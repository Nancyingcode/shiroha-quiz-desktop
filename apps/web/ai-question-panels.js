// 渲染练习与复盘中的 AI 解析入口，并把用户操作交给所属会话。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;
  // 绑定题目、会话和设置依赖，供练习与复盘共用解析组件。
  function create({
    session: practiceSession,
    practiceAi: practiceAiSessions,
    reviewAi: reviewAiSessions,
    select: $,
    selectAll: $$,
    escape: esc,
    question,
    settings,
    actions,
  }) {
    const {
      currentItem: currentPracticeItemV8916,
      question: practiceQuestionV8916,
      key: practiceItemKeyV8916,
      answer: getPracticeAnswerStateV26,
      hasImages: aiSingleHasImagesV613,
      source: reviewAnalysisSource,
      content: renderQuestionContent,
    } = question;
    const {
      config: aiExecutionConfigV99,
      configured: aiConfiguredV99,
      availability: aiAvailabilityV99,
      request: aiRequestConfigV99,
      isHarness: isAiHarnessExecutionV99,
      label: aiExecutionLabelV99,
      privacy: aiHarnessPrivacyV99,
    } = settings;
    const {
      practiceSession: aiSingleSessionV613,
      runPractice: runAiSingleAnalysisV613,
      followUp: runAiSingleFollowUpV613,
      save: saveAiSingleAnalysisV613,
      runReview: runReviewAnalysis,
      saveReview: saveReviewAnalysis,
      exitPractice: exitPracticeFocus,
      exitExam: exitExamFocus,
      switchView: switchViewV45,
      isReady: isApplicationReady,
      retryReadiness,
    } = actions;
    let reviewEventsBound = false;
    function aiSingleAllowedV613(item) {
      return !!item && !practiceSession.current.completed;
    }

    // 将模型置信度映射为用户可读的提示，低置信时强调信息不足。
    function aiSingleConfidenceLabelV613(confidence) {
      if (confidence === 'HIGH') {
        return '高置信';
      }

      if (confidence === 'LOW') {
        return '信息不足';
      }

      return '中等置信';
    }

    function aiSingleConfigV613() {
      const config = aiExecutionConfigV99();
      return { configured: aiConfiguredV99(config, 'question_analysis'), config, requestConfig: aiRequestConfigV99(config) };
    }

    // 草稿区同时展示核对提示与保存状态，避免把未确认结果当成题库解析。
    function appendPracticeDraft(blocks, q, session, result, generationDisabled, busy) {
      let match = '';
      if (result.matchesLocalAnswer !== null) {
        match = result.matchesLocalAnswer ? '｜与题库答案一致' : '｜与题库答案可能不一致，请人工确认';
      }

      const saved = !!String(result.analysis || '').trim() && String(q.analysis || '').trim() === String(result.analysis || '').trim();
      blocks.push(`<p class="practice-ai-meta-v613"><span class="pill practice-ai-confidence-v613 is-${result.confidence.toLowerCase()}">${aiSingleConfidenceLabelV613(result.confidence)}</span><span>${i18n.html('ai.referenceAnswer')}${result.suggestedAnswer ? esc(result.suggestedAnswer) : i18n.html('question.notProvided')}${esc(match)}</span></p>`);
      blocks.push(`<div class="practice-ai-text-v613">${result.analysis ? renderQuestionContent(result.analysis) : `<span class="muted">${i18n.html('ai.noExplanation')}</span>`}</div>`);
      if (result.needsReview) {
        blocks.push(`<p class="practice-ai-warn-v613">${i18n.html('ai.manualCheckAnswer')}</p>`);
      }

      if (result.warning) {
        blocks.push(`<p class="practice-ai-note-v613">${esc(result.warning)}</p>`);
      }

      blocks.push(`<div class="actions practice-ai-actions-v613"><button class="primary mini-btn" type="button" data-ai-single-save-v613="1" ${(!result.analysis || busy || saved) ? 'disabled' : ''}>${i18n.html(saved ? 'ai.writtenExplanation' : 'ai.saveExplanation')}</button><button class="ghost mini-btn" type="button" data-ai-single-analysis-v613="1" ${generationDisabled ? 'disabled' : ''}>${i18n.html('ai.regenerate')}</button><button class="ghost mini-btn" type="button" data-ai-single-follow-v613="1" ${busy ? 'disabled' : ''}>${i18n.html(session.followUpOpen ? 'ai.hideFollowUp' : 'ai.askFollowUp')}</button></div>`);
    }

    // 对话区保留错误、草稿和追问状态，生成期间禁用输入及重复发送。
    function appendPracticeConversation(blocks, session, result, busy, generationDisabled) {
      if (session.error) {
        blocks.push(`<p class="notice warn practice-ai-message-v613">${esc(session.error)}</p>`);
      }

      if (session.notice) {
        blocks.push(`<p class="notice ok practice-ai-message-v613">${esc(session.notice)}</p>`);
      }

      if (session.messages.length) {
        blocks.push(`<div class="practice-ai-chat-v613"><b>${i18n.html('ai.followUpHistory')}</b>${session.messages.map((message) => `<div class="practice-ai-msg-v613 is-${message.role}"><span>${message.role === 'user' ? i18n.html('ai.you') : 'AI'}</span><div>${message.role === 'user' ? esc(message.content) : renderQuestionContent(message.content)}</div></div>`).join('')}</div>`);
      }

      if (session.followUpOpen && result) {
        blocks.push(`<div class="practice-ai-follow-v613"><textarea id="practice-ai-follow-input-v613" rows="2" ${i18n.attribute('placeholder', 'ai.followUpExample')} ${busy ? 'disabled' : ''}>${esc(session.draft || '')}</textarea><button class="primary mini-btn" type="button" data-ai-single-send-v613="1" ${generationDisabled ? 'disabled' : ''}>${i18n.html('ai.sendFollowUp')}</button></div>`);
      }
    }

    // 按当前作答状态决定解析入口，并在重绘时保留追问光标。
    function renderPracticeAiPanelV613() {
      const box = $('#p-ai-v613');
      if (!box) {
        return;
      }

      const item = currentPracticeItemV8916();
      const key = item ? practiceItemKeyV8916(item) : null;
      practiceAiSessions.select($('#practice')?.classList.contains('active') ? key : null);
      if (!item) {
        box.innerHTML = '';
        return;
      }

      const q = practiceQuestionV8916(item); const st = getPracticeAnswerStateV26(key);
      if (!aiSingleAllowedV613(item)) {
        box.innerHTML = '';
        return;
      }

      const review = reviewAiSessions.get(JSON.stringify([`practice:${practiceSession.current.start}`, item.bankId || '', q.id || '']));
      const inlineWrongAnalysis = st.answered && st.correct === false && (!String(q.analysis || '').trim() || !!review?.analysis);
      if (inlineWrongAnalysis) {
        box.innerHTML = '';
        return;
      }

      const session = aiSingleSessionV613(key); const result = session.analysis; const busy = !!session.loading;
      const savedAnalysis = String(q.analysis || '').trim();
      const hasSavedAnalysis = !result && !!savedAnalysis;
      const entryText = result || hasSavedAnalysis ? 'ai.viewExplanation' : 'ai.entry';
      let panelStatus = result ? 'ai.explanationReady' : 'ai.explanationAvailable';
      if (hasSavedAnalysis) {
        panelStatus = 'ai.explanationStored';
      }

      if (busy) {
        panelStatus = session.loading === 'followUp' ? 'ai.followUpBusy' : 'ai.generatingExplanation';
      }

      if (!session.expanded) {
        box.className = 'practice-ai-entry-v613';
        box.innerHTML = `<button class="ghost mini-btn" type="button" data-ai-single-open-v613="1" aria-expanded="false">${i18n.html(busy ? 'ai.entryBusy' : entryText)}</button>`;
        bindPracticeAiPanelV613();
        return;
      }

      box.className = 'practice-ai-panel-v613';
      const { configured, config } = aiSingleConfigV613();
      const availability = aiAvailabilityV99(config, 'question_analysis');
      const { retryable } = availability;
      const needsSettings = !configured && availability.state !== 'checking' && !retryable;
      const isHarness = isAiHarnessExecutionV99(config.execution);
      const generationDisabled = !configured || busy;
      const blocks = [`<div class="practice-ai-head-v613"><div><b>${i18n.html('ai.singleExplanation')}</b><span>${configured || isHarness ? esc(aiExecutionLabelV99(config)) + (config.model ? ` · ${esc(config.model)}` : '') : i18n.html('ai.notConfigured')}</span></div><span class="pill practice-ai-status-v613${busy ? ' is-busy' : ''}">${i18n.html(panelStatus)}</span></div>`];
      if (!configured) {
        blocks.push(`<p class="practice-ai-hint-v613" role="status" aria-live="polite" aria-busy="${availability.state === 'checking'}">${esc(availability.reason)}</p>`);
      }

      blocks.push(`<div class="actions practice-ai-actions-v613"><button class="ghost mini-btn" type="button" data-ai-single-close-v613="1" aria-expanded="true">${i18n.html('ai.collapsePanel')}</button>${busy ? `<button class="ghost mini-btn" type="button" data-ai-single-stop-v613="1">${i18n.html('ai.stopRequest')}</button>` : ''}</div>`);
      if (aiSingleHasImagesV613(item)) {
        blocks.push(`<p class="practice-ai-warn-v613">${i18n.html('ai.imagesExcluded')}</p>`);
      }

      if (isHarness) {
        blocks.push(`<p class="practice-ai-hint-v613">${esc(aiHarnessPrivacyV99(config, '本题文字、参考答案、作答及追问记录'))}</p>`);
      }

      if (result) {
        appendPracticeDraft(blocks, q, session, result, generationDisabled, busy);
      } else if (hasSavedAnalysis) {
        blocks.push(`<p class="practice-ai-hint-v613">${i18n.html('ai.savedExplanation')}</p><div class="practice-ai-text-v613">${renderQuestionContent(savedAnalysis)}</div>`);
        blocks.push(`<div class="actions practice-ai-actions-v613"><button class="ghost mini-btn" type="button" data-ai-single-analysis-v613="1" ${generationDisabled ? 'disabled' : ''}>${i18n.html('ai.regenerate')}</button>${needsSettings ? `<button class="ghost mini-btn" type="button" data-ai-single-settings-v613="1">${i18n.html('import.openAi')}</button>` : ''}${retryable ? `<button class="ghost mini-btn" type="button" data-ai-single-retry-v613="1">${i18n.html('import.aiRetryCheck')}</button>` : ''}</div>`);
      } else {
        blocks.push(`<p class="practice-ai-hint-v613">${i18n.html('ai.singleHint')}</p>`);
        blocks.push(`<div class="actions practice-ai-actions-v613"><button class="primary mini-btn" type="button" data-ai-single-analysis-v613="1" ${generationDisabled ? 'disabled' : ''}>${i18n.html(busy ? 'ai.generatingExplanation' : 'ai.entry')}</button>${needsSettings ? `<button class="ghost mini-btn" type="button" data-ai-single-settings-v613="1">${i18n.html('import.openAi')}</button>` : ''}${retryable ? `<button class="ghost mini-btn" type="button" data-ai-single-retry-v613="1">${i18n.html('import.aiRetryCheck')}</button>` : ''}</div>`);
      }

      if (result && (needsSettings || retryable)) {
        blocks.push(`<div class="actions practice-ai-actions-v613">${needsSettings ? `<button class="ghost mini-btn" type="button" data-ai-single-settings-v613="1">${i18n.html('import.openAi')}</button>` : ''}${retryable ? `<button class="ghost mini-btn" type="button" data-ai-single-retry-v613="1">${i18n.html('import.aiRetryCheck')}</button>` : ''}</div>`);
      }

      appendPracticeConversation(blocks, session, result, busy, generationDisabled);

      const focusedInput = document.activeElement?.id === 'practice-ai-follow-input-v613' && box.contains(document.activeElement) ? document.activeElement : null;
      const selection = focusedInput ? [focusedInput.selectionStart, focusedInput.selectionEnd, focusedInput.selectionDirection] : null;
      box.innerHTML = blocks.join('');
      bindPracticeAiPanelV613();
      const restoredInput = focusedInput && $('#practice-ai-follow-input-v613');
      if (restoredInput && selection) { restoredInput.focus({ preventScroll: true });restoredInput.setSelectionRange(...selection); }
    }

    // 展开当前题的解析区，只有缺少可用解析且服务已配置时才触发生成。
    function openPracticeAnalysis() {
      const item = currentPracticeItemV8916(); const session = aiSingleSessionV613(practiceItemKeyV8916(item));
      session.expanded = true;
      renderPracticeAiPanelV613();
      if (!session.analysis && !session.loading && !String(practiceQuestionV8916(item).analysis || '').trim() && aiSingleConfigV613().configured) {
        runAiSingleAnalysisV613();
      }
    }

    // 切换当前题的追问区，展开后将键盘焦点交给输入框。
    function togglePracticeFollowUp() {
      const session = aiSingleSessionV613(practiceItemKeyV8916(currentPracticeItemV8916()));
      session.followUpOpen = !session.followUpOpen;
      renderPracticeAiPanelV613();
      const input = $('#practice-ai-follow-input-v613');
      if (input) {
        input.focus();
      }
    }

    // 在练习解析面板重绘后绑定新控件，事件始终操作当前题目。
    function bindPracticeAiPanelV613() {
      const open = $('#p-ai-v613 [data-ai-single-open-v613]');
      if (open) {
        open.onclick = openPracticeAnalysis;
      }

      const close = $('#p-ai-v613 [data-ai-single-close-v613]');
      if (close) {
        close.onclick = () => {
          aiSingleSessionV613(practiceItemKeyV8916(currentPracticeItemV8916())).expanded = false;
          renderPracticeAiPanelV613();
        };
      }

      const stop = $('#p-ai-v613 [data-ai-single-stop-v613]');
      if (stop) {
        stop.onclick = () => {
          const session = aiSingleSessionV613(practiceItemKeyV8916(currentPracticeItemV8916()));
          practiceAiSessions.stop(session);
        };
      }

      const analysis = $('#p-ai-v613 [data-ai-single-analysis-v613]');
      if (analysis) {
        analysis.onclick = () => runAiSingleAnalysisV613();
      }

      const follow = $('#p-ai-v613 [data-ai-single-follow-v613]');
      if (follow) {
        follow.onclick = togglePracticeFollowUp;
      }

      const save = $('#p-ai-v613 [data-ai-single-save-v613]');
      if (save) {
        save.onclick = () => saveAiSingleAnalysisV613();
      }

      const settings = $('#p-ai-v613 [data-ai-single-settings-v613]');
      if (settings) {
        settings.onclick = async () => {
          exitPracticeFocus();
          await switchViewV45('ai-settings');
        };
      }

      const retry = $('#p-ai-v613 [data-ai-single-retry-v613]');
      if (retry) {
        retry.onclick = () => {
          void retryReadiness();
        };
      }

      const send = $('#p-ai-v613 [data-ai-single-send-v613]');
      if (send) {
        send.onclick = () => runAiSingleFollowUpV613();
      }

      const input = $('#practice-ai-follow-input-v613');
      if (input) {
        input.oninput = () => {
          aiSingleSessionV613(practiceItemKeyV8916(currentPracticeItemV8916())).draft = input.value;
        };

        input.onkeydown = (event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            runAiSingleFollowUpV613();
          }
        };
      }
    }

    // 优先显示当前题目解析，快照缺少解析时查询来源题。
    function reviewAnalysisText(item) {
      const q = practiceQuestionV8916(item); const local = String(q.analysis || '').trim();
      if (local) {
        return local;
      }

      const { bank, index } = reviewAnalysisSource(item);
      return String(bank?.questions[index]?.analysis || '').trim();
    }

    function renderReviewAnalysis(item, chosen, scope) {
      const q = practiceQuestionV8916(item); const key = JSON.stringify([scope, item.bankId || '', q.id || '']);
      const session = reviewAiSessions.getOrCreate(key, item, chosen);
      return `<section class="review-analysis" data-review-analysis="${esc(key)}" lang="zh-CN" ${i18n.attribute('aria-label', 'ai.questionExplanation')} aria-live="polite">${reviewAnalysisContent(session)}</section>`;
    }

    // 根据读取、草稿、保存和服务就绪状态展示复盘操作。
    function reviewAnalysisContent(session) {
      const text = reviewAnalysisText(session.item); const result = session.analysis;
      const config = aiExecutionConfigV99();
      const configured = !isApplicationReady() || aiConfiguredV99(config, 'question_analysis');
      const availability = aiAvailabilityV99(config, 'question_analysis');
      const { retryable } = availability;
      const title = `<b class="review-analysis-title">${i18n.html('editor.analysis')}</b>`;
      const button = (action, label, primary = false, disabled = false) => `<button type="button" class="${primary ? 'primary' : 'ghost'} mini-btn" data-review-ai="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;

      const error = session.error ? `<p class="review-analysis-warning" role="alert">${esc(session.error)}</p>` : '';
      if (session.loading) {
        return `${title}<p role="status">正在生成 AI 解析…</p><p class="muted">生成后核对草稿，再保存到题库。${result ? '已有草稿已保留。' : ''}</p><div class="actions">${button('stop', '停止生成')}</div>`;
      }

      if (result && !session.saved) {
        let match = '';
        if (result.matchesLocalAnswer !== null) {
          match = result.matchesLocalAnswer ? ' · 与题库答案一致' : ' · 与题库答案可能不一致，请人工确认';
        }

        return `<div class="review-analysis-head"><b class="review-analysis-title">${i18n.html('ai.explanationDraft')}</b><span class="pill">${i18n.html('ai.unsavedDraft')}</span></div><p class="muted">${i18n.html('ai.referenceAnswer')}${result.suggestedAnswer ? esc(result.suggestedAnswer) : i18n.html('question.notProvided')}${esc(match)} · ${aiSingleConfidenceLabelV613(result.confidence)}</p><div class="q-multiline-text">${renderQuestionContent(result.analysis)}</div>${result.needsReview ? `<p class="review-analysis-warning">${i18n.html('ai.checkBeforeSaving')}</p>` : ''}${result.warning ? `<p class="review-analysis-warning">${esc(result.warning)}</p>` : ''}<p class="muted">${i18n.html('ai.generatedHint')}</p>${error}${configured ? '' : `<p role="status">${esc(availability.reason)}</p>`}<div class="actions">${button('save', session.saving ? '保存中…' : '保存到题库解析', true, session.saving)}${button('generate', '重新生成', false, session.saving || !configured)}${button('discard', '放弃草稿', false, session.saving)}${retryable ? button('retry', '重试检查') : ''}${!configured && !retryable && availability.state !== 'checking' ? button('settings', '前往 AI 设置') : ''}</div>`;
      }

      if (text) {
        return `<div class="review-analysis-head">${title}${session.saved ? `<span class="review-analysis-saved" role="status">${i18n.html('ai.savedMark')}</span>` : ''}</div><div class="q-multiline-text">${renderQuestionContent(text)}</div>`;
      }

      let action = button('generate', 'AI 生成解析', true);
      if (availability.state === 'checking' && !configured) { action = button('generate', 'AI 生成解析', true, true); } else if (!configured) { action = retryable ? button('retry', '重试检查', true) : button('settings', '前往 AI 设置', true); }

      return `${title}<div class="review-analysis-empty"><span class="muted">暂无解析</span>${action}</div><p class="muted" role="status" aria-busy="${availability.state === 'checking'}">${configured ? '仅发送本题题干、选项、答案和你的作答；生成后由你确认保存。' : esc(availability.reason)}</p>${error}${session.notice ? `<p class="muted">${esc(session.notice)}</p>` : ''}`;
    }

    // 重绘单道复盘题后恢复原按钮焦点，保留键盘用户的操作位置。
    function updateReviewAnalysisPanel(panel, mounted) {
      const key = panel.dataset.reviewAnalysis; const session = reviewAiSessions.get(key);
      if (!session) {
        return;
      }

      mounted.add(key);
      const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.reviewAi : null;
      panel.innerHTML = reviewAnalysisContent(session);
      panel.classList.toggle('is-empty', !reviewAnalysisText(session.item) && !session.analysis);
      const checking = aiAvailabilityV99(aiExecutionConfigV99(), 'question_analysis').state === 'checking';
      panel.setAttribute('aria-busy', String(!!session.loading || session.saving || checking));
      if (focused) {
        panel.querySelector(`[data-review-ai="${focused}"]`)?.focus({ preventScroll: true });
      }
    }

    // 刷新已挂载的复盘解析区，并停止已离开页面的会话。
    function updateReviewAnalysisPanels() {
      const mounted = new Set();
      $$('[data-review-analysis]').forEach((panel) => updateReviewAnalysisPanel(panel, mounted));

      reviewAiSessions.retain(mounted);
    }

    // 保留离开后可继续使用的复盘草稿，并让当前页的挂载拒收旧请求。
    function cancelPendingReviewAnalysis(view) {
      const panels = view.querySelectorAll('[data-review-analysis]');
      if (!panels.length) {
        return;
      }

      panels.forEach((panel) => {
        reviewAiSessions.cancelPending(panel.dataset.reviewAnalysis);
      });

      updateReviewAnalysisPanels();
    }

    // 只路由当前已挂载解析区的操作，写入期间保留草稿与正在保存的状态。
    async function handleReviewAnalysisClick(event) {
      const button = event.target.closest?.('[data-review-ai]'); const panel = button?.closest('[data-review-analysis]');
      const session = panel && reviewAiSessions.get(panel.dataset.reviewAnalysis);
      if (!session || button.disabled) {
        return;
      }

      const action = button.dataset.reviewAi;
      if (action === 'generate') {
        await runReviewAnalysis(session);
        return;
      }

      if (action === 'save') {
        await saveReviewAnalysis(session);
        return;
      }

      if (action === 'settings') {
        exitPracticeFocus();
        exitExamFocus();
        await switchViewV45('ai-settings');
        return;
      }

      if (action === 'retry') { await retryReadiness(); return; }

      if (session.saving) {
        return;
      }

      if (action === 'stop') {
        reviewAiSessions.stop(session);
      }

      if (action === 'discard') {
        reviewAiSessions.discard(session);
      }

      updateReviewAnalysisPanels();
    }

    // 通过唯一的委托监听器处理反复重绘的复盘面板。
    function bindReviewAnalysisEvents() {
      if (reviewEventsBound) {
        return;
      }

      reviewEventsBound = true;
      document.addEventListener('click', handleReviewAnalysisClick);
    }

    return {
      aiSingleAllowedV613,
      aiSingleConfigV613,
      renderPracticeAiPanelV613,
      renderReviewAnalysis,
      updateReviewAnalysisPanels,
      bindReviewAnalysisEvents,
      cancelPendingReviewAnalysis,
    };
  }

  globalThis.ShirohaAiQuestionPanels = { create };
})();
