import assert from 'node:assert/strict';
import { markNativeIsolation } from './native-isolation.mjs';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const RUN_COUNT = 5;
const IDLE_MS = 5_000;
const START_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 8_000;
const POLL_MS = 20;
const MIB_BYTES = 1_048_576;
const PROFILE_PREFIX = 'shiroha-native-perf-';
const execute = promisify(execFile);

/** @typedef {{Id: number, ProcessName: string, WorkingSet64: number, PrivateMemorySize64: number}} ProcessMemory */
/** @typedef {{child: import('node:child_process').ChildProcess, executable: string, earliest: string, latest: string}} OwnedProcess */
/** @typedef {{id: string, fileName: string, text: string, mode: string, questions: number}} Fixture */

async function fixedFixtures() {
  const require = createRequire(import.meta.url);
  /** @type {{webState: () => {banks: Array<{name: string, questions: unknown[]}>}}} */
  const dataset = require('../../../test/dual-platform/fixtures/dataset.cjs');
  const { banks } = dataset.webState();
  assert.equal(banks.length, 2, '固定题库 fixture 结构已改变，应先更新测量协议');
  assert.equal(banks[0].questions.length, 7);
  assert.equal(banks[1].questions.length, 1);
  return [
    { id: 'small-json', fileName: 'small-bank.json', text: JSON.stringify(banks[1]), mode: 'json', questions: 1 },
    { id: 'image-json', fileName: 'image-bank.json', text: JSON.stringify(banks[0]), mode: 'json', questions: 7 },
    { id: 'material-text', fileName: 'material.txt', text: (await readFile(new URL('../../../test/dual-platform/fixtures/material.txt', import.meta.url), 'utf8')).replace(/\r\n/g, '\n'), mode: 'normal', questions: 2 },
  ];
}

/** @param {Fixture} fixture */
function fixtureMetadata(fixture) {
  return { id: fixture.id, fileName: fixture.fileName, sha256: createHash('sha256').update(fixture.text).digest('hex'),
    bytes: Buffer.byteLength(fixture.text), expectedQuestions: fixture.questions };
}

/** @param {import('playwright-core').Page} page @param {Fixture} fixture @param {string} _storageKey */
async function measureFixture(page, fixture, _storageKey) {
  const bankName = `阶段A性能-${fixture.id}`;
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-mode').selectOption(fixture.mode);
  await page.locator('#import-save-mode-v59').selectOption('new');
  const parseStart = performance.now();
  await page.locator('#import-file').setInputFiles({ name: fixture.fileName,
    mimeType: fixture.mode === 'json' ? 'application/json' : 'text/plain', buffer: Buffer.from(fixture.text) });
  await page.waitForFunction(text => (/** @type {HTMLTextAreaElement | null} */ (document.querySelector('#import-text')))?.value === text, fixture.text.replace(/\r\n/g, '\n'));
  await page.locator('#parse-import-btn').click();
  await page.waitForFunction(expected => document.querySelectorAll('#import-preview tbody tr').length === expected, fixture.questions);
  assert.equal(await page.locator('#confirm-import-btn').isEnabled(), true, '解析后不能确认导入');
  const parseMs = performance.now() - parseStart;
  await page.locator('#import-bank-name').fill(bankName);
  const commitStart = performance.now();
  await page.locator('#confirm-import-btn').click();
  await page.locator('#active-bank-select option').filter({ hasText: bankName }).waitFor({ state: 'attached' });
  const importCommitMs = performance.now() - commitStart;
  const saveStart = performance.now();
  await page.locator('#save-all-btn').click();
  await page.locator('#app-toast .toast-item.ok').getByText('已保存到本机数据库。', { exact: true }).waitFor({ state: 'visible' });
  const manualSaveMs = performance.now() - saveStart;
  const raw = await page.evaluate(async () => JSON.stringify(await (/** @type {Window & {ShirohaDesktopHost:{invoke(command:string):Promise<unknown>}}} */ (/** @type {unknown} */ (window))).ShirohaDesktopHost.invoke('local_read')));
  assert(raw, '确认导入和手动保存后没有主状态');
  /** @type {{banks?: Array<{name: string, questions?: unknown[]}>}} */
  const saved = JSON.parse(raw);
  const matching = saved.banks?.filter(bank => bank.name === bankName) ?? [];
  assert.equal(matching.length, 1, '样本导入数量不一致');
  assert.equal(matching[0].questions?.length, fixture.questions, '持久化题数不一致');
  // 先完成可练习断言再采样，避免把只出现“成功”提示但数据不可用的运行记为有效样本。
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-source').selectOption('all');
  await page.locator('#practice-type').selectOption('all');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#practice-order').selectOption('sequence');
  await page.locator('#practice-start-mode-v58916').selectOption('from_start');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .question-title').first().waitFor({ state: 'visible' });
  assert.match(await page.locator('#practice-progress').innerText(), new RegExp(`1\\s*/\\s*${fixture.questions}`));
  return { ...fixtureMetadata(fixture), parseMs: Math.round(parseMs), importCommitMs: Math.round(importCommitMs),
    manualSaveMs: Math.round(manualSaveMs), persistedQuestions: matching[0].questions?.length, storedBytes: Buffer.byteLength(raw) };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = server.address();
  assert(address && typeof address !== 'string', '无法取得调试端口');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)));
  return address.port;
}

/** @param {string} value */
function quotePs(value) { return `'${value.replaceAll("'", "''")}'`; }

/** @param {OwnedProcess} owned */
function verifyRoot(owned) {
  assert(owned.child.pid, '启动未返回 PID');
  return `$root=Get-CimInstance Win32_Process -Filter "ProcessId=${owned.child.pid}";
    if(!$root -or $root.ExecutablePath -ne ${quotePs(owned.executable)} -or
      $root.CreationDate.ToUniversalTime() -lt [DateTime]::Parse(${quotePs(owned.earliest)}).ToUniversalTime() -or
      $root.CreationDate.ToUniversalTime() -gt [DateTime]::Parse(${quotePs(owned.latest)}).ToUniversalTime()) {
      throw '测试主进程身份无法确认，拒绝采样或关闭';
    };`;
}

/** @param {string} command */
async function powershell(command) {
  return execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${command}`],
    { encoding: 'utf8', windowsHide: true, timeout: START_TIMEOUT_MS, maxBuffer: MIB_BYTES });
}

/** @param {OwnedProcess} owned */
async function sampleMemory(owned) {
  // 创建时间同时校验父子关系，防止已退出进程的 PID 被无关进程复用后误计入。
  const { stdout } = await powershell(`${verifyRoot(owned)}
    $all=@(Get-CimInstance Win32_Process | Where-Object {$_.CreationDate -ge $root.CreationDate});
    $nodes=@{}; $nodes[[int]$root.ProcessId]=$root;
    do {
      $added=$false;
      foreach($node in $all) {
        $parent=$nodes[[int]$node.ParentProcessId];
        if($parent -and $node.CreationDate -ge $parent.CreationDate -and !$nodes.ContainsKey([int]$node.ProcessId)) {
          $nodes[[int]$node.ProcessId]=$node; $added=$true;
        }
      }
    } while($added);
    $rows=@(foreach($node in $nodes.Values) {
      $p=Get-Process -Id $node.ProcessId -ErrorAction SilentlyContinue;
      if($p -and [Math]::Abs(($p.StartTime.ToUniversalTime()-$node.CreationDate.ToUniversalTime()).TotalMilliseconds) -lt 1) {
        $p | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64;
      }
    }); ConvertTo-Json -InputObject $rows -Compress`);
  /** @type {unknown} */
  const parsed = JSON.parse(stdout);
  assert(Array.isArray(parsed) && parsed.length > 0, '未取得进程内存数据');
  /** @type {ProcessMemory[]} */
  const processes = parsed.map(row => {
    assert(row && typeof row === 'object');
    assert(typeof row.Id === 'number' && typeof row.ProcessName === 'string'
      && typeof row.WorkingSet64 === 'number' && typeof row.PrivateMemorySize64 === 'number', '无效的内存数据');
    return { Id: row.Id, ProcessName: row.ProcessName, WorkingSet64: row.WorkingSet64, PrivateMemorySize64: row.PrivateMemorySize64 };
  });
  assert(processes.some(row => row.Id === owned.child.pid), '主进程在采样期间退出');
  return processes;
}

/** @param {import('node:child_process').ChildProcess} child */
function running(child) {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** @param {OwnedProcess} owned */
async function stopOwned(owned) {
  if (!running(owned.child)) return;
  // 关闭前重新核验可执行文件与启动时间，仅处理本轮自己创建的进程。
  await powershell(`${verifyRoot(owned)} $p=Get-Process -Id $root.ProcessId; [void]$p.CloseMainWindow()`);
  const end = Date.now() + CLOSE_TIMEOUT_MS;
  while (running(owned.child) && Date.now() < end) await delay(POLL_MS);
  if (running(owned.child)) {
    await powershell(`${verifyRoot(owned)} & taskkill.exe /PID $root.ProcessId /T /F; if($LASTEXITCODE -ne 0){throw '结束测试进程失败'}`);
    const forcedEnd = Date.now() + CLOSE_TIMEOUT_MS;
    while (running(owned.child) && Date.now() < forcedEnd) await delay(POLL_MS);
  }
  assert(!running(owned.child), '测试进程仍在运行，保留临时目录');
}

/** @param {string} executable @param {string} profile @param {number} index @param {Fixture | undefined} [fixture] @param {string} [storageKey] */
async function measure(executable, profile, index, fixture, storageKey = '') {
  const port = await availablePort();
  const earliest = new Date().toISOString();
  const start = performance.now();
  const child = spawn(executable, [], {
    stdio: 'ignore', windowsHide: true,
    env: {
      ...process.env,
      SHIROHA_TEST_ROOT: profile,
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port} --disable-background-networking`,
    },
  });
  /** @type {Error | undefined} */
  let launchError;
  child.on('error', error => { launchError = error; });
  /** @type {import('playwright-core').Browser | undefined} */
  let browser;
  const owned = { child, executable, earliest, latest: new Date(Date.now() + START_TIMEOUT_MS).toISOString() };
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    const end = Date.now() + START_TIMEOUT_MS;
    while (true) {
      if (launchError) throw launchError;
      assert(running(child), '测试进程在 CDP 就绪前退出');
      assert(Date.now() < end, '等待 CDP 超时');
      try {
        if ((await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) })).ok) break;
      } catch { /* 启动期间调试端口尚未监听，按固定间隔重试。 */ }
      await delay(POLL_MS);
    }
    browser = await chromium.connectOverCDP(endpoint, { timeout: START_TIMEOUT_MS });
    let page;
    while (!page) {
      assert(Date.now() < end && running(child), '等待 WebView 页面超时');
      page = browser.contexts()[0]?.pages()[0];
      if (!page) await delay(POLL_MS);
    }
    page.setDefaultTimeout(START_TIMEOUT_MS);
    await page.waitForURL('http://tauri.localhost/**');
    await page.waitForLoadState('load');
    const domMs = performance.now() - start;
    await page.locator('.app-splash').waitFor({ state: 'hidden' });
    const visibleMs = performance.now() - start;
    owned.latest = new Date().toISOString();
    await delay(IDLE_MS);
    const processes = await sampleMemory(owned);
    // 辅助诊断放在既有内存采样之后，不改变原有启动与空闲采样口径。
    const diagnostics = await page.evaluate(() => ({ resourceCount: performance.getEntriesByType('resource').length }));
    const session = await page.context().newCDPSession(page);
    const heap = await session.send('Runtime.getHeapUsage');
    await session.detach();
    let fixtureResult;
    if (fixture) {
      const timings = await measureFixture(page, fixture, storageKey);
      await delay(IDLE_MS);
      const afterProcesses = await sampleMemory(owned);
      fixtureResult = { ...timings,
        workingSetMiB: +(afterProcesses.reduce((sum, item) => sum + item.WorkingSet64, 0) / MIB_BYTES).toFixed(1),
        privateMiB: +(afterProcesses.reduce((sum, item) => sum + item.PrivateMemorySize64, 0) / MIB_BYTES).toFixed(1),
        processes: afterProcesses };
    }
    return {
      run: index + 1, profile: fixture || index === 0 ? 'fresh' : 'reused',
      domMs: Math.round(domMs), visibleMs: Math.round(visibleMs),
      workingSetMiB: +(processes.reduce((sum, item) => sum + item.WorkingSet64, 0) / MIB_BYTES).toFixed(1),
      privateMiB: +(processes.reduce((sum, item) => sum + item.PrivateMemorySize64, 0) / MIB_BYTES).toFixed(1),
      processes, diagnostics: { ...diagnostics, jsHeapUsedMiB: +(heap.usedSize / MIB_BYTES).toFixed(2) },
      ...(fixtureResult ? { fixture: fixtureResult } : {}),
    };
  } finally {
    try { await stopOwned(owned); }
    finally { await browser?.close().catch(() => undefined); }
  }
}

assert(process.platform === 'win32', '该测量脚本仅支持 Windows');
const argumentsList = process.argv.slice(2);
const fixturesMode = argumentsList.includes('--fixtures');
const positional = argumentsList.filter(value => value !== '--fixtures');
assert(positional.length <= 2 && !positional.some(value => value.startsWith('--')), '参数：benchmark.mjs [EXE] [报告路径] [--fixtures]');
const executable = await realpath(path.resolve(positional[0] ?? fileURLToPath(new URL('../src-tauri/target/native-test/release/shiroha-quiz-desktop.exe', import.meta.url))));
assert((await stat(executable)).isFile() && path.extname(executable).toLowerCase() === '.exe', '必须提供 EXE 文件');
const output = path.resolve(positional[1] ?? fileURLToPath(new URL(fixturesMode ? '../.reports/performance-fixtures.json' : '../.reports/performance.json', import.meta.url)));
const fixtures = fixturesMode ? await fixedFixtures() : [];
const appSource = fixturesMode ? await readFile(new URL('../../web/app.js', import.meta.url), 'utf8') : '';
const storageKey = appSource.match(/const KEY='([^']+)'/)?.[1] ?? '';
assert(!fixturesMode || storageKey, '找不到基线主状态键，拒绝猜测读取位置');
const temporaryRoot = await realpath(tmpdir());
const profile = await mkdtemp(path.join(temporaryRoot, PROFILE_PREFIX));
await markNativeIsolation(profile);
const profiles = [profile];
const results = [];
let complete = false;
try {
  for (let index = 0; index < RUN_COUNT; index += 1) {
    for (const fixture of fixturesMode ? fixtures : [undefined]) {
      let runProfile = profile;
      if (fixture && results.length > 0) {
        runProfile = await mkdtemp(path.join(temporaryRoot, PROFILE_PREFIX));
        await markNativeIsolation(runProfile);
        profiles.push(runProfile);
      }
      const result = await measure(executable, runProfile, index, fixture, storageKey);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  complete = true;
} finally {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ executable, profile, measuredAt: new Date().toISOString(), complete,
    protocol: { runs: RUN_COUNT, idleMs: IDLE_MS, firstProfile: 'fresh', followingProfiles: fixturesMode ? 'fresh per fixture' : 'reused', debugging: 'CDP', memory: 'entire process tree' },
    ...(fixturesMode ? { fixtures: fixtures.map(fixtureMetadata), profiles,
      executableSha256: createHash('sha256').update(await readFile(executable)).digest('hex'),
      sourceSha256: createHash('sha256').update(appSource).digest('hex') } : {}), results }, null, 2));
  // 失败时保留隔离目录供排查；只删除成功完成且路径验证通过的本次临时目录。
  if (complete) {
    for (const item of profiles) {
      const resolved = await realpath(item);
      assert(path.dirname(resolved).toLowerCase() === temporaryRoot.toLowerCase() && path.basename(resolved).startsWith(PROFILE_PREFIX), '临时目录越界');
      await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    }
  }
}
