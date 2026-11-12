(() => {
  'use strict';

  function create({ readers, ocr, setBankName, applyTable, toast }) {
    const { readText, readTable: readTableImportFileV49, readDocx: extractDocxText, readPdf: extractPdfText } = readers;
    const { setOcrImportSource, setOcrStatus } = ocr;
    const setImportBankNameFromFile = setBankName;
    const applyTableImportResultV49 = applyTable;
    const $ = (selector) => document.querySelector(selector);
    // 预览草稿只属于当前页面；单文件或双文件清空时保留原有报告与筛选语义。
    const draft = {
      questions: [],
      tableResult: null,
      warnings: [],
      report: '',
      diagnostics: null,
      filter: 'priority',
      selected: new Set(),
      sourceMeta: { name: '', size: 0, type: '' },
    };
    // 每个输入槽位拥有独立读取代次；用户替换或清空内容时废弃该槽位的迟到结果。
    const readGenerations = { single: 0, question: 0, answer: 0 };
    let bankNameGeneration = 0;
    let previewGeneration = 0;
    function invalidatePreview() { previewGeneration += 1; }
    function invalidateBankName() { bankNameGeneration += 1; }
    function invalidateRead(slot) {
      readGenerations[slot] += 1;
      return readGenerations[slot];
    }
    function isCurrentRead(slot, generation) { return readGenerations[slot] === generation; }
    async function readImportFile(e) {
      const file = e.target.files[0];
      if (!file) { return; }
      const generation = invalidateRead('single');
      const previewAtStart = previewGeneration;
      invalidateBankName();
      draft.sourceMeta = { name: file.name || '', size: Number(file.size || 0), type: file.type || '' };
      setImportBankNameFromFile(file.name);
      setOcrImportSource(file);
      try {
        toast('正在读取文件，请稍候……', 'warn');
        if (isUnsupportedSpreadsheetFileV49(file)) { throw new Error('暂不支持 .xls / .xlsm，请在 Excel 或 WPS 中另存为 .xlsx 或 .csv 后导入'); }
        if (isTableImportFileV49(file)) {
          const result = await readTableImportFileV49(file);
          if (!isCurrentRead('single', generation) || previewAtStart !== previewGeneration) { return; }
          applyTableImportResultV49(result, file.name);
          return;
        }
        draft.tableResult = null;
        const text = await readFileToText(file);
        if (!isCurrentRead('single', generation)) { return; }
        const textEl = $('#import-text');
        if (textEl) { textEl.value = text;delete textEl.dataset.tableImportV49; }
        toast(`文件读取完成：提取到 ${text.split(/\n+/).filter(Boolean).length} 行文本。请点击“开始识别”。`, 'ok');
      } catch (err) {
        if (!isCurrentRead('single', generation) || (isTableImportFileV49(file) && previewAtStart !== previewGeneration)) { return; }
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        if (/\.pdf$/i.test(file.name || '')) { setOcrStatus('文字层提取失败：' + err.message + '。如果这是扫描件/图片型 PDF，可以尝试 OCR。', 'warn'); }
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        toast('文件读取失败：' + err.message + '。可尝试复制文件内容粘贴到文本框。');
      }
    }
    async function readDualFile(e, kind) {
      const file = e.target.files[0];
      if (!file) { return; }
      const slot = kind === 'question' ? 'question' : 'answer';
      const generation = invalidateRead(slot);
      const nameGeneration = bankNameGeneration;
      draft.sourceMeta = { name: file.name || '', size: (Number(draft.sourceMeta?.size || 0) + Number(file.size || 0)), type: 'dual' };
      try {
        toast(`正在读取${kind === 'question' ? '题目' : '答案'}文件，请稍候……`, 'warn');
        const text = await readFileToText(file);
        if (!isCurrentRead(slot, generation)) { return; }
        if (kind === 'question') {
          $('#dual-question-text').value = text;
          if (nameGeneration === bankNameGeneration) { setImportBankNameFromFile(file.name); }
        } else {
          $('#dual-answer-text').value = text;
        }
        toast(`${kind === 'question' ? '题目' : '答案'}文件读取完成。`, 'ok');
      } catch (err) {
        if (!isCurrentRead(slot, generation)) { return; }
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        toast('文件读取失败：' + err.message + '。');
      }
    }
    async function readFileToText(file) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.docx')) { return await extractDocxText(file); }
      if (lower.endsWith('.doc')) { throw new Error('暂不支持旧版 .doc，请先在 Word/WPS 中另存为 .docx 后导入'); }
      if (isUnsupportedSpreadsheetFileV49(file)) { throw new Error('暂不支持 .xls / .xlsm，请在 Excel 或 WPS 中另存为 .xlsx 或 .csv 后导入'); }
      if (lower.endsWith('.pdf')) { return await extractPdfText(file); }
      return await readText(file);
    }

    function isTableImportFileV49(file) {
      const lower = String(file?.name || '').toLowerCase();
      return lower.endsWith('.xlsx') || lower.endsWith('.csv');
    }
    function isUnsupportedSpreadsheetFileV49(file) {
      const lower = String(file?.name || '').toLowerCase();
      return lower.endsWith('.xls') || lower.endsWith('.xlsm');
    }

    function clearDraft() {
      draft.questions = [];
      draft.selected.clear();
      draft.diagnostics = null;
      draft.sourceMeta = { name: '', size: 0, type: '' };
    }
    function clearDual() {
      invalidatePreview();
      invalidateRead('question');
      invalidateRead('answer');
      clearDraft();
    }
    function clearSingle() {
      // 单文件与双文件读取互相独立；清空单文件不能取消双文件的在途读取。
      invalidateRead('single');
      draft.tableResult = null;
      clearDraft();
    }
    function snapshot() {
      return {
        cache: draft.questions,
        warnings: draft.warnings,
        report: draft.report,
        diagnostics: draft.diagnostics,
        filter: draft.filter,
        selected: draft.selected,
      };
    }
    function restore(previous) {
      draft.questions = previous.cache;
      draft.warnings = previous.warnings;
      draft.report = previous.report;
      draft.diagnostics = previous.diagnostics;
      draft.filter = previous.filter;
      draft.selected = previous.selected;
    }
    return Object.assign(draft, { readImportFile, readDualFile, invalidateRead, invalidatePreview, invalidateBankName, clearSingle, clearDual, snapshot, restore });
  }

  globalThis.ShirohaImportPreview = Object.freeze({ create });
})();
