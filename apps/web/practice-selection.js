(() => {
  'use strict';
  function create({ state, session: practiceSession, select: $, now, scope, questions, progress }) {
    const { banks: practiceScopeBanksV8916, current: practiceScopeV8916,
      normalize: normalizePracticeScopeV8916, fromStart: PRACTICE_START_FROM_V58916,
      continueMode: PRACTICE_START_CONTINUE_V58916, custom: PRACTICE_START_CUSTOM_V58916 } = scope;
    const { itemsForBanks: practiceSessionItemsForBanksV8916, key: practiceItemKeyV8916,
      wrongEntries: getWrongEntries, favorites: getFavoriteIdsV27, shuffle, parseNumbers: parsePracticeNumberRangeV58916 } = questions;
    const { answer: getPracticeAnswerStateV26 } = progress;
    function readCustomCountV60(selector, fallback = 20) {
      const el = selector ? $(selector) : null;
      const raw = el ? Number(el.value) : NaN;
      const n = Number.isFinite(raw) ? Math.floor(raw) : Number(fallback || 20);
      return Math.max(1, n || 20);
    }
    function syncLimitControlV60(scope) {
      const prefix = scope === 'wrong' ? 'wrong-practice' : 'practice';
      const select = $(`#${prefix}-limit`);
      const input = $(`#${prefix}-custom-count`);
      const control = input && input.closest('.limit-control-v60');
      if (!select || !input) {
        return;
      }
      const custom = select.value === 'custom';
      if (control) {
        control.classList.toggle('is-custom', custom);
      }
      input.disabled = !custom;
      input.style.display = custom ? '' : 'none';
      if (custom && (!Number(input.value) || Number(input.value) < 1)) {
        input.value = '20';
      }
    }
    function bindLimitControlsV60() {
      [['practice', '#practice-limit', '#practice-custom-count'], ['wrong', '#wrong-practice-limit', '#wrong-practice-custom-count']].forEach(([scope, sel, inputSel]) => {
        const select = $(sel);
        const input = $(inputSel);
        if (select && !select.dataset.boundV60) {
          select.dataset.boundV60 = '1';
          select.addEventListener('change', () => syncLimitControlV60(scope));
        }
        if (input && !input.dataset.boundV60) {
          input.dataset.boundV60 = '1';
          input.addEventListener('input', () => {
            if (Number(input.value) < 1) {
              input.value = '1';
            }
          });
        }
        syncLimitControlV60(scope);
      });
    }
    function applyQuestionLimitV60(qs, limit, customCount) {
      const mode = String(limit || 'custom');
      if (mode === 'all') {
        return qs;
      }
      if (mode === 'half') {
        return qs.slice(0, Math.max(1, Math.ceil(qs.length / 2)));
      }
      const count = mode === 'custom' ? readCustomCountV60('', customCount || 20) : Math.max(1, Math.floor(Number(mode) || 20));
      return qs.slice(0, count);
    }
    function filteredPracticeItemsV8916(source, type, order, limit, customCount, scopeOverride) {
      let items = practiceBaseItemsV58916(source, type, scopeOverride);
      if (order === 'random') {
        items = shuffle(items);
      }
      return applyQuestionLimitV60(items, limit, customCount);
    }
    /* SHIROHA_WEB_V58_9_16_PRACTICE_PROGRESS_START
   顺序练习进度记忆与自选题号。进度只保存在 Web settings，不写入跨端业务层。 */
    function practiceProgressStoreV58916() {
      state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {};
      const current = state.settings.practiceProgressV58916;
      state.settings.practiceProgressV58916 = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      return state.settings.practiceProgressV58916;
    }
    function practiceProgressKeyV58916(scope, source, type) {
      const normalized = normalizePracticeScopeV8916(scope);
      return JSON.stringify([normalized.type, normalized.value, String(source || 'all'), String(type || 'all')]);
    }
    function practiceBaseItemsV58916(source, type, scopeOverride) {
      const banks = practiceScopeBanksV8916(scopeOverride);
      let items = practiceSessionItemsForBanksV8916(banks);
      if (source === 'wrong') {
        const byBank = new Map(banks.map((b) => [b.id, new Set(getWrongEntries(b.id).filter((e) => e.status !== '已掌握').map((e) => e.id))]));
        items = items.filter((item) => byBank.get(item.bankId)?.has(item.question.id));
      }
      if (source === 'favorite') {
        const byBank = new Map(banks.map((b) => [b.id, new Set(getFavoriteIdsV27(b.id))]));
        items = items.filter((item) => byBank.get(item.bankId)?.has(item.question.id));
      }
      if (type && type !== 'all') {
        const t = type === 'multi' ? 'multiple' : type;
        items = items.filter((item) => item.question.type === t);
      }
      return items;
    }
    function resolvePracticeProgressV58916(scope, source, type, baseItems) {
      const key = practiceProgressKeyV58916(scope, source, type);
      const saved = practiceProgressStoreV58916()[key];
      if (!saved || !baseItems.length) {
        return null;
      }
      const keys = baseItems.map(practiceItemKeyV8916);
      let index = keys.indexOf(String(saved.nextSessionKey || ''));
      if (index < 0) {
        const fallback = Math.floor(Number(saved.nextIndex));
        if (Number.isFinite(fallback) && fallback >= 0 && fallback < baseItems.length) {
          index = fallback;
        }
      }
      return index >= 0 && index < baseItems.length ? { key, index, item: baseItems[index], saved } : null;
    }
    function syncPracticeStartModeFieldsV58916() {
      const select = $('#practice-start-mode-v58916');
      const rangeInput = $('#practice-number-range-v58916');
      const limitControl = $('#practice-limit-control-v58916');
      const rangeLabel = $('#practice-range-label-v58916');
      if (!select || !rangeInput || !limitControl) {
        return;
      }
      const custom = select.value === PRACTICE_START_CUSTOM_V58916;
      rangeInput.hidden = !custom;
      rangeInput.disabled = !custom;
      limitControl.hidden = false;
      if (rangeLabel) {
        rangeLabel.hidden = !custom;
      }
    }
    function syncPracticeStartUiV58916(preferContinue = false) {
      const select = $('#practice-start-mode-v58916');
      if (!select) {
        return;
      }
      const order = $('#practice-order')?.value || 'sequence';
      let progress = null;
      if (order === 'sequence') {
        const source = $('#practice-source')?.value || 'all';
        const type = $('#practice-type')?.value || 'all';
        const scope = practiceScopeV8916();
        const baseItems = practiceBaseItemsV58916(source, type, scope);
        progress = resolvePracticeProgressV58916(scope, source, type, baseItems);
      }
      const fromOption = select.querySelector(`option[value="${PRACTICE_START_FROM_V58916}"]`);
      const continueOption = select.querySelector(`option[value="${PRACTICE_START_CONTINUE_V58916}"]`);
      if (fromOption) {
        fromOption.textContent = order === 'random' ? '全部范围' : '从头开始';
      }
      if (continueOption) {
        continueOption.hidden = order !== 'sequence';
        continueOption.disabled = !progress;
        continueOption.textContent = progress ? `继续上次 · 第${progress.index + 1}题` : '继续上次 · 暂无进度';
      }
      if (order !== 'sequence' && select.value === PRACTICE_START_CONTINUE_V58916) {
        select.value = PRACTICE_START_FROM_V58916;
      } else if (preferContinue && progress) {
        select.value = PRACTICE_START_CONTINUE_V58916;
      } else if (select.value === PRACTICE_START_CONTINUE_V58916 && !progress) {
        select.value = PRACTICE_START_FROM_V58916;
      }
      syncPracticeStartModeFieldsV58916();
    }
    function bindPracticeStartControlsV58916() {
      const select = $('#practice-start-mode-v58916');
      if (select && !select.dataset.boundV58916) {
        select.dataset.boundV58916 = '1';
        select.addEventListener('change', syncPracticeStartModeFieldsV58916);
      }
      ['#practice-type', '#practice-source', '#practice-order'].forEach((selector) => {
        const el = $(selector);
        if (el && !el.dataset.practiceStartBoundV58916) {
          el.dataset.practiceStartBoundV58916 = '1';
          el.addEventListener('change', () => syncPracticeStartUiV58916(true));
        }
      });
      syncPracticeStartUiV58916(true);
    }
    function buildPracticeSelectionV58916(scope, source, type, order, limit, customCount) {
      const baseItems = practiceBaseItemsV58916(source, type, scope);
      let startMode = $('#practice-start-mode-v58916')?.value || PRACTICE_START_FROM_V58916;
      if (order !== 'sequence' && startMode === PRACTICE_START_CONTINUE_V58916) {
        startMode = PRACTICE_START_FROM_V58916;
      }
      const progressKey = practiceProgressKeyV58916(scope, source, type);
      let startIndex = 0;
      let items;
      if (startMode === PRACTICE_START_CUSTOM_V58916) {
        const raw = String($('#practice-number-range-v58916')?.value || '').trim();
        const parsed = parsePracticeNumberRangeV58916(raw, baseItems.length);
        if (parsed.error) {
          return { error: parsed.error, items: [], baseItems, startMode, progressKey, startIndex };
        }
        const isStartingNumber = /^\d+$/.test(raw);
        if (isStartingNumber) {
          startIndex = parsed.indexes[0];
          items = baseItems.slice(startIndex);
        } else {
          items = parsed.indexes.map((index) => baseItems[index]).filter(Boolean);
        }
        if (order === 'random') {
          items = shuffle(items);
        }
        items = applyQuestionLimitV60(items, limit, customCount);
      } else if (order === 'sequence') {
        if (startMode === PRACTICE_START_CONTINUE_V58916) {
          const progress = resolvePracticeProgressV58916(scope, source, type, baseItems);
          if (progress) {
            startIndex = progress.index;
          } else {
            startMode = PRACTICE_START_FROM_V58916;
          }
        }
        items = applyQuestionLimitV60(baseItems.slice(startIndex), limit, customCount);
      } else {
        items = applyQuestionLimitV60(shuffle([...baseItems]), limit, customCount);
      }
      return { items, baseItems, startMode, progressKey, startIndex, error: '' };
    }
    function updatePracticeProgressV58916() {
      const round = practiceSession.current;
      const hasSequentialProgress = round.order === 'sequence'
        && [PRACTICE_START_FROM_V58916, PRACTICE_START_CONTINUE_V58916].includes(round.startMode)
        && round.progressKey && Array.isArray(round.baseItemKeys) && round.baseItemKeys.length
        && round.items?.length;
      if (!hasSequentialProgress) {
        return;
      }
      const itemKeys = round.items.map(practiceItemKeyV8916);
      let nextKey = '';
      for (const key of itemKeys) {
        const answer = getPracticeAnswerStateV26(key);
        if (!answer.answered && !answer.revealed) {
          nextKey = key;
          break;
        }
      }
      let nextIndex = nextKey ? round.baseItemKeys.indexOf(nextKey) : -1;
      if (nextIndex < 0) {
        const lastIndex = round.baseItemKeys.indexOf(itemKeys[itemKeys.length - 1]);
        nextIndex = lastIndex >= 0 ? lastIndex + 1 : round.startIndex + round.items.length;
      }
      const store = practiceProgressStoreV58916();
      if (nextIndex >= round.baseItemKeys.length) {
        delete store[round.progressKey];
      } else {
        store[round.progressKey] = {
          nextSessionKey: round.baseItemKeys[nextIndex],
          nextIndex,
          updatedAt: now(),
          scopeType: round.scopeType || 'BANK',
          scopeValue: round.scopeValue || '',
          source: round.source || 'all',
          type: round.type || 'all',
        };
      }
    }
    /* SHIROHA_WEB_V58_9_16_PRACTICE_PROGRESS_END */
    return {
      readCustomCountV60, syncLimitControlV60, bindLimitControlsV60, filteredPracticeItemsV8916,
      practiceBaseItemsV58916, syncPracticeStartModeFieldsV58916, syncPracticeStartUiV58916,
      bindPracticeStartControlsV58916, buildPracticeSelectionV58916, updatePracticeProgressV58916,
    };
  }
  globalThis.ShirohaPracticeSelection = { create };
})();
