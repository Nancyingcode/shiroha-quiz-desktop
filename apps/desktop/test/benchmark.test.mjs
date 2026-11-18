import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir, mkdtemp, readFile, realpath, rm, symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('desktop benchmark examples pass the executable and report directly to pnpm', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const examples = readme.match(/^pnpm run bench:desktop .+\.json$/gm) ?? [];
  assert.equal(examples.length, 2);
  for (const example of examples) {
    assert.match(example, /^pnpm run bench:desktop \S+\.exe \S+\.json$/);
  }
});

test(
  'fixture benchmark reaches an isolated launch and records source metadata',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'shiroha-benchmark-check-'));
    t.after(async () => rm(temporary, { recursive: true, force: true }));
    const profileRoot = path.join(temporary, 'profiles');
    const profileAlias = path.join(temporary, 'profiles-alias');
    await mkdir(profileRoot);
    // 用目录联接复现路径别名，无需依赖文件系统是否生成 8.3 短路径。
    await symlink(await realpath(profileRoot), profileAlias, 'junction');
    const output = path.join(temporary, 'report.json');
    const script = fileURLToPath(new URL('../scripts/benchmark.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, process.execPath, output, '--fixtures'], {
      env: { ...process.env, TEMP: profileAlias, TMP: profileAlias },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
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
    assert.equal(path.dirname(report.profile), await realpath(profileAlias));
  },
);
