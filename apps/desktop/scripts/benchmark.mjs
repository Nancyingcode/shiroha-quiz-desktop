import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
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
const PROFILE_PREFIX = 'shiroha-desktop-perf-';
const execute = promisify(execFile);

/** @typedef {{Id: number, ProcessName: string, WorkingSet64: number, PrivateMemorySize64: number}} ProcessMemory */
/** @typedef {{child: import('node:child_process').ChildProcess, executable: string, earliest: string, latest: string}} OwnedProcess */

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

/** @param {string} executable @param {string} profile @param {number} index */
async function measure(executable, profile, index) {
  const port = await availablePort();
  const earliest = new Date().toISOString();
  const start = performance.now();
  const child = spawn(executable, [], {
    stdio: 'ignore', windowsHide: true,
    env: {
      ...process.env,
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
    return {
      run: index + 1, profile: index === 0 ? 'fresh' : 'reused',
      domMs: Math.round(domMs), visibleMs: Math.round(visibleMs),
      workingSetMiB: +(processes.reduce((sum, item) => sum + item.WorkingSet64, 0) / MIB_BYTES).toFixed(1),
      privateMiB: +(processes.reduce((sum, item) => sum + item.PrivateMemorySize64, 0) / MIB_BYTES).toFixed(1),
      processes, diagnostics: { ...diagnostics, jsHeapUsedMiB: +(heap.usedSize / MIB_BYTES).toFixed(2) },
    };
  } finally {
    try { await stopOwned(owned); }
    finally { await browser?.close().catch(() => undefined); }
  }
}

assert(process.platform === 'win32', '该测量脚本仅支持 Windows');
const executable = await realpath(path.resolve(process.argv[2] ?? fileURLToPath(new URL('../src-tauri/target/release/shiroha-quiz-desktop.exe', import.meta.url))));
assert((await stat(executable)).isFile() && path.extname(executable).toLowerCase() === '.exe', '必须提供 EXE 文件');
const output = path.resolve(process.argv[3] ?? fileURLToPath(new URL('../.reports/performance.json', import.meta.url)));
const temporaryRoot = await realpath(tmpdir());
const profile = await mkdtemp(path.join(temporaryRoot, PROFILE_PREFIX));
const results = [];
let complete = false;
try {
  for (let index = 0; index < RUN_COUNT; index += 1) {
    const result = await measure(executable, profile, index);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  complete = true;
} finally {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ executable, profile, measuredAt: new Date().toISOString(), complete, protocol: { runs: RUN_COUNT, idleMs: IDLE_MS, firstProfile: 'fresh', followingProfiles: 'reused', debugging: 'CDP', memory: 'entire process tree' }, results }, null, 2));
  // 失败时保留隔离目录供排查；只删除成功完成且路径验证通过的本次临时目录。
  if (complete) {
    const resolved = await realpath(profile);
    assert(path.dirname(resolved).toLowerCase() === temporaryRoot.toLowerCase() && path.basename(resolved).startsWith(PROFILE_PREFIX), '临时目录越界');
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}
