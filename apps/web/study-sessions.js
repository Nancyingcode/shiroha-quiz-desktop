// 为练习页和考试页提供各自拥有的轮次状态和取消边界。
(() => {
  'use strict';

  // 弹窗回调仍可读取旧轮次，因此先释放计时器和弹窗，再由调用方切换状态。
  function releasePracticeResources(resources) {
    if (resources.timer !== null) {
      globalThis.clearInterval(resources.timer);
    }

    resources.timer = null;
    if (resources.dialog) {
      resources.dialog.close();
      resources.dialog.remove();
      resources.dialog = null;
    }
  }

  // 练习页通过此会话管理当前轮次，以及随轮次切换释放的资源。
  function createPractice() {
    // 页面重置或更换轮次时使未完成的读取失效，并释放旧轮次的计时器和弹窗。
    let current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0 };
    let request = 0;
    const resources = { timer: null, dialog: null };
    function invalidatePending() {
      // eslint-disable-next-line no-plusplus -- setter 仍接受字符串和 BigInt；限定类型后才能移除此例外。
      request++;
    }

    return {
      invalidatePending,
      get current() {
        return current;
      },

      set current(next) {
        releasePracticeResources(resources);
        invalidatePending();
        current = next;
      },

      get request() {
        return request;
      },

      set request(value) {
        request = value;
      },

      get timer() {
        return resources.timer;
      },

      set timer(value) {
        resources.timer = value;
      },

      get dialog() {
        return resources.dialog;
      },

      set dialog(value) {
        resources.dialog = value;
      },
    };
  }

  // 考试页通过此会话使读题任务和倒计时随考卷切换一起失效。
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
      get current() {
        return current;
      },

      // 保留旧考卷直到其定时器被清理，再使加载中的请求失效。
      set current(next) {
        if (current.timer !== null) {
          globalThis.clearInterval(current.timer);
        }

        invalidatePending();
        current = next;
      },

      get request() {
        return request;
      },

      set request(value) {
        request = value;
      },
    };
  }

  globalThis.ShirohaStudySessions = { createPractice, createExam };
})();
