// @ts-check
// 对同一页面的快照按提交顺序写入，失败时暂停后续保存以避免覆盖数据。
(function () {
  'use strict';
  /** 创建页内队列，串行使用写入时最新的存储修订号。
   * @param {{write(snapshot: import('./contracts').Snapshot, id: string, revision: number): Promise<{revision:number}>, revision():number}} storage
   */
  function create(storage) {
    // 队列归当前页面所有；失败阻断后继提交，只有用户显式重试才恢复。
    let tail = Promise.resolve();
    let blocked = false;
    let pending = 0;
    let sequence = 0;
    const prefix = Date.now().toString(36) + Math.random().toString(36).slice(2);

    /** 每项写入在队首检查阻断状态，首个失败会阻止后继项继续提交。
     * @param {import('./contracts').Snapshot} snapshot
     * @param {string} id
     */
    async function writeSnapshot(snapshot, id) {
      if (blocked) {
        throw new Error('前一次保存失败，请先重试。');
      }

      try {
        await storage.write(snapshot, id, storage.revision());
      } catch (error) {
        blocked = true;
        throw error;
      }
    }

    return {
      /** 在入队时复制快照，之后的界面编辑不会混入这次保存。
       * @param {import('./contracts').Snapshot} snapshot
       * @param {string} [operationId]
       */
      save(snapshot, operationId) {
        const frozen = structuredClone(snapshot);
        const id = operationId || `${prefix}-${(sequence += 1)}`;
        pending += 1;
        const next = tail.then(() => writeSnapshot(frozen, id)).finally(() => {
          pending -= 1;
        });
        tail = next.catch(() => {});

        return next;
      },

      resume() {
        if (pending) {
          throw new Error('保存仍在进行。');
        }

        blocked = false;
      },

      status() {
        const idleState = blocked ? 'failed' : 'saved';
        return { state: pending ? 'pending' : idleState, revision: storage.revision() };
      },

      async idle() {
        await tail;
      },
    };
  }

  const api = { create };
  /** @type {typeof globalThis & {ShirohaSaveQueue?: typeof api}} */ (globalThis).ShirohaSaveQueue = api;
})();
