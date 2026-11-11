(() => {
  'use strict';
  function create({ select: $, selectAll: $$, escape: esc, label, short, formatDate: fmt, now, toast,
    paging, bank, favorites, wrong, review, practice, actions }) {
    const { visible: nativeViewVisible, begin: beginNativeRender, page: nativePage, versions: nativeRenderVersions,
      loadItems: loadNativeItems, itemsForBanks: practiceSessionItemsForBanksV8916 } = paging;
    const { active: activeBank, closeDetail: closeBankQuestionDetail, copyText: bankQuestionCopyText,
      openDetail: openBankQuestionDetail } = bank;
    const { ids: getFavoriteIdsV27, toggle: toggleFavoriteV27, isFavorite: isFavoriteV27 } = favorites;
    const { get: getWrongEntries, set: setWrongEntries, remove: removeWrong } = wrong;
    const { questionBody: renderQuestionBodyV83, options: renderReviewOptions, summary: renderReviewAnswerSummary,
      analysis: renderReviewAnalysis, updatePanels: updateReviewAnalysisPanels, isTextType } = review;
    const { resetAi: resetAiSinglePracticeV613, setup: openQuickPracticeSetup, baseItems: practiceBaseItemsV58916,
      question: practiceQuestionV8916, customMode: PRACTICE_START_CUSTOM_V58916,
      exactNumbers: formatExactPracticeNumbersV58916, syncMode: syncPracticeStartModeFieldsV58916 } = practice;
    const { transaction: runMutation, save: saveSilent, renderAll, canStartPractice, preparePracticeNavigation } = actions;
    // 收藏单题读取只属于发起时的页面；离页或新请求会撤销旧跳转。
    let favoritePracticeRequest = 0;
    // 可见列表读取按所属页面失效；后台预渲染仍沿用原有渲染策略。
    let favoriteReadOwner = 0; let wrongReadOwner = 0;
    function cancelPendingSavedReads(target) {
      if (target !== 'favorites') { favoriteReadOwner += 1; }
      if (target !== 'wrongbook') { wrongReadOwner += 1; }
    }
    function cancelFavoritePractice() {
      favoritePracticeRequest += 1;
    }
    function favoriteRowsV596() {
      const ids = new Set(getFavoriteIdsV27());
      const map = new Map(activeBank().questions.map((q) => [q.id, q]));
      return [...ids].map((id) => map.get(id)).filter(Boolean);
    }
    function renderFavoritePanelV27() {
      renderFavoritesPageV596();
    }
    async function renderFavoritesPageV596() {
      if (!nativeViewVisible('favorites')) {
        return;
      }
      const box = $('#favorites-list-v596');
      if (!box) {
        return;
      }
      closeBankQuestionDetail();
      const renderVersion = beginNativeRender('favorites');
      const bank = activeBank();
      const owner = favoriteReadOwner;
      const startedVisible = !!$('#favorites')?.classList.contains('active');
      const isCurrentRead = () => renderVersion === nativeRenderVersions.get('favorites') && activeBank() === bank
        && (!startedVisible || (owner === favoriteReadOwner && $('#favorites')?.classList.contains('active')));
      const allRows = favoriteRowsV596();
      // eslint-disable-next-line prefer-template -- 外部值可能是对象，保留 + 的默认转换；输入类型受约束后移除此例外。
      const rows = nativePage(allRows, 'favorites:' + bank.id, box, renderFavoritesPageV596);
      const body = box.tBodies[0];
      body.innerHTML = '<tr><td colspan="7" role="status">正在加载收藏题……</td></tr>';
      const countEl = $('#favorites-count-v596');
      if (countEl) {
        countEl.textContent = `${allRows.length} 道`;
      }
      const practiceBtn = $('#practice-favorites-btn-v596');
      if (practiceBtn) {
        practiceBtn.disabled = true;
      }
      const clearBtn = $('#clear-favorites-btn-v596');
      if (clearBtn) {
        clearBtn.disabled = true;
      }
      if (!await loadNativeItems(practiceSessionItemsForBanksV8916([{ ...bank, questions: rows }]), isCurrentRead)) {
        if (!isCurrentRead()) {
          return;
        }
        body.innerHTML = '<tr><td colspan="7" role="status">收藏题加载失败，请重试。 <button type="button" class="ghost mini-btn" id="retry-favorites">重试</button></td></tr>';
        $('#retry-favorites').onclick = renderFavoritesPageV596;
        return;
      }
      if (!isCurrentRead() || !nativeViewVisible('favorites')) {
        return;
      }
      if (practiceBtn) {
        practiceBtn.disabled = !allRows.length;
      }
      if (clearBtn) {
        clearBtn.disabled = !allRows.length;
      }
      body.innerHTML = rows.length ? rows.map((q) => {
        const number = bank.questions.indexOf(q) + 1; const preview = bankQuestionCopyText(q);
        return `<tr class="favorite-question-row"><td class="favorite-question-number">${number}</td><td>${label(q.type)}</td><td>${esc(short(preview.text, 80))}${preview.text.length > 80 ? ` <button class="ghost mini-btn" type="button" data-preview-full="${esc(q.id)}" aria-label="查看第 ${number} 道收藏题全文">查看全文</button>` : ''}${preview.hasImages ? ' <span class="muted">含图片</span>' : ''}</td><td>${esc((q.answer || q.answerKeys || []).join('') || '未提供')}</td><td>${esc(q.category || q.topic || '未分类')}</td><td>${esc(q.score || '默认')}</td><td><div class="favorite-question-actions"><button class="ghost mini-btn" type="button" data-preview-question="${esc(q.id)}" aria-expanded="false" aria-controls="bank-question-detail" aria-label="查看第 ${number} 道收藏题详情">查看详情</button><button class="ghost mini-btn" data-practice-one-fav-v596="${esc(q.id)}" type="button">练习本题</button><button class="ghost danger mini-btn" data-unfav-v27="${esc(q.id)}" type="button">取消收藏</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="7" class="empty">当前题库暂无收藏题。刷题时点击“收藏题目”，这里会集中显示。</td></tr>';
      box.querySelectorAll('[data-preview-question]').forEach((button) => button.onclick = () => openBankQuestionDetail(bank, rows.find((q) => q.id === button.dataset.previewQuestion), button, false));
      box.querySelectorAll('[data-preview-full]').forEach((button) => button.onclick = () => openBankQuestionDetail(bank, rows.find((q) => q.id === button.dataset.previewFull), button, true));
      box.querySelectorAll('[data-unfav-v27]').forEach((btn) => btn.onclick = async () => {
        if (await toggleFavoriteV27(btn.dataset.unfavV27)) {
          renderAll();
        }
      });
      box.querySelectorAll('[data-practice-one-fav-v596]').forEach((btn) => btn.onclick = () => startSingleFavoritePracticeV596(btn.dataset.practiceOneFavV596, bank, btn));
    }
    async function startSingleFavoritePracticeV596(id, bank, button) {
      const stillCurrent = () => canStartPractice() && activeBank() === bank && button.isConnected
        && document.getElementById('favorites')?.classList.contains('active')
        && document.getElementById('favorites-list-v596')?.contains(button);
      if (!stillCurrent()) {
        return;
      }
      favoritePracticeRequest += 1;
      const request = favoritePracticeRequest;
      const isCurrentRequest = () => request === favoritePracticeRequest && stillCurrent();
      if (!await loadNativeItems(practiceSessionItemsForBanksV8916([{ ...bank, questions: bank.questions.filter((q) => q.id === id) }]), isCurrentRequest)) {
        return;
      }
      if (!isCurrentRequest()) {
        return;
      }
      const q = bank.questions.find((x) => x.id === id);
      if (!q) {
        toast('未找到这道收藏题。', 'warn');
        return;
      }
      preparePracticeNavigation();
      resetAiSinglePracticeV613();
      $$('.nav').forEach((b) => b.classList.remove('active'));
      document.querySelector('[data-view="practice"]').classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));
      $('#practice').classList.add('active');
      $('#page-title').textContent = '刷题练习';
      $('#practice-source').value = 'favorite';
      $('#practice-type').value = 'all';
      $('#practice-order').value = 'sequence';
      openQuickPracticeSetup();
      const index = practiceBaseItemsV58916('favorite', 'all').findIndex((item) => practiceQuestionV8916(item).id === id);
      if (index < 0) {
        toast('这道题已不在收藏中，请重新选择。', 'warn');
        return;
      }
      $('#practice-start-mode-v58916').value = PRACTICE_START_CUSTOM_V58916;
      $('#practice-number-range-v58916').value = formatExactPracticeNumbersV58916([index + 1]);
      syncPracticeStartModeFieldsV58916();
    }
    async function renderWrongBook() {
      if (!nativeViewVisible('wrongbook')) {
        return;
      }
      const renderVersion = beginNativeRender('wrongbook');
      const bid = activeBank().id;
      const owner = wrongReadOwner;
      const startedVisible = !!$('#wrongbook')?.classList.contains('active');
      const isCurrentRead = () => renderVersion === nativeRenderVersions.get('wrongbook') && activeBank().id === bid
        && (!startedVisible || (owner === wrongReadOwner && $('#wrongbook')?.classList.contains('active')));
      let entries = getWrongEntries(bid);
      const filter = $('#wrong-status-filter')?.value || 'active';
      if (filter === 'active') {
        entries = entries.filter((e) => e.status !== '已掌握');
      } else if (filter !== 'all') {
        entries = entries.filter((e) => e.status === filter);
      }
      const sort = $('#wrong-sort-mode')?.value || 'lastWrong';
      if (sort === 'wrongCount') {
        entries.sort((a, b) => b.wrongCount - a.wrongCount);
      } else if (sort === 'status') {
        entries.sort((a, b) => String(a.status).localeCompare(String(b.status), 'zh-CN'));
      } else {
        entries.sort((a, b) => String(b.lastWrongAt || '').localeCompare(String(a.lastWrongAt || '')));
      }
      const map = new Map(activeBank().questions.map((q) => [q.id, q]));
      // eslint-disable-next-line prefer-template -- 外部值可能是对象，保留 + 的默认转换；输入类型受约束后移除此例外。
      const rows = nativePage(entries.map((e) => ({ e, q: map.get(e.id) })).filter((x) => x.q), 'wrong:' + bid + ':' + filter + ':' + sort, document.getElementById('wrongbook-list'), renderWrongBook);
      if (!await loadNativeItems(practiceSessionItemsForBanksV8916([{ ...activeBank(), questions: rows.map((row) => row.q) }]), isCurrentRead)) {
        return;
      }
      if (!isCurrentRead() || !nativeViewVisible('wrongbook')) {
        return;
      }
      $('#wrongbook-list').innerHTML = rows.length ? rows.map(({ e, q }) => `<div class="wrong-item"><div class="section-head"><div><b>${label(q.type)}</b><p class="muted">${isTextType(q.type) ? `答案：${esc(q.answer.join(''))}｜` : ''}状态：${esc(e.status)}｜错误 ${e.wrongCount} 次｜做对 ${e.rightCount} 次${e.lastWrongAt ? `｜最近错：${fmt(e.lastWrongAt)}` : ''}</p></div><div class="row-actions"><button class="ghost mini-btn" data-toggle-master-wrong="${esc(q.id)}">${e.status === '已掌握' ? '取消掌握' : '标记已掌握'}</button><button class="ghost mini-btn" data-fav-wrong="${esc(q.id)}">${isFavoriteV27(q.id) ? '取消收藏' : '收藏'}</button><button class="ghost danger mini-btn" data-remove-wrong="${esc(q.id)}">移出</button></div></div><div class="question-title">${renderQuestionBodyV83(q)}</div>${renderReviewOptions(q, e.lastAnswer)}${renderReviewAnswerSummary(q, e.lastAnswer)}${renderReviewAnalysis({ bankId: bid, question: q }, e.lastAnswer, 'wrongbook')}</div>`).join('') : '<p class="muted">当前条件下暂无错题。</p>';
      $$('[data-remove-wrong]').forEach((b) => b.onclick = async () => runMutation(async () => {
        if (await globalThis.ShirohaDialogs.confirm('确定将这道题移出错题本？')) {
          removeWrong(b.dataset.removeWrong);
          await saveSilent();
          renderAll();
        }
      }));
      $$('[data-toggle-master-wrong]').forEach((b) => b.onclick = async () => runMutation(async () => {
        const arr = getWrongEntries();
        const e = arr.find((x) => x.id === b.dataset.toggleMasterWrong);
        if (e) {
          if (e.status === '已掌握') {
            e.status = '复习中';
            e.rightCount = Math.min(e.rightCount || 0, 1);
          } else {
            e.status = '已掌握';
            e.lastCorrectAt = now();
            e.rightCount = Math.max(e.rightCount || 0, 2);
          }
          setWrongEntries(arr);
          await saveSilent();
          renderAll();
        }
      }));
      $$('[data-fav-wrong]').forEach((b) => b.onclick = async () => {
        if (await toggleFavoriteV27(b.dataset.favWrong)) {
          renderAll();
        }
      });
      updateReviewAnalysisPanels();
    }
    return { renderFavoritePanelV27, renderFavoritesPageV596, renderWrongBook, cancelFavoritePractice, cancelPendingSavedReads };
  }
  globalThis.ShirohaSavedQuestionsPage = { create };
})();
