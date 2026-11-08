'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
function harness() {
  const storage = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }; };
  const local = storage(); const session = storage(); const calls = [];
  const context = vm.createContext({ localStorage: local, sessionStorage: session, ShirohaBrowserNetwork: { ai: (config) => { calls.push(config);return Promise.resolve({}); }, webdav: () => Promise.resolve({}) } });
  vm.runInContext(readFileSync(path.join(__dirname, '../../apps/web/platform/browser-credentials.js'), 'utf8'), context);
  return { api: context.ShirohaBrowserCredentials, local, session, calls };
}
const config = { endpoint: 'https://mock.invalid/ai', rememberKey: false };
test('旧凭据只绑定初始化端点，UI 只得到状态；端点改变不泄露', async () => {
  const h = harness();h.session.setItem('shiroha_ai_key_session_v99', 'fake-key');h.api.initialize(config);
  const marker = h.api.status('ai', config);assert(marker && !marker.includes('fake-key'));
  await h.api.ai({ ...config, apiKey: marker }, {}, undefined);assert.equal(h.calls[0].apiKey, 'fake-key');
  await h.api.ai({ ...config, endpoint: 'https://other.invalid', apiKey: marker }, {}, undefined);assert.equal(h.calls[1].apiKey, '');
});
test('切换记住选项迁移已有秘密并删除旧副本，补偿闭包不暴露值', () => {
  const h = harness();h.api.initialize(config);h.api.set('ai', config, 'fake-key', false);
  const marker = h.api.status('ai', config);const undo = h.api.set('ai', { ...config, rememberKey: true }, marker, true);
  assert.equal(h.local.getItem('shiroha_ai_key_local_v99'), 'fake-key');assert.equal(h.session.getItem('shiroha_ai_key_session_v99'), null);
  undo();assert.equal(h.local.getItem('shiroha_ai_key_local_v99'), null);assert.equal(h.session.getItem('shiroha_ai_key_session_v99'), 'fake-key');
});
test('删除旧凭据副本失败会抛错并保留原值，不能假报成功', () => {
  const h = harness();h.api.initialize(config);h.api.set('ai', config, 'fake-key', false);
  const remove = h.session.removeItem;let failed = false;h.session.removeItem = (k) => { if (!failed) { failed = true;throw new Error('denied'); } return remove(k); };
  assert.throws(() => h.api.set('ai', { ...config, rememberKey: true }, h.api.status('ai', config), true), /denied/);
  assert.equal(h.local.getItem('shiroha_ai_key_local_v99'), null);assert.equal(h.session.getItem('shiroha_ai_key_session_v99'), 'fake-key');
});
test('重置删除失败补偿主数据和凭据', () => {
  const h = harness();h.local.setItem('shiroha_quiz_state_v28_4_c1', 'original-data');h.api.initialize(config);h.api.set('ai', config, 'fake-key', false);
  const remove = h.local.removeItem;h.local.removeItem = (k) => { if (k === 'shiroha_quiz_state_v28_4_c1') { throw new Error('denied'); } return remove(k); };
  assert.throws(() => h.api.reset(), /denied/);assert.equal(h.local.getItem('shiroha_quiz_state_v28_4_c1'), 'original-data');assert.equal(h.session.getItem('shiroha_ai_key_session_v99'), 'fake-key');
});

test('AI 和 WebDAV 占位符只保留同一绑定的凭据，按记住设置切换存储或清除', () => {
  for (const service of ['ai', 'webdav']) {
    const h = harness();
    const localKey = service === 'ai' ? 'shiroha_ai_key_local_v99' : 'shiroha_webdav_password_local_v378';
    const sessionKey = service === 'ai' ? 'shiroha_ai_key_session_v99' : 'shiroha_webdav_password_session_v378';
    const original = { endpoint: 'https://mock.invalid/service', username: 'user', rememberKey: false, rememberPassword: false };
    const remembered = { ...original, rememberKey: true, rememberPassword: true };
    h.api.initialize(config);
    h.api.set(service, original, 'synthetic-secret', false);
    const marker = h.api.status(service, original);
    assert(marker, service);
    assert.throws(() => h.api.set(service, { ...remembered, endpoint: 'https://other.invalid' }, marker, true), /重新输入凭据/);
    assert.throws(() => h.api.set(service, { ...remembered, username: 'other' }, marker, true), /重新输入凭据/);
    assert.equal(h.session.getItem(sessionKey), 'synthetic-secret');
    assert.equal(h.local.getItem(localKey), null);
    h.api.set(service, remembered, marker, true);
    assert.equal(h.local.getItem(localKey), 'synthetic-secret');
    assert.equal(h.session.getItem(sessionKey), null);
    h.api.set(service, original, h.api.status(service, remembered), false);
    assert.equal(h.local.getItem(localKey), null);
    assert.equal(h.session.getItem(sessionKey), 'synthetic-secret');
    h.api.set(service, original, '', false);
    assert.equal(h.api.status(service, original), '');
    assert.equal(h.local.getItem(localKey), null);
    assert.equal(h.session.getItem(sessionKey), null);
    assert.throws(() => h.api.set(service, original, marker, false), /重新输入凭据/);
  }
});
