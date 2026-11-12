import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
/** @param {object} scope @returns {{storage:{initialize():Promise<{state:string,error?:Error & {code?:string}}>,write(data:unknown,id:string,revision:number):Promise<unknown>,revision():number,getOperation(id:string):Promise<{revision:number}>}}} */
function platform(scope) { return vm.runInNewContext('ShirohaPlatform', scope); }

test('复盘正文惰性读取与释放保留轻量摘要，重读不产生写入', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const metadata = { version: 1, completion: 'ended_early', submitMode: 'single', timing: 'active', unanswered: 1 };
  const full = { id: 'training', reviewSummary: metadata, review: { version: 1, items: [{ question: { id: 'old', question: '历史正文' } }] }, details: [] };
  const index = { schemaVersion: 1, banks: [], records: [{ id: 'training', reviewSummary: metadata }], settings: {}, wrongBook: {}, favorites: {}, crossPlatformMeta: {}, activeBankId: '' };
  let detailReads = 0;
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */command, /** @type {{query?:{kind:string}}} */args) => {
        if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
        if (args?.query?.kind === 'summary') { return { revision: 1, snapshot: globalThis.structuredClone(index) }; }
        if (args?.query?.kind === 'details') { detailReads += 1;return [globalThis.structuredClone(full)]; }
        assert.fail(`只读复盘不应写入：${command}`);
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  await storage.initialize();const view = await storage.read();assert(view);
  await storage.ensureRecords?.(view, ['training']);
  assert(view.records[0].review);
  storage.releaseView?.(view, []);
  assert.equal(view.records[0].review, undefined);
  assert.deepEqual(globalThis.structuredClone(view.records[0].reviewSummary), metadata);
  await storage.ensureRecords?.(view, ['training']);
  assert.equal(detailReads, 2);
  assert(view.records[0].review);
});

for (const [code, expected] of /** @type {Array<[string,RegExp]>} */ ([
  ['storage_in_use', /其他 Shiroha Quiz 窗口.*原数据已保留.*关闭其他 Shiroha Quiz 窗口后重试/],
  ['permission_denied', /当前窗口.*本地访问.*未授权.*原数据已保留.*重新启动正确的 Shiroha Quiz 桌面程序/],
  ['corrupt_data', /本地数据校验失败.*原数据已保留.*恢复副本/],
  ['unsupported_version', /不支持此本地数据版本.*原数据已保留.*支持该版本/],
])) {
  test(`原生初始化 ${code} 显示可操作的安全提示并保持禁止写入`, async () => {
    const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
    /** @type {string[]} */ const calls = [];
    const scope = {
      ShirohaDesktopHost: {
        invoke: async (/** @type {string} */ command) => {
          calls.push(command);
          throw { code, message: 'fixture-secret-do-not-display', details: 'private-fixture-path' };
        },
      },
      ShirohaBrowser: {},
      ShirohaBrowserCredentials: {},
      ShirohaSaveQueue: { create: () => ({}) },
      localStorage: { getItem: () => null, setItem: () => assert.fail('browser write') },
      structuredClone: globalThis.structuredClone,
    };
    vm.runInNewContext(source, scope);
    const result = await platform(scope).storage.initialize();
    assert.equal(result.state, 'recovery_required');
    assert.equal(result.error?.code, code);
    assert.match(result.error?.message || '', expected);
    assert.doesNotMatch(result.error?.message || '', /fixture-secret|private-fixture-path|端口/);
    await assert.rejects(platform(scope).storage.write({}, 'blocked', 0), /尚未就绪/);
    assert.deepEqual(calls, ['local_initialize']);
  });
}

for (const code of ['unknown_failure', 'constructor', 'toString', '__proto__']) {
  test(`未知原生错误 ${code} 仅显示固定提示，不显示底层秘密`, async () => {
    const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
    const scope = {
      ShirohaDesktopHost: { invoke: async () => { throw { code, message: 'fixture-secret-do-not-display' }; } },
      ShirohaBrowser: {},
      ShirohaBrowserCredentials: {},
      ShirohaSaveQueue: { create: () => ({}) },
      localStorage: { getItem: () => null },
      structuredClone: globalThis.structuredClone,
    };
    vm.runInNewContext(source, scope);
    const result = await platform(scope).storage.initialize();
    assert.equal(result.state, 'recovery_required');
    assert.equal(result.error?.message, '本地操作未完成，原数据已保留。请检查权限、空间或重新启动。');
  });
}

test('恢复查询访问被拒绝时不套用启动窗口未授权提示', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */ command) => {
        assert.equal(command, 'local_query');
        throw { code: 'permission_denied', message: 'fixture-secret-do-not-display' };
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  assert(storage.recoverySnapshots);
  await assert.rejects(storage.recoverySnapshots(), {
    code: 'permission_denied',
    message: '本地操作未完成，原数据已保留。请检查权限、空间或重新启动。',
  });
});

test('desktop storage fails closed without the native bridge and never writes browser storage', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const scope = {
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null, setItem: () => assert.fail('browser write') },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const result = await platform(scope).storage.initialize();
  assert.equal(result.state, 'recovery_required');
  await assert.rejects(platform(scope).storage.write({}, 'one', 0));
});

test('native revisions and durable operation receipts drive the existing save queue', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  /** @type {Array<[string, unknown]>} */ const calls = [];
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */ name, /** @type {unknown} */ args) => {
        calls.push([name, args]);
        if (name === 'local_initialize') { return { revision: 7, hasData: true }; }
        if (name === 'local_read') { return { schemaVersion: 1, banks: [], records: [] }; }
        if (name === 'local_write') { return { revision: 8 }; }
        if (name === 'local_operation') { return { revision: 8 }; }
        throw new Error('unexpected command');
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  assert.equal((await platform(scope).storage.initialize()).state, 'ready');
  assert.equal(platform(scope).storage.revision(), 7);
  await platform(scope).storage.write({ schemaVersion: 1, banks: [], records: [] }, 'op', 7);
  assert.equal(platform(scope).storage.revision(), 8);
  assert.equal((await platform(scope).storage.getOperation('op')).revision, 8);
  assert.equal(calls[1][0], 'local_write');
});

test('learning-only edits send changes without copying unchanged question images', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const snapshot = { schemaVersion: 1, banks: [{ id: 'b', name: 'bank', questions: [{ id: 'q', question: 'large-image-payload', type: 'single', answer: [], options: [] }] }], records: [], favorites: {}, wrongBook: {}, settings: {}, activeBankId: 'b', crossPlatformMeta: {} };
  /** @type {Array<[string,unknown]>} */const calls = [];
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */name, /** @type {unknown} */args) => {
        calls.push([name, args]);if (name === 'local_initialize') { return { revision: 1, hasData: true }; } if (name === 'local_query') { return { revision: 1, snapshot }; } return { revision: 2 };
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {{initialize():Promise<unknown>,read():Promise<unknown>,write(snapshot:unknown,id:string,revision:number):Promise<unknown>}} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  await storage.initialize();await storage.read();
  const next = globalThis.structuredClone(snapshot);next.favorites = { b: ['q'] };await storage.write(next, 'change', 1);
  assert.equal(calls.at(-1)?.[0], 'local_commit');
  assert(!JSON.stringify(calls.at(-1)?.[1]).includes('large-image-payload'));
});

test('a lost commit reply is resolved by its durable operation receipt', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */ name) => {
        if (name === 'local_initialize') { return { revision: 0, hasData: false }; }
        if (name === 'local_write') { throw new Error('lost reply'); }
        if (name === 'local_operation') { return { revision: 1 }; }
        throw new Error('unexpected command');
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  await platform(scope).storage.initialize();
  await platform(scope).storage.write({ schemaVersion: 1, banks: [], records: [] }, 'lost', 0);
  assert.equal(platform(scope).storage.revision(), 1);
});

test('lazy metadata writes preserve unread questions and failed edits restore the read baseline', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const index = { schemaVersion: 1, banks: [{ id: 'b', name: 'bank', questions: [{ id: 'q', type: 'single', question: '', options: [], answer: [] }] }], records: [], settings: {}, wrongBook: {}, favorites: {}, crossPlatformMeta: {}, activeBankId: 'b' };
  /** @type {Array<{command:string,args:Record<string,unknown>}>} */const calls = [];
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */command, /** @type {Record<string,unknown>} */args) => {
        calls.push({ command, args });
        if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
        const query = /** @type {{kind:string}} */ (args?.query);
        if (query?.kind === 'summary') { return { revision: 1, snapshot: globalThis.structuredClone(index) }; }
        if (query?.kind === 'details') { return [{ id: 'q', type: 'single', question: '完整题干和图片', options: [], answer: [], extension: { preserved: true } }]; }
        if (command === 'local_commit') { return { revision: 2 }; }
        throw new Error('unexpected');
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  await storage.initialize();const view = await storage.read();assert(view);
  const rollback = storage.checkpointView?.();
  await storage.ensureQuestions?.(view, [{ bankId: 'b', questionId: 'q' }]);
  assert.equal(view.banks[0].questions[0].question, '完整题干和图片');
  rollback?.();
  const rolledBack = globalThis.structuredClone(index);rolledBack.banks[0].name = 'rename';
  await storage.write(/** @type {import('../../web/platform/contracts.d.ts').Snapshot} */(rolledBack), 'rename', 1);
  const changes = /** @type {{kind:string}[]} */ (calls.at(-1)?.args.changes);
  assert.deepEqual(Array.from(changes, (change) => change.kind), ['put_bank_metadata']);
  assert(!JSON.stringify(changes).includes('questions'));
});

for (const collection of ['questions', 'records']) {
  test(`未加载的 ${collection} 详情发生修改时拒绝提交，原始摘要仍可继续保存`, async () => {
    const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
    const index = {
      schemaVersion: 1,
      banks: [{ id: 'b', name: 'bank', questions: [{ id: 'q', type: 'single', question: '', options: [], answer: [] }] }],
      records: [{ id: 'r' }],
      settings: {},
      wrongBook: {},
      favorites: {},
      crossPlatformMeta: {},
      activeBankId: 'b',
    };
    /** @type {string[]} */ const calls = [];
    const scope = {
      ShirohaDesktopHost: {
        invoke: async (/** @type {string} */ command, /** @type {{query?:{kind:string}}} */ args) => {
          calls.push(command);
          if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
          if (args?.query?.kind === 'summary') { return { revision: 1, snapshot: globalThis.structuredClone(index) }; }
          if (command === 'local_operation') { return null; }
          if (command === 'local_commit') { return { revision: 2 }; }
          throw new Error('unexpected command');
        },
      },
      ShirohaBrowser: {},
      ShirohaBrowserCredentials: {},
      ShirohaSaveQueue: { create: () => ({}) },
      localStorage: { getItem: () => null },
      structuredClone: globalThis.structuredClone,
    };
    vm.runInNewContext(source, scope);
    const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
    await storage.initialize();
    await storage.read();
    const edited = globalThis.structuredClone(index);
    if (collection === 'questions') {
      edited.banks[0].questions[0].question = '不应覆盖未加载正文';
    } else {
      Object.assign(edited.records[0], { details: [{ question: '不应覆盖未加载记录' }] });
    }
    const snapshot = /** @type {import('../../web/platform/contracts.d.ts').Snapshot} */ (edited);
    await assert.rejects(storage.write(snapshot, 'rejected', 1), /尚未读取，已阻止保存/);
    assert.equal(calls.includes('local_commit'), false);
    assert.equal(storage.revision(), 1);
    await storage.write(/** @type {import('../../web/platform/contracts.d.ts').Snapshot} */ (index), 'retry', 1);
    assert.equal(storage.revision(), 2);
    assert.equal(calls.filter((command) => command === 'local_commit').length, 1);
  });
}

for (const collection of ['questions', 'records']) {
  test(`恢复修订后拒绝迟到的 ${collection} 正文并允许重新读取`, async () => {
    const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
    const index = {
      schemaVersion: 1,
      banks: [{ id: 'b', name: 'bank', questions: [{ id: 'q', type: 'single', question: '', options: [], answer: [] }] }],
      records: [{ id: 'r' }],
      settings: {},
      wrongBook: {},
      favorites: {},
      crossPlatformMeta: {},
      activeBankId: 'b',
    };
    /** @type {(value:unknown)=>void} */ let releaseOld = () => { throw new Error('old request was not started'); };
    let nativeRevision = 1;
    const scope = {
      ShirohaDesktopHost: {
        invoke: async (/** @type {string} */ command, /** @type {{query?:{kind:string,revision?:number,expected_revision?:number}}} */ args) => {
          if (command === 'local_initialize') { return { revision: nativeRevision, hasData: true }; }
          if (args?.query?.kind === 'summary') { return { revision: nativeRevision, snapshot: globalThis.structuredClone(index) }; }
          if (args?.query?.kind === 'restore') {
            assert.equal(args.query.expected_revision, 1);
            nativeRevision = 2;
            return { revision: nativeRevision };
          }
          if (args?.query?.kind === 'details') {
            if (args.query.revision === 1) { return new Promise((resolve) => { releaseOld = resolve; }); }
            assert.equal(args.query.revision, 2);
            return collection === 'questions'
              ? [{ id: 'q', type: 'single', question: '恢复后的正文', options: [], answer: [] }]
              : [{ id: 'r', details: [{ question: '恢复后的记录' }] }];
          }
          throw new Error('unexpected command');
        },
      },
      ShirohaBrowser: {},
      ShirohaBrowserCredentials: {},
      ShirohaSaveQueue: { create: () => ({}) },
      localStorage: { getItem: () => null },
      structuredClone: globalThis.structuredClone,
      crypto: { randomUUID: () => 'synthetic-restore' },
    };
    vm.runInNewContext(source, scope);
    const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
    assert(storage.ensureQuestions && storage.ensureRecords && storage.restoreSnapshot);
    await storage.initialize();
    const old = await storage.read();
    assert(old);
    const pending = collection === 'questions'
      ? storage.ensureQuestions(old, [{ bankId: 'b', questionId: 'q' }])
      : storage.ensureRecords(old, ['r']);
    await storage.restoreSnapshot('synthetic-snapshot');
    releaseOld(collection === 'questions'
      ? [{ id: 'q', type: 'single', question: '过期正文', options: [], answer: [] }]
      : [{ id: 'r', details: [{ question: '过期记录' }] }]);
    await assert.rejects(pending, /数据修订已变化/);
    assert.equal(old.banks[0].questions[0].question, '');
    assert.equal(old.records[0].details, undefined);
    const fresh = await storage.read();
    assert(fresh);
    if (collection === 'questions') {
      await storage.ensureQuestions(fresh, [{ bankId: 'b', questionId: 'q' }]);
      assert.equal(fresh.banks[0].questions[0].question, '恢复后的正文');
    } else {
      await storage.ensureRecords(fresh, ['r']);
      assert.deepEqual(fresh.records[0].details, [{ question: '恢复后的记录' }]);
    }
  });
}

test('恢复修订后拒绝迟到的完整数据读取并允许重新读取', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const index = {
    schemaVersion: 1,
    banks: [],
    records: [],
    settings: {},
    favorites: {},
    activeBankId: '',
    wrongBook: { b: [{ id: 'summary' }] },
    crossPlatformMeta: {},
  };
  /** @type {(value:unknown)=>void} */ let releaseOld = () => { throw new Error('old request was not started'); };
  let markStarted = () => {};
  const started = new Promise((resolve) => { markStarted = () => resolve(undefined); });
  let nativeRevision = 1;
  let oldHydrates = 0;
  let freshHydrates = 0;
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */ command, /** @type {{query?:{kind:string,revision?:number}}} */ args) => {
        if (command === 'local_initialize') { return { revision: nativeRevision, hasData: true }; }
        if (args?.query?.kind === 'summary') { return { revision: nativeRevision, snapshot: globalThis.structuredClone(index) }; }
        if (args?.query?.kind === 'restore') { nativeRevision = 2; return { revision: nativeRevision }; }
        if (args?.query?.kind === 'hydrate') {
          if (args.query.revision === 1) {
            oldHydrates += 1;
            if (oldHydrates === 1) { return new Promise((resolve) => { releaseOld = resolve; markStarted(); }); }
            return { stale: true };
          }
          assert.equal(args.query.revision, 2);
          freshHydrates += 1;
          return freshHydrates === 1 ? { b: [{ id: 'restored' }] } : { restored: true };
        }
        throw new Error('unexpected command');
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
    crypto: { randomUUID: () => 'synthetic-restore' },
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  assert(storage.ensureAll && storage.restoreSnapshot);
  await storage.initialize();
  const old = await storage.read();
  assert(old);
  const pending = storage.ensureAll(old);
  await started;
  await storage.restoreSnapshot('synthetic-snapshot');
  releaseOld({ b: [{ id: 'stale' }] });
  await assert.rejects(pending, /数据修订已变化/);
  assert.deepEqual(old.wrongBook, index.wrongBook);
  const fresh = await storage.read();
  assert(fresh);
  await storage.ensureAll(fresh);
  assert.deepEqual(fresh.wrongBook, { b: [{ id: 'restored' }] });
  assert.deepEqual(fresh.crossPlatformMeta, { restored: true });
});

/** @typedef {{schemaVersion:1,activeBankId:string,wrongBook:import('../../web/platform/contracts.d.ts').JsonObject,
 * favorites:import('../../web/platform/contracts.d.ts').JsonObject,settings:import('../../web/platform/contracts.d.ts').JsonObject,
 * crossPlatformMeta:import('../../web/platform/contracts.d.ts').JsonObject,records:Array<import('../../web/platform/contracts.d.ts').StudyRecord>,
 * banks:Array<{id:string,name:string,questions:Array<{id:string,type:string,question:string,options:readonly import('../../web/platform/contracts.d.ts').JsonValue[],answer:readonly string[]}>}>}} MutableAdapterSnapshot */
test('desktop save uses linear question identity work for a single favorite change', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  /** @type {Array<{size:number,comparisons:number,idReads:number}>} */ const measurements = [];
  for (const size of [100, 200, 500, 1000]) {
    const counts = { comparisons: 0, idReads: 0 };
    const snapshot = { schemaVersion: 1, banks: [{ id: 'bank', name: 'sample', questions: Array.from({ length: size }, (_, index) => ({ id: `q-${index}`, type: 'single', question: '', options: [], answer: [] })) }], records: [], settings: {}, wrongBook: {}, favorites: {}, crossPlatformMeta: {}, activeBankId: 'bank' };
    /** @param {unknown} value */
    function instrument(value) {
      const state = /** @type {{banks?:Array<{questions:Array<{id:string}>}>}|null} */ (value);
      for (const bank of state?.banks || []) {
        for (const question of bank.questions) {
          const { id } = question;
          Object.defineProperty(question, 'id', { enumerable: true, configurable: true, get() { counts.idReads += 1;return id; } });
        }
        const { questions } = bank;
        Object.defineProperty(questions, 'some', {
          configurable: true,
          value: (/** @type {(item:{id:string})=>boolean} */ predicate) => {
            for (const item of questions) { counts.comparisons += 1;if (predicate(item)) { return true; } }
            return false;
          },
        });
      }
    }
    /** @template T @param {T} value @returns {T} */
    function clone(value) { const copy = globalThis.structuredClone(value);instrument(copy);return copy; }
    /** @type {Array<{command:string,args:Record<string,unknown>|undefined}>} */ const calls = [];
    const scope = {
      ShirohaDesktopHost: {
        invoke: async (/** @type {string} */ command, /** @type {Record<string,unknown>|undefined} */ args) => {
          calls.push({ command, args });
          if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
          if (command === 'local_query') { return { revision: 1, snapshot: clone(snapshot) }; }
          if (command === 'local_commit') { return { revision: 2 }; }
          throw new Error(`unexpected ${command}`);
        },
      },
      ShirohaBrowser: {},
      ShirohaBrowserCredentials: {},
      ShirohaSaveQueue: { create: () => ({}) },
      localStorage: { getItem: () => null },
      structuredClone: clone,
    };
    vm.runInNewContext(source, scope);
    const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
    await storage.initialize();
    const next = /** @type {MutableAdapterSnapshot|null} */ (/** @type {unknown} */ (await storage.read()));assert(next);
    next.favorites = { bank: ['q-0'] };
    counts.comparisons = 0;counts.idReads = 0;
    const receipt = await storage.write(next, `favorite-${size}`, 1);
    measurements.push({ size, ...counts });
    assert.deepEqual(globalThis.structuredClone(receipt), { revision: 2 });
    const commit = calls.find((call) => call.command === 'local_commit');assert(commit);
    assert.deepEqual(JSON.parse(JSON.stringify(commit.args)), { changes: [{ kind: 'put_header', header: { schemaVersion: 1, settings: {}, wrongBook: {}, favorites: { bank: ['q-0'] }, crossPlatformMeta: {}, activeBankId: 'bank' } }], operationId: `favorite-${size}`, expectedRevision: 1 });
  }
  console.log(`question identity work: ${JSON.stringify(measurements)}`);
  for (const result of measurements) {
    assert.ok(result.comparisons <= result.size * 2, `${result.size} 题比较 ${result.comparisons} 次`);
    assert.ok(result.idReads <= result.size * 20, `${result.size} 题读取身份 ${result.idReads} 次`);
  }
  assert.ok(measurements[3].idReads <= measurements[2].idReads * 2.1, '1,000 题的身份读取应随题数线性增长');
});

for (const outcome of ['receipt', 'lost-reply', 'retry']) {
  test(`desktop save preserves ordered changes and ${outcome} semantics`, async () => {
    const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
    const summary = {
      schemaVersion: 1,
      banks: [
        { id: 'b1', name: 'first', questions: [{ id: 'shared', type: 'single', question: '', options: [], answer: [] }, { id: 'deleted', type: 'single', question: '', options: [], answer: [] }] },
        { id: 'b2', name: 'second', questions: [{ id: 'shared', type: 'single', question: '', options: [], answer: [] }] },
      ],
      records: [{ id: 'r1' }, { id: 'r2' }],
      settings: {},
      wrongBook: {},
      favorites: {},
      crossPlatformMeta: {},
      activeBankId: 'b1',
    };
    /** @type {Array<{command:string,args:Record<string,unknown>|undefined}>} */ const calls = [];
    let commits = 0;
    const scope = {
      ShirohaDesktopHost: {
        invoke: async (/** @type {string} */ command, /** @type {Record<string,unknown>|undefined} */ args) => {
          calls.push({ command, args: globalThis.structuredClone(args) });
          if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
          const query = /** @type {{kind?:string,collection?:string,bank_id?:string,ids?:string[]}|undefined} */ (args?.query);
          if (query?.kind === 'summary') { return { revision: 1, snapshot: globalThis.structuredClone(summary) }; }
          if (query?.kind === 'details' && query.collection === 'questions') {
            return (query.ids || []).map((id) => ({ id, type: 'single', question: `正文-${query.bank_id}-${id}`, options: [], answer: [] }));
          }
          if (query?.kind === 'details' && query.collection === 'records') { return [{ id: 'r1', details: ['旧记录正文'] }]; }
          if (command === 'local_commit') {
            commits += 1;
            if (commits === 1 && outcome !== 'receipt') { throw { code: 'storage_unavailable' }; }
            if (commits === 1 || (outcome === 'retry' && commits === 2)) { return { revision: 2 }; }
            return { revision: 3 };
          }
          if (command === 'local_operation') { return outcome === 'lost-reply' ? { revision: 2 } : null; }
          throw new Error(`unexpected ${command}`);
        },
      },
      ShirohaBrowser: {},
      ShirohaBrowserCredentials: {},
      ShirohaSaveQueue: { create: () => ({}) },
      localStorage: { getItem: () => null },
      structuredClone: globalThis.structuredClone,
    };
    vm.runInNewContext(source, scope);
    const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
    await storage.initialize();const view = /** @type {MutableAdapterSnapshot|null} */ (/** @type {unknown} */ (await storage.read()));assert(view);
    await storage.ensureQuestions?.(view, [{ bankId: 'b1', questionId: 'shared' }, { bankId: 'b2', questionId: 'shared' }]);
    await storage.ensureRecords?.(view, ['r1']);
    view.banks[0].name = 'changed';
    const added = { id: 'new', type: 'single', question: '新题', options: [], answer: [] };
    view.banks[0].questions = [added, view.banks[0].questions[0]];
    view.banks[1].questions[0].question = '修改第二库的正文';
    view.banks.reverse();
    Object.assign(view.records[0], { details: ['新记录正文'] });
    view.records = [{ id: 'r3', details: ['新增'] }, view.records[0]];
    view.favorites = { b2: ['shared'] };
    const expectedChanges = [
      { kind: 'put_header', header: { schemaVersion: 1, settings: {}, wrongBook: {}, favorites: { b2: ['shared'] }, crossPlatformMeta: {}, activeBankId: 'b1' } },
      { kind: 'put_question', bank_id: 'b2', question: view.banks[0].questions[0] },
      { kind: 'put_bank_metadata', bank: { id: 'b1', name: 'changed' } },
      { kind: 'put_question', bank_id: 'b1', question: added },
      { kind: 'delete_question', bank_id: 'b1', question_id: 'deleted' },
      { kind: 'question_order', bank_id: 'b1', ids: ['new', 'shared'] },
      { kind: 'bank_order', ids: ['b2', 'b1'] },
      { kind: 'put_record', record: view.records[0] },
      { kind: 'put_record', record: view.records[1] },
      { kind: 'delete_record', record_id: 'r2' },
      { kind: 'record_order', ids: ['r3', 'r1'] },
    ];
    if (outcome === 'retry') {
      await assert.rejects(storage.write(view, 'first', 1));
      assert.equal(storage.revision(), 1);
    }
    const receipt = await storage.write(view, outcome === 'retry' ? 'second' : 'first', 1);
    assert.deepEqual(globalThis.structuredClone(receipt), { revision: 2 });
    const writes = calls.filter((call) => call.command === 'local_commit');
    assert.equal(writes.length, outcome === 'retry' ? 2 : 1);
    for (const call of writes) { assert.deepEqual(call.args?.changes, expectedChanges);assert.equal(call.args?.expectedRevision, 1); }
    if (outcome !== 'receipt') { assert.equal(calls.filter((call) => call.command === 'local_operation').length, 1); }
    added.question = '新增题保存后再次修改';
    Object.assign(view.records[0], { details: ['新增记录保存后再次修改'] });
    const nextReceipt = await storage.write(view, 'edit-added', 2);
    assert.deepEqual(globalThis.structuredClone(nextReceipt), { revision: 3 });
    assert.deepEqual(calls.at(-1)?.args?.changes, [
      { kind: 'put_question', bank_id: 'b1', question: added },
      { kind: 'put_record', record: view.records[0] },
    ]);
  });
}

test('desktop save does not confuse identical question IDs in different banks', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const question = { id: 'same', type: 'single', question: '', options: [], answer: [] };
  const summary = { schemaVersion: 1, banks: [{ id: 'a', questions: [question] }, { id: 'b', questions: [question] }], records: [], settings: {}, wrongBook: {}, favorites: {}, crossPlatformMeta: {}, activeBankId: 'a' };
  /** @type {string[]} */ const calls = [];
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */ command, /** @type {Record<string,unknown>|undefined} */ args) => {
        calls.push(command);
        if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
        const query = /** @type {{kind?:string,bank_id?:string}|undefined} */ (args?.query);
        if (query?.kind === 'summary') { return { revision: 1, snapshot: globalThis.structuredClone(summary) }; }
        if (query?.kind === 'details') { return [{ ...question, question: `正文-${query.bank_id}` }]; }
        if (command === 'local_operation') { return null; }
        if (command === 'local_commit') { return { revision: 2 }; }
        throw new Error(`unexpected ${command}`);
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  await storage.initialize();const view = /** @type {MutableAdapterSnapshot|null} */ (/** @type {unknown} */ (await storage.read()));assert(view);
  await storage.ensureQuestions?.(view, [{ bankId: 'a', questionId: 'same' }]);
  view.banks[1].questions[0].question = '未经读取的正文';
  await assert.rejects(storage.write(view, 'not-loaded', 1), /正文尚未读取/);
  assert.equal(calls.includes('local_commit'), false);
  view.banks[1].questions[0].question = '';
  await storage.ensureQuestions?.(view, [{ bankId: 'b', questionId: 'same' }]);
  view.banks[1].questions[0].question = '已读取后修改';
  assert.deepEqual(globalThis.structuredClone(await storage.write(view, 'loaded', 1)), { revision: 2 });
});

test('desktop save rechecks a replaced baseline while waiting for the receipt', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const original = { schemaVersion: 1, banks: [{ id: 'b', name: 'bank', questions: [{ id: 'old', type: 'single', question: '', options: [], answer: [] }] }], records: [], settings: {}, wrongBook: {}, favorites: {}, crossPlatformMeta: {}, activeBankId: 'b' };
  const replacement = globalThis.structuredClone(original);
  replacement.banks[0].questions.push({ id: 'new', type: 'single', question: '', options: [], answer: [] });
  /** @type {(receipt:{revision:number})=>void} */ let release = () => { throw new Error('commit not started'); };
  const pending = new Promise((resolve) => { release = resolve; });
  let reads = 0;let commits = 0;
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */ command, /** @type {Record<string,unknown>|undefined} */ args) => {
        if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
        const query = /** @type {{kind?:string}|undefined} */ (args?.query);
        if (query?.kind === 'summary') { reads += 1;return { revision: 1, snapshot: globalThis.structuredClone(reads === 1 ? original : replacement) }; }
        if (query?.kind === 'details') { return [{ id: 'new', type: 'single', question: '已读取正文', options: [], answer: [] }]; }
        if (command === 'local_commit') { commits += 1;return commits === 1 ? pending : { revision: 3 }; }
        if (command === 'local_operation') { return null; }
        throw new Error(`unexpected ${command}`);
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  await storage.initialize();
  const view = /** @type {MutableAdapterSnapshot|null} */ (/** @type {unknown} */ (await storage.read()));assert(view);
  view.banks[0].questions.push({ id: 'new', type: 'single', question: '', options: [], answer: [] });
  const saving = storage.write(view, 'pending', 1);
  assert.equal(commits, 1);
  assert(await storage.read());
  release({ revision: 2 });
  assert.deepEqual(globalThis.structuredClone(await saving), { revision: 2 });
  assert.equal(storage.isQuestionLoaded?.('b', 'new'), false);
  view.banks[0].questions[1].question = '未经读取的修改';
  await assert.rejects(storage.write(view, 'blocked', 2), /正文尚未读取/);
  view.banks[0].questions[1].question = '';
  await storage.ensureQuestions?.(view, [{ bankId: 'b', questionId: 'new' }]);
  view.banks[0].questions[1].question = '读取后修改';
  assert.deepEqual(globalThis.structuredClone(await storage.write(view, 'allowed', 2)), { revision: 3 });
});

test('desktop save preserves bank insertion, deletion and order across the receipt', async () => {
  const source = await readFile(new URL('../frontend/adapter.js', import.meta.url), 'utf8');
  const question = { id: 'same', type: 'single', question: '', options: [], answer: [] };
  const summary = { schemaVersion: 1, banks: [{ id: 'removed', name: '旧库', questions: [question] }, { id: 'kept', name: '保留库', questions: [question] }], records: [], settings: {}, wrongBook: {}, favorites: {}, crossPlatformMeta: {}, activeBankId: 'kept' };
  /** @type {Array<{command:string,args:Record<string,unknown>|undefined}>} */ const calls = [];
  let commits = 0;
  const scope = {
    ShirohaDesktopHost: {
      invoke: async (/** @type {string} */ command, /** @type {Record<string,unknown>|undefined} */ args) => {
        calls.push({ command, args: globalThis.structuredClone(args) });
        if (command === 'local_initialize') { return { revision: 1, hasData: true }; }
        if (command === 'local_query') { return { revision: 1, snapshot: globalThis.structuredClone(summary) }; }
        if (command === 'local_commit') { commits += 1;return { revision: commits + 1 }; }
        throw new Error(`unexpected ${command}`);
      },
    },
    ShirohaBrowser: {},
    ShirohaBrowserCredentials: {},
    ShirohaSaveQueue: { create: () => ({}) },
    localStorage: { getItem: () => null },
    structuredClone: globalThis.structuredClone,
  };
  vm.runInNewContext(source, scope);
  const storage = /** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */ (vm.runInNewContext('ShirohaPlatform.storage', scope));
  await storage.initialize();const view = /** @type {MutableAdapterSnapshot|null} */ (/** @type {unknown} */ (await storage.read()));assert(view);
  const added = { id: 'added', name: '新库', questions: [{ ...question, question: '新库正文' }] };
  view.banks = [view.banks[1], added];
  assert.deepEqual(globalThis.structuredClone(await storage.write(view, 'banks', 1)), { revision: 2 });
  assert.deepEqual(calls.at(-1)?.args?.changes, [
    { kind: 'put_bank', bank: added }, { kind: 'delete_bank', bank_id: 'removed' }, { kind: 'bank_order', ids: ['kept', 'added'] },
  ]);
  added.questions[0].question = '新库题目已修改';
  assert.deepEqual(globalThis.structuredClone(await storage.write(view, 'new-bank-edit', 2)), { revision: 3 });
  assert.deepEqual(calls.at(-1)?.args?.changes, [{ kind: 'put_question', bank_id: 'added', question: added.questions[0] }]);
});
