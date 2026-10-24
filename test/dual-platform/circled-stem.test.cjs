'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');

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
