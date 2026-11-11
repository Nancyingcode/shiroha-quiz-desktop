'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

function fixture() {
  const banks = ['a', 'b'].map((id) => ({
    id,
    questions: Array.from({ length: 250 }, (_, index) => ({
      id: `q-${index}`,
      type: index % 2 ? 'multiple' : 'single',
    })),
  }));
  const from = {};
  const continued = {};
  const start = {
    value: 'continue',
    querySelector: (selector) => (selector.includes('"from"') ? from : continued),
  };
  const nodes = {
    '#practice-start-mode-v58916': start,
    '#practice-number-range-v58916': { value: '3' },
    '#practice-limit-control-v58916': {},
    '#practice-range-label-v58916': {},
    '#practice-order': { value: 'random' },
    '#practice-source': { value: 'all' },
    '#practice-type': { value: 'all' },
  };
  const state = { settings: {} };
  let enumerated = 0;
  const context = vm.createContext({});
  runWebScripts(context, ['practice-selection.js']);
  const api = context.ShirohaPracticeSelection.create({
    state,
    session: {},
    select: (selector) => nodes[selector] || null,
    scope: {
      banks: () => banks,
      current: () => ({ type: 'GROUP', value: 'g' }),
      normalize: (scope) => scope,
      fromStart: 'from',
      continueMode: 'continue',
      custom: 'custom',
    },
    questions: {
      itemsForBanks: (values) => values.flatMap((bank) => bank.questions.map((question) => {
        enumerated += 1;
        return { bankId: bank.id, question };
      })),
      key: (item) => `${item.bankId}:${item.question.id}`,
      wrongEntries: (bankId) => [{ id: bankId === 'a' ? 'q-0' : 'q-1', status: '未掌握' }],
      favorites: (bankId) => [bankId === 'a' ? 'q-2' : 'q-3'],
      shuffle: (items) => [...items].reverse(),
      parseNumbers: (raw, count) => {
        const number = Number(raw);
        return number >= 1 && number <= count ? { indexes: [number - 1] } : { error: '题号无效' };
      },
    },
    progress: { answer: () => ({}) },
  });
  return { api, banks, nodes, state, start, from, continued, count: () => enumerated, reset: () => { enumerated = 0; } };
}

test('随机起点控件同步不枚举题目，顺序模式仍定位跨库进度', () => {
  const f = fixture();
  f.api.syncPracticeStartUiV58916(true);
  assert.equal(f.count(), 0);
  assert.equal(f.start.value, 'from');
  assert.equal(f.from.textContent, '全部范围');
  assert.equal(f.continued.hidden, true);

  f.nodes['#practice-order'].value = 'sequence';
  const scope = { type: 'GROUP', value: 'g' };
  f.state.settings.practiceProgressV58916 = {
    [JSON.stringify(['GROUP', 'g', 'all', 'all'])]: { nextSessionKey: 'b:q-0', nextIndex: 0 },
  };
  f.api.syncPracticeStartUiV58916(true);
  assert.equal(f.count(), 500);
  assert.equal(f.start.value, 'continue');
  assert.equal(f.continued.textContent, '继续上次 · 第251题');
  const chosen = f.api.buildPracticeSelectionV58916(scope, 'all', 'all', 'sequence', '2');
  assert.deepEqual(Array.from(chosen.items, (item) => `${item.bankId}:${item.question.id}`), ['b:q-0', 'b:q-1']);
});

test('练习和考试基础筛选保持跨库身份、顺序、自选起点与随机题量', () => {
  const f = fixture();
  const scope = { type: 'GROUP', value: 'g' };
  const keys = (items) => Array.from(items, (item) => `${item.bankId}:${item.question.id}`);
  assert.deepEqual(keys(f.api.filteredPracticeItemsV8916('wrong', 'all', 'sequence', 'all', 20, scope)), ['a:q-0', 'b:q-1']);
  assert.deepEqual(keys(f.api.filteredPracticeItemsV8916('favorite', 'multi', 'sequence', 'all', 20, scope)), ['b:q-3']);
  assert.deepEqual(keys(f.api.filteredPracticeItemsV8916('all', 'single', 'random', '2', 20, scope)), ['b:q-248', 'b:q-246']);
  f.start.value = 'custom';
  assert.deepEqual(keys(f.api.buildPracticeSelectionV58916(scope, 'all', 'all', 'sequence', '2').items), ['a:q-2', 'a:q-3']);
  f.start.value = 'from';
  assert.deepEqual(keys(f.api.buildPracticeSelectionV58916(scope, 'all', 'all', 'random', '2').items), ['b:q-249', 'b:q-248']);
});
