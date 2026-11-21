// 组织练习的出题、作答、专注计时和训练结果，统一接入应用生命周期。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;

  function isPracticeAnswerLocked(answerState) {
    return Boolean(answerState.answered || answerState.revealed);
  }

  // 从应用接入练习范围、会话、评分和保存能力，让单题与总提交共享作答状态。
  function create({
    state,
    session: practiceSession,
    training: ShirohaTraining,
    select: $,
    selectAll: $$,
    escape: esc,
    now,
    makeId,
    toast,
    showNotice,
    selection,
    scope,
    question,
    review,
    favorites,
    ai,
    shell,
    storage,
  }) {
    const {
      readCount: readCustomCountV60,
      syncLimit: syncLimitControlV60,
      build: buildPracticeSelectionV58916,
      updateProgress: updatePracticeProgressV58916,
      syncStart: syncPracticeStartUiV58916,
    } = selection;
    const {
      current: practiceScopeV8916,
      normalize: normalizePracticeScopeV8916,
      label: practiceScopeLabelV8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      fromStart: PRACTICE_START_FROM_V58916,
      continueMode: PRACTICE_START_CONTINUE_V58916,
      custom: PRACTICE_START_CUSTOM_V58916,
      setBank: setPracticeBankScopeV8916,
      render: renderPracticeScopeUiV8916,
      activeBank,
    } = scope;
    const {
      current: currentPracticeItemV8916,
      question: practiceQuestionV8916,
      key: practiceItemKeyV8916,
      bankId: practiceItemBankIdV8916,
      bankName: practiceItemBankNameV8916,
      hasAnswer: hasAnswerValueV58914,
      sameAnswer: sameAnswerForQuestion,
      isTextType,
      isMultiBlank: isMultiBlankQuestionV58914,
      blankUserAnswers: blankUserAnswersFromDetailV58914,
      multiBlankComparison: renderMultiBlankComparisonV58914,
      reviewAnswer: practiceReviewAnswerHtml,
      body: renderQuestionBodyV83,
      reviewOptions: renderReviewOptions,
      reviewSummary: renderReviewAnswerSummary,
      typeLabel: practiceTypeLabel,
      html: questionHtml,
      applyAnswer: applyAnswerStateV26,
      collectAnswer,
      bindOptions: bindAnswerOptionControls,
      refreshOptions: refreshAnswerOptionControls,
      canEditOptions: canEditPracticeOptions,
      markOptions,
      content: renderQuestionContent,
      feedback: feedbackAnswerHtmlV58914,
      score: scoreOf,
      detail: makeAnswerDetail,
      addWrong,
      markRight,
    } = question;
    const {
      items: trainingSessionItems,
      data: buildTrainingReview,
      open: openTrainingReview,
      page: nativePage,
      analysis: renderReviewAnalysis,
      updatePanels: updateReviewAnalysisPanels,
    } = review;
    const { isFavorite: isFavoriteV27, toggle: toggleFavoriteV27 } = favorites;
    const { reset: resetAiSinglePracticeV613, render: renderPracticeAiPanelV613 } = ai;
    const {
      collapse: autoCollapseSidebarForFocusV47,
      restore: restoreSidebarAfterFocusV47,
      update: updateShellLayoutByView,
      bindRail: bindFocusRailToggleV34,
      prewarmMath: prewarmMathJaxV56,
      editQuestion: openPracticeEditQuestionV120,
      closeBankDetail: closeBankQuestionDetail,
      renderAll,
      renderStats,
    } = shell;
    const {
      loadItems: loadNativeItems,
      isBusy: isMutationBusy,
      isReady: isApplicationReady,
      transaction: runMutation,
      save: saveSilent,
    } = storage;
    // 运行计时器和复盘视图仅归当前页面；换轮/重置释放计时器，离开复盘后释放快照引用。
    const PRACTICE_CLOCK_REFRESH_MS = 250;
    let lifecycleBound = false;
    // 只绑定一次页面可见性生命周期，后台停留不继续计入专注练习时间。
    function bindPracticeClockLifecycle() {
      if (lifecycleBound) {
        return;
      }

      lifecycleBound = true;
      document.addEventListener('visibilitychange', /* 页面隐藏时暂停；恢复显示时按当前练习状态决定是否提示继续。 */ () => {
        if (document.hidden) {
          pausePracticeClock(false);
        } else {
          showPracticePause();
        }
      });

      window.addEventListener('focus', showPracticePause);
      // WebView2 最小化/恢复不总派发可见性事件；仅补显已暂停状态，待这些路径稳定派发后可移除补显监听。
      window.addEventListener('shiroha:practice-hidden', () => pausePracticeClock());

      window.addEventListener('resize', showPracticePause);
    }

    // 更换练习前释放当前轮次的 AI 会话、计时资源和专注布局。
    function resetPractice() {
      resetAiSinglePracticeV613();
      exitPracticeFocus();
      renderPracticeEmpty();
      practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0 };
      syncPracticeStartUiV58916(true);
    }

    function renderPracticeEmpty(key = 'practice.empty') {
      $('#practice-card').innerHTML = `<div class="empty">${i18n.html(key)}</div>`;
      i18n.bindText($('#practice-progress'), 'practice.progress', { current: 0, total: 0 });
    }

    // 暂停、离开或切题前收集当前可编辑控件里的作答草稿。
    function capturePracticeDraft() {
      const item = currentPracticeItemV8916();
      if (!item || practiceSession.current.completed) {
        return;
      }

      const key = practiceItemKeyV8916(item); const st = getPracticeAnswerStateV26(key);
      if (!isPracticeAnswerLocked(st) && !practiceSession.current.totalLocked && $('#practice-card .question-title')) {
        setPracticeAnswerStateV26(key, { chosen: collectAnswer('#practice-card', practiceQuestionV8916(item)) });
      }
    }

    function clearPracticeClockTimer() {
      if (practiceSession.timer !== null) {
        globalThis.clearInterval(practiceSession.timer);
      }

      practiceSession.timer = null;
    }

    // 清理当前计时器和暂停对话框，使旧轮次无法更新另一轮界面。
    function disposePracticeClock() {
      clearPracticeClockTimer();
      if (practiceSession.dialog) {
        practiceSession.dialog.close();
        practiceSession.dialog.remove();
        practiceSession.dialog = null;
      }
    }

    function updatePracticeClock() {
      const elapsed = ShirohaTraining.elapsedClock(practiceSession.current.clock, globalThis.performance.now()); const node = $('#p-clock');
      if (node) {
        node.textContent = ShirohaTraining.formatDuration(elapsed / 1000);
      }
    }

    // 只在专注计时运行时启动可更新界面的滴答，切换轮次后旧定时器自行取消。
    function startPracticeClockTicker() {
      clearPracticeClockTimer();
      if (practiceSession.current.clock?.state === 'running') {
        const owner = practiceSession.current;
        const timer = globalThis.setInterval(/* 滴答检查捕获的轮次身份，旧回调不再刷新新题的计时显示。 */ () => {
          if (practiceSession.current !== owner) {
            globalThis.clearInterval(timer);
            return;
          }

          updatePracticeClock();
        }, PRACTICE_CLOCK_REFRESH_MS);
        practiceSession.timer = timer;
      }

      updatePracticeClock();
    }

    // 继续前确认还是捕获的可见轮次，再撤掉暂停对话框并恢复计时。
    function resumePausedPractice(owner, dialog) {
      if (practiceSession.current !== owner || document.hidden) {
        return;
      }

      dialog.close();
      dialog.remove();
      practiceSession.dialog = null;
      owner.clock = ShirohaTraining.transitionClock(owner.clock, 'running', globalThis.performance.now());
      refreshAnswerOptionControls();
      startPracticeClockTicker();
      $('#p-pause')?.focus({ preventScroll: true });
    }

    // 仅在当前练习可见且不存在冲突对话框时展示暂停遮罩。
    function showPracticePause() {
      if (practiceSession.dialog || practiceSession.current.clock?.state !== 'paused' || !$('#practice.active') || document.hidden || $('#app-dialog[open]')) {
        return;
      }

      const owner = practiceSession.current; const dialog = document.createElement('dialog');
      practiceSession.dialog = dialog;
      dialog.id = 'practice-pause-dialog';
      dialog.className = 'practice-pause-dialog';
      dialog.setAttribute('aria-labelledby', 'practice-pause-title');
      const elapsed = ShirohaTraining.elapsedClock(owner.clock, globalThis.performance.now()) / 1000;
      dialog.innerHTML = `<h2 id="practice-pause-title">${i18n.html('practice.paused')}</h2>
        <p>${i18n.html('practice.pauseInfo')}</p>
        <strong id="practice-pause-time">${ShirohaTraining.formatDuration(elapsed)}</strong>
        <button type="button" class="primary" id="practice-resume">${i18n.html('practice.resume')}</button>`;
      const resume = () => resumePausedPractice(owner, dialog);

      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        resume();
      });

      dialog.addEventListener('keydown', /* 临时接管暂停对话框的键盘事件，使快捷键和焦点不会泄漏到答题区。 */ (event) => {
        event.stopPropagation();
        if (event.key === 'Tab') {
          event.preventDefault();
          $('#practice-resume').focus();
        }
      });

      dialog.querySelector('button').onclick = resume;
      document.body.appendChild(dialog);
      dialog.showModal();
      dialog.querySelector('button').focus();
    }

    // 暂停前保留当前作答，并根据页面调用场景选择是否立即显示继续提示。
    function pausePracticeClock(show = true) {
      if (!practiceSession.current.clock || practiceSession.current.clock.state === 'stopped') {
        return;
      }

      capturePracticeDraft();
      practiceSession.current.clock = ShirohaTraining.transitionClock(practiceSession.current.clock, 'paused', globalThis.performance.now());
      clearPracticeClockTimer();
      updatePracticeClock();
      if (show) {
        showPracticePause();
      }
    }

    function freezePracticeInputs() {
      if (practiceSession.current.clock?.state === 'stopped') {
        $$('#practice-card input,#practice-card textarea,#p-submit,#p-reveal').forEach((node) => {
          node.disabled = true;
        });
      }
    }

    // 完成练习时保存最后一题草稿并固定实际专注用时。
    function stopPracticeClock() {
      capturePracticeDraft();
      practiceSession.current.clock = ShirohaTraining.transitionClock(practiceSession.current.clock, 'stopped', globalThis.performance.now());
      disposePracticeClock();
      freezePracticeInputs();
      refreshAnswerOptionControls();
      updatePracticeClock();
    }

    // 在练习标题中装配计时与暂停入口，复用当前轮次的时间状态。
    function mountPracticeClock() {
      const head = $('#practice-card .practice-focus-head');
      if (!head || !practiceSession.current.clock) {
        return;
      }

      const timerLabel = i18n.attribute('aria-label', 'practice.elapsedLabel');
      const disabled = practiceSession.current.clock.state === 'stopped' ? 'disabled' : '';
      head.insertAdjacentHTML('beforeend', `<div class="practice-clock"><span>${i18n.html('practice.elapsed')}
        <b id="p-clock" role="timer" ${timerLabel} aria-live="off"></b></span>
        <button type="button" class="ghost mini-btn" id="p-pause" ${disabled}>${i18n.html('practice.pause')}</button></div>`);
      $('#p-pause').onclick = () => pausePracticeClock();

      freezePracticeInputs();
      updatePracticeClock();
      if (practiceSession.current.clock.state === 'paused') {
        showPracticePause();
      }
    }

    // 练习只调整对话框文案，焦点约束和取消仍由共享对话框处理。
    function confirm(message, options) {
      return globalThis.ShirohaDialogs.confirm(message, {
        title: i18n.text('dialog.confirm'),
        acceptLabel: i18n.text('dialog.accept'),
        cancelLabel: i18n.text('dialog.cancel'),
        closeLabel: i18n.text('dialog.close'),
        ...options,
      });
    }

    // 确认操作期间暂停计时，取消确认后只恢复仍活动的同一轮。
    async function confirmPracticeAction(message, options) {
      const owner = practiceSession.current; const wasRunning = owner.clock?.state === 'running';
      pausePracticeClock(false);
      const accepted = await confirm(message, options);
      if (!accepted && practiceSession.current === owner && wasRunning && !document.hidden) {
        owner.clock = ShirohaTraining.transitionClock(owner.clock, 'running', globalThis.performance.now());
        startPracticeClockTicker();
      }

      return accepted && practiceSession.current === owner;
    }

    function practiceReviewItems() {
      return (practiceSession.current.reviewItems || trainingSessionItems(practiceSession.current.items)).map((item, index) => {
        const answer = getPracticeAnswerStateV26(practiceItemKeyV8916(practiceSession.current.items[index]));
        return { ...item, chosen: answer.chosen || [], revealed: answer.revealed };
      });
    }

    // 使用错题专用题量设置进入练习，并保留当前错题来源。
    function startWrongPractice() {
      const limit = $('#wrong-practice-limit')?.value || 'custom';
      const customCount = readCustomCountV60('#wrong-practice-custom-count', 20);
      $$('.nav').forEach((b) => b.classList.remove('active'));

      document.querySelector('[data-view="practice"]').classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));

      $('#practice').classList.add('active');
      $('#page-title').textContent = i18n.text('nav.practice');
      $('#practice-source').value = 'wrong';
      $('#practice-order').value = 'random';
      $('#practice-limit').value = limit;
      if ($('#practice-custom-count')) {
        $('#practice-custom-count').value = customCount;
      }

      openQuickPracticeSetup();
    }

    // 首次进入专注练习时记录导航变化；连续开始下一轮仍复用专注会话。
    function enterPracticeFocus() {
      // 连续再练仍属于同一次沉浸会话，保留退出时恢复导航的标记。
      if (document.body.classList.contains('practice-focus')) {
        return;
      }

      document.body.classList.add('practice-focus');
      autoCollapseSidebarForFocusV47();
    }

    function exitPracticeFocus() {
      pausePracticeClock(false);
      document.body.classList.remove('practice-focus', 'practice-rail-collapsed-v34');
      restoreSidebarAfterFocusV47();
    }

    function practiceWrongRows(record) {
      return (record.details || []).map((detail, index) => ({ detail, index })).filter(({ detail }) => !detail.correct);
    }

    // 渲染本轮错题的历史答案和选项，快照缺少 ID 时使用明细中的题目身份。
    function renderPracticeWrongRows(record, items) {
      return items.map(/* 复用完成时的题目快照和作答，翻译不依赖当前题库。 */ ({ detail, index }) => {
        const snapshot = detail.nativeQuestion || detail;
        const q = snapshot.id ? snapshot : { ...snapshot, id: detail.questionId || '' };
        const chosen = blankUserAnswersFromDetailV58914(detail);
        const answer = detail.answer || q.answer || [];
        const referenceLabel = q.type === 'short' ? 'question.referenceSelf' : 'question.correctAnswerLabel';
        const reference = hasAnswerValueV58914(answer) ? practiceReviewAnswerHtml(q, answer, true) : i18n.html('question.noBankAnswer');
        const comparison = isMultiBlankQuestionV58914(q)
          ? renderMultiBlankComparisonV58914(q.blankAnswers, chosen, true, true)
          : `<div class="q-multiline-text"><b>${i18n.html('question.userAnswer')}</b>${practiceReviewAnswerHtml(q, chosen, true)}</div>
            <div class="q-multiline-text"><b>${i18n.html(referenceLabel)}</b>${reference}</div>`;
        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        const analysis = renderReviewAnalysis({ bankId: detail.sourceBankId || record.bankId || '', question: q }, chosen, 'result:' + record.id + ':' + index);
        return `<article class="exam-q" data-wrong-question-index="${index}">
          <div class="qmeta"><b>${i18n.html('practice.overviewPosition', { number: index + 1 })}</b>
            <span class="pill">${practiceTypeLabel(q.type)}</span><span>${esc(detail.sourceBankName || record.bankName || '')}</span></div>
          <div class="question-title">${renderQuestionBodyV83(q)}</div>
          ${renderReviewOptions({ ...q, answer }, chosen, true)}
          ${isTextType(q.type) ? `<div class="feedback bad">${comparison}</div>` : renderReviewAnswerSummary({ ...q, answer }, chosen, '未作答', true)}
          ${analysis}</article>`;
      }).join('');
    }

    // 按已保存的错误数呈现概览，分页读取时仍显示全量计数。
    function renderPracticeWrongOverview(record, items = practiceWrongRows(record)) {
      const wrong = practiceWrongRows(record);
      const label = i18n.attribute('aria-label', 'practice.wrongOverview');
      const rows = wrong.length ? renderPracticeWrongRows(record, items) : `<div class="notice ok">${i18n.html('practice.noMistakes')}</div>`;
      return `<section id="p-wrong-overview" ${label}><h3>${i18n.html('practice.wrongHeading', { count: wrong.length })}</h3>
        <div id="p-wrong-overview-list" ${label}>${rows}</div></section>`;
    }

    // 对本轮错题列表分页，重绘只涉及当前可见的错题明细。
    function renderPracticeWrongPage(record) {
      const target = document.getElementById('p-wrong-overview-list'); const wrong = practiceWrongRows(record);
      if (!target || !wrong.length) {
        return;
      }

      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      const rows = nativePage(wrong, 'practice-wrong:' + record.id, target, () => renderPracticeWrongPage(record), '本轮错题一览');
      target.innerHTML = renderPracticeWrongRows(record, rows);
      updateReviewAnalysisPanels();
    }

    function hasUnfinishedTotalPractice() {
      return practiceSession.current.submitMode === 'total'
        && (!practiceSession.current.totalLocked || practiceSession.current.answered !== practiceSession.current.items.length);
    }

    // 成绩已经保存，结果区只读取该记录，让语言切换无需再次提交或评分。
    function renderPracticeResult(record, completion) {
      const metrics = [
        ['practice.answered', i18n.number(record.answered)],
        ['practice.correct', i18n.number(record.correct)],
        ['practice.incorrect', i18n.number(record.wrong)],
        ['practice.accuracy', i18n.percent(record.accuracy)],
      ].map(([key, value]) => `<div class="metric"><span>${i18n.html(key)}</span><b>${value}</b></div>`).join('');
      const summary = i18n.html('practice.resultSummary', {
        unanswered: record.reviewSummary.unanswered,
        duration: ShirohaTraining.formatDuration(record.duration),
      });
      const card = $('#practice-card');
      card.innerHTML = `<div class="score-card">${metrics}</div>
        <p class="training-result-summary">${i18n.html(completion)} · ${summary}</p>
        <div class="actions training-result-actions">
          <button type="button" class="primary" id="practice-review-result">${i18n.html('practice.review')}</button></div>
        <div class="notice ok">${i18n.html(completion)}${i18n.html('practice.resultSaved')}</div>
        <div class="actions"><button class="primary" id="back-practice-setup">${i18n.html('practice.back')}</button>
          <button class="ghost" id="again-practice">${i18n.html('practice.again')}</button></div>`;
      if (practiceSession.current.submitMode === 'total') {
        card.insertAdjacentHTML('beforeend', renderPracticeWrongOverview(record, []));
        renderPracticeWrongPage(record);
      }

      $('#practice-review-result').onclick = () => openTrainingReview(record.id, 'practice');

      $('#back-practice-setup').onclick = () => exitPracticeFocus();

      $('#again-practice').onclick = () => startPractice();
    }

    // 完成时固化当前训练记录和结果；仍有未提交总提交草稿时先保留本轮。
    async function finishPractice(exited = false) {
      if (hasUnfinishedTotalPractice()) {
        return;
      }

      stopPracticeClock();
      return runMutation(/* 在保存事务中再次确认练习尚未计入记录，并以完成时的快照生成复盘。 */ async () => {
        if (practiceSession.current.completed || !practiceSession.current.items.length) {
          return;
        }

        if (hasUnfinishedTotalPractice()) {
          return;
        }

        const total = practiceSession.current.answered;
        const groupMode = practiceSession.current.scopeType === 'GROUP';
        const rec = {
          id: makeId('rec', 'practice'),
          mode: '练习',
          bankId: groupMode ? '' : (practiceSession.current.items[0]?.bankId || activeBank().id),
          bankName: groupMode ? (practiceSession.current.scopeName || '分组练习') : (practiceSession.current.items[0]?.bankName || activeBank().name),
          scopeType: practiceSession.current.scopeType || 'BANK',
          scopeName: practiceSession.current.scopeName || practiceItemBankNameV8916(practiceSession.current.items[0]),
          total: practiceSession.current.items.length,
          answered: total,
          correct: practiceSession.current.correct,
          wrong: practiceSession.current.wrong,
          accuracy: total ? Math.round(practiceSession.current.correct / total * 100) : 0,
          score: null,
          date: now(),
          duration: Math.round((Date.now() - practiceSession.current.start) / 1000),
          details: practiceSession.current.details || [],
        };
        rec.duration = Math.round(ShirohaTraining.elapsedClock(practiceSession.current.clock, globalThis.performance.now()) / 1000);
        Object.assign(rec, buildTrainingReview(practiceReviewItems(), rec.details, {
          completion: total < practiceSession.current.items.length ? 'ended_early' : 'completed',
          submitMode: practiceSession.current.submitMode || 'single',
          timing: 'active',
        }));
        state.records.unshift(rec);
        updatePracticeProgressV58916();
        await saveSilent();
        practiceSession.current.completed = true;
        resetAiSinglePracticeV613();
        if (exited) {
          exitPracticeFocus();
        }

        const completion = rec.reviewSummary.completion === 'ended_early' ? 'practice.endedEarly' : 'practice.completed';
        renderPracticeResult(rec, completion);
        showNotice(i18n.text(completion), i18n.text('practice.resultNotice', {
          count: total, accuracy: i18n.percent(rec.accuracy),
        }), 'ok');
        renderAll();
      });
    }

    // 从选题结果建立独立轮次，保留原选题范围和稳定的续练索引。
    function createPracticeRound(selection, scope, source, type, order) {
      return {
        items: selection.items,
        idx: 0,
        answered: 0,
        correct: 0,
        wrong: 0,
        start: Date.now(),
        details: [],
        answerState: {},
        scopeType: scope.type === PRACTICE_SCOPE_GROUP_V8916 ? 'GROUP' : 'BANK',
        scopeName: practiceScopeLabelV8916(scope),
        scopeValue: scope.value,
        source,
        type,
        order,
        startMode: selection.startMode,
        startIndex: selection.startIndex,
        progressKey: selection.progressKey,
        baseItemKeys: selection.baseItems.map(practiceItemKeyV8916),
      };
    }

    // 读取选题后检查启动请求仍有效，再切换到新轮次和计时器。
    async function startPractice(scopeOverrideV8916) {
      // eslint-disable-next-line no-plusplus -- setter 仍接受字符串和 BigInt；限定类型后才能移除此例外。
      const request = ++practiceSession.request;
      const isCurrentStart = () => request === practiceSession.request && isApplicationReady() && !isMutationBusy()
        && $('#practice')?.classList.contains('active');

      if (!isCurrentStart()) {
        return;
      }

      const overrideType = String((scopeOverrideV8916 && scopeOverrideV8916.type) || '').toLowerCase();
      const override = [PRACTICE_SCOPE_BANK_V8916, PRACTICE_SCOPE_GROUP_V8916].includes(overrideType) ? normalizePracticeScopeV8916(scopeOverrideV8916) : null;
      const limit = $('#practice-limit')?.value || 'custom';
      const customCount = readCustomCountV60('#practice-custom-count', 20);
      syncLimitControlV60('practice');
      const scope = override || practiceScopeV8916();
      const source = $('#practice-source')?.value || 'all';
      const type = $('#practice-type')?.value || 'all';
      const order = $('#practice-order')?.value || 'sequence';
      const selection = buildPracticeSelectionV58916(scope, source, type, order, limit, customCount);
      if (selection.error) {
        const values = { detail: selection.error };
        $('#practice-card').innerHTML = `<div class="empty">${i18n.html('practice.invalidRange', values)}</div>`;
        showNotice(i18n.text('practice.cannotStart'), i18n.text('practice.invalidRange', values), 'warn');
        return;
      }

      if (!selection.items.length) {
        $('#practice-card').innerHTML = `<div class="empty">${i18n.html('practice.noQuestions')}</div>`;
        showNotice(i18n.text('practice.cannotStart'), i18n.text('practice.noQuestions'), 'warn');
        return;
      }

      const previous = practiceSession.current;
      const needsLargeRoundConfirmation = selection.items.length > 200 && (limit === 'all' || limit === 'half' || limit === 'custom' || Number(limit) > 200 || selection.startMode === PRACTICE_START_CUSTOM_V58916);
      if (needsLargeRoundConfirmation) {
        const count = selection.items.length;
        const key = count > 500 ? 'practice.largeRound' : 'practice.largeRoundMobile';
        const accepted = await confirm(i18n.text(key, { count }));
        if (!accepted || practiceSession.current !== previous || !isCurrentStart()) {
          return;
        }
      }

      if (!await loadNativeItems(selection.items, isCurrentStart) || !isCurrentStart()) {
        return;
      }

      disposePracticeClock();
      resetAiSinglePracticeV613();
      practiceSession.current = createPracticeRound(selection, scope, source, type, order);
      practiceSession.current.submitMode = $('#practice-submit-mode')?.value === 'total' ? 'total' : 'single';
      let startText = '';
      if (selection.startMode === PRACTICE_START_CONTINUE_V58916) {
        startText = ` · ${i18n.text('practice.startedAt', { number: selection.startIndex + 1 })}`;
      } else if (selection.startMode === PRACTICE_START_CUSTOM_V58916) {
        startText = ` · ${i18n.text('practice.customRange')}`;
      }

      practiceSession.current.reviewItems = trainingSessionItems(practiceSession.current.items);
      enterPracticeFocus();
      prewarmMathJaxV56();
      const countText = i18n.text('practice.startedCount', { count: practiceSession.current.items.length });
      showNotice(i18n.text('practice.started'), `${practiceSession.current.scopeName}${startText} · ${countText}`, 'ok');
      renderPracticeQuestion();
      practiceSession.current.clock = ShirohaTraining.createClock(globalThis.performance.now());
      mountPracticeClock();
      startPracticeClockTicker();
    }

    function totalPracticeFilledCount() {
      return practiceSession.current.items.filter((item) => hasAnswerValueV58914(getPracticeAnswerStateV26(practiceItemKeyV8916(item)).chosen)).length;
    }

    // 离开前保护未提交的总提交草稿，已锁定进入自评时保持当前页面。
    async function canLeaveTotalPractice(target) {
      if (practiceSession.current.submitMode !== 'total' || practiceSession.current.completed) {
        return true;
      }

      if (target === 'ai-settings') {
        return true;
      }

      if (practiceSession.current.totalLocked) {
        toast(i18n.text('practice.completeSelfFirst'), 'warn', i18n.text('shell.done'));
        return false;
      }

      if (totalPracticeFilledCount() > 0 && !await confirmPracticeAction(i18n.text('practice.totalLeave'))) {
        return false;
      }

      disposePracticeClock();
      resetAiSinglePracticeV613();
      practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0, details: [], answerState: {} };
      renderPracticeEmpty();
      return true;
    }

    function hasCompletedPracticeSelfAssessment(answerState) {
      const { selfCorrect } = answerState;
      return selfCorrect === true || selfCorrect === false;
    }

    // 仅对已填写的简答题请求自评，避免空答案进入评分确认。
    function needsPracticeSelfAssessment(question, answerState) {
      const isAnsweredShortQuestion = question.type === 'short' && hasAnswerValueV58914(answerState.chosen);
      if (!isAnsweredShortQuestion) {
        return false;
      }

      return !hasCompletedPracticeSelfAssessment(answerState);
    }

    function totalPracticePendingSelfIndex() {
      return practiceSession.current.items.findIndex((item) => {
        const answerState = getPracticeAnswerStateV26(practiceItemKeyV8916(item));
        return needsPracticeSelfAssessment(practiceQuestionV8916(item), answerState);
      });
    }

    function totalPracticeCounts() {
      const filled = totalPracticeFilledCount();
      const total = practiceSession.current.items.length;
      return { total, filled, remaining: total - filled };
    }

    function totalPracticeStatusHtml(locked = false) {
      const details = i18n.html('practice.totalStatus', totalPracticeCounts());
      return `${details} · ${i18n.html(locked ? 'practice.totalLocked' : 'practice.totalEditable')}`;
    }

    // 两种作答模式只改变本轮标题和工具的可用性，题号与操作名使用共用词条。
    function renderPracticeHeader(favorite, { total = false, locked = false } = {}) {
      let key = 'nav.practice';
      if (total) {
        key = 'practice.totalRound';
      } else if (practiceSession.current.scopeType === 'GROUP') {
        key = 'practice.groupRound';
      }

      const title = i18n.html(key, { name: practiceSession.current.scopeName || '' });
      const progress = i18n.html('practice.position', {
        current: practiceSession.current.idx + 1, total: practiceSession.current.items.length,
      });
      const editState = total ? `disabled ${i18n.attribute('title', 'practice.editLater')}` : '';
      return `<div class="practice-focus-head"><b>${title}</b><span class="practice-round-progress">${progress}</span>
        <div class="practice-tools-v26">
          <button class="ghost mini-btn" id="p-favorite">${i18n.html(favorite ? 'practice.unfavorite' : 'practice.favorite')}</button>
          <button class="ghost mini-btn" id="p-edit-v120" ${editState}>${i18n.html('practice.edit')}</button>
          <button class="ghost mini-btn" id="p-exit" ${locked ? 'disabled' : ''}>${i18n.html('practice.exit')}</button>
        </div></div>`;
    }

    // 总提交答题卡只反映是否填写，不在统一提交前泄露判定结果。
    function renderTotalPracticeNav() {
      const buttons = practiceSession.current.items.map(/* 用可访问名称说明填写状态，避免只靠图标传达。 */ (item, index) => {
        const filled = hasAnswerValueV58914(getPracticeAnswerStateV26(practiceItemKeyV8916(item)).chosen);
        const label = i18n.attribute('aria-label', filled ? 'practice.navFilled' : 'practice.navEmpty', {
          number: index + 1,
        });
        const current = index === practiceSession.current.idx ? 'current' : '';
        const disabled = practiceSession.current.totalLocked ? 'disabled' : '';
        return `<button type="button" class="${current}" data-practice-jump="${index}" ${label} ${disabled}>${i18n.number(index + 1)}${filled ? ' ✓' : ' ○'}</button>`;
      }).join('');
      return `<div id="practice-nav-v26" class="practice-nav-v26"><b>${i18n.html('practice.navLegend')}</b>
        <div class="practice-nav-grid-v26">${buttons}</div></div>`;
    }

    // 渲染总提交练习的当前题、草稿和导航，并保持已锁定作答不可编辑。
    function renderTotalPracticeQuestion() {
      const item = currentPracticeItemV8916();
      if (!item) {
        return;
      }

      const q = practiceQuestionV8916(item);
      const key = practiceItemKeyV8916(item);
      const st = getPracticeAnswerStateV26(key);
      const locked = !!practiceSession.current.totalLocked;
      const { idx, items } = practiceSession.current;
      i18n.bindText($('#practice-progress'), 'practice.progress', { current: idx + 1, total: items.length });
      const header = renderPracticeHeader(isFavoriteV27(q.id, practiceItemBankIdV8916(item)), { total: true, locked });
      const prevDisabled = locked || idx === 0;
      const nextDisabled = locked || idx === items.length - 1;
      $('#practice-card').innerHTML = `${header}${questionHtml(q, false, 0, item)}
        <div class="actions practice-actions-v44">
          <button class="ghost" id="p-prev" ${prevDisabled ? 'disabled' : ''}>${i18n.html('practice.prev')}</button>
          <button class="ghost" id="p-next" ${nextDisabled ? 'disabled' : ''}>${i18n.html('practice.next')}</button>
          <button class="primary" id="p-submit-all">${i18n.html(locked ? 'practice.continueSubmit' : 'practice.submitAll')}</button>
        </div><p id="p-total-status" role="status">${totalPracticeStatusHtml(locked)}</p>
        <div id="p-feedback" role="status"></div><div id="p-ai-v613"></div>${renderTotalPracticeNav()}`;
      applyAnswerStateV26('#practice-card', q, st.chosen || []);
      const session = practiceSession.current;
      const marker = $('#practice-card .question-title');
      const canEdit = () => canEditPracticeOptions(session, key) && marker?.isConnected
        && $('#practice-card')?.contains(marker);

      // 仅在当前轮次及题目仍可写时将输入收集到总提交草稿。
      const capture = () => {
        if (!canEdit()) {
          return;
        }

        setPracticeAnswerStateV26(key, { chosen: collectAnswer('#practice-card', q) });
        $('#p-total-status').innerHTML = totalPracticeStatusHtml();
        $('#practice-nav-v26').outerHTML = renderTotalPracticeNav();
        bindPracticeNavV30();
      };

      bindAnswerOptionControls('#practice-card', q, practiceSession.current.idx + 1, canEdit, capture);
      // 草稿属于本轮，不写入学习记录；输入时采集可覆盖切题、收藏重绘和键盘操作。
      $$('#practice-card .text-answer').forEach((input) => {
        input.disabled = locked;
        if (!locked) {
          input.addEventListener('input', capture);
        }
      });

      $('#p-favorite').onclick = async () => {
        if (await toggleFavoriteV27(q.id, practiceItemBankIdV8916(item))) {
          renderPracticeQuestion();
        }
      };

      $('#p-prev').onclick = () => {
        // eslint-disable-next-line no-plusplus -- 轮次状态可由调用方替换，保留字符串和 BigInt 的转换；限定字段类型后移除此例外。
        practiceSession.current.idx--;
        renderPracticeQuestion();
      };

      $('#p-next').onclick = () => {
        // eslint-disable-next-line no-plusplus -- 轮次状态可由调用方替换，保留字符串和 BigInt 的转换；限定字段类型后移除此例外。
        practiceSession.current.idx++;
        renderPracticeQuestion();
      };

      $('#p-submit-all').onclick = submitTotalPractice;
      $('#p-exit').onclick = /* 退出确认跨越异步操作，确认前保留本轮未提交的作答。 */ async () => {
        if (!await confirmPracticeAction(i18n.text('practice.totalExit'))) {
          return;
        }

        disposePracticeClock();
        resetAiSinglePracticeV613();
        practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0, details: [], answerState: {} };
        exitPracticeFocus();
        renderPracticeEmpty();
        $('#start-practice-btn').focus();
      };

      bindPracticeNavV30();
      bindPracticeHotkeysV44();
      mountPracticeClock();
      renderPracticeAiPanelV613();
      if (locked && needsPracticeSelfAssessment(q, st)) {
        const answer = q.answer.join('；');
        const reference = answer ? renderQuestionContent(answer) : i18n.html('question.notProvided');
        const analysis = q.analysis ? `<p>${i18n.html('question.analysis')}${renderQuestionContent(q.analysis)}</p>` : '';
        $('#p-feedback').innerHTML = `<div class="feedback warn"><b>${i18n.html('practice.selfAssess')}</b>
          <p>${i18n.html('question.userResponse')}${renderQuestionContent(st.chosen.join('；'))}</p>
          <p>${i18n.html('question.referenceAnswer')}${reference}</p>${analysis}
          <div class="actions"><button class="primary" id="p-self-right">${i18n.html('practice.selfRight')}</button>
            <button class="danger" id="p-self-wrong">${i18n.html('practice.selfWrong')}</button></div></div>`;
        // 每道简答题只接受一次自评，然后恢复总提交的剩余处理。
        const assess = (correct) => {
          if (hasCompletedPracticeSelfAssessment(getPracticeAnswerStateV26(key))) {
            return;
          }

          setPracticeAnswerStateV26(key, { selfCorrect: correct });
          continueTotalPractice();
        };

        $('#p-self-right').onclick = () => assess(true);

        $('#p-self-wrong').onclick = () => assess(false);

        $('#p-self-right').focus();
      }
    }

    // 统一提交前冻结本轮作答，仅允许一个确认流程进入评阅。
    async function submitTotalPractice() {
      if (practiceSession.current.submitMode !== 'total' || practiceSession.current.completed || isMutationBusy() || practiceSession.current.confirmingTotal) {
        return;
      }

      const session = practiceSession.current;
      // 异步确认期间尚未进入保存事务；本轮临时标记阻止连击排入第二次提交，结束后释放。
      session.confirmingTotal = true;
      refreshAnswerOptionControls();
      try {
        if (!session.totalLocked) {
          const status = i18n.text('practice.totalStatus', totalPracticeCounts());
          if (!await confirmPracticeAction(i18n.text('practice.confirmTotal', { status }))) {
            return;
          }

          if (practiceSession.current !== session) {
            return;
          }

          session.totalLocked = true;
          stopPracticeClock();
        }

        return continueTotalPractice();
      } finally {
        delete session.confirmingTotal;
        refreshAnswerOptionControls();
      }
    }

    // 若有待自评题则定位到该题，完成自评后才结算总提交。
    function continueTotalPractice() {
      const index = totalPracticePendingSelfIndex();
      if (index >= 0) {
        practiceSession.current.idx = index;
        renderPracticeQuestion();
        return;
      }

      renderPracticeQuestion();
      // 自评仅暂存在本轮；全部就绪后用同一事务更新错题、进度和记录，失败整体回滚。
      return runMutation(/* 只有尚未完成且已经锁定的总提交可记录一次成绩。 */ () => {
        if (practiceSession.current.completed || practiceSession.current.submitMode !== 'total' || !practiceSession.current.totalLocked) {
          return;
        }

        for (const item of practiceSession.current.items) {
          const question = practiceQuestionV8916(item);
          const answerState = getPracticeAnswerStateV26(practiceItemKeyV8916(item));
          const chosen = answerState.chosen || [];
          const hasAnswer = hasAnswerValueV58914(chosen);
          let correct = false;
          if (hasAnswer) {
            if (question.type === 'short') {
              correct = answerState.selfCorrect === true;
            } else {
              correct = sameAnswerForQuestion(question, chosen, question.answer);
            }
          }

          recordPracticeAnswer(item, chosen, correct);
        }

        return finishPractice();
      });
    }

    // 按提交方式和当前题状态渲染练习区，使用一致的结果与答题卡入口。
    function renderPracticeQuestion(done = false) {
      if (practiceSession.current.submitMode === 'total' && !practiceSession.current.completed) {
        renderTotalPracticeQuestion();
        return;
      }

      const { idx, items } = practiceSession.current;
      i18n.bindText($('#practice-progress'), 'practice.progress', { current: Math.min(idx + 1, items.length), total: items.length });
      if (done || idx >= items.length) {
        finishPractice();
        return;
      }

      const item = currentPracticeItemV8916();
      const q = practiceQuestionV8916(item);
      const key = practiceItemKeyV8916(item);
      const bid = practiceItemBankIdV8916(item);
      const st = getPracticeAnswerStateV26(key);
      const answerLocked = isPracticeAnswerLocked(st);

      const fav = isFavoriteV27(q.id, bid);
      const next = idx >= items.length - 1 ? 'practice.finish' : 'practice.next';
      $('#practice-card').innerHTML = `${renderPracticeHeader(fav)}${questionHtml(q, false, 0, item)}
        <div class="actions practice-actions-v44">
          <button class="ghost" id="p-prev" ${idx === 0 ? 'disabled' : ''}>${i18n.html('practice.prev')}</button>
          <button class="ghost" id="p-next">${i18n.html(next)}</button>
          <button class="primary" id="p-submit" ${answerLocked ? 'disabled' : ''}>${i18n.html('practice.submit')}</button>
          <button class="ghost" id="p-reveal" ${answerLocked ? 'disabled' : ''}>${i18n.html('practice.reveal')}</button>
        </div><div id="p-feedback" role="status"></div><div id="p-ai-v613"></div>${renderPracticeNavV26()}
        <aside class="practice-side-v31">${renderPracticeStatsV30()}</aside>`;
      applyAnswerStateV26('#practice-card', q, st.chosen || []);
      bindPracticeAnswerDraft(q, key, st);
      if (answerLocked) {
        showAnsweredStateV26(q, st);
      } else {
        renderPracticeAiPanelV613();
      }

      $('#p-exit').onclick = /* 用确认结果保护同一轮次，取消后继续练习。 */ async () => {
        if (await confirmPracticeAction(i18n.text('practice.exitMessage'), {
          title: i18n.text('practice.exitTitle'),
          cancelLabel: i18n.text('practice.resume'),
          acceptLabel: i18n.text('practice.exitAccept'),
        })) {
          finishPractice(true);
        }
      };

      $('#p-favorite').onclick = async () => {
        if (await toggleFavoriteV27(q.id, bid)) {
          renderPracticeQuestion();
        }
      };

      $('#p-edit-v120').onclick = () => openPracticeEditQuestionV120();

      $('#p-prev').onclick = () => {
        if (practiceSession.current.idx > 0) {
          // eslint-disable-next-line no-plusplus -- 轮次状态可由调用方替换，保留字符串和 BigInt 的转换；限定字段类型后移除此例外。
          practiceSession.current.idx--;
          renderPracticeQuestion();
        }
      };

      $('#p-submit').onclick = () => submitPractice(item, false);

      $('#p-reveal').onclick = () => submitPractice(item, true);

      $('#p-next').onclick = /* 最后一题之后完成训练，其余场景切换到下一题并同步当前视图。 */ () => {
        if (practiceSession.current.idx >= practiceSession.current.items.length - 1) {
          finishPractice();
        } else {
          // eslint-disable-next-line no-plusplus -- 轮次状态可由调用方替换，保留字符串和 BigInt 的转换；限定字段类型后移除此例外。
          practiceSession.current.idx++;
          renderPracticeQuestion();
        }
      };

      bindPracticeNavV30();
      bindFocusRailToggleV34();
      bindPracticeHotkeysV44();
      updateReviewAnalysisPanels();
      mountPracticeClock();
    }

    // 仅安装一次专注练习快捷键，输入框和对话框继续拥有各自的键盘操作。
    function bindPracticeHotkeysV44() {
      if (window.__shirohaPracticeHotkeysV44Bound) {
        return;
      }

      window.__shirohaPracticeHotkeysV44Bound = true;
      document.addEventListener('keydown', /* 只有当前可答的专注练习才解释快捷键，避免输入法或浏览器快捷键受到影响。 */ (e) => {
        if (!document.body.classList.contains('practice-focus') || !practiceSession.current?.items?.length || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
          return;
        }

        const { target } = e;
        const tag = ((target && target.tagName) || '').toUpperCase();
        const type = String((target && target.type) || '').toLowerCase();
        const editable = target && (target.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['radio', 'checkbox', 'button', 'submit'].includes(type)));
        if (editable || (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' '))) {
          return;
        }

        const q = practiceQuestionV8916(currentPracticeItemV8916());
        if (!q) {
          return;
        }

        // 让快捷键复用可点击控件的行为与禁用规则。
        const clickIfReady = (selector) => {
          const btn = $(selector);
          if (btn && !btn.disabled) {
            btn.click();
            return true;
          }

          return false;
        };

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          clickIfReady('#p-prev');
          return;
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          clickIfReady('#p-next');
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          if (!clickIfReady('#p-submit')) {
            clickIfReady('#p-next');
          }

          return;
        }

        if (String(e.key || '').toLowerCase() === 'v') {
          e.preventDefault();
          clickIfReady('#p-reveal');
          return;
        }

        const numeric = String(e.key || '').trim();
        if (/* 仅把单个数字 1 到 7 当成选项快捷键，文本题继续使用正常输入。 */ /^[1-7]$/.test(numeric) && !isTextType(q.type)) {
          const label = $$('#practice-card .option')[Number(numeric) - 1];
          if (label) {
            e.preventDefault();
            label.click();
          }
        }
      });
    }

    // 使用本轮计数生成当前进度与正确率，并沿用当轮的范围标签。
    function renderPracticeStatsV30() {
      const total = (practiceSession.current.items || []).length;
      const answered = Number(practiceSession.current.answered || 0);
      const correct = Number(practiceSession.current.correct || 0);
      const wrong = Number(practiceSession.current.wrong || 0);
      const accuracy = answered ? Math.round(correct / answered * 100) : 0;
      const remaining = Math.max(0, total - answered);
      const name = practiceSession.current.scopeName;
      const metrics = [
        ['practice.total', i18n.number(total)],
        ['practice.practiced', i18n.number(answered)],
        ['practice.accuracy', i18n.percent(accuracy)],
        ['practice.mistakes', i18n.number(wrong)],
      ].map(([key, value]) => `<div><span>${i18n.html(key)}</span><b>${value}</b></div>`).join('');
      return `<div id="practice-stat-card-v30" class="practice-stat-card-v30">
        <div class="practice-stat-head-v30"><div><b>${i18n.html('practice.stats')}</b>
          <span>${name ? esc(name) : i18n.html('practice.focus')}</span></div>
          <button class="rail-hide-btn-v34" data-rail-toggle-v34="practice" type="button" ${i18n.attribute('title', 'practice.hideStats')}>${i18n.html('shell.hideArtwork')}</button></div>
        <div class="practice-stat-list-v31">${metrics}</div><p>${i18n.html('practice.statsDetail', { correct, remaining })}</p>
        <button class="rail-show-btn-v34" data-rail-toggle-v34="practice" type="button" ${i18n.attribute('title', 'practice.showStats')}>${i18n.html('practice.statsShort')}</button></div>`;
    }

    // 作答后局部刷新训练统计，避免不必要地重绘输入控件。
    function refreshPracticeStatsV30() {
      const box = $('#practice-stat-card-v30');
      if (box) {
        box.outerHTML = renderPracticeStatsV30();
      }

      bindFocusRailToggleV34();
      const nav = $('#practice-nav-v26');
      if (nav) {
        nav.outerHTML = renderPracticeNavV26();
        bindPracticeNavV30();
        bindFocusRailToggleV34();
      }
    }

    function bindPracticeNavV30() {
      $$('#practice-card [data-practice-jump]').forEach((btn) => btn.onclick = () => {
        practiceSession.current.idx = Number(btn.dataset.practiceJump);
        renderPracticeQuestion();
      });
    }

    function getPracticeAnswerStateV26(id) {
      practiceSession.current.answerState = practiceSession.current.answerState || {};
      return practiceSession.current.answerState[id] || { chosen: [], answered: false, revealed: false, correct: null };
    }

    function setPracticeAnswerStateV26(id, next) {
      practiceSession.current.answerState = practiceSession.current.answerState || {};
      practiceSession.current.answerState[id] = { ...getPracticeAnswerStateV26(id), ...next };
    }

    // 将变化绑定到捕获的会话和题目标记，旧控件事件不得写入新一轮。
    function bindPracticeAnswerDraft(q, key, stateValue) {
      const session = practiceSession.current; const marker = $('#practice-card .question-title');
      const canEdit = () => canEditPracticeOptions(session, key) && marker?.isConnected
        && $('#practice-card')?.contains(marker);

      const capture = () => {
        if (canEdit()) {
          setPracticeAnswerStateV26(key, { chosen: collectAnswer('#practice-card', q) });
        }
      };

      bindAnswerOptionControls('#practice-card', q, practiceSession.current.idx + 1, canEdit, capture);
      if (isPracticeAnswerLocked(stateValue)) {
        return;
      }

      $$('#practice-card .text-answer').forEach((input) => {
        input.oninput = capture;
      });
    }

    // 为逐题训练生成可定位的答题卡，区分作答、揭晓与当前题。
    function renderPracticeNavV26() {
      const buttons = (practiceSession.current.items || []).map(/* 逐题读取答题状态构造卡片，键盘和视图依赖稳定的题目索引。 */ (item, i) => {
        const q = practiceQuestionV8916(item);
        const st = getPracticeAnswerStateV26(practiceItemKeyV8916(item));
        let correctness = '';
        if (st.correct === true) {
          correctness = 'ok';
        } else if (st.correct === false) {
          correctness = 'bad';
        }

        const cls = [i === practiceSession.current.idx ? 'current' : '', st.answered ? 'done' : '', correctness, isFavoriteV27(q.id, practiceItemBankIdV8916(item)) ? 'favorite' : ''].filter(Boolean).join(' ');
        const title = i18n.attribute('title', 'practice.navNumber', { number: i + 1 });
        return `<button type="button" class="${cls}" data-practice-jump="${i}" ${title}>${i18n.number(i + 1)}</button>`;
      }).join('');
      return `<div id="practice-nav-v26" class="practice-nav-v26"><b>${i18n.html('practice.nav')}</b><div class="practice-nav-grid-v26">${buttons}</div></div>`;
    }

    // 单题提交通过事务记录答案；揭晓与主动判分沿用不同的交互入口。
    async function submitPractice(item, reveal) {
      return runMutation(/* 在提交时重新收集当前输入，保存成功后更新可显示的判定状态。 */ async () => {
        const q = practiceQuestionV8916(item); const key = practiceItemKeyV8916(item);
        const chosen = collectAnswer('#practice-card', q);
        if (!hasAnswerValueV58914(chosen) && !reveal) {
          $('#p-feedback').innerHTML = `<div class="feedback warn">${i18n.html('practice.answerFirst')}</div>`;
          return;
        }

        if (q.type === 'short') {
          showSubjectiveFeedback(item, chosen, reveal);
          return;
        }

        const ok = !reveal && sameAnswerForQuestion(q, chosen, q.answer);
        if (!reveal) {
          recordPracticeAnswer(item, chosen, ok);
        } else {
          setPracticeAnswerStateV26(key, { chosen, revealed: true, correct: null });
        }

        await saveSilent();
        markOptions('#practice-card', q, chosen);
        showAnsweredStateV26(q, getPracticeAnswerStateV26(key));
        refreshPracticeStatsV30();
        renderStats();
      });
    }

    // 根据当前题已答状态恢复反馈和控件，揭晓答案不显示为普通作答错误。
    function showAnsweredStateV26(q, st) {
      markOptions('#practice-card', q, st.chosen || []);
      const wrong = st.answered && st.correct === false && !st.revealed;
      let analysis = '';
      if (wrong) {
        analysis = renderReviewAnalysis(currentPracticeItemV8916(), st.chosen || [], `practice:${practiceSession.current.start}`);
      } else if (q.analysis) {
        analysis = `<br>${i18n.html('question.analysis')}${renderQuestionContent(q.analysis)}`;
      }

      let feedbackClass = 'bad';
      let feedbackTitle = 'practice.feedbackWrong';
      if (st.revealed) {
        feedbackClass = 'warn';
        feedbackTitle = 'practice.feedbackRevealed';
      } else if (st.correct) {
        feedbackClass = 'ok';
        feedbackTitle = 'practice.feedbackCorrect';
      }

      const comparison = isMultiBlankQuestionV58914(q)
        ? renderMultiBlankComparisonV58914(q.blankAnswers, st.chosen || [], true, true)
        : `｜${feedbackAnswerHtmlV58914(q, st.chosen || [], true)}`;
      $('#p-feedback').innerHTML = `<div class="feedback ${feedbackClass}"><b>${i18n.html(feedbackTitle)}</b>${comparison}${analysis}</div>`;
      const sub = $('#p-submit'); const rev = $('#p-reveal');
      if (sub) {
        sub.disabled = true;
      }

      if (rev) {
        rev.disabled = true;
      }

      renderPracticeAiPanelV613();
      updateReviewAnalysisPanels();
    }

    // 简答反馈先保留用户文字和参考答案，由用户自评决定本题结果。
    function showSubjectiveFeedback(item, chosen, reveal) {
      const q = practiceQuestionV8916(item);
      const key = practiceItemKeyV8916(item);
      const userAnswer = chosen.join('；');
      const referenceAnswer = q.answer.join('；');
      const user = userAnswer ? renderQuestionContent(userAnswer) : i18n.html('question.notFilled');
      const reference = referenceAnswer ? renderQuestionContent(referenceAnswer) : i18n.html('question.notProvided');
      const analysis = q.analysis ? `<b>${i18n.html('question.analysis')}</b><div class="q-multiline-text">${renderQuestionContent(q.analysis)}</div>` : '';
      setPracticeAnswerStateV26(key, { chosen, revealed: !!reveal });
      $('#p-feedback').innerHTML = `<div class="feedback warn">
        <b>${i18n.html('question.userResponse')}</b><div class="q-multiline-text">${user}</div>
        <b>${i18n.html('question.referenceAnswer')}</b><div class="q-multiline-text">${reference}</div>
        ${analysis}<div class="actions"><button class="primary" id="p-self-right">${i18n.html('practice.selfRight')}</button>
          <button class="danger" id="p-self-wrong">${i18n.html('practice.selfWrong')}</button></div></div>`;
      $('#p-submit').disabled = true;
      $('#p-reveal').disabled = true;
      $('#p-self-right').onclick = /* 将自评正确的点击提交给同一保存事务。 */ async () => runMutation(/* 按正确记录原作答后关闭两个自评入口，避免重复登记。 */ async () => {
        recordPracticeAnswer(item, chosen, true);
        $('#p-self-right').disabled = true;
        $('#p-self-wrong').disabled = true;
        await saveSilent();
        renderStats();
        renderPracticeQuestion();
      });

      $('#p-self-wrong').onclick = /* 将自评错误的点击提交给同一保存事务。 */ async () => runMutation(/* 按错误记录原作答后关闭两个自评入口，供后续错题复习。 */ async () => {
        recordPracticeAnswer(item, chosen, false);
        $('#p-self-right').disabled = true;
        $('#p-self-wrong').disabled = true;
        await saveSilent();
        renderStats();
        renderPracticeQuestion();
      });

      renderPracticeAiPanelV613();
    }

    // 保存解析不代表提交答案；总提交和未进入自评的简答题继续保留答题草稿。
    function refreshSavedPracticeAnalysis() {
      const item = currentPracticeItemV8916();
      const q = practiceQuestionV8916(item);
      const st = getPracticeAnswerStateV26(practiceItemKeyV8916(item));
      if (practiceSession.current.submitMode === 'total') {
        renderPracticeAiPanelV613();
      } else if (q.type === 'short' && !st.answered && $('#p-self-right')) {
        showSubjectiveFeedback(item, st.chosen || [], !!st.revealed);
      } else if (isPracticeAnswerLocked(st)) {
        showAnsweredStateV26(q, st);
      } else {
        renderPracticeAiPanelV613();
      }
    }

    // 只首次登记有效判分，并按原题来源更新本轮计数和错题记录。
    function recordPracticeAnswer(item, chosen, ok) {
      const q = practiceQuestionV8916(item); const key = practiceItemKeyV8916(item); const bid = practiceItemBankIdV8916(item);
      const current = getPracticeAnswerStateV26(key);
      if (current.answered) {
        return;
      }

      // eslint-disable-next-line no-plusplus -- 轮次状态可由调用方替换，保留字符串和 BigInt 的转换；限定字段类型后移除此例外。
      practiceSession.current.answered++;
      if (ok) {
        // eslint-disable-next-line no-plusplus -- 轮次状态可由调用方替换，保留字符串和 BigInt 的转换；限定字段类型后移除此例外。
        practiceSession.current.correct++;
        markRight(q.id, bid);
      } else {
        // eslint-disable-next-line no-plusplus -- 轮次状态可由调用方替换，保留字符串和 BigInt 的转换；限定字段类型后移除此例外。
        practiceSession.current.wrong++;
        addWrong(q.id, bid, chosen);
      }

      setPracticeAnswerStateV26(key, { chosen: [...chosen], answered: true, revealed: false, correct: !!ok, answeredAt: now() });
      practiceSession.current.details.push(makeAnswerDetail(item, {
        question: q, chosen, correct: ok, score: scoreOf(q), time: now(),
      }));
    }

    // 从题库详情带当前源题库进入练习设置，并关闭旧题目详情。
    function openQuickPracticeSetup() {
      closeBankQuestionDetail();
      setPracticeBankScopeV8916(activeBank().id);
      resetAiSinglePracticeV613();
      exitPracticeFocus();
      practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0, details: [], answerState: {} };
      renderPracticeEmpty('practice.quickEmpty');
      $('#practice-start-mode-v58916').value = PRACTICE_START_FROM_V58916;
      syncLimitControlV60('practice');
      renderPracticeScopeUiV8916();
      syncPracticeStartUiV58916(false);
      updateShellLayoutByView('practice');
      $('#practice-submit-mode').focus();
    }

    // 切换练习来源时使导航与实际视图一致，并同步可用的开始方式。
    function switchPracticeSourceV27(source) {
      $$('.nav').forEach((b) => b.classList.remove('active'));

      document.querySelector('[data-view="practice"]').classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));

      $('#practice').classList.add('active');
      $('#page-title').textContent = i18n.text('nav.practice');
      $('#practice-source').value = source;
      $('#practice-order').value = 'random';
      $('#practice-limit').value = 'custom';
      if ($('#practice-custom-count')) {
        $('#practice-custom-count').value = '20';
      }

      openQuickPracticeSetup();
    }

    return {
      startPracticeClockTicker,
      showPracticePause,
      pausePracticeClock,
      startWrongPractice,
      enterPracticeFocus,
      exitPracticeFocus,
      startPractice,
      totalPracticeFilledCount,
      canLeaveTotalPractice,
      renderPracticeQuestion,
      getPracticeAnswerStateV26,
      refreshSavedPracticeAnalysis,
      openQuickPracticeSetup,
      switchPracticeSourceV27,
      renderPracticeWrongOverview,
      needsPracticeSelfAssessment,
      recordPracticeAnswer,
      resetPractice,
      bindPracticeClockLifecycle,
    };
  }

  globalThis.ShirohaPracticePage = { create };
})();
