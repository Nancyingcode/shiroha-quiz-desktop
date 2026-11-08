(() => {
  'use strict';
  function create({ state, select: $, selectAll: $$, escape: esc, label, short, formatDate: fmt, toast,
    platform: ShirohaPlatform, training: ShirohaTraining, paging, content, review, navigation, practice }) {
    const { visible: nativeViewVisible, begin: beginNativeRender, page: nativePage, versions: nativeRenderVersions,
      pages: nativePages, openRecords: nativeOpenRecords, loadItems: loadNativeItems, read: readNative } = paging;
    const { blankAnswers: blankAnswersFromDetailV58914, blankUserAnswers: blankUserAnswersFromDetailV58914,
      normalizeType: normalizeWebQuestionType, questionContent: renderQuestionContent, questionBody: renderQuestionBodyV83,
      isMultiBlank: isMultiBlankQuestionV58914, multiBlankComparison: renderMultiBlankComparisonV58914,
      practiceAnswer: practiceReviewAnswerHtml, hasAnswer: hasAnswerValueV58914, options: renderReviewOptions } = content;
    const { sessions: reviewAiSessions, analysis: renderReviewAnalysis, updatePanels: updateReviewAnalysisPanels,
      typeset: scheduleMathJaxTypesetV56 } = review;
    const { switchView: switchViewV45, exitPractice: exitPracticeFocus, exitExam: exitExamFocus, status: platformStatus } = navigation;
    const { setup: openQuickPracticeSetup, groupName: bankGroupNameV58, setBank: setPracticeBankScopeV8916,
      setGroup: setPracticeGroupScopeV8916, baseItems: practiceBaseItemsV58916, scope: practiceScopeV8916,
      itemBankId: practiceItemBankIdV8916, question: practiceQuestionV8916, exactNumbers: formatExactPracticeNumbersV58916,
      renderScope: renderPracticeScopeUiV8916, syncMode: syncPracticeStartModeFieldsV58916 } = practice;
    // 复盘快照和请求序号仅属于当前页面；离开时释放引用并使迟到读取失效。
    let trainingReview = null; let trainingReviewRequest = 0; let bound = false;
    function leaveTrainingReview() {
      releaseTrainingReviewAnalysis();
      trainingReviewRequest++;
      trainingReview = null;
      $('#training-review-content')?.replaceChildren();
    }
    function bindTrainingReviewEvents() {
      if (bound) {
        return;
      }
      bound = true;
      document.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-training-review]');
        if (button && !button.disabled) {
          openTrainingReview(button.dataset.trainingReview);
        }
      });
    }
    function renderRecordAnswerCellV58914(detail, kind) {
      const groups = blankAnswersFromDetailV58914(detail);
      if (groups.length) {
        const users = blankUserAnswersFromDetailV58914(detail);
        return kind === 'user' ? `<div class="multi-blank-record-v58914">${groups.map((_, i) => `<span><b>第${i + 1}空：</b>${esc(users[i] || '未答')}</span>`).join('')}</div>` : `<div class="multi-blank-record-v58914">${groups.map((accepted, i) => `<span><b>第${i + 1}空：</b>${esc(accepted.join(' / ') || '未提供')}</span>`).join('')}</div>`;
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
      rows = nativePage(rows, 'records:' + mode + ':' + detailFilter + ':' + lim, list, renderRecords);
      if (ShirohaPlatform.storage.ensureRecords && !await readNative(() => ShirohaPlatform.storage.ensureRecords(state, rows.filter((r) => nativeOpenRecords.has(r.id)).map((r) => r.id)))) {
        return;
      }
      if (renderVersion !== nativeRenderVersions.get('records') || !nativeViewVisible('records')) {
        return;
      }
      const emptyMessage = wrongOnly ? '<p class="muted">当前筛选范围内暂无含错题的练习或考试记录。</p>' : '<p class="muted">暂无练习或考试记录。</p>';
      list.innerHTML = rows.length ? rows.map((r) => {
        const showSource = r.scopeType === 'GROUP';
        const allDetails = r.details || [];
        const filteredDetails = wrongOnly ? allDetails.filter((d) => d && d.correct === false) : allDetails;
        const detail = filteredDetails.slice(0, 8).map((d, i) => `<tr><td>${i + 1}</td><td>${esc(short(d.question, 42))}${showSource && d.sourceBankName ? `<small class="record-source-v8916">来源：${esc(d.sourceBankName)}</small>` : ''}</td><td>${renderRecordAnswerCellV58914(d, 'user')}</td><td>${renderRecordAnswerCellV58914(d, 'answer')}</td><td>${d.correct ? '正确' : '错误'}</td></tr>`).join('');
        const summary = `题数${r.total}｜已答${r.answered}｜正确${r.correct}｜错误${r.wrong}｜正确率${r.accuracy}%${r.score != null ? `｜得分${r.score}/${r.totalScore}${r.passScore != null ? `｜及格线${r.passScore}｜${r.passed ? '合格' : '未合格'}` : ''}` : ''}｜用时${r.duration}秒`;
        const needsDetailLoad = ShirohaPlatform.storage.lazy && !nativeOpenRecords.has(r.id);
        let detailSummary = `查看作答明细（前8题 / 共${allDetails.length}题）`;
        if (needsDetailLoad) {
          detailSummary = '查看作答明细';
        } else if (wrongOnly) {
          detailSummary = `查看错题明细（前8题 / 共${filteredDetails.length}道错题）`;
        }
        return `<div class="record-item"><div class="training-history-row"><b>${esc(trainingTitle(r))}｜${esc(r.bankName)}｜${fmt(r.date)}</b><span>${trainingCompletion(r)}</span><button type="button" class="ghost mini-btn" data-training-review="${esc(r.id)}">查看复盘</button></div><p class="muted">${summary}</p>${detail || ShirohaPlatform.storage.lazy ? `<details data-native-record="${esc(r.id)}" ${nativeOpenRecords.has(r.id) ? 'open' : ''}><summary>${detailSummary}</summary><div class="table-wrap"><table><thead><tr><th>#</th><th>题干</th><th>你的答案</th><th>正确答案</th><th>结果</th></tr></thead><tbody>${detail}</tbody></table></div></details>` : ''}</div>`;
      }).join('') : emptyMessage;
      if (ShirohaPlatform.storage.lazy) {
        list.querySelectorAll('[data-native-record]').forEach((element) => element.ontoggle = () => {
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
        return '已完成';
      }
      if (completion === 'ended_early') {
        return '提前结束';
      }
      return '历史记录';
    }
    function trainingTitle(record) {
      return record.name || record.scopeName || record.bankName || record.mode || '训练';
    }
    function renderRecentTraining() {
      let box = $('#recent-training');
      if (!box) {
        box = document.createElement('section');
        box.id = 'recent-training';
        box.className = 'card recent-training';
        $('#dashboard')?.appendChild(box);
      }
      const records = [...state.records].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 3);
      box.innerHTML = `<div class="section-head"><h3>最近训练</h3><button type="button" class="ghost mini-btn" id="all-training-records">全部记录 →</button></div>${records.length ? records.map((record) => `<article class="training-history-row"><div><b>${esc(trainingTitle(record))}</b><p class="muted">${esc(record.mode)} · ${esc(fmt(record.date))} · ${trainingCompletion(record)}</p><p>已答 ${record.answered}/${record.total} · 正确率 ${record.accuracy}% · 用时 ${ShirohaTraining.formatDuration(record.duration)}</p></div><button type="button" class="ghost mini-btn" data-training-review="${esc(record.id)}">查看复盘</button></article>`).join('') : '<p class="muted">还没有训练记录。开始练习后，可在这里查看每轮答题情况。</p>'}`;
      $('#all-training-records').onclick = () => switchViewV45('records');
    }
    async function openTrainingReview(id, origin) {
      const record = state.records.find((value) => value.id === id);
      if (!record) {
        return;
      }
      const request = ++trainingReviewRequest; const from = origin || $('.view.active')?.id || 'records';
      const focus = document.activeElement; const scroll = { window: window.scrollY, main: $('.main')?.scrollTop || 0 };
      if (ShirohaPlatform.storage.ensureRecords && !await readNative(() => ShirohaPlatform.storage.ensureRecords(state, [id]))) {
        platformStatus('复盘加载失败，请再次点击查看复盘重试。', true);
        return;
      }
      if (request !== trainingReviewRequest || $('.view.active')?.id !== from) {
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
    async function closeTrainingReview() {
      const view = trainingReview;
      if (!view) {
        return;
      }
      trainingReview = null;
      trainingReviewRequest++;
      await switchViewV45(view.origin);
      if (view.origin === 'records') {
        await renderRecords();
      }
      window.requestAnimationFrame(() => {
        if ($('.view.active')?.id !== view.origin) {
          return;
        }
        window.scrollTo({ top: view.scroll.window, behavior: 'instant' });
        const main = $('.main');
        if (main) {
          main.scrollTop = view.scroll.main;
        }
        const fallback = [...($('#' + view.origin)?.querySelectorAll('[data-training-review]') || [])].find((button) => button.dataset.trainingReview === view.record.id);
        const focus = view.focus?.isConnected ? view.focus : fallback;
        focus?.focus({ preventScroll: true });
      });
    }
    function releaseTrainingReviewAnalysis(keepKey = '') {
      $$('#training-review-content [data-review-analysis]').forEach((panel) => {
        const key = panel.dataset.reviewAnalysis;
        const session = reviewAiSessions.get(key);
        if (!session || key === keepKey) {
          return;
        }
        reviewAiSessions.remove(key);
      });
    }
    function renderTrainingQuestion(row, recordId = '') {
      if (!row?.question) {
        return '<p class="notice">未记录原题快照，无法还原这道题。</p>';
      }
      const q = { ...row.question, type: normalizeWebQuestionType(row.question.type || row.detail?.type) }; const chosen = row.chosen || []; const answer = q.answer || row.detail?.answer || [];
      const title = row.roundNumber ? `本轮第 ${row.roundNumber} 题` : `历史明细第 ${row.index + 1} 条（原题序未记录）`;
      const bankNumber = row.bankQuestionNumber ? `题库第 ${row.bankQuestionNumber} 题` : '题库题号未记录';
      const status = { correct: '✓ 正确', wrong: '× 错误', unanswered: '— 未作答', unrecorded: '未记录' }[row.status];
      const comparison = isMultiBlankQuestionV58914(q) ? renderMultiBlankComparisonV58914(q.blankAnswers, chosen, true) : `<div><b>你的答案：</b>${practiceReviewAnswerHtml(q, chosen)}</div><div class="training-reference-answer"><b>${q.type === 'short' ? '参考答案（人工自评）' : '正确答案'}：</b>${hasAnswerValueV58914(answer) ? practiceReviewAnswerHtml(q, answer) : '题库未提供答案'}</div>`;
      return `<article class="training-question-content"><div class="qmeta"><b>${title}</b><span class="pill">${bankNumber}</span><span>${esc(label(q.type))}</span><span>${esc(row.bankName)}</span><b class="training-status-${row.status}">${status}</b></div>${row.partial ? '<p class="notice">旧记录未保存完整原题，以下仅为当时保存的摘要与答案。</p>' : ''}<div class="question-title">${renderQuestionBodyV83(q)}</div>${renderReviewOptions({ ...q, answer }, chosen)}<div class="training-answer-comparison training-status-${row.status}">${comparison}</div>${row.revealed ? '<p class="muted">本题曾查看答案，未正式提交。</p>' : ''}${hasAnswerValueV58914(row.draft) ? `<div class="notice"><b>曾填写但未提交（不计成绩）：</b>${practiceReviewAnswerHtml(q, row.draft)}</div>` : ''}<div class="training-analysis">${renderReviewAnalysis({ bankId: row.bankId, question: { ...q, answer } }, chosen, 'training:' + recordId + ':' + row.index)}</div></article>`;
    }
    async function renderTrainingReview() {
      const view = trainingReview;
      if (!view || !$('#training-review.active')) {
        return;
      }
      const renderVersion = beginNativeRender('training-review');
      const { record } = view; const rows = ShirohaTraining.reviewRows(record); const counts = { correct: 0, wrong: 0, unanswered: 0, unrecorded: 0 };
      rows.forEach((row) => counts[row.status]++);
      const filtered = rows.filter((row) => view.filter === 'all' || row.status === view.filter);
      if (filtered.length && !filtered.some((row) => row.index === view.index)) {
        view.index = filtered[0].index;
      }
      const position = filtered.findIndex((row) => row.index === view.index); const selected = filtered[position];
      const selectedAnalysisKey = selected?.question
        ? JSON.stringify(['training:' + record.id + ':' + selected.index, selected.bankId || '', selected.question.id || ''])
        : '';
      // 补读可能异步完成，切题时先释放旧会话，避免迟到响应继续绑定旧页面。
      releaseTrainingReviewAnalysis(selectedAnalysisKey);
      const needsSourceAnalysis = selected?.question && selected.bankId && !String(selected.question.analysis || '').trim();
      if (needsSourceAnalysis) {
        // 桌面摘要不含解析；只补读当前选题，切题或离开后的迟到读取不能重绘旧页面。
        if (!await loadNativeItems([{ bankId: selected.bankId, question: selected.question }])) {
          return;
        }
        if (trainingReview !== view || renderVersion !== nativeRenderVersions.get('training-review') || !$('#training-review.active')) {
          return;
        }
      }
      const missing = Math.max(0, Number(record.total || 0) - rows.length); const meta = record.reviewSummary;
      const denominator = meta?.submitMode === 'single' ? record.answered : record.total;
      const box = $('#training-review-content');
      box.dataset.recordId = record.id;
      const active = box.contains(document.activeElement) ? document.activeElement : null;
      const focused = active?.getAttribute('data-training-filter'); const focusedQuestion = active?.getAttribute('data-training-question'); const focusedPage = active?.dataset.pageControl;
      let backLabel = '训练记录';
      if (view.origin === 'dashboard') {
        backLabel = '首页';
      } else if (view.origin === 'practice' || view.origin === 'exam') {
        backLabel = '训练结果';
      }
      box.innerHTML = `<button type="button" class="ghost mini-btn" id="training-review-back">← 返回${backLabel}</button><div class="section-head"><div><h2>${esc(trainingTitle(record))}</h2><p class="muted">${esc(fmt(record.date))} · ${esc(record.mode)} · ${meta ? { single: '单题提交', total: '总提交', exam: '考试交卷' }[meta.submitMode] || '' : ''} · ${trainingCompletion(record)}</p></div></div><div class="score-card"><div class="metric"><span>正确</span><b>${counts.correct}</b></div><div class="metric"><span>错误（已作答）</span><b>${counts.wrong}</b></div><div class="metric"><span>未作答</span><b>${counts.unanswered}</b></div><div class="metric"><span>用时</span><b>${ShirohaTraining.formatDuration(record.duration)}</b></div></div><p class="muted">正确率 ${record.accuracy}%${meta ? ` · ${record.correct}/${denominator} 道${meta.submitMode === 'single' ? '已判定题' : '本轮题目'}` : '（沿用历史统计）'} · ${meta?.timing === 'active' ? '已扣除暂停' : '原记录用时，可能包含停留时间'}</p>${missing ? `<p class="notice">另有 ${missing} 道题未记录原题快照，无法还原；旧明细顺序不代表本轮题序。</p>` : ''}${meta && meta.submitMode !== 'single' && counts.unanswered ? '<p class="notice">未作答题已按本轮原规则计错；上方“错误（已作答）”只统计实际作答错误。</p>' : ''}<div class="training-filters" aria-label="复盘题目筛选">${[['all', '全部题目', rows.length], ['correct', '正确', counts.correct], ['wrong', '错误', counts.wrong], ['unanswered', '未作答', counts.unanswered]].map(([key, text, count]) => `<button type="button" class="ghost mini-btn" data-training-filter="${key}" aria-pressed="${view.filter === key}">${text} ${count}</button>`).join('')}</div><div id="training-answer-card" class="training-answer-card" aria-label="本轮答题卡"></div><p class="muted">✓ 正确\u3000× 错误\u3000— 未作答</p><section id="training-question" aria-label="选中题目复盘">${selected ? renderTrainingQuestion(selected, record.id) : '<p class="empty" role="status">当前筛选没有题目。</p>'}</section><div class="actions"><button type="button" class="ghost" id="training-prev" ${position <= 0 ? 'disabled' : ''}>上一题</button><button type="button" class="ghost" id="training-next" ${position < 0 || position === filtered.length - 1 ? 'disabled' : ''}>下一题</button><button type="button" class="primary" id="training-retry" ${counts.wrong ? '' : 'disabled'}>重练错题（${counts.wrong}）</button></div>`;
      updateReviewAnalysisPanels();
      const card = $('#training-answer-card'); const pageRows = nativePage(filtered, 'training:' + record.id + ':' + view.filter, card, renderTrainingReview);
      card.innerHTML = pageRows.map((row) => `<button type="button" class="training-status-${row.status}" data-training-question="${row.index}" aria-label="${row.roundNumber ? '第 ' + row.roundNumber + ' 题' : '明细第 ' + (row.index + 1) + ' 条'}，${{ correct: '正确', wrong: '错误', unanswered: '未作答', unrecorded: '未记录' }[row.status]}" aria-pressed="${view.index === row.index}">${row.roundNumber || row.index + 1} ${{ correct: '✓', wrong: '×', unanswered: '—', unrecorded: '?' }[row.status]}</button>`).join('');
      $('#training-review-back').onclick = closeTrainingReview;
      $$('[data-training-filter]').forEach((button) => button.onclick = () => {
        view.filter = button.dataset.trainingFilter;
        renderTrainingReview();
      });
      $$('[data-training-question]').forEach((button) => button.onclick = async () => {
        const index = Number(button.dataset.trainingQuestion);
        view.index = index;
        await renderTrainingReview();
        if (trainingReview === view && view.index === index) {
          $('#training-question')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      });
      const jump = async (offset) => {
        const row = filtered[position + offset];
        if (!row) {
          return;
        }
        view.index = row.index;
        const page = nativePages.get(card.id);
        if (page) {
          page.page = Math.floor((position + offset) / page.size);
        }
        await renderTrainingReview();
        if (trainingReview === view && view.index === row.index) {
          $(offset > 0 ? '#training-next' : '#training-prev')?.focus({ preventScroll: true });
        }
      };
      $('#training-prev').onclick = () => jump(-1);
      $('#training-next').onclick = () => jump(1);
      $('#training-retry').onclick = async () => {
        const wrongRows = rows.filter((row) => row.status === 'wrong');
        const available = wrongRows.every((row) => state.banks.find((bank) => bank.id === row.bankId)?.questions.some((q) => q.id === row.question.id));
        if (!available) {
          toast('部分原题已删除，历史复盘保留；请先重新导入原题库后重练。', 'warn');
          return;
        }
        const first = wrongRows[0];
        if (!first) {
          return;
        }
        const banks = state.banks.filter((bank) => wrongRows.some((row) => row.bankId === bank.id)); const groups = new Set(banks.map(bankGroupNameV58));
        if (banks.length > 1 && groups.size !== 1) {
          toast('原题现已分散到不同分组，请分别选择题库重练；历史复盘仍保留。', 'warn');
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
        const selectedNumbers = base.map((item, index) => {
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
      if (focusedPage) {
        const controls = [...box.querySelectorAll('[data-page-control]')].filter((node) => node.getClientRects().length && !node.disabled);
        (controls.find((node) => node.dataset.pageControl === focusedPage) || controls.find((node) => node.getAttribute('aria-current') === 'page'))?.focus({ preventScroll: true });
      }
      scheduleMathJaxTypesetV56(box);
    }
    return { renderRecords, trainingCompletion, trainingTitle, renderRecentTraining, openTrainingReview, renderTrainingQuestion, leaveTrainingReview, bindTrainingReviewEvents };
  }
  globalThis.ShirohaTrainingReviewPage = { create };
})();
