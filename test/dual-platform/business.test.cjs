'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');
const { questions, webState, IMAGE } = require('./fixtures/dataset.cjs');

function textFixture(name) { return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'); }

test('五类题目及历史别名归一化保持题型和答案语义', () => {
  const { api } = loadWeb();
  const fixture = questions();
  const aliases = ['SINGLE', 'MULTIPLE', 'JUDGE', 'BLANK', 'SHORT'];
  fixture.slice(0, 5).forEach((question, index) => {
    const actual = api.normalizeQuestion({ ...question, type: aliases[index] }, index);
    assert.equal(actual.type, question.type);
    assert.deepEqual(plain(actual.answer), question.answer);
    assert.equal(actual.score, question.score);
  });
  assert.equal(api.normalizeQuestion({ ...fixture[1], type: 'multi' }).type, 'multiple');
  assert.equal(api.normalizeQuestion({ ...fixture[4], type: 'short_answer' }).type, 'short');
});

test('单选、多选、判断严格匹配，多选顺序不影响结果但漏选与多选不得分', () => {
  const { api } = loadWeb();
  const [single, multiple, judge] = questions();
  for (const [question, chosen, correct] of [
    [single, ['A'], true], [single, ['B'], false],
    [multiple, ['C', 'A'], true], [multiple, ['A'], false], [multiple, ['A', 'B', 'C'], false],
    [judge, ['A'], true], [judge, ['B'], false],
  ]) assert.equal(api.sameAnswerForQuestion(question, chosen, question.answer), correct);
});

test('多空答案按位置接受别名，空白、漏空、交换顺序不判正确', () => {
  const { api } = loadWeb();
  const question = questions()[3];
  for (const [chosen, correct] of [
    [['北京市', '京'], true], [[' 北京。 ', '京'], true],
    [['北京', ''], false], [['北京'], false], [['京', '北京'], false],
  ]) assert.equal(api.sameAnswerForQuestion(question, chosen, question.answer), correct);
});

test('旧单空支持等价参考答案；简答文本比较保持换行内容但练习自评分数由调用者确认', () => {
  const { api } = loadWeb();
  const blank = { type: 'blank', answer: ['北京', '北京市'] };
  assert.equal(api.sameAnswerForQuestion(blank, [' 北 京。'], blank.answer), true);
  assert.equal(api.sameAnswerForQuestion(blank, ['南京'], blank.answer), false);
  const question = questions()[4];
  assert.deepEqual(plain(api.normalizeQuestion(question).answer), ['先保存\n再退出']);
  const correct = api.makeAnswerDetail({ bankId: 'bank-a', bankName: '阶段A全题型', question }, ['人工核对后的作答'], true, 5, 5);
  const wrong = api.makeAnswerDetail({ bankId: 'bank-a', bankName: '阶段A全题型', question }, ['人工核对后的作答'], false, 5, 5);
  assert.equal(correct.score, 5);
  assert.equal(wrong.score, 0);
});

test('无答案题保留空答案，普通非空作答不能通过比较', () => {
  const { api } = loadWeb();
  const question = api.normalizeQuestion(questions()[5]);
  assert.deepEqual(plain(question.answer), []);
  assert.equal(api.sameAnswerForQuestion(question, ['A'], question.answer), false);
});

test('题目自定分覆盖界面默认分；答题明细保留多空内容、满分、来源和历史快照', () => {
  const { api } = loadWeb({ scoreDefaults: { single: 2, multiple: 4, judge: 1, blank: 3, short: 5 } });
  for (const [type, expected] of [['single', 2], ['multiple', 4], ['judge', 1], ['blank', 3], ['short', 5]]) {
    assert.equal(api.scoreOf({ type }), expected);
    assert.equal(api.scoreOf({ type, score: 7 }), 7);
  }
  const question = questions()[3];
  const detail = plain(api.makeAnswerDetail({ bankId: 'bank-a', bankName: '阶段A全题型', question }, ['北京市', '京'], true, 4, 4));
  assert.deepEqual(detail.blankAnswers, [['北京', '北京市'], ['京']]);
  assert.deepEqual(detail.userBlankAnswers, ['北京市', '京']);
  assert.equal(detail.score, 4);
  assert.equal(detail.fullScore, 4);
  assert.equal(detail.sourceBankId, 'bank-a');
  assert.deepEqual(detail.nativeQuestion, question);
  assert.notEqual(detail.nativeQuestion, question);
});

test('双文件按题型与重复题号对应，不能将单选答案套到多选或判断题', () => {
  const { api } = loadWeb();
  const questionList = api.parseTextQuestions(textFixture('dual-questions.txt'));
  const answers = api.parseAnswerEntries(textFixture('dual-answers.txt'));
  assert.deepEqual(plain(questionList.map(question => question.number)), [1, 1, 1]);
  assert.deepEqual(plain(questionList.map(question => question.type)), ['single', 'multiple', 'judge']);
  assert.deepEqual(plain(answers.map(entry => entry.answer)), [['A'], ['A', 'C'], ['正确']]);
  for (const mode of ['group', 'number', 'auto']) {
    const merged = api.mergeQuestionAnswers(questionList, answers, mode);
    assert.deepEqual(plain(merged.questions.map(question => question.answer)), [['A'], ['A', 'C'], ['A']]);
  }
  assert(questionList.every(question => question.answer.length === 0), '合并不能修改原题目列表。');
});

test('共享材料绑定到两道题，答案和各自选项保持独立', () => {
  const { api } = loadWeb();
  const parsed = api.parseTextQuestions(textFixture('material.txt'));
  assert.equal(parsed.length, 2);
  parsed.forEach(question => assert.match(question.question, /某学校种植了十棵树，其中六棵为松树，四棵为柏树/));
  assert.match(parsed[0].question, /学校种植了多少棵树/);
  assert.match(parsed[1].question, /松树有多少棵/);
  assert.deepEqual(plain(parsed.map(question => question.answer)), [['A'], ['B']]);
  assert.deepEqual(plain(parsed.map(question => question.options.map(option => option.text))), [['十棵', '六棵'], ['四棵', '六棵']]);
});

test('跨题库同 ID 保持独立练习标识和错题状态', () => {
  const { api } = loadWeb({ state: webState() });
  const state = api.snapshot();
  const first = { bankId: 'bank-a', question: state.banks[0].questions[0] };
  const second = { bankId: 'bank-b', question: state.banks[1].questions[0] };
  assert.equal(api.practiceItemKeyV8916(first), 'bank-a#same-id');
  assert.equal(api.practiceItemKeyV8916(second), 'bank-b#same-id');
  api.addWrong('same-id', 'bank-a');
  assert.equal(api.getWrongEntries('bank-a').find(entry => entry.id === 'same-id').wrongCount, 1);
  assert.equal(api.getWrongEntries('bank-b').length, 0);
  api.markRight('same-id', 'bank-a');
  assert.equal(api.getWrongEntries('bank-a').find(entry => entry.id === 'same-id').status, '复习中');
  api.markRight('same-id', 'bank-a');
  assert.equal(api.getWrongEntries('bank-a').find(entry => entry.id === 'same-id').status, '已掌握');
});

test('现有富文本公式和所有可显示图片位置保持在解析后的题目文本中', () => {
  const { api } = loadWeb();
  const question = api.normalizeQuestion(questions()[6]);
  assert.match(question.question, /\$x\^2\$/);
  assert(question.question.includes(IMAGE));
  assert(question.options[0].text.includes(IMAGE));
  assert(question.analysis.includes(IMAGE));
  assert.equal(question.images[0].dataUrl, IMAGE);
});
