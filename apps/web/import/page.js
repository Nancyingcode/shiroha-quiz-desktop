// 编排导入控件、识别和共享预览，题目保存沿用现有提交及恢复事务。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;

  function cleanImportBankNameFromFile(fileName) {
    return String(fileName || '')
      .replace(/* 去掉最后一个文件扩展名，保留前面可能用于分组或命名的点号。 */ /\.[^.]+$/, '').trim() || '导入题库';
  }

  // 所有入口共享同一草稿，直到初始化绑定控件才访问页面。
  function create({
    state,
    draft: importDraft,
    view,
    parsing,
    banks,
    editor,
    actions,
    ai,
    panel,
    ocr,
    persistence,
    backup,
  }) {
    const {
      select: $,
      selectAll: $$,
      escape: esc,
      renderImportPreview,
      showNotice,
      toast,
      warnDev,
      formatBytesV376,
    } = view;
    const {
      parseTextQuestionsDetailed,
      normalizeQuestion,
      countTypes,
      collectImportWarnings,
      collectSoftRiskWarnings,
      parseAnswerAnalysisEntries,
      dualAnswers,
      tableImportPreviewTextV49,
    } = parsing;
    const { normalizeBankGroupNameV58, bankPathLabelV58, groupSuggestions } = banks;
    const {
      current: currentEditor,
      closeEditModal,
      saveEditQuestion,
      deleteEditQuestion,
      batchDeleteImportSelected,
    } = editor;
    const { confirmImport, openFindReplace, isBusy } = actions;
    const {
      cancelAiImportRequestV99,
      cancelAiPreviewRequestV991,
      invalidateAiImportRequestV99,
      resetAiSuggestionsV991,
    } = ai;
    const { closeAiImportPanelV99, closeAiPreviewPanelV991, syncAiImportActionV99 } = panel;
    const { bind: bindOcr, resetOcrImportState } = ocr;
    const {
      confirm: confirmBackup,
      runMutation,
      normalizeBackupPayloadV23,
      countUnresolvedBackupImagesV24,
      applyLocalBackup,
    } = backup;
    const { readImportFile, readDualFile } = importDraft;

    // 文件名只覆盖空白或上一次自动命名，保留用户手工输入的题库名。
    function setImportBankNameFromFile(fileName) {
      const inp = $('#import-bank-name');
      if (!inp) {
        return;
      }

      const next = cleanImportBankNameFromFile(fileName);
      const current = inp.value.trim();
      const lastAuto = inp.dataset.autoNameValue || '';
      const canOverwrite = !current || inp.dataset.autoName === '1' || current === lastAuto;
      if (canOverwrite) {
        inp.value = next;
        inp.dataset.autoName = '1';
        inp.dataset.autoNameValue = next;
      }
    }

    function readImportBankGroupV58() {
      return normalizeBankGroupNameV58($('#import-bank-group-v58')?.value || '');
    }

    // 为缺少题库分组样式的旧页面补齐界面规则，多次初始化只插入一次。
    function ensureBankGroupStylesV58() {
      if (typeof document === 'undefined' || document.getElementById('shiroha-bank-group-style-v58')) {
        return;
      }

      const style = document.createElement('style');
      style.id = 'shiroha-bank-group-style-v58';
      style.textContent = `
      .bank-group-field-v58{display:flex;flex-direction:column;gap:6px;min-width:180px;flex:1 1 180px;}
      .bank-group-field-v58 input{width:100%;}
      .bank-group-section-v58{margin:14px 0 18px;}
      .bank-group-head-v58{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 2px 8px;}
      .bank-group-head-v58 b{font-size:1rem;}
      .bank-group-head-v58 .muted{font-size:.88rem;}
      .bank-group-list-v58{display:grid;gap:10px;}
      .bank-group-badge-v58{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;background:rgba(79,124,255,.10);color:var(--primary,#4f7cff);font-size:.78rem;font-weight:600;margin-left:8px;}
      .import-target-bank-field-v59{display:none;}
      .import-target-bank-field-v59.is-visible{display:grid;}
    `;
      document.head.appendChild(style);
    }

    // 题库命名和重命名使用相同的一级分组候选项，只在各自控件缺失时插入。
    function appendBankGroupInput(input, groupInputId) {
      if (input && !$(`#${groupInputId}`)) {
        const holder = document.createElement('label');
        holder.className = 'bank-group-field-v58';
        holder.innerHTML = `${i18n.html('import.group')}<input id="${groupInputId}" list="bank-group-list-v58" ${i18n.attribute('placeholder', 'import.groupPlaceholder')}>`;
        const anchor = input.closest('label') || input;
        anchor.insertAdjacentElement('afterend', holder);
      }
    }

    // 将分组控件接到导入题库名称，并让已有分组可被输入框发现。
    function ensureBankGroupUiV58() {
      ensureBankGroupStylesV58();
      appendBankGroupInput($('#import-bank-name'), 'import-bank-group-v58');

      if (!$('#bank-group-list-v58')) {
        const datalist = document.createElement('datalist');
        datalist.id = 'bank-group-list-v58';
        document.body.appendChild(datalist);
      }

      renderBankGroupDatalistV58();
      appendBankGroupInput($('#bank-rename-input'), 'bank-group-rename-input-v58');
      ensureImportAppendUiV59();
    }

    // 当导入区缺少追加控件时装配保存方式和目标题库选择。
    function ensureImportAppendUiV59() {
      const nameInput = $('#import-bank-name');
      if (nameInput && !$('#import-save-mode-v59')) {
        const mode = document.createElement('label');
        mode.className = 'bank-group-field-v58 import-save-mode-field-v59';
        mode.innerHTML = `${i18n.html('import.saveMode')}<select id="import-save-mode-v59"><option value="new" data-i18n="import.newBank">${i18n.text('import.newBank')}</option><option value="append" data-i18n="import.appendBank">${i18n.text('import.appendBank')}</option></select>`;
        const anchor = $('#import-bank-group-v58')?.closest('label') || nameInput.closest('label') || nameInput;
        anchor.insertAdjacentElement('afterend', mode);
        const select = mode.querySelector('select');
        if (select) {
          select.onchange = syncImportAppendUiV59;
        }
      }

      if (nameInput && !$('#import-target-bank-v59')) {
        const target = document.createElement('label');
        target.id = 'import-target-bank-label-v59';
        target.className = 'bank-group-field-v58 import-target-bank-field-v59';
        target.innerHTML = `${i18n.html('import.appendTo')}<select id="import-target-bank-v59"></select>`;
        const anchor = $('#import-save-mode-v59')?.closest('label') || $('#import-bank-group-v58')?.closest('label') || nameInput.closest('label') || nameInput;
        anchor.insertAdjacentElement('afterend', target);
      }

      renderImportTargetBankOptionsV59();
      syncImportAppendUiV59();
    }

    // 重建可追加的目标题库列表，维持仍然有效的选择。
    function renderImportTargetBankOptionsV59() {
      const select = $('#import-target-bank-v59');
      if (!select) {
        return;
      }

      const previous = select.value || state.activeBankId || '';
      const banks = Array.isArray(state.banks) ? state.banks : [];
      select.innerHTML = banks.map((b) => `<option value="${esc(b.id)}">${esc(i18n.text('import.bankOption', { bank: bankPathLabelV58(b), count: (b.questions || []).length }))}</option>`).join('');

      if (banks.some((b) => b.id === previous)) {
        select.value = previous;
      } else {
        select.value = banks[0]?.id || '';
      }

      select.disabled = !banks.length;
    }

    // 根据新增、追加和二次编辑模式同步目标题库控件状态。
    function syncImportAppendUiV59() {
      const mode = $('#import-save-mode-v59');
      const modeLabel = mode?.closest('label');
      const targetLabel = $('#import-target-bank-label-v59');
      const confirmBtn = $('#confirm-import-btn');
      const dualConfirm = $('#dual-confirm-import-btn');
      if (currentEditor()) {
        if (modeLabel) {
          modeLabel.style.display = 'none';
        }

        if (targetLabel) {
          targetLabel.style.display = 'none';
          targetLabel.classList.remove('is-visible');
        }

        return;
      }

      if (modeLabel) {
        modeLabel.style.display = '';
      }

      const isAppend = mode?.value === 'append';
      if (targetLabel) {
        targetLabel.classList.toggle('is-visible', isAppend);
        targetLabel.style.display = isAppend ? 'grid' : 'none';
      }

      if (confirmBtn) {
        i18n.bindText(confirmBtn, isAppend ? 'import.confirmAppend' : 'import.confirm');
      }

      if (dualConfirm) {
        i18n.bindText(dualConfirm, isAppend ? 'import.confirmAppend' : 'import.confirm');
      }
    }

    // 分组变动后刷新建议列表，供题库编辑表单复用。
    function renderBankGroupDatalistV58() {
      const list = $('#bank-group-list-v58');
      if (!list) {
        return;
      }

      list.innerHTML = groupSuggestions(state.banks).map((g) => `<option value="${esc(g)}"></option>`).join('');
    }

    /* 文件名回显只负责界面提示；文件读取仍由原有 onchange 绑定处理，因此用
       addEventListener 叠加，避免覆盖 readImportFile / readDualFile。 */
    function bindFileFieldsV615() {
      $$('.file-control-v615').forEach(/* 为尚未绑定的文件控件回显文件名，实际读取仍由导入流程负责。 */ (control) => {
        if (control.dataset.fileBoundV615 === '1') {
          return;
        }

        const input = control.querySelector('input[type="file"]');
        const nameEl = control.querySelector('.file-name-v615');
        if (!input || !nameEl) {
          return;
        }

        control.dataset.fileBoundV615 = '1';
        input.addEventListener('change', /* 文件名使用原文，清空时恢复可随语言切换的占位。 */ () => {
          const file = input.files && input.files[0];
          if (file) {
            nameEl.removeAttribute('data-i18n');
            nameEl.textContent = file.name;
          } else {
            i18n.bindText(nameEl, 'import.noFile');
          }

          control.classList.toggle('has-file-v615', Boolean(file));
        });
      });
    }

    // 单文件和双文件导入与同一预览区联动，原文编辑时使对应读取失效。
    function bindSingleImport() {
      $('#load-sample-btn').onclick = loadSample;
      $('#import-file').onchange = readImportFile;
      $('#parse-import-btn').onclick = parseImport;
      $('#confirm-import-btn').onclick = confirmImport;
      const findReplaceBtnV51 = $('#find-replace-import-btn');
      if (findReplaceBtnV51) {
        findReplaceBtnV51.onclick = openFindReplace;
      }

      const importTextAreaV49 = $('#import-text');
      if (importTextAreaV49 && !importTextAreaV49.dataset.sourceBoundV49) {
        importTextAreaV49.dataset.sourceBoundV49 = '1';
        importTextAreaV49.addEventListener('input', /* 手工修改原文后，旧表格结果不能再作为导入来源。 */ () => {
          importDraft.invalidateRead('single');
          if (importTextAreaV49.dataset.tableImportV49 === '1') {
            importDraft.tableResult = null;
            delete importTextAreaV49.dataset.tableImportV49;
          }

          importDraft.sourceMeta = { name: '手动文本', size: new Blob([importTextAreaV49.value || '']).size, type: 'text' };
        });
      }

      $('#clear-import-btn').onclick = clearSingleImport;
      bindOcr();
    }

    // 清空草稿前停止识别，避免异步结果重新填充已清空的内容。
    function clearSingleImport() {
      cancelAiImportRequestV99(true);
      cancelAiPreviewRequestV991(true);
      closeAiImportPanelV99();
      closeAiPreviewPanelV991();
      resetAiSuggestionsV991();
      const input = $('#import-text');
      input.value = '';
      delete input.dataset.tableImportV49;
      importDraft.clearSingle();
      resetOcrImportState();
      renderImportPreview([]);
      syncAiImportActionV99();
    }

    // 题目和答案各自管理文件读取，合并后进入同一确认保存流程。
    function bindDualImport() {
      const dualConfirmBtn = $('#dual-confirm-import-btn');
      if (dualConfirmBtn) {
        dualConfirmBtn.onclick = confirmImport;
      }

      $('#dual-question-file').onchange = (e) => readDualFile(e, 'question');

      $('#dual-answer-file').onchange = (e) => readDualFile(e, 'answer');

      [['#dual-question-text', 'question'], ['#dual-answer-text', 'answer']].forEach(/* 将双文件文本框与各自的读取槽位关联，用户编辑时使原读取失效。 */ ([selector, slot]) => {
        const field = $(selector);
        if (field && !field.dataset.readBoundV4) {
          field.dataset.readBoundV4 = '1';
          field.addEventListener('input', () => importDraft.invalidateRead(slot));
        }
      });

      $('#parse-dual-import-btn').onclick = parseDualImport;
      $('#clear-dual-import-btn').onclick = clearDualImport;
      $('#dual-load-sample-btn').onclick = loadDualSample;
    }

    // 清空双文件时撤销 AI 请求，避免迟到结果回写。
    function clearDualImport() {
      invalidateAiImportRequestV99();
      cancelAiPreviewRequestV991(true);
      resetAiSuggestionsV991();
      $('#dual-question-text').value = '';
      $('#dual-answer-text').value = '';
      importDraft.clearDual();
      renderImportPreview([]);
    }

    // 两个识别入口共用筛选、批量删除与编辑弹窗。
    function bindPreviewControls() {
      $('#revalidate-import-btn').onclick = () => renderImportPreview(importDraft.questions);

      $('#edit-close-btn').onclick = closeEditModal;
      $('#edit-save-btn').onclick = saveEditQuestion;
      $('#edit-delete-btn').onclick = deleteEditQuestion;
      const filter = $('#import-preview-filter');
      if (filter) {
        filter.onchange = /* 筛选变化时使旧预览失效，避免迟到结果覆盖当前筛选。 */ (e) => {
          invalidateAiImportRequestV99();
          if (importDraft.filter !== e.target.value) {
            importDraft.invalidatePreview();
          }

          importDraft.filter = e.target.value;
          renderImportPreview(importDraft.questions);
        };
      }

      const batchDelete = $('#batch-delete-import-btn');
      if (batchDelete) {
        batchDelete.onclick = batchDeleteImportSelected;
      }

      const clearSelection = $('#clear-import-selection-btn');
      if (clearSelection) {
        clearSelection.onclick = /* 清除选择时使基于原选题的预览失效。 */ () => {
          invalidateAiImportRequestV99();
          if (importDraft.selected.size) {
            importDraft.invalidatePreview();
          }

          importDraft.selected.clear();
          renderImportPreview(importDraft.questions);
        };
      }
    }

    // HTML 文件拖放只读取用户交付的 File，不接收本机路径；与选择文件共用解析和确认流程。
    function createFileDragHandler(type) {
      return /* 仅在导入页空闲时接收单一题库文件，其他文件拖放也阻止浏览器导航。 */ (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes('Files')) {
          return;
        }

        event.preventDefault();
        if (type !== 'drop' || !event.target.closest?.('#import') || isBusy()) {
          return;
        }

        const files = Array.from(event.dataTransfer.files || []);
        if (files.length !== 1) {
          toast(i18n.text('import.dropOne'), 'warn');
          return;
        }

        if (!/* 检查拖入文件是否属于导入流程能识别的扩展名，大小写不影响判断。 */ /\.(txt|json|csv|xlsx|docx|doc|pdf)$/i.test(files[0].name)) {
          toast(i18n.text('import.unsupportedType'), 'warn');
          return;
        }

        void readImportFile({ target: { files } });
      };
    }

    // 应用启动前注册一次，浏览器在导入页外也能拦截文件拖放导航。
    function bindFileDrop() {
      for (const type of ['dragover', 'drop']) {
        document.addEventListener(type, createFileDragHandler(type));
      }
    }

    // 恢复草稿前使旧的 AI、OCR 和文件读取失效，避免迟到结果覆盖恢复内容。
    function resetSourcesForRestore() {
      cancelAiImportRequestV99(true);
      cancelAiPreviewRequestV991(true);
      closeAiImportPanelV99();
      closeAiPreviewPanelV991();
      resetOcrImportState();
      ['single', 'question', 'answer'].forEach((slot) => importDraft.invalidateRead(slot));

      importDraft.invalidatePreview();
      importDraft.invalidateBankName();
      ['import-file', 'dual-question-file', 'dual-answer-file'].forEach(/* 清理旧的文件选择和控件显示，恢复后允许再次选择同一个文件。 */ (id) => {
        const input = $(`#${id}`);
        if (!input) {
          return;
        }

        input.value = '';
        const control = input.closest('.file-control-v615');
        const name = control?.querySelector('.file-name-v615');
        if (name) {
          i18n.bindText(name, 'import.noFile');
        }

        control?.classList.remove('has-file-v615');
      });

      const name = $('#import-bank-name');
      if (name) {
        name.dataset.autoName = '0';
      }
    }

    // 解析导入文本，并从同一次解析中保留预览使用的诊断和来源信息。
    function parseTextQuestions(text, strategy = 'auto') {
      const result = parseTextQuestionsDetailed(text, strategy, (report) => {
        importDraft.report = report;
      });
      importDraft.diagnostics = result.diagnostics;
      return result.questions;
    }

    function summarizeImportResult(arr, warnings = []) {
      const stats = countTypes(arr || []);
      return `识别到 ${(arr || []).length} 道题：单选${stats.single || 0}、多选${(stats.multiple || 0) + (stats.multi || 0)}、判断${stats.judge || 0}、填空${stats.blank || 0}、简答${stats.short || 0}。${warnings && warnings.length ? `发现 ${warnings.length} 条需要确认的问题。` : '未发现明显异常。'}`;
    }

    // 导入风险提示采用序列化后的字节数，涵盖多字节文本。
    function estimateImportPayloadSizeV376(arr) {
      try {
        return new Blob([JSON.stringify(arr || [])]).size;
      } catch {
        return 0;
      }
    }

    // 汇总题量、来源文件和序列化负载的风险，给出适用于当前导入的提示。
    function largeImportRiskMessageV376(arr = importDraft.questions) {
      const count = (arr || []).length;
      const sourceSize = Number(importDraft.sourceMeta?.size || 0);
      const payloadSize = estimateImportPayloadSizeV376(arr);
      const reasons = [];
      if (sourceSize >= 5 * 1024 * 1024) {
        reasons.push(`源文件约 ${formatBytesV376(sourceSize)}`);
      }

      if (count >= 3000) {
        reasons.push(`识别题数 ${count.toLocaleString('zh-CN')} 道`);
      }

      if (payloadSize >= 4 * 1024 * 1024) {
        reasons.push(`预估题目数据约 ${formatBytesV376(payloadSize)}`);
      }

      if (!reasons.length) {
        return '';
      }

      return `大文件提醒：${reasons.join('，')}。浏览器本地保存空间有限，确认导入时可能失败；建议先分批导入、清理旧题库/记录，或导入前先导出完整备份。`;
    }

    function summarizeImportResultV376(arr, warnings = []) {
      const base = summarizeImportResult(arr, warnings);
      const risk = largeImportRiskMessageV376(arr);
      return risk ? `${base} ${risk}` : base;
    }

    // 加载示例前取消旧文件读取与自动命名，避免异步结果覆盖示例。
    function loadSample() {
      importDraft.invalidateBankName();
      const text = $('#import-text');
      $('#import-bank-name').value = 'C1导入示例题库';
      text.value = `1. 机动车驾驶人初次申领驾驶证后的实习期是多长时间？
A. 6个月
B. 12个月
C. 16个月
D. 18个月
答案：B
解析：初次取得汽车类准驾车型后的实习期为12个月。

2. 初次申领的机动车驾驶证有效期为6年。[判断题]
A、正确(正确答案)
B、错误

3. 雨天安全驾驶应注意哪些事项？ [多选题]
A、降低车速(正确答案)
B、加大跟车距离(正确答案)
C、避免急刹急打方向(正确答案)
D、高速通过积水路段`;
      text.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 将表格解析结果应用到导入草稿，并使已有 AI 任务与预览失效。
    function applyTableImportResultV49(result, fileName) {
      invalidateAiImportRequestV99();
      cancelAiPreviewRequestV991(true);
      resetAiSuggestionsV991();
      importDraft.tableResult = result;
      const questions = (result.questions || []).map((q, i) => normalizeQuestion(q, i)).filter((q) => q.question);
      importDraft.questions = questions;

      importDraft.warnings = [];
      importDraft.report = result.report || '解析策略：Excel/CSV 表格题库解析。';
      importDraft.diagnostics = {
        mode: 'Excel/CSV 表格题库解析',
        strategy: '表格题库解析',
        profile: { tableImport: true },
        candidates: [{
          name: '表格题库解析',
          questions: questions.length,
          score: questions.length * 12,
          warnings: collectImportWarnings(questions),
        }],
        expected: { total: questions.length, types: {} },
        stats: countTypes(questions),
        warnings: result.warnings || [],
      };
      importDraft.selected.clear();
      importDraft.filter = 'priority';
      const textEl = $('#import-text');
      if (textEl) {
        textEl.dataset.tableImportV49 = '1';
        textEl.value = tableImportPreviewTextV49(result, fileName);
      }

      renderImportPreview(questions);
      $('#confirm-import-btn').disabled = !questions.length;
      const warnings = collectSoftRiskWarnings(questions, importDraft.diagnostics.profile || {});
      if (questions.length) {
        const risk = largeImportRiskMessageV376(questions);
        showNotice('表格识别完成', summarizeImportResultV376(questions, warnings), (warnings.length || risk) ? 'warn' : 'ok');
      } else {
        showNotice('表格识别失败', '没有从表格中识别到有效题目，请检查表头是否包含题干、答案、选项等字段。', 'danger');
      }
    }

    // 自动导入先辨别 JSON 外形，解析失败时交由原有文本识别路径。
    function tryParseAutoJsonImportV58922(text) {
      const source = String(text || '').trim();
      if (!source || !['[', '{'].includes(source[0])) {
        return null;
      }

      try {
        const data = JSON.parse(source);
        return data && typeof data === 'object' ? data : null;
      } catch {
        return null;
      }
    }

    // 全量备份与题目预览分别确认，等保存成功后才清理仍属于本次导入的预览。
    async function mergeRecognizedBackup(data, isCurrentSource) {
      const normalized = normalizeBackupPayloadV23(data, importDraft.sourceMeta.name || '导入备份.json');
      if (!normalized.banks.length) {
        showNotice(i18n.text('import.parseFailed'), '备份中没有可导入的题库。', 'danger');
        return;
      }

      const bankCount = normalized.banks.length;
      const total = normalized.banks.reduce((count, bank) => count + bank.questions.length, 0);
      const accepted = await confirmBackup(
        `识别到备份：${bankCount} 个题库，${total} 道题，${normalized.records.length} 条学习记录。`
        + '将按原分组合并导入题库、错题、收藏和学习记录，保留当前数据；同名题库会自动重命名。确定导入？',
      );
      if (!accepted) {
        return;
      }

      // 全局重试沿用已经确认的归一化备份和预览清理流程。
      const applyImport = () => runMutation(/* 等待备份合并成功后再清空题目预览。 */ async () => {
        // 确认、等待原生读取及失败期间都可能换文件或离页，不能继续使用已失效的合并确认。
        if (!isCurrentSource()) {
          toast(i18n.text('import.sourceChanged'), 'warn');
          return false;
        }

        const restored = await applyLocalBackup(normalized, 'merge', countUnresolvedBackupImagesV24(data));
        if (!restored) {
          return false;
        }

        if (isCurrentSource()) {
          importDraft.questions = [];
          importDraft.selected.clear();
          importDraft.warnings = [];
          importDraft.report = '';
          importDraft.diagnostics = null;
          renderImportPreview([]);
        }

        showNotice('备份导入完成', `已合并导入 ${bankCount} 个题库、${total} 道题及对应的错题、收藏和学习记录。`, 'ok');
        return true;
      }, applyImport);

      await applyImport();
    }

    // JSON 题库和数组也走人工核对预览，保留和文本解析一致的诊断字段。
    function parseStructuredQuestions(data) {
      const items = Array.isArray(data) ? data : (data.questions || []);
      const questions = items.map(normalizeQuestion).filter((q) => q.question);
      importDraft.report = '解析策略：JSON结构化导入。';
      importDraft.diagnostics = {
        mode: 'JSON结构化导入',
        strategy: 'JSON结构化导入',
        profile: {},
        candidates: [{
          name: 'JSON结构化导入',
          questions: questions.length,
          score: questions.length * 10,
          warnings: collectImportWarnings(questions),
        }],
        expected: { total: 0, types: {} },
        stats: countTypes(questions),
      };
      return questions;
    }

    // 按导入模式解析当前原文；来源更换后的旧读取和 AI 建议不能回写结果。
    async function parseImport() {
      invalidateAiImportRequestV99();
      cancelAiPreviewRequestV991(true);
      resetAiSuggestionsV991();
      closeAiPreviewPanelV991();
      const textEl = $('#import-text');
      const text = textEl.value.trim();
      const strategy = $('#import-strategy')?.value || 'auto';
      if (importDraft.tableResult && textEl?.dataset.tableImportV49 === '1') {
        importDraft.invalidateRead('single');
        applyTableImportResultV49(importDraft.tableResult, $('#import-bank-name')?.value || '表格题库');
        return;
      }

      if (!text) {
        toast(i18n.text('import.emptyInput'), 'warn', i18n.text('import.notStarted'));
        return;
      }

      const generation = importDraft.invalidateRead('single');
      try {
        const inputMode = $('#import-mode').value;
        const explicitJson = inputMode === 'json';
        const data = explicitJson ? JSON.parse(text) : tryParseAutoJsonImportV58922(text);
        if (Array.isArray(data?.banks)) {
          // 即使输入被改回同样的字面，读取代次变化也会使原确认失效。
          await mergeRecognizedBackup(data, () => importDraft.isCurrentRead('single', generation)
            && textEl.value.trim() === text && $('#import-mode').value === inputMode
            && $('#import')?.classList.contains('active'));

          return;
        }

        importDraft.warnings = [];
        importDraft.report = '';
        importDraft.diagnostics = null;
        const questions = explicitJson || data !== null ? parseStructuredQuestions(data) : parseTextQuestions(text, strategy);
        importDraft.questions = questions;

        importDraft.selected.clear();
        renderImportPreview(questions);
        $('#confirm-import-btn').disabled = !questions.length;
        const warnings = collectSoftRiskWarnings(questions, importDraft.diagnostics?.profile || {});
        if (questions.length) {
          const risk = largeImportRiskMessageV376(questions);
          showNotice('识别完成', summarizeImportResultV376(questions, warnings), (warnings.length || risk) ? 'warn' : 'ok');
        } else {
          showNotice(i18n.text('import.parseFailed'), '没有识别到有效题目。请检查题号、选项或答案格式，也可以先粘贴纯文本后再试。', 'danger');
        }
      } catch (e) {
        // 文本预览只展示异常详情，不把它作为 HTML。
        toast(i18n.text('import.parseFailedDetail', { detail: String(e.message) }), 'danger', i18n.text('import.parseFailed'));
      }
    }

    // 双文件样例保留跨题型重复题号，以演示需结合分组对齐答案。
    const DUAL_SAMPLE_QUESTIONS = `一、单选题
1. 机动车驾驶人初次申领驾驶证后的实习期是多长时间？
A. 6个月
B. 12个月
C. 16个月
D. 18个月

二、判断题
1. 初次申领的机动车驾驶证有效期为6年。
A. 正确
B. 错误

三、多选题
1. 雨天安全驾驶应注意哪些事项？
A. 降低车速
B. 加大跟车距离
C. 避免急刹急打方向
D. 高速通过积水路段`;
    const DUAL_SAMPLE_ANSWERS = `一、单选题
1. B

二、判断题
1. A

三、多选题
1. ABC`;

    // 装载成对的题目与答案样例，清理双文件读取及旧预览关联。
    function loadDualSample() {
      importDraft.invalidateBankName();
      importDraft.invalidateRead('question');
      importDraft.invalidateRead('answer');
      $('#import-bank-name').value = 'C1双文件导入示例题库';
      $('#dual-question-text').value = DUAL_SAMPLE_QUESTIONS;
      $('#dual-answer-text').value = DUAL_SAMPLE_ANSWERS;
      $('#dual-match-mode').value = 'auto';
      toast(i18n.text('import.dualSampleReady'), 'ok');
    }

    // 独立读取题目与答案文本，再按用户选择或自动策略匹配并给出诊断。
    function parseDualImport() {
      invalidateAiImportRequestV99();
      cancelAiPreviewRequestV991(true);
      resetAiSuggestionsV991();
      closeAiPreviewPanelV991();
      const qText = $('#dual-question-text').value.trim();
      const aText = $('#dual-answer-text').value.trim();
      if (!qText || !aText) {
        toast(i18n.text('import.dualEmptyInput'), 'warn', i18n.text('import.dualNotStarted'));
        return;
      }

      importDraft.invalidateRead('question');
      importDraft.invalidateRead('answer');
      importDraft.invalidatePreview();
      try {
        importDraft.warnings = [];
        importDraft.report = '';
        const qStrategy = $('#import-strategy')?.value || 'auto';
        const questions = parseTextQuestions(qText, qStrategy).map((q, i) => ({ ...q, answer: [], number: q.number || i + 1 }));
        const mode = $('#dual-match-mode').value;
        const resolved = resolveDualAnswerCandidates(questions, aText, mode);
        const answerEntries = resolved.answerEntries || [];
        const result = resolved.result || dualAnswers.mergeQuestionAnswers(questions, answerEntries, mode);
        importDraft.questions = result.questions;
        importDraft.warnings = result.warnings;
        importDraft.report = `解析策略：双文件导入；题目文件和答案文件分别识别后按自动/所选规则合并。${
          result.strategyName ? ` 实际采用：${result.strategyName}。` : ''
        }${resolved.answerSourceName ? ` 答案文件识别：${resolved.answerSourceName}。` : ''
        }${resolved.answerSourceSummary ? ` 答案候选：${resolved.answerSourceSummary}。` : ''
        }${result.autoSummary ? ` 合并候选：${result.autoSummary}。` : ''}`;
        importDraft.diagnostics = { ...(importDraft.diagnostics || {}), mode: '双文件导入', matchMode: mode, chosenMatchMode: result.chosenMode || mode, answerCount: answerEntries.length, questionCount: questions.length, stats: countTypes(result.questions || []), mergeWarnings: result.warnings || [], autoSummary: result.autoSummary || '', answerSource: resolved.answerSourceName || '', answerSourceSummary: resolved.answerSourceSummary || '' };
        importDraft.selected.clear();
        renderImportPreview(importDraft.questions);
        $('#confirm-import-btn').disabled = !importDraft.questions.length;
        const warnings = [...new Set(collectSoftRiskWarnings(importDraft.questions, importDraft.diagnostics?.profile || {}).concat(importDraft.warnings || []))];
        if (importDraft.questions.length) {
          const risk = largeImportRiskMessageV376(importDraft.questions);
          showNotice('双文件合并完成', `题目文件识别 ${questions.length} 道，答案文件识别 ${answerEntries.length} 条；答案策略：${resolved.answerSourceName || '答案表提取'}；合并后 ${importDraft.questions.length} 道。${warnings.length ? `存在 ${warnings.length} 条提示，请在预览中确认。` : '未发现明显异常。'}${risk ? ` ${risk}` : ''}`, (warnings.length || risk) ? 'warn' : 'ok');
        } else {
          showNotice('双文件合并失败', '没有得到可导入题目，请检查题目文件和答案文件的对应方式。', 'danger');
        }
      } catch (e) {
        // 文本预览只展示异常详情，不把它作为 HTML。
        toast(i18n.text('import.dualFailedDetail', { detail: String(e.message) }), 'danger', i18n.text('import.dualFailed'));
      }
    }

    // 依序准备答案来源，让完整题库兜底沿用原来的草稿诊断写入时机。
    function resolveDualAnswerCandidates(questions, text, mode) {
      const standardEntries = dualAnswers.parseAnswerEntries(text);
      const analysisEntries = parseAnswerAnalysisEntries(text);
      let fallbackQuestions;
      try {
        fallbackQuestions = parseTextQuestions(text, 'auto') || [];
      } catch (error) {
        warnDev('普通文本解析失败，返回空结果。', error);
        fallbackQuestions = [];
      }

      return dualAnswers.resolveDualAnswerCandidates(questions, {
        standardEntries, analysisEntries, fallbackQuestions,
      }, mode);
    }

    // 手工命名使在途生成的文件名失效，恢复重入时保留原监听。
    function bindBankName() {
      const input = $('#import-bank-name');
      if (input && !input.dataset.autoNameBound) {
        input.dataset.autoNameBound = '1';
        input.addEventListener('input', () => {
          importDraft.invalidateBankName();
          input.dataset.autoName = '0';
        });
      }
    }

    // 在启动或恢复重入时接回原有控件，输入监听仍按节点只挂载一次。
    function bind() {
      bindFileFieldsV615();
      bindBankName();
      bindSingleImport();
      bindDualImport();
      bindPreviewControls();
      $('#save-import-draft-btn').onclick = () => persistence.save();

      $('#restore-import-draft-btn').onclick = persistence.restore;
      $('#delete-import-draft-btn').onclick = persistence.remove;
    }

    function refreshAppendTarget() {
      renderImportTargetBankOptionsV59();
      syncImportAppendUiV59();
    }

    return {
      bind,
      bindFileDrop,
      setBankNameFromFile: setImportBankNameFromFile,
      readBankGroup: readImportBankGroupV58,
      ensureBankGroupUi: ensureBankGroupUiV58,
      renderBankGroups: renderBankGroupDatalistV58,
      refreshAppendTarget,
      syncAppend: syncImportAppendUiV59,
      applyTable: applyTableImportResultV49,
      parseImport,
      parseTextQuestions,
      resolveDualAnswerCandidates,
      riskMessage: largeImportRiskMessageV376,
      resetSourcesForRestore,
    };
  }

  globalThis.ShirohaImportPage = Object.freeze({ create, cleanImportBankNameFromFile });
})();
