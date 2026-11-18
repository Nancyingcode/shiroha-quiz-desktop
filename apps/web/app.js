// 隔离应用状态和共享模块装配，待浏览器或桌面平台准备好后启动页面。
(function () {
  const APP_VERSION = 'V38：单题AI解析与追问版';
  const { zipStoreFiles } = globalThis.ShirohaZip;
  const RICH_CONTENT_VERSION_V57 = 'shiroha-web-rich-v1';
  const BANK_DEFAULT_GROUP_V58 = '未分组';
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
  const PRACTICE_SCOPE_BANK_V8916 = 'bank';
  const PRACTICE_SCOPE_GROUP_V8916 = 'group';
  const state = blankState();
  const practiceSession = globalThis.ShirohaStudySessions.createPractice();
  const examSession = globalThis.ShirohaStudySessions.createExam();
  let exportBankSelectedV23 = new Set();let backupImportModeV23 = 'merge';let importCommitBusyV5911 = false;
  const $ = (s) => document.querySelector(s);

  const $$ = (s) => [...document.querySelectorAll(s)];

  // 将本轮试题连同源题库和原题号固化进训练记录，便于跨库复盘时定位。
  function trainingSessionItems(items) {
    return items.map((item) => {
      const bankId = practiceItemBankIdV8916(item); const q = practiceQuestionV8916(item); const bank = state.banks.find((value) => value.id === bankId);
      const position = bank?.questions.findIndex((value) => value.id === q.id) ?? -1;
      return { bankId, bankName: practiceItemBankNameV8916(item), bankQuestionNumber: position < 0 ? null : position + 1, question: JSON.parse(JSON.stringify(q)) };
    });
  }

  function attachTrainingReview(record, items, metadata) {
    record.review = ShirohaTraining.buildReview(items, record.details || [], metadata);record.reviewSummary = ShirohaTraining.reviewSummary(record.review, record.details || []);
  }

  function ensureDefaultBank() {
    if (!state.banks.length && !state.settings?.suppressDefaultBank) { state.banks.push(defaultBank()); }

    if (!state.activeBankId) { state.activeBankId = state.banks[0]?.id || ''; }
  }

  function blankState() {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, banks: [], activeBankId: '', wrongBook: {}, favorites: {}, records: [], settings: {}, crossPlatformMeta: { favoriteQuestions: {} } };
  }

  function warnDev(message, error) {
    try { console.warn('[Shiroha Quiz]', message, error || ''); } catch { /* 日志不可用时不能阻断题库操作。 */ }
  }

  // 等平台存储确认可读后才装入应用数据，读取失败交给启动恢复流程。
  async function loadState() {
    const result = await ShirohaPlatform.storage.initialize();
    if (result.state !== 'ready') { throw result.error; }

    const snapshot = await ShirohaPlatform.storage.read();
    return snapshot ? migrateState(snapshot, KEY) : blankState();
  }

  // 将历史存储内容迁移到当前快照结构，并补齐旧版本缺失的设置与元数据。
  function migrateState(raw, sourceKey) {
    const base = blankState();
    if (!raw || typeof raw !== 'object') { return base; }

    const migrated = { ...base, ...raw };
    const oldVersion = Number(raw.schemaVersion || 0);
    migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
    if (oldVersion < CURRENT_SCHEMA_VERSION) {
      migrated.settings = { ...(migrated.settings || {}), lastMigratedFromSchema: oldVersion, lastMigratedAt: now() };
    }

    if (sourceKey && sourceKey !== KEY) { migrated.settings = { ...(migrated.settings || {}), migratedFromStorageKey: sourceKey }; }

    return migrated;
  }

  async function clearStoredState() {
    await ShirohaPlatform.harness?.cancelAll();if (ShirohaPlatform.storage.reset) { await ShirohaPlatform.storage.reset(); } else { await ShirohaPlatform.credentials.reset(); }

    await ShirohaPlatform.harness?.initialize({ restored: true });
  }

  async function saveState() {
    return runMutation(async () => {
      await saveSilent();toast(ShirohaPlatform.storage.checkpoint ? '已保存到本机数据库。' : '已保存到浏览器本地。', 'ok');
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
  // 首页的午夜刷新计时器随页面存活；每次统计重绘时替换，避免累积任务。
  let dueReviewTimer = null;
  let dueReviewVisibilityBound = false;

  function beginNativeRender(view) {
    const version = (nativeRenderVersions.get(view) || 0) + 1;nativeRenderVersions.set(view, version);return version;
  }

  // 追踪尚未完成的原生读取供保存事务等待，失效页面可抑制迟到的错误提示。
  async function readNative(action, shouldReport = () => true) {
    const task = Promise.resolve().then(action);nativeReads.add(task);try { await task;return true; } catch (error) {
      if (shouldReport()) { platformStatus(error.message || '读取本地数据失败，请重试。', true); }

      return false;
    } finally { nativeReads.delete(task); }
  }

  async function loadNativeItems(items, shouldReport) {
    if (!ShirohaPlatform.storage.ensureQuestions) { return true; }

    return readNative(() => ShirohaPlatform.storage.ensureQuestions(state, items.map((item) => ({ bankId: practiceItemBankIdV8916(item), questionId: practiceQuestionV8916(item).id }))), shouldReport);
  }

  async function loadNativeBanks(ids, shouldReport) {
    return loadNativeItems(practiceSessionItemsForBanksV8916(state.banks.filter((bank) => ids.includes(bank.id))), shouldReport);
  }

  async function loadNativeAll() {
    if (!ShirohaPlatform.storage.ensureAll) { return true; }

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
  const {
    resetOcrImportState,
    setOcrStatus,
    startPdfOcrImport,
    currentOcrText,
  } = ocrSession;
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
      wrongEntries: getWrongEntries,
      favorites: getFavoriteIdsV27,
      shuffle,
      parseNumbers: parsePracticeNumberRangeV58916,
    },
    progress: { answer: (...args) => getPracticeAnswerStateV26(...args) },
  });
  const {
    closeBankQuestionDetail,
    renderBankSelect,
    renderMergeSelect,
    renderBankInputs,
    renderBankList,
    renderBankToolbarV28,
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
      ensureGroupUi: ensureBankGroupUiV58,
      ensure: ensurePracticeScopeV8916,
      current: practiceScopeV8916,
      groupName: bankGroupNameV58,
      pathLabel: bankPathLabelV58,
      normalizeGroup: normalizeBankGroupNameV58,
      renderGroups: renderBankGroupDatalistV58,
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
    rendering: { all: renderAll, exportSummary: renderExportBankSummaryV23, toast },
    selection: {
      get: () => exportBankSelectedV23,

      set: (value) => {
        exportBankSelectedV23 = value;
      },
    },
    actions: {
      activeBank,
      transaction: runMutation,
      save: saveSilent,
      edit: (...args) => editBankByIdV45(...args),

      duplicate: duplicateBankById,
      exportBank: exportBankById,
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
    setBankName: setImportBankNameFromFile,
    applyTable: applyTableImportResultV49,
    toast,
  });
  const { readImportFile, readDualFile } = importDraft;
  const aiSettings = globalThis.ShirohaAiSettings.create({
    presets: AI_PROVIDER_PRESETS_V99,
    platform: ShirohaPlatform,
    config: ensureAiImportStateV99,
    readKey: readStoredAiKeyV99,
    view: { select: $, escape: esc, copy: copyTextV23, toast },
  });
  const {
    defaultAiConfigV99,
    normalizeAiConfigV99,
    isAiHarnessExecutionV99,
    aiHarnessLabelV99,
    aiHarnessTaskReasonV99,
    aiUnavailableReasonV99,
    aiHarnessPrivacyV99,
    aiExecutionConfigV99,
    aiConfiguredV99,
    aiAvailabilityV99,
    aiExecutionLabelV99,
    aiRequestConfigV99,
    isLocalAiEndpointV99,
    readAiFormV99,
    setAiSettingsStatusV99,
    sanitizeAiDiagnosticDetailV375,
    buildAiDiagnosticV375,
    renderAiDiagnosticV375,
    setAiDiagnosticV375,
    toggleAiDiagnosticV375,
    copyAiDiagnosticV375,
    copyAiOllamaCorsCommandV375,
    updateAiConnectionPillV99,
    renderAiSettingsV99,
  } = aiSettings;
  const { requestAiChatV99, withAiTimeoutV99 } = globalThis.ShirohaAiTransport.create({
    platform: ShirohaPlatform,
    harness: { isHarness: isAiHarnessExecutionV99, taskReason: aiHarnessTaskReasonV99, configured: aiConfiguredV99, unavailableReason: aiUnavailableReasonV99 },
    response: { content: aiResponseContentV99, httpErrorMessage: aiHttpErrorMessage },
  });
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
    question: practiceQuestionV8916, importKey: aiQuestionKeyV991, validate: validateQuestion, maxChars: AI_IMPORT_MAX_CHARS_V99,
  });
  const aiImportSessions = globalThis.ShirohaAiImportSessions.create({
    draft: importDraft,
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

      context: aiRefactorContextV384,
      messages: buildAiMessagesV99,
      parse: parseAiRefactorPayloadV384,
      parseText: parseTextQuestions,
      risk: largeImportRiskMessageV376,
    },
    preview: {
      mode: () => aiImportPanel.mode(),

      collectTargets: (...args) => collectAiPreviewTargetDetailsV992(...args),

      key: aiQuestionKeyV991,
      fingerprint: aiQuestionFingerprintV991,
      payload: aiQuestionPayloadV991,
      issueStatus: importIssueStatus,
      label: (...args) => aiPreviewModeLabelV991(...args),

      analysisMessages: buildAiAnalysisMessagesV991,
      reviewMessages: buildAiReviewMessagesV991,
      resultArray: aiResultArrayV991,
      normalizeReview: normalizeAiReviewResultV991,
      normalizeAnalysis: normalizeAiAnalysisResultV991,
      findIndex: findImportIndexByAiKeyV991,
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
  const reviewAiSessions = globalThis.ShirohaAiQuestionSessions.createReview({
    question: { source: reviewAnalysisSource, fingerprint: aiSingleFingerprintV613, hasImages: aiSingleHasImagesV613 },
    request: {
      config: (...args) => aiSingleConfigV613(...args),

      timeout: withAiTimeoutV99,
      chat: requestAiChatV99,
      analysisMessages: buildAiSingleAnalysisMessagesV613,
    },
    result: { analysis: parseAiSingleAnalysisV613, mergeWarning: mergeAiSingleWarningV381 },
    storage: { load: loadNativeItems, save: saveAiSingleAnalysisV613 },
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
    now,
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
    favorites: { ids: getFavoriteIdsV27, toggle: toggleFavoriteV27, isFavorite: isFavoriteV27 },
    wrong: { get: getWrongEntries, set: setWrongEntries, remove: removeWrong },
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
      transaction: runMutation,
      save: saveSilent,
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
      ensure: ensurePracticeScopeV8916,
      groupName: bankGroupNameV58,
      normalizeGroup: normalizeBankGroupNameV58,
      readGroup: readImportBankGroupV58,
      ensureGroupUi: ensureBankGroupUiV58,
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
    examQuestionV113,
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
      attachReview: attachTrainingReview,
      addWrong,
      markRight,
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
      addWrong,
      markRight,
    },
    review: {
      items: trainingSessionItems,
      attach: attachTrainingReview,
      completion: trainingCompletion,
      open: openTrainingReview,
      page: nativePage,
      analysis: (...args) => renderReviewAnalysis(...args),

      updatePanels: (...args) => updateReviewAnalysisPanels(...args),
    },
    favorites: { isFavorite: isFavoriteV27, toggle: toggleFavoriteV27 },
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
    showAnsweredStateV26,
    showSubjectiveFeedback,
    openQuickPracticeSetup,
    switchPracticeSourceV27,
    resetPractice,
    bindPracticeClockLifecycle,
  } = practicePage;
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
      save: saveAiSettingsV99,
      test: testAiConnectionV99,
      clear: clearAiSettingsV99,
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
      key: aiQuestionKeyV991,
      findIndex: findImportIndexByAiKeyV991,
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

      save: saveAiSingleAnalysisV613,
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
    findPracticeQuestionLocationV120,
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
    editor: { updateBankUi: updateBankEditUiV45, syncAppend: syncImportAppendUiV59, saveDraft: (index) => importDraftPersistence.save(index) },
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
      // 恢复草稿前使旧的 AI、OCR 和文件读取失效，避免迟到结果覆盖恢复内容。
      invalidate: () => {
        cancelAiImportRequestV99(true);cancelAiPreviewRequestV991(true);
        closeAiImportPanelV99();closeAiPreviewPanelV991();resetOcrImportState();
        ['single', 'question', 'answer'].forEach((slot) => importDraft.invalidateRead(slot));

        importDraft.invalidatePreview();importDraft.invalidateBankName();
        ['import-file', 'dual-question-file', 'dual-answer-file'].forEach(/* 清理旧的文件选择和控件显示，恢复后允许再次选择同一个文件。 */ (id) => {
          const input = $(`#${id}`);if (!input) { return; }

          input.value = '';
          const control = input.closest('.file-control-v615');
          const name = control?.querySelector('.file-name-v615');
          if (name) { name.textContent = name.dataset.emptyText || '未选择文件'; }

          control?.classList.remove('has-file-v615');
        });

        const name = $('#import-bank-name');if (name) { name.dataset.autoName = '0'; }
      },

      render: () => {
        renderImportPreview(importDraft.questions);syncAiImportActionV99();
      },
    },
  });
  // 解析导入文本，并从同一次解析中保留预览使用的诊断和来源信息。
  function parseTextQuestions(text, strategy = 'auto') {
    const result = parseTextQuestionsDetailed(text, strategy, (report) => {
      importDraft.report = report;
    });
    importDraft.diagnostics = result.diagnostics;
    return result.questions;
  }

  // 为宽窄布局建立可切换的页码与每页条数控件，两组按钮共用翻页行为。
  function renderNativePageActions({
    controls,
    page,
    pages,
    title,
    entry,
    changePage,
  }) {
    const actions = document.createElement('div');actions.className = 'list-pagination-controls';controls.appendChild(actions);
    // 构造带可访问名称的分页按钮，保留重渲染后定位焦点所需的控件标识。
    const addButton = (group, text, name, value, disabled, control) => {
      const button = document.createElement('button');button.type = 'button';button.textContent = text;button.className = 'list-page-button';
      button.setAttribute('aria-label', name);button.dataset.pageControl = control;button.disabled = disabled;
      if (control === `page:${page}`) { button.setAttribute('aria-current', 'page'); }

      button.onclick = () => changePage(value);

      group.appendChild(button);
    };

    // 容器宽度决定显示哪组页码；窄卡片（含桌面侧栏布局）也保留首末页与键盘入口。
    for (const compact of [false, true]) {
      const group = document.createElement('div');group.className = `list-page-numbers ${compact ? 'is-compact' : 'is-wide'}`;actions.appendChild(group);
      addButton(group, '‹', '上一页', page - 1, page === 0, 'previous');
      for (const n of listPageNumbers(page + 1, pages, compact)) {
        if (n === 'ellipsis') { const gap = document.createElement('span');gap.className = 'list-page-gap';gap.textContent = '…';gap.setAttribute('aria-hidden', 'true');group.appendChild(gap); } else { addButton(group, String(n), `第 ${n} 页`, n - 1, false, `page:${n - 1}`); }
      }

      addButton(group, '›', '下一页', page + 1, page === pages - 1, 'next');
    }

    const select = document.createElement('select');select.className = 'list-page-size';select.setAttribute('aria-label', `${title}每页条数`);select.dataset.pageControl = 'size';
    for (const size of LIST_PAGE_SIZES) { const option = document.createElement('option');option.value = String(size);option.textContent = `${size} 条/页`;select.appendChild(option); }

    select.value = String(entry.size);select.onchange = () => changePage(0, Number(select.value));

    actions.appendChild(select);
  }

  // 为分页目标维护独立的请求页与焦点，换题库后重置页码并仅获取可见题目。
  function nativePage(rows, key, target, render) {
    let entry = nativePages.get(target.id);
    if (!entry) { entry = { key, page: 0, size: LIST_PAGE_SIZES[0] };nativePages.set(target.id, entry); }

    if (entry.key !== key) { entry.key = key;entry.page = 0; }

    const {
      page,
      pages,
      start,
      end,
    } = listPageRange(rows.length, entry.page, entry.size);
    entry.page = page;
    const id = `${target.id}-pager`;let controls = document.getElementById(id);
    if (!controls) {
      controls = document.createElement('nav');controls.id = id;controls.className = 'list-pagination';
      const anchor = target.closest('.table-wrap') || target;anchor.insertAdjacentElement('afterend', controls);
    }

    const focusKey = controls.contains(document.activeElement) ? document.activeElement.dataset.pageControl : null;
    const view = target.closest('.view');
    const title = target.closest('.card')?.querySelector('h2')?.textContent || target.getAttribute('aria-label') || '列表';
    controls.setAttribute('aria-label', `${title}分页`);controls.replaceChildren();
    const status = document.createElement('span');status.className = 'list-pagination-status';status.setAttribute('role', 'status');
    status.textContent = rows.length ? `第 ${page + 1} / ${pages} 页 · ${start + 1}–${end} 项，共 ${rows.length} 项` : '共 0 项';controls.appendChild(status);
    if (!rows.length) { return []; }

    // 页码和每页数量同时写入分页状态，并在重新渲染后同步列表。
    const changePage = async (next, size = entry.size) => {
      entry.page = next;entry.size = size;
      await render();
      const stillCurrent = entry.key === key && entry.page === next && entry.size === size && target.isConnected;
      if (stillCurrent && (!view || view.classList.contains('active'))) { target.scrollIntoView({ block: 'start', behavior: 'instant' }); }
    };

    renderNativePageActions({ controls, page, pages, title, entry, changePage });
    if (focusKey) {
      const candidates = [...controls.querySelectorAll('[data-page-control]')].filter((node) => node.getClientRects().length && !node.disabled);
      const nextFocus = candidates.find((node) => node.dataset.pageControl === focusKey) || candidates.find((node) => node.getAttribute('aria-current') === 'page');
      nextFocus?.focus({ preventScroll: true });
    }

    return rows.slice(start, end);
  }

  function releaseNativeView() {
    if (nativeReads.size || mutationBusy) { return; }

    ShirohaPlatform.storage.releaseView?.(state, [...(practiceSession.current.items || []), ...(examSession.current.items || [])].map((item) => ({ bankId: practiceItemBankIdV8916(item), questionId: practiceQuestionV8916(item).id })));

    nativeOpenRecords.clear();
  }

  // 原生分页视图统一刷新；浏览器仅在已有加载占位时补做题库预览。
  function renderNativeView() {
    if (!ShirohaPlatform.storage.lazy) {
      if ($('#banks')?.classList.contains('active') && $('#bank-preview [data-bank-preview-loading]')) { renderBankPreview(); }

      return;
    }

    renderBankPreview();renderWrongBook();renderFavoritesPageV596();renderRecords();
  }

  function activeBank() {
    return state.banks.find((b) => b.id === state.activeBankId) || state.banks[0] || { questions: [] };
  }

  function normalizePracticeScopeV8916(scope) {
    const raw = scope && typeof scope === 'object' ? scope : {};
    const type = String(raw.type || '').toLowerCase() === PRACTICE_SCOPE_GROUP_V8916 ? PRACTICE_SCOPE_GROUP_V8916 : PRACTICE_SCOPE_BANK_V8916;
    return { type, value: String(raw.value || '').trim() };
  }

  // 校准历史设置里的练习范围，失效分组或题库回退到可用范围。
  function ensurePracticeScopeV8916() {
    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    let scope = normalizePracticeScopeV8916(state.settings.practiceScope);
    if (scope.type === PRACTICE_SCOPE_GROUP_V8916) {
      const group = normalizeBankGroupNameV58(scope.value);
      if (group && (state.banks || []).some((b) => bankGroupNameV58(b) === group)) { scope = { type: PRACTICE_SCOPE_GROUP_V8916, value: group }; } else { scope = { type: PRACTICE_SCOPE_BANK_V8916, value: activeBank().id || '' }; }
    } else {
      const bank = (state.banks || []).find((b) => b.id === scope.value) || activeBank();
      scope = { type: PRACTICE_SCOPE_BANK_V8916, value: (bank && bank.id) || '' };
    }

    state.settings.practiceScope = scope;
    return scope;
  }

  function practiceScopeV8916() {
    return ensurePracticeScopeV8916();
  }

  function practiceScopeBanksV8916(scopeOverride) {
    const scope = scopeOverride ? normalizePracticeScopeV8916(scopeOverride) : practiceScopeV8916();
    if (scope.type === PRACTICE_SCOPE_GROUP_V8916) { const group = normalizeBankGroupNameV58(scope.value);return (state.banks || []).filter((b) => bankGroupNameV58(b) === group); }

    const bank = (state.banks || []).find((b) => b.id === scope.value) || activeBank();return bank && bank.id ? [bank] : [];
  }

  function practiceScopeLabelV8916(scopeOverride) {
    const scope = scopeOverride ? normalizePracticeScopeV8916(scopeOverride) : practiceScopeV8916();
    if (scope.type === PRACTICE_SCOPE_GROUP_V8916) { return normalizeBankGroupNameV58(scope.value) || BANK_DEFAULT_GROUP_V58; }

    return practiceScopeBanksV8916(scope)[0]?.name || '当前题库';
  }

  function practiceScopeSummaryV8916(scopeOverride) {
    const scope = scopeOverride ? normalizePracticeScopeV8916(scopeOverride) : practiceScopeV8916();const banks = practiceScopeBanksV8916(scope);const total = banks.reduce((n, b) => n + (b.questions || []).length, 0);
    return scope.type === PRACTICE_SCOPE_GROUP_V8916 ? `${banks.length} 个题库 · ${total} 题` : `${total} 题`;
  }

  // 只允许已有题库成为练习范围，按调用场景决定是否同步切换当前题库。
  function setPracticeBankScopeV8916(bankId, setActive = true) {
    const bank = (state.banks || []).find((b) => b.id === bankId);if (!bank) { return false; }

    if (setActive && state.activeBankId !== bank.id) { for (const entry of nativePages.values()) { entry.page = 0; } }

    if (setActive) { state.activeBankId = bank.id; }

    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings.practiceScope = { type: PRACTICE_SCOPE_BANK_V8916, value: bank.id };return true;
  }

  function setPracticeGroupScopeV8916(groupName) {
    const group = normalizeBankGroupNameV58(groupName);if (!group || (state.banks || []).every((b) => bankGroupNameV58(b) !== group)) { return false; }

    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings.practiceScope = { type: PRACTICE_SCOPE_GROUP_V8916, value: group };return true;
  }

  // 为跨库练习准备带来源的题目条目，并保证本轮标识不会碰撞。
  function practiceSessionItemsForBanksV8916(banks) {
    const used = new Map();const keys = new Set();const out = [];
    // 历史题号或题库 ID 可能包含分隔符，去重后缀也可能与另一题的原始键相同。
    (banks || []).forEach(/* 按题库和原题顺序展开范围，为各条练习数据保留题库来源。 */ (bank) => (bank.questions || []).forEach(/* 为历史重复标识选择唯一后缀，避免碰撞覆盖本轮答案。 */ (question) => {
      const base = `${bank.id}#${question.id}`;let n = used.get(base) || 0;let key = n ? `${base}#${n}` : base;
      while (keys.has(key)) { n += 1;key = `${base}#${n}`; }

      used.set(base, n + 1);keys.add(key);
      out.push({ sessionKey: key, bankId: bank.id, bankName: bank.name || '', groupName: bankGroupNameV58(bank), question });
    }));

    return out;
  }

  function currentPracticeItemV8916() {
    return (practiceSession.current && practiceSession.current.items && practiceSession.current.items[practiceSession.current.idx]) || null;
  }

  function practiceQuestionV8916(item) {
    return item && item.question && typeof item.question === 'object' ? item.question : item;
  }

  function practiceItemKeyV8916(item) {
    const q = practiceQuestionV8916(item);return (item && item.sessionKey) || `${(item && item.bankId) || activeBank().id}#${(q && q.id) || ''}`;
  }

  function practiceItemBankIdV8916(item) {
    return (item && item.bankId) || activeBank().id;
  }

  function practiceItemBankNameV8916(item) {
    return (item && item.bankName) || state.banks.find((b) => b.id === practiceItemBankIdV8916(item))?.name || activeBank().name || '';
  }

  // 显示来源题库里的原题序号，原题已不可定位时明确显示未知。
  function practiceSourceMeta(item) {
    const bank = state.banks.find((value) => value.id === practiceItemBankIdV8916(item));
    const index = bank ? bank.questions.findIndex((question) => question.id === practiceQuestionV8916(item).id) : -1;
    const number = index < 0 ? '题库题号未知' : `题库第 ${index + 1} 题`;
    return `<span class="pill practice-source-number">${number}</span><span class="practice-source-bank">${esc(practiceItemBankNameV8916(item))}</span>`;
  }

  // 让首页与题库页反映同一个练习范围和题量。
  function renderPracticeScopeUiV8916() {
    const scope = practiceScopeV8916();const label = practiceScopeLabelV8916(scope);const summary = practiceScopeSummaryV8916(scope);
    const home = $('#home-practice-scope-v8916');if (home) { home.innerHTML = `<span>${scope.type === PRACTICE_SCOPE_GROUP_V8916 ? '当前练习范围' : '当前题库'}</span><b>${esc(label)}</b><small>${esc(summary)}</small>`; }

    const bank = $('#bank-practice-scope-v8916');if (bank) { bank.innerHTML = `<div><span>当前题库</span><b>${esc(activeBank().name || '暂无题库')}</b></div><div><span>练习范围</span><b>${esc(label)}</b><small>${esc(summary)}</small></div>`; }

    const practiceEl = $('#practice-scope-summary-v8916');if (practiceEl) { practiceEl.innerHTML = `<span>题目来源</span><b>${esc(label)}</b><small>${esc(summary)}</small>`; }

    const examEl = $('#exam-bank-summary-v8916');if (examEl) { examEl.textContent = `考试范围：${label}（跟随当前练习范围 · ${summary}）`; }
  }

  // 切换页面时复位内容滚动，兼容不提供窗口滚动能力的宿主。
  function resetViewScrollV282() {
    try {
      const main = document.querySelector('.main');
      if (main) { main.scrollTop = 0; }

      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    } catch {
      try { window.scrollTo(0, 0); } catch { /* 部分宿主不支持滚动，导航仍应继续。 */ }
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
    cancelPendingSavedReads(target);
    if (target !== 'favorites') { cancelFavoritePractice(); }

    if (target !== 'practice') { practiceSession.invalidatePending(); }

    if (target !== 'exam') { examSession.invalidatePending(); }

    if (target !== 'banks') { cancelPendingBankEdit();cancelPendingBankPreview(); }
  }

  // 将导航按钮接入页面切换守卫，并同步专注模式及未完成练习提示。
  function bindNav() {
    $$('.nav').forEach(/* 为每个导航按钮保留它自己的目标页面与点击处理。 */ (btn) => btn.onclick = /* 通过离开练习确认后再切页，并使原页面的待处理操作失效。 */ async () => {
      const target = btn.dataset.view;
      const view = target && $(`#${target}`);
      if (!view || view.classList.contains('active')) { return; }

      if (target !== 'practice' && !await canLeaveTotalPractice(target)) { return; }

      cancelPendingViewActions(target);
      leaveTrainingReview();
      if (document.body.classList.contains('practice-focus') && target !== 'practice') { exitPracticeFocus(); }

      if (document.body.classList.contains('exam-focus') && target !== 'exam') { exitExamFocus(); }

      if (aiImportSessions.importRequest.running && target !== 'import') { cancelAiImportRequestV99(true); }

      if (aiImportSessions.previewRequest.running && target !== 'import') { cancelAiPreviewRequestV991(true); }

      closeBankQuestionDetail();
      $$('.nav').forEach((b) => b.classList.toggle('active', b === btn));

      $$('.view').forEach((v) => v.classList.toggle('active', v === view));

      const title = $('#page-title');if (title) { title.textContent = btn.textContent; }

      updateShellLayoutByView(target);releaseNativeView();renderNativeView();
      if (target === 'practice' && practiceSession.current.items.length && !practiceSession.current.completed) { enterPracticeFocus();renderPracticeQuestion(); }

      if (target === 'ai-settings') { renderAiSettingsV99(); }

      if (target === 'import') { syncAiImportActionV99(); }

      resetViewScrollV282();
    });
  }

  /* 文件名回显只负责界面提示；文件读取仍由原有 onchange 绑定处理，因此用
     addEventListener 叠加，避免覆盖 readImportFile / readDualFile。 */
  function bindFileFieldsV615() {
    $$('.file-control-v615').forEach(/* 为尚未绑定的文件控件回显文件名，实际读取仍由导入流程负责。 */ (control) => {
      if (control.dataset.fileBoundV615 === '1') { return; }

      const input = control.querySelector('input[type="file"]');
      const nameEl = control.querySelector('.file-name-v615');
      if (!input || !nameEl) { return; }

      control.dataset.fileBoundV615 = '1';
      const emptyText = nameEl.dataset.emptyText || nameEl.textContent;
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        nameEl.textContent = file ? file.name : emptyText;
        control.classList.toggle('has-file-v615', Boolean(file));
      });
    });
  }

  // 单文件和双文件导入与同一预览区联动，原文编辑时使对应读取失效。
  function bindImportControls() {
    $('#load-sample-btn').onclick = loadSample;$('#import-file').onchange = readImportFile;$('#parse-import-btn').onclick = parseImport;$('#confirm-import-btn').onclick = confirmImport;const findReplaceBtnV51 = $('#find-replace-import-btn');if (findReplaceBtnV51) { findReplaceBtnV51.onclick = openImportFindReplaceV51; }

    const dualConfirmBtn = $('#dual-confirm-import-btn');if (dualConfirmBtn) { dualConfirmBtn.onclick = confirmImport; }

    const importTextAreaV49 = $('#import-text');if (importTextAreaV49 && !importTextAreaV49.dataset.sourceBoundV49) {
      importTextAreaV49.dataset.sourceBoundV49 = '1';importTextAreaV49.addEventListener('input', () => {
        importDraft.invalidateRead('single');if (importTextAreaV49.dataset.tableImportV49 === '1') { importDraft.tableResult = null;delete importTextAreaV49.dataset.tableImportV49; }

        importDraft.sourceMeta = { name: '手动文本', size: new Blob([importTextAreaV49.value || '']).size, type: 'text' };
      });
    }

    const ocrStartBtn = $('#ocr-start-btn');
    if (ocrStartBtn) { ocrStartBtn.onclick = startPdfOcrImport; }

    const ocrUseBtn = $('#ocr-use-text-btn');if (ocrUseBtn) { ocrUseBtn.onclick = applyOcrTextToImport; }

    const ocrCopyBtn = $('#ocr-copy-btn');if (ocrCopyBtn) { ocrCopyBtn.onclick = copyOcrText; }

    const ocrDocxBtn = $('#ocr-download-docx-btn');if (ocrDocxBtn) { ocrDocxBtn.onclick = downloadOcrDocx; }

    $('#clear-import-btn').onclick = () => {
      cancelAiImportRequestV99(true);cancelAiPreviewRequestV991(true);closeAiImportPanelV99();closeAiPreviewPanelV991();resetAiSuggestionsV991();$('#import-text').value = '';if ($('#import-text')) { delete $('#import-text').dataset.tableImportV49; }

      importDraft.clearSingle();resetOcrImportState();renderImportPreview([]);syncAiImportActionV99();
    };

    $('#dual-question-file').onchange = (e) => readDualFile(e, 'question');

    $('#dual-answer-file').onchange = (e) => readDualFile(e, 'answer');

    [['#dual-question-text', 'question'], ['#dual-answer-text', 'answer']].forEach(/* 将双文件文本框与各自的读取槽位关联，用户编辑时使原读取失效。 */ ([selector, slot]) => {
      const field = $(selector);
      if (field && !field.dataset.readBoundV4) {
        field.dataset.readBoundV4 = '1';
        field.addEventListener('input', () => importDraft.invalidateRead(slot));
      }
    });

    $('#parse-dual-import-btn').onclick = parseDualImport;$('#clear-dual-import-btn').onclick = () => {
      invalidateAiImportRequestV99();cancelAiPreviewRequestV991(true);resetAiSuggestionsV991();$('#dual-question-text').value = '';$('#dual-answer-text').value = '';importDraft.clearDual();renderImportPreview([]);
    };

    $('#dual-load-sample-btn').onclick = loadDualSample;$('#revalidate-import-btn').onclick = () => renderImportPreview(importDraft.questions);

    $('#edit-close-btn').onclick = closeEditModal;$('#edit-save-btn').onclick = saveEditQuestion;$('#edit-delete-btn').onclick = deleteEditQuestion;const pf = $('#import-preview-filter');if (pf) {
      pf.onchange = (e) => {
        invalidateAiImportRequestV99();if (importDraft.filter !== e.target.value) { importDraft.invalidatePreview(); }

        importDraft.filter = e.target.value;renderImportPreview(importDraft.questions);
      };
    }

    const bid = $('#batch-delete-import-btn');if (bid) { bid.onclick = batchDeleteImportSelected; }

    const cis = $('#clear-import-selection-btn');if (cis) {
      cis.onclick = () => {
        invalidateAiImportRequestV99();if (importDraft.selected.size) { importDraft.invalidatePreview(); }

        importDraft.selected.clear();renderImportPreview(importDraft.questions);
      };
    }
  }

  // 让错题、收藏和学习记录从各自入口触发复习、刷新或经确认清理。
  function bindLearningRecordActions() {
    $('#clear-wrong-btn').onclick = async () => runMutation(async () => {
      if (await ShirohaDialogs.confirm('确定清空当前题库错题本？')) { state.wrongBook[activeBank().id] = [];await saveSilent();renderAll(); }
    });

    $('#clear-records-btn').onclick = async () => runMutation(async () => {
      if (await ShirohaDialogs.confirm('确定清空全部练习与考试记录？')) { state.records = [];await saveSilent();renderAll(); }
    });

    $('#export-records-btn').onclick = exportRecords;$('#record-mode-filter').onchange = renderRecords;const recordDetailFilterV385 = $('#record-detail-filter-v385');if (recordDetailFilterV385) { recordDetailFilterV385.onchange = renderRecords; }

    $('#record-limit').onchange = renderRecords;$('#record-refresh-btn').onclick = renderRecords;$('#wrong-status-filter').onchange = renderWrongBook;$('#wrong-sort-mode').onchange = renderWrongBook;$('#practice-wrong-btn').onclick = () => {
      cancelPendingViewActions('practice');startWrongPractice();
    };

    const practiceFavBtnV596 = $('#practice-favorites-btn-v596');if (practiceFavBtnV596) {
      practiceFavBtnV596.onclick = () => {
        cancelPendingViewActions('practice');switchPracticeSourceV27('favorite');
      };
    }

    const clearFavBtnV596 = $('#clear-favorites-btn-v596');if (clearFavBtnV596) { clearFavBtnV596.onclick = clearCurrentFavoritesV596; }
  }

  // 在应用初始化时集中绑定界面操作及生命周期事件，保留已有模块的入口。
  function bindEvents() {
    bindFileFieldsV615();
    bindReviewAnalysisEvents();
    bindTrainingReviewEvents();
    bindPracticeClockLifecycle();
    $('#save-import-draft-btn').onclick = () => importDraftPersistence.save();

    $('#restore-import-draft-btn').onclick = importDraftPersistence.restore;
    $('#delete-import-draft-btn').onclick = importDraftPersistence.remove;
    $('#start-due-review').onclick = startDueReview;
    if (!dueReviewVisibilityBound) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && applicationReady) { renderStats(); }
      });

      dueReviewVisibilityBound = true;
    }

    $('#active-bank-select').onchange = async (e) => runMutation(async () => {
      setPracticeBankScopeV8916(e.target.value, true);await saveSilent();renderAll();
    });

    const importNameInput = $('#import-bank-name');if (importNameInput && !importNameInput.dataset.autoNameBound) {
      importNameInput.dataset.autoNameBound = '1';importNameInput.addEventListener('input', () => {
        importDraft.invalidateBankName();importNameInput.dataset.autoName = '0';
      });
    }

    $('#save-all-btn').onclick = saveState;
    bindImportControls();

    $('#dedupe-btn').onclick = dedupeActiveBank;$('#rename-bank-btn').onclick = renameActiveBank;$('#duplicate-bank-btn').onclick = duplicateActiveBank;$('#new-empty-bank-btn').onclick = newEmptyBank;$('#merge-bank-btn').onclick = mergeBankIntoActive;$('#bank-sort-mode').onchange = renderBankList;$('#start-practice-btn').onclick = startPractice;$('#reset-practice-btn').onclick = resetPractice;
    $('#start-exam-btn').onclick = startExam;$('#submit-exam-btn').onclick = () => submitExam(false);

    bindLearningRecordActions();

    const exportJsonBtn = $('#export-json-btn');if (exportJsonBtn) { exportJsonBtn.onclick = exportCurrentBank; }

    const exportAllBtn = $('#export-all-btn');if (exportAllBtn) { exportAllBtn.onclick = exportAll; }

    const importBackupQuickBtnV598 = $('#import-backup-quick-btn-v598');if (importBackupQuickBtnV598) {
      importBackupQuickBtnV598.onclick = () => {
        backupImportModeV23 = $('#settings-backup-mode-v23')?.value || 'overwrite';$('#backup-json-file-v23')?.click();
      };
    }

    $('#reset-data-btn').onclick = resetData;bindLimitControlsV60();bindPracticeStartControlsV58916();bindAiImportEventsV99();
  }

  function cleanImportBankNameFromFile(fileName) {
    return String(fileName || '').replace(/* 去掉最后一个文件扩展名，保留前面可能用于分组或命名的点号。 */ /\.[^.]+$/, '').trim() || '导入题库';
  }

  // 文件名只覆盖空白或上一次自动命名，保留用户手工输入的题库名。
  function setImportBankNameFromFile(fileName) {
    const inp = $('#import-bank-name');
    if (!inp) { return; }

    const next = cleanImportBankNameFromFile(fileName);
    const current = inp.value.trim();
    const lastAuto = inp.dataset.autoNameValue || '';
    const canOverwrite = !current || inp.dataset.autoName === '1' || current === lastAuto;
    if (canOverwrite) {
      inp.value = next;
      inp.dataset.autoName = '1';
      inp.dataset.autoNameValue = next;
    }
  }

  async function saveSilent(operationId) {
    try { await ShirohaPlatform.saves.save(JSON.parse(serializeState()), operationId); } catch (error) { mutationSaveError = error;throw error; }
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
    return aiImportSessions.importRequest.running || aiImportSessions.previewRequest.running || practiceAiSessions.isBusy() || reviewAiSessions.isBusy() || !!ShirohaPlatform.harness?.status().busy || $('#ai-test-connection-v99')?.getAttribute?.('aria-busy') === 'true';
  }

  // AI 任务空闲后才保存执行配置，区分桌面 Harness 和 API 设置。
  async function saveAiSettingsV99() {
    if (aiTasksBusyV99()) { setAiSettingsStatusV99('AI 任务仍在执行或停止中，请等待结束后保存设置。', 'warn');return; }

    if (ShirohaPlatform.harness?.formMode() === 'harness') {
      try { await ShirohaPlatform.harness.saveMode('harness');setAiSettingsStatusV99('Harness 设置已保存；原直接 API 设置已保留。', 'ok');syncAiImportActionV99();updateAiConnectionPillV99('idle'); } catch (error) { setAiSettingsStatusV99(error.message || 'Harness 设置保存失败。', 'warn'); }

      return;
    }

    return runMutation(/* 将 API 设置及凭据写入纳入同一次保存，失败后恢复原设置。 */ async () => {
      const previousConfig = { ...ensureAiImportStateV99() };
      try {
        const config = readAiFormV99();
        state.settings.aiImportV99 = { provider: config.provider, endpoint: config.endpoint, model: config.model, timeoutSeconds: config.timeoutSeconds, rememberKey: config.rememberKey };
        const undoCredential = await ShirohaPlatform.credentials.set('ai', config, config.apiKey, config.rememberKey);
        try { await saveSilent(ShirohaPlatform.credentials.operationId?.(undoCredential)); } catch (error) { state.settings.aiImportV99 = previousConfig;await undoCredential();throw error; }

        await ShirohaPlatform.credentials.finalize?.(undoCredential);
        // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
        if (ShirohaPlatform.harness) { try { await ShirohaPlatform.harness.saveMode('api'); } catch (error) { setAiSettingsStatusV99('API 配置已保存，但执行方式切换失败，原执行方式仍生效：' + (error.message || error), 'warn');return; } }

        aiSettings.setState('idle', buildAiDiagnosticV375(null, config, 'idle'));
        const endpoint = $('#ai-endpoint-v99');if (endpoint) { endpoint.value = config.endpoint; }

        setAiSettingsStatusV99('设置已保存。API Key 与题库状态分离存储，不会写入 Web 完整备份。', 'ok');
        updateAiConnectionPillV99();renderAiDiagnosticV375();syncAiImportActionV99();showNotice('AI 设置', '设置已保存。', 'ok');
      } catch (error) { mutationSaveError = error;setAiSettingsStatusV99(error.message || '保存失败。', 'warn');updateAiConnectionPillV99('error');showNotice('AI 设置', error.message || '保存失败。', 'danger'); }
    });
  }

  // 按执行模式清除相应 AI 设置，运行中的任务仍由各模式的状态约束。
  async function clearAiSettingsV99() {
    if (ShirohaPlatform.harness?.formMode() === 'harness') {
      const execution = ShirohaPlatform.harness.snapshot();
      const adapter = ShirohaPlatform.harness.formAdapter?.() ?? execution.adapter;
      if (adapter !== 'codex') { setAiSettingsStatusV99(`${aiHarnessLabelV99(adapter)} 的账户操作请使用对应面板；其他提供方配置已保留。`, 'warn');return; }

      if (execution.adapter !== adapter) { setAiSettingsStatusV99('提供方选择尚未保存，请等待保存完成后再清除配置。', 'warn');return; }

      if (!await ShirohaDialogs.confirm('确定停止 Harness 任务并清除 Codex 配置和订阅授权？原直接 API 配置将保留。')) { return; }

      try { await ShirohaPlatform.harness.cancelAll();await ShirohaPlatform.harness.clear();setAiSettingsStatusV99('Codex 配置已清除；如需使用直接 API，请明确选择并保存执行方式。');updateAiConnectionPillV99('idle');syncAiImportActionV99(); } catch (error) { setAiSettingsStatusV99(error.message || '清除失败。', 'warn'); }

      return;
    }

    if (aiTasksBusyV99()) { setAiSettingsStatusV99('请等待 AI 任务结束后清除配置。', 'warn');return; }

    return runMutation(/* 经用户确认后清除 API 配置及凭据，并用保存结果更新提示。 */ async () => {
      if (!await ShirohaDialogs.confirm('确定清除 AI 接口配置和已保存的 API Key？')) { return; }

      const undoCredential = await ShirohaPlatform.credentials.set('ai', ensureAiImportStateV99(), '', false);
      state.settings.aiImportV99 = defaultAiConfigV99();
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      try { await saveSilent(ShirohaPlatform.credentials.operationId?.(undoCredential)); } catch (error) { await undoCredential();setAiSettingsStatusV99('清除失败，原配置已保留：' + (error.message || error), 'warn');return; }

      await ShirohaPlatform.credentials.finalize?.(undoCredential);
      aiSettings.reset();renderAiSettingsV99();setAiSettingsStatusV99('AI 配置已清除。');syncAiImportActionV99();showNotice('AI 设置', '配置已清除。', 'ok');
    });
  }

  /* SHIROHA_WEB_V38_4_AI_REFACTOR_STRUCTURED_FIRST_START
   对齐原生端 AI 重构：结构化 questions 优先，严格校验不可用时再退回 clean_text；所有结果仍只进入人工确认预览。 */

  // 从当前导入范围组织 AI 清洗上下文，局部选区不附带无关题库诊断。
  function aiRefactorContextV384(range) {
    if (range?.scope === 'selection') { return { currentQuestions: [], warnings: [] }; }

    const current = (importDraft.questions || []).slice(0, AI_PREVIEW_MAX_ITEMS_V991).map(aiRefactorQuestionSnapshotV384);
    const warnings = (importDraft.warnings || []).slice(0, 40).map((x) => String(x || '').trim()).filter(Boolean);
    return { currentQuestions: current, warnings };
  }

  /* SHIROHA_WEB_V38_4_AI_REFACTOR_STRUCTURED_FIRST_END */

  // 使用当前配置测试 AI 服务可用性，保护按钮状态并提供错误指引。
  async function testAiConnectionV99() {
    const btn = $('#ai-test-connection-v99');let config = null;
    if (ShirohaPlatform.harness?.formMode() === 'harness') {
      try {
        const execution = ShirohaPlatform.harness.snapshot();
        const adapter = ShirohaPlatform.harness.formAdapter?.() ?? execution.adapter;
        const unavailable = aiHarnessTaskReasonV99({ execution: { ...execution, adapter } }, 'connection_test');if (unavailable) { throw new Error(unavailable); }

        if (execution.mode !== 'harness' || execution.adapter !== adapter) { throw new Error('请先保存当前提供方和执行方式，再测试执行。'); }

        if (!aiConfiguredV99({ execution }, 'connection_test')) { throw new Error(execution.reason || '当前 Harness 尚未就绪，请先检查设置。'); }

        if (btn) { btn.disabled = true;btn.setAttribute?.('aria-busy', 'true');btn.textContent = '测试中……'; }

        await ShirohaPlatform.harness.test();setAiSettingsStatusV99(`${aiHarnessLabelV99(adapter)} 测试执行成功，结果已通过校验。`, 'ok');updateAiConnectionPillV99('ok', true);
      } catch (error) { setAiSettingsStatusV99(error.message || 'Harness 测试执行失败。', 'warn');updateAiConnectionPillV99('error'); } finally { if (btn) { btn.removeAttribute?.('aria-busy');btn.disabled = !ShirohaPlatform.harness.snapshot().ready;btn.textContent = '测试连接'; } }

      return;
    }

    try {
      config = readAiFormV99();if (btn) { btn.disabled = true;btn.setAttribute?.('aria-busy', 'true');btn.textContent = '测试中……'; }

      setAiSettingsStatusV99('正在连接接口并调用所选模型……');
      setAiDiagnosticV375(buildAiDiagnosticV375(null, config, 'idle'));
      const messages = [{ role: 'system', content: '只回复一个 JSON 对象。' }, { role: 'user', content: '回复 {"ok":true}' }];
      const result = await withAiTimeoutV99(config.timeoutSeconds, (controller) => requestAiChatV99(config, messages, { controller, maxTokens: 32, testMode: true, task: 'connection_test' }));
      if (!result.payload) { throw new Error('接口没有返回有效结果。'); }

      const diag = buildAiDiagnosticV375(null, config, 'ok');
      updateAiConnectionPillV99('ok', true);setAiDiagnosticV375(diag);setAiSettingsStatusV99(diag.statusMessage, 'ok');showNotice('AI 连接', '连接测试成功。', 'ok');
    } catch (error) {
      const diag = config ? buildAiDiagnosticV375(error, config, 'error') : null;
      updateAiConnectionPillV99('error', !!config);
      if (diag) { setAiDiagnosticV375(diag, true); }

      setAiSettingsStatusV99(diag?.statusMessage || error.message || '连接测试失败。', 'warn');showNotice('AI 连接', diag?.summary || error.message || '连接测试失败。', 'danger');
    } finally { if (btn) { btn.removeAttribute?.('aria-busy');btn.disabled = false;btn.textContent = '测试连接'; } }
  }

  // 无 ID 题目的临时身份仅属于当前页面；弱引用随草稿释放，不写入题库或备份。
  const aiImportAnonymousKeysV991 = new WeakMap();
  let aiImportAnonymousSequenceV991 = 0;
  // 保留已有题号标识，缺少 ID 时为同一草稿对象分配稳定的临时键。
  function aiQuestionKeyV991(q) {
    if (!q || typeof q !== 'object') { return ''; }

    const id = String(q.id ?? '');
    if (id) { return id; }

    let key = aiImportAnonymousKeysV991.get(q);
    if (!key) {
      aiImportAnonymousSequenceV991 += 1;
      key = `import-anonymous-${aiImportAnonymousSequenceV991}`;
      aiImportAnonymousKeysV991.set(q, key);
    }

    return key;
  }

  function aiQuestionFingerprintV991(q) {
    return JSON.stringify(q);
  }

  // 只有唯一键的导入题才可被 AI 建议定位，避免重复题误写。
  function findImportIndexByAiKeyV991(key) {
    if (!key) { return -1; }

    const matches = importDraft.questions.reduce((indexes, question, index) => {
      if (aiQuestionKeyV991(question) === key) { indexes.push(index); }

      return indexes;
    }, []);
    return matches.length === 1 ? matches[0] : -1;
  }

  /* SHIROHA_WEB_ISSUE_99_AI_IMPORT_END */

  function normalizeBankGroupNameV58(value) {
    return String(value ?? '').replace(/* 将空白折叠成单个空格，使导入标签保持单行。 */ /\s+/g, ' ').trim().slice(0, 60);
  }

  function bankGroupNameV58(bank) {
    return normalizeBankGroupNameV58(bank && bank.groupName) || BANK_DEFAULT_GROUP_V58;
  }

  function pickBankGroupNameFromJsonV58(bank) {
    if (!bank || typeof bank !== 'object') { return ''; }

    return normalizeBankGroupNameV58(bank.groupName ?? bank.bankGroup ?? bank.parentName ?? bank.groupTitle ?? '');
  }

  function bankNameKeyV58(groupName, name) {
    return `${normalizeBankGroupNameV58(groupName).toLocaleLowerCase('zh-CN')}::${String(name || '题库').trim().toLocaleLowerCase('zh-CN')}`;
  }

  function bankPathLabelV58(bank) {
    const group = bankGroupNameV58(bank);
    return `${group} / ${bank?.name || '题库'}`;
  }

  function existingBankGroupsV58() {
    const groups = [...new Set((state.banks || []).map((b) => normalizeBankGroupNameV58(b.groupName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return groups;
  }

  function readImportBankGroupV58() {
    return normalizeBankGroupNameV58($('#import-bank-group-v58')?.value || '');
  }

  // 为缺少题库分组样式的旧页面补齐界面规则，多次初始化只插入一次。
  function ensureBankGroupStylesV58() {
    if (typeof document === 'undefined' || document.getElementById('shiroha-bank-group-style-v58')) { return; }

    const style = document.createElement('style');
    style.id = 'shiroha-bank-group-style-v58';
    style.textContent = `
    .bank-group-field-v58{display:flex;flex-direction:column;gap:6px;min-width:180px;flex:1 1 180px;}
    .bank-group-field-v58 input{width:100%;}
    .bank-group-section-v58{margin:14px 0 18px;}
    .bank-group-head-v58{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 2px 8px;}
    .bank-group-head-v58 b{font-size:1rem;}
    .bank-group-head-v58 .muted{font-size:.88rem;}
    .bank-group-list-v58{display:grid;gap:10px;}
    .bank-group-badge-v58{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;background:rgba(79,124,255,.10);color:var(--primary,#4f7cff);font-size:.78rem;font-weight:600;margin-left:8px;}
    .import-target-bank-field-v59{display:none;}
    .import-target-bank-field-v59.is-visible{display:grid;}
  `;
    document.head.appendChild(style);
  }

  // 题库命名和重命名使用相同的一级分组候选项，只在各自控件缺失时插入。
  function appendBankGroupInput(input, groupInputId) {
    if (input && !$(`#${groupInputId}`)) {
      const holder = document.createElement('label');
      holder.className = 'bank-group-field-v58';
      holder.innerHTML = `一级分组<input id="${groupInputId}" list="bank-group-list-v58" placeholder="留空则归入未分组">`;
      const anchor = input.closest('label') || input;
      anchor.insertAdjacentElement('afterend', holder);
    }
  }

  // 将分组控件接到导入题库名称，并让已有分组可被输入框发现。
  function ensureBankGroupUiV58() {
    ensureBankGroupStylesV58();
    appendBankGroupInput($('#import-bank-name'), 'import-bank-group-v58');

    if (!$('#bank-group-list-v58')) {
      const datalist = document.createElement('datalist');
      datalist.id = 'bank-group-list-v58';
      document.body.appendChild(datalist);
    }

    renderBankGroupDatalistV58();
    appendBankGroupInput($('#bank-rename-input'), 'bank-group-rename-input-v58');
    ensureImportAppendUiV59();
  }

  // 当导入区缺少追加控件时装配保存方式和目标题库选择。
  function ensureImportAppendUiV59() {
    const nameInput = $('#import-bank-name');
    if (nameInput && !$('#import-save-mode-v59')) {
      const mode = document.createElement('label');
      mode.className = 'bank-group-field-v58 import-save-mode-field-v59';
      mode.innerHTML = '导入方式<select id="import-save-mode-v59"><option value="new">新建题库</option><option value="append">追加到已有题库</option></select>';
      const anchor = $('#import-bank-group-v58')?.closest('label') || nameInput.closest('label') || nameInput;
      anchor.insertAdjacentElement('afterend', mode);
      const select = mode.querySelector('select');
      if (select) { select.onchange = syncImportAppendUiV59; }
    }

    if (nameInput && !$('#import-target-bank-v59')) {
      const target = document.createElement('label');
      target.id = 'import-target-bank-label-v59';
      target.className = 'bank-group-field-v58 import-target-bank-field-v59';
      target.innerHTML = '追加到<select id="import-target-bank-v59"></select>';
      const anchor = $('#import-save-mode-v59')?.closest('label') || $('#import-bank-group-v58')?.closest('label') || nameInput.closest('label') || nameInput;
      anchor.insertAdjacentElement('afterend', target);
    }

    renderImportTargetBankOptionsV59();
    syncImportAppendUiV59();
  }

  // 重建可追加的目标题库列表，维持仍然有效的选择。
  function renderImportTargetBankOptionsV59() {
    const select = $('#import-target-bank-v59');
    if (!select) { return; }

    const previous = select.value || state.activeBankId || '';
    const banks = Array.isArray(state.banks) ? state.banks : [];
    select.innerHTML = banks.map((b) => `<option value="${esc(b.id)}">${esc(bankPathLabelV58(b))}（${(b.questions || []).length}题）</option>`).join('');

    if (banks.some((b) => b.id === previous)) { select.value = previous; } else { select.value = banks[0]?.id || ''; }

    select.disabled = !banks.length;
  }

  // 根据新增、追加和二次编辑模式同步目标题库控件状态。
  function syncImportAppendUiV59() {
    const mode = $('#import-save-mode-v59');
    const modeLabel = mode?.closest('label');
    const targetLabel = $('#import-target-bank-label-v59');
    const confirmBtn = $('#confirm-import-btn');
    const dualConfirm = $('#dual-confirm-import-btn');
    if (bankEditor.current()) {
      if (modeLabel) { modeLabel.style.display = 'none'; }

      if (targetLabel) { targetLabel.style.display = 'none';targetLabel.classList.remove('is-visible'); }

      return;
    }

    if (modeLabel) { modeLabel.style.display = ''; }

    const isAppend = mode?.value === 'append';
    if (targetLabel) {
      targetLabel.classList.toggle('is-visible', isAppend);
      targetLabel.style.display = isAppend ? 'grid' : 'none';
    }

    if (confirmBtn) { confirmBtn.textContent = isAppend ? '确认追加' : '确认导入'; }

    if (dualConfirm) { dualConfirm.textContent = isAppend ? '确认追加' : '确认导入'; }
  }

  function readImportSaveModeV59() {
    return $('#import-save-mode-v59')?.value === 'append' ? 'append' : 'new';
  }

  function renderBankGroupDatalistV58() {
    const list = $('#bank-group-list-v58');
    if (!list) { return; }

    list.innerHTML = existingBankGroupsV58().map((g) => `<option value="${esc(g)}"></option>`).join('');
  }

  function localDateKeyV36(value) {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) { return ''; }

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 练习统计按本地日期归档，考试记录不计入首页的今日练习。
  function todayPracticeStats(current) {
    const today = localDateKeyV36(current);
    const practiceRecords = (state.records || []).filter((r) => r && r.mode === '练习');
    const todayPractice = practiceRecords.filter((r) => localDateKeyV36(r.date) === today);
    const todayAnswered = todayPractice.reduce((n, r) => n + Number(r.answered || 0), 0);
    const todayCorrect = todayPractice.reduce((n, r) => n + Number(r.correct || 0), 0);
    return { todayAnswered, todayCorrect, practiceRecords };
  }

  // 本地零点会改变今日待复习范围，始终只保留下一次刷新任务。
  function scheduleDueReviewRefresh(current) {
    const nextDay = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    if (dueReviewTimer !== null) { clearTimeout(dueReviewTimer); }

    dueReviewTimer = setTimeout(renderStats, Math.max(1, nextDay.getTime() - current.getTime()));
  }

  // 按当前练习范围和本地日期刷新首页题量、错题及训练摘要。
  function renderStats() {
    const current = new Date();
    const scopeBanks = practiceScopeBanksV8916();
    const totalQuestions = scopeBanks.reduce((n, b) => n + (b.questions || []).length, 0);
    const activeWrongEntries = scopeBanks.flatMap((b) => getWrongEntries(b.id).filter((e) => e.status !== '已掌握'));
    $('#stat-total').textContent = totalQuestions;
    $('#stat-wrong').textContent = activeWrongEntries.length;
    $('#stat-records').textContent = state.records.length;
    const { todayAnswered, todayCorrect, practiceRecords } = todayPracticeStats(current);
    const setText = (id, val) => {
      const el = $(id);if (el) { el.textContent = val; }
    };

    setText('#stat-today-count', todayAnswered);
    setText('#stat-today-rate', todayAnswered ? `${Math.round(todayCorrect / todayAnswered * 100)}%` : '—');
    const dueCount = dueReviewItems(undefined, current).length;
    setText('#stat-review-due', dueCount);
    const dueButton = $('#start-due-review');
    if (dueButton) {
      dueButton.disabled = dueCount === 0;
      dueButton.setAttribute('aria-label', `待复习错题 ${dueCount} 道，开始复习`);
    }

    setText('#stat-total-practice', practiceRecords.length);
    scheduleDueReviewRefresh(current);
  }

  // 从首页进入今日错题练习，并在确认期间检测页面或轮次是否已变更。
  async function startDueReview() {
    if (!applicationReady || mutationBusy || !$('#dashboard')?.classList.contains('active')) { return; }

    if (!dueReviewItems().length) { renderStats();toast('当前范围暂无待复习错题。', 'warn');return; }

    const previous = practiceSession.current;
    if (previous.items?.length && !previous.completed) {
      const accepted = await ShirohaDialogs.confirm('当前练习尚未保存为记录，开始今日错题复习会放弃本轮进度。是否继续？');
      if (!accepted || practiceSession.current !== previous || !$('#dashboard')?.classList.contains('active') || mutationBusy) { return; }
    }

    await switchViewV45('practice', false);
    if (!applicationReady || mutationBusy || !$('#practice')?.classList.contains('active')) { return; }

    $('#practice-source').value = 'due';
    $('#practice-type').value = 'all';
    $('#practice-order').value = 'sequence';
    $('#practice-submit-mode').value = 'single';
    $('#practice-limit').value = 'all';
    $('#practice-start-mode-v58916').value = PRACTICE_START_FROM_V58916;
    syncPracticeStartUiV58916(false);
    await startPractice();
    if (practiceSession.current !== previous && practiceSession.current.items?.length) {
      $('#practice-card input:not([disabled]), #practice-card textarea:not([disabled]), #p-submit')?.focus();
    } else if (practiceSession.current === previous && previous.items?.length && !previous.completed && $('#practice')?.classList.contains('active')) {
      enterPracticeFocus();
      renderPracticeQuestion();
    }
  }

  function bankQuestionDeletionBlocked(bankId, ids) {
    const contains = (items) => (items || []).some((item) => practiceItemBankIdV8916(item) === bankId && ids.has(practiceQuestionV8916(item).id));

    return (!practiceSession.current.completed && contains(practiceSession.current.items)) || (!examSession.current.submitted && contains(examSession.current.items));
  }

  async function confirmBankQuestionDeletion(bank, ids) {
    if (bankQuestionDeletionBlocked(bank.id, ids)) { toast('这些试题正在练习或考试中，请先结束相关会话后再删除。', 'warn');return false; }

    return ShirohaDialogs.confirm(`确定从“${bank.name}”删除 ${ids.size} 道试题？对应错题和收藏会一并移除，历史成绩保留。删除后不能直接撤销。`);
  }

  // 删除试题后清理它对应的本库错题及收藏引用，避免留下失效入口。
  function removeBankQuestionReferences(bankId, ids) {
    if (Array.isArray(state.wrongBook[bankId])) { state.wrongBook[bankId] = state.wrongBook[bankId].filter((entry) => !ids.has(typeof entry === 'string' ? entry : entry.id)); }

    if (Array.isArray(state.favorites?.[bankId])) { state.favorites[bankId] = state.favorites[bankId].filter((id) => !ids.has(id)); }

    const metadata = state.crossPlatformMeta?.favoriteQuestions?.[bankId];
    if (metadata) { ids.forEach((id) => delete metadata[id]); }
  }

  // 仅在可保存时发起删除，并将题目和关联引用变更放在同一事务里。
  async function deleteBankQuestions(bankId, questionIds) {
    if (mutationBusy || !applicationReady) { return false; }

    if (!await loadNativeBanks([bankId])) { return false; }

    return runMutation(/* 保存前重新定位目标库并确认有效的删除范围，随后保存和刷新视图。 */ async () => {
      const bank = state.banks.find((b) => b.id === bankId);if (!bank) { return; }

      const requested = new Set(questionIds); const ids = new Set(bank.questions.filter((q) => requested.has(q.id)).map((q) => q.id));
      if (!ids.size) { toast('请先选择要删除的试题。', 'warn');return; }

      if (!await confirmBankQuestionDeletion(bank, ids)) { return; }

      bank.questions = bank.questions.filter((q) => !ids.has(q.id));

      bank.updatedAt = now();
      removeBankQuestionReferences(bankId, ids);
      await saveSilent();
      resetBankQuestionSelection();
      renderAll();toast(`已删除 ${ids.size} 道试题。`, 'ok');
    });
  }

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

  // 将 Web 题型对应到跨端备份使用的原生题型枚举，保留主观题回退。
  function toNativeQuestionType(type) {
    const value = normalizeWebQuestionType(type);
    if (value === 'multiple') { return 'MULTIPLE'; }

    if (value === 'judge') { return 'JUDGE'; }

    if (value === 'blank') { return 'BLANK'; }

    if (value === 'short') { return 'SHORT'; }

    return 'SINGLE';
  }

  // 构造跨端题目副本，将图片与题干、富文本的导出形式统一。
  function serializeQuestionForCrossExportV53(q) {
    const out = JSON.parse(JSON.stringify(q || {}));
    const media = exportQuestionImagesForCrossExportV83(out);
    out.type = toNativeQuestionType(out.type || out.questionType || out.kind);
    out.question = media.question;
    // 显式空数组属于原有跨端数据；缺失字段和无效媒体继续按原规则处理。
    if (media.images.length) { out.images = media.images; } else if (!Array.isArray(out.images) || out.images.length) { delete out.images; }

    const rich = buildQuestionRichContentV57(out);
    if (rich) { out.richContent = rich; } else { delete out.richContent; }

    return out;
  }

  // 序列化题库副本和组名，让跨端导出无需修改当前工作题库。
  function serializeBankForCrossExportV53(bank) {
    const out = JSON.parse(JSON.stringify(bank || {}));
    out.groupName = normalizeBankGroupNameV58(out.groupName);
    out.questions = Array.isArray(out.questions) ? out.questions.map(serializeQuestionForCrossExportV53) : [];
    return out;
  }

  function stripQuestionImages(s) {
    return String(s || '').replace(/* 用可读占位代替内嵌 Markdown 图片，避免预览摘要包含二进制内容。 */ /!\[[^\]]*\]\(data:image\/[^)]+\)/g, '[图片]');
  }

  function short(s, n) {
    const text = stripQuestionImages(String(s || ''));return text.length > n ? `${text.slice(0, n)}…` : text;
  }

  function esc(s) {
    return String(s ?? '').replace(/* 转义会被浏览器解释为 HTML 标记或属性边界的字符。 */ /[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function toast(msg, type = 'warn', title = '提示') {
    const n = $('#import-summary');
    if (n) { n.textContent = msg;n.className = `notice ${type}`; }

    showNotice(title, msg, type);
  }

  // 复用全局通知容器，并在新提示到来时更新显示内容及状态。
  function showNotice(title, msg, type = 'ok') {
    let box = $('#app-toast');
    if (!box) { box = document.createElement('div');box.id = 'app-toast';box.className = 'app-toast';document.body.appendChild(box); }

    const item = document.createElement('div');
    item.className = `toast-item ${['ok', 'danger'].includes(type) ? type : 'warn'}`;
    item.innerHTML = `<div><b>${esc(title || '提示')}</b><p>${esc(msg || '')}</p></div><button type="button" aria-label="关闭">×</button>`;
    item.querySelector('button').onclick = () => item.remove();

    box.appendChild(item);
    setTimeout(() => {
      item.classList.add('hide');setTimeout(() => item.remove(), 260);
    }, type === 'danger' ? 6500 : 4200);
  }

  function summarizeImportResult(arr, warnings = []) {
    const stats = countTypes(arr || []);
    return `识别到 ${(arr || []).length} 道题：单选${stats.single || 0}、多选${(stats.multiple || 0) + (stats.multi || 0)}、判断${stats.judge || 0}、填空${stats.blank || 0}、简答${stats.short || 0}。${warnings && warnings.length ? `发现 ${warnings.length} 条需要确认的问题。` : '未发现明显异常。'}`;
  }

  // 以当前数量级格式化导入体积，便于界面提示用户判断拆分规模。
  function formatBytesV376(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n >= 1024 * 1024) { return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2)} MB`; }

    if (n >= 1024) { return `${(n / 1024).toFixed(1)} KB`; }

    return `${n} B`;
  }

  function estimateImportPayloadSizeV376(arr) {
    try { return new Blob([JSON.stringify(arr || [])]).size; } catch { return 0; }
  }

  // 汇总题量、来源文件和序列化负载的风险，给出适用于当前导入的提示。
  function largeImportRiskMessageV376(arr = importDraft.questions) {
    const count = (arr || []).length;const sourceSize = Number(importDraft.sourceMeta?.size || 0);const payloadSize = estimateImportPayloadSizeV376(arr);
    const reasons = [];
    if (sourceSize >= 5 * 1024 * 1024) { reasons.push(`源文件约 ${formatBytesV376(sourceSize)}`); }

    if (count >= 3000) { reasons.push(`识别题数 ${count.toLocaleString('zh-CN')} 道`); }

    if (payloadSize >= 4 * 1024 * 1024) { reasons.push(`预估题目数据约 ${formatBytesV376(payloadSize)}`); }

    if (!reasons.length) { return ''; }

    return `大文件提醒：${reasons.join('，')}。浏览器本地保存空间有限，确认导入时可能失败；建议先分批导入、清理旧题库/记录，或导入前先导出完整备份。`;
  }

  function summarizeImportResultV376(arr, warnings = []) {
    const base = summarizeImportResult(arr, warnings);const risk = largeImportRiskMessageV376(arr);
    return risk ? `${base} ${risk}` : base;
  }

  // 兼容用户粘贴的斜杠写法，从尾部识别模式与修饰符。
  function parseSlashRegexV51(raw) {
    const text = String(raw || '');
    if (text.length < 2 || text[0] !== '/') { return null; }

    let escaped = false;
    for (let i = text.length - 1;i > 0;i -= 1) {
      const ch = text[i];
      if (ch === '/' && !escaped) { return { pattern: text.slice(1, i), flags: text.slice(i + 1) }; }

      escaped = ch === '\\' && !escaped;
      if (ch !== '\\') { escaped = false; }
    }

    return null;
  }

  // 按文本或正则查找模式构造匹配器，让全局匹配与大小写遵循面板选项。
  function buildFindRegExpV51(pattern, { useRegex = true, caseSensitive = true, global = true } = {}) {
    const searchPattern = String(pattern || '');
    if (!searchPattern) { throw new Error('请先输入查找内容'); }

    let source = searchPattern;
    let flags = global ? 'g' : '';
    if (useRegex) {
      const parsed = parseSlashRegexV51(searchPattern.trim());
      if (parsed) {
        source = parsed.pattern;
        flags = parsed.flags.replace(/* 只允许当前查找面板支持的 JavaScript 正则修饰符。 */ /[^gimsuy]/g, '');
        if (global && !flags.includes('g')) { flags += 'g'; }

        if (!caseSensitive && !flags.includes('i')) { flags += 'i'; }

        if (caseSensitive) { flags = flags.replace(/* 启用区分大小写时移除不区分大小写的修饰符。 */ /i/g, ''); }
      } else {
        if (!caseSensitive) { flags += 'i'; }
      }
    } else {
      source = escapeRegExpV51(searchPattern);
      if (!caseSensitive) { flags += 'i'; }
    }

    const re = /* 使用面板派生模式和去重的修饰符创建文本查找匹配器。 */ new RegExp(source, [...new Set(flags.split(''))].join(''));
    if (''.match(re)) { throw new Error('查找规则不能匹配空字符串'); }

    return re;
  }

  // 修改原始文本后标记草稿变动，避免后续读取沿用旧解析结果。
  function markImportTextEditedV51(textarea) {
    if (!textarea) { return; }

    if (textarea.dataset.tableImportV49 === '1') { delete textarea.dataset.tableImportV49; }

    importDraft.tableResult = null;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // 按需建立导入查找替换面板并绑定原文操作，保留已有控件实例。
  function ensureImportFindReplacePanelV51() {
    let panel = $('#import-find-replace-panel-v51');
    if (panel) { return panel; }

    panel = document.createElement('div');
    panel.id = 'import-find-replace-panel-v51';
    panel.className = 'import-find-replace-panel-v51 hidden';
    panel.innerHTML = `
    <div class="import-find-replace-card-v51" role="dialog" aria-modal="false" aria-label="查找替换">
      <div class="import-find-replace-head-v51">
        <strong>查找替换</strong>
        <button type="button" class="ghost import-find-close-v51" aria-label="关闭">×</button>
      </div>
      <div class="import-find-replace-grid-v51">
        <label>查找内容<input id="import-find-pattern-v51" placeholder="支持正则，例如：答案[：:]\\s*([A-G])" /></label>
        <label>替换为<input id="import-replace-value-v51" placeholder="留空则删除匹配内容，可用 $1" /></label>
      </div>
      <div class="import-find-replace-options-v51">
        <label><input id="import-find-regex-v51" type="checkbox" checked /> 正则</label>
        <label><input id="import-find-case-v51" type="checkbox" checked /> 区分大小写</label>
      </div>
      <div class="import-find-replace-actions-v51">
        <button type="button" class="ghost" id="import-find-next-v51">查找下一个</button>
        <button type="button" class="ghost" id="import-replace-current-v51">替换当前</button>
        <button type="button" class="primary" id="import-replace-all-v51">全部替换</button>
      </div>
      <p class="muted import-find-replace-tip-v51">替换内容留空时等同于删除；正则替换支持 $1、$2 等分组引用。</p>
      <div class="notice import-find-status-v51" id="import-find-status-v51">请输入查找内容。</div>
    </div>`;
    document.body.appendChild(panel);
    panel.querySelector('.import-find-close-v51').onclick = closeImportFindReplaceV51;
    panel.addEventListener('click', (e) => {
      if (e.target === panel) { closeImportFindReplaceV51(); }
    });

    $('#import-find-next-v51').onclick = findNextImportTextV51;
    $('#import-replace-current-v51').onclick = replaceCurrentImportTextV51;
    $('#import-replace-all-v51').onclick = replaceAllImportTextV51;
    const pattern = panel.querySelector('#import-find-pattern-v51');
    if (pattern) {
      pattern.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault();findNextImportTextV51(); }
      });
    }

    return panel;
  }

  // 打开查找替换面板并从原文选区准备查找内容和键盘焦点。
  function openImportFindReplaceV51() {
    const panel = ensureImportFindReplacePanelV51();
    panel.classList.remove('hidden');
    const text = $('#import-text');
    const pattern = $('#import-find-pattern-v51');
    if (text && text.selectionStart !== text.selectionEnd && !pattern.value) { pattern.value = text.value.slice(text.selectionStart, text.selectionEnd); }

    setTimeout(() => {
      (pattern || $('#import-replace-value-v51'))?.focus();
    }, 0);
  }

  function closeImportFindReplaceV51() {
    const panel = $('#import-find-replace-panel-v51');
    if (panel) { panel.classList.add('hidden'); }
  }

  // 将查找结果或模式错误反馈到面板状态区域。
  function setFindStatusV51(msg, type = 'warn') {
    const el = $('#import-find-status-v51');
    if (!el) { return; }

    el.textContent = msg;
    el.className = `notice import-find-status-v51 ${['ok', 'danger'].includes(type) ? type : 'warn'}`;
  }

  // 在每次操作时读取面板当前的查找词、替换词及匹配选项。
  function getFindConfigV51() {
    return {
      pattern: $('#import-find-pattern-v51')?.value || '',
      replacement: $('#import-replace-value-v51')?.value || '',
      useRegex: !!$('#import-find-regex-v51')?.checked,
      caseSensitive: !!$('#import-find-case-v51')?.checked,
    };
  }

  // 从原文当前选区后查找，末尾无匹配时允许回到开头。
  function findNextImportTextV51() {
    const textEl = $('#import-text');
    if (!textEl) { setFindStatusV51('没有找到原始文本框。', 'danger');return false; }

    try {
      const cfg = getFindConfigV51();
      const re = buildFindRegExpV51(cfg.pattern, { useRegex: cfg.useRegex, caseSensitive: cfg.caseSensitive, global: true });
      const text = textEl.value || '';
      const start = textEl.selectionEnd || 0;
      re.lastIndex = start;
      let match = re.exec(text);
      let wrapped = false;
      if (!match && start > 0) { re.lastIndex = 0;match = re.exec(text);wrapped = true; }

      if (!match) { setFindStatusV51('没有找到匹配内容。', 'warn');return false; }

      textEl.focus();
      textEl.setSelectionRange(match.index, match.index + match[0].length);
      setFindStatusV51(`${wrapped ? '已从头查找，' : ''}找到 1 处：第 ${match.index + 1} 个字符。`, 'ok');
      return true;
    } catch (err) { setFindStatusV51(err.message || String(err), 'danger');return false; }
  }

  // 优先替换当前匹配选区，否则先定位下一处命中再写回原文。
  function replaceCurrentImportTextV51() {
    const textEl = $('#import-text');
    if (!textEl) { setFindStatusV51('没有找到原始文本框。', 'danger');return; }

    try {
      const cfg = getFindConfigV51();
      const re = buildFindRegExpV51(cfg.pattern, { useRegex: cfg.useRegex, caseSensitive: cfg.caseSensitive, global: false });
      let start = textEl.selectionStart || 0; let end = textEl.selectionEnd || 0;
      if (start === end || !re.test(textEl.value.slice(start, end))) {
        if (!findNextImportTextV51()) { return; }

        start = textEl.selectionStart || 0;end = textEl.selectionEnd || 0;
      }

      const selected = textEl.value.slice(start, end);
      re.lastIndex = 0;
      const next = selected.replace(re, cfg.replacement);
      textEl.setRangeText(next, start, end, 'select');
      markImportTextEditedV51(textEl);
      setFindStatusV51(next ? '已替换当前匹配。' : '已删除当前匹配。', 'ok');
    } catch (err) { setFindStatusV51(err.message || String(err), 'danger'); }
  }

  // 全量替换前统计命中数，只在确有匹配时修改原文并更新草稿。
  function replaceAllImportTextV51() {
    const textEl = $('#import-text');
    if (!textEl) { setFindStatusV51('没有找到原始文本框。', 'danger');return; }

    try {
      const cfg = getFindConfigV51();
      const re = buildFindRegExpV51(cfg.pattern, { useRegex: cfg.useRegex, caseSensitive: cfg.caseSensitive, global: true });
      const text = textEl.value || '';
      let count = 0;
      text.replace(re, () => {
        count += 1;return '';
      });

      if (!count) { setFindStatusV51('没有找到匹配内容。', 'warn');return; }

      textEl.value = text.replace(re, cfg.replacement);
      markImportTextEditedV51(textEl);
      setFindStatusV51(cfg.replacement ? `已替换 ${count} 处。` : `已删除 ${count} 处。`, 'ok');
    } catch (err) { setFindStatusV51(err.message || String(err), 'danger'); }
  }

  // 加载示例前取消旧文件读取与自动命名，避免异步结果覆盖示例。
  function loadSample() {
    importDraft.invalidateRead('single');
    importDraft.invalidateBankName();
    $('#import-bank-name').value = 'C1导入示例题库';$('#import-text').value = `1. 机动车驾驶人初次申领驾驶证后的实习期是多长时间？
A. 6个月
B. 12个月
C. 16个月
D. 18个月
答案：B
解析：初次取得汽车类准驾车型后的实习期为12个月。

2. 初次申领的机动车驾驶证有效期为6年。[判断题]
A、正确(正确答案)
B、错误

3. 雨天安全驾驶应注意哪些事项？ [多选题]
A、降低车速(正确答案)
B、加大跟车距离(正确答案)
C、避免急刹急打方向(正确答案)
D、高速通过积水路段`;
  }

  async function readPlainTextFileV49(file) {
    return ShirohaPlatform.files.readText(file);
  }

  // 将表格解析结果应用到导入草稿，并使已有 AI 任务与预览失效。
  function applyTableImportResultV49(result, fileName) {
    invalidateAiImportRequestV99();
    cancelAiPreviewRequestV991(true);
    resetAiSuggestionsV991();
    importDraft.tableResult = result;
    importDraft.questions = (result.questions || []).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);

    importDraft.warnings = [];
    importDraft.report = result.report || '解析策略：Excel/CSV 表格题库解析。';
    importDraft.diagnostics = { mode: 'Excel/CSV 表格题库解析', strategy: '表格题库解析', profile: { tableImport: true }, candidates: [{ name: '表格题库解析', questions: importDraft.questions.length, score: importDraft.questions.length * 12, warnings: collectImportWarnings(importDraft.questions) }], expected: { total: importDraft.questions.length, types: {} }, stats: countTypes(importDraft.questions), warnings: result.warnings || [] };
    importDraft.selected.clear();
    importDraft.filter = 'priority';
    const textEl = $('#import-text');
    if (textEl) {
      textEl.dataset.tableImportV49 = '1';
      textEl.value = tableImportPreviewTextV49(result, fileName);
    }

    renderImportPreview(importDraft.questions);
    $('#confirm-import-btn').disabled = !importDraft.questions.length;
    const warnings = collectSoftRiskWarnings(importDraft.questions, importDraft.diagnostics.profile || {});
    if (importDraft.questions.length) { const risk = largeImportRiskMessageV376(importDraft.questions);showNotice('表格识别完成', summarizeImportResultV376(importDraft.questions, warnings), (warnings.length || risk) ? 'warn' : 'ok'); } else { showNotice('表格识别失败', '没有从表格中识别到有效题目，请检查表头是否包含题干、答案、选项等字段。', 'danger'); }
  }

  // 把当前 OCR 输出交给文本导入区，缺少识别内容时保留原文。
  function applyOcrTextToImport() {
    const text = currentOcrText();
    if (!text) { setOcrStatus('没有可填入的 OCR 文本。', 'warn');return; }

    importDraft.invalidateRead('single');
    invalidateAiImportRequestV99();
    const textEl = $('#import-text');
    if (textEl) { textEl.value = text;delete textEl.dataset.tableImportV49; }

    importDraft.tableResult = null;
    setOcrStatus('已填入导入文本。请检查内容后点击“开始识别”。', 'ok');
  }

  async function copyOcrText() {
    const text = currentOcrText();
    if (!text) { setOcrStatus('没有可复制的 OCR 文本。', 'warn');return; }

    await copyTextV23(text, '已复制 OCR 文本。');
  }

  // 将当前 OCR 文本封装成可下载的离线 DOCX，错误交给 OCR 界面。
  async function downloadOcrDocx() {
    try {
      const text = currentOcrText();
      if (!text) { setOcrStatus('没有可下载的 OCR 文本。', 'warn');return; }

      const name = `${cleanImportBankNameFromFile(ocrSession.getFile()?.name || 'OCR识别结果')}_OCR.docx`;
      const blob = createOcrDocxBlob(text, ocrSession.getFile()?.name || 'OCR识别结果');
      await downloadBlob(name, blob);
      setOcrStatus('已生成 DOCX 下载文件。请打开后人工核对 OCR 结果。', 'ok');
    // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
    } catch (error) { platformStatus('导出失败：' + error.message, true);return false; }
  }

  // 自动导入先辨别 JSON 外形，解析失败时交由原有文本识别路径。
  function tryParseAutoJsonImportV58922(text) {
    const source = String(text || '').trim();
    if (!source || !['[', '{'].includes(source[0])) { return null; }

    try {
      const data = JSON.parse(source);
      return data && typeof data === 'object' ? data : null;
    } catch { return null; }
  }

  // 按导入模式解析当前原文；来源更换后的旧读取和 AI 建议不能回写结果。
  async function parseImport() {
    invalidateAiImportRequestV99();
    cancelAiPreviewRequestV991(true);
    resetAiSuggestionsV991();
    closeAiPreviewPanelV991();
    const textEl = $('#import-text');
    const text = textEl.value.trim();
    const strategy = $('#import-strategy')?.value || 'auto';
    if (importDraft.tableResult && textEl?.dataset.tableImportV49 === '1') {
      importDraft.invalidateRead('single');
      applyTableImportResultV49(importDraft.tableResult, $('#import-bank-name')?.value || '表格题库');
      return;
    }

    if (!text) { toast('请先粘贴或上传题库文本。', 'warn', '导入未开始');return; }

    importDraft.invalidateRead('single');
    try {
      importDraft.warnings = [];importDraft.report = '';importDraft.diagnostics = null;
      const explicitJson = $('#import-mode').value === 'json';
      const autoJson = explicitJson ? null : tryParseAutoJsonImportV58922(text);
      if (explicitJson || autoJson !== null) {
        const data = explicitJson ? JSON.parse(text) : autoJson;
        if (Array.isArray(data.banks)) {
          const normalized = normalizeBackupPayloadV23(data, importDraft.sourceMeta.name || '导入备份.json');
          if (!normalized.banks.length) { showNotice('识别失败', '备份中没有可导入的题库。', 'danger');return; }

          const total = normalized.banks.reduce((n, bank) => n + bank.questions.length, 0);
          const accepted = await ShirohaDialogs.confirm(`识别到备份：${normalized.banks.length} 个题库，${total} 道题，${normalized.records.length} 条学习记录。将按原分组合并导入题库、错题、收藏和学习记录，保留当前数据；同名题库会自动重命名。确定导入？`);
          if (!accepted) { return; }

          await runMutation(async () => {
            await applyBackupImportV23(normalized, 'merge', countUnresolvedBackupImagesV24(data));
            importDraft.questions = [];importDraft.selected.clear();renderImportPreview([]);
            showNotice('备份导入完成', `已合并导入 ${normalized.banks.length} 个题库、${total} 道题及对应的错题、收藏和学习记录。`, 'ok');
          });

          return;
        }

        const arr = Array.isArray(data) ? data : (data.questions || []);
        importDraft.questions = arr.map(normalizeQuestion).filter((q) => q.question);

        importDraft.report = '解析策略：JSON结构化导入。';importDraft.diagnostics = { mode: 'JSON结构化导入', strategy: 'JSON结构化导入', profile: {}, candidates: [{ name: 'JSON结构化导入', questions: importDraft.questions.length, score: importDraft.questions.length * 10, warnings: collectImportWarnings(importDraft.questions) }], expected: { total: 0, types: {} }, stats: countTypes(importDraft.questions) };
      } else { importDraft.questions = parseTextQuestions(text, strategy); }

      importDraft.selected.clear();
      renderImportPreview(importDraft.questions);
      $('#confirm-import-btn').disabled = !importDraft.questions.length;
      const warnings = collectSoftRiskWarnings(importDraft.questions, importDraft.diagnostics?.profile || {});
      if (importDraft.questions.length) { const risk = largeImportRiskMessageV376(importDraft.questions);showNotice('识别完成', summarizeImportResultV376(importDraft.questions, warnings), (warnings.length || risk) ? 'warn' : 'ok'); } else { showNotice('识别失败', '没有识别到有效题目。请检查题号、选项或答案格式，也可以先粘贴纯文本后再试。', 'danger'); }
    // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
    } catch (e) { toast('识别失败：' + e.message, 'danger', '识别失败'); }
  }

  // 双文件样例保留跨题型重复题号，以演示需结合分组对齐答案。
  const DUAL_SAMPLE_QUESTIONS = `一、单选题
1. 机动车驾驶人初次申领驾驶证后的实习期是多长时间？
A. 6个月
B. 12个月
C. 16个月
D. 18个月

二、判断题
1. 初次申领的机动车驾驶证有效期为6年。
A. 正确
B. 错误

三、多选题
1. 雨天安全驾驶应注意哪些事项？
A. 降低车速
B. 加大跟车距离
C. 避免急刹急打方向
D. 高速通过积水路段`;
  const DUAL_SAMPLE_ANSWERS = `一、单选题
1. B

二、判断题
1. A

三、多选题
1. ABC`;

  // 装载成对的题目与答案样例，清理双文件读取及旧预览关联。
  function loadDualSample() {
    importDraft.invalidateBankName();
    importDraft.invalidateRead('question');
    importDraft.invalidateRead('answer');
    $('#import-bank-name').value = 'C1双文件导入示例题库';
    $('#dual-question-text').value = DUAL_SAMPLE_QUESTIONS;
    $('#dual-answer-text').value = DUAL_SAMPLE_ANSWERS;
    $('#dual-match-mode').value = 'auto';
    toast('已填入C1双文件示例，请点击“识别并合并双文件”。', 'ok');
  }

  // 独立读取题目与答案文本，再按用户选择或自动策略匹配并给出诊断。
  function parseDualImport() {
    invalidateAiImportRequestV99();
    cancelAiPreviewRequestV991(true);
    resetAiSuggestionsV991();
    closeAiPreviewPanelV991();
    const qText = $('#dual-question-text').value.trim();
    const aText = $('#dual-answer-text').value.trim();
    if (!qText || !aText) { toast('请先提供题目文本和答案文本。', 'warn', '双文件导入未开始');return; }

    importDraft.invalidateRead('question');
    importDraft.invalidateRead('answer');
    importDraft.invalidatePreview();
    try {
      importDraft.warnings = [];importDraft.report = '';
      const qStrategy = $('#import-strategy')?.value || 'auto';
      const questions = parseTextQuestions(qText, qStrategy).map((q, i) => ({ ...q, answer: [], number: q.number || i + 1 }));
      const mode = $('#dual-match-mode').value;
      const resolved = resolveDualAnswerCandidates(questions, aText, mode);
      const answerEntries = resolved.answerEntries || [];
      const result = resolved.result || mergeQuestionAnswers(questions, answerEntries, mode);
      importDraft.questions = result.questions;
      importDraft.warnings = result.warnings;
      importDraft.report = `解析策略：双文件导入；题目文件和答案文件分别识别后按自动/所选规则合并。${
        result.strategyName ? ` 实际采用：${result.strategyName}。` : ''
      }${resolved.answerSourceName ? ` 答案文件识别：${resolved.answerSourceName}。` : ''
      }${resolved.answerSourceSummary ? ` 答案候选：${resolved.answerSourceSummary}。` : ''
      }${result.autoSummary ? ` 合并候选：${result.autoSummary}。` : ''}`;
      importDraft.diagnostics = { ...(importDraft.diagnostics || {}), mode: '双文件导入', matchMode: mode, chosenMatchMode: result.chosenMode || mode, answerCount: answerEntries.length, questionCount: questions.length, stats: countTypes(result.questions || []), mergeWarnings: result.warnings || [], autoSummary: result.autoSummary || '', answerSource: resolved.answerSourceName || '', answerSourceSummary: resolved.answerSourceSummary || '' };
      importDraft.selected.clear();
      renderImportPreview(importDraft.questions);
      $('#confirm-import-btn').disabled = !importDraft.questions.length;
      const warnings = [...new Set(collectSoftRiskWarnings(importDraft.questions, importDraft.diagnostics?.profile || {}).concat(importDraft.warnings || []))];
      if (importDraft.questions.length) { const risk = largeImportRiskMessageV376(importDraft.questions);showNotice('双文件合并完成', `题目文件识别 ${questions.length} 道，答案文件识别 ${answerEntries.length} 条；答案策略：${resolved.answerSourceName || '答案表提取'}；合并后 ${importDraft.questions.length} 道。${warnings.length ? `存在 ${warnings.length} 条提示，请在预览中确认。` : '未发现明显异常。'}${risk ? ` ${risk}` : ''}`, (warnings.length || risk) ? 'warn' : 'ok'); } else { showNotice('双文件合并失败', '没有得到可导入题目，请检查题目文件和答案文件的对应方式。', 'danger'); }
    // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
    } catch (e) { toast('双文件识别失败：' + e.message, 'danger', '双文件识别失败'); }
  }

  const answerEntryRules = {
    isImportNoiseLine, getHeadingType, splitAnswer, splitTextAnswer,
  };
  function parseAnswerEntries(text) {
    const normalizedText = normalizeImportText(text);
    return globalThis.ShirohaTextAnswers.parseAnswerEntries(normalizedText, answerEntryRules);
  }

  // 答案表专用解析不足时，复用普通题库解析结果提取可用答案。
  function parseAnswerEntriesByQuestionParse(text) {
    let parsed;
    try { parsed = parseTextQuestions(text, 'auto') || []; } catch (e) { warnDev('普通文本解析失败，返回空结果。', e);parsed = []; }

    const entries = [];
    parsed.forEach(/* 仅收录有可辨认答案的解析题，并保留原序号供后续合并。 */ (q, i) => {
      const ans = (q.answer || []).map((x) => String(x || '').trim()).filter(Boolean);
      if (!ans.length) { return; }

      entries.push({
        number: String(q.number || i + 1),
        group: q.category || q.group || q.type || '',
        answer: ans,
        raw: ans.join(''),
      });
    });

    return { entries, questionCount: parsed.length };
  }

  // 同时考虑已答数与异常数对合并结果评分，供答案来源择优。
  function scoreDualMergeResult(result) {
    const qs = result?.questions || [];
    const importWarns = collectImportWarnings(qs);
    const unanswered = qs.filter((q) => !(q.answer || []).length).length;
    const invalid = importWarns.filter((w) => !/* 缺答单独计入匹配率，不重复计入无效答案诊断。 */ /缺少答案|缺少参考答案/.test(w)).length;
    const typeMismatch = qs.filter((q) => q.type === 'judge' && (q.answer || []).some((a) => !['A', 'B'].includes(String(a)))).length;
    const answered = qs.length - unanswered;
    return (answered * 120) - (invalid * 100) - (unanswered * 90) - (typeMismatch * 150) - ((result?.warnings || []).length * 10);
  }

  // 在多个解析来源中保留最先出现的同题号、同分组和同答案条目。
  function combineDualAnswerEntries(...entryGroups) {
    const merged = [];
    const seen = new Set();
    for (const entries of entryGroups) {
      for (const entry of entries) {
        const key = `${String(entry.number || '')}|${String(entry.group || '')}|${(entry.answer || []).join('')}`;
        if (seen.has(key)) { continue; }

        seen.add(key);
        merged.push(entry);
      }
    }

    return merged;
  }

  // 独立保留每种答案解析来源，完整题库解析也可补充答案表遗漏的题号。
  function collectDualAnswerCandidates(text) {
    const standardEntries = parseAnswerEntries(text);
    const analysisEntries = parseAnswerAnalysisEntries(text);
    const fullParsed = parseAnswerEntriesByQuestionParse(text);
    const candidates = [
      { key: 'simple', name: '答案表提取', entries: standardEntries, detail: `答案表提取${standardEntries.length}条` },
    ];
    if (analysisEntries.length) {
      candidates.push({ key: 'analysis', name: '答案解析区提取', entries: analysisEntries, detail: `答案解析区提取${analysisEntries.length}条` });
    }

    if (fullParsed.entries.length) {
      candidates.push({ key: 'full', name: '完整题库解析兜底', entries: fullParsed.entries, detail: `完整题库解析${fullParsed.entries.length}条（共识别${fullParsed.questionCount || 0}题）` });
    }

    if ((standardEntries.length || analysisEntries.length) && fullParsed.entries.length) {
      const merged = combineDualAnswerEntries(standardEntries, analysisEntries, fullParsed.entries);
      candidates.push({ key: 'hybrid', name: '答案表提取 + 完整题库解析兜底', entries: merged, detail: `混合提取${merged.length}条（答案表${standardEntries.length} + 答案解析${analysisEntries.length} + 完整题库${fullParsed.entries.length}）` });
    }

    return candidates;
  }

  // 综合答案表、解析区和完整题库解析，依据合并质量选择可用答案来源。
  function resolveDualAnswerCandidates(questions, text, mode = 'auto') {
    const candidates = collectDualAnswerCandidates(text);
    const evaluated = candidates.map((c) => {
      const result = mergeQuestionAnswers(questions, c.entries, mode);
      const score = scoreDualMergeResult(result);
      return { ...c, result, score };
    }).sort((a, b) => b.score - a.score);
    const best = evaluated[0] || { entries: [], name: '答案表提取', detail: '答案表提取0条', result: mergeQuestionAnswers(questions, [], mode), score: -999999 };
    return {
      answerEntries: best.entries || [],
      answerSourceName: best.name,
      answerSourceSummary: evaluated.map((c) => `${c.name}${(c.entries || []).length}条/质量${c.score}`).join('；'),
      result: best.result,
      candidates: evaluated,
    };
  }

  // 按题型分组、题号或顺序匹配答案；自动模式比较匹配质量后择优。
  function mergeQuestionAnswers(questions, answers, mode) {
    if (mode === 'auto') {
      const labelMap = { group: '按题型分组 + 组内题号对应', number: '智能按题号对应', order: '按顺序对应' };
      const candidates = ['group', 'number', 'order'].map(/* 单独试算每种合并模式，按照缺答、无效答案和题型冲突排序。 */ (m) => {
        const r = mergeQuestionAnswers(questions, answers, m);
        const qs = r.questions || [];
        const importWarns = collectImportWarnings(qs);
        const unanswered = qs.filter((q) => !(q.answer || []).length).length;
        const invalid = importWarns.filter((w) => !/* 无效评分排除已单独计入未作答权重的缺答诊断。 */ /缺少答案|缺少参考答案/.test(w)).length;
        const typeMismatch = qs.filter((q) => q.type === 'judge' && (q.answer || []).some((a) => !['A', 'B'].includes(String(a)))).length;
        const answered = qs.length - unanswered;
        const score = (answered * 100) - (invalid * 80) - (unanswered * 50) - (typeMismatch * 120) - ((r.warnings || []).length * 8);
        return { ...r, chosenMode: m, strategyName: labelMap[m], autoScore: score, autoUnanswered: unanswered, autoInvalid: invalid };
      });
      candidates.sort((a, b) => b.autoScore - a.autoScore);

      const best = candidates[0] || { questions: [], warnings: [] };
      const summary = candidates.map((c) => `${c.strategyName}${(c.questions || []).length}题/缺答案${c.autoUnanswered}/质量${c.autoScore}`).join('；');
      best.autoSummary = summary;
      return best;
    }

    const warnings = [];
    if (!questions.length) { warnings.push('题目文件未识别到题目。'); }

    if (!answers.length) { warnings.push('答案文件未识别到答案。'); }

    const qs = questions.map((q, i) => ({ ...q, answer: [], number: q.number || i + 1 }));
    const normGroup = (s) => mapType(s) || mapType(String(s || '').replace(/* 在题型映射前兼容末尾存在“题”字的分组名称。 */ /题$/, '')) || String(s || '').replace(/* 未识别为题型的来源分组按去除内部空白的名称匹配。 */ /\s/g, '');

    if (mode === 'order') {
      qs.forEach((q, i) => {
        if (answers[i]) { q.answer = normalizeAnswer(answers[i].answer, q.options, q.type); }
      });
    } else if (mode === 'group') {
      const used = new Set();
      qs.forEach((q) => {
        const qg = normGroup(q.category || q.group || '');
        const hitIndex = answers.findIndex((a, ai) => !used.has(ai) && String(a.number) === String(q.number) && normGroup(a.group) === qg);
        if (hitIndex >= 0) { q.answer = normalizeAnswer(answers[hitIndex].answer, q.options, q.type);used.add(hitIndex); }
      });

      if (qs.some((q) => !q.answer.length)) { warnings.push('部分题目没有按“题型分组 + 题号”匹配到答案，可尝试改用“按顺序对应”或检查分组标题。'); }
    } else {
    // 按题号对应时也要兼容“每个题型都从 1 重新编号”的答案表。
    // 如果同一题号在单选/多选/判断区重复出现，优先按题目自身题型匹配答案分组，避免判断题误取单选题的 C/D 答案。
      const byNumber = new Map();const dup = new Set();
      answers.forEach((a, idx) => {
        if (!a.number) { return; }

        const key = String(a.number);if (!byNumber.has(key)) { byNumber.set(key, []); } else { dup.add(key); }

        byNumber.get(key).push({ ...a, idx });
      });

      if (dup.size) { warnings.push(`答案文件存在重复题号：${[...dup].slice(0, 10).join('、')}。已优先按题型分组匹配；如仍有异常，请使用“按题型分组 + 组内题号对应”。`); }

      qs.forEach(/* 从同题号候选中择优匹配，无明确题号的答案才可按原顺序补入。 */ (q, i) => {
        const candidates = byNumber.get(String(q.number)) || [];
        const hit = globalThis.ShirohaTextAnswers.findNumberedAnswer(candidates, q, mode, {
          normGroup, isRawJudgeSymbolAnswer, isJudgeSymbolAnswer,
        });
        if (hit) { q.answer = normalizeAnswer(hit.answer, q.options, q.type); } else if (answers[i] && !answers[i].number) { q.answer = normalizeAnswer(answers[i].answer, q.options, q.type); }
      });
    }

    const unanswered = qs.filter((q) => !q.answer.length).length;
    if (questions.length !== answers.length) { warnings.push(`数量提示：识别到题目 ${questions.length} 道，答案 ${answers.length} 个。`); }

    if (unanswered) { warnings.push(`合并后仍有 ${unanswered} 道题缺少答案。`); }

    return { questions: qs.map((q, i) => normalizeQuestion(q, i)), warnings };
  }

  // 同步两个导入入口的保存忙碌状态，保留恢复时所需的原按钮文案。
  function setImportCommitBusyV5911(busy, label = '正在保存…') {
    const buttons = [$('#confirm-import-btn'), $('#dual-confirm-import-btn')].filter(Boolean);
    buttons.forEach(/* 让每个按钮保留自己的确认文字，保存结束后恢复独立状态。 */ (btn) => {
      if (busy) {
        if (!btn.dataset.commitTextV5911) { btn.dataset.commitTextV5911 = btn.textContent || '确认导入'; }

        btn.dataset.commitDisabledV5911 = btn.disabled ? '1' : '0';
        btn.disabled = true;btn.textContent = label;btn.setAttribute('aria-busy', 'true');
      } else {
        const oldText = btn.dataset.commitTextV5911;
        if (oldText) { btn.textContent = oldText; }

        btn.disabled = btn.dataset.commitDisabledV5911 === '1';
        delete btn.dataset.commitTextV5911;delete btn.dataset.commitDisabledV5911;btn.removeAttribute('aria-busy');
      }
    });
  }

  function waitForImportCommitPaintV5911() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(() => requestAnimationFrame(resolve)); } else { setTimeout(resolve, 0); }
    });
  }

  function isStorageQuotaErrorV5911(error) {
    const name = String(error?.name || '');const code = Number(error?.code || 0);
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
  }

  function isStringTooLargeErrorV376(error) {
    const name = String(error?.name || '');const msg = String(error?.message || '');
    return name === 'RangeError' || /* 从运行时错误文案识别序列化字符串超限，补足仅有错误名称的判断。 */ /Invalid string length|string length|too large/i.test(msg);
  }

  // 区分存储体积限制与一般保存失败，提示用户可继续处理尚存的预览草稿。
  function importSaveFailureTextV5911(error, action = '保存') {
    const suffix = '识别结果仍保留在预览区，可以删除部分题目、拆分文件或清理旧题库后再试。';
    if (isStringTooLargeErrorV376(error)) { return `题目已经识别完成，但浏览器在生成本地保存数据时失败，通常是当前题库/记录数据过大。${action}内容没有写入，已恢复到保存前状态。${suffix}`; }

    if (isStorageQuotaErrorV5911(error)) { return `浏览器本地存储空间不足，${action}内容没有写入，已恢复到保存前状态。可先导出完整备份并清理不需要的图片题库、旧记录或旧题库后重试。${suffix}`; }

    const detail = String(error?.message || '').trim();
    return `浏览器未能保存${action}结果，已恢复到保存前状态。${detail ? `错误信息：${detail}` : '请稍后重试。'} ${suffix}`;
  }

  // 将预览追加进指定题库，失败时保留原题库和未提交草稿。
  async function appendImportToBankV5911(target, warnings) {
    return runMutation(/* 保存前记录目标库快照，写入失败后恢复题目及更新时间。 */ async () => {
      const previousQuestions = Array.isArray(target.questions) ? target.questions : [];
      const previousUpdatedAt = target.updatedAt;
      const previousActiveBankId = state.activeBankId;
      const previousSettings = state.settings;
      const hadPracticeScope = !!previousSettings && typeof previousSettings === 'object' && Object.prototype.hasOwnProperty.call(previousSettings, 'practiceScope');
      const previousPracticeScope = hadPracticeScope && previousSettings.practiceScope && typeof previousSettings.practiceScope === 'object' ? { ...previousSettings.practiceScope } : previousSettings?.practiceScope;
      const before = previousQuestions.length;let incoming;
      importCommitBusyV5911 = true;setImportCommitBusyV5911(true, '正在追加…');
      showNotice('正在追加', `正在将 ${importDraft.questions.length} 道题追加到“${bankPathLabelV58(target)}”，请勿重复点击或关闭页面。`, 'warn');
      await waitForImportCommitPaintV5911();
      try {
        incoming = importDraft.questions.map((q, i) => cleanImportedQuestion({ ...q, id: makeId('q', before + i + 1), number: before + i + 1 }));

        target.questions = [...previousQuestions, ...incoming];
        target.updatedAt = now();
        setPracticeBankScopeV8916(target.id, true);
        await saveSilent();
      } catch (error) {
        target.questions = previousQuestions;
        target.updatedAt = previousUpdatedAt;
        state.activeBankId = previousActiveBankId;
        state.settings = previousSettings;
        if (previousSettings && typeof previousSettings === 'object') {
          if (hadPracticeScope) { previousSettings.practiceScope = previousPracticeScope; } else { delete previousSettings.practiceScope; }
        }

        warnDev('追加题库保存失败，已恢复追加前状态', error);
        showNotice('追加失败', importSaveFailureTextV5911(error, '追加'), 'danger');
        toast('追加失败，原题库未被修改。', 'warn', '追加失败');
        return;
      } finally {
        importCommitBusyV5911 = false;setImportCommitBusyV5911(false);
      }

      renderAll();
      await importDraftPersistence.imported();
      showNotice('追加成功', `已追加到“${bankPathLabelV58(target)}”：新增 ${incoming.length} 道题，当前共 ${target.questions.length} 道题。${warnings.length ? `追加前有 ${warnings.length} 条提示，建议在题库管理中抽查。` : ''}`, 'ok');
      toast(`已追加 ${incoming.length} 题到：${target.name}`, 'ok', '追加成功');
    });
  }

  // 按编辑、追加或新建模式提交导入预览，统一执行守卫和存储事务。
  async function confirmImport() {
    if (bankEditor.current()) { return saveBankEditSessionV45(); }

    if (readImportSaveModeV59() === 'append') {
      const targetId = $('#import-target-bank-v59')?.value;
      if (!targetId) { showNotice('追加失败', '原目标题库不存在，请重新选择要追加的题库。', 'danger');return; }

      if (!await loadNativeBanks([targetId])) { return; }
    }

    return runMutation(/* 在短时间内只允许一次提交，成功后重置草稿并更新当前题库。 */ async () => {
      if (importCommitBusyV5911) { return; }

      if (!importDraft.questions.length) { showNotice('导入失败', '当前没有可导入的题目。', 'danger');return; }

      const warnings = collectImportWarnings(importDraft.questions);
      const saveMode = readImportSaveModeV59();
      if (saveMode === 'append') {
        const targetId = $('#import-target-bank-v59')?.value || '';
        const target = state.banks.find((b) => b.id === targetId);
        if (!target) { showNotice('追加失败', '没有找到要追加的目标题库，请先选择已有题库。', 'danger');return; }

        await appendImportToBankV5911(target, warnings);
        return;
      }

      const name = $('#import-bank-name').value.trim() || '导入题库';
      const groupName = readImportBankGroupV58();
      const previousBanks = state.banks;const previousActiveBankId = state.activeBankId;const previousSettings = state.settings;
      const hadPracticeScope = !!previousSettings && typeof previousSettings === 'object' && Object.prototype.hasOwnProperty.call(previousSettings, 'practiceScope');
      const previousPracticeScope = hadPracticeScope && previousSettings.practiceScope && typeof previousSettings.practiceScope === 'object' ? { ...previousSettings.practiceScope } : previousSettings?.practiceScope;
      let bank;
      importCommitBusyV5911 = true;setImportCommitBusyV5911(true, '正在保存…');
      showNotice('正在导入', `正在保存“${name}”的 ${importDraft.questions.length} 道题，请勿重复点击或关闭页面。`, 'warn');
      await waitForImportCommitPaintV5911();
      try {
        bank = { id: makeId('bank'), name, groupName, createdAt: now(), updatedAt: now(), questions: importDraft.questions.map((q, i) => cleanImportedQuestion({ ...q, id: makeId('q', i), number: i + 1 })) };

        state.banks = [...previousBanks, bank];setPracticeBankScopeV8916(bank.id, true);await saveSilent();
      } catch (error) {
        state.banks = previousBanks;state.activeBankId = previousActiveBankId;state.settings = previousSettings;
        if (previousSettings && typeof previousSettings === 'object') {
          if (hadPracticeScope) { previousSettings.practiceScope = previousPracticeScope; } else { delete previousSettings.practiceScope; }
        }

        warnDev('新建题库保存失败，已恢复导入前状态', error);
        showNotice('导入未保存', importSaveFailureTextV5911(error, '导入'), 'danger');
        toast('导入保存失败，识别预览仍保留。', 'warn', '导入未保存');
        return;
      } finally {
        importCommitBusyV5911 = false;setImportCommitBusyV5911(false);
      }

      renderAll();
      await importDraftPersistence.imported();
      showNotice('导入成功', `已创建题库“${name}”，共 ${bank.questions.length} 道题。${warnings.length ? `导入前有 ${warnings.length} 条提示，建议在题库管理中抽查。` : ''}`, 'ok');
      toast(`已导入题库：${name}，共 ${bank.questions.length} 题。`, 'ok', '导入成功');
    });
  }

  // 在保存事务中校验用户输入的题库名，取消或失败时不提交空名称。
  async function renameActiveBank() {
    return runMutation(/* 从当前界面读取新名称，确认有效后保存及刷新相关视图。 */ async () => {
      const b = activeBank();const val = $('#bank-rename-input').value.trim();if (!val) { await ShirohaDialogs.alert('请输入新的题库名称。');return; }

      const oldGroup = bankGroupNameV58(b);b.name = val;b.groupName = normalizeBankGroupNameV58($('#bank-group-rename-input-v58')?.value || b.groupName);b.updatedAt = now();const scope = practiceScopeV8916();if (scope.type === PRACTICE_SCOPE_GROUP_V8916 && scope.value === oldGroup && state.banks.every((x) => x.id === b.id || bankGroupNameV58(x) !== oldGroup)) { ensurePracticeScopeV8916();toast('原练习分组已无题库，已切换为当前题库。', 'warn'); }

      const g = $('#bank-group-rename-input-v58');if (g) { g.dataset.lastBankIdV58 = ''; }

      await saveSilent();renderAll();
    });
  }

  function duplicateActiveBank() {
    duplicateBankById(activeBank().id);
  }

  // 先读取原题库完整试题，再复制到拥有独立标识的新题库。
  async function duplicateBankById(id) {
    if (!await loadNativeBanks([id])) { return; }

    return runMutation(/* 仅在源题库仍存在时复制内容，保存后切换到副本。 */ async () => {
      const b = state.banks.find((x) => x.id === id);if (!b) { return; }

      const copy = JSON.parse(JSON.stringify(b));
      copy.id = makeId('bank');
      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      copy.name = b.name + ' - 副本';
      copy.createdAt = now();copy.updatedAt = now();copy.questions = (copy.questions || []).map((q, i) => ({ ...q, id: makeId('q', i), number: i + 1 }));

      state.banks.push(copy);setPracticeBankScopeV8916(copy.id, true);await saveSilent();renderAll();
    });
  }

  async function newEmptyBank() {
    return runMutation(async () => {
      const name = await ShirohaDialogs.prompt('请输入新题库名称：', '新建空题库');if (!name) { return; }

      const groupName = normalizeBankGroupNameV58(await ShirohaDialogs.prompt('请输入一级分组名称，可留空：', '') || '');const bank = { id: makeId('bank'), name: name.trim() || '新建空题库', groupName, createdAt: now(), updatedAt: now(), questions: [] };state.banks.push(bank);setPracticeBankScopeV8916(bank.id, true);await saveSilent();renderAll();
    });
  }

  // 合并前确保来源与目标题库数据均可用，避免将未加载的题目当作完整内容。
  async function mergeBankIntoActive() {
    if (!await loadNativeBanks([activeBank().id, $('#merge-bank-select').value])) { return; }

    return runMutation(/* 在同一事务内确认两个题库仍可定位和合并，随后保存目标库。 */ async () => {
      const sourceId = $('#merge-bank-select').value;const target = activeBank();const src = state.banks.find((b) => b.id === sourceId);if (!src) { await ShirohaDialogs.alert('没有可合并的来源题库。');return; }

      if (!await ShirohaDialogs.confirm(`将“${src.name}”的 ${src.questions.length} 道题合并到当前题库“${target.name}”？`)) { return; }

      const before = target.questions.length;const existing = new Set(target.questions.map((q) => normalizeText(q.question)));let added = 0; let skipped = 0;src.questions.forEach((q) => {
        const k = normalizeText(q.question);if (existing.has(k)) { skipped += 1;return; }

        existing.add(k);target.questions.push({ ...JSON.parse(JSON.stringify(q)), id: makeId('q', target.questions.length + 1), number: target.questions.length + 1 });added += 1;
      });

      target.updatedAt = now();await saveSilent();renderAll();await ShirohaDialogs.alert(`合并完成：新增 ${added} 题，跳过重复 ${skipped} 题。合并前 ${before} 题，当前 ${target.questions.length} 题。`);
    });
  }

  // 导出指定题库前加载原生按需数据，确保导出包含完整题目。
  async function exportBankById(id) {
    try {
      if (!await loadNativeBanks([id])) { return; }

      const b = state.banks.find((x) => x.id === id);if (!b) { return; }

      const text = JSON.stringify(serializeBankForCrossExportV53(b), null, 2);const output = $('#export-output');if (output) { output.value = text; }

      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      await download((b.name || '题库') + '.json', text);
    } catch (error) {
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      platformStatus('导出失败：' + error.message, true);
      return false;
    }
  }

  // 对当前题库进行去重前先加载原生题目正文。
  async function dedupeActiveBank() {
    if (!await loadNativeBanks([activeBank().id])) { return; }

    return runMutation(/* 按归一化题干保留第一道重复题，并按去重后的顺序重新编号。 */ async () => {
      const b = activeBank();const map = new Map(); const dups = [];b.questions.forEach((q) => {
        const k = normalizeText(q.question);if (map.has(k)) { dups.push(q); } else { map.set(k, q); }
      });

      b.questions = [...map.values()].map((q, i) => ({ ...q, number: i + 1 }));

      await saveSilent();renderAll();await ShirohaDialogs.alert(`去重完成：删除 ${dups.length} 道重复题，剩余 ${b.questions.length} 道。`);
    });
  }

  function shuffle(a) {
    const shuffled = [...a];for (let i = shuffled.length - 1;i > 0;i -= 1) { const j = Math.floor(Math.random() * (i + 1));[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }

    return shuffled;
  }

  // 兼容历史富文本字段形态，选择第一份有效文本并按安全规则处理。
  function pickRichTextFieldV57(q, field, fallback = '') {
    const rich = q && q.richContent;
    const candidates = [];
    if (rich && typeof rich === 'object') {
      const fields = rich.fields && typeof rich.fields === 'object' ? rich.fields : rich;
      const item = fields && fields[field];
      if (typeof item === 'string') { candidates.push(item); } else if (item && typeof item === 'object') { candidates.push(item.text, item.markdown, item.sourceText, item.fallbackText, item.plainText); }
    }

    candidates.push(fallback);
    const found = candidates.find((v) => v != null && String(v).trim());
    return sanitizeRichTextValueV57(found);
  }

  // 按选项位置读取富文本，缺失时保留旧选项的文本表示。
  function pickRichOptionTextV57(q, index, opt) {
    const fallback = opt && (opt.text ?? opt.content ?? opt.label ?? '');
    const rich = q && q.richContent;
    if (rich && typeof rich === 'object') {
      const fields = rich.fields && typeof rich.fields === 'object' ? rich.fields : rich;
      const options = fields && fields.options;
      if (Array.isArray(options)) {
        const item = options[index];
        if (typeof item === 'string' && item.trim()) { return sanitizeRichTextValueV57(item); }

        if (item && typeof item === 'object') {
          const value = item.text ?? item.markdown ?? item.sourceText ?? item.fallbackText ?? item.plainText;
          if (value != null && String(value).trim()) { return sanitizeRichTextValueV57(value); }
        }
      }
    }

    return sanitizeRichTextValueV57(fallback);
  }

  /* SHIROHA_WEB_V58_9_19_DOCX_ANALYSIS_IMAGE_TRUNCATION_FIX_START */
  function truncateRichTextPreservingImagesV58919(text, maxPlainLength = 200000) {
    const images = [];
    const protect = (image) => {
      const index = images.push(image) - 1;
      return `\uE000SHIROHA_RICH_IMAGE_${index}\uE001`;
    };

    let masked = String(text || '').replace(markdownImageRegexV83(), (match) => protect(match));
    masked = masked.replace(/* 把允许的内嵌位图暂存为占位标识，便于清理富文本时保留有效图片。 */ /data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=\r\n]+/gi, (match) => (questionImageDataUriRegexV83().test(match) ? protect(match) : '[图片已移除]'));

    if (masked.length > maxPlainLength) { masked = masked.slice(0, maxPlainLength); }

    return masked.replace(/* 以编号找回暂存的安全图片，未知编号不会恢复为原始内容。 */ /\uE000SHIROHA_RICH_IMAGE_(\d+)\uE001/g, (_, index) => images[Number(index)] || '');
  }

  function sanitizeRichTextValueV57(value) {
    const safe = stripUnsafeImageDataUrisV83(String(value || ''));
    if (safe.length <= 200000) { return safe; }

    // 只限制普通文本长度，不能在合法 Base64 图片中间截断，否则图片会变成无法渲染的残缺 Markdown。
    return truncateRichTextPreservingImagesV58919(safe, 200000);
  }

  /* SHIROHA_WEB_V58_9_19_DOCX_ANALYSIS_IMAGE_TRUNCATION_FIX_END */
  function detectRichFeaturesV57(text, extraImages) {
    const s = String(text || '');
    const features = [];
    if (/* DOCX 导入的表格边界标记用于声明表格兼容能力。 */ /【DOCX表格开始】[\s\S]*?【DOCX表格结束】/.test(s)) { features.push('docx_table'); }

    if (/* OMML 标记表示源 DOCX 含公式，保留给后续导出能力判断。 */ /【DOCX公式OMML(?::|】)/.test(s)) { features.push('docx_omml_formula'); }

    if (/* 识别受支持的 LaTeX 命令或公式定界符，给富文本字段标记公式能力。 */ /\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|theta|vartheta|lambda|mu|sigma|Sigma|pi|rho|bar|hat|sqrt|sum|frac|begin\{cases\})\b|\\\(|\\\[|\$[^\n$]{1,280}\$/.test(s)) { features.push('latex_formula'); }

    if (markdownImageRegexV83().test(s) || ((extraImages || []).length > 0)) { features.push('image'); }

    return [...new Set(features)];
  }

  // 给富文本字段附带来源和能力信息，供跨端导入选择与降级。
  function buildRichContentFieldV57(text, source, extraImages) {
    const value = String(text || '');
    const features = detectRichFeaturesV57(value, extraImages);
    if (!features.length) { return null; }

    return { text: value, source: source || 'web', features };
  }

  // 收集题干、选项和解析的富文本表示，空内容不生成无用字段。
  function buildQuestionRichContentV57(q) {
    if (!q || typeof q !== 'object') { return null; }

    const fields = {};
    const questionField = buildRichContentFieldV57(q.question, 'question', q.images);
    if (questionField) { fields.question = questionField; }

    const analysisField = buildRichContentFieldV57(q.analysis, 'analysis', []);
    if (analysisField) { fields.analysis = analysisField; }

    const optionFields = (q.options || []).map((o) => buildRichContentFieldV57(o && o.text, 'option', []));
    if (optionFields.some(Boolean)) { fields.options = optionFields.map((x) => x || null); }

    const allFeatures = [...new Set(Object.values(fields).flatMap((v) => (Array.isArray(v) ? v.filter(Boolean).flatMap((x) => x.features || []) : (v.features || []))))];
    if (!allFeatures.length) { return null; }

    return { schema: RICH_CONTENT_VERSION_V57, features: allFeatures, fields };
  }

  // 汇总全部导出题库使用的富文本能力，便于接收端判断兼容性。
  function buildRichContentCapabilitiesV57(banks) {
    const caps = { schema: RICH_CONTENT_VERSION_V57, exportedBy: 'web-v33', fallback: 'plain_text_with_safe_unknown_fields', features: [] };
    const set = new Set();
    (banks || []).forEach((bank) => (bank.questions || []).forEach((q) => {
      const rich = q && q.richContent;
      (rich && Array.isArray(rich.features) ? rich.features : []).forEach((f) => set.add(f));
    }));

    caps.features = [...set].sort();
    return caps;
  }

  function questionImageDataUriRegexV83() {
    return /* 仅接受列出的位图 MIME 和 Base64 数据，供题目图片来源校验。 */ /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=\r\n]+$/i;
  }

  function markdownImageRegexV83() {
    return /* 识别题干内嵌位图的 Markdown 表示，捕获替代文字和数据地址。 */ /!\[([^\]]{0,120})\]\((data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,[^)]+)\)/gi;
  }

  function dataUriMimeExtV83(dataUri) {
    const m = String(dataUri || '').match(/* 提取内嵌位图的 MIME 子类型，供资产文件扩展名选择。 */ /^data:image\/([^;]+);base64,/i);const t = ((m && m[1]) || 'webp').toLowerCase();if (t === 'jpeg' || t === 'jpg') { return 'jpg'; }

    return t.replace(/* MIME 子类型只能留下 ASCII 扩展名字符，空值回退到 webp。 */ /[^a-z0-9]+/g, '') || 'webp';
  }

  function dataUriSizeBytesV83(dataUri) {
    const b64 = String(dataUri || '').split(',')[1] || '';return Math.max(0, Math.floor(b64.replace(/* 忽略 Base64 的换行和间隔，再按字符数估算图像字节数。 */ /\s/g, '').length * 3 / 4));
  }

  function safeImageIdV83(prefix, a, b) {
    return `${String(prefix || 'img')}_${String(a || 'q').replace(/* 来源标识只使用可移植字符，避免占位编号影响文件名。 */ /[^A-Za-z0-9_-]+/g, '_').slice(0, 32)}_${String(b || 1).replace(/* 图片序号也限制为可移植字符，以免旧备份值引入分隔符。 */ /[^A-Za-z0-9_-]+/g, '_')}`;
  }

  function stripUnsafeImageDataUrisV83(text) {
    return String(text || '')
      .replace(/* 逐个检查 Markdown 内嵌图像，仅保留完整的安全数据地址。 */ /!\[[^\]]{0,120}\]\((data:image\/[^;)\s]+;base64,[^)]+)\)/gi, (m, src) => (questionImageDataUriRegexV83().test(src) ? m : '[图片已移除]'))
      .replace(/* 兼容未包在 Markdown 标记里的图片数据，去除不适合展示的源。 */ /data:image\/[^;)\s]+;base64,[A-Za-z0-9+/=\r\n]+/gi, (m) => (questionImageDataUriRegexV83().test(m) ? m : '[图片已移除]'));
  }

  // 将历史图片数组归一化，保留显示和跨端复用所需的身份及尺寸字段。
  function normalizeQuestionImagesForWebV83(images) {
    if (!Array.isArray(images)) { return []; }

    return images.map(/* 单个图片缺少有效来源时允许过滤，避免将空描述写入导出资产。 */ (img, i) => {
      if (!img || typeof img !== 'object') { return null; }

      const src = String(img.dataUrl || img.dataUri || img.src || img.localPath || '').trim();
      if (!src) { return null; }

      const sourceName = String(img.sourceName || img.name || img.alt || (`题目图片${i + 1}`)).trim() || (`题目图片${i + 1}`);
      return { id: String(img.id || safeImageIdV83('img', sourceName, i + 1)), localPath: src, dataUrl: src, sourceName, order: Number(img.order || i + 1) || i + 1, width: img.width ?? null, height: img.height ?? null, sizeBytes: Number(img.sizeBytes || dataUriSizeBytesV83(src)) || 0 };
    }).filter(Boolean);
  }

  function questionTextContainsDataUriV83(question, dataUri) {
    return !!dataUri && String(question || '').includes(String(dataUri).slice(0, 80));
  }

  // 将有效图片补到题干里，避免重复插入原文中已有的相同资源。
  function injectQuestionImagesForWebV83(question, images) {
    let text = String(question || '').trim();
    const imgs = normalizeQuestionImagesForWebV83(images).filter((img) => questionImageDataUriRegexV83().test(img.dataUrl || img.localPath || ''));
    const additions = [];
    imgs.forEach((img, i) => {
      const src = img.dataUrl || img.localPath;if (!questionTextContainsDataUriV83(text, src)) { const alt = (img.sourceName || (`题目图片${i + 1}`)).replace(/* 删除会结束替代文字或引入新行的字符，避免破坏 Markdown 图片边界。 */ /[\]\n\r]/g, '').slice(0, 80) || '题目图片';additions.push(`![${alt}](${src})`); }
    });

    if (additions.length) { text = [text, ...additions].filter(Boolean).join('\n'); }

    return text;
  }

  // 保留题干图片顺序，合并独立图片列表时跳过已处理的来源。
  function exportQuestionImagesForCrossExportV83(q) {
    const question = String((q && q.question) || '');
    const images = [];let order = 1;
    const cleanQuestion = question.replace(markdownImageRegexV83(), /* 将题干里的内嵌图片收录为资产，同时留下人可读的占位名称。 */ (m, alt, src) => {
      const cleanAlt = String(alt || (`题目图片${order}`)).trim() || (`题目图片${order}`);
      const ext = dataUriMimeExtV83(src);
      images.push({ id: safeImageIdV83('web', (q && q.id) || 'q', order), localPath: src, dataUrl: src, sourceName: `${cleanAlt}.${ext}`, order, width: null, height: null, sizeBytes: dataUriSizeBytesV83(src) });
      order += 1;
      return `\n【${cleanAlt}】\n`;
    }).replace(/* 图片转换会留下额外换行，超过一个空白段时折叠为单个空白段。 */ /\n{3,}/g, '\n\n').trim();
    normalizeQuestionImagesForWebV83(q && q.images).forEach(/* 补充只存在于结构化图片数组的资源，保留已有顺序号。 */ (img) => {
      const src = img.dataUrl || img.localPath || '';
      if (!src || images.some((x) => x.localPath === src || x.dataUrl === src)) { return; }

      const exportedImage = { ...img, order: img.order || order };
      if (!img.order) { order += 1; }

      images.push(exportedImage);
    });

    return { question: cleanQuestion, images };
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

    if (practiceSession.current.submitMode === 'total') { return !practiceSession.current.totalLocked && !practiceSession.current.confirmingTotal; }

    const answer = getPracticeAnswerStateV26(key);
    return !answer.answered && !answer.revealed;
  }

  function getWrongEntries(bid = activeBank().id) {
    const v = state.wrongBook[bid] || [];if (!Array.isArray(v)) { return []; }

    return v.map((x) => (typeof x === 'string' ? { id: x, wrongCount: 1, rightCount: 0, reviewRightCount: 0, streakCorrectCount: 0, lastWrongAt: '', lastCorrectAt: '', lastReviewedAt: '', nextReviewAt: '', reviewLevel: 0, lastAnswer: [], source: 'web', timestamp: 0, status: '未掌握' } : { ...x, id: x.id, wrongCount: Number(x.wrongCount || 0), rightCount: Number(x.rightCount || 0), reviewRightCount: Number(x.reviewRightCount || 0), streakCorrectCount: Number(x.streakCorrectCount || 0), lastWrongAt: x.lastWrongAt || '', lastCorrectAt: x.lastCorrectAt || '', lastReviewedAt: x.lastReviewedAt || '', nextReviewAt: x.nextReviewAt || '', reviewLevel: Number(x.reviewLevel || 0), lastAnswer: Array.isArray(x.lastAnswer) ? x.lastAnswer : [], source: x.source || 'web', timestamp: Number(x.timestamp || 0), status: x.status || '未掌握' })).filter((x) => x.id);
  }

  function setWrongEntries(entries, bid = activeBank().id) {
    state.wrongBook[bid] = entries;
  }

  function nextWrongReviewIsoV24(level, base = Date.now()) {
    const days = [1, 1, 3, 7, 14, 30, 60][Math.max(0, Math.min(6, Number(level || 0)))] || 1;return new Date(base + (days * 86400000)).toISOString();
  }

  function addWrong(id, bid = activeBank().id, chosen = []) {
    const arr = getWrongEntries(bid);let e = arr.find((x) => x.id === id);if (!e) { e = { id, wrongCount: 0, rightCount: 0, reviewRightCount: 0, streakCorrectCount: 0, lastWrongAt: '', lastCorrectAt: '', lastReviewedAt: '', nextReviewAt: '', reviewLevel: 0, lastAnswer: [], source: 'web', timestamp: 0, status: '未掌握' };arr.push(e); }

    const ts = Date.now();e.lastAnswer = [...chosen];e.wrongCount += 1;e.rightCount = 0;e.reviewRightCount = 0;e.streakCorrectCount = 0;e.reviewLevel = 0;e.lastWrongAt = new Date(ts).toISOString();e.lastReviewedAt = e.lastWrongAt;e.nextReviewAt = nextWrongReviewIsoV24(0, ts);e.timestamp = ts;e.source = 'web';e.status = '未掌握';setWrongEntries(arr, bid);
  }

  function markRight(id, bid = activeBank().id) {
    const arr = getWrongEntries(bid);const e = arr.find((x) => x.id === id);if (!e) { return; }

    const ts = Date.now();e.rightCount += 1;e.reviewRightCount = Number(e.reviewRightCount || 0) + 1;e.streakCorrectCount = Number(e.streakCorrectCount || 0) + 1;const mastered = e.streakCorrectCount >= 2;e.reviewLevel = mastered ? Math.max(2, Number(e.reviewLevel || 0) + 1) : Math.max(1, Number(e.reviewLevel || 0));e.lastCorrectAt = new Date(ts).toISOString();e.lastReviewedAt = e.lastCorrectAt;e.nextReviewAt = nextWrongReviewIsoV24(e.reviewLevel, ts);e.timestamp = ts;e.status = mastered ? '已掌握' : '复习中';setWrongEntries(arr, bid);
  }

  function removeWrong(id) {
    const bid = activeBank().id;setWrongEntries(getWrongEntries(bid).filter((x) => x.id !== id), bid);
  }

  function makeAnswerDetail(item, chosen, ok, score, _totalScore) {
    const q = practiceQuestionV8916(item);const values = Array.isArray(chosen) ? [...chosen] : [];const detail = { questionId: q.id, question: short(q.question, 120), type: q.type, category: q.category || '', chosen: values, userAnswer: [...values], answer: [...q.answer], correct: !!ok, score: ok ? score : 0, fullScore: score, time: now(), sourceBankId: practiceItemBankIdV8916(item), sourceBankName: practiceItemBankNameV8916(item), nativeQuestion: JSON.parse(JSON.stringify(q)) };if (isMultiBlankQuestionV58914(q)) { detail.blankAnswers = cloneBlankAnswersV58914(q.blankAnswers);detail.userBlankAnswers = [...values]; }

    return detail;
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

  // 导出前补齐原生分页记录详情，避免把只读摘要当成完整学习记录。
  async function exportRecords() {
    try {
      if (ShirohaPlatform.storage.ensureRecords && !await readNative(() => ShirohaPlatform.storage.ensureRecords(state, state.records.map((r) => r.id)))) { return; }

      const text = JSON.stringify(state.records || [], null, 2);const output = $('#export-output');if (output) { output.value = text; }

      await download('学习记录.json', text);
    } catch (error) {
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      platformStatus('导出失败：' + error.message, true);
      return false;
    }
  }

  function fmt(s) {
    return new Date(s).toLocaleString('zh-CN', { hour12: false });
  }

  // 导出当前题库前确保其试题正文已经全部加载。
  async function exportCurrentBank() {
    try {
      if (!await loadNativeBanks([activeBank().id])) { return; }

      const text = JSON.stringify(serializeBankForCrossExportV53(activeBank()), null, 2);$('#export-output').value = text;
      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      await download(activeBank().name + '.json', text);
    } catch (error) {
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      platformStatus('导出失败：' + error.message, true);
      return false;
    }
  }

  function exportAll() {
    exportAllBackupV23();
  }

  /* SHIROHA_V23_DATA_TOOLS_PATCH_START
   v23: 题库管理页批量选择导出 + 导入页/设置页备份 JSON 导入恢复
*/
  function setupEnhancedDataToolsV23() {
    injectDataToolsStyleV23();
    ensureBackupFileInputV23();
    ensureBankManageExportPanelV23();
    ensureSettingsBackupPanelV23();
    const validIds = new Set(state.banks.map((bank) => bank.id));
    exportBankSelectedV23 = new Set([...exportBankSelectedV23].filter((id) => validIds.has(id)));

    if (!exportBankSelectedV23.size) { exportBankSelectedV23 = new Set(validIds); }

    renderExportBankSummaryV23();
  }

  // 按需装配备份文件输入，用独立控件承接恢复文件选择。
  function ensureBackupFileInputV23() {
    if ($('#backup-json-file-v23')) { return; }

    const input = document.createElement('input');
    input.type = 'file';input.id = 'backup-json-file-v23';input.accept = '.json,.zip,application/json,application/zip';input.style.display = 'none';
    input.onchange = importBackupJsonFileV23;
    document.body.appendChild(input);
  }

  // 在题库管理页装配选择性批量导出控件，重复渲染时复用已绑定入口。
  function ensureBankManageExportPanelV23() {
    if ($('#bank-bulk-export-panel-v23')) { return; }

    const bankList = $('#bank-list');if (!bankList) { return; }

    bankList.insertAdjacentHTML('beforebegin', `<div id="bank-bulk-export-panel-v23" class="data-tool-card-v23 bank-bulk-panel-v23 bank-manage-toolbar-v28">
    <div class="section-head compact-head-v23"><div><h3>当前题库与批量管理</h3><p class="muted">在这里切换当前题库；勾选下方题库后，可以批量导出题库 JSON 或删除。</p></div></div>
    <div class="bank-current-bar-v28">
      <label>当前题库<select id="bank-current-select-v28"></select></label>
      <span class="muted">切换后会同步预览、练习、考试和错题范围。</span>
    </div>
    <div class="actions wrap-v23 bank-toolbar-actions-v28">
      <label class="check-line-v23"><input id="export-bank-all-v23" type="checkbox">全选</label>
      <button class="ghost" id="export-bank-invert-v23" type="button">反选</button>
      <button class="ghost" id="export-bank-current-v23" type="button">仅选当前题库</button>
      <button class="primary" id="export-selected-banks-v23" type="button">导出选中题库 JSON</button>
      <button class="ghost danger" id="delete-selected-banks-v32" type="button">删除选中题库</button>
    </div>
    <div id="export-bank-summary-v23" class="notice warn">请选择需要管理的题库。</div>
  </div>`);
    $('#bank-current-select-v28').onchange = async (e) => runMutation(async () => {
      if (e.target.value) { state.activeBankId = e.target.value;await saveSilent();renderAll(); }
    });

    $('#export-bank-all-v23').onchange = (e) => {
      exportBankSelectedV23 = e.target.checked ? new Set(state.banks.map((b) => b.id)) : new Set();

      renderBankList();
    };

    $('#export-bank-invert-v23').onclick = () => {
      const next = new Set();state.banks.forEach((b) => {
        if (!exportBankSelectedV23.has(b.id)) { next.add(b.id); }
      });

      exportBankSelectedV23 = next;renderBankList();
    };

    $('#export-bank-current-v23').onclick = () => {
      exportBankSelectedV23 = new Set([activeBank().id]);renderBankList();
    };

    $('#export-selected-banks-v23').onclick = exportSelectedBanksV23;
    const deleteSelectedBtnV32 = $('#delete-selected-banks-v32');if (deleteSelectedBtnV32) { deleteSelectedBtnV32.onclick = deleteSelectedBanksV32; }

    renderBankToolbarV28();
  }

  /* v28.4.4: 导入配置 / 备份 JSON 入口已移动到设置/导出页，不再插入导入题库页。 */
  function ensureNativeRecoveryPanel() {
    if (!ShirohaPlatform.storage.snapshots || document.getElementById('native-recovery-panel')) { return; }

    const panel = document.createElement('div');panel.id = 'native-recovery-panel';panel.className = 'notice';
    const title = document.createElement('p');title.textContent = '本机恢复点：覆盖和重置前自动保留，不自动删除。恢复点不包含 API Key 或密码。';
    const select = document.createElement('select');select.setAttribute('aria-label', '本机恢复点');
    const refresh = document.createElement('button');refresh.textContent = '读取恢复点';
    const restore = document.createElement('button');restore.textContent = '恢复选中的数据';restore.disabled = true;
    const status = document.createElement('p');status.setAttribute('role', 'status');
    refresh.onclick = /* 查询恢复点期间锁定刷新按钮，到达后同步恢复操作的可用性。 */ async () => {
      refresh.disabled = true;try {
        const names = await ShirohaPlatform.storage.snapshots();select.replaceChildren();for (const name of names) { const option = document.createElement('option');option.value = name;option.textContent = name;select.appendChild(option); }

        restore.disabled = !names.length;status.textContent = names.length ? '恢复前会再次保留当前数据。' : '尚无恢复点。';
      } catch (error) { status.textContent = error.message; } finally { refresh.disabled = false; }
    };

    restore.onclick = () => runMutation(async () => {
      if (!select.value || !await ShirohaDialogs.confirm('用选中的恢复点替换当前题库和学习数据？当前数据会先保留为新的恢复点。')) { return; }

      await ShirohaPlatform.harness?.cancelAll();await ShirohaPlatform.saves.idle();await ShirohaPlatform.storage.restoreSnapshot(select.value);location.reload();
    });

    panel.append(title, refresh, select, restore, status);document.getElementById('settings').appendChild(panel);
    const repair = document.createElement('details');const summary = document.createElement('summary');summary.textContent = '数据无法读取时修复';repair.appendChild(summary);offerNativeRecovery(repair);panel.appendChild(repair);
  }

  // 装配设置页的备份恢复工具，并挂载原生侧支持的恢复入口。
  function ensureSettingsBackupPanelV23() {
    ensureNativeRecoveryPanel();
    if ($('#settings-backup-panel-v23')) { return; }

    const settingsCard = $('#settings .card');if (!settingsCard) { return; }

    settingsCard.insertAdjacentHTML('beforeend', `<div id="settings-backup-panel-v23" class="data-tools-v23">
    <h2>备份与恢复</h2>
    <p class="muted">设置页只处理完整数据备份：包含题库、错题本、收藏夹、练习记录和设置。单个题库或选中题库 JSON 请到“题库管理”页导出。</p>
    <div class="form-grid">
      <label>恢复方式<select id="settings-backup-mode-v23"><option value="merge">合并导入：保留当前数据，新增备份中的题库</option><option value="overwrite" selected>覆盖恢复：用备份替换当前本地数据</option></select></label>
      <label>备份范围<input disabled value="全部题库、错题本、收藏夹、记录、设置" /></label>
    </div>
    <div class="actions wrap-v23">
      <button class="ghost" id="settings-export-native-backup-v611" type="button">导出含图片备份 ZIP</button>
      <button class="ghost" id="settings-import-backup-v23" type="button">导入备份 JSON/ZIP</button>
      <button class="ghost" id="settings-copy-all-backup-v23" type="button">复制 Web 备份文本</button>
    </div>
    <p class="muted">提示：顶部“导出 Web 完整备份”用于 Web 端完整恢复；“含图片备份 ZIP”保存题库、图片及现有可交换学习数据，兼容旧版备份格式，不包含所有平台专属设置；复制文本只作为浏览器下载失败时的兜底。覆盖恢复会替换本机数据；合并导入遇到同名题库会自动追加“_导入”。</p>
    <details class="asset-reference-details"><summary>角色基准素材预览</summary><img src="./media/mascot_character_sheet.webp" alt="角色基准素材" /></details>
  </div>`);
    $('#settings-export-native-backup-v611').onclick = exportNativeCompatibleBackupZipV611;
    $('#settings-copy-all-backup-v23').onclick = copyAllBackupJsonV23;
    $('#settings-import-backup-v23').onclick = () => {
      backupImportModeV23 = $('#settings-backup-mode-v23')?.value || 'overwrite';$('#backup-json-file-v23').click();
    };

    const oldAll = $('#export-all-btn');if (oldAll) { oldAll.onclick = exportAllBackupV23; }

    webdavPanel.mount(settingsCard);
  }

  // 旧页面没有数据工具样式时按需补齐，避免重复注入。
  function injectDataToolsStyleV23() {
    if ($('#data-tools-style-v23')) { return; }

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

  // 汇总本次选择的题库和题目数，同步更新导出与清除选择的可用状态。
  function renderExportBankSummaryV23() {
    const summary = $('#export-bank-summary-v23');
    const selected = selectedBanksV23();const qCount = selected.reduce((n, b) => n + (b.questions || []).length, 0);
    const all = $('#export-bank-all-v23');if (all) { all.checked = state.banks.length > 0 && selected.length === state.banks.length;all.indeterminate = selected.length > 0 && selected.length < state.banks.length; }

    if (summary) { summary.textContent = selected.length ? `已选择 ${selected.length} 个题库，共 ${qCount} 道题。` : '请至少选择一个题库。';summary.className = `notice ${selected.length ? 'ok' : 'warn'}`; }

    const btn = $('#export-selected-banks-v23');if (btn) { btn.disabled = !selected.length; }

    const del = $('#delete-selected-banks-v32');if (del) { del.disabled = !selected.length; }
  }

  function selectedBanksV23() {
    return state.banks.filter((b) => exportBankSelectedV23.has(b.id));
  }

  function deleteSelectedBanksV32() {
    deleteBanksV32([...exportBankSelectedV23]);
  }

  // 将批量删库及依赖数据清理放在同一保存事务内。
  async function deleteBanksV32(ids) {
    return runMutation(/* 重新确认目标题库和用户选择后再清理，防止延迟操作影响其他题库。 */ async () => {
      const unique = [...new Set((ids || []).filter(Boolean))];
      const targets = state.banks.filter((b) => unique.includes(b.id));
      if (!targets.length) { toast('请先选择要删除的题库。', 'warn');return; }

      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      const preview = targets.slice(0, 4).map((b) => '“' + b.name + '”').join('、') + (targets.length > 4 ? ' 等' : '');
      if (!await ShirohaDialogs.confirm(`确定删除 ${targets.length} 个题库：${preview}？删除后不会影响已导出的备份，但本机数据不可恢复。`)) { return; }

      const delIds = new Set(targets.map((b) => b.id));
      state.banks = state.banks.filter((b) => !delIds.has(b.id));

      delIds.forEach((id) => {
        delete state.wrongBook[id];if (state.favorites) { delete state.favorites[id]; }

        if (state.crossPlatformMeta && state.crossPlatformMeta.favoriteQuestions) { delete state.crossPlatformMeta.favoriteQuestions[id]; }

        exportBankSelectedV23.delete(id);
      });

      if (!state.banks.length) { state.activeBankId = '';state.settings = { ...(state.settings || {}), suppressDefaultBank: true }; } else if (!state.banks.some((b) => b.id === state.activeBankId)) { state.activeBankId = state.banks[0]?.id || ''; }

      const beforeScope = normalizePracticeScopeV8916(state.settings && state.settings.practiceScope);ensurePracticeScopeV8916();const afterScope = practiceScopeV8916();
      await saveSilent();renderAll();
      const groupWasCleared = beforeScope.type === PRACTICE_SCOPE_GROUP_V8916 && afterScope.type === PRACTICE_SCOPE_BANK_V8916;
      toast(groupWasCleared ? `已删除 ${targets.length} 个题库。原练习分组已无题库，已切换为当前题库。` : `已删除 ${targets.length} 个题库。`, groupWasCleared ? 'warn' : 'ok');
    });
  }

  function cleanFileNameV23(s) {
    return String(s || '').replace(/* 将宿主不接受的文件名分隔符和通配字符替换为下划线。 */ /[\\/:*?"<>|]/g, '_').replace(/* 将连续空白折叠成单个下划线，使导出文件名便于使用。 */ /\s+/g, '_').slice(0, 80) || 'bank';
  }

  function todayV23() {
    return new Date().toISOString().slice(0, 10);
  }

  function buildQuestionBanksExportPayloadV598(banks) {
    const exported = (banks || []).map(serializeBankForCrossExportV53);
    if (exported.length === 1) { return exported[0]; }

    return { app: 'Shiroha Quiz', appVersion: APP_VERSION, schemaVersion: CURRENT_SCHEMA_VERSION, richContentVersion: RICH_CONTENT_VERSION_V57, richContentCapabilities: buildRichContentCapabilitiesV57(exported), exportType: 'question_banks', exportedAt: now(), banks: exported, activeBankId: exported.some((b) => b.id === state.activeBankId) ? state.activeBankId : (exported[0]?.id || '') };
  }

  // 加载所选题库后导出快照，避免导出仍在分页占位状态的数据。
  async function exportSelectedBanksV23() {
    try {
      if (!await loadNativeBanks(selectedBanksV23().map((b) => b.id))) { return; }

      const banks = selectedBanksV23();if (!banks.length) { toast('请至少选择一个题库。', 'warn');return; }

      const payload = buildQuestionBanksExportPayloadV598(banks);
      const text = JSON.stringify(payload, null, 2);setBackupPreviewV23(text);
      const name = banks.length === 1 ? `shiroha-quiz-bank-${cleanFileNameV23(banks[0].name)}-${todayV23()}.json` : `shiroha-quiz-question-banks-${todayV23()}.json`;
      await download(name, text);toast(`已导出 ${banks.length} 个题库 JSON。题库管理页导出的 JSON 只包含题库内容，不包含错题、收藏、记录和设置。`, 'ok');
    // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
    } catch (error) { platformStatus('导出失败：' + error.message, true);return false; }
  }

  // 完整读取题库及学习数据后导出 Web 备份，失败时保留数据与设置。
  async function exportAllBackupV23() {
    try {
      if (!await loadNativeAll()) { return; }

      const payload = buildBackupPayloadV23(state.banks || [], 'all_data', true);
      const text = JSON.stringify(payload, null, 2);setBackupPreviewV23(text);
      await download(`shiroha-quiz-all-data-${todayV23()}.json`, text);toast('已生成全部数据备份。手机端若未弹出下载，可复制文本框内容。', 'ok');
    // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
    } catch (error) { platformStatus('导出失败：' + error.message, true);return false; }
  }

  // 完整加载后生成原生兼容 ZIP，确保备份含试题、学习记录和相关资源。
  async function exportNativeCompatibleBackupZipV611() {
    try {
      if (!await loadNativeAll()) { return; }

      try {
        const result = buildNativeCompatibleBackupZipV611();
        setBackupPreviewV23(JSON.stringify(result.payload, null, 2));
        await downloadBlob(`shiroha-quiz-native-backup-${todayV23()}.zip`, result.blob);
        toast(`已生成含图片备份 ZIP。${result.assetCount ? `已外置 ${result.assetCount} 张图片。` : '当前没有需要外置的图片。'}`, 'ok');
      } catch (err) {
        warnDev('导出含图片备份 ZIP 失败', err);
        toast('导出含图片备份 ZIP 失败，请先使用完整 JSON 备份。', 'danger');
      }
    // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
    } catch (error) { platformStatus('导出失败：' + error.message, true);return false; }
  }

  async function copyAllBackupJsonV23() {
    if (!await loadNativeAll()) { return; }

    const text = JSON.stringify(buildBackupPayloadV23(state.banks || [], 'all_data', true), null, 2);setBackupPreviewV23(text);
    await copyTextV23(text, '已复制全部数据备份文本。');
  }

  async function copyTextV23(text, okMsg) {
    try { await navigator.clipboard.writeText(text);toast(okMsg, 'ok'); } catch { toast('浏览器不允许自动复制，请手动复制下方文本。', 'warn'); }
  }

  function setBackupPreviewV23(text) {
    const out = $('#export-output');if (out) { out.value = text; }
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
      if (homeVersionLabel) { homeVersionLabel.textContent = label; }

      const nodes = [...root.querySelectorAll('h1,h2,h3,h4,b,strong,span,p,div')];
      nodes.forEach(/* 仅替换安全的版本文本节点，避开脚本、样式与用户输入内容。 */ (el) => {
        if (!el || /* 不在脚本、样式和表单控件的内容里替换旧版本标签。 */ /^(SCRIPT|STYLE|INPUT|TEXTAREA|SELECT|OPTION)$/i.test(el.tagName || '')) { return; }

        const txt = (el.textContent || '').trim();
        if (!txt) { return; }

        const leaf = el.children.length === 0;
        if (leaf && /* 识别不带明确新式分隔符的 V29 旧标题。 */ /^V\s*29\s*[:：]?\s*基本完成版$/.test(txt)) { el.textContent = label; } else if (leaf && /* 兼容带冒号的任意旧版“基本完成版”标题。 */ /^V\s*\d+\s*[:：]\s*基本完成版$/.test(txt)) { el.textContent = label; }
      });
    } catch { /* 版本提示同步失败不应阻断页面启动。 */ }
  }

  function init() {
    upgradeState();ensureAiImportStateV99();ensureDefaultBank();ensureBankGroupUiV58();bindNav();bindEvents();bindMultiBlankEditorV58914();bindV25ToV28Events();ensureV25ToV28Panels();setupSidebarCollapse();setupEnhancedDataToolsV23();renderAll();updateShellLayoutByView();syncHomeVersionPromptV586();setTimeout(syncHomeVersionPromptV586, 80);setTimeout(syncHomeVersionPromptV586, 300);
  }

  function defaultBank() {
    const qb = window.questionBank || { meta: { title: '内置题库（按需加载）' }, questions: [] };
    const qs = Array.isArray(qb.questions) ? qb.questions : [];
    return { id: 'default-c1', name: qs.length ? (qb.meta?.title || '默认题库') : '内置题库（待加载）', groupName: '', createdAt: now(), updatedAt: now(), questions: qs.map(normalizeQuestion), builtInLazy: !qs.length };
  }

  // 迁移已读状态的字段与题库分组，防止归一化改写尚未加载的原生题目。
  function upgradeState() {
    for (const entry of nativePages.values()) { entry.page = 0;entry.key = ''; }

    state.schemaVersion = CURRENT_SCHEMA_VERSION;
    state.banks = Array.isArray(state.banks) ? state.banks : [];
    state.records = Array.isArray(state.records) ? state.records : [];
    state.wrongBook = state.wrongBook && typeof state.wrongBook === 'object' ? state.wrongBook : {};
    state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    state.settings.aiImportV99 = normalizeAiConfigV99(state.settings.aiImportV99);
    state.settings.practiceProgressV58916 = state.settings.practiceProgressV58916 && typeof state.settings.practiceProgressV58916 === 'object' && !Array.isArray(state.settings.practiceProgressV58916) ? state.settings.practiceProgressV58916 : {};
    state.favorites = state.favorites && typeof state.favorites === 'object' ? state.favorites : {};
    state.crossPlatformMeta = state.crossPlatformMeta && typeof state.crossPlatformMeta === 'object' ? state.crossPlatformMeta : { favoriteQuestions: {} };
    state.crossPlatformMeta.favoriteQuestions = state.crossPlatformMeta.favoriteQuestions && typeof state.crossPlatformMeta.favoriteQuestions === 'object' ? state.crossPlatformMeta.favoriteQuestions : {};
    for (const b of state.banks) {
      b.groupName = pickBankGroupNameFromJsonV58(b);
      b.questions = (b.questions || []).map((q, i) => (ShirohaPlatform.storage?.isQuestionLoaded && !ShirohaPlatform.storage.isQuestionLoaded(b.id, q.id) ? q : ({ ...q, ...normalizeQuestion(q, i), id: q.id || makeId('q', i), number: q.number || i + 1 })));

      b.updatedAt = b.updatedAt || b.createdAt || now();
    }

    for (const bid of Object.keys(state.wrongBook)) {
      const val = state.wrongBook[bid];
      if (Array.isArray(val)) {
        state.wrongBook[bid] = val.map((x) => (typeof x === 'string' ? { id: x, wrongCount: 1, rightCount: 0, reviewRightCount: 0, streakCorrectCount: 0, lastWrongAt: '', lastCorrectAt: '', lastReviewedAt: '', nextReviewAt: '', reviewLevel: 0, lastAnswer: [], source: 'web', timestamp: 0, status: '未掌握' } : { ...x, id: x.id, wrongCount: Number(x.wrongCount || 1), rightCount: Number(x.rightCount || 0), reviewRightCount: Number(x.reviewRightCount || 0), streakCorrectCount: Number(x.streakCorrectCount || 0), lastWrongAt: x.lastWrongAt || '', lastCorrectAt: x.lastCorrectAt || '', lastReviewedAt: x.lastReviewedAt || '', nextReviewAt: x.nextReviewAt || '', reviewLevel: Number(x.reviewLevel || 0), lastAnswer: Array.isArray(x.lastAnswer) ? x.lastAnswer : [], source: x.source || 'web', timestamp: Number(x.timestamp || 0), status: x.status || '未掌握' })).filter((x) => x.id);
      } else { state.wrongBook[bid] = []; }
    }

    for (const bid of Object.keys(state.favorites)) { state.favorites[bid] = Array.isArray(state.favorites[bid]) ? [...new Set(state.favorites[bid].filter(Boolean))] : []; }

    ensurePracticeScopeV8916();
  }

  function serializeState() {
    return JSON.stringify({ ...state, schemaVersion: CURRENT_SCHEMA_VERSION, favorites: state.favorites || {} });
  }

  function renderAll() {
    ensureBankGroupUiV58();ensurePracticeScopeV8916();updateAiConnectionPillV99();syncAiImportActionV99();renderStats();renderBankSelect();renderMergeSelect();renderBankList();renderBankPreview();renderWrongBook();renderFavoritesPageV596();renderRecords();renderRecentTraining();renderBankInputs();renderBuiltInPanelV252();renderPracticeScopeUiV8916();if (typeof renderExportBankSelectorV23 === 'function') { renderExportBankSelectorV23(); }

    renderImportTargetBankOptionsV59();syncImportAppendUiV59();syncHomeVersionPromptV586();syncPracticeStartUiV58916(true);
  }

  function bindV25ToV28Events() {
    ['#load-built-in-bank-btn', '#load-built-in-bank-btn-banks'].forEach((sel) => {
      const btn = $(sel);if (btn) { btn.onclick = () => loadBuiltInBankV252(); }
    });
  }

  function ensureV25ToV28Panels() {
    ensureBuiltInPanelV252();
    ensureFavoritePanelV27();
  }

  // 为旧版设置页按需补上内置题库导入面板，复用已有面板实例。
  function ensureBuiltInPanelV252() {
    if ($('#builtin-bank-panel-v252')) { return; }

    const bankList = $('#bank-list');if (!bankList) { return; }

    bankList.insertAdjacentHTML('beforebegin', '<div id="builtin-bank-panel-v252" class="builtin-bank-card-v252 compact-built-in-v33"><div class="section-head compact-head-v23"><div><h3>内置 C1 题库</h3><p class="muted">本地没有 C1 题库时，可重新加入。</p></div><button id="load-built-in-bank-btn-panel" class="primary" type="button">加载内置 C1 题库</button></div><div id="builtin-bank-status-v252" class="muted"></div></div>');
    $('#load-built-in-bank-btn-panel').onclick = () => loadBuiltInBankV252();
  }

  // 根据已经存在的内置题库和来源可用性更新界面状态。
  function renderBuiltInPanelV252() {
    const panel = $('#builtin-bank-panel-v252');
    const el = $('#builtin-bank-status-v252');if (!el) { return; }

    const has = state.banks.some((b) => b.id === 'default-c1' && (b.questions || []).length > 0) || state.banks.some((b) => /* 兼容按显示名称保存的旧内置题库，即使历史版本未使用固定 ID。 */ /C1驾照科目一/.test(b.name || ''));
    if (panel) { panel.hidden = !!has; }

    el.textContent = has ? '已加载，可直接使用。' : '当前未加入 C1 题库。';
  }

  async function fetchJsonLocalV252(url) {
    return ShirohaPlatform.resourceJson(url);
  }

  // 在保存事务中装入内置题库，失败时原题库不会被半写入替换。
  async function loadBuiltInBankV252() {
    return runMutation(/* 选择可用的内置数据来源并在通过格式检查后替换或新增题库。 */ async () => {
      try {
        let data = null;
        let item = null;
        try {
          const index = window.questionBankIndex || await fetchJsonLocalV252('data/banks-index.json');
          item = (index || [])[0];
          if (item) { data = await fetchJsonLocalV252(item.file || 'data/c1-full.json'); }
        } catch (fetchErr) {
          warnDev('按需读取内置题库 JSON 失败，转用 question-bank.js 内置兜底数据。', fetchErr);
        }

        if (!data && window.questionBank && Array.isArray(window.questionBank.questions)) {
          data = window.questionBank;
          item = (window.questionBankIndex || [])[0] || { name: data.meta?.title || 'C1 驾照科目一模拟练习题库' };
        }

        if (!data) { throw new Error('未找到内置题库数据'); }

        const questions = (data.questions || []).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
        if (!questions.length) { throw new Error('内置题库为空'); }

        const bank = { id: 'default-c1', name: data.meta?.title || item?.name || '默认题库', groupName: '', createdAt: now(), updatedAt: now(), questions, builtInLazy: false };
        const old = state.banks.findIndex((b) => b.id === 'default-c1' || b.builtInLazy);
        if (old >= 0) { state.banks[old] = bank; } else { state.banks.push(bank); }

        state.settings = { ...(state.settings || {}), suppressDefaultBank: false };
        setPracticeBankScopeV8916(bank.id, true);await saveSilent();renderAll();toast(`已加载内置题库：${bank.name}，共 ${bank.questions.length} 题。`, 'ok');
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      } catch (e) { warnDev('加载内置题库失败', e);toast('加载内置题库失败：' + e.message, 'danger'); }
    });
  }

  /* SHIROHA_WEB_PRACTICE_AI_SINGLE_QUESTION_V613_START
   沉浸练习页的单题 AI 解析与追问：只处理当前这一道题，结果先作为草稿展示，由用户决定是否写入题库解析。 */

  // 构造带新解析的题目副本，并让富文本解析与普通解析保持一致。
  function aiSingleWithAnalysisV613(question, text) {
    const next = { ...question, analysis: text };
    const field = buildRichContentFieldV57(text, 'analysis', []);
    if (question.richContent?.fields || field) {
      const fields = { ...question.richContent?.fields };
      if (field) { fields.analysis = field; } else { delete fields.analysis; }

      const features = [...new Set(Object.values(fields).flatMap((value) => (Array.isArray(value) ? value.filter(Boolean).flatMap((entry) => entry.features || []) : (value?.features || []))))];
      next.richContent = { ...question.richContent, schema: question.richContent?.schema || RICH_CONTENT_VERSION_V57, fields, features };
    }

    return next;
  }

  // 从当前练习或复盘入口保存 AI 草稿，校验它仍对应来源题目的快照。
  async function saveAiSingleAnalysisV613(reviewSession = null) {
    return runMutation(/* 确认解析可保存后同步相关题目副本，并允许写入失败时回滚。 */ async () => {
      const item = reviewSession ? reviewSession.item : currentPracticeItemV8916();if (!reviewSession && !aiSingleAllowedV613(item)) { return false; }

      const key = practiceItemKeyV8916(item); const session = reviewSession || aiSingleSessionV613(key); const text = String(session.analysis?.analysis || '').trim();
      const render = reviewSession ? updateReviewAnalysisPanels : renderPracticeAiPanelV613;
      if (!text || session.loading) { return false; }

      const loc = reviewSession ? reviewAnalysisSource(item) : findPracticeQuestionLocationV120(item);
      if (!loc.bank || loc.index < 0) { session.error = '来源题库或题目不存在，无法保存；AI 草稿已保留。';render();return false; }

      const target = loc.bank.questions[loc.index];
      if (aiSingleFingerprintV613(target) !== session.fingerprint) { session.error = '来源题目已发生变化，请重新生成后再保存。';render();return false; }

      if (String(target.analysis || '').trim() && target.analysis !== text && !await ShirohaDialogs.confirm('这道题已有解析，是否用当前 AI 草稿替换？题干、选项和答案不会改变。')) { return false; }

      const patches = []; const seen = new WeakMap();
      // 同一对象属性只记录第一次旧值，防止回滚时恢复到半更新状态。
      const patch = (object, property, value) => {
        if (!object) { return; }

        let keys = seen.get(object);if (!keys) { keys = new Set();seen.set(object, keys); }

        if (keys.has(property)) { return; }

        keys.add(property);patches.push({ object, property, had: Object.prototype.hasOwnProperty.call(object, property), old: object[property] });object[property] = value;
      };

      const next = aiSingleWithAnalysisV613(target, text);
      patch(loc.bank.questions, loc.index, next);patch(loc.bank, 'updatedAt', now());
      (practiceSession.current.items || []).forEach((value, index) => {
        const q = practiceQuestionV8916(value);if (practiceItemBankIdV8916(value) === loc.bankId && q?.id === target.id) { if (value.question && typeof value.question === 'object') { patch(value, 'question', aiSingleWithAnalysisV613(q, text)); } else { patch(practiceSession.current.items, index, aiSingleWithAnalysisV613(q, text)); } }
      });

      (examSession.current.items || []).forEach((value, index) => {
        const q = examQuestionV113(value);if (practiceItemBankIdV8916(value) === loc.bankId && q?.id === target.id) { if (value.question && typeof value.question === 'object') { patch(value, 'question', aiSingleWithAnalysisV613(q, text)); } else { patch(examSession.current.items, index, aiSingleWithAnalysisV613(q, text)); } }
      });

      (state.wrongBook[loc.bankId] || []).forEach((entry) => {
        if (entry.id === target.id && entry.nativeQuestion) { patch(entry, 'nativeQuestion', aiSingleWithAnalysisV613(entry.nativeQuestion, text)); }
      });

      const favorite = state.crossPlatformMeta?.favoriteQuestions?.[loc.bankId]?.[target.id];
      if (favorite?.question) { patch(favorite, 'question', aiSingleWithAnalysisV613(favorite.question, text)); }

      try { await saveSilent(); } catch {
        for (const change of patches.reverse()) { if (change.had) { change.object[change.property] = change.old; } else { delete change.object[change.property]; } }

        session.error = '保存失败，本地题库改动已回滚，AI 草稿仍保留。请检查本地存储空间后重试。';session.notice = '';render();return false;
      }

      session.error = '';session.notice = '已写入题库解析，可在题库管理与导出中看到。';
      if (reviewSession) { session.saved = true;render();return true; }

      const q = practiceQuestionV8916(item); const st = getPracticeAnswerStateV26(key);
      // 保存解析不代表提交答案；总提交和未进入自评的简答题继续保留答题草稿。
      if (practiceSession.current.submitMode === 'total') { renderPracticeAiPanelV613(); } else if (q.type === 'short' && !st.answered && $('#p-self-right')) { showSubjectiveFeedback(item, st.chosen || [], !!st.revealed); } else if (st.answered || st.revealed) { showAnsweredStateV26(q, st); } else { renderPracticeAiPanelV613(); }

      showNotice('AI 单题解析', '已写入本题题库解析。', 'ok');
      return true;
    });
  }
  /* SHIROHA_WEB_PRACTICE_AI_SINGLE_QUESTION_V613_END */

  function reviewAnalysisSource(item) {
    const q = practiceQuestionV8916(item); const bankId = item.bankId || '';
    const bank = state.banks.find((value) => value.id === bankId) || null;
    return { q, bankId, bank, index: bank ? (bank.questions || []).findIndex((value) => value.id === q.id) : -1 };
  }

  function getFavoriteIdsV27(bid = activeBank().id) {
    state.favorites = state.favorites || {};return Array.isArray(state.favorites[bid]) ? state.favorites[bid] : [];
  }

  // 使当前题库的收藏 ID 和跨端收藏元数据保持同步。
  function setFavoriteIdsV27(ids, bid = activeBank().id) {
    state.favorites = state.favorites || {};state.crossPlatformMeta = state.crossPlatformMeta && typeof state.crossPlatformMeta === 'object' ? state.crossPlatformMeta : { favoriteQuestions: {} };state.crossPlatformMeta.favoriteQuestions = state.crossPlatformMeta.favoriteQuestions && typeof state.crossPlatformMeta.favoriteQuestions === 'object' ? state.crossPlatformMeta.favoriteQuestions : {};const next = [...new Set((ids || []).filter(Boolean))];state.favorites[bid] = next;const meta = state.crossPlatformMeta.favoriteQuestions[bid] && typeof state.crossPlatformMeta.favoriteQuestions[bid] === 'object' ? state.crossPlatformMeta.favoriteQuestions[bid] : {};Object.keys(meta).forEach((qid) => {
      if (!next.includes(qid)) { delete meta[qid]; }
    });

    next.forEach((qid) => {
      if (!meta[qid]) { meta[qid] = { favoritedAt: Date.now() }; }
    });

    state.crossPlatformMeta.favoriteQuestions[bid] = meta;
  }

  function isFavoriteV27(id, bid = activeBank().id) {
    return getFavoriteIdsV27(bid).includes(id);
  }

  async function toggleFavoriteV27(id, bid = activeBank().id) {
    return runMutation(async () => {
      const ids = getFavoriteIdsV27(bid);if (ids.includes(id)) { setFavoriteIdsV27(ids.filter((x) => x !== id), bid); } else { setFavoriteIdsV27([...ids, id], bid); }

      await saveSilent();toast(ids.includes(id) ? '已取消收藏。' : '已收藏题目。', 'ok');
    });
  }

  function ensureFavoritePanelV27() {
    return;
  }

  async function clearCurrentFavoritesV596() {
    return runMutation(async () => {
      const count = getFavoriteIdsV27().length;if (!count) { toast('当前题库暂无收藏题。', 'warn');return; }

      if (await ShirohaDialogs.confirm(`确定清空当前题库的 ${count} 道收藏题？`)) { setFavoriteIdsV27([]);await saveSilent();renderAll();toast('已清空当前题库收藏。', 'ok'); }
    });
  }

  // 只导出兼容设置字段，AI 配置的认证信息继续由凭据层持有。
  function exportSettingsV1(settings) {
    const result = {};
    for (const key of ['suppressDefaultBank', 'practiceScope', 'practiceProgressV58916', 'lastMigratedFromSchema', 'lastMigratedAt', 'migratedFromStorageKey']) { if (settings?.[key] !== undefined) { result[key] = structuredClone(settings[key]); } }

    if (settings?.aiImportV99) { result.aiImportV99 = {};for (const key of ['provider', 'endpoint', 'model', 'timeoutSeconds', 'rememberKey']) { if (settings.aiImportV99[key] !== undefined) { result.aiImportV99[key] = settings.aiImportV99[key]; } } }

    return result;
  }

  /* SHIROHA_WEB_V24_CROSS_PLATFORM_NATIVE_INTEROP */
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

  const buildNativeCompatibleBackupZipV611 = () => backupData.buildNativeCompatibleBackupZipV611(state);

  const { normalizeBackupPayloadV23 } = backupData;
  const mergeBackupBanksV23 = (normalized) => backupData.mergeBackupBanksV23(state, normalized);

  function download(name, text) {
    const out = $('#export-output');if (out) { out.value = text; }

    return ShirohaPlatform.download(name, new Blob([text], { type: 'application/json;charset=utf-8' }));
  }

  function downloadBlob(name, blob) {
    return ShirohaPlatform.download(name || 'download.bin', blob);
  }

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
    return new Blob([zipStoreFiles(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function docxParagraphXml(line) {
    const text = String(line ?? '');
    return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }

  function xmlEscape(s) {
    return String(s ?? '').replace(/* 转义会改变 DOCX XML 结构的字符，让 OCR 内容只作为文本解释。 */ /[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));
  }

  // 调用方须先进入页面写入事务，确保两个导入入口共用保存和失败回滚边界。
  async function applyBackupImportV23(normalized, mode, unresolvedImageCount = 0) {
    if (unresolvedImageCount && ShirohaPlatform.storage.checkpoint) { throw new Error('备份缺少图片，尚未更改本地数据。请补齐原始图片后重试。'); }

    if (!normalized.banks.length) { toast('没有在 JSON 中找到可导入的题库。', 'warn');return; }

    const previousStateJson = JSON.stringify(state);
    if (mode === 'overwrite') {
      if (!await ShirohaDialogs.confirm(`覆盖恢复会清空当前本地数据，并导入 ${normalized.banks.length} 个题库。确定继续？`)) { return; }

      if (!await loadNativeAll()) { throw new Error('恢复前读取失败，原数据已保留。'); }

      await ShirohaPlatform.storage.checkpoint?.();
      await ShirohaPlatform.harness?.cancelAll();
      if (ShirohaPlatform.credentials.native) { await ShirohaPlatform.credentials.reset(); }

      const previousWebSettings = state.settings && typeof state.settings === 'object' ? state.settings : {};state.schemaVersion = CURRENT_SCHEMA_VERSION;state.banks = normalized.banks.map((b) => ({ ...b, groupName: normalizeBankGroupNameV58(b.groupName) }));

      state.activeBankId = normalized.activeBankId || state.banks[0]?.id || '';state.wrongBook = normalized.wrongBook || {};state.favorites = normalized.favorites || {};state.records = Array.isArray(normalized.records) ? normalized.records : [];state.settings = normalized.hasWebSettings && normalized.settings && typeof normalized.settings === 'object' ? normalized.settings : previousWebSettings;state.crossPlatformMeta = normalized.crossPlatformMeta && typeof normalized.crossPlatformMeta === 'object' ? normalized.crossPlatformMeta : { favoriteQuestions: {} };
    } else {
      mergeBackupBanksV23(normalized);
    }

    upgradeState();ensureDefaultBank();
    try { await saveSilent(); } catch {
      const previous = JSON.parse(previousStateJson);Object.keys(state).forEach((k) => delete state[k]);

      Object.assign(state, previous);upgradeState();throw new Error('导入内容超过浏览器本地存储容量，已恢复导入前数据。可减少图片后重试，或只导入部分题库。');
    }

    setupEnhancedDataToolsV23();renderAll();
    const total = normalized.banks.reduce((n, b) => n + (b.questions || []).length, 0);
    toast(`导入完成：${normalized.banks.length} 个题库，${total} 道题。${unresolvedImageCount ? ` 另有 ${unresolvedImageCount} 张图片未包含在备份文件中，Web 端无法显示。` : ''}`, unresolvedImageCount ? 'warn' : 'ok');
  }

  // 在文件选择事件后按当前模式读取、检查和应用兼容备份。
  function importBackupJsonFileV23(e) {
    const file = e.target.files && e.target.files[0];if (!file) { return; }

    // 启动不返回给 DOM 事件的异步导入，并把错误收敛到事务中的用户提示。
    (async () => runMutation(/* 在解析和关联备份资源后才应用导入，失败时保留可重试的文件选择。 */ async () => {
      try {
        const loaded = await readBackupFileV24(file);const { text } = loaded;
        setBackupPreviewV23(text);
        const data = JSON.parse(text);const assets = loaded.assets || {};
        if (Object.keys(assets).length) { applyBackupAssetsV24(data, assets); }

        const unresolvedImageCount = countUnresolvedBackupImagesV24(data);const normalized = normalizeBackupPayloadV23(data, file.name);
        await applyBackupImportV23(normalized, backupImportModeV23 || 'merge', unresolvedImageCount);
      // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
      } catch (err) { toast('导入备份失败：' + err.message, 'danger'); } finally { if (!mutationSaveError) { e.target.value = ''; } }
    }))();
  }

  /* SHIROHA_WEB_V37_8_WEBDAV_CLOUD_BACKUP_START
   v37.8: 手动 WebDAV 完整备份、远程历史列表与事务恢复。
*/
  async function storeWebdavConfigV378(config, password, storePassword = true) {
    const safe = { ...defaultWebdavConfigV378(), ...config };delete safe.password;delete safe.authorization;
    const undo = await ShirohaPlatform.credentials.saveDav(safe, password, storePassword);
    if (ShirohaPlatform.credentials.native) {
      const previous = state.serviceConfigurations;state.serviceConfigurations = { ...previous, webdav: safe };
      try { await saveSilent(ShirohaPlatform.credentials.operationId?.(undo)); } catch (error) { state.serviceConfigurations = previous;await undo?.();throw error; }

      if (undo) { await ShirohaPlatform.credentials.finalize(undo); }

      ShirohaPlatform.credentials.updateDav(safe);
    }
  }

  // 清除备份恢复前的 WebDAV 配置，按照平台凭据接口完成后续处理。
  async function clearWebdavStorageV378() {
    const undo = await ShirohaPlatform.credentials.clearDav();
    if (ShirohaPlatform.credentials.native) {
      const previous = state.serviceConfigurations;state.serviceConfigurations = { ...previous };delete state.serviceConfigurations.webdav;
      try { await saveSilent(ShirohaPlatform.credentials.operationId?.(undo)); } catch (error) { state.serviceConfigurations = previous;await undo?.();throw error; }

      if (undo) { await ShirohaPlatform.credentials.finalize(undo); }

      ShirohaPlatform.credentials.updateDav(null);
    }
  }

  // 执行备份合并或替换前保留可恢复快照，使失败不会留下半写入状态。
  async function applyNormalizedBackupV378(normalized, mode) {
    return runMutation(/* 区分合并和覆盖的前置步骤，数据保存成功之前保留旧状态及回滚路径。 */ async () => {
      let previousStateJson;try { previousStateJson = JSON.stringify(state); } catch { throw new Error('当前本地数据过大，无法创建恢复前回滚快照。请先导出本地完整备份。'); }

      try {
        if (mode === 'overwrite') {
          if (!await loadNativeAll()) { throw new Error('恢复前读取失败，原数据已保留。'); }

          await ShirohaPlatform.storage.checkpoint?.();
          await ShirohaPlatform.harness?.cancelAll();
          if (ShirohaPlatform.credentials.native) { await ShirohaPlatform.credentials.reset(); }

          const previousWebSettings = state.settings && typeof state.settings === 'object' ? state.settings : {};state.schemaVersion = CURRENT_SCHEMA_VERSION;state.banks = normalized.banks.map((b) => ({ ...b, groupName: normalizeBankGroupNameV58(b.groupName) }));

          state.activeBankId = normalized.activeBankId || state.banks[0]?.id || '';state.wrongBook = normalized.wrongBook || {};state.favorites = normalized.favorites || {};state.records = Array.isArray(normalized.records) ? normalized.records : [];state.settings = normalized.hasWebSettings && normalized.settings && typeof normalized.settings === 'object' ? normalized.settings : previousWebSettings;state.crossPlatformMeta = normalized.crossPlatformMeta && typeof normalized.crossPlatformMeta === 'object' ? normalized.crossPlatformMeta : { favoriteQuestions: {} };
        } else { mergeBackupBanksV23(normalized); }

        upgradeState();ensureDefaultBank();await saveSilent();
      } catch {
        const previous = JSON.parse(previousStateJson);Object.keys(state).forEach((k) => delete state[k]);

        Object.assign(state, previous);upgradeState();throw new Error('恢复内容未能写入浏览器本地存储，已回滚到恢复前数据。请检查本地存储空间，或减少备份中的大图片。');
      }
    });
  }

  const webdavPanel = globalThis.ShirohaWebdavPanel.create({
    platform: ShirohaPlatform,
    storeWebdavConfigV378,
    clearWebdavStorageV378,
    loadNativeAll,
    getState: () => state,

    buildBackupPayloadV23,
    normalizeBackupPayloadV23,
    applyNormalizedBackupV378,
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
    if (!btn) { return; }

    const collapsed = document.body.classList.contains('side-collapsed');
    btn.textContent = collapsed ? '展开导航' : '收起导航';
    btn.setAttribute('aria-label', collapsed ? '展开左侧导航' : '收起左侧导航');
    btn.setAttribute('aria-pressed', String(collapsed));
  }

  function setSidebarCollapsedV47(collapsed, persist = false) {
    document.body.classList.toggle('side-collapsed', !!collapsed);
    if (persist) { try { ShirohaPlatform.preferences.setSidebar(document.body.classList.contains('side-collapsed')); } catch { platformStatus('侧栏设置保存失败，请检查浏览器存储权限。', true); } }

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
    if ($('#sidebar-toggle')) { return; }

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

    if (!card || !rail) { return; }

    if (window.innerWidth < 1280) { rail.style.removeProperty('top');rail.style.removeProperty('max-height');return; }

    const top = Math.max(12, Math.round(card.getBoundingClientRect().top));
    rail.style.setProperty('top', `${top}px`, 'important');
    rail.style.setProperty('max-height', `calc(100vh - ${top + 18}px)`, 'important');
  }

  let focusRailSyncBoundV35 = false;
  // 全局只绑定一次专注栏重算监听，供滚动和窗口尺寸变化共用。
  function setupFocusRailSyncV35() {
    if (focusRailSyncBoundV35) { return; }

    focusRailSyncBoundV35 = true;
    let ticking = false;
    // 让多个布局事件在同一动画帧合并，避免重复测量。
    const schedule = () => {
      if (ticking) { return; }

      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;syncFocusRailTopV35();
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
      if (kind === 'practice') { document.body.classList.toggle('practice-rail-collapsed-v34'); }

      if (kind === 'exam') { document.body.classList.toggle('exam-rail-collapsed-v34'); }

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
      if (!await ShirohaDialogs.confirm('确定清除全部本地数据？默认题库也会重新初始化。')) { return; }

      await ShirohaPlatform.saves.idle();await clearStoredState();
      try { await importDraftPersistence.clearForReset(); } catch { await ShirohaDialogs.alert('题库数据已清除，但本机导入草稿未能清除，请刷新后手动删除草稿。'); }

      location.reload();
    });
  }

  /* SHIROHA_WEB_V45_BANK_EDITOR_AND_FOCUS_NAV_START */
  async function switchViewV45(viewId, resumePractice = true) {
    const view = viewId && $(`#${viewId}`);
    if (!view) { return; }

    if (viewId !== 'practice' && !await canLeaveTotalPractice(viewId)) { return; }

    cancelPendingViewActions(viewId);
    if (viewId !== 'practice') { exitPracticeFocus(); }

    if (viewId !== 'exam') { exitExamFocus(); }

    if (viewId !== 'training-review') { leaveTrainingReview(); }

    $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === viewId));

    $$('.view').forEach((v) => v.classList.toggle('active', v === view));

    const nav = document.querySelector(`[data-view="${viewId}"]`);
    const title = $('#page-title');
    if (title && nav) { title.textContent = nav.textContent; }

    updateShellLayoutByView(viewId);releaseNativeView();renderNativeView();
    if (viewId === 'practice' && resumePractice && practiceSession.current.items.length && !practiceSession.current.completed) { enterPracticeFocus();renderPracticeQuestion(); }

    if (viewId === 'ai-settings') { renderAiSettingsV99(); }

    if (viewId === 'import') { syncAiImportActionV99(); }

    resetViewScrollV282();
  }

  /* SHIROHA_WEB_V45_BANK_EDITOR_AND_FOCUS_NAV_END */

  // 页面拥有单个写入事务；保存期间冻结交互，避免失败回滚覆盖后续编辑。
  // 仅 action 的同步调用链可加入当前事务；action 返回或抛错时立即重置，异步期间仍由 mutationBusy 独占。
  let mutationBusy = false; let enteringMutation = false; let mutationSaveError = null; let applicationReady = false;
  // 启动代次只属于当前窗口；恢复后的新启动不能沿用旧冷启动检查。
  let applicationStarted = false;
  let applicationGeneration = 0;
  let retryMutation = null;
  // 将平台读写状态呈现在可访问的通知区，失败时保留对应样式。
  function platformStatus(message, failed = false) {
    let el = document.getElementById('platform-status');
    if (!el) { el = document.createElement('div');el.id = 'platform-status';el.setAttribute('role', 'status');el.setAttribute('aria-live', 'polite');document.body.appendChild(el); }

    el.textContent = message;el.className = `platform-status${failed ? ' failed' : ''}`;el.hidden = !message;
    if (failed && retryMutation) {
      const retry = document.createElement('button');retry.textContent = '重试';retry.onclick = () => retryMutation();

      el.appendChild(retry);
    }
  }

  function lockApplication(locked) {
    document.querySelector('.app')?.toggleAttribute('inert', locked);document.body.dataset.storageState = locked ? 'pending' : 'ready';refreshAnswerOptionControls();
  }

  // 记录普通对象图的属性与数组长度，便于恢复原对象身份而非替换对象。
  function mutationCheckpoint(roots) {
    const seen = new Set(); const entries = [];
    const visit = (value) => {
      if (!value || typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) { return; }

      seen.add(value);const fields = Object.entries(value);entries.push({ value, fields, length: Array.isArray(value) ? value.length : null });fields.forEach(([,child]) => visit(child));
    };

    roots.forEach(visit);
    return /* 回滚时恢复原对象属性与长度，清除事务期间新增的字段。 */ () => {
      for (const { value, fields, length } of entries) {
        Object.keys(value).forEach((key) => delete value[key]);

        if (length !== null) { value.length = length; }

        for (const [key, child] of fields) { value[key] = child; }
      }
    };
  }

  // 串行保护需要保存的数据变更，确认修订未推进时才恢复原快照。
  async function runMutation(action) {
    if (enteringMutation) { return action(); }

    if (mutationBusy || !applicationReady) { return false; }

    mutationBusy = true;mutationSaveError = null;lockApplication(true);platformStatus('正在保存，请勿关闭页面…');
    await Promise.allSettled([...nativeReads]);
    const rollbackView = ShirohaPlatform.storage.checkpointView?.();
    const disabledBefore = [...document.querySelectorAll('button,input,select,textarea')].map((el) => [el, el.disabled]);
    const exportSelectionBefore = new Set(exportBankSelectedV23);
    const practiceBefore = practiceSession.current; const examBefore = examSession.current;
    const rollback = mutationCheckpoint([state, practiceBefore, examBefore]);
    const revisionBefore = ShirohaPlatform.storage.revision();
    const focused = document.activeElement;
    try {
      ShirohaPlatform.saves.resume();
      enteringMutation = true;let result;
      try { result = action(); } finally { enteringMutation = false; }

      const value = await result;
      if (mutationSaveError) { throw mutationSaveError; }

      retryMutation = null;platformStatus('');return value === undefined ? true : value;
    } catch (error) {
      if (ShirohaPlatform.storage.revision() !== revisionBefore) { mutationSaveError = null;retryMutation = null;platformStatus('数据已保存，但界面刷新失败，请重新打开页面。', true);return false; }

      rollback();
      if (practiceSession.current !== practiceBefore) { practiceSession.current = practiceBefore;if (practiceBefore.clock?.state === 'running') { startPracticeClockTicker(); } }

      if (examSession.current !== examBefore) { examSession.current = examBefore;startExamTicker(examBefore); }

      rollbackView?.();exportBankSelectedV23 = exportSelectionBefore;disabledBefore.forEach(([el, disabled]) => {
        if (el.isConnected) { el.disabled = disabled; }
      });

      retryMutation = () => runMutation(action);

      platformStatus(error?.message || '保存失败，原数据与编辑内容已保留，请重试。', true);
      return false;
    } finally {
      mutationBusy = false;lockApplication(false);if (focused?.isConnected) { focused.focus(); }

      renderNativeView();
    }
  }

  // 损坏数据无法启动时提供原生恢复点和兼容备份修复入口。
  function offerNativeRecovery(container) {
    if (!ShirohaPlatform.storage.recoverySnapshots) { return; }

    const load = document.createElement('button');load.textContent = '查找本机恢复点';load.type = 'button';
    const select = document.createElement('select');select.setAttribute('aria-label', '修复使用的恢复点');select.hidden = true;
    const repair = document.createElement('button');repair.textContent = '从恢复点修复数据';repair.type = 'button';repair.disabled = true;
    const message = document.createElement('p');message.setAttribute('role', 'status');
    load.onclick = /* 查询可验证的恢复副本，未找到时提示保留当前数据目录。 */ async () => {
      load.disabled = true;try {
        const names = await ShirohaPlatform.storage.recoverySnapshots();select.replaceChildren();for (const name of names) { const option = document.createElement('option');option.value = name;option.textContent = name;select.appendChild(option); }

        select.hidden = !names.length;repair.disabled = !names.length;message.textContent = names.length ? '修复会先校验恢复副本；原数据库、日志和媒体均会保留。' : '没有可用的本机恢复点。请保留完整数据目录，使用已有兼容备份恢复。';
      } catch (error) { message.textContent = error.message; } finally { load.disabled = false; }
    };

    repair.onclick = async () => {
      if (!select.value || !await ShirohaDialogs.confirm('用所选恢复点修复本地数据？恢复副本通过校验后才会切换，原数据文件不会删除。')) { return; }

      repair.disabled = true;load.disabled = true;try { await ShirohaPlatform.storage.recover(select.value);await startApplication(); } catch (error) { message.textContent = error.message;repair.disabled = false;load.disabled = false; }
    };

    const backup = document.createElement('input');backup.type = 'file';backup.accept = '.json,.zip';backup.setAttribute('aria-label', '选择兼容备份修复数据');
    backup.onchange = /* 使用用户选择的兼容备份尝试修复，保留原数据库供追查。 */ async () => {
      const file = backup.files?.[0];if (!file) { return; }

      backup.disabled = true;try {
        const loaded = await readBackupFileV24(file);const data = JSON.parse(loaded.text);const assets = loaded.assets || {};
        if (Object.keys(assets).length) { applyBackupAssetsV24(data, assets); }

        if (countUnresolvedBackupImagesV24(data)) { throw new Error('备份缺少图片，未切换本地数据。'); }

        const normalized = normalizeBackupPayloadV23(data, file.name);
        const snapshot = { schemaVersion: CURRENT_SCHEMA_VERSION, banks: normalized.banks, activeBankId: normalized.activeBankId || normalized.banks[0]?.id || '', wrongBook: normalized.wrongBook || {}, favorites: normalized.favorites || {}, records: normalized.records || [], settings: normalized.settings || {}, crossPlatformMeta: normalized.crossPlatformMeta || {} };
        if (!await ShirohaDialogs.confirm(`已解析 ${snapshot.banks.length} 个题库、${snapshot.banks.reduce((n, b) => n + b.questions.length, 0)} 道题、${snapshot.records.length} 条记录。使用此备份修复？原数据文件和凭据将保留。`)) { return; }

        await ShirohaPlatform.storage.recoverImport(snapshot);await startApplication();
      } catch (error) { message.textContent = error.message; } finally { backup.disabled = false; }
    };

    container.append(load, select, repair, backup, message);
  }

  // 在本地数据与凭据就绪后开放界面，忽略上一代启动迟到的 AI 状态。
  async function startApplication() {
    const coldStart = !applicationStarted;applicationStarted = true;applicationGeneration += 1;const generation = applicationGeneration;
    lockApplication(true);document.body.dataset.storageState = 'loading';platformStatus('正在读取本地数据…');
    try {
      Object.assign(state, await loadState());
      await ShirohaPlatform.credentials.initialize(ensureAiImportStateV99(), state.serviceConfigurations);
      const harnessInitialization = ShirohaPlatform.harness?.initialize({ restored: !coldStart });
      init();applicationReady = true;lockApplication(false);platformStatus('');
      if (harnessInitialization) {
        void harnessInitialization.then(() => {
          if (coldStart && generation === applicationGeneration && applicationReady) { return ShirohaPlatform.harness?.ensureReady(); }

          return undefined;
        }).catch(() => {
          if (generation === applicationGeneration) { platformStatus('AI 状态检查未完成，请在 AI 设置中重试。', true); }
        });
      }

      if (ShirohaPlatform.credentials.migrateLegacy) {
        const retryCredentials = async () => {
          try { await ShirohaPlatform.credentials.migrateLegacy();renderAiSettingsV99();renderWebdavPanelV378(true);platformStatus(''); } catch { platformStatus('旧凭据迁移未完成，旧值已保留，可独立重试。', true);const retry = document.createElement('button');retry.textContent = '重试凭据迁移';retry.onclick = retryCredentials;document.getElementById('platform-status').appendChild(retry); }
        };

        await retryCredentials();
      }
    } catch (error) {
      applicationReady = false;document.body.dataset.storageState = 'recovery_required';
      retryMutation = startApplication;platformStatus(error?.message || '数据加载失败，原数据已保留。', true);
      const button = document.createElement('button');button.textContent = '导出原始数据';
      button.onclick = async () => {
        try { await ShirohaPlatform.download('shiroha-recovery.json', new Blob([ShirohaPlatform.storage.recoveryText()], { type: 'application/json' })); } catch { platformStatus('无法读取原始数据，请检查浏览器存储权限。', true); }
      };

      document.getElementById('platform-status').appendChild(button);
      if (error?.code !== 'migration_required') { offerNativeRecovery(document.getElementById('platform-status')); }

      if (error?.code === 'migration_required' && ShirohaPlatform.storage.migrate) {
        const migrate = document.createElement('button');migrate.textContent = '确认迁移旧原型数据';
        migrate.onclick = async () => {
          if (!await ShirohaDialogs.confirm('将旧题库和学习记录迁移到本机数据库，并保留原始数据。凭据会单独迁移，只有保存成功才清理对应旧值；失败仍保留。是否继续？')) { return; }

          migrate.disabled = true;try { await ShirohaPlatform.storage.migrate();await startApplication(); } catch (error) { platformStatus(error.message, true); } finally { migrate.disabled = false; }
        };

        document.getElementById('platform-status').appendChild(migrate);
      }
    }
  }

  function blockInteractionDuringMutation(event) {
    if (mutationBusy && !event.target.closest?.('#platform-status,#desktop-titlebar,#app-dialog')) { event.preventDefault();event.stopImmediatePropagation(); }
  }

  for (const type of ['click', 'change', 'input', 'keydown']) { document.addEventListener(type, blockInteractionDuringMutation, true); }

  window.addEventListener('beforeunload', (event) => {
    if (mutationBusy || mutationSaveError || (practiceSession.current.submitMode === 'total' && !practiceSession.current.completed && (practiceSession.current.totalLocked || totalPracticeFilledCount() > 0))) { event.preventDefault();event.returnValue = ''; }
  });

  // HTML 文件拖放只读取用户交付的 File，不接收本机路径；与选择文件共用解析和确认流程。
  function createFileDragHandler(type) {
    return /* 仅在导入页空闲时接收单一题库文件，其他文件拖放也阻止浏览器导航。 */ (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) { return; }

      event.preventDefault();
      if (type !== 'drop' || !event.target.closest?.('#import') || mutationBusy) { return; }

      const files = Array.from(event.dataTransfer.files || []);
      if (files.length !== 1) { toast('请每次拖入一个文件。', 'warn');return; }

      if (!/* 检查拖入文件是否属于导入流程能识别的扩展名，大小写不影响判断。 */ /\.(txt|json|csv|xlsx|docx|doc|pdf)$/i.test(files[0].name)) { toast('不支持此文件类型，请选择 TXT、JSON、CSV、XLSX、DOCX 或 PDF。', 'warn');return; }

      void readImportFile({ target: { files } });
    };
  }

  for (const type of ['dragover', 'drop']) { document.addEventListener(type, createFileDragHandler(type)); }

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.repeat) { return; }

    if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) { return; }

    if (event.key.toLowerCase() === 's') { event.preventDefault();if (!mutationBusy) { document.getElementById('save-all-btn')?.click(); } }
  });

  if (globalThis.ShirohaDesktopHost) {
    globalThis.ShirohaDesktopHost.canClose = /* 在宿主关闭前检查未保存的练习、考试与识别任务，按操作状态允许取消退出。 */ async () => {
      if (mutationBusy) { platformStatus('正在保存，请完成后再关闭。', true);return false; }

      if (practiceSession.current.submitMode === 'total' && !practiceSession.current.completed) {
        if (practiceSession.current.totalLocked) { platformStatus('本轮答案已锁定，请完成简答题自评和保存后再关闭。');return false; }

        if (totalPracticeFilledCount() > 0 && !await ShirohaDialogs.confirm('本轮答案尚未提交，关闭将放弃本轮草稿。确定退出？')) { return false; }
      }

      if (mutationSaveError && !await ShirohaDialogs.confirm('保存尚未成功。确定放弃本次未保存修改并退出？')) { return false; }

      if (examSession.current.items.length && !examSession.current.submitted && !await ShirohaDialogs.confirm('当前考试尚未交卷，退出后不能续考。确定退出？')) { return false; }

      if (ocrSession.isRunning()) {
        if (!await ShirohaDialogs.confirm('OCR 尚未结束。取消识别并退出？')) { return false; }

        ocrSession.cancel();
      }

      if (webdavPanel.isBusy() || aiTasksBusyV99()) {
        if (!await ShirohaDialogs.confirm('网络任务尚未结束。取消并退出？已经发送的上传可能到达远端，下次请先核对列表。')) { return false; }
      }

      try { await ShirohaPlatform.harness?.cancelAll();await ShirohaPlatform.network.cancelAll?.();await ShirohaPlatform.saves.idle();return true; } catch (error) { platformStatus(error.message || '退出前检查失败，请重试。', true);return false; }
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
