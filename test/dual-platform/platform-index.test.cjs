'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../apps/web/platform/index.js'), 'utf8');
const storageKey = 'shiroha_quiz_state_v28_4_c1';

function fixture(existingPlatform) {
  const values = new Map();
  const listeners = new Map();
  const calls = [];
  const storage = { invalidate: () => calls.push('invalidate') };
  const saves = {};
  const browser = {
    resourceJson: {}, media: {}, files: {}, preferences: {}, download: () => {},
    createStorage(adapter, key) {
      calls.push({ adapter, key });
      return storage;
    },
  };
  const credentials = {};
  const context = vm.createContext({
    ShirohaPlatform: existingPlatform,
    ShirohaBrowser: browser,
    ShirohaBrowserCredentials: credentials,
    ShirohaSaveQueue: { create: (received) => { calls.push(received); return saves; } },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
  });
  vm.runInContext(source, context);
  return { context, browser, credentials, storage, saves, calls, listeners, values };
}

test('已注入的桌面平台保留所有权，不创建浏览器存储或注册事件', () => {
  const nativePlatform = { native: true };
  const result = fixture(nativePlatform);
  assert.strictEqual(result.context.ShirohaPlatform, nativePlatform);
  assert.equal(result.calls.length, 0);
  assert.equal(result.listeners.size, 0);
});

test('浏览器平台复用存储适配器，只对本应用键或清空事件失效', () => {
  const result = fixture();
  const platform = result.context.ShirohaPlatform;
  assert.strictEqual(platform.storage, result.storage);
  assert.strictEqual(platform.saves, result.saves);
  assert.strictEqual(platform.network, result.credentials);
  assert.strictEqual(platform.credentials, result.credentials);
  assert.strictEqual(platform.files, result.browser.files);
  assert.equal(result.calls[0].key, storageKey);
  assert.strictEqual(result.calls[1], result.storage);
  const adapter = result.calls[0].adapter;
  adapter.setItem(storageKey, 'fixture');
  assert.equal(adapter.getItem(storageKey), 'fixture');
  adapter.removeItem(storageKey);
  assert.equal(adapter.getItem(storageKey), null);
  const onStorage = result.listeners.get('storage');
  assert.equal(typeof onStorage, 'function');
  onStorage({ key: 'unrelated' });
  assert.equal(result.calls.filter((call) => call === 'invalidate').length, 0);
  onStorage({ key: storageKey });
  onStorage({ key: null });
  assert.equal(result.calls.filter((call) => call === 'invalidate').length, 2);
});
