// 题库列表和编辑器共用删题确认及引用清理，写入继续由应用事务负责。
(() => {
  'use strict';

  // 只在实际删除时读取当前会话、练习范围和选库状态。
  function create({
    state,
    sessions,
    scope,
    selection,
    storage,
    dialogs,
    rendering,
    now,
  }) {
    const { all: renderAll, resetQuestionSelection, toast } = rendering;

    // 同一题目 ID 可以出现在不同库，只阻止删除仍被会话占用的来源题目。
    function bankQuestionDeletionBlocked(bankId, ids) {
      const { practice, exam } = sessions;
      const contains = (items) => (items || []).some((item) => (
        sessions.bankIdOf(item) === bankId && ids.has(sessions.questionOf(item).id)
      ));

      return (!practice.current.completed && contains(practice.current.items))
        || (!exam.current.submitted && contains(exam.current.items));
    }

    // 删除试题前保护正在用题的会话，再确认关联数据的清理范围。
    async function confirmBankQuestionDeletion(bank, ids) {
      if (bankQuestionDeletionBlocked(bank.id, ids)) {
        toast('这些试题正在练习或考试中，请先结束相关会话后再删除。', 'warn');
        return false;
      }

      const message = `确定从“${bank.name}”删除 ${ids.size} 道试题？对应错题和收藏会一并移除，历史成绩保留。删除后不能直接撤销。`;
      return dialogs.confirm(message);
    }

    // 删除试题后清理它对应的本库错题及收藏引用，避免留下失效入口。
    function removeBankQuestionReferences(bankId, ids) {
      if (Array.isArray(state.wrongBook[bankId])) {
        state.wrongBook[bankId] = state.wrongBook[bankId].filter((entry) => !ids.has(typeof entry === 'string' ? entry : entry.id));
      }

      if (Array.isArray(state.favorites?.[bankId])) {
        state.favorites[bankId] = state.favorites[bankId].filter((id) => !ids.has(id));
      }

      const metadata = state.crossPlatformMeta?.favoriteQuestions?.[bankId];
      if (metadata) {
        ids.forEach((id) => delete metadata[id]);
      }
    }

    // 仅在可保存时发起删除，并将题目和关联引用变更放在同一事务里。
    async function deleteBankQuestions(bankId, questionIds) {
      if (!storage.canStart()) {
        return false;
      }

      const requested = new Set(questionIds);
      if (!await storage.loadBanks([bankId])) {
        return false;
      }

      return storage.transaction(
        // 保存前重新定位目标库并确认有效的删除范围，随后保存和刷新视图。
        async () => {
          const bank = state.banks.find((item) => item.id === bankId);
          if (!bank) {
            return;
          }

          const ids = new Set(bank.questions.filter((question) => requested.has(question.id)).map((question) => question.id));
          if (!ids.size) {
            toast('请先选择要删除的试题。', 'warn');
            return;
          }

          if (!await confirmBankQuestionDeletion(bank, ids)) {
            return;
          }

          bank.questions = bank.questions.filter((question) => !ids.has(question.id));

          bank.updatedAt = now();
          removeBankQuestionReferences(bankId, ids);
          await storage.save();
          resetQuestionSelection();
          renderAll();
          toast(`已删除 ${ids.size} 道试题。`, 'ok');
        },
        // 离页可能释放正文，重试从最初库和题目的预读开始。
        () => deleteBankQuestions(bankId, requested),
      );
    }

    // 将批量删库及依赖数据清理放在同一保存事务内。
    async function deleteBanksV32(ids) {
      const requested = new Set((ids || []).filter(Boolean));
      return storage.transaction(/* 重新确认目标题库和用户选择后再清理，防止延迟操作影响其他题库。 */ async () => {
        const targets = state.banks.filter((bank) => requested.has(bank.id));
        if (!targets.length) {
          toast('请先选择要删除的题库。', 'warn');
          return;
        }

        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        const preview = targets.slice(0, 4).map((b) => '“' + b.name + '”').join('、') + (targets.length > 4 ? ' 等' : '');
        const confirmation = `确定删除 ${targets.length} 个题库：${preview}？删除后不会影响已导出的备份，但本机数据不可恢复。`;
        if (!await dialogs.confirm(confirmation)) {
          return;
        }

        const deletedIds = new Set(targets.map((bank) => bank.id));
        state.banks = state.banks.filter((bank) => !deletedIds.has(bank.id));

        const selectedBanks = selection.get();
        deletedIds.forEach(/* 删除题库时清理关联索引，避免收藏或错题指向已删除的题库。 */ (id) => {
          delete state.wrongBook[id];
          if (state.favorites) {
            delete state.favorites[id];
          }

          const favoriteQuestions = state.crossPlatformMeta?.favoriteQuestions;
          if (favoriteQuestions) {
            delete favoriteQuestions[id];
          }

          selectedBanks.delete(id);
        });

        if (!state.banks.length) {
          state.activeBankId = '';
          state.settings = { ...(state.settings || {}), suppressDefaultBank: true };
        } else if (!state.banks.some((bank) => bank.id === state.activeBankId)) {
          state.activeBankId = state.banks[0]?.id || '';
        }

        const beforeScope = scope.normalize(state.settings?.practiceScope);
        const afterScope = scope.ensure();
        await storage.save();
        renderAll();
        const groupWasCleared = beforeScope.type === scope.groupType && afterScope.type === scope.bankType;
        const success = `已删除 ${targets.length} 个题库。`;
        toast(groupWasCleared ? `${success}原练习分组已无题库，已切换为当前题库。` : success, groupWasCleared ? 'warn' : 'ok');
      });
    }

    return {
      confirmBankQuestionDeletion,
      removeBankQuestionReferences,
      deleteBankQuestions,
      deleteBanksV32,
    };
  }

  globalThis.ShirohaBankDeletion = Object.freeze({ create });
})();
