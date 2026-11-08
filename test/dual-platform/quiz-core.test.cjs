'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

test('共享计算脚本在无 DOM、存储和原生能力的环境中加载', () => {
  const context = vm.createContext({});
  runWebScripts(context, ['quiz-core.js']);
  assert.equal(typeof context.ShirohaQuizCore.sameAnswerForQuestion, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(context.ShirohaQuizCore.listPageRange(21, 2, 10))), {
    page: 2, pages: 3, start: 20, end: 21,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.ShirohaQuizCore.listPageNumbers(1, 1))), [1]);
});

test('答案计算模块独立归一化与比较多空，无需页面传入规则', () => {
  const context = vm.createContext({});
  runWebScripts(context, ['quiz-core.js']);
  const api = context.ShirohaQuizCore;
  const question = { type: 'fill_blank', blankAnswers: [['Ａ', 'Ａ', ' 甲 '], ['京']] };
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeBlankAnswersV58914(question.blankAnswers))), [['Ａ', '甲'], ['京']]);
  assert.equal(api.sameAnswerForQuestion(question, ['a', '京'], []), true);
  assert.equal(api.sameAnswerForQuestion(question, ['京', 'a'], []), false);
  assert.equal(api.sameAnswerForQuestion({ type: 'blank' }, [' 北 京。'], ['北京']), true);
});
