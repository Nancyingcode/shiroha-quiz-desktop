import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createGuardedRelay, validateCandidate } from './guard.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXPECTED_HASH = 'bc404638e5e55af4030f93ed73dadc68a7ca2b7eb5df6613b07ab3510061b309';
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const CASE_TIMEOUT_MS = 25_000;
const FAKE_KEY = 'shiroha-stdio-fake-key-never-real';
const FAKE_AUTH_TOKEN = 'shiroha-stdio-fake-auth-never-real';
const RESPONSE_TEXT = '{"ok":true,"text":"白羽测试"}';
const CASES = ['stop', 'length', 'content_filter', 'eof', 'done_only', 'malformed', 'tool', 'cancel', 'timeout', 'password', 'interrupt'];

function environment(dirs, endpoint) {
  return {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    PATH: path.join(process.env.SystemRoot, 'System32'),
    HOME: dirs.home, USERPROFILE: dirs.home, APPDATA: dirs.appdata,
    LOCALAPPDATA: dirs.localappdata, TEMP: dirs.temp, TMP: dirs.temp,
    CODEBUDDY_CONFIG_DIR: dirs.config, CODEBUDDY_DATA_ROOT: dirs.data,
    CODEBUDDY_CREDENTIALS_IN_MEMORY: '1', DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    CODEBUDDY_SKIP_BUILTIN_MARKETPLACE: '1', CODEBUDDY_DISABLE_PLUGIN_INSTALLS: '1',
    CODEBUDDY_API_KEY_HELPER_DISABLED: '1', CODEBUDDY_DISABLE_PARENT_MEMORY: '1',
    CODEBUDDY_DISABLE_AUTO_MEMORY: '1', CODEBUDDY_CODE_DISABLE_AUTO_MEMORY: '1',
    CODEBUDDY_DISABLE_SYSTEM_REMINDER_MD: '1', CODEBUDDY_MEMORY_RELEVANCE_DISABLED: '1',
    CODEBUDDY_MEMORY_EXTRACTION_DISABLED: '1', CBC_ENABLE_FUNCTION_HOOKS: '0',
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '0', CODEBUDDY_CODE_DISABLE_SESSION_SUMMARY: '1',
    CODEBUDDY_CODE_DISABLE_TERMINAL_TITLE: '1', CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1',
    CODEBUDDY_DISABLE_TRACE_COLLECTOR: '1', CODEBUDDY_DISABLE_SHELL_SNAPSHOT: '1',
    CODEBUDDY_CODE_MAX_TURNS: '1', CODEBUDDY_MAX_RETRIES: '0',
    CODEBUDDY_BASE_URL: endpoint, CODEBUDDY_API_KEY: FAKE_KEY,
    HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
    LANG: 'zh_CN.UTF-8', NO_COLOR: '1',
  };
}

function argumentsFor(inputFormat = 'text') {
  return ['-p', '--input-format', inputFormat, '--output-format', 'stream-json',
    '--include-partial-messages', '--tools', '', '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'none',
    '--no-plugin-management', '--no-session-persistence', '--permission-mode', 'dontAsk',
    '--max-turns', '1', '--model', 'poc-model', '--system-prompt', 'Return the requested JSON.'];
}

async function listeningPorts(pid) {
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = `$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen | Where-Object OwningProcess -eq ${pid} | Select-Object LocalAddress,LocalPort) | ConvertTo-Json -Compress`;
  const { stdout } = await promisify(execFile)(powershell,
    ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 12_000 });
  return stdout.trim() ? [JSON.parse(stdout)].flat() : [];
}

async function scanMarkers(directory, markers) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, 'Refuse traversal outside isolated files');
    if (entry.isDirectory()) matches.push(...await scanMarkers(full, markers));
    else if (entry.isFile()) {
      const bytes = await readFile(full);
      if (markers.some(marker => bytes.includes(Buffer.from(marker)))) matches.push(full);
    }
  }
  return matches;
}

function sendChunk(response, delta, finishReason = null) {
  response.write(`data: ${JSON.stringify({ id: 'synthetic-completion', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
}

async function runCase(executable, runRoot, scenario, guarded = false) {
  const isolated = path.join(runRoot, scenario);
  const dirs = Object.fromEntries(['home', 'config', 'data', 'appdata', 'localappdata', 'temp', 'work']
    .map(key => [key, path.join(isolated, key)]));
  await Promise.all(Object.values(dirs).map(dir => mkdir(dir, { recursive: true })));
  const marker = `SHIROHA_STDIO_${scenario.toUpperCase()}_SYNTHETIC`;
  const calls = [];
  const events = [];
  const serverErrors = [];
  const controlResponses = [];
  const usesControlProtocol = scenario === 'interrupt';
  let child;
  let processClosed = false;
  let stopReason;
  let outputBytes = 0;
  let stdout = '';
  let stderr = '';
  let ports;
  const localRoutes = [];
  let connectionClosed = false;
  let connectionClosedBeforeCleanup;
  let cleanupPromise;
  let rejectClosed;
  let responseTimer;
  let controlBuffer = '';
  let sessionId = '';
  const prompt = `合成题目 ${marker}。Return ${RESPONSE_TEXT}`;
  const sendControl = subtype => child.stdin.write(`${JSON.stringify({
    type: 'control_request', request_id: `probe-${subtype}`,
    request: { subtype, hasPrompt: false, session_id: sessionId },
  })}\n`);
  const consumeControlLine = line => {
    let event;
    try { event = JSON.parse(line); }
    catch { events.push({ invalid: 'non-JSON control output' }); return; }
    if (event.type === 'control_response') {
      const response = event.response;
      // Authentication replies may contain tokens, so raw control responses never enter evidence.
      const summary = { request_id: response?.request_id, subtype: response?.subtype,
        fields: Object.keys(response?.response ?? {}),
        hasAccount: Boolean(response?.response?.account?.userId),
        interrupted: response?.response?.interrupted };
      controlResponses.push(summary);
      events.push({ type: 'control_response', response: summary });
      if (response?.subtype !== 'success') { stop('control-error'); return; }
      if (response.request_id === 'probe-initialize') sendControl('get_auth_methods');
      else if (response.request_id === 'probe-get_auth_methods') sendControl('logout');
      else if (response.request_id === 'probe-logout') child.stdin.write(`${JSON.stringify({
        type: 'user', session_id: '', message: { role: 'user', content: prompt }, parent_tool_use_id: null,
      })}\n`);
      return;
    }
    if (event.type === 'control_request') {
      events.push({ type: 'control_request', subtype: event.request?.subtype });
      stop('unexpected-control-request');
      return;
    }
    events.push(event);
    if (event.session_id) sessionId = event.session_id;
    if (event.type === 'result') {
      child.stdin.end();
      responseTimer = setTimeout(() => stop('stdin-close-fallback'), 2_000);
    }
  };

  // Only this invocation owns this PID. Never search for or stop other CodeBuddy processes.
  const stop = reason => {
    if (processClosed || cleanupPromise || !child?.pid) return;
    stopReason = reason;
    cleanupPromise = promisify(execFile)(path.join(process.env.SystemRoot, 'System32/taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 })
      .catch(error => {
        if (!processClosed) {
          serverErrors.push(`Process cleanup failed: ${error.code}`);
          child.kill();
          rejectClosed?.(new Error('Process tree cleanup could not be confirmed'));
        }
      });
  };

  const handle = async (request, response) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      assert.ok(size <= MAX_REQUEST_BYTES, 'Mock request exceeded limit');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    calls.push({ url: request.url, method: request.method, body });
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    response.on('close', () => { connectionClosed = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': synthetic local fixture\n\n');
    if (calls.length === 1) {
      ports = await listeningPorts(child.pid);
      for (const port of ports) {
        assert.equal(port.LocalAddress, '127.0.0.1', 'Unexpected CLI listen address');
        for (const route of ['/api/v1/info', '/internal/hooks/services/invoke']) {
          // No service ID or account is provided; the proxy request must stop at parameter validation.
          const result = await fetch(`http://127.0.0.1:${port.LocalPort}${route}`, {
            headers: route === '/api/v1/info' ? { 'x-codebuddy-request': '1' } : {},
            signal: AbortSignal.timeout(2_000),
          });
          const body = await result.json();
          localRoutes.push({ route, status: result.status,
            errorCode: body.error?.code ?? body.code ?? null,
            gatewayMode: body.data?.gatewayMode });
        }
      }
    }
    if (usesControlProtocol) {
      responseTimer = setTimeout(() => sendControl('interrupt'), 100);
      return;
    }
    if (scenario === 'cancel' || scenario === 'timeout') {
      responseTimer = setTimeout(() => stop(scenario), scenario === 'cancel' ? 100 : 1_500);
      return;
    }
    if (scenario === 'tool' && calls.length === 1) {
      sendChunk(response, { role: 'assistant', tool_calls: [{ index: 0, id: 'synthetic-write',
        type: 'function', function: { name: 'Write', arguments: JSON.stringify({
          file_path: path.join(dirs.work, 'tool-sentinel.txt'), content: 'TOOL_MUST_NOT_RUN',
        }) } }] });
      sendChunk(response, {}, 'tool_calls');
      response.end('data: [DONE]\n\n');
      return;
    }
    sendChunk(response, { role: 'assistant' });
    sendChunk(response, { content: RESPONSE_TEXT });
    if (scenario === 'eof') { response.end(); return; }
    if (scenario === 'done_only') { response.end('data: [DONE]\n\n'); return; }
    if (scenario === 'malformed') { response.end('data: {broken\n\n'); return; }
    const finishReason = ['length', 'content_filter'].includes(scenario) ? scenario : 'stop';
    sendChunk(response, {}, finishReason);
    response.end('data: [DONE]\n\n');
  };
  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      serverErrors.push(error.message);
      response.destroy();
      stop('probe-error');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  let timer;
  let exit;
  let relay;
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    if (guarded) relay = await createGuardedRelay(endpoint, scenario === 'auth-token' ? FAKE_AUTH_TOKEN : FAKE_KEY);
    const env = environment(dirs, relay?.endpoint ?? endpoint);
    if (scenario === 'auth-token') {
      delete env.CODEBUDDY_API_KEY;
      env.CODEBUDDY_AUTH_TOKEN = FAKE_AUTH_TOKEN;
    }
    if (relay) env.CODEBUDDY_CUSTOM_HEADERS = `x-shiroha-run: ${relay.headers['x-shiroha-run']}`;
    if (scenario === 'password') {
      env.CODEBUDDY_GATEWAY_AUTH = 'password';
      env.CODEBUDDY_GATEWAY_PASSWORD = 'synthetic-gateway-password-never-real';
    }
    child = spawn(executable, argumentsFor(usesControlProtocol ? 'stream-json' : 'text'), {
      cwd: dirs.work, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const closed = new Promise((resolve, reject) => {
      rejectClosed = reject;
      child.once('error', reject);
      child.once('close', (code, signal) => {
        processClosed = true;
        resolve({ code, signal });
      });
    });
    timer = setTimeout(() => stop('watchdog'), CASE_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const collect = (stream, chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) { stop('output-limit'); return; }
      if (stream === 'stdout' && usesControlProtocol) {
        controlBuffer += chunk;
        while (controlBuffer.includes('\n')) {
          const end = controlBuffer.indexOf('\n');
          const line = controlBuffer.slice(0, end).trim();
          controlBuffer = controlBuffer.slice(end + 1);
          if (line) consumeControlLine(line);
        }
      }
      else if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.stdin.on('error', () => {});
    if (usesControlProtocol) sendControl('initialize');
    else child.stdin.end(prompt);
    exit = await closed;
    await cleanupPromise;
    if (!connectionClosed) await new Promise(resolve => setTimeout(resolve, 100));
    connectionClosedBeforeCleanup = connectionClosed;
  } finally {
    clearTimeout(timer);
    clearTimeout(responseTimer);
    stop('finally');
    await cleanupPromise;
    await relay?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  for (const line of stdout.split(/\r?\n/).filter(line => line.trim())) {
    try { events.push(JSON.parse(line)); }
    catch { events.push({ invalid: line }); }
  }
  const results = events.filter(event => event.type === 'result');
  const assistants = events.filter(event => event.type === 'assistant');
  const partials = events.filter(event => event.type === 'stream_event');
  const markers = [marker, FAKE_KEY, FAKE_AUTH_TOKEN, RESPONSE_TEXT, 'TOOL_MUST_NOT_RUN'];
  if (relay) markers.push(relay.headers['x-shiroha-run']);
  const markerFiles = await scanMarkers(isolated, markers);
  let toolFileExists = false;
  try { await access(path.join(dirs.work, 'tool-sentinel.txt')); toolFileExists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const modelCalls = calls.filter(call => call.method === 'POST' && call.url === '/chat/completions');
  const observation = {
    scenario, exit, stopReason: stopReason ?? null, ports, localRoutes,
    connectionClosedBeforeCleanup, controlResponses, toolFileExists,
    requestCount: modelCalls.length, unexpectedRoutes: calls.length - modelCalls.length,
    toolsAdvertised: modelCalls.some(call => JSON.parse(call.body).tools?.length > 0),
    parentRulesSent: modelCalls.some(call => /AGENTS\.md|always_applied_workspace_rules/.test(call.body)),
    result: results.map(event => ({ subtype: event.subtype, is_error: event.is_error,
      result: event.result, terminal_reason: event.terminal_reason ?? null })),
    assistantStops: assistants.map(event => event.message?.stop_reason),
    partialStops: partials.map(event => event.event?.delta?.stop_reason).filter(value => value !== undefined),
    eventTypes: [...new Set(events.map(event => event.type ?? 'invalid'))],
    markerFiles: markerFiles.map(file => path.relative(isolated, file)), serverErrors,
    ...(relay ? { guard: { ...relay.evidence(), candidate: validateCandidate(events, relay.evidence(),
      Boolean(stopReason) || exit.code !== 0) } } : {}),
  };
  await writeFile(path.join(runRoot, `${scenario}.json`), JSON.stringify({ observation, events, stderr, calls }, null, 2));
  console.log(JSON.stringify(observation));
  assert.deepEqual(serverErrors, [], 'Probe infrastructure failed');
  assert.ok(modelCalls.length > 0, 'No local model request observed');
  assert.notEqual(stopReason, 'watchdog', 'Probe exceeded watchdog deadline');
  return observation;
}

async function main() {
  assert.equal(process.platform, 'win32', 'This probe targets the fixed Windows executable');
  const executable = path.resolve(process.argv[2] ?? path.join(ROOT, '.reports/codebuddy-cli-stdio/runtime/codebuddy.exe'));
  assert.equal(createHash('sha256').update(await readFile(executable)).digest('hex'), EXPECTED_HASH);
  const guarded = process.argv.includes('--guarded');
  const requested = process.argv[3] === '--guarded' ? undefined : process.argv[3];
  if (requested) assert.ok(CASES.includes(requested) || requested === 'auth-token', 'Unknown scenario');
  const runRoot = path.join(ROOT, '.reports/codebuddy-cli-stdio', `run-${guarded ? 'guarded-' : ''}${Date.now()}`);
  await mkdir(runRoot, { recursive: true });
  const observations = [];
  const scenarios = guarded ? CASES.filter(name => name !== 'password') : CASES;
  for (const scenario of requested ? [requested] : scenarios) {
    observations.push(await runCase(executable, runRoot, scenario, guarded));
  }
  await writeFile(path.join(runRoot, 'summary.json'), JSON.stringify({
    executableHash: EXPECTED_HASH, observations,
    meaning: 'Probe execution only; not approval of production integration or subscription authentication',
  }, null, 2));
  console.log(`Evidence: ${runRoot}`);
}

await main();
