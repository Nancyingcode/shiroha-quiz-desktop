(() => {
  'use strict';
  function create({
    state, session: practiceSession, training: ShirohaTraining, select: $, selectAll: $$,
    escape: esc, label, now, makeId, toast, showNotice, selection, scope, question, review, favorites, ai, shell, storage,
  }) {
    const {
      readCount: readCustomCountV60, syncLimit: syncLimitControlV60, build: buildPracticeSelectionV58916,
      updateProgress: updatePracticeProgressV58916, syncStart: syncPracticeStartUiV58916,
    } = selection;
    const {
      current: practiceScopeV8916, normalize: normalizePracticeScopeV8916, label: practiceScopeLabelV8916,
      bankType: PRACTICE_SCOPE_BANK_V8916, groupType: PRACTICE_SCOPE_GROUP_V8916,
      fromStart: PRACTICE_START_FROM_V58916, continueMode: PRACTICE_START_CONTINUE_V58916, custom: PRACTICE_START_CUSTOM_V58916,
      setBank: setPracticeBankScopeV8916, render: renderPracticeScopeUiV8916, activeBank,
    } = scope;
    const {
      current: currentPracticeItemV8916, question: practiceQuestionV8916, key: practiceItemKeyV8916,
      bankId: practiceItemBankIdV8916, bankName: practiceItemBankNameV8916, hasAnswer: hasAnswerValueV58914,
      sameAnswer: sameAnswerForQuestion, isTextType, isMultiBlank: isMultiBlankQuestionV58914,
      blankUserAnswers: blankUserAnswersFromDetailV58914, multiBlankComparison: renderMultiBlankComparisonV58914,
      reviewAnswer: practiceReviewAnswerHtml, body: renderQuestionBodyV83, reviewOptions: renderReviewOptions,
      reviewSummary: renderReviewAnswerSummary, html: questionHtml, applyAnswer: applyAnswerStateV26, collectAnswer,
      bindOptions: bindAnswerOptionControls, refreshOptions: refreshAnswerOptionControls, canEditOptions: canEditPracticeOptions,
      markOptions, content: renderQuestionContent, feedback: feedbackAnswerHtmlV58914, score: scoreOf, detail: makeAnswerDetail,
      addWrong, markRight,
    } = question;
    const {
      items: trainingSessionItems, attach: attachTrainingReview, completion: trainingCompletion,
      open: openTrainingReview, page: nativePage, analysis: renderReviewAnalysis, updatePanels: updateReviewAnalysisPanels,
    } = review;
    const { isFavorite: isFavoriteV27, toggle: toggleFavoriteV27 } = favorites;
    const { reset: resetAiSinglePracticeV613, render: renderPracticeAiPanelV613 } = ai;
    const {
      collapse: autoCollapseSidebarForFocusV47, restore: restoreSidebarAfterFocusV47, update: updateShellLayoutByView,
      bindRail: bindFocusRailToggleV34, prewarmMath: prewarmMathJaxV56, editQuestion: openPracticeEditQuestionV120,
      closeBankDetail: closeBankQuestionDetail, renderAll, renderStats,
    } = shell;
    const {
      loadItems: loadNativeItems, isBusy: isMutationBusy, isReady: isApplicationReady,
      transaction: runMutation, save: saveSilent,
    } = storage;
    // 运行计时器和复盘视图仅归当前页面；换轮/重置释放计时器，离开复盘后释放快照引用。
    const PRACTICE_CLOCK_REFRESH_MS = 250;
    let lifecycleBound = false;
    function bindPracticeClockLifecycle() {
      if (lifecycleBound) {
        return;
      }
      lifecycleBound = true;
      document.addEventListener('visibilitychange', () => {
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
    function resetPractice() {
      resetAiSinglePracticeV613();
      exitPracticeFocus();
      $('#practice-card').innerHTML = '<div class="empty">选择条件后点击“开始练习”。</div>';
      practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0 };
      $('#practice-progress').textContent = '0 / 0';
      syncPracticeStartUiV58916(true);
    }
    function capturePracticeDraft() {
      const item = currentPracticeItemV8916();
      if (!item || practiceSession.current.completed) {
        return;
      }
      const key = practiceItemKeyV8916(item); const st = getPracticeAnswerStateV26(key);
      if (!st.answered && !st.revealed && !practiceSession.current.totalLocked && $('#practice-card .question-title')) {
        setPracticeAnswerStateV26(key, { chosen: collectAnswer('#practice-card', practiceQuestionV8916(item)) });
      }
    }
    function clearPracticeClockTimer() {
      if (practiceSession.timer !== null) {
        globalThis.clearInterval(practiceSession.timer);
      }
      practiceSession.timer = null;
    }
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
    function startPracticeClockTicker() {
      clearPracticeClockTimer();
      if (practiceSession.current.clock?.state === 'running') {
        const owner = practiceSession.current;
        const timer = globalThis.setInterval(() => {
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
    function showPracticePause() {
      if (practiceSession.dialog || practiceSession.current.clock?.state !== 'paused' || !$('#practice.active') || document.hidden || $('#app-dialog[open]')) {
        return;
      }
      const owner = practiceSession.current; const dialog = document.createElement('dialog');
      practiceSession.dialog = dialog;
      dialog.id = 'practice-pause-dialog';
      dialog.className = 'practice-pause-dialog';
      dialog.setAttribute('aria-labelledby', 'practice-pause-title');
      dialog.innerHTML = `<h2 id="practice-pause-title">练习已暂停</h2><p>暂停期间不计时，当前作答已保留。</p><strong id="practice-pause-time">${ShirohaTraining.formatDuration(ShirohaTraining.elapsedClock(owner.clock, globalThis.performance.now()) / 1000)}</strong><button type="button" class="primary" id="practice-resume">继续练习</button>`;
      const resume = () => {
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
      };
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        resume();
      });
      dialog.addEventListener('keydown', (event) => {
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
    function stopPracticeClock() {
      capturePracticeDraft();
      practiceSession.current.clock = ShirohaTraining.transitionClock(practiceSession.current.clock, 'stopped', globalThis.performance.now());
      disposePracticeClock();
      freezePracticeInputs();
      refreshAnswerOptionControls();
      updatePracticeClock();
    }
    function mountPracticeClock() {
      const head = $('#practice-card .practice-focus-head');
      if (!head || !practiceSession.current.clock) {
        return;
      }
      head.insertAdjacentHTML('beforeend', `<div class="practice-clock"><span>用时 <b id="p-clock" role="timer" aria-label="本轮有效练习用时" aria-live="off"></b></span><button type="button" class="ghost mini-btn" id="p-pause" ${practiceSession.current.clock.state === 'stopped' ? 'disabled' : ''}>暂停</button></div>`);
      $('#p-pause').onclick = () => pausePracticeClock();
      freezePracticeInputs();
      updatePracticeClock();
      if (practiceSession.current.clock.state === 'paused') {
        showPracticePause();
      }
    }
    async function confirmPracticeAction(message, options) {
      const owner = practiceSession.current; const wasRunning = owner.clock?.state === 'running';
      pausePracticeClock(false);
      const accepted = await globalThis.ShirohaDialogs.confirm(message, options);
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
    function startWrongPractice() {
      const limit = $('#wrong-practice-limit')?.value || 'custom';
      const customCount = readCustomCountV60('#wrong-practice-custom-count', 20);
      $$('.nav').forEach((b) => b.classList.remove('active'));
      document.querySelector('[data-view="practice"]').classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));
      $('#practice').classList.add('active');
      $('#page-title').textContent = '刷题练习';
      $('#practice-source').value = 'wrong';
      $('#practice-order').value = 'random';
      $('#practice-limit').value = limit;
      if ($('#practice-custom-count')) {
        $('#practice-custom-count').value = customCount;
      }
      openQuickPracticeSetup();
    }
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
    function renderPracticeWrongRows(record, items) {
      return items.map(({ detail, index }) => {
        const snapshot = detail.nativeQuestion || detail; const q = snapshot.id ? snapshot : { ...snapshot, id: detail.questionId || '' }; const chosen = blankUserAnswersFromDetailV58914(detail); const answer = detail.answer || q.answer || [];
        const comparison = isMultiBlankQuestionV58914(q) ? renderMultiBlankComparisonV58914(q.blankAnswers, chosen, true) : `<div class="q-multiline-text"><b>你的答案：</b>${practiceReviewAnswerHtml(q, chosen)}</div><div class="q-multiline-text"><b>${q.type === 'short' ? '参考答案（自评）' : '正确答案'}：</b>${hasAnswerValueV58914(answer) ? practiceReviewAnswerHtml(q, answer) : '题库未提供答案'}</div>`;
        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        return `<article class="exam-q" data-wrong-question-index="${index}"><div class="qmeta"><b>第 ${index + 1} 题</b><span class="pill">${label(q.type)}</span><span>${esc(detail.sourceBankName || record.bankName || '')}</span></div><div class="question-title">${renderQuestionBodyV83(q)}</div>${renderReviewOptions({ ...q, answer }, chosen)}${isTextType(q.type) ? `<div class="feedback bad">${comparison}</div>` : renderReviewAnswerSummary({ ...q, answer }, chosen, '未作答')}${renderReviewAnalysis({ bankId: detail.sourceBankId || record.bankId || '', question: q }, chosen, 'result:' + record.id + ':' + index)}</article>`;
      }).join('');
    }
    function renderPracticeWrongOverview(record, items = practiceWrongRows(record)) {
      const wrong = practiceWrongRows(record);
      return `<section id="p-wrong-overview" aria-label="本轮错题一览"><h3>错题一览（${wrong.length}）</h3><div id="p-wrong-overview-list" aria-label="本轮错题一览">${wrong.length ? renderPracticeWrongRows(record, items) : '<div class="notice ok">本轮没有错题，全部答对了。</div>'}</div></section>`;
    }
    function renderPracticeWrongPage(record) {
      const target = document.getElementById('p-wrong-overview-list'); const wrong = practiceWrongRows(record);
      if (!target || !wrong.length) {
        return;
      }
      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      const rows = nativePage(wrong, 'practice-wrong:' + record.id, target, () => renderPracticeWrongPage(record));
      target.innerHTML = renderPracticeWrongRows(record, rows);
      updateReviewAnalysisPanels();
    }
    function hasUnfinishedTotalPractice() {
      return practiceSession.current.submitMode === 'total'
        && (!practiceSession.current.totalLocked || practiceSession.current.answered !== practiceSession.current.items.length);
    }
    async function finishPractice(exited = false) {
      if (hasUnfinishedTotalPractice()) {
        return;
      }
      stopPracticeClock();
      return runMutation(async () => {
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
        attachTrainingReview(rec, practiceReviewItems(), { completion: total < practiceSession.current.items.length ? 'ended_early' : 'completed', submitMode: practiceSession.current.submitMode || 'single', timing: 'active' });
        state.records.unshift(rec);
        updatePracticeProgressV58916();
        await saveSilent();
        practiceSession.current.completed = true;
        resetAiSinglePracticeV613();
        if (exited) {
          exitPracticeFocus();
        }
        $('#practice-card').innerHTML = `<div class="score-card"><div class="metric"><span>已答</span><b>${total}</b></div><div class="metric"><span>正确</span><b>${practiceSession.current.correct}</b></div><div class="metric"><span>错误</span><b>${practiceSession.current.wrong}</b></div><div class="metric"><span>正确率</span><b>${rec.accuracy}%</b></div></div><div class="notice ok">本轮练习已完成，并已写入记录页。记录包含每题作答明细。</div><div class="actions"><button class="primary" id="back-practice-setup">返回练习设置</button><button class="ghost" id="again-practice">按当前条件再练一次</button></div>`;
        if (practiceSession.current.submitMode === 'total') {
          $('#practice-card').insertAdjacentHTML('beforeend', renderPracticeWrongOverview(rec, []));
          renderPracticeWrongPage(rec);
        }
        $('#practice-card > .notice').textContent = `${trainingCompletion(rec)}，记录已保存。可查看本轮全部题目的作答情况。`;
        $('#practice-card .score-card').insertAdjacentHTML('afterend', `<p class="training-result-summary">${trainingCompletion(rec)} · 未作答 ${rec.reviewSummary.unanswered} 题 · 用时 ${ShirohaTraining.formatDuration(rec.duration)}</p><div class="actions training-result-actions"><button type="button" class="primary" id="practice-review-result">查看复盘</button></div>`);
        $('#practice-review-result').onclick = () => openTrainingReview(rec.id, 'practice');
        $('#back-practice-setup').onclick = () => exitPracticeFocus();
        $('#again-practice').onclick = () => startPractice();
        showNotice(trainingCompletion(rec), `已答 ${total} 道，正确率 ${rec.accuracy}%。`, 'ok');
        renderAll();
      });
    }
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
        $('#practice-card').innerHTML = `<div class="empty">${esc(selection.error)}</div>`;
        showNotice('无法开始练习', selection.error, 'warn');
        return;
      }
      if (!await loadNativeItems(selection.items, isCurrentStart) || !isCurrentStart()) {
        return;
      }
      disposePracticeClock();
      resetAiSinglePracticeV613();
      practiceSession.current = {
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
      const session = practiceSession.current; const sessionRequest = practiceSession.request;
      practiceSession.current.submitMode = $('#practice-submit-mode')?.value === 'total' ? 'total' : 'single';
      if (!practiceSession.current.items.length) {
        $('#practice-card').innerHTML = '<div class="empty">当前条件下没有题目。</div>';
        showNotice('无法开始练习', '当前筛选条件下没有题目。', 'warn');
        return;
      }
      const needsLargeRoundConfirmation = session.items.length > 200 && (limit === 'all' || limit === 'half' || limit === 'custom' || Number(limit) > 200 || selection.startMode === PRACTICE_START_CUSTOM_V58916);
      if (needsLargeRoundConfirmation) {
        const msg = session.items.length > 500 ? `本轮将练习 ${session.items.length} 道题，题量很大，手机 WebView 可能明显卡顿，建议减少题量或使用电脑端。是否继续？` : `本轮将练习 ${session.items.length} 道题，手机 WebView 可能出现轻微卡顿，是否继续？`;
        const accepted = await globalThis.ShirohaDialogs.confirm(msg);
        if (practiceSession.current !== session || practiceSession.request !== sessionRequest || isMutationBusy()) {
          return;
        }
        if (!accepted) {
          practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0, details: [], answerState: {} };
          return;
        }
      }
      let startText = '';
      if (selection.startMode === PRACTICE_START_CONTINUE_V58916) {
        startText = ` · 从第 ${selection.startIndex + 1} 题继续`;
      } else if (selection.startMode === PRACTICE_START_CUSTOM_V58916) {
        startText = ' · 自选题号';
      }
      practiceSession.current.reviewItems = trainingSessionItems(practiceSession.current.items);
      enterPracticeFocus();
      prewarmMathJaxV56();
      showNotice('练习开始', `${practiceSession.current.scopeName}${startText} · 本轮共 ${practiceSession.current.items.length} 道题。`, 'ok');
      renderPracticeQuestion();
      practiceSession.current.clock = ShirohaTraining.createClock(globalThis.performance.now());
      mountPracticeClock();
      startPracticeClockTicker();
    }
    function totalPracticeFilledCount() {
      return practiceSession.current.items.filter((item) => hasAnswerValueV58914(getPracticeAnswerStateV26(practiceItemKeyV8916(item)).chosen)).length;
    }
    async function canLeaveTotalPractice(target) {
      if (practiceSession.current.submitMode !== 'total' || practiceSession.current.completed) {
        return true;
      }
      if (target === 'ai-settings') {
        return true;
      }
      if (practiceSession.current.totalLocked) {
        toast('请先完成简答题自评和总提交保存。', 'warn');
        return false;
      }
      if (totalPracticeFilledCount() > 0 && !await confirmPracticeAction('本轮答案尚未提交，离开将放弃本轮草稿。确定离开？')) {
        return false;
      }
      disposePracticeClock();
      resetAiSinglePracticeV613();
      practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0, details: [], answerState: {} };
      $('#practice-card').innerHTML = '<div class="empty">选择条件后点击“开始练习”。</div>';
      $('#practice-progress').textContent = '0 / 0';
      return true;
    }
    function hasCompletedPracticeSelfAssessment(answerState) {
      const { selfCorrect } = answerState;
      return selfCorrect === true || selfCorrect === false;
    }
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
    function totalPracticeStatus() {
      const filled = totalPracticeFilledCount();
      return `共 ${practiceSession.current.items.length} 题 · 已填写 ${filled} 题 · 未填写 ${practiceSession.current.items.length - filled} 题`;
    }
    function renderTotalPracticeNav() {
      return `<div id="practice-nav-v26" class="practice-nav-v26"><b>答题卡 · ✓ 已填写 / ○ 未填写</b><div class="practice-nav-grid-v26">${practiceSession.current.items.map((item, index) => {
        const filled = hasAnswerValueV58914(getPracticeAnswerStateV26(practiceItemKeyV8916(item)).chosen);
        return `<button type="button" class="${index === practiceSession.current.idx ? 'current' : ''}" data-practice-jump="${index}" aria-label="第 ${index + 1} 题，${filled ? '已填写' : '未填写'}" ${practiceSession.current.totalLocked ? 'disabled' : ''}>${index + 1}${filled ? ' ✓' : ' ○'}</button>`;
      }).join('')}</div></div>`;
    }
    function renderTotalPracticeQuestion() {
      const item = currentPracticeItemV8916();
      if (!item) {
        return;
      }
      const q = practiceQuestionV8916(item); const key = practiceItemKeyV8916(item); const st = getPracticeAnswerStateV26(key); const locked = !!practiceSession.current.totalLocked;
      $('#practice-progress').textContent = `${practiceSession.current.idx + 1} / ${practiceSession.current.items.length}`;
      $('#practice-card').innerHTML = `<div class="practice-focus-head"><b>${esc(practiceSession.current.scopeName || '刷题练习')} · 总提交</b><span class="practice-round-progress">本轮进度 · 第 ${practiceSession.current.idx + 1} / ${practiceSession.current.items.length} 题</span><div class="practice-tools-v26"><button class="ghost mini-btn" id="p-favorite">${isFavoriteV27(q.id, practiceItemBankIdV8916(item)) ? '取消收藏' : '收藏题目'}</button><button class="ghost mini-btn" id="p-edit-v120" disabled title="本轮总提交结束后可编辑题目">编辑题目</button><button class="ghost mini-btn" id="p-exit" ${locked ? 'disabled' : ''}>退出练习</button></div></div>${questionHtml(q, false, 0, item)}<div class="actions practice-actions-v44"><button class="ghost" id="p-prev" ${locked || practiceSession.current.idx === 0 ? 'disabled' : ''}>上一题</button><button class="ghost" id="p-next" ${locked || practiceSession.current.idx === practiceSession.current.items.length - 1 ? 'disabled' : ''}>下一题</button><button class="primary" id="p-submit-all">${locked ? '继续提交' : '总提交'}</button></div><p id="p-total-status" role="status">${totalPracticeStatus()}${locked ? ' · 答案已锁定，请完成自评与保存。' : ' · 提交前可修改答案。'}</p><div id="p-feedback" role="status"></div><div id="p-ai-v613"></div>${renderTotalPracticeNav()}`;
      applyAnswerStateV26('#practice-card', q, st.chosen || []);
      const session = practiceSession.current;
      const marker = $('#practice-card .question-title');
      const canEdit = () => canEditPracticeOptions(session, key) && marker?.isConnected
        && $('#practice-card')?.contains(marker);
      const capture = () => {
        if (!canEdit()) {
          return;
        }
        setPracticeAnswerStateV26(key, { chosen: collectAnswer('#practice-card', q) });
        $('#p-total-status').textContent = `${totalPracticeStatus()} · 提交前可修改答案。`;
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
      $('#p-exit').onclick = async () => {
        if (!await confirmPracticeAction('本轮答案尚未提交。退出将放弃本轮草稿，不生成练习记录。确定退出？')) {
          return;
        }
        disposePracticeClock();
        resetAiSinglePracticeV613();
        practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0, details: [], answerState: {} };
        exitPracticeFocus();
        $('#practice-card').innerHTML = '<div class="empty">选择条件后点击“开始练习”。</div>';
        $('#practice-progress').textContent = '0 / 0';
        $('#start-practice-btn').focus();
      };
      bindPracticeNavV30();
      bindPracticeHotkeysV44();
      mountPracticeClock();
      renderPracticeAiPanelV613();
      if (locked && needsPracticeSelfAssessment(q, st)) {
        $('#p-feedback').innerHTML = `<div class="feedback warn"><b>请对照参考答案自评</b><p>你的作答：${renderQuestionContent(st.chosen.join('；'))}</p><p>参考答案：${renderQuestionContent(q.answer.join('；') || '未提供')}</p>${q.analysis ? `<p>解析：${renderQuestionContent(q.analysis)}</p>` : ''}<div class="actions"><button class="primary" id="p-self-right">判为正确</button><button class="danger" id="p-self-wrong">判为错误</button></div></div>`;
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
          if (!await confirmPracticeAction(`${totalPracticeStatus()}。总提交后不能修改答案；未填写题将按错误计入本轮，简答题需对照参考答案自评。确认总提交？`)) {
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
    function continueTotalPractice() {
      const index = totalPracticePendingSelfIndex();
      if (index >= 0) {
        practiceSession.current.idx = index;
        renderPracticeQuestion();
        return;
      }
      renderPracticeQuestion();
      // 自评仅暂存在本轮；全部就绪后用同一事务更新错题、进度和记录，失败整体回滚。
      return runMutation(() => {
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
    function renderPracticeQuestion(done = false) {
      if (practiceSession.current.submitMode === 'total' && !practiceSession.current.completed) {
        renderTotalPracticeQuestion();
        return;
      }
      $('#practice-progress').textContent = `${Math.min(practiceSession.current.idx + 1, practiceSession.current.items.length)} / ${practiceSession.current.items.length}`;
      if (done || practiceSession.current.idx >= practiceSession.current.items.length) {
        finishPractice();
        return;
      }
      const item = currentPracticeItemV8916();
      const q = practiceQuestionV8916(item);
      const key = practiceItemKeyV8916(item);
      const bid = practiceItemBankIdV8916(item);
      const st = getPracticeAnswerStateV26(key);
      const answerLocked = () => st.answered || st.revealed;
      const fav = isFavoriteV27(q.id, bid);
      const groupTitle = practiceSession.current.scopeType === 'GROUP' ? `${practiceSession.current.scopeName} · 分组练习` : '刷题练习';
      $('#practice-card').innerHTML = `<div class="practice-focus-head"><b>${esc(groupTitle)}</b><span class="practice-round-progress">本轮进度 · 第 ${practiceSession.current.idx + 1} / ${practiceSession.current.items.length} 题</span><div class="practice-tools-v26"><button class="ghost mini-btn" id="p-favorite">${fav ? '取消收藏' : '收藏题目'}</button><button class="ghost mini-btn" id="p-edit-v120">编辑题目</button><button class="ghost mini-btn" id="p-exit">退出练习</button></div></div>${questionHtml(q, false, 0, item)}<div class="actions practice-actions-v44"><button class="ghost" id="p-prev" ${practiceSession.current.idx === 0 ? 'disabled' : ''}>上一题</button><button class="ghost" id="p-next">${practiceSession.current.idx >= practiceSession.current.items.length - 1 ? '完成练习' : '下一题'}</button><button class="primary" id="p-submit" ${answerLocked() ? 'disabled' : ''}>提交答案</button><button class="ghost" id="p-reveal" ${answerLocked() ? 'disabled' : ''}>看答案</button></div><div id="p-feedback"></div><div id="p-ai-v613"></div>${renderPracticeNavV26()}<aside class="practice-side-v31">${renderPracticeStatsV30()}</aside>`;
      applyAnswerStateV26('#practice-card', q, st.chosen || []);
      bindPracticeAnswerDraft(q, key, st);
      if (answerLocked()) {
        showAnsweredStateV26(q, st);
      } else {
        renderPracticeAiPanelV613();
      }
      $('#p-exit').onclick = async () => {
        if (await confirmPracticeAction('已作答部分会保存为一条记录。', { title: '退出本轮练习？', cancelLabel: '继续练习', acceptLabel: '保存并退出' })) {
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
      $('#p-next').onclick = () => {
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
    function bindPracticeHotkeysV44() {
      if (window.__shirohaPracticeHotkeysV44Bound) {
        return;
      }
      window.__shirohaPracticeHotkeysV44Bound = true;
      document.addEventListener('keydown', (e) => {
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
        if (/^[1-7]$/.test(numeric) && !isTextType(q.type)) {
          const label = $$('#practice-card .option')[Number(numeric) - 1];
          if (label) {
            e.preventDefault();
            label.click();
          }
        }
      });
    }
    function renderPracticeStatsV30() {
      const total = (practiceSession.current.items || []).length;
      const answered = Number(practiceSession.current.answered || 0);
      const correct = Number(practiceSession.current.correct || 0);
      const wrong = Number(practiceSession.current.wrong || 0);
      const accuracy = answered ? Math.round(correct / answered * 100) : 0;
      const remaining = Math.max(0, total - answered);
      return `<div id="practice-stat-card-v30" class="practice-stat-card-v30"><div class="practice-stat-head-v30"><div><b>本轮统计</b><span>${esc(practiceSession.current.scopeName || '沉浸练习')}</span></div><button class="rail-hide-btn-v34" data-rail-toggle-v34="practice" type="button" title="隐藏本轮统计">隐藏</button></div><div class="practice-stat-list-v31"><div><span>总题</span><b>${total}</b></div><div><span>已刷</span><b>${answered}</b></div><div><span>正确率</span><b>${accuracy}%</b></div><div><span>错题</span><b>${wrong}</b></div></div><p>正确 ${correct} · 剩余 ${remaining}</p><button class="rail-show-btn-v34" data-rail-toggle-v34="practice" type="button" title="显示本轮统计">统计</button></div>`;
    }
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
      if (stateValue.answered || stateValue.revealed) {
        return;
      }
      $$('#practice-card .text-answer').forEach((input) => {
        input.oninput = capture;
      });
    }
    function renderPracticeNavV26() {
      const buttons = (practiceSession.current.items || []).map((item, i) => {
        const q = practiceQuestionV8916(item);
        const st = getPracticeAnswerStateV26(practiceItemKeyV8916(item));
        let correctness = '';
        if (st.correct === true) {
          correctness = 'ok';
        } else if (st.correct === false) {
          correctness = 'bad';
        }
        const cls = [i === practiceSession.current.idx ? 'current' : '', st.answered ? 'done' : '', correctness, isFavoriteV27(q.id, practiceItemBankIdV8916(item)) ? 'favorite' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-practice-jump="${i}" title="第${i + 1}题">${i + 1}</button>`;
      }).join('');
      return `<div id="practice-nav-v26" class="practice-nav-v26"><b>答题卡</b><div class="practice-nav-grid-v26">${buttons}</div></div>`;
    }
    async function submitPractice(item, reveal) {
      return runMutation(async () => {
        const q = practiceQuestionV8916(item); const key = practiceItemKeyV8916(item);
        const chosen = collectAnswer('#practice-card', q);
        if (!hasAnswerValueV58914(chosen) && !reveal) {
          $('#p-feedback').innerHTML = '<div class="feedback warn">请先作答，再提交。</div>';
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
    function showAnsweredStateV26(q, st) {
      markOptions('#practice-card', q, st.chosen || []);
      const wrong = st.answered && st.correct === false && !st.revealed;
      let analysis = '';
      if (wrong) {
        analysis = renderReviewAnalysis(currentPracticeItemV8916(), st.chosen || [], `practice:${practiceSession.current.start}`);
      } else if (q.analysis) {
        analysis = `<br>解析：${renderQuestionContent(q.analysis)}`;
      }
      let feedbackClass = 'bad';
      let feedbackTitle = '✕ 这题要再看一遍';
      if (st.revealed) {
        feedbackClass = 'warn';
        feedbackTitle = '已显示参考答案';
      } else if (st.correct) {
        feedbackClass = 'ok';
        feedbackTitle = '✓ 回答正确';
      }
      $('#p-feedback').innerHTML = `<div class="feedback ${feedbackClass}"><b>${feedbackTitle}</b>${isMultiBlankQuestionV58914(q) ? renderMultiBlankComparisonV58914(q.blankAnswers, st.chosen || [], true) : `｜${feedbackAnswerHtmlV58914(q, st.chosen || [])}`}${analysis}</div>`;
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
    function showSubjectiveFeedback(item, chosen, reveal) {
      const q = practiceQuestionV8916(item); const key = practiceItemKeyV8916(item); const user = chosen.join('；') || '未填写';
      setPracticeAnswerStateV26(key, { chosen, revealed: !!reveal });
      $('#p-feedback').innerHTML = `<div class="feedback warn"><b>你的作答：</b><div class="q-multiline-text">${renderQuestionContent(user)}</div><b>参考答案：</b><div class="q-multiline-text">${renderQuestionContent(q.answer.join('；') || '未提供')}</div>${q.analysis ? `<b>解析：</b><div class="q-multiline-text">${renderQuestionContent(q.analysis)}</div>` : ''}<div class="actions"><button class="primary" id="p-self-right">判为正确</button><button class="danger" id="p-self-wrong">判为错误</button></div></div>`;
      $('#p-submit').disabled = true;
      $('#p-reveal').disabled = true;
      $('#p-self-right').onclick = async () => runMutation(async () => {
        recordPracticeAnswer(item, chosen, true);
        $('#p-self-right').disabled = true;
        $('#p-self-wrong').disabled = true;
        await saveSilent();
        renderStats();
        renderPracticeQuestion();
      });
      $('#p-self-wrong').onclick = async () => runMutation(async () => {
        recordPracticeAnswer(item, chosen, false);
        $('#p-self-right').disabled = true;
        $('#p-self-wrong').disabled = true;
        await saveSilent();
        renderStats();
        renderPracticeQuestion();
      });
      renderPracticeAiPanelV613();
    }
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
      practiceSession.current.details.push(makeAnswerDetail(item, chosen, ok, scoreOf(q), scoreOf(q)));
    }
    function openQuickPracticeSetup() {
      closeBankQuestionDetail();
      setPracticeBankScopeV8916(activeBank().id);
      resetAiSinglePracticeV613();
      exitPracticeFocus();
      practiceSession.current = { items: [], idx: 0, answered: 0, correct: 0, wrong: 0, start: 0, details: [], answerState: {} };
      $('#practice-card').innerHTML = '<div class="empty">请选择提交方式后点击“开始练习”。</div>';
      $('#practice-progress').textContent = '0 / 0';
      $('#practice-start-mode-v58916').value = PRACTICE_START_FROM_V58916;
      syncLimitControlV60('practice');
      renderPracticeScopeUiV8916();
      syncPracticeStartUiV58916(false);
      updateShellLayoutByView('practice');
      $('#practice-submit-mode').focus();
    }
    function switchPracticeSourceV27(source) {
      $$('.nav').forEach((b) => b.classList.remove('active'));
      document.querySelector('[data-view="practice"]').classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));
      $('#practice').classList.add('active');
      $('#page-title').textContent = '刷题练习';
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
      showAnsweredStateV26,
      showSubjectiveFeedback,
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
