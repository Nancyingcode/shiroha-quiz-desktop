// 注册离线 DOCX 解析器，通过共享的 Zip 能力读取正文和内部资源。
(() => {
  'use strict';

  // 注入文件读取及诊断能力，使文档解析可在 Web、桌面和测试中复用。
  function create({ readBuffer, warnDev }) {
    const { parseZipEntries, unzipEntry, unzipEntryBytes } = globalThis.ShirohaZip;
    // 按关系声明顺序读取内嵌图片并保留编号，资源损坏时交回此前已恢复的图片。
    async function collectDocxImages(buf, entries, relXml) {
      const imageMap = {};
      try {
        const rels = parseDocxImageRelationships(relXml);
        let imageNo = 1;
        for (const [rid, target] of Object.entries(rels)) {
          const entryName = docxImageTargetToEntryName(target);
          const imgEntry = entries.find((e) => e.name === entryName);
          if (!imgEntry) { continue; }

          const mime = docxImageMime(entryName);
          // 这些位图格式可直接嵌入浏览器题干，其他图片只提供文本占位。
          if (/^image\/(?:png|jpe?g|gif|webp|bmp)$/i.test(mime)) {
            const bytes = await unzipEntryBytes(buf, imgEntry);
            imageMap[rid] = await makeOptimizedDocxImageMarkdown(bytes, mime, imageNo);
          } else {
            imageMap[rid] = `【DOCX图片${imageNo}：${entryName.split('/').pop()}，当前浏览器可能无法直接显示】`;
          }

          imageNo += 1;
        }
      } catch (err) { warnDev('DOCX 图片提取失败，继续按纯文本导入。', err); }

      return imageMap;
    }

    // 按文档关系表恢复内嵌图片和外部正文，保留资源读取失败时的兼容提示。
    async function extractDocxText(file) {
      const buf = await readBuffer(file);
      const entries = parseZipEntries(buf);
      const doc = entries.find((e) => e.name === 'word/document.xml');
      if (!doc) { throw new Error('未找到 word/document.xml，可能不是有效 .docx 文件'); }

      const xml = await unzipEntry(buf, doc);
      const relEntry = entries.find((e) => e.name === 'word/_rels/document.xml.rels');
      let relXml = '';
      if (relEntry) {
        try { relXml = await unzipEntry(buf, relEntry); } catch (err) { warnDev('DOCX 关系文件读取失败，继续按正文导入。', err); }
      }

      const imageMap = relXml ? await collectDocxImages(buf, entries, relXml) : {};
      let altChunkMap = {};
      // 主文档声明 aFChunk 时才读取外部正文；若最终为空，需要给出明确的兼容提示。
      const hasAltChunk = /<w:altChunk\b/i.test(xml);
      if (relXml && hasAltChunk) {
        try {
          const rels = parseDocxAltChunkRelationshipsV58922(relXml);
          altChunkMap = await extractDocxAltChunksV58922(buf, entries, rels);
        } catch (err) { warnDev('DOCX aFChunk 内容提取失败，继续按普通正文导入。', err); }
      }

      const text = docxXmlToText(xml, imageMap, altChunkMap);
      if (!String(text || '').trim() && hasAltChunk) { throw new Error('DOCX 正文位于 aFChunk 外部内容块中，但未能读取，请尝试用 Word/WPS 另存为标准 DOCX 后重试'); }

      return text;
    }

    function docxImageDataMarkdown(no, mime, bytes) {
      return `![DOCX图片${no}](data:${mime};base64,${bytesToBase64(bytes)})`;
    }

    function dataUrlToBytesApprox(dataUrl) {
      const b64 = String(dataUrl || '').split(',')[1] || '';
      return Math.ceil(b64.length * 3 / 4);
    }

    // 在浏览器能力支持且压缩有收益时生成较小的图片，转码失败时保留原件。
    async function makeOptimizedDocxImageMarkdown(bytes, mime, no) {
      try {
        const rawBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        const rawMarkdown = docxImageDataMarkdown(no, mime, rawBytes);
        const canCanvas = typeof document !== 'undefined' && document.createElement && typeof globalThis.Image !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined';
        // 仅允许无动画位图参与画布转码，避免把 GIF 降为静态帧。
        const raster = /^image\/(?:png|jpe?g|webp|bmp)$/i.test(mime);
        if (!canCanvas || !raster) { return rawMarkdown; }

        const blob = new Blob([rawBytes], { type: mime });
        const url = URL.createObjectURL(blob);
        let img;
        try {
          img = await new Promise(/* 图像加载完成或失败后再解除对象地址关联，避免浏览器从已释放地址读取。 */ (resolve, reject) => {
            const im = new globalThis.Image();
            im.onload = () => resolve(im);

            im.onerror = () => reject(new Error('图片解码失败'));

            im.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }

        const maxW = 1400; const maxH = 1100;
        const w = img.naturalWidth || img.width || 0; const h = img.naturalHeight || img.height || 0;
        if (!w || !h) { return rawMarkdown; }

        const scale = Math.min(1, maxW / w, maxH / h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) { return rawMarkdown; }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let dataUrl = '';
        try { dataUrl = canvas.toDataURL('image/webp', 0.82); } catch { dataUrl = ''; }

        // 浏览器可能不实现 WebP 导出；检查真实的 data URL 类型后决定是否尝试 JPEG。
        if (!/^data:image\/webp;base64,/.test(dataUrl)) {
          try { dataUrl = canvas.toDataURL('image/jpeg', 0.86); } catch { dataUrl = ''; }
        }

        if (!dataUrl) { return rawMarkdown; }

        // 如果原图已经很小，且转码后反而更大，则保留原图，避免无意义膨胀。
        const optimizedBytes = dataUrlToBytesApprox(dataUrl);
        if (rawBytes.length < 260 * 1024 && optimizedBytes > rawBytes.length * 1.05) { return rawMarkdown; }

        return `![DOCX图片${no}](${dataUrl})`;
      } catch (err) {
        warnDev('DOCX 图片压缩失败，保留原图。', err);
        return docxImageDataMarkdown(no, mime, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
      }
    }

    // 为内部图片建立关系 ID 到资源路径的映射，供正文中的图形引用恢复。
    function parseDocxImageRelationships(xml) {
      const out = {};let m;const re = /* 从关系文件中逐个读取完整的关系标签。 */ /<Relationship\b[^>]*>/g;
      while ((m = re.exec(String(xml || '')))) {
        const tag = m[0];
        // 取关系类型，以免把超链接或嵌入对象误读取为图片。
        const type = (tag.match(/Type="([^"]+)"/) || [])[1] || '';
        if (!/* 接受 URI 以 image 结尾的标准图片关系。 */ /\/image$/i.test(type) && !/* 兼容图片类型 URI 保有 relationships/image 路径的文档。 */ /relationships\/image/i.test(type)) { continue; }

        // 关系 ID 用于匹配正文中的图片节点。
        const id = (tag.match(/Id="([^"]+)"/) || [])[1];
        // 读取压缩包内部目标路径，之后再解码 XML 属性。
        const target = (tag.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) { out[id] = decodeXml(target); }
      }

      return out;
    }

    // v58_9_22：兼容由 HTML/MHT 外部内容块承载正文的 DOCX。
    function parseDocxAltChunkRelationshipsV58922(xml) {
      const out = {};let m;const re = /* 枚举关系标签，保持外部内容块在文件中的声明顺序。 */ /<Relationship\b[^>]*>/g;
      while ((m = re.exec(String(xml || '')))) {
        const tag = m[0];
        // 先读取关系类型，再筛选可导入的正文关联。
        const type = (tag.match(/Type="([^"]+)"/) || [])[1] || '';
        if (!/* OOXML 使用 aFChunk 关系标识可替换的正文内容。 */ /relationships\/aFChunk$/i.test(type) && !/* 兼容简化关系 URI 但仍以 aFChunk 结尾的文档。 */ /\/aFChunk$/i.test(type)) { continue; }

        // 取供正文 aFChunk 标签引用的关系 ID。
        const id = (tag.match(/Id="([^"]+)"/) || [])[1];
        // 获取应从 DOCX 包内读取的正文块路径。
        const target = (tag.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) { out[id] = decodeXml(target); }
      }

      return out;
    }

    // 按关系顺序读取可用的 DOCX 外部正文块，并以 ID 对应回主文档。
    async function extractDocxAltChunksV58922(buf, entries, rels) {
      const out = {};
      for (const [rid, target] of Object.entries(rels || {})) {
        const entryName = docxImageTargetToEntryName(target);
        const entry = entries.find((e) => e.name === entryName);
        if (!entry) { continue; }

        const raw = await unzipEntry(buf, entry);
        const text = docxAltChunkToTextV58922(raw, entryName);
        if (text) { out[rid] = text; }
      }

      return out;
    }

    // 根据资源文件名或 MIME 声明判别外部正文是 HTML 还是 MHT 封包。
    function docxAltChunkToTextV58922(raw, entryName = '') {
      const source = String(raw || '');
      const isMht = /* .mht 或 .mhtml 扩展表明需先拆解 MIME 内容。 */ /\.mht(?:ml)?$/i.test(entryName) || /* 无文件名时也能由 MIME 版本头识别封包。 */ /^MIME-Version:/im.test(source) || /* 声明多部分内容的 MIME 头是另一种 MHT 证据。 */ /Content-Type:\s*multipart\//i.test(source);
      const html = isMht ? extractHtmlPartFromMhtV58922(source) : source;
      return htmlToImportTextV58922(html);
    }

    // 在首个空行处分隔 MIME 头和正文，同时兼容两种换行格式。
    function splitMimeHeaderBodyV58922(text) {
      const source = String(text || '');
      // CRLF 或 LF 空行都可能标记 MIME 头结束。
      const m = /\r?\n\r?\n/.exec(source);
      if (!m) { return { headers: '', body: source }; }

      return { headers: source.slice(0, m.index), body: source.slice(m.index + m[0].length) };
    }

    function unfoldMimeHeadersV58922(headers) {
      // MIME 头的续行以空格或制表符开始，应与上一行合并后再查找字段。
      return String(headers || '').replace(/\r?\n[ \t]+/g, ' ');
    }

    // 忽略字段名大小写查找单个头值，允许读取跨行折叠的 MIME 字段。
    function mimeHeaderValueV58922(headers, name) {
      const source = unfoldMimeHeadersV58922(headers);
      // 转义字段名内的正则元字符，确保按字面量读取指定头名。
      const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 只读取该字段的独立头行内容，避免命中正文或其他头名。
      const m = source.match(new RegExp(`(?:^|\\r?\\n)${escaped}\\s*:\\s*([^\\r\\n]+)`, 'i'));
      return m ? m[1].trim() : '';
    }

    function mimeCharsetV58922(contentType) {
      // MIME 字符集可由双引号、单引号或无引号参数给出。
      const m = String(contentType || '').match(/charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
      return ((m && (m[1] || m[2] || m[3])) || 'utf-8').trim();
    }

    function decodeMimeBytesV58922(bytes, charset = 'utf-8') {
      try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
    }

    // 将 quoted-printable 正文还原为字节，按 MIME 字符集解码外部正文。
    function decodeQuotedPrintableV58922(text, charset = 'utf-8') {
      // 等号紧接换行表示软折行，不应进入解码后的正文。
      const source = String(text || '').replace(/=\r?\n/g, '');
      const bytes = [];const encoder = new TextEncoder();let literal = '';
      const flush = () => {
        if (!literal) { return; }

        const encoded = encoder.encode(literal);for (const b of encoded) { bytes.push(b); }

        literal = '';
      };

      for (let i = 0;i < source.length;i += 1) {
        // 等号后恰好构成十六进制字节时才按转义替换。
        if (source[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
          flush();bytes.push(parseInt(source.slice(i + 1, i + 3), 16));i += 2;
        } else { literal += source[i]; }
      }

      flush();
      return decodeMimeBytesV58922(new Uint8Array(bytes), charset);
    }

    // 按 MIME 传输编码解包正文，读取 Base64 或 quoted-printable 中的原始字节。
    function decodeMimePartBodyV58922(body, transferEncoding, charset) {
      const encoding = String(transferEncoding || '').toLowerCase();
      if (encoding.includes('quoted-printable')) { return decodeQuotedPrintableV58922(body, charset); }

      if (encoding.includes('base64')) {
        // 忽略 Base64 传输中插入的换行和空白。
        const clean = String(body || '').replace(/\s+/g, '');
        const bin = globalThis.atob(clean);const bytes = new Uint8Array(bin.length);
        for (let i = 0;i < bin.length;i += 1) { bytes[i] = bin.charCodeAt(i); }

        return decodeMimeBytesV58922(bytes, charset);
      }

      return String(body || '');
    }

    // 按 MIME 边界寻找首个 HTML 内容块，保留无法拆分时的原文回退。
    function extractHtmlPartFromMhtV58922(raw) {
      const root = splitMimeHeaderBodyV58922(raw);
      const rootHeaders = unfoldMimeHeadersV58922(root.headers);
      const contentType = mimeHeaderValueV58922(rootHeaders, 'Content-Type');
      // MIME 边界值可能加引号，也可能裸写，拆分前只取参数内容。
      const boundaryMatch = contentType.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
      const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2] || boundaryMatch[3]);
      if (boundary) {
        const marker = `--${boundary}`;
        const parts = root.body.split(marker);
        for (let part of parts) {
          part = part.replace(/* 移除 MIME 分界后多出的首个 CRLF 或 LF。 */ /^\r?\n/, '').replace(/* 移除多部分封包结尾的终止边界残留。 */ /\r?\n--\s*$/, '').trim();
          if (!part) { continue; }

          const parsed = splitMimeHeaderBodyV58922(part);
          const headers = unfoldMimeHeadersV58922(parsed.headers);
          const partType = mimeHeaderValueV58922(headers, 'Content-Type');
          // 只选择 HTML 正文部分，跳过图片和其他 MIME 附件。
          if (!/^text\/html\b/i.test(partType)) { continue; }

          const transfer = mimeHeaderValueV58922(headers, 'Content-Transfer-Encoding');
          return decodeMimePartBodyV58922(parsed.body, transfer, mimeCharsetV58922(partType));
        }
      }

      const transfer = mimeHeaderValueV58922(rootHeaders, 'Content-Transfer-Encoding');
      return decodeMimePartBodyV58922(root.body, transfer, mimeCharsetV58922(contentType));
    }

    // 按 HTML 节点顺序提取可见文本和结构换行，避免把样式脚本带进题库。
    function htmlNodeTextV58922(node) {
      if (!node) { return ''; }

      if (node.nodeType === 3) { return node.nodeValue || ''; }

      if (node.nodeType !== 1) { return ''; }

      const tag = String(node.tagName || '').toUpperCase();
      if (tag === 'BR') { return '\n'; }

      let text = '';
      for (const child of node.childNodes || []) { text += htmlNodeTextV58922(child); }

      return text;
    }

    function cleanAltChunkLineV58922(text) {
      return String(text || '').replace(/* 将 HTML 的不换行空格还原成普通空格。 */ /\u00a0/g, ' ').replace(/* 压缩可见行中的水平空白，保留结构换行。 */ /[ \t]+/g, ' ').replace(/* 去掉结构换行两侧的空格，稳定后续分行。 */ / *\n */g, '\n').trim();
    }

    // 按段落、表格和列表的文档顺序输出可供题库分块的外部 HTML 正文。
    function htmlToImportTextV58922(html) {
      const source = String(html || '').trim();if (!source) { return ''; }

      const doc = new globalThis.DOMParser().parseFromString(source, 'text/html');
      const body = doc.body || doc.documentElement;if (!body) { return ''; }

      const selector = 'p,li,h1,h2,h3,h4,h5,h6,pre,tr';
      const lines = [];
      for (const el of body.querySelectorAll(selector)) {
        const tag = String(el.tagName || '').toUpperCase();
        if (tag === 'TR' && el.querySelector('p,li,h1,h2,h3,h4,h5,h6,pre')) { continue; }

        if (tag !== 'TR' && el.parentElement && el.parentElement.closest('p,li,h1,h2,h3,h4,h5,h6,pre')) { continue; }

        let text;
        if (tag === 'TR') {
          text = Array.from(el.querySelectorAll(':scope > td, :scope > th')).map((cell) => cleanAltChunkLineV58922(htmlNodeTextV58922(cell))).filter(Boolean).join('\t');
        } else { text = cleanAltChunkLineV58922(htmlNodeTextV58922(el)); }

        if (text) { lines.push(text); }
      }

      if (!lines.length) {
        const fallback = cleanAltChunkLineV58922(htmlNodeTextV58922(body));
        if (fallback) { lines.push(...fallback.split(/* 回退到节点文本时，按连续换行拆成独立正文行。 */ /\n+/).map((x) => x.trim()).filter(Boolean)); }
      }

      return lines.join('\n');
    }

    // 把关系目标转换成 DOCX 压缩包内可查找的条目名，兼容 Word 的相对路径写法。
    function docxImageTargetToEntryName(target) {
      let path = String(target || '').replace(/* 统一关系目标中的 Windows 反斜杠分隔符。 */ /\\/g, '/').replace(/* 去掉明确指向当前目录的路径前缀。 */ /^\.\//, '');
      if (path.startsWith('/')) { path = path.slice(1); }

      if (path.startsWith('word/')) { return path; }

      if (path.startsWith('../')) { return path.replace(/* 兼容以 ../ 引用相邻 DOCX 包目录的关系文件。 */ /^\.\.\//, ''); }

      return `word/${path}`;
    }

    // 根据包内文件扩展名区分可内嵌的位图和只可保留占位的其他资源。
    function docxImageMime(name) {
      const ext = String(name || '').split('.').pop().toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') { return 'image/jpeg'; }

      if (ext === 'png') { return 'image/png'; }

      if (ext === 'gif') { return 'image/gif'; }

      if (ext === 'webp') { return 'image/webp'; }

      if (ext === 'bmp') { return 'image/bmp'; }

      if (ext === 'svg') { return 'application/octet-stream'; }

      if (ext === 'wmf') { return 'image/x-wmf'; }

      if (ext === 'emf') { return 'image/x-emf'; }

      return 'application/octet-stream';
    }

    function bytesToBase64(bytes) {
      let bin = '';const chunk = 0x8000;
      for (let i = 0;i < bytes.length;i += chunk) { bin += String.fromCharCode.apply(null, bytes.slice(i, i + chunk)); }

      return globalThis.btoa(bin);
    }

    // 按原文顺序展开 DOCX 正文及关联资源，兼容只传入正文 XML 片段的调用。
    function docxXmlToText(xml, imageMap = {}, altChunkMap = {}) {
      // v54 / 内部 v30：DOCX 富文本块识别。
      // 从“全局抽段落”调整为按 document body 顺序识别段落、表格、图片和 OMML 公式，
      // 先保证结构不丢、不乱序；表格精细显示与公式渲染留给后续版本。
      const raw = String(xml || '');
      // 优先只读取 Word body，以免把文件级元数据作为题目正文。
      const body = (raw.match(/<w:body\b[\s\S]*?<\/w:body>/) || [])[0] || raw;
      const blocks = docxBodyToTextBlocks(body, imageMap, altChunkMap);
      return blocks.map((x) => String(x || '').trim()).filter(Boolean).join('\n');
    }

    // 按文档顺序拆分段落、表格、公式和可替换正文块，交由各自规则转换。
    function docxBodyToTextBlocks(xml, imageMap = {}, altChunkMap = {}) {
      const blocks = [];
      // 统一读取正文中的完整复合节点，保持正文与图片、表格和公式的相对次序。
      const re = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>|<w:altChunk\b[^>]*(?:\/>|>[\s\S]*?<\/w:altChunk>)|<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>/g;
      let m;
      while ((m = re.exec(String(xml || '')))) {
        const token = m[0];
        let text;
        if (/* 表格正文交由按行与单元格处理的转换器。 */ /^<w:tbl/i.test(token)) { text = docxTableToText(token, imageMap); } else if (/* 普通 Word 段落需要保留内部文本、图形和公式顺序。 */ /^<w:p/i.test(token)) { text = docxParagraphToText(token, imageMap); } else if (/* 可替换正文块须用关系 ID 查找预先读取的正文。 */ /^<w:altChunk/i.test(token)) {
          // 读取 aFChunk 关系 ID，绑定该位置的外部正文。
          const rid = (token.match(/r:id="([^"]+)"/) || [])[1] || '';
          text = rid ? altChunkMap[rid] || '' : '';
        } else { text = docxMathToText(token); }

        text = String(text || '').trim();
        if (text) { blocks.push(text); }
      }

      return blocks;
    }

    // 按 Word 段落的内联节点顺序重建可见内容，保留换行和制表符。
    function docxParagraphToText(p, imageMap = {}) {
      const parts = [];
      // 统一提取运行块、公式、链接、文字节点和资源引用，匹配顺序即原文顺序。
      const re = /<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<w:hyperlink\b[\s\S]*?<\/w:hyperlink>|<w:r\b[\s\S]*?<\/w:r>|<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/g;
      let m;
      while ((m = re.exec(String(p || '')))) {
        parts.push(docxInlineTokenToText(m[0], imageMap));
      }

      return docxCleanBlockText(parts.join(''));
    }

    // 按内联节点类型交给适当的转换器，保留公式、资源和格式边界。
    function docxInlineTokenToText(value, imageMap = {}) {
      const token = String(value || '');
      // OMML 节点先按公式规则处理，避免用普通正文过滤数学符号。
      if (/^<m:oMath/i.test(token)) { return docxMathToText(token); }

      // 超链接本身由常规段落规则提取可见文本。
      if (/^<w:hyperlink/i.test(token)) { return docxParagraphToText(token, imageMap); }

      // Word 运行块需检查上标和下标属性。
      if (/^<w:r/i.test(token)) { return docxRunToText(token, imageMap); }

      // 原始 Word 文字节点可直接按 XML 文本提取。
      if (/^<w:t/i.test(token)) {
        // 取完整文字节点的内部文本并解码实体。
        const tm = token.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
        return tm ? decodeXml(tm[1]) : '';
      }

      // 保留 Word 制表符的位置，供后续识别列或段边界。
      if (/^<w:tab/i.test(token)) { return '\t'; }

      // Word 换行标签对应可见的段内换行。
      if (/^<w:br/i.test(token)) { return '\n'; }

      if (/* 现代 Word 绘图节点可能持有嵌入图片关系。 */ /^<w:drawing/i.test(token) || /* 同样读取旧版 Word pict 节点内的图片引用。 */ /^<w:pict/i.test(token)) { return docxImageRefsToText(token, imageMap); }

      return '';
    }

    // 将同一 Word 运行块的文字、公式和图片按原顺序拼接，并转换文字的上下标模式。
    function docxRunToText(run, imageMap = {}) {
      const mode = getDocxRunVerticalMode(run);
      const parts = [];
      // 同时扫描运行块中的公式、文字、跳格和两种图片节点。
      const re = /<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/g;
      let m;
      while ((m = re.exec(String(run || '')))) {
        const token = m[0];
        // 运行块内部的公式保留独立的公式转换。
        if (/^<m:oMath/i.test(token)) { parts.push(docxMathToText(token)); } else if (token.startsWith('<w:t')) {
          // 解码 Word 文本后再应用上下标转换。
          const tm = token.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
          if (tm) { parts.push(convertDocxScriptText(decodeXml(tm[1]), mode)); }
        } else if (/* 文本运行块应保留制表符的位置。 */ /^<w:tab/i.test(token)) { parts.push('\t'); } else if (/* 文本运行块应保留显式换行，而不是把下行正文粘在上一行。 */ /^<w:br/i.test(token)) { parts.push('\n'); } else { parts.push(docxImageRefsToText(token, imageMap)); }
      }

      return parts.join('');
    }

    // 按行和单元格收集 Word 表格，只保留有正文的行。
    function docxTableToText(tbl, imageMap = {}) {
      const rows = [];
      // 逐个捕获 Word 表格行，保持原始排列顺序。
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rm;
      while ((rm = rowRe.exec(String(tbl || '')))) {
        const row = rm[0];
        const cells = [];
        // 在每行读取完整的单元格节点，保留单元格内部的图文和公式。
        const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        let cm;
        while ((cm = cellRe.exec(row))) {
          cells.push(docxTableCellToText(cm[0], imageMap));
        }

        if (cells.some((x) => String(x || '').trim())) { rows.push(cells); }
      }

      if (!rows.length) { return ''; }

      return docxRowsToMarkdownTable(rows);
    }

    function docxTableCellToText(cell, imageMap = {}) {
      const parts = docxBodyToTextBlocks(cell, imageMap);
      return docxCleanTableCellText(parts.join(' / '));
    }

    // 将不规则行填齐为 Markdown 表格，保留导入分块使用的表格起止标记。
    function docxRowsToMarkdownTable(rows) {
      const maxCols = Math.max(1, ...rows.map((r) => r.length || 0));
      const padded = rows.map((r) => Array.from({ length: maxCols }, (_, i) => docxMarkdownTableCell(r[i] || '')));
      const lines = ['【DOCX表格开始】'];
      const first = padded[0] || [];
      lines.push(`| ${first.join(' | ')} |`);
      lines.push(`| ${Array.from({ length: maxCols }, () => '---').join(' | ')} |`);

      padded.slice(1).forEach((r) => lines.push(`| ${r.join(' | ')} |`));

      lines.push('【DOCX表格结束】');
      return lines.join('\n');
    }

    function docxMarkdownTableCell(text) {
      return String(text || '').replace(/* 将单元格正文中的管道符换成全角符号，避免被误作列边界。 */ /\|/g, '｜').replace(/* 将单元格内换行改为 br，防止把一格内容误拆成多行数据。 */ /\s*\n+\s*/g, '<br>').replace(/* 折叠单元格内重复空白，保持列文本稳定。 */ /\s{2,}/g, ' ').trim();
    }

    function docxCleanTableCellText(text) {
      return String(text || '').replace(/* 将行内制表符和连续普通空格缩为一个空格。 */ /[\t ]+/g, ' ').replace(/* 用斜杠保留同一单元格内独立段落之间的可见边界。 */ /\s*\n+\s*/g, ' / ').replace(/* 压缩换行转换后残留的重复空白。 */ /\s{2,}/g, ' ').trim();
    }

    // 清理正文段落的排版空白，保留单行和双行两类题目分隔。
    function docxCleanBlockText(text) {
      return String(text || '')
        .replace(/* 将表示水平排版的多余空格及制表符缩为一个空格。 */ /[\t ]+/g, ' ')
        .replace(/* 清理下一行开头的缩进残留。 */ /\n[ \t]+/g, '\n')
        .replace(/* 清理各行末尾因 XML 转换留下的水平空白。 */ /[ \t]+\n/g, '\n')
        .replace(/* 限制连续空行，保留两行作为段落边界。 */ /\n{3,}/g, '\n\n')
        .trim();
    }

    function docxMathToText(xml) {
      // 压缩公式文本的多余空白，便于作为同一占位式保存在题干。
      const plain = docxOmmlToPlainText(xml).replace(/\s{2,}/g, ' ').trim();
      return plain ? `【DOCX公式OMML：${plain}】` : '【DOCX公式OMML】';
    }

    // 按分子与分母还原分式，两部分都无法解析时保留文本回退。
    function renderDocxFraction(m) {
      const num = docxInnerXmlOfTag(m, 'm:num');
      const den = docxInnerXmlOfTag(m, 'm:den');
      const a = docxOmmlToPlainText(num); const b = docxOmmlToPlainText(den);
      return a || b ? `(${a})/(${b})` : docxOmmlFallbackText(m);
    }

    // 保留公式底数，仅在上标存在时附加其内容。
    function renderDocxSuperscript(m) {
      const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
      const sup = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sup'));
      return sup ? `${e}^{${sup}}` : e;
    }

    // 保留公式底数，仅在下标存在时附加其内容。
    function renderDocxSubscript(m) {
      const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
      const sub = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sub'));
      return sub ? `${e}_{${sub}}` : e;
    }

    // 为同一底数按下标、上标的既定顺序恢复复合结构。
    function renderDocxBothScripts(m) {
      const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
      const sub = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sub'));
      const sup = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sup'));
      return `${e}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}`;
    }

    // 还原被开方内容；仅在原文提供根次数时带入根次数。
    function renderDocxRadical(m) {
      const deg = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:deg'));
      const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
      return deg ? `√[${deg}](${e})` : `√(${e})`;
    }

    // 恢复运算符、上下界和操作数，并保留缺省求和符号。
    function renderDocxNary(m) {
      const chr = docxOmmlChr(m) || '∑';
      const sub = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sub'));
      const sup = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sup'));
      const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
      return `${chr}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}${e ? ` ${e}` : ''}`;
    }

    // 按固定次序递归展开可支持的 OMML 结构，并为无法解析的部分保留文本回退。
    function docxOmmlToPlainText(xml) {
      let s = String(xml || '');
      if (!s) { return ''; }

      const replaceStruct = (re, fn) => {
        s = s.replace(re, fn);
      };

      for (let i = 0;i < 4;i += 1) {
        replaceStruct(/* 匹配完整分式结构，继续读取其分子和分母。 */ /<m:f\b[\s\S]*?<\/m:f>/g, renderDocxFraction);
        replaceStruct(/* 找出上标节点以恢复底数和指数的顺序。 */ /<m:sSup\b[\s\S]*?<\/m:sSup>/g, renderDocxSuperscript);
        replaceStruct(/* 找出下标节点以保持底数和索引关系。 */ /<m:sSub\b[\s\S]*?<\/m:sSub>/g, renderDocxSubscript);
        replaceStruct(/* 同时带上下标的节点须一次处理，避免把下标或上标独立拆开。 */ /<m:sSubSup\b[\s\S]*?<\/m:sSubSup>/g, renderDocxBothScripts);
        replaceStruct(/* 识别完整根式，保留可能省略的根次数。 */ /<m:rad\b[\s\S]*?<\/m:rad>/g, renderDocxRadical);
        replaceStruct(/* 匹配 Word 求和等多元运算符，后续继续读取上下界和操作数。 */ /<m:nary\b[\s\S]*?<\/m:nary>/g, renderDocxNary);
      }

      return docxOmmlFallbackText(s);
    }

    // 对未识别的公式结构保留可见字符和文字，清除剩余的 XML 包装。
    function docxOmmlFallbackText(xml) {
      let s = String(xml || '');
      // 用 OMML 字符属性中实际的符号代替整个标签。
      s = s.replace(/<m:chr\b[^>]*>/g, (m) => docxOmmlChr(m));

      // 公式内换行先转换为普通换行，供统一空白整理。
      s = s.replace(/<m:br\b[^>]*\/>/g, '\n');
      // 提取数学或 Word 文本节点中的文字并解码实体。
      s = s.replace(/<(?:m|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:m|w):t>/g, (_, v) => decodeXml(v));

      // 文本取出后去掉剩余的结构标签。
      s = s.replace(/<[^>]+>/g, '');
      // 折叠公式回退文本的空格与换行。
      return decodeXml(s).replace(/\s+/g, ' ').trim();
    }

    function docxOmmlChr(xml) {
      // 运算符字符保存在 m:val 属性，兼容单引号和双引号。
      const m = String(xml || '').match(/m:val=["']([^"']+)["']/i);
      return m ? decodeXml(m[1]) : '';
    }

    function docxInnerXmlOfTag(xml, tag) {
      // 动态匹配调用处指定的完整内部标签，仅返回首个匹配的节点正文。
      const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m = String(xml || '').match(re);
      return m ? m[1] : '';
    }

    // 从运行块格式中读取上下标模式，供纯文本转换保留指数和索引含义。
    function getDocxRunVerticalMode(run) {
      // 先定位运行块的属性节点，避免正文里的同名片段影响判断。
      const rpr = (String(run || '').match(/<w:rPr\b[\s\S]*?<\/w:rPr>/) || [])[0] || '';
      // 在运行块属性中找垂直对齐设置。
      const tag = (rpr.match(/<w:vertAlign\b[^>]*>/) || [])[0] || '';
      // 提取垂直对齐类型的属性值并归一为小写。
      const val = ((tag.match(/w:val=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
      if (val === 'superscript') { return 'sup'; }

      if (val === 'subscript') { return 'sub'; }

      return '';
    }

    // 将有对应 Unicode 形式的字符转换为上标或下标，保留未支持的字形。
    function convertDocxScriptText(text, mode) {
      if (!mode) { return String(text || ''); }

      const sup = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
      const sub = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
      const map = mode === 'sup' ? sup : sub;
      // 只转换上下标映射表支持的数字、常见符号和字符。
      return String(text || '').replace(/[0-9+\-=()ni]/g, (ch) => map[ch] || ch);
    }

    function docxImageRefsToText(token, imageMap = {}) {
      const ids = [];let im;const idRe = /* 优先恢复正文顺序中的嵌入、链接和普通关系 ID，再去重解析。 */ /(?:r:embed|r:id|r:link)=["']([^"']+)["']/g;
      while ((im = idRe.exec(String(token || '')))) { ids.push(im[1]); }

      return [...new Set(ids)].map((id) => (imageMap[id] ? `\n${imageMap[id]}\n` : '')).join('');
    }

    function decodeXml(s) {
      return String(s).replace(/* 将 XML 的十六进制字符实体还原为 Unicode 字符。 */ /&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/* 兼容十进制形式的 XML 字符实体。 */ /&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10))).replace(/* 还原正文中按 XML 转义的左尖括号。 */ /&lt;/g, '<').replace(/* 还原正文中按 XML 转义的右尖括号。 */ /&gt;/g, '>').replace(/* 按既有解码次序还原转义的 & 符号。 */ /&amp;/g, '&').replace(/* 还原正文中转义的双引号。 */ /&quot;/g, '"').replace(/* 还原正文中转义的单引号。 */ /&apos;/g, "'");
    }

    return { extractDocxText, docxXmlToText, decodeXml };
  }

  globalThis.ShirohaDocx = Object.freeze({ create });
})();
