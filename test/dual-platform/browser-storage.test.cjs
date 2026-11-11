'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function runtime(initial = null) {
  const values = new Map(initial === null ? [] : [['state', initial]]);
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  const context = vm.createContext({ structuredClone, console, setTimeout, clearTimeout, Error });
  for (const name of ['validation', 'browser', 'save-queue']) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps/web/platform', `${name}.js`), 'utf8'), context); }
  return { values, storage, create: () => context.ShirohaBrowser.createStorage(storage, 'state'), queue: context.ShirohaSaveQueue.create };
}
const snapshot = () => ({ schemaVersion: 1, banks: [], activeBankId: '', records: [], settings: { suppressDefaultBank: true }, wrongBook: {}, favorites: {}, crossPlatformMeta: {} });
test('缺省、明确空库与损坏/未来数据不同；失败原值不变', async () => {
  for (const raw of ['{broken', 'null', '{"schemaVersion":999,"banks":[]}']) {
    const r = runtime(raw); const s = r.create();
    assert.equal((await s.initialize()).state, 'recovery_required');
    assert.equal(r.values.get('state'), raw);
  }
  const r = runtime(JSON.stringify(snapshot())); const s = r.create();
  assert.equal((await s.initialize()).hasData, true);
  assert.equal((await s.read()).settings.suppressDefaultBank, true);
});
test('队列冻结连续编辑，严格按序写入且推进修订', async () => {
  const r = runtime(); const s = r.create(); await s.initialize();
  const written = [];const set = r.storage.setItem;r.storage.setItem = (key, value) => { written.push(JSON.parse(value));return set(key, value); };
  const queue = r.queue(s); const a = snapshot();
  const first = queue.save(a); a.activeBankId = 'later';
  const second = queue.save(a); await Promise.all([first, second]);
  assert.equal(JSON.parse(r.values.get('state')).activeBankId, 'later');
  assert.equal(queue.status().revision, 2);
  assert.deepEqual(written.map((value) => value.activeBankId), ['', 'later']);
});
test('操作 ID 查询与同载荷重试幂等，拒绝同 ID 不同载荷', async () => {
  const r = runtime();const s = r.create();await s.initialize();
  await s.write(snapshot(), 'operation-1', 0);
  assert.equal((await s.getOperation('operation-1')).revision, 1);
  await s.write(snapshot(), 'operation-1', 0);
  assert.equal(s.revision(), 1);
  await assert.rejects(s.write({ ...snapshot(), activeBankId: 'changed' }, 'operation-1', 1), /编号/);
});
test('即使外部标签把原值改回，已观察的变更也禁止过期写入', async () => {
  const r = runtime(JSON.stringify(snapshot()));const s = r.create();await s.initialize();
  s.invalidate();await assert.rejects(r.queue(s).save(snapshot()), /其他页面/);
});
test('首写 quota 失败阻断依赖写入；明确重试后恢复', async () => {
  const r = runtime(); const s = r.create(); await s.initialize();
  const queue = r.queue(s); const original = r.storage.setItem;
  r.storage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  const results = await Promise.allSettled([queue.save(snapshot()), queue.save(snapshot())]);
  assert(results.every((x) => x.status === 'rejected'));
  assert.equal(r.values.size, 0);
  r.storage.setItem = original; queue.resume(); await queue.save(snapshot());
  assert.equal(queue.status().state, 'saved');
});
test('保存队列状态优先显示进行中，再显示失败，明确恢复后显示已保存', async () => {
  const r = runtime(); const s = r.create(); await s.initialize();
  const queue = r.queue(s); const original = r.storage.setItem;
  r.storage.setItem = () => { throw new Error('write failed'); };
  const first = queue.save(snapshot());
  assert.equal(queue.status().state, 'pending');
  await assert.rejects(first);
  assert.equal(queue.status().state, 'failed');
  const blocked = queue.save(snapshot());
  assert.equal(queue.status().state, 'pending');
  await assert.rejects(blocked);
  assert.equal(queue.status().state, 'failed');
  r.storage.setItem = original; queue.resume();
  assert.equal(queue.status().state, 'saved');
});
test('外部标签更改与拒绝访问不得覆盖数据', async () => {
  const r = runtime(); const s = r.create(); await s.initialize();
  r.values.set('state', 'external');
  await assert.rejects(r.queue(s).save(snapshot()), /其他页面/);
  assert.equal(r.values.get('state'), 'external');
  const denied = r.create(); r.storage.getItem = () => { throw new Error('denied'); };
  assert.equal((await denied.initialize()).state, 'recovery_required');
});
test('损坏 JSON、结构和未来版本进入各自恢复状态，并禁止覆盖且可导出原文', async () => {
  for (const [raw, code] of [
    ['{broken', 'corrupt_data'],
    ['null', 'corrupt_data'],
    ['{"banks":{}}', 'corrupt_data'],
    ['{"schemaVersion":999,"banks":[]}', 'unsupported_version'],
  ]) {
    const r = runtime(raw); const s = r.create();
    const result = await s.initialize();
    assert.equal(result.error.code, code);
    assert.equal(s.recoveryText(), raw);
    await assert.rejects(s.write(snapshot(), 'blocked', 0), (error) => error.code === 'not_ready');
    assert.equal(r.values.get('state'), raw);
  }
});

for (const [name, code] of [['SecurityError', 'storage_unavailable'], ['QuotaExceededError', 'quota_exceeded']]) {
  test(`真实 ${name} 的读取和写入失败保留原文及状态`, async () => {
    const raw = JSON.stringify(snapshot());
    const read = runtime(raw); const blocked = read.create();
    const originalGet = read.storage.getItem;
    read.storage.getItem = () => { throw new globalThis.DOMException('failure', name); };
    assert.equal((await blocked.initialize()).error.code, code);
    read.storage.getItem = originalGet;
    assert.equal(blocked.recoveryText(), raw);
    await assert.rejects(blocked.write(snapshot(), 'blocked', 0), (error) => error.code === 'not_ready');
    assert.equal(read.values.get('state'), raw);

    const write = runtime(raw); const s = write.create();
    await s.initialize();
    write.storage.setItem = () => { throw new globalThis.DOMException('failure', name); };
    await assert.rejects(s.write(snapshot(), 'failure', 0), (error) => error.code === code);
    assert.equal(write.values.get('state'), raw);
    assert.equal(s.revision(), 0);
    assert.equal((await s.read()).schemaVersion, 1);
  });
}

test('观察到外部变更后优先报告冲突，不再访问存储', async () => {
  const r = runtime(JSON.stringify(snapshot())); const s = r.create();
  await s.initialize();
  s.invalidate();
  r.storage.getItem = () => { throw new globalThis.DOMException('denied', 'SecurityError'); };
  await assert.rejects(s.write(snapshot(), 'conflict', 0), (error) => error.code === 'revision_conflict');
});
