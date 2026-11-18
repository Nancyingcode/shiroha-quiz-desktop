// 读取 PDF 文本层与可识别的文字流，保留 OCR 入口处理扫描版文件。
(() => {
  'use strict';

  function pdfTextLength(text) {
    // 忽略 PDF 位置碎片带来的空白，只统计有内容的字符。
    return text.replace(/\s/g, '').length;
  }

  function cleanPdfPageText(text) {
    // 把超过两个连续换行归并为一个段落间隔。
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  // 将页面文字层按页归并，并统计正文长度以便识别扫描件。
  async function readPdfPages(pdf, toLines) {
    const pages = [];let extractedChars = 0;
    for (let pageNo = 1;pageNo <= pdf.numPages;pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const pageText = toLines(content.items || []);
      extractedChars += pdfTextLength(pageText);
      pages.push(`【第${pageNo}页】\n${pageText}`.trim());
    }

    const text = cleanPdfPageText(pages.join('\n\n'));
    return { text, extractedChars };
  }

  // 按 PDF 字符串的 BOM 区分 UTF-16 大端和小端；缺少 BOM 时交给旧编码回退。
  function decodePdfUtf16(bytes) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      let str = '';for (let i = 2;i < bytes.length;i += 2) { str += String.fromCharCode((bytes[i] << 8) | (bytes[i + 1] || 0)); }

      return str;
    }

    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      let str = '';for (let i = 2;i < bytes.length;i += 2) { str += String.fromCharCode(bytes[i] | ((bytes[i + 1] || 0) << 8)); }

      return str;
    }

    return null;
  }

  function isOctalDigit(value) {
    // 八进制转义仅读取 0 到 7，遇到其他字符时保留其后正文。
    return /[0-7]/.test(value);
  }

  // 为导入和 OCR 装配同一套 PDF 资源加载方式。
  function create({ readBuffer, toast, warnDev }) {
    // 优先读取 PDF.js 文本层，文字不足时才使用轻量提取。
    async function extractPdfText(file) {
      const data = new Uint8Array(await readBuffer(file));
      let loadingTask = null;
      // v6: PDF 文本层本地提取。优先尝试本地 PDF.js；如果没有打包 PDF.js，则使用内置轻量提取器。
      try {
        const loaded = await loadLocalPdfJs();
        const pdfjsLib = loaded && loaded.lib;
        if (pdfjsLib && pdfjsLib.getDocument) {
          if (pdfjsLib.GlobalWorkerOptions) { pdfjsLib.GlobalWorkerOptions.workerSrc = loaded.workerSrc; }

          loadingTask = pdfjsLib.getDocument(pdfDocumentOptions(data, loaded));
          const pdf = await loadingTask.promise;
          const { text, extractedChars } = await readPdfPages(pdf, pdfItemsToLines);
          if (extractedChars >= 20) {
            toast(`PDF 文字提取完成：使用 ${loaded.mode}。`, 'ok');
            return text;
          }
        }
      } catch (err) { warnDev('PDF.js 提取失败，转入内置轻量提取器。', err); } finally { try { await loadingTask?.destroy(); } catch (err) { warnDev('PDF 资源释放失败', err); } }

      const text = await extractPdfTextLite(data);
      const chars = pdfTextLength(text);
      if (chars < 20) {
        throw new Error('该 PDF 未提取到足够文字，可能是扫描版/图片版 PDF。可先复制 PDF 文本粘贴导入，或使用导入页 OCR 测试功能转成可编辑文本 / DOCX 后再核对导入。');
      }

      return cleanPdfPageText(text);
    }

    // 在同一页面复用成功加载的 PDF.js，并按配置保留来源优先顺序。
    async function loadLocalPdfJs() {
      // v7: 混合 PDF.js 加载策略：本地最小版优先；本地缺失时 CDN；最后才降级轻量提取器。
      if (window.__pdfjsMixed) { return window.__pdfjsMixed; }

      const candidates = [
        { mode: '本地 PDF.js', module: './libs/pdf.min.mjs', worker: './libs/pdf.worker.min.mjs', assetBase: './libs/' },
        { mode: 'CDN PDF.js/jsDelivr', module: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.min.mjs', worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs', assetBase: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/' },
        { mode: 'CDN PDF.js/unpkg', module: 'https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.min.mjs', worker: 'https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs', assetBase: 'https://unpkg.com/pdfjs-dist@5.7.284/' },
      ];
      for (const c of candidates) {
        try {
          const mod = await import(c.module);
          window.__pdfjsMixed = { lib: mod, workerSrc: c.worker, mode: c.mode, assetBase: c.assetBase };
          return window.__pdfjsMixed;
        } catch (e) { warnDev(`PDF.js 来源加载失败：${c.mode}`, e); }
      }

      return null;
    }

    // Worker、字体和字库沿用 PDF.js 的成功来源，以免解码资源版本混用。
    function pdfDocumentOptions(data, loaded) {
      const options = { data };
      if (loaded && loaded.assetBase) {
        Object.assign(options, {
          cMapUrl: `${loaded.assetBase}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${loaded.assetBase}standard_fonts/`,
          iccUrl: `${loaded.assetBase}iccs/`,
          wasmUrl: `${loaded.assetBase}wasm/`,
          useWasm: true,
        });
      }

      return options;
    }

    // 从可识别的 PDF 流中读取文字，单个无效压缩流可跳过。
    async function extractPdfTextLite(bytes) {
      const raw = latin1(bytes);
      const streams = [];
      // 匹配 PDF 的 stream/endstream 行边界，保留中间的原始字节。
      const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let m;
      while ((m = re.exec(raw))) {
        const before = raw.slice(Math.max(0, m.index - 900), m.index);
        // 读取紧邻流头前的字典，用于判断该流是否压缩。
        const dict = (before.match(/<<[\s\S]*?>>\s*$/) || [''])[0];
        let bin = m[1];
        if (bin.startsWith('\r\n')) { bin = bin.slice(2); } else if (bin.startsWith('\n')) { bin = bin.slice(1); }

        let u8 = latin1ToBytes(bin);
        // 轻量提取器仅尝试解开显式标记为 FlateDecode 的流。
        if (/FlateDecode/.test(dict)) {
          try { u8 = await inflateBytes(u8); } catch (err) { warnDev('PDF 压缩文本流解压失败，已跳过该流。', err);continue; }
        }

        const txt = decodePdfStreamText(latin1(u8));
        if (txt.trim()) { streams.push(txt.trim()); }
      }

      let text = streams.join('\n');
      // 有些极简 PDF 没有压缩流，直接在全文中包含 Tj/TJ。
      if (pdfTextLength(text) < 20) {
        text = decodePdfStreamText(raw);
      }

      return cleanupPdfLiteText(text);
    }

    function latin1(u8) {
      let out = '';const chunk = 0x8000;for (let i = 0;i < u8.length;i += chunk) { out += String.fromCharCode.apply(null, u8.slice(i, i + chunk)); }

      return out;
    }

    function latin1ToBytes(s) {
      const out = new Uint8Array(s.length);for (let i = 0;i < s.length;i += 1) { out[i] = s.charCodeAt(i) & 255; }

      return out;
    }

    async function inflateBytes(u8) {
      if (!('DecompressionStream' in window)) { throw new Error('当前浏览器缺少 DecompressionStream，无法解压 PDF 压缩文本流'); }

      const tryOne = async (fmt) => new Uint8Array(await new globalThis.Response(new Blob([u8]).stream().pipeThrough(new globalThis.DecompressionStream(fmt))).arrayBuffer());

      try { const inflated = await tryOne('deflate'); return inflated; } catch { return tryOne('deflate-raw'); }
    }

    // 收集常见 PDF 文字绘制运算符前的操作数，按出现顺序拼接。
    function decodePdfStreamText(s) {
      const out = [];
      // 匹配文字绘制指令前的字符串、十六进制文本或带字距的数组。
      const tj = /((?:\((?:\\.|[^\\()])*\)|<[^>]+>|\[(?:[^\]]|\((?:\\.|[^\\()])*\))*\]))\s*(?:Tj|TJ|'|")/g;
      let m;
      while ((m = tj.exec(s))) {
        const token = m[1];
        if (token.startsWith('[')) {
          out.push(...extractPdfArrayStrings(token));
        } else {
          out.push(decodePdfToken(token));
        }
      }

      return out.join('\n');
    }

    // 解码文字数组中的各个文本片段，保留其绘制顺序。
    function extractPdfArrayStrings(arr) {
      const items = [];
      // 字距数组中只读字符串和十六进制文本，忽略位置调整值。
      const re = /\((?:\\.|[^\\()])*\)|<[^>]+>/g;
      let m;
      while ((m = re.exec(arr))) { items.push(decodePdfToken(m[0])); }

      return items;
    }

    // 按 PDF 字符串定界符区分普通转义文本与十六进制文本。
    function decodePdfToken(value) {
      const t = String(value || '').trim();
      if (t.startsWith('(') && t.endsWith(')')) { return decodePdfLiteral(t.slice(1, -1)); }

      if (t.startsWith('<') && t.endsWith('>')) { return decodePdfHex(t.slice(1, -1)); }

      return '';
    }

    // 处理 PDF 字符串转义与续行，再尝试识别得到的原始编码。
    function decodePdfLiteral(s) {
      let out = '';
      for (let i = 0;i < s.length;i += 1) {
        const c = s[i];
        if (c === '\\') {
          const n = s[(i += 1)];
          if (n === 'n') { out += '\n'; } else if (n === 'r') { out += '\r'; } else if (n === 't') { out += '\t'; } else if (n === 'b') { out += '\b'; } else if (n === 'f') { out += '\f'; } else if (isOctalDigit(n || '')) {
            let oct = n;for (let k = 0;k < 2 && isOctalDigit(s[i + 1] || '');k += 1) { oct += s[(i += 1)]; }

            out += String.fromCharCode(parseInt(oct, 8));
          } else if (n === '\n' || n === '\r') { if (n === '\r' && s[i + 1] === '\n') { i += 1; } } else { out += n || ''; }
        } else { out += c; }
      }

      return decodeMaybeUtf16OrGbk(out);
    }

    // PDF 十六进制字符串缺少末尾半字节时按规范补零。
    function decodePdfHex(value) {
      // 十六进制数字间可以插入空白，解码时先移除。
      let hex = value.replace(/\s+/g, '');if (hex.length % 2) { hex += '0'; }

      const bytes = [];for (let i = 0;i < hex.length;i += 2) { bytes.push(parseInt(hex.slice(i, i + 2), 16)); }

      const unicode = decodePdfUtf16(bytes);
      if (unicode !== null) { return unicode; }

      return decodeMaybeUtf16OrGbk(String.fromCharCode(...bytes));
    }

    // 优先使用显式 UTF-16 或有效 UTF-8，兼容旧中文 PDF 的 GB18030 文本。
    function decodeMaybeUtf16OrGbk(s) {
      if (!s) { return ''; }

      const bytes = latin1ToBytes(s);
      try {
        const unicode = decodePdfUtf16(bytes);
        if (unicode !== null) { return unicode; }

        if (typeof TextDecoder !== 'undefined') {
          try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (err) { warnDev('UTF-8 解码失败，尝试 GB18030。', err); }

          try { return new TextDecoder('gb18030').decode(bytes); } catch (err) { warnDev('GB18030 解码失败，保留原始文本。', err); }
        }
      } catch (err) { warnDev('文本编码识别失败，保留原始文本。', err); }

      return s;
    }

    function cleanPdfLiteLine(line) {
      // 合并同一行内的制表符和空格，保留词间间距。
      return line.replace(/[\t ]+/g, ' ').trim();
    }

    function cleanupPdfLiteText(text) {
      // 将轻量提取器生成的回车一并视为换行后逐行清理。
      const lines = String(text || '').replace(/\r/g, '\n').split('\n');
      return lines.map(cleanPdfLiteLine).filter(Boolean).join('\n');
    }

    // 根据字符的纵向位置聚成同一行，再按横向位置重建可读文本。
    function pdfItemsToLines(items) {
      const parts = items.map((it) => ({
        text: String(it.str || '').trim(),
        x: Number((it.transform && it.transform[4]) || 0),
        y: Number((it.transform && it.transform[5]) || 0),
      })).filter((it) => it.text);
      if (!parts.length) { return ''; }

      parts.sort((a, b) => (Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x));

      const lines = [];
      for (const part of parts) {
        let line = lines.find((l) => Math.abs(l.y - part.y) <= 3);
        if (!line) { line = { y: part.y, items: [] };lines.push(line); }

        line.items.push(part);
      }

      lines.sort((a, b) => b.y - a.y);

      return lines.map((line) => line.items.sort((a, b) => a.x - b.x).map((x) => x.text).reduce(joinPdfText, '').trim()).filter(Boolean).join('\n');
    }

    // 只在同行的英文或数字碎片之间补词间空格。
    function joinPdfText(acc, cur) {
      if (!acc) { return cur; }

      const last = acc.slice(-1);
      const first = cur.charAt(0);
      // 前一段以英数或右括号结束时，后续英语词片可能需要分隔。
      const leftWord = /[A-Za-z0-9)]/.test(last);
      // 下一段以英数或左括号开头时，保留英文阅读所需的空格。
      if (leftWord && /[A-Za-z0-9(]/.test(first)) { return `${acc} ${cur}`; }

      // 常见中文和英文标点直接跟在前一段之后。
      if (/[，。；：、？！,.!?;:]/.test(first)) { return acc + cur; }

      return acc + cur;
    }

    return { extractPdfText, loadLocalPdfJs, pdfDocumentOptions };
  }

  globalThis.ShirohaPdf = Object.freeze({ create });
})();
