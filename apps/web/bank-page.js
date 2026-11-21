// 装配题库管理、浏览和题目详情，保留来源身份与按需数据读取。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;
  // 复用应用注入的分页、保存与导航能力，题库界面只管理自己的选中状态。
  function create({
    state,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    short,
    formatDate: fmt,
    now,
    countTypes,
    scope,
    paging,
    rendering,
    selection,
    actions,
    content,
  }) {
    const {
      ensureGroupUi: ensureBankGroupUiV58,
      current: practiceScopeV8916,
      banks: practiceScopeBanksV8916,
      groupName: bankGroupNameV58,
      pathLabel: bankPathLabelV58,
      normalizeGroup: normalizeBankGroupNameV58,
      renderGroups: renderBankGroupDatalistV58,
      setBank: setPracticeBankScopeV8916,
      setGroup: setPracticeGroupScopeV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
    } = scope;
    const {
      page: nativePage,
      visible: nativeViewVisible,
      begin: beginNativeRender,
      versions: nativeRenderVersions,
      loadItems: loadNativeItems,
      itemsForBanks: practiceSessionItemsForBanksV8916,
    } = paging;
    const { all: renderAll, toast } = rendering;
    const { get: getExportSelection, set: setExportSelection } = selection;
    const {
      activeBank,
      transaction: runMutation,
      save: saveSilent,
      edit: editBankByIdV45,
      duplicate: duplicateBankById,
      exportBank: exportBankById,
      exportCurrent,
      exportSelected,
      deleteBanks: deleteBanksV32,
      deleteQuestions: deleteBankQuestions,
      canSelectExportBanks,
      isBusy,
    } = actions;
    const {
      stripUnsafe: stripUnsafeImageDataUrisV83,
      optionText: pickRichOptionTextV57,
      repair: repairCircledCombinationQuestion,
      parseTable: parseDocxMarkdownTableBlockV55,
      normalizeImages: normalizeQuestionImagesForWebV83,
      normalizeType: normalizeWebQuestionType,
      questionBody: renderQuestionBodyV83,
      questionContent: renderQuestionContent,
      answerDisplay,
    } = content;
    // 选择仅归当前题库页面会话；切库或题目集合被替换后重置，不写入备份。
    let bankQuestionSelection = { bank: null, idsKey: '', selected: new Set() };
    // 可见预览的读取只属于发起时的题库页；离页后即使返回也不能显示旧失败。
    let bankPreviewOwner = 0;
    // 用于在切换筛选时清除旧分页；页码本身仍由现有分页器管理。
    let bankPreviewFilterKey = '';
    const BANK_SEARCH_BATCH_SIZE = 100;
    function cancelPendingBankPreview() {
      bankPreviewOwner += 1;
    }

    function resetBankQuestionSelection() {
      bankQuestionSelection = { bank: null, idsKey: '', selected: new Set() };
    }

    // 详情 DOM 仅归预览页面所有；重绘、翻页和离开页面时移除，使旧异步复制反馈失效。
    function closeBankQuestionDetail() {
      const detail = document.getElementById('bank-question-detail');
      detail?.dispatchEvent(new Event('preview-close'));
      detail?.remove();
      document.querySelectorAll('[data-preview-question]').forEach((button) => {
        i18n.bindText(button, 'banks.viewDetails');
        button.setAttribute('aria-expanded', 'false');
      });
    }

    // 用当前可用题库刷新活动库选择器，保持已选择的题库。
    function renderBankSelect() {
      const sel = $('#active-bank-select');
      if (!sel) {
        return;
      }

      const old = state.activeBankId;
      sel.innerHTML = state.banks.map(/* 仅翻译缺省标签，显式命名的分组仍使用用户文本。 */ (bank) => {
        const group = normalizeBankGroupNameV58(bank.groupName) || i18n.text('scope.ungrouped');
        const path = `${group} / ${bank.name || i18n.text('scope.untitledBank')}`;
        const labelText = i18n.text('shell.bankOption', { path, count: bank.questions.length });
        return `<option value="${esc(bank.id)}">${esc(labelText)}</option>`;
      }).join('');

      sel.value = old || state.activeBankId;
    }

    // 刷新合并来源下拉列表，避免把当前题库作为来源。
    function renderMergeSelect(preserveSelection = false) {
      const sel = $('#merge-bank-select');
      if (!sel) {
        return;
      }

      const previous = preserveSelection ? sel.value : '';
      const banks = state.banks.filter((bank) => bank.id !== state.activeBankId);
      sel.innerHTML = banks.map((b) => `<option value="${esc(b.id)}">${esc(i18n.text('import.bankOption', { bank: bankPathLabelV58(b), count: b.questions.length }))}</option>`).join('') || `<option value="">${i18n.text('banks.noneToMerge')}</option>`;

      if (previous && banks.some((bank) => bank.id === previous)) {
        sel.value = previous;
      }
    }

    // 从活动题库恢复名称、分组和其他编辑字段，保持控件与库状态一致。
    function renderBankInputs() {
      ensureBankGroupUiV58();
      const b = activeBank();
      const inp = $('#bank-rename-input');
      if (inp && !inp.value) {
        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        inp.placeholder = '当前：' + (b.name || '未命名题库');
      }

      const groupInput = $('#bank-group-rename-input-v58');
      if (groupInput) {
        groupInput.placeholder = `当前：${bankGroupNameV58(b)}`;
        if (!groupInput.dataset.lastBankIdV58 || groupInput.dataset.lastBankIdV58 !== b.id) {
          groupInput.value = normalizeBankGroupNameV58(b.groupName);
          groupInput.dataset.lastBankIdV58 = b.id || '';
        }
      }

      renderBankGroupDatalistV58();
    }

    // 旧备份恢复与首次启动都从有效选择恢复；没有任何选择时沿用默认全选。
    function setupBankManagement() {
      mountBankManagementToolbar();
      const validIds = new Set(state.banks.map((bank) => bank.id));
      const selected = new Set([...getExportSelection()].filter((id) => validIds.has(id)));
      setExportSelection(selected.size ? selected : validIds);
      renderBulkSelection();
    }

    // 在题库管理页装配选择性批量导出控件，重复渲染时复用已绑定入口。
    function mountBankManagementToolbar() {
      if ($('#bank-bulk-export-panel-v23')) {
        return;
      }

      const bankList = $('#bank-list');
      if (!bankList) {
        return;
      }

      bankList.insertAdjacentHTML('beforebegin', `<div id="bank-bulk-export-panel-v23" class="data-tool-card-v23 bank-bulk-panel-v23 bank-manage-toolbar-v28">
    <div class="section-head compact-head-v23"><div><h3>${i18n.html('banks.bulkTitle')}</h3><p class="muted">${i18n.html('banks.bulkHelp')}</p></div></div>
    <div class="bank-current-bar-v28">
      <label>${i18n.html('scope.bank')}<select id="bank-current-select-v28"></select></label>
      <button class="ghost" id="export-json-btn" type="button">${i18n.html('banks.exportCurrent')}</button>
      <span class="muted">${i18n.html('banks.switchHelp')}</span>
    </div>
    <div class="actions wrap-v23 bank-toolbar-actions-v28">
      <label class="check-line-v23"><input id="export-bank-all-v23" type="checkbox">${i18n.html('common.selectAll')}</label>
      <button class="ghost" id="export-bank-invert-v23" type="button">${i18n.html('common.invert')}</button>
      <button class="ghost" id="export-bank-current-v23" type="button">${i18n.html('banks.selectCurrent')}</button>
      <button class="primary" id="export-selected-banks-v23" type="button">${i18n.html('banks.exportSelected')}</button>
      <button class="ghost danger" id="delete-selected-banks-v32" type="button">${i18n.html('banks.deleteSelected')}</button>
    </div>
    <div id="export-bank-summary-v23" class="notice warn">${i18n.html('banks.chooseToManage')}</div>
  </div>`);
      bindBankManagementToolbar();
      renderBankToolbarV28();
    }

    // 题库卡片和批量工具栏共享当前选择，删除和导出只在触发时取值。
    function bindBankManagementToolbar() {
      $('#bank-current-select-v28').onchange = /* 题库管理页的选择器切换活动题库。 */ async (e) => runMutation(/* 空选项不触发数据写入。 */ async () => {
        if (e.target.value) {
          state.activeBankId = e.target.value;
          await saveSilent();
          renderAll();
        }
      });

      $('#export-bank-all-v23').onchange = (e) => {
        setExportSelection(e.target.checked ? new Set(state.banks.map((bank) => bank.id)) : new Set());

        renderBankList();
      };

      $('#export-bank-invert-v23').onclick = /* 以当前题库列表为准反选，确保导出的题库仍存在。 */ () => {
        const selected = getExportSelection();
        const next = new Set(state.banks.map((bank) => bank.id).filter((id) => !selected.has(id)));
        setExportSelection(next);
        renderBankList();
      };

      $('#export-bank-current-v23').onclick = () => {
        setExportSelection(new Set([activeBank().id]));
        renderBankList();
      };

      $('#export-json-btn').onclick = exportCurrent;
      $('#export-selected-banks-v23').onclick = exportSelected;
      $('#delete-selected-banks-v32').onclick = () => deleteBanksV32([...getExportSelection()]);
    }

    // 汇总本次选择的题库和题目数，同步更新导出与删除的可用状态。
    function renderBulkSelection() {
      const selection = getExportSelection();
      const selected = state.banks.filter((bank) => selection.has(bank.id));
      const qCount = selected.reduce((n, bank) => n + (bank.questions || []).length, 0);
      const all = $('#export-bank-all-v23');
      if (all) {
        all.checked = state.banks.length > 0 && selected.length === state.banks.length;
        all.indeterminate = selected.length > 0 && selected.length < state.banks.length;
      }

      const summary = $('#export-bank-summary-v23');
      if (summary) {
        summary.textContent = selected.length ? i18n.text('banks.selectedSummary', { banks: selected.length, questions: qCount }) : i18n.text('banks.chooseFirst');
        summary.className = `notice ${selected.length ? 'ok' : 'warn'}`;
      }

      const exportSelectedButton = $('#export-selected-banks-v23');
      if (exportSelectedButton) {
        exportSelectedButton.disabled = !selected.length;
      }

      const deleteSelectedButton = $('#delete-selected-banks-v32');
      if (deleteSelectedButton) {
        deleteSelectedButton.disabled = !selected.length;
      }
    }

    // 按分组及排序方式显示题库，重绘前后保留当前可用的批量选择。
    function renderBankList() {
      ensureBankGroupUiV58();
      const scope = practiceScopeV8916();
      const box = $('#bank-list');
      let banks = [...state.banks];
      const sort = $('#bank-sort-mode')?.value || 'created';
      if (sort === 'name') {
        banks.sort((a, b) => `${bankGroupNameV58(a)} ${a.name}`.localeCompare(`${bankGroupNameV58(b)} ${b.name}`, 'zh-CN'));
      } else if (sort === 'count') {
        banks.sort((a, b) => b.questions.length - a.questions.length || bankPathLabelV58(a).localeCompare(bankPathLabelV58(b), 'zh-CN'));
      } else {
        banks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || bankPathLabelV58(a).localeCompare(bankPathLabelV58(b), 'zh-CN'));
      }

      const validIds = new Set(state.banks.map((b) => b.id));
      banks = nativePage(banks, `banks:${sort}`, box, renderBankList);
      setExportSelection(new Set([...getExportSelection()].filter((id) => validIds.has(id))));

      if (!banks.length) {
        box.innerHTML = `<p class="muted">${i18n.html('banks.none')}</p>`;
        renderBankToolbarV28();
        renderBulkSelection();
        return;
      }

      const groups = new Map();
      banks.forEach(/* 按当前展示顺序把题库放入分组，保留组内已有顺序。 */ (b) => {
        const g = bankGroupNameV58(b);
        if (!groups.has(g)) {
          groups.set(g, []);
        }

        groups.get(g).push(b);
      });

      box.innerHTML = [...groups.entries()].map(/* 按组汇总题量和选择状态，并为每个题库生成其操作入口。 */ ([groupName, items]) => {
        const groupBanks = practiceScopeBanksV8916({ type: PRACTICE_SCOPE_GROUP_V8916, value: groupName });
        const total = groupBanks.reduce((n, b) => n + (b.questions?.length || 0), 0);
        const groupActive = scope.type === PRACTICE_SCOPE_GROUP_V8916 && scope.value === groupName;
        const body = items.map(/* 以当前题库身份标识状态，显示题型数和适用于该库的操作。 */ (b) => {
          const stats = countTypes(b.questions);
          const active = b.id === state.activeBankId;
          const bankScope = scope.type === PRACTICE_SCOPE_BANK_V8916 && scope.value === b.id;
          const checked = getExportSelection().has(b.id);
          return `<article class="bank-item bank-item-compact-v28 ${active ? 'active-bank' : ''} ${checked ? 'selected-bank-v28' : ''}">
        <label class="bank-bulk-check-v23 bank-card-check-v28" ${i18n.attribute('title', 'banks.selectBank')}><input type="checkbox" data-bank-bulk-v23="${esc(b.id)}" ${checked ? 'checked' : ''}></label>
        <div class="bank-card-main-v28"><div class="bank-card-title-v28"><b>${esc(b.name)}</b>${active ? `<span class="source-badge">${i18n.html('scope.bank')}</span>` : ''}${bankScope ? `<span class="practice-scope-badge-v8916">${i18n.html('scope.practice')}</span>` : ''}</div><p class="muted bank-card-meta-v28">${i18n.html('banks.bankStats', { total: b.questions.length, single: stats.single, multiple: stats.multiple + stats.multi, judge: stats.judge, blank: stats.blank, short: stats.short, created: fmt(b.createdAt || now()) })}</p></div>
        <div class="bank-card-actions-v33"><button class="ghost mini-btn" data-openbank="${esc(b.id)}" type="button">${i18n.html(active && bankScope ? 'banks.active' : 'banks.activate')}</button><details class="bank-more-menu-v28"><summary ${i18n.attribute('aria-label', 'banks.moreActions')}>${i18n.html('common.more')}</summary><div class="bank-more-panel-v28"><button class="ghost" data-editbank-v45="${esc(b.id)}" type="button">${i18n.html('banks.moveGroup')}</button><button class="ghost" data-copybank="${esc(b.id)}" type="button">${i18n.html('common.copy')}</button><button class="ghost" data-exportbank="${esc(b.id)}" type="button">${i18n.html('banks.exportSingle')}</button></div></details><button class="ghost danger mini-btn bank-delete-quick-v32" data-delbank="${esc(b.id)}" type="button" ${i18n.attribute('title', 'banks.deleteSingle')}>${i18n.html('common.delete')}</button></div>
      </article>`;
        }).join('');
        return `<section class="bank-group-section-v58 ${groupActive ? 'practice-group-active-v8916' : ''}"><div class="bank-group-head-v58"><div><b>${esc(groupName)}</b><span class="bank-group-badge-v58">${i18n.html('banks.firstLevelGroup')}</span>${groupActive ? `<span class="practice-scope-badge-v8916">${i18n.html('scope.current')}</span>` : ''}</div><div class="bank-group-actions-v8916"><span class="muted">${i18n.html('banks.groupCounts', { banks: groupBanks.length, count: total })}</span><button class="ghost mini-btn" data-practice-group-v8916="${esc(groupName)}" type="button">${i18n.html(groupActive ? 'banks.groupCurrent' : 'banks.useGroup')}</button></div></div><div class="bank-group-list-v58">${body}</div></section>`;
      }).join('');

      $$('[data-bank-bulk-v23]').forEach(/* 给每个选库控件绑定对应的题库标识。 */ (x) => x.onchange = /* 只接受仍在当前列表的选择事件，避免重绘后旧控件污染选中集。 */ () => {
        const id = x.dataset.bankBulkV23;
        if (!canSelectExportBanks() || !box.contains(x) || !state.banks.some((bank) => bank.id === id)) {
          x.checked = getExportSelection().has(id);
          return;
        }

        if (x.checked) {
          getExportSelection().add(id);
        } else {
          getExportSelection().delete(id);
        }

        x.closest('.bank-item')?.classList.toggle('selected-bank-v28', x.checked);
        renderBulkSelection();
      });

      $$('[data-openbank]').forEach(/* 给每条题库绑定切换入口，使用该行携带的库标识。 */ (x) => x.onclick = /* 将活动库和练习范围同步写入同一保存操作，再刷新其他视图。 */ async () => runMutation(async () => {
        setPracticeBankScopeV8916(x.dataset.openbank, true);
        await saveSilent();
        renderAll();
      }));

      $$('[data-practice-group-v8916]').forEach(/* 每个分组入口独立绑定，点击使用该按钮所属的分组。 */ (x) => x.onclick = /* 在保存事务内发起切组，让显示与当前范围在保存后同步。 */ async () => runMutation(/* 分组仍有效时才保存其练习范围并刷新界面。 */ async () => {
        if (setPracticeGroupScopeV8916(x.dataset.practiceGroupV8916)) {
          await saveSilent();
          renderAll();
          toast(i18n.text('banks.groupActivated', { name: x.dataset.practiceGroupV8916 }), 'ok');
        }
      }));

      $$('[data-editbank-v45]').forEach((x) => x.onclick = () => editBankByIdV45(x.dataset.editbankV45, x));

      $$('[data-copybank]').forEach((x) => x.onclick = () => duplicateBankById(x.dataset.copybank));

      $$('[data-exportbank]').forEach((x) => x.onclick = () => exportBankById(x.dataset.exportbank));

      $$('[data-delbank]').forEach((x) => x.onclick = () => deleteBanksV32([x.dataset.delbank]));

      renderBankToolbarV28();
      renderBulkSelection();
    }

    // 重建题库管理工具栏的活动库提示，保持当前操作目标可见。
    function renderBankToolbarV28() {
      const sel = $('#bank-current-select-v28');
      if (!sel) {
        return;
      }

      const old = state.activeBankId;
      sel.innerHTML = state.banks.map((b) => `<option value="${esc(b.id)}">${esc(i18n.text('import.bankOption', { bank: bankPathLabelV58(b), count: b.questions.length }))}</option>`).join('') || `<option value="">${i18n.text('scope.noBank')}</option>`;

      sel.value = old || state.activeBankId || '';
      $('#export-json-btn').disabled = state.banks.length === 0;
    }

    // 按当前题库及搜索条件显示分页预览，阻止迟到读取覆盖已切换的页面。
    async function renderBankPreview() {
      const bank = activeBank(); const idsKey = JSON.stringify(bank.questions.map((q) => q.id));
      if (bankQuestionSelection.bank !== bank || bankQuestionSelection.idsKey !== idsKey) {
        bankQuestionSelection = { bank, idsKey, selected: new Set() };
      }

      if (!nativeViewVisible('banks')) {
        return;
      }

      const searchInput = $('#bank-search-query'); const typeSelect = $('#bank-search-type');
      searchInput.oninput = renderBankPreview;
      typeSelect.onchange = renderBankPreview;
      const rawSearch = searchInput.value; const search = rawSearch.trim().toLocaleLowerCase();
      const selectedType = typeSelect.value;
      const filterKey = JSON.stringify([bank.id, rawSearch, selectedType]);
      if (filterKey !== bankPreviewFilterKey) {
        document.getElementById('bank-preview-pager')?.replaceChildren();
        bankPreviewFilterKey = filterKey;
      }

      closeBankQuestionDetail();
      const renderVersion = beginNativeRender('banks');
      const owner = bankPreviewOwner;
      const startedVisible = !!$('#banks')?.classList.contains('active');
      const isCurrentRead = () => renderVersion === nativeRenderVersions.get('banks') && activeBank().id === bank.id
        && searchInput.value === rawSearch && typeSelect.value === selectedType && !isBusy() && nativeViewVisible('banks')
        && (!startedVisible || (owner === bankPreviewOwner && $('#banks')?.classList.contains('active')));

      $('#bank-preview tbody').innerHTML = `<tr data-bank-preview-loading><td colspan="8" role="status">${i18n.html('question.loading')}</td></tr>`;
      for (const id of ['select-bank-question-page', 'clear-bank-question-selection', 'delete-selected-questions']) {
        document.getElementById(id).disabled = true;
      }

      const candidates = bank.questions.filter((q) => selectedType === 'all' || normalizeWebQuestionType(q.type) === selectedType);
      let filtered = candidates;
      if (search) {
        filtered = [];
        for (let offset = 0;offset < candidates.length;offset += BANK_SEARCH_BATCH_SIZE) {
          const batch = candidates.slice(offset, offset + BANK_SEARCH_BATCH_SIZE);
          if (!await loadNativeItems(practiceSessionItemsForBanksV8916([{ ...bank, questions: batch }]), isCurrentRead)) {
            if (isCurrentRead()) {
              $('#bank-preview tbody').innerHTML = `<tr><td colspan="8" role="status">${i18n.html('question.loadFailed')} <button type="button" id="retry-bank-preview">${i18n.html('common.retry')}</button></td></tr>`;
              $('#retry-bank-preview').onclick = renderBankPreview;
            }

            return;
          }

          if (!isCurrentRead()) {
            return;
          }

          filtered.push(...batch.filter((q) => bankQuestionMatchesSearch(q, search)));

          if (offset + BANK_SEARCH_BATCH_SIZE < candidates.length) {
            await new Promise((resolve) => {
              setTimeout(resolve, 0);
            });
            if (!isCurrentRead()) {
              return;
            }
          }
        }
      }

      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      const bankPageKey = 'preview:' + bank.id;
      const qs = nativePage(filtered, JSON.stringify([bankPageKey, rawSearch, selectedType]), document.getElementById('bank-preview'), renderBankPreview);
      if (!await loadNativeItems(practiceSessionItemsForBanksV8916([{ ...bank, questions: qs }]), isCurrentRead)) {
        if (!isCurrentRead()) {
          return;
        }

        $('#bank-preview tbody').innerHTML = `<tr><td colspan="8" role="status">${i18n.html('question.loadFailed')} <button type="button" id="retry-bank-preview">${i18n.html('common.retry')}</button></td></tr>`;
        $('#retry-bank-preview').onclick = renderBankPreview;
        return;
      }

      if (!isCurrentRead() || !nativeViewVisible('banks')) {
        return;
      }

      const { selected } = bankQuestionSelection;
      $('#bank-preview tbody').innerHTML = qs.map((q) => {
        const number = bank.questions.indexOf(q) + 1; const preview = bankQuestionCopyText(q);
        return `<tr><td><input type="checkbox" data-select-bank-question="${esc(q.id)}" ${i18n.attribute('aria-label', 'banks.selectQuestion', { number })} ${selected.has(q.id) ? 'checked' : ''}></td><td>${number}</td><td>${label(q.type)}</td><td>${esc(short(preview.text, 80))}${preview.text.length > 80 ? ` <button class="ghost mini-btn" type="button" data-preview-full="${esc(q.id)}" ${i18n.attribute('aria-label', 'banks.fullQuestionLabel', { number })}>${i18n.html('banks.viewFull')}</button>` : ''}${preview.hasImages ? ` <span class="muted">${i18n.html('banks.hasImages')}</span>` : ''}</td><td>${esc((q.answer || q.answerKeys || []).join(''))}</td><td>${esc(q.category || q.topic || '')}</td><td>${esc(q.score || '默认')}</td><td><button class="ghost mini-btn" type="button" data-preview-question="${esc(q.id)}" aria-expanded="false" aria-controls="bank-question-detail" ${i18n.attribute('aria-label', 'banks.detailLabel', { number })}>${i18n.html('banks.viewDetails')}</button> <button class="ghost danger mini-btn" type="button" data-delete-bank-question="${esc(q.id)}" ${i18n.attribute('aria-label', 'banks.deleteQuestionLabel', { number })}>${i18n.html('common.delete')}</button></td></tr>`;
      }).join('') || `<tr><td colspan="8" class="empty">${i18n.html(bank.questions.length ? 'banks.noMatches' : 'banks.empty')}</td></tr>`;

      $('#bank-preview').querySelectorAll('[data-preview-question]').forEach((button) => button.onclick = () => openBankQuestionDetail(bank, qs.find((q) => q.id === button.dataset.previewQuestion), button, false));

      $('#bank-preview').querySelectorAll('[data-preview-full]').forEach((button) => button.onclick = () => openBankQuestionDetail(bank, qs.find((q) => q.id === button.dataset.previewFull), button, true));

      bindBankQuestionSelection(bank, qs, selected);
    }

    // 刷新预览后重新绑定当前页控件，从同一个选中集同步单选和批量操作。
    function bindBankQuestionSelection(bank, qs, selected) {
      // 题目选择变化时局部同步数量、批量操作和全选状态。
      const updateSelection = () => {
        i18n.bindText($('#bank-question-selection'), 'banks.selectedQuestions', { count: selected.size });
        $('#bank-question-selection').hidden = selected.size === 0;
        $('#delete-selected-questions').disabled = !selected.size;
        $('#clear-bank-question-selection').disabled = !selected.size;
        $('#select-bank-question-page').disabled = !qs.length;
        $$('[data-select-bank-question]').forEach((input) => {
          input.checked = selected.has(input.dataset.selectBankQuestion);
        });
      };

      $$('[data-select-bank-question]').forEach(/* 将复选框关联到它所代表的题目 ID。 */ (input) => input.onchange = /* 将当前试题的选中状态写回集合并刷新预览操作。 */ () => {
        if (input.checked) {
          selected.add(input.dataset.selectBankQuestion);
        } else {
          selected.delete(input.dataset.selectBankQuestion);
        }

        updateSelection();
      });

      $$('[data-delete-bank-question]').forEach((button) => button.onclick = () => deleteBankQuestions(bank.id, [button.dataset.deleteBankQuestion]));

      $('#select-bank-question-page').onclick = () => {
        qs.forEach((q) => selected.add(q.id));

        updateSelection();
      };

      $('#clear-bank-question-selection').onclick = () => {
        selected.clear();
        updateSelection();
      };

      $('#delete-selected-questions').onclick = () => deleteBankQuestions(bank.id, [...selected]);

      updateSelection();
    }

    // 通过读者可见的题干或可复制文本筛选，不要求知道原始标记写法。
    function bankQuestionMatchesSearch(q, search) {
      const preview = bankQuestionPreview(q);
      if (bankQuestionCopyText(q).text.toLocaleLowerCase().includes(search)) {
        return true;
      }

      return preview.options.some((option) => {
        const { text } = bankQuestionCopyText({ question: option.text, options: [], images: [] });
        return text.toLocaleLowerCase().includes(search);
      });
    }

    // 从新旧富文本结构里选择预览使用的题干，缺失时回退原文。
    function bankQuestionPreview(q) {
      const rich = q.richContent; const fields = rich?.fields || rich; const field = fields?.question;
      const candidates = typeof field === 'string' ? [field] : [field?.text, field?.markdown, field?.sourceText, field?.fallbackText, field?.plainText];
      candidates.push(q.question);
      const question = stripUnsafeImageDataUrisV83(String(candidates.find((value) => value != null && String(value).trim()) || ''));
      const options = Array.isArray(q.options) ? q.options.map((option, index) => ({ ...option, text: pickRichOptionTextV57(q, index, option) })) : [];
      return repairCircledCombinationQuestion({ ...q, question, options });
    }

    function bankQuestionPreviewSource(q) {
      return bankQuestionPreview(q).question;
    }

    // 构建便于复制的题目文本，图片只保留描述，不输出数据地址或本机路径。
    function bankQuestionCopyText(q) {
      const seen = new Set();
      let hasImages = false;
      // 统一图片占位文字并登记来源，避免同一资源再次作为附件输出。
      const imageText = (src, description) => {
        hasImages = true;
        seen.add(src);
        const safe = String(description || '').replace(/* 从图片描述中去掉数据地址、协议地址和本机路径，避免复制出原始资源位置。 */ /(?:data:|file:|https?:|[a-z]:[\\/])\S*/gi, '').trim();
        return safe ? `[图片：${safe}]` : '[图片]';
      };

      let text = String(bankQuestionPreviewSource(q)).replace(/* 将 Markdown 图片替换为可复制的文本描述。 */ /!\[([^\]]*)\]\(([^\n]*?)\)/g, (_, alt, src) => imageText(src, alt));
      text = text.replace(/* 将完整 DOCX 表格标记替换为制表符和换行表示的表格内容。 */ /【DOCX表格开始】[\s\S]*?【DOCX表格结束】/g, (block) => parseDocxMarkdownTableBlockV55(block).map((row) => row.join('\t')).join('\n'));

      // 只解析惰性模板；先移除图片来源，再取文字，避免复制内部媒体路径或执行导入内容。
      text = text.replace(/```[\s\S]*?```/g, (block) => esc(block));

      text = text.replace(/* HTML 图片标签只保留可读说明，避免复制标记与源地址。 */ /<img\b[^>]*>/gi, (tag) => {
        const alt = tag.match(/* 从 HTML 图片属性中取替代文字，供文本占位提示使用。 */ /\balt=["']([^"']*)["']/i);
        return imageText('', alt?.[1] || '');
      });

      text = text.replace(/* 复制时将 HTML 换行标签还原为真正的文本换行。 */ /<br\s*\/?\s*>/gi, '\n').replace(/* 将段落、列表项和表格行的闭合标记解释为文本换行。 */ /<\/(?:p|div|li|tr)>/gi, '\n').replace(/* 相邻 HTML 表格单元格用制表符分隔。 */ /<\/(?:td|th)>\s*(?=<(?:td|th)\b)/gi, '\t');
      if (/* 只有出现标签或字符实体时才用纯文本转换处理预览内容。 */ /<\/?[a-z][^>]*>|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(text)) {
        const template = document.createElement('template');
        template.innerHTML = text;
        template.content.querySelectorAll('script,style,iframe,object').forEach((node) => node.remove());

        text = template.content.textContent || '';
      }

      text = text.replace(/* 清除未包在图片标记中的内嵌数据地址，只留下可读占位。 */ /data:image\/[^\s)]+/gi, () => imageText('', ''));

      for (const img of normalizeQuestionImagesForWebV83(q.images)) {
        const src = img.dataUrl || img.localPath;
        if (!seen.has(src)) {
          text += `\n${imageText(src, img.sourceName)}`;
        }
      }

      return { text, hasImages };
    }

    // 仅打开仍属于当前题库的题目详情，并在关闭后恢复触发控件的焦点。
    function openBankQuestionDetail(bank, q, trigger, full) {
      if (!q || activeBank() !== bank) {
        return;
      }

      const row = trigger.closest('tr'); const table = trigger.closest('table'); const button = row.querySelector('[data-preview-question]');
      const favorite = table.id === 'favorites-list-v596';
      const current = document.getElementById('bank-question-detail');
      if (current?.previousElementSibling === row) {
        if (full) {
          current.querySelector('h3').focus();
          current.querySelector('h3').scrollIntoView({ block: 'nearest' });
        } else {
          closeBankQuestionDetail();
          button.focus();
        }

        return;
      }

      closeBankQuestionDetail();
      const preview = bankQuestionPreview(q); const copy = bankQuestionCopyText(q); const answers = q.answer || q.answerKeys || []; const { options } = preview;
      const type = normalizeWebQuestionType(q.type);
      let empty = i18n.text('banks.noChoices');
      if (type === 'judge') {
        empty = i18n.text('banks.noJudgeChoices');
      }

      if (type === 'blank' || type === 'short') {
        empty = i18n.text('banks.choicesNotNeeded');
      }

      const detail = document.createElement('tr');
      detail.id = 'bank-question-detail';
      detail.innerHTML = `<td colspan="${table.tHead.rows[0].cells.length}"><section class="bank-detail" aria-labelledby="bank-detail-title"><div class="bank-detail-toolbar"><h3 id="bank-detail-title" tabindex="-1">${i18n.html('banks.fullText')}${favorite ? ` <span class="pill">${i18n.html('question.bankPosition', { number: bank.questions.indexOf(q) + 1 })}</span>` : ''}</h3><div><button type="button" class="ghost mini-btn" data-copy-question>${i18n.html('banks.copyStem')}</button> <button type="button" class="ghost mini-btn" data-close-detail>${i18n.html('banks.closeDetail')}</button></div></div><div class="bank-detail-status" role="status" aria-live="polite"></div><div class="bank-detail-body">${copy.text.trim() ? renderQuestionBodyV83(preview) : i18n.text('banks.noText')}</div><h4>${i18n.html('question.options')}</h4>${options.map((o) => {
        const matches = answers.includes(o.key) && options.filter((item) => item.key === o.key).length === 1;
        return `<div class="bank-detail-option${matches ? ' is-answer' : ''}"><b>${esc(o.key)}</b><div>${o.text ? renderQuestionContent(o.text) : i18n.text('banks.emptyChoice')}</div>${matches ? `<span>${i18n.html('banks.savedAnswer')}</span>` : ''}</div>`;
      }).join('')}${!options.length ? `<p class="muted">${empty}</p>` : ''}<p><b>${i18n.html('banks.savedAnswerLabel')}</b>${esc(answers.length ? answerDisplay(answers) : i18n.text('banks.noAnswer'))}</p>${favorite && q.analysis ? `<div class="bank-detail-analysis"><b>${i18n.html('question.analysis')}</b>${renderQuestionContent(q.analysis)}</div>` : ''}<div class="bank-manual-copy" hidden><label for="bank-question-manual-copy">${i18n.html('banks.stemPlainText')}</label><textarea id="bank-question-manual-copy" readonly></textarea><button type="button" class="ghost mini-btn" data-select-copy>${i18n.html('banks.selectText')}</button> <button type="button" class="ghost mini-btn" data-hide-copy>${i18n.html('banks.hideCopy')}</button></div></section></td>`;

      row.after(detail);
      bindBankQuestionDetailToolbar(detail, table);
      i18n.bindText(button, 'banks.collapseDetail');
      button.setAttribute('aria-expanded', 'true');
      bindBankQuestionDetailCopy(detail, copy, button);

      detail.querySelectorAll('img').forEach(/* 给加载失败的图片提供可读文字，保留其题目上下文和已知描述。 */ (img) => img.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.textContent = i18n.text('banks.imageLoadFailed', { description: img.alt || i18n.text('banks.questionImage') });
        img.replaceWith(fallback);
      }, { once: true }));

      if (full) {
        detail.querySelector('h3').focus();
        detail.querySelector('h3').scrollIntoView({ block: 'nearest' });
      }
    }

    // 详情关闭时释放窗口监听，使其他详情或其他页的滚动不再访问旧节点。
    function bindBankQuestionDetailToolbar(detail, table) {
      // 表格横向滚动容器会限制 CSS sticky，工具栏只在本详情范围内平移，并随关闭释放监听。
      const toolbar = detail.querySelector('.bank-detail-toolbar');
      // 让题目详情和工具栏随表格可见区域调整，避免窄布局裁切操作。
      const moveToolbar = () => {
        detail.querySelector('.bank-detail').style.width = `${table.parentElement.clientWidth}px`;
        toolbar.style.transform = '';
        const bounds = detail.getBoundingClientRect(); const bar = toolbar.getBoundingClientRect();
        const topbar = document.querySelector('.topbar'); const topBounds = topbar?.getBoundingClientRect();
        const fixedTop = topbar && ['fixed', 'sticky'].includes(window.getComputedStyle(topbar).position) && topBounds.bottom > 0 ? topBounds.bottom : 0;
        const offset = Math.max(0, Math.min(fixedTop + 8 - bar.top, bounds.bottom - bar.bottom - 8));
        toolbar.style.transform = `translateY(${offset}px)`;
      };

      document.addEventListener('scroll', moveToolbar, true);
      window.addEventListener('resize', moveToolbar);
      detail.addEventListener('preview-close', () => {
        document.removeEventListener('scroll', moveToolbar, true);
        window.removeEventListener('resize', moveToolbar);
      }, { once: true });

      moveToolbar();
    }

    // 自动复制失败时显示可手动选择的文字，同时忽略已关闭详情的写入结果。
    function bindBankQuestionDetailCopy(detail, copy, button) {
      const copyButton = detail.querySelector('[data-copy-question]'); const status = detail.querySelector('[role="status"]'); const manual = detail.querySelector('.bank-manual-copy'); const field = detail.querySelector('textarea');
      field.value = copy.text;
      copyButton.disabled = !copy.text.trim();
      if (copy.hasImages) {
        status.textContent = i18n.text('banks.copyImagesHint');
      }

      detail.querySelector('[data-close-detail]').onclick = () => {
        closeBankQuestionDetail();
        button.focus();
        button.scrollIntoView({ block: 'nearest' });
      };

      detail.querySelector('[data-select-copy]').onclick = () => {
        field.focus();
        field.select();
      };

      detail.querySelector('[data-hide-copy]').onclick = () => {
        manual.hidden = true;
        copyButton.focus();
      };

      copyButton.onclick = /* 将题目复制给系统剪贴板，并独立反馈复制成功或失败。 */ async () => {
        try {
          await navigator.clipboard.writeText(copy.text);
          if (!detail.isConnected) {
            return;
          }

          status.textContent = copy.hasImages ? i18n.text('banks.copiedImages') : i18n.text('banks.copiedText');
          copyButton.textContent = i18n.text('banks.copied');
          setTimeout(() => {
            if (detail.isConnected) {
              i18n.bindText(copyButton, 'banks.copyStem');
            }
          }, 1800);
        } catch {
          if (!detail.isConnected) {
            return;
          }

          status.textContent = i18n.text('banks.copyManually');
          manual.hidden = false;
          field.focus();
          field.select();
        }
      };
    }

    return { closeBankQuestionDetail, renderBankSelect, renderMergeSelect, renderBankInputs, renderBankList, setupBankManagement, renderBankPreview, bankQuestionCopyText, openBankQuestionDetail, resetBankQuestionSelection, cancelPendingBankPreview };
  }

  globalThis.ShirohaBankPage = { create };
})();
