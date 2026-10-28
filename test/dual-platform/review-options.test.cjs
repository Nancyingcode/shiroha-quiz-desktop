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

test('错题一览的缺失、空字符串及空白解析均显示空态和主动 AI 入口', () => {
  const { api } = loadWeb();
  for (const analysis of [undefined, '', ' \n\t ']) {
    const q = { id: 'empty-analysis', type: 'single', question: '自建空解析题', options: [], answer: ['A'], analysis };
    const html = api.renderPracticeWrongOverview({ id: 'empty', bankId: 'source', details: [{ nativeQuestion: q, chosen: ['B'], answer: ['A'], correct: false }] });
    assert.match(html, /暂无解析/);
    assert.match(html, /AI 生成解析/);
  }
});

test('错题快照缺少解析时补读明确来源题库，保留快照正文及历史数据', () => {
  const q = { id: 'same-id', type: 'single', question: '当前题干', options: [], answer: ['A'], analysis: '来源题库解析' };
  const raw = { banks: [{ id: 'source', name: '来源', questions: [q] }, { id: 'other', name: '其他', questions: [{ ...q, analysis: '其他题库解析' }] }], activeBankId: 'other', settings: { suppressDefaultBank: true } };
  const { api } = loadWeb({ state: raw });
  const snapshot = { ...q, question: '历史题干', analysis: '' };
  const record = { id: 'history', bankId: 'source', details: [{ nativeQuestion: snapshot, chosen: ['B'], correct: false }] };
  const before = JSON.stringify(record);
  const html = api.renderPracticeWrongOverview(record);
  assert.match(html, /来源题库解析/);
  assert.match(html, /历史题干/);
  assert.doesNotMatch(html, /其他题库解析/);
  assert.equal(JSON.stringify(record), before);
  snapshot.analysis = '原始快照解析';
  assert.match(api.renderPracticeWrongOverview(record), /原始快照解析/);
  snapshot.analysis = '';
  assert.doesNotMatch(api.renderPracticeWrongOverview({ ...record, bankId: '' }), /其他题库解析/);
  assert.match(api.renderPracticeWrongOverview({ ...record, bankId: '' }), /暂无解析/);
});

test('缺少 nativeQuestion 的旧错题按 questionId 补读，未知来源不绑定当前题库', () => {
  const questions = ['one', 'two'].map(id => ({ id, type: 'single', question: id, options: [], answer: ['A'], analysis: id + '解析' }));
  const { api } = loadWeb({ state: { banks: [{ id: 'source', name: '来源', questions }], activeBankId: 'source', settings: { suppressDefaultBank: true } } });
  const record = { id: 'legacy', bankId: 'source', details: questions.map(q => ({ questionId: q.id, question: '旧' + q.question, type: q.type, chosen: ['B'], answer: ['A'], correct: false })) };
  const html = api.renderPracticeWrongOverview(record);
  assert.match(html, /one解析/);
  assert.match(html, /two解析/);
  const keys = [...html.matchAll(/data-review-analysis="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(keys).size, 2);
  assert.doesNotMatch(api.renderPracticeWrongOverview({ ...record, bankId: '' }), /one解析|two解析/);
});
