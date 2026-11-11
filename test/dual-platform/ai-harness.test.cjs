'use strict';
const { installAiTransport } = require('./ai-transport-helper.cjs');
const { installAiSettings } = require('./ai-settings-helper.cjs');
const { loadWebSource } = require('./source-tools.cjs');

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const status = { mode: 'harness', adapter: 'codex', model: 'mock-model', timeoutSeconds: 120, credentialStatus: 'subscription', runtimePath: 'fixture.exe', runtimeVersion: 'mock', runtimeSource: 'custom', runtimeState: 'ready', runtimeReceivedBytes: 0, runtimeTotalBytes: 0, ready: true, reason: '', revision: 4, busy: false };
function client(invoke, elements = {}, clock = { setTimeout, clearTimeout }) {
  const context = vm.createContext({ AbortController: globalThis.AbortController, document: { getElementById(id) { return elements[id] || null; } }, ShirohaPlatform: {}, ShirohaDesktopHost: { invoke }, crypto: { randomUUID: () => 'fixture-request' }, ...clock });
  vm.runInContext(readFileSync(require.resolve('../../apps/desktop/frontend/harness.js'), 'utf8'), context);
  return context.ShirohaPlatform.harness;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
const settleUi = () => new Promise(globalThis.setImmediate);
function settingsElements() {
  const elements = {};
  for (const id of ['ai-execution-settings', 'ai-execution-api', 'ai-execution-harness', 'ai-harness-login', 'ai-harness-prepare', 'ai-harness-prepare-cancel', 'ai-harness-use-managed', 'ai-harness-runtime-status', 'ai-harness-runtime-progress', 'ai-harness-status']) { elements[id] = {}; }
  elements['ai-settings'] = { classList: { contains: () => true } };
  elements['ai-harness-model'] = { value: 'gpt-6.1-sol' };
  elements['ai-harness-timeout'] = { value: '120' };
  for (const id of ['ai-harness-settings', 'ai-codex-settings', 'ai-codebuddy-settings', 'ai-deepseek-settings', 'ai-api-settings-fields', 'ai-settings-actions', 'ai-save-settings-v99', 'ai-test-connection-v99', 'ai-clear-settings-v99', 'ai-settings-status-v99']) { elements[id] = {}; }
  elements['ai-harness-adapter'] = { value: 'codex' };
  let selected = 'api';
  function bindModeSelection(mode) { Object.defineProperty(elements[`ai-execution-${mode}`], 'checked', { get: () => selected === mode, set: (value) => { if (value) { selected = mode; } } }); }
  for (const mode of ['api', 'harness']) { bindModeSelection(mode); }
  return elements;
}
function pollingClock() {
  const timers = new Map();let id = 0;
  return { setTimeout(callback) { timers.set((id += 1), callback);return id; }, clearTimeout(key) { timers.delete(key); }, async tick() { const entry = timers.entries().next().value;assert(entry, '缺少状态轮询');timers.delete(entry[0]);await entry[1](); }, timers };
}
const managedStatus = { ...status, mode: 'api', model: '', credentialStatus: 'missing', runtimePath: '', runtimeVersion: '', runtimeSource: 'managed', runtimeState: 'unprepared', ready: false };

test('冷启动无需进入设置页即可确认已保存的 Codex 订阅', async () => {
  const calls = []; const pending = deferred(); let updates = 0;
  const api = client(async (command, { request }) => {
    calls.push({ command, ...request });
    if (request.kind === 'check_readiness') { return pending.promise; }
    return { ...status, credentialStatus: 'missing', ready: false };
  });
  await api.initialize(); api.bind(() => { updates += 1; }, () => false);
  const checking = api.ensureReady();
  assert.equal(api.snapshot().readiness, 'checking');
  assert.deepEqual(calls.map((call) => call.kind), ['status', 'check_readiness']);
  pending.resolve({ ...status }); await checking;
  assert.equal(api.snapshot().ready, true);
  assert.ok(updates > 0, '检查结束应通知已经打开的业务页面');
  assert.equal(calls.some((call) => call.command === 'harness_execute'), false);
});

test('启动时已有只读检查在收尾，会在其结束后继续确认状态', async () => {
  const clock = pollingClock(); const calls = []; let reads = 0;
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'check_readiness') { return { ...status }; }
    reads += 1;
    return { ...status, ready: false, credentialStatus: 'missing', busy: reads === 1, operationBusy: false };
  }, {}, clock);
  await api.initialize(); await api.ensureReady();
  assert.deepEqual(calls, ['status']);
  await clock.tick(); await settleUi();
  assert.deepEqual(calls, ['status', 'status', 'check_readiness']);
  assert.equal(api.snapshot().ready, true);
});

test('启动检查遇到业务占用时等待结束后继续，不丢失检查请求', async () => {
  const clock = pollingClock(); const calls = []; let busy = true;
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    return request.kind === 'check_readiness' ? { ...status } : { ...status, ready: false, credentialStatus: 'missing' };
  }, {}, clock);
  await api.initialize(); api.bind(() => {}, () => busy); await api.ensureReady();
  assert.equal(api.snapshot().readiness, 'checking');
  assert.match(api.snapshot().reason, /等待/);
  assert.equal(clock.timers.size > 0, true, '等待业务结束时须保留检查机会');
  busy = false; await clock.tick(); await settleUi();
  assert.equal(calls.filter((kind) => kind === 'check_readiness').length, 1);
  assert.equal(api.snapshot().ready, true);
});

test('启动时原生任务忙碌，结束后重新读取并检查', async () => {
  const clock = pollingClock(); const calls = []; let busy = true;
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'check_readiness') { return { ...status }; }
    return { ...status, ready: false, credentialStatus: 'missing', busy, operationBusy: busy };
  }, {}, clock);
  await api.initialize(); await api.ensureReady();
  busy = false; await clock.tick(); await settleUi();
  assert.deepEqual(calls, ['status', 'status', 'check_readiness']);
  assert.equal(api.snapshot().ready, true);
});

test('等待期间已有状态变为就绪时结束等待，不重复检查', async () => {
  const clock = pollingClock(); const calls = []; const updates = []; let busy = true;
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    return busy ? { ...status, ready: false, credentialStatus: 'missing', busy: true } : { ...status };
  }, {}, clock);
  await api.initialize(); api.bind(() => { updates.push(api.snapshot().ready); }, () => false); await api.ensureReady();
  busy = false; await clock.tick(); await settleUi();
  assert.equal(api.snapshot().ready, true);
  assert.equal(updates.at(-1), true);
  assert.equal(clock.timers.size, 0);
  assert.deepEqual(calls, ['status', 'status']);
});

test('等待业务结束时状态读取失败，显示可重试错误而非无限等待', async () => {
  const clock = pollingClock(); let reads = 0;
  const api = client(async () => {
    reads += 1;
    if (reads > 1) { throw { code: 'harness_unavailable', message: '状态读取失败。' }; }
    return { ...status, ready: false, credentialStatus: 'missing' };
  }, {}, clock);
  await api.initialize(); api.bind(() => {}, () => true); await api.ensureReady();
  await clock.tick(); await settleUi();
  assert.equal(api.snapshot().readiness, 'error');
  assert.match(api.snapshot().reason, /状态读取失败/);
  assert.equal(clock.timers.size, 0);
});

test('等待占用结束后的组件失败不会再次自动重试', async () => {
  const clock = pollingClock(); let busy = true; let checks = 0;
  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') { checks += 1; throw { code: 'harness_runtime', message: '组件不存在。' }; }
    return { ...status, ready: false, credentialStatus: 'missing' };
  }, {}, clock);
  await api.initialize(); api.bind(() => {}, () => busy); await api.ensureReady();
  busy = false; await clock.tick(); await settleUi();
  assert.equal(checks, 1);
  assert.equal(clock.timers.size, 0);
});

test('等待检查期间切换到 API 后停止等待轮询', async () => {
  const clock = pollingClock(); let busy = true;
  let native = { ...status, ready: false, credentialStatus: 'missing' };
  const api = client(async (_command, { request }) => {
    if (request.kind === 'save') { native = { ...native, mode: request.mode, revision: native.revision + 1 }; }
    return { ...native };
  }, {}, clock);
  await api.initialize(); api.bind(() => {}, () => busy); await api.ensureReady();
  busy = false; await api.saveMode('api');
  await clock.tick(); await settleUi();
  assert.equal(api.snapshot().mode, 'api');
  assert.equal(clock.timers.size, 0);
});

test('等待检查期间选择未接入的提供方后停止等待轮询', async () => {
  const clock = pollingClock(); let busy = true;
  let native = { ...status, ready: false, credentialStatus: 'missing', runtimeState: 'ready' };
  const api = client(async (_command, { request }) => {
    if (request.kind === 'select_adapter') { native = { ...native, adapter: request.adapter, revision: native.revision + 1 }; }
    return { ...native };
  }, {}, clock);
  await api.initialize(); api.bind(() => {}, () => busy); await api.ensureReady();
  busy = false; await api.selectAdapter('deepseek'); await settleUi();
  assert.equal(api.snapshot().adapter, 'deepseek');
  assert.equal(clock.timers.size, 0);
});

test('AI 设置读取缓慢时题库先可用，核验完成后再启动后台检查', async () => {
  const pending = deferred(); let unlocked = false; let checks = 0;
  const context = vm.createContext({
    applicationStarted: false, applicationGeneration: 0, applicationReady: false, state: {},
    document: { body: { dataset: {} } },
    ShirohaPlatform: { credentials: { initialize: async () => {} }, harness: {
      initialize: () => pending.promise, ensureReady: async () => { checks += 1; },
    } },
    loadState: async () => ({}), ensureAiImportStateV99: () => ({}),
    lockApplication: (locked) => { unlocked = !locked; }, platformStatus() {}, init() {}, warnDev() {},
  });
  vm.runInContext(loadWebSource().functionSource('startApplication'), context);
  const starting = context.startApplication();
  try {
    await settleUi();
    assert.equal(unlocked, true);
    assert.equal(context.applicationReady, true);
    assert.equal(checks, 0);
  } finally { pending.resolve(); await starting; }
  await settleUi();
  assert.equal(checks, 1);
});

test('恢复发生在旧启动读取期间时，不启动旧生命周期的自动核验', async () => {
  const first = deferred(); const restored = deferred(); let calls = 0; let checks = 0;
  const context = vm.createContext({
    applicationStarted: false, applicationGeneration: 0, applicationReady: false, state: {},
    document: { body: { dataset: {} } },
    ShirohaPlatform: { credentials: { initialize: async () => {} }, harness: {
      initialize: () => { calls += 1; return calls === 1 ? first.promise : restored.promise; },
      ensureReady: async () => { checks += 1; },
    } },
    loadState: async () => ({}), ensureAiImportStateV99: () => ({}), lockApplication() {}, platformStatus() {}, init() {},
  });
  vm.runInContext(loadWebSource().functionSource('startApplication'), context);
  await context.startApplication(); await context.startApplication();
  first.resolve(); restored.resolve(); await settleUi();
  assert.equal(checks, 0);
});

test('多个 AI 入口共享检查，直接 API 启动不核验 Harness', async () => {
  const calls = []; const pending = deferred();
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'check_readiness') { return pending.promise; }
    return { ...status, credentialStatus: 'missing', ready: false };
  });
  await api.initialize();
  const first = api.ensureReady(); const second = api.ensureReady();
  assert.equal(calls.filter((kind) => kind === 'check_readiness').length, 1);
  pending.resolve({ ...status }); await Promise.all([first, second]);
  await api.ensureReady();
  assert.equal(calls.filter((kind) => kind === 'check_readiness').length, 1);

  const apiCalls = [];
  const direct = client(async (_command, { request }) => { apiCalls.push(request.kind); return { ...managedStatus }; });
  await direct.initialize(); await direct.ensureReady();
  assert.deepEqual(apiCalls, ['status']);
});

test('业务入口区分检查中、检查失败和不支持的任务', () => {
  const context = vm.createContext({ ShirohaPlatform: {}, URL });
  installAiSettings(context);
  const config = { execution: { ...status, ready: false, readiness: 'checking', reason: '正在检查 AI 状态…' } };
  assert.equal(context.aiAvailabilityV99(config, 'question_analysis').state, 'checking');
  assert.equal(context.aiAvailabilityV99(config, 'question_analysis').retryable, false);
  config.execution = { ...config.execution, readiness: 'error', reason: '检查失败，请重试。' };
  assert.equal(context.aiAvailabilityV99(config, 'question_analysis').state, 'error');
  assert.equal(context.aiAvailabilityV99(config, 'question_analysis').retryable, true);
  config.execution = { ...config.execution, adapter: 'codebuddy', readiness: 'checking' };
  assert.equal(context.aiAvailabilityV99(config, 'import_organize').state, 'unsupported');
  config.execution = { ...config.execution, mode: 'api', reason: 'Codex 未登录' };
  assert.match(context.aiAvailabilityV99(config, 'question_analysis').reason, /尚未配置 AI 服务/);
});

test('就绪检查失败后等待用户重试，不自动重复核验', async () => {
  const calls = []; let fail = true;
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'check_readiness' && fail) { throw { code: 'network_unavailable', message: '网络不可用。' }; }
    return request.kind === 'check_readiness' ? { ...status } : { ...status, ready: false, credentialStatus: 'missing' };
  });
  await api.initialize(); await api.ensureReady();
  assert.equal(api.snapshot().readiness, 'error');
  assert.match(api.snapshot().reason, /网络不可用/);
  await api.ensureReady();
  assert.equal(calls.filter((kind) => kind === 'check_readiness').length, 1);
  fail = false; await api.retryReadiness();
  assert.equal(api.snapshot().ready, true);
  assert.equal(calls.filter((kind) => kind === 'check_readiness').length, 2);
});

test('未确认停止时不把原生阻塞状态展示为可重试错误', async () => {
  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') { throw { code: 'harness_stopping', message: '停止尚未确认。' }; }
    return { ...status, ready: false, credentialStatus: 'missing' };
  });
  await api.initialize(); await api.ensureReady();
  assert.equal(api.snapshot().readiness, 'blocked');
  assert.equal(api.snapshot().readinessRetryable, false);
  assert.match(api.snapshot().reason, /重新启动/);
});

test('前端超时后原生报告停止失败时，仍保持不可重试的阻塞', async () => {
  const clock = pollingClock(); const pending = deferred();
  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') { return pending.promise; }
    if (request.kind === 'cancel') { pending.reject({ code: 'harness_stopping', message: '停止尚未确认。' }); }
    return { ...status, ready: false, credentialStatus: 'missing' };
  }, {}, clock);
  await api.initialize(); const checking = api.ensureReady();
  await clock.tick(); await checking;
  assert.equal(api.snapshot().readiness, 'blocked');
  assert.equal(api.snapshot().readinessRetryable, false);
  assert.match(api.snapshot().reason, /重新启动/);
});

test('检查失败按组件、登录、忙碌和超时分别提供正确入口', async () => {
  const cases = [
    ['codex', 'harness_runtime', 'idle'], ['codex', 'harness_runtime_integrity', 'idle'],
    ['codebuddy', 'codebuddy_runtime_unavailable', 'idle'], ['codebuddy', 'codebuddy_runtime_integrity', 'idle'],
    ['codex', 'harness_auth_cleanup', 'idle'], ['codebuddy', 'codebuddy_auth_expired', 'idle'],
    ['codex', 'harness_busy', 'error'], ['codex', 'timeout', 'error'], ['codex', 'invalid_input', 'error'],
  ];
  for (const [adapter, code, expected] of cases) {
    const initial = { ...status, adapter, accountRevision: adapter === 'codebuddy' ? 1 : undefined, ready: false, credentialStatus: 'missing' };
    const api = client(async (_command, { request }) => {
      if (request.kind === 'check_readiness') { throw { code, message: `fixture ${code}` }; }
      return { ...initial };
    });
    await api.initialize(); await api.ensureReady();
    assert.equal(api.snapshot().readiness || 'idle', expected, code);
    assert.match(api.snapshot().reason, new RegExp(code));
  }
});

test('读取设置和退出清理状态优先于旧检查错误', async () => {
  const loading = deferred();
  const reading = client(async () => loading.promise);
  const initialization = reading.initialize({ restored: true });
  try { assert.equal(reading.snapshot().readiness, 'checking'); } finally { loading.resolve({ ...status, ready: false }); await initialization; }

  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') { throw { code: 'network_unavailable', message: '旧网络错误。' }; }
    if (request.kind === 'clear') { throw { code: 'harness_logout', message: '清理失败。' }; }
    return { ...status, ready: false, credentialStatus: 'missing' };
  });
  await api.initialize(); await api.ensureReady();
  await assert.rejects(api.clear());
  assert.equal(api.snapshot().readiness, 'blocked');
  assert.equal(api.snapshot().readinessRetryable, false);
  assert.match(api.snapshot().reason, /退出登录尚未完成/);
});

test('配置修订过期后重试先读取最新配置，并合并重复点击', async () => {
  const calls = []; const pending = deferred(); const statusRefresh = deferred(); let revision = 4;
  const api = client(async (_command, { request }) => {
    calls.push({ ...request });
    if (request.kind === 'check_readiness') {
      if (request.revision === 4) { revision = 5; throw { code: 'harness_stale', message: '配置已变化。' }; }
      return pending.promise;
    }
    if (revision === 5) { return statusRefresh.promise; }
    return { ...status, revision, ready: false, credentialStatus: 'missing' };
  });
  await api.initialize(); await api.ensureReady();
  const first = api.retryReadiness(); const second = api.retryReadiness();
  await settleUi();
  const shared = api.ensureReady();
  assert.equal(calls.filter((request) => request.kind === 'check_readiness').length, 1);
  statusRefresh.resolve({ ...status, revision: 5, ready: false, credentialStatus: 'missing' });
  await settleUi();
  const checks = calls.filter((request) => request.kind === 'check_readiness');
  assert.equal(checks.length, 2); assert.equal(checks[1].revision, 5);
  pending.resolve({ ...status, revision: 5 }); await Promise.all([first, second, shared]);
  assert.equal(api.snapshot().ready, true);
});

test('取消期间迟到的就绪结果不能恢复旧执行状态', async () => {
  const pending = deferred();
  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') { return pending.promise; }
    if (request.kind === 'cancel_all') { return { ...status, revision: 5, ready: false, credentialStatus: 'missing' }; }
    return { ...status, ready: false, credentialStatus: 'missing' };
  });
  await api.initialize(); const checking = api.ensureReady();
  await api.cancelAll(); pending.resolve({ ...status }); await checking;
  assert.equal(api.snapshot().revision, 5);
  assert.equal(api.snapshot().ready, false);
});

test('取消后的新检查等待旧检查收敛，再使用当前修订', async () => {
  const old = deferred(); const calls = []; let native = { ...status, ready: false, credentialStatus: 'missing' };
  const api = client(async (_command, { request }) => {
    calls.push({ ...request });
    if (request.kind === 'check_readiness' && request.revision === 4) { return old.promise; }
    if (request.kind === 'cancel_all') { native = { ...native, revision: 5 }; return { ...native }; }
    if (request.kind === 'check_readiness') { native = { ...status, revision: 5 }; }
    return { ...native };
  });
  await api.initialize(); const first = api.ensureReady(); await api.cancelAll();
  const second = api.retryReadiness();
  assert.equal(calls.filter((call) => call.kind === 'check_readiness').length, 1);
  old.resolve({ ...status }); await first; await second;
  assert.deepEqual(calls.filter((call) => call.kind === 'check_readiness').map((call) => call.revision), [4, 5]);
  assert.equal(api.snapshot().ready, true);
});

test('恢复重读后显式重试等待旧检查，不借用失效结果', async () => {
  const old = deferred(); const calls = []; let restored = false;
  const api = client(async (_command, { request }) => {
    calls.push({ ...request });
    if (request.kind === 'check_readiness' && !request.confirmedAfterRestore) { return old.promise; }
    if (request.kind === 'check_readiness') { return { ...status, revision: 6, restoreRequired: false }; }
    return restored ? { ...status, revision: 5, ready: false, restoreRequired: true, reason: '恢复后需确认。' }
      : { ...status, ready: false, credentialStatus: 'missing' };
  });
  await api.initialize(); const first = api.ensureReady();
  restored = true; await api.initialize({ restored: true });
  const retry = api.retryReadiness();
  assert.equal(calls.filter((call) => call.kind === 'check_readiness').length, 1);
  old.resolve({ ...status }); await first; await retry;
  const checks = calls.filter((call) => call.kind === 'check_readiness');
  assert.equal(checks.length, 2);
  assert.equal(checks[1].revision, 5);
  assert.equal(checks[1].confirmedAfterRestore, true);
  assert.equal(api.snapshot().ready, true);
});

test('切换提供方先停止检查，停止期间旧路由不能重新执行', async () => {
  const checking = deferred(); const stopping = deferred(); const calls = [];
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'check_readiness') { return checking.promise; }
    if (request.kind === 'cancel') { return stopping.promise; }
    if (request.kind === 'select_adapter') { return { ...status, adapter: 'deepseek', revision: 5, ready: false }; }
    return { ...status, ready: false, credentialStatus: 'missing' };
  });
  await api.initialize(); const pendingCheck = api.ensureReady();
  const switching = api.selectAdapter('deepseek');
  assert.equal(api.snapshot().ready, false);
  assert.equal(calls.includes('select_adapter'), false);
  stopping.resolve({ ...status }); checking.resolve({ ...status });
  await pendingCheck; await switching;
  assert.equal(api.snapshot().adapter, 'deepseek');
  assert.equal(api.snapshot().ready, false);
  assert.deepEqual(calls, ['status', 'check_readiness', 'cancel', 'select_adapter']);
});

test('检查超时且停止状态未知时保持阻塞，不重复检查', async () => {
  const clock = pollingClock(); const calls = [];
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'status') { return { ...status, ready: false, credentialStatus: 'missing' }; }
    return new Promise(() => {});
  }, {}, clock);
  await api.initialize(); const checking = api.ensureReady();
  await clock.tick(); await settleUi();
  await clock.tick(); await checking;
  assert.equal(api.snapshot().readiness, 'blocked');
  assert.equal(api.snapshot().readinessRetryable, false);
  await api.retryReadiness();
  assert.deepEqual(calls, ['status', 'check_readiness', 'cancel']);
});

test('启动检查完成后的较新 CodeBuddy 账户状态不被旧卡片覆盖', async () => {
  const pending = deferred();
  const initial = { ...status, adapter: 'codebuddy', model: 'default', accountRevision: 1, credentialStatus: 'missing', ready: false };
  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') { return pending.promise; }
    return { ...initial };
  });
  await api.initialize(); const checking = api.ensureReady();
  api.codebuddyAccountChanged({ revision: 1, phase: 'signed_out', blocked: true });
  pending.resolve({ ...initial, accountRevision: 2, credentialStatus: 'subscription', ready: true });
  await checking;
  assert.equal(api.snapshot().ready, true);
  api.codebuddyAccountChanged({ revision: 1, phase: 'signed_out', blocked: true });
  assert.equal(api.snapshot().ready, true);
});

test('数据恢复后 CodeBuddy 需要显式刷新账户，再检查已有组件', async () => {
  const calls = []; let accountConfirmed = false;
  const initial = { ...status, adapter: 'codebuddy', model: 'default', accountRevision: 1, credentialStatus: 'missing', runtimeState: 'unprepared', ready: false };
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'check_readiness') { return { ...initial, accountRevision: 2, credentialStatus: 'subscription', runtimeState: 'ready', ready: true }; }
    return accountConfirmed ? { ...initial, accountRevision: 2, credentialStatus: 'subscription' } : { ...initial };
  });
  await api.initialize(); await api.initialize({ restored: true }); await api.ensureReady();
  assert.equal(api.snapshot().readiness, 'blocked');
  assert.equal(api.snapshot().readinessRetryable, false);
  assert.equal(calls.includes('check_readiness'), false);
  api.codebuddyAccountChanged({ revision: 1, phase: 'signed_in', blocked: false });
  await settleUi();
  assert.equal(api.snapshot().readiness, 'blocked', '恢复前的账户快照不能解除阻断');
  assert.equal(calls.includes('check_readiness'), false);
  accountConfirmed = true;
  api.codebuddyAccountChanged({ revision: 2, phase: 'signed_in', blocked: false });
  await settleUi(); await settleUi();
  assert.equal(api.snapshot().ready, true);
  assert.equal(calls.filter((kind) => kind === 'check_readiness').length, 1);
});

test('CodeBuddy 检查失败后主动刷新账户成功，可重新检查组件', async () => {
  const calls = []; let signedIn = false;
  const initial = { ...status, adapter: 'codebuddy', model: 'default', accountRevision: 1, credentialStatus: 'missing', runtimeState: 'unprepared', ready: false };
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'check_readiness' && !signedIn) { throw { code: 'codebuddy_auth_network', message: '网络失败。' }; }
    if (request.kind === 'check_readiness') { return { ...initial, accountRevision: 2, credentialStatus: 'subscription', runtimeState: 'ready', ready: true }; }
    return signedIn ? { ...initial, accountRevision: 2, credentialStatus: 'subscription' } : { ...initial };
  });
  await api.initialize(); await api.ensureReady();
  assert.equal(api.snapshot().readiness, 'error');
  signedIn = true; api.codebuddyAccountChanged({ revision: 2, phase: 'signed_in', blocked: false });
  await settleUi(); await settleUi();
  assert.equal(calls.filter((kind) => kind === 'check_readiness').length, 2);
  assert.equal(api.snapshot().ready, true);
});

test('Codex 组件校验失败后显示可重新准备的状态', async () => {
  const initial = { ...status, credentialStatus: 'missing', ready: false, runtimeSource: 'managed', runtimeState: 'ready' };
  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') { throw { code: 'harness_runtime', message: '组件未通过校验。' }; }
    return { ...initial };
  });
  await api.initialize(); await api.ensureReady();
  assert.equal(api.snapshot().ready, false);
  assert.equal(api.snapshot().runtimeState, 'unprepared');
});

test('Codex 组件校验失败后同步撤销验证产生的新配置修订', async () => {
  let native = { ...status, credentialStatus: 'missing', ready: false, runtimeSource: 'managed', runtimeState: 'ready' };
  const api = client(async (_command, { request }) => {
    if (request.kind === 'check_readiness') {
      native = { ...native, revision: native.revision + 1, runtimeState: 'unprepared' };
      throw { code: 'harness_runtime_integrity', message: '组件未通过校验。' };
    }
    return { ...native };
  });
  await api.initialize(); await api.ensureReady();
  assert.equal(api.snapshot().revision, native.revision);
  assert.equal(api.snapshot().runtimeState, 'unprepared');
  assert.match(api.snapshot().reason, /组件未通过校验/);
});

test('恢复后页面重载只显示阻塞状态，用户重试才确认 Codex', async () => {
  const calls = []; const elements = settingsElements();
  let native = { ...status, ready: false, runtimeState: 'unprepared', restoreRequired: true, reason: '数据恢复后请主动重新检查 Codex 状态。' };
  const api = client(async (_command, { request }) => {
    calls.push({ ...request });
    if (request.kind === 'check_readiness') {
      assert.equal(request.confirmedAfterRestore, true);
      native = { ...status, restoreRequired: false };
    }
    return { ...native };
  }, elements);
  await api.initialize(); api.bind(() => {}, () => false); api.render(); await api.ensureReady(); await settleUi();
  assert.equal(api.snapshot().readiness, 'blocked');
  assert.equal(api.snapshot().ready, false);
  assert.deepEqual(calls.map((call) => call.kind), ['status']);
  await api.retryReadiness();
  assert.equal(api.snapshot().ready, true);
  assert.deepEqual(calls.map((call) => call.kind), ['status', 'status', 'check_readiness']);
});

test('恢复后切换回 Codex 不得自动解除恢复确认', async () => {
  const calls = [];
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'select_adapter') { return { ...status, revision: 5, ready: false, restoreRequired: true, reason: '数据恢复后请主动重新检查 Codex 状态。' }; }
    return { ...status, adapter: 'deepseek', ready: false };
  });
  await api.initialize(); await api.selectAdapter('codex'); await settleUi();
  assert.equal(api.snapshot().readiness, 'blocked');
  assert.equal(api.snapshot().ready, false);
  assert.deepEqual(calls, ['status', 'select_adapter']);
});

test('请求撞上就绪检查时等待，输入变化后不发送旧题目', async () => {
  const pending = deferred(); let valid = true; let calls = 0;
  const platform = { harness: {
    status: () => ({ ...status, readiness: 'checking', ready: false }),
    snapshot: () => ({ ...status }), ensureReady: () => pending.promise,
    execute: async () => { calls += 1; return { content: 'fixture' }; },
  } };
  const context = vm.createContext({ ShirohaPlatform: platform, URL });
  installAiSettings(context); installAiTransport(context);
  const options = { task: 'question_analysis', isCurrent: () => valid };
  const first = context.requestAiChatV99({ execution: { ...status } }, [], options);
  const second = context.requestAiChatV99({ execution: { ...status } }, [], options);
  assert.equal(calls, 0);
  valid = false; pending.resolve();
  await assert.rejects(first, /变化|取消/); await assert.rejects(second, /变化|取消/);
  assert.equal(calls, 0);
  valid = true;
  const result = await context.requestAiChatV99({ execution: { ...status } }, [], options);
  assert.equal(result.content, 'fixture'); assert.equal(calls, 1);
  platform.harness.snapshot = () => ({ ...status, revision: status.revision + 1 });
  await assert.rejects(context.requestAiChatV99({ execution: { ...status } }, [], options), /变化/);
  assert.equal(calls, 1);
});

test('本次就绪检查推进修订后可使用新快照，不误报配置变化', async () => {
  const pending = deferred(); const executions = []; let native = { ...status, ready: false, credentialStatus: 'missing' };
  const api = client(async (command, { request }) => {
    if (command === 'harness_execute') { executions.push(request.revision); return { content: 'fixture' }; }
    if (request.kind === 'check_readiness') { await pending.promise; native = { ...status, revision: 5 }; }
    return { ...native };
  });
  await api.initialize(); const checking = api.ensureReady();
  const context = vm.createContext({ ShirohaPlatform: { harness: api }, URL });
  installAiSettings(context); installAiTransport(context);
  const request = context.requestAiChatV99({ execution: { ...status } }, [], { task: 'question_analysis', isCurrent: () => true });
  pending.resolve(); await checking;
  assert.equal((await request).content, 'fixture');
  assert.deepEqual(executions, [5]);
});

test('生成前捕获检查中快照，即使检查已结束也使用核验后的修订', async () => {
  const pending = deferred(); const executions = []; let native = { ...status, ready: false, credentialStatus: 'missing' };
  const api = client(async (command, { request }) => {
    if (command === 'harness_execute') { executions.push(request.revision); return { content: 'fixture' }; }
    if (request.kind === 'check_readiness') { await pending.promise; native = { ...status, revision: 5 }; }
    return { ...native };
  });
  await api.initialize(); const checking = api.ensureReady();
  const captured = api.snapshot();
  pending.resolve(); await checking;
  const context = vm.createContext({ ShirohaPlatform: { harness: api }, URL });
  installAiSettings(context); installAiTransport(context);
  const result = await context.requestAiChatV99({ execution: captured }, [], { task: 'question_analysis', isCurrent: () => true });
  assert.equal(result.content, 'fixture');
  assert.deepEqual(executions, [5]);
});

test('检查完成后发生取消，即使修订未变化也不能发送旧请求', async () => {
  const pending = deferred(); let executions = 0;
  const initial = { ...status, ready: false, credentialStatus: 'missing' };
  const api = client(async (command, { request }) => {
    if (command === 'harness_execute') { executions += 1; return { content: 'fixture' }; }
    if (request.kind === 'check_readiness') { await pending.promise; return { ...status }; }
    return request.kind === 'cancel_all' ? { ...status } : { ...initial };
  });
  await api.initialize(); const checking = api.ensureReady();
  const captured = api.snapshot();
  pending.resolve(); await checking; await api.cancelAll();
  const context = vm.createContext({ ShirohaPlatform: { harness: api }, URL });
  installAiSettings(context); installAiTransport(context);
  await assert.rejects(context.requestAiChatV99({ execution: captured }, [], { task: 'question_analysis', isCurrent: () => true }), /变化|取消/);
  assert.equal(executions, 0);
});

test('检查成功且修订未变化时，同一生命周期的请求可以继续', async () => {
  const pending = deferred(); let executions = 0; let native = { ...status, ready: false, credentialStatus: 'missing' };
  const api = client(async (command, { request }) => {
    if (command === 'harness_execute') { executions += 1; return { content: 'fixture' }; }
    if (request.kind === 'check_readiness') { await pending.promise; native = { ...status }; }
    return { ...native };
  });
  await api.initialize(); const checking = api.ensureReady();
  const captured = api.snapshot();
  pending.resolve(); await checking;
  const context = vm.createContext({ ShirohaPlatform: { harness: api }, URL });
  installAiSettings(context); installAiTransport(context);
  assert.equal((await context.requestAiChatV99({ execution: captured }, [], { task: 'question_analysis', isCurrent: () => true })).content, 'fixture');
  assert.equal(executions, 1);
});

test('就绪检查不能把已确认的 CodeBuddy 换号当成普通修订变化', async () => {
  const original = { ...status, adapter: 'codebuddy', model: 'default', accountRevision: 1, ready: false };
  const api = client(async (_command, { request }) => (request.kind === 'check_readiness'
    ? { ...original, revision: 5, accountRevision: 2, ready: true }
    : { ...original }));
  await api.initialize(); await api.ensureReady();
  assert.equal(api.isReadinessTransition({ ...original, ready: true }, api.snapshot()), false);
});

test('等待检查的任务缺少上下文验证时给出明确错误', async () => {
  const platform = { harness: { status: () => ({ ...status, readiness: 'checking' }), ensureReady: async () => {}, snapshot: () => ({ ...status }) } };
  const context = vm.createContext({ ShirohaPlatform: platform, URL });
  installAiSettings(context); installAiTransport(context);
  await assert.rejects(context.requestAiChatV99({ execution: { ...status } }, [], { task: 'question_analysis' }), /缺少上下文确认/);
});

test('单题请求等待期间切题，不发送原题内容', async () => {
  const pending = deferred(); const items = [{ id: 'first' }, { id: 'second' }];
  const owner = { items, idx: 0 }; let sends = 0;
  const context = vm.createContext({ AbortController });
  vm.runInContext(readFileSync(require.resolve('../../apps/web/ai-question-sessions.js'), 'utf8'), context);
  const sessions = context.ShirohaAiQuestionSessions.createPractice({
    practice: { current: () => owner },
    question: { current: () => items[owner.idx], allowed: () => true, key: (item) => item?.id, fingerprint: (item) => item?.id, answer: () => ({ chosen: ['A'] }), hasImages: () => false },
    request: { config: () => ({ configured: true, requestConfig: { timeoutSeconds: 120 } }), timeout: (_seconds, run) => run(new AbortController()),
      chat: async (_config, _messages, options) => { await pending.promise; if (!options.isCurrent()) { throw new Error('题目已变化'); } sends += 1; return { content: 'fixture' }; }, analysisMessages: () => [] },
    result: { analysis: () => ({ analysis: 'fixture' }) }, view: { render() {}, sanitize: (message) => message, notice() {} },
  });
  const running = sessions.runAnalysis(); owner.idx = 1; pending.resolve(); await running;
  assert.equal(sends, 0);
});

test('复制登录信息的回调读取绑定后更新的状态', async () => {
  const elements = settingsElements();
  elements['ai-harness-copy-url'] = {};
  elements['ai-harness-copy-code'] = {};
  const copied = [];
  const clock = { ...pollingClock(), navigator: { clipboard: { writeText: async (value) => { copied.push(value); } } } };
  let native = { ...status, loginUrl: 'https://auth.example.invalid/old', userCode: 'OLD' };
  const api = client(async () => ({ ...native }), elements, clock);
  await api.initialize();
  api.bind(() => {}, () => false);
  elements['ai-harness-copy-url'].onclick();
  elements['ai-harness-copy-code'].onclick();
  await settleUi();
  native = { ...native, revision: 5, loginUrl: 'https://auth.example.invalid/new', userCode: 'NEW' };
  await api.initialize();
  elements['ai-harness-copy-url'].onclick();
  elements['ai-harness-copy-code'].onclick();
  await settleUi();
  assert.deepEqual(copied, ['https://auth.example.invalid/old', 'OLD', 'https://auth.example.invalid/new', 'NEW']);
});

test('下载中切换保留后台任务，切回不重新准备并按提供方取消', async () => {
  const elements = settingsElements();const clock = pollingClock();const calls = [];
  for (const id of ['ai-harness-background', 'ai-harness-background-status', 'ai-harness-background-view', 'ai-harness-background-cancel']) { elements[id] = {}; }
  const task = { adapter: 'codex', id: 'task-codex', phase: 'downloading', received: 42, total: 100 };
  let native = { ...managedStatus, mode: 'harness', operationBusy: false, componentTasks: [] };
  const api = client(async (_command, { request }) => {
    calls.push(request);
    if (request.kind === 'prepare_runtime') { native = { ...native, runtimeState: 'preparing', busy: true, componentTasks: [task] }; }
    if (request.kind === 'select_adapter') { native = { ...native, adapter: request.adapter, revision: native.revision + 1, runtimeState: request.adapter === 'codex' ? 'preparing' : 'ready', busy: request.adapter === 'codex', accountRevision: 1 }; }
    if (request.kind === 'cancel_preparation') { native = { ...native, runtimeState: 'cancelled', busy: false, componentTasks: [] }; }
    return { ...native };
  }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);api.render();await settleUi();
  assert.equal(elements['ai-harness-adapter'].disabled, false);
  assert.equal(api.status().busy, false, '组件准备不冒充模型忙碌');
  await api.selectAdapter('codebuddy');await settleUi();
  assert.equal(elements['ai-harness-background'].hidden, false);
  assert.match(elements['ai-harness-background-status'].textContent, /Codex.*42%/);
  await api.selectAdapter('codex');await settleUi();
  assert.equal(calls.filter((call) => call.kind === 'prepare_runtime').length, 1);
  assert.equal(calls.some((call) => call.kind === 'cancel_all'), false);
  elements['ai-harness-prepare-cancel'].onclick();await settleUi();
  assert.deepEqual({ ...calls.find((call) => call.kind === 'cancel_preparation') }, { kind: 'cancel_preparation', adapter: 'codex', id: 'task-codex' });
  assert.equal(native.componentTasks.length, 0);
  assert.equal(clock.timers.size, 0);
});

test('组件恰好完成导致选择修订过期时，重读并保存同一次用户选择', async () => {
  const elements = settingsElements();const clock = pollingClock();const calls = [];let selections = 0;
  let native = { ...managedStatus, mode: 'harness', adapter: 'codebuddy', operationBusy: false, runtimeState: 'preparing', busy: true, componentTasks: [{ adapter: 'codebuddy', id: 'task', phase: 'checking', received: 0, total: 0 }] };
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'select_adapter') {
      if ((selections += 1) === 1) { native = { ...native, revision: 5, runtimeState: 'ready', busy: false, componentTasks: [] };throw { code: 'harness_stale' }; }
      assert.equal(request.revision, 5);
      native = { ...native, adapter: request.adapter, revision: 6 };
    }
    return { ...native };
  }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);
  await api.selectAdapter('codex');await settleUi();
  assert.equal(api.status().adapter, 'codex');assert.equal(elements['ai-codex-settings'].hidden, false);
  assert.equal(selections, 2);assert.equal(calls.includes('cancel_all'), false);
});

test('本地组件检查不显示下载字节，初始化延迟显示设置加载状态', async () => {
  const elements = settingsElements();const pending = deferred();const clock = pollingClock();
  elements['ai-harness-loading'] = {};elements['ai-harness-load-retry'] = {};
  const task = { adapter: 'codex', id: 'checking', phase: 'checking', received: 0, total: 0 };
  const native = { ...managedStatus, mode: 'harness', runtimeState: 'preparing', operationBusy: false, componentTasks: [task] };
  const api = client(async () => pending.promise, elements, clock);
  const initializing = api.initialize();
  assert.equal(elements['ai-harness-loading'].hidden, false);
  assert.equal(elements['ai-harness-settings'].hidden, true);
  pending.resolve(native);await initializing;api.bind(() => {}, () => false);
  assert.match(elements['ai-harness-runtime-status'].textContent, /检查本地组件/);
  assert.equal(elements['ai-harness-runtime-progress'].hidden, true);
  native.runtimeState = 'ready';native.componentTasks = [];await api.initialize();
});

for (const adapter of ['codex', 'codebuddy', 'deepseek']) {
  test(`Harness选择${adapter}时仅显示对应面板，API模式隐藏所有订阅面板`, async () => {
    const elements = settingsElements();const calls = [];
    const api = client(async (_command, { request }) => { calls.push(request.kind);return { ...status, adapter, ready: adapter === 'codex' }; }, elements);
    await api.initialize();api.bind(() => {}, () => false);api.render();await settleUi();
    assert.equal(elements['ai-harness-adapter'].value, adapter);
    for (const name of ['codex', 'codebuddy', 'deepseek']) { assert.equal(elements[`ai-${name}-settings`].hidden, name !== adapter); }
    if (adapter !== 'codex') {
      assert.deepEqual(calls, ['status']);
      assert.equal(elements['ai-test-connection-v99'].hidden, adapter === 'deepseek');
      assert.equal(elements['ai-test-connection-v99'].disabled, true, '未就绪时测试按钮禁用，但提供方仍可切换');
    }
    elements['ai-execution-api'].checked = true;elements['ai-execution-api'].onchange();await settleUi();
    for (const name of ['codex', 'codebuddy', 'deepseek']) { assert.equal(elements[`ai-${name}-settings`].hidden, true); }
    assert.match(elements['ai-settings-status-v99'].textContent, /直接 API/);
    assert.equal(calls.some((kind) => kind === 'logout' || kind === 'clear'), false);
  });
}

test('选择立即阻断旧Codex快照，保存成功保留订阅且迟到状态不能改回界面', async () => {
  const saving = deferred();const stale = deferred();const calls = [];const elements = settingsElements();let reads = 0;
  elements['ai-harness-auth-refresh'] = {};
  const api = client(async (command, { request }) => {
    calls.push({ command, ...request });
    if (request.kind === 'select_adapter') { return saving.promise; }
    if (request.kind === 'status' && (reads += 1) > 1) { return stale.promise; }
    return { ...status };
  }, elements);
  await api.initialize();api.bind(() => {}, () => false);
  const old = api.snapshot();elements['ai-harness-auth-refresh'].onclick();await settleUi();
  const selected = api.selectAdapter('codebuddy');
  assert.equal(api.snapshot().adapter, 'codebuddy');assert.equal(api.snapshot().ready, false);
  await assert.rejects(api.execute(old, 'question_analysis', []));
  assert.equal(elements['ai-codebuddy-settings'].hidden, false);
  saving.resolve({ ...status, adapter: 'codebuddy', ready: false, revision: 5 });await selected;
  stale.resolve({ ...status, revision: 99 });await settleUi();api.render();
  assert.equal(api.snapshot().adapter, 'codebuddy');assert.equal(elements['ai-harness-adapter'].value, 'codebuddy');
  assert.equal(api.status().credentialStatus, 'subscription');
  assert.equal(calls.some((call) => call.command === 'harness_execute' || ['logout', 'clear', 'inspect'].includes(call.kind)), false);
  assert.deepEqual(calls.find((call) => call.kind === 'select_adapter'), { command: 'harness_control', kind: 'select_adapter', adapter: 'codebuddy', revision: 4 });
});

test('选择失败恢复已保存的提供方且禁止旧执行，保存重试目标并使用当前修订', async () => {
  const calls = [];const elements = settingsElements();let fail = true;
  const api = client(async (command, { request }) => {
    calls.push({ command, ...request });
    if (request.kind === 'select_adapter') {
      if (fail) { throw { code: 'save_failed', message: '保存失败' }; }
      return { ...status, adapter: request.adapter, ready: false, revision: 5 };
    }
    return { ...status };
  }, elements);
  await api.initialize();api.bind(() => {}, () => false);
  await assert.rejects(api.selectAdapter('deepseek'));
  api.render();assert.equal(api.snapshot().adapter, 'codex');assert.equal(api.snapshot().ready, false);
  assert.equal(elements['ai-harness-adapter'].value, 'codex');
  assert.equal(elements['ai-save-settings-v99'].hidden, false);
  await assert.rejects(api.execute({ ...status }, 'batch_analysis', []));
  await assert.rejects(api.test());
  fail = false;await api.saveMode('harness');
  assert.equal(api.status().adapter, 'deepseek');assert.equal(api.status().revision, 5);
  assert.equal(calls.filter((call) => call.kind === 'select_adapter').length, 2);
  assert.equal(calls.some((call) => call.command === 'harness_execute' || call.kind === 'clear' || call.kind === 'logout'), false);
});

for (const outcome of ['success', 'failure']) {
  test(`重新初始化与提供方保存${outcome}重叠时旧Codex始终不可执行`, async () => {
    const saving = deferred();const calls = [];const elements = settingsElements();let reads = 0;
    elements['ai-harness-auth-refresh'] = {};
    const native = { ...status, adapter: 'codebuddy', ready: false, revision: 5, reason: 'CodeBuddy 模型执行尚未开放。' };
    const api = client(async (command, { request }) => {
      calls.push({ command, ...request });
      if (request.kind === 'select_adapter') { return saving.promise; }
      return (reads += 1) === 1 ? { ...status } : { ...native };
    }, elements);
    await api.initialize();api.bind(() => {}, () => false);const old = api.snapshot();
    const selection = api.selectAdapter('codebuddy');const rejected = assert.rejects(selection);
    const initializing = api.initialize();
    assert.equal(api.snapshot().ready, false, '重新读取开始即停用旧已就绪状态');
    await initializing;
    assert.equal(api.status().ready, false, '保存未收敛时的查询不能解除阻断');
    if (outcome === 'success') { saving.resolve(native); } else { saving.reject(new Error('保存回复失败')); }
    await rejected;
    assert.equal(api.status().busy, false);assert.equal(api.snapshot().ready, false);
    assert.match(api.status().reason, /刷新|重新/);
    await assert.rejects(api.execute(old, 'question_analysis', []));
    assert.equal(calls.some((call) => call.command === 'harness_execute'), false);
    elements['ai-harness-auth-refresh'].onclick();await settleUi();
    assert.equal(api.snapshot().adapter, 'codebuddy');assert.equal(api.snapshot().revision, 5);
    assert.equal(api.snapshot().ready, false);
  });
}

test('旧初始化查询的失败不能覆盖新生命周期已确认的提供方状态', async () => {
  const stale = deferred();let reads = 0;
  const native = { ...status, adapter: 'deepseek', ready: false, revision: 6, reason: 'DeepSeek 尚未接入。' };
  const api = client(async () => {
    reads += 1;
    if (reads === 1) { return { ...status }; }
    if (reads === 2) { return stale.promise; }
    return { ...native };
  });
  await api.initialize();const old = api.initialize();await api.initialize();
  stale.reject(new Error('旧生命周期读取失败'));await old;
  assert.equal(api.snapshot().adapter, 'deepseek');assert.equal(api.snapshot().reason, native.reason);
});

test('任务忙碌拒绝切换，返回Codex保留登录并刷新环境', async () => {
  const elements = settingsElements();const calls = [];let busy = true;let native = { ...status };
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'select_adapter') { native = { ...native, adapter: request.adapter, revision: native.revision + 1, ready: request.adapter === 'codex' }; }
    return { ...native };
  }, elements);
  await api.initialize();api.bind(() => {}, () => busy);
  await assert.rejects(api.selectAdapter('codebuddy'), (error) => error.code === 'busy');
  assert.equal(api.formAdapter(), 'codex');assert.equal(calls.includes('select_adapter'), false);
  busy = false;await api.selectAdapter('codebuddy');await api.selectAdapter('codex');await settleUi();
  assert.equal(api.status().credentialStatus, 'subscription');assert.equal(calls.includes('inspect'), true);
  assert.equal(calls.some((kind) => kind === 'login' || kind === 'logout' || kind === 'clear'), false);
});

for (const adapter of ['codebuddy', 'deepseek']) {
  test(`${adapter}即使收到伪造ready也不能执行或触发Codex专属操作`, async () => {
    const elements = settingsElements();for (const id of ['ai-harness-choose', 'ai-harness-inspect', 'ai-harness-logout', 'ai-harness-auth-refresh', 'ai-harness-stop']) { elements[id] = {}; }
    const calls = [];const api = client(async (command, { request }) => { calls.push({ command, ...request });return { ...status, adapter }; }, elements);
    await api.initialize();api.bind(() => {}, () => false);
    assert.equal(api.snapshot().ready, false);
    for (const task of ['connection_test', 'import_organize', 'batch_review', 'batch_analysis', 'question_analysis', 'question_followup']) { await assert.rejects(api.execute({ ...status, adapter }, task, [])); }
    await assert.rejects(api.test());await assert.rejects(api.clear());
    for (const id of ['ai-harness-login', 'ai-harness-prepare', 'ai-harness-use-managed', 'ai-harness-choose', 'ai-harness-inspect', 'ai-harness-logout']) { elements[id].onclick(); }
    await api.cancelAll();await settleUi();
    assert.deepEqual(calls.map((call) => call.kind), adapter === 'codebuddy' ? ['status', 'cancel_all'] : ['status']);
  });
}

test('共享业务冻结真实提供方标签并拒绝未开放提供方，隐私文案不冒称OpenAI', () => {
  let execution = { ...status };
  const context = vm.createContext({ ShirohaPlatform: { harness: { snapshot: () => execution } }, AI_PROVIDER_PRESETS_V99: {} });
  installAiSettings(context);
  for (const [adapter, label] of [['codex', 'Codex'], ['codebuddy', 'CodeBuddy'], ['deepseek', 'DeepSeek']]) {
    execution = { ...status, adapter, model: adapter === 'codebuddy' ? 'deepseek-v4.1-flash' : status.model };const config = context.aiExecutionConfigV99();
    assert.equal(config.provider, adapter);assert.equal(context.aiExecutionLabelV99(config), `${label} Harness`);
    assert.equal(context.aiConfiguredV99(config), adapter === 'codex');
    if (adapter !== 'codex') {
      assert.notEqual(config.model, status.model);
      if (adapter === 'codebuddy') { assert.equal(config.model, execution.model); }
      const privacy = context.aiHarnessPrivacyV99(config, '本题文字');
      assert.doesNotMatch(privacy, /Codex|OpenAI/);assert.match(privacy, /不会发送|尚未开放/);
    }
  }
});

test('共享清除入口在非Codex提供方不确认或清理Codex授权', async () => {
  const source = loadWebSource();
  for (const adapter of ['codebuddy', 'deepseek']) {
    const calls = [];
    const context = vm.createContext({ ShirohaPlatform: { harness: { formMode: () => 'harness', formAdapter: () => adapter, snapshot: () => ({ ...status, adapter }), cancelAll: async () => calls.push('cancel'), clear: async () => calls.push('clear') } }, ShirohaDialogs: { confirm: async () => { calls.push('confirm');return true; } }, setAiSettingsStatusV99() {}, updateAiConnectionPillV99() {}, syncAiImportActionV99() {} });
    installAiSettings(context);
    vm.runInContext(source.functionSource('clearAiSettingsV99'), context);
    await context.clearAiSettingsV99();assert.deepEqual(calls, []);
  }
});

test('共享测试与统一请求入口拒绝缺少账户修订的CodeBuddy和未开放提供方', async () => {
  const source = loadWebSource();
  for (const adapter of ['codebuddy', 'deepseek']) {
    const calls = [];const messages = [];const button = { disabled: false, textContent: '测试连接' };
    const context = vm.createContext({
      ShirohaPlatform: { harness: { formMode: () => 'harness', formAdapter: () => adapter, snapshot: () => ({ ...status, adapter }), test: async () => calls.push('test'), execute: async () => calls.push('execute') }, network: { ai: async () => calls.push('network') } },
      $: () => button, setAiSettingsStatusV99: (message) => messages.push(message), updateAiConnectionPillV99() {},
    });
    installAiSettings(context);
    vm.runInContext(source.between('testAiConnectionV99', 'aiQuestionKeyV991'), context);
    installAiTransport(context);
    await context.testAiConnectionV99();
    for (const task of ['connection_test', 'import_organize', 'batch_review', 'batch_analysis', 'question_analysis', 'question_followup']) {
      const missingAccount = adapter === 'codebuddy' && ['connection_test', 'question_analysis', 'question_followup'].includes(task);
      await assert.rejects(context.requestAiChatV99({ execution: { ...status, adapter } }, [], { task }), missingAccount ? /所选 Harness 尚未就绪/ : /尚未开放/);
    }
    assert.deepEqual(calls, []);assert.equal(button.disabled, false);assert.match(messages[0], adapter === 'codebuddy' ? /尚未就绪/ : /尚未开放/);
  }
});

test('Harness 每次操作冻结已保存配置并分派任务，不接触 API 设置', async () => {
  const calls = [];
  const api = client(async (command, args) => { calls.push({ command, request: args.request }); return command === 'harness_execute' ? { content: '{"analysis":"候选"}' } : { ...status }; });
  await api.initialize();
  const snapshot = api.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  const result = await api.execute(snapshot, 'question_analysis', [{ role: 'user', content: '测试题' }]);
  assert.equal(result.content, '{"analysis":"候选"}');
  assert.equal(calls[1].request.revision, 4);
  assert.equal(calls[1].request.task, 'question_analysis');
  assert.equal(calls[1].command, 'harness_execute');
  assert.equal('endpoint' in calls[1].request, false);
  assert.equal('apiKey' in calls[1].request, false);
});

test('取消后等待原生终态，迟到结果不能返回给业务', async () => {
  let finish;
  const calls = [];
  const api = client(async (command, args) => {
    calls.push(args.request);
    if (command === 'harness_execute') { return new Promise((resolve) => { finish = resolve; }); }
    return { ...status };
  });
  await api.initialize();
  const controller = new globalThis.AbortController();
  const pending = api.execute(api.snapshot(), 'question_followup', [], controller.signal);
  controller.abort();
  assert.equal(api.status().busy, true);
  await assert.rejects(api.execute(api.snapshot(), 'question_analysis', []), (error) => error.code === 'busy');
  finish({ content: '迟到结果' });
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal(calls.some((request) => request.kind === 'cancel'), true);
  assert.equal(api.status().busy, false);
});

for (const task of ['connection_test', 'import_organize', 'batch_review', 'batch_analysis', 'question_analysis', 'question_followup']) {
  test(`统一执行器发送明确任务种类：${task}`, async () => {
    const requests = [];
    const api = client(async (command, args) => { requests.push(args.request); return command === 'harness_execute' ? { content: '{"ok":true}' } : { ...status }; });
    await api.initialize();
    await api.execute(api.snapshot(), task, [{ role: 'user', content: '自建测试数据' }]);
    assert.equal(requests[1].task, task);
  });
}

test('保存 Harness 绕过 API 表单与题库设置写入，原 API 配置原样保留', async () => {
  const source = loadWebSource();
  const original = { provider: 'ollama', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', model: '旧模型', rememberKey: true, timeoutSeconds: 60 };
  const state = { settings: { aiImportV99: { ...original } } };
  const modes = [];
  const context = vm.createContext({ state, aiTasksBusyV99: () => false, ShirohaPlatform: { harness: { formMode: () => 'harness', async saveMode(mode) { modes.push(mode); } } }, readAiFormV99() { throw new Error('不得读取 API 表单'); }, runMutation() { throw new Error('不得写入题库配置'); }, setAiSettingsStatusV99() {}, syncAiImportActionV99() {}, updateAiConnectionPillV99() {} });
  vm.runInContext(source.between('saveAiSettingsV99', 'clearAiSettingsV99'), context);
  await context.saveAiSettingsV99();
  assert.deepEqual(modes, ['harness']);
  assert.deepEqual(state.settings.aiImportV99, original);
});

test('切回直接 API 时只改变路由，保留 Codex 运行配置及订阅授权', async () => {
  const requests = [];
  const api = client(async (_command, args) => { requests.push(args.request); return { ...status, mode: args.request.mode || status.mode }; });
  await api.initialize();
  await api.saveMode('api');
  assert.equal(requests[1].mode, 'api');
  assert.equal(requests[1].model, status.model);
  assert.equal('secret' in requests[1], false);
  assert.equal('rememberKey' in requests[1], false);
  assert.equal('endpoint' in requests[1], false);
  assert.equal(api.snapshot().mode, 'api');
});

test('连接测试仅接受校验通过的 JSON，文本响应不能冒充成功', async () => {
  const elements = { 'ai-execution-harness': { checked: true }, 'ai-harness-model': { value: status.model }, 'ai-harness-timeout': { value: '120' }, 'ai-harness-status': {} };
  const api = client(async (command) => (command === 'harness_execute' ? { content: '已完成！' } : { ...status }), elements);
  await api.initialize();
  await assert.rejects(api.test(), /不是有效 JSON/);
  assert.match(elements['ai-harness-status'].textContent, /不是有效 JSON/);
  assert.equal(elements['ai-harness-status'].className, 'notice warn');
});

for (const available of [false, true]) {
  test(`连接测试${available ? '执行失败' : '尚未就绪'}时清除执行中提示并保留错误`, async () => {
    const elements = { 'ai-execution-harness': { checked: true }, 'ai-harness-model': { value: status.model }, 'ai-harness-timeout': { value: '120' }, 'ai-harness-status': {} };
    let executions = 0;
    const message = available ? '隔离执行失败' : '请先完成订阅登录';
    const api = client(async (command) => {
      if (command === 'harness_execute') { executions += 1;throw { code: 'harness_unavailable', message }; }
      return { ...status, ready: available, reason: message };
    }, elements);
    await api.initialize();
    await assert.rejects(api.test(), (error) => error.message === message);
    assert.equal(executions, available ? 1 : 0);
    assert.equal(elements['ai-harness-status'].textContent, message);
    assert.equal(elements['ai-harness-status'].className, 'notice warn');
    assert.doesNotMatch(elements['ai-harness-status'].textContent, /正在执行/);
  });
}

test('配置更新后拒绝旧快照，未授权不能执行，不静默回退', async () => {
  let current = { ...status };
  let executions = 0;
  const api = client(async (command) => { if (command === 'harness_execute') { executions += 1; } return current; });
  await api.initialize();
  const frozen = api.snapshot();
  current = { ...status, revision: 5 };
  await api.initialize();
  await assert.rejects(api.execute(frozen, 'batch_review', []), (error) => error.code === 'configuration_changed');
  current = { ...current, ready: false, reason: '请完成订阅登录' };
  await api.initialize();
  await assert.rejects(api.execute(api.snapshot(), 'batch_analysis', []), /订阅登录/);
  assert.equal(executions, 0);
});

test('Harness 初始化失败只关闭 AI 执行，不影响题库初始化', async () => {
  const api = client(async () => { throw { code: 'storage_unavailable', message: '设置读取失败' }; });
  await api.initialize();
  assert.equal(api.status().ready, false);
  assert.match(api.status().reason, /设置读取失败/);
});

test('损坏的执行状态不能隐式回退到直接 API', async () => {
  const api = client(async () => ({ mode: 'unknown', revision: 1, ready: true }));
  await api.initialize();
  assert.equal(api.snapshot().mode, 'harness');
  assert.equal(api.snapshot().ready, false);
});

test('Harness 拒绝 API Key 授权状态，只接受订阅登录', async () => {
  const api = client(async () => ({ ...status, credentialStatus: 'remembered' }));
  await api.initialize();
  assert.equal(api.status().ready, false);
  await assert.rejects(api.execute(api.snapshot(), 'connection_test', []), (error) => error.code === 'harness_unavailable');
});

test('订阅授权只轮询已有登录状态，完成或取消后释放计时器', async () => {
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  let authorization = 'authenticating';
  const api = client(async (_command, args) => { requests.push(args.request.kind);return { ...status, credentialStatus: authorization, ready: authorization === 'subscription' }; }, {}, { setTimeout(callback, delay) { assert([1000, 15000].includes(delay));timers.set((timerId += 1), callback);return timerId; }, clearTimeout(id) { timers.delete(id); } });
  await api.initialize();
  assert.equal(timers.size, 1);
  const [id, callback] = [...timers][0];timers.delete(id);
  authorization = 'subscription';
  await callback();
  assert.equal(api.status().credentialStatus, 'subscription');
  assert.equal(timers.size, 0);
  assert.deepEqual(requests, ['status', 'status']);
  authorization = 'authenticating';await api.initialize();
  assert.equal(timers.size, 1);
  authorization = 'missing';await api.cancelAll();
  assert.equal(timers.size, 0);
});

test('较早发出的 status 迟到不能覆盖登录的新修订或停止授权轮询', async () => {
  const timers = new Map();
  let timerId = 0;
  let resolveStatus;
  let reads = 0;
  const elements = { 'ai-harness-login': {}, 'ai-harness-auth-refresh': {} };
  const initial = { ...status, revision: 4, credentialStatus: 'missing', ready: false };
  const signingIn = { ...initial, revision: 5, credentialStatus: 'authenticating', loginUrl: 'https://auth.example.invalid/device', userCode: 'TEST-CODE' };
  const api = client(async (_command, args) => {
    if (args.request.kind === 'login') { return signingIn; }
    if (args.request.kind === 'save') { return initial; }
    if ((reads += 1) === 1) { return initial; }
    return new Promise((resolve) => { resolveStatus = resolve; });
  }, elements, { setTimeout(callback) { timers.set((timerId += 1), callback);return timerId; }, clearTimeout(id) { timers.delete(id); } });
  await api.initialize();
  let changed;
  api.bind(() => changed?.(), () => false);
  elements['ai-harness-auth-refresh'].onclick();
  const loggedIn = new Promise((resolve) => { changed = () => { if (api.status().revision === 5) { resolve(); } }; });
  elements['ai-harness-login'].onclick();
  await loggedIn;
  assert.equal(api.status().revision, 5);
  assert.equal(timers.size, 2, '登录轮询与在途读取的超时各有一个计时器');
  const refreshed = new Promise((resolve) => { changed = resolve; });
  resolveStatus(initial);
  await refreshed;
  assert.equal(api.status().revision, 5, '旧 status 覆盖了已接受的新修订');
  assert.equal(api.status().credentialStatus, 'authenticating');
  assert.equal(api.status().userCode, 'TEST-CODE');
  assert.equal(timers.size, 1, '旧 status 停止了仍需进行的授权轮询');
});

for (const action of ['cancel_all', 'logout']) {
  test(`${action} 完成后迟到的已登录 status 不得恢复授权显示`, async () => {
    let resolveStatus;
    let reads = 0;
    const elements = { 'ai-harness-auth-refresh': {}, 'ai-harness-logout': {} };
    const ended = { ...status, revision: 5, credentialStatus: 'missing', ready: false };
    const api = client(async (_command, args) => {
      if (args.request.kind === 'logout') { return ended; }
      if (args.request.kind === 'cancel_all') { return action === 'logout' ? status : ended; }
      if ((reads += 1) === 1) { return status; }
      return new Promise((resolve) => { resolveStatus = resolve; });
    }, elements);
    await api.initialize();
    let changed;
    api.bind(() => changed?.(), () => false);
    elements['ai-harness-auth-refresh'].onclick();
    if (action === 'logout') {
      const loggedOut = new Promise((resolve) => { changed = () => { if (api.status().revision === 5) { resolve(); } }; });
      elements['ai-harness-logout'].onclick();
      await loggedOut;
    } else { await api.cancelAll(); }
    assert.equal(api.status().credentialStatus, 'missing');
    const refreshed = new Promise((resolve) => { changed = resolve; });
    resolveStatus(status);
    await refreshed;
    assert.equal(api.status().revision, 5);
    assert.equal(api.status().credentialStatus, 'missing');
    assert.equal(api.status().ready, false);
  });
}

test('取消全部任务等待在途执行终态，再允许保存配置', async () => {
  let finish;
  const api = client(async (command) => (command === 'harness_execute' ? new Promise((resolve) => { finish = resolve; }) : { ...status }));
  await api.initialize();
  const pending = api.execute(api.snapshot(), 'question_analysis', []);
  const rejected = assert.rejects(pending, (error) => error.name === 'AbortError');
  let stopped = false;
  const stopping = api.cancelAll().then(() => { stopped = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stopped, false);
  finish({ content: '旧结果' });
  await rejected;
  await stopping;
  assert.equal(stopped, true);
  await api.saveMode('api');
});

test('统一入口返回 Harness 内容，失败不走 API response_format 重试', async () => {
  let apiCalls = 0;
  let harnessCalls = 0;
  const context = vm.createContext({ ShirohaPlatform: { credentials: { native: true }, network: { ai() { apiCalls += 1; } }, harness: { async execute(snapshot, task) { harnessCalls += 1; assert.equal(snapshot.revision, 4); assert.equal(task, 'import_organize'); throw Object.assign(new Error('额度不足'), { code: 'quota_exceeded' }); } } } });
  installAiSettings(context);
  installAiTransport(context);
  await assert.rejects(context.requestAiChatV99({ execution: status }, [], { task: 'import_organize' }), /额度不足/);
  assert.equal(apiCalls, 0);
  assert.equal(harnessCalls, 1);
});

test('同一修订的 status 逆序返回不能恢复较旧的 busy 状态', async () => {
  const older = deferred();
  const newer = deferred();
  let reads = 0;
  const elements = { 'ai-harness-auth-refresh': {} };
  const api = client(async () => {
    reads += 1;
    if (reads === 1) { return status; }
    if (reads === 2) { return older.promise; }
    return newer.promise;
  }, elements);
  await api.initialize();
  api.bind(() => {}, () => false);
  elements['ai-harness-auth-refresh'].onclick();
  elements['ai-harness-auth-refresh'].onclick();
  newer.resolve({ ...status, busy: false });
  await settleUi();
  older.resolve({ ...status, busy: true });
  await settleUi();
  assert.equal(api.status().busy, false);
});

for (const ending of ['success', 'cancel']) {
  test(`执行 ${ending} 终态重新查询 busy，迟到的运行中 status 不覆盖终态`, async () => {
    const execution = deferred();
    const delayedStatus = deferred();
    let phase = 'idle';
    let reads = 0;
    const elements = { 'ai-harness-auth-refresh': {} };
    const api = client(async (command, args) => {
      if (command === 'harness_execute') { return execution.promise; }
      if (args.request.kind === 'cancel') { return { ...status, busy: true }; }
      if ((reads += 1) === 3) { return delayedStatus.promise; }
      return { ...status, busy: phase === 'running' };
    }, elements);
    await api.initialize();
    api.bind(() => {}, () => false);
    const controller = new globalThis.AbortController();
    const pending = api.execute(api.snapshot(), 'question_analysis', [], controller.signal);
    const completion = ending === 'cancel' ? assert.rejects(pending, (error) => error.name === 'AbortError') : pending;
    phase = 'running';
    elements['ai-harness-auth-refresh'].onclick();
    await settleUi();
    elements['ai-harness-auth-refresh'].onclick();
    if (ending === 'cancel') { controller.abort(); }
    phase = 'idle';
    execution.resolve({ content: '完成结果' });
    await completion;
    assert.equal(api.status().busy, false, '终态必须查询原生状态，不能保留运行中的缓存');
    delayedStatus.resolve({ ...status, busy: true });
    await settleUi();
    assert.equal(api.status().busy, false, '迟到的同修订查询不能回写运行中状态');
  });
}

for (const ending of ['unreadable', 'poisoned']) {
  test(`执行终态 ${ending} 时保持不可运行，刷新确认前拒绝旧快照`, async () => {
    let reads = 0;
    let runs = 0;
    const api = client(async (command) => {
      if (command === 'harness_execute') { runs += 1;return { content: '完成结果' }; }
      if ((reads += 1) === 1) { return status; }
      if (ending === 'unreadable') { throw { code: 'storage_unavailable', message: '状态查询失败' }; }
      return { ...status, ready: false, busy: true, reason: '进程尚未停止' };
    });
    await api.initialize();
    const oldSnapshot = api.snapshot();
    await api.execute(oldSnapshot, 'question_analysis', []);
    assert.equal(api.status().ready, false);
    assert.equal(api.status().busy, true);
    await assert.rejects(api.execute(oldSnapshot, 'question_analysis', []));
    assert.equal(runs, 1);
  });
}

for (const action of ['logout', 'clear']) {
  test(`${action} 开始即停用；失败刷新真实状态且旧授权不得复活，允许重试退出`, async () => {
    const operation = deferred();
    let reads = 0;
    let attempts = 0;
    const elements = { 'ai-harness-logout': {}, 'ai-harness-auth-refresh': {}, 'ai-harness-status': {} };
    const api = client(async (_command, args) => {
      if (args.request.kind === 'status') { reads += 1;return status; }
      if (args.request.kind === 'cancel_all') { return status; }
      if (args.request.kind === action && (attempts += 1) === 1) { return operation.promise; }
      return { ...status, revision: 5, credentialStatus: 'missing', ready: false };
    }, elements);
    await api.initialize();
    api.bind(() => {}, () => false);
    const oldSnapshot = api.snapshot();
    let failed;
    if (action === 'clear') { failed = assert.rejects(api.clear(), /退出失败/); } else { elements['ai-harness-logout'].onclick(); }
    assert.equal(api.status().ready, false, '破坏性操作开始时不再显示可运行');
    await assert.rejects(api.execute(oldSnapshot, 'question_analysis', []));
    operation.reject({ code: 'logout_incomplete', message: '退出失败' });
    if (failed) { await failed; }
    await settleUi();
    assert.ok(reads >= 2, '失败后必须查询原生状态');
    assert.equal(api.status().ready, false, '失败后的旧订阅状态不能重新启用');
    assert.equal(api.status().credentialStatus, 'missing');
    assert.match(api.status().reason, /重试退出/);
    elements['ai-harness-auth-refresh'].onclick();
    await settleUi();
    assert.equal(api.status().ready, false, '手动刷新旧状态也不能绕过未完成退出');
    elements['ai-harness-logout'].onclick();
    await settleUi();
    assert.equal(api.status().revision, 5);
    assert.equal(api.status().credentialStatus, 'missing');
    assert.equal(api.status().ready, false);
  });
}

test('cancel_all 期间查询不得覆盖完成结果，即使查询与完成共用 revision', async () => {
  const stopping = deferred();
  const observed = deferred();
  let reads = 0;
  const elements = { 'ai-harness-auth-refresh': {} };
  const api = client(async (_command, args) => {
    if (args.request.kind === 'cancel_all') { return stopping.promise; }
    return (reads += 1) === 1 ? status : observed.promise;
  }, elements);
  await api.initialize();
  api.bind(() => {}, () => false);
  const cancelled = api.cancelAll();
  elements['ai-harness-auth-refresh'].onclick();
  observed.resolve({ ...status, busy: true, ready: false });
  await settleUi();
  stopping.resolve(status);
  await cancelled;
  assert.equal(api.status().busy, false);
  assert.equal(api.status().ready, true);
});

test('终态查询过程中取消仍等待停止并重新确认状态，不返回已取消的结果', async () => {
  const terminal = deferred();
  const stopping = deferred();
  let reads = 0;
  let phase = 'idle';
  const api = client(async (command, args) => {
    if (command === 'harness_execute') { return { content: '不能采用的结果' }; }
    if (args.request.kind === 'cancel') { return stopping.promise; }
    if ((reads += 1) === 2) { phase = 'refreshing';return terminal.promise; }
    return status;
  });
  await api.initialize();
  const controller = new globalThis.AbortController();
  const pending = api.execute(api.snapshot(), 'question_analysis', [], controller.signal);
  const rejected = assert.rejects(pending, (error) => error.name === 'AbortError');
  await settleUi();
  assert.equal(phase, 'refreshing');
  controller.abort();
  terminal.resolve({ ...status, busy: true });
  await settleUi();
  assert.equal(api.status().busy, true);
  stopping.resolve(status);
  await rejected;
  assert.equal(api.status().busy, false);
  assert.ok(reads >= 3, '取消后的终态必须再确认');
});

test('退出失败且状态读取失败后仍可重试退出，新的登录不绕过未完成清理', async () => {
  let phase = 'initial';
  let logins = 0;
  const elements = { 'ai-harness-logout': {}, 'ai-harness-login': {}, 'ai-harness-status': {} };
  const api = client(async (_command, args) => {
    if (args.request.kind === 'status' && phase === 'failed') { throw { message: '状态读取失败' }; }
    if (args.request.kind === 'logout' && phase === 'initial') { phase = 'failed';throw { message: '退出失败' }; }
    if (args.request.kind === 'login') { logins += 1; }
    return phase === 'retry' ? { ...status, revision: 5, credentialStatus: 'missing', ready: false } : status;
  }, elements);
  await api.initialize();
  api.bind(() => {}, () => false);
  elements['ai-harness-logout'].onclick();
  await settleUi();
  assert.equal(api.status().ready, false);
  assert.equal(api.status().busy, true);
  elements['ai-harness-login'].onclick();
  await settleUi();
  assert.equal(logins, 0);
  phase = 'retry';
  elements['ai-harness-logout'].onclick();
  await settleUi();
  assert.equal(api.status().busy, false);
  assert.equal(api.status().credentialStatus, 'missing');
  assert.equal(api.status().revision, 5);
});

test('初始化与 API 页面不准备组件，选择 Harness 后自动单次准备且展示真实字节', async () => {
  const calls = [];const elements = settingsElements();const clock = pollingClock();
  const preparing = { ...managedStatus, runtimeState: 'preparing', runtimeReceivedBytes: 1024, runtimeTotalBytes: 341270320, busy: true, revision: 5 };
  const api = client(async (_command, { request }) => { calls.push(request.kind);return request.kind === 'prepare_runtime' ? preparing : managedStatus; }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);api.render();await settleUi();
  assert.deepEqual(calls, ['status']);
  elements['ai-execution-harness'].checked = true;elements['ai-execution-harness'].onchange();
  await settleUi();elements['ai-execution-harness'].onchange();await settleUi();
  assert.equal(calls.filter((kind) => kind === 'prepare_runtime').length, 1);
  assert.equal(calls.includes('login'), false);assert.equal(calls.includes('save'), false);
  assert.match(elements['ai-harness-runtime-status'].textContent, /准备中/);
  assert.match(elements['ai-harness-runtime-progress'].textContent, /1,024.*341,270,320.*字节/);
});

test('登录加入准备任务，组件就绪后才自动保存并登录，不自动调用模型', async () => {
  const calls = [];const elements = settingsElements();const clock = pollingClock();let native = { ...managedStatus };
  const api = client(async (command, { request }) => {
    assert.equal(command, 'harness_control', '准备与登录不得执行模型任务');calls.push({ ...request });
    if (request.kind === 'prepare_runtime') { native = { ...native, runtimeState: 'preparing', busy: true, revision: 5 }; }
    if (request.kind === 'save') { assert.equal(native.runtimeState, 'ready');assert.equal(request.revision, native.revision);native = { ...native, mode: request.mode, model: request.model, timeoutSeconds: request.timeoutSeconds, revision: 7 }; }
    if (request.kind === 'login') { native = { ...native, credentialStatus: 'authenticating', revision: 8 }; }
    return { ...native };
  }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);
  elements['ai-execution-harness'].checked = true;elements['ai-execution-harness'].onchange();
  await settleUi();elements['ai-harness-login'].onclick();elements['ai-harness-login'].onclick();await settleUi();
  assert.equal(calls.some((call) => call.kind === 'save' || call.kind === 'login'), false);
  native = { ...native, runtimeState: 'ready', runtimePath: 'managed-fixture.exe', busy: false, revision: 6 };
  await clock.tick();await settleUi();
  assert.deepEqual(calls.filter((call) => call.kind !== 'status').map((call) => call.kind), ['prepare_runtime', 'save', 'login']);
  const saved = calls.find((call) => call.kind === 'save');assert.equal(saved.model, 'gpt-6.1-sol');assert.equal(saved.timeoutSeconds, 120);
  assert.equal('secret' in saved, false);assert.equal('endpoint' in saved, false);
  assert.equal(api.status().credentialStatus, 'authenticating');
});

for (const outcome of ['failed', 'cancelled']) {
  test(`准备 ${outcome} 后不继续登录或自动重试，显式重试才重新准备`, async () => {
    const calls = [];const elements = settingsElements();const clock = pollingClock();let native = { ...managedStatus };
    const api = client(async (_command, { request }) => { calls.push(request.kind);if (request.kind === 'prepare_runtime') { native = { ...native, runtimeState: 'preparing', busy: true, revision: native.revision + 1 }; } return { ...native }; }, elements, clock);
    await api.initialize();api.bind(() => {}, () => false);elements['ai-execution-harness'].checked = true;
    elements['ai-harness-login'].onclick();await settleUi();
    native = { ...native, runtimeState: outcome, busy: false, reason: '组件准备未完成' };
    await clock.tick();await settleUi();elements['ai-execution-harness'].onchange();await settleUi();
    assert.equal(calls.filter((kind) => kind === 'prepare_runtime').length, 1);
    assert.equal(calls.includes('save'), false);assert.equal(calls.includes('login'), false);
    elements['ai-harness-prepare'].onclick();await settleUi();
    assert.equal(calls.filter((kind) => kind === 'prepare_runtime').length, 2);
  });
}

test('切回 API 取消准备和待续登录，迟到的已准备状态不能重新登录', async () => {
  const prepared = deferred();const calls = [];const elements = settingsElements();const clock = pollingClock();let reads = 0;
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'prepare_runtime') { return { ...managedStatus, runtimeState: 'preparing', busy: true, revision: 5 }; }
    if (request.kind === 'cancel_all') { return { ...managedStatus, runtimeState: 'cancelled', revision: 6 }; }
    if ((reads += 1) === 1) { return managedStatus; }
    return prepared.promise;
  }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);elements['ai-execution-harness'].checked = true;
  elements['ai-harness-login'].onclick();await settleUi();
  const poll = clock.tick();await settleUi();
  elements['ai-execution-api'].checked = true;elements['ai-execution-api'].onchange();await settleUi();
  prepared.resolve({ ...managedStatus, runtimeState: 'ready', revision: 5 });await poll;await settleUi();
  assert.equal(calls.includes('cancel_all'), true);assert.equal(calls.includes('save'), false);assert.equal(calls.includes('login'), false);
  assert.equal(api.status().runtimeState, 'cancelled');assert.equal(api.formMode(), 'api');
});

test('自定义组件保留来源，只有高级恢复自动管理操作才请求切换', async () => {
  const elements = settingsElements();const clock = pollingClock();const calls = [];
  let native = { ...status, credentialStatus: 'missing', ready: false };
  const api = client(async (_command, { request }) => { calls.push(request.kind);if (request.kind === 'use_managed_runtime') { native = { ...native, runtimeState: 'preparing', busy: true, revision: 5 }; } return { ...native }; }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);api.render();await settleUi();
  assert.deepEqual(calls, ['status', 'inspect']);assert.equal(api.status().runtimeSource, 'custom');
  elements['ai-harness-use-managed'].onclick();await settleUi();assert.equal(calls.includes('use_managed_runtime'), true);
  native = { ...native, runtimeState: 'failed', busy: false, reason: '隔离下载失败' };await clock.tick();await settleUi();
  assert.equal(api.status().runtimeSource, 'custom');assert.equal(api.status().runtimePath, 'fixture.exe');
});

test('准备就绪进入 Harness 时只显式检查一次，刷新状态可重新核验订阅', async () => {
  const elements = settingsElements();elements['ai-harness-auth-refresh'] = {};const calls = [];
  const api = client(async (_command, { request }) => { calls.push(request.kind);return { ...status, credentialStatus: request.kind === 'inspect' ? 'subscription' : 'missing', ready: request.kind === 'inspect' }; }, elements);
  await api.initialize();assert.deepEqual(calls, ['status']);api.bind(() => {}, () => false);
  api.render();await settleUi();api.render();await settleUi();
  assert.deepEqual(calls, ['status', 'inspect']);
  elements['ai-harness-auth-refresh'].onclick();await settleUi();
  assert.equal(calls.at(-1), 'inspect');assert.equal(api.status().credentialStatus, 'subscription');
});

test('自动保存发现现有订阅时直接就绪，不重复启动登录', async () => {
  const elements = settingsElements();const calls = [];
  const api = client(async (_command, { request }) => { calls.push(request.kind);return { ...status, credentialStatus: request.kind === 'save' ? 'subscription' : 'missing', ready: request.kind === 'save' }; }, elements);
  await api.initialize();api.bind(() => {}, () => false);elements['ai-harness-login'].onclick();await settleUi();
  assert.deepEqual(calls, ['status', 'save']);assert.equal(api.status().credentialStatus, 'subscription');
});

test('自动保存尚未返回时切 API 不能继续登录或把界面切回 Harness', async () => {
  const saving = deferred();const elements = settingsElements();const calls = [];
  const api = client(async (_command, { request }) => {
    calls.push(request.kind);
    if (request.kind === 'save') { return saving.promise; }
    return { ...managedStatus, runtimeState: 'ready', revision: request.kind === 'cancel_all' ? 6 : 4 };
  }, elements);
  await api.initialize();api.bind(() => {}, () => false);elements['ai-execution-harness'].checked = true;
  elements['ai-harness-login'].onclick();await settleUi();assert.equal(calls.includes('save'), true);
  elements['ai-execution-api'].checked = true;elements['ai-execution-api'].onchange();await settleUi();
  saving.resolve({ ...status, revision: 5 });await settleUi();
  assert.equal(calls.includes('login'), false);assert.equal(api.formMode(), 'api');assert.equal(api.status().revision, 6);
});

test('恢复初始化废弃等待准备的登录流程，初始化本身不重启准备', async () => {
  const elements = settingsElements();const clock = pollingClock();const calls = [];let native = { ...managedStatus };
  const api = client(async (_command, { request }) => { calls.push(request.kind);if (request.kind === 'prepare_runtime') { native = { ...native, runtimeState: 'preparing', busy: true, revision: 5 }; } return { ...native }; }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);elements['ai-execution-harness'].checked = true;elements['ai-harness-login'].onclick();await settleUi();
  native = { ...managedStatus, revision: 6 };await api.initialize();await settleUi();
  assert.equal(calls.filter((kind) => kind === 'prepare_runtime').length, 1);assert.equal(calls.includes('save'), false);assert.equal(calls.includes('login'), false);assert.equal(clock.timers.size, 0);
});

test('恢复后仍停留在 Harness 页面时渲染不重新准备，重新选择才激活', async () => {
  const elements = settingsElements();const clock = pollingClock();const calls = [];let native = { ...status };
  const api = client(async (_command, { request }) => { calls.push(request.kind);if (request.kind === 'prepare_runtime') { native = { ...native, runtimeState: 'preparing', busy: true }; } return { ...native }; }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);api.render();await settleUi();
  assert.equal(elements['ai-execution-harness'].checked, true);
  native = { ...native, runtimeState: 'unprepared', ready: false, revision: 5 };
  calls.length = 0;await api.initialize();api.render();await settleUi();
  assert.deepEqual(calls, ['status'], '恢复后的普通渲染不能自动启动准备或检测');
  elements['ai-execution-api'].checked = true;elements['ai-execution-api'].onchange();
  elements['ai-execution-harness'].checked = true;elements['ai-execution-harness'].onchange();await settleUi();
  assert.deepEqual(calls, ['status', 'prepare_runtime'], '用户重新选择 Harness 后仍应自动准备');
});

test('自定义来源恢复自动管理时展示受管下载进度，失败后恢复来源显示', async () => {
  const elements = settingsElements();const clock = pollingClock();let native = { ...status };
  const api = client(async (_command, { request }) => {
    if (request.kind === 'use_managed_runtime') { native = { ...native, runtimeState: 'preparing', runtimeReceivedBytes: 1024, runtimeTotalBytes: 341270320, busy: true, revision: 5 }; }
    return { ...native };
  }, elements, clock);
  await api.initialize();api.bind(() => {}, () => false);elements['ai-harness-use-managed'].onclick();await settleUi();
  assert.equal(api.status().runtimeSource, 'custom', '准备成功前不能改已保存来源');
  assert.equal(api.status().runtimePath, 'fixture.exe');
  assert.match(elements['ai-harness-runtime-status'].textContent, /自动管理.*准备中/);
  assert.equal(elements['ai-harness-runtime-progress'].hidden, false);
  assert.match(elements['ai-harness-runtime-progress'].textContent, /1,024.*341,270,320.*字节/);
  native = { ...native, runtimeState: 'failed', busy: false, reason: '隔离下载失败' };await clock.tick();await settleUi();
  assert.match(elements['ai-harness-runtime-status'].textContent, /自定义程序.*失败/);
  assert.equal(elements['ai-harness-runtime-progress'].hidden, true);
});
