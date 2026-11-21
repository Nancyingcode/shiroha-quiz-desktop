// 装配导入预览与题目编辑，保存前保护原草稿、题目来源和练习状态。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;
  const issueMessages = new Map([
    ['正常', 'diagnostic.valid'],
    ['缺少题干', 'diagnostic.missingQuestion'],
    ['选择题缺少选项', 'diagnostic.missingChoices'],
    ['判断题缺少正确/错误选项', 'diagnostic.missingJudgeChoices'],
    ['缺少答案', 'diagnostic.missingAnswer'],
    ['判断题答案无法映射到正确/错误', 'diagnostic.unknownJudgeAnswer'],
    ['判断题出现多个答案', 'diagnostic.multipleJudgeAnswers'],
    ['判断题选项含义疑似不明确', 'diagnostic.ambiguousJudgeChoices'],
    ['缺少参考答案', 'diagnostic.missingReference'],
    ['多空题存在缺少主答案的题空', 'diagnostic.missingBlankAnswer'],
    ['答案超出选项范围', 'diagnostic.answerOutOfRange'],
    ['单选题出现多个答案', 'diagnostic.multipleSingleAnswers'],
    ['多选题只有一个答案', 'diagnostic.onlyOneMultipleAnswer'],
    ['题干疑似混入A选项', 'diagnostic.mergedChoiceA'],
    ['题干残留答案标记', 'diagnostic.answerMarker'],
    ['选项疑似粘连', 'diagnostic.mergedChoices'],
    ['题干过长', 'diagnostic.longQuestion'],
    ['单选题选项数量偏少', 'diagnostic.fewSingleChoices'],
    ['多选题选项数量偏少', 'diagnostic.fewMultipleChoices'],
  ]);

  // 解析器仍使用原有状态判断风险等级。只对已知诊断的显示文案做翻译。
  function issueText(status) {
    const detail = status.replace(/* 兼容中英文冒号，拆分风险前缀后查找诊断正文。 */ /^异常[:：]/, '');
    const message = issueMessages.get(detail);
    if (!message) {
      return status;
    }

    const issue = i18n.text(message);
    return detail === status ? issue : i18n.text('diagnostic.warning', { issue });
  }

  // 使用应用注入的识别、预览和保存能力，把编辑状态限制在当前入口及草稿。
  function create({
    state,
    draft: importDraft,
    session: practiceSession,
    select: $,
    selectAll: $$,
    escape: esc,
    label,
    short,
    toast,
    now,
    parser,
    suggestions,
    editor,
    practice,
    view,
    storage,
  }) {
    const {
      countTypes,
      issueStatus: importIssueStatus,
      parseOptions: parseOptionsText,
      trimText: trimMultilineBoundaryV5910,
      isTextType,
      splitText: splitTextAnswer,
      splitAnswer,
      isMultiBlank: isMultiBlankQuestionV58914,
      cloneBlanks: cloneBlankAnswersV58914,
      primaryBlank: primaryBlankAnswerV58914,
      explicitBlankCount: explicitBlankCountV58914,
      normalizeType: normalizeWebQuestionType,
      normalizeQuestion,
      cleanQuestion: cleanImportedQuestion,
      validate: validateQuestion,
    } = parser;
    const {
      renderRow: renderAiSuggestionRowV991,
      remove: removeAiSuggestionsForQuestionV991,
      invalidateImport: invalidateAiImportRequestV99,
      bind: bindAiSuggestionActionsV991,
      sync: syncAiPreviewToolsV991,
    } = suggestions;
    const { updateBankUi: updateBankEditUiV45, syncAppend: syncImportAppendUiV59, saveDraft } = editor;
    const {
      currentItem: currentPracticeItemV8916,
      question: practiceQuestionV8916,
      bankId: practiceItemBankIdV8916,
      key: practiceItemKeyV8916,
      renderScope: renderPracticeScopeUiV8916,
      render: renderPracticeQuestion,
    } = practice;
    const {
      stats: renderStats,
      banks: renderBankList,
      bankPreview: renderBankPreview,
      wrong: renderWrongBook,
      favorites: renderFavoritesPageV596,
      records: renderRecords,
    } = view;
    const { transaction: runMutation, save: saveSilent } = storage;
    // 编辑弹窗与多空输入只属于当前页面；打开新题或关闭弹窗时丢弃旧编辑会话。
    let practiceEditSessionV120 = null; let editBlankGroupsV58914 = []; let editMultiBlankEnabledV58914 = false;
    // 将解析诊断汇总到导入报告，便于核对识别方式和异常题量。
    function renderImportReportPanel(arr, statusList) {
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
      const diffClass = !expTotal ? '' : ` ${Math.abs(diff) <= Math.max(2, Math.ceil(expTotal * 0.05)) ? 'ok' : 'warn'}`;
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
      const strategyLabels = new Map([
        ['标准逐行解析', 'import.lineStrategy'],
        ['分卷分区三层解析', 'import.volumeStrategy'],
        ['紧凑格式解析', 'import.compactStrategy'],
        ['自动推荐', 'import.autoStrategy'],
        ['表格题库解析', 'import.tableStrategy'],
        ['Excel/CSV 表格题库解析', 'import.tableStrategy'],
        ['JSON结构化导入', 'import.jsonStrategy'],
        ['双文件导入', 'import.dualFormat'],
      ]);
      const mode = strategyLabels.get(d.mode);
      const strategy = strategyLabels.get(d.strategy);
      const modeText = mode ? i18n.text(mode) : d.mode || i18n.text('import.autoStrategy');
      const strategyText = strategy ? i18n.text(strategy) : d.strategy || i18n.text('question.notRecorded');
      const typeCounts = i18n.text('import.typeCounts', {
        single: stats.single || 0,
        multiple: (stats.multiple || 0) + (stats.multi || 0),
        judge: stats.judge || 0,
        blank: stats.blank || 0,
        short: stats.short || 0,
      });
      const totalNote = expTotal
        ? i18n.html('import.totalDifference', { diff: diff > 0 ? `+${diff}` : diff })
        : i18n.html('import.reviewCount');
      el.innerHTML = `<div class="report-grid">
        <div><span>${esc(i18n.text('import.chosenStrategy'))}</span><b>${esc(strategyText)}</b><small>${i18n.html('import.reportMode', { mode: modeText })}</small></div>
        <div><span>${esc(i18n.text('import.recognizedCount'))}</span><b>${i18n.number(arr.length)}</b><small>${esc(typeCounts)}</small></div>
        <div class="${diffClass}"><span>${esc(i18n.text('import.compareCount'))}</span><b>${expTotal ? `${i18n.number(arr.length)}/${i18n.number(expTotal)}` : i18n.html('import.noExpectedCount')}</b><small>${totalNote}</small></div>
        <div><span>${esc(i18n.text('import.issueCounts'))}</span><b>${i18n.number(hardCount)}/${i18n.number(riskCount)}</b><small>${i18n.html('import.issueBreakdown', { errors: hardCount, warnings: riskCount })}</small></div>
      </div>
      <div class="report-detail"><b>${i18n.html('import.profile')}</b>${profileBits.length ? profileBits.join('、') : i18n.html('import.standardProfile')}${expLine ? `；<b>${i18n.html('import.expectedTypes')}</b>${esc(expLine)}` : ''}${repairedSegments.length ? `；<b>${i18n.html('import.repairedSections')}</b>${esc(repairedSegments.slice(0, 3).join('；'))}${repairedSegments.length > 3 ? '……' : ''}` : ''}</div>
      ${candidates ? `<details class="candidate-details"><summary>${i18n.html('import.compareStrategies')}</summary><table><thead><tr><th>${i18n.html('import.strategyShort')}</th><th>${i18n.html('import.questionsColumn')}</th><th>${i18n.html('import.quality')}</th><th>${i18n.html('import.warningsColumn')}</th><th>${i18n.html('import.repaired')}</th></tr></thead><tbody>${candidates}</tbody></table></details>` : ''}`;
    }

    // 将结构化的预览状态映射到界面严重度，未知状态使用原有提示样式。
    function importStatusSeverity(status) {
      if (status === '正常') {
        return 'ok';
      }

      if (/* 将带中文或半角冒号的“异常”前缀视为明确的错误状态。 */ /^异常[:：]/.test(String(status || ''))) {
        return 'warn';
      }

      return 'error';
    }

    // 按筛选条件重绘导入草稿并同步当前选中集，保留实际行索引供后续编辑。
    function renderImportPreview(arr, { syncPreviewTools = true } = {}) {
      importDraft.selected = new Set([...importDraft.selected].filter((i) => i >= 0 && i < (arr || []).length));

      const warnings = [...importDraft.warnings];
      const rows = (arr || []).map(/* 每条预览行单独计算异常状态，并保留它对应的原稿位置。 */ (q, i) => {
        const status = importIssueStatus(q, importDraft.diagnostics?.profile || {});
        if (status !== '正常') {
          warnings.push(i18n.text('diagnostic.questionWarning', { number: i + 1, issue: issueText(status) }));
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
      $('#import-preview tbody').innerHTML = shown.map(/* 将原行索引和诊断状态写入预览，筛选后编辑仍使用原草稿位置。 */ ({ q, i, status }) => {
        const severity = importStatusSeverity(status);
        const styles = { ok: ['status-ok', ''], error: ['status-error', 'error-row'], warn: ['status-warn', 'issue-row'] };
        const [cls, rowCls] = styles[severity];
        const seqInfo = [q.volume, q.group, q.number ? `原${q.number}` : ''].filter(Boolean).join(' · ');
        const checked = importDraft.selected.has(i) ? 'checked' : '';
        return `<tr class="${rowCls}"><td class="select-cell"><input type="checkbox" class="import-row-check" data-select-import="${i}" ${checked}></td><td class="seq-cell"><b>${i + 1}</b>${seqInfo ? `<small>${esc(seqInfo)}</small>` : ''}</td><td>${esc(label(q.type))}</td><td>${esc(short(q.question, 72))}</td><td>${q.options.length}</td><td>${esc(q.answer.join(''))}</td><td class="${cls}">${esc(issueText(status))}</td><td><div class="row-actions"><button class="ghost mini-btn" data-edit-import="${i}">${i18n.html('common.edit')}</button><button class="ghost mini-btn" data-save-import-draft="${i}" ${i18n.attribute('aria-label', 'import.saveDraftPosition', { number: i + 1 })}>${i18n.html('import.saveDraft')}</button><button class="ghost danger mini-btn" data-delete-import="${i}">${i18n.html('common.delete')}</button></div></td></tr>${renderAiSuggestionRowV991(q, i)}`;
      }).join('');

      const filterKeys = { priority: 'import.priority', problem: 'import.problemsOnly', normal: 'import.normalOnly', all: 'import.all' };
      const filter = i18n.text(filterKeys[importDraft.filter] || filterKeys.priority);
      let report = '';
      if (importDraft.report) {
        const content = `<div class="import-report">${esc(importDraft.report)}</div>`;
        report = i18n.locale() === 'en'
          ? `<details><summary>${i18n.html('import.originalReport')}</summary>${content}</details>`
          : content;
      }

      renderImportReportPanel(arr, rows.map((row) => row.status));

      const summary = i18n.html('import.summary', { total: arr.length, shown: shown.length, filter, selected: importDraft.selected.size });
      const warningsMarkup = warnings.length
        ? `${i18n.html('import.warningCount', { count: warnings.length })}<br>${warnings.slice(0, 12).map(esc).join('<br>')}${warnings.length > 12 ? '<br>……' : ''}`
        : i18n.html('import.noWarnings');
      $('#import-summary').innerHTML = arr.length ? `${report}<b>${summary}</b><br>${warningsMarkup}` : i18n.html('import.noQuestions');
      $('#import-summary').className = `notice ${warnings.length ? 'warn' : 'ok'}`;
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

      bindImportPreviewSelection(shownIdx);
      bindImportPreviewRowActions();
      bindAiSuggestionActionsV991();
      if (syncPreviewTools) { syncAiPreviewToolsV991(); }
    }

    // 按未筛选草稿的索引管理当前可见勾选范围，变更后同步预览。
    function bindImportPreviewSelection(shownIdx) {
      const all = $('#import-select-all-visible');
      if (all) {
        const selectedVisible = shownIdx.filter((i) => importDraft.selected.has(i)).length;
        all.checked = shownIdx.length > 0 && selectedVisible === shownIdx.length;
        all.indeterminate = selectedVisible > 0 && selectedVisible < shownIdx.length;
        all.onchange = /* 全选只影响当前筛选结果，实际选中变化后才使旧预览请求失效。 */ () => {
          invalidateAiImportRequestV99?.();
          if (shownIdx.some((i) => importDraft.selected.has(i) !== all.checked)) { importDraft.invalidatePreview?.(); }

          if (all.checked) {
            shownIdx.forEach((i) => importDraft.selected.add(i));
          } else {
            shownIdx.forEach((i) => importDraft.selected.delete(i));
          }

          renderImportPreview(importDraft.questions);
        };
      }

      $$('[data-select-import]').forEach(/* 为每个预览复选框绑定原始题目索引。 */ (cb) => cb.onchange = /* 单行选择影响后续批量处理，变更后更新预览与操作状态。 */ () => {
        invalidateAiImportRequestV99?.();
        const i = Number(cb.dataset.selectImport);
        if (importDraft.selected.has(i) !== cb.checked) { importDraft.invalidatePreview?.(); }

        if (cb.checked) {
          importDraft.selected.add(i);
        } else {
          importDraft.selected.delete(i);
        }

        renderImportPreview(importDraft.questions);
      });
    }

    // 预览行编辑、保存和删除共用草稿索引，筛选不会改变操作目标。
    function bindImportPreviewRowActions() {
      $$('[data-edit-import]').forEach((btn) => btn.onclick = () => openEditQuestion(Number(btn.dataset.editImport)));

      $$('[data-save-import-draft]').forEach((btn) => btn.onclick = () => saveDraft?.(Number(btn.dataset.saveImportDraft)));

      $$('[data-delete-import]').forEach(/* 为每条可删除的预览行保留其草稿索引。 */ (btn) => btn.onclick = /* 经用户确认后删除对应草稿项，并同步选中集与预览。 */ async () => {
        const i = Number(btn.dataset.deleteImport);
        if (await globalThis.ShirohaDialogs.confirm('删除这道识别结果？')) {
          invalidateAiImportRequestV99?.();
          importDraft.invalidatePreview?.();
          removeAiSuggestionsForQuestionV991(importDraft.questions[i], i);
          importDraft.questions.splice(i, 1);
          importDraft.selected = new Set([...importDraft.selected].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));

          renderImportPreview(importDraft.questions);
        }
      });
    }

    // 按降序删除已选的有效行，避免前一项删除改变后一项的原索引。
    async function batchDeleteImportSelected() {
      const ids = [...importDraft.selected].filter((i) => i >= 0 && i < importDraft.questions.length).sort((a, b) => b - a);
      if (!ids.length) {
        toast('请先勾选要删除的题目。', 'warn');
        return;
      }

      if (!await globalThis.ShirohaDialogs.confirm(`确定批量删除选中的 ${ids.length} 道识别结果？`)) {
        return;
      }

      invalidateAiImportRequestV99?.();
      importDraft.invalidatePreview?.();
      ids.forEach((i) => {
        removeAiSuggestionsForQuestionV991(importDraft.questions[i], i);
        importDraft.questions.splice(i, 1);
      });

      importDraft.selected.clear();
      renderImportPreview(importDraft.questions);
      toast(`已批量删除 ${ids.length} 道题。`, 'ok');
    }

    // 保存前按当前编辑顺序读取各个空位的主答案与同义答案。
    function collectEditBlankGroupsV58914() {
      const rows = $$('#edit-blank-groups-v58914 [data-blank-group-v58914]');
      if (!rows.length) {
        return cloneBlankAnswersV58914(editBlankGroupsV58914);
      }

      return rows.map(/* 每行独立保留主答案及额外等价答案，避免不同空位混在一起。 */ (row) => {
        const values = [...row.querySelectorAll('[data-blank-answer-v58914]')].sort((a, b) => Number(a.dataset.blankAnswerV58914) - Number(b.dataset.blankAnswerV58914)).map((input) => String(input.value || '').trim());
        const main = values[0] || '';
        const seen = new Set(main ? [main] : []);
        const alternatives = values.slice(1).filter((value) => value && !seen.has(value) && seen.add(value));
        return [main, ...alternatives];
      });
    }

    // 检查题干中的显式空位和已编辑答案组，给用户可核对的数量提示。
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
      tip.className = `muted ${detected && detected !== configured ? 'multi-blank-count-warn-v58914' : ''}`;
    }

    // 从当前草稿重建逐空编辑控件，并让移动、修改和删除作用于当前空位。
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

      $$('#edit-blank-groups-v58914 [data-blank-move-v58914]').forEach(/* 为每个空位的移动按钮保留对应编辑行。 */ (button) => button.onclick = /* 移动前先收集未保存输入，重排空位时保留各自的答案。 */ () => {
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

      $$('#edit-blank-groups-v58914 [data-blank-delete-v58914]').forEach(/* 为每个空位绑定当前编辑行的删除操作。 */ (button) => button.onclick = /* 删除前保留剩余控件中的草稿，并按剩余空位重新渲染。 */ () => {
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

    // 题型和多空模式共同决定显示哪组控件，保留兼容的答案输入方式。
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

    // 根据题型选取答案控件，切换输入方式时保留当前值供继续编辑。
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

    // 将题型、多空模式和空位操作连接到同一个当前编辑表单。
    function bindMultiBlankEditorV58914() {
      const type = $('#edit-type');
      if (type) {
        type.onchange = /* 题型切换时只清除不再适用的逐空模式，并同步答案控件。 */ () => {
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

      bindMultiBlankModeControls();
    }

    // 转换答案模型前保留题干的空位数和现有答案，退出时仍由用户确认。
    function bindMultiBlankModeControls() {
      const enable = $('#edit-enable-multi-blank-btn-v58914');
      if (enable) {
        enable.onclick = /* 从题干空位和已有答案初始化逐空编辑，用户仍可逐组核对。 */ () => {
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
        disable.onclick = /* 经确认后把逐空主答案合回普通字段，避免误触丢失单空细节。 */ async () => {
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

    // 只有当前入口支持删除时才显示对应按钮，避免练习编辑误删试题。
    function setEditDeleteVisibleV120(visible) {
      const btn = $('#edit-delete-btn');
      if (!btn) {
        return;
      }

      btn.style.display = visible ? '' : 'none';
      btn.disabled = !visible;
    }

    // 从指定题目装载各字段和状态提示，既支持导入预览也支持练习编辑。
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

    // 从当前仍存在的预览行打开编辑表单，防止失效索引指向其他题目。
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

    // 关闭编辑器后释放当前编辑入口关联的临时状态。
    function closeEditModal() {
      $('#edit-modal').classList.add('hidden');
      $('#edit-modal').setAttribute('aria-hidden', 'true');
      practiceEditSessionV120 = null;
      setEditDeleteVisibleV120(true);
    }

    // 读取编辑字段，保留原题中的未编辑数据及对应的逐空答案形态。
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

    // 根据打开编辑器的来源决定更新草稿还是保存正在练习的原题。
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

      invalidateAiImportRequestV99?.();
      const oldQuestion = importDraft.questions[i];
      const q = normalizeQuestion(read.raw, i);
      importDraft.invalidatePreview?.();
      removeAiSuggestionsForQuestionV991(oldQuestion, i);
      importDraft.questions[i] = q;
      const status = validateQuestion(q);
      $('#edit-status').textContent = i18n.text('editor.savedStatus', { status: issueText(status) });
      $('#edit-status').className = `notice ${status === '正常' ? 'ok' : 'warn'}`;
      renderImportPreview(importDraft.questions);
    }

    // 当前预览允许删除时再发起确认，练习中编辑不提供删除。
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
        invalidateAiImportRequestV99?.();
        importDraft.invalidatePreview?.();
        removeAiSuggestionsForQuestionV991(importDraft.questions[i], i);
        importDraft.questions.splice(i, 1);
        importDraft.selected = new Set([...importDraft.selected].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));

        closeEditModal();
        renderImportPreview(importDraft.questions);
      }
    }

    // 通过来源题库和题目 ID 查找原题，避免跨库重号写错来源。
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

    // 仅在当前题目和练习状态允许编辑时进入原题表单。
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

    // 在可保存的练习会话中写入原题，保留题库来源和已答状态约束。
    async function savePracticeEditQuestionV120() {
      return runMutation(/* 事务提交前重新核对会话和当前题目，写入失败时保留可继续编辑的内容。 */ async () => {
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
        $('#edit-status').textContent = i18n.text('editor.savedSourceStatus', { status: issueText(status) });
        $('#edit-status').className = `notice ${status === '正常' ? 'ok' : 'warn'}`;
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
