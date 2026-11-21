// 让用户从题库管理进入二次编辑，并用来源快照拦截冲突写入。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;
  // 装配题库二次编辑流程，由页面提供事务、题库和预览入口。
  function create({
    state,
    draft: importDraft,
    select: $,
    toast,
    now,
    makeId,
    scope,
    data,
    preview,
    navigation,
    actions,
  }) {
    const {
      current: practiceScopeV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916,
      bankType: PRACTICE_SCOPE_BANK_V8916,
      normalizeGroup: normalizeBankGroupNameV58,
      readGroup: readImportBankGroupV58,
      ensureGroupUi: ensureBankGroupUiV58,
    } = scope;
    const {
      normalize: normalizeQuestion,
      clean: cleanImportedQuestion,
      warnings: collectImportWarnings,
      loadBanks: loadNativeBanks,
      confirmDeletion: confirmBankQuestionDeletion,
      removeReferences: removeBankQuestionReferences,
    } = data;
    const {
      cancelAi: cancelAiPreviewRequestV991,
      resetAi: resetAiSuggestionsV991,
      closeAi: closeAiPreviewPanelV991,
      render: renderImportPreview,
      resetSelection: resetBankQuestionSelection,
    } = preview;
    const { switchView: switchViewV45 } = navigation;
    const {
      transaction: runMutation,
      save: saveSilent,
      renderAll,
      canStartEdit,
    } = actions;
    // 二次编辑会话仅在打开编辑器后存在；成功保存或确认退出时释放。
    let bankEditSessionV45 = null;
    // 待读取的编辑入口属于发起时的题库页；离页或新入口使旧请求失效。
    let bankEditRequest = 0;
    function cancelPendingBankEdit() {
      bankEditRequest += 1;
    }

    // 复用现有预览容器，只在首次打开时插入并绑定编辑面板。
    function ensureBankEditPanelV45() {
      let panel = $('#bank-edit-panel-v45');
      const summary = $('#import-summary');
      if (!summary) {
        return null;
      }

      if (!panel) {
        summary.insertAdjacentHTML('beforebegin', `<div id="bank-edit-panel-v45" class="bank-edit-panel-v45 hidden"><div><b>${i18n.html('editor.secondary')}</b><span id="bank-edit-title-v45"></span></div><div class="bank-edit-panel-actions-v45"><button class="primary" id="bank-edit-save-v45" type="button">${i18n.html('editor.saveToBank')}</button><button class="ghost" id="bank-edit-cancel-v45" type="button">${i18n.html('editor.exit')}</button></div></div>`);
        panel = $('#bank-edit-panel-v45');
        $('#bank-edit-save-v45').onclick = saveBankEditSessionV45;
        $('#bank-edit-cancel-v45').onclick = cancelBankEditSessionV45;
      }

      return panel;
    }

    // 让预览页在二次编辑时显示回写操作，退出编辑后恢复普通导入入口。
    function updateBankEditUiV45(count = 0) {
      const panel = ensureBankEditPanelV45();
      const confirmBtn = $('#confirm-import-btn');
      const dualConfirm = $('#dual-confirm-import-btn');
      if (!panel) {
        return;
      }

      if (bankEditSessionV45) {
        const b = state.banks.find((x) => x.id === bankEditSessionV45.bankId);
        panel.classList.remove('hidden');
        const title = $('#bank-edit-title-v45');
        if (title) {
          title.textContent = i18n.text('editor.editingBank', { name: b?.name || bankEditSessionV45.name || i18n.text('scope.untitledBank'), count: count || importDraft.questions.length });
        }

        if (confirmBtn) {
          i18n.bindText(confirmBtn, 'editor.saveToBank');
          confirmBtn.disabled = false;
        }

        if (dualConfirm) {
          i18n.bindText(dualConfirm, 'editor.saveToBank');
          dualConfirm.disabled = false;
        }
      } else {
        panel.classList.add('hidden');
        if (confirmBtn) {
          i18n.bindText(confirmBtn, 'import.confirm');
        }

        if (dualConfirm) {
          i18n.bindText(dualConfirm, 'import.confirm');
        }
      }
    }

    function bankEditQuestionSnapshot(questions) {
      // 桌面分页释放、重载正文会改变属性插入顺序；冲突判断只比较实际内容与题目顺序。
      return JSON.stringify(questions, (_key, value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value));
    }

    // 初始化预览草稿和源快照，保存时用快照判断真实改动和编辑冲突。
    function prepareBankEditDraft(bank, id) {
      cancelAiPreviewRequestV991(true);
      resetAiSuggestionsV991();
      closeAiPreviewPanelV991();
      importDraft.invalidatePreview?.();
      importDraft.invalidateBankName?.();
      bankEditSessionV45 = { bankId: id, name: bank.name || '题库', startedAt: now(), sourceQuestions: bankEditQuestionSnapshot(bank.questions) };
      importDraft.questions = (bank.questions || []).map((q, i) => ({ ...q, ...normalizeQuestion(JSON.parse(JSON.stringify(q)), i), number: q.number }));

      // 预览需要归一化字段；未实际编辑的题目保存时使用原对象，避免删除顺带改变题意和元数据。
      bankEditSessionV45.previewQuestions = new Map(importDraft.questions.map((q) => [q.id, JSON.stringify(q)]));

      importDraft.selected.clear();
      importDraft.warnings = [];
      importDraft.report = '从题库管理进入二次编辑：可逐题查看题型、答案、状态提示，并修改后保存回原题库。';
      importDraft.diagnostics = { strategy: '题库二次编辑', mode: '题库管理', expected: { total: importDraft.questions.length }, profile: {} };
      importDraft.filter = 'all';
      ensureBankGroupUiV58();
      const nameInput = $('#import-bank-name');
      if (nameInput) {
        nameInput.value = bank.name || '题库';
        nameInput.dataset.autoName = '0';
      }

      const groupInput = $('#import-bank-group-v58');
      if (groupInput) {
        groupInput.value = normalizeBankGroupNameV58(bank.groupName);
      }
    }

    // 读取题库时保留发起页身份，离页或有新入口时丢弃旧请求结果。
    async function editBankByIdV45(id, button) {
      const isCurrentPage = () => canStartEdit() && button?.isConnected && $('#bank-list')?.contains(button)
        && $('#banks')?.classList.contains('active');

      if (!isCurrentPage()) {
        return;
      }

      const bank = state.banks.find((value) => value.id === id);
      if (!bank) {
        toast(i18n.text('editor.missingBank'), 'warn');
        return;
      }

      bankEditRequest += 1;
      const request = bankEditRequest;
      const isCurrentRequest = () => request === bankEditRequest && isCurrentPage() && state.banks.includes(bank);

      if (!isCurrentRequest() || !await loadNativeBanks([id], isCurrentRequest) || !isCurrentRequest()) {
        return;
      }

      prepareBankEditDraft(bank, id);
      await switchViewV45('import');
      renderImportPreview(importDraft.questions);
      setTimeout(() => {
        $('#bank-edit-panel-v45')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);

      toast(i18n.text('editor.editStarted'), 'ok');
    }

    function saveBankEditSessionV45() {
      return saveBankEditSession(bankEditSessionV45);
    }

    // 读取当前题库后再进入保存事务，避免用过期题库写入。
    async function saveBankEditSession(session) {
      const isCurrentSession = () => session && bankEditSessionV45 === session;

      if (isCurrentSession() && !await loadNativeBanks([session.bankId])) {
        return;
      }

      return runMutation(
        // 对比原始快照并确认删除，在同一事务内保存题库及其关联引用。
        async () => {
          if (!isCurrentSession()) {
            return;
          }

          const bank = state.banks.find((b) => b.id === session.bankId);
          if (!bank) {
            toast(i18n.text('editor.missingSource'), 'danger');
            return;
          }

          if (bankEditQuestionSnapshot(bank.questions) !== session.sourceQuestions) {
            toast(i18n.text('editor.changedBank'), 'warn');
            return;
          }

          const keptIds = new Set(importDraft.questions.map((q) => q.id));
          const deletedIds = new Set(bank.questions.filter((q) => !keptIds.has(q.id)).map((q) => q.id));
          if (deletedIds.size && !await confirmBankQuestionDeletion(bank, deletedIds)) {
            return;
          }

          const originals = new Map(bank.questions.map((q) => [q.id, q]));
          const warnings = collectImportWarnings(importDraft.questions);
          const name = ($('#import-bank-name')?.value || bank.name || '题库').trim() || bank.name || '题库';
          const groupName = readImportBankGroupV58();
          // 读取范围会校准已失效的分组，必须在修改题库前取得原范围。
          const scopeBefore = practiceScopeV8916();
          bank.name = name;
          bank.groupName = groupName;
          bank.updatedAt = now();
          bank.questions = importDraft.questions.map((q, i) => (session.previewQuestions.get(q.id) === JSON.stringify(q) ? originals.get(q.id) : cleanImportedQuestion({ ...q, id: q.id || makeId('q', i) })));

          removeBankQuestionReferences(bank.id, deletedIds);
          const scopeAfter = practiceScopeV8916();
          const scopeFellBack = scopeBefore.type === PRACTICE_SCOPE_GROUP_V8916 && scopeAfter.type === PRACTICE_SCOPE_BANK_V8916;
          await saveSilent();
          bankEditSessionV45 = null;
          resetBankQuestionSelection();
          importDraft.report = '';
          importDraft.diagnostics = null;
          importDraft.selected.clear();
          updateBankEditUiV45(0);
          renderAll();
          await switchViewV45('banks');
          if (scopeFellBack) {
            toast(i18n.text('editor.groupCleared'), 'warn');
          }

          toast(i18n.text(warnings.length ? 'editor.bankSavedWithWarnings' : 'editor.bankSaved', { name, count: bank.questions.length, warnings: warnings.length }), warnings.length ? 'warn' : 'ok');
        },
        // 离开编辑页可释放题目正文，重试仍需为原编辑会话重新预读。
        () => saveBankEditSession(session),
      );
    }

    // 只有确认放弃后才清除编辑草稿并返回题库页。
    async function cancelBankEditSessionV45() {
      if (!bankEditSessionV45) {
        return;
      }

      resetAiSuggestionsV991();
      if (!await globalThis.ShirohaDialogs.confirm(i18n.text('editor.closeEditing'))) {
        return;
      }

      bankEditSessionV45 = null;
      importDraft.invalidatePreview?.();
      importDraft.questions = [];
      importDraft.selected.clear();
      importDraft.warnings = [];
      importDraft.report = '';
      importDraft.diagnostics = null;
      renderImportPreview([]);
      await switchViewV45('banks');
    }

    return { updateBankEditUiV45, editBankByIdV45, saveBankEditSessionV45, cancelPendingBankEdit, current: () => bankEditSessionV45 };
  }

  globalThis.ShirohaBankEditor = { create };
})();
