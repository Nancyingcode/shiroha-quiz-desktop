// 复制、合并与去重需要原生题目正文，写入继续使用应用的保存事务。
(() => {
  'use strict';

  // 装配时只接收依赖，实际操作时读取当前题库和界面选择。
  function create({
    state,
    select: $,
    activeBank,
    setPracticeBankScope,
    normalizeText,
    storage,
    dialogs,
    renderAll,
    makeId,
    now,
  }) {
    // 切页可能释放正文。失败后的重试从同一预读入口开始，避免处理摘要占位。
    async function withBankDetails(ids, action) {
      if (!await storage.loadBanks(ids)) {
        return undefined;
      }

      return storage.transaction(action, () => withBankDetails(ids, action));
    }

    // 先读取原题库完整试题，再复制到拥有独立标识的新题库。
    async function duplicateBankById(id) {
      return withBankDetails([id], /* 仅在源题库仍存在时复制内容，保存后切换到副本。 */ async () => {
        const bank = state.banks.find((item) => item.id === id);
        if (!bank) {
          return;
        }

        const copy = JSON.parse(JSON.stringify(bank));
        copy.id = makeId('bank');
        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        copy.name = bank.name + ' - 副本';
        copy.createdAt = now();
        copy.updatedAt = now();
        copy.questions = (copy.questions || []).map((question, i) => ({ ...question, id: makeId('q', i), number: i + 1 }));

        state.banks.push(copy);
        setPracticeBankScope(copy.id, true);
        await storage.save();
        renderAll();
      });
    }

    function duplicateActiveBank() {
      duplicateBankById(activeBank().id);
    }

    // 合并前确保来源与目标题库数据均可用，避免将未加载的题目当作完整内容。
    async function mergeBankIntoActive() {
      const targetId = activeBank().id;
      const sourceId = $('#merge-bank-select').value;
      return withBankDetails([targetId, sourceId], /* 只合并本次已预读的两个题库。 */ async () => {
        const target = activeBank();
        const selectionChanged = target.id !== targetId || $('#merge-bank-select').value !== sourceId;
        if (selectionChanged) {
          await dialogs.alert('合并的题库已变化，请重新确认。');
          return;
        }

        const source = state.banks.find((bank) => bank.id === sourceId);
        if (!source) {
          await dialogs.alert('没有可合并的来源题库。');
          return;
        }

        if (!await dialogs.confirm(`将“${source.name}”的 ${source.questions.length} 道题合并到当前题库“${target.name}”？`)) {
          return;
        }

        const before = target.questions.length;
        const existing = new Set(target.questions.map((question) => normalizeText(question.question)));
        let added = 0;
        let skipped = 0;
        source.questions.forEach(/* 合并时按规范化题干去重，新题按目标库顺序编号。 */ (question) => {
          const key = normalizeText(question.question);
          if (existing.has(key)) {
            skipped += 1;
            return;
          }

          existing.add(key);
          const number = target.questions.length + 1;
          target.questions.push({ ...JSON.parse(JSON.stringify(question)), id: makeId('q', number), number });
          added += 1;
        });

        target.updatedAt = now();
        await storage.save();
        renderAll();
        await dialogs.alert(`合并完成：新增 ${added} 题，跳过重复 ${skipped} 题。合并前 ${before} 题，当前 ${target.questions.length} 题。`);
      });
    }

    // 对当前题库进行去重前先加载原生题目正文。
    async function dedupeActiveBank() {
      const bankId = activeBank().id;
      return withBankDetails([bankId], /* 保留第一道重复题，并按去重后的顺序重新编号。 */ async () => {
        const bank = activeBank();
        if (bank.id !== bankId) {
          await dialogs.alert('当前题库已变化，请重新执行去重。');
          return;
        }

        const before = bank.questions.length;
        const unique = new Map();
        bank.questions.forEach(/* 用首次出现的题作为同题干条目，保持原顺序。 */ (question) => {
          const key = normalizeText(question.question);
          if (!unique.has(key)) {
            unique.set(key, question);
          }
        });

        bank.questions = [...unique.values()].map((question, i) => ({ ...question, number: i + 1 }));

        const deleted = before - bank.questions.length;
        await storage.save();
        renderAll();
        await dialogs.alert(`去重完成：删除 ${deleted} 道重复题，剩余 ${bank.questions.length} 道。`);
      });
    }

    return {
      duplicateActiveBank, duplicateBankById, mergeBankIntoActive, dedupeActiveBank,
    };
  }

  globalThis.ShirohaBankQuestionOperations = Object.freeze({ create });
})();
