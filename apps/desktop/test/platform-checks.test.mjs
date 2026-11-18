import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
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
    const [valid] = await lint.lintText("window.document.title = '测试';\n", { filePath });
    assert.equal(valid.errorCount, 0);
    assert.equal(valid.warningCount, 0, '边界文件不能被忽略');
    const [invalid] = await lint.lintText('var value = process.pid; window.document.title = value;', { filePath });
    assert(invalid.messages.some((message) => message.ruleId === 'no-var'));
    assert(invalid.messages.some((message) => message.ruleId === 'no-undef'));
  }
});

test('platform lint accepts a CSS-only desktop frontend and still checks nested JavaScript', async (t) => {
  const reports = path.join(desktop, '.reports');
  await mkdir(reports, { recursive: true });
  const temporary = await mkdtemp(path.join(reports, 'platform-lint-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const directory of [
    'apps/desktop/scripts', 'apps/desktop/frontend/nested', 'apps/web/platform', 'test/dual-platform',
  ]) {
    await mkdir(path.join(temporary, directory), { recursive: true });
  }
  const script = path.join(temporary, 'apps/desktop/scripts/lint-platform.mjs');
  await copyFile(path.join(desktop, 'scripts/lint-platform.mjs'), script);
  const configs = ['eslint.platform.config.mjs', 'eslint.rules.mjs', 'eslint.migration.mjs', 'eslint.readability.mjs'];
  for (const name of configs) {
    await copyFile(path.join(desktop, name), path.join(temporary, 'apps/desktop', name));
  }
  await copyFile(path.join(root, 'apps/web/training.js'), path.join(temporary, 'apps/web/training.js'));
  const panel = path.join(temporary, 'apps/web/ai-import-panel.js');
  const sessions = path.join(temporary, 'apps/web/study-sessions.js');
  const browserStorage = path.join(temporary, 'apps/web/platform/browser.js');
  await writeFile(panel, "console.log('valid');\n");
  await writeFile(sessions, "console.log('valid');\n");
  await writeFile(browserStorage, "console.log('valid');\n");
  await writeFile(path.join(temporary, 'apps/web/platform/probe.js'), "window.document.title = '测试';\n");
  await writeFile(path.join(temporary, 'test/dual-platform/probe.cjs'), "console.log('fixture');\n");
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
  await writeFile(probe, "window.document.title = '测试';\n");
  const valid = run();
  assert.ifError(valid.error);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);

  await t.test('checks the AI import panel shadowing pilot without rewriting source', async () => {
    const shadowed = [
      "const value = 'outer';",
      'function printValue() {',
      "  const value = 'inner';",
      '  console.log(value);',
      '}',
      'printValue();',
      'console.log(value);',
      '',
    ].join('\n');
    await writeFile(panel, shadowed);
    const rejected = run();
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stdout, /ai-import-panel\.js/);
    assert.match(rejected.stdout, /no-shadow/);
    assert.equal(await readFile(panel, 'utf8'), shadowed);
    const renamed = shadowed.replace("const value = 'inner';", "const innerValue = 'inner';")
      .replace('  console.log(value);', '  console.log(innerValue);');
    await writeFile(panel, renamed);
    const accepted = run();
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.equal(await readFile(panel, 'utf8'), renamed);
  });
  await t.test('checks both state modules against the complexity pilot', async () => {
    const branchy = [
      'function branchy(value) {',
      ...Array.from({ length: 16 }, (_, index) => `  if (value === ${index}) {\n    return ${index};\n  }`),
      '  return -1;',
      '}',
      'console.log(branchy(1));',
      '',
    ].join('\n');
    for (const file of [sessions, browserStorage]) {
      await writeFile(file, branchy);
      const rejected = run();
      assert.ifError(rejected.error);
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert(rejected.stdout.includes(path.basename(file)), rejected.stdout);
      assert.match(rejected.stdout, /complexity/);
      assert.equal(await readFile(file, 'utf8'), branchy);
      await writeFile(file, "console.log('valid');\n");
    }
    const accepted = run();
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  });
  await t.test('rejects a linked AI import panel before reading it', async () => {
    const linked = path.join(temporary, 'linked-target');
    await mkdir(linked);
    await writeFile(path.join(linked, 'probe.js'), "console.log('fixture');\n");
    await unlink(panel);
    await symlink(linked, panel, 'junction');
    const rejected = run();
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stderr, /无法检查链接/);
    assert.match(rejected.stderr, /ai-import-panel\.js/);
  });
});

test('browser typecheck rejects incorrect JSDoc and unavailable Node globals', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shiroha-platform-types-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const probe = path.join(temporary, 'probe.js');
  const config = path.join(temporary, 'tsconfig.json');
  await writeFile(config, JSON.stringify({
    extends: path.join(desktop, 'tsconfig.platform.json'),
    files: [probe],
    include: [],
  }));
  const run = () => spawnSync(
    process.execPath,
    [path.join(desktop, 'node_modules/typescript/bin/tsc'), '-p', config],
    { encoding: 'utf8', windowsHide: true },
  );
  await writeFile(probe, "window.document.title = '测试';\n");
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
