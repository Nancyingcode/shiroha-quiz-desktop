import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureInstallerIntegrity, prepareInstaller } from '../scripts/installer-integrity.mjs';

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shiroha-installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src-tauri'), { recursive: true });
  await writeFile(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({
    productName: 'Shiroha Quiz', version: '0.1.3',
  }));
  const directory = path.join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');
  await mkdir(directory, { recursive: true });
  const installer = path.join(directory, 'Shiroha Quiz_0.1.3_x64-setup.exe');
  await writeFile(installer, 'MZ synthetic installer');
  return { root, directory, installer };
}

test('all four installer commands run the same post-packaging integrity gate', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const command of ['build:nsis', 'build:offline', 'bundle:nsis', 'bundle:offline']) {
    assert.equal(scripts[`post${command}`], 'node scripts/installer-integrity.mjs');
  }
});

test('low-integrity installer is repaired without changing its bytes or access grants', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const f = await fixture(t);
  const bytes = await readFile(f.installer);
  const unrelated = path.join(f.directory, 'unrelated.exe');
  await writeFile(unrelated, 'MZ unrelated');
  await rm(f.installer);
  execFileSync('icacls.exe', [f.directory, '/setintegritylevel', '(OI)(CI)L'], { windowsHide: true });
  await writeFile(f.installer, bytes);
  const daclFile = path.join(f.root, 'before.acl');
  execFileSync('icacls.exe', [f.installer, '/save', daclFile], { windowsHide: true });
  await assert.rejects(ensureInstallerIntegrity(f.installer, { repair: false }), /低完整性/);
  await prepareInstaller(f.root);
  assert.equal(await ensureInstallerIntegrity(f.installer, { repair: false }), false);
  assert.deepEqual(await readFile(f.installer), bytes);
  const afterDacl = path.join(f.root, 'after.acl');
  execFileSync('icacls.exe', [f.installer, '/save', afterDacl], { windowsHide: true });
  const before = (await readFile(daclFile, 'utf16le')).replace(/\(ML;[^)]*\)/g, '');
  const after = (await readFile(afterDacl, 'utf16le')).replace(/\(ML;[^)]*\)/g, '');
  assert.equal(after, before);
  assert.equal(await readFile(unrelated, 'utf8'), 'MZ unrelated');
});

test('post-packaging rejects a missing installer and a junction before changing permissions', async (t) => {
  const f = await fixture(t);
  await rm(f.installer);
  await assert.rejects(prepareInstaller(f.root), /ENOENT/);
  await rm(f.directory, { recursive: true });
  const external = await mkdtemp(path.join(os.tmpdir(), 'shiroha-installer-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const externalFile = path.join(external, path.basename(f.installer));
  await writeFile(externalFile, 'MZ external installer');
  await symlink(external, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareInstaller(f.root), /链接/);
  assert.equal(await readFile(externalFile, 'utf8'), 'MZ external installer');
});

test('permission denial and an ineffective repair fail packaging with a recoverable instruction', async (t) => {
  const f = await fixture(t);
  for (const failWrite of [true, false]) {
    await assert.rejects(ensureInstallerIntegrity(f.installer, {
      platform: 'win32',
      run: async (command) => {
        if (command === 'icacls.exe' && failWrite) { throw new Error('access denied'); }
        return JSON.stringify({ sddl: 'S:(ML;ID;NW;;;LW)' });
      },
    }), /普通 PowerShell/);
  }
});

test('unreadable or unknown integrity labels cannot be reported as successful', async (t) => {
  const f = await fixture(t);
  for (const output of ['', '{}', '{"sddl":"S:(ML;;NW;;;unknown)"}']) {
    await assert.rejects(ensureInstallerIntegrity(f.installer, {
      platform: 'win32', run: async () => output,
    }));
  }
});
