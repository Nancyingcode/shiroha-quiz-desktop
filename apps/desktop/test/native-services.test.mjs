import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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
