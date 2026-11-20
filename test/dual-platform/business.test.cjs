'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');
const { questions, webState, IMAGE } = require('./fixtures/dataset.cjs');

function textFixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

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
  const item = { bankId: 'bank-a', bankName: '阶段A全题型', question };
  const result = {
    question, chosen: ['人工核对后的作答'], score: 5, time: '2026-11-19T01:00:00.000Z',
  };
  const correct = api.makeAnswerDetail(item, { ...result, correct: true });
  const wrong = api.makeAnswerDetail(item, { ...result, correct: false });
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
  const time = '2026-11-19T01:00:00.000Z';
  const chosen = ['北京市', '京'];
  const detail = api.makeAnswerDetail(
    { bankId: 'bank-a', bankName: '阶段A全题型', question },
    { question, chosen, correct: true, score: 4, time },
  );
  assert.deepEqual(plain(detail.blankAnswers), [['北京', '北京市'], ['京']]);
  assert.deepEqual(plain(detail.userBlankAnswers), ['北京市', '京']);
  assert.equal(detail.score, 4);
  assert.equal(detail.fullScore, 4);
  assert.equal(detail.sourceBankId, 'bank-a');
  assert.equal(detail.time, time);
  assert.deepEqual(plain(detail.nativeQuestion), question);
  assert.notEqual(detail.nativeQuestion, question);
  question.blankAnswers[0][0] = '后来修改';
  chosen[0] = '后来作答';
  assert.equal(detail.nativeQuestion.blankAnswers[0][0], '北京');
  assert.equal(detail.blankAnswers[0][0], '北京');
  assert.equal(detail.userBlankAnswers[0], '北京市');
});

test('双文件按题型与重复题号对应，不能将单选答案套到多选或判断题', () => {
  const { api } = loadWeb();
  const questionList = api.parseTextQuestions(textFixture('dual-questions.txt'));
  const answers = api.parseAnswerEntries(textFixture('dual-answers.txt'));
  assert.deepEqual(plain(questionList.map((question) => question.number)), [1, 1, 1]);
  assert.deepEqual(plain(questionList.map((question) => question.type)), ['single', 'multiple', 'judge']);
  assert.deepEqual(plain(answers.map((entry) => entry.answer)), [['A'], ['A', 'C'], ['正确']]);
  for (const mode of ['group', 'number', 'number-strict', 'order', 'auto']) {
    const merged = api.mergeQuestionAnswers(questionList, answers, mode);
    assert.deepEqual(plain(merged.questions.map((question) => question.answer)), [['A'], ['A', 'C'], ['A']]);
  }
  assert(questionList.every((question) => question.answer.length === 0), '合并不能修改原题目列表。');

  const resolved = api.resolveDualAnswerCandidates(questionList, textFixture('dual-answers.txt'));
  assert.equal(resolved.result.chosenMode, 'group');
  assert.equal(resolved.result.autoScore, 300);
  assert.deepEqual(plain(resolved.result.warnings), []);
  assert.equal(resolved.answerSourceName, '答案表提取');
  assert.equal(resolved.answerSourceSummary, '答案表提取3条/质量360；答案解析区提取2条/质量130');
});

test('双文件完整解析兜底保留缺答警告，混合候选去重且保留首条答案', () => {
  const { api } = loadWeb();
  const questionList = api.parseTextQuestions([
    '一、单选题',
    '1. 第一题选甲还是乙？', 'A. 甲', 'B. 乙',
    '2. 第二题选左还是右？', 'A. 左', 'B. 右',
    '3. 第三题选上还是下？', 'A. 上', 'B. 下',
  ].join('\n'));
  const before = plain(questionList);
  assert.equal(api.importState().diagnostics.stats.single, 3);
  const firstAnswer = ['1. 答案文件复述第一题？', 'A. 甲', 'B. 乙', '答案：A'];
  const fullAnswer = [
    '一、单选题', '2. 答案文件复述第二题？', 'A. 左', 'B. 右', '答案：B', ...firstAnswer,
  ].join('\n');

  const fallback = api.resolveDualAnswerCandidates(questionList, fullAnswer, 'group');
  assert.equal(fallback.answerSourceName, '完整题库解析兜底');
  assert.equal(fallback.candidates[0].score, 120);
  assert.equal(api.importState().diagnostics.stats.single, 2);
  assert.deepEqual(plain(fallback.result.questions.map((question) => question.number)), [1, 2, 3]);
  assert.deepEqual(plain(fallback.result.questions.map((question) => question.answer)), [['A'], ['B'], []]);
  assert.deepEqual(plain(fallback.result.warnings), [
    '部分题目没有按“题型分组 + 题号”匹配到答案，可尝试改用“按顺序对应”或检查分组标题。',
    '数量提示：识别到题目 3 道，答案 2 个。',
    '合并后仍有 1 道题缺少答案。',
  ]);

  const mixedAnswer = ['一、单选题', '2. B', ...firstAnswer, '1. A'].join('\n');
  const mixed = api.resolveDualAnswerCandidates(questionList, mixedAnswer, 'group');
  const hybrid = mixed.candidates.find((candidate) => candidate.key === 'hybrid');
  const entries = hybrid.entries.map(({
    number,
    group,
    answer,
    raw,
  }) => [number, group, answer, raw]);
  assert.deepEqual(plain(entries), [
    ['2', '单选题', ['B'], 'B'],
    ['', '单选题', ['A'], 'A'],
    ['1', '单选题', ['A'], 'A'],
    ['2', '一、单选题', ['B'], '2. B'],
    ['1', '一、单选题', ['A'], '1. A'],
  ]);
  assert.equal(hybrid.detail, '混合提取5条（答案表3 + 答案解析2 + 完整题库1）');
  assert.deepEqual(plain(questionList), before);
});

test('共享材料绑定到两道题，答案和各自选项保持独立', () => {
  const { api } = loadWeb();
  const parsed = api.parseTextQuestions(textFixture('material.txt'));
  assert.equal(parsed.length, 2);
  parsed.forEach((question) => assert.match(question.question, /某学校种植了十棵树，其中六棵为松树，四棵为柏树/));
  assert.match(parsed[0].question, /学校种植了多少棵树/);
  assert.match(parsed[1].question, /松树有多少棵/);
  assert.deepEqual(plain(parsed.map((question) => question.answer)), [['A'], ['B']]);
  assert.deepEqual(
    plain(parsed.map((question) => question.options.map((option) => option.text))),
    [['十棵', '六棵'], ['四棵', '六棵']],
  );
});

test('共享材料已在首题时不重复，后续题仍保留材料及各自答案', () => {
  const { api } = loadWeb();
  const material = '某学校种植了十棵树，其中六棵为松树，四棵为柏树。';
  const source = [
    '根据以下材料，回答1～2题。', material,
    `1. ${material}学校种植了多少棵树？`, 'A. 十棵', 'B. 六棵', '答案：A',
    '2. 松树有多少棵？', 'A. 四棵', 'B. 六棵', '答案：B',
  ].join('\n');
  const parsed = plain(api.parseTextQuestions(source));
  assert.equal(parsed.length, 2);
  for (const question of parsed) { assert.equal(question.question.split(material).length - 1, 1); }
  assert.deepEqual(parsed.map((question) => question.answer), [['A'], ['B']]);
  assert.deepEqual(
    parsed.map((question) => question.options.map((option) => option.text)),
    [['十棵', '六棵'], ['四棵', '六棵']],
  );
});

test('多种解析策略保留同行选项顺序、题号与答案', () => {
  const { api } = loadWeb();
  const source = [
    '单选题',
    '1. 哪个颜色？ A. 红色 B. 蓝色 C. 绿色', '答案：B',
    '2. 哪个数字？ A. 一 B. 二 C. 三', '答案：C',
  ].join('\n');
  for (const strategy of ['standard', 'compact', 'auto']) {
    const questions = plain(api.parseTextQuestions(source, strategy));
    assert.deepEqual(questions.map((question) => String(question.number)), ['1', '2']);
    assert.deepEqual(questions.map((question) => question.answer), [['B'], ['C']]);
    assert.deepEqual(questions.map((question) => question.options.map((option) => option.text)), [
      ['红色', '蓝色', '绿色'], ['一', '二', '三'],
    ]);
  }
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

test('历史错题的文本计数先转为数字再递增，正确复习不改变错误次数', () => {
  const initial = webState();
  initial.wrongBook = { 'bank-a': [{ id: 'same-id', wrongCount: '2', rightCount: '3' }] };
  const { api } = loadWeb({ state: initial });
  api.addWrong('same-id', 'bank-a', ['B']);
  let [entry] = api.getWrongEntries('bank-a');
  assert.equal(entry.wrongCount, 3);
  assert.equal(entry.rightCount, 0);
  api.markRight('same-id', 'bank-a');
  [entry] = api.getWrongEntries('bank-a');
  assert.equal(entry.wrongCount, 3);
  assert.equal(entry.rightCount, 1);
});

test('旧错题字符串和对象在直接读取及状态升级时保留各自的计数默认值', () => {
  const initial = webState();
  initial.wrongBook = {
    'bank-a': ['same-id', { id: 'multiple', rightCount: '2', extension: { keep: true } }],
    'bank-b': [{ id: 'same-id', wrongCount: '0' }],
  };
  const { api } = loadWeb({ state: initial });
  const readCounts = (bankId) => api.getWrongEntries(bankId).map(({ wrongCount }) => wrongCount);

  assert.deepEqual(plain(readCounts('bank-a')), [1, 0]);
  api.upgradeState();
  assert.deepEqual(plain(readCounts('bank-a')), [1, 1]);
  assert.equal(api.snapshot().wrongBook['bank-a'][1].rightCount, 2);
  assert.deepEqual(plain(api.snapshot().wrongBook['bank-a'][1].extension), { keep: true });
  assert.deepEqual(plain(readCounts('bank-b')), [0]);
});

test('练习轮次计数接受文本与 BigInt 时保留原有自增转换', () => {
  const { api } = loadWeb({ state: webState() });
  const question = api.snapshot().banks[0].questions[0];
  const item = { bankId: 'bank-a', question };
  for (const [value, next] of [['2', 3], [2n, 3n]]) {
    api.practiceSession.current = {
      items: [item], idx: 0, answered: value, correct: value, wrong: value, details: [], answerState: {},
    };
    api.recordPracticeAnswer(item, ['A'], true);
    assert.equal(api.practiceSession.current.answered, next);
    assert.equal(api.practiceSession.current.correct, next);
    assert.equal(api.practiceSession.current.wrong, value);
    api.practiceSession.current = {
      items: [item], idx: 0, answered: value, correct: value, wrong: value, details: [], answerState: {},
    };
    api.recordPracticeAnswer(item, ['B'], false);
    assert.equal(api.practiceSession.current.answered, next);
    assert.equal(api.practiceSession.current.correct, value);
    assert.equal(api.practiceSession.current.wrong, next);
  }
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

test('长解析截断后保留跨过边界的完整图片与公式', () => {
  const { api } = loadWeb();
  const formula = '解析公式 $x^2$。';
  const prefix = [formula, '甲'.repeat(199_940), ''].join('\n');
  const image = `![解析图](${IMAGE})`;
  const analysis = `${prefix}${image}${'乙'.repeat(200)}`;
  const input = {
    type: 'short',
    question: '自建简答题',
    answer: ['自建答案'],
    richContent: { analysis: { markdown: analysis } },
  };
  const before = JSON.stringify(input);
  assert(prefix.length < 200_000 && prefix.length + image.length > 200_000);

  const normalized = api.normalizeQuestion(input);

  assert(normalized.analysis.startsWith(`${prefix}${image}`));
  assert(normalized.analysis.length < analysis.length);
  assert.equal(JSON.stringify(input), before);
});

test('跨端导出保持正文图片顺序并去重结构化图片', () => {
  const { api } = loadWeb();
  const first = 'data:image/png;base64,AAAA';
  const second = 'data:image/png;base64,BBBB';
  const extra = 'data:image/png;base64,CCCC';
  const output = api.exportQuestionImagesForCrossExportV83({
    id: 'image-order',
    question: `![甲](${first})\n![乙](${second})`,
    images: [{ dataUrl: first }, { dataUrl: extra, sourceName: '附图', order: 4 }],
  });
  assert.deepEqual(plain(output.images.map((image) => image.order)), [1, 2, 4]);
  assert.deepEqual(plain(output.images.map((image) => image.dataUrl)), [first, second, extra]);
  assert.equal(output.question, '【甲】\n\n【乙】');
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
  const questions = [{
    id: 'x',
    number: 1,
    type: 'judge',
    question: '判断？',
    options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
    answer: [],
  }];
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
