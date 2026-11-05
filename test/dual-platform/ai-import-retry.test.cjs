'use strict';
const { loadWebSource } = require('./source-tools.cjs');

const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const source = loadWebSource();

function setup(respond) {
  const requests = [];
  const original = [{ question: '原题', answer: ['A'] }];
  const context = vm.createContext({
    aiImportRequestV99: { running: false }, aiPreviewRequestV991: { running: false },
    bankEditSessionV45: null, AI_IMPORT_MAX_CHARS_V99: 50000,
    importCache: original, importWarnings: [], importReport: '', importDiagnostics: null,
    importPreviewFilter: '', importSelected: new Set(),
    ShirohaPlatform: {},
    ensureAiImportStateV99: () => ({ endpoint: 'https://example.invalid', model: 'fixture', timeoutSeconds: 10 }),
    readStoredAiKeyV99: () => '', aiImportRangeV992: () => ({ text: '待整理题目', label: '全文' }),
    aiRefactorContextV384: () => ({}), syncAiImportActionV99() {}, setAiImportStatusV99() {},
    showNotice() {}, refreshAiImportPanelV99() {},
    withAiTimeoutV99: (_timeout, run) => run({}),
    buildAiMessagesV99: (_text, options) => options,
    requestAiChatV99: async (_config, options) => { requests.push(options.requestedMode); return respond(requests.length); },
    parseAiRefactorPayloadV384: () => { throw new Error('模型业务 JSON 无效'); },
  });
  vm.runInContext(source.between('aiExecutionConfigV99', 'normalizeAiEndpointV99'), context);
  vm.runInContext(source.functionSource('startAiImportV99'), context);
  return { context, requests, original };
}

for (const failure of [
  { code: 'timeout' }, { code: 'cancelled', name: 'AbortError' },
  { code: 'outcome_unknown' }, { code: 'network_unavailable' },
  { status: 401 }, { status: 429 }, { status: 503 },
  { aiStage: 'json' }, { message: '无法连接接口' },
]) {
  test(`导入请求失败不另发文本兜底：${JSON.stringify(failure)}`, async () => {
    const { context, requests, original } = setup(async () => { throw Object.assign(new Error('执行失败'), failure); });
    await context.startAiImportV99();
    assert.deepEqual(requests, ['direct_questions']);
    assert.equal(context.importCache, original);
    assert.equal(context.aiImportRequestV99.running, false);
  });
}

test('已收到模型内容但业务结构无效时仍可请求一次文本兜底', async () => {
  const { context, requests, original } = setup(async () => ({ content: '模型返回的无效业务结构' }));
  await context.startAiImportV99();
  assert.deepEqual(requests, ['direct_questions', 'clean_text']);
  assert.equal(context.importCache, original);
});
