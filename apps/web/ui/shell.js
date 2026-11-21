// 管理 Web 与桌面共用的外壳布局，视图切换与练习、考试状态由调用方协调。
(() => {
  'use strict';
  const i18n = globalThis.ShirohaI18n;

  /* SHIROHA_WEB_V28_2_LAYOUT_AND_IMMERSIVE_FIX_START */
  // 切换页面时复位内容滚动，兼容不提供窗口滚动能力的宿主。
  function resetScroll() {
    try {
      const main = document.querySelector('.main');
      if (main) {
        main.scrollTop = 0;
      }

      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    } catch {
      try {
        window.scrollTo(0, 0);
      } catch { /* 部分宿主不支持滚动，导航仍应继续。 */ }
    }
  }

  // 同步当前视图对应的应用外壳属性，避免页态与侧栏布局分离。
  function updateView(viewId) {
    const current = viewId || document.querySelector('.view.active')?.id || 'dashboard';
    document.body.dataset.activeView = current;
    const topbar = document.querySelector('.topbar');
    if (topbar) {
      const hideTopbar = ['wrongbook', 'favorites', 'records', 'training-review', 'ai-settings', 'settings']
        .includes(current);
      topbar.classList.toggle('is-hidden-by-view', hideTopbar);
    }
  }

  // 导航开关的名称和按下状态跟随侧栏，即使切换由专注模式发起。
  function refreshSidebarToggle() {
    const button = document.getElementById('sidebar-toggle');
    if (!button) {
      return;
    }

    const collapsed = document.body.classList.contains('side-collapsed');
    i18n.bindText(button, collapsed ? 'nav.expand' : 'nav.collapse');
    i18n.bindAttribute(button, 'aria-label', collapsed ? 'nav.expandLabel' : 'nav.collapseLabel');
    button.setAttribute('aria-pressed', String(collapsed));
  }

  // 按当前专注页面的布局测量答题栏顶部，避免切页或窗口变化后遮挡内容。
  function syncFocusRailTop() {
    const isPractice = document.body.classList.contains('practice-focus');
    const isExam = document.body.classList.contains('exam-focus');
    let card = null;
    let rail = null;
    if (isPractice) {
      card = document.getElementById('practice-card');
      rail = document.querySelector('#practice-card > .practice-side-v31');
    } else if (isExam) {
      card = document.getElementById('exam-card');
      rail = document.querySelector('#exam-card > .exam-side-v31');
    }

    if (!card || !rail) {
      return;
    }

    if (window.innerWidth < 1280) {
      rail.style.removeProperty('top');
      rail.style.removeProperty('max-height');
      return;
    }

    const top = Math.max(12, Math.round(card.getBoundingClientRect().top));
    rail.style.setProperty('top', `${top}px`, 'important');
    rail.style.setProperty('max-height', `calc(100vh - ${top + 18}px)`, 'important');
  }

  // 实例与文档同寿命，恢复业务数据时继续使用同一份侧栏和答题栏监听。
  function create({ preferences, status }) {
    let focusRailSyncBound = false;

    // 侧栏状态与按钮同步，只有调用者显式请求时才保存偏好。
    function setSidebarCollapsed(collapsed, persist = false) {
      document.body.classList.toggle('side-collapsed', !!collapsed);
      if (persist) {
        try {
          preferences.setSidebar(document.body.classList.contains('side-collapsed'));
        } catch {
          status('侧栏设置保存失败，请检查浏览器存储权限。', true);
        }
      }

      refreshSidebarToggle();
    }

    // 进入专注练习时自动收起展开的侧栏，记录是否由入口自动改变。
    function collapseSidebarForFocus() {
      if (!document.body.classList.contains('side-collapsed')) {
        document.body.dataset.focusAutoCollapsedV47 = '1';
        setSidebarCollapsed(true, false);
      } else {
        delete document.body.dataset.focusAutoCollapsedV47;
        refreshSidebarToggle();
      }
    }

    // 离开专注状态时只还原自动收起的侧栏，保留用户自己的选择。
    function restoreSidebarAfterFocus() {
      if (document.body.dataset.focusAutoCollapsedV47 === '1') {
        setSidebarCollapsed(false, false);
        delete document.body.dataset.focusAutoCollapsedV47;
      } else {
        refreshSidebarToggle();
      }
    }

    // 初始化可折叠侧栏及持久化偏好，多次装配时保持单一控件。
    function bindSidebar() {
      if (document.getElementById('sidebar-toggle')) {
        return;
      }

      const button = document.createElement('button');
      button.id = 'sidebar-toggle';
      button.type = 'button';
      button.className = 'sidebar-toggle';
      document.body.appendChild(button);
      const stored = preferences.sidebar();
      setSidebarCollapsed(stored, false);
      button.onclick = () => {
        delete document.body.dataset.focusAutoCollapsedV47;
        setSidebarCollapsed(!document.body.classList.contains('side-collapsed'), true);
      };

      refreshSidebarToggle();
    }

    // 全局只绑定一次专注栏重算监听，供滚动和窗口尺寸变化共用。
    function setupFocusRailSync() {
      if (focusRailSyncBound) {
        return;
      }

      focusRailSyncBound = true;
      let ticking = false;
      // 让多个布局事件在同一动画帧合并，避免重复测量。
      const schedule = () => {
        if (ticking) {
          return;
        }

        ticking = true;
        window.requestAnimationFrame(() => {
          ticking = false;
          syncFocusRailTop();
        });
      };

      window.addEventListener('resize', schedule, { passive: true });
      window.addEventListener('scroll', schedule, { passive: true });
    }

    // 只切换按钮所属的答题栏，再同步该栏的位置。
    function toggleRail(kind) {
      if (kind === 'practice') {
        document.body.classList.toggle('practice-rail-collapsed-v34');
      }

      if (kind === 'exam') {
        document.body.classList.toggle('exam-rail-collapsed-v34');
      }

      syncFocusRailTop();
    }

    // 绑定各专注页自己的答题栏按钮，并确保尺寸监听已启用。
    function bindRail() {
      setupFocusRailSync();
      // 给练习与考试按钮保留不同的收起状态来源。
      document.querySelectorAll('[data-rail-toggle-v34]').forEach((button) => {
        button.onclick = () => toggleRail(button.dataset.railToggleV34);
      });

      syncFocusRailTop();
      window.requestAnimationFrame(syncFocusRailTop);
      setTimeout(syncFocusRailTop, 80);
    }

    return {
      bindSidebar,
      collapseSidebarForFocus,
      restoreSidebarAfterFocus,
      bindRail,
      updateView,
      resetScroll,
    };
  }
  /* SHIROHA_WEB_V28_2_LAYOUT_AND_IMMERSIVE_FIX_END */

  globalThis.ShirohaShell = Object.freeze({ create });
})();
