(() => {
  'use strict';
  function create({ session: practiceSession, practiceAi: practiceAiSessions, reviewAi: reviewAiSessions,
    select: $, selectAll: $$, escape: esc, question, settings, actions }) {
    const { currentItem: currentPracticeItemV8916, question: practiceQuestionV8916, key: practiceItemKeyV8916,
      answer: getPracticeAnswerStateV26, hasImages: aiSingleHasImagesV613, source: reviewAnalysisSource,
      content: renderQuestionContent } = question;
    const { config: aiExecutionConfigV99, configured: aiConfiguredV99, availability: aiAvailabilityV99, request: aiRequestConfigV99, isHarness: isAiHarnessExecutionV99,
      label: aiExecutionLabelV99, privacy: aiHarnessPrivacyV99 } = settings;
    const { practiceSession: aiSingleSessionV613, runPractice: runAiSingleAnalysisV613,
      followUp: runAiSingleFollowUpV613, save: saveAiSingleAnalysisV613, runReview: runReviewAnalysis,
      saveReview: saveReviewAnalysis, exitPractice: exitPracticeFocus, exitExam: exitExamFocus,
      switchView: switchViewV45, isReady: isApplicationReady, retryReadiness } = actions;
    let reviewEventsBound = false;
    function aiSingleAllowedV613(item) {
      return !!item && !practiceSession.current.completed;
    }
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
    function renderPracticeAiPanelV613() {
      const box = $('#p-ai-v613');
      if (!box) {
        return;
      }
      const item = currentPracticeItemV8916();
      if (!item) {
        box.innerHTML = '';
        return;
      }
      const q = practiceQuestionV8916(item); const key = practiceItemKeyV8916(item); const st = getPracticeAnswerStateV26(key);
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
      const entryText = result || hasSavedAnalysis ? '查看 AI 解析' : 'AI 解析';
      let panelStatus = result ? '已生成' : '按需生成';
      if (hasSavedAnalysis) {
        panelStatus = '已保存';
      }
      if (busy) {
        panelStatus = session.loading === 'followUp' ? '追问中……' : '生成中……';
      }
      if (!session.expanded) {
        box.className = 'practice-ai-entry-v613';
        box.innerHTML = `<button class="ghost mini-btn" type="button" data-ai-single-open-v613="1" aria-expanded="false">${busy ? 'AI 解析中……' : entryText}</button>`;
        bindPracticeAiPanelV613();
        return;
      }
      box.className = 'practice-ai-panel-v613';
      const { configured, config } = aiSingleConfigV613();
      const availability = aiAvailabilityV99(config, 'question_analysis');
      const retryable = (availability.state === 'error' || availability.state === 'blocked') && availability.retryable;
      const needsSettings = !configured && availability.state !== 'checking' && !retryable;
      const isHarness = isAiHarnessExecutionV99(config.execution);
      const generationDisabled = !configured || busy;
      const blocks = [`<div class="practice-ai-head-v613"><div><b>AI 单题解析</b><span>${configured || isHarness ? esc(aiExecutionLabelV99(config)) + (config.model ? ` · ${esc(config.model)}` : '') : '尚未配置 AI 服务'}</span></div><span class="pill practice-ai-status-v613${busy ? ' is-busy' : ''}">${panelStatus}</span></div>`];
      if (!configured) {
        blocks.push(`<p class="practice-ai-hint-v613" role="status" aria-live="polite" aria-busy="${availability.state === 'checking'}">${esc(availability.reason)}</p>`);
      }
      blocks.push(`<div class="actions practice-ai-actions-v613"><button class="ghost mini-btn" type="button" data-ai-single-close-v613="1" aria-expanded="true">收起 AI 面板</button>${busy ? '<button class="ghost mini-btn" type="button" data-ai-single-stop-v613="1">停止请求</button>' : ''}</div>`);
      if (aiSingleHasImagesV613(item)) {
        blocks.push('<p class="practice-ai-warn-v613">本次仅发送文字，未发送题目图片；AI 无法读取图表细节，请人工核对。</p>');
      }
      if (isHarness) {
        blocks.push(`<p class="practice-ai-hint-v613">${esc(aiHarnessPrivacyV99(config, '本题文字、参考答案、作答及追问记录'))}</p>`);
      }
      if (result) {
        let match = '';
        if (result.matchesLocalAnswer !== null) {
          match = result.matchesLocalAnswer ? '｜与题库答案一致' : '｜与题库答案可能不一致，请人工确认';
        }
        const saved = !!String(result.analysis || '').trim() && String(q.analysis || '').trim() === String(result.analysis || '').trim();
        blocks.push(`<p class="practice-ai-meta-v613"><span class="pill practice-ai-confidence-v613 is-${result.confidence.toLowerCase()}">${aiSingleConfidenceLabelV613(result.confidence)}</span><span>AI 参考答案：${esc(result.suggestedAnswer || '未给出')}${esc(match)}</span></p>`);
        blocks.push(`<div class="practice-ai-text-v613">${result.analysis ? renderQuestionContent(result.analysis) : '<span class="muted">AI 未生成可靠解析。</span>'}</div>`);
        if (result.needsReview) {
          blocks.push('<p class="practice-ai-warn-v613">需要人工确认：AI 对本题答案没有把握，请自行核对后再决定是否写入题库。</p>');
        }
        if (result.warning) {
          blocks.push(`<p class="practice-ai-note-v613">${esc(result.warning)}</p>`);
        }
        blocks.push(`<div class="actions practice-ai-actions-v613"><button class="primary mini-btn" type="button" data-ai-single-save-v613="1" ${(!result.analysis || busy || saved) ? 'disabled' : ''}>${saved ? '已写入题库解析' : '保存到题库解析'}</button><button class="ghost mini-btn" type="button" data-ai-single-analysis-v613="1" ${generationDisabled ? 'disabled' : ''}>重新生成</button><button class="ghost mini-btn" type="button" data-ai-single-follow-v613="1" ${busy ? 'disabled' : ''}>${session.followUpOpen ? '收起追问' : '追问'}</button></div>`);
      } else if (hasSavedAnalysis) {
        blocks.push(`<p class="practice-ai-hint-v613">题库已保存解析</p><div class="practice-ai-text-v613">${renderQuestionContent(savedAnalysis)}</div>`);
        blocks.push(`<div class="actions practice-ai-actions-v613"><button class="ghost mini-btn" type="button" data-ai-single-analysis-v613="1" ${generationDisabled ? 'disabled' : ''}>重新生成</button>${needsSettings ? '<button class="ghost mini-btn" type="button" data-ai-single-settings-v613="1">前往 AI 设置</button>' : ''}${retryable ? '<button class="ghost mini-btn" type="button" data-ai-single-retry-v613="1">重试检查</button>' : ''}</div>`);
      } else {
        blocks.push('<p class="practice-ai-hint-v613">只把当前这道题的题干、选项、答案和你的作答发给 AI，生成一段简短解析；结果先作为草稿，确认后再写入题库。</p>');
        blocks.push(`<div class="actions practice-ai-actions-v613"><button class="primary mini-btn" type="button" data-ai-single-analysis-v613="1" ${generationDisabled ? 'disabled' : ''}>${busy ? '生成中……' : 'AI 解析'}</button>${needsSettings ? '<button class="ghost mini-btn" type="button" data-ai-single-settings-v613="1">前往 AI 设置</button>' : ''}${retryable ? '<button class="ghost mini-btn" type="button" data-ai-single-retry-v613="1">重试检查</button>' : ''}</div>`);
      }
      if (result && !configured) {
        blocks.push(`<div class="actions practice-ai-actions-v613">${needsSettings ? '<button class="ghost mini-btn" type="button" data-ai-single-settings-v613="1">前往 AI 设置</button>' : ''}${retryable ? '<button class="ghost mini-btn" type="button" data-ai-single-retry-v613="1">重试检查</button>' : ''}</div>`);
      }
      if (session.error) {
        blocks.push(`<p class="notice warn practice-ai-message-v613">${esc(session.error)}</p>`);
      }
      if (session.notice) {
        blocks.push(`<p class="notice ok practice-ai-message-v613">${esc(session.notice)}</p>`);
      }
      if (session.messages.length) {
        blocks.push(`<div class="practice-ai-chat-v613"><b>追问记录</b>${session.messages.map((message) => `<div class="practice-ai-msg-v613 is-${message.role}"><span>${message.role === 'user' ? '你' : 'AI'}</span><div>${message.role === 'user' ? esc(message.content) : renderQuestionContent(message.content)}</div></div>`).join('')}</div>`);
      }
      if (session.followUpOpen && result) {
        blocks.push(`<div class="practice-ai-follow-v613"><textarea id="practice-ai-follow-input-v613" rows="2" placeholder="例如：为什么 C 选项不对？" ${busy ? 'disabled' : ''}>${esc(session.draft || '')}</textarea><button class="primary mini-btn" type="button" data-ai-single-send-v613="1" ${generationDisabled ? 'disabled' : ''}>发送追问</button></div>`);
      }
      const focusedInput = document.activeElement?.id === 'practice-ai-follow-input-v613' && box.contains(document.activeElement) ? document.activeElement : null;
      const selection = focusedInput ? [focusedInput.selectionStart, focusedInput.selectionEnd, focusedInput.selectionDirection] : null;
      box.innerHTML = blocks.join('');
      bindPracticeAiPanelV613();
      const restoredInput = focusedInput && $('#practice-ai-follow-input-v613');
      if (restoredInput && selection) { restoredInput.focus({ preventScroll: true });restoredInput.setSelectionRange(...selection); }
    }
    function bindPracticeAiPanelV613() {
      const open = $('#p-ai-v613 [data-ai-single-open-v613]');
      if (open) {
        open.onclick = () => {
          const item = currentPracticeItemV8916(); const session = aiSingleSessionV613(practiceItemKeyV8916(item));
          session.expanded = true;
          renderPracticeAiPanelV613();
          if (!session.analysis && !session.loading && !String(practiceQuestionV8916(item).analysis || '').trim() && aiSingleConfigV613().configured) {
            runAiSingleAnalysisV613();
          }
        };
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
        follow.onclick = () => {
          const session = aiSingleSessionV613(practiceItemKeyV8916(currentPracticeItemV8916()));
          session.followUpOpen = !session.followUpOpen;
          renderPracticeAiPanelV613();
          const input = $('#practice-ai-follow-input-v613');
          if (input) {
            input.focus();
          }
        };
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
      if (retry) { retry.onclick = () => { void retryReadiness(); }; }
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
      return `<section class="review-analysis" data-review-analysis="${esc(key)}" aria-label="题目解析" aria-live="polite">${reviewAnalysisContent(session)}</section>`;
    }
    function reviewAnalysisContent(session) {
      const text = reviewAnalysisText(session.item); const result = session.analysis;
      const config = aiExecutionConfigV99();
      const configured = !isApplicationReady() || aiConfiguredV99(config, 'question_analysis');
      const availability = aiAvailabilityV99(config, 'question_analysis');
      const retryable = (availability.state === 'error' || availability.state === 'blocked') && availability.retryable;
      const title = '<b class="review-analysis-title">解析</b>';
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
        return `<div class="review-analysis-head"><b class="review-analysis-title">AI 解析草稿</b><span class="pill">草稿 · 未保存</span></div><p class="muted">AI 参考答案：${esc(result.suggestedAnswer || '未给出')}${esc(match)} · ${aiSingleConfidenceLabelV613(result.confidence)}</p><div class="q-multiline-text">${renderQuestionContent(result.analysis)}</div>${result.needsReview ? '<p class="review-analysis-warning">需要人工核对后再决定是否保存。</p>' : ''}${result.warning ? `<p class="review-analysis-warning">${esc(result.warning)}</p>` : ''}<p class="muted">AI 生成内容仅供参考，请核对后保存。</p>${error}${configured ? '' : `<p role="status">${esc(availability.reason)}</p>`}<div class="actions">${button('save', session.saving ? '保存中…' : '保存到题库解析', true, session.saving)}${button('generate', '重新生成', false, session.saving || !configured)}${button('discard', '放弃草稿', false, session.saving)}${retryable ? button('retry', '重试检查') : ''}${!configured && !retryable && availability.state !== 'checking' ? button('settings', '前往 AI 设置') : ''}</div>`;
      }
      if (text) {
        return `<div class="review-analysis-head">${title}${session.saved ? '<span class="review-analysis-saved" role="status">✓ 已保存到题库解析</span>' : ''}</div><div class="q-multiline-text">${renderQuestionContent(text)}</div>`;
      }
      let action = button('generate', 'AI 生成解析', true);
      if (availability.state === 'checking' && !configured) { action = button('generate', 'AI 生成解析', true, true); } else if (!configured) { action = retryable ? button('retry', '重试检查', true) : button('settings', '前往 AI 设置', true); }
      return `${title}<div class="review-analysis-empty"><span class="muted">暂无解析</span>${action}</div><p class="muted" role="status" aria-busy="${availability.state === 'checking'}">${configured ? '仅发送本题题干、选项、答案和你的作答；生成后由你确认保存。' : esc(availability.reason)}</p>${error}${session.notice ? `<p class="muted">${esc(session.notice)}</p>` : ''}`;
    }
    function updateReviewAnalysisPanels() {
      const mounted = new Set();
      $$('[data-review-analysis]').forEach((panel) => {
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
      });
      reviewAiSessions.retain(mounted);
    }
    function bindReviewAnalysisEvents() {
      if (reviewEventsBound) {
        return;
      }
      reviewEventsBound = true;
      document.addEventListener('click', async (event) => {
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
      });
    }
    return { aiSingleAllowedV613, aiSingleConfigV613, renderPracticeAiPanelV613, renderReviewAnalysis, updateReviewAnalysisPanels, bindReviewAnalysisEvents };
  }
  globalThis.ShirohaAiQuestionPanels = { create };
})();
