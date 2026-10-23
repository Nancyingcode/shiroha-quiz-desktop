'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function runtime(initial = null) {
  const values = new Map(initial === null ? [] : [['state', initial]]);
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  const context = vm.createContext({ structuredClone, console, setTimeout, clearTimeout });
  for (const name of ['validation', 'browser', 'save-queue']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps/web/platform', name + '.js'), 'utf8'), context);
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
  const written=[];const set=r.storage.setItem;r.storage.setItem=(key,value)=>{written.push(JSON.parse(value));return set(key,value)};
  const queue = r.queue(s); const a = snapshot();
  const first = queue.save(a); a.activeBankId = 'later';
  const second = queue.save(a); await Promise.all([first, second]);
  assert.equal(JSON.parse(r.values.get('state')).activeBankId, 'later');
  assert.equal(queue.status().revision, 2);
  assert.deepEqual(written.map(value=>value.activeBankId),['','later']);
});
test('操作 ID 查询与同载荷重试幂等，拒绝同 ID 不同载荷',async()=>{
  const r=runtime();const s=r.create();await s.initialize();
  await s.write(snapshot(),'operation-1',0);
  assert.equal((await s.getOperation('operation-1')).revision,1);
  await s.write(snapshot(),'operation-1',0);
  assert.equal(s.revision(),1);
  await assert.rejects(s.write({...snapshot(),activeBankId:'changed'},'operation-1',1),/编号/);
});
test('即使外部标签把原值改回，已观察的变更也禁止过期写入',async()=>{
  const r=runtime(JSON.stringify(snapshot()));const s=r.create();await s.initialize();
  s.invalidate();await assert.rejects(r.queue(s).save(snapshot()),/其他页面/);
});
test('首写 quota 失败阻断依赖写入；明确重试后恢复', async () => {
  const r = runtime(); const s = r.create(); await s.initialize();
  const queue = r.queue(s); const original = r.storage.setItem;
  r.storage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  const results = await Promise.allSettled([queue.save(snapshot()), queue.save(snapshot())]);
  assert(results.every(x => x.status === 'rejected'));
  assert.equal(r.values.size, 0);
  r.storage.setItem = original; queue.resume(); await queue.save(snapshot());
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
