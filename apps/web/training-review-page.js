// 装配训练记录列表和复盘界面，保留跨页返回位置及按需数据读取。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;
  // 通过应用提供的存储、导航和渲染能力连接历史记录、复盘和错题重练。
  function create({
    state,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    short,
    formatDate: fmt,
    toast,
    platform: ShirohaPlatform,
    training: ShirohaTraining,
    paging,
    content,
    review,
    navigation,
    practice,
    actions = {},
  }) {
    const {
      visible: nativeViewVisible,
      begin: beginNativeRender,
      page: nativePage,
      versions: nativeRenderVersions,
      goToItem,
      restoreFocus: restorePageFocus,
      openRecords: nativeOpenRecords,
      loadItems: loadNativeItems,
      read: readNative,
    } = paging;
    const {
      blankAnswers: blankAnswersFromDetailV58914,
      blankUserAnswers: blankUserAnswersFromDetailV58914,
      normalizeType: normalizeWebQuestionType,
      questionContent: renderQuestionContent,
      questionBody: renderQuestionBodyV83,
      isMultiBlank: isMultiBlankQuestionV58914,
      multiBlankComparison: renderMultiBlankComparisonV58914,
      practiceAnswer: practiceReviewAnswerHtml,
      hasAnswer: hasAnswerValueV58914,
      options: renderReviewOptions,
    } = content;
    const {
      sessions: reviewAiSessions,
      analysis: renderReviewAnalysis,
      updatePanels: updateReviewAnalysisPanels,
      typeset: scheduleMathJaxTypesetV56,
    } = review;
    const {
      switchView: switchViewV45,
      exitPractice: exitPracticeFocus,
      exitExam: exitExamFocus,
      status: platformStatus,
    } = navigation;
    const {
      setup: openQuickPracticeSetup,
      groupName: bankGroupNameV58,
      setBank: setPracticeBankScopeV8916,
      setGroup: setPracticeGroupScopeV8916,
      baseItems: practiceBaseItemsV58916,
      scope: practiceScopeV8916,
      itemBankId: practiceItemBankIdV8916,
      question: practiceQuestionV8916,
      exactNumbers: formatExactPracticeNumbersV58916,
      renderScope: renderPracticeScopeUiV8916,
      syncMode: syncPracticeStartModeFieldsV58916,
    } = practice;
    const { transaction: runMutation, save: saveSilent, renderAll } = actions;
    // 复盘快照和请求序号仅属于当前页面；离开时释放引用并使迟到读取失效。
    let trainingReview = null; let trainingReviewRequest = 0; let bound = false;
    // 同一页面只处理一个删除确认；弹窗关闭或事务结束后释放。
    let recordDeletionPending = false;
    // 离开复盘时释放旧 AI 会话并使未完成的记录请求失效。
    function leaveTrainingReview() {
      releaseTrainingReviewAnalysis();
      trainingReviewRequest += 1;
      trainingReview = null;
      $('#training-review-content')?.replaceChildren();
    }

    // 通过页面事件代理复用记录按钮监听，避免重绘后重复注册。
    function bindTrainingReviewEvents() {
      if (bound) {
        return;
      }

      bound = true;
      document.addEventListener('click', /* 将当前可用的记录操作转为删除或打开复盘，并保留发起视图。 */ (event) => {
        const deleteButton = event.target.closest?.('[data-training-delete]');
        if (deleteButton && !deleteButton.disabled) {
          deleteTrainingRecord(deleteButton.dataset.trainingDelete);
          return;
        }

        const button = event.target.closest?.('[data-training-review]');
        if (button && !button.disabled) {
          openTrainingReview(button.dataset.trainingReview);
        }
      });
    }

    // 验证待删除记录的 ID 与当前索引，拒绝缺失或有冲突的历史标识。
    function recordDeletionTarget(id) {
      if (typeof id !== 'string' || !id.trim()) {
        toast(i18n.text('record.missingId'), 'warn');
        return null;
      }

      const matches = state.records.filter((record) => record && record.id === id);
      if (matches.length > 1) {
        toast(i18n.text('record.duplicateId'), 'warn');
        return null;
      }

      if (!matches.length) {
        toast(i18n.text('record.missingRecord'), 'warn');
        return null;
      }

      return matches[0];
    }

    function recordDeletionContext(record) {
      return [trainingTitle(record), record.bankName, fmt(record.date)].filter(Boolean).join(' · ');
    }

    // 此入口清空全部练习和考试记录。
    function clearRecords() {
      return runMutation(/* 确认、清理和保存属于同一次数据变更。 */ async () => {
        if (await globalThis.ShirohaDialogs.confirm(i18n.text('record.clearConfirm'))) {
          state.records = [];
          await saveSilent();
          renderAll();
        }
      });
    }

    // 删除操作等待用户确认，确认期间其他操作更改记录后需要再核对。
    async function deleteTrainingRecord(id) {
      if (recordDeletionPending) {
        return;
      }

      const target = recordDeletionTarget(id);
      if (!target) {
        return;
      }

      const context = recordDeletionContext(target);
      recordDeletionPending = true;
      try {
        const confirmed = await globalThis.ShirohaDialogs.confirm(
          i18n.text('record.deleteConfirm'),
          { title: i18n.text('record.deleteTitle'), acceptLabel: i18n.text('record.deleteAction'), context, danger: true },
        );
        if (!confirmed) {
          return;
        }

        await runMutation(/* 在保存事务中重新定位待删除记录，避免把其他记录误当成最初目标。 */ async () => {
          const current = recordDeletionTarget(id);
          if (!current) {
            return false;
          }

          if (recordDeletionContext(current) !== context) {
            toast(i18n.text('record.changedRecord'), 'warn');
            return false;
          }

          state.records = state.records.filter((record) => record.id !== id);

          await saveSilent();
          nativeOpenRecords.delete(id);
          renderAll();
          toast(i18n.text('record.deleted'), 'ok');
          window.requestAnimationFrame(() => {
            if ($('.view.active')?.id === 'records') {
              $('#record-mode-filter')?.focus({ preventScroll: true });
            }
          });
        });
      } finally {
        recordDeletionPending = false;
      }
    }

    // 优先按空位还原历史填空作答与答案，兼容旧记录的普通答案字段。
    function renderRecordAnswerCellV58914(detail, kind) {
      const groups = blankAnswersFromDetailV58914(detail);
      if (groups.length) {
        const users = blankUserAnswersFromDetailV58914(detail);
        return kind === 'user' ? `<div class="multi-blank-record-v58914">${groups.map((_, i) => `<span><b>${i18n.html('record.blankLabel', { number: i + 1 })}</b>${esc(users[i] || '未答')}</span>`).join('')}</div>` : `<div class="multi-blank-record-v58914">${groups.map((accepted, i) => `<span><b>${i18n.html('record.blankLabel', { number: i + 1 })}</b>${esc(accepted.join(' / ') || '未提供')}</span>`).join('')}</div>`;
      }

      const value = kind === 'user' ? ((detail.chosen || []).join('；') || '未答') : ((detail.answer || []).join('；') || '未提供');
      return normalizeWebQuestionType(detail && detail.type) === 'short' ? `<div class="q-multiline-text">${renderQuestionContent(value)}</div>` : esc(value);
    }

    /* SHIROHA_WEB_V38_5_RECORD_WRONG_ONLY_FILTER_START
   记录页“只看错题”同时作用于记录列表与展开明细；不修改历史记录数据。 */
    async function renderRecords() {
      if (!nativeViewVisible('records')) {
        return;
      }

      const renderVersion = beginNativeRender('records');
      const list = $('#records-list');
      let rows = [...state.records].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      const mode = $('#record-mode-filter')?.value || 'all';
      const detailFilter = $('#record-detail-filter-v385')?.value || 'all';
      const wrongOnly = detailFilter === 'wrong';
      if (mode !== 'all') {
        rows = rows.filter((r) => r.mode === mode);
      }

      if (wrongOnly) {
        rows = rows.filter((r) => (r.details || []).some((d) => d && d.correct === false) || Number(r.wrong || 0) > 0);
      }

      const lim = $('#record-limit')?.value || '30';
      if (lim !== 'all') {
        rows = rows.slice(0, Number(lim));
      }

      rows = nativePage(rows, `records:${mode}:${detailFilter}:${lim}`, list, renderRecords);
      const openIds = rows.filter((record) => nativeOpenRecords.has(record.id)).map((record) => record.id);
      const openDetails = [...list.querySelectorAll('[data-native-record]')].filter((node) => openIds.includes(node.dataset.nativeRecord));
      // toggle 事件可能晚于补读完成；用户已关闭的节点不能被旧读取重新展开。
      const isCurrentRead = () => renderVersion === nativeRenderVersions.get('records') && nativeViewVisible('records')
        && openDetails.every((node) => node.isConnected && node.open);

      if (ShirohaPlatform.storage.ensureRecords && !await readNative(() => ShirohaPlatform.storage.ensureRecords(state, openIds), isCurrentRead)) {
        return;
      }

      if (!isCurrentRead()) {
        return;
      }

      const emptyMessage = wrongOnly ? `<p class="muted">${i18n.html('record.noWrong')}</p>` : `<p class="muted">${i18n.html('record.empty')}</p>`;
      list.innerHTML = rows.length ? rows.map(/* 生成每条训练记录的摘要和详情，分组训练保留跨库来源。 */ (r) => {
        const showSource = r.scopeType === 'GROUP';
        const allDetails = r.details || [];
        const filteredDetails = wrongOnly ? allDetails.filter((d) => d && d.correct === false) : allDetails;
        const detail = filteredDetails.slice(0, 8).map((d, i) => `<tr><td>${i + 1}</td><td>${esc(short(d.question, 42))}${showSource && d.sourceBankName ? `<small class="record-source-v8916">${i18n.html('record.sourceBank', { name: d.sourceBankName })}</small>` : ''}</td><td>${renderRecordAnswerCellV58914(d, 'user')}</td><td>${renderRecordAnswerCellV58914(d, 'answer')}</td><td>${i18n.html(d.correct ? 'practice.correct' : 'practice.incorrect')}</td></tr>`).join('');
        let summary = i18n.html('record.historySummary', {
          total: r.total,
          answered: r.answered,
          correct: r.correct,
          wrong: r.wrong,
          accuracy: i18n.percent(r.accuracy),
        });
        if (r.score != null) {
          summary += i18n.html('record.historyScore', { score: r.score, total: r.totalScore });
        }

        if (r.score != null && r.passScore != null) {
          const result = i18n.text(r.passed ? 'exam.passed' : 'exam.notPassed');
          summary += i18n.html('record.historyPass', { score: r.passScore, result });
        }

        summary += i18n.html('record.historyDuration', { duration: r.duration });
        const needsDetailLoad = ShirohaPlatform.storage.lazy && !nativeOpenRecords.has(r.id);
        let detailSummary = i18n.html('record.detailsCount', { count: allDetails.length });
        if (needsDetailLoad) {
          detailSummary = i18n.html('record.details');
        } else if (wrongOnly) {
          detailSummary = i18n.html('record.detailsWrongCount', { count: filteredDetails.length });
        }

        return `<div class="record-item"><div class="training-history-row"><b>${esc(trainingTitle(r))}｜${esc(r.bankName)}｜${fmt(r.date)}</b><span>${trainingCompletion(r)}</span><span class="training-record-actions"><button type="button" class="ghost mini-btn" data-training-review="${esc(r.id)}">${i18n.html('practice.review')}</button><button type="button" class="ghost danger mini-btn" data-training-delete="${esc(r.id)}" ${i18n.attribute('aria-label', 'record.deleteLabel', { context: recordDeletionContext(r) })}>${i18n.html('common.delete')}</button></span></div><p class="muted">${summary}</p>${detail || ShirohaPlatform.storage.lazy ? `<details data-native-record="${esc(r.id)}" ${nativeOpenRecords.has(r.id) ? 'open' : ''}><summary>${detailSummary}</summary><div class="table-wrap"><table><thead><tr><th>#</th><th>${i18n.html('question.stem')}</th><th>${i18n.html('record.yourAnswer')}</th><th>${i18n.html('question.correctAnswer')}</th><th>${i18n.html('common.result')}</th></tr></thead><tbody>${detail}</tbody></table></div></details>` : ''}</div>`;
      }).join('') : emptyMessage;

      if (ShirohaPlatform.storage.lazy) {
        list.querySelectorAll('[data-native-record]').forEach(/* 只给尚需延迟加载的原生记录详情安装展开监听。 */ (element) => element.ontoggle = /* 接受最新展开请求并在原记录仍展开时渲染，避免关闭后回弹。 */ () => {
          const id = element.dataset.nativeRecord;
          if (element.open === nativeOpenRecords.has(id)) {
            return;
          }

          if (element.open) {
            nativeOpenRecords.add(id);
          } else {
            nativeOpenRecords.delete(id);
          }

          renderRecords();
        });
      }
    }

    /* SHIROHA_WEB_V38_5_RECORD_WRONG_ONLY_FILTER_END */
    function trainingCompletion(record) {
      const completion = record.reviewSummary?.completion || record.review?.completion;
      if (completion === 'completed') {
        return i18n.text('practice.completed');
      }

      if (completion === 'ended_early') {
        return i18n.text('practice.endedEarly');
      }

      return i18n.text('practice.historical');
    }

    // 记录原有的 mode 字段参与筛选，只在展示时转换两种已知模式。
    function trainingMode(mode) {
      const labels = { 练习: 'record.practice', 考试: 'record.exam' };
      return Object.hasOwn(labels, mode) ? i18n.text(labels[mode]) : mode;
    }

    function trainingTitle(record) {
      return record.name || record.scopeName || record.bankName || trainingMode(record.mode) || i18n.text('record.training');
    }

    // 首页只需要训练摘要，打开复盘时再读取历史题目。
    function recentTrainingCard(record) {
      const summary = i18n.text('home.recentSummary', {
        answered: record.answered,
        total: record.total,
        accuracy: i18n.percent(record.accuracy),
        duration: ShirohaTraining.formatDuration(record.duration),
      });
      return `<article class="training-history-row"><div><b>${esc(trainingTitle(record))}</b>
        <p class="muted">${esc(trainingMode(record.mode))} · ${esc(i18n.date(record.date))} · ${esc(trainingCompletion(record))}</p>
        <p>${esc(summary)}</p></div>
        <button type="button" class="ghost mini-btn" data-training-review="${esc(record.id)}">${i18n.html('practice.review')}</button>
      </article>`;
    }

    // 首页只展示最近训练摘要，让对应记录可进入复盘。
    function renderRecentTraining() {
      let box = $('#recent-training');
      if (!box) {
        box = document.createElement('section');
        box.id = 'recent-training';
        box.className = 'card recent-training';
        $('#dashboard')?.appendChild(box);
      }

      const records = [...state.records].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 3);
      const entries = records.length ? records.map(recentTrainingCard).join('') : `<p class="muted">${i18n.html('home.noRecords')}</p>`;
      box.innerHTML = `<div class="section-head"><h3>${i18n.html('home.recent')}</h3>
        <button type="button" class="ghost mini-btn" id="all-training-records">${i18n.html('home.allRecords')}</button></div>${entries}`;

      $('#all-training-records').onclick = () => switchViewV45('records');
    }

    // 打开复盘前确保目标记录可读，迟到的旧请求不能覆盖已切换视图。
    async function openTrainingReview(id, origin) {
      const record = state.records.find((value) => value.id === id);
      if (!record) {
        return;
      }

      trainingReviewRequest += 1; const request = trainingReviewRequest; const from = origin || $('.view.active')?.id || 'records';
      const focus = document.activeElement; const scroll = { window: window.scrollY, main: $('.main')?.scrollTop || 0 };
      const isCurrentRequest = () => request === trainingReviewRequest && $('.view.active')?.id === from;

      if (ShirohaPlatform.storage.ensureRecords && !await readNative(() => ShirohaPlatform.storage.ensureRecords(state, [id]), isCurrentRequest)) {
        if (isCurrentRequest()) {
          platformStatus(i18n.text('record.reviewLoadFailed'), true);
        }

        return;
      }

      if (!isCurrentRequest()) {
        return;
      }

      trainingReview = { record, origin: from, focus, scroll, filter: 'all', index: 0 };
      exitPracticeFocus();
      exitExamFocus();
      await switchViewV45('training-review');
      if (!$('#training-review.active')) {
        trainingReview = null;
        return;
      }

      await renderTrainingReview();
      if (trainingReview?.record === record) {
        $('#training-review-back')?.focus({ preventScroll: true });
      }
    }

    // 回到原页面时恢复发起控件，找不到原控件则使用当前视图的安全落点。
    async function closeTrainingReview() {
      const view = trainingReview;
      if (!view) {
        return;
      }

      trainingReview = null;
      trainingReviewRequest += 1;
      await switchViewV45(view.origin);
      if (view.origin === 'records') {
        await renderRecords();
      }

      window.requestAnimationFrame(/* 等目标页面已渲染后再恢复键盘焦点，避免把焦点留在已离开的复盘页。 */ () => {
        if ($('.view.active')?.id !== view.origin) {
          return;
        }

        window.scrollTo({ top: view.scroll.window, behavior: 'instant' });
        const main = $('.main');
        if (main) {
          main.scrollTop = view.scroll.main;
        }

        const fallback = [...($(`#${view.origin}`)?.querySelectorAll('[data-training-review]') || [])].find((button) => button.dataset.trainingReview === view.record.id);
        const focus = view.focus?.isConnected ? view.focus : fallback;
        focus?.focus({ preventScroll: true });
      });
    }

    // 清除已离开题目的旧 AI 解析会话，保持当前题可以继续操作。
    function releaseTrainingReviewAnalysis(keepKey = '') {
      $$('#training-review-content [data-review-analysis]').forEach(/* 仅释放不属于选中题的会话，并处理对应的请求生命周期。 */ (panel) => {
        const key = panel.dataset.reviewAnalysis;
        const session = reviewAiSessions.get(key);
        if (!session || key === keepKey) {
          return;
        }

        reviewAiSessions.remove(key);
      });
    }

    // 从记录中保存的题目快照还原历史题目，缺少快照时明确提示。
    function renderTrainingQuestion(row, recordId = '') {
      if (!row?.question) {
        return `<p class="notice">${i18n.html('record.missingSnapshot')}</p>`;
      }

      const q = { ...row.question, type: normalizeWebQuestionType(row.question.type || row.detail?.type) }; const chosen = row.chosen || []; const answer = q.answer || row.detail?.answer || [];
      const title = row.roundNumber
        ? i18n.html('record.roundQuestion', { number: row.roundNumber })
        : i18n.html('record.legacyQuestion', { number: row.index + 1 });
      const bankNumber = row.bankQuestionNumber
        ? i18n.html('question.bankPosition', { number: row.bankQuestionNumber })
        : i18n.html('record.bankNumberMissing');
      const stateLabels = { correct: 'record.rightMark', wrong: 'record.wrongMark', unanswered: 'record.unansweredMark', unrecorded: 'question.notRecorded' };
      const status = i18n.html(stateLabels[row.status]);
      const comparison = isMultiBlankQuestionV58914(q) ? renderMultiBlankComparisonV58914(q.blankAnswers, chosen, true) : `<div><b>${i18n.html('question.userAnswer')}</b>${practiceReviewAnswerHtml(q, chosen)}</div><div class="training-reference-answer"><b>${i18n.html(q.type === 'short' ? 'record.selfAssessAnswer' : 'question.correctAnswerLabel')}</b>${hasAnswerValueV58914(answer) ? practiceReviewAnswerHtml(q, answer) : i18n.html('question.noBankAnswer')}</div>`;
      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      return `<article class="training-question-content"><div class="qmeta"><b>${title}</b><span class="pill">${bankNumber}</span><span>${esc(label(q.type))}</span><span>${esc(row.bankName)}</span><b class="training-status-${row.status}">${status}</b></div>${row.partial ? `<p class="notice">${i18n.html('record.partialSnapshot')}</p>` : ''}<div class="question-title">${renderQuestionBodyV83(q)}</div>${renderReviewOptions({ ...q, answer }, chosen)}<div class="training-answer-comparison training-status-${row.status}">${comparison}</div>${row.revealed ? `<p class="muted">${i18n.html('record.revealed')}</p>` : ''}${hasAnswerValueV58914(row.draft) ? `<div class="notice"><b>${i18n.html('record.unsubmitted')}</b>${practiceReviewAnswerHtml(q, row.draft)}</div>` : ''}<div class="training-analysis">${renderReviewAnalysis({ bankId: row.bankId, question: { ...q, answer } }, chosen, 'training:' + recordId + ':' + row.index)}</div></article>`;
    }

    // 各导航控件共享当前复盘视图，重绘后继续使用对应条目和分页位置。
    function bindTrainingReviewNavigation(view, card, filtered, position) {
      $('#training-review-back').onclick = closeTrainingReview;
      $$('[data-training-filter]').forEach((button) => button.onclick = () => {
        view.filter = button.dataset.trainingFilter;
        renderTrainingReview();
      });

      $$('[data-training-question]').forEach(/* 每个答题卡按钮都更新本次复盘的题目索引。 */ (button) => button.onclick = /* 重新渲染后确认题目仍选中，再滚动到题目区域。 */ async () => {
        const index = Number(button.dataset.trainingQuestion);
        view.index = index;
        await renderTrainingReview();
        if (trainingReview === view && view.index === index) {
          $('#training-question')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      });

      // 上下题导航同时更新答题卡页码，保持新题和操作按钮可定位。
      const jump = async (offset) => {
        const row = filtered[position + offset];
        if (!row) {
          return;
        }

        view.index = row.index;
        goToItem(card.id, position + offset);
        await renderTrainingReview();
        if (trainingReview === view && view.index === row.index) {
          $(offset > 0 ? '#training-next' : '#training-prev')?.focus({ preventScroll: true });
        }
      };

      $('#training-prev').onclick = () => jump(-1);

      $('#training-next').onclick = () => jump(1);
    }

    // 维护当前复盘题和筛选分页，仅补读当前选中的原生解析。
    async function renderTrainingReview() {
      const view = trainingReview;
      if (!view || !$('#training-review.active')) {
        return;
      }

      const renderVersion = beginNativeRender('training-review');
      const { record } = view; const rows = ShirohaTraining.reviewRows(record); const counts = { correct: 0, wrong: 0, unanswered: 0, unrecorded: 0 };
      rows.forEach((row) => {
        counts[row.status] += 1;
      });

      const filtered = rows.filter((row) => view.filter === 'all' || row.status === view.filter);
      if (filtered.length && !filtered.some((row) => row.index === view.index)) {
        view.index = filtered[0].index;
      }

      const position = filtered.findIndex((row) => row.index === view.index); const selected = filtered[position];
      const selectedAnalysisKey = selected?.question
        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        ? JSON.stringify(['training:' + record.id + ':' + selected.index, selected.bankId || '', selected.question.id || ''])
        : '';
      // 补读可能异步完成，切题时先释放旧会话，避免迟到响应继续绑定旧页面。
      releaseTrainingReviewAnalysis(selectedAnalysisKey);
      const needsSourceAnalysis = selected?.question && selected.bankId && !String(selected.question.analysis || '').trim();
      if (needsSourceAnalysis) {
        const isCurrentRead = () => trainingReview === view && renderVersion === nativeRenderVersions.get('training-review')
          && !!$('#training-review.active');

        // 桌面摘要不含解析；只补读当前选题，切题或离开后的迟到读取不能重绘旧页面。
        if (!await loadNativeItems([{ bankId: selected.bankId, question: selected.question }], isCurrentRead)) {
          return;
        }

        if (!isCurrentRead()) {
          return;
        }
      }

      const missing = Math.max(0, Number(record.total || 0) - rows.length); const meta = record.reviewSummary;
      const denominator = meta?.submitMode === 'single' ? record.answered : record.total;
      const box = $('#training-review-content');
      box.dataset.recordId = record.id;
      const active = box.contains(document.activeElement) ? document.activeElement : null;
      const focused = active?.getAttribute('data-training-filter'); const focusedQuestion = active?.getAttribute('data-training-question'); const focusedPage = active?.dataset.pageControl;
      let backLabel = i18n.text('nav.records');
      if (view.origin === 'dashboard') {
        backLabel = i18n.text('nav.home');
      } else if (view.origin === 'practice' || view.origin === 'exam') {
        backLabel = i18n.text('record.roundResults');
      }

      const submissionKeys = { single: 'record.singleSubmission', total: 'record.totalSubmission', exam: 'record.examSubmission' };
      const submission = meta && submissionKeys[meta.submitMode];
      const detailCount = meta
        ? i18n.html(meta.submitMode === 'single' ? 'record.judgedRatio' : 'record.roundRatio', { correct: record.correct, total: denominator })
        : i18n.html('record.legacyAccuracy');
      const timing = i18n.html(meta?.timing === 'active' ? 'record.pauseExcluded' : 'record.legacyDuration');
      const filterButtons = [
        ['all', 'practice.allQuestions', rows.length],
        ['correct', 'practice.correct', counts.correct],
        ['wrong', 'practice.incorrect', counts.wrong],
        ['unanswered', 'question.notAnswered', counts.unanswered],
      ].map(([key, message, count]) => `<button type="button" class="ghost mini-btn" data-training-filter="${key}" aria-pressed="${view.filter === key}">${i18n.html(message)} ${i18n.number(count)}</button>`).join('');
      box.innerHTML = `<button type="button" class="ghost mini-btn" id="training-review-back">${i18n.html('record.back', { view: backLabel })}</button><div class="section-head"><div><h2>${esc(trainingTitle(record))}</h2><p class="muted">${esc(fmt(record.date))} · ${esc(trainingMode(record.mode))} · ${submission ? i18n.html(submission) : ''} · ${trainingCompletion(record)}</p></div></div><div class="score-card"><div class="metric"><span>${i18n.html('practice.correct')}</span><b>${counts.correct}</b></div><div class="metric"><span>${i18n.html('record.answeredWrong')}</span><b>${counts.wrong}</b></div><div class="metric"><span>${i18n.html('question.notAnswered')}</span><b>${counts.unanswered}</b></div><div class="metric"><span>${i18n.html('practice.elapsed')}</span><b>${ShirohaTraining.formatDuration(record.duration)}</b></div></div><p class="muted">${i18n.html('record.reviewAccuracy', { accuracy: i18n.percent(record.accuracy) })}${detailCount} · ${timing}</p>${missing ? `<p class="notice">${i18n.html('record.legacyMissing', { count: missing })}</p>` : ''}${meta && meta.submitMode !== 'single' && counts.unanswered ? `<p class="notice">${i18n.html('record.unansweredScoring')}</p>` : ''}<div class="training-filters" ${i18n.attribute('aria-label', 'record.filters')}>${filterButtons}</div><div id="training-answer-card" class="training-answer-card" ${i18n.attribute('aria-label', 'record.answerSheet')}></div><p class="muted">${i18n.html('record.legend')}</p><section id="training-question" ${i18n.attribute('aria-label', 'record.selectedQuestion')}>${selected ? renderTrainingQuestion(selected, record.id) : `<p class="empty" role="status">${i18n.html('record.noMatch')}</p>`}</section><div class="actions"><button type="button" class="ghost" id="training-prev" ${position <= 0 ? 'disabled' : ''}>${i18n.html('practice.prev')}</button><button type="button" class="ghost" id="training-next" ${position < 0 || position === filtered.length - 1 ? 'disabled' : ''}>${i18n.html('practice.next')}</button><button type="button" class="primary" id="training-retry" ${counts.wrong ? '' : 'disabled'}>${i18n.html('record.retryWrong', { count: counts.wrong })}</button></div>`;

      updateReviewAnalysisPanels();
      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      const card = $('#training-answer-card'); const pageRows = nativePage(filtered, 'training:' + record.id + ':' + view.filter, card, renderTrainingReview);
      card.innerHTML = pageRows.map((row) => `<button type="button" class="training-status-${row.status}" data-training-question="${row.index}" aria-label="${row.roundNumber ? `第 ${row.roundNumber} 题` : `明细第 ${row.index + 1} 条`}，${{ correct: '正确', wrong: '错误', unanswered: '未作答', unrecorded: '未记录' }[row.status]}" aria-pressed="${view.index === row.index}">${row.roundNumber || row.index + 1} ${{ correct: '✓', wrong: '×', unanswered: '—', unrecorded: '?' }[row.status]}</button>`).join('');

      bindTrainingReviewNavigation(view, card, filtered, position);
      $('#training-retry').onclick = /* 按原题身份检查重练是否仍可用，跨库时只选择当前记录中的错题。 */ async () => {
        const wrongRows = rows.filter((row) => row.status === 'wrong');
        const available = wrongRows.every((row) => state.banks.find((bank) => bank.id === row.bankId)?.questions.some((q) => q.id === row.question.id));
        if (!available) {
          toast(i18n.text('record.retryMissing'), 'warn');
          return;
        }

        const first = wrongRows[0];
        if (!first) {
          return;
        }

        const banks = state.banks.filter((bank) => wrongRows.some((row) => row.bankId === bank.id)); const groups = new Set(banks.map(bankGroupNameV58));
        if (banks.length > 1 && groups.size !== 1) {
          toast(i18n.text('record.retryAcrossGroups'), 'warn');
          return;
        }

        await switchViewV45('practice');
        openQuickPracticeSetup();
        if (banks.length === 1) {
          setPracticeBankScopeV8916(first.bankId);
        } else {
          setPracticeGroupScopeV8916([...groups][0]);
        }

        $('#practice-source').value = 'all';
        $('#practice-type').value = 'all';
        $('#practice-order').value = 'sequence';
        $('#practice-start-mode-v58916').value = 'custom';
        const base = practiceBaseItemsV58916('all', 'all', practiceScopeV8916());
        const selectedNumbers = base.map(/* 将复盘错题映射到当前候选顺序，保留题库与题目双重身份。 */ (item, index) => {
          const belongsToWrongRows = wrongRows.some((row) => (
            row.bankId === practiceItemBankIdV8916(item)
&& row.question.id === practiceQuestionV8916(item).id
          ));
          return belongsToWrongRows ? index + 1 : null;
        }).filter(Boolean);
        $('#practice-number-range-v58916').value = formatExactPracticeNumbersV58916(selectedNumbers);
        renderPracticeScopeUiV8916();
        syncPracticeStartModeFieldsV58916();
      };

      if (focused) {
        box.querySelector(`[data-training-filter="${focused}"]`)?.focus({ preventScroll: true });
      }

      if (focusedQuestion) {
        box.querySelector(`[data-training-question="${focusedQuestion}"]`)?.focus({ preventScroll: true });
      }

      restorePageFocus(box, focusedPage);
      scheduleMathJaxTypesetV56(box);
    }

    return {
      renderRecords,
      clearRecords,
      trainingCompletion,
      trainingTitle,
      renderRecentTraining,
      openTrainingReview,
      renderTrainingQuestion,
      leaveTrainingReview,
      bindTrainingReviewEvents,
    };
  }

  globalThis.ShirohaTrainingReviewPage = { create };
})();
