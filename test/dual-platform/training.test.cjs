'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadWeb } = require('./web-source.cjs');
const { webState } = require('./fixtures/dataset.cjs');

function training() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../apps/web/training.js'), 'utf8'), context);
  return context.ShirohaTraining;
}
const plain = value => JSON.parse(JSON.stringify(value));
const question = (id, text) => ({ id, type: 'single', question: text, options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: ['A'] });

test('有效计时按运行段累计，重复暂停、继续及停止后重试不增加用时', () => {
  const api = training();
  let clock = api.createClock(100);
  clock = api.transitionClock(clock, 'paused', 1600);
  assert.equal(api.elapsedClock(clock, 9000), 1500);
  clock = api.transitionClock(clock, 'paused', 10000);
  clock = api.transitionClock(clock, 'running', 11000);
  clock = api.transitionClock(clock, 'running', 12000);
  assert.equal(api.elapsedClock(clock, 12500), 3000);
  clock = api.transitionClock(clock, 'stopped', 12500);
  clock = api.transitionClock(clock, 'running', 20000);
  assert.equal(api.elapsedClock(clock, 30000), 3000);
  assert.equal(api.formatDuration(4121), '1:08:41');
  assert.equal(api.formatDuration(5), '00:05');
});

test('复盘按本轮顺序关联跨库同 ID 与跳序提交，保留未提交快照且不复制已答正文', () => {
  const api = training();
  const items = [{ bankId: 'a', question: question('same', '第一题'), bankQuestionNumber: 41 }, { bankId: 'b', question: question('same', '第二题'), bankQuestionNumber: 9 }, { bankId: 'a', question: question('last', '未答题'), chosen: ['B'], revealed: true }];
  const details = [{ sourceBankId: 'b', questionId: 'same', chosen: ['B'], correct: false, nativeQuestion: items[1].question }, { sourceBankId: 'a', questionId: 'same', chosen: ['A'], correct: true, nativeQuestion: items[0].question }];
  const review = api.buildReview(items, details, { completion: 'ended_early', submitMode: 'single', timing: 'active' });
  assert.equal(review.items[0].detailIndex, 1);
  assert.equal(review.items[1].detailIndex, 0);
  assert.equal(review.items[0].question, undefined);
  items[2].question.question = '后来改题';
  const record = plain({ total: 3, review, details });
  const rows = api.reviewRows(record);
  assert.deepEqual(plain(rows.map(row => row.status)), ['correct', 'wrong', 'unanswered']);
  assert.equal(rows[0].bankQuestionNumber, 41);
  assert.equal(rows[2].question.question, '未答题');
  assert.deepEqual(plain(rows[2].draft), ['B']);
  assert.equal(rows[2].revealed, true);
  assert.equal(api.reviewSummary(review, details).unanswered, 1);
  assert.equal(api.reviewSummary(review, details).items, undefined);
});

test('总提交的空答案计错与复盘未作答分开，简答自评保留原判定', () => {
  const api = training();
  const items = [{ bankId: 'a', question: question('empty', '空答案') }, { bankId: 'a', question: { ...question('short', '简答'), type: 'short' } }];
  const details = [{ sourceBankId: 'a', questionId: 'empty', chosen: [], correct: false, nativeQuestion: items[0].question }, { sourceBankId: 'a', questionId: 'short', chosen: ['人工作答'], correct: true, nativeQuestion: items[1].question }];
  const review = api.buildReview(items, details, { completion: 'completed', submitMode: 'total', timing: 'active' });
  assert.deepEqual(plain(api.reviewRows({ review, details }).map(row => row.status)), ['unanswered', 'correct']);
  assert.equal(details[0].correct, false);
});

test('旧记录只使用已保存明细，缺少原题与本轮题号时保留未知语义', () => {
  const api = training();
  const record = { total: 12, duration: 100, details: [{ questionId: 'old', question: '旧摘要', chosen: ['B'], answer: ['A'], correct: false }] };
  const before = JSON.stringify(record);
  const rows = api.reviewRows(record);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].roundNumber, null);
  assert.equal(rows[0].bankQuestionNumber, null);
  assert.equal(rows[0].partial, true);
  assert.equal(rows[0].status, 'wrong');
  assert.equal(JSON.stringify(record), before);
});

test('完整备份往返保留复盘扩展，合并导入时未答快照的题库引用同步映射', () => {
  const helper=training(), initial=webState(), record=initial.records[0];
  record.total=3;
  record.review=plain(helper.buildReview([...record.details.map(detail=>({bankId:detail.sourceBankId,question:detail.nativeQuestion})),{bankId:'bank-a',question:question('not-submitted','未答快照')}],record.details,{completion:'ended_early',submitMode:'single',timing:'active'}));
  record.reviewSummary=plain(helper.reviewSummary(record.review,record.details));
  const {api}=loadWeb({state:initial});
  const payload=plain(api.buildBackupPayloadV23(api.snapshot().banks,'all_data',true));
  const restored=plain(api.normalizeBackupPayloadV23(JSON.parse(JSON.stringify(payload)),'training.json'));
  assert.deepEqual(restored.records[0].review,record.review);
  assert.deepEqual(restored.records[0].reviewSummary,record.reviewSummary);
  restored.records[0].id='imported-training';
  api.mergeBackupBanksV23(restored);
  const merged=api.snapshot(), imported=merged.records.find(value=>value.id==='imported-training');
  assert.notEqual(imported.review.items[2].sourceBankId,'bank-a');
  assert.equal(imported.review.items[2].sourceBankId,imported.details[0].sourceBankId);
  assert.equal(imported.review.items[2].question.question,'未答快照');
});
