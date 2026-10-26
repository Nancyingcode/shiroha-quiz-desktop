'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');

test('旧题中合并进选项的圈号陈述恢复到题干，保留答案且不修改原对象', () => {
  const { api } = loadWeb();
  const statements = ['①有关法律、法规、规章和标准的规定', '②本地区、本部门、本单位的安全生产实际情况', '③应急组织和人员的职责分工明确，并有具体的落实措施', '④有明确的应急保障措施，满足本地区、本部门、本单位的应急工作需要'];
  const combinations = ['①②', '①②③', '②③④', '①②③④'];
  const original = { id: 'legacy-55', type: 'single', question: '应急预案应当符合下列（ ）基本要求。', answer: ['D'], options: statements.map((text, i) => ({ key: 'ABCD'[i], text: text + ' ' + combinations[i] })) };
  const snapshot = structuredClone(original);
  const repaired = api.repairCircledCombinationQuestion(original);
  assert.equal(repaired.question, [original.question, ...statements].join('\n'));
  assert.deepEqual(plain(repaired.options), combinations.map((text, i) => ({ key: 'ABCD'[i], text })));
  assert.equal(repaired.id, original.id);
  assert.deepEqual(plain(repaired.answer), original.answer);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(original.options.map(option => api.displayOptionTextV589(original, option)), combinations);
  assert.deepEqual(plain(api.repairCircledCombinationQuestion(repaired)), plain(repaired));
  for (const options of [
    original.options.map((o, i) => i === 2 ? { ...o, text: '普通选项' } : o),
    original.options.map((o, i) => i === 2 ? { ...o, text: '③说明 ②⑤' } : o),
    original.options.map(o => ({ ...o, text: o.text.replace(/^[①-④]/, '①') })),
  ]) {
    const ambiguous = { ...original, options };
    assert.equal(api.repairCircledCombinationQuestion(ambiguous), ambiguous);
  }
});

for (const strategy of ['auto', 'standard', 'volume', 'compact']) for (const separator of ['；', ';', '\n']) {
  test(`${strategy} 组合题的圈号陈述保留在题干（分隔符 ${JSON.stringify(separator)}）`, () => {
    const { api } = loadWeb();
    const statements = ['①船型', '②尺度', '③主机', '④舵', '⑤船速。'];
    const questions = api.parseTextQuestions([
      '21. 影响船舶在静水中的操纵性的因素包括（ ）。',
      statements.join(separator),
      'A. ①②③④⑤', 'B. ①③⑤', 'C. ①④⑤', 'D. ②③④⑤', '正确答案：A',
    ].join('\n'), strategy);
    assert.equal(questions.length, 1);
    const question = questions[0];
    for (const statement of statements) assert.ok(question.question.includes(statement), question.question);
    assert.deepEqual(plain(question.options), [
      { key: 'A', text: '①②③④⑤' }, { key: 'B', text: '①③⑤' },
      { key: 'C', text: '①④⑤' }, { key: 'D', text: '②③④⑤' },
    ]);
    assert.deepEqual(plain(question.answer), ['A']);
    assert.equal(question.type, 'single');
  });
}

test('无显式字母选项时保留分号选项兼容，解析中的圈号不移入题干', () => {
  const { api } = loadWeb();
  const [unkeyed] = api.parseTextQuestions('1. 请选择（ ）\n①甲；②乙；③丙\n答案：A', 'compact');
  assert.deepEqual(plain(unkeyed.options.map(option => option.text)), ['①甲', '②乙', '③丙']);
  const [question] = api.parseTextQuestions('1. 请选择（ ）\nA. ①②；③\nB. ②③\n答案：A\n解析：①甲；②乙；③丙', 'compact');
  assert.deepEqual(plain(question.options), [{ key: 'A', text: '①②；③' }, { key: 'B', text: '②③' }]);
  assert.ok(!question.question.includes('①甲'));
});
