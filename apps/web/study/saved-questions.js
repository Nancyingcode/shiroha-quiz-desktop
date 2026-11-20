// 按来源题库管理错题复习和收藏，使用应用提供的事务保存用户操作。
(() => {
  'use strict';

  const REVIEW_INTERVALS_DAYS = [1, 1, 3, 7, 14, 30, 60];
  const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

  // 新登记和只有题目 ID 的旧记录共享结构，旧记录已经答错过一次。
  function newWrongEntry(id, wrongCount) {
    return {
      id,
      wrongCount,
      rightCount: 0,
      reviewRightCount: 0,
      streakCorrectCount: 0,
      lastWrongAt: '',
      lastCorrectAt: '',
      lastReviewedAt: '',
      nextReviewAt: '',
      reviewLevel: 0,
      lastAnswer: [],
      source: 'web',
      timestamp: 0,
      status: '未掌握',
    };
  }

  // 保留导入的题目快照及扩展字段，计数可读作数字，缺失值由读取或升级入口决定。
  function normalizeWrongEntry(entry, defaultWrongCount) {
    if (typeof entry === 'string') {
      return newWrongEntry(entry, 1);
    }

    return {
      ...entry,
      id: entry.id,
      wrongCount: Number(entry.wrongCount || defaultWrongCount),
      rightCount: Number(entry.rightCount || 0),
      reviewRightCount: Number(entry.reviewRightCount || 0),
      streakCorrectCount: Number(entry.streakCorrectCount || 0),
      lastWrongAt: entry.lastWrongAt || '',
      lastCorrectAt: entry.lastCorrectAt || '',
      lastReviewedAt: entry.lastReviewedAt || '',
      nextReviewAt: entry.nextReviewAt || '',
      reviewLevel: Number(entry.reviewLevel || 0),
      lastAnswer: Array.isArray(entry.lastAnswer) ? entry.lastAnswer : [],
      source: entry.source || 'web',
      timestamp: Number(entry.timestamp || 0),
      status: entry.status || '未掌握',
    };
  }

  function normalizeWrongEntries(entries, defaultWrongCount) {
    return Array.isArray(entries)
      ? entries.map((entry) => normalizeWrongEntry(entry, defaultWrongCount)).filter((entry) => entry.id)
      : [];
  }

  function nextWrongReviewIso(level, timestamp) {
    const interval = Math.max(0, Math.min(REVIEW_INTERVALS_DAYS.length - 1, Number(level || 0)));
    const days = REVIEW_INTERVALS_DAYS[interval] || 1;
    return new Date(timestamp + (days * MILLISECONDS_PER_DAY)).toISOString();
  }

  function uniqueFavoriteIds(ids) {
    return [...new Set(ids.filter(Boolean))];
  }

  // 每次操作读取应用当前映射，备份恢复和事务回滚可替换这些数据。
  function create({
    state,
    activeBank,
    transaction: runMutation,
    confirm,
    save: saveSilent,
    renderAll,
    toast,
  }) {
    // 为错题页和复习流程统一记录结构，兼容早期只保存题目 ID 的数据。
    function getWrongEntries(bid = activeBank().id) {
      return normalizeWrongEntries(state.wrongBook[bid], 0);
    }

    function setWrongEntries(entries, bid) {
      state.wrongBook[bid] = entries;
    }

    // 再次答错时从初始复习级别排期，清零此前的连续答对次数。
    function addWrong(id, bid = activeBank().id, chosen = []) {
      const entries = getWrongEntries(bid);
      let entry = entries.find((item) => item.id === id);
      if (!entry) {
        entry = newWrongEntry(id, 0);
        entries.push(entry);
      }

      const timestamp = Date.now();
      entry.lastAnswer = [...chosen];
      entry.wrongCount += 1;
      entry.rightCount = 0;
      entry.reviewRightCount = 0;
      entry.streakCorrectCount = 0;
      entry.reviewLevel = 0;
      entry.lastWrongAt = new Date(timestamp).toISOString();
      entry.lastReviewedAt = entry.lastWrongAt;
      entry.nextReviewAt = nextWrongReviewIso(0, timestamp);
      entry.timestamp = timestamp;
      entry.source = 'web';
      entry.status = '未掌握';
      setWrongEntries(entries, bid);
    }

    // 答对只推进已有错题的复习进度，连续答对两次才标为已掌握。
    function markRight(id, bid = activeBank().id) {
      const entries = getWrongEntries(bid);
      const entry = entries.find((item) => item.id === id);
      if (!entry) {
        return;
      }

      const timestamp = Date.now();
      entry.rightCount += 1;
      entry.reviewRightCount = Number(entry.reviewRightCount || 0) + 1;
      entry.streakCorrectCount = Number(entry.streakCorrectCount || 0) + 1;
      const mastered = entry.streakCorrectCount >= 2;
      const level = Number(entry.reviewLevel || 0);
      entry.reviewLevel = mastered ? Math.max(2, level + 1) : Math.max(1, level);
      entry.lastCorrectAt = new Date(timestamp).toISOString();
      entry.lastReviewedAt = entry.lastCorrectAt;
      entry.nextReviewAt = nextWrongReviewIso(entry.reviewLevel, timestamp);
      entry.timestamp = timestamp;
      entry.status = mastered ? '已掌握' : '复习中';
      setWrongEntries(entries, bid);
    }

    // 只有在确认后才从错题本移出试题，然后持久化和更新页面。
    function removeWrong(id, bid = activeBank().id) {
      return runMutation(/* 确认和移出属于同一次事务。 */ async () => {
        if (await confirm('确定将这道题移出错题本？')) {
          setWrongEntries(getWrongEntries(bid).filter((entry) => entry.id !== id), bid);

          await saveSilent();
          renderAll();
        }
      });
    }

    // 手动掌握同时调整显示的答对次数，使筛选和复习条件保持一致。
    function toggleWrongMastery(id, bid = activeBank().id) {
      return runMutation(/* 掌握状态与答对次数随同一次保存生效。 */ async () => {
        const entries = getWrongEntries(bid);
        const entry = entries.find((item) => item.id === id);
        if (!entry) {
          return;
        }

        if (entry.status === '已掌握') {
          entry.status = '复习中';
          entry.rightCount = Math.min(entry.rightCount || 0, 1);
        } else {
          entry.status = '已掌握';
          entry.lastCorrectAt = new Date().toISOString();
          entry.rightCount = Math.max(entry.rightCount || 0, 2);
        }

        setWrongEntries(entries, bid);
        await saveSilent();
        renderAll();
      });
    }

    // 此入口只清空当前题库的错题。
    function clearCurrentWrong() {
      return runMutation(/* 确认期间锁定变更入口，避免同时写入。 */ async () => {
        if (await confirm('确定清空当前题库错题本？')) {
          setWrongEntries([], activeBank().id);
          await saveSilent();
          renderAll();
        }
      });
    }

    function getFavoriteIds(bid = activeBank().id) {
      state.favorites = state.favorites || {};
      return Array.isArray(state.favorites[bid]) ? state.favorites[bid] : [];
    }

    // 旧存档可以没有收藏元信息，写入时保留其他跨端扩展字段。
    function favoriteMetadata() {
      if (!state.crossPlatformMeta || typeof state.crossPlatformMeta !== 'object') {
        state.crossPlatformMeta = { favoriteQuestions: {} };
      }

      const existing = state.crossPlatformMeta.favoriteQuestions;
      if (!existing || typeof existing !== 'object') {
        state.crossPlatformMeta.favoriteQuestions = {};
      }

      return state.crossPlatformMeta.favoriteQuestions;
    }

    // 使当前题库的收藏 ID 和跨端收藏元数据保持同步。
    function setFavoriteIds(ids, bid) {
      state.favorites = state.favorites || {};
      const next = uniqueFavoriteIds(ids);
      state.favorites[bid] = next;
      const byBank = favoriteMetadata();
      const meta = byBank[bid] && typeof byBank[bid] === 'object' ? byBank[bid] : {};
      const wanted = new Set(next);
      for (const qid of Object.keys(meta)) {
        if (!wanted.has(qid)) {
          delete meta[qid];
        }
      }

      for (const qid of next) {
        if (!meta[qid]) {
          meta[qid] = { favoritedAt: Date.now() };
        }
      }

      byBank[bid] = meta;
    }

    function isFavorite(id, bid = activeBank().id) {
      return getFavoriteIds(bid).includes(id);
    }

    // 跨库练习按题目来源切换收藏，默认以活动题库为准。
    function toggleFavorite(id, bid = activeBank().id) {
      return runMutation(/* 保存结果与提示使用同一次读取的收藏状态。 */ async () => {
        const ids = getFavoriteIds(bid);
        const wasFavorite = ids.includes(id);
        const next = wasFavorite ? ids.filter((value) => value !== id) : [...ids, id];
        setFavoriteIds(next, bid);
        await saveSilent();
        toast(wasFavorite ? '已取消收藏。' : '已收藏题目。', 'ok');
      });
    }

    // 批量清空收藏前显示受影响的题目数量并征求确认。
    function clearCurrentFavorites() {
      return runMutation(/* 确认期间锁定变更入口，避免其间切换活动题库。 */ async () => {
        const bid = activeBank().id;
        const count = getFavoriteIds(bid).length;
        if (!count) {
          toast('当前题库暂无收藏题。', 'warn');
          return;
        }

        if (await confirm(`确定清空当前题库的 ${count} 道收藏题？`)) {
          setFavoriteIds([], bid);
          await saveSilent();
          renderAll();
          toast('已清空当前题库收藏。', 'ok');
        }
      });
    }

    // 历史对象记录至少答错过一次，升级时保留原有的缺失计数默认值。
    function upgrade() {
      state.wrongBook = state.wrongBook && typeof state.wrongBook === 'object' ? state.wrongBook : {};
      state.favorites = state.favorites && typeof state.favorites === 'object' ? state.favorites : {};
      favoriteMetadata();
      for (const bid of Object.keys(state.wrongBook)) {
        state.wrongBook[bid] = normalizeWrongEntries(state.wrongBook[bid], 1);
      }

      for (const [bid, ids] of Object.entries(state.favorites)) {
        state.favorites[bid] = Array.isArray(ids) ? uniqueFavoriteIds(ids) : [];
      }
    }

    return {
      getWrongEntries,
      addWrong,
      markRight,
      removeWrong,
      toggleWrongMastery,
      clearCurrentWrong,
      getFavoriteIds,
      isFavorite,
      toggleFavorite,
      clearCurrentFavorites,
      upgrade,
    };
  }

  globalThis.ShirohaSavedQuestions = Object.freeze({ create });
})();
