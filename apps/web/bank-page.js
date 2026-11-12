(() => {
  'use strict';
  function create({
    state, select: $, selectAll: $$, escape: esc, label, short, formatDate: fmt, now, countTypes,
    scope, paging, rendering, selection, actions, content,
  }) {
    const {
      ensureGroupUi: ensureBankGroupUiV58, ensure: ensurePracticeScopeV8916, current: practiceScopeV8916,
      groupName: bankGroupNameV58, pathLabel: bankPathLabelV58, normalizeGroup: normalizeBankGroupNameV58,
      renderGroups: renderBankGroupDatalistV58, setBank: setPracticeBankScopeV8916, setGroup: setPracticeGroupScopeV8916,
      groupType: PRACTICE_SCOPE_GROUP_V8916, bankType: PRACTICE_SCOPE_BANK_V8916,
    } = scope;
    const {
      page: nativePage, visible: nativeViewVisible, begin: beginNativeRender, versions: nativeRenderVersions,
      loadItems: loadNativeItems, itemsForBanks: practiceSessionItemsForBanksV8916,
    } = paging;
    const { all: renderAll, exportSummary: renderExportBankSummaryV23, toast } = rendering;
    const { get: getExportSelection, set: setExportSelection } = selection;
    const {
      activeBank, transaction: runMutation, save: saveSilent, edit: editBankByIdV45, duplicate: duplicateBankById,
      exportBank: exportBankById, deleteBanks: deleteBanksV32, deleteQuestions: deleteBankQuestions,
      canSelectExportBanks,
    } = actions;
    const {
      stripUnsafe: stripUnsafeImageDataUrisV83, optionText: pickRichOptionTextV57,
      repair: repairCircledCombinationQuestion, parseTable: parseDocxMarkdownTableBlockV55,
      normalizeImages: normalizeQuestionImagesForWebV83, normalizeType: normalizeWebQuestionType,
      questionBody: renderQuestionBodyV83, questionContent: renderQuestionContent, answerDisplay,
    } = content;
    // 选择仅归当前题库页面会话；切库或题目集合被替换后重置，不写入备份。
    let bankQuestionSelection = { bank: null, idsKey: '', selected: new Set() };
    // 可见预览的读取只属于发起时的题库页；离页后即使返回也不能显示旧失败。
    let bankPreviewOwner = 0;
    function cancelPendingBankPreview() {
      bankPreviewOwner += 1;
    }
    function resetBankQuestionSelection() {
      bankQuestionSelection = { bank: null, idsKey: '', selected: new Set() };
    }
    // 详情 DOM 仅归预览页面所有；重绘、翻页和离开页面时移除，使旧异步复制反馈失效。
    function closeBankQuestionDetail() {
      const detail = document.getElementById('bank-question-detail');
      detail?.dispatchEvent(new Event('preview-close'));
      detail?.remove();
      document.querySelectorAll('[data-preview-question]').forEach((button) => {
        button.textContent = '查看详情';
        button.setAttribute('aria-expanded', 'false');
      });
    }
    function renderBankSelect() {
      const sel = $('#active-bank-select');
      if (!sel) {
        return;
      }
      const old = state.activeBankId;
      sel.innerHTML = state.banks.map((b) => `<option value="${esc(b.id)}">${esc(bankPathLabelV58(b))}（${b.questions.length}题）</option>`).join('');
      sel.value = old || state.activeBankId;
    }
    function renderMergeSelect() {
      const sel = $('#merge-bank-select');
      if (!sel) {
        return;
      }
      const current = state.activeBankId;
      sel.innerHTML = state.banks.filter((b) => b.id !== current).map((b) => `<option value="${esc(b.id)}">${esc(bankPathLabelV58(b))}（${b.questions.length}题）</option>`).join('') || '<option value="">暂无可合并题库</option>';
    }
    function renderBankInputs() {
      ensureBankGroupUiV58();
      const b = activeBank();
      const inp = $('#bank-rename-input');
      if (inp && !inp.value) {
        // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
        inp.placeholder = '当前：' + (b.name || '未命名题库');
      }
      const groupInput = $('#bank-group-rename-input-v58');
      if (groupInput) {
        groupInput.placeholder = `当前：${bankGroupNameV58(b)}`;
        if (!groupInput.dataset.lastBankIdV58 || groupInput.dataset.lastBankIdV58 !== b.id) {
          groupInput.value = normalizeBankGroupNameV58(b.groupName);
          groupInput.dataset.lastBankIdV58 = b.id || '';
        }
      }
      renderBankGroupDatalistV58();
    }
    function renderBankList() {
      ensureBankGroupUiV58();
      ensurePracticeScopeV8916();
      const box = $('#bank-list');
      let banks = [...state.banks];
      const sort = $('#bank-sort-mode')?.value || 'created';
      if (sort === 'name') {
        banks.sort((a, b) => `${bankGroupNameV58(a)} ${a.name}`.localeCompare(`${bankGroupNameV58(b)} ${b.name}`, 'zh-CN'));
      } else if (sort === 'count') {
        banks.sort((a, b) => b.questions.length - a.questions.length || bankPathLabelV58(a).localeCompare(bankPathLabelV58(b), 'zh-CN'));
      } else {
        banks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || bankPathLabelV58(a).localeCompare(bankPathLabelV58(b), 'zh-CN'));
      }
      const validIds = new Set(state.banks.map((b) => b.id));
      banks = nativePage(banks, `banks:${sort}`, box, renderBankList);
      setExportSelection(new Set([...getExportSelection()].filter((id) => validIds.has(id))));
      if (!banks.length) {
        box.innerHTML = '<p class="muted">暂无题库。</p>';
        renderBankToolbarV28();
        renderExportBankSummaryV23();
        return;
      }
      const scope = practiceScopeV8916();
      const groups = new Map();
      banks.forEach((b) => {
        const g = bankGroupNameV58(b);
        if (!groups.has(g)) {
          groups.set(g, []);
        }
        groups.get(g).push(b);
      });
      box.innerHTML = [...groups.entries()].map(([groupName, items]) => {
        const groupBanks = state.banks.filter((b) => bankGroupNameV58(b) === groupName);
        const total = groupBanks.reduce((n, b) => n + (b.questions?.length || 0), 0);
        const groupActive = scope.type === PRACTICE_SCOPE_GROUP_V8916 && scope.value === groupName;
        const body = items.map((b) => {
          const stats = countTypes(b.questions);
          const active = b.id === state.activeBankId;
          const bankScope = scope.type === PRACTICE_SCOPE_BANK_V8916 && scope.value === b.id;
          const checked = getExportSelection().has(b.id);
          return `<article class="bank-item bank-item-compact-v28 ${active ? 'active-bank' : ''} ${checked ? 'selected-bank-v28' : ''}">
        <label class="bank-bulk-check-v23 bank-card-check-v28" title="选择题库"><input type="checkbox" data-bank-bulk-v23="${esc(b.id)}" ${checked ? 'checked' : ''}></label>
        <div class="bank-card-main-v28"><div class="bank-card-title-v28"><b>${esc(b.name)}</b>${active ? '<span class="source-badge">当前题库</span>' : ''}${bankScope ? '<span class="practice-scope-badge-v8916">练习范围</span>' : ''}</div><p class="muted bank-card-meta-v28">${b.questions.length}题｜单选${stats.single}｜多选${stats.multiple + stats.multi}｜判断${stats.judge}｜填空${stats.blank}｜简答${stats.short}｜创建 ${fmt(b.createdAt || now())}</p></div>
        <div class="bank-card-actions-v33"><button class="ghost mini-btn" data-openbank="${esc(b.id)}" type="button">${active && bankScope ? '当前' : '设为当前'}</button><details class="bank-more-menu-v28"><summary aria-label="更多题库操作">更多</summary><div class="bank-more-panel-v28"><button class="ghost" data-editbank-v45="${esc(b.id)}" type="button">编辑 / 移动分组</button><button class="ghost" data-copybank="${esc(b.id)}" type="button">复制</button><button class="ghost" data-exportbank="${esc(b.id)}" type="button">导出该题库 JSON</button></div></details><button class="ghost danger mini-btn bank-delete-quick-v32" data-delbank="${esc(b.id)}" type="button" title="删除该题库">删除</button></div>
      </article>`;
        }).join('');
        return `<section class="bank-group-section-v58 ${groupActive ? 'practice-group-active-v8916' : ''}"><div class="bank-group-head-v58"><div><b>${esc(groupName)}</b><span class="bank-group-badge-v58">一级分组</span>${groupActive ? '<span class="practice-scope-badge-v8916">当前练习范围</span>' : ''}</div><div class="bank-group-actions-v8916"><span class="muted">${groupBanks.length} 个题库｜${total} 题</span><button class="ghost mini-btn" data-practice-group-v8916="${esc(groupName)}" type="button">${groupActive ? '已设为练习范围' : '设为练习范围'}</button></div></div><div class="bank-group-list-v58">${body}</div></section>`;
      }).join('');
      $$('[data-bank-bulk-v23]').forEach((x) => x.onchange = () => {
        const id = x.dataset.bankBulkV23;
        if (!canSelectExportBanks() || !box.contains(x) || !state.banks.some((bank) => bank.id === id)) {
          x.checked = getExportSelection().has(id);
          return;
        }
        if (x.checked) {
          getExportSelection().add(id);
        } else {
          getExportSelection().delete(id);
        }
        x.closest('.bank-item')?.classList.toggle('selected-bank-v28', x.checked);
        renderExportBankSummaryV23();
      });
      $$('[data-openbank]').forEach((x) => x.onclick = async () => runMutation(async () => {
        setPracticeBankScopeV8916(x.dataset.openbank, true);
        await saveSilent();
        renderAll();
      }));
      $$('[data-practice-group-v8916]').forEach((x) => x.onclick = async () => runMutation(async () => {
        if (setPracticeGroupScopeV8916(x.dataset.practiceGroupV8916)) {
          await saveSilent();
          renderAll();
          toast(`已将“${x.dataset.practiceGroupV8916}”设为当前练习范围。`, 'ok');
        }
      }));
      $$('[data-editbank-v45]').forEach((x) => x.onclick = () => editBankByIdV45(x.dataset.editbankV45, x));
      $$('[data-copybank]').forEach((x) => x.onclick = () => duplicateBankById(x.dataset.copybank));
      $$('[data-exportbank]').forEach((x) => x.onclick = () => exportBankById(x.dataset.exportbank));
      $$('[data-delbank]').forEach((x) => x.onclick = () => deleteBanksV32([x.dataset.delbank]));
      renderBankToolbarV28();
      renderExportBankSummaryV23();
    }
    function renderBankToolbarV28() {
      const sel = $('#bank-current-select-v28');
      if (!sel) {
        return;
      }
      const old = state.activeBankId;
      sel.innerHTML = state.banks.map((b) => `<option value="${esc(b.id)}">${esc(bankPathLabelV58(b))}（${b.questions.length}题）</option>`).join('') || '<option value="">暂无题库</option>';
      sel.value = old || state.activeBankId || '';
    }
    async function renderBankPreview() {
      const bank = activeBank(); const idsKey = JSON.stringify(bank.questions.map((q) => q.id));
      if (bankQuestionSelection.bank !== bank || bankQuestionSelection.idsKey !== idsKey) {
        bankQuestionSelection = { bank, idsKey, selected: new Set() };
      }
      if (!nativeViewVisible('banks')) {
        return;
      }
      closeBankQuestionDetail();
      const renderVersion = beginNativeRender('banks');
      const owner = bankPreviewOwner;
      const startedVisible = !!$('#banks')?.classList.contains('active');
      const isCurrentRead = () => renderVersion === nativeRenderVersions.get('banks') && activeBank().id === bank.id
        && (!startedVisible || (owner === bankPreviewOwner && $('#banks')?.classList.contains('active')));
      // eslint-disable-next-line prefer-template -- 历史数据字段可能是对象，保留 + 的默认转换；字段类型受约束后移除此例外。
      const qs = nativePage(bank.questions, 'preview:' + bank.id, document.getElementById('bank-preview'), renderBankPreview);
      $('#bank-preview tbody').innerHTML = '<tr><td colspan="8" role="status">正在加载题目……</td></tr>';
      for (const id of ['select-bank-question-page', 'clear-bank-question-selection', 'delete-selected-questions']) {
        document.getElementById(id).disabled = true;
      }
      if (!await loadNativeItems(practiceSessionItemsForBanksV8916([{ ...bank, questions: qs }]), isCurrentRead)) {
        if (!isCurrentRead()) {
          return;
        }
        $('#bank-preview tbody').innerHTML = '<tr><td colspan="8" role="status">题目加载失败，请重试。 <button type="button" id="retry-bank-preview">重试</button></td></tr>';
        $('#retry-bank-preview').onclick = renderBankPreview;
        return;
      }
      if (!isCurrentRead() || !nativeViewVisible('banks')) {
        return;
      }
      const { selected } = bankQuestionSelection;
      $('#bank-preview tbody').innerHTML = qs.map((q) => {
        const number = bank.questions.indexOf(q) + 1; const preview = bankQuestionCopyText(q);
        return `<tr><td><input type="checkbox" data-select-bank-question="${esc(q.id)}" aria-label="选择第 ${number} 道试题" ${selected.has(q.id) ? 'checked' : ''}></td><td>${number}</td><td>${label(q.type)}</td><td>${esc(short(preview.text, 80))}${preview.text.length > 80 ? ` <button class="ghost mini-btn" type="button" data-preview-full="${esc(q.id)}" aria-label="查看第 ${number} 道试题全文">查看全文</button>` : ''}${preview.hasImages ? ' <span class="muted">含图片</span>' : ''}</td><td>${esc((q.answer || q.answerKeys || []).join(''))}</td><td>${esc(q.category || q.topic || '')}</td><td>${esc(q.score || '默认')}</td><td><button class="ghost mini-btn" type="button" data-preview-question="${esc(q.id)}" aria-expanded="false" aria-controls="bank-question-detail" aria-label="查看第 ${number} 道试题详情">查看详情</button> <button class="ghost danger mini-btn" type="button" data-delete-bank-question="${esc(q.id)}" aria-label="删除第 ${number} 道试题">删除</button></td></tr>`;
      }).join('') || '<tr><td colspan="8" class="empty">当前题库暂无试题。</td></tr>';
      $('#bank-preview').querySelectorAll('[data-preview-question]').forEach((button) => button.onclick = () => openBankQuestionDetail(bank, qs.find((q) => q.id === button.dataset.previewQuestion), button, false));
      $('#bank-preview').querySelectorAll('[data-preview-full]').forEach((button) => button.onclick = () => openBankQuestionDetail(bank, qs.find((q) => q.id === button.dataset.previewFull), button, true));
      const updateSelection = () => {
        $('#bank-question-selection').textContent = `已选择 ${selected.size} 道试题`;
        $('#bank-question-selection').hidden = selected.size === 0;
        $('#delete-selected-questions').disabled = !selected.size;
        $('#clear-bank-question-selection').disabled = !selected.size;
        $('#select-bank-question-page').disabled = !qs.length;
        $$('[data-select-bank-question]').forEach((input) => {
          input.checked = selected.has(input.dataset.selectBankQuestion);
        });
      };
      $$('[data-select-bank-question]').forEach((input) => input.onchange = () => {
        if (input.checked) {
          selected.add(input.dataset.selectBankQuestion);
        } else {
          selected.delete(input.dataset.selectBankQuestion);
        }
        updateSelection();
      });
      $$('[data-delete-bank-question]').forEach((button) => button.onclick = () => deleteBankQuestions(bank.id, [button.dataset.deleteBankQuestion]));
      $('#select-bank-question-page').onclick = () => {
        qs.forEach((q) => selected.add(q.id));
        updateSelection();
      };
      $('#clear-bank-question-selection').onclick = () => {
        selected.clear();
        updateSelection();
      };
      $('#delete-selected-questions').onclick = () => deleteBankQuestions(bank.id, [...selected]);
      updateSelection();
    }
    function bankQuestionPreview(q) {
      const rich = q.richContent; const fields = rich?.fields || rich; const field = fields?.question;
      const candidates = typeof field === 'string' ? [field] : [field?.text, field?.markdown, field?.sourceText, field?.fallbackText, field?.plainText];
      candidates.push(q.question);
      const question = stripUnsafeImageDataUrisV83(String(candidates.find((value) => value != null && String(value).trim()) || ''));
      const options = Array.isArray(q.options) ? q.options.map((option, index) => ({ ...option, text: pickRichOptionTextV57(q, index, option) })) : [];
      return repairCircledCombinationQuestion({ ...q, question, options });
    }
    function bankQuestionPreviewSource(q) {
      return bankQuestionPreview(q).question;
    }
    function bankQuestionCopyText(q) {
      const seen = new Set();
      let hasImages = false;
      const imageText = (src, description) => {
        hasImages = true;
        seen.add(src);
        const safe = String(description || '').replace(/(?:data:|file:|https?:|[a-z]:[\\/])\S*/gi, '').trim();
        return safe ? `[图片：${safe}]` : '[图片]';
      };
      let text = String(bankQuestionPreviewSource(q)).replace(/!\[([^\]]*)\]\(([^\n]*?)\)/g, (_, alt, src) => imageText(src, alt));
      text = text.replace(/【DOCX表格开始】[\s\S]*?【DOCX表格结束】/g, (block) => parseDocxMarkdownTableBlockV55(block).map((row) => row.join('\t')).join('\n'));
      // 只解析惰性模板；先移除图片来源，再取文字，避免复制内部媒体路径或执行导入内容。
      text = text.replace(/```[\s\S]*?```/g, (block) => esc(block));
      text = text.replace(/<img\b[^>]*>/gi, (tag) => {
        const alt = tag.match(/\balt=["']([^"']*)["']/i);
        return imageText('', alt?.[1] || '');
      });
      text = text.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li|tr)>/gi, '\n').replace(/<\/(?:td|th)>\s*(?=<(?:td|th)\b)/gi, '\t');
      if (/<\/?[a-z][^>]*>|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(text)) {
        const template = document.createElement('template');
        template.innerHTML = text;
        template.content.querySelectorAll('script,style,iframe,object').forEach((node) => node.remove());
        text = template.content.textContent || '';
      }
      text = text.replace(/data:image\/[^\s)]+/gi, () => imageText('', ''));
      for (const img of normalizeQuestionImagesForWebV83(q.images)) {
        const src = img.dataUrl || img.localPath;
        if (!seen.has(src)) {
          text += `\n${imageText(src, img.sourceName)}`;
        }
      }
      return { text, hasImages };
    }
    function openBankQuestionDetail(bank, q, trigger, full) {
      if (!q || activeBank() !== bank) {
        return;
      }
      const row = trigger.closest('tr'); const table = trigger.closest('table'); const button = row.querySelector('[data-preview-question]');
      const favorite = table.id === 'favorites-list-v596';
      const current = document.getElementById('bank-question-detail');
      if (current?.previousElementSibling === row) {
        if (full) {
          current.querySelector('h3').focus();
          current.querySelector('h3').scrollIntoView({ block: 'nearest' });
        } else {
          closeBankQuestionDetail();
          button.focus();
        }
        return;
      }
      closeBankQuestionDetail();
      const preview = bankQuestionPreview(q); const copy = bankQuestionCopyText(q); const answers = q.answer || q.answerKeys || []; const { options } = preview;
      const type = normalizeWebQuestionType(q.type);
      let empty = '该题暂无选项，请检查题库内容';
      if (type === 'judge') {
        empty = '该判断题未提供独立选项';
      }
      if (type === 'blank' || type === 'short') {
        empty = '该题型无需选项';
      }
      const detail = document.createElement('tr');
      detail.id = 'bank-question-detail';
      detail.innerHTML = `<td colspan="${table.tHead.rows[0].cells.length}"><section class="bank-detail" aria-labelledby="bank-detail-title"><div class="bank-detail-toolbar"><h3 id="bank-detail-title" tabindex="-1">完整题干${favorite ? ` <span class="pill">题库第 ${bank.questions.indexOf(q) + 1} 题</span>` : ''}</h3><div><button type="button" class="ghost mini-btn" data-copy-question>复制题干</button> <button type="button" class="ghost mini-btn" data-close-detail>收起详情</button></div></div><div class="bank-detail-status" role="status" aria-live="polite"></div><div class="bank-detail-body">${copy.text.trim() ? renderQuestionBodyV83(preview) : '暂无题干'}</div><h4>选项</h4>${options.map((o) => {
        const matches = answers.includes(o.key) && options.filter((item) => item.key === o.key).length === 1;
        return `<div class="bank-detail-option${matches ? ' is-answer' : ''}"><b>${esc(o.key)}</b><div>${o.text ? renderQuestionContent(o.text) : '选项内容为空'}</div>${matches ? '<span>已存答案</span>' : ''}</div>`;
      }).join('')}${!options.length ? `<p class="muted">${empty}</p>` : ''}<p><b>已存答案：</b>${esc(answers.length ? answerDisplay(answers) : '未提供答案')}</p>${favorite && q.analysis ? `<div class="bank-detail-analysis"><b>解析：</b>${renderQuestionContent(q.analysis)}</div>` : ''}<div class="bank-manual-copy" hidden><label for="bank-question-manual-copy">完整题干纯文本</label><textarea id="bank-question-manual-copy" readonly></textarea><button type="button" class="ghost mini-btn" data-select-copy>全选文本</button> <button type="button" class="ghost mini-btn" data-hide-copy>收起手动复制区</button></div></section></td>`;
      row.after(detail);
      // 表格横向滚动容器会限制 CSS sticky，工具栏只在本详情范围内平移，并随关闭释放监听。
      const toolbar = detail.querySelector('.bank-detail-toolbar');
      const moveToolbar = () => {
        detail.querySelector('.bank-detail').style.width = `${table.parentElement.clientWidth}px`;
        toolbar.style.transform = '';
        const bounds = detail.getBoundingClientRect(); const bar = toolbar.getBoundingClientRect();
        const topbar = document.querySelector('.topbar'); const topBounds = topbar?.getBoundingClientRect();
        const fixedTop = topbar && ['fixed', 'sticky'].includes(window.getComputedStyle(topbar).position) && topBounds.bottom > 0 ? topBounds.bottom : 0;
        const offset = Math.max(0, Math.min(fixedTop + 8 - bar.top, bounds.bottom - bar.bottom - 8));
        toolbar.style.transform = `translateY(${offset}px)`;
      };
      document.addEventListener('scroll', moveToolbar, true);
      window.addEventListener('resize', moveToolbar);
      detail.addEventListener('preview-close', () => {
        document.removeEventListener('scroll', moveToolbar, true);
        window.removeEventListener('resize', moveToolbar);
      }, { once: true });
      moveToolbar();
      button.textContent = '收起';
      button.setAttribute('aria-expanded', 'true');
      const copyButton = detail.querySelector('[data-copy-question]'); const status = detail.querySelector('[role="status"]'); const manual = detail.querySelector('.bank-manual-copy'); const field = detail.querySelector('textarea');
      field.value = copy.text;
      copyButton.disabled = !copy.text.trim();
      if (copy.hasImages) {
        status.textContent = '复制文字，图片以占位说明保留';
      }
      detail.querySelector('[data-close-detail]').onclick = () => {
        closeBankQuestionDetail();
        button.focus();
        button.scrollIntoView({ block: 'nearest' });
      };
      detail.querySelector('[data-select-copy]').onclick = () => {
        field.focus();
        field.select();
      };
      detail.querySelector('[data-hide-copy]').onclick = () => {
        manual.hidden = true;
        copyButton.focus();
      };
      copyButton.onclick = async () => {
        try {
          await navigator.clipboard.writeText(copy.text);
          if (!detail.isConnected) {
            return;
          }
          status.textContent = copy.hasImages ? '已复制题干文字（图片为占位说明）' : '已复制完整题干';
          copyButton.textContent = '已复制';
          setTimeout(() => {
            if (detail.isConnected) {
              copyButton.textContent = '复制题干';
            }
          }, 1800);
        } catch {
          if (!detail.isConnected) {
            return;
          }
          status.textContent = '自动复制失败，请选中文本后按 Ctrl+C，或使用系统复制菜单';
          manual.hidden = false;
          field.focus();
          field.select();
        }
      };
      detail.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.textContent = `图片加载失败：${img.alt || '题目图片'}`;
        img.replaceWith(fallback);
      }, { once: true }));
      if (full) {
        detail.querySelector('h3').focus();
        detail.querySelector('h3').scrollIntoView({ block: 'nearest' });
      }
    }
    return { closeBankQuestionDetail, renderBankSelect, renderMergeSelect, renderBankInputs, renderBankList, renderBankToolbarV28, renderBankPreview, bankQuestionCopyText, openBankQuestionDetail, resetBankQuestionSelection, cancelPendingBankPreview };
  }
  globalThis.ShirohaBankPage = { create };
})();
