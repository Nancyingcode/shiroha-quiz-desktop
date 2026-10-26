import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../frontend/codebuddy-login.js', import.meta.url), 'utf8');

class Element {
  hidden = true;
  disabled = false;
  textContent = '';
  value = '';
  /** @type {Record<string,string>} */ dataset = {};
  /** @type {Map<string,string>} */ attributes = new Map();
  /** @type {Map<string,()=>void>} */ listeners = new Map();
  /** @param {string} name @param {()=>void} callback */
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  /** @param {string} name @param {string} value */
  setAttribute(name, value) { this.attributes.set(name, value); }
  click() { this.listeners.get('click')?.(); }
}

/** @param {string} [phase] @param {number} [revision] */
function status(phase = 'signed_out', revision = 0) {
  return { phase, revision, loginUrl: phase === 'authenticating' ? 'https://copilot.tencent.com/login?platform=CLI&state=synthetic' : '', message: `合成状态：${phase}`, browserOpened: phase === 'authenticating', busy: phase === 'authenticating' };
}

/** @param {{desktop?:boolean,loading?:boolean}} [options] */
function fixture(options = {}) {
  const names = ['settings', 'phase', 'status', 'login', 'details', 'login-url', 'browser-status', 'open-login', 'copy-link', 'refresh', 'cancel', 'logout'];
  const elements = new Map(names.map(name => [`ai-codebuddy-${name}`, new Element()]));
  /** @param {string} name */
  const get = name => { const element = elements.get(`ai-codebuddy-${name}`); assert(element); return element; };
  /** @type {Array<{command:string,request:Record<string,unknown>}>} */ const calls = [];
  /** @type {string[]} */ const copied = [];
  /** @type {Array<{revision:number,phase:string,blocked:boolean}>} */ const accounts = [];
  /** @type {Map<number,()=>void|Promise<void>>} */ const timers = new Map();
  /** @type {Map<string,()=>void>} */ const events = new Map();
  let timerId = 0;
  /** @type {(kind:string)=>Promise<unknown>} */ let respond = async () => status();
  const host = {
    /** @param {string} command @param {{request:Record<string,unknown>}} args */
    async invoke(command, args) { calls.push({ command, request: args.request }); return respond(String(args.request.kind)); },
  };
  const context = {
    ShirohaDesktopHost: options.desktop === false ? undefined : host,
    ShirohaPlatform: {harness:{codebuddyAccountChanged(/** @type {{revision:number,phase:string,blocked:boolean}} */ account) {accounts.push(account);}}},
    document: {
      readyState: options.loading ? 'loading' : 'complete',
      getElementById: (/** @type {string} */ id) => elements.get(id),
      addEventListener: (/** @type {string} */ name, /** @type {()=>void} */ callback) => events.set(name, callback),
    },
    navigator: { clipboard: { async writeText(/** @type {string} */ text) { copied.push(text); } } },
    setTimeout: (/** @type {()=>void|Promise<void>} */ callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (/** @type {number} */ id) => timers.delete(id),
    addEventListener: (/** @type {string} */ name, /** @type {()=>void} */ callback) => events.set(name, callback),
  };
  return {
    get, calls, copied, accounts, timers, events,
    start: () => vm.runInNewContext(source, context),
    /** @param {(kind:string)=>Promise<unknown>} response */
    respond(response) { respond = response; },
    async tick() { const next = timers.entries().next().value; assert(next, '等待授权时应安排状态轮询'); timers.delete(next[0]); await next[1](); await setImmediate(); },
  };
}

test('desktop initializes after DOM ready with only a status query; Web stays hidden', async () => {
  const web = fixture({ desktop: false }); web.start(); await setImmediate();
  assert.equal(web.get('settings').hidden, true);
  assert.equal(web.calls.length, 0);
  const desktop = fixture({ loading: true }); desktop.start();
  assert.equal(desktop.calls.length, 0);
  desktop.events.get('DOMContentLoaded')?.(); await setImmediate();
  assert.equal(desktop.get('settings').hidden, true, '账户控制器不得抢占 Harness 的面板显隐');
  assert.deepEqual(desktop.calls.map(call => call.request.kind), ['status']);
  assert.equal(desktop.timers.size, 0);
});

test('provider switches hide the panel without clearing its pending or completed account', async () => {
  const f = fixture(); f.start(); await setImmediate();
  f.get('settings').hidden = false;
  f.respond(async kind => status(kind === 'login' ? 'authenticating' : 'signed_in', 1));
  f.get('login').click(); await setImmediate();
  f.get('settings').hidden = true;
  await f.tick();
  assert.equal(f.get('settings').hidden, true, '后台登录完成不能重新展示非当前面板');
  assert.equal(f.get('settings').dataset.phase, 'signed_in');
  assert.equal(f.calls.some(call => ['cancel','logout'].includes(String(call.request.kind))), false);
  f.get('settings').hidden = false;
  assert.equal(f.get('logout').hidden, false, '切回后继续显示已有登录状态');
});

test('login uses only fixed account actions, prevents double submit and stops polling at success', async () => {
  const f = fixture(); f.start(); await setImmediate();
  f.respond(async kind => status(kind === 'login' ? 'authenticating' : 'signed_in', 1));
  f.get('login').click(); f.get('login').click(); await setImmediate();
  assert.equal(f.calls.filter(call => call.request.kind === 'login').length, 1);
  assert.equal(f.get('cancel').hidden, false);
  assert.equal(f.get('details').hidden, false);
  assert.match(f.get('login-url').value, /^https:\/\/copilot\.tencent\.com\/login\?/);
  assert.equal(f.timers.size, 1);
  await f.tick();
  assert.equal(f.get('settings').dataset.phase, 'signed_in');
  assert.equal(f.get('logout').hidden, false);
  assert.equal(f.get('details').hidden, true);
  assert.equal(f.get('login-url').value, '');
  assert.equal(f.timers.size, 0);
  for (const call of f.calls) {
    assert.equal(call.command, 'codebuddy_control');
    assert.deepEqual(Object.keys(call.request), call.request.kind === 'login' ? ['kind', 'revision'] : ['kind']);
  }
});

test('login freezes the observed revision and a new login after cancellation uses the new revision', async () => {
  const f = fixture(); f.respond(async () => status('signed_out', 7)); f.start(); await setImmediate();
  /** @type {(value:unknown)=>void} */ let resolveOld = () => {};
  f.respond(kind => kind === 'login' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(status('cancelled', 8)));
  f.get('login').click();
  assert.equal(f.calls.at(-1)?.request.revision, 7);
  f.get('cancel').click(); await setImmediate();
  assert.deepEqual(Object.keys(f.calls.at(-1)?.request ?? {}), ['kind']);
  resolveOld(status('signed_in', 7)); await setImmediate();
  assert.equal(f.get('settings').dataset.phase, 'cancelled');
  f.respond(async () => status('authenticating', 9));
  f.get('login').click(); await setImmediate();
  assert.equal(f.calls.at(-1)?.request.kind, 'login');
  assert.equal(f.calls.at(-1)?.request.revision, 8);
});

test('cancel invalidates an unresolved login and late success cannot revive the account', async () => {
  const f = fixture(); f.start(); await setImmediate();
  /** @type {(value:unknown)=>void} */ let resolveLogin = () => {};
  f.respond(kind => kind === 'login' ? new Promise(resolve => { resolveLogin = resolve; }) : Promise.resolve(status('cancelled', 2)));
  f.get('login').click();
  assert.equal(f.get('cancel').disabled, false);
  f.get('cancel').click(); await setImmediate();
  resolveLogin(status('signed_in', 1)); await setImmediate();
  assert.equal(f.get('settings').dataset.phase, 'cancelled');
  assert.equal(f.get('logout').hidden, true);
  assert.equal(f.timers.size, 0);
});

test('logout discards an older status result, including a reply with a newer revision', async () => {
  const f = fixture(); f.respond(async () => status('signed_in', 1)); f.start(); await setImmediate();
  /** @type {(value:unknown)=>void} */ let resolveStatus = () => {};
  f.respond(kind => kind === 'status' ? new Promise(resolve => { resolveStatus = resolve; }) : Promise.resolve(status('signed_out', 2)));
  f.get('refresh').click(); f.get('logout').click(); await setImmediate();
  resolveStatus(status('signed_in', 99)); await setImmediate();
  assert.equal(f.get('settings').dataset.phase, 'signed_out');
  assert.equal(f.get('login').disabled, false);
  assert.equal(f.timers.size, 0);
});

test('failed logout keeps authorization blocked until cleanup succeeds and never displays raw errors', async () => {
  const f = fixture(); f.respond(async () => status('signed_in', 1)); f.start(); await setImmediate();
  f.respond(async kind => { if (kind === 'logout') throw new Error('secret-token-from-native'); return status('signed_in', 1); });
  f.get('logout').click(); await setImmediate();
  assert.equal(f.get('login').disabled, true);
  assert.equal(f.get('logout').hidden, false);
  assert.doesNotMatch(f.get('status').textContent, /secret-token/);
  f.get('refresh').click(); await setImmediate();
  assert.notEqual(f.get('settings').dataset.phase, 'signed_in');
  f.respond(async () => status('signed_out', 2));
  f.get('logout').click(); await setImmediate();
  assert.equal(f.get('settings').dataset.phase, 'signed_out');
  assert.equal(f.get('login').disabled, false);
});

test('open and copy use only the current native login link, then terminal state clears it', async () => {
  const f = fixture(); f.respond(async () => status('authenticating', 4)); f.start(); await setImmediate();
  f.get('copy-link').click(); await setImmediate();
  assert.deepEqual(f.copied, [status('authenticating').loginUrl]);
  f.get('open-login').click(); await setImmediate();
  assert.deepEqual(Object.keys(f.calls.at(-1)?.request ?? {}), ['kind']);
  assert.equal(f.calls.at(-1)?.request.kind, 'open_login');
  f.respond(async () => status('expired', 5)); await f.tick();
  assert.equal(f.get('login-url').value, '');
  const count = f.calls.length;
  f.get('open-login').click(); f.get('copy-link').click(); await setImmediate();
  assert.equal(f.calls.length, count);
  assert.equal(f.copied.length, 1);
});

test('invalid and stale status cannot enable authorization; page exit cancels polling', async () => {
  const f = fixture(); f.respond(async () => status('signed_out', 5)); f.start(); await setImmediate();
  f.respond(async () => status('signed_in', 4)); f.get('refresh').click(); await setImmediate();
  assert.equal(f.get('settings').dataset.phase, 'signed_out');
  f.respond(async () => ({ ...status('signed_in', 6), revision: '6' })); f.get('refresh').click(); await setImmediate();
  assert.equal(f.get('settings').dataset.phase, 'signed_out');
  assert.match(f.get('status').textContent, /无法|失败|重试/);
  f.respond(async () => status('authenticating', 6)); f.get('refresh').click(); await setImmediate();
  assert.equal(f.timers.size, 1);
  f.events.get('pagehide')?.();
  assert.equal(f.timers.size, 0);
});

test('account mutations invalidate execution before IPC, including failed logout and same revision login completion', async () => {
  const f=fixture();f.start();await setImmediate();
  assert.equal(f.accounts.at(-1)?.phase,'signed_out');
  f.respond(async kind=>status(kind==='login'?'authenticating':'signed_in',1));
  f.get('login').click();
  assert.equal(f.accounts.at(-1)?.blocked,true);
  await setImmediate();await f.tick();
  assert.deepEqual(f.accounts.slice(-2).map(value=>[value.revision,value.phase,value.blocked]),[[1,'authenticating',false],[1,'signed_in',false]]);
  f.respond(async()=>{throw new Error('secret');});f.get('logout').click();await setImmediate();
  assert.equal(f.accounts.at(-1)?.blocked,true);
  f.respond(async()=>status('signed_out',2));f.get('logout').click();await setImmediate();
  assert.deepEqual(JSON.parse(JSON.stringify(f.accounts.at(-1))),{revision:2,phase:'signed_out',blocked:false});
});

test('model account invalidation requests a readonly card refresh without restarting login', async () => {
  const f=fixture();f.respond(async()=>status('signed_in',1));f.start();await setImmediate();
  f.respond(async()=>status('expired',2));f.events.get('shiroha-codebuddy-account-refresh')?.();await setImmediate();
  assert.equal(f.get('settings').dataset.phase,'expired');
  assert.deepEqual(f.calls.map(call=>call.request.kind),['status','status']);
  f.events.get('pagehide')?.();f.events.get('shiroha-codebuddy-account-refresh')?.();await setImmediate();
  assert.equal(f.calls.length,2);
});

test('shared HTML keeps the account card hidden and clearly limits this entry to memory login', async () => {
  const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="ai-codebuddy-settings"[^>]*hidden/);
  assert.match(html, /id="ai-codebuddy-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /CodeBuddy 当前支持连接测试、单题解析和追问/);
  for (const name of ['prepare','prepare-cancel','runtime-status','runtime-progress','stop','execution-status']) assert.match(html, new RegExp(`id="ai-codebuddy-${name}"`));
  const modelOptions = html.match(/<select id="ai-codebuddy-model"[^>]*>(.*?)<\/select>/s)?.[1];
  assert(modelOptions, 'CodeBuddy 模型需要独立的下拉框');
  assert.deepEqual([...modelOptions.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), ['deepseek-v4.1-flash','hy4-preview','hy3','default']);
  assert.match(html, /<label for="ai-codebuddy-model">/);
  assert.match(html, /id="ai-codebuddy-model-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="ai-codebuddy-model-retry"[^>]*hidden/);
  assert.match(html, /关闭应用后需要重新登录/);
  assert.doesNotMatch(html, /<script[^>]*codebuddy-login\.js/);
  for (const provider of ['codex','codebuddy','deepseek']) assert.match(html, new RegExp(`<option value="${provider}">`, 'i'));
  assert.match(html, /id="ai-codex-settings"/);
  assert.match(html, /id="ai-deepseek-settings"[^>]*hidden/);
  assert(html.indexOf('id="ai-codebuddy-settings"') < html.indexOf('id="ai-api-settings-fields"'), '账户面板应在 Harness 容器内');
});
