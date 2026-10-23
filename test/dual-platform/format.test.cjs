'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');
const { webState, androidBackup, IMAGE, PNG_BASE64, TIME, MILLIS, FAKE_SECRETS, fakeStorage } = require('./fixtures/dataset.cjs');

function assertNoSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  Object.values(FAKE_SECRETS).forEach(secret => assert(!text.includes(secret), '导出或诊断含测试凭据。'));
}

async function readZip(api, blob) {
  const buffer = await blob.arrayBuffer();
  const entries = api.parseZipEntries(buffer);
  const payload = JSON.parse(await api.unzipEntry(buffer, entries.find(entry => entry.name === 'backup.json')));
  return { buffer, entries, payload };
}

test('完整 Web JSON 容器和学习数据往返；跨库相同 ID 不合并', () => {
  const initial = webState();
  const { api } = loadWeb({ state: initial });
  const payload = plain(api.buildBackupPayloadV23(api.snapshot().banks, 'all_data', true));
  assert.equal(payload.kind, 'shiroha_quiz_web_full_backup');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.crossPlatformSchemaVersion, 1);
  assert.equal(payload.richContentVersion, 'shiroha-web-rich-v1');
  assert.equal(payload.exportType, 'all_data');
  assert.deepEqual(payload.banks.map(bank => bank.questions[0].id), ['same-id', 'same-id']);
  assert.deepEqual(payload.banks.map(bank => bank.questions[0].answer), [['A'], ['B']]);
  assert.deepEqual(payload.banks[0].questions.map(question => question.type), ['SINGLE', 'MULTIPLE', 'JUDGE', 'BLANK', 'SHORT', 'SINGLE', 'SINGLE']);
  assert.deepEqual(payload.banks[0].questions[6].extensions, initial.banks[0].questions[6].extensions);
  const restored = plain(api.normalizeBackupPayloadV23(JSON.parse(JSON.stringify(payload)), 'full.json'));
  for (const key of ['wrongBook', 'favorites', 'records', 'settings', 'crossPlatformMeta', 'activeBankId']) assert.deepEqual(restored[key], initial[key], key);
  assert.deepEqual(restored.banks.map(bank => bank.id), ['bank-a', 'bank-b']);
  assert.deepEqual(restored.banks[0].questions[3].blankAnswers, [['北京', '北京市'], ['京']]);
  assert.equal(restored.banks[0].questions[6].images[0].dataUrl, IMAGE);
});

test('选中题库 JSON 单库使用 questions，多库使用 banks，均不含学习数据与设置', () => {
  const { api } = loadWeb({ state: webState() });
  const banks = api.snapshot().banks;
  const single = plain(api.buildQuestionBanksExportPayloadV598([banks[0]]));
  const multiple = plain(api.buildQuestionBanksExportPayloadV598(banks));
  assert.equal(single.id, 'bank-a');
  assert.equal(single.questions.length, 7);
  assert.equal(multiple.exportType, 'question_banks');
  assert.equal(multiple.schemaVersion, 1);
  assert.deepEqual(multiple.banks.map(bank => bank.id), ['bank-a', 'bank-b']);
  for (const payload of [single, multiple]) {
    for (const key of ['wrongBook', 'favorites', 'records', 'settings', 'webState', 'crossPlatform']) assert.equal(Object.hasOwn(payload, key), false, key);
    assert.equal(api.normalizeBackupPayloadV23(payload, 'selected.json').banks.length, payload === single ? 1 : 2);
  }
});

test('Web 完整 JSON 的原生视图保留错题计数、收藏时间、多空作答与历史图片', () => {
  const { api } = loadWeb({ state: webState() });
  const payload = plain(api.buildBackupPayloadV23(api.snapshot().banks, 'all_data', true));
  const native = payload.crossPlatform;
  assert.equal(native.wrongBook[0].question.id, 'deleted-question');
  assert.equal(native.wrongBook[0].wrongCount, 2);
  assert.equal(native.wrongBook[0].reviewRightCount, 1);
  assert.equal(native.wrongBook[0].question.images[0].dataUrl, IMAGE);
  assert.equal(native.favoriteQuestions[0].favoritedAt, MILLIS);
  assert.equal(native.favoriteQuestions[0].question.images[0].dataUrl, IMAGE);
  assert.equal(native.studyRecords[0].earnedScore, 4);
  assert.deepEqual(native.studyRecords[0].questionResults[0].userBlankAnswers, ['北京市', '京']);
  assert.equal(native.studyRecords[0].questionResults[1].question.images[0].dataUrl, IMAGE);
});

test('原生兼容图片 ZIP 实际封包并回读，重复共享图只写一个资产且字节一致', async () => {
  const initial = webState();
  const { api } = loadWeb({ state: initial });
  const exported = api.buildNativeCompatibleBackupZipV611();
  const { buffer, entries, payload } = await readZip(api, exported.blob);
  assert.equal(exported.assetCount, 1);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'backup.json');
  assert.match(entries[1].name, /^assets\/.+\.png$/);
  assert.equal(payload.kind, 'shiroha_quiz_web_native_backup');
  assert.equal(payload.version, 3);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.crossPlatformSchemaVersion, 1);
  assert.equal(payload.exportedBy, 'web');
  assert.equal(payload.banks[0].questions[6].options[0].text, initial.banks[0].questions[6].options[0].text);
  assert.equal(payload.banks[0].questions[6].analysis, initial.banks[0].questions[6].analysis);
  const bytes = await api.unzipEntryBytes(buffer, entries[1]);
  assert.deepEqual(Buffer.from(bytes), Buffer.from(PNG_BASE64, 'base64'));
  const references = [payload.banks[0].questions[6], payload.crossPlatform.wrongBook[0].question, payload.crossPlatform.favoriteQuestions[0].question, payload.crossPlatform.studyRecords[0].questionResults[1].question];
  references.forEach(question => {
    assert.equal(question.images[0].localPath, entries[1].name);
    assert.equal(Object.hasOwn(question.images[0], 'dataUrl'), false);
  });
  const read = await api.readBackupFileV24({ name: 'fixture.zip', arrayBuffer: () => exported.blob.arrayBuffer() });
  const restoredPayload = JSON.parse(read.text);
  api.applyBackupAssetsV24(restoredPayload, read.assets);
  assert.equal(api.countUnresolvedBackupImagesV24(restoredPayload), 0);
  const restored = api.normalizeBackupPayloadV23(restoredPayload, 'fixture.zip');
  assert.equal(restored.banks[0].questions[6].images[0].dataUrl, IMAGE);
  assert.deepEqual(plain(restored.records[0].details[0].userBlankAnswers), ['北京市', '京']);
  assert.equal(restored.records[0].details[1].nativeQuestion.images[0].dataUrl, IMAGE);
});

test('Android version 3 自建 ZIP 输入保留图片、多空、收藏、错题与记录再转原生视图', async () => {
  const { api } = loadWeb();
  const input = androidBackup();
  const blob = api.zipStoreFiles([
    { name: 'backup.json', text: JSON.stringify(input) },
    { name: 'assets/pixel.png', data: new Uint8Array(Buffer.from(PNG_BASE64, 'base64')) },
  ]);
  const read = await api.readBackupFileV24({ name: 'android-fixture.zip', arrayBuffer: () => blob.arrayBuffer() });
  const payload = JSON.parse(read.text);
  api.applyBackupAssetsV24(payload, read.assets);
  const restored = plain(api.normalizeBackupPayloadV23(payload, 'android-fixture.zip'));
  assert.equal(restored.banks[0].id, 'native-bank');
  assert.equal(restored.banks[0].questions[0].id, 'native-blank');
  assert.equal(restored.banks[0].questions[0].type, 'blank');
  assert.deepEqual(restored.banks[0].questions[0].blankAnswers, [['北京', '北京市'], ['京']]);
  assert.equal(restored.banks[0].questions[0].images[0].dataUrl, IMAGE);
  assert.deepEqual(restored.favorites, { 'native-bank': ['native-blank'] });
  assert.equal(restored.crossPlatformMeta.favoriteQuestions['native-bank']['native-blank'].favoritedAt, MILLIS);
  assert.equal(restored.wrongBook['native-bank'][0].wrongCount, 2);
  assert.equal(restored.wrongBook['native-bank'][0].lastWrongAt, TIME);
  assert.deepEqual(restored.records[0].details[0].userBlankAnswers, ['北京市', '京']);
  assert.equal(restored.records[0].details[0].score, 4);
  const reloaded = loadWeb({ state: restored }).api;
  const roundtrip = plain(reloaded.buildNativeCompatibleBackupZipV611().payload).crossPlatform;
  assert.equal(roundtrip.studyRecords[0].id, 'native-record');
  assert.equal(roundtrip.studyRecords[0].questionResults[0].earnedScore, 4);
  assert.equal(roundtrip.favoriteQuestions[0].favoritedAt, MILLIS);
  assert.deepEqual(roundtrip.studyRecords[0].questionResults[0].userBlankAnswers, ['北京市', '京']);
});

test('缺失图片被检测并保持路径，不能被误当作已恢复图片', () => {
  const { api } = loadWeb();
  const payload = androidBackup();
  api.applyBackupAssetsV24(payload, {});
  assert(api.countUnresolvedBackupImagesV24(payload) > 0);
  assert.equal(payload.banks[0].questions[0].images[0].localPath, 'assets/pixel.png');
  assert.equal(Object.hasOwn(payload.banks[0].questions[0].images[0], 'dataUrl'), false);
});

test('旧单题库/题目数组与答案别名可读，重复题号及跨库同 ID 不重排', () => {
  const { api } = loadWeb();
  const question = { id: 'legacy-q', number: 9, questionType: 'multi', title: '选择偶数。', choices: ['二', '三', '四'], answerKeys: ['A', 'C'] };
  const single = api.normalizeBackupPayloadV23({ id: 'legacy-bank', name: '旧题库', questions: [question] }, 'legacy.json');
  assert.equal(single.banks[0].questions[0].number, 9);
  assert.equal(single.banks[0].questions[0].type, 'multiple');
  assert.deepEqual(plain(single.banks[0].questions[0].answer), ['A', 'C']);
  assert.equal(api.normalizeBackupPayloadV23([question], 'legacy.json').banks[0].questions[0].id, 'legacy-q');
  const full = api.normalizeBackupPayloadV23(webState(), 'web.json');
  assert.deepEqual(plain(full.banks[0].questions.slice(0, 3).map(item => item.number)), ['1', '1', '1']);
  assert.deepEqual(plain(full.banks.map(bank => bank.questions[0].id)), ['same-id', 'same-id']);
});

test('完整 JSON、单/多题库 JSON、原生 ZIP 与转换日志均排除独立存储中的假凭据', async () => {
  const { api, logs } = loadWeb({ state: webState(), local: fakeStorage, session: { shiroha_ai_key_session_v99: FAKE_SECRETS.ai, shiroha_webdav_password_session_v378: FAKE_SECRETS.webdav } });
  const banks = api.snapshot().banks;
  const full = api.buildBackupPayloadV23(banks, 'all_data', true);
  assert.equal(full.settings.aiImportV99.endpoint, 'https://ai.example.invalid/v1/chat/completions');
  assertNoSecrets(full);
  assertNoSecrets(api.buildQuestionBanksExportPayloadV598([banks[0]]));
  assertNoSecrets(api.buildQuestionBanksExportPayloadV598(banks));
  assertNoSecrets(api.serializeBankForCrossExportV53(banks[0]));
  const zip = await readZip(api, api.buildNativeCompatibleBackupZipV611().blob);
  assertNoSecrets(zip.payload);
  assertNoSecrets(logs);
});

test('启动归一化应无损保留合法题目扩展和富内容字段', () => {
  const initial = webState();
  const { api } = loadWeb({ state: initial });
  api.upgradeState();
  const actual = plain(api.snapshot()).banks[0].questions[6];
  assert.deepEqual({ extensions: actual.extensions, richContent: actual.richContent }, {
    extensions: initial.banks[0].questions[6].extensions,
    richContent: initial.banks[0].questions[6].richContent,
  });
});

test('JSON 恢复应保留合法题库扩展', () => {
  const { api } = loadWeb();
  const initial = webState();
  const restored = api.normalizeBackupPayloadV23(initial, 'full.json');
  assert.deepEqual(plain(restored.banks[0].extensions ?? null), initial.banks[0].extensions);
});

test('明确拒绝未来不支持的交换版本', () => {
  const { api } = loadWeb();
  const future = { ...androidBackup(), version: 999, schemaVersion: 999, crossPlatformSchemaVersion: 999 };
  assert.throws(() => api.normalizeBackupPayloadV23(future, 'future.json'), /版本|version|schema/i);
});

test('非敏感配置导出白名单应排除混入设置的秘密与凭据引用', () => {
  const state = webState();
  state.settings.legacyCredentials = FAKE_SECRETS;
  const { api } = loadWeb({ state });
  assertNoSecrets(api.buildBackupPayloadV23(api.snapshot().banks, 'all_data', true));
});

test('原生 ZIP 导出不得改写当前错题与收藏历史快照的图片引用', () => {
  const initial = webState();
  const { api } = loadWeb({ state: initial });
  api.buildNativeCompatibleBackupZipV611();
  assert.deepEqual(plain(api.snapshot()), initial, '导出必须保留原内存中的图片引用。');
});
