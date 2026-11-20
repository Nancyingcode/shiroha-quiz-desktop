// 内置题库的启动数据和手动加载入口共用题库形状，写入由应用事务负责。
(() => {
  'use strict';

  const BUILT_IN_BANK_ID = 'default-c1';
  // 兼容按显示名称保存的旧内置题库，即使历史版本未使用固定 ID。
  const LEGACY_BUILT_IN_NAME = /C1驾照科目一/;

  // 应用决定何时补库或挂载控件，装配时不读取资源或页面。
  function create({
    state,
    select: $,
    resources,
    normalizeQuestion,
    setBankScope,
    storage,
    renderAll,
    toast,
    warnDev,
    now,
  }) {
    // 启动和手动加载使用同一库标识，空占位库保留待加载标记。
    function createBank(name, questions) {
      return {
        id: BUILT_IN_BANK_ID,
        name,
        groupName: '',
        createdAt: now(),
        updatedAt: now(),
        questions,
        builtInLazy: !questions.length,
      };
    }

    // 首次启动可以同步从内置脚本构造题库，脚本缺失时保留占位库。
    function defaultBank() {
      const bundled = resources.bank();
      const questions = Array.isArray(bundled?.questions) ? bundled.questions : [];
      const name = questions.length ? (bundled.meta?.title || '默认题库') : '内置题库（待加载）';
      return createBank(name, questions.map(normalizeQuestion));
    }

    // 手动优先读取本地 JSON，兼容直接打开 HTML 时从内置脚本取数据。
    async function readBankResource() {
      let data = null;
      let item = null;
      try {
        const index = resources.index() || await resources.json('data/banks-index.json');
        item = (index || [])[0];
        if (item) {
          data = await resources.json(item.file || 'data/c1-full.json');
        }
      } catch (error) {
        warnDev('按需读取内置题库 JSON 失败，转用 question-bank.js 内置兜底数据。', error);
      }

      if (data) {
        return { data, item };
      }

      const bundled = resources.bank();
      if (!Array.isArray(bundled?.questions)) {
        throw new Error('未找到内置题库数据');
      }

      const bundledItem = (resources.index() || [])[0] || { name: bundled.meta?.title || 'C1 驾照科目一模拟练习题库' };
      return { data: bundled, item: bundledItem };
    }

    // 将占位替换和范围切换纳入同一次保存，失败时由应用回滚并允许重试。
    async function load() {
      return storage.transaction(/* 正文通过检查后才替换原位题库或新增题库。 */ async () => {
        try {
          const { data, item } = await readBankResource();
          const questions = (data.questions || []).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
          if (!questions.length) {
            throw new Error('内置题库为空');
          }

          const bank = createBank(data.meta?.title || item?.name || '默认题库', questions);
          const replaceAt = state.banks.findIndex((entry) => entry.id === BUILT_IN_BANK_ID || entry.builtInLazy);
          if (replaceAt >= 0) {
            state.banks[replaceAt] = bank;
          } else {
            state.banks.push(bank);
          }

          state.settings = { ...(state.settings || {}), suppressDefaultBank: false };
          setBankScope(bank.id, true);
          await storage.save();
          renderAll();
          toast(`已加载内置题库：${bank.name}，共 ${bank.questions.length} 题。`, 'ok');
        } catch (error) {
          warnDev('加载内置题库失败', error);
          // eslint-disable-next-line prefer-template -- 异常信息可能是对象，保留 + 的默认转换；统一异常类型后移除此例外。
          toast('加载内置题库失败：' + error.message, 'danger');
        }
      });
    }

    // 题库页按需补上内置题库面板，恢复重入时复用已有面板。
    function ensurePanel() {
      if ($('#builtin-bank-panel-v252')) {
        return;
      }

      const bankList = $('#bank-list');
      if (!bankList) {
        return;
      }

      bankList.insertAdjacentHTML('beforebegin', `
        <div id="builtin-bank-panel-v252" class="builtin-bank-card-v252 compact-built-in-v33">
          <div class="section-head compact-head-v23">
            <div><h3>内置 C1 题库</h3><p class="muted">本地没有 C1 题库时，可重新加入。</p></div>
            <button id="load-built-in-bank-btn-panel" class="primary" type="button">加载内置 C1 题库</button>
          </div>
          <div id="builtin-bank-status-v252" class="muted"></div>
        </div>`);
    }

    // 两处可选旧入口和当前面板复用同一个加载流程。
    function bind() {
      ensurePanel();
      for (const selector of ['#load-built-in-bank-btn', '#load-built-in-bank-btn-banks', '#load-built-in-bank-btn-panel']) {
        const button = $(selector);
        if (button) {
          button.onclick = load;
        }
      }
    }

    // 有可用内置库时隐藏面板，保留空占位库和加载失败后的入口。
    function render() {
      const panel = $('#builtin-bank-panel-v252');
      const status = $('#builtin-bank-status-v252');
      if (!status) {
        return;
      }

      const hasLoadedBank = state.banks.some((bank) => bank.id === BUILT_IN_BANK_ID && (bank.questions || []).length > 0)
        || state.banks.some((bank) => LEGACY_BUILT_IN_NAME.test(bank.name || ''));
      if (panel) {
        panel.hidden = hasLoadedBank;
      }

      status.textContent = hasLoadedBank ? '已加载，可直接使用。' : '当前未加入 C1 题库。';
    }

    return { defaultBank, bind, render };
  }

  globalThis.ShirohaBuiltInBank = { create };
})();
