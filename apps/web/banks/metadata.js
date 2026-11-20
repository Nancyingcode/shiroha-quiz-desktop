// 题库名称、分组和空库操作共用应用的保存事务与练习范围。
(() => {
  'use strict';

  const DEFAULT_BANK_GROUP = '未分组';
  const BANK_GROUP_MAX_LENGTH = 60;
  const EMPTY_BANK_NAME = '新建空题库';

  function normalizeGroupName(value) {
    return String(value ?? '').replace(/* 将空白折叠成单个空格，使导入标签保持单行。 */ /\s+/g, ' ')
      .trim().slice(0, BANK_GROUP_MAX_LENGTH);
  }

  function bankGroupName(bank) {
    return normalizeGroupName(bank && bank.groupName) || DEFAULT_BANK_GROUP;
  }

  // 旧备份可以使用分组别名，显式空的 groupName 保留未分组语义。
  function pickGroupNameFromJson(bank) {
    if (!bank || typeof bank !== 'object') {
      return '';
    }

    return normalizeGroupName(bank.groupName ?? bank.bankGroup ?? bank.parentName ?? bank.groupTitle ?? '');
  }

  function bankNameKey(groupName, name) {
    const group = normalizeGroupName(groupName).toLocaleLowerCase('zh-CN');
    const title = String(name || '题库').trim().toLocaleLowerCase('zh-CN');
    return `${group}::${title}`;
  }

  function bankPathLabel(bank) {
    return `${bankGroupName(bank)} / ${bank?.name || '题库'}`;
  }

  function groupSuggestions(banks) {
    const names = (banks || []).map((bank) => normalizeGroupName(bank.groupName)).filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  // 题库页完成控件装配后才读取输入，保存使用应用提供的事务。
  function create({
    state,
    select: $,
    activeBank,
    scope,
    dialogs,
    storage,
    renderAll,
    toast,
    makeId,
    now,
  }) {
    // 在保存事务中校验用户输入的题库名，取消或失败时不提交空名称。
    async function renameActiveBank() {
      return storage.transaction(/* 从当前界面读取新名称，确认有效后保存及刷新相关视图。 */ async () => {
        const bank = activeBank();
        const name = $('#bank-rename-input').value.trim();
        if (!name) {
          await dialogs.alert('请输入新的题库名称。');
          return;
        }

        const groupInput = $('#bank-group-rename-input-v58');
        // 读取当前范围会校准失效分组，因此先记录修改分组前的范围。
        const before = scope.current();
        bank.name = name;
        bank.groupName = normalizeGroupName(groupInput?.value || bank.groupName);
        bank.updatedAt = now();
        const after = scope.current();
        const scopeFellBack = before.type === scope.groupType && after.type === scope.bankType;

        await storage.save();
        if (groupInput) {
          groupInput.dataset.lastBankIdV58 = '';
        }

        renderAll();
        if (scopeFellBack) {
          toast('原练习分组已无题库，已切换为当前题库。', 'warn');
        }
      });
    }

    // 新题库创建成功后立即切换过去，便于继续导入或编辑。
    async function newEmptyBank() {
      return storage.transaction(/* 用户确认名称后才创建题库，分组可以留空。 */ async () => {
        const name = await dialogs.prompt('请输入新题库名称：', EMPTY_BANK_NAME);
        if (!name) {
          return;
        }

        const groupName = normalizeGroupName(await dialogs.prompt('请输入一级分组名称，可留空：', '') || '');
        const bank = {
          id: makeId('bank'),
          name: name.trim() || EMPTY_BANK_NAME,
          groupName,
          createdAt: now(),
          updatedAt: now(),
          questions: [],
        };

        state.banks.push(bank);
        scope.setBank(bank.id, true);
        await storage.save();
        renderAll();
      });
    }

    return { renameActiveBank, newEmptyBank };
  }

  globalThis.ShirohaBankMetadata = Object.freeze({
    create,
    defaultGroup: DEFAULT_BANK_GROUP,
    normalizeGroupName,
    pickGroupNameFromJson,
    bankGroupName,
    bankNameKey,
    bankPathLabel,
    groupSuggestions,
  });
})();
