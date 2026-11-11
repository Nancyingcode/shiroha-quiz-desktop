(() => {
  'use strict';

  function createPractice() {
    // 页面重置或更换轮次时使未完成的读取失效，并释放旧轮次的计时器和弹窗。
    let current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0 };
    let request = 0;
    let timer = null;
    let dialog = null;
    function invalidatePending() {
      // eslint-disable-next-line no-plusplus -- setter 仍接受字符串和 BigInt；限定类型后才能移除此例外。
      request++;
    }
    return {
      invalidatePending,
      get current() { return current; },
      set current(next) {
        if (timer !== null) { globalThis.clearInterval(timer); }
        timer = null;
        if (dialog) {
          dialog.close();
          dialog.remove();
          dialog = null;
        }
        invalidatePending();
        current = next;
      },
      get request() { return request; },
      set request(value) { request = value; },
      get timer() { return timer; },
      set timer(value) { timer = value; },
      get dialog() { return dialog; },
      set dialog(value) { dialog = value; },
    };
  }

  function createExam() {
    // 考卷及倒计时只属于当前轮次；切换考卷后旧读取和定时回调失效。
    let current = { items: [], answers: {}, start: 0, timer: null, deadline: 0, submitted: false };
    let request = 0;
    function invalidatePending() {
      // eslint-disable-next-line no-plusplus -- setter 仍接受字符串和 BigInt；限定类型后才能移除此例外。
      request++;
    }
    return {
      invalidatePending,
      get current() { return current; },
      set current(next) {
        if (current.timer !== null) { globalThis.clearInterval(current.timer); }
        invalidatePending();
        current = next;
      },
      get request() { return request; },
      set request(value) { request = value; },
    };
  }

  globalThis.ShirohaStudySessions = { createPractice, createExam };
})();
