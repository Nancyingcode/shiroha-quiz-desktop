// 收集备份数据并转换跨端语义，保留旧格式和只导入题库的入口。
(() => {
  'use strict';

  // 绑定题库、学习记录和附件转换规则，保持 Web 与原生备份格式一致。
  function create({
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
  }) {
    const { parseCrossPlatformTime: parseCrossPlatformTimeV24, crossTimeToIso: crossTimeToIsoV24 } = globalThis.ShirohaBackupCore;
    const { zipStoreFiles } = globalThis.ShirohaZip;
    // 按题库范围筛选错题和收藏，全量备份仍保留全部原始数据。
    function selectBankLearningData(state, bankIds, includeAll) {
      const wrongBook = {};Object.keys(state.wrongBook || {}).forEach((id) => {
        if (includeAll || bankIds.has(id)) { wrongBook[id] = state.wrongBook[id]; }
      });

      const favorites = {};Object.keys(state.favorites || {}).forEach((id) => {
        if (includeAll || bankIds.has(id)) { favorites[id] = state.favorites[id]; }
      });

      return { wrongBook, favorites };
    }

    // 区分全量与题库选集备份，写出前检查不支持的数据及敏感字段。
    function buildBackupPayloadV23(state, banks, exportType = 'selected_banks', includeAll = false) {
      const bankIds = new Set((banks || []).map((b) => b.id));
      const { wrongBook, favorites } = selectBankLearningData(state, bankIds, includeAll);
      const exportedBanks = (banks || []).map(serializeBankForCrossExportV53);
      const webRecords = includeAll ? (state.records || []) : [];
      const webSettings = includeAll ? exportSettingsV1(state.settings) : {};
      const crossPlatform = includeAll ? buildNativeInteropStateV24(state, exportedBanks) : null;
      const payload = {
        app: 'Shiroha Quiz',
        kind: includeAll ? 'shiroha_quiz_web_full_backup' : 'shiroha_quiz_selected_banks',
        appVersion: APP_VERSION,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        crossPlatformSchemaVersion: 1,
        richContentVersion: RICH_CONTENT_VERSION_V57,
        richContentCapabilities: buildRichContentCapabilitiesV57(exportedBanks),
        exportType,
        exportedAt: now(),
        banks: exportedBanks,
        // 保留 Web 原始状态，确保 Web 自身覆盖恢复不降级。
        wrongBook,
        favorites,
        records: webRecords,
        settings: webSettings,
        ...(includeAll ? { webState: { wrongBook, favorites, records: webRecords, settings: webSettings, crossPlatformMeta: state.crossPlatformMeta || {} } } : {}),
        activeBankId: includeAll ? state.activeBankId : ((banks && banks[0] && banks[0].id) || ''),
      };
      if (crossPlatform) { payload.crossPlatform = crossPlatform; }

      const checked = globalThis.ShirohaPlatformValidation.validateBackup(payload);if (!checked.ok) { throw new Error('备份含不支持的数据或敏感字段，请先检查数据。'); }

      return payload;
    }

    // 保留错题的时间、答题次数及训练进度，使它在原生端能继续复习。
    function nativeWrongEntry(e, q, bid, bank) {
      const lastWrongAt = parseCrossPlatformTimeV24(e.lastWrongAt, Date.now());
      return {
        bankId: bid,
        bankName: bank.name || bank.title || '',
        question: structuredClone(q),
        lastAnswer: Array.isArray(e.lastAnswer) ? e.lastAnswer : [],
        source: e.source || 'web-export',
        timestamp: Number(e.timestamp || lastWrongAt),
        wrongCount: Number(e.wrongCount || 1),
        rightCount: Number(e.rightCount || 0),
        reviewRightCount: Number(e.reviewRightCount || 0),
        streakCorrectCount: Number(e.streakCorrectCount || 0),
        lastWrongAt,
        lastCorrectAt: e.lastCorrectAt ? parseCrossPlatformTimeV24(e.lastCorrectAt, null) : null,
        status: e.status || '未掌握',
        lastReviewedAt: e.lastReviewedAt ? parseCrossPlatformTimeV24(e.lastReviewedAt, null) : null,
        nextReviewAt: e.nextReviewAt ? parseCrossPlatformTimeV24(e.nextReviewAt, null) : null,
        reviewLevel: Number(e.reviewLevel || 0),
      };
    }

    // 逐个题库导出可还原题目或自有题目快照的错题。
    function collectNativeWrongBook(state, bankMap) {
      const nativeWrongBook = [];
      // 仅从这次导出的题库查找题目，必要时保留错题自带的快照。
      const collectBank = ([bid, entries]) => {
        const bank = bankMap.get(bid);if (!bank) { return; }

        const questionMap = new Map((bank.questions || []).map((q) => [q.id, q]));
        (entries || []).forEach((e) => {
          const q = questionMap.get(e.id) || (e.nativeQuestion && typeof e.nativeQuestion === 'object' ? e.nativeQuestion : null);if (!q) { return; }

          nativeWrongBook.push(nativeWrongEntry(e, q, bid, bank));
        });
      };

      Object.entries(state.wrongBook || {}).forEach(collectBank);
      return nativeWrongBook;
    }

    // 导出跨端收藏时保留收藏时间；无历史时间时使用当前时间。
    function collectNativeFavorites(state, bankMap) {
      const nativeFavorites = [];
      // 已收藏题可能从题库移除，仍可从收藏元数据恢复题目。
      const collectBank = ([bid, ids]) => {
        const bank = bankMap.get(bid);if (!bank) { return; }

        const questionMap = new Map((bank.questions || []).map((q) => [q.id, q]));
        const favoriteMeta = (state.crossPlatformMeta && state.crossPlatformMeta.favoriteQuestions && state.crossPlatformMeta.favoriteQuestions[bid]) || {};(ids || []).forEach((qid) => {
          const q = questionMap.get(qid) || (favoriteMeta[qid] && favoriteMeta[qid].question);if (q) { nativeFavorites.push({ question: structuredClone(q), bankId: bid, bankName: bank.name || bank.title || '', favoritedAt: Number((favoriteMeta[qid] && favoriteMeta[qid].favoritedAt) || Date.now()) }); }
        });
      };

      Object.entries(state.favorites || {}).forEach(collectBank);
      return nativeFavorites;
    }

    // 把 Web 错题、收藏和训练记录转为原生端可直接恢复的结构。
    function buildNativeInteropStateV24(state, exportedBanks) {
      const bankMap = new Map((exportedBanks || []).map((b) => [b.id, b]));
      const nativeWrongBook = collectNativeWrongBook(state, bankMap);
      const nativeFavorites = collectNativeFavorites(state, bankMap);
      const nativeRecords = (state.records || []).map((record) => backupRecordConverters.toNative(record, bankMap));
      return { schemaVersion: 1, wrongBook: nativeWrongBook, favoriteQuestions: nativeFavorites, studyRecords: nativeRecords };
    }

    // 构建原生可读的 ZIP 清单，将内嵌附件改写为包内引用。
    function buildNativeCompatibleBackupZipV611(state) {
      const exportedBanks = (state.banks || []).map(serializeBankForCrossExportV53);
      const payload = {
        app: 'Shiroha Quiz',
        kind: 'shiroha_quiz_web_native_backup',
        version: 3,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        crossPlatformSchemaVersion: 1,
        exportedBy: 'web',
        exportedAt: now(),
        activeBankId: exportedBanks.some((b) => b.id === state.activeBankId) ? state.activeBankId : (exportedBanks[0]?.id || ''),
        banks: exportedBanks,
        crossPlatform: buildNativeInteropStateV24(state, exportedBanks),
      };
      const assets = [];const assetMap = new Map();
      externalizeNativeBackupImagesV611(payload, assets, assetMap);
      const files = [{ name: 'backup.json', text: JSON.stringify(payload, null, 2) }, ...assets.map((a) => ({ name: a.name, data: a.bytes }))];
      return { payload, blob: zipStoreFiles(files), assetCount: assets.length };
    }

    // 复原题库附带的学习数据时优先使用原 Web 状态，必要时将原生项转为 Web 格式。
    function restoreBackupState(data, webState, cross) {
      const legacyWrong = (webState && webState.wrongBook) || (!Array.isArray(data.wrongBook) && data.wrongBook) || null;
      const legacyFavorites = (webState && webState.favorites) || (!Array.isArray(data.favorites) && data.favorites) || null;
      const legacyRecords = (webState && webState.records) || (!cross && Array.isArray(data.records) ? data.records : null);
      const wrongBook = legacyWrong && typeof legacyWrong === 'object'
        ? legacyWrong : convertNativeWrongBookToWebV24((cross && cross.wrongBook) || data.wrongBook || []);

      const nativeFavoriteEntries = (cross && cross.favoriteQuestions) || data.favoriteQuestions || [];
      const favorites = legacyFavorites && typeof legacyFavorites === 'object'
        ? legacyFavorites : convertNativeFavoritesToWebV24(nativeFavoriteEntries);

      const hasWebFavoriteMeta = webState && webState.crossPlatformMeta
        && typeof webState.crossPlatformMeta === 'object';
      const crossPlatformMeta = hasWebFavoriteMeta ? webState.crossPlatformMeta
        : { favoriteQuestions: extractNativeFavoriteMetaV24(nativeFavoriteEntries) };
      const records = Array.isArray(legacyRecords)
        ? legacyRecords : convertNativeRecordsToWebV24((cross && cross.studyRecords) || data.studyRecords || []);

      const hasWebSettings = !!((webState && Object.prototype.hasOwnProperty.call(webState, 'settings'))
        || Object.prototype.hasOwnProperty.call(data, 'webSettings')
        || Object.prototype.hasOwnProperty.call(data, 'settings'));
      const settings = (webState && webState.settings) || data.webSettings || data.settings || {};
      const activeBankId = data.activeBankId || '';

      return { wrongBook, favorites, records, settings, hasWebSettings, crossPlatformMeta, activeBankId };
    }

    function backupBankName(fileName) {
      // 单题库旧格式没有名称时使用文件名，移除备份容器的扩展名。
      return cleanFileNameV23(fileName).replace(/\.(?:json|zip)$/i, '') || '导入题库';
    }

    // 统一历史题库字段和题目结构，缺少 ID 或名称时补齐导入默认值。
    function normalizeImportedBank(bank, index) {
      return {
        ...bank,
        id: String(bank.id || makeId('bank_import', index)),
        name: String(bank.name || bank.title || (`导入题库_${index + 1}`)),
        groupName: pickBankGroupNameFromJsonV58(bank),
        createdAt: bank.createdAt || now(),
        updatedAt: now(),
        questions: (bank.questions || []).map((question, questionIndex) => ({
          ...question, ...normalizeQuestion(question, questionIndex),
        })).filter((question) => question.question),
      };
    }

    // 归一化全量备份、单题库和题目数组，并保留恢复设置是否存在。
    function normalizeBackupPayloadV23(data, fileName) {
      globalThis.ShirohaBackupCore.assertSupportedBackup(data);
      let banks;
      let backupState = {
        wrongBook: {},
        favorites: {},
        records: [],
        settings: {},
        hasWebSettings: false,
        crossPlatformMeta: { favoriteQuestions: {} },
        activeBankId: '',
      };
      const webState = data.webState && typeof data.webState === 'object' ? data.webState : null;
      const cross = data.crossPlatform && typeof data.crossPlatform === 'object' ? data.crossPlatform : null;
      const nativeLike = String(data.kind || '').startsWith('shiroha_quiz') || !!cross;
      if (Array.isArray(data.banks)) {
        banks = data.banks;
        backupState = restoreBackupState(data, webState, cross);
      } else if (Array.isArray(data.questions)) {
        banks = [{ id: data.id || makeId('bank'), name: data.name || backupBankName(fileName), groupName: pickBankGroupNameFromJsonV58(data), createdAt: data.createdAt || now(), updatedAt: now(), questions: data.questions }];
      } else if (Array.isArray(data)) {
        banks = [{ id: makeId('bank'), name: backupBankName(fileName), createdAt: now(), updatedAt: now(), questions: data }];
      } else { throw new Error(nativeLike ? '备份中没有 banks[] 题库数据' : '不是 Shiroha Quiz 备份，也不是单题库 JSON'); }

      banks = banks.map(normalizeImportedBank).filter((bank) => bank.questions.length || bank.name);

      if (!banks.some((b) => b.id === backupState.activeBankId)) { backupState.activeBankId = banks[0]?.id || ''; }

      return { banks, ...backupState };
    }

    /* SHIROHA_WEB_V24_NATIVE_IMPORT_CONVERTERS */
    function nativeQuestionReference(entry) {
      const bankId = (entry && entry.bankId) || '';
      const question = entry && entry.question;
      const questionId = (question && (question.id || question.questionId)) || (entry && entry.questionId) || '';
      return { bankId, question, questionId };
    }

    // 保留原生错题快照，并将各次练习时间统一成 Web 的 ISO 字符串。
    function restoreNativeWrongEntry(entry, question, questionId) {
      return {
        id: questionId,
        wrongCount: Number(entry.wrongCount || 1),
        rightCount: Number(entry.rightCount || 0),
        reviewRightCount: Number(entry.reviewRightCount || 0),
        streakCorrectCount: Number(entry.streakCorrectCount || 0),
        lastWrongAt: crossTimeToIsoV24(entry.lastWrongAt || entry.timestamp),
        lastCorrectAt: entry.lastCorrectAt ? crossTimeToIsoV24(entry.lastCorrectAt) : '',
        lastReviewedAt: entry.lastReviewedAt ? crossTimeToIsoV24(entry.lastReviewedAt) : '',
        nextReviewAt: entry.nextReviewAt ? crossTimeToIsoV24(entry.nextReviewAt) : '',
        reviewLevel: Number(entry.reviewLevel || 0),
        lastAnswer: Array.isArray(entry.lastAnswer) ? entry.lastAnswer : [],
        source: entry.source || 'native',
        timestamp: Number(entry.timestamp || entry.lastWrongAt || 0),
        nativeQuestion: question,
        status: entry.status || '未掌握',
      };
    }

    // 将原生错题按题库归组，保留错题快照和作答进度。
    function convertNativeWrongBookToWebV24(nativeEntries) {
      const web = {};
      // 同一题库下只登记来源可识别的错题。
      const collect = (entry) => {
        const { bankId, question, questionId } = nativeQuestionReference(entry);
        if (!bankId || !questionId) { return; }

        if (!web[bankId]) { web[bankId] = []; }

        web[bankId].push(restoreNativeWrongEntry(entry, question, questionId));
      };

      (Array.isArray(nativeEntries) ? nativeEntries : []).forEach(collect);

      return web;
    }

    // 归并原生收藏 ID；同一题库的同一题只收藏一次。
    function convertNativeFavoritesToWebV24(nativeEntries) {
      const web = {};
      // 待导入的收藏按题库和题目 ID 去重。
      const collect = (entry) => {
        const { bankId, questionId } = nativeQuestionReference(entry);
        if (!bankId || !questionId) { return; }

        if (!web[bankId]) { web[bankId] = []; }

        if (!web[bankId].includes(questionId)) { web[bankId].push(questionId); }
      };

      (Array.isArray(nativeEntries) ? nativeEntries : []).forEach(collect);

      return web;
    }

    // 收集原生收藏时间和题目快照，题库缺题时仍可恢复。
    function extractNativeFavoriteMetaV24(nativeEntries) {
      const meta = {};
      // 按当前题目保存收藏快照，恢复不受题库正文缺失影响。
      const collect = (entry) => {
        const { bankId, question, questionId } = nativeQuestionReference(entry);
        if (!bankId || !questionId) { return; }

        if (!meta[bankId]) { meta[bankId] = {}; }

        meta[bankId][questionId] = { favoritedAt: Number(entry.favoritedAt || Date.now()), question };
      };

      (Array.isArray(nativeEntries) ? nativeEntries : []).forEach(collect);

      return meta;
    }

    function convertNativeRecordsToWebV24(nativeEntries) {
      return (Array.isArray(nativeEntries) ? nativeEntries : []).map((record) => backupRecordConverters.toWeb(record));
    }

    // 为导入题库选择空闲名称与 ID，重名时使用原有编号规则。
    function chooseImportedBankIdentity(bank, idx, existingKeys, existingIds) {
      const groupName = normalizeBankGroupNameV58(bank.groupName);
      let name = bank.name || (`导入题库_${idx + 1}`);
      if (existingKeys.has(bankNameKeyV58(groupName, name))) {
        let suffix = 1;
        // eslint-disable-next-line prefer-template -- 外部值可能是对象，保留 + 的默认转换；输入类型受约束后移除此例外。
        const base = name + '_导入';
        while (existingKeys.has(bankNameKeyV58(groupName, base + suffix))) { suffix += 1; }

        name = base + suffix;
      }

      let { id } = bank;
      if (existingIds.has(id)) { id = makeId('bank_import', idx); }

      return { id, name, groupName };
    }

    // 合并时避免名称或 ID 重复，并按新题库身份重映射学习记录。
    function mergeBackupBanksV23(state, normalized) {
      const existingKeys = new Set(state.banks.map((b) => bankNameKeyV58(b.groupName, b.name)));
      const existingIds = new Set(state.banks.map((b) => b.id));
      const bankMap = {};
      const importedFavoriteMeta = (normalized.crossPlatformMeta && normalized.crossPlatformMeta.favoriteQuestions) || {};
      state.crossPlatformMeta = state.crossPlatformMeta && typeof state.crossPlatformMeta === 'object'
        ? state.crossPlatformMeta : { favoriteQuestions: {} };
      state.crossPlatformMeta.favoriteQuestions = state.crossPlatformMeta.favoriteQuestions
        && typeof state.crossPlatformMeta.favoriteQuestions === 'object' ? state.crossPlatformMeta.favoriteQuestions : {};
      // 每个题库先选出新身份，后继题库及关联数据复用这个映射。
      const mergeBank = (bank, idx) => {
        const oldId = bank.id;
        const { id, name, groupName } = chooseImportedBankIdentity(bank, idx, existingKeys, existingIds);
        bankMap[oldId] = { id, name };
        existingIds.add(id);
        existingKeys.add(bankNameKeyV58(groupName, name));
        const next = { ...bank, id, name, groupName, createdAt: bank.createdAt || now(), updatedAt: now(), questions: (bank.questions || []).map((q, i) => ({ ...q, ...normalizeQuestion(q, i), id: q.id || makeId('q', idx, i), number: q.number || i + 1 })) };
        state.banks.push(next);
        if (normalized.wrongBook && normalized.wrongBook[oldId]) { state.wrongBook[id] = normalized.wrongBook[oldId]; }

        if (normalized.favorites && normalized.favorites[oldId]) { state.favorites[id] = normalized.favorites[oldId]; }

        if (importedFavoriteMeta[oldId]) { state.crossPlatformMeta.favoriteQuestions[id] = importedFavoriteMeta[oldId]; }
      };

      normalized.banks.forEach(mergeBank);

      const importedRecords = (normalized.records || [])
        .map((record) => globalThis.ShirohaBackupCore.remapBackupRecord(record, bankMap));
      if (importedRecords.length) { state.records = [...(state.records || []), ...importedRecords]; }

      state.activeBankId = state.banks[state.banks.length - normalized.banks.length]?.id || state.activeBankId;
    }

    return Object.freeze({
      buildBackupPayloadV23,
      buildNativeInteropStateV24,
      buildNativeCompatibleBackupZipV611,
      normalizeBackupPayloadV23,
      mergeBackupBanksV23,
    });
  }

  globalThis.ShirohaBackupData = Object.freeze({ create });
})();
