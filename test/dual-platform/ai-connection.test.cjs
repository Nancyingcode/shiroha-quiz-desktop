'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = readFileSync(require.resolve('../../apps/web/app.js'), 'utf8');
const config = { provider: 'ollama', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: 'test-model' };
const browserAdvice = /CORS|跨域|Origin|浏览器|当前网页/;

function functionsBetween(startName, endName) {
  const start = source.indexOf(startName);
  const end = source.indexOf(endName, start);
  assert(start >= 0 && end > start, 'AI 函数边界已改变，请更新测试加载器。');
  return source.slice(start, end);
}

function harness(native, ai = async () => { throw new Error('未配置 mock 响应'); }) {
  const timers = new Set();
  const context = vm.createContext({
    URL, AbortController: globalThis.AbortController,
    location: { origin: native ? 'http://tauri.localhost' : 'https://quiz.example.invalid' },
    AI_PROVIDER_PRESETS_V99: { ollama: { label: 'Ollama' }, custom: { label: '自定义接口' } },
    ShirohaPlatform: { network: { ai }, credentials: { native, redact: (_config, text) => text } },
    setTimeout(callback) { const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  for (const [start, end] of [
    ['function aiProviderLabelV99(', 'function readAiFormV99('],
    ['function aiCurrentOriginV375(', 'function renderAiDiagnosticV375('],
    ['function aiResponseContentV99(', 'async function testAiConnectionV99('],
  ]) vm.runInContext(functionsBetween(start, end), context);
  return { context, timers };
}

for (const [code, message, summary] of [
  ['binding_required', '服务绑定已变化，请重新输入凭据。', /凭据/],
  ['credential_pending', '凭据保存尚未完成，请重试保存设置。', /凭据/],
  ['credential_unavailable', '系统凭据不可用。', /凭据/],
  ['configuration_not_committed', '配置尚未保存，凭据尚未生效。', /配置/],
  ['invalid_service_config', '服务地址格式不符合要求。', /配置/],
  ['redirect_denied', '服务重定向未通过安全校验。', /重定向/],
  ['network_scope_denied', '服务重定向超出允许范围。', /重定向/],
  ['network_denied', '当前运行环境不允许访问该服务。', /访问/],
  ['timeout', '请求超时，请检查服务连接。', /超时/],
  ['cancelled', '请求已取消。', /取消/],
]) {
  test(`桌面 AI 保留 ${code} 原错误并给出对应诊断`, async () => {
    const failure = Object.assign(new Error(message), { code });
    const { context } = harness(true, async () => { throw failure; });
    await assert.rejects(context.requestAiChatV99(config, []), error => {
      assert.equal(error, failure);
      assert.equal(error.code, code);
      const diagnostic = context.buildAiDiagnosticV375(error, config);
      assert.match(diagnostic.summary, summary);
      assert.equal(diagnostic.statusMessage, message);
      assert.doesNotMatch(JSON.stringify(diagnostic), browserAdvice);
      return true;
    });
  });
}

for (const endpoint of [config.endpoint, 'https://ai.example.invalid/v1/chat/completions']) {
  test(`桌面网络失败 ${endpoint} 不给出浏览器跨域建议`, async () => {
    const failure = Object.assign(new Error('无法连接服务，请检查地址、证书和网络。'), { code: 'network_unavailable' });
    const { context } = harness(true, async () => { throw failure; });
    const current = { ...config, endpoint };
    await assert.rejects(context.requestAiChatV99(current, []), error => {
      assert.equal(error, failure);
      const diagnostic = context.buildAiDiagnosticV375(error, current);
      assert.match(diagnostic.summary, /无法连接/);
      assert.match(diagnostic.statusMessage, /地址|证书|网络/);
      assert.doesNotMatch(JSON.stringify(diagnostic), browserAdvice);
      return true;
    });
  });
}

test('桌面 HTTP 403 保留服务拒绝语义，不诊断为 CORS', async () => {
  const { context } = harness(true, async () => ({ ok: false, status: 403, text: async () => 'permission denied' }));
  await assert.rejects(context.requestAiChatV99(config, []), error => {
    assert.equal(error.status, 403);
    const diagnostic = context.buildAiDiagnosticV375(error, config);
    assert.match(diagnostic.summary, /拒绝/);
    assert.doesNotMatch(JSON.stringify(diagnostic), browserAdvice);
    return true;
  });
});

for (const [mode, error] of [['idle', null], ['ok', null], ['error', new Error('桌面服务不可用，请重新启动应用。')]]) {
  test(`桌面 ${mode} 诊断和 Ollama 命令不提供跨域配置`, () => {
    const { context } = harness(true);
    const diagnostic = context.buildAiDiagnosticV375(error, config, mode);
    assert.doesNotMatch(JSON.stringify(diagnostic), browserAdvice);
    assert.equal(context.aiOllamaCorsCommandV375(diagnostic), '');
  });
}

test('浏览器网络失败仍保留跨域诊断与 Ollama 命令', async () => {
  const failure = new TypeError('Failed to fetch');
  const { context } = harness(false, async () => { throw failure; });
  await assert.rejects(context.requestAiChatV99(config, []), error => {
    assert.equal(error.cause, failure);
    assert.equal(error.network, true);
    const diagnostic = context.buildAiDiagnosticV375(error, config);
    assert.match(diagnostic.summary, /疑似 CORS/);
    assert.match(context.aiOllamaCorsCommandV375(diagnostic), /OLLAMA_ORIGINS.*https:\/\/quiz\.example\.invalid/);
    return true;
  });
});

test('浏览器本地服务 HTTP 403 保留 Origin 排查建议', () => {
  const { context } = harness(false);
  const diagnostic = context.buildAiDiagnosticV375({ status: 403, message: 'forbidden' }, config);
  assert.match(diagnostic.summary, /CORS \/ Origin/);
  assert.match(diagnostic.statusMessage, /OLLAMA_ORIGINS/);
});

for (const native of [false, true]) {
  test(`${native ? '桌面' : '浏览器'} HTTP 参数错误中的秒数限制不会被诊断为超时`, async () => {
    const { context } = harness(native, async () => ({ ok: false, status: 400, text: async () => 'duration 参数不能超过 60 秒' }));
    await assert.rejects(context.requestAiChatV99(config, []), error => {
      assert.equal(error.status, 400);
      const diagnostic = context.buildAiDiagnosticV375(error, config);
      assert.equal(diagnostic.summary, '请求格式或模型名称可能不匹配');
      assert.equal(diagnostic.statusLabel, 'HTTP 400');
      return true;
    });
  });

  test(`${native ? '桌面' : '浏览器'} AI 超时保留超时诊断并释放定时器`, async () => {
    const { context, timers } = harness(native, async (_config, _payload, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('请求已取消。'), { name: 'AbortError', code: 'cancelled' })));
    }));
    const pending = context.withAiTimeoutV99(15, controller => context.requestAiChatV99(config, [], { controller }));
    assert.equal(timers.size, 1);
    [...timers][0].callback();
    await assert.rejects(pending, error => {
      const diagnostic = context.buildAiDiagnosticV375(error, config);
      assert.equal(diagnostic.summary, '请求超时');
      assert.match(diagnostic.statusMessage, /15 秒/);
      assert.doesNotMatch(JSON.stringify(diagnostic), browserAdvice);
      return true;
    });
    assert.equal(timers.size, 0);
  });
}

test('桌面主动取消不会被诊断为连接或跨域失败', async () => {
  const failure = Object.assign(new Error('请求已取消。'), { name: 'AbortError', code: 'cancelled' });
  const { context } = harness(true, async () => { throw failure; });
  await assert.rejects(context.requestAiChatV99(config, []), error => {
    assert.equal(error, failure);
    assert.match(context.buildAiDiagnosticV375(error, config).summary, /取消/);
    return true;
  });
});
