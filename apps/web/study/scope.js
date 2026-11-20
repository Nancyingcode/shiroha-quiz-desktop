// 题库、首页、练习和考试共享练习范围及本轮题目的来源规则。
(() => {
  'use strict';

  const BANK = 'bank';
  const GROUP = 'group';
  const { bankGroupName, defaultGroup, normalizeGroupName } = globalThis.ShirohaBankMetadata;

  function normalize(scope) {
    const raw = scope && typeof scope === 'object' ? scope : {};
    const type = String(raw.type || '').toLowerCase() === GROUP ? GROUP : BANK;
    return { type, value: String(raw.value || '').trim() };
  }

  // 为跨库练习准备带来源的题目条目，并保证本轮标识不会碰撞。
  function itemsForBanks(banks) {
    const used = new Map();
    const keys = new Set();
    const items = [];
    // 历史题号或题库 ID 可能包含分隔符，去重后缀也可能与另一题的原始键相同。
    // 按题库和原题顺序展开范围，为各条练习数据保留题库来源。
    for (const bank of banks || []) {
      const groupName = bankGroupName(bank);
      // 为历史重复标识选择唯一后缀，避免碰撞覆盖本轮答案。
      for (const question of bank.questions || []) {
        const base = `${bank.id}#${question.id}`;
        let n = used.get(base) || 0;
        let key = n ? `${base}#${n}` : base;
        while (keys.has(key)) {
          n += 1;
          key = `${base}#${n}`;
        }

        used.set(base, n + 1);
        keys.add(key);
        items.push({ sessionKey: key, bankId: bank.id, bankName: bank.name || '', groupName, question });
      }
    }

    return items;
  }

  function question(item) {
    return item && item.question && typeof item.question === 'object' ? item.question : item;
  }

  // 通过应用的当前状态解析范围，恢复或回滚可以替换题库及设置对象。
  function create({
    state,
    select,
    escape,
    resetPages,
  }) {
    function findBank(id) {
      return (state.banks || []).find((bank) => bank.id === id);
    }

    function activeBank() {
      return findBank(state.activeBankId) || state.banks[0] || { questions: [] };
    }

    function scopeSettings() {
      if (!state.settings || typeof state.settings !== 'object') {
        state.settings = {};
      }

      return state.settings;
    }

    function groupExists(group) {
      return Boolean(group) && (state.banks || []).some((bank) => bankGroupName(bank) === group);
    }

    // 校准历史设置里的练习范围，失效分组或题库回退到可用范围。
    function current() {
      const settings = scopeSettings();
      const { type, value } = normalize(settings.practiceScope);
      if (type === GROUP) {
        const group = normalizeGroupName(value);
        if (groupExists(group)) {
          settings.practiceScope = { type: GROUP, value: group };
          return settings.practiceScope;
        }
      }

      const bank = type === BANK ? findBank(value) : undefined;
      settings.practiceScope = { type: BANK, value: (bank || activeBank()).id || '' };
      return settings.practiceScope;
    }

    // 为选题和统计解析练习范围，单库选择失效时回退到活动题库。
    function banksForScope(scopeOverride) {
      const scope = scopeOverride ? normalize(scopeOverride) : current();
      if (scope.type === GROUP) {
        const group = normalizeGroupName(scope.value);
        return (state.banks || []).filter((bank) => bankGroupName(bank) === group);
      }

      const bank = findBank(scope.value) || activeBank();
      return bank && bank.id ? [bank] : [];
    }

    // 练习和考试使用同一套范围名称，兼容题库尚未加载的情况。
    function label(scopeOverride) {
      const scope = scopeOverride ? normalize(scopeOverride) : current();
      if (scope.type === GROUP) {
        return normalizeGroupName(scope.value) || defaultGroup;
      }

      return banksForScope(scope)[0]?.name || '当前题库';
    }

    // 分组范围同时显示题库数和题数，方便用户核对跨库选题范围。
    function summary(scopeOverride) {
      const scope = scopeOverride ? normalize(scopeOverride) : current();
      const banks = banksForScope(scope);
      const total = banks.reduce((count, bank) => count + (bank.questions || []).length, 0);
      return scope.type === GROUP ? `${banks.length} 个题库 · ${total} 题` : `${total} 题`;
    }

    // 只允许已有题库成为练习范围，按调用场景决定是否同步切换当前题库。
    function setBank(bankId, setActive = true) {
      const bank = findBank(bankId);
      if (!bank) {
        return false;
      }

      if (setActive && state.activeBankId !== bank.id) {
        resetPages();
        state.activeBankId = bank.id;
      }

      scopeSettings().practiceScope = { type: BANK, value: bank.id };
      return true;
    }

    // 从分组选项切换练习范围时，拒绝已经不存在的分组。
    function setGroup(groupName) {
      const group = normalizeGroupName(groupName);
      if (!groupExists(group)) {
        return false;
      }

      scopeSettings().practiceScope = { type: GROUP, value: group };
      return true;
    }

    function itemBankId(item) {
      return (item && item.bankId) || activeBank().id;
    }

    function itemBankName(item) {
      return (item && item.bankName) || findBank(itemBankId(item))?.name || activeBank().name || '';
    }

    function itemKey(item) {
      const q = question(item);
      return (item && item.sessionKey) || `${itemBankId(item)}#${(q && q.id) || ''}`;
    }

    function questionRef(item) {
      return { bankId: itemBankId(item), questionId: question(item).id };
    }

    function bankQuestionNumber(item) {
      const bank = findBank(itemBankId(item));
      const index = bank ? bank.questions.findIndex((entry) => entry.id === question(item).id) : -1;
      return index < 0 ? null : index + 1;
    }

    // 显示来源题库里的原题序号，原题已不可定位时明确显示未知。
    function sourceMeta(item) {
      const position = bankQuestionNumber(item);
      const number = position === null ? '题库题号未知' : `题库第 ${position} 题`;
      return `<span class="pill practice-source-number">${number}</span>`
        + `<span class="practice-source-bank">${escape(itemBankName(item))}</span>`;
    }

    // 让首页与题库页反映同一个练习范围和题量。
    function render() {
      const scope = current();
      const name = label(scope);
      const counts = summary(scope);
      const markup = `<b>${escape(name)}</b><small>${escape(counts)}</small>`;
      const home = select('#home-practice-scope-v8916');
      if (home) {
        const title = scope.type === GROUP ? '当前练习范围' : '当前题库';
        home.innerHTML = `<span>${title}</span>${markup}`;
      }

      const bank = select('#bank-practice-scope-v8916');
      if (bank) {
        const activeName = escape(activeBank().name || '暂无题库');
        bank.innerHTML = `<div><span>当前题库</span><b>${activeName}</b></div><div><span>练习范围</span>${markup}</div>`;
      }

      const practice = select('#practice-scope-summary-v8916');
      if (practice) {
        practice.innerHTML = `<span>题目来源</span>${markup}`;
      }

      const exam = select('#exam-bank-summary-v8916');
      if (exam) {
        exam.textContent = `考试范围：${name}（跟随当前练习范围 · ${counts}）`;
      }
    }

    return {
      activeBank,
      current,
      banks: banksForScope,
      label,
      summary,
      setBank,
      setGroup,
      itemKey,
      itemBankId,
      itemBankName,
      questionRef,
      bankQuestionNumber,
      sourceMeta,
      render,
    };
  }

  globalThis.ShirohaStudyScope = Object.freeze({
    create,
    bankType: BANK,
    groupType: GROUP,
    normalize,
    itemsForBanks,
    question,
  });
})();
