(() => {
  'use strict';
  function create({ state, draft: importDraft, select: $, toast, now, makeId, scope, data, preview, navigation, actions }) {
    const { current: practiceScopeV8916, groupType: PRACTICE_SCOPE_GROUP_V8916, ensure: ensurePracticeScopeV8916,
      groupName: bankGroupNameV58, normalizeGroup: normalizeBankGroupNameV58, readGroup: readImportBankGroupV58,
      ensureGroupUi: ensureBankGroupUiV58 } = scope;
    const { normalize: normalizeQuestion, clean: cleanImportedQuestion, warnings: collectImportWarnings,
      loadBanks: loadNativeBanks, confirmDeletion: confirmBankQuestionDeletion,
      removeReferences: removeBankQuestionReferences } = data;
    const { cancelAi: cancelAiPreviewRequestV991, resetAi: resetAiSuggestionsV991, closeAi: closeAiPreviewPanelV991,
      render: renderImportPreview, resetSelection: resetBankQuestionSelection } = preview;
    const { switchView: switchViewV45 } = navigation;
    const { transaction: runMutation, save: saveSilent, renderAll } = actions;
    // 二次编辑会话仅在打开编辑器后存在；成功保存或确认退出时释放。
    let bankEditSessionV45 = null;
    function ensureBankEditPanelV45() {
      let panel = $('#bank-edit-panel-v45');
      const summary = $('#import-summary');
      if (!summary) {
        return null;
      }
      if (!panel) {
        summary.insertAdjacentHTML('beforebegin', '<div id="bank-edit-panel-v45" class="bank-edit-panel-v45 hidden"><div><b>题库二次编辑</b><span id="bank-edit-title-v45"></span></div><div class="bank-edit-panel-actions-v45"><button class="primary" id="bank-edit-save-v45" type="button">保存回题库</button><button class="ghost" id="bank-edit-cancel-v45" type="button">退出编辑</button></div></div>');
        panel = $('#bank-edit-panel-v45');
        $('#bank-edit-save-v45').onclick = saveBankEditSessionV45;
        $('#bank-edit-cancel-v45').onclick = cancelBankEditSessionV45;
      }
      return panel;
    }
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
          title.textContent = `正在编辑：${b?.name || bankEditSessionV45.name || '题库'}｜${count || importDraft.questions.length} 题`;
        }
        if (confirmBtn) {
          confirmBtn.textContent = '保存回题库';
          confirmBtn.disabled = false;
        }
        if (dualConfirm) {
          dualConfirm.textContent = '保存回题库';
          dualConfirm.disabled = false;
        }
      } else {
        panel.classList.add('hidden');
        if (confirmBtn) {
          confirmBtn.textContent = '确认导入';
        }
        if (dualConfirm) {
          dualConfirm.textContent = '确认导入';
        }
      }
    }
    function bankEditQuestionSnapshot(questions) {
      // 桌面分页释放、重载正文会改变属性插入顺序；冲突判断只比较实际内容与题目顺序。
      return JSON.stringify(questions, (_key, value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value));
    }
    async function editBankByIdV45(id) {
      if (!await loadNativeBanks([id])) {
        return;
      }
      cancelAiPreviewRequestV991(true);
      resetAiSuggestionsV991();
      closeAiPreviewPanelV991();
      const bank = state.banks.find((b) => b.id === id);
      if (!bank) {
        toast('没有找到该题库。', 'warn');
        return;
      }
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
      await switchViewV45('import');
      renderImportPreview(importDraft.questions);
      setTimeout(() => {
        $('#bank-edit-panel-v45')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
      toast('已进入题库二次编辑。', 'ok');
    }
    async function saveBankEditSessionV45() {
      if (bankEditSessionV45 && !await loadNativeBanks([bankEditSessionV45.bankId])) {
        return;
      }
      return runMutation(async () => {
        if (!bankEditSessionV45) {
          return;
        }
        const bank = state.banks.find((b) => b.id === bankEditSessionV45.bankId);
        if (!bank) {
          toast('原题库不存在，无法保存。', 'danger');
          return;
        }
        if (bankEditQuestionSnapshot(bank.questions) !== bankEditSessionV45.sourceQuestions) {
          toast('题库已变化，请退出编辑后重新打开，避免覆盖其他修改。', 'warn');
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
        const oldGroupName = bankGroupNameV58(bank);
        bank.name = name;
        bank.groupName = groupName;
        bank.updatedAt = now();
        bank.questions = importDraft.questions.map((q, i) => (bankEditSessionV45.previewQuestions.get(q.id) === JSON.stringify(q) ? originals.get(q.id) : cleanImportedQuestion({ ...q, id: q.id || makeId('q', i) })));
        removeBankQuestionReferences(bank.id, deletedIds);
        const scopeBefore = practiceScopeV8916();
        if (scopeBefore.type === PRACTICE_SCOPE_GROUP_V8916 && scopeBefore.value === oldGroupName && state.banks.every((x) => x.id === bank.id || bankGroupNameV58(x) !== oldGroupName)) {
          ensurePracticeScopeV8916();
          toast('原练习分组已无题库，已切换为当前题库。', 'warn');
        }
        await saveSilent();
        bankEditSessionV45 = null;
        resetBankQuestionSelection();
        importDraft.report = '';
        importDraft.diagnostics = null;
        importDraft.selected.clear();
        updateBankEditUiV45(0);
        renderAll();
        await switchViewV45('banks');
        toast(`已保存题库“${name}”：${bank.questions.length} 道题${warnings.length ? `，仍有 ${warnings.length} 条提示可后续再核对` : ''}。`, warnings.length ? 'warn' : 'ok');
      });
    }
    async function cancelBankEditSessionV45() {
      if (!bankEditSessionV45) {
        return;
      }
      resetAiSuggestionsV991();
      if (!await globalThis.ShirohaDialogs.confirm('退出题库二次编辑？未保存的修改不会写回题库。')) {
        return;
      }
      bankEditSessionV45 = null;
      importDraft.questions = [];
      importDraft.selected.clear();
      importDraft.warnings = [];
      importDraft.report = '';
      importDraft.diagnostics = null;
      renderImportPreview([]);
      await switchViewV45('banks');
    }
    return { updateBankEditUiV45, editBankByIdV45, saveBankEditSessionV45, current: () => bankEditSessionV45 };
  }
  globalThis.ShirohaBankEditor = { create };
})();
