'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');
const { questions, webState, IMAGE } = require('./fixtures/dataset.cjs');

function textFixture(name) { return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'); }

test('查找表达式、文本截断与随机排序保留输入和原有规则', () => {
  const { api } = loadWeb();
  assert.deepEqual(plain(api.parseSlashRegexV51('/foo/im')), { pattern: 'foo', flags: 'im' });
  assert.equal(api.parseSlashRegexV51('foo'), null);
  const literal = api.buildFindRegExpV51('a.b', { useRegex: false, caseSensitive: false, global: true });
  assert.equal(literal.source, 'a\\.b');
  assert.equal(literal.flags, 'gi');
  assert.equal(literal.test('A.B'), true);
  const regex = api.buildFindRegExpV51('/foo/im', { useRegex: true, caseSensitive: false, global: true });
  assert.equal(regex.source, 'foo');
  assert.equal(regex.flags, 'gim');
  assert.throws(() => api.buildFindRegExpV51(''), /请先输入/);
  assert.throws(() => api.buildFindRegExpV51('a*'), /不能匹配空字符串/);
  assert.equal(api.short('abcdef', 3), 'abc…');
  assert.equal(api.short('![](data:image/png;base64,AA)题目', 20), '[图片]题目');
  const original = Object.freeze([1, 2, 3, 4]);
  const shuffled = api.shuffle(original);
  assert.notEqual(shuffled, original);
  assert.deepEqual(Array.from(shuffled).sort(), Array.from(original));
});

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
  ]) { assert.equal(api.sameAnswerForQuestion(question, chosen, question.answer), correct); }
});

test('多空答案按位置接受别名，空白、漏空、交换顺序不判正确', () => {
  const { api } = loadWeb();
  const question = questions()[3];
  for (const [chosen, correct] of [
    [['北京市', '京'], true], [[' 北京。 ', '京'], true],
    [['北京', ''], false], [['北京'], false], [['京', '北京'], false],
  ]) { assert.equal(api.sameAnswerForQuestion(question, chosen, question.answer), correct); }
});

test('自选题号保留去重排序、区间边界和原有错误文案', () => {
  const { api } = loadWeb();
  const parse = (raw, max = 10) => plain(api.parsePracticeNumberRangeV58916(raw, max));
  assert.deepEqual(parse(' 3，1、3；5-7 6 10~10 '), { indexes: [0, 2, 4, 5, 6, 9], error: '' });
  assert.deepEqual(parse('1—2,4至5'), { indexes: [0, 1, 3, 4], error: '' });
  assert.deepEqual(parse(''), { indexes: [], error: '请输入题号，例如 1,3,5-10,20。' });
  assert.deepEqual(parse('，、；'), { indexes: [], error: '没有可用的题号。' });
  assert.deepEqual(parse('1,0,8-7,9-11,abc,12,13,14'), {
    indexes: [], error: '题号格式或范围有误：0、8-7、9-11、abc、12…',
  });
  assert.deepEqual(parse('1 - 3'), { indexes: [], error: '题号格式或范围有误：-' });
  assert.deepEqual(parse('1', 0), { indexes: [], error: '题号格式或范围有误：1' });
});

test('精确题号格式保留单题范围，避免被解释为从该题继续', () => {
  const { api } = loadWeb();
  assert.equal(api.formatExactPracticeNumbersV58916([]), '');
  assert.equal(api.formatExactPracticeNumbersV58916(Object.freeze([2])), '2-2');
  assert.equal(api.formatExactPracticeNumbersV58916(Object.freeze([2, 4, 7])), '2,4,7');
});

test('多空归一化保留位置和空组，只去除各组内修剪后完全相同的答案', () => {
  const { api } = loadWeb();
  const input = Object.freeze([
    Object.freeze([' 甲 ', '甲', '', null, 'Ａ', 'A', '甲 ']),
    Object.freeze(['', '  ']),
    '乙',
    Object.freeze([0, false, '0', 'false']),
  ]);
  const expected = [['甲', 'Ａ', 'A'], [], ['乙'], ['0', 'false']];
  assert.deepEqual(plain(api.normalizeBlankAnswersV58914(input)), expected);
  assert.deepEqual(plain(api.normalizeBlankAnswersV58914(null)), []);
  assert.equal(api.primaryBlankAnswerV58914(input), '甲；；乙；0');
  const copy = api.cloneBlankAnswersV58914(input);
  assert.deepEqual(plain(copy), expected);
  copy[0].push('新答案');
  assert.equal(input[0].length, 7);
  assert.equal(api.normalizeBlankTextV58914('  ，ＢＥＩＪＩＮＧ。 '), 'beijing');
  assert.equal(api.normalizeBlankTextV58914('甲，乙'), '甲,乙');
  for (const type of ['blank', 'BLANK', 'fill-in-blank']) {
    assert.equal(api.isMultiBlankQuestionV58914({ type, blankAnswers: [[]] }), true);
  }
  assert.equal(api.isMultiBlankQuestionV58914({ type: 'short', blankAnswers: [['甲']] }), false);
  assert.equal(api.isMultiBlankQuestionV58914({ type: 'blank', blankAnswers: [] }), false);
  assert.equal(api.isMultiBlankQuestionV58914(null), false);
});

test('多空判定保留位置、空组和标点比较规则，且不更改输入', () => {
  const { api } = loadWeb();
  const question = { type: 'BLANK', blankAnswers: [['Ａ', 'a', '甲，乙'], ['京']] };
  const before = structuredClone(question);
  for (const [chosen, correct] of [
    [[' a。 ', '京'], true], [['甲,乙', ' 京 '], true],
    [['甲乙', '京'], false], [['京', 'a'], false],
    [['a'], false], [['a', '京', '多余'], false], [['a', ''], false],
  ]) { assert.equal(api.sameAnswerForQuestion(question, chosen, []), correct); }
  assert.equal(api.sameAnswerForQuestion({ type: 'blank', blankAnswers: [['甲'], []] }, ['甲', ''], []), false);
  assert.deepEqual(question, before);
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

test('简答自评区分未选择、判错与判对，空答案不请求自评', () => {
  const { api } = loadWeb();
  const question = { type: 'short' };
  assert.equal(api.needsPracticeSelfAssessment(question, { chosen: ['回答'] }), true);
  assert.equal(api.needsPracticeSelfAssessment(question, { chosen: ['回答'], selfCorrect: null }), true);
  assert.equal(api.needsPracticeSelfAssessment(question, { chosen: ['回答'], selfCorrect: false }), false);
  assert.equal(api.needsPracticeSelfAssessment(question, { chosen: ['回答'], selfCorrect: true }), false);
  assert.equal(api.needsPracticeSelfAssessment(question, { chosen: [' '] }), false);
  assert.equal(api.needsPracticeSelfAssessment({ type: 'blank' }, { chosen: ['回答'] }), false);
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
    assert.equal(api.scoreOf({ type, score: 0 }), expected);
  }
  assert.equal(api.scoreOf({ type: 'unknown' }), 2);
  assert.equal(api.scoreOf({ type: 'single', score: '0' }), '0');
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
  assert.deepEqual(plain(questionList.map((question) => question.number)), [1, 1, 1]);
  assert.deepEqual(plain(questionList.map((question) => question.type)), ['single', 'multiple', 'judge']);
  assert.deepEqual(plain(answers.map((entry) => entry.answer)), [['A'], ['A', 'C'], ['正确']]);
  for (const mode of ['group', 'number', 'auto']) {
    const merged = api.mergeQuestionAnswers(questionList, answers, mode);
    assert.deepEqual(plain(merged.questions.map((question) => question.answer)), [['A'], ['A', 'C'], ['A']]);
  }
  assert(questionList.every((question) => question.answer.length === 0), '合并不能修改原题目列表。');
});

test('共享材料绑定到两道题，答案和各自选项保持独立', () => {
  const { api } = loadWeb();
  const parsed = api.parseTextQuestions(textFixture('material.txt'));
  assert.equal(parsed.length, 2);
  parsed.forEach((question) => assert.match(question.question, /某学校种植了十棵树，其中六棵为松树，四棵为柏树/));
  assert.match(parsed[0].question, /学校种植了多少棵树/);
  assert.match(parsed[1].question, /松树有多少棵/);
  assert.deepEqual(plain(parsed.map((question) => question.answer)), [['A'], ['B']]);
  assert.deepEqual(plain(parsed.map((question) => question.options.map((option) => option.text))), [['十棵', '六棵'], ['四棵', '六棵']]);
});

test('跨题库同 ID 保持独立练习标识和错题状态', () => {
  const { api } = loadWeb({ state: webState() });
  const state = api.snapshot();
  const first = { bankId: 'bank-a', question: state.banks[0].questions[0] };
  const second = { bankId: 'bank-b', question: state.banks[1].questions[0] };
  assert.equal(api.practiceItemKeyV8916(first), 'bank-a#same-id');
  assert.equal(api.practiceItemKeyV8916(second), 'bank-b#same-id');
  api.addWrong('same-id', 'bank-a');
  assert.equal(api.getWrongEntries('bank-a').find((entry) => entry.id === 'same-id').wrongCount, 1);
  assert.equal(api.getWrongEntries('bank-b').length, 0);
  api.markRight('same-id', 'bank-a');
  assert.equal(api.getWrongEntries('bank-a').find((entry) => entry.id === 'same-id').status, '复习中');
  api.markRight('same-id', 'bank-a');
  assert.equal(api.getWrongEntries('bank-a').find((entry) => entry.id === 'same-id').status, '已掌握');
});

test('错题保存错误选择副本，正确复习不覆盖，重新答错更新且跨库隔离', () => {
  const initial = webState();
  initial.wrongBook = {};
  const { api } = loadWeb({ state: initial });
  const chosen = ['B'];
  api.addWrong('same-id', 'bank-a', chosen);
  chosen.push('C');
  assert.deepEqual(plain(api.getWrongEntries('bank-a')[0].lastAnswer), ['B']);
  api.markRight('same-id', 'bank-a');
  assert.deepEqual(plain(api.getWrongEntries('bank-a')[0].lastAnswer), ['B']);
  api.addWrong('same-id', 'bank-b', ['A']);
  assert.deepEqual(plain(api.getWrongEntries('bank-b')[0].lastAnswer), ['A']);
  api.addWrong('same-id', 'bank-a', ['C', 'D']);
  assert.deepEqual(plain(api.getWrongEntries('bank-a')[0].lastAnswer), ['C', 'D']);
  const restored = loadWeb({ state: api.snapshot() }).api;
  assert.deepEqual(plain(restored.getWrongEntries('bank-a')[0].lastAnswer), ['C', 'D']);
  api.addWrong('same-id', 'bank-a', []);
  assert.deepEqual(plain(api.getWrongEntries('bank-a')[0].lastAnswer), []);
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

test('答案比较保留空答案、重复选项和输入所有权的既有语义', () => {
  const { api } = loadWeb();
  const chosen = Object.freeze(['C', 'A']);
  const answer = Object.freeze(['A', 'C']);
  assert.equal(api.sameAnswerForQuestion({ type: 'multiple' }, chosen, answer), true);
  assert.deepEqual(chosen, ['C', 'A']);
  assert.deepEqual(answer, ['A', 'C']);
  assert.equal(api.sameAnswerForQuestion({ type: 'multiple' }, ['A', 'A'], ['A']), false);
  assert.equal(api.sameAnswerForQuestion({ type: 'single' }, [], []), true);
  assert.equal(api.sameAnswerForQuestion({ type: 'blank' }, [], ['']), false);
  assert.equal(api.sameAnswerForQuestion({ type: 'short' }, [''], ['']), false);
  const blank = { type: 'blank', blankAnswers: [['beijing'], ['京']] };
  assert.equal(api.sameAnswerForQuestion(blank, ['ＢＥＩＪＩＮＧ', '京'], []), true);
  assert.deepEqual(blank.blankAnswers, [['beijing'], ['京']]);
});

test('答案表保留区间、粘连题号、分组和原始答案文本', () => {
  const { api } = loadWeb();
  const entries = api.parseAnswerEntries('单选题\n1-3：A B C\n28 B29 B\n多选题\n第1题：A、C\n判断题\n1. 正确');
  assert.deepEqual(plain(entries.map((entry) => [entry.number, entry.group, entry.answer, entry.raw])), [
    ['1', '单选题', ['A'], 'A'], ['2', '单选题', ['B'], 'B'], ['3', '单选题', ['C'], 'C'],
    ['28', '单选题', ['B'], 'B'], ['29', '单选题', ['B'], 'B'],
    ['1', '多选题', ['A', 'C'], 'A、C'], ['1', '判断题', ['正确'], '正确'],
  ]);
});

test('重复题号无法判断题型时保留空答案并保持源数据不变', () => {
  const { api } = loadWeb();
  const questions = [{ id: 'x', number: 1, type: 'judge', question: '判断？',
    options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [] }];
  const answers = [
    { number: '1', group: '单选题', answer: ['C'], raw: 'C' },
    { number: '1', group: '多选题', answer: ['A', 'C'], raw: 'AC' },
  ];
  const before = structuredClone({ questions, answers });
  const result = api.mergeQuestionAnswers(questions, answers, 'number');
  assert.deepEqual(plain(result.questions[0].answer), []);
  assert(result.warnings.some((warning) => warning.includes('重复题号')));
  assert.deepEqual({ questions, answers }, before);
});

test('原文题号识别区分题干、选项、答案和解析行', () => {
  const { api } = loadWeb();
  const cases = [
    ['1. 这是一道题？', 1], ['第12题 判断题：北京是首都吗？', 12], ['（13）这是第十三题', 13],
    ['2. A', 0], ['3. 答案：B', 0], ['A. 这是选项', 0], ['一、单选题', 0], ['12. 解析：说明', 0],
  ];
  for (const [line, expected] of cases) {
    assert.equal(api.sourceQuestionNumberFromLineV58910(line), expected, line);
  }
});
