import { spawn } from 'node:child_process';

/** @typedef {{ name: string, ok: boolean, detail?: unknown, error?: string }} Check */

/** @template T @param {Promise<T>} operation @param {number} timeoutMs @returns {Promise<T>} */
export async function deadline(operation, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`操作超过 ${timeoutMs} ms`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {{ assertActive: () => void, registerChild: (child: import('node:child_process').ChildProcess) => void }} lifecycle
 * @param {string} executable @param {string[]} args @param {import('node:child_process').SpawnOptions} options */
export function spawnOwned(lifecycle, executable, args, options) {
  lifecycle.assertActive();
  const child = spawn(executable, args, options);
  lifecycle.registerChild(child);
  return child;
}

/** @param {{shutdown: () => Promise<void>}} control @param {() => Promise<void>} cleanup */
export async function cleanupAfterShutdown(control, cleanup) {
  await control.shutdown();
  await cleanup();
}

export class SmokeCheckAborted extends Error {}

export class SmokeStopFailedError extends Error {
  /** @param {unknown} cause */
  constructor(cause) {
    super(`测试进程未确认退出，隔离目录保留：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

export class SmokeUnsettledError extends Error {
  /** @param {unknown} cause */
  constructor(cause) {
    super(`操作未收敛，隔离目录保留：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** @param {{ok: boolean, [key: string]: unknown}} report @param {boolean} forceExit */
export async function reportSmoke(report, forceExit) {
  if (forceExit) {
    await new Promise((resolve, reject) => {
      process.stdout.write(`${JSON.stringify(report)}\n`, (error) => (error ? reject(error) : resolve(undefined)));
    });
    process.exit(1);
  }
  console.log(JSON.stringify(report));
  process.exitCode = report.ok ? 0 : 1;
}

/**
 * 所有启动和检查只属于一次 smoke；失败后禁止新启动，已启动的操作收敛前不得删除 profile。
 * @param {{ checks: Check[], timeoutMs: number, settleTimeoutMs: number,
 *   stopChild: (child: import('node:child_process').ChildProcess) => Promise<void> }} options
 */
export function createSmokeControl(options) {
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set();
  /** @type {Set<Promise<unknown>>} */
  const launches = new Set();
  /** @type {Set<Promise<unknown>>} */
  const actions = new Set();
  let stopped = false;

  function assertActive() {
    if (stopped) { throw new Error('冒烟已停止，拒绝启动测试进程'); }
  }

  /** @param {import('node:child_process').ChildProcess} child */
  function registerChild(child) {
    assertActive();
    children.add(child);
    child.once('close', () => children.delete(child));
  }

  /** @template T @param {(lifecycle: { assertActive: () => void,
   *   registerChild: (child: import('node:child_process').ChildProcess) => void }) => Promise<T>} action
   * @returns {Promise<T>} */
  function launch(action) {
    assertActive();
    const pending = Promise.resolve().then(() => action({ assertActive, registerChild }));
    launches.add(pending);
    pending.then(() => launches.delete(pending), () => launches.delete(pending));
    return pending;
  }

  /** @param {string} name @param {() => Promise<unknown>} action */
  async function check(name, action) {
    assertActive();
    const pending = Promise.resolve().then(action);
    actions.add(pending);
    pending.then(() => actions.delete(pending), () => actions.delete(pending));
    try {
      const detail = await deadline(pending, options.timeoutMs);
      options.checks.push({ name, ok: true, detail });
    } catch (error) {
      options.checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
      stopped = true;
      throw new SmokeCheckAborted();
    }
  }

  async function shutdown() {
    stopped = true;
    const results = await Promise.allSettled([...children].map((child) => options.stopChild(child)));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') { throw new SmokeStopFailedError(failed.reason); }
    try {
      await deadline(Promise.all([Promise.allSettled([...launches]), Promise.allSettled([...actions])]), options.settleTimeoutMs);
    } catch (error) {
      throw new SmokeUnsettledError(error);
    }
  }

  return { check, launch, shutdown };
}
