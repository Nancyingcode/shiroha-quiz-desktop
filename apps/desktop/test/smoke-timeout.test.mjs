import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanupAfterShutdown, createSmokeControl, SmokeCheckAborted, spawnOwned } from '../scripts/smoke-control.mjs';

function fixture() {
  /** @type {Array<{name: string, ok: boolean, detail?: unknown, error?: string}>} */
  const checks = [];
  const control = createSmokeControl({
    checks, timeoutMs: 25, settleTimeoutMs: 1000,
    stopChild: async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) { return; }
      const closed = new Promise((resolve) => child.once('close', resolve));
      assert.equal(child.kill(), true);
      await closed;
    },
  });
  return { checks, control };
}

test('shutdown reports every child that failed to stop and retains the profile', async () => {
  let attempts = 0;
  const control = createSmokeControl({
    checks: [], timeoutMs: 1000, settleTimeoutMs: 1000,
    stopChild: async () => { attempts += 1; throw new Error(`stop failure ${attempts}`); },
  });
  await control.launch(async (lifecycle) => {
    lifecycle.registerChild(/** @type {import('node:child_process').ChildProcess} */ (/** @type {unknown} */ (new EventEmitter())));
    lifecycle.registerChild(/** @type {import('node:child_process').ChildProcess} */ (/** @type {unknown} */ (new EventEmitter())));
  });
  let cleaned = false;
  await assert.rejects(cleanupAfterShutdown(control, async () => { cleaned = true; }), (error) => {
    assert(error instanceof Error);
    assert.match(error.message, /stop failure 1/);
    assert.match(error.message, /stop failure 2/);
    return true;
  });
  assert.equal(attempts, 2);
  assert.equal(cleaned, false);
});

test('an outer timeout stops the next shared check and waits for its late action', async () => {
  const { control, checks } = fixture();
  /** @type {string[]} */
  const events = [];
  /** @type {() => void} */
  let release = () => { throw new Error('gate not initialized'); };
  /** @type {Promise<void>} */
  const gate = new Promise((resolve) => { release = resolve; });
  await assert.rejects(control.check('slow', async () => { await gate; events.push('late'); }), SmokeCheckAborted);
  await assert.rejects(control.check('next', async () => { events.push('next'); }), /已停止/);
  const cleaned = cleanupAfterShutdown(control, async () => { events.push('cleanup'); });
  await delay(20);
  assert.deepEqual(events, []);
  release();
  await cleaned;
  assert.deepEqual(events, ['late', 'cleanup']);
  assert.equal(checks[0].ok, false);
  assert.match(checks[0].error ?? '', /操作超过 25 ms/);
});

test('an action failure stops the next check and retains the original failure', async () => {
  const { control, checks } = fixture();
  let next = false;
  await assert.rejects(control.check('failed', async () => { throw new Error('step timed out'); }), SmokeCheckAborted);
  await assert.rejects(control.check('next', async () => { next = true; }), /已停止/);
  await control.shutdown();
  assert.equal(checks[0].error, 'step timed out');
  assert.equal(next, false);
});

test('a timeout before spawn rejects a late restart without starting a child', async () => {
  const { control, checks } = fixture();
  /** @type {() => void} */
  let release = () => { throw new Error('gate not initialized'); };
  /** @type {Promise<void>} */
  const gate = new Promise((resolve) => { release = resolve; });
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  const run = control.check('restart', () => control.launch(async (lifecycle) => {
    await gate;
    child = spawnOwned(lifecycle, process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { windowsHide: true, stdio: 'ignore' });
  }));
  await assert.rejects(run, SmokeCheckAborted);
  const cleaned = control.shutdown();
  release();
  await cleaned;
  assert.equal(child, undefined);
  assert.match(checks[0].error ?? '', /操作超过 25 ms/);
});

test('a timeout during launch stops only the owned child and waits before profile deletion', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-smoke-control-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-smoke-control-'));
    await rm(actual, { recursive: true, force: true });
  });
  const profile = path.join(temp, 'profile');
  await mkdir(profile);
  const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { windowsHide: true, stdio: 'ignore' });
  /** @type {{current?: import('node:child_process').ChildProcess, closed?: Promise<void>}} */
  const owned = {};
  /** @type {() => void} */
  let release = () => { throw new Error('gate not initialized'); };
  /** @type {() => void} */
  let registered = () => { throw new Error('ready not initialized'); };
  /** @type {Promise<void>} */
  const gate = new Promise((resolve) => { release = resolve; });
  /** @type {Promise<void>} */
  const ready = new Promise((resolve) => { registered = resolve; });
  const { control, checks } = fixture();
  try {
    const run = control.check('restart', () => control.launch(async (lifecycle) => {
      const child = spawnOwned(lifecycle, process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { windowsHide: true, stdio: 'ignore' });
      owned.current = child;
      owned.closed = new Promise((resolve) => child.once('close', () => resolve()));
      registered();
      await gate;
      lifecycle.assertActive();
      return owned.current;
    }));
    await ready;
    await assert.rejects(run, SmokeCheckAborted);
    const cleaned = cleanupAfterShutdown(control, async () => {
      assert.equal(await realpath(profile), profile);
      await rm(profile, { recursive: true });
    });
    const { closed } = owned;
    assert(closed, 'owned child was not started');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('owned child did not close in time')), 5000);
      closed.then(() => { clearTimeout(timer); resolve(undefined); }, (error) => { clearTimeout(timer); reject(error); });
    });
    assert(owned.current, 'owned child was not started');
    assert(owned.current.exitCode !== null || owned.current.signalCode !== null, 'owned child was not stopped');
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    await access(profile);
    release();
    await cleaned;
    await assert.rejects(access(profile), { code: 'ENOENT' });
    assert.equal(unrelated.exitCode, null);
    assert.equal(unrelated.signalCode, null);
    assert.match(checks[0].error ?? '', /操作超过 25 ms/);
  } finally {
    if (unrelated.exitCode === null && unrelated.signalCode === null) {
      const closed = new Promise((resolve) => unrelated.once('close', resolve));
      unrelated.kill();
      await closed;
    }
    const child = owned.current;
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      await closed;
    }
  }
});

test('an unsettled action prevents profile cleanup and reports the cleanup timeout', async () => {
  /** @type {Array<{name: string, ok: boolean, detail?: unknown, error?: string}>} */
  const checks = [];
  const control = createSmokeControl({ checks, timeoutMs: 10, settleTimeoutMs: 30, stopChild: async () => {} });
  await assert.rejects(control.check('stuck', () => new Promise(() => {})), SmokeCheckAborted);
  let cleaned = false;
  await assert.rejects(cleanupAfterShutdown(control, async () => { cleaned = true; }), /操作未收敛.*操作超过 30 ms/);
  assert.equal(cleaned, false);
  assert.match(checks[0].error ?? '', /操作超过 10 ms/);
});

test('a non-settling action leaves its profile and the smoke process exits with its original failure', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-smoke-exit-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-smoke-exit-'));
    await rm(actual, { recursive: true, force: true });
  });
  const profile = path.join(temp, 'profile');
  await mkdir(profile);
  const moduleUrl = new URL('../scripts/smoke-control.mjs', import.meta.url).href;
  const source = [
    'import { cleanupAfterShutdown, createSmokeControl, reportSmoke, SmokeStopFailedError, SmokeUnsettledError } from process.argv[1];',
    "import { realpath, rm } from 'node:fs/promises';",
    "import path from 'node:path';",
    'const profile = process.argv[1]; const temp = process.argv[2];',
    'const checks = [];',
    'const control = createSmokeControl({checks, timeoutMs: 10, settleTimeoutMs: 30, stopChild: async () => {}});',
    "try { await control.check('original', async () => { await new Promise((resolve) => setTimeout(resolve, 30000)); }); } catch {}",
    'let forceExit = false;',
    "try { await cleanupAfterShutdown(control, async () => { const actual = await realpath(profile); if (path.dirname(actual) !== temp || path.basename(actual) !== 'profile') throw new Error('invalid profile'); await rm(actual, {recursive:true, force:true}); }); } catch (error) { checks.push({name:'cleanup', ok:false, error:error.message}); forceExit = error instanceof SmokeUnsettledError || error instanceof SmokeStopFailedError; }",
    'await reportSmoke({ok:false, checks}, forceExit);',
  ].join('\n').replace('from process.argv[1]', `from '${moduleUrl}'`);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, profile, temp], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /操作超过 10 ms/);
  assert.match(result.stdout, /操作超过 30 ms/);
  await access(profile);
});

test('a failed owned-process stop is reported and does not leave the smoke process waiting on a long action', async () => {
  const moduleUrl = new URL('../scripts/smoke-control.mjs', import.meta.url).href;
  const source = [
    "import { EventEmitter } from 'node:events';",
    'import { cleanupAfterShutdown, createSmokeControl, reportSmoke, SmokeStopFailedError, SmokeUnsettledError } from process.argv[1];',
    'const checks = [];',
    "const control = createSmokeControl({checks, timeoutMs: 10, settleTimeoutMs: 30, stopChild: async () => { throw new Error('synthetic stop failure'); }});",
    "try { await control.check('original', () => control.launch(async (lifecycle) => { lifecycle.registerChild(new EventEmitter()); await new Promise((resolve) => setTimeout(resolve, 30000)); })); } catch {}",
    'let forceExit = false;',
    "try { await cleanupAfterShutdown(control, async () => { throw new Error('profile unexpectedly removed'); }); } catch (error) { checks.push({name:'cleanup', ok:false, error:error.message, detail:{profile:'isolated-profile'}}); forceExit = error instanceof SmokeUnsettledError || error instanceof SmokeStopFailedError; }",
    'await reportSmoke({ok:false, checks}, forceExit);',
  ].join('\n').replace('from process.argv[1]', `from '${moduleUrl}'`);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /操作超过 10 ms/);
  assert.match(result.stdout, /synthetic stop failure/);
  assert.match(result.stdout, /isolated-profile/);
});

test('native mock closes its listener when the origin marker already exists', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-mock-failure-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-mock-failure-'));
    await rm(actual, { recursive: true, force: true });
  });
  const marker = path.join(temp, 'network-mock-origin');
  await writeFile(marker, 'existing fixture');
  const moduleUrl = new URL('../scripts/network-smoke.mjs', import.meta.url).href;
  const source = [
    'import { createNativeMock } from process.argv[1];',
    'try { await createNativeMock(process.argv[1]); } catch (error) { console.log(error.code); process.exitCode = 1; }',
  ].join('\n').replace('from process.argv[1]', `from '${moduleUrl}'`);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, temp], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stdout, /EEXIST/);
  assert.equal(await readFile(marker, 'utf8'), 'existing fixture');
});

test('smoke removes its own profile if isolation marking or mock startup fails', { skip: process.platform !== 'win32' }, async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-smoke-startup-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-smoke-startup-'));
    await rm(actual, { recursive: true, force: true });
  });
  const fakeExecutable = path.join(temp, 'synthetic.exe');
  const hook = path.join(temp, 'failure.mjs');
  await writeFile(fakeExecutable, 'not executed');
  await writeFile(hook, [
    "import fsp from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const original = fsp.writeFile;',
    'fsp.writeFile = async function(file, ...args) {',
    '  if (String(file).endsWith(process.env.INJECT_FILE)) { const error = new Error("synthetic startup failure"); error.code = "EEXIST"; throw error; }',
    '  return original.call(this, file, ...args);',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  const script = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
  for (const injected of ['test-isolation', 'network-mock-origin']) {
    const result = spawnSync(process.execPath, [script, fakeExecutable], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { ...process.env, TEMP: temp, TMP: temp, INJECT_FILE: injected, NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /synthetic startup failure/);
    assert.deepEqual((await readdir(temp)).filter((name) => name.startsWith('shiroha-native-smoke-')), []);
  }
});

test('unconfirmed mock shutdown retains the profile and both startup and cleanup errors', { skip: process.platform !== 'win32' }, async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-mock-cleanup-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-mock-cleanup-'));
    await rm(actual, { recursive: true, force: true });
  });
  const fakeExecutable = path.join(temp, 'synthetic.exe');
  const hook = path.join(temp, 'failure.mjs');
  await writeFile(fakeExecutable, 'not executed');
  await writeFile(hook, [
    "import http from 'node:http';",
    "import fsp from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const createServer = http.createServer; const writeFile = fsp.writeFile;',
    'http.createServer = function(...args) {',
    '  const server = createServer.apply(this, args); const close = server.close.bind(server);',
    '  server.close = (callback) => close(() => callback(new Error("synthetic close failure")));',
    '  return server;',
    '};',
    'fsp.writeFile = async function(file, ...args) {',
    '  if (String(file).endsWith("network-mock-origin")) { const error = new Error("synthetic origin failure"); error.code = "EEXIST"; throw error; }',
    '  return writeFile.call(this, file, ...args);',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  const script = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, fakeExecutable], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
    env: { ...process.env, TEMP: temp, TMP: temp, NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stdout, /synthetic origin failure/);
  assert.match(result.stdout, /EEXIST/);
  assert.match(result.stdout, /synthetic close failure/);
  assert.match(result.stdout, /隔离目录保留/);
  const profiles = (await readdir(temp)).filter((name) => name.startsWith('shiroha-native-smoke-'));
  assert.equal(profiles.length, 1);
  assert.equal(await readFile(path.join(temp, profiles[0], 'test-isolation'), 'utf8'), 'fake-credentials\nnetwork-denied\n');
});

for (const scenario of ['stop-failure', 'browser-failure', 'stop-and-browser-failure', 'browser-timeout']) {
  test(`initial launch retains its error and profile on ${scenario}`, { skip: process.platform !== 'win32' }, async (t) => {
    const tempRoot = await realpath(os.tmpdir());
    const temp = await mkdtemp(path.join(tempRoot, 'shiroha-launch-failure-'));
    t.after(async () => {
      const actual = await realpath(temp);
      assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
      assert(path.basename(actual).startsWith('shiroha-launch-failure-'));
      await rm(actual, { recursive: true, force: true });
    });
    const fakeExecutable = path.join(temp, 'synthetic.exe');
    const hook = path.join(temp, 'failure.mjs');
    const marker = path.join(temp, 'browser-close-attempted');
    const playwright = new URL('../node_modules/playwright-core/index.mjs', import.meta.url).href;
    await writeFile(fakeExecutable, 'not executed');
    await writeFile(hook, [
      "import childProcess from 'node:child_process';",
      "import { EventEmitter } from 'node:events';",
      "import { writeFileSync } from 'node:fs';",
      "import { syncBuiltinESMExports } from 'node:module';",
      `import { chromium } from '${playwright}';`,
      'const child = new EventEmitter(); child.pid = 123456; child.exitCode = null; child.signalCode = null;',
      'childProcess.spawn = () => child;',
      'childProcess.execFile = (file, args, options, callback) => {',
      '  if (file === "powershell.exe") {',
      '    if (!process.env.FAILURE_SCENARIO.startsWith("stop-")) { child.exitCode = 0; queueMicrotask(() => child.emit("close", 0, null)); }',
      '    callback(null, "", "");',
      '  } else { callback(new Error("synthetic stop failure"), "", ""); }',
      '};',
      'syncBuiltinESMExports();',
      'const now = Date.now.bind(Date); let tick = 0; Date.now = () => now() + (tick++ * 10000);',
      'globalThis.fetch = async () => ({ ok: true });',
      'chromium.connectOverCDP = async () => ({',
      '  contexts() { throw new Error("synthetic CDP startup failure"); },',
      '  close() {',
      '    writeFileSync(process.env.BROWSER_MARKER, "attempted");',
      '    if (process.env.FAILURE_SCENARIO.endsWith("browser-failure")) return Promise.reject(new Error("synthetic browser close failure"));',
      '    if (process.env.FAILURE_SCENARIO === "browser-timeout") { setTimeout(() => {}, 30000); return new Promise(() => {}); }',
      '    return Promise.resolve();',
      '  },',
      '});',
      '',
    ].join('\n'));
    const script = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, fakeExecutable], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { ...process.env, TEMP: temp, TMP: temp, FAILURE_SCENARIO: scenario, BROWSER_MARKER: marker,
        NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /synthetic CDP startup failure/);
    if (scenario.startsWith('stop-')) { assert.match(result.stdout, /synthetic stop failure/); }
    if (scenario === 'stop-failure') { assert.match(result.stdout, /浏览器连接关闭完成/); }
    if (scenario.endsWith('browser-failure')) { assert.match(result.stdout, /synthetic browser close failure/); }
    if (scenario.startsWith('browser-')) { assert.match(result.stdout, /测试进程关闭完成/); }
    if (scenario === 'browser-timeout') { assert.match(result.stdout, /操作超过 8000 ms/); }
    assert.equal(await readFile(marker, 'utf8'), 'attempted');
    assert.match(result.stdout, /隔离目录保留/);
    const profiles = (await readdir(temp)).filter((name) => name.startsWith('shiroha-native-smoke-'));
    assert.equal(profiles.length, 1);
    assert.equal(await readFile(path.join(temp, profiles[0], 'test-isolation'), 'utf8'), 'fake-credentials\nnetwork-denied\n');
  });
}
