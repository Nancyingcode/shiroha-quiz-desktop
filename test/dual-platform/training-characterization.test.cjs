'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function training() {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.resolve(__dirname, '../../apps/web/training.js'), 'utf8');
  vm.runInContext(source, context);
  return context.ShirohaTraining;
}

test('时钟保留状态所有权、排除倒退时间并从暂停直接停止', () => {
  const api = training();
  assert.equal(api.elapsedClock(null, 500), 0);
  const running = api.createClock(1000);
  assert.equal(api.elapsedClock(running, 900), 0);
  const paused = api.transitionClock(running, 'paused', 1500);
  assert.equal(running.state, 'running');
  assert.equal(api.elapsedClock(paused, 9000), 500);
  assert.strictEqual(api.transitionClock(paused, 'paused', 9000), paused);
  const stopped = api.transitionClock(paused, 'stopped', 10000);
  assert.equal(api.elapsedClock(stopped, 20000), 500);
  assert.strictEqual(api.transitionClock(stopped, 'running', 21000), stopped);
  assert.equal(api.formatDuration(-1), '00:00');
  assert.equal(api.formatDuration(Number.NaN), '00:00');
});

test('未提交题目的嵌套内容与草稿在复盘创建时各自保存快照', () => {
  const api = training();
  const question = { id: 'q', question: '原题', options: [{ key: 'A', text: '原选项' }], answer: ['A'] };
  const chosen = ['A'];
  const review = api.buildReview([{ bankId: 'a', question, chosen }], [], {});
  question.question = '后来改题';
  question.options[0].text = '后来改选项';
  chosen.push('B');
  const row = api.reviewRows({ review, details: [] })[0];
  assert.equal(row.question.question, '原题');
  assert.equal(row.question.options[0].text, '原选项');
  assert.deepEqual(Array.from(row.draft), ['A']);
  assert.equal(row.status, 'unanswered');
});
