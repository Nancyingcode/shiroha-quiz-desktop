// 单文件和双文件共用确认保存，借用应用的存储事务和题库编辑会话。
(() => {
  'use strict';

  // 提交导入前给进度提示一次绘制机会，避免大量写入挡住反馈。
  function waitForCommitPaint() {
    return new Promise(/* 连等两帧保证有一次绘制机会，无动画帧接口时让出事件循环。 */ (resolve) => {
      if (typeof globalThis.requestAnimationFrame === 'function') {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function isStorageQuotaError(error) {
    const name = String(error?.name || '');
    const code = Number(error?.code || 0);
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
  }

  // 仅在确认时读取控件和草稿，避免装配期依赖导入面板已经初始化。
  function create({
    state,
    draft,
    editor,
    readBankGroup,
    bankPathLabel,
    setPracticeBankScope,
    loadNativeBanks,
    runMutation,
    saveSilent,
    isStringTooLargeError,
    collectImportWarnings,
    cleanImportedQuestion,
    makeId,
    now,
    onImported,
    view: {
      select: $,
      renderAll,
      showNotice,
      toast,
      warnDev,
    },
  }) {
    // 两个确认入口共享在途提交，正文预读到草稿清理期间只接收一次确认。
    let confirmationPending = false;

    function readSaveMode() {
      return $('#import-save-mode-v59')?.value === 'append' ? 'append' : 'new';
    }

    function readTargetId() {
      return $('#import-target-bank-v59')?.value;
    }

    // 同步两个导入入口的保存忙碌状态，保留恢复时所需的原按钮文案。
    function markConfirmButtonsBusy(label) {
      const buttons = [$('#confirm-import-btn'), $('#dual-confirm-import-btn')].filter(Boolean);
      const prior = buttons.map(/* 让每个按钮保留自己的确认文字，保存结束后恢复独立状态。 */ (button) => {
        const text = button.textContent || '确认导入';
        const { disabled } = button;
        button.disabled = true;
        button.textContent = label;
        button.setAttribute('aria-busy', 'true');
        return { button, text, disabled };
      });

      return /* 恢复时使用本次提交各自记录的按钮状态。 */ () => {
        for (const { button, text, disabled } of prior) {
          button.textContent = text;
          button.disabled = disabled;
          button.removeAttribute('aria-busy');
        }
      };
    }

    // 区分存储体积限制与一般保存失败，提示用户可继续处理尚存的预览草稿。
    function saveFailureText(error, action) {
      const suffix = '识别结果仍保留在预览区，可以删除部分题目、拆分文件或清理旧题库后再试。';
      if (isStringTooLargeError(error)) {
        const cause = '题目已经识别完成，但浏览器在生成本地保存数据时失败，通常是当前题库/记录数据过大。';
        return `${cause}${action}内容没有写入，已恢复到保存前状态。${suffix}`;
      }

      if (isStorageQuotaError(error)) {
        const advice = '可先导出完整备份并清理不需要的图片题库、旧记录或旧题库后重试。';
        return `浏览器本地存储空间不足，${action}内容没有写入，已恢复到保存前状态。${advice}${suffix}`;
      }

      const detail = String(error?.message || '').trim();
      return `浏览器未能保存${action}结果，已恢复到保存前状态。${detail ? `错误信息：${detail}` : '请稍后重试。'} ${suffix}`;
    }

    // 保存失败时恢复原活动库，并保持旧设置中可选范围字段的存在性。
    function checkpointPracticeSelection() {
      const { activeBankId, settings } = state;
      const hasSettings = settings && typeof settings === 'object';
      const hadScope = hasSettings && Object.hasOwn(settings, 'practiceScope');
      const scope = settings?.practiceScope;
      const previousScope = hadScope && scope && typeof scope === 'object' ? { ...scope } : scope;
      return /* 保留设置对象身份，避免其他界面握有失效引用。 */ () => {
        state.activeBankId = activeBankId;
        state.settings = settings;
        if (hadScope) {
          settings.practiceScope = previousScope;
        } else if (hasSettings) {
          delete settings.practiceScope;
        }
      };
    }

    // 将预览追加进指定题库，失败时保留原题库和未提交草稿。
    async function appendToBank(target, warnings) {
      // 保存前记录目标库快照，写入失败后恢复题目及更新时间。
      const previousQuestions = Array.isArray(target.questions) ? target.questions : [];
      const previousUpdatedAt = target.updatedAt;
      const restorePracticeSelection = checkpointPracticeSelection();
      const before = previousQuestions.length;
      let incoming;
      const restoreButtons = markConfirmButtonsBusy('正在追加…');
      try {
        const label = bankPathLabel(target);
        showNotice('正在追加', `正在将 ${draft.questions.length} 道题追加到“${label}”，请勿重复点击或关闭页面。`, 'warn');
        await waitForCommitPaint();
        incoming = draft.questions.map((q, i) => {
          const number = before + i + 1;
          return cleanImportedQuestion({ ...q, id: makeId('q', number), number });
        });

        target.questions = [...previousQuestions, ...incoming];
        target.updatedAt = now();
        setPracticeBankScope(target.id, true);
        await saveSilent();
      } catch (error) {
        target.questions = previousQuestions;
        target.updatedAt = previousUpdatedAt;
        restorePracticeSelection();
        warnDev('追加题库保存失败，已恢复追加前状态', error);
        showNotice('追加失败', saveFailureText(error, '追加'), 'danger');
        toast('追加失败，原题库未被修改。', 'warn', '追加失败');
        return;
      } finally {
        restoreButtons();
      }

      renderAll();
      await onImported();
      const total = target.questions.length;
      const advice = warnings.length ? `追加前有 ${warnings.length} 条提示，建议在题库管理中抽查。` : '';
      const message = `已追加到“${bankPathLabel(target)}”：新增 ${incoming.length} 道题，当前共 ${total} 道题。${advice}`;
      showNotice('追加成功', message, 'ok');
      toast(`已追加 ${incoming.length} 题到：${target.name}`, 'ok', '追加成功');
    }

    // 新建和追加都等写入成功后才刷新页面并清理与本次入库对应的草稿。
    async function createBank(warnings) {
      const name = $('#import-bank-name').value.trim() || '导入题库';
      const groupName = readBankGroup();
      const previousBanks = state.banks;
      const restorePracticeSelection = checkpointPracticeSelection();
      let bank;
      const restoreButtons = markConfirmButtonsBusy('正在保存…');
      try {
        showNotice('正在导入', `正在保存“${name}”的 ${draft.questions.length} 道题，请勿重复点击或关闭页面。`, 'warn');
        await waitForCommitPaint();
        bank = {
          id: makeId('bank'),
          name,
          groupName,
          createdAt: now(),
          updatedAt: now(),
          questions: draft.questions.map((q, i) => cleanImportedQuestion({
            ...q, id: makeId('q', i), number: i + 1,
          })),
        };

        state.banks = [...previousBanks, bank];
        setPracticeBankScope(bank.id, true);
        await saveSilent();
      } catch (error) {
        state.banks = previousBanks;
        restorePracticeSelection();
        warnDev('新建题库保存失败，已恢复导入前状态', error);
        showNotice('导入未保存', saveFailureText(error, '导入'), 'danger');
        toast('导入保存失败，识别预览仍保留。', 'warn', '导入未保存');
        return;
      } finally {
        restoreButtons();
      }

      renderAll();
      await onImported();
      const advice = warnings.length ? `导入前有 ${warnings.length} 条提示，建议在题库管理中抽查。` : '';
      showNotice('导入成功', `已创建题库“${name}”，共 ${bank.questions.length} 道题。${advice}`, 'ok');
      toast(`已导入题库：${name}，共 ${bank.questions.length} 题。`, 'ok', '导入成功');
    }

    // 追加的预读和保存使用同一次确认的目标，选择变化时由用户重新确认。
    async function commitDraft() {
      const saveMode = readSaveMode();
      const isAppend = saveMode === 'append';
      const targetId = isAppend ? readTargetId() : '';
      if (isAppend) {
        if (!targetId) {
          showNotice('追加失败', '原目标题库不存在，请重新选择要追加的题库。', 'danger');
          return undefined;
        }

        if (!await loadNativeBanks([targetId])) {
          return undefined;
        }
      }

      return runMutation(/* 同一事务涵盖选中范围、题库写入及提交后的界面更新。 */ () => {
        const targetChanged = isAppend && readTargetId() !== targetId;
        if (targetChanged || readSaveMode() !== saveMode || editor.current()) {
          showNotice('请重新确认导入', '保存方式或目标题库已变化，请核对当前选择后重新确认导入。', 'warn');
          return false;
        }

        if (!draft.questions.length) {
          showNotice('导入失败', '当前没有可导入的题目。', 'danger');
          return undefined;
        }

        const warnings = collectImportWarnings(draft.questions);
        if (isAppend) {
          const target = state.banks.find((bank) => bank.id === targetId);
          if (!target) {
            showNotice('追加失败', '没有找到要追加的目标题库，请先选择已有题库。', 'danger');
            return undefined;
          }

          return appendToBank(target, warnings);
        }

        return createBank(warnings);
      });
    }

    // 二次编辑沿用专属保存入口，普通导入共享预读和写入的占用状态。
    async function confirm() {
      if (confirmationPending) {
        return false;
      }

      if (editor.current()) {
        return editor.save();
      }

      confirmationPending = true;
      try {
        return await commitDraft();
      } finally {
        confirmationPending = false;
      }
    }

    return { confirm };
  }

  globalThis.ShirohaImportCommit = Object.freeze({ create });
})();
