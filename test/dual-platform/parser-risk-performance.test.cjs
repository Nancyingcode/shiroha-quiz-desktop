'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb } = require('./web-source.cjs');
const { cases } = require('./text-parser-cases.cjs');

for (const [name, text, expected] of [
  ['标准', '1. 首题？\nA. 甲\nB. 乙\n答案：A\n2. 次题？\nA. 丙\nB. 丁\n答案：B', 13],
  ['重复题号', cases[0].text, 13],
  ['共用材料', cases[1].text, 13],
  ['Word 图片与答案', cases[4].text, 4],
]) {
  test(`解析主候选复用已完成的风险计数：${name}`, () => {
    const marker = '    function countLocalRepairWarnings(qs, profile) {';
    const { api, context } = loadWeb({
      deterministicIds: true,
      parserSourceTransform(source) {
        assert.equal(source.split(marker).length, 2);
        return source.replace(marker, `${marker}\n      globalThis.__batch4RiskCount = (globalThis.__batch4RiskCount || 0) + 1;`);
      },
    });
    context.__batch4RiskCount = 0;
    const questions = api.parseTextQuestions(text, 'auto');
    assert(questions.length > 0);
    assert.equal(context.__batch4RiskCount, expected);
  });
}
