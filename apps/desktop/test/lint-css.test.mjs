import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

test('CSS lint limits historical violations to their original files and checks new shared CSS', async (t) => {
  const { temporary } = await repositoryFixture(t);
  const desktop = path.resolve(import.meta.dirname, '..');
  const project = path.join(temporary, 'apps/desktop');
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
  const runLint = () => spawnSync('npm run --silent lint:css', {
    cwd: project, shell: true, encoding: 'utf8', windowsHide: true,
  });
  const baseline = runLint();
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);

  for (const file of legacy) { await appendFile(path.join(project, file), duplicates); }
  const fragment = path.join(project, '../web/styles/components/probe.css');
  const source = `${duplicates}.fixable { color: red; color: red; }\n`;
  await writeFile(fragment, source);
  const rejected = runLint();
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
  for (const file of ['../web/styles.css', '../web/styles/responsive-artwork.css', 'frontend/desktop.css', 'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json']) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  for (const file of ['../web/probe.CSS', '../web/styles/components/probe.CsS', 'frontend/nested/probe.cSS']) {
    const target = path.join(project, file);
    await writeFile(target, 'a { colr: red; }\n');
    const result = spawnSync('npm run --silent lint:css', {
      cwd: project, shell: true, encoding: 'utf8', windowsHide: true,
    });
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
  for (const file of ['../web/styles.css', '../web/styles/responsive-artwork.css', 'frontend/desktop.css', 'package.json', 'stylelint.config.mjs', 'stylelint-suppressions.json']) {
    await copyFile(path.join(desktop, file), path.join(project, file));
  }
  const runLint = () => spawnSync('npm run --silent lint:css', {
    cwd: project, shell: true, encoding: 'utf8', windowsHide: true,
  });
  const baseline = runLint();
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);

  const fragment = path.join(project, '../web/styles/components/depth-probe.css');
  await writeFile(fragment, '.lint-a > .lint-b > .lint-c > .lint-d { color: red; }\n');
  const accepted = runLint();
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);

  await writeFile(fragment, '.lint-a > .lint-b > .lint-c > .lint-d > .lint-e { color: red; }\n');
  const rejected = runLint();
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
  const runLint = () => spawnSync('npm run --silent lint:css', {
    cwd: project, shell: true, encoding: 'utf8', windowsHide: true,
  });
  const baseline = runLint();
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);

  const fragment = path.join(project, '../web/styles/components/theme-probe.css');
  await writeFile(fragment, '.theme-probe { color: var(--blue3); }\n');
  const accepted = runLint();
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);

  await writeFile(fragment, '.theme-probe { color: var(--bule3); }\n');
  const rejected = runLint();
  const diagnostics = rejected.stdout + rejected.stderr;
  assert.equal(rejected.status, 2, diagnostics);
  assert.match(diagnostics, /no-unknown-custom-properties/);
  assert(diagnostics.includes('theme-probe.css'), diagnostics);
});
