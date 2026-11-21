// 管理文件读取和本地导入草稿，恢复时保留用户尚未提交的识别状态。
(() => {
  'use strict';

  // 为单文件与双文件输入维护各自的读取代次和当前预览。
  function create({
    readers,
    ocr,
    setBankName,
    applyTable,
    toast,
  }) {
    const {
      readText,
      readTable: readTableImportFileV49,
      readDocx: extractDocxText,
      readPdf: extractPdfText,
    } = readers;
    const { setOcrImportSource, setOcrStatus } = ocr;
    const setImportBankNameFromFile = setBankName;
    const applyTableImportResultV49 = applyTable;
    const $ = (selector) => document.querySelector(selector);

    // 当前预览归本页面；保存的副本单独管理，清空输入时不删除该副本。
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
    function invalidatePreview() {
      previewGeneration += 1;
    }

    function invalidateBankName() {
      bankNameGeneration += 1;
    }

    function invalidateRead(slot) {
      readGenerations[slot] += 1;
      return readGenerations[slot];
    }

    function isCurrentRead(slot, generation) {
      return readGenerations[slot] === generation;
    }

    // 文本读取完成后解除表格输入标记，并提示用户主动开始识别。
    function showImportedText(text) {
      const textEl = $('#import-text');
      if (textEl) { textEl.value = text;delete textEl.dataset.tableImportV49; }

      // 以一个或多个换行分隔提取结果，空行不计入提示行数。
      toast(`文件读取完成：提取到 ${text.split(/\n+/).filter(Boolean).length} 行文本。请点击“开始识别”。`, 'ok');
    }

    function reportImportReadError(file, err) {
      // PDF 文字层提取失败时才提示用户采用扫描件 OCR。
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      if (/\.pdf$/i.test(file.name || '')) { setOcrStatus('文字层提取失败：' + err.message + '。如果这是扫描件/图片型 PDF，可以尝试 OCR。', 'warn'); }

      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      toast('文件读取失败：' + err.message + '。可尝试复制文件内容粘贴到文本框。');
    }

    // 记录本次文件的来源和 OCR 对象，防止旧题库名影响随后导入。
    function prepareSingleFile(file) {
      invalidateBankName();
      draft.sourceMeta = { name: file.name || '', size: Number(file.size || 0), type: file.type || '' };
      setImportBankNameFromFile(file.name);
      setOcrImportSource(file);
    }

    // 读取本次选择的文件；表格结果还须匹配开始读取时的预览代次。
    async function readImportFile(e) {
      const file = e.target.files[0];
      if (!file) { return; }

      const generation = invalidateRead('single');
      const previewAtStart = previewGeneration;
      prepareSingleFile(file);
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

        showImportedText(text);
      } catch (err) {
        if (!isCurrentRead('single', generation) || (isTableImportFileV49(file) && previewAtStart !== previewGeneration)) { return; }

        reportImportReadError(file, err);
      }
    }

    // 只写入仍属于本次选择的题目或答案槽位，防止较早读取覆盖新内容。
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

    // 按实际扩展名选择文本提取器，让旧格式错误给出明确转换指引。
    async function readFileToText(file) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.docx')) { return extractDocxText(file); }

      if (lower.endsWith('.doc')) { throw new Error('暂不支持旧版 .doc，请先在 Word/WPS 中另存为 .docx 后导入'); }

      if (isUnsupportedSpreadsheetFileV49(file)) { throw new Error('暂不支持 .xls / .xlsm，请在 Excel 或 WPS 中另存为 .xlsx 或 .csv 后导入'); }

      if (lower.endsWith('.pdf')) { return extractPdfText(file); }

      return readText(file);
    }

    function isTableImportFileV49(file) {
      const lower = String(file?.name || '').toLowerCase();
      return lower.endsWith('.xlsx') || lower.endsWith('.csv');
    }

    function isUnsupportedSpreadsheetFileV49(file) {
      const lower = String(file?.name || '').toLowerCase();
      return lower.endsWith('.xls') || lower.endsWith('.xlsm');
    }

    // 释放当前识别结果和来源信息，保留独立存储的持久草稿。
    function clearDraft() {
      draft.questions = [];
      draft.selected.clear();
      draft.diagnostics = null;
      draft.sourceMeta = { name: '', size: 0, type: '' };
    }

    // 双文件预览清空时废弃题目与答案槽位尚未完成的读取。
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

    // 保留识别前的原对象引用，供检测在途请求失效和失败回滚。
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

    // 处理失败时恢复开始前的识别结果、诊断与筛选引用。
    function restore(previous) {
      draft.questions = previous.cache;
      draft.warnings = previous.warnings;
      draft.report = previous.report;
      draft.diagnostics = previous.diagnostics;
      draft.filter = previous.filter;
      draft.selected = previous.selected;
    }

    return Object.assign(draft, {
      readImportFile,
      readDualFile,
      invalidateRead,
      isCurrentRead,
      invalidatePreview,
      invalidateBankName,
      clearSingle,
      clearDual,
      snapshot,
      restore,
    });
  }

  const DATABASE_NAME = 'shiroha-import-draft';
  const STORE_NAME = 'draft';
  const RECORD_KEY = 'current';
  const RECORD_VERSION = 1;
  const FILTERS = ['priority', 'problem', 'normal', 'all'];
  const INPUT_IDS = ['import-bank-name', 'import-bank-group-v58', 'import-save-mode-v59', 'import-target-bank-v59', 'import-mode', 'import-strategy', 'import-text', 'dual-question-text', 'dual-answer-text', 'dual-match-mode'];

  // 草稿库被其他窗口占用时即报错，若随后打开则立即关闭迟到的连接。
  function openDraftDatabase(indexedDb) {
    return new Promise(
      // 依据 IndexedDB 的打开事件决定何时交出连接，避免把被拒绝的连接留在后台。
      (resolve, reject) => {
        if (!indexedDb) { reject(new Error('本地草稿存储不可用。'));return; }

        const request = indexedDb.open(DATABASE_NAME, 1);
        let blocked = false;
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);

        request.onblocked = () => {
          blocked = true;reject(new Error('草稿存储被其他窗口占用，请关闭其他窗口后重试。'));
        };

        request.onerror = () => reject(request.error || new Error('打开草稿存储失败。'));

        request.onsuccess = () => {
          if (blocked) { request.result.close(); } else { resolve(request.result); }
        };
      },
    );
  }

  // 在同一事务中读取修订并提交操作，完成或中止都释放数据库连接。
  function runDraftTransaction(db, mode, operation) {
    return new Promise(
      // 等待完整事务提交再返回，单条请求成功仍可能发生事务回滚。
      (resolve, reject) => {
        let result;
        let failure;
        let tx;
        try {
          tx = db.transaction(STORE_NAME, mode);
          const store = tx.objectStore(STORE_NAME);
          const request = store.get(RECORD_KEY);
          request.onsuccess = () => {
            try { result = operation(store, request.result); } catch (error) { failure = error;tx.abort(); }
          };

          tx.oncomplete = () => {
            db.close();resolve(result);
          };

          tx.onabort = () => {
            db.close();reject(failure || tx.error || new Error('草稿事务未完成。'));
          };

          tx.onerror = () => { /* 事务中止回调负责关闭连接并报告错误。 */ };
        } catch (error) { db.close();reject(error); }
      },
    );
  }

  // 通过事务读写唯一的草稿记录，让跨窗口修订检查与写入保持原子。
  function createStore(indexedDb) {
    async function access(mode, operation) {
      const db = await openDraftDatabase(indexedDb);
      return runDraftTransaction(db, mode, operation);
    }

    function checkRevision(existing, expected) {
      if ((existing?.revision || null) !== expected) { throw new Error('已保存草稿已在其他窗口变化，请重新操作。'); }
    }

    return {
      read: () => access('readonly', (_store, record) => {
        if (record === undefined) { return null; }

        return record && typeof record === 'object' ? record : { invalid: true };
      }),

      replace: (record, expected) => access('readwrite', (store, existing) => {
        checkRevision(existing, expected);store.put(record, RECORD_KEY);
      }),

      remove: (expected) => access('readwrite', (store, existing) => {
        checkRevision(existing, expected);store.delete(RECORD_KEY);
      }),
    };
  }

  // 诊断和候选的细分字段可缺省，但保存时出现的列表必须可安全遍历。
  function validDraftDiagnostics(diagnostics) {
    const candidates = diagnostics?.candidates;
    return (diagnostics === null || (diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)))
      && (candidates === undefined || (Array.isArray(candidates) && candidates.every((item) => item && typeof item === 'object'
        && (item.segments === undefined || Array.isArray(item.segments)) && (item.warnings === undefined || Array.isArray(item.warnings)))));
  }

  // 建议依赖内容指纹，核对建议还须提供问题列表及可采纳变更。
  function validSuggestions(entries, review) {
    return Array.isArray(entries) && entries.every((entry) => Array.isArray(entry)
      && entry.length === 2 && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object'
      && typeof entry[1].fingerprint === 'string' && (!review || (Array.isArray(entry[1].issues) && entry[1].changes && typeof entry[1].changes === 'object')));
  }

  // 恢复前验证格式版本、预览字段及与题目关联的建议，损坏记录不覆盖当前内容。
  function validRecord(record) {
    const data = record?.data;
    const validDiagnostics = validDraftDiagnostics(data?.diagnostics);

    return record?.version === RECORD_VERSION && typeof record.revision === 'string' && !!record.revision
      && !!data && Array.isArray(data.questions) && data.questions.length > 0
      && data.questions.every((q) => q && typeof q === 'object' && typeof q.question === 'string' && Array.isArray(q.options)
        && q.options.every((option) => option && typeof option === 'object') && Array.isArray(q.answer))
      && Array.isArray(data.warnings) && typeof data.report === 'string' && validDiagnostics
      && Array.isArray(data.selected) && data.selected.every((index) => Number.isInteger(index) && index >= 0 && index < data.questions.length)
      && FILTERS.includes(data.filter) && data.sourceMeta && typeof data.sourceMeta === 'object'
      && (data.tableResult === null || (data.tableResult && typeof data.tableResult === 'object'))
      && typeof data.tableInput === 'boolean' && data.fields && INPUT_IDS.every((id) => typeof data.fields[id] === 'string')
      && data.suggestions && validSuggestions(data.suggestions.review, true) && validSuggestions(data.suggestions.analysis, false);
  }

  // 管理草稿保存、恢复和删除，并追踪本页拥有的修订。
  function createPersistence({
    draft,
    select: $,
    store,
    suggestions,
    actions,
  }) {
    // 此页面仅记住亲自保存或恢复的修订；成功入库后只能清理同一修订。
    let owned = null;
    let busy = false;
    function status(message) {
      const el = $('#import-draft-status');if (el) { el.textContent = message; }
    }

    // 草稿事务期间锁定全部入口，避免重复写入或在恢复途中删除。
    function setBusy(value) {
      busy = value;
      ['save-import-draft-btn', 'restore-import-draft-btn', 'delete-import-draft-btn'].forEach((id) => {
        const button = $(`#${id}`);if (button) { button.disabled = value; }
      });

      document.querySelectorAll('[data-save-import-draft]').forEach((button) => {
        button.disabled = value;
      });
    }

    // 优先记录用户操作的题目，缺少锚点时保留当前屏幕内的位置。
    function position(anchor) {
      const scrollContainer = globalThis.ShirohaShell.desktopScrollContainer();
      const scrollBounds = scrollContainer?.getBoundingClientRect();
      const top = scrollBounds?.top ?? 0;
      const bottom = scrollBounds?.bottom ?? window.innerHeight;
      const buttons = [...document.querySelectorAll('#import-preview [data-edit-import]')];
      const visible = buttons.find((button) => Number(button.dataset.editImport) === anchor) || buttons.find((button) => {
        const rect = button.getBoundingClientRect();
        return rect.bottom > top && rect.top < bottom;
      });
      return {
        index: visible ? Number(visible.dataset.editImport) : null,
        offset: visible?.getBoundingClientRect().top ?? 0,
        scrollY: scrollContainer?.scrollTop ?? window.scrollY,
      };
    }

    // 采集恢复预览所需的输入、选择、建议与滚动位置。
    function capture(anchor) {
      const fields = Object.fromEntries(INPUT_IDS.map((id) => [id, $(`#${id}`)?.value || '']));
      return {
        questions: draft.questions,
        warnings: draft.warnings,
        report: draft.report,
        diagnostics: draft.diagnostics,
        filter: draft.filter,
        selected: [...draft.selected],
        sourceMeta: draft.sourceMeta,
        tableResult: draft.tableResult,
        tableInput: $('#import-text')?.dataset.tableImportV49 === '1',
        fields,
        suggestions: suggestions.capture(),
        position: position(anchor),
      };
    }

    function fingerprint(data) {
      const content = { ...data };delete content.position;return JSON.stringify(content);
    }

    function contentFingerprint(data) {
      const content = { ...data };delete content.position;delete content.filter;delete content.selected;
      return JSON.stringify(content);
    }

    function isEditing() {
      return actions.isEditing() || !$('#edit-modal')?.classList.contains('hidden');
    }

    function canOperate() {
      if (busy) { return false; }

      if (isEditing()) { status('请先保存或关闭题目编辑，退出题库二次编辑后再操作草稿。');return false; }

      return true;
    }

    function changedSince(before) {
      return isEditing() || fingerprint(capture()) !== before;
    }

    function savedRecord(record) {
      if (record && !validRecord(record)) { throw new Error('已保存草稿损坏或版本不受支持，原数据已保留。'); }

      return record;
    }

    // 覆盖已经保存的草稿前询问用户，并核对等待期间预览和修订未变化。
    async function save(anchor) {
      if (!canOperate()) { return; }

      if (!draft.questions.length) { status('请先识别出题目，再保存草稿。');return; }

      setBusy(true);status('正在保存草稿……');
      try {
        const before = fingerprint(capture());
        const existing = savedRecord(await store.read());
        if (existing && !await actions.confirm('已有一份本地导入草稿，覆盖它？')) { status('已取消保存，原草稿保留。');return; }

        if (changedSince(before)) { status('当前预览已变化，请重新保存草稿。');return; }

        const data = structuredClone(capture(anchor));
        const record = { version: RECORD_VERSION, revision: actions.makeId(), data };
        const savedContent = contentFingerprint(data);
        await store.replace(record, existing?.revision || null);
        owned = { revision: record.revision, content: savedContent };
        status(changedSince(before) ? '已保存操作开始时的草稿；当前预览已变化，请再次保存。' : '草稿已保存到本机；确认导入前仍需核对。');
        if (Number.isInteger(anchor)) { actions.notify('本机草稿已保存，可从这道题继续核对。', 'ok'); }
      } catch (error) { status(`保存草稿失败，现有预览和已保存草稿均保留。${error?.message || ''}`);if (Number.isInteger(anchor)) { actions.notify('草稿保存失败，原内容已保留。', 'warn'); } } finally { setBusy(false); }
    }

    // 草稿锚点仍以窗口为坐标基准，恢复时滚动当前平台的正文区域。
    function restorePosition(saved) {
      globalThis.requestAnimationFrame(/* 等待预览布局完成后再测量锚点。 */ () => {
        const scrollTarget = globalThis.ShirohaShell.desktopScrollContainer() ?? window;
        const button = Number.isInteger(saved?.index)
          ? $(`#import-preview [data-edit-import="${saved.index}"]`)
          : null;
        if (button) {
          scrollTarget.scrollBy(0, button.getBoundingClientRect().top - (Number(saved.offset) || 0));
        } else {
          scrollTarget.scrollTo(0, Math.max(0, Number(saved?.scrollY) || 0));
        }
      });
    }

    // 使旧读取与模型请求失效，再把已验证的草稿恢复到页面。
    function apply(data) {
      actions.invalidate();
      draft.questions = data.questions;draft.warnings = data.warnings;draft.report = data.report;
      draft.diagnostics = data.diagnostics;draft.filter = data.filter;draft.selected = new Set(data.selected);
      draft.sourceMeta = data.sourceMeta;draft.tableResult = data.tableResult;
      for (const id of INPUT_IDS) { const field = $(`#${id}`);if (field) { field.value = data.fields[id] || ''; } }

      const input = $('#import-text');
      if (data.tableInput) { input.dataset.tableImportV49 = '1'; } else { delete input.dataset.tableImportV49; }

      suggestions.restore(data.suggestions);
      actions.render();restorePosition(data.position);
    }

    // 确认可替换当前输入，并在应用前再次检查两个窗口中的修订。
    async function restore() {
      if (!canOperate()) { return; }

      setBusy(true);status('正在读取草稿……');
      try {
        const beforeData = capture();const before = fingerprint(beforeData);
        const record = savedRecord(await store.read());
        if (!record) { status('没有保存的草稿。');return; }

        if (changedSince(before)) { status('当前预览已变化，请重新恢复。');return; }

        if (before === fingerprint(record.data)) { owned = { revision: record.revision, content: contentFingerprint(record.data) };status('当前预览已是保存的草稿。');return; }

        const hasCurrent = beforeData.questions.length || beforeData.fields['import-text'] || beforeData.fields['dual-question-text'] || beforeData.fields['dual-answer-text']
          || beforeData.fields['import-bank-name'] || beforeData.fields['import-bank-group-v58'];
        if (hasCurrent && !await actions.confirm('恢复本地草稿会替换当前导入预览和输入文本，继续？')) { status('已取消恢复，当前预览保留。');return; }

        const latest = await store.read();
        if (latest?.revision !== record.revision || changedSince(before)) { status('草稿或当前预览已变化，请重新恢复。');return; }

        apply(record.data);owned = { revision: record.revision, content: contentFingerprint(record.data) };
        status('已恢复本地草稿；请继续核对并主动确认导入。');
      } catch (error) { status(`恢复草稿失败，当前预览和已保存草稿均保留。${error?.message || ''}`); } finally { setBusy(false); }
    }

    // 删除前询问用户，并使用刚读取的修订保护其他窗口的新草稿。
    async function remove() {
      if (!canOperate()) { return; }

      setBusy(true);status('正在读取草稿……');
      try {
        const record = await store.read();
        if (!record) { status('没有保存的草稿。');return; }

        if (!await actions.confirm('删除本机保存的导入草稿？当前预览不受影响。')) { status('已取消删除草稿。');return; }

        await store.remove(record.revision || null);owned = null;status('已删除本机保存的草稿，当前预览保留。');
      } catch (error) { status(`删除草稿失败，原草稿已保留。${error?.message || ''}`); } finally { setBusy(false); }
    }

    // 成功入库后只清理本页拥有且内容一致的草稿。
    async function imported() {
      if (!owned) { return; }

      try {
        if (contentFingerprint(capture()) !== owned.content) { status('导入成功；当前内容与已保存草稿不同，草稿仍保留。');return; }

        await store.remove(owned.revision);owned = null;status('导入成功，已清除对应的本地草稿。');
      } catch (error) { status(`导入成功，但本地草稿未清除，请核对后手动删除。${error?.message || ''}`); }
    }

    async function clearForReset() {
      const record = await store.read();
      if (record) { await store.remove(record.revision || null); }

      owned = null;
    }

    return { save, restore, remove, imported, clearForReset };
  }

  globalThis.ShirohaImportPreview = Object.freeze({ create, createStore, createPersistence });
})();
