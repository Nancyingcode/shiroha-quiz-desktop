import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

/** @param {string} watched @param {string} marker */
function readWatch(watched, marker) {
  return [
    "import fs from 'node:fs';",
    "import fsp from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    `const watched = ${JSON.stringify(watched)};`,
    `const marker = ${JSON.stringify(marker)};`,
    'const record = fs.writeFileSync.bind(fs);',
    "const methods = [[fs, 'readFile'], [fs, 'readFileSync'], [fs, 'open'], [fs, 'openSync'], [fs, 'createReadStream'], [fsp, 'readFile'], [fsp, 'open']];",
    'for (const [target, name] of methods) {',
    '  const original = target[name];',
    '  target[name] = function(file, ...args) {',
    '    if (String(file) === watched) { record(marker, "read"); }',
    '    return Reflect.apply(original, this, [file, ...args]);',
    '  };',
    '}',
    'syncBuiltinESMExports();',
    '',
  ].join('\n');
}

test('full lint orchestrates one complete JavaScript pass and the independent non-JavaScript checks', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-lint-dedup-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-lint-dedup-'));
    await rm(actual, { recursive: true, force: true });
  });
  const driver = path.join(temp, 'npm-driver.mjs');
  await writeFile(driver, 'console.log(process.argv[3]);\n');
  const runner = fileURLToPath(new URL('../scripts/lint-runner.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [runner], {
    env: { ...process.env, npm_execpath: driver }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/).sort(), [
    'lint:css', 'lint:docs', 'lint:fixtures', 'lint:incremental',
  ]);
});
test('complete lint preserves both legacy scopes for Git-ignored files and desktop-specific configuration', async (t) => {
  const f = await repositoryFixture(t);
  const desktop = path.join(f.temporary, 'apps/desktop');
  await copyFile(new URL('../eslint.config.mjs', import.meta.url), path.join(desktop, 'eslint.config.mjs'));
  await mkdir(path.join(f.temporary, 'apps/web/platform'), { recursive: true });
  await mkdir(path.join(f.temporary, 'test/dual-platform'), { recursive: true });
  await mkdir(path.join(desktop, 'test'), { recursive: true });
  await writeFile(path.join(desktop, 'test/base.mjs'), 'export {};\n');
  await writeFile(path.join(f.temporary, 'apps/web/training.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, '.gitignore'), '*ignored*\n');
  const files = [
    'apps/desktop/scripts/ignored-script.mjs',
    'apps/desktop/test/ignored-test.mjs',
    'apps/web/platform/ignored-platform.js',
    'test/dual-platform/ignored-helper.cjs',
  ];
  for (const file of files) {
    await writeFile(path.join(f.temporary, file), 'var invalid = 1; console.log(invalid);\n');
  }
  const ignored = f.run('lint-incremental.mjs', ['--complete']);
  assert.equal(ignored.status, 1, ignored.stderr + ignored.stdout);
  for (const file of files) { assert(ignored.stdout.includes(path.join(f.temporary, file)), `${file}\n${ignored.stderr}\n${ignored.stdout}`); }
  for (const file of files) { await writeFile(path.join(f.temporary, file), 'export {};\n'); }
  await writeFile(path.join(f.temporary, files[2]), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, files[3]), "console.log('valid');\n");
  const unique = path.join(desktop, 'scripts', 'desktop-only.mjs');
  await writeFile(unique, "console.log('desktop rule');\n");
  await writeFile(path.join(desktop, 'eslint.config.mjs'), [
    "import { createConfig } from './eslint.rules.mjs';",
    "export default [...createConfig({ desktop: true }), { files: ['scripts/desktop-only.mjs'], rules: { 'no-console': 'error' } }];",
    '',
  ].join('\n'));
  const difference = f.run('lint-incremental.mjs', ['--complete']);
  assert.equal(difference.status, 1, difference.stderr + difference.stdout);
  assert.match(difference.stdout, /no-console/);
  assert(difference.stdout.includes(unique));
});

test('case-distinct Git and legacy-only paths both remain in the complete pass', async (t) => {
  const f = await repositoryFixture(t);
  const desktop = path.join(f.temporary, 'apps/desktop');
  await copyFile(new URL('../eslint.config.mjs', import.meta.url), path.join(desktop, 'eslint.config.mjs'));
  await mkdir(path.join(desktop, 'test'), { recursive: true });
  await writeFile(path.join(desktop, 'test/base.mjs'), 'export {};\n');
  await mkdir(path.join(f.temporary, 'apps/web/platform'), { recursive: true });
  await mkdir(path.join(f.temporary, 'test/dual-platform'), { recursive: true });
  await writeFile(path.join(f.temporary, 'apps/web/training.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'apps/web/platform/base.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'test/dual-platform/base.cjs'), "console.log('valid');\n");
  const lower = path.join(desktop, 'scripts/case.mjs');
  const upper = path.join(desktop, 'scripts/CASE.mjs');
  await writeFile(lower, "console.log('valid');\n", { flag: 'wx' });
  try {
    await writeFile(upper, 'var invalid = 1; console.log(invalid);\n', { flag: 'wx' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      t.skip('current temporary directory is case-insensitive');
      return;
    }
    throw error;
  }
  assert.equal(f.git(['config', 'core.ignorecase', 'false']).status, 0);
  await writeFile(path.join(f.temporary, '.gitignore'), '/apps/desktop/scripts/CASE.mjs\n');
  assert.equal(f.git(['add', 'apps/desktop/scripts/case.mjs']).status, 0);
  const listed = f.git(['ls-files', '--cached', '--others', '--exclude-standard']).stdout.replaceAll('\\', '/');
  assert(listed.includes('apps/desktop/scripts/case.mjs'));
  assert(!listed.includes('apps/desktop/scripts/CASE.mjs'));
  const result = f.run('lint-incremental.mjs', ['--complete']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert(result.stdout.includes(upper), result.stderr + result.stdout);
  assert.match(result.stdout, /no-var/);
});

test('desktop-only discovery still rejects an indexed link when platform configuration ignores it', async (t) => {
  const f = await repositoryFixture(t);
  const desktop = path.join(f.temporary, 'apps/desktop');
  await copyFile(new URL('../eslint.config.mjs', import.meta.url), path.join(desktop, 'eslint.config.mjs'));
  await mkdir(path.join(desktop, 'test'), { recursive: true });
  await writeFile(path.join(desktop, 'test/base.mjs'), 'export {};\n');
  await mkdir(path.join(f.temporary, 'apps/web/platform'), { recursive: true });
  await mkdir(path.join(f.temporary, 'test/dual-platform'), { recursive: true });
  await writeFile(path.join(f.temporary, 'apps/web/training.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'apps/web/platform/base.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'test/dual-platform/base.cjs'), "console.log('valid');\n");
  await writeFile(path.join(desktop, 'eslint.platform.config.mjs'), [
    "import { createConfig } from './eslint.rules.mjs';",
    "export default [...createConfig(), { ignores: ['apps/desktop/scripts/only.mjs'] }];",
    '',
  ].join('\n'));
  const file = 'apps/desktop/scripts/only.mjs';
  await writeFile(path.join(f.temporary, file), "console.log('valid');\n");
  const hash = f.git(['hash-object', '-w', file]);
  assert.equal(hash.status, 0, hash.stderr);
  const staged = f.git(['update-index', '--add', '--cacheinfo', `120000,${hash.stdout.trim()},${file}`]);
  assert.equal(staged.status, 0, staged.stderr);
  const result = f.run('lint-incremental.mjs', ['--complete']);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stderr, /非普通 JavaScript 文件/);
});

test('complete discovery rejects an external JavaScript link before ESLint reads it', async (t) => {
  const f = await repositoryFixture(t);
  const desktop = path.join(f.temporary, 'apps/desktop');
  await copyFile(new URL('../eslint.config.mjs', import.meta.url), path.join(desktop, 'eslint.config.mjs'));
  await mkdir(path.join(desktop, 'test'), { recursive: true });
  await writeFile(path.join(desktop, 'test/base.mjs'), 'export {};\n');
  await mkdir(path.join(f.temporary, 'apps/web/platform'), { recursive: true });
  await mkdir(path.join(f.temporary, 'test/dual-platform'), { recursive: true });
  await writeFile(path.join(f.temporary, 'apps/web/training.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'apps/web/platform/base.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'test/dual-platform/base.cjs'), "console.log('valid');\n");
  const tempRoot = await realpath(os.tmpdir());
  const outside = await mkdtemp(path.join(tempRoot, 'shiroha-lint-outside-'));
  t.after(async () => {
    const actual = await realpath(outside);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-lint-outside-'));
    await rm(actual, { recursive: true, force: true });
  });
  const target = path.join(outside, 'target.mjs');
  await mkdir(path.join(desktop, 'scripts/nested'), { recursive: true });
  const link = path.join(desktop, 'scripts/nested/external.mjs');
  await writeFile(target, "console.log('outside');\n");
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const marker = path.join(f.temporary, 'outside-read');
    const hook = path.join(f.temporary, 'read-watch.mjs');
    await writeFile(path.join(f.temporary, '.gitignore'), '/read-watch.mjs\n/outside-read\n');
    await writeFile(hook, readWatch(link, marker));
    const result = spawnSync(process.execPath, [path.join(desktop, 'scripts/lint-incremental.mjs'), '--complete'], {
      cwd: f.temporary, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` },
    });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
    assert.match(result.stderr, /非普通 JavaScript 文件|链接/);
    assert.equal(await readFile(target, 'utf8'), "console.log('outside');\n");
  } finally {
    await rm(link);
  }
});

test('real ESLint discovery reads legacy files through the ordinary-path guard', async (t) => {
  const f = await repositoryFixture(t);
  const desktop = path.join(f.temporary, 'apps/desktop');
  await copyFile(new URL('../eslint.config.mjs', import.meta.url), path.join(desktop, 'eslint.config.mjs'));
  await mkdir(path.join(desktop, 'test'), { recursive: true });
  await mkdir(path.join(f.temporary, 'apps/web/platform'), { recursive: true });
  await mkdir(path.join(f.temporary, 'test/dual-platform'), { recursive: true });
  await writeFile(path.join(desktop, 'test/base.mjs'), 'export {};\n');
  await writeFile(path.join(f.temporary, 'apps/web/training.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'apps/web/platform/base.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'test/dual-platform/base.cjs'), "console.log('valid');\n");
  const watched = path.join(desktop, 'scripts/legacy-only.mjs');
  const marker = path.join(f.temporary, 'guard-observed');
  const hook = path.join(f.temporary, 'guard-watch.mjs');
  await writeFile(watched, 'export {};\n');
  await writeFile(path.join(f.temporary, '.gitignore'), '/apps/desktop/scripts/legacy-only.mjs\n/guard-watch.mjs\n/guard-observed\n');
  await writeFile(hook, [
    "import fs from 'node:fs';",
    "import fsp from 'node:fs/promises';",
    `const watched = ${JSON.stringify(watched)};`,
    `const marker = ${JSON.stringify(marker)};`,
    'const original = fsp.readFile;',
    'fsp.readFile = function(file, ...args) {',
    '  if (String(file) === watched && new Error().stack?.includes("guardedReadFile")) fs.writeFileSync(marker, "guarded");',
    '  return Reflect.apply(original, this, [file, ...args]);',
    '};',
    '',
  ].join('\n'));
  const result = spawnSync(process.execPath, [path.join(desktop, 'scripts/lint-incremental.mjs'), '--complete'], {
    cwd: f.temporary, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(await readFile(marker, 'utf8'), 'guarded');
});

test('legacy discovery skips ignored JavaScript links and directory junctions it does not traverse', async (t) => {
  const f = await repositoryFixture(t);
  const desktop = path.join(f.temporary, 'apps/desktop');
  await mkdir(path.join(desktop, 'test'), { recursive: true });
  await writeFile(path.join(desktop, 'test/base.mjs'), 'export {};\n');
  await mkdir(path.join(f.temporary, 'apps/web/platform'), { recursive: true });
  await mkdir(path.join(f.temporary, 'test/dual-platform'), { recursive: true });
  await writeFile(path.join(f.temporary, 'apps/web/training.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'apps/web/platform/base.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'test/dual-platform/base.cjs'), "console.log('valid');\n");
  await writeFile(path.join(desktop, 'eslint.config.mjs'), [
    "import { createConfig } from './eslint.rules.mjs';",
    "export default [...createConfig({ desktop: true }), { ignores: ['scripts/ignored.mjs', 'scripts/ignored.mjs/**', 'scripts/assets/**'] }];",
    '',
  ].join('\n'));
  await writeFile(path.join(desktop, 'eslint.platform.config.mjs'), [
    "import { createConfig } from './eslint.rules.mjs';",
    "export default [...createConfig(), { ignores: ['apps/desktop/scripts/ignored.mjs', 'apps/desktop/scripts/ignored.mjs/**', 'apps/desktop/scripts/assets/**'] }];",
    '',
  ].join('\n'));
  const tempRoot = await realpath(os.tmpdir());
  const outside = await mkdtemp(path.join(tempRoot, 'shiroha-lint-skipped-'));
  t.after(async () => {
    const actual = await realpath(outside);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-lint-skipped-'));
    await rm(actual, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, 'bad.mjs'), 'var broken = 1; console.log(broken);\n');
  const links = ['node_modules', 'assets', 'ignored.mjs'].map((name) => path.join(desktop, 'scripts', name));
  try {
    for (const link of links) { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
    const result = f.run('lint-incremental.mjs', ['--complete']);
    assert.equal(result.status, 0, result.stderr + result.stdout);
  } finally {
    for (const link of links) { await rm(link, { force: true }); }
  }
});

test('filename-specific ignore patterns cannot make an external junction safe', async (t) => {
  const f = await repositoryFixture(t);
  const desktop = path.join(f.temporary, 'apps/desktop');
  await mkdir(path.join(desktop, 'test'), { recursive: true });
  await writeFile(path.join(desktop, 'test/base.mjs'), 'export {};\n');
  await mkdir(path.join(f.temporary, 'apps/web/platform'), { recursive: true });
  await mkdir(path.join(f.temporary, 'test/dual-platform'), { recursive: true });
  await writeFile(path.join(f.temporary, 'apps/web/training.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'apps/web/platform/base.js'), "console.log('valid');\n");
  await writeFile(path.join(f.temporary, 'test/dual-platform/base.cjs'), "console.log('valid');\n");
  for (const [file, desktopMode] of /** @type {Array<[string, boolean]>} */ ([['eslint.config.mjs', true], ['eslint.platform.config.mjs', false]])) {
    await writeFile(path.join(desktop, file), [
      "import { createConfig } from './eslint.rules.mjs';",
      `export default [...createConfig(${desktopMode ? '{ desktop: true }' : ''}), { ignores: ['**/__lint_probe__.*'] }];`,
      '',
    ].join('\n'));
  }
  const tempRoot = await realpath(os.tmpdir());
  const outside = await mkdtemp(path.join(tempRoot, 'shiroha-lint-probe-'));
  t.after(async () => {
    const actual = await realpath(outside);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-lint-probe-'));
    await rm(actual, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, 'bad.mjs'), 'var broken = 1; console.log(broken);\n');
  const link = path.join(desktop, 'scripts', 'external-directory');
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const marker = path.join(f.temporary, 'outside-read');
    const hook = path.join(f.temporary, 'read-watch.mjs');
    await writeFile(path.join(f.temporary, '.gitignore'), '/read-watch.mjs\n/outside-read\n');
    await writeFile(hook, readWatch(path.join(link, 'bad.mjs'), marker));
    const result = spawnSync(process.execPath, [path.join(desktop, 'scripts/lint-incremental.mjs'), '--complete'], {
      cwd: f.temporary, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` },
    });
    assert.equal(result.status, 1, result.stderr + result.stdout);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
    assert.match(result.stderr, /无法检查链接/);
  } finally {
    await rm(link);
  }
});

test('read watcher observes synchronous, callback, stream and promise file access', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-read-watch-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-read-watch-'));
    await rm(actual, { recursive: true, force: true });
  });
  const file = path.join(temp, 'sample.js');
  const marker = path.join(temp, 'observed');
  const hook = path.join(temp, 'watch.mjs');
  await writeFile(file, 'fixture');
  await writeFile(hook, readWatch(file, marker));
  const source = [
    "import fs from 'node:fs';",
    "import fsp from 'node:fs/promises';",
    'const file = process.argv[1]; const marker = process.argv[2];',
    'async function check(action) { await action(); if (!fs.existsSync(marker)) throw new Error("access not observed"); fs.unlinkSync(marker); }',
    'await check(() => fs.readFileSync(file));',
    'await check(() => new Promise((resolve, reject) => fs.readFile(file, (error) => error ? reject(error) : resolve())));',
    'await check(() => fsp.readFile(file));',
    'await check(() => { const fd = fs.openSync(file, "r"); fs.closeSync(fd); });',
    'await check(() => new Promise((resolve, reject) => fs.open(file, "r", (error, fd) => { if (error) reject(error); else { fs.closeSync(fd); resolve(); } })));',
    'await check(async () => { const handle = await fsp.open(file, "r"); await handle.close(); });',
    'await check(async () => { for await (const _chunk of fs.createReadStream(file)) {} });',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, file, marker], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` },
  });
  assert.equal(result.status, 0, result.stderr);
});
