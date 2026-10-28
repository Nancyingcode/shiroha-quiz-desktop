import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(desktop, '../..');

test('browser boundaries reject Node globals and var in Web and desktop frontend', async () => {
  const lint = new ESLint({ cwd: root, overrideConfigFile: path.join(desktop, 'eslint.platform.config.mjs') });
  for (const filePath of ['apps/web/platform/probe.js', 'apps/web/training.js', 'apps/desktop/frontend/probe.js']) {
    const [valid] = await lint.lintText('window.document.title = "测试";', { filePath });
    assert.equal(valid.errorCount, 0);
    assert.equal(valid.warningCount, 0, '边界文件不能被忽略');
    const [invalid] = await lint.lintText('var value = process.pid; window.document.title = value;', { filePath });
    assert(invalid.messages.some(message => message.ruleId === 'no-var'));
    assert(invalid.messages.some(message => message.ruleId === 'no-undef'));
  }
});

test('platform lint accepts a CSS-only desktop frontend and still checks nested JavaScript', async t => {
  const reports = path.join(desktop, '.reports');
  await mkdir(reports, { recursive: true });
  const temporary = await mkdtemp(path.join(reports, 'platform-lint-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const directory of ['apps/desktop/scripts', 'apps/desktop/frontend/nested', 'apps/web/platform', 'test/dual-platform']) {
    await mkdir(path.join(temporary, directory), { recursive: true });
  }
  const script = path.join(temporary, 'apps/desktop/scripts/lint-platform.mjs');
  await copyFile(path.join(desktop, 'scripts/lint-platform.mjs'), script);
  await copyFile(path.join(desktop, 'eslint.platform.config.mjs'), path.join(temporary, 'apps/desktop/eslint.platform.config.mjs'));
  await copyFile(path.join(root, 'apps/web/training.js'), path.join(temporary, 'apps/web/training.js'));
  await writeFile(path.join(temporary, 'apps/web/platform/probe.js'), 'window.document.title = "测试";');
  await writeFile(path.join(temporary, 'test/dual-platform/probe.cjs'), 'console.log("fixture");');
  await writeFile(path.join(temporary, 'apps/desktop/frontend/desktop.css'), 'body { color: #223344; }');
  const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true });
  const cssOnly = run();
  assert.ifError(cssOnly.error);
  assert.equal(cssOnly.status, 0, cssOnly.stdout + cssOnly.stderr);
  const probe = path.join(temporary, 'apps/desktop/frontend/nested/probe.js');
  await writeFile(probe, 'var value = process.pid; window.document.title = value;');
  const invalid = run();
  assert.ifError(invalid.error);
  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
  assert.match(invalid.stdout, /no-var/);
  assert.match(invalid.stdout, /no-undef/);
  await writeFile(probe, 'window.document.title = "测试";');
  const valid = run();
  assert.ifError(valid.error);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
});

test('browser typecheck rejects incorrect JSDoc and unavailable Node globals', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shiroha-platform-types-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const probe = path.join(temporary, 'probe.js');
  const config = path.join(temporary, 'tsconfig.json');
  await writeFile(config, JSON.stringify({
    extends: path.join(desktop, 'tsconfig.platform.json'),
    files: [probe], include: [],
  }));
  const run = () => spawnSync(process.execPath, [path.join(desktop, 'node_modules/typescript/bin/tsc'), '-p', config],
    { encoding: 'utf8', windowsHide: true });
  await writeFile(probe, 'window.document.title = "测试";');
  const valid = run();
  assert.ifError(valid.error);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  await writeFile(probe, '/** @type {number} */\nconst value = "invalid";\nwindow.document.title = process.cwd();');
  const invalid = run();
  assert.ifError(invalid.error);
  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
  assert.match(invalid.stdout, /TS2322/);
  assert.match(invalid.stdout, /process/);
});
