(() => {
  'use strict';

  function create({
    makeId, now, serializeBankForCrossExportV53, exportSettingsV1, buildRichContentCapabilitiesV57,
    cleanFileNameV23, pickBankGroupNameFromJsonV58, normalizeQuestion, normalizeBankGroupNameV58,
    bankNameKeyV58, backupRecordConverters, externalizeNativeBackupImagesV611,
    APP_VERSION, CURRENT_SCHEMA_VERSION, RICH_CONTENT_VERSION_V57,
  }) {
    const { parseCrossPlatformTime: parseCrossPlatformTimeV24, crossTimeToIso: crossTimeToIsoV24 } = globalThis.ShirohaBackupCore;
    const { zipStoreFiles } = globalThis.ShirohaZip;
    function buildBackupPayloadV23(state, banks, exportType = 'selected_banks', includeAll = false) {
      const bankIds = new Set((banks || []).map((b)=>b.id));
      const wrongBook = {};Object.keys(state.wrongBook || {}).forEach((id)=>{if (includeAll || bankIds.has(id)) {wrongBook[id] = state.wrongBook[id];}});
      const favorites = {};Object.keys(state.favorites || {}).forEach((id)=>{if (includeAll || bankIds.has(id)) {favorites[id] = state.favorites[id];}});
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
      if (crossPlatform) {payload.crossPlatform = crossPlatform;}
      const checked = globalThis.ShirohaPlatformValidation.validateBackup(payload);if (!checked.ok) {throw new Error('备份含不支持的数据或敏感字段，请先检查数据。');}
      return payload;
    }
    function buildNativeInteropStateV24(state, exportedBanks) {
      const bankMap = new Map((exportedBanks || []).map((b)=>[b.id, b]));
      const nativeWrongBook = [];
      Object.entries(state.wrongBook || {}).forEach(([bid, entries])=>{
        const bank = bankMap.get(bid);if (!bank) {return;}
        const questionMap = new Map((bank.questions || []).map((q)=>[q.id, q]));
        (entries || []).forEach((e)=>{
          const q = questionMap.get(e.id) || (e.nativeQuestion && typeof e.nativeQuestion === 'object' ? e.nativeQuestion : null);if (!q) {return;}
          const lastWrongAt = parseCrossPlatformTimeV24(e.lastWrongAt, Date.now());
          nativeWrongBook.push({
            bankId: bid, bankName: bank.name || bank.title || '', question: structuredClone(q), lastAnswer: Array.isArray(e.lastAnswer) ? e.lastAnswer : [], source: e.source || 'web-export', timestamp: Number(e.timestamp || lastWrongAt),
            wrongCount: Number(e.wrongCount || 1), rightCount: Number(e.rightCount || 0), reviewRightCount: Number(e.reviewRightCount || 0), streakCorrectCount: Number(e.streakCorrectCount || 0),
            lastWrongAt, lastCorrectAt: e.lastCorrectAt ? parseCrossPlatformTimeV24(e.lastCorrectAt, null) : null, status: e.status || '未掌握',
            lastReviewedAt: e.lastReviewedAt ? parseCrossPlatformTimeV24(e.lastReviewedAt, null) : null, nextReviewAt: e.nextReviewAt ? parseCrossPlatformTimeV24(e.nextReviewAt, null) : null, reviewLevel: Number(e.reviewLevel || 0),
          });
        });
      });
      const nativeFavorites = [];
      Object.entries(state.favorites || {}).forEach(([bid, ids])=>{
        const bank = bankMap.get(bid);if (!bank) {return;}
        const questionMap = new Map((bank.questions || []).map((q)=>[q.id, q]));
        const favoriteMeta = state.crossPlatformMeta && state.crossPlatformMeta.favoriteQuestions && state.crossPlatformMeta.favoriteQuestions[bid] || {};(ids || []).forEach((qid)=>{const q = questionMap.get(qid) || (favoriteMeta[qid] && favoriteMeta[qid].question);if (q) {nativeFavorites.push({ question: structuredClone(q), bankId: bid, bankName: bank.name || bank.title || '', favoritedAt: Number(favoriteMeta[qid] && favoriteMeta[qid].favoritedAt || Date.now()) });}});
      });
      const nativeRecords = (state.records || []).map((record)=>backupRecordConverters.toNative(record, bankMap));
      return { schemaVersion: 1, wrongBook: nativeWrongBook, favoriteQuestions: nativeFavorites, studyRecords: nativeRecords };
    }
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
        activeBankId: exportedBanks.some((b)=>b.id === state.activeBankId) ? state.activeBankId : (exportedBanks[0]?.id || ''),
        banks: exportedBanks,
        crossPlatform: buildNativeInteropStateV24(state, exportedBanks),
      };
      const assets = [];const assetMap = new Map();
      externalizeNativeBackupImagesV611(payload, assets, assetMap);
      const files = [{ name: 'backup.json', text: JSON.stringify(payload, null, 2) }, ...assets.map((a)=>({ name: a.name, data: a.bytes }))];
      return { payload, blob: zipStoreFiles(files), assetCount: assets.length };
    }
    function normalizeBackupPayloadV23(data, fileName) {
      globalThis.ShirohaBackupCore.assertSupportedBackup(data);
      let banks;
      let wrongBook = {};
      let favorites = {};
      let records = [];
      let settings = {};
      let activeBankId = '';
      let hasWebSettings = false;
      let crossPlatformMeta = { favoriteQuestions: {} };
      const webState = data.webState && typeof data.webState === 'object' ? data.webState : null;
      const cross = data.crossPlatform && typeof data.crossPlatform === 'object' ? data.crossPlatform : null;
      const nativeLike = String(data.kind || '').startsWith('shiroha_quiz') || !!cross;
      if (Array.isArray(data.banks)) {
        banks = data.banks;
        const legacyWrong = (webState && webState.wrongBook) || (!Array.isArray(data.wrongBook) && data.wrongBook) || null;
        const legacyFavorites = (webState && webState.favorites) || (!Array.isArray(data.favorites) && data.favorites) || null;
        const legacyRecords = (webState && webState.records) || (!cross && Array.isArray(data.records) ? data.records : null);
        if (legacyWrong && typeof legacyWrong === 'object') {wrongBook = legacyWrong;}
        else {wrongBook = convertNativeWrongBookToWebV24((cross && cross.wrongBook) || data.wrongBook || []);}
        const nativeFavoriteEntries = (cross && cross.favoriteQuestions) || data.favoriteQuestions || [];
        if (legacyFavorites && typeof legacyFavorites === 'object') {favorites = legacyFavorites;}
        else {favorites = convertNativeFavoritesToWebV24(nativeFavoriteEntries);}
        const hasWebFavoriteMeta = webState && webState.crossPlatformMeta
          && typeof webState.crossPlatformMeta === 'object';
        crossPlatformMeta = hasWebFavoriteMeta ? webState.crossPlatformMeta
          : { favoriteQuestions: extractNativeFavoriteMetaV24(nativeFavoriteEntries) };
        if (Array.isArray(legacyRecords)) {records = legacyRecords;}
        else {records = convertNativeRecordsToWebV24((cross && cross.studyRecords) || data.studyRecords || []);}
        hasWebSettings = !!((webState && Object.prototype.hasOwnProperty.call(webState, 'settings'))
          || Object.prototype.hasOwnProperty.call(data, 'webSettings')
          || Object.prototype.hasOwnProperty.call(data, 'settings'));
        settings = (webState && webState.settings) || data.webSettings || data.settings || {};
        activeBankId = data.activeBankId || '';
      } else if (Array.isArray(data.questions)) {
        banks = [{ id: data.id || makeId('bank'), name: data.name || cleanFileNameV23(fileName).replace(/\.(?:json|zip)$/i, '') || '导入题库', groupName: pickBankGroupNameFromJsonV58(data), createdAt: data.createdAt || now(), updatedAt: now(), questions: data.questions }];
      } else if (Array.isArray(data)) {
        banks = [{ id: makeId('bank'), name: cleanFileNameV23(fileName).replace(/\.(?:json|zip)$/i, '') || '导入题库', createdAt: now(), updatedAt: now(), questions: data }];
      } else {throw new Error(nativeLike ? '备份中没有 banks[] 题库数据' : '不是 Shiroha Quiz 备份，也不是单题库 JSON');}
      banks = banks.map((bank, index) => ({
        ...bank,
        id: String(bank.id || makeId('bank_import', index)),
        name: String(bank.name || bank.title || ('导入题库_' + (index + 1))),
        groupName: pickBankGroupNameFromJsonV58(bank), createdAt: bank.createdAt || now(), updatedAt: now(),
        questions: (bank.questions || []).map((question, questionIndex) => ({
          ...question, ...normalizeQuestion(question, questionIndex),
        })).filter((question) => question.question),
      })).filter((bank) => bank.questions.length || bank.name);
      if (!banks.some((b)=>b.id === activeBankId)) {activeBankId = banks[0]?.id || '';}
      return { banks, wrongBook, favorites, records, settings, hasWebSettings, crossPlatformMeta, activeBankId };
    }
    /* SHIROHA_WEB_V24_NATIVE_IMPORT_CONVERTERS */
    function nativeQuestionReference(entry) {
      const bankId = entry && entry.bankId || '';
      const question = entry && entry.question;
      const questionId = question && (question.id || question.questionId) || entry && entry.questionId || '';
      return { bankId, question, questionId };
    }
    function convertNativeWrongBookToWebV24(nativeEntries) {
      const web = {};
      (Array.isArray(nativeEntries) ? nativeEntries : []).forEach((entry) => {
        const { bankId, question, questionId } = nativeQuestionReference(entry);
        if (!bankId || !questionId) {return;}
        if (!web[bankId]) {web[bankId] = [];}
        web[bankId].push({
          id: questionId, wrongCount: Number(entry.wrongCount || 1), rightCount: Number(entry.rightCount || 0),
          reviewRightCount: Number(entry.reviewRightCount || 0), streakCorrectCount: Number(entry.streakCorrectCount || 0),
          lastWrongAt: crossTimeToIsoV24(entry.lastWrongAt || entry.timestamp),
          lastCorrectAt: entry.lastCorrectAt ? crossTimeToIsoV24(entry.lastCorrectAt) : '',
          lastReviewedAt: entry.lastReviewedAt ? crossTimeToIsoV24(entry.lastReviewedAt) : '',
          nextReviewAt: entry.nextReviewAt ? crossTimeToIsoV24(entry.nextReviewAt) : '',
          reviewLevel: Number(entry.reviewLevel || 0), lastAnswer: Array.isArray(entry.lastAnswer) ? entry.lastAnswer : [],
          source: entry.source || 'native', timestamp: Number(entry.timestamp || entry.lastWrongAt || 0),
          nativeQuestion: question, status: entry.status || '未掌握',
        });
      });
      return web;
    }
    function convertNativeFavoritesToWebV24(nativeEntries) {
      const web = {};
      (Array.isArray(nativeEntries) ? nativeEntries : []).forEach((entry) => {
        const { bankId, questionId } = nativeQuestionReference(entry);
        if (!bankId || !questionId) {return;}
        if (!web[bankId]) {web[bankId] = [];}
        if (!web[bankId].includes(questionId)) {web[bankId].push(questionId);}
      });
      return web;
    }
    function extractNativeFavoriteMetaV24(nativeEntries) {
      const meta = {};
      (Array.isArray(nativeEntries) ? nativeEntries : []).forEach((entry) => {
        const { bankId, question, questionId } = nativeQuestionReference(entry);
        if (!bankId || !questionId) {return;}
        if (!meta[bankId]) {meta[bankId] = {};}
        meta[bankId][questionId] = { favoritedAt: Number(entry.favoritedAt || Date.now()), question };
      });
      return meta;
    }
    function convertNativeRecordsToWebV24(nativeEntries) {
      return (Array.isArray(nativeEntries) ? nativeEntries : []).map((record)=>backupRecordConverters.toWeb(record));
    }
    function mergeBackupBanksV23(state, normalized) {
      const existingKeys = new Set(state.banks.map((b)=>bankNameKeyV58(b.groupName, b.name)));
      const existingIds = new Set(state.banks.map((b)=>b.id));
      const bankMap = {};
      const importedFavoriteMeta = normalized.crossPlatformMeta && normalized.crossPlatformMeta.favoriteQuestions || {};
      state.crossPlatformMeta = state.crossPlatformMeta && typeof state.crossPlatformMeta === 'object'
        ? state.crossPlatformMeta : { favoriteQuestions: {} };
      state.crossPlatformMeta.favoriteQuestions = state.crossPlatformMeta.favoriteQuestions
        && typeof state.crossPlatformMeta.favoriteQuestions === 'object' ? state.crossPlatformMeta.favoriteQuestions : {};
      normalized.banks.forEach((bank, idx)=>{
        const oldId = bank.id;
        const groupName = normalizeBankGroupNameV58(bank.groupName);
        let name = bank.name || ('导入题库_' + (idx + 1));
        if (existingKeys.has(bankNameKeyV58(groupName, name))) {
          let suffix = 1;
          const base = name + '_导入';
          while (existingKeys.has(bankNameKeyV58(groupName, base + suffix))) {suffix++;}
          name = base + suffix;
        }
        let id = bank.id;
        if (existingIds.has(id)) {id = makeId('bank_import', idx);}
        bankMap[oldId] = { id, name };
        existingIds.add(id);
        existingKeys.add(bankNameKeyV58(groupName, name));
        const next = { ...bank, id, name, groupName, createdAt: bank.createdAt || now(), updatedAt: now(), questions: (bank.questions || []).map((q, i)=>({ ...q, ...normalizeQuestion(q, i), id: q.id || makeId('q', idx, i), number: q.number || i + 1 })) };
        state.banks.push(next);
        if (normalized.wrongBook && normalized.wrongBook[oldId]) {state.wrongBook[id] = normalized.wrongBook[oldId];}
        if (normalized.favorites && normalized.favorites[oldId]) {state.favorites[id] = normalized.favorites[oldId];}
        if (importedFavoriteMeta[oldId]) {state.crossPlatformMeta.favoriteQuestions[id] = importedFavoriteMeta[oldId];}
      });
      const importedRecords = (normalized.records || [])
        .map((record) => globalThis.ShirohaBackupCore.remapBackupRecord(record, bankMap));
      if (importedRecords.length) {state.records = [...(state.records || []), ...importedRecords];}
      state.activeBankId = state.banks[state.banks.length - normalized.banks.length]?.id || state.activeBankId;
    }

    return Object.freeze({ buildBackupPayloadV23, buildNativeInteropStateV24, buildNativeCompatibleBackupZipV611,
      normalizeBackupPayloadV23, mergeBackupBanksV23 });
  }
  globalThis.ShirohaBackupData = Object.freeze({ create });
})();
