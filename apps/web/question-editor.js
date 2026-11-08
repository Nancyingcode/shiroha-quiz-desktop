(() => {
  'use strict';
  function create({ state, draft: importDraft, session: practiceSession, select: $, selectAll: $$,
    escape: esc, label, short, toast, now, parser, suggestions, editor, practice, view, storage }) {
    const { countTypes, issueStatus: importIssueStatus, parseOptions: parseOptionsText,
      trimText: trimMultilineBoundaryV5910, isTextType, splitText: splitTextAnswer, splitAnswer,
      isMultiBlank: isMultiBlankQuestionV58914, cloneBlanks: cloneBlankAnswersV58914,
      primaryBlank: primaryBlankAnswerV58914, explicitBlankCount: explicitBlankCountV58914,
      normalizeType: normalizeWebQuestionType, normalizeQuestion, cleanQuestion: cleanImportedQuestion,
      validate: validateQuestion } = parser;
    const { renderRow: renderAiSuggestionRowV991, remove: removeAiSuggestionsForQuestionV991,
      bind: bindAiSuggestionActionsV991, sync: syncAiPreviewToolsV991 } = suggestions;
    const { updateBankUi: updateBankEditUiV45, syncAppend: syncImportAppendUiV59 } = editor;
    const { currentItem: currentPracticeItemV8916, question: practiceQuestionV8916, bankId: practiceItemBankIdV8916,
      key: practiceItemKeyV8916, renderScope: renderPracticeScopeUiV8916, render: renderPracticeQuestion } = practice;
    const { stats: renderStats, banks: renderBankList, bankPreview: renderBankPreview, wrong: renderWrongBook,
      favorites: renderFavoritesPageV596, records: renderRecords } = view;
    const { transaction: runMutation, save: saveSilent } = storage;
    // 编辑弹窗与多空输入只属于当前页面；打开新题或关闭弹窗时丢弃旧编辑会话。
    let practiceEditSessionV120 = null; let editBlankGroupsV58914 = []; let editMultiBlankEnabledV58914 = false;
    function renderImportReportPanel(arr) {
      const el = $('#import-report-panel');
      if (!el) {
        return;
      }
      if (!arr || !arr.length) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      const d = importDraft.diagnostics || {};
      const stats = countTypes(arr);
      const expected = d.expected || {};
      const expTotal = Number(expected.total || 0);
      const diff = expTotal ? arr.length - expTotal : 0;
      const diffClass = !expTotal ? '' : ' ' + (Math.abs(diff) <= Math.max(2, Math.ceil(expTotal * 0.05)) ? 'ok' : 'warn');
      const statusList = (arr || []).map((q) => importIssueStatus(q, d.profile || {}));
      const hardCount = statusList.filter((x) => importStatusSeverity(x) === 'error').length;
      const riskCount = statusList.filter((x) => importStatusSeverity(x) === 'warn').length;
      const repairedSegments = (d.candidates || []).flatMap((c) => c.segments || []);
      const candidates = (d.candidates || []).map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.questions)}</td><td>${esc(c.score)}</td><td>${esc((c.warnings || []).length)}</td><td>${esc((c.segments || []).length)}</td></tr>`).join('');
      const profile = d.profile || {};
      const profileBits = [];
      if (profile.hasVolumeHeading) {
        profileBits.push('分卷');
      }
      if (profile.hasTypeSections) {
        profileBits.push('题型分区');
      }
      if (profile.repeatedQuestionNumbers) {
        profileBits.push('重复题号');
      }
      if (profile.inlineOptionLikely) {
        profileBits.push('同一行选项');
      }
      if (profile.inlineAnswerLikely) {
        profileBits.push('题尾答案');
      }
      if (profile.sharedStemAppliedGroups) {
        profileBits.push(`共用材料${profile.sharedStemAppliedGroups}组/${profile.sharedStemAppliedChildren || 0}题`);
      }
      const typeExpected = expected.types || {};
      const expLine = Object.entries({ single: '单选', multiple: '多选', judge: '判断', blank: '填空', short: '简答' }).map(([k, n]) => (typeExpected[k] ? `${n}${typeExpected[k]}题` : null)).filter(Boolean).join('、');
      el.classList.remove('hidden');
      el.innerHTML = `<div class="report-grid">
    <div><span>采用策略</span><b>${esc(d.strategy || '未记录')}</b><small>模式：${esc(d.mode || '自动推荐')}</small></div>
    <div><span>识别题量</span><b>${arr.length}</b><small>单选${stats.single || 0}｜多选${(stats.multiple || 0) + (stats.multi || 0)}｜判断${stats.judge || 0}｜填空${stats.blank || 0}｜简答${stats.short || 0}</small></div>
    <div class="${diffClass}"><span>题量核对</span><b>${expTotal ? `${arr.length}/${expTotal}` : '未发现标题题量'}</b><small>${expTotal ? `差值 ${diff > 0 ? '+' : ''}${diff}` : '可在预览区人工核对'}</small></div>
    <div><span>错误/异常</span><b>${hardCount}/${riskCount}</b><small>错误 ${hardCount}｜需确认 ${riskCount}</small></div>
  </div>
  <div class="report-detail"><b>格式画像：</b>${profileBits.length ? profileBits.join('、') : '标准或低风险格式'}${expLine ? `；<b>标题分布：</b>${esc(expLine)}` : ''}${repairedSegments.length ? `；<b>已局部修复：</b>${esc(repairedSegments.slice(0, 3).join('；'))}${repairedSegments.length > 3 ? '……' : ''}` : ''}</div>
  ${candidates ? `<details class="candidate-details"><summary>查看候选策略质量对比</summary><table><thead><tr><th>策略</th><th>题数</th><th>质量分</th><th>异常数</th><th>局部修复</th></tr></thead><tbody>${candidates}</tbody></table></details>` : ''}`;
    }
    function importStatusSeverity(status) {
      if (status === '正常') {
        return 'ok';
      }
      if (/^异常[:：]/.test(String(status || ''))) {
        return 'warn';
      }
      return 'error';
    }
    function renderImportPreview(arr) {
      importDraft.selected = new Set([...importDraft.selected].filter((i) => i >= 0 && i < (arr || []).length));
      const warnings = [...importDraft.warnings];
      const rows = (arr || []).map((q, i) => {
        const status = importIssueStatus(q, importDraft.diagnostics?.profile || {});
        if (status !== '正常') {
          warnings.push(`第${i + 1}题：${status}`);
        }
        return { q, i, status };
      });
      let shown = [...rows];
      if (importDraft.filter === 'problem') {
        shown = shown.filter((r) => r.status !== '正常');
      } else if (importDraft.filter === 'normal') {
        shown = shown.filter((r) => r.status === '正常');
      } else if (importDraft.filter === 'priority') {
        shown.sort((a, b) => {
          const aw = a.status === '正常' ? 1 : 0; const bw = b.status === '正常' ? 1 : 0;
          return aw - bw || a.i - b.i;
        });
      }
      const shownIdx = shown.map((r) => r.i);
      $('#import-preview tbody').innerHTML = shown.map(({ q, i, status }) => {
        const severity = importStatusSeverity(status);
        const styles = { ok: ['status-ok', ''], error: ['status-error', 'error-row'], warn: ['status-warn', 'issue-row'] };
        const [cls, rowCls] = styles[severity];
        const seqInfo = [q.volume, q.group, q.number ? `原${q.number}` : ''].filter(Boolean).join(' · ');
        const checked = importDraft.selected.has(i) ? 'checked' : '';
        return `<tr class="${rowCls}"><td class="select-cell"><input type="checkbox" class="import-row-check" data-select-import="${i}" ${checked}></td><td class="seq-cell"><b>${i + 1}</b>${seqInfo ? `<small>${esc(seqInfo)}</small>` : ''}</td><td>${label(q.type)}</td><td>${esc(short(q.question, 72))}</td><td>${q.options.length}</td><td>${esc(q.answer.join(''))}</td><td class="${cls}">${esc(status)}</td><td><div class="row-actions"><button class="ghost mini-btn" data-edit-import="${i}">编辑</button><button class="ghost danger mini-btn" data-delete-import="${i}">删除</button></div></td></tr>${renderAiSuggestionRowV991(q, i)}`;
      }).join('');
      const filterLabel = { priority: '异常优先', problem: '仅异常', normal: '仅正常', all: '全部' }[importDraft.filter] || '异常优先';
      const report = importDraft.report ? `<div class="import-report">${esc(importDraft.report)}</div>` : '';
      renderImportReportPanel(arr);
      $('#import-summary').innerHTML = arr.length ? `${report}<b>识别到 ${arr.length} 道题，当前显示 ${shown.length} 道（${filterLabel}），已选择 ${importDraft.selected.size} 道。</b>${warnings.length ? '<br>警告 ' + warnings.length + ' 条：<br>' + warnings.slice(0, 12).map(esc).join('<br>') + (warnings.length > 12 ? '<br>……' : '') : '<br>未发现明显异常。'}` : '尚未识别到题目。';
      $('#import-summary').className = 'notice ' + (warnings.length ? 'warn' : 'ok');
      const pf = $('#import-preview-filter');
      if (pf && pf.value !== importDraft.filter) {
        pf.value = importDraft.filter;
      }
      $('#confirm-import-btn').disabled = !arr.length;
      const dualConfirm = $('#dual-confirm-import-btn');
      if (dualConfirm) {
        dualConfirm.disabled = !arr.length;
      }
      updateBankEditUiV45(arr.length);
      syncImportAppendUiV59();
      const batchBtn = $('#batch-delete-import-btn');
      if (batchBtn) {
        batchBtn.disabled = importDraft.selected.size === 0;
      }
      const clearBtn = $('#clear-import-selection-btn');
      if (clearBtn) {
        clearBtn.disabled = importDraft.selected.size === 0;
      }
      const all = $('#import-select-all-visible');
      if (all) {
        const selectedVisible = shownIdx.filter((i) => importDraft.selected.has(i)).length;
        all.checked = shownIdx.length > 0 && selectedVisible === shownIdx.length;
        all.indeterminate = selectedVisible > 0 && selectedVisible < shownIdx.length;
        all.onchange = () => {
          if (all.checked) {
            shownIdx.forEach((i) => importDraft.selected.add(i));
          } else {
            shownIdx.forEach((i) => importDraft.selected.delete(i));
          }
          renderImportPreview(importDraft.questions);
        };
      }
      $$('[data-select-import]').forEach((cb) => cb.onchange = () => {
        const i = Number(cb.dataset.selectImport);
        if (cb.checked) {
          importDraft.selected.add(i);
        } else {
          importDraft.selected.delete(i);
        }
        renderImportPreview(importDraft.questions);
      });
      $$('[data-edit-import]').forEach((btn) => btn.onclick = () => openEditQuestion(Number(btn.dataset.editImport)));
      $$('[data-delete-import]').forEach((btn) => btn.onclick = async () => {
        const i = Number(btn.dataset.deleteImport);
        if (await globalThis.ShirohaDialogs.confirm('删除这道识别结果？')) {
          removeAiSuggestionsForQuestionV991(importDraft.questions[i], i);
          importDraft.questions.splice(i, 1);
          importDraft.selected = new Set([...importDraft.selected].map((x) => (x > i ? x - 1 : x)).filter((x) => x !== i));
          renderImportPreview(importDraft.questions);
        }
      });
      bindAiSuggestionActionsV991();
      syncAiPreviewToolsV991();
    }
    async function batchDeleteImportSelected() {
      const ids = [...importDraft.selected].filter((i) => i >= 0 && i < importDraft.questions.length).sort((a, b) => b - a);
      if (!ids.length) {
        toast('请先勾选要删除的题目。', 'warn');
        return;
      }
      if (!await globalThis.ShirohaDialogs.confirm(`确定批量删除选中的 ${ids.length} 道识别结果？`)) {
        return;
      }
      ids.forEach((i) => {
        removeAiSuggestionsForQuestionV991(importDraft.questions[i], i);
        importDraft.questions.splice(i, 1);
      });
      importDraft.selected.clear();
      renderImportPreview(importDraft.questions);
      toast(`已批量删除 ${ids.length} 道题。`, 'ok');
    }
    function collectEditBlankGroupsV58914() {
      const rows = $$('#edit-blank-groups-v58914 [data-blank-group-v58914]');
      if (!rows.length) {
        return cloneBlankAnswersV58914(editBlankGroupsV58914);
      }
      return rows.map((row) => {
        const values = [...row.querySelectorAll('[data-blank-answer-v58914]')].sort((a, b) => Number(a.dataset.blankAnswerV58914) - Number(b.dataset.blankAnswerV58914)).map((input) => String(input.value || '').trim());
        const main = values[0] || '';
        const seen = new Set(main ? [main] : []);
        const alternatives = values.slice(1).filter((value) => value && !seen.has(value) && seen.add(value));
        return [main, ...alternatives];
      });
    }
    function updateEditBlankCountTipV58914() {
      const tip = $('#edit-blank-count-tip-v58914');
      if (!tip) {
        return;
      }
      const detected = explicitBlankCountV58914($('#edit-question')?.value || '');
      const configured = editMultiBlankEnabledV58914 ? editBlankGroupsV58914.length : 0;
      let message = '未检测到明确空括号或连续下划线，仅按当前配置保存。';
      if (detected) {
        message = detected === configured
          ? `题干检测到 ${detected} 个明确题空。`
          : `题干检测到 ${detected} 个明确题空，当前配置 ${configured} 个。`;
      }
      tip.textContent = message;
      tip.className = 'muted ' + (detected && detected !== configured ? 'multi-blank-count-warn-v58914' : '');
    }
    function renderEditBlankGroupsV58914() {
      const box = $('#edit-blank-groups-v58914');
      if (!box) {
        return;
      }
      if (!editBlankGroupsV58914.length) {
        editBlankGroupsV58914 = [['']];
      }
      box.innerHTML = editBlankGroupsV58914.map((group, index) => {
        const values = [group[0] || '', group[1] || '', group[2] || ''];
        return `<div class="multi-blank-edit-group-v58914" data-blank-group-v58914="${index}"><div class="multi-blank-edit-head-v58914"><b>第${index + 1}空</b><div class="row-actions"><button class="ghost mini-btn" type="button" data-blank-move-v58914="up" ${index === 0 ? 'disabled' : ''}>上移</button><button class="ghost mini-btn" type="button" data-blank-move-v58914="down" ${index === editBlankGroupsV58914.length - 1 ? 'disabled' : ''}>下移</button><button class="ghost danger mini-btn" type="button" data-blank-delete-v58914 ${editBlankGroupsV58914.length === 1 ? 'disabled' : ''}>删除</button></div></div><div class="multi-blank-edit-fields-v58914"><label>主答案<input data-blank-answer-v58914="0" value="${esc(values[0])}" placeholder="必填" /></label><label>备选答案1<input data-blank-answer-v58914="1" value="${esc(values[1])}" placeholder="可空" /></label><label>备选答案2<input data-blank-answer-v58914="2" value="${esc(values[2])}" placeholder="可空" /></label></div></div>`;
      }).join('');
      $$('#edit-blank-groups-v58914 [data-blank-answer-v58914]').forEach((input) => input.oninput = () => {
        editBlankGroupsV58914 = collectEditBlankGroupsV58914();
        updateEditBlankCountTipV58914();
      });
      $$('#edit-blank-groups-v58914 [data-blank-move-v58914]').forEach((button) => button.onclick = () => {
        editBlankGroupsV58914 = collectEditBlankGroupsV58914();
        const row = button.closest('[data-blank-group-v58914]');
        const index = Number(row?.dataset.blankGroupV58914);
        const target = button.dataset.blankMoveV58914 === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= editBlankGroupsV58914.length) {
          return;
        }
        [editBlankGroupsV58914[index], editBlankGroupsV58914[target]] = [editBlankGroupsV58914[target], editBlankGroupsV58914[index]];
        renderEditBlankGroupsV58914();
      });
      $$('#edit-blank-groups-v58914 [data-blank-delete-v58914]').forEach((button) => button.onclick = () => {
        editBlankGroupsV58914 = collectEditBlankGroupsV58914();
        const index = Number(button.closest('[data-blank-group-v58914]')?.dataset.blankGroupV58914);
        if (editBlankGroupsV58914.length <= 1) {
          return;
        }
        editBlankGroupsV58914.splice(index, 1);
        renderEditBlankGroupsV58914();
      });
      updateEditBlankCountTipV58914();
    }
    function syncEditBlankUiV58914() {
      const type = $('#edit-type')?.value || '';
      const blankType = type === 'blank';
      const singleWrap = $('#edit-answer-single-wrap-v58914');
      const multiWrap = $('#edit-multi-blank-wrap-v58914');
      const enable = $('#edit-enable-multi-blank-btn-v58914');
      if (singleWrap) {
        singleWrap.classList.toggle('hidden', blankType && editMultiBlankEnabledV58914);
      }
      if (multiWrap) {
        multiWrap.classList.toggle('hidden', !(blankType && editMultiBlankEnabledV58914));
      }
      if (enable) {
        enable.classList.toggle('hidden', !blankType || editMultiBlankEnabledV58914);
      }
      if (blankType && editMultiBlankEnabledV58914) {
        renderEditBlankGroupsV58914();
      }
    }
    function ensureEditAnswerFieldV5910(type) {
      let field = $('#edit-answer');
      if (!field) {
        return null;
      }
      const original = field.dataset.v5910OriginalTag || field.tagName.toLowerCase();
      const shortType = normalizeWebQuestionType(type) === 'short';
      const desired = shortType ? 'textarea' : original;
      if (field.tagName.toLowerCase() !== desired) {
        const next = document.createElement(desired);
        [...field.attributes].forEach((attr) => {
          if (attr.name !== 'type') {
            next.setAttribute(attr.name, attr.value);
          }
        });
        if (desired === 'input') {
          next.type = 'text';
        }
        next.value = field.value;
        next.dataset.v5910OriginalTag = original;
        field.replaceWith(next);
        field = next;
      } else {
        field.dataset.v5910OriginalTag = original;
      }
      field.classList.toggle('edit-answer-multiline-v5910', shortType);
      if (shortType) {
        field.setAttribute('rows', '8');
      } else {
        field.removeAttribute('rows');
      }
      return field;
    }
    function bindMultiBlankEditorV58914() {
      const type = $('#edit-type');
      if (type) {
        type.onchange = () => {
          if (type.value !== 'blank') {
            editMultiBlankEnabledV58914 = false;
          }
          ensureEditAnswerFieldV5910(type.value);
          syncEditBlankUiV58914();
        };
      }
      const question = $('#edit-question');
      if (question && !question.dataset.blankTipBound) {
        question.dataset.blankTipBound = '1';
        question.addEventListener('input', updateEditBlankCountTipV58914);
      }
      const add = $('#edit-add-blank-btn-v58914');
      if (add) {
        add.onclick = () => {
          editBlankGroupsV58914 = collectEditBlankGroupsV58914();
          editBlankGroupsV58914.push(['']);
          renderEditBlankGroupsV58914();
        };
      }
      const enable = $('#edit-enable-multi-blank-btn-v58914');
      if (enable) {
        enable.onclick = () => {
          const count = Math.max(1, explicitBlankCountV58914($('#edit-question')?.value || ''));
          const old = String($('#edit-answer')?.value || '').trim();
          editBlankGroupsV58914 = Array.from({ length: count }, (_, i) => (i === 0 && count === 1 && old ? [old] : ['']));
          editMultiBlankEnabledV58914 = true;
          syncEditBlankUiV58914();
          $('#edit-status').textContent = '已启用逐空答案，请为每个题空填写主答案。';
          $('#edit-status').className = 'notice warn';
        };
      }
      const disable = $('#edit-disable-multi-blank-btn-v58914');
      if (disable) {
        disable.onclick = async () => {
          editBlankGroupsV58914 = collectEditBlankGroupsV58914();
          if (!await globalThis.ShirohaDialogs.confirm('退出多空模式？各空主答案会用中文分号合并到普通答案框。')) {
            return;
          }
          $('#edit-answer').value = primaryBlankAnswerV58914(editBlankGroupsV58914);
          editMultiBlankEnabledV58914 = false;
          syncEditBlankUiV58914();
        };
      }
    }
    function setEditDeleteVisibleV120(visible) {
      const btn = $('#edit-delete-btn');
      if (!btn) {
        return;
      }
      btn.style.display = visible ? '' : 'none';
      btn.disabled = !visible;
    }
    function fillEditQuestionFormV120(q, index, statusText = '可修改后保存。') {
      $('#edit-index').value = index;
      $('#edit-type').value = q.type || 'single';
      $('#edit-question').value = q.question || '';
      ensureEditAnswerFieldV5910(q.type);
      $('#edit-answer').value = isTextType(q.type) ? (q.answer || []).join(' || ') : (q.answer || []).join('');
      $('#edit-analysis').value = q.analysis || '';
      $('#edit-category').value = q.category || q.group || '';
      $('#edit-score').value = q.score || '';
      editMultiBlankEnabledV58914 = isMultiBlankQuestionV58914(q);
      editBlankGroupsV58914 = editMultiBlankEnabledV58914 ? cloneBlankAnswersV58914(q.blankAnswers) : [];
      $('#edit-options').value = (q.options || []).map((o) => `${o.key}. ${o.text}`).join('\n');
      $('#edit-status').textContent = statusText;
      $('#edit-status').className = 'notice';
      syncEditBlankUiV58914();
    }
    function openEditQuestion(i) {
      const q = importDraft.questions[i];
      if (!q) {
        return;
      }
      practiceEditSessionV120 = null;
      setEditDeleteVisibleV120(true);
      fillEditQuestionFormV120(q, i, '可修改后保存。');
      $('#edit-modal').classList.remove('hidden');
      $('#edit-modal').setAttribute('aria-hidden', 'false');
    }
    function closeEditModal() {
      $('#edit-modal').classList.add('hidden');
      $('#edit-modal').setAttribute('aria-hidden', 'true');
      practiceEditSessionV120 = null;
      setEditDeleteVisibleV120(true);
    }
    function readEditQuestionRawV120(baseQuestion) {
      const type = $('#edit-type').value;
      const options = parseOptionsText($('#edit-options').value);
      const raw = { ...baseQuestion, type, question: trimMultilineBoundaryV5910($('#edit-question').value), options, answer: isTextType(type) ? splitTextAnswer($('#edit-answer').value) : splitAnswer($('#edit-answer').value), analysis: trimMultilineBoundaryV5910($('#edit-analysis').value), category: $('#edit-category').value.trim(), score: $('#edit-score').value };
      if (type === 'blank' && editMultiBlankEnabledV58914) {
        const groups = collectEditBlankGroupsV58914();
        const missing = groups.findIndex((group) => !String(group[0] || '').trim());
        if (missing >= 0) {
          return { error: `第${missing + 1}空缺少主答案，暂未保存。` };
        }
        raw.blankAnswers = groups;
        raw.answer = [primaryBlankAnswerV58914(groups)];
        editBlankGroupsV58914 = cloneBlankAnswersV58914(groups);
      } else {
        delete raw.blankAnswers;
      }
      return { raw };
    }
    function saveEditQuestion() {
      if (practiceEditSessionV120) {
        savePracticeEditQuestionV120();
        return;
      }
      const i = Number($('#edit-index').value);
      if (!importDraft.questions[i]) {
        return;
      }
      const read = readEditQuestionRawV120(importDraft.questions[i]);
      if (read.error) {
        $('#edit-status').textContent = read.error;
        $('#edit-status').className = 'notice warn';
        return;
      }
      const oldQuestion = importDraft.questions[i];
      const q = normalizeQuestion(read.raw, i);
      removeAiSuggestionsForQuestionV991(oldQuestion, i);
      importDraft.questions[i] = q;
      const status = validateQuestion(q);
      $('#edit-status').textContent = '已保存。当前状态：' + status;
      $('#edit-status').className = 'notice ' + (status === '正常' ? 'ok' : 'warn');
      renderImportPreview(importDraft.questions);
    }
    async function deleteEditQuestion() {
      if (practiceEditSessionV120) {
        toast('刷题中编辑不支持删除本题。', 'warn');
        return;
      }
      const i = Number($('#edit-index').value);
      if (!importDraft.questions[i]) {
        return;
      }
      if (await globalThis.ShirohaDialogs.confirm('删除这道题？')) {
        removeAiSuggestionsForQuestionV991(importDraft.questions[i], i);
        importDraft.questions.splice(i, 1);
        importDraft.selected = new Set([...importDraft.selected].map((x) => (x > i ? x - 1 : x)).filter((x) => x !== i));
        closeEditModal();
        renderImportPreview(importDraft.questions);
      }
    }
    function findPracticeQuestionLocationV120(item) {
      const q = practiceQuestionV8916(item);
      const bankId = practiceItemBankIdV8916(item);
      const bank = (state.banks || []).find((b) => b.id === bankId);
      if (!q || !bank) {
        return { q, bankId, bank: null, index: -1 };
      }
      let index = (bank.questions || []).findIndex((x) => x === q);
      if (index < 0 && q.id) {
        index = (bank.questions || []).findIndex((x) => x && x.id === q.id);
      }
      return { q, bankId, bank, index };
    }
    function openPracticeEditQuestionV120() {
      if (practiceSession.current.submitMode === 'total' && !practiceSession.current.completed) {
        return;
      }
      const item = currentPracticeItemV8916();
      const loc = findPracticeQuestionLocationV120(item);
      if (!loc.bank) {
        toast('没有找到这道题的来源题库，无法编辑。', 'danger');
        return;
      }
      if (loc.index < 0) {
        toast('没有在来源题库中找到这道题，无法编辑。', 'danger');
        return;
      }
      practiceEditSessionV120 = { bankId: loc.bankId, questionId: loc.q.id, questionIndex: loc.index, sessionKey: practiceItemKeyV8916(item), startedAt: now(), item };
      setEditDeleteVisibleV120(false);
      fillEditQuestionFormV120(loc.bank.questions[loc.index], loc.index, '刷题中编辑：保存后会写回来源题库，并立即刷新当前题。');
      $('#edit-modal').classList.remove('hidden');
      $('#edit-modal').setAttribute('aria-hidden', 'false');
    }
    async function savePracticeEditQuestionV120() {
      return runMutation(async () => {
        const session = practiceEditSessionV120;
        if (!session) {
          return;
        }
        const bank = (state.banks || []).find((b) => b.id === session.bankId);
        if (!bank) {
          $('#edit-status').textContent = '来源题库不存在，无法保存。';
          $('#edit-status').className = 'notice warn';
          return;
        }
        let index = session.questionIndex;
        let oldQuestion = bank.questions && bank.questions[index];
        if (!oldQuestion || oldQuestion.id !== session.questionId) {
          index = (bank.questions || []).findIndex((q) => q && q.id === session.questionId);
          oldQuestion = index >= 0 ? bank.questions[index] : null;
        }
        if (!oldQuestion) {
          $('#edit-status').textContent = '来源题目不存在，无法保存。';
          $('#edit-status').className = 'notice warn';
          return;
        }
        const read = readEditQuestionRawV120(oldQuestion);
        if (read.error) {
          $('#edit-status').textContent = read.error;
          $('#edit-status').className = 'notice warn';
          return;
        }
        const next = cleanImportedQuestion(normalizeQuestion(read.raw, index));
        bank.questions[index] = next;
        bank.updatedAt = now();
        (practiceSession.current.items || []).forEach((item) => {
          if (item && item.bankId === bank.id && (item.question === oldQuestion || practiceItemKeyV8916(item) === session.sessionKey)) {
            item.question = next;
          }
        });
        await saveSilent();
        const status = validateQuestion(next);
        $('#edit-status').textContent = '已保存到来源题库。当前状态：' + status;
        $('#edit-status').className = 'notice ' + (status === '正常' ? 'ok' : 'warn');
        toast('已保存题目修改。', 'ok');
        renderStats();
        renderBankList();
        renderBankPreview();
        renderWrongBook();
        renderFavoritesPageV596();
        renderRecords();
        renderPracticeScopeUiV8916();
        renderPracticeQuestion();
      });
    }
    return { renderImportPreview, batchDeleteImportSelected, bindMultiBlankEditorV58914, openEditQuestion, closeEditModal, saveEditQuestion, deleteEditQuestion, findPracticeQuestionLocationV120, openPracticeEditQuestionV120 };
  }
  globalThis.ShirohaQuestionEditor = { create };
})();
