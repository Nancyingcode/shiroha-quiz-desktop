(() => {
  'use strict';

  function create({ readBuffer, toast, warnDev }) {
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
          const pages = [];let extractedChars = 0;
          for (let pageNo = 1;pageNo <= pdf.numPages;pageNo++) {
            const page = await pdf.getPage(pageNo);
            const content = await page.getTextContent();
            const pageText = pdfItemsToLines(content.items || []);
            extractedChars += pageText.replace(/\s/g, '').length;
            pages.push(`【第${pageNo}页】\n${pageText}`.trim());
          }
          const text = pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
          if (extractedChars >= 20) {
            toast(`PDF 文字提取完成：使用 ${loaded.mode}。`, 'ok');
            return text;
          }
        }
      } catch (err) { warnDev('PDF.js 提取失败，转入内置轻量提取器。', err); } finally { try { await loadingTask?.destroy(); } catch (err) { warnDev('PDF 资源释放失败', err); } }
      const text = await extractPdfTextLite(data);
      const chars = text.replace(/\s/g, '').length;
      if (chars < 20) {
        throw new Error('该 PDF 未提取到足够文字，可能是扫描版/图片版 PDF。可先复制 PDF 文本粘贴导入，或使用导入页 OCR 测试功能转成可编辑文本 / DOCX 后再核对导入。');
      }
      return text.replace(/\n{3,}/g, '\n\n').trim();
    }
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
        } catch (e) { warnDev('PDF.js 来源加载失败：' + c.mode, e); }
      }
      return null;
    }
    function pdfDocumentOptions(data, loaded) {
      const options = { data };
      if (loaded && loaded.assetBase) {
        Object.assign(options, {
          cMapUrl: loaded.assetBase + 'cmaps/',
          cMapPacked: true,
          standardFontDataUrl: loaded.assetBase + 'standard_fonts/',
          iccUrl: loaded.assetBase + 'iccs/',
          wasmUrl: loaded.assetBase + 'wasm/',
          useWasm: true,
        });
      }
      return options;
    }

    async function extractPdfTextLite(bytes) {
      const raw = latin1(bytes);
      const streams = [];
      const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let m;
      while ((m = re.exec(raw))) {
        const before = raw.slice(Math.max(0, m.index - 900), m.index);
        const dict = (before.match(/<<[\s\S]*?>>\s*$/) || [''])[0];
        let bin = m[1];
        if (bin.startsWith('\r\n')) { bin = bin.slice(2); } else if (bin.startsWith('\n')) { bin = bin.slice(1); }
        let u8 = latin1ToBytes(bin);
        if (/FlateDecode/.test(dict)) {
          try { u8 = await inflateBytes(u8); } catch (err) { warnDev('PDF 压缩文本流解压失败，已跳过该流。', err);continue; }
        }
        const txt = decodePdfStreamText(latin1(u8));
        if (txt.trim()) { streams.push(txt.trim()); }
      }
      let text = streams.join('\n');
      // 有些极简 PDF 没有压缩流，直接在全文中包含 Tj/TJ。
      if (text.replace(/\s/g, '').length < 20) {
        text = decodePdfStreamText(raw);
      }
      return cleanupPdfLiteText(text);
    }
    function latin1(u8) { let out = '';const chunk = 0x8000;for (let i = 0;i < u8.length;i += chunk) { out += String.fromCharCode.apply(null, u8.slice(i, i + chunk)); } return out; }
    function latin1ToBytes(s) { const out = new Uint8Array(s.length);for (let i = 0;i < s.length;i++) { out[i] = s.charCodeAt(i) & 255; } return out; }
    async function inflateBytes(u8) {
      if (!('DecompressionStream' in window)) { throw new Error('当前浏览器缺少 DecompressionStream，无法解压 PDF 压缩文本流'); }
      const tryOne = async (fmt) => new Uint8Array(await new globalThis.Response(new Blob([u8]).stream().pipeThrough(new globalThis.DecompressionStream(fmt))).arrayBuffer());
      try { return await tryOne('deflate'); } catch { return await tryOne('deflate-raw'); }
    }
    function decodePdfStreamText(s) {
      const out = [];
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
    function extractPdfArrayStrings(arr) {
      const items = [];const re = /\((?:\\.|[^\\()])*\)|<[^>]+>/g;let m;
      while ((m = re.exec(arr))) { items.push(decodePdfToken(m[0])); }
      return items;
    }
    function decodePdfToken(value) {
      const t = String(value || '').trim();
      if (t.startsWith('(') && t.endsWith(')')) { return decodePdfLiteral(t.slice(1, -1)); }
      if (t.startsWith('<') && t.endsWith('>')) { return decodePdfHex(t.slice(1, -1)); }
      return '';
    }
    function decodePdfLiteral(s) {
      let out = '';
      for (let i = 0;i < s.length;i++) {
        const c = s[i];
        if (c === '\\') {
          const n = s[++i];
          if (n === 'n') { out += '\n'; } else if (n === 'r') { out += '\r'; } else if (n === 't') { out += '\t'; } else if (n === 'b') { out += '\b'; } else if (n === 'f') { out += '\f'; } else if (/[0-7]/.test(n || '')) {
            let oct = n;for (let k = 0;k < 2 && /[0-7]/.test(s[i + 1] || '');k++) { oct += s[++i]; }out += String.fromCharCode(parseInt(oct, 8));
          } else if (n === '\n' || n === '\r') { if (n === '\r' && s[i + 1] === '\n') { i++; } } else { out += n || ''; }
        } else { out += c; }
      }
      return decodeMaybeUtf16OrGbk(out);
    }
    function decodePdfHex(value) {
      let hex = value.replace(/\s+/g, '');if (hex.length % 2) { hex += '0'; }
      const bytes = [];for (let i = 0;i < hex.length;i += 2) { bytes.push(parseInt(hex.slice(i, i + 2), 16)); }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) { let str = '';for (let i = 2;i < bytes.length;i += 2) { str += String.fromCharCode((bytes[i] << 8) | (bytes[i + 1] || 0)); } return str; }
      if (bytes[0] === 0xff && bytes[1] === 0xfe) { let str = '';for (let i = 2;i < bytes.length;i += 2) { str += String.fromCharCode(bytes[i] | ((bytes[i + 1] || 0) << 8)); } return str; }
      return decodeMaybeUtf16OrGbk(String.fromCharCode(...bytes));
    }
    function decodeMaybeUtf16OrGbk(s) {
      if (!s) { return ''; }
      const bytes = latin1ToBytes(s);
      try {
        if (bytes[0] === 0xfe && bytes[1] === 0xff) { let out = '';for (let i = 2;i < bytes.length;i += 2) { out += String.fromCharCode((bytes[i] << 8) | (bytes[i + 1] || 0)); } return out; }
        if (bytes[0] === 0xff && bytes[1] === 0xfe) { let out = '';for (let i = 2;i < bytes.length;i += 2) { out += String.fromCharCode(bytes[i] | ((bytes[i + 1] || 0) << 8)); } return out; }
        if (typeof TextDecoder !== 'undefined') {
          try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (err) { warnDev('UTF-8 解码失败，尝试 GB18030。', err); }
          try { return new TextDecoder('gb18030').decode(bytes); } catch (err) { warnDev('GB18030 解码失败，保留原始文本。', err); }
        }
      } catch (err) { warnDev('文本编码识别失败，保留原始文本。', err); }
      return s;
    }
    function cleanupPdfLiteText(text) {
      return String(text || '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((x) => x.replace(/[\t ]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    }

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
    function joinPdfText(acc, cur) {
      if (!acc) { return cur; }
      const last = acc.slice(-1);
      const first = cur.charAt(0);
      if (/[A-Za-z0-9)]/.test(last) && /[A-Za-z0-9(]/.test(first)) { return acc + ' ' + cur; }
      if (/[，。；：、？！,.!?;:]/.test(first)) { return acc + cur; }
      return acc + cur;
    }

    return { extractPdfText, loadLocalPdfJs, pdfDocumentOptions };
  }

  globalThis.ShirohaPdf = Object.freeze({ create });
})();
