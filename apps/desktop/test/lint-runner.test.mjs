import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runChecks } from '../scripts/lint-runner.mjs';

test('independent lint checks start together and wait for each other', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temporary = await mkdtemp(path.join(tempRoot, 'shiroha-lint-parallel-'));
  t.after(async () => {
    const actual = await realpath(temporary);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-lint-parallel-'));
    await rm(actual, { recursive: true, force: true });
  });
  const worker = path.join(temporary, 'worker.mjs');
  await writeFile(worker, [
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import path from 'node:path';",
    'const [directory, own, other] = process.argv.slice(2);',
    "writeFileSync(path.join(directory, own), 'ready');",
    'const deadline = Date.now() + 15000;',
    'while (!existsSync(path.join(directory, other)) && Date.now() < deadline) {',
    '  await new Promise((resolve) => setTimeout(resolve, 20));',
    '}',
    'if (!existsSync(path.join(directory, other))) { process.exitCode = 1; }',
    '',
  ].join('\n'));
  const checks = [
    { name: 'first', command: process.execPath, args: [worker, temporary, 'first', 'second'] },
    { name: 'second', command: process.execPath, args: [worker, temporary, 'second', 'first'] },
  ];
  assert.equal(await runChecks(checks, { cwd: temporary, stdio: 'ignore' }), true);
});

test('a failing or unavailable lint check fails the combined result', async () => {
  const passing = { name: 'pass', command: process.execPath, args: ['-e', 'process.exit(0)'] };
  const failing = { name: 'fail', command: process.execPath, args: ['-e', 'process.exit(7)'] };
  /** @type {string[]} */
  const failures = [];
  const reportFailure = (/** @type {string} */ message) => { failures.push(message); };
  assert.equal(await runChecks([passing, failing], { stdio: 'ignore', reportFailure }), false);
  assert.equal(await runChecks([{ name: 'missing', command: 'shiroha-nonexistent-command', args: [] }], {
    stdio: 'ignore', reportFailure,
  }), false);
  assert.match(failures[0], /fail.*7/);
  assert.match(failures[1], /missing.*无法启动/);
});

test('parallel checks leave the commit message on standard input untouched', () => {
  const script = [
    'const { runChecks } = await import(process.argv[1]);',
    "const child = 'process.stdin.on(\"data\", () => { process.exitCode = 1; });';",
    "const checks = [{ name: 'stdin', command: process.execPath, args: ['-e', child] }];",
    'const passed = await runChecks(checks);',
    'const chunks = [];',
    'for await (const chunk of process.stdin) { chunks.push(chunk); }',
    "if (!passed || Buffer.concat(chunks).toString() !== 'commit message\\n') { process.exitCode = 1; }",
  ].join('\n');
  const runner = new URL('../scripts/lint-runner.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, runner], {
    input: 'commit message\n', encoding: 'utf8', windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
