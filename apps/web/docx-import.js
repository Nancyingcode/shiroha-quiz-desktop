(() => {
  'use strict';

  function create({ readBuffer, warnDev }) {
    const { parseZipEntries, unzipEntry, unzipEntryBytes } = globalThis.ShirohaZip;
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
      const imageMap = {};
      if (relXml) {
        try {
          const rels = parseDocxImageRelationships(relXml);
          let imageNo = 1;
          for (const [rid, target] of Object.entries(rels)) {
            const entryName = docxImageTargetToEntryName(target);
            const imgEntry = entries.find((e) => e.name === entryName);
            if (!imgEntry) { continue; }
            const mime = docxImageMime(entryName);
            if (/^image\/(?:png|jpe?g|gif|webp|bmp)$/i.test(mime)) {
              const bytes = await unzipEntryBytes(buf, imgEntry);
              imageMap[rid] = await makeOptimizedDocxImageMarkdown(bytes, mime, imageNo);
            } else {
              imageMap[rid] = `【DOCX图片${imageNo}：${entryName.split('/').pop()}，当前浏览器可能无法直接显示】`;
            }
            imageNo++;
          }
        } catch (err) { warnDev('DOCX 图片提取失败，继续按纯文本导入。', err); }
      }
      let altChunkMap = {};
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
    async function makeOptimizedDocxImageMarkdown(bytes, mime, no) {
      try {
        const rawBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        const rawMarkdown = docxImageDataMarkdown(no, mime, rawBytes);
        const canCanvas = typeof document !== 'undefined' && document.createElement && typeof globalThis.Image !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined';
        const raster = /^image\/(?:png|jpe?g|webp|bmp)$/i.test(mime);
        if (!canCanvas || !raster) { return rawMarkdown; }
        const blob = new Blob([rawBytes], { type: mime });
        const url = URL.createObjectURL(blob);
        let img;
        try {
          img = await new Promise((resolve, reject) => {
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

    function parseDocxImageRelationships(xml) {
      const out = {};let m;const re = /<Relationship\b[^>]*>/g;
      while ((m = re.exec(String(xml || '')))) {
        const tag = m[0];
        const type = (tag.match(/Type="([^"]+)"/) || [])[1] || '';
        if (!/\/image$/i.test(type) && !/relationships\/image/i.test(type)) { continue; }
        const id = (tag.match(/Id="([^"]+)"/) || [])[1];
        const target = (tag.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) { out[id] = decodeXml(target); }
      }
      return out;
    }

    // v58_9_22：兼容由 HTML/MHT 外部内容块承载正文的 DOCX。
    function parseDocxAltChunkRelationshipsV58922(xml) {
      const out = {};let m;const re = /<Relationship\b[^>]*>/g;
      while ((m = re.exec(String(xml || '')))) {
        const tag = m[0];
        const type = (tag.match(/Type="([^"]+)"/) || [])[1] || '';
        if (!/relationships\/aFChunk$/i.test(type) && !/\/aFChunk$/i.test(type)) { continue; }
        const id = (tag.match(/Id="([^"]+)"/) || [])[1];
        const target = (tag.match(/Target="([^"]+)"/) || [])[1];
        if (id && target) { out[id] = decodeXml(target); }
      }
      return out;
    }
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
    function docxAltChunkToTextV58922(raw, entryName = '') {
      const source = String(raw || '');
      const isMht = /\.mht(?:ml)?$/i.test(entryName) || /^MIME-Version:/im.test(source) || /Content-Type:\s*multipart\//i.test(source);
      const html = isMht ? extractHtmlPartFromMhtV58922(source) : source;
      return htmlToImportTextV58922(html);
    }
    function splitMimeHeaderBodyV58922(text) {
      const source = String(text || '');
      const m = /\r?\n\r?\n/.exec(source);
      if (!m) { return { headers: '', body: source }; }
      return { headers: source.slice(0, m.index), body: source.slice(m.index + m[0].length) };
    }
    function unfoldMimeHeadersV58922(headers) {
      return String(headers || '').replace(/\r?\n[ \t]+/g, ' ');
    }
    function mimeHeaderValueV58922(headers, name) {
      const source = unfoldMimeHeadersV58922(headers);
      const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = source.match(new RegExp('(?:^|\\r?\\n)' + escaped + '\\s*:\\s*([^\\r\\n]+)', 'i'));
      return m ? m[1].trim() : '';
    }
    function mimeCharsetV58922(contentType) {
      const m = String(contentType || '').match(/charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
      return ((m && (m[1] || m[2] || m[3])) || 'utf-8').trim();
    }
    function decodeMimeBytesV58922(bytes, charset = 'utf-8') {
      try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
    }
    function decodeQuotedPrintableV58922(text, charset = 'utf-8') {
      const source = String(text || '').replace(/=\r?\n/g, '');
      const bytes = [];const encoder = new TextEncoder();let literal = '';
      const flush = () => { if (!literal) { return; } const encoded = encoder.encode(literal);for (const b of encoded) { bytes.push(b); }literal = ''; };
      for (let i = 0;i < source.length;i++) {
        if (source[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
          flush();bytes.push(parseInt(source.slice(i + 1, i + 3), 16));i += 2;
        } else { literal += source[i]; }
      }
      flush();
      return decodeMimeBytesV58922(new Uint8Array(bytes), charset);
    }
    function decodeMimePartBodyV58922(body, transferEncoding, charset) {
      const encoding = String(transferEncoding || '').toLowerCase();
      if (encoding.includes('quoted-printable')) { return decodeQuotedPrintableV58922(body, charset); }
      if (encoding.includes('base64')) {
        const clean = String(body || '').replace(/\s+/g, '');
        const bin = globalThis.atob(clean);const bytes = new Uint8Array(bin.length);
        for (let i = 0;i < bin.length;i++) { bytes[i] = bin.charCodeAt(i); }
        return decodeMimeBytesV58922(bytes, charset);
      }
      return String(body || '');
    }
    function extractHtmlPartFromMhtV58922(raw) {
      const root = splitMimeHeaderBodyV58922(raw);
      const rootHeaders = unfoldMimeHeadersV58922(root.headers);
      const contentType = mimeHeaderValueV58922(rootHeaders, 'Content-Type');
      const boundaryMatch = contentType.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
      const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2] || boundaryMatch[3]);
      if (boundary) {
        const marker = '--' + boundary;
        const parts = root.body.split(marker);
        for (let part of parts) {
          part = part.replace(/^\r?\n/, '').replace(/\r?\n--\s*$/, '').trim();
          if (!part) { continue; }
          const parsed = splitMimeHeaderBodyV58922(part);
          const headers = unfoldMimeHeadersV58922(parsed.headers);
          const partType = mimeHeaderValueV58922(headers, 'Content-Type');
          if (!/^text\/html\b/i.test(partType)) { continue; }
          const transfer = mimeHeaderValueV58922(headers, 'Content-Transfer-Encoding');
          return decodeMimePartBodyV58922(parsed.body, transfer, mimeCharsetV58922(partType));
        }
      }
      const transfer = mimeHeaderValueV58922(rootHeaders, 'Content-Transfer-Encoding');
      return decodeMimePartBodyV58922(root.body, transfer, mimeCharsetV58922(contentType));
    }
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
      return String(text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    }
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
        if (fallback) { lines.push(...fallback.split(/\n+/).map((x) => x.trim()).filter(Boolean)); }
      }
      return lines.join('\n');
    }
    function docxImageTargetToEntryName(target) {
      let path = String(target || '').replace(/\\/g, '/').replace(/^\.\//, '');
      if (path.startsWith('/')) { path = path.slice(1); }
      if (path.startsWith('word/')) { return path; }
      if (path.startsWith('../')) { return path.replace(/^\.\.\//, ''); }
      return 'word/' + path;
    }
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
    function docxXmlToText(xml, imageMap = {}, altChunkMap = {}) {
      // v54 / 内部 v30：DOCX 富文本块识别。
      // 从“全局抽段落”调整为按 document body 顺序识别段落、表格、图片和 OMML 公式，
      // 先保证结构不丢、不乱序；表格精细显示与公式渲染留给后续版本。
      const raw = String(xml || '');
      const body = (raw.match(/<w:body\b[\s\S]*?<\/w:body>/) || [])[0] || raw;
      const blocks = docxBodyToTextBlocks(body, imageMap, altChunkMap);
      return blocks.map((x) => String(x || '').trim()).filter(Boolean).join('\n');
    }

    function docxBodyToTextBlocks(xml, imageMap = {}, altChunkMap = {}) {
      const blocks = [];
      const re = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>|<w:altChunk\b[^>]*(?:\/>|>[\s\S]*?<\/w:altChunk>)|<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>/g;
      let m;
      while ((m = re.exec(String(xml || '')))) {
        const token = m[0];
        let text;
        if (/^<w:tbl/i.test(token)) { text = docxTableToText(token, imageMap); } else if (/^<w:p/i.test(token)) { text = docxParagraphToText(token, imageMap); } else if (/^<w:altChunk/i.test(token)) {
          const rid = (token.match(/r:id="([^"]+)"/) || [])[1] || '';
          text = rid ? altChunkMap[rid] || '' : '';
        } else { text = docxMathToText(token); }
        text = String(text || '').trim();
        if (text) { blocks.push(text); }
      }
      return blocks;
    }

    function docxParagraphToText(p, imageMap = {}) {
      const parts = [];
      const re = /<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<w:hyperlink\b[\s\S]*?<\/w:hyperlink>|<w:r\b[\s\S]*?<\/w:r>|<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/g;
      let m;
      while ((m = re.exec(String(p || '')))) {
        parts.push(docxInlineTokenToText(m[0], imageMap));
      }
      return docxCleanBlockText(parts.join(''));
    }

    function docxInlineTokenToText(value, imageMap = {}) {
      const token = String(value || '');
      if (/^<m:oMath/i.test(token)) { return docxMathToText(token); }
      if (/^<w:hyperlink/i.test(token)) { return docxParagraphToText(token, imageMap); }
      if (/^<w:r/i.test(token)) { return docxRunToText(token, imageMap); }
      if (/^<w:t/i.test(token)) {
        const tm = token.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
        return tm ? decodeXml(tm[1]) : '';
      }
      if (/^<w:tab/i.test(token)) { return '\t'; }
      if (/^<w:br/i.test(token)) { return '\n'; }
      if (/^<w:drawing/i.test(token) || /^<w:pict/i.test(token)) { return docxImageRefsToText(token, imageMap); }
      return '';
    }

    function docxRunToText(run, imageMap = {}) {
      const mode = getDocxRunVerticalMode(run);
      const parts = [];
      const re = /<m:oMathPara\b[\s\S]*?<\/m:oMathPara>|<m:oMath\b[\s\S]*?<\/m:oMath>|<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:drawing\b[\s\S]*?<\/w:drawing>|<w:pict\b[\s\S]*?<\/w:pict>/g;
      let m;
      while ((m = re.exec(String(run || '')))) {
        const token = m[0];
        if (/^<m:oMath/i.test(token)) { parts.push(docxMathToText(token)); } else if (token.startsWith('<w:t')) {
          const tm = token.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
          if (tm) { parts.push(convertDocxScriptText(decodeXml(tm[1]), mode)); }
        } else if (/^<w:tab/i.test(token)) { parts.push('\t'); } else if (/^<w:br/i.test(token)) { parts.push('\n'); } else { parts.push(docxImageRefsToText(token, imageMap)); }
      }
      return parts.join('');
    }

    function docxTableToText(tbl, imageMap = {}) {
      const rows = [];
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rm;
      while ((rm = rowRe.exec(String(tbl || '')))) {
        const row = rm[0];
        const cells = [];
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

    function docxRowsToMarkdownTable(rows) {
      const maxCols = Math.max(1, ...rows.map((r) => r.length || 0));
      const padded = rows.map((r) => Array.from({ length: maxCols }, (_, i) => docxMarkdownTableCell(r[i] || '')));
      const lines = ['【DOCX表格开始】'];
      const first = padded[0] || [];
      lines.push('| ' + first.join(' | ') + ' |');
      lines.push('| ' + Array.from({ length: maxCols }, () => '---').join(' | ') + ' |');
      padded.slice(1).forEach((r) => lines.push('| ' + r.join(' | ') + ' |'));
      lines.push('【DOCX表格结束】');
      return lines.join('\n');
    }

    function docxMarkdownTableCell(text) {
      return String(text || '').replace(/\|/g, '｜').replace(/\s*\n+\s*/g, '<br>').replace(/\s{2,}/g, ' ').trim();
    }
    function docxCleanTableCellText(text) {
      return String(text || '').replace(/[\t ]+/g, ' ').replace(/\s*\n+\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim();
    }
    function docxCleanBlockText(text) {
      return String(text || '')
        .replace(/[\t ]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function docxMathToText(xml) {
      const plain = docxOmmlToPlainText(xml).replace(/\s{2,}/g, ' ').trim();
      return plain ? `【DOCX公式OMML：${plain}】` : '【DOCX公式OMML】';
    }

    function docxOmmlToPlainText(xml) {
      let s = String(xml || '');
      if (!s) { return ''; }
      const replaceStruct = (re, fn) => { s = s.replace(re, fn); };
      for (let i = 0;i < 4;i++) {
        replaceStruct(/<m:f\b[\s\S]*?<\/m:f>/g, (m) => {
          const num = docxInnerXmlOfTag(m, 'm:num');
          const den = docxInnerXmlOfTag(m, 'm:den');
          const a = docxOmmlToPlainText(num); const b = docxOmmlToPlainText(den);
          return a || b ? `(${a})/(${b})` : docxOmmlFallbackText(m);
        });
        replaceStruct(/<m:sSup\b[\s\S]*?<\/m:sSup>/g, (m) => {
          const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
          const sup = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sup'));
          return sup ? `${e}^{${sup}}` : e;
        });
        replaceStruct(/<m:sSub\b[\s\S]*?<\/m:sSub>/g, (m) => {
          const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
          const sub = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sub'));
          return sub ? `${e}_{${sub}}` : e;
        });
        replaceStruct(/<m:sSubSup\b[\s\S]*?<\/m:sSubSup>/g, (m) => {
          const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
          const sub = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sub'));
          const sup = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sup'));
          return `${e}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}`;
        });
        replaceStruct(/<m:rad\b[\s\S]*?<\/m:rad>/g, (m) => {
          const deg = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:deg'));
          const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
          return deg ? `√[${deg}](${e})` : `√(${e})`;
        });
        replaceStruct(/<m:nary\b[\s\S]*?<\/m:nary>/g, (m) => {
          const chr = docxOmmlChr(m) || '∑';
          const sub = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sub'));
          const sup = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:sup'));
          const e = docxOmmlToPlainText(docxInnerXmlOfTag(m, 'm:e'));
          return `${chr}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}${e ? ` ${e}` : ''}`;
        });
      }
      return docxOmmlFallbackText(s);
    }

    function docxOmmlFallbackText(xml) {
      let s = String(xml || '');
      s = s.replace(/<m:chr\b[^>]*>/g, (m) => docxOmmlChr(m));
      s = s.replace(/<m:br\b[^>]*\/>/g, '\n');
      s = s.replace(/<(?:m|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:m|w):t>/g, (_, v) => decodeXml(v));
      s = s.replace(/<[^>]+>/g, '');
      return decodeXml(s).replace(/\s+/g, ' ').trim();
    }
    function docxOmmlChr(xml) {
      const m = String(xml || '').match(/m:val=["']([^"']+)["']/i);
      return m ? decodeXml(m[1]) : '';
    }
    function docxInnerXmlOfTag(xml, tag) {
      const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
      const m = String(xml || '').match(re);
      return m ? m[1] : '';
    }

    function getDocxRunVerticalMode(run) {
      const rpr = (String(run || '').match(/<w:rPr\b[\s\S]*?<\/w:rPr>/) || [])[0] || '';
      const tag = (rpr.match(/<w:vertAlign\b[^>]*>/) || [])[0] || '';
      const val = ((tag.match(/w:val=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
      if (val === 'superscript') { return 'sup'; }
      if (val === 'subscript') { return 'sub'; }
      return '';
    }

    function convertDocxScriptText(text, mode) {
      if (!mode) { return String(text || ''); }
      const sup = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
      const sub = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
      const map = mode === 'sup' ? sup : sub;
      return String(text || '').replace(/[0-9+\-=()ni]/g, (ch) => map[ch] || ch);
    }

    function docxImageRefsToText(token, imageMap = {}) {
      const ids = [];let im;const idRe = /(?:r:embed|r:id|r:link)=["']([^"']+)["']/g;
      while ((im = idRe.exec(String(token || '')))) { ids.push(im[1]); }
      return [...new Set(ids)].map((id) => (imageMap[id] ? '\n' + imageMap[id] + '\n' : '')).join('');
    }
    function decodeXml(s) { return String(s).replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }

    return { extractDocxText, docxXmlToText, decodeXml };
  }

  globalThis.ShirohaDocx = Object.freeze({ create });
})();
