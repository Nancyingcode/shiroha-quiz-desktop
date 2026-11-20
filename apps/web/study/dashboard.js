// 首页按当前学习范围展示统计与到期队列，通过现有练习入口开启复习。
(() => {
  'use strict';

  // 日统计按本地日历日期归类，避免 UTC 跨日偏移。
  function localDateKey(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  // 练习统计按本地日期归档，考试记录不计入首页的今日练习。
  function todayPracticeStats(records, current) {
    const today = localDateKey(current);
    const practiceRecords = records.filter((record) => record && record.mode === '练习');
    const todayPractice = practiceRecords.filter((record) => localDateKey(record.date) === today);
    const todayAnswered = todayPractice.reduce((total, record) => total + Number(record.answered || 0), 0);
    const todayCorrect = todayPractice.reduce((total, record) => total + Number(record.correct || 0), 0);
    return { todayAnswered, todayCorrect, practiceCount: practiceRecords.length };
  }

  function hasUnfinishedPractice(round) {
    return round.items?.length && !round.completed;
  }

  // 应用初始化时绑定当前页面，恢复或启动失败时解除绑定并清理待执行的刷新。
  function create({
    select: $,
    data,
    application,
    practice,
    confirm,
    toast,
  }) {
    const {
      records,
      scopeBanks,
      wrongEntries,
      dueReviewItems,
    } = data;
    // 午夜任务与可见性监听由同一首页实例持有，恢复时由应用调用 stop 释放。
    let bound = false;
    let dueReviewTimer = null;

    function clearDueReviewRefresh() {
      if (dueReviewTimer !== null) {
        clearTimeout(dueReviewTimer);
        dueReviewTimer = null;
      }
    }

    function refreshAtMidnight() {
      dueReviewTimer = null;
      renderStats();
    }

    // 本地零点会改变今日待复习范围，始终只保留下一次刷新任务。
    function scheduleDueReviewRefresh(current) {
      const nextDay = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      clearDueReviewRefresh();
      dueReviewTimer = setTimeout(refreshAtMidnight, Math.max(1, nextDay.getTime() - current.getTime()));
    }

    function setText(id, value) {
      const element = $(id);
      if (element) {
        element.textContent = value;
      }
    }

    // 按当前练习范围和本地日期刷新首页题量、错题及训练摘要。
    function renderStats() {
      const current = new Date();
      const banks = scopeBanks();
      const totalQuestions = banks.reduce((total, bank) => total + (bank.questions || []).length, 0);
      const activeWrongEntries = banks.flatMap((bank) => wrongEntries(bank.id)
        .filter((entry) => entry.status !== '已掌握'));
      const currentRecords = records();
      $('#stat-total').textContent = totalQuestions;
      $('#stat-wrong').textContent = activeWrongEntries.length;
      $('#stat-records').textContent = currentRecords.length;
      const { todayAnswered, todayCorrect, practiceCount } = todayPracticeStats(currentRecords, current);

      setText('#stat-today-count', todayAnswered);
      setText('#stat-today-rate', todayAnswered ? `${Math.round(todayCorrect / todayAnswered * 100)}%` : '—');
      const dueCount = dueReviewItems(undefined, current).length;
      setText('#stat-review-due', dueCount);
      const dueButton = $('#start-due-review');
      if (dueButton) {
        dueButton.disabled = dueCount === 0;
        dueButton.setAttribute('aria-label', `待复习错题 ${dueCount} 道，开始复习`);
      }

      setText('#stat-total-practice', practiceCount);
      if (bound) {
        scheduleDueReviewRefresh(current);
      }
    }

    function canStartFrom(view) {
      return bound && application.isReady() && !application.isBusy() && $(`#${view}`)?.classList.contains('active');
    }

    // 固定今日复习所用的练习条件，沿用已有的选题与起始位置处理。
    function setDueReviewControls() {
      $('#practice-source').value = 'due';
      $('#practice-type').value = 'all';
      $('#practice-order').value = 'sequence';
      $('#practice-submit-mode').value = 'single';
      $('#practice-limit').value = 'all';
      $('#practice-start-mode-v58916').value = practice.fromStart;
      practice.syncStartUi(false);
    }

    // 练习入口可以拒绝或取消开始；原轮仍有效时恢复其专注界面。
    function focusPracticeAfterStart(previous) {
      const current = practice.current();
      if (current !== previous && current.items?.length) {
        $('#practice-card input:not([disabled]), #practice-card textarea:not([disabled]), #p-submit')?.focus();
      } else if (current === previous && hasUnfinishedPractice(previous) && $('#practice')?.classList.contains('active')) {
        practice.enterFocus();
        practice.renderQuestion();
      }
    }

    // 从首页进入今日错题练习，并在确认期间检测页面或轮次是否已变更。
    async function startDueReview() {
      if (!canStartFrom('dashboard')) {
        return;
      }

      if (!dueReviewItems().length) {
        renderStats();
        toast('当前范围暂无待复习错题。', 'warn');
        return;
      }

      const previous = practice.current();
      if (hasUnfinishedPractice(previous)) {
        const accepted = await confirm('当前练习尚未保存为记录，开始今日错题复习会放弃本轮进度。是否继续？');
        if (!accepted || practice.current() !== previous || !canStartFrom('dashboard')) {
          return;
        }
      }

      await application.switchView('practice', false);
      if (!canStartFrom('practice')) {
        return;
      }

      setDueReviewControls();
      await practice.start();
      focusPracticeAfterStart(previous);
    }

    function refreshWhenVisible() {
      if (!document.hidden && application.isReady()) {
        renderStats();
      }
    }

    // 应用初始化与修复都会经过此入口，绑定期间只接收一次可见性事件。
    function bind() {
      if (bound) {
        return;
      }

      const button = $('#start-due-review');
      if (button) {
        button.onclick = startDueReview;
      }

      document.addEventListener('visibilitychange', refreshWhenVisible);
      bound = true;
    }

    // 同文档恢复可能再次初始化页面，停用期间不保留上次运行的任务或点击入口。
    function stop() {
      if (!bound) {
        return;
      }

      clearDueReviewRefresh();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      const button = $('#start-due-review');
      if (button?.onclick === startDueReview) {
        button.onclick = null;
      }

      bound = false;
    }

    return { bind, renderStats, stop };
  }

  globalThis.ShirohaStudyDashboard = { create };
})();
