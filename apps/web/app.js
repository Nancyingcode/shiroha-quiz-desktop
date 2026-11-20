// 隔离应用状态和共享模块装配，待浏览器或桌面平台准备好后启动页面。
(function () {
  const APP_VERSION = 'V38：单题AI解析与追问版';
  const {
    RICH_CONTENT_VERSION_V57,
    pickRichTextFieldV57,
    pickRichOptionTextV57,
    questionImageDataUriRegexV83,
    markdownImageRegexV83,
    safeImageIdV83,
    stripUnsafeImageDataUrisV83,
    normalizeQuestionImagesForWebV83,
    questionTextContainsDataUriV83,
    injectQuestionImagesForWebV83,
    buildRichContentFieldV57,
    buildRichContentCapabilitiesV57,
  } = globalThis.ShirohaRichContent;
  const {
    bankGroupName: bankGroupNameV58,
    bankNameKey: bankNameKeyV58,
    bankPathLabel: bankPathLabelV58,
    groupSuggestions,
    normalizeGroupName: normalizeBankGroupNameV58,
    pickGroupNameFromJson: pickBankGroupNameFromJsonV58,
  } = globalThis.ShirohaBankMetadata;
  const {
    bankType: PRACTICE_SCOPE_BANK_V8916,
    groupType: PRACTICE_SCOPE_GROUP_V8916,
    itemsForBanks: practiceSessionItemsForBanksV8916,
    normalize: normalizePracticeScopeV8916,
    question: practiceQuestionV8916,
  } = globalThis.ShirohaStudyScope;
  const CURRENT_SCHEMA_VERSION = 1;
  const KEY = 'shiroha_quiz_state_v28_4_c1';
  const AI_IMPORT_MAX_CHARS_V99 = 50000;
  const AI_SINGLE_FOLLOW_UP_MAX_V613 = 12;
  const AI_PREVIEW_MAX_ITEMS_V991 = 200;
  const AI_REVIEW_DEFAULT_BATCH_V991 = 20;
  const AI_ANALYSIS_DEFAULT_BATCH_V991 = 10;
  const AI_PROVIDER_PRESETS_V99 = globalThis.ShirohaAiSettings.presets;
  const TYPE_LABEL = { single: '单选题', multiple: '多选题', multi: '多选题', judge: '判断题', blank: '填空题', short: '简答题', short_answer: '简答题' };
  const PRACTICE_START_FROM_V58916 = 'from_start';
  const PRACTICE_START_CONTINUE_V58916 = 'continue';
  const PRACTICE_START_CUSTOM_V58916 = 'custom';
  const state = blankState();
  const practiceSession = globalThis.ShirohaStudySessions.createPractice();
  const examSession = globalThis.ShirohaStudySessions.createExam();
  let exportBankSelectedV23 = new Set();
  const $ = (s) => document.querySelector(s);

  const $$ = (s) => [...document.querySelectorAll(s)];

  // 将本轮试题连同源题库和原题号固化进训练记录，便于跨库复盘时定位。
  function trainingSessionItems(items) {
    return items.map(/* 开轮已补读正文，此处记录范围模块提供的来源。 */ (item) => ShirohaTraining.snapshotItem({
      bankId: practiceItemBankIdV8916(item),
      bankName: practiceItemBankNameV8916(item),
      bankQuestionNumber: practiceBankQuestionNumber(item),
      question: practiceQuestionV8916(item),
    }));
  }

  // 初始化时补齐缺失题库，保留用户清空题库后的空状态。
  function ensureDefaultBank() {
    if (!state.banks.length && !state.settings?.suppressDefaultBank) {
      state.banks.push(builtInBank.defaultBank());
    }

    if (!state.activeBankId) {
      state.activeBankId = state.banks[0]?.id || '';
    }
  }

  function blankState() {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, banks: [], activeBankId: '', wrongBook: {}, favorites: {}, records: [], settings: {}, crossPlatformMeta: { favoriteQuestions: {} } };
  }

  function warnDev(message, error) {
    try {
      console.warn('[Shiroha Quiz]', message, error || '');
    } catch { /* 日志不可用时不能阻断题库操作。 */ }
  }

  // 等平台存储确认可读后才装入应用数据，读取失败交给启动恢复流程。
  async function loadState() {
    const result = await ShirohaPlatform.storage.initialize();
    if (result.state !== 'ready') {
      throw result.error;
    }

    const snapshot = await ShirohaPlatform.storage.read();
    return snapshot ? migrateState(snapshot, KEY) : blankState();
  }

  // 将历史存储内容迁移到当前快照结构，并补齐旧版本缺失的设置与元数据。
  function migrateState(raw, sourceKey) {
    const base = blankState();
    if (!raw || typeof raw !== 'object') {
      return base;
    }

    const migrated = { ...base, ...raw };
    const oldVersion = Number(raw.schemaVersion || 0);
    migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
    if (oldVersion < CURRENT_SCHEMA_VERSION) {
      migrated.settings = { ...(migrated.settings || {}), lastMigratedFromSchema: oldVersion, lastMigratedAt: now() };
    }

    if (sourceKey && sourceKey !== KEY) {
      migrated.settings = { ...(migrated.settings || {}), migratedFromStorageKey: sourceKey };
    }

    return migrated;
  }

  // 清理本地数据前先取消在途操作，清理后让宿主按恢复场景重新初始化。
  async function clearStoredState() {
    await ShirohaPlatform.harness?.cancelAll();
    if (ShirohaPlatform.storage.reset) {
      await ShirohaPlatform.storage.reset();
    } else {
      await ShirohaPlatform.credentials.reset();
    }

    await ShirohaPlatform.harness?.initialize({ restored: true });
  }

  async function saveState() {
    return runMutation(async () => {
      await saveSilent();
      toast(ShirohaPlatform.storage.checkpoint ? '已保存到本机数据库。' : '已保存到浏览器本地。', 'ok');
    });
  }

  function now() {
    return new Date().toISOString();
  }

  function makeId(prefix = 'id', ...parts) {
    const base = parts.filter((v) => v != null && String(v).trim()).map((v) => String(v).replace(/* 标识片段只保留 ASCII 字母、数字、下划线和连字符，以便拼成稳定 ID。 */ /[^A-Za-z0-9_-]+/g, '_').slice(0, 32)).filter(Boolean).join('_');
    const random = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    return [prefix, base, random].filter(Boolean).join('_');
  }

  // 本页仅保存已读取正文；索引参与统计和组卷，读取完成后才能进入修改事务。
  const nativeReads = new Set();
  // 分页仅归当前页面会话；每个列表独立保存条数，切换范围或恢复数据时重置页码。
  const nativePages = new Map();
  const LIST_PAGE_SIZES = [10, 20, 50, 100];
  const nativeOpenRecords = new Set();
  const nativeRenderVersions = new Map();
  const {
    activeBank,
    current: practiceScopeV8916,
    banks: practiceScopeBanksV8916,
    label: practiceScopeLabelV8916,
    summary: practiceScopeSummaryV8916,
    setBank: setPracticeBankScopeV8916,
    setGroup: setPracticeGroupScopeV8916,
    itemKey: practiceItemKeyV8916,
    itemBankId: practiceItemBankIdV8916,
    itemBankName: practiceItemBankNameV8916,
    questionRef: practiceQuestionRef,
    bankQuestionNumber: practiceBankQuestionNumber,
    sourceMeta: practiceSourceMeta,
    render: renderPracticeScopeUiV8916,
  } = globalThis.ShirohaStudyScope.create({
    state,
    select: $,
    escape: esc,
    resetPages() {
      for (const entry of nativePages.values()) {
        entry.page = 0;
      }
    },
  });
  const savedQuestions = globalThis.ShirohaSavedQuestions.create({
    state,
    activeBank,
    transaction: runMutation,
    confirm: (...args) => ShirohaDialogs.confirm(...args),

    save: saveSilent,
    renderAll,
    toast,
  });
  function beginNativeRender(view) {
    const version = (nativeRenderVersions.get(view) || 0) + 1;
    nativeRenderVersions.set(view, version);
    return version;
  }

  // 追踪尚未完成的原生读取供保存事务等待，失效页面可抑制迟到的错误提示。
  async function readNative(action, shouldReport = () => true) {
    const task = Promise.resolve().then(action);
    nativeReads.add(task);
    try {
      await task;
      return true;
    } catch (error) {
      if (shouldReport()) {
        platformStatus(error.message || '读取本地数据失败，请重试。', true);
      }

      return false;
    } finally {
      nativeReads.delete(task);
    }
  }

  async function loadNativeItems(items, shouldReport) {
    if (!ShirohaPlatform.storage.ensureQuestions) {
      return true;
    }

    return readNative(() => ShirohaPlatform.storage.ensureQuestions(state, items.map(practiceQuestionRef)), shouldReport);
  }

  async function loadNativeBanks(ids, shouldReport) {
    return loadNativeItems(practiceSessionItemsForBanksV8916(state.banks.filter((bank) => ids.includes(bank.id))), shouldReport);
  }

  async function loadNativeRecords(ids) {
    if (!ShirohaPlatform.storage.ensureRecords) {
      return true;
    }

    return readNative(() => ShirohaPlatform.storage.ensureRecords(state, ids));
  }

  async function loadNativeAll() {
    if (!ShirohaPlatform.storage.ensureAll) {
      return true;
    }

    return readNative(() => ShirohaPlatform.storage.ensureAll(state));
  }

  function nativeViewVisible(id) {
    return !ShirohaPlatform.storage.lazy || (!mutationBusy && document.getElementById(id)?.classList.contains('active'));
  }

  const {
    listPageRange,
    listPageNumbers,
    normalizeWebQuestionType,
    isTextType,
    normalizeBlankAnswersV58914,
    isMultiBlankQuestionV58914,
    primaryBlankAnswerV58914,
    cloneBlankAnswersV58914,
    sameAnswerForQuestion,
  } = globalThis.ShirohaQuizCore;
  const { parsePracticeNumberRangeV58916, formatExactPracticeNumbersV58916 } = globalThis.ShirohaTraining;
  const { extractDocxText, docxXmlToText, decodeXml } = globalThis.ShirohaDocx.create({
    readBuffer: (file) => ShirohaPlatform.files.readBuffer(file),

    warnDev,
  });
  const pdfImport = globalThis.ShirohaPdf.create({
    readBuffer: (file) => ShirohaPlatform.files.readBuffer(file),

    toast,
    warnDev,
  });
  const { extractPdfText } = pdfImport;
  const ocrSession = globalThis.ShirohaOcrImport.create({
    pdf: pdfImport,
    readBuffer: (file) => ShirohaPlatform.files.readBuffer(file),

    toast,
    warnDev,
  });
  const textParser = globalThis.ShirohaTextParser.create({
    makeId,
    warnDev,
    docxXmlToText,
    decodeXml,
    pickRichTextFieldV57,
    pickRichOptionTextV57,
    normalizeQuestionImagesForWebV83,
    injectQuestionImagesForWebV83,
  });
  const {
    cleanImportedQuestion,
    collectImportWarnings,
    collectSoftRiskWarnings,
    countTypes,
    displayOptionTextV589,
    escapeRegExpV51,
    getHeadingType,
    importIssueStatus,
    isImportNoiseLine,
    isJudgeSymbolAnswer,
    isRawJudgeSymbolAnswer,
    mapType,
    normalizeAnswer,
    normalizeImportText,
    normalizeJsonMultilineTextV5910,
    normalizeQuestion,
    normalizeText,
    normalizeType,
    parseAnswerAnalysisEntries,
    parseOptionsText,
    parseTextQuestions: parseTextQuestionsDetailed,
    repairCircledCombinationQuestion,
    splitAnswer,
    splitTextAnswer,
    trimMultilineBoundaryV5910,
    validateQuestion,
  } = textParser;
  const dualAnswers = globalThis.ShirohaDualAnswers.create({
    collectImportWarnings,
    getHeadingType,
    isImportNoiseLine,
    isJudgeSymbolAnswer,
    isRawJudgeSymbolAnswer,
    mapType,
    normalizeAnswer,
    normalizeImportText,
    normalizeQuestion,
    splitAnswer,
    splitTextAnswer,
  });
  const {
    renderQuestionContent,
    prewarmMathJaxV56,
    scheduleMathJaxTypesetV56,
    parseDocxMarkdownTableBlockV55,
    renderQuestionBodyV83,
    questionHtml,
    bindAnswerOptionControls,
    refreshAnswerOptionControls,
    collectTextAnswerFromElementV58914,
    collectAnswer,
    answerDisplay,
    blankAnswersFromDetailV58914,
    blankUserAnswersFromDetailV58914,
    renderMultiBlankComparisonV58914,
    feedbackAnswerHtmlV58914,
    markOptions,
    practiceReviewAnswerHtml,
    renderReviewAnswerSummary,
    renderReviewOptions,
    applyAnswerStateV26,
  } = globalThis.ShirohaQuestionView.create({
    select: $,
    selectAll: $$,
    escape: esc,
    warn: warnDev,
    platform: ShirohaPlatform,
    normalizeJsonMultilineTextV5910,
    trimMultilineBoundaryV5910,
    displayOptionTextV589,
    repairCircledCombinationQuestion,
    normalizeQuestionImagesForWebV83,
    questionImageDataUriRegexV83,
    questionTextContainsDataUriV83,
    practiceSourceMeta,
    label,
    scoreOf,
    hasAnswerValueV58914,
    isMultiBlankQuestionV58914,
    isTextType,
    normalizeWebQuestionType,
    normalizeBlankAnswersV58914,
  });
  const {
    readCustomCountV60,
    syncLimitControlV60,
    bindLimitControlsV60,
    filteredPracticeItemsV8916,
    dueReviewItems,
    practiceBaseItemsV58916,
    syncPracticeStartModeFieldsV58916,
    syncPracticeStartUiV58916,
    bindPracticeStartControlsV58916,
    buildPracticeSelectionV58916,
    updatePracticeProgressV58916,
  } = globalThis.ShirohaPracticeSelection.create({
    state,
    session: practiceSession,
    select: $,
    now,
    scope: {
      banks: practiceScopeBanksV8916,
      current: practiceScopeV8916,
      normalize: normalizePracticeScopeV8916,
      fromStart: PRACTICE_START_FROM_V58916,
      continueMode: PRACTICE_START_CONTINUE_V58916,
      custom: PRACTICE_START_CUSTOM_V58916,
    },
    questions: {
      itemsForBanks: practiceSessionItemsForBanksV8916,
      key: practiceItemKeyV8916,
      wrongEntries: savedQuestions.getWrongEntries,
      favorites: savedQuestions.getFavoriteIds,
      shuffle,
      parseNumbers: parsePracticeNumberRangeV58916,
    },
    progress: { answer: (...args) => getPracticeAnswerStateV26(...args) },
  });
  const { renameActiveBank, newEmptyBank } = globalThis.ShirohaBankMetadata.create({
    state,
    select: $,
    activeBank,
    scope: {
      current: practiceScopeV8916,
      setBank: setPracticeBankScopeV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
    },
    dialogs: ShirohaDialogs,
    storage: { transaction: runMutation, save: saveSilent },
    renderAll,
    toast,
    makeId,
    now,
  });
  const builtInBank = globalThis.ShirohaBuiltInBank.create({
    state,
    select: $,
    resources: {
      bank: () => window.questionBank,

      index: () => window.questionBankIndex,

      json: (url) => ShirohaPlatform.resourceJson(url),
    },
    normalizeQuestion,
    setBankScope: setPracticeBankScopeV8916,
    storage: { transaction: runMutation, save: saveSilent },
    renderAll,
    toast,
    warnDev,
    now,
  });
  const {
    duplicateActiveBank,
    duplicateBankById,
    mergeBankIntoActive,
    dedupeActiveBank,
  } = globalThis.ShirohaBankQuestionOperations.create({
    state,
    select: $,
    activeBank,
    setPracticeBankScope: setPracticeBankScopeV8916,
    normalizeText,
    storage: { loadBanks: loadNativeBanks, transaction: runMutation, save: saveSilent },
    dialogs: ShirohaDialogs,
    renderAll,
    makeId,
    now,
  });
  // 保存失败可能替换选中集合，题库页、导出和删除每次使用同一个当前集合。
  const bankSelection = {
    get: () => exportBankSelectedV23,

    set: (value) => {
      exportBankSelectedV23 = value;
    },
  };
  const {
    confirmBankQuestionDeletion,
    removeBankQuestionReferences,
    deleteBankQuestions,
    deleteBanksV32,
  } = globalThis.ShirohaBankDeletion.create({
    state,
    sessions: {
      practice: practiceSession,
      exam: examSession,
      bankIdOf: practiceItemBankIdV8916,
      questionOf: practiceQuestionV8916,
    },
    scope: {
      normalize: normalizePracticeScopeV8916,
      ensure: practiceScopeV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
    },
    selection: bankSelection,
    storage: {
      canStart: () => !mutationBusy && applicationReady,

      loadBanks: loadNativeBanks,
      transaction: runMutation,
      save: saveSilent,
    },
    dialogs: ShirohaDialogs,
    rendering: {
      all: renderAll,
      resetQuestionSelection: () => resetBankQuestionSelection(),

      toast,
    },
    now,
  });
  const {
    closeBankQuestionDetail,
    renderBankSelect,
    renderMergeSelect,
    renderBankInputs,
    renderBankList,
    setupBankManagement,
    renderBankPreview,
    bankQuestionCopyText,
    openBankQuestionDetail,
    resetBankQuestionSelection,
    cancelPendingBankPreview,
  } = globalThis.ShirohaBankPage.create({
    state,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    short,
    formatDate: fmt,
    now,
    countTypes,
    scope: {
      ensureGroupUi: () => importPage.ensureBankGroupUi(),

      current: practiceScopeV8916,
      banks: practiceScopeBanksV8916,
      groupName: bankGroupNameV58,
      pathLabel: bankPathLabelV58,
      normalizeGroup: normalizeBankGroupNameV58,
      renderGroups: () => importPage.renderBankGroups(),

      setBank: setPracticeBankScopeV8916,
      setGroup: setPracticeGroupScopeV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
    },
    paging: {
      page: nativePage,
      visible: nativeViewVisible,
      begin: beginNativeRender,
      versions: nativeRenderVersions,
      loadItems: loadNativeItems,
      itemsForBanks: practiceSessionItemsForBanksV8916,
    },
    rendering: { all: renderAll, toast },
    selection: bankSelection,
    actions: {
      activeBank,
      transaction: runMutation,
      save: saveSilent,
      edit: (...args) => editBankByIdV45(...args),

      duplicate: duplicateBankById,
      exportBank: (id) => backupExport.exportBankById(id),

      exportCurrent: () => backupExport.exportCurrentBank(),

      exportSelected: () => backupExport.exportSelectedBanks(),

      deleteBanks: deleteBanksV32,
      deleteQuestions: deleteBankQuestions,
      isBusy: () => mutationBusy,

      canSelectExportBanks: () => applicationReady && !mutationBusy,
    },
    content: {
      stripUnsafe: stripUnsafeImageDataUrisV83,
      optionText: pickRichOptionTextV57,
      repair: repairCircledCombinationQuestion,
      parseTable: parseDocxMarkdownTableBlockV55,
      normalizeImages: normalizeQuestionImagesForWebV83,
      normalizeType: normalizeWebQuestionType,
      questionBody: renderQuestionBodyV83,
      questionContent: renderQuestionContent,
      answerDisplay,
    },
  });
  const {
    parseAiRefactorPayloadV384,
    aiResponseContentV99,
    aiResultArrayV991,
    normalizeAiReviewResultV991,
    normalizeAiAnalysisResultV991,
    parseAiSingleFollowUpV381,
    mergeAiSingleWarningV381,
    parseAiSingleAnalysisV613,
    aiHttpErrorMessage,
  } = globalThis.ShirohaAiResults.create({
    normalizeType, normalizeQuestion, makeId, trimMultilineBoundaryV5910, splitAnswer,
  });
  const { readTableImportFileV49, tableImportPreviewTextV49 } = globalThis.ShirohaTableImport.create({
    readText: readPlainTextFileV49,
    readBuffer: (file) => ShirohaPlatform.files.readBuffer(file),

    parser: textParser,
    decodeXml,
    makeId,
  });
  const importDraft = globalThis.ShirohaImportPreview.create({
    readers: { readText: readPlainTextFileV49, readTable: readTableImportFileV49, readDocx: extractDocxText, readPdf: extractPdfText },
    ocr: ocrSession,
    setBankName: (fileName) => importPage.setBankNameFromFile(fileName),

    applyTable: (result, fileName) => importPage.applyTable(result, fileName),

    toast,
  });
  const importFindReplace = globalThis.ShirohaImportFindReplace.create({
    select: $,
    escapeRegExp: escapeRegExpV51,
    // 修改原始文本后标记草稿变动，避免后续读取沿用旧解析结果。
    onTextEdited: (textarea) => {
      if (textarea.dataset.tableImportV49 === '1') {
        delete textarea.dataset.tableImportV49;
      }

      importDraft.tableResult = null;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });
  const aiSettings = globalThis.ShirohaAiSettings.create({
    presets: AI_PROVIDER_PRESETS_V99,
    platform: ShirohaPlatform,
    config: ensureAiImportStateV99,
    readKey: readStoredAiKeyV99,
    view: { select: $, escape: esc, copy: copyTextV23, toast },
  });
  const {
    normalizeAiConfigV99,
    isAiHarnessExecutionV99,
    aiHarnessTaskReasonV99,
    aiUnavailableReasonV99,
    aiHarnessPrivacyV99,
    aiExecutionConfigV99,
    aiConfiguredV99,
    aiAvailabilityV99,
    aiExecutionLabelV99,
    aiRequestConfigV99,
    isLocalAiEndpointV99,
    isConnectionTestingV99,
    sanitizeAiDiagnosticDetailV375,
    toggleAiDiagnosticV375,
    copyAiDiagnosticV375,
    copyAiOllamaCorsCommandV375,
    updateAiConnectionPillV99,
    renderAiSettingsV99,
  } = aiSettings;
  const aiTransport = globalThis.ShirohaAiTransport.create({
    platform: ShirohaPlatform,
    harness: { isHarness: isAiHarnessExecutionV99, taskReason: aiHarnessTaskReasonV99, configured: aiConfiguredV99, unavailableReason: aiUnavailableReasonV99 },
    response: { content: aiResponseContentV99, httpErrorMessage: aiHttpErrorMessage },
  });
  const { requestAiChatV99, withAiTimeoutV99 } = aiTransport;
  const importIdentity = globalThis.ShirohaAiImportSessions.createIdentity(importDraft);
  const {
    aiRefactorQuestionSnapshotV384,
    buildAiMessagesV99,
    aiQuestionPayloadV991,
    buildAiReviewMessagesV991,
    buildAiAnalysisMessagesV991,
    aiSingleFingerprintV613,
    aiSingleHasImagesV613,
    buildAiSingleAnalysisMessagesV613,
    buildAiSingleFollowUpMessagesV613,
  } = globalThis.ShirohaAiPrompts.create({
    question: practiceQuestionV8916, importKey: importIdentity.key, validate: validateQuestion, maxChars: AI_IMPORT_MAX_CHARS_V99,
  });
  const aiImportSessions = globalThis.ShirohaAiImportSessions.create({
    draft: importDraft,
    identity: importIdentity,
    configuration: {
      isEditing: () => !!bankEditor.current(),

      current: aiExecutionConfigV99,
      configured: aiConfiguredV99,
      unavailable: aiUnavailableReasonV99,
      request: aiRequestConfigV99,
      label: aiExecutionLabelV99,
    },
    organizer: {
      range: (...args) => aiImportRangeV992(...args),

      snapshotQuestion: aiRefactorQuestionSnapshotV384,
      messages: buildAiMessagesV99,
      parse: parseAiRefactorPayloadV384,
      parseText: (...args) => importPage.parseTextQuestions(...args),

      risk: (...args) => importPage.riskMessage(...args),
    },
    preview: {
      mode: () => aiImportPanel.mode(),

      collectTargets: (...args) => collectAiPreviewTargetDetailsV992(...args),

      payload: aiQuestionPayloadV991,
      issueStatus: importIssueStatus,
      label: (...args) => aiPreviewModeLabelV991(...args),

      analysisMessages: buildAiAnalysisMessagesV991,
      reviewMessages: buildAiReviewMessagesV991,
      resultArray: aiResultArrayV991,
      normalizeReview: normalizeAiReviewResultV991,
      normalizeAnalysis: normalizeAiAnalysisResultV991,
    },
    view: {
      select: $,
      sync: (...args) => syncAiImportActionV99(...args),

      refreshImport: (...args) => refreshAiImportPanelV99(...args),

      refreshPreview: (...args) => refreshAiPreviewPanelV991(...args),

      importStatus: (...args) => setAiImportStatusV99(...args),

      previewStatus: (...args) => setAiPreviewStatusV991(...args),

      notice: showNotice,
      render: (...args) => renderImportPreview(...args),
    },
    transport: { request: requestAiChatV99, timeout: withAiTimeoutV99 },
    limits: { importChars: AI_IMPORT_MAX_CHARS_V99, previewItems: AI_PREVIEW_MAX_ITEMS_V991, analysisBatch: AI_ANALYSIS_DEFAULT_BATCH_V991, reviewBatch: AI_REVIEW_DEFAULT_BATCH_V991 },
  });
  const {
    cancelAiImportRequestV99,
    invalidateAiImportRequestV99,
    cancelAiPreviewRequestV991,
    startAiPreviewTaskV991,
    startAiImportV99,
    resetAiSuggestionsV991,
    removeAiSuggestionsForQuestionV991,
  } = aiImportSessions;
  const practiceAiSessions = globalThis.ShirohaAiQuestionSessions.createPractice({
    practice: { current: () => practiceSession.current },
    question: {
      current: currentPracticeItemV8916,
      allowed: (...args) => aiSingleAllowedV613(...args),

      key: practiceItemKeyV8916,
      fingerprint: aiSingleFingerprintV613,
      answer: (...args) => getPracticeAnswerStateV26(...args),

      hasImages: aiSingleHasImagesV613,
    },
    request: {
      config: (...args) => aiSingleConfigV613(...args),

      timeout: withAiTimeoutV99,
      chat: requestAiChatV99,
      analysisMessages: buildAiSingleAnalysisMessagesV613,
      followUpMessages: buildAiSingleFollowUpMessagesV613,
    },
    result: { analysis: parseAiSingleAnalysisV613, followUp: parseAiSingleFollowUpV381, mergeWarning: mergeAiSingleWarningV381 },
    view: {
      render: (...args) => renderPracticeAiPanelV613(...args),

      sanitize: sanitizeAiDiagnosticDetailV375,
      notice: showNotice,
    },
    maxFollowUps: AI_SINGLE_FOLLOW_UP_MAX_V613,
  });
  const {
    reset: resetAiSinglePracticeV613,
    getSession: aiSingleSessionV613,
    runAnalysis: runAiSingleAnalysisV613,
    runFollowUp: runAiSingleFollowUpV613,
  } = practiceAiSessions;
  const { reviewAnalysisSource, savePractice, saveReview } = globalThis.ShirohaAiAnalysisSave.create({
    state,
    exam: examSession,
    practice: {
      current: () => practiceSession.current,

      currentItem: currentPracticeItemV8916,
      key: practiceItemKeyV8916,
      allowed: (...args) => aiSingleAllowedV613(...args),

      getSession: aiSingleSessionV613,
      selectionVersion: practiceAiSessions.selectionVersion,
    },
    question: { fromItem: practiceQuestionV8916, bankId: practiceItemBankIdV8916, fingerprint: aiSingleFingerprintV613 },
    rich: { buildField: buildRichContentFieldV57, schema: RICH_CONTENT_VERSION_V57 },
    storage: {
      transaction: runMutation,
      load: loadNativeItems,
      save: saveSilent,
      revision: () => ShirohaPlatform.storage.revision(),
    },
    view: {
      practice: () => renderPracticeAiPanelV613(),

      practiceSaved: () => refreshSavedPracticeAnalysis(),

      review: () => updateReviewAnalysisPanels(),

      notice: showNotice,
    },
    confirm: (...args) => ShirohaDialogs.confirm(...args),

    now,
  });
  const reviewAiSessions = globalThis.ShirohaAiQuestionSessions.createReview({
    question: { source: reviewAnalysisSource, fingerprint: aiSingleFingerprintV613, hasImages: aiSingleHasImagesV613 },
    request: {
      config: (...args) => aiSingleConfigV613(...args),

      timeout: withAiTimeoutV99,
      chat: requestAiChatV99,
      analysisMessages: buildAiSingleAnalysisMessagesV613,
    },
    result: { analysis: parseAiSingleAnalysisV613, mergeWarning: mergeAiSingleWarningV381 },
    storage: { save: saveReview },
    view: {
      render: (...args) => updateReviewAnalysisPanels(...args),

      sanitize: sanitizeAiDiagnosticDetailV375,
    },
  });
  const { run: runReviewAnalysis, save: saveReviewAnalysis } = reviewAiSessions;
  const {
    renderFavoritesPageV596,
    renderWrongBook,
    cancelFavoritePractice,
    cancelPendingSavedReads,
  } = globalThis.ShirohaSavedQuestionsPage.create({
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    short,
    formatDate: fmt,
    toast,
    paging: {
      visible: nativeViewVisible,
      begin: beginNativeRender,
      page: nativePage,
      versions: nativeRenderVersions,
      loadItems: loadNativeItems,
      itemsForBanks: practiceSessionItemsForBanksV8916,
    },
    bank: { active: activeBank, closeDetail: closeBankQuestionDetail, copyText: bankQuestionCopyText, openDetail: openBankQuestionDetail },
    favorites: {
      ids: savedQuestions.getFavoriteIds,
      toggle: savedQuestions.toggleFavorite,
      isFavorite: savedQuestions.isFavorite,
    },
    wrong: {
      get: savedQuestions.getWrongEntries,
      remove: savedQuestions.removeWrong,
      toggleMastery: savedQuestions.toggleWrongMastery,
    },
    review: {
      questionBody: renderQuestionBodyV83,
      options: renderReviewOptions,
      summary: renderReviewAnswerSummary,
      analysis: (...args) => renderReviewAnalysis(...args),

      updatePanels: (...args) => updateReviewAnalysisPanels(...args),

      isTextType,
    },
    practice: {
      resetAi: resetAiSinglePracticeV613,
      setup: (...args) => openQuickPracticeSetup(...args),

      baseItems: practiceBaseItemsV58916,
      question: practiceQuestionV8916,
      customMode: PRACTICE_START_CUSTOM_V58916,
      exactNumbers: formatExactPracticeNumbersV58916,
      syncMode: syncPracticeStartModeFieldsV58916,
    },
    actions: {
      renderAll,
      canStartPractice: () => applicationReady && !mutationBusy,

      preparePracticeNavigation: () => cancelPendingViewActions('practice'),
    },
  });
  const trainingReviewPage = globalThis.ShirohaTrainingReviewPage.create({
    state,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    short,
    formatDate: fmt,
    toast,
    platform: ShirohaPlatform,
    training: ShirohaTraining,
    paging: {
      visible: nativeViewVisible,
      begin: beginNativeRender,
      page: nativePage,
      versions: nativeRenderVersions,
      pages: nativePages,
      openRecords: nativeOpenRecords,
      loadItems: loadNativeItems,
      read: readNative,
    },
    content: {
      blankAnswers: blankAnswersFromDetailV58914,
      blankUserAnswers: blankUserAnswersFromDetailV58914,
      normalizeType: normalizeWebQuestionType,
      questionContent: renderQuestionContent,
      questionBody: renderQuestionBodyV83,
      isMultiBlank: isMultiBlankQuestionV58914,
      multiBlankComparison: renderMultiBlankComparisonV58914,
      practiceAnswer: practiceReviewAnswerHtml,
      hasAnswer: hasAnswerValueV58914,
      options: renderReviewOptions,
    },
    review: {
      sessions: reviewAiSessions,
      analysis: (...args) => renderReviewAnalysis(...args),

      updatePanels: (...args) => updateReviewAnalysisPanels(...args),

      typeset: scheduleMathJaxTypesetV56,
    },
    navigation: {
      switchView: switchViewV45,
      exitPractice: (...args) => exitPracticeFocus(...args),

      exitExam: (...args) => exitExamFocus(...args),

      status: platformStatus,
    },
    practice: {
      setup: (...args) => openQuickPracticeSetup(...args),

      groupName: bankGroupNameV58,
      setBank: setPracticeBankScopeV8916,
      setGroup: setPracticeGroupScopeV8916,
      baseItems: practiceBaseItemsV58916,
      scope: practiceScopeV8916,
      itemBankId: practiceItemBankIdV8916,
      question: practiceQuestionV8916,
      exactNumbers: formatExactPracticeNumbersV58916,
      renderScope: renderPracticeScopeUiV8916,
      syncMode: syncPracticeStartModeFieldsV58916,
    },
    actions: { transaction: runMutation, save: saveSilent, renderAll },
  });
  const {
    renderRecords,
    trainingCompletion,
    renderRecentTraining,
    openTrainingReview,
    leaveTrainingReview,
    bindTrainingReviewEvents,
  } = trainingReviewPage;
  const bankEditor = globalThis.ShirohaBankEditor.create({
    state,
    draft: importDraft,
    select: $,
    toast,
    now,
    makeId,
    scope: {
      current: practiceScopeV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
      normalizeGroup: normalizeBankGroupNameV58,
      readGroup: () => importPage.readBankGroup(),

      ensureGroupUi: () => importPage.ensureBankGroupUi(),

    },
    data: {
      normalize: normalizeQuestion,
      clean: cleanImportedQuestion,
      warnings: collectImportWarnings,
      loadBanks: loadNativeBanks,
      confirmDeletion: confirmBankQuestionDeletion,
      removeReferences: removeBankQuestionReferences,
    },
    preview: {
      cancelAi: cancelAiPreviewRequestV991,
      resetAi: resetAiSuggestionsV991,
      closeAi: (...args) => closeAiPreviewPanelV991(...args),

      render: (...args) => renderImportPreview(...args),

      resetSelection: resetBankQuestionSelection,
    },
    navigation: { switchView: switchViewV45 },
    actions: {
      transaction: runMutation,
      save: saveSilent,
      renderAll,
      canStartEdit: () => applicationReady && !mutationBusy,
    },
  });
  const {
    updateBankEditUiV45,
    editBankByIdV45,
    saveBankEditSessionV45,
    cancelPendingBankEdit,
  } = bankEditor;
  const {
    exitExamFocus,
    startExam,
    startExamTicker,
    submitExam,
  } = globalThis.ShirohaExamPage.create({
    session: examSession,
    state,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    now,
    makeId,
    question: {
      current: practiceQuestionV8916,
      key: practiceItemKeyV8916,
      bankId: practiceItemBankIdV8916,
      bankName: practiceItemBankNameV8916,
      isTextType,
      hasAnswer: hasAnswerValueV58914,
      score: scoreOf,
      sameAnswer: sameAnswerForQuestion,
      detail: makeAnswerDetail,
      collectText: collectTextAnswerFromElementV58914,
      html: questionHtml,
      applyAnswer: applyAnswerStateV26,
      bindOptions: bindAnswerOptionControls,
      collectAnswer,
      feedback: feedbackAnswerHtmlV58914,
      content: renderQuestionContent,
      markOptions,
    },
    practice: {
      scope: practiceScopeV8916,
      scopeLabel: practiceScopeLabelV8916,
      scopeSummary: practiceScopeSummaryV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      filteredItems: filteredPracticeItemsV8916,
      reviewItems: trainingSessionItems,
      reviewData: ShirohaTraining.buildReviewData,
      addWrong: savedQuestions.addWrong,
      markRight: savedQuestions.markRight,
      activeBank,
    },
    view: {
      restoreSidebar: restoreSidebarAfterFocusV47,
      collapseSidebar: autoCollapseSidebarForFocusV47,
      shell: updateShellLayoutByView,
      prewarmMath: prewarmMathJaxV56,
      bindRail: bindFocusRailToggleV34,
      renderAll,
      renderReviewAnalysis: (...args) => renderReviewAnalysis(...args),

      updateReviewPanels: (...args) => updateReviewAnalysisPanels(...args),

      openReview: openTrainingReview,
    },
    storage: {
      loadItems: loadNativeItems,
      isBusy: () => mutationBusy,

      isReady: () => applicationReady,

      saveFailed: () => mutationSaveError,

      transaction: runMutation,
      save: saveSilent,
    },
  });
  const studyDashboard = globalThis.ShirohaStudyDashboard.create({
    select: $,
    data: {
      records: () => state.records,

      scopeBanks: practiceScopeBanksV8916,
      wrongEntries: savedQuestions.getWrongEntries,
      dueReviewItems,
    },
    application: {
      isReady: () => applicationReady,

      isBusy: () => mutationBusy,

      switchView: switchViewV45,
    },
    practice: {
      current: () => practiceSession.current,

      fromStart: PRACTICE_START_FROM_V58916,
      syncStartUi: syncPracticeStartUiV58916,
      start: () => startPractice(),

      enterFocus: () => enterPracticeFocus(),

      renderQuestion: () => renderPracticeQuestion(),
    },
    confirm: (message) => ShirohaDialogs.confirm(message),

    toast,
  });
  const { renderStats } = studyDashboard;
  const practicePage = globalThis.ShirohaPracticePage.create({
    state,
    session: practiceSession,
    training: ShirohaTraining,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    now,
    makeId,
    toast,
    showNotice,
    selection: {
      readCount: readCustomCountV60,
      syncLimit: syncLimitControlV60,
      build: buildPracticeSelectionV58916,
      updateProgress: updatePracticeProgressV58916,
      syncStart: syncPracticeStartUiV58916,
    },
    scope: {
      current: practiceScopeV8916,
      normalize: normalizePracticeScopeV8916,
      label: practiceScopeLabelV8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      fromStart: PRACTICE_START_FROM_V58916,
      continueMode: PRACTICE_START_CONTINUE_V58916,
      custom: PRACTICE_START_CUSTOM_V58916,
      setBank: setPracticeBankScopeV8916,
      render: renderPracticeScopeUiV8916,
      activeBank,
    },
    question: {
      current: currentPracticeItemV8916,
      question: practiceQuestionV8916,
      key: practiceItemKeyV8916,
      bankId: practiceItemBankIdV8916,
      bankName: practiceItemBankNameV8916,
      hasAnswer: hasAnswerValueV58914,
      sameAnswer: sameAnswerForQuestion,
      isTextType,
      isMultiBlank: isMultiBlankQuestionV58914,
      blankUserAnswers: blankUserAnswersFromDetailV58914,
      multiBlankComparison: renderMultiBlankComparisonV58914,
      reviewAnswer: practiceReviewAnswerHtml,
      body: renderQuestionBodyV83,
      reviewOptions: renderReviewOptions,
      reviewSummary: renderReviewAnswerSummary,
      html: questionHtml,
      applyAnswer: applyAnswerStateV26,
      collectAnswer,
      bindOptions: bindAnswerOptionControls,
      refreshOptions: refreshAnswerOptionControls,
      canEditOptions: canEditPracticeOptions,
      markOptions,
      content: renderQuestionContent,
      feedback: feedbackAnswerHtmlV58914,
      score: scoreOf,
      detail: makeAnswerDetail,
      addWrong: savedQuestions.addWrong,
      markRight: savedQuestions.markRight,
    },
    review: {
      items: trainingSessionItems,
      data: ShirohaTraining.buildReviewData,
      completion: trainingCompletion,
      open: openTrainingReview,
      page: nativePage,
      analysis: (...args) => renderReviewAnalysis(...args),

      updatePanels: (...args) => updateReviewAnalysisPanels(...args),
    },
    favorites: { isFavorite: savedQuestions.isFavorite, toggle: savedQuestions.toggleFavorite },
    ai: { reset: resetAiSinglePracticeV613, render: (...args) => renderPracticeAiPanelV613(...args) },
    shell: {
      collapse: autoCollapseSidebarForFocusV47,
      restore: restoreSidebarAfterFocusV47,
      update: updateShellLayoutByView,
      bindRail: bindFocusRailToggleV34,
      prewarmMath: prewarmMathJaxV56,
      editQuestion: (...args) => openPracticeEditQuestionV120(...args),

      closeBankDetail: closeBankQuestionDetail,
      renderAll,
      renderStats,
    },
    storage: {
      loadItems: loadNativeItems,
      isBusy: () => mutationBusy,

      isReady: () => applicationReady,

      transaction: runMutation,
      save: saveSilent,
    },
  });
  const {
    startPracticeClockTicker,
    startWrongPractice,
    enterPracticeFocus,
    exitPracticeFocus,
    startPractice,
    totalPracticeFilledCount,
    canLeaveTotalPractice,
    renderPracticeQuestion,
    getPracticeAnswerStateV26,
    refreshSavedPracticeAnalysis,
    openQuickPracticeSetup,
    switchPracticeSourceV27,
    resetPractice,
    bindPracticeClockLifecycle,
  } = practicePage;
  const aiSettingsActions = globalThis.ShirohaAiSettingsActions.create({
    platform: ShirohaPlatform,
    settings: aiSettings,
    transport: aiTransport,
    storage: {
      readConfig: ensureAiImportStateV99,
      setConfig: (config) => {
        state.settings.aiImportV99 = config;
      },

      transaction: runMutation,
      save: saveSilent,
      recordSaveError: (error) => {
        mutationSaveError = error;
      },
    },
    confirm: (message) => ShirohaDialogs.confirm(message),

    isBusy: aiTasksBusyV99,
    syncImportAction: () => syncAiImportActionV99(),

    showNotice,
  });
  const aiImportPanel = globalThis.ShirohaAiImportPanel.create({
    draft: importDraft,
    sessions: aiImportSessions,
    platform: ShirohaPlatform,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    toast,
    showNotice,
    settings: {
      presets: AI_PROVIDER_PRESETS_V99,
      config: aiExecutionConfigV99,
      configured: aiConfiguredV99,
      availability: aiAvailabilityV99,
      isHarness: isAiHarnessExecutionV99,
      unavailable: aiUnavailableReasonV99,
      executionLabel: aiExecutionLabelV99,
      privacy: aiHarnessPrivacyV99,
      localEndpoint: isLocalAiEndpointV99,
      updatePill: updateAiConnectionPillV99,
      render: renderAiSettingsV99,
      toggleDiagnostic: toggleAiDiagnosticV375,
      copyDiagnostic: copyAiDiagnosticV375,
      copyCors: copyAiOllamaCorsCommandV375,
      save: aiSettingsActions.saveAiSettingsV99,
      test: aiSettingsActions.testAiConnectionV99,
      clear: aiSettingsActions.clearAiSettingsV99,
    },
    requests: {
      busy: aiTasksBusyV99,
      startImport: startAiImportV99,
      cancelImport: cancelAiImportRequestV99,
      invalidateImport: invalidateAiImportRequestV99,
      startPreview: startAiPreviewTaskV991,
      cancelPreview: cancelAiPreviewRequestV991,
    },
    editor: {
      isEditing: () => !!bankEditor.current(),

      openQuestion: (...args) => openEditQuestion(...args),

      normalizeQuestion,
    },
    preview: {
      status: importIssueStatus,
      key: importIdentity.key,
      findIndex: importIdentity.findIndex,
      render: (...args) => renderImportPreview(...args),

      renderPracticeAi: (...args) => renderPracticeAiPanelV613(...args),

      updateReview: (...args) => updateReviewAnalysisPanels(...args),

      switchView: switchViewV45,
    },
    limits: {
      importChars: AI_IMPORT_MAX_CHARS_V99,
      items: AI_PREVIEW_MAX_ITEMS_V991,
      analysisBatch: AI_ANALYSIS_DEFAULT_BATCH_V991,
      reviewBatch: AI_REVIEW_DEFAULT_BATCH_V991,
    },
  });
  const {
    bindAiImportEventsV99,
    syncAiImportActionV99,
    closeAiImportPanelV99,
    aiImportRangeV992,
    refreshAiImportPanelV99,
    setAiImportStatusV99,
    closeAiPreviewPanelV991,
    aiPreviewModeLabelV991,
    collectAiPreviewTargetDetailsV992,
    refreshAiPreviewPanelV991,
    setAiPreviewStatusV991,
    syncAiPreviewToolsV991,
    renderAiSuggestionRowV991,
    bindAiSuggestionActionsV991,
  } = aiImportPanel;
  const {
    aiSingleAllowedV613,
    aiSingleConfigV613,
    renderPracticeAiPanelV613,
    renderReviewAnalysis,
    updateReviewAnalysisPanels,
    bindReviewAnalysisEvents,
    cancelPendingReviewAnalysis,
  } = globalThis.ShirohaAiQuestionPanels.create({
    session: practiceSession,
    practiceAi: practiceAiSessions,
    reviewAi: reviewAiSessions,
    select: $,
    selectAll: $$,
    escape: esc,
    question: {
      currentItem: currentPracticeItemV8916,
      question: practiceQuestionV8916,
      key: practiceItemKeyV8916,
      answer: getPracticeAnswerStateV26,
      hasImages: aiSingleHasImagesV613,
      source: reviewAnalysisSource,
      content: renderQuestionContent,
    },
    settings: {
      config: aiExecutionConfigV99,
      configured: aiConfiguredV99,
      availability: aiAvailabilityV99,
      request: aiRequestConfigV99,
      isHarness: isAiHarnessExecutionV99,
      label: aiExecutionLabelV99,
      privacy: aiHarnessPrivacyV99,
    },
    actions: {
      practiceSession: aiSingleSessionV613,
      runPractice: runAiSingleAnalysisV613,
      followUp: runAiSingleFollowUpV613,
      retryReadiness: () => ShirohaPlatform.harness?.retryReadiness(),

      save: savePractice,
      runReview: runReviewAnalysis,
      saveReview: saveReviewAnalysis,
      exitPractice: exitPracticeFocus,
      exitExam: exitExamFocus,
      switchView: switchViewV45,
      isReady: () => applicationReady,
    },
  });
  const {
    renderImportPreview,
    batchDeleteImportSelected,
    bindMultiBlankEditorV58914,
    openEditQuestion,
    closeEditModal,
    saveEditQuestion,
    deleteEditQuestion,
    openPracticeEditQuestionV120,
  } = globalThis.ShirohaQuestionEditor.create({
    state,
    draft: importDraft,
    session: practiceSession,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    short,
    toast,
    now,
    parser: {
      countTypes,
      issueStatus: importIssueStatus,
      parseOptions: parseOptionsText,
      trimText: trimMultilineBoundaryV5910,
      isTextType,
      splitText: splitTextAnswer,
      splitAnswer,
      isMultiBlank: isMultiBlankQuestionV58914,
      cloneBlanks: cloneBlankAnswersV58914,
      primaryBlank: primaryBlankAnswerV58914,
      explicitBlankCount: explicitBlankCountV58914,
      normalizeType: normalizeWebQuestionType,
      normalizeQuestion,
      cleanQuestion: cleanImportedQuestion,
      validate: validateQuestion,
    },
    suggestions: {
      renderRow: renderAiSuggestionRowV991,
      remove: removeAiSuggestionsForQuestionV991,
      invalidateImport: invalidateAiImportRequestV99,
      bind: bindAiSuggestionActionsV991,
      sync: syncAiPreviewToolsV991,
    },
    editor: {
      updateBankUi: updateBankEditUiV45,
      syncAppend: () => importPage.syncAppend(),

      saveDraft: (index) => importDraftPersistence.save(index),
    },
    practice: {
      currentItem: currentPracticeItemV8916,
      question: practiceQuestionV8916,
      bankId: practiceItemBankIdV8916,
      key: practiceItemKeyV8916,
      renderScope: renderPracticeScopeUiV8916,
      render: renderPracticeQuestion,
    },
    view: {
      stats: renderStats,
      banks: renderBankList,
      bankPreview: renderBankPreview,
      wrong: renderWrongBook,
      favorites: renderFavoritesPageV596,
      records: renderRecords,
    },
    storage: { transaction: runMutation, save: saveSilent },
  });
  const importDraftPersistence = globalThis.ShirohaImportPreview.createPersistence({
    draft: importDraft,
    select: $,
    store: globalThis.ShirohaImportPreview.createStore(globalThis.indexedDB),
    suggestions: { capture: aiImportSessions.captureSuggestions, restore: aiImportSessions.restoreSuggestions },
    actions: {
      isEditing: () => !!bankEditor.current(),

      confirm: (message) => ShirohaDialogs.confirm(message),

      makeId: () => makeId('import-draft'),

      notify: toast,
      invalidate: () => importPage.resetSourcesForRestore(),

      render: () => {
        renderImportPreview(importDraft.questions);
        syncAiImportActionV99();
      },
    },
  });
  const { confirm: confirmImport } = globalThis.ShirohaImportCommit.create({
    state,
    draft: importDraft,
    editor: { current: bankEditor.current, save: saveBankEditSessionV45 },
    readBankGroup: () => importPage.readBankGroup(),

    bankPathLabel: bankPathLabelV58,
    setPracticeBankScope: setPracticeBankScopeV8916,
    loadNativeBanks,
    runMutation,
    saveSilent,
    isStringTooLargeError: isStringTooLargeErrorV376,
    collectImportWarnings,
    cleanImportedQuestion,
    makeId,
    now,
    onImported: importDraftPersistence.imported,
    view: { select: $, renderAll, showNotice, toast, warnDev },
  });

  // 为宽窄布局建立可切换的页码与每页条数控件，两组按钮共用翻页行为。
  function renderNativePageActions({
    controls,
    page,
    pages,
    title,
    entry,
    changePage,
  }) {
    const actions = document.createElement('div');
    actions.className = 'list-pagination-controls';
    controls.appendChild(actions);
    // 构造带可访问名称的分页按钮，保留重渲染后定位焦点所需的控件标识。
    const addButton = (group, text, name, value, disabled, control) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.className = 'list-page-button';
      button.setAttribute('aria-label', name);
      button.dataset.pageControl = control;
      button.disabled = disabled;
      if (control === `page:${page}`) {
        button.setAttribute('aria-current', 'page');
      }

      button.onclick = () => changePage(value);

      group.appendChild(button);
    };

    // 容器宽度决定显示哪组页码；窄卡片（含桌面侧栏布局）也保留首末页与键盘入口。
    for (const compact of [false, true]) {
      const group = document.createElement('div');
      group.className = `list-page-numbers ${compact ? 'is-compact' : 'is-wide'}`;
      actions.appendChild(group);
      addButton(group, '‹', '上一页', page - 1, page === 0, 'previous');
      for (const n of listPageNumbers(page + 1, pages, compact)) {
        if (n === 'ellipsis') {
          const gap = document.createElement('span');
          gap.className = 'list-page-gap';
          gap.textContent = '…';
          gap.setAttribute('aria-hidden', 'true');
          group.appendChild(gap);
        } else {
          addButton(group, String(n), `第 ${n} 页`, n - 1, false, `page:${n - 1}`);
        }
      }

      addButton(group, '›', '下一页', page + 1, page === pages - 1, 'next');
    }

    const select = document.createElement('select');
    select.className = 'list-page-size';
    select.setAttribute('aria-label', `${title}每页条数`);
    select.dataset.pageControl = 'size';
    for (const size of LIST_PAGE_SIZES) {
      const option = document.createElement('option');
      option.value = String(size);
      option.textContent = `${size} 条/页`;
      select.appendChild(option);
    }

    select.value = String(entry.size);
    select.onchange = () => changePage(0, Number(select.value));

    actions.appendChild(select);
  }

  // 为分页目标维护独立的请求页与焦点，换题库后重置页码并仅获取可见题目。
  function nativePage(rows, key, target, render) {
    let entry = nativePages.get(target.id);
    if (!entry) {
      entry = { key, page: 0, size: LIST_PAGE_SIZES[0] };
      nativePages.set(target.id, entry);
    }

    if (entry.key !== key) {
      entry.key = key;
      entry.page = 0;
    }

    const {
      page,
      pages,
      start,
      end,
    } = listPageRange(rows.length, entry.page, entry.size);
    entry.page = page;
    const id = `${target.id}-pager`;
    let controls = document.getElementById(id);
    if (!controls) {
      controls = document.createElement('nav');
      controls.id = id;
      controls.className = 'list-pagination';
      const anchor = target.closest('.table-wrap') || target;
      anchor.insertAdjacentElement('afterend', controls);
    }

    const focusKey = controls.contains(document.activeElement) ? document.activeElement.dataset.pageControl : null;
    const view = target.closest('.view');
    const title = target.closest('.card')?.querySelector('h2')?.textContent || target.getAttribute('aria-label') || '列表';
    controls.setAttribute('aria-label', `${title}分页`);
    controls.replaceChildren();
    const status = document.createElement('span');
    status.className = 'list-pagination-status';
    status.setAttribute('role', 'status');
    status.textContent = rows.length ? `第 ${page + 1} / ${pages} 页 · ${start + 1}–${end} 项，共 ${rows.length} 项` : '共 0 项';
    controls.appendChild(status);
    if (!rows.length) {
      return [];
    }

    // 页码和每页数量同时写入分页状态，并在重新渲染后同步列表。
    const changePage = async (next, size = entry.size) => {
      entry.page = next;
      entry.size = size;
      await render();
      const stillCurrent = entry.key === key && entry.page === next && entry.size === size && target.isConnected;
      if (stillCurrent && (!view || view.classList.contains('active'))) {
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    };

    renderNativePageActions({ controls, page, pages, title, entry, changePage });
    if (focusKey) {
      const candidates = [...controls.querySelectorAll('[data-page-control]')].filter((node) => node.getClientRects().length && !node.disabled);
      const nextFocus = candidates.find((node) => node.dataset.pageControl === focusKey) || candidates.find((node) => node.getAttribute('aria-current') === 'page');
      nextFocus?.focus({ preventScroll: true });
    }

    return rows.slice(start, end);
  }

  // 切页释放题目缓存前避开在途读写，并保留当前练习和考试的题目。
  function releaseNativeView() {
    if (nativeReads.size || mutationBusy) {
      return;
    }

    const activeItems = [...(practiceSession.current.items || []), ...(examSession.current.items || [])];
    ShirohaPlatform.storage.releaseView?.(state, activeItems.map(practiceQuestionRef));

    nativeOpenRecords.clear();
  }

  // 原生分页视图统一刷新；浏览器仅在已有加载占位时补做题库预览。
  function renderNativeView() {
    if (!ShirohaPlatform.storage.lazy) {
      if ($('#banks')?.classList.contains('active') && $('#bank-preview [data-bank-preview-loading]')) {
        renderBankPreview();
      }

      return;
    }

    renderBankPreview();
    renderWrongBook();
    renderFavoritesPageV596();
    renderRecords();
  }

  function currentPracticeItemV8916() {
    return (practiceSession.current && practiceSession.current.items && practiceSession.current.items[practiceSession.current.idx]) || null;
  }

  // 切换页面时复位内容滚动，兼容不提供窗口滚动能力的宿主。
  function resetViewScrollV282() {
    try {
      const main = document.querySelector('.main');
      if (main) {
        main.scrollTop = 0;
      }

      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    } catch {
      try {
        window.scrollTo(0, 0);
      } catch { /* 部分宿主不支持滚动，导航仍应继续。 */ }
    }
  }

  // 同步当前视图对应的应用外壳属性，避免页态与侧栏布局分离。
  function updateShellLayoutByView(viewId) {
    const current = viewId || document.querySelector('.view.active')?.id || 'dashboard';
    document.body.dataset.activeView = current;
    const topbar = $('.topbar');
    if (topbar) {
      const hideTopbar = ['wrongbook', 'favorites', 'records', 'training-review', 'ai-settings', 'settings'].includes(current);
      topbar.classList.toggle('is-hidden-by-view', hideTopbar);
    }
  }

  // 页面变化后取消原视图仍在进行的读取和导航任务，阻止迟到结果回写。
  function cancelPendingViewActions(target) {
    const from = $('.view.active');
    if (from && from.id !== target) {
      cancelPendingReviewAnalysis(from);
    }

    cancelPendingSavedReads(target);
    if (target !== 'favorites') {
      cancelFavoritePractice();
    }

    if (target !== 'practice') {
      practiceSession.invalidatePending();
      practiceAiSessions.select();
    }

    if (target !== 'exam') {
      examSession.invalidatePending();
    }

    if (target !== 'banks') {
      cancelPendingBankEdit();
      cancelPendingBankPreview();
    }
  }

  // 将导航按钮接入页面切换守卫，并同步专注模式及未完成练习提示。
  function bindNav() {
    $$('.nav').forEach(/* 为每个导航按钮保留它自己的目标页面与点击处理。 */ (btn) => btn.onclick = /* 通过离开练习确认后再切页，并使原页面的待处理操作失效。 */ async () => {
      const target = btn.dataset.view;
      const view = target && $(`#${target}`);
      if (!view || view.classList.contains('active')) {
        return;
      }

      if (target !== 'practice' && !await canLeaveTotalPractice(target)) {
        return;
      }

      cancelPendingViewActions(target);
      leaveTrainingReview();
      if (document.body.classList.contains('practice-focus') && target !== 'practice') {
        exitPracticeFocus();
      }

      if (document.body.classList.contains('exam-focus') && target !== 'exam') {
        exitExamFocus();
      }

      if (aiImportSessions.importRequest.running && target !== 'import') {
        cancelAiImportRequestV99(true);
      }

      if (aiImportSessions.previewRequest.running && target !== 'import') {
        cancelAiPreviewRequestV991(true);
      }

      closeBankQuestionDetail();
      $$('.nav').forEach((b) => b.classList.toggle('active', b === btn));

      $$('.view').forEach((v) => v.classList.toggle('active', v === view));

      const title = $('#page-title');
      if (title) {
        title.textContent = btn.textContent;
      }

      updateShellLayoutByView(target);
      releaseNativeView();
      renderNativeView();
      if (target === 'practice' && practiceSession.current.items.length && !practiceSession.current.completed) {
        enterPracticeFocus();
        renderPracticeQuestion();
      }

      if (target === 'ai-settings') {
        renderAiSettingsV99();
      }

      if (target === 'import') {
        syncAiImportActionV99();
      }

      resetViewScrollV282();
    });
  }

  // 让错题、收藏和学习记录从各自入口触发复习、刷新或经确认清理。
  function bindLearningRecordActions() {
    $('#clear-wrong-btn').onclick = savedQuestions.clearCurrentWrong;
    $('#clear-records-btn').onclick = trainingReviewPage.clearRecords;
    $('#export-records-btn').onclick = backupExport.exportRecords;
    $('#record-mode-filter').onchange = renderRecords;
    const recordDetailFilterV385 = $('#record-detail-filter-v385');
    if (recordDetailFilterV385) {
      recordDetailFilterV385.onchange = renderRecords;
    }

    $('#record-limit').onchange = renderRecords;
    $('#record-refresh-btn').onclick = renderRecords;
    $('#wrong-status-filter').onchange = renderWrongBook;
    $('#wrong-sort-mode').onchange = renderWrongBook;
    $('#practice-wrong-btn').onclick = () => {
      cancelPendingViewActions('practice');
      startWrongPractice();
    };

    const practiceFavBtnV596 = $('#practice-favorites-btn-v596');
    if (practiceFavBtnV596) {
      practiceFavBtnV596.onclick = () => {
        cancelPendingViewActions('practice');
        switchPracticeSourceV27('favorite');
      };
    }

    const clearFavBtnV596 = $('#clear-favorites-btn-v596');
    if (clearFavBtnV596) {
      clearFavBtnV596.onclick = savedQuestions.clearCurrentFavorites;
    }
  }

  // 在应用初始化时集中绑定界面操作及生命周期事件，保留已有模块的入口。
  function bindEvents() {
    bindReviewAnalysisEvents();
    bindTrainingReviewEvents();
    bindPracticeClockLifecycle();
    studyDashboard.bind();
    $('#active-bank-select').onchange = /* 一起更新练习范围和活动题库，避免两个选择分离。 */ async (e) => runMutation(async () => {
      setPracticeBankScopeV8916(e.target.value, true);
      await saveSilent();
      renderAll();
    });

    $('#save-all-btn').onclick = saveState;
    importPage.bind();

    $('#dedupe-btn').onclick = dedupeActiveBank;
    $('#rename-bank-btn').onclick = renameActiveBank;
    $('#duplicate-bank-btn').onclick = duplicateActiveBank;
    $('#new-empty-bank-btn').onclick = newEmptyBank;
    $('#merge-bank-btn').onclick = mergeBankIntoActive;
    $('#bank-sort-mode').onchange = renderBankList;
    $('#start-practice-btn').onclick = startPractice;
    $('#reset-practice-btn').onclick = resetPractice;
    $('#start-exam-btn').onclick = startExam;
    $('#submit-exam-btn').onclick = () => submitExam(false);

    bindLearningRecordActions();

    const exportAllBtn = $('#export-all-btn');
    if (exportAllBtn) {
      exportAllBtn.onclick = backupExport.exportAllBackup;
    }

    $('#reset-data-btn').onclick = resetData;
    bindLimitControlsV60();
    bindPracticeStartControlsV58916();
    bindAiImportEventsV99();
  }

  // 保存失败时保留错误供外层变更回滚，并把错误传给调用者。
  async function saveSilent(operationId) {
    try {
      await ShirohaPlatform.saves.save(JSON.parse(serializeState()), operationId);
    } catch (error) {
      mutationSaveError = error;
      throw error;
    }
  }

  /* SHIROHA_WEB_ISSUE_99_AI_IMPORT_START */

  function ensureAiImportStateV99() {
    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings.aiImportV99 = normalizeAiConfigV99(state.settings.aiImportV99);
    return state.settings.aiImportV99;
  }

  function readStoredAiKeyV99(configOverride) {
    return ShirohaPlatform.credentials.status('ai', configOverride || ensureAiImportStateV99());
  }

  // 按钮未就绪也会禁用，只有连接测试的在途标记才代表业务占用。
  function aiTasksBusyV99() {
    const importBusy = aiImportSessions.importRequest.running || aiImportSessions.previewRequest.running;
    return importBusy || practiceAiSessions.isBusy() || reviewAiSessions.isBusy()
      || !!ShirohaPlatform.harness?.status().busy || isConnectionTestingV99();
  }

  /* SHIROHA_WEB_ISSUE_99_AI_IMPORT_END */

  function label(t) {
    return TYPE_LABEL[t] || t || '未知';
  }

  /* SHIROHA_WEB_V58_9_14_MULTI_BLANK_SYNC_START */
  function hasAnswerValueV58914(values) {
    return Array.isArray(values) && values.some((value) => String(value ?? '').trim());
  }

  function explicitBlankCountV58914(value) {
    return (String(value || '').match(/* 全角或半角空括号以及至少三道下划线都计作题干显式空位。 */ /（\s*）|\(\s*\)|_{3,}/g) || []).length;
  }
  /* SHIROHA_WEB_V58_9_14_MULTI_BLANK_SYNC_END */

  function stripQuestionImages(s) {
    return String(s || '').replace(/* 用可读占位代替内嵌 Markdown 图片，避免预览摘要包含二进制内容。 */ /!\[[^\]]*\]\(data:image\/[^)]+\)/g, '[图片]');
  }

  function short(s, n) {
    const text = stripQuestionImages(String(s || ''));
    return text.length > n ? `${text.slice(0, n)}…` : text;
  }

  function esc(s) {
    return String(s ?? '').replace(/* 转义会被浏览器解释为 HTML 标记或属性边界的字符。 */ /[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // 全局通知提示本次操作结果，导入页保留可回看的反馈。
  function toast(msg, type = 'warn', title = '提示') {
    const n = $('#import-summary');
    if (n) {
      n.textContent = msg;
      n.className = `notice ${type}`;
    }

    showNotice(title, msg, type);
  }

  // 复用全局通知容器，并在新提示到来时更新显示内容及状态。
  function showNotice(title, msg, type = 'ok') {
    let box = $('#app-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'app-toast';
      box.className = 'app-toast';
      document.body.appendChild(box);
    }

    const item = document.createElement('div');
    item.className = `toast-item ${['ok', 'danger'].includes(type) ? type : 'warn'}`;
    item.innerHTML = `<div><b>${esc(title || '提示')}</b><p>${esc(msg || '')}</p></div><button type="button" aria-label="关闭">×</button>`;
    item.querySelector('button').onclick = () => item.remove();

    box.appendChild(item);
    setTimeout(() => {
      item.classList.add('hide');
      setTimeout(() => item.remove(), 260);
    }, type === 'danger' ? 6500 : 4200);
  }

  // 以当前数量级格式化导入体积，便于界面提示用户判断拆分规模。
  function formatBytesV376(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n >= 1024 * 1024) {
      return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
    }

    if (n >= 1024) {
      return `${(n / 1024).toFixed(1)} KB`;
    }

    return `${n} B`;
  }

  async function readPlainTextFileV49(file) {
    return ShirohaPlatform.files.readText(file);
  }

  // 导入与 WebDAV 共用同一判断，保持字符串超限的反馈一致。
  function isStringTooLargeErrorV376(error) {
    const name = String(error?.name || '');
    const msg = String(error?.message || '');
    return name === 'RangeError' || /* 从运行时错误文案识别序列化字符串超限，补足仅有错误名称的判断。 */ /Invalid string length|string length|too large/i.test(msg);
  }

  // 洗牌时复制输入，避免打乱原有题库顺序。
  function shuffle(a) {
    const shuffled = [...a];
    for (let i = shuffled.length - 1;i > 0;i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  // 仅在原练习轮次和题目仍活动且计时未锁时允许修改选项。
  function canEditPracticeOptions(session, key) {
    const current = currentPracticeItemV8916();
    const clockLocked = practiceSession.current.clock && practiceSession.current.clock.state !== 'running';
    const isDifferentQuestion = practiceSession.current !== session || !current || practiceItemKeyV8916(current) !== key;
    const isInputLocked = isDifferentQuestion || practiceSession.current.completed || mutationBusy || clockLocked;
    if (isInputLocked) {
      return false;
    }

    if (practiceSession.current.submitMode === 'total') {
      return !practiceSession.current.totalLocked && !practiceSession.current.confirmingTotal;
    }

    const answer = getPracticeAnswerStateV26(key);
    return !answer.answered && !answer.revealed;
  }

  // 记录逻辑共用题目来源、题干摘要和多空答案规则，判分与时间由提交方提供。
  function makeAnswerDetail(item, answer) {
    return ShirohaTraining.answerDetail({
      ...answer,
      bankId: practiceItemBankIdV8916(item),
      bankName: practiceItemBankNameV8916(item),
    }, { short, isMultiBlank: isMultiBlankQuestionV58914, cloneBlankAnswers: cloneBlankAnswersV58914 });
  }

  // 使用显式的题目分数，旧题未配置时由当前题型计分规则提供默认值。
  function scoreOf(q) {
    if (q.score) {
      return q.score;
    }

    let selector = '#score-single';
    if (q.type === 'multiple') {
      selector = '#score-multiple';
    } else if (q.type === 'judge') {
      selector = '#score-judge';
    } else if (q.type === 'blank') {
      selector = '#score-blank';
    } else if (q.type === 'short') {
      selector = '#score-short';
    }

    return Number($(selector).value) || 0;
  }

  function fmt(s) {
    return new Date(s).toLocaleString('zh-CN', { hour12: false });
  }

  /* SHIROHA_V23_DATA_TOOLS_PATCH_START
   v23: 题库管理页批量选择导出 + 导入页/设置页备份 JSON 导入恢复
*/
  function setupEnhancedDataToolsV23() {
    injectDataToolsStyleV23();
    setupBankManagement();
    ensureNativeRecoveryPanel();
    backupRestore.mountSettings({
      exportZip: backupExport.exportNativeCompatibleBackupZip,
      copyBackup: backupExport.copyAllBackupJson,
      mountWebdav: webdavPanel.mount,
    });
  }

  /* v28.4.4: 导入配置 / 备份 JSON 入口已移动到设置/导出页，不再插入导入题库页。 */
  function ensureNativeRecoveryPanel() {
    if (!ShirohaPlatform.storage.snapshots || document.getElementById('native-recovery-panel')) {
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'native-recovery-panel';
    panel.className = 'notice';
    const title = document.createElement('p');
    title.textContent = '本机恢复点：覆盖和重置前自动保留，不自动删除。恢复点不包含 API Key 或密码。';
    const select = document.createElement('select');
    select.setAttribute('aria-label', '本机恢复点');
    const refresh = document.createElement('button');
    refresh.textContent = '读取恢复点';
    const restore = document.createElement('button');
    restore.textContent = '恢复选中的数据';
    restore.disabled = true;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    refresh.onclick = /* 查询恢复点期间锁定刷新按钮，到达后同步恢复操作的可用性。 */ async () => {
      refresh.disabled = true;
      try {
        const names = await ShirohaPlatform.storage.snapshots();
        select.replaceChildren();
        for (const name of names) {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        }

        restore.disabled = !names.length;
        status.textContent = names.length ? '恢复前会再次保留当前数据。' : '尚无恢复点。';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        refresh.disabled = false;
      }
    };

    restore.onclick = /* 恢复点切换完成后重新载入应用。 */ async () => {
      const name = select.value;
      if (!name) {
        return;
      }

      // 解锁页面后再重载，避免正常恢复触发正在保存时的退出拦截。
      const attempt = async () => {
        const restored = await runMutation(/* 等旧保存队列结束再切换，避免旧状态覆盖恢复结果。 */ async () => {
          if (!await ShirohaDialogs.confirm('用选中的恢复点替换当前题库和学习数据？当前数据会先保留为新的恢复点。')) {
            return false;
          }

          await ShirohaPlatform.harness?.cancelAll();
          await ShirohaPlatform.saves.idle();
          await ShirohaPlatform.storage.restoreSnapshot(name);
          return true;
        }, retry);
        if (restored) {
          location.reload();
        }
      };

      // 重试不能切换到未确认过的恢复点。
      const retry = () => {
        if (select.value !== name || !$('#settings')?.classList.contains('active')) {
          toast('恢复点选择已变化，请重新选择。', 'warn');
          return false;
        }

        return attempt();
      };

      await attempt();
    };

    panel.append(title, refresh, select, restore, status);
    document.getElementById('settings').appendChild(panel);
    const repair = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '数据无法读取时修复';
    repair.appendChild(summary);
    offerNativeRecovery(repair);
    panel.appendChild(repair);
  }

  // 旧页面没有数据工具样式时按需补齐，避免重复注入。
  function injectDataToolsStyleV23() {
    if ($('#data-tools-style-v23')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'data-tools-style-v23';
    style.textContent = `
    .data-tools-v23{margin:16px 0;padding:16px;border:1px solid rgba(120,144,180,.28);border-radius:16px;background:rgba(248,251,255,.72)}
    .data-tools-v23 h2{margin:0 0 8px}.data-tools-v23 h3{margin:0 0 10px}
    .data-tool-card-v23{margin:14px 0;padding:14px;border:1px solid rgba(120,144,180,.22);border-radius:14px;background:rgba(255,255,255,.82)}
    .bank-bulk-panel-v23{background:rgba(248,251,255,.9)}.compact-head-v23{margin-bottom:8px}
    .wrap-v23{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.check-line-v23{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
    .bank-bulk-check-v23{display:flex;align-items:center;padding-right:8px}.bank-bulk-check-v23 input{width:18px;height:18px;cursor:pointer}
    .webdav-card-v378{position:relative}.webdav-head-v378,.webdav-list-head-v378{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.webdav-list-head-v378{margin-top:18px;align-items:baseline}.webdav-list-head-v378 h3{margin:0}
    .webdav-chip-v378{display:inline-flex;white-space:nowrap;padding:4px 10px;border-radius:999px;background:rgba(120,144,180,.14);font-size:12px;font-weight:700}.webdav-chip-v378.ok{color:#18794e;background:rgba(38,166,91,.13)}.webdav-chip-v378.warn{color:#9a6700;background:rgba(240,174,0,.14)}.webdav-chip-v378.danger{color:#b42318;background:rgba(217,45,32,.12)}
    .webdav-form-v378{margin-top:12px}.webdav-remember-v378{margin:10px 0}.webdav-summary-v378{margin:10px 0;line-height:1.7}.webdav-list-v378{display:grid;gap:8px;margin-top:10px}.webdav-row-v378{display:grid;grid-template-columns:minmax(180px,1fr) auto auto auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid rgba(120,144,180,.2);border-radius:12px;background:rgba(255,255,255,.7)}.webdav-file-v378{min-width:0}.webdav-file-v378 b{display:block;overflow-wrap:anywhere}.webdav-latest-v378{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:rgba(38,166,91,.13);color:#18794e;font-size:11px}.webdav-diagnostics-v378{margin-top:14px;padding:10px 12px;border:1px dashed rgba(120,144,180,.3);border-radius:12px}.webdav-diagnostics-v378 summary{cursor:pointer;font-weight:700}.webdav-diagnostics-v378 dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 10px;margin:10px 0}.webdav-diagnostics-v378 dt{font-weight:700}.webdav-diagnostics-v378 dd{margin:0;overflow-wrap:anywhere}.webdav-security-v378{margin:12px 0 0}
    .webdav-modal-v378{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.48)}.webdav-modal-v378[hidden]{display:none}.webdav-modal-card-v378{width:min(620px,100%);max-height:calc(100vh - 36px);overflow:auto;padding:20px;border-radius:18px;background:var(--card,#fff);box-shadow:0 24px 70px rgba(15,23,42,.28)}.webdav-modal-card-v378 h2{margin-top:0}.webdav-modal-card-v378 label{display:grid;gap:7px;margin:14px 0}
    @media(max-width:720px){.webdav-head-v378,.webdav-list-head-v378{display:block}.webdav-head-v378 .webdav-chip-v378{margin-top:8px}.webdav-row-v378{grid-template-columns:1fr auto}.webdav-row-v378 .webdav-row-meta-v378{grid-column:1/-1}.webdav-actions-v378 button{flex:1 1 calc(50% - 8px)}.webdav-diagnostics-v378 dl{grid-template-columns:1fr}.webdav-diagnostics-v378 dd{margin-bottom:4px}}
  `;
    document.head.appendChild(style);
  }

  // 剪贴板权限失败时给出手动复制说明，供各复制入口复用。
  async function copyTextV23(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg, 'ok');
    } catch {
      toast('浏览器不允许自动复制，请手动复制下方文本。', 'warn');
    }
  }

  function setBackupPreviewV23(text) {
    const out = $('#export-output');
    if (out) {
      out.value = text;
    }
  }
  /* SHIROHA_V23_DATA_TOOLS_PATCH_END */

  /* SHIROHA_V25_2_TO_V28_ENHANCEMENTS_START
   v25.2: 内置题库按需加载
   v26: 刷题体验增强
   v27: 收藏题与错题本补强
   v28: App WebView 导出兜底与移动端加固
*/

  /* SHIROHA_WEB_V58_9_12_1_HOME_VERSION_SYNC_FIX */
  function syncHomeVersionPromptV586() {
    const label = APP_VERSION;
    try {
      const root = document.querySelector('#dashboard') || document.body || document;
      document.title = `Shiroha Quiz - ${label}`;
      const homeVersionLabel = document.querySelector('#home-version-label');
      if (homeVersionLabel) {
        homeVersionLabel.textContent = label;
      }

      const nodes = [...root.querySelectorAll('h1,h2,h3,h4,b,strong,span,p,div')];
      nodes.forEach(/* 仅替换安全的版本文本节点，避开脚本、样式与用户输入内容。 */ (el) => {
        if (!el || /* 不在脚本、样式和表单控件的内容里替换旧版本标签。 */ /^(SCRIPT|STYLE|INPUT|TEXTAREA|SELECT|OPTION)$/i.test(el.tagName || '')) {
          return;
        }

        const txt = (el.textContent || '').trim();
        if (!txt) {
          return;
        }

        const leaf = el.children.length === 0;
        if (leaf && /* 识别不带明确新式分隔符的 V29 旧标题。 */ /^V\s*29\s*[:：]?\s*基本完成版$/.test(txt)) {
          el.textContent = label;
        } else if (leaf && /* 兼容带冒号的任意旧版“基本完成版”标题。 */ /^V\s*\d+\s*[:：]\s*基本完成版$/.test(txt)) {
          el.textContent = label;
        }
      });
    } catch { /* 版本提示同步失败不应阻断页面启动。 */ }
  }

  // 完成状态迁移和默认值补齐后绑定事件，首次渲染即可读取完整状态。
  function init() {
    upgradeState();
    ensureAiImportStateV99();
    ensureDefaultBank();
    importPage.ensureBankGroupUi();
    bindNav();
    bindEvents();
    bindMultiBlankEditorV58914();
    builtInBank.bind();
    setupSidebarCollapse();
    setupEnhancedDataToolsV23();
    renderAll();
    updateShellLayoutByView();
    syncHomeVersionPromptV586();
    setTimeout(syncHomeVersionPromptV586, 80);
    setTimeout(syncHomeVersionPromptV586, 300);
  }

  // 迁移已读状态的字段与题库分组，防止归一化改写尚未加载的原生题目。
  function upgradeState() {
    for (const entry of nativePages.values()) {
      entry.page = 0;
      entry.key = '';
    }

    state.schemaVersion = CURRENT_SCHEMA_VERSION;
    state.banks = Array.isArray(state.banks) ? state.banks : [];
    state.records = Array.isArray(state.records) ? state.records : [];
    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings.aiImportV99 = normalizeAiConfigV99(state.settings.aiImportV99);
    state.settings.practiceProgressV58916 = state.settings.practiceProgressV58916 && typeof state.settings.practiceProgressV58916 === 'object' && !Array.isArray(state.settings.practiceProgressV58916) ? state.settings.practiceProgressV58916 : {};
    for (const b of state.banks) {
      b.groupName = pickBankGroupNameFromJsonV58(b);
      b.questions = (b.questions || []).map((q, i) => (ShirohaPlatform.storage?.isQuestionLoaded && !ShirohaPlatform.storage.isQuestionLoaded(b.id, q.id) ? q : ({ ...q, ...normalizeQuestion(q, i), id: q.id || makeId('q', i), number: q.number || i + 1 })));

      b.updatedAt = b.updatedAt || b.createdAt || now();
    }

    savedQuestions.upgrade();
    practiceScopeV8916();
  }

  function serializeState() {
    return JSON.stringify({ ...state, schemaVersion: CURRENT_SCHEMA_VERSION, favorites: state.favorites || {} });
  }

  // 数据切换后集中刷新界面，保持题库、练习范围和各处计数一致。
  function renderAll() {
    importPage.ensureBankGroupUi();
    practiceScopeV8916();
    updateAiConnectionPillV99();
    syncAiImportActionV99();
    renderStats();
    renderBankSelect();
    renderMergeSelect();
    renderBankList();
    renderBankPreview();
    renderWrongBook();
    renderFavoritesPageV596();
    renderRecords();
    renderRecentTraining();
    renderBankInputs();
    builtInBank.render();
    renderPracticeScopeUiV8916();
    if (typeof renderExportBankSelectorV23 === 'function') {
      renderExportBankSelectorV23();
    }

    importPage.refreshAppendTarget();
    syncHomeVersionPromptV586();
    syncPracticeStartUiV58916(true);
  }

  /* SHIROHA_WEB_V24_CROSS_PLATFORM_NATIVE_INTEROP */
  const {
    cleanFileNameV23,
    exportSettingsV1,
    toNativeQuestionType,
    serializeQuestionForCrossExportV53,
    serializeBankForCrossExportV53: serializeBackupBank,
  } = globalThis.ShirohaBackupExport;
  const serializeBankForCrossExportV53 = (bank) => serializeBackupBank(bank, normalizeBankGroupNameV58);

  const backupRecordConverters = globalThis.ShirohaBackupCore.createRecordConverters({
    makeId, now, serializeQuestion: serializeQuestionForCrossExportV53, toNativeQuestionType,
  });
  const {
    externalizeImages: externalizeNativeBackupImagesV611,
    readBackupFile: readBackupFileV24,
    applyAssets: applyBackupAssetsV24,
    countUnresolvedImages: countUnresolvedBackupImagesV24,
  } =    globalThis.ShirohaBackupArchive.create({
    readBuffer: (file) => ShirohaPlatform.files.readBuffer(file),

    cleanFileName: cleanFileNameV23,
    markdownImageRegex: markdownImageRegexV83,
    questionImageDataUriRegex: questionImageDataUriRegexV83,
    safeImageId: safeImageIdV83,
  });
  const backupData = globalThis.ShirohaBackupData.create({
    makeId,
    now,
    serializeBankForCrossExportV53,
    exportSettingsV1,
    buildRichContentCapabilitiesV57,
    cleanFileNameV23,
    pickBankGroupNameFromJsonV58,
    normalizeQuestion,
    normalizeBankGroupNameV58,
    bankNameKeyV58,
    backupRecordConverters,
    externalizeNativeBackupImagesV611,
    APP_VERSION,
    CURRENT_SCHEMA_VERSION,
    RICH_CONTENT_VERSION_V57,
  });
  const buildBackupPayloadV23 = (banks, exportType, includeAll) => backupData.buildBackupPayloadV23(state, banks, exportType, includeAll);

  const { normalizeBackupPayloadV23 } = backupData;
  const mergeBackupBanksV23 = (normalized) => backupData.mergeBackupBanksV23(state, normalized);

  const backupExport = globalThis.ShirohaBackupExport.create({
    state,
    activeBank,
    selection: bankSelection,
    serializeBank: serializeBankForCrossExportV53,
    backupData,
    reads: { banks: loadNativeBanks, records: loadNativeRecords, all: loadNativeAll },
    output: {
      download: downloadBlob,
      setPreview: setBackupPreviewV23,
      copy: copyTextV23,
      toast,
      platformStatus,
      warnDev,
    },
    appVersion: APP_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    now,
  });
  const backupRestore = globalThis.ShirohaBackupRestore.create({
    state,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    platform: ShirohaPlatform,
    archive: {
      read: readBackupFileV24,
      applyAssets: applyBackupAssetsV24,
      countUnresolvedImages: countUnresolvedBackupImagesV24,
    },
    data: {
      normalize: normalizeBackupPayloadV23,
      merge: mergeBackupBanksV23,
      normalizeGroup: normalizeBankGroupNameV58,
      upgrade: upgradeState,
      ensureDefaultBank,
    },
    storage: {
      transaction: runMutation,
      loadAll: loadNativeAll,
      save: saveSilent,
      saveFailed: () => Boolean(mutationSaveError),
    },
    view: {
      select: $,
      confirm: ShirohaDialogs.confirm,
      setPreview: setBackupPreviewV23,
      toast,
      refresh: () => {
        setupEnhancedDataToolsV23();
        renderAll();
      },
    },
  });

  const ocrOutput = globalThis.ShirohaOcrOutput.create({
    draft: importDraft,
    ocr: ocrSession,
    select: $,
    invalidateAiImportRequestV99,
    cleanImportBankNameFromFile: globalThis.ShirohaImportPage.cleanImportBankNameFromFile,
    copyTextV23,
    downloadBlob,
    platformStatus,
  });
  const importPage = globalThis.ShirohaImportPage.create({
    state,
    draft: importDraft,
    view: {
      select: $,
      selectAll: $$,
      escape: esc,
      renderImportPreview,
      showNotice,
      toast,
      warnDev,
      formatBytesV376,
    },
    parsing: {
      parseTextQuestionsDetailed,
      normalizeQuestion,
      countTypes,
      collectImportWarnings,
      collectSoftRiskWarnings,
      parseAnswerAnalysisEntries,
      dualAnswers,
      tableImportPreviewTextV49,
    },
    banks: { normalizeBankGroupNameV58, bankPathLabelV58, groupSuggestions },
    editor: { current: bankEditor.current, closeEditModal, saveEditQuestion, deleteEditQuestion, batchDeleteImportSelected },
    actions: { confirmImport, openFindReplace: importFindReplace.open, isBusy: () => mutationBusy },
    ai: aiImportSessions,
    panel: { closeAiImportPanelV99, closeAiPreviewPanelV991, syncAiImportActionV99 },
    ocr: { bind: ocrOutput.bind, resetOcrImportState: ocrSession.resetOcrImportState },
    persistence: importDraftPersistence,
    backup: {
      confirm: ShirohaDialogs.confirm,
      runMutation,
      normalizeBackupPayloadV23,
      countUnresolvedBackupImagesV24,
      applyLocalBackup: backupRestore.applyLocalBackup,
    },
  });

  function downloadBlob(name, blob) {
    return ShirohaPlatform.download(name || 'download.bin', blob);
  }

  /* SHIROHA_WEB_V37_8_WEBDAV_CLOUD_BACKUP_START
   v37.8: 手动 WebDAV 完整备份、远程历史列表与事务恢复。
*/
  const webdavPanel = globalThis.ShirohaWebdavPanel.create({
    platform: ShirohaPlatform,
    storeWebdavConfigV378: (config, password, storePassword) => {
      const defaults = defaultWebdavConfigV378();
      return backupRestore.storeWebdavConfig(defaults, config, password, storePassword);
    },

    clearWebdavStorageV378: backupRestore.clearWebdavConfig,
    loadNativeAll,
    getState: () => state,

    buildBackupPayloadV23,
    normalizeBackupPayloadV23,
    applyNormalizedBackupV378: backupRestore.applyWebdavBackup,
    isStringTooLargeErrorV376,
    isMutationBusy: () => mutationBusy,

    APP_VERSION,
    now,
    fmt,
    esc,
    formatBytesV376,
    copyTextV23,
    toast,
    renderAll,
    setupEnhancedDataToolsV23,
  });
  const { defaultWebdavConfigV378, renderWebdavPanelV378 } = webdavPanel;
  /* SHIROHA_WEB_V37_8_WEBDAV_CLOUD_BACKUP_END */

  /* SHIROHA_V25_2_TO_V28_ENHANCEMENTS_END */

  /* SHIROHA_WEB_V28_2_LAYOUT_AND_IMMERSIVE_FIX_START */
  function refreshSidebarToggleV47() {
    const btn = $('#sidebar-toggle');
    if (!btn) {
      return;
    }

    const collapsed = document.body.classList.contains('side-collapsed');
    btn.textContent = collapsed ? '展开导航' : '收起导航';
    btn.setAttribute('aria-label', collapsed ? '展开左侧导航' : '收起左侧导航');
    btn.setAttribute('aria-pressed', String(collapsed));
  }

  // 侧栏状态与按钮同步，只有调用者显式请求时才保存偏好。
  function setSidebarCollapsedV47(collapsed, persist = false) {
    document.body.classList.toggle('side-collapsed', !!collapsed);
    if (persist) {
      try {
        ShirohaPlatform.preferences.setSidebar(document.body.classList.contains('side-collapsed'));
      } catch {
        platformStatus('侧栏设置保存失败，请检查浏览器存储权限。', true);
      }
    }

    refreshSidebarToggleV47();
  }

  // 进入专注练习时自动收起展开的侧栏，记录是否由入口自动改变。
  function autoCollapseSidebarForFocusV47() {
    if (!document.body.classList.contains('side-collapsed')) {
      document.body.dataset.focusAutoCollapsedV47 = '1';
      setSidebarCollapsedV47(true, false);
    } else {
      delete document.body.dataset.focusAutoCollapsedV47;
      refreshSidebarToggleV47();
    }
  }

  // 离开专注状态时只还原自动收起的侧栏，保留用户自己的选择。
  function restoreSidebarAfterFocusV47() {
    if (document.body.dataset.focusAutoCollapsedV47 === '1') {
      setSidebarCollapsedV47(false, false);
      delete document.body.dataset.focusAutoCollapsedV47;
    } else {
      refreshSidebarToggleV47();
    }
  }

  // 初始化可折叠侧栏及持久化偏好，多次装配时保持单一控件。
  function setupSidebarCollapse() {
    if ($('#sidebar-toggle')) {
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'sidebar-toggle';
    btn.type = 'button';
    btn.className = 'sidebar-toggle';
    document.body.appendChild(btn);
    const stored = ShirohaPlatform.preferences.sidebar();
    setSidebarCollapsedV47(stored, false);
    btn.onclick = () => {
      delete document.body.dataset.focusAutoCollapsedV47;
      setSidebarCollapsedV47(!document.body.classList.contains('side-collapsed'), true);
    };

    refreshSidebarToggleV47();
  }

  // 按当前专注页面的布局测量答题栏顶部，避免切页或窗口变化后遮挡内容。
  function syncFocusRailTopV35() {
    const isPractice = document.body.classList.contains('practice-focus');
    const isExam = document.body.classList.contains('exam-focus');
    let card = null;
    let rail = null;
    if (isPractice) {
      card = $('#practice-card');
      rail = $('#practice-card > .practice-side-v31');
    } else if (isExam) {
      card = $('#exam-card');
      rail = $('#exam-card > .exam-side-v31');
    }

    if (!card || !rail) {
      return;
    }

    if (window.innerWidth < 1280) {
      rail.style.removeProperty('top');
      rail.style.removeProperty('max-height');
      return;
    }

    const top = Math.max(12, Math.round(card.getBoundingClientRect().top));
    rail.style.setProperty('top', `${top}px`, 'important');
    rail.style.setProperty('max-height', `calc(100vh - ${top + 18}px)`, 'important');
  }

  let focusRailSyncBoundV35 = false;
  // 全局只绑定一次专注栏重算监听，供滚动和窗口尺寸变化共用。
  function setupFocusRailSyncV35() {
    if (focusRailSyncBoundV35) {
      return;
    }

    focusRailSyncBoundV35 = true;
    let ticking = false;
    // 让多个布局事件在同一动画帧合并，避免重复测量。
    const schedule = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        syncFocusRailTopV35();
      });
    };

    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
  }

  // 绑定各专注页自己的答题栏按钮，并确保尺寸监听已启用。
  function bindFocusRailToggleV34() {
    setupFocusRailSyncV35();
    $$('[data-rail-toggle-v34]').forEach(/* 给练习与考试按钮保留不同的收起状态来源。 */ (btn) => btn.onclick = /* 只切换按钮所属的答题栏，再同步可访问状态与定位。 */ () => {
      const kind = btn.dataset.railToggleV34;
      if (kind === 'practice') {
        document.body.classList.toggle('practice-rail-collapsed-v34');
      }

      if (kind === 'exam') {
        document.body.classList.toggle('exam-rail-collapsed-v34');
      }

      syncFocusRailTopV35();
    });

    syncFocusRailTopV35();
    requestAnimationFrame(syncFocusRailTopV35);
    setTimeout(syncFocusRailTopV35, 80);
  }

  /* SHIROHA_WEB_V28_2_LAYOUT_AND_IMMERSIVE_FIX_END */

  // 在独占保存事务中重置数据，经用户确认后才调用平台清除入口。
  async function resetData() {
    return runMutation(/* 确认后停止原任务并清理可恢复的本地状态，然后重新初始化数据。 */ async () => {
      if (!await ShirohaDialogs.confirm('确定清除全部本地数据？默认题库也会重新初始化。')) {
        return;
      }

      await ShirohaPlatform.saves.idle();
      await clearStoredState();
      try {
        await importDraftPersistence.clearForReset();
      } catch {
        await ShirohaDialogs.alert('题库数据已清除，但本机导入草稿未能清除，请刷新后手动删除草稿。');
      }

      location.reload();
    });
  }

  /* SHIROHA_WEB_V45_BANK_EDITOR_AND_FOCUS_NAV_START */
  async function switchViewV45(viewId, resumePractice = true) {
    const view = viewId && $(`#${viewId}`);
    if (!view) {
      return;
    }

    if (viewId !== 'practice' && !await canLeaveTotalPractice(viewId)) {
      return;
    }

    cancelPendingViewActions(viewId);
    if (viewId !== 'practice') {
      exitPracticeFocus();
    }

    if (viewId !== 'exam') {
      exitExamFocus();
    }

    if (viewId !== 'training-review') {
      leaveTrainingReview();
    }

    $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === viewId));

    $$('.view').forEach((v) => v.classList.toggle('active', v === view));

    const nav = document.querySelector(`[data-view="${viewId}"]`);
    const title = $('#page-title');
    if (title && nav) {
      title.textContent = nav.textContent;
    }

    updateShellLayoutByView(viewId);
    releaseNativeView();
    renderNativeView();
    if (viewId === 'practice' && resumePractice && practiceSession.current.items.length && !practiceSession.current.completed) {
      enterPracticeFocus();
      renderPracticeQuestion();
    }

    if (viewId === 'ai-settings') {
      renderAiSettingsV99();
    }

    if (viewId === 'import') {
      syncAiImportActionV99();
    }

    resetViewScrollV282();
  }

  /* SHIROHA_WEB_V45_BANK_EDITOR_AND_FOCUS_NAV_END */

  // 页面拥有单个写入事务；保存期间冻结交互，避免失败回滚覆盖后续编辑。
  // 仅 action 的同步调用链可加入当前事务；action 返回或抛错时立即重置，异步期间仍由 mutationBusy 独占。
  let mutationBusy = false;
  let enteringMutation = false;
  let mutationSaveError = null;
  let applicationReady = false;
  // 启动代次只属于当前窗口；恢复后的新启动不能沿用旧冷启动检查。
  let applicationStarted = false;
  let applicationGeneration = 0;
  let retryMutation = null;
  // 将平台读写状态呈现在可访问的通知区，失败时保留对应样式。
  function platformStatus(message, failed = false) {
    let el = document.getElementById('platform-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'platform-status';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }

    el.textContent = message;
    el.className = `platform-status${failed ? ' failed' : ''}`;
    el.hidden = !message;
    if (failed && retryMutation) {
      const retry = document.createElement('button');
      retry.textContent = '重试';
      retry.onclick = () => retryMutation();

      el.appendChild(retry);
    }
  }

  function lockApplication(locked) {
    document.querySelector('.app')?.toggleAttribute('inert', locked);
    document.body.dataset.storageState = locked ? 'pending' : 'ready';
    refreshAnswerOptionControls();
  }

  // 记录普通对象图的属性与数组长度，便于恢复原对象身份而非替换对象。
  function mutationCheckpoint(roots) {
    const seen = new Set();
    const entries = [];
    // 仅记录可回滚的普通对象与数组，保留原引用并跳过重复访问。
    const visit = (value) => {
      if (!value || typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) {
        return;
      }

      seen.add(value);
      const fields = Object.entries(value);
      entries.push({ value, fields, length: Array.isArray(value) ? value.length : null });
      fields.forEach(([,child]) => visit(child));
    };

    roots.forEach(visit);
    return /* 回滚时恢复原对象属性与长度，清除事务期间新增的字段。 */ () => {
      for (const { value, fields, length } of entries) {
        Object.keys(value).forEach((key) => delete value[key]);

        if (length !== null) {
          value.length = length;
        }

        for (const [key, child] of fields) {
          value[key] = child;
        }
      }
    };
  }

  // 串行保护需要保存的数据变更，确认修订未推进时才恢复原快照。
  // 需要预读原生正文的操作可以在重试时重新执行完整入口。
  async function runMutation(action, retry = () => runMutation(action)) {
    if (enteringMutation) {
      return action();
    }

    if (mutationBusy || !applicationReady) {
      return false;
    }

    mutationBusy = true;
    mutationSaveError = null;
    lockApplication(true);
    platformStatus('正在保存，请勿关闭页面…');
    await Promise.allSettled([...nativeReads]);
    const rollbackView = ShirohaPlatform.storage.checkpointView?.();
    const disabledBefore = [...document.querySelectorAll('button,input,select,textarea')].map((el) => [el, el.disabled]);
    const exportSelectionBefore = new Set(exportBankSelectedV23);
    const practiceBefore = practiceSession.current;
    const examBefore = examSession.current;
    const rollback = mutationCheckpoint([state, practiceBefore, examBefore]);
    const revisionBefore = ShirohaPlatform.storage.revision();
    const focused = document.activeElement;
    try {
      ShirohaPlatform.saves.resume();
      enteringMutation = true;
      let result;
      try {
        result = action();
      } finally {
        enteringMutation = false;
      }

      const value = await result;
      if (mutationSaveError) {
        throw mutationSaveError;
      }

      retryMutation = null;
      platformStatus('');
      return value === undefined ? true : value;
    } catch (error) {
      if (ShirohaPlatform.storage.revision() !== revisionBefore) {
        mutationSaveError = null;
        retryMutation = null;
        platformStatus('数据已保存，但界面刷新失败，请重新打开页面。', true);
        return false;
      }

      rollback();
      if (practiceSession.current !== practiceBefore) {
        practiceSession.current = practiceBefore;
        if (practiceBefore.clock?.state === 'running') {
          startPracticeClockTicker();
        }
      }

      if (examSession.current !== examBefore) {
        examSession.current = examBefore;
        startExamTicker(examBefore);
      }

      rollbackView?.();
      exportBankSelectedV23 = exportSelectionBefore;
      disabledBefore.forEach(([el, disabled]) => {
        if (el.isConnected) {
          el.disabled = disabled;
        }
      });

      retryMutation = retry;

      platformStatus(error?.message || '保存失败，原数据与编辑内容已保留，请重试。', true);
      return false;
    } finally {
      mutationBusy = false;
      lockApplication(false);
      if (focused?.isConnected) {
        focused.focus();
      }

      renderNativeView();
    }
  }

  // 损坏数据无法启动时提供原生恢复点和兼容备份修复入口。
  function offerNativeRecovery(container) {
    if (!ShirohaPlatform.storage.recoverySnapshots) {
      return;
    }

    const load = document.createElement('button');
    load.textContent = '查找本机恢复点';
    load.type = 'button';
    const select = document.createElement('select');
    select.setAttribute('aria-label', '修复使用的恢复点');
    select.hidden = true;
    const repair = document.createElement('button');
    repair.textContent = '从恢复点修复数据';
    repair.type = 'button';
    repair.disabled = true;
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    load.onclick = /* 查询可验证的恢复副本，未找到时提示保留当前数据目录。 */ async () => {
      load.disabled = true;
      try {
        const names = await ShirohaPlatform.storage.recoverySnapshots();
        select.replaceChildren();
        for (const name of names) {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        }

        select.hidden = !names.length;
        repair.disabled = !names.length;
        message.textContent = names.length ? '修复会先校验恢复副本；原数据库、日志和媒体均会保留。' : '没有可用的本机恢复点。请保留完整数据目录，使用已有兼容备份恢复。';
      } catch (error) {
        message.textContent = error.message;
      } finally {
        load.disabled = false;
      }
    };

    repair.onclick = /* 恢复期间锁定两个入口，失败后允许改选副本再试。 */ async () => {
      if (!select.value || !await ShirohaDialogs.confirm('用所选恢复点修复本地数据？恢复副本通过校验后才会切换，原数据文件不会删除。')) {
        return;
      }

      repair.disabled = true;
      load.disabled = true;
      try {
        await ShirohaPlatform.storage.recover(select.value);
        await startApplication();
      } catch (error) {
        message.textContent = error.message;
        repair.disabled = false;
        load.disabled = false;
      }
    };

    const backup = document.createElement('input');
    backup.type = 'file';
    backup.accept = '.json,.zip';
    backup.setAttribute('aria-label', '选择兼容备份修复数据');
    backup.onchange = /* 使用用户选择的兼容备份尝试修复，保留原数据库供追查。 */ async () => {
      const file = backup.files?.[0];
      if (!file) {
        return;
      }

      backup.disabled = true;
      try {
        const { data, unresolvedImageCount } = await backupRestore.readBackupContents(file);
        if (unresolvedImageCount) {
          throw new Error('备份缺少图片，未切换本地数据。');
        }

        const normalized = normalizeBackupPayloadV23(data, file.name);
        const snapshot = { schemaVersion: CURRENT_SCHEMA_VERSION, banks: normalized.banks, activeBankId: normalized.activeBankId || normalized.banks[0]?.id || '', wrongBook: normalized.wrongBook || {}, favorites: normalized.favorites || {}, records: normalized.records || [], settings: normalized.settings || {}, crossPlatformMeta: normalized.crossPlatformMeta || {} };
        if (!await ShirohaDialogs.confirm(`已解析 ${snapshot.banks.length} 个题库、${snapshot.banks.reduce((n, b) => n + b.questions.length, 0)} 道题、${snapshot.records.length} 条记录。使用此备份修复？原数据文件和凭据将保留。`)) {
          return;
        }

        await ShirohaPlatform.storage.recoverImport(snapshot);
        await startApplication();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        backup.disabled = false;
      }
    };

    container.append(load, select, repair, backup, message);
  }

  // 在本地数据与凭据就绪后开放界面，忽略上一代启动迟到的 AI 状态。
  async function startApplication() {
    const coldStart = !applicationStarted;
    applicationStarted = true;
    applicationGeneration += 1;
    const generation = applicationGeneration;
    studyDashboard.stop();
    lockApplication(true);
    document.body.dataset.storageState = 'loading';
    platformStatus('正在读取本地数据…');
    try {
      Object.assign(state, await loadState());
      await ShirohaPlatform.credentials.initialize(ensureAiImportStateV99(), state.serviceConfigurations);
      const harnessInitialization = ShirohaPlatform.harness?.initialize({ restored: !coldStart });
      init();
      applicationReady = true;
      lockApplication(false);
      platformStatus('');
      if (harnessInitialization) {
        void harnessInitialization.then(() => {
          if (coldStart && generation === applicationGeneration && applicationReady) {
            return ShirohaPlatform.harness?.ensureReady();
          }

          return undefined;
        }).catch(() => {
          if (generation === applicationGeneration) {
            platformStatus('AI 状态检查未完成，请在 AI 设置中重试。', true);
          }
        });
      }

      if (ShirohaPlatform.credentials.migrateLegacy) {
        // 凭据迁移可单独重试，失败时保留旧值。
        const retryCredentials = async () => {
          try {
            await ShirohaPlatform.credentials.migrateLegacy();
            renderAiSettingsV99();
            renderWebdavPanelV378(true);
            platformStatus('');
          } catch {
            platformStatus('旧凭据迁移未完成，旧值已保留，可独立重试。', true);
            const retry = document.createElement('button');
            retry.textContent = '重试凭据迁移';
            retry.onclick = retryCredentials;
            document.getElementById('platform-status').appendChild(retry);
          }
        };

        await retryCredentials();
      }
    } catch (error) {
      applicationReady = false;
      studyDashboard.stop();
      document.body.dataset.storageState = 'recovery_required';
      retryMutation = startApplication;
      platformStatus(error?.message || '数据加载失败，原数据已保留。', true);
      const button = document.createElement('button');
      button.textContent = '导出原始数据';
      button.onclick = /* 启动发现异常的旧数据时，提供原始副本供用户另行恢复。 */ async () => {
        try {
          await ShirohaPlatform.download('shiroha-recovery.json', new Blob([ShirohaPlatform.storage.recoveryText()], { type: 'application/json' }));
        } catch {
          platformStatus('无法读取原始数据，请检查浏览器存储权限。', true);
        }
      };

      document.getElementById('platform-status').appendChild(button);
      if (error?.code !== 'migration_required') {
        offerNativeRecovery(document.getElementById('platform-status'));
      }

      if (error?.code === 'migration_required' && ShirohaPlatform.storage.migrate) {
        const migrate = document.createElement('button');
        migrate.textContent = '确认迁移旧原型数据';
        migrate.onclick = /* 迁移须经用户确认，成功后重新进入正常加载流程。 */ async () => {
          if (!await ShirohaDialogs.confirm('将旧题库和学习记录迁移到本机数据库，并保留原始数据。凭据会单独迁移，只有保存成功才清理对应旧值；失败仍保留。是否继续？')) {
            return;
          }

          migrate.disabled = true;
          try {
            await ShirohaPlatform.storage.migrate();
            await startApplication();
          } catch (error) {
            platformStatus(error.message, true);
          } finally {
            migrate.disabled = false;
          }
        };

        document.getElementById('platform-status').appendChild(migrate);
      }
    }
  }

  function blockInteractionDuringMutation(event) {
    if (mutationBusy && !event.target.closest?.('#platform-status,#desktop-titlebar,#app-dialog')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  for (const type of ['click', 'change', 'input', 'keydown']) {
    document.addEventListener(type, blockInteractionDuringMutation, true);
  }

  window.addEventListener('beforeunload', (event) => {
    if (mutationBusy || mutationSaveError || (practiceSession.current.submitMode === 'total' && !practiceSession.current.completed && (practiceSession.current.totalLocked || totalPracticeFilledCount() > 0))) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  importPage.bindFileDrop();

  document.addEventListener('keydown', /* 保存快捷键让出文本编辑和输入法组合输入。 */ (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.repeat) {
      return;
    }

    if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) {
      return;
    }

    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!mutationBusy) {
        document.getElementById('save-all-btn')?.click();
      }
    }
  });

  if (globalThis.ShirohaDesktopHost) {
    globalThis.ShirohaDesktopHost.canClose = /* 在宿主关闭前检查未保存的练习、考试与识别任务，按操作状态允许取消退出。 */ async () => {
      if (mutationBusy) {
        platformStatus('正在保存，请完成后再关闭。', true);
        return false;
      }

      if (practiceSession.current.submitMode === 'total' && !practiceSession.current.completed) {
        if (practiceSession.current.totalLocked) {
          platformStatus('本轮答案已锁定，请完成简答题自评和保存后再关闭。');
          return false;
        }

        if (totalPracticeFilledCount() > 0 && !await ShirohaDialogs.confirm('本轮答案尚未提交，关闭将放弃本轮草稿。确定退出？')) {
          return false;
        }
      }

      if (mutationSaveError && !await ShirohaDialogs.confirm('保存尚未成功。确定放弃本次未保存修改并退出？')) {
        return false;
      }

      if (examSession.current.items.length && !examSession.current.submitted && !await ShirohaDialogs.confirm('当前考试尚未交卷，退出后不能续考。确定退出？')) {
        return false;
      }

      if (ocrSession.isRunning()) {
        if (!await ShirohaDialogs.confirm('OCR 尚未结束。取消识别并退出？')) {
          return false;
        }

        ocrSession.cancel();
      }

      if (webdavPanel.isBusy() || aiTasksBusyV99()) {
        if (!await ShirohaDialogs.confirm('网络任务尚未结束。取消并退出？已经发送的上传可能到达远端，下次请先核对列表。')) {
          return false;
        }
      }

      try {
        await ShirohaPlatform.harness?.cancelAll();
        await ShirohaPlatform.network.cancelAll?.();
        await ShirohaPlatform.saves.idle();
        return true;
      } catch (error) {
        platformStatus(error.message || '退出前检查失败，请重试。', true);
        return false;
      }
    };
  }

  // Initialize only after every top-level lexical binding has been created.
  startApplication();
})();

/* SHIROHA_WEB_V29_4_STANDARD_TYPE_NUMBER_IMPORT_FIX */

/* SHIROHA_WEB_V29_5_SECTION_CONTEXT_PARSER_FIX */

/* SHIROHA_WEB_V29_6_DOCX_IMAGE_IMPORT_FIX */

/* SHIROHA_WEB_V29_7_DOCX_IMAGE_EXAM_VERIFIED */

/* SHIROHA_WEB_V29_8_IMPORT_REVIEW_ANALYSIS_AND_LONG_STEM_FIX */

/* SHIROHA_WEB_V29_9_VERIFIED_CUTTING_AND_ANALYSIS_FIX */

/* SHIROHA_WEB_V29_10_RECRUITMENT_SEGMENT_OPTION_FIX */

/* SHIROHA_WEB_V29_11_RECRUITMENT_FULL_VERIFY_FIX */

/* SHIROHA_WEB_V29_12_SELECTED_HITS_COPY_FIX */

/* SHIROHA_WEB_V29_13_COMPACT_OPTION_SEQUENCE_FIX */

/* SHIROHA_WEB_V29_14_LAST_A_OPTION_FALLBACK_FIX */
