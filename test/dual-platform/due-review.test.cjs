'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

function selectionFixture() {
  const today = new Date(2026, 10, 17, 12);
  const localTime = (day, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
  const banks = [
    {
      id: 'a',
      questions: [
        'today', 'old', 'legacy', 'bad', 'tomorrow', 'mastered', 'same',
      ].map((id) => ({ id, type: 'single' })),
    },
    { id: 'b', questions: [{ id: 'same', type: 'single' }] },
  ];
  const wrong = {
    a: [
      { id: 'today', status: '复习中', nextReviewAt: localTime(17, 23, 59) },
      { id: 'old', status: '未掌握', nextReviewAt: localTime(15) },
      { id: 'legacy', status: '未掌握' },
      { id: 'bad', status: '复习中', nextReviewAt: 'invalid-date' },
      { id: 'tomorrow', status: '未掌握', nextReviewAt: localTime(18) },
      { id: 'mastered', status: '已掌握', nextReviewAt: localTime(14) },
      { id: 'same', status: '未掌握', nextReviewAt: localTime(16) },
      { id: 'deleted', status: '未掌握', nextReviewAt: localTime(14) },
      { id: 'old', status: '未掌握', nextReviewAt: localTime(16) },
    ],
    b: [{ id: 'same', status: '未掌握', nextReviewAt: localTime(14) }],
  };
  const context = vm.createContext({});
  runWebScripts(context, ['practice-selection.js']);
  const api = context.ShirohaPracticeSelection.create({
    state: { settings: {} },
    session: {},
    select: () => null,
    scope: { banks: (scope) => (scope?.type === 'bank' ? banks.filter((bank) => bank.id === scope.value) : banks) },
    questions: {
      itemsForBanks: (values) => values.flatMap(
        (bank) => bank.questions.map((question) => ({ bankId: bank.id, question })),
      ),
      wrongEntries: (id) => wrong[id],
    },
    progress: {},
  });
  return { api, banks, wrong, today, localTime };
}

const keys = (items) => Array.from(items, (item) => `${item.bankId}:${item.question.id}`);

test('今日复习队列按范围过滤并先排逾期，历史缺失及无效时间可复习', () => {
  const fixture = selectionFixture();
  const before = JSON.stringify({ banks: fixture.banks, wrong: fixture.wrong });
  const group = fixture.api.dueReviewItems({ type: 'group', value: 'g' }, fixture.today);
  assert.deepEqual(keys(group), ['b:same', 'a:old', 'a:same', 'a:legacy', 'a:bad', 'a:today']);
  const bank = fixture.api.dueReviewItems({ type: 'bank', value: 'a' }, fixture.today);
  assert.deepEqual(keys(bank), ['a:old', 'a:same', 'a:legacy', 'a:bad', 'a:today']);
  assert.equal(JSON.stringify({ banks: fixture.banks, wrong: fixture.wrong }), before);
});

test('本地午夜是到期日界线，下一日本地零点才进入队列', () => {
  const fixture = selectionFixture();
  const scope = { type: 'bank', value: 'a' };
  const beforeMidnight = new Date(2026, 10, 17, 23, 59, 59);
  const midnight = new Date(2026, 10, 18, 0, 0, 0);
  assert.equal(keys(fixture.api.dueReviewItems(scope, beforeMidnight)).includes('a:tomorrow'), false);
  assert.equal(keys(fixture.api.dueReviewItems(scope, midnight)).includes('a:tomorrow'), true);
  assert.equal(keys(fixture.api.dueReviewItems(scope, midnight))[2], 'a:today');
});

test('跨夏令时仍以本地下一日零点为边界', () => {
  const fixture = selectionFixture();
  fixture.wrong.a = [{ id: 'today', status: '未掌握', nextReviewAt: new Date(2026, 2, 9).toISOString() }];
  const date = new Date(2026, 2, 8, 12);
  assert.deepEqual(keys(fixture.api.dueReviewItems({ type: 'bank', value: 'a' }, date)), []);
});
