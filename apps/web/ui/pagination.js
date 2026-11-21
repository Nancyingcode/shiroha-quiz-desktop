// Web 与桌面共用分页控件，页面继续负责读取和渲染当前页的数据。
(() => {
  'use strict';

  const { listPageNumbers, listPageRange } = globalThis.ShirohaQuizCore;
  const i18n = globalThis.ShirohaI18n;
  const PAGE_SIZES = [10, 20, 50, 100];

  // 保留可访问名称和控件标识，以便页面重绘时恢复焦点。
  function addPageButton(group, copy, {
    text,
    labelKey,
    labelValues,
    control,
    disabled = false,
    current = false,
    activate,
  }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.className = 'list-page-button';
    copy.bindAttribute(button, 'aria-label', labelKey, labelValues);
    button.dataset.pageControl = control;
    button.disabled = disabled;
    if (current) {
      button.setAttribute('aria-current', 'page');
    }

    button.onclick = activate;
    group.appendChild(button);
  }

  // 容器宽度决定显示哪组页码；窄卡片（含桌面侧栏布局）也保留首末页与键盘入口。
  function renderPageNumbers(actions, page, pages, changePage, copy) {
    for (const compact of [false, true]) {
      const group = document.createElement('div');
      group.className = `list-page-numbers ${compact ? 'is-compact' : 'is-wide'}`;
      actions.appendChild(group);
      addPageButton(group, copy, {
        text: '‹', labelKey: 'pagination.previous', control: 'previous', disabled: page === 0, activate: () => changePage(page - 1),
      });
      for (const number of listPageNumbers(page + 1, pages, compact)) {
        if (number === 'ellipsis') {
          const gap = document.createElement('span');
          gap.className = 'list-page-gap';
          gap.textContent = '…';
          gap.setAttribute('aria-hidden', 'true');
          group.appendChild(gap);
        } else {
          const index = number - 1;
          addPageButton(group, copy, {
            text: String(number),
            labelKey: 'pagination.page',
            labelValues: { number },
            control: `page:${index}`,
            current: page === index,
            activate: () => changePage(index),
          });
        }
      }

      addPageButton(group, copy, {
        text: '›', labelKey: 'pagination.next', control: 'next', disabled: page === pages - 1, activate: () => changePage(page + 1),
      });
    }
  }

  // 为宽窄布局建立可切换的页码与每页条数控件，两组按钮共用翻页行为。
  function renderPageActions(controls, {
    page,
    pages,
    title,
    size,
    changePage,
    copy,
  }) {
    const actions = document.createElement('div');
    actions.className = 'list-pagination-controls';
    controls.appendChild(actions);
    renderPageNumbers(actions, page, pages, changePage, copy);

    const select = document.createElement('select');
    select.className = 'list-page-size';
    copy.bindAttribute(select, 'aria-label', 'pagination.size', { title });
    select.dataset.pageControl = 'size';
    for (const pageSize of PAGE_SIZES) {
      const option = document.createElement('option');
      option.value = String(pageSize);
      copy.bindText(option, 'pagination.sizeOption', { count: pageSize });
      select.appendChild(option);
    }

    select.value = String(size);
    select.onchange = () => changePage(0, Number(select.value));

    actions.appendChild(select);
  }

  // 分页控件放在表格外，让窄屏的表格横向滚动不遮住按钮。
  function ensureControls(target) {
    const id = `${target.id}-pager`;
    const existing = document.getElementById(id);
    if (existing) {
      return existing;
    }

    const controls = document.createElement('nav');
    controls.id = id;
    controls.className = 'list-pagination';
    const anchor = target.closest('.table-wrap') || target;
    anchor.insertAdjacentElement('afterend', controls);
    return controls;
  }

  // 宽窄布局切换或按钮变成禁用时，将焦点交给可见的当前页按钮。
  function restoreFocus(controls, focusKey) {
    if (!focusKey) {
      return;
    }

    const candidates = [...controls.querySelectorAll('[data-page-control]')]
      .filter((node) => node.getClientRects().length && !node.disabled);
    const nextFocus = candidates.find((node) => node.dataset.pageControl === focusKey)
      || candidates.find((node) => node.getAttribute('aria-current') === 'page');
    nextFocus?.focus({ preventScroll: true });
  }

  // 分页只在当前文档存活；各列表独立选择条数，切库或恢复时可以单独重置页码。
  function create() {
    const entries = new Map();

    // 结束离开视图前发起的滚动请求，页码和条数仍供返回时使用。
    function cancelPendingScrolls() {
      for (const entry of entries.values()) {
        entry.scrollRequest = null;
      }
    }

    // 切换当前库时页码归零，列表的筛选键和条数由原页面继续使用。
    function resetPages() {
      cancelPendingScrolls();
      for (const entry of entries.values()) {
        entry.page = 0;
      }
    }

    // 数据替换后旧筛选键也失效，已选择的每页条数保留到文档关闭。
    function resetAfterRestore() {
      resetPages();
      for (const entry of entries.values()) {
        entry.key = '';
      }
    }

    // 复盘按筛选结果中的位置跳题，由分页器用当前条数计算所在页。
    function goToItem(targetId, index) {
      const entry = entries.get(targetId);
      if (entry) {
        entry.page = Math.floor(index / entry.size);
        entry.scrollRequest = null;
      }
    }

    // 为分页目标维护独立的请求页和焦点，返回当前页供页面按需读取正文。
    function render(rows, key, target, renderList, localizedTitle) {
      let entry = entries.get(target.id);
      if (!entry) {
        entry = { key, page: 0, size: PAGE_SIZES[0], scrollRequest: null };
        entries.set(target.id, entry);
      }

      if (entry.key !== key) {
        entry.key = key;
        entry.page = 0;
        entry.scrollRequest = null;
      }

      const {
        page,
        pages,
        start,
        end,
      } = listPageRange(rows.length, entry.page, entry.size);
      entry.page = page;
      const controls = ensureControls(target);
      const active = document.activeElement;
      const focusKey = controls.contains(active) ? active.dataset.pageControl : null;
      const view = target.closest('.view');
      const title = localizedTitle || target.closest('.card')?.querySelector('h2')?.textContent
        || target.getAttribute('aria-label') || '列表';
      const copy = i18n;
      copy.bindAttribute(controls, 'aria-label', 'pagination.controls', { title });
      controls.replaceChildren();
      const status = document.createElement('span');
      status.className = 'list-pagination-status';
      status.setAttribute('role', 'status');
      if (rows.length) {
        copy.bindText(status, 'pagination.position', {
          page: page + 1,
          pages,
          start: start + 1,
          end,
          total: rows.length,
        });
      } else {
        copy.bindText(status, 'pagination.empty');
      }

      controls.appendChild(status);
      if (!rows.length) {
        return [];
      }

      // 重新渲染结束后，只有发起最后一次翻页的控件才能滚动列表。
      const changePage = async (next, size = entry.size) => {
        // 同页往返和恢复后可再次出现相同页码，不可复用的标记能区分这些请求。
        const request = Symbol();
        entry.scrollRequest = request;
        entry.page = next;
        entry.size = size;
        await renderList();
        const stillCurrent = entry.scrollRequest === request && entry.page === next && target.isConnected;
        if (stillCurrent && (!view || view.classList.contains('active'))) {
          target.scrollIntoView({ block: 'start', behavior: 'instant' });
        }
      };

      renderPageActions(controls, {
        page, pages, title, size: entry.size, changePage, copy,
      });
      restoreFocus(controls, focusKey);
      return rows.slice(start, end);
    }

    return {
      render,
      resetPages,
      resetAfterRestore,
      goToItem,
      restoreFocus,
      cancelPendingScrolls,
    };
  }

  globalThis.ShirohaPagination = Object.freeze({ create });
})();
