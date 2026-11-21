// 单文件和双文件共用确认保存，借用应用的存储事务和题库编辑会话。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;

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
        const text = button.textContent || i18n.text('import.confirm');
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
      const suffix = i18n.text('import.previewPreserved');
      const unchanged = i18n.text('import.notWritten', { action });
      if (isStringTooLargeError(error)) {
        const cause = i18n.text('import.saveSize');
        return `${cause}${unchanged}${suffix}`;
      }

      if (isStorageQuotaError(error)) {
        const advice = i18n.text('import.quotaAdvice');
        return i18n.text('import.storageFull', { unchanged, advice, suffix });
      }

      const detail = String(error?.message || '').trim();
      return i18n.text('import.browserSaveFailed', { action, detail: detail ? i18n.text('import.errorDetail', { detail }) : i18n.text('import.failureTryAgain'), suffix });
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
      const restoreButtons = markConfirmButtonsBusy(i18n.text('import.busyAppending'));
      try {
        const label = bankPathLabel(target);
        showNotice(i18n.text('import.busyAppend'), i18n.text('import.appendProgress', { count: draft.questions.length, bank: label }), 'warn');
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
        showNotice(i18n.text('import.appendFailed'), saveFailureText(error, i18n.text('import.actionAppend')), 'danger');
        toast(i18n.text('import.appendPreserved'), 'warn', i18n.text('import.appendFailed'));
        return;
      } finally {
        restoreButtons();
      }

      renderAll();
      await onImported();
      const total = target.questions.length;
      const advice = warnings.length ? i18n.text('import.appendWarning', { count: warnings.length }) : '';
      const message = i18n.text('import.appendBankProgress', { name: bankPathLabel(target), added: incoming.length, total, advice });
      showNotice(i18n.text('import.appendOk'), message, 'ok');
      toast(i18n.text('import.appendToast', { count: incoming.length, name: target.name }), 'ok', i18n.text('import.appendOk'));
    }

    // 新建和追加都等写入成功后才刷新页面并清理与本次入库对应的草稿。
    async function createBank(warnings) {
      const name = $('#import-bank-name').value.trim() || '导入题库';
      const groupName = readBankGroup();
      const previousBanks = state.banks;
      const restorePracticeSelection = checkpointPracticeSelection();
      let bank;
      const restoreButtons = markConfirmButtonsBusy(i18n.text('import.busySaving'));
      try {
        showNotice(i18n.text('import.busyImport'), i18n.text('import.createProgress', { name, count: draft.questions.length }), 'warn');
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
        showNotice(i18n.text('import.notSaved'), saveFailureText(error, i18n.text('import.actionNew')), 'danger');
        toast(i18n.text('import.saveFailed'), 'warn', i18n.text('import.notSaved'));
        return;
      } finally {
        restoreButtons();
      }

      renderAll();
      await onImported();
      const advice = warnings.length ? i18n.text('import.createWarning', { count: warnings.length }) : '';
      showNotice(i18n.text('import.saved'), i18n.text('import.createdBank', { name, count: bank.questions.length, advice }), 'ok');
      toast(i18n.text('import.createdToast', { name, count: bank.questions.length }), 'ok', i18n.text('import.saved'));
    }

    // 追加的预读和保存使用同一次确认的目标，选择变化时由用户重新确认。
    async function commitDraft() {
      const saveMode = readSaveMode();
      const isAppend = saveMode === 'append';
      const targetId = isAppend ? readTargetId() : '';
      if (isAppend) {
        if (!targetId) {
          showNotice(i18n.text('import.appendFailed'), i18n.text('import.selectTarget'), 'danger');
          return undefined;
        }

        if (!await loadNativeBanks([targetId])) {
          return undefined;
        }
      }

      return runMutation(/* 同一事务涵盖选中范围、题库写入及提交后的界面更新。 */ () => {
        const targetChanged = isAppend && readTargetId() !== targetId;
        if (targetChanged || readSaveMode() !== saveMode || editor.current()) {
          showNotice(i18n.text('import.chooseAgain'), i18n.text('import.changedTarget'), 'warn');
          return false;
        }

        if (!draft.questions.length) {
          showNotice(i18n.text('import.failed'), i18n.text('import.emptyCommit'), 'danger');
          return undefined;
        }

        const warnings = collectImportWarnings(draft.questions);
        if (isAppend) {
          const target = state.banks.find((bank) => bank.id === targetId);
          if (!target) {
            showNotice(i18n.text('import.appendFailed'), i18n.text('import.targetNotFound'), 'danger');
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
