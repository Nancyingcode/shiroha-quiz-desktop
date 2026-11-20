// 将当前页的 OCR 结果交给待识别原文、剪贴板或离线 DOCX。
(() => {
  'use strict';

  // 将 OCR 输出转为可离线下载的最小 DOCX，转义识别文本后写入文档部件。
  function createOcrDocxBlob(text, sourceName) {
    const title = 'Shiroha Quiz OCR 识别结果';
    const paragraphs = [
      title,
      // eslint-disable-next-line prefer-template -- 外部值可能是对象，保留 + 的默认转换；输入类型受约束后移除此例外。
      '来源文件：' + (sourceName || '未命名 PDF'),
      '说明：本文件由 OCR 自动识别生成，可能存在错字、漏字和段落错位，请人工核对后再用于题库整理。',
      '',
    ];
    String(text || '').replace(/* 先去掉 CR，统一按 LF 分段而不把回车写进 DOCX 文本。 */ /\r/g, '').split('\n').forEach((line) => paragraphs.push(line));

    const body = paragraphs.map(docxParagraphXml).join('');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const files = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', text: documentXml },
    ];
    return new Blob([globalThis.ShirohaZip.zipStoreFiles(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function docxParagraphXml(line) {
    const text = String(line ?? '');
    return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }

  function xmlEscape(s) {
    return String(s ?? '').replace(/* 转义会改变 DOCX XML 结构的字符，让 OCR 内容只作为文本解释。 */ /[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));
  }

  // 输出操作复用 OCR 识别会话及原有平台能力，绑定前不读取页面。
  function create({
    draft: importDraft,
    ocr: ocrSession,
    select: $,
    invalidateAiImportRequestV99,
    cleanImportBankNameFromFile,
    copyTextV23,
    downloadBlob,
    platformStatus,
  }) {
    const { currentOcrText, setOcrStatus, startPdfOcrImport } = ocrSession;

    // 把当前 OCR 输出交给文本导入区，缺少识别内容时保留原文。
    function applyOcrTextToImport() {
      const text = currentOcrText();
      if (!text) {
        setOcrStatus('没有可填入的 OCR 文本。', 'warn');
        return;
      }

      importDraft.invalidateRead('single');
      invalidateAiImportRequestV99();
      const textEl = $('#import-text');
      if (textEl) {
        textEl.value = text;
        delete textEl.dataset.tableImportV49;
      }

      importDraft.tableResult = null;
      setOcrStatus('已填入导入文本。请检查内容后点击“开始识别”。', 'ok');
    }

    // 复制以当前 OCR 文本为准，文本为空时在原面板提示。
    async function copyOcrText() {
      const text = currentOcrText();
      if (!text) {
        setOcrStatus('没有可复制的 OCR 文本。', 'warn');
        return;
      }

      await copyTextV23(text, '已复制 OCR 文本。');
    }

    // 将当前 OCR 文本封装成可下载的离线 DOCX，错误交给 OCR 界面。
    async function downloadOcrDocx() {
      try {
        const text = currentOcrText();
        if (!text) {
          setOcrStatus('没有可下载的 OCR 文本。', 'warn');
          return;
        }

        const name = `${cleanImportBankNameFromFile(ocrSession.getFile()?.name || 'OCR识别结果')}_OCR.docx`;
        const blob = createOcrDocxBlob(text, ocrSession.getFile()?.name || 'OCR识别结果');
        await downloadBlob(name, blob);
        setOcrStatus('已生成 DOCX 下载文件。请打开后人工核对 OCR 结果。', 'ok');
      } catch (error) {
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        platformStatus('导出失败：' + error.message, true);
        return false;
      }
    }

    // 启动识别与采用输出共用原 OCR 面板，按钮的可用性仍由会话控制。
    function bind() {
      const controls = [
        ['#ocr-start-btn', startPdfOcrImport],
        ['#ocr-use-text-btn', applyOcrTextToImport],
        ['#ocr-copy-btn', copyOcrText],
        ['#ocr-download-docx-btn', downloadOcrDocx],
      ];
      for (const [selector, handler] of controls) {
        const button = $(selector);
        if (button) {
          button.onclick = handler;
        }
      }
    }

    return { bind };
  }

  globalThis.ShirohaOcrOutput = Object.freeze({ create, createOcrDocxBlob });
})();
