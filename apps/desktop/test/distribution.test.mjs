import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('installer variants preserve identity and distinguish offline runtime deployment', async () => {
  const read = async (/** @type {string} */ name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
  const base = await read('../src-tauri/tauri.conf.json');
  const pkg = await read('../package.json');
  const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
  assert.equal(pkg.version, base.version);
  assert.equal(cargo.match(/^version = "([^"]+)"/m)?.[1], base.version);
  assert.equal(pkg.scripts.build, 'tauri build --no-bundle');
  for (const [name, mode] of [['nsis', 'downloadBootstrapper'], ['offline', 'offlineInstaller']]) {
    const config = await read(`../src-tauri/tauri.${name}.conf.json`);
    assert.equal(config.identifier, undefined);
    assert.equal(config.app, undefined);
    assert.equal(config.bundle.active, true);
    assert.deepEqual(config.bundle.targets, ['nsis']);
    assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
    assert.equal(config.bundle.windows.webviewInstallMode.type, mode);
    assert.equal(config.bundle.windows.allowDowngrades, false);
    assert.match(pkg.scripts[`build:${name}`], /tauri build/);
  }
});
