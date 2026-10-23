// @ts-check
(function () {
  'use strict';
  /** @param {{write(snapshot: import('./contracts').Snapshot, id: string, revision: number): Promise<{revision:number}>, revision():number}} storage */
  function create(storage) {
    // 队列归当前页面所有；失败阻断后继提交，只有用户显式重试才恢复。
    let tail = Promise.resolve();
    let blocked = false;
    let pending = 0;
    let sequence = 0;
    const prefix = Date.now().toString(36) + Math.random().toString(36).slice(2);
    return {
      /** @param {import('./contracts').Snapshot} snapshot @param {string} [operationId] */
      save(snapshot, operationId) {
        const frozen = structuredClone(snapshot);
        const id = operationId || `${prefix}-${++sequence}`;
        pending++;
        const next = tail.then(async () => {
          if (blocked) throw new Error('前一次保存失败，请先重试。');
          try { await storage.write(frozen, id, storage.revision()); }
          catch (error) { blocked = true; throw error; }
        }).finally(() => { pending--; });
        tail = next.catch(() => {});
        return next;
      },
      resume() { if (pending) throw new Error('保存仍在进行。'); blocked = false; },
      status() { return { state: pending ? 'pending' : blocked ? 'failed' : 'saved', revision: storage.revision() }; },
      async idle() { await tail; },
    };
  }
  const api = { create };
  /** @type {typeof globalThis & {ShirohaSaveQueue?: typeof api}} */ (globalThis).ShirohaSaveQueue = api;
})();
