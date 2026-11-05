'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

test('答案表与题号匹配脚本不依赖 DOM、存储或原生接口', () => {
  const context = vm.createContext({});
  runWebScripts(context, ['text-answers.js']);
  assert.equal(typeof context.ShirohaTextAnswers.parseAnswerEntries, 'function');
  assert.equal(typeof context.ShirohaTextAnswers.findNumberedAnswer, 'function');
  assert.equal(typeof context.ShirohaTextAnswers.sourceQuestionNumberFromLine, 'function');
  assert.deepEqual(Array.from(context.ShirohaTextAnswers.parseAnswerEntries('', {})), []);
});
