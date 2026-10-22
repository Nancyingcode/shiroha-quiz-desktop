'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadWeb, plain } = require('./web-source.cjs');
const { webState, androidBackup } = require('./fixtures/dataset.cjs');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps/web/platform/validation.js'), 'utf8'), context);
const validation = context.ShirohaPlatformValidation;

function ready(overrides = {}) {
  return { initialization: 'ready', currentRevision: 4, knownOperationIds: [], ...overrides };
}

function commit(overrides = {}) {
  return { contractVersion: 1, operationId: 'operation-1', expectedRevision: 4, changes: [{ kind: 'select_bank', bankId: 'bank-1' }], ...overrides };
}

function backup(overrides = {}) {
  return {
    kind: 'shiroha_quiz_web_full_backup', schemaVersion: 1, crossPlatformSchemaVersion: 1,
    richContentVersion: 'shiroha-web-rich-v1', banks: [{ id: 'bank-1', name: '契约样本', questions: [] }],
    activeBankId: 'bank-1', wrongBook: {}, favorites: {}, records: [],
    settings: { suppressDefaultBank: false }, ...overrides,
  };
}

function rejects(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
}

test('拒绝任意 SQL、系统路径及未知业务变更', () => {
  for (const change of [{ kind: 'sql', sql: 'DELETE FROM banks' }, { kind: 'write_file', path: 'C:\\outside' }, { kind: 'delete_bank', bankId: 9 }]) {
    rejects(validation.validateCommit(commit({ changes: [change] }), ready()), 'invalid_input');
  }
  rejects(validation.validateCommit(commit({ sql: 'SELECT 1' }), ready()), 'invalid_input');
});

test('合法变更保留富字段，题目以题库和题目组合定位', () => {
  const question = { id: 'same-id', type: 'blank', question: '填空', options: [], answer: ['甲'], blankAnswers: [['甲', '乙']], richContent: { formula: 'x^2' }, extension: { preserved: true } };
  const request = commit({ changes: [{ kind: 'put_question', bankId: 'bank-1', question }, { kind: 'put_question', bankId: 'bank-2', question }] });
  assert.equal(validation.validateCommit(request, ready()).ok, true);
  assert.equal(question.extension.preserved, true);
});

test('拒绝过期修订、非法修订与尚未就绪的写入', () => {
  rejects(validation.validateCommit(commit({ expectedRevision: 3 }), ready()), 'revision_conflict');
  rejects(validation.validateCommit(commit({ expectedRevision: -1 }), ready()), 'invalid_input');
  rejects(validation.validateCommit(commit(), ready({ initialization: 'loading' })), 'not_ready');
  rejects(validation.validateCommit(commit(), ready({ initialization: 'recovery_required' })), 'not_ready');
});

test('重复操作 ID 要求先查询已有结果，不能重复应用写入', () => {
  rejects(validation.validateCommit(commit(), ready({ knownOperationIds: ['operation-1'] })), 'duplicate_operation');
});

test('失败依赖和排他操作阻止普通写入', () => {
  rejects(validation.validateCommit(commit(), ready({ blockedByOperationId: 'failed-1' })), 'dependency_failed');
  rejects(validation.validateCommit(commit(), ready({ exclusiveOperationId: 'restore-1' })), 'operation_busy');
});

test('入队载荷是独立的深冻结副本', () => {
  const source = commit();
  const result = validation.freezeCommit(source, ready());
  assert.equal(result.ok, true);
  source.changes[0].bankId = 'later-edit';
  assert.equal(result.value.changes[0].bankId, 'bank-1');
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.changes[0]), true);
  assert.throws(() => { result.value.changes.push({ kind: 'select_bank', bankId: '' }); }, TypeError);
});

test('冻结拒绝循环对象和不能无损序列化的值', () => {
  const circular = commit();
  circular.changes.push(circular);
  rejects(validation.freezeCommit(circular, ready()), 'invalid_input');
  rejects(validation.freezeCommit(commit({ changes: [{ kind: 'put_settings', settings: { bad: undefined } }] }), ready()), 'invalid_input');
});

test('恢复、导入和重置必须等普通提交达到确定结果', () => {
  const restore = { contractVersion: 1, operationId: 'restore-1', expectedRevision: 4, kind: 'restore', mode: 'replace', backup: backup() };
  assert.equal(validation.validateExclusive(restore, ready()).ok, true);
  rejects(validation.validateExclusive(restore, ready({ pendingOperationIds: ['edit-1'] })), 'operation_busy');
  rejects(validation.validateCommit(commit({ changes: [{ kind: 'restore', backup: backup() }] }), ready()), 'invalid_input');
  assert.equal(validation.validateExclusive({ contractVersion: 1, operationId: 'reset-1', expectedRevision: 4, kind: 'reset' }, ready()).ok, true);
});

test('已取消任务的迟到成功不能覆盖终态', () => {
  rejects(validation.validateTaskTransition({ taskId: 'task-1', state: 'cancelled' }, { taskId: 'task-1', state: 'succeeded' }), 'invalid_transition');
  rejects(validation.validateTaskTransition({ taskId: 'task-1', state: 'succeeded' }, { taskId: 'task-1', state: 'running', phase: 'working' }), 'invalid_transition');
});

test('提交阶段取消必须以确定的事务结果为准', () => {
  const committing = { taskId: 'task-1', state: 'running', phase: 'committing' };
  rejects(validation.validateTaskTransition(committing, { taskId: 'task-1', state: 'cancelled' }), 'invalid_transition');
  assert.equal(validation.validateTaskTransition(committing, { taskId: 'task-1', state: 'succeeded' }).ok, true);
  assert.equal(validation.validateTaskTransition({ taskId: 'task-1', state: 'running', phase: 'validating' }, { taskId: 'task-1', state: 'cancelled' }).ok, true);
});

test('任务不能换 ID、跳过运行态或回退提交阶段', () => {
  rejects(validation.validateTaskTransition({ taskId: 'task-1', state: 'queued' }, { taskId: 'task-2', state: 'running', phase: 'working' }), 'invalid_transition');
  rejects(validation.validateTaskTransition({ taskId: 'task-1', state: 'queued' }, { taskId: 'task-1', state: 'succeeded' }), 'invalid_transition');
  rejects(validation.validateTaskTransition({ taskId: 'task-1', state: 'running', phase: 'committing' }, { taskId: 'task-1', state: 'running', phase: 'validating' }), 'invalid_transition');
});

test('协议、数据、富内容和跨端版本分别校验', () => {
  rejects(validation.validateCommit(commit({ contractVersion: 2 }), ready()), 'unsupported_version');
  for (const patch of [{ schemaVersion: 2 }, { crossPlatformSchemaVersion: 2 }, { richContentVersion: 'shiroha-web-rich-v2' }, { kind: 'shiroha_quiz_web_native_backup', version: 4 }]) {
    rejects(validation.validateBackup(backup(patch)), 'unsupported_version');
  }
});

test('凭据与凭据引用不能通过嵌套扩展字段进入备份', () => {
  for (const key of ['apiKey', 'mineruToken', 'password', 'credentialRef', 'Authorization', 'access_token']) {
    const source = backup({ banks: [{ id: 'bank-1', name: '样本', questions: [], extension: { [key]: 'FAKE_SECRET_ONLY' } }] });
    const result = validation.validateBackup(source);
    rejects(result, 'sensitive_data');
    assert.equal(JSON.stringify(result).includes('FAKE_SECRET_ONLY'), false);
    assert.equal(source.banks[0].extension[key], 'FAKE_SECRET_ONLY');
  }
});

test('备份设置按白名单检查，允许非敏感端点并保留明确关闭语义', () => {
  const source = backup({ settings: { suppressDefaultBank: false, aiImportV99: { provider: 'custom', endpoint: 'https://example.test/v1/chat/completions', model: 'test', timeoutSeconds: 30, rememberKey: false } } });
  assert.equal(validation.validateBackup(source).ok, true);
  assert.equal(source.settings.suppressDefaultBank, false);
  rejects(validation.validateBackup(backup({ settings: { futureUnknownSetting: true } })), 'invalid_input');
});

test('普通变更也不能携带秘密、畸形题库或空变更', () => {
  rejects(validation.validateCommit(commit({ changes: [{ kind: 'put_settings', settings: { apiKey: 'FAKE' } }] }), ready()), 'sensitive_data');
  rejects(validation.validateCommit(commit({ changes: [{ kind: 'put_bank', bank: { id: 'bank-1', questions: 'bad' } }] }), ready()), 'invalid_input');
  rejects(validation.validateCommit(commit({ changes: [] }), ready()), 'invalid_input');
});

test('备份校验不改写已有 ID、共享题目 ID 和合法扩展', () => {
  const q = { id: 'shared-id', question: '公式 $x^2$', type: 'short', options: [], answer: [], extension: { formula: true } };
  const source = backup({ banks: [{ id: 'bank-a', name: '甲', questions: [q] }, { id: 'bank-b', name: '乙', questions: [q] }], activeBankId: 'bank-a' });
  const original = JSON.stringify(source);
  assert.equal(validation.validateBackup(source).ok, true);
  assert.equal(JSON.stringify(source), original);
});

test('A2 真实 Web 完整、历史选中备份和双端原生兼容载荷满足契约', () => {
  const { api } = loadWeb({ state: webState() });
  const full = plain(api.buildBackupPayloadV23(api.snapshot().banks, 'all_data', true));
  const selected = plain(api.buildBackupPayloadV23([api.snapshot().banks[0]], 'selected_banks', false));
  const native = plain(loadWeb({ state: webState() }).api.buildNativeCompatibleBackupZipV611().payload);
  for (const payload of [full, selected, native, androidBackup()]) assert.equal(validation.validateBackup(payload).ok, true, payload.kind);
  rejects(validation.validateBackup({ ...androidBackup(), schemaVersion: 4 }), 'unsupported_version');
});

test('A2 实际单库/多库 JSON 仅作为题库导入，不混同完整恢复', () => {
  const { api } = loadWeb({ state: webState() });
  const sourceBanks = api.snapshot().banks;
  for (const selected of [[sourceBanks[0]], sourceBanks]) {
    const payload = plain(api.buildQuestionBanksExportPayloadV598(selected));
    assert.equal(validation.validateBankExport(payload).ok, true);
    assert.equal(validation.validateBackup(payload).ok, false);
  }
  const future = plain(api.buildQuestionBanksExportPayloadV598(sourceBanks));
  future.schemaVersion = 999;
  rejects(validation.validateBankExport(future), 'unsupported_version');
});

test('合法分词扩展 token 不当作服务凭据，也不丢弃', () => {
  const source = backup({ banks: [{ id: 'bank-1', name: '分词题', questions: [], extensions: { token: '词元' } }] });
  assert.equal(validation.validateBackup(source).ok, true);
  assert.equal(source.banks[0].extensions.token, '词元');
});

test('结果不确定的任务不能假报失败或已保存', () => {
  const running = { taskId: 'task-1', state: 'running', phase: 'committing' };
  rejects(validation.validateTaskTransition(running, { taskId: 'task-1', state: 'failed', error: { code: 'outcome_unknown', message: '待查询', retryable: false } }), 'invalid_transition');
  assert.equal(validation.validateTaskTransition(running, { taskId: 'task-1', state: 'running', phase: 'resolving' }).ok, true);
});

test('备份不能装入畸形学习数据、内部路径或凭据服务状态', () => {
  rejects(validation.validateBackup(backup({ records: 'bad' })), 'invalid_input');
  rejects(validation.validateBackup(backup({ banks: [{ id: 'bank-1', name: '图片', questions: [], extension: { localPath: 'C:\\private\\image.png' } }] })), 'invalid_input');
  rejects(validation.validateBackup(backup({ settings: { aiImportV99: { provider: 'custom', endpoint: 'https://user:FAKE@example.test', model: 'test' } } })), 'sensitive_data');
});

test('备份跨端视图必须保留可解析的学习数组', () => {
  for (const crossPlatform of [[], { schemaVersion: 1, wrongBook: 'bad' }, { schemaVersion: 1, favoriteQuestions: 'bad' }, { schemaVersion: 1, studyRecords: 'bad' }]) {
    rejects(validation.validateBackup(backup({ crossPlatform })), 'invalid_input');
  }
  assert.equal(validation.validateBackup(backup({ crossPlatform: { schemaVersion: 1, wrongBook: [], favoriteQuestions: [], studyRecords: [] } })).ok, true);
});

test('尚未确定结果的操作 ID 也不能重复提交', () => {
  rejects(validation.validateCommit(commit(), ready({ pendingOperationIds: ['operation-1'] })), 'duplicate_operation');
  assert.equal(validation.validateCommit(commit(), ready({ pendingOperationIds: ['prior-operation'] })).ok, true);
});

test('任务错误必须符合脱敏错误码及字段契约', () => {
  const queued = { taskId: 'task-1', state: 'queued' };
  for (const error of [
    { code: 'anything', message: '错误', retryable: false },
    { code: 'network' },
    { code: 'network', message: '错误', retryable: 'yes' },
    { code: 'network', message: '错误', retryable: false, authorization: 'FAKE_SECRET' },
    { code: 'network', message: '错误', retryable: false, path: 'C:\\sensitive' },
  ]) {
    const result = validation.validateTaskTransition(queued, { taskId: 'task-1', state: 'failed', error });
    rejects(result, 'invalid_transition');
    assert.equal(JSON.stringify(result).includes('FAKE_SECRET'), false);
  }
  assert.equal(validation.validateTaskTransition(queued, { taskId: 'task-1', state: 'failed', error: { code: 'network', message: '连接失败。', retryable: true } }).ok, true);
});

test('冻结拒绝会在 JSON 交换中丢失的稀疏数组和隐藏字段', () => {
  const sparse = commit();
  sparse.changes.length = 2;
  rejects(validation.freezeCommit(sparse, ready()), 'invalid_input');
  for (const key of ['hidden', Symbol('hidden')]) {
    const request = commit();
    Object.defineProperty(request.changes[0], key, { value: '不得丢失', enumerable: false });
    rejects(validation.freezeCommit(request, ready()), 'invalid_input');
  }
});

test('校验拒绝访问器和类实例，不能在冻结时执行 getter', () => {
  let reads = 0;
  const request = commit();
  Object.defineProperty(request.changes[0], 'bankId', { get() { reads++; return 'bank-1'; }, enumerable: true });
  rejects(validation.freezeCommit(request, ready()), 'invalid_input');
  assert.equal(reads, 0);
  class Setting { constructor() { this.value = '不能丢弃原型语义'; } }
  rejects(validation.freezeCommit(commit({ changes: [{ kind: 'put_settings', settings: new Setting() }] }), ready()), 'invalid_input');
});
