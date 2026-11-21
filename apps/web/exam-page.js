// 将模拟考试的页面状态、作答、计时和成绩更新集中装配。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;
  // 使用应用注入的题库、保存和练习范围能力建立考试页面，考试轮次仍由会话持有。
  function create({
    session: examSession,
    state,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    now,
    makeId,
    question,
    practice,
    view,
    storage,
  }) {
    const {
      current: practiceQuestionV8916,
      key: practiceItemKeyV8916,
      bankId: practiceItemBankIdV8916,
      bankName: practiceItemBankNameV8916,
      isTextType,
      hasAnswer: hasAnswerValueV58914,
      score: scoreOf,
      sameAnswer: sameAnswerForQuestion,
      detail: makeAnswerDetail,
      collectText: collectTextAnswerFromElementV58914,
      html: questionHtml,
      applyAnswer: applyAnswerStateV26,
      bindOptions: bindAnswerOptionControls,
      collectAnswer,
      feedback: feedbackAnswerHtmlV58914,
      content: renderQuestionContent,
      markOptions,
    } = question;
    const {
      scope: practiceScopeV8916,
      scopeLabel: practiceScopeLabelV8916,
      scopeSummary: practiceScopeSummaryV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      filteredItems: filteredPracticeItemsV8916,
      reviewItems: trainingSessionItems,
      reviewData: buildTrainingReview,
      addWrong,
      markRight,
      activeBank,
    } = practice;
    const {
      restoreSidebar: restoreSidebarAfterFocusV47,
      collapseSidebar: autoCollapseSidebarForFocusV47,
      shell: updateShellLayoutByView,
      prewarmMath: prewarmMathJaxV56,
      bindRail: bindFocusRailToggleV34,
      renderAll,
      renderReviewAnalysis,
      updateReviewPanels: updateReviewAnalysisPanels,
      openReview: openTrainingReview,
    } = view;
    const {
      loadItems: loadNativeItems,
      isBusy: isMutationBusy,
      isReady: isApplicationReady,
      saveFailed: hasMutationSaveError,
      transaction: runMutation,
      save: saveSilent,
    } = storage;
    // 答题卡缓存只归当前试卷 DOM；重绘时从会话答案重建，交卷和回滚不修改缓存。
    let examAnswerCard = null;
    function examQuestionV113(item) {
      return practiceQuestionV8916(item);
    }

    function examItemKeyV113(item) {
      return practiceItemKeyV8916(item);
    }

    function examRenderQuestionV113(item) {
      const q = examQuestionV113(item);
      return { ...q, id: examItemKeyV113(item) };
    }

    function filteredExamItemsV113(type, order, count) {
      return filteredPracticeItemsV8916('all', type, order, count);
    }

    // 交卷前读取输入框里尚未持久化的文本作答，以当前考试题号键保存。
    function collectExamTextAnswers() {
      if (!examSession.current.items) {
        return;
      }

      examSession.current.items.forEach(/* 只补收需从文本输入框读取的题型，选项题沿用点击时保存的答案。 */ (item) => {
        const q = examQuestionV113(item); const key = examItemKeyV113(item);
        if (!isTextType(q.type)) {
          return;
        }

        const box = $(`#exam-card [data-qid="${globalThis.CSS.escape(key)}"]`);
        if (box) {
          examSession.current.answers[key] = collectTextAnswerFromElementV58914(box, q);
        }
      });
    }

    // 按各题的来源题库更新错题状态，以免分组考试写到当前题库。
    function addWrongOnExam(item, isWrong, chosen) {
      const q = examQuestionV113(item); const bid = practiceItemBankIdV8916(item);
      if (isWrong) {
        addWrong(q.id, bid, chosen);
      } else {
        markRight(q.id, bid);
      }
    }

    // 退出专注考试时清理布局状态，并恢复进入前的导航显示。
    function exitExamFocus() {
      document.body.classList.remove('exam-focus', 'exam-rail-collapsed-v34');
      restoreSidebarAfterFocusV47();
      const setup = $('#exam-setup');
      if (setup) {
        setup.style.display = '';
      }
    }

    // 只有最新考试启动仍有效且题目读取成功才替换当前轮次。
    async function startExam() {
      // eslint-disable-next-line no-plusplus -- setter 仍接受字符串和 BigInt；限定类型后才能移除此例外。
      const request = ++examSession.request;
      const isCurrentStart = () => request === examSession.request && isApplicationReady() && !isMutationBusy()
        && $('#exam')?.classList.contains('active');

      if (!isCurrentStart()) {
        return;
      }

      const count = Number($('#exam-count').value) || 50;
      const scope = practiceScopeV8916();
      const scopeLabel = practiceScopeLabelV8916(scope);
      const scopeSummary = practiceScopeSummaryV8916(scope);
      const selected = {
        name: ($('#exam-name').value || '模拟考试').trim(),
        passScore: Number($('#exam-pass-score').value) || 0,
        items: filteredExamItemsV113($('#exam-type').value, $('#exam-order').value, count),
        answers: {},
        start: Date.now(),
        deadline: 0,
        timer: null,
        submitted: false,
        scopeType: scope.type === PRACTICE_SCOPE_GROUP_V8916 ? 'GROUP' : 'BANK',
        scopeName: scopeLabel,
        scopeSummary,
      };
      if (!selected.items.length) {
        $('#exam-card').innerHTML = `<div class="empty">${i18n.html('exam.noQuestions')}</div>`;
        return;
      }

      if (!await loadNativeItems(selected.items, isCurrentStart) || !isCurrentStart()) {
        return;
      }

      globalThis.clearInterval(examSession.current.timer);
      examSession.current = selected;
      examSession.current.reviewItems = trainingSessionItems(examSession.current.items);
      const min = Number($('#exam-minutes').value) || 0;
      if (min > 0) {
        examSession.current.deadline = Date.now() + (min * 60000);
        startExamTicker(examSession.current);
      } else {
        i18n.bindText($('#exam-timer'), 'exam.untimed');
      }

      $('#submit-exam-btn').disabled = false;
      document.body.classList.add('exam-focus');
      autoCollapseSidebarForFocusV47();
      updateShellLayoutByView('exam');
      prewarmMathJaxV56();
      renderExamPaper();
    }

    // 重绑计时器前确认这仍是当前未交卷的计时考试。
    function startExamTicker(owner) {
      if (examSession.current !== owner || !owner.deadline || owner.submitted) {
        return;
      }

      globalThis.clearInterval(owner.timer);
      owner.timer = globalThis.setInterval(() => updateTimer(owner), 1000);

      updateTimer(owner);
    }

    // 按截止时间刷新剩余时间，旧轮次的滴答不触发新一轮交卷。
    function updateTimer(owner = examSession.current) {
      if (examSession.current !== owner) {
        return;
      }

      if (!examSession.current.deadline) {
        return;
      }

      const left = Math.max(0, examSession.current.deadline - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      const time = `${m}:${String(s).padStart(2, '0')}`;
      i18n.bindText($('#exam-timer'), 'exam.remaining', { time });
      const focusTimer = $('#exam-focus-timer');
      if (focusTimer) {
        i18n.bindText(focusTimer, 'exam.remaining', { time });
      }

      if (left <= 0) {
        submitExam(true);
      }
    }

    // 渲染当前试卷的作答区和答题卡，确保重绘保持已保存的选择。
    function renderExamPaper() {
      const timerText = examSession.current.deadline
        ? ($('#exam-timer')?.textContent || i18n.text('exam.timing')) : i18n.text('exam.untimed');
      let html = `<main class="exam-focus-main-v31"><div class="exam-focus-head"><div><b>${esc(examSession.current.name || i18n.text('exam.defaultName'))}</b><span id="exam-focus-timer">${esc(timerText)}</span>${examSession.current.scopeName ? `<span class="pill">${i18n.html('exam.scopeName', { scope: examSession.current.scopeName })}</span>` : ''}</div><div class="exam-head-actions"><button class="ghost mini-btn focus-mini-btn" id="exam-exit-focus" type="button">${i18n.html('exam.exit')}</button><button class="danger focus-mini-btn" id="exam-submit-focus" type="button">${i18n.html('exam.submit')}</button></div></div><div class="notice warn">${i18n.html('exam.scoringHelp')}</div>`;
      examSession.current.items.forEach((item, i) => {
        const key = examItemKeyV113(item);
        html += `<div class="exam-q" data-qid="${esc(key)}" id="exam-q-${i + 1}">${questionHtml(examRenderQuestionV113(item), true, i + 1)}</div>`;
      });

      html += `<div class="exam-focus-actions"><button class="danger" id="exam-submit-focus-bottom" type="button">${i18n.html('exam.submit')}</button></div></main><aside class="exam-side-v31">${renderExamAnswerCardV30()}</aside>`;
      $('#exam-card').innerHTML = html;
      $('#exam-submit-focus').onclick = () => submitExam(false);

      $('#exam-submit-focus-bottom').onclick = () => submitExam(false);

      $('#exam-exit-focus').onclick = /* 退出确认结束后再次验证原考试仍有效，防止清除等待期间启动的新轮次。 */ async () => {
        const session = examSession.current;
        if (!await globalThis.ShirohaDialogs.confirm(i18n.text('exam.confirmExit'))) {
          return;
        }

        // 确认框不暂停计时；到时交卷或切换会话后，迟到的退出不能清空成绩界面。
        if (examSession.current !== session || session.submitted) {
          return;
        }

        globalThis.clearInterval(examSession.current.timer);
        examSession.current = { items: [], answers: {}, start: 0, timer: null, deadline: 0, submitted: false };
        examAnswerCard = null;
        $('#exam-card').innerHTML = `<div class="empty">${i18n.html('exam.exited')}</div>`;
        $('#submit-exam-btn').disabled = true;
        i18n.bindText($('#exam-timer'), 'exam.notStarted');
        exitExamFocus();
      };

      bindExamAnswerCardV30();
      bindFocusRailToggleV34();
      const session = examSession.current;
      session.items.forEach(/* 用当前轮次与稳定的题目键绑定作答控件，已交卷或旧页面的控件不可再写入。 */ (item, index) => {
        const q = examQuestionV113(item); const key = examItemKeyV113(item); const root = `#exam-card [data-qid="${globalThis.CSS.escape(key)}"]`;
        const box = $(root);
        const canEdit = () => examSession.current === session && !session.submitted && !isMutationBusy()
          && box?.isConnected && $('#exam-card')?.contains(box);

        applyAnswerStateV26(root, q, session.answers[key] || []);
        bindAnswerOptionControls(root, q, index + 1, canEdit, () => {
          updateExamAnswerV30(session, key, collectAnswer(root, q));
        });

        box?.querySelectorAll('.text-answer').forEach(/* 文本作答随输入同步到答题卡，保留每题自己的收集范围。 */ (el) => {
          el.oninput = () => {
            if (!canEdit()) {
              return;
            }

            updateExamAnswerV30(session, key, collectTextAnswerFromElementV58914(box, q));
          };
        });
      });
    }

    function examAnsweredCountV30() {
      return (examSession.current.items || []).filter((item) => hasAnswerValueV58914((examSession.current.answers || {})[examItemKeyV113(item)] || [])).length;
    }

    // 根据已答题量及题目身份绘制考试答题卡，支持按序跳转。
    function renderExamAnswerCardV30() {
      const total = (examSession.current.items || []).length;
      const answered = examAnsweredCountV30();
      const remain = Math.max(0, total - answered);
      const indexes = new Map();
      const buttons = (examSession.current.items || []).map(/* 对答题卡使用稳定题目键，给控制选择的位置保留原题序。 */ (item, i) => {
        const key = examItemKeyV113(item);
        if (!indexes.has(key)) {
          indexes.set(key, []);
        }

        indexes.get(key).push(i);
        const done = hasAnswerValueV58914((examSession.current.answers || {})[key] || []);
        return `<button type="button" class="${done ? 'answered' : ''}" data-exam-jump="${i}" ${i18n.attribute('title', 'practice.navNumber', { number: i + 1 })}>${i + 1}</button>`;
      }).join('');
      examAnswerCard = { owner: examSession.current, answered, total, indexes, box: null, buttons: [] };
      return `<div id="exam-answer-card-v30" class="exam-answer-card-v30"><div class="exam-answer-card-head-v30"><div><b>${i18n.html('practice.nav')}</b><span data-exam-answer-summary>${i18n.html('exam.answerProgress', { answered, total, remaining: remain })}</span></div><div class="exam-answer-mini-stats-v30"><span>${i18n.html('exam.progress')}</span><b data-exam-answer-progress>${total ? Math.round(answered / total * 100) : 0}%</b></div><button class="rail-hide-btn-v34" data-rail-toggle-v34="exam" type="button" ${i18n.attribute('title', 'exam.hideSheet')}>${i18n.html('shell.hideArtwork')}</button></div><div class="exam-nav-grid-v30">${buttons}</div><button class="rail-show-btn-v34" data-rail-toggle-v34="exam" type="button" ${i18n.attribute('title', 'exam.showSheet')}>${i18n.html('practice.nav')}</button></div>`;
    }

    // 更新一题的作答后同步已答计数及答题卡状态，避免重复加减。
    function updateExamAnswerV30(session, key, answer) {
      const wasAnswered = hasAnswerValueV58914(session.answers[key] || []);
      const isAnswered = hasAnswerValueV58914(answer);
      session.answers[key] = answer;
      const card = examAnswerCard;
      if (!card || card.owner !== session || !card.box?.isConnected) {
        return;
      }

      const indexes = card.indexes.get(key) || [];
      if (wasAnswered !== isAnswered) {
        card.answered += isAnswered ? indexes.length : -indexes.length;
      }

      indexes.forEach((index) => card.buttons[index]?.classList.toggle('answered', isAnswered));

      i18n.bindText(card.summary, 'exam.answerProgress', {
        answered: card.answered,
        total: card.total,
        remaining: Math.max(0, card.total - card.answered),
      });
      card.progress.textContent = i18n.percent(card.total ? card.answered / card.total * 100 : 0);
    }

    // 在当前答题卡绑定滚动定位和选择状态更新。
    function bindExamAnswerCardV30() {
      const box = $('#exam-answer-card-v30');
      const buttons = $$('#exam-card [data-exam-jump]');
      if (examAnswerCard && examAnswerCard.owner === examSession.current && box) {
        examAnswerCard.box = box;
        examAnswerCard.buttons = buttons;
        examAnswerCard.summary = box.querySelector('[data-exam-answer-summary]');
        examAnswerCard.progress = box.querySelector('[data-exam-answer-progress]');
      }

      buttons.forEach(/* 给每个答题卡按钮建立对应的题号跳转入口。 */ (btn) => btn.onclick = /* 优先用题号锚点查找考试题项，兼容缺少新版锚点的旧渲染。 */ () => {
        const i = Number(btn.dataset.examJump);
        const target = $(`#exam-q-${i + 1}`) || $$('#exam-card .exam-q')[i];
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.classList.add('exam-q-pulse-v30');
          setTimeout(() => target.classList.remove('exam-q-pulse-v30'), 900);

          const focus = target.querySelector('input,textarea');
          if (focus) {
            focus.focus({ preventScroll: true });
          }
        }
      });
    }

    // 在交卷事务内逐题计分并更新错题，本轮原题快照交由调用方保存。
    function scoreCurrentExam() {
      let got = 0;
      let total = 0;
      let correct = 0;
      const details = [];
      const byType = {};
      examSession.current.items.forEach(/* 逐题累计分数和题型统计，同时保留来源题目与错题状态。 */ (item) => {
        const q = examQuestionV113(item); const key = examItemKeyV113(item);
        const sc = scoreOf(q);
        total += sc;
        const ans = examSession.current.answers[key] || [];
        const ok = sameAnswerForQuestion(q, ans, q.answer);
        if (ok) {
          got += sc;
          correct += 1;
        }

        addWrongOnExam(item, !ok, ans);
        details.push(makeAnswerDetail(item, {
          question: q, chosen: ans, correct: ok, score: sc, time: now(),
        }));
        const k = q.type || 'single';
        byType[k] = byType[k] || { total: 0, correct: 0, score: 0, fullScore: 0 };
        byType[k].total += 1;
        if (ok) {
          byType[k].correct += 1;
        }

        byType[k].score += ok ? sc : 0;
        byType[k].fullScore += sc;
      });

      return { got, total, correct, details, byType };
    }

    // 将收卷计分、训练记录和保存放在同一事务，自动交卷受存储错误状态保护。
    async function submitExam(auto) {
      if (auto && hasMutationSaveError()) {
        return false;
      }

      return runMutation(/* 只为当前未交的试卷记录一次成绩，并在保存成功后停止计时。 */ async () => {
        if (examSession.current.submitted) {
          return;
        }

        collectExamTextAnswers();
        examSession.current.submitted = true;
        const {
          got,
          total,
          correct,
          details,
          byType,
        } = scoreCurrentExam();
        const acc = Math.round(correct / examSession.current.items.length * 100);
        const groupMode = examSession.current.scopeType === 'GROUP';
        const firstItem = examSession.current.items[0] || null;
        const rec = {
          id: makeId('rec', 'exam'),
          name: examSession.current.name || '模拟考试',
          mode: '考试',
          bankId: groupMode ? '' : (practiceItemBankIdV8916(firstItem) || activeBank().id),
          bankName: groupMode ? (examSession.current.scopeName || '分组考试') : (practiceItemBankNameV8916(firstItem) || activeBank().name),
          scopeType: examSession.current.scopeType || 'BANK',
          scopeName: examSession.current.scopeName || practiceItemBankNameV8916(firstItem),
          total: examSession.current.items.length,
          answered: examAnsweredCountV30(),
          correct,
          wrong: examSession.current.items.length - correct,
          accuracy: acc,
          score: got,
          totalScore: total,
          passScore: examSession.current.passScore,
          passed: got >= Number(examSession.current.passScore || 0),
          autoSubmitted: !!auto,
          date: now(),
          duration: Math.round((Date.now() - examSession.current.start) / 1000),
          details,
          byType,
        };
        const reviewItems = examSession.current.reviewItems || trainingSessionItems(examSession.current.items);
        Object.assign(rec, buildTrainingReview(reviewItems, details, {
          completion: 'completed', submitMode: 'exam', timing: 'wall',
        }));
        state.records.unshift(rec);
        await saveSilent();
        globalThis.clearInterval(examSession.current.timer);
        $('#submit-exam-btn').disabled = true;
        i18n.bindText($('#exam-timer'), auto ? 'exam.autoSubmitted' : 'exam.submitted');
        renderExamResult(rec);
        renderAll();
      });
    }

    // 交卷后将原试卷替换为只读成绩与答题回顾，并清理动态答题卡引用。
    function renderExamResult(rec) {
      examAnswerCard = null;
      const typeRows = Object.entries(rec.byType || {}).map(([t, v]) => `<tr><td>${label(t)}</td><td>${v.correct}/${v.total}</td><td>${Number(v.score.toFixed ? v.score.toFixed(1) : v.score)}/${v.fullScore}</td></tr>`).join('');
      let html = `<div class="exam-focus-head"><div><b>${i18n.html('exam.results')}</b><span>${esc(rec.name || i18n.text('exam.defaultName'))}</span></div><div class="exam-head-actions"><button class="primary focus-mini-btn" id="exam-back-setup" type="button">${i18n.html('exam.backSetup')}</button></div></div><div class="score-card"><div class="metric"><span>${i18n.html('exam.score')}</span><b>${rec.score}/${rec.totalScore}</b></div><div class="metric"><span>${i18n.html('common.result')}</span><b>${i18n.html(rec.passed ? 'exam.passed' : 'exam.notPassed')}</b></div><div class="metric"><span>${i18n.html('practice.accuracy')}</span><b>${i18n.percent(rec.accuracy)}</b></div><div class="metric"><span>${i18n.html('practice.elapsed')}</span><b>${i18n.html('exam.seconds', { duration: rec.duration })}</b></div></div><div class="notice ${rec.passed ? 'ok' : 'warn'}">${i18n.html('exam.resultNotice', { name: rec.name || i18n.text('exam.defaultName'), score: rec.passScore })}${i18n.html(rec.autoSubmitted ? 'exam.autoSubmittedNotice' : 'exam.submittedNotice')}</div>${typeRows ? `<div class="table-wrap"><table><thead><tr><th>${i18n.html('practice.type')}</th><th>${i18n.html('practice.correct')}</th><th>${i18n.html('exam.score')}</th></tr></thead><tbody>${typeRows}</tbody></table></div>` : ''}`;
      examSession.current.items.forEach(/* 将成绩明细与原试题对齐以展示本轮选项、答案和解析。 */ (item, i) => {
        const q = examQuestionV113(item);
        const key = examItemKeyV113(item);
        const ans = examSession.current.answers[key] || [];
        const correct = sameAnswerForQuestion(q, ans, q.answer);
        let analysis = '';
        if (!correct) {
          analysis = renderReviewAnalysis(item, ans, `exam:${rec.id}`);
        } else if (q.analysis) {
          analysis = `<br>${i18n.html('question.analysis')}${renderQuestionContent(q.analysis)}`;
        }

        html += `<div class="exam-q" data-result-qid="${esc(key)}">${questionHtml(examRenderQuestionV113(item), true, i + 1)}<div class="feedback ${correct ? 'ok' : 'bad'}">${feedbackAnswerHtmlV58914(q, ans)}${analysis}</div></div>`;
      });

      $('#exam-card').innerHTML = html;
      $('#exam-card .exam-head-actions').insertAdjacentHTML('afterbegin', `<button type="button" class="ghost focus-mini-btn" id="exam-review-result">${i18n.html('practice.review')}</button>`);
      $('#exam-review-result').onclick = () => openTrainingReview(rec.id, 'exam');

      updateReviewAnalysisPanels();
      $('#exam-back-setup').onclick = () => exitExamFocus();

      examSession.current.items.forEach((item) => {
        const q = examQuestionV113(item); const key = examItemKeyV113(item);
        markOptions(`#exam-card [data-result-qid="${globalThis.CSS.escape(key)}"]`, q, examSession.current.answers[key] || []);
      });
    }

    return { exitExamFocus, startExam, startExamTicker, submitExam, examQuestionV113 };
  }

  globalThis.ShirohaExamPage = { create };
})();
