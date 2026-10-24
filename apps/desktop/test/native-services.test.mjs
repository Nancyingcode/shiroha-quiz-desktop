import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('desktop AI cancellation keeps AbortError semantics when native IPC rejects', async () => {
  const scope = {
    Response: globalThis.Response, crypto: globalThis.crypto,
    ShirohaBrowser: {}, ShirohaBrowserCredentials: {}, ShirohaSaveQueue: { create: () => ({}) },
    ShirohaDesktopHost: { invoke: async () => { throw { code: 'cancelled' }; } },
  };
  vm.runInNewContext(await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8'), scope);
  const network = vm.runInNewContext('ShirohaPlatform.network', scope);
  await assert.rejects(network.ai({ endpoint: 'https://mock.invalid/chat' }, { messages: [] }), {
    name: 'AbortError', code: 'cancelled',
  });
});

test('desktop AI configuration and redirect failures have actionable messages', async () => {
  for (const [code, expected] of [
    ['invalid_service_config', /接口地址/], ['redirect_denied', /重定向/],
    ['network_scope_denied', /范围/], ['network_denied', /网络/],
    ['invalid_response', /响应/], ['response_too_large', /响应/],
    ['payload_too_large', /内容/], ['invalid_input', /参数/],
  ]) {
    const scope = {
      Response: globalThis.Response, crypto: globalThis.crypto,
      ShirohaBrowser: {}, ShirohaBrowserCredentials: {}, ShirohaSaveQueue: { create: () => ({}) },
      ShirohaDesktopHost: { invoke: async () => { throw { code }; } },
    };
    vm.runInNewContext(await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8'), scope);
    const network = vm.runInNewContext('ShirohaPlatform.network', scope);
    await assert.rejects(network.ai({ endpoint: 'https://mock.invalid/chat' }, { messages: [] }), error => {
      assert(error && typeof error === 'object');
      assert.equal(Reflect.get(error, 'code'), code);
      assert.match(Reflect.get(error, 'message'), /** @type {RegExp} */ (expected));
      return true;
    });
  }
});

test('desktop credentials expose status only and commit staged secrets explicitly', async () => {
  /** @type {{command:string,args:{request:{kind:string,operation?:{kind:string}},secret?:string|null}}[]} */ const calls = [];
  const scope = { Response: globalThis.Response, crypto: globalThis.crypto, TextDecoder, TextEncoder: globalThis.TextEncoder, structuredClone: globalThis.structuredClone,
    ShirohaBrowser: {}, ShirohaBrowserCredentials: {}, ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    ShirohaDesktopHost: { invoke: async (/** @type {string} */ command, /** @type {{request:{kind:string,operation?:{kind:string}},secret?:string|null}} */ args) => {
      calls.push({ command, args });
      if (args.request.kind === 'stage') return { id: 'staged' };
      if (args.request.kind === 'status') return { state: 'remembered' };
      return {};
    } },
  };
  vm.runInNewContext(await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8'), scope);
  const credentials = vm.runInNewContext('ShirohaPlatform.credentials', scope);
  const config = { endpoint: 'https://example.com/chat', rememberKey: true };
  await credentials.initialize(config);
  assert.equal(credentials.status('ai', config), '[已保存的凭据]');
  const undo = await credentials.set('ai', config, 'fake-key', true);
  assert.equal(calls.at(-1)?.args.request.kind, 'stage');
  await credentials.finalize(undo);
  assert(calls.some(call => call.args.request.kind === 'commit'));
  assert(!JSON.stringify(credentials).includes('fake-key'));
});

test('desktop network maps DAV methods to limited operations and rejects arbitrary methods', async () => {
  /** @type {{command:string,args:{request:{kind:string,operation?:{kind:string}},secret?:string|null}}[]} */ const calls = [];
  const scope = { Response: globalThis.Response, crypto: globalThis.crypto, TextDecoder, TextEncoder: globalThis.TextEncoder, structuredClone: globalThis.structuredClone,
    ShirohaBrowser: {}, ShirohaBrowserCredentials: {}, ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    ShirohaDesktopHost: { invoke: async (/** @type {string} */ command, /** @type {{request:{kind:string,operation?:{kind:string}},secret?:string|null}} */ args) => { calls.push({ command, args }); return { status: 200, body: '{}' }; } },
  };
  vm.runInNewContext(await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8'), scope);
  const network = vm.runInNewContext('ShirohaPlatform.network', scope);
  const config = { endpoint: 'https://example.com/dav', remoteDir: 'ShirohaQuiz/Web' };
  await network.webdav(config, '[已保存的凭据]', 'ShirohaQuiz/Web/latest.json', { method: 'GET' });
  assert.equal(calls[0].args.request.operation?.kind, 'download');
  assert.equal(calls[0].args.secret, null);
  await assert.rejects(network.webdav(config, '', 'outside/file.json', { method: 'GET' }));
  await assert.rejects(network.webdav(config, '', '', { method: 'DELETE' }));
  assert.equal(calls.length, 1);
});
