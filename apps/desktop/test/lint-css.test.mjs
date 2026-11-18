import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, appendFile, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

/** @param {string} project */
function runCssLint(project) {
  // 夹具借用当前 pnpm 和已安装依赖；避免桌面清单的版本声明生成引导锁或触发安装。
  return spawnSync('pnpm run --silent lint:css', {
    cwd: project,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', PNPM_CONFIG_PM_ON_FAIL: 'ignore' },
  });
}

test('CSS lint limits historical violations to their original files and checks new shared CSS', async (t) => {
  const { temporary } = await repositoryFixture(t);
  const desktop = path.resolve(import.meta.dirname, '..');
  const project = path.join(temporary, 'apps/desktop');
  const localCli = process.platform === 'win32' ? 'stylelint.cmd' : 'stylelint';
  await access(path.join(project, 'node_modules/.bin', localCli));
  for (const dir of ['frontend', '../web/styles/components', '../web/libs', 'dist']) {
    await mkdir(path.join(project, dir), { recursive: true });
  }
  const legacy = ['../web/styles.css', '../web/styles/responsive-artwork.css', 'frontend/desktop.css'];
  for (const file of [...legacy, 'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json']) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  const duplicates = '\n.lint-probe { color: red; }\n.lint-probe { color: blue; }\n';
  for (const file of ['../web/libs/vendor.css', 'dist/generated.css']) {
    await writeFile(path.join(project, file), duplicates);
  }
  const baseline = runCssLint(project);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  await assert.rejects(access(path.join(project, 'pnpm-lock.yaml')), { code: 'ENOENT' });

  for (const file of legacy) { await appendFile(path.join(project, file), duplicates); }
  const fragment = path.join(project, '../web/styles/components/probe.css');
  const source = `${duplicates}.fixable { color: red; color: red; }\n`;
  await writeFile(fragment, source);
  const rejected = runCssLint(project);
  const diagnostics = rejected.stdout + rejected.stderr;
  assert.equal(rejected.status, 2, diagnostics);
  for (const file of [...legacy, fragment]) { assert(diagnostics.includes(path.basename(file)), diagnostics); }
  assert.match(diagnostics, /no-duplicate-selectors/);
  assert.equal(await readFile(fragment, 'utf8'), source);
});

test('CSS lint rejects mixed-case extensions in each handwritten stylesheet directory', async (t) => {
  const { temporary } = await repositoryFixture(t);
  const desktop = path.resolve(import.meta.dirname, '..');
  const project = path.join(temporary, 'apps/desktop');
  for (const dir of ['frontend/nested', '../web/styles/components']) {
    await mkdir(path.join(project, dir), { recursive: true });
  }
  for (const file of [
    '../web/styles.css', '../web/styles/responsive-artwork.css', 'frontend/desktop.css',
    'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json',
  ]) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  for (const file of ['../web/probe.CSS', '../web/styles/components/probe.CsS', 'frontend/nested/probe.cSS']) {
    const target = path.join(project, file);
    await writeFile(target, 'a { colr: red; }\n');
    const result = runCssLint(project);
    const diagnostics = result.stdout + result.stderr;
    assert.equal(result.status, 2, diagnostics);
    assert.match(diagnostics, /property-no-unknown/);
    assert(diagnostics.includes(path.basename(file)), diagnostics);
    await unlink(target);
  }
});

test('CSS lint caps compound selector depth for new component styles', async (t) => {
  const { temporary } = await repositoryFixture(t);
  const desktop = path.resolve(import.meta.dirname, '..');
  const project = path.join(temporary, 'apps/desktop');
  for (const dir of ['frontend', '../web/styles/components']) {
    await mkdir(path.join(project, dir), { recursive: true });
  }
  for (const file of [
    '../web/styles.css', '../web/styles/responsive-artwork.css', 'frontend/desktop.css',
    'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json',
  ]) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  const baseline = runCssLint(project);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);

  const fragment = path.join(project, '../web/styles/components/depth-probe.css');
  await writeFile(fragment, '.lint-a > .lint-b > .lint-c > .lint-d { color: red; }\n');
  const accepted = runCssLint(project);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);

  await writeFile(fragment, '.lint-a > .lint-b > .lint-c > .lint-d > .lint-e { color: red; }\n');
  const rejected = runCssLint(project);
  const diagnostics = rejected.stdout + rejected.stderr;
  assert.equal(rejected.status, 2, diagnostics);
  assert.match(diagnostics, /selector-max-compound-selectors/);
  assert(diagnostics.includes('depth-probe.css'), diagnostics);
});

test('CSS lint resolves shared custom properties across split stylesheets', async (t) => {
  const { temporary } = await repositoryFixture(t);
  const desktop = path.resolve(import.meta.dirname, '..');
  const project = path.join(temporary, 'apps/desktop');
  for (const dir of ['frontend', '../web/styles/components']) {
    await mkdir(path.join(project, dir), { recursive: true });
  }
  const referenced = ['../web/styles.css', '../web/styles/responsive-artwork.css', 'frontend/desktop.css'];
  for (const file of [...referenced, 'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json']) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  const baseline = runCssLint(project);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);

  const fragment = path.join(project, '../web/styles/components/theme-probe.css');
  await writeFile(fragment, '.theme-probe { color: var(--blue3); }\n');
  const accepted = runCssLint(project);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);

  await writeFile(fragment, '.theme-probe { color: var(--bule3); }\n');
  const rejected = runCssLint(project);
  const diagnostics = rejected.stdout + rejected.stderr;
  assert.equal(rejected.status, 2, diagnostics);
  assert.match(diagnostics, /no-unknown-custom-properties/);
  assert(diagnostics.includes('theme-probe.css'), diagnostics);
});

test('CSS lint rejects redundant shorthand values without changing source files', async (t) => {
  const { temporary } = await repositoryFixture(t);
  const desktop = path.resolve(import.meta.dirname, '..');
  const project = path.join(temporary, 'apps/desktop');
  for (const dir of ['frontend/nested', '../web/styles/components']) {
    await mkdir(path.join(project, dir), { recursive: true });
  }
  for (const file of [
    '../web/styles.css', '../web/styles/responsive-artwork.css', 'frontend/desktop.css',
    'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json',
  ]) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  const fragment = path.join(project, '../web/styles/components/shorthand-probe.css');
  const directional = '.directional { padding: 10px 12px; gap: 8px 12px; }\n';
  await writeFile(fragment, directional);
  const accepted = runCssLint(project);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.equal(await readFile(fragment, 'utf8'), directional);

  for (const declaration of [
    'padding: 10px 10px',
    'margin: 0 1px 2px 1px',
    'gap: 8px 8px !important',
    'padding: 10px /* keep comment */ 10px',
  ]) {
    const source = `.redundant { ${declaration}; }\n`;
    await writeFile(fragment, source);
    const rejected = runCssLint(project);
    const diagnostics = rejected.stdout + rejected.stderr;
    assert.equal(rejected.status, 2, `${declaration}\n${diagnostics}`);
    assert.match(diagnostics, /shorthand-property-no-redundant-values/);
    assert(diagnostics.includes('shorthand-probe.css'), diagnostics);
    assert.equal(await readFile(fragment, 'utf8'), source);
  }

  await writeFile(fragment, directional);
  for (const file of [
    '../web/shorthand-root.CSS', '../web/styles/components/shorthand-nested.CsS',
    'frontend/nested/shorthand-desktop.cSS',
  ]) {
    const target = path.join(project, file);
    const source = '.redundant { padding: 10px 10px; }\n';
    await writeFile(target, source);
    const rejected = runCssLint(project);
    const diagnostics = rejected.stdout + rejected.stderr;
    assert.equal(rejected.status, 2, diagnostics);
    assert(diagnostics.includes(path.basename(file)), diagnostics);
    assert.match(diagnostics, /shorthand-property-no-redundant-values/);
    assert.equal(await readFile(target, 'utf8'), source);
    await unlink(target);
  }
});

test('CSS lint rejects unknown animation names in the splash card', async (t) => {
  const { temporary } = await repositoryFixture(t);
  const desktop = path.resolve(import.meta.dirname, '..');
  const project = path.join(temporary, 'apps/desktop');
  for (const dir of ['frontend', '../web/styles']) {
    await mkdir(path.join(project, dir), { recursive: true });
  }
  for (const file of [
    '../web/styles.css', '../web/styles/responsive-artwork.css', '../web/styles/app-shell.css',
    'frontend/desktop.css', 'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json',
  ]) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  const accepted = runCssLint(project);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);

  const fragment = path.join(project, '../web/styles/app-shell.css');
  const source = await readFile(fragment, 'utf8');
  const misspelled = source.replace('animation:splashCardIn ', 'animation:splashCadrIn ');
  assert.notEqual(misspelled, source);
  await writeFile(fragment, misspelled);
  const rejected = runCssLint(project);
  const diagnostics = rejected.stdout + rejected.stderr;
  assert.equal(rejected.status, 2, diagnostics);
  assert.equal((diagnostics.match(/no-unknown-animations/g) ?? []).length, 1, diagnostics);
  assert.match(diagnostics, /splashCadrIn/);
  assert.match(diagnostics, /\b1 problem\b/);
});
