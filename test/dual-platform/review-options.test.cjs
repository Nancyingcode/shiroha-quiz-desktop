'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb } = require('./web-source.cjs');

test('错题复盘保留全部选项并区分正确、错选和未选项', () => {
  const { api } = loadWeb();
  const q = { type: 'multiple', options: ['A', 'B', 'C', 'D'].map(key => ({ key, text: `选项${key}` })), answer: ['A', 'C'] };
  const html = api.renderReviewOptions(q, ['A', 'D']);
  for (const key of ['A', 'B', 'C', 'D']) assert.ok(html.includes(`选项${key}`));
  assert.match(html, /正确答案 · 当时选择/);
  assert.match(html, /✕ 当时选择/);
  assert.match(html, /未选择/);
  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(api.renderReviewOptions(q), /当时选择/);
  assert.equal(api.renderReviewOptions({ type: 'short' }), '');
  assert.equal((html.match(/class="option wrong"/g) || []).length, 1);
  assert.equal((html.match(/class="option correct"/g) || []).length, 2);
});

test('未知旧作答与本轮未作答明确区分，判断题仍按保存的键标红', () => {
  const { api } = loadWeb();
  const q = { type: 'judge', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: ['A'] };
  assert.match(api.renderReviewAnswerSummary(q), /未记录/);
  assert.match(api.renderReviewAnswerSummary(q, [], '未作答'), /未作答/);
  assert.doesNotMatch(api.renderReviewOptions(q, []), /option wrong/);
  assert.match(api.renderReviewOptions(q, ['B']), /class="option wrong" data-key="B"/);
  assert.equal(api.renderReviewAnswerSummary({ type: 'blank' }), '');
});

test('练习结束后的错题一览显示快照中的全部选项', () => {
  const { api } = loadWeb();
  const q = api.normalizeQuestion({ id: 'review', type: 'single', question: '测试题', options: ['A', 'B', 'C', 'D'].map(key => ({ key, text: `完整选项${key}` })), answer: ['B'] });
  const html = api.renderPracticeWrongOverview({ details: [{ nativeQuestion: q, chosen: ['D'], answer: ['B'], correct: false }] });
  for (const key of ['A', 'B', 'C', 'D']) assert.ok(html.includes(`完整选项${key}`));
});
