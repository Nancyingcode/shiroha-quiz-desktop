'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

function dashboardFixture(time) {
  let timestamp = time.getTime();
  let nextTimer = 0;
  let renders = 0;
  const timers = new Map();
  const visibilityListeners = new Set();
  const document = {
    hidden: false,
    addEventListener(event, listener) {
      assert.equal(event, 'visibilitychange');
      visibilityListeners.add(listener);
    },
    removeEventListener(event, listener) {
      assert.equal(event, 'visibilitychange');
      assert(visibilityListeners.delete(listener));
    },
  };
  class FixtureDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [timestamp]));
    }
  }
  const context = vm.createContext({
    Date: FixtureDate,
    document,
    setTimeout(callback, delay) {
      nextTimer += 1;
      timers.set(nextTimer, { callback, time: timestamp + delay });
      return nextTimer;
    },
    clearTimeout(id) {
      assert(timers.delete(id));
    },
  });
  runWebScripts(context, ['ui/i18n-messages.js', 'ui/i18n.js', 'practice-selection.js', 'study/dashboard.js']);
  const state = {
    banks: [{ id: 'a', questions: [{ id: 'question', type: 'single' }] }],
    wrongBook: {},
    records: [],
    ready: true,
  };
  const scopeBanks = () => state.banks;
  const wrongEntries = (bankId) => state.wrongBook[bankId] || [];
  const { dueReviewItems } = context.ShirohaPracticeSelection.create({
    session: {},
    scope: { banks: scopeBanks },
    questions: {
      itemsForBanks: (banks) => banks.flatMap(
        (bank) => bank.questions.map((question) => ({ bankId: bank.id, question })),
      ),
      wrongEntries,
    },
    progress: {},
  });
  const panels = Object.fromEntries([
    'total', 'wrong', 'records', 'today-count', 'today-rate', 'review-due', 'total-practice',
  ].map((name) => [`#stat-${name}`, { textContent: '' }]));
  const button = {
    onclick: null,
    setAttribute(name, value) {
      if (name === 'aria-label') {
        this.label = value;
      }
    },
  };
  const dashboard = context.ShirohaStudyDashboard.create({
    select: (selector) => (selector === '#start-due-review' ? button : panels[selector]),
    data: {
      records: () => {
        renders += 1;
        return state.records;
      },
      scopeBanks,
      wrongEntries,
      dueReviewItems,
    },
    application: { isReady: () => state.ready },
  });
  return {
    dashboard,
    timers,
    visibilityListeners,
    state,
    button,
    count: () => renders,
    stat: (name) => panels[`#stat-${name}`].textContent,
    visibility(hidden) {
      document.hidden = hidden;
      for (const listener of visibilityListeners) {
        listener();
      }
    },
    advanceTo(value) {
      timestamp = value.getTime();
      for (const [id, task] of [...timers]) {
        if (task.time <= timestamp) {
          timers.delete(id);
          task.callback();
        }
      }
    },
  };
}

test('首页重绘和恢复可见始终替换午夜任务，重复绑定与停止不累计监听', () => {
  const f = dashboardFixture(new Date(2026, 10, 17, 12));
  assert.equal(f.timers.size, 0);
  assert.equal(f.visibilityListeners.size, 0);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    f.dashboard.bind();
    f.dashboard.bind();
    assert.equal(typeof f.button.onclick, 'function');
    assert.equal(f.visibilityListeners.size, 1);
    f.dashboard.renderStats();
    f.dashboard.renderStats();
    assert.equal(f.timers.size, 1);
    const count = f.count();
    f.visibility(true);
    f.state.ready = false;
    f.visibility(false);
    assert.equal(f.count(), count);
    f.state.ready = true;
    f.visibility(false);
    assert.equal(f.count(), count + 1);
    assert.equal(f.timers.size, 1);

    f.dashboard.stop();
    f.dashboard.stop();
    assert.equal(f.button.onclick, null);
    assert.equal(f.visibilityListeners.size, 0);
    f.dashboard.renderStats();
    assert.equal(f.timers.size, 0);
  }
});

test('首页午夜任务在实际夏令时切换日按 23 或 25 小时刷新到期队列', (t) => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  t.after(() => {
    if (previousZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousZone;
    }
  });
  const cases = [
    { start: new Date(2026, 2, 8), midnight: new Date(2026, 2, 9), hours: 23 },
    { start: new Date(2026, 10, 1), midnight: new Date(2026, 10, 2), hours: 25 },
  ];
  for (const { start, midnight, hours } of cases) {
    assert.notEqual(start.getTimezoneOffset(), midnight.getTimezoneOffset());
    const f = dashboardFixture(start);
    f.state.wrongBook.a = [{ id: 'question', status: '未掌握', nextReviewAt: midnight.toISOString() }];
    f.dashboard.bind();
    f.dashboard.renderStats();
    assert.equal(f.stat('review-due'), '0');
    assert.equal(f.button.disabled, true);
    const [task] = f.timers.values();
    assert.equal(task.time - start.getTime(), hours * 60 * 60 * 1000);
    f.advanceTo(new Date(midnight.getTime() - 1));
    assert.equal(f.stat('review-due'), '0');
    f.advanceTo(midnight);
    assert.equal(f.stat('review-due'), '1');
    assert.equal(f.button.disabled, false);
    assert.equal(f.button.label, '待复习错题 1 道，开始复习');
    assert.equal(f.timers.size, 1);
    f.dashboard.stop();
  }
});

test('首页区分全部记录和今日练习，保留旧日期及数字字符串的统计语义', () => {
  const current = new Date(2026, 10, 17, 12);
  const earlier = new Date(2026, 10, 16, 23, 59).toISOString();
  const today = new Date(2026, 10, 17, 0, 1).toISOString();
  const f = dashboardFixture(current);
  const previous = { mode: '练习', date: earlier, answered: 99, correct: 99 };
  const exam = { mode: '考试', date: today, answered: 99, correct: 99 };
  f.state.wrongBook.a = [
    { id: 'question', status: '已掌握' },
    { id: 'deleted', status: '未掌握' },
  ];
  f.state.records = [
    { mode: '练习', date: today, answered: '2', correct: '1' },
    { mode: '练习', date: '', answered: '1', correct: '1' },
    { mode: '练习', date: 0, answered: 4, correct: '2' },
    { mode: '练习', answered: null, correct: 0 },
    { mode: '练习', date: 'invalid-date', answered: 99, correct: 99 },
    previous,
    exam,
    null,
  ];
  f.dashboard.renderStats();
  assert.deepEqual(
    ['total', 'wrong', 'review-due', 'records', 'total-practice', 'today-count', 'today-rate'].map(f.stat),
    ['1', '1', '0', '8', '6', '7', '57%'],
  );
  f.state.records = [previous, exam];
  f.state.banks = [];
  f.dashboard.renderStats();
  assert.deepEqual(
    ['total', 'wrong', 'review-due', 'records', 'total-practice', 'today-count', 'today-rate'].map(f.stat),
    ['0', '0', '0', '2', '1', '0', '—'],
  );
});
