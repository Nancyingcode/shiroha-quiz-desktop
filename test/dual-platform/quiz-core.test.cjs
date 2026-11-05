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
