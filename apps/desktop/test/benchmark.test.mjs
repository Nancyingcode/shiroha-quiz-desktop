import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('fixture benchmark reaches an isolated launch and records source metadata', { skip: process.platform !== 'win32' }, async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'shiroha-benchmark-check-'));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, 'report.json');
  const script = fileURLToPath(new URL('../scripts/benchmark.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, process.execPath, output, '--fixtures'], {
    env: { ...process.env, TEMP: temporary, TMP: temporary }, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /测试进程在 CDP 就绪前退出/);
  /** @type {{complete:boolean,results:unknown[],fixtures:Array<{expectedQuestions:number}>,sourceSha256:string,profile:string}} */
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.complete, false);
  assert.equal(report.results.length, 0);
  assert.deepEqual(report.fixtures.map((item) => item.expectedQuestions), [1, 7, 2]);
  const source = await readFile(new URL('../../web/app.js', import.meta.url), 'utf8');
  assert.equal(report.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(path.dirname(report.profile).toLowerCase(), temporary.toLowerCase());
});
