import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { releaseContext, validateVersions, initializeRelease, stageArtifact, finalizeRelease, verifyRelease, releaseDirectory, binaryNames } from '../scripts/release-artifacts.mjs';
import { createReleaseDraft } from '../scripts/release-github.mjs';

const input = {
  ref: 'refs/tags/desktop-v0.1.0', commit: 'a'.repeat(40),
  repository: 'example/quiz', runId: '1234', runAttempt: '1',
};
const executable = 'src-tauri/target/x86_64-pc-windows-msvc/release/shiroha-quiz-desktop.exe';
const installer = 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Shiroha Quiz_0.1.0_x64-setup.exe';

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shiroha-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src-tauri'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }));
  await writeFile(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.1.0' }));
  await writeFile(path.join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "shiroha-quiz-desktop"\nversion = "0.1.0"\n');
  await writeFile(path.join(root, 'src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "dependency"\nversion = "2.0.0"\n\n[[package]]\nname = "shiroha-quiz-desktop"\nversion = "0.1.0"\n');
  const context = releaseContext(input);
  /** @param {string} relative @param {string} contents */
  const put = async (relative, contents) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  const collect = async () => {
    await initializeRelease(root, context);
    await put(executable, 'MZ standalone');
    await stageArtifact(root, context, 'exe');
    await put(installer, 'MZ online installer');
    await stageArtifact(root, context, 'nsis');
    await put(installer, 'MZ offline installer');
    await stageArtifact(root, context, 'offline');
    await finalizeRelease(root, context);
  };
  return { root, context, put, collect, output: releaseDirectory(root, context) };
}

test('release accepts only explicit desktop version tags and safe run identities', () => {
  assert.equal(releaseContext(input).version, '0.1.0');
  for (const ref of ['refs/heads/main', 'desktop-v0.1.0', 'refs/tags/v0.1.0', 'refs/tags/desktop-v01.2.3', 'refs/tags/desktop-v0.1.0-beta', 'refs/tags/desktop-v0.1.0\n']) {
    assert.throws(() => releaseContext({ ...input, ref }));
  }
  for (const change of [{ commit: 'main' }, { runId: '../1234' }, { runAttempt: '0' }, { repository: '../quiz' }, { repository: 'example/quiz;echo' }]) {
    assert.throws(() => releaseContext({ ...input, ...change }));
  }
});

test('CLI context uses the resolved commit even when the event identifies an annotated tag object', () => {
  const moduleUrl = new URL('../scripts/release-artifacts.mjs', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `import { contextFromEnvironment } from ${JSON.stringify(moduleUrl)}; console.log(contextFromEnvironment().commit);`], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF: input.ref, GITHUB_SHA: 'c'.repeat(40), RELEASE_COMMIT: input.commit, GITHUB_REPOSITORY: input.repository, GITHUB_RUN_ID: input.runId, GITHUB_RUN_ATTEMPT: input.runAttempt },
  });
  assert.equal(output.trim(), input.commit);
});

test('release validates every version source including both lockfiles without writing', async (t) => {
  const f = await fixture(t);
  await validateVersions(f.root, f.context);
  const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
  for (const file of files) {
    const original = await readFile(path.join(f.root, file), 'utf8');
    const changed = original.replace('0.1.0', '0.2.0');
    await f.put(file, changed);
    await assert.rejects(validateVersions(f.root, f.context), /version|版本/i);
    assert.equal(await readFile(path.join(f.root, file), 'utf8'), changed);
    await f.put(file, original);
  }
  await f.put('package-lock.json', JSON.stringify({ version: '0.1.0', packages: { '': {} } }));
  await assert.rejects(validateVersions(f.root, f.context), /version|版本/i);
});

test('collects each build before the shared NSIS output is overwritten and hashes final bytes', async (t) => {
  const f = await fixture(t);
  await f.collect();
  const names = binaryNames(f.context);
  assert.equal(await readFile(path.join(f.output, names.nsis), 'utf8'), 'MZ online installer');
  assert.equal(await readFile(path.join(f.output, names.offline), 'utf8'), 'MZ offline installer');
  const sums = await readFile(path.join(f.output, 'SHA256SUMS.txt'), 'utf8');
  const digest = createHash('sha256').update('MZ online installer').digest('hex');
  assert.ok(sums.includes(`${digest}  ${names.nsis}\n`));
  const assets = await verifyRelease(f.root, f.context);
  assert.equal(assets.length, 5);
  assert.ok(assets.every((file) => !file.includes('native-test')));
  const notes = await readFile(path.join(f.output, 'release-notes.md'), 'utf8');
  assert.match(notes, /未签名/);
  assert.match(notes, /尚未|未完成/);
  assert.match(notes, /CodeBuddy/);
  assert.match(notes, /SHA256/);
});

test('rejects duplicate runs and files, missing or empty output, and unexpected build kinds', async (t) => {
  const f = await fixture(t);
  await initializeRelease(f.root, f.context);
  await assert.rejects(initializeRelease(f.root, f.context), /EEXIST/);
  await f.put('src-tauri/target/release/shiroha-quiz-desktop.exe', 'MZ stale host build');
  await f.put('src-tauri/target/native-test/release/shiroha-quiz-desktop.exe', 'MZ test build');
  await assert.rejects(stageArtifact(f.root, f.context, 'exe'), /ENOENT/);
  await f.put(executable, '');
  await assert.rejects(stageArtifact(f.root, f.context, 'exe'), /empty|非空/i);
  await f.put(executable, 'MZ standalone');
  await stageArtifact(f.root, f.context, 'exe');
  await assert.rejects(stageArtifact(f.root, f.context, 'exe'), /EEXIST/);
  await assert.rejects(stageArtifact(f.root, f.context, '../native-test'), /kind|类型/i);
  await assert.rejects(finalizeRelease(f.root, f.context), /ENOENT/);
  assert.equal(await readFile(path.join(f.output, binaryNames(f.context).exe), 'utf8'), 'MZ standalone');
});

test('rejects two installer labels containing the same build', async (t) => {
  const f = await fixture(t);
  await initializeRelease(f.root, f.context);
  await f.put(executable, 'MZ standalone');
  await stageArtifact(f.root, f.context, 'exe');
  await f.put(installer, 'MZ only one installer');
  await stageArtifact(f.root, f.context, 'nsis');
  await stageArtifact(f.root, f.context, 'offline');
  await assert.rejects(finalizeRelease(f.root, f.context), /identical|相同/i);
});

test('rejects junctions in source and output paths without touching the destination', async (t) => {
  const f = await fixture(t);
  const external = await mkdtemp(path.join(os.tmpdir(), 'shiroha-release-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(path.join(external, 'keep.txt'), 'keep');
  await symlink(external, path.join(f.root, '.reports'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(initializeRelease(f.root, f.context), /link|链接/i);
  await rm(path.join(f.root, '.reports'));
  await initializeRelease(f.root, f.context);
  await symlink(external, path.join(f.root, 'src-tauri/target'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageArtifact(f.root, f.context, 'exe'), /link|链接/i);
  assert.deepEqual(await readdir(external), ['keep.txt']);
});

test('verifier rejects tampered bytes, metadata, notes, checksums and extra files', async (t) => {
  const f = await fixture(t);
  await f.collect();
  for (const name of [binaryNames(f.context).offline, 'release-metadata.json', 'release-notes.md', 'SHA256SUMS.txt']) {
    const file = path.join(f.output, name);
    const original = await readFile(file);
    await writeFile(file, 'tampered');
    await assert.rejects(verifyRelease(f.root, f.context));
    await writeFile(file, original);
  }
  await writeFile(path.join(f.output, 'unexpected.exe'), 'MZ extra');
  await assert.rejects(verifyRelease(f.root, f.context), /files|文件/i);
});

test('release context prevents mixing commits and attempts', async (t) => {
  const f = await fixture(t);
  await f.collect();
  await assert.rejects(verifyRelease(f.root, { ...f.context, commit: 'b'.repeat(40) }), /metadata|元数据/i);
  await assert.rejects(verifyRelease(f.root, { ...f.context, runAttempt: '2' }), /ENOENT/);
});

/** @param {string} tag @param {boolean} [draft] */
const existing = (tag, draft = true) => JSON.stringify([[{ tag_name: tag, draft }]]);

test('existing draft or published release is never overwritten, including later pages', async (t) => {
  const f = await fixture(t);
  await f.collect();
  for (const draft of [true, false]) {
    /** @type {string[][]} */
    const calls = [];
    await assert.rejects(createReleaseDraft(f.root, f.context, async (args) => {
      calls.push(args);
      return JSON.stringify([[], JSON.parse(existing(f.context.tag, draft))[0]]);
    }), /exists|已存在/i);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('--paginate'));
  }
});

test('API errors and malformed release lists cannot become permission to create', async (t) => {
  const f = await fixture(t);
  await f.collect();
  for (const response of ['not json', '{}', '[{}]']) {
    await assert.rejects(createReleaseDraft(f.root, f.context, async () => response));
  }
  await assert.rejects(createReleaseDraft(f.root, f.context, async () => { throw new Error('HTTP 403'); }), /403/);
});

test('moved remote tags and unsupported tag objects stop before creation', async (t) => {
  const f = await fixture(t);
  await f.collect();
  for (const object of [{ type: 'commit', sha: 'b'.repeat(40) }, { type: 'tree', sha: input.commit }]) {
    /** @type {string[][]} */
    const calls = [];
    await assert.rejects(createReleaseDraft(f.root, f.context, async (args) => {
      calls.push(args);
      return calls.length === 1 ? '[[]]' : JSON.stringify({ object });
    }), /tag|标签/i);
    assert.equal(calls.length, 2);
  }
});

test('creates only a verified prerelease draft with explicit assets and dereferences annotated tags', async (t) => {
  const f = await fixture(t);
  await f.collect();
  /** @type {string[][]} */
  const calls = [];
  const assets = await verifyRelease(f.root, f.context);
  await createReleaseDraft(f.root, f.context, async (args) => {
    calls.push(args);
    if (calls.length === 1) return '[[]]';
    if (calls.length === 2) return JSON.stringify({ object: { type: 'tag', sha: 'c'.repeat(40) } });
    if (calls.length === 3) return JSON.stringify({ object: { type: 'commit', sha: input.commit } });
    if (calls.length === 4) return 'https://github.com/example/quiz/releases/tag/desktop-v0.1.0';
    return JSON.stringify([[{ tag_name: f.context.tag, draft: true, prerelease: true, assets: await Promise.all(assets.map(async (file) => ({ name: path.basename(file), size: (await readFile(file)).length }))) }]]);
  });
  const create = calls[3];
  assert.deepEqual(create.slice(0, 3), ['release', 'create', f.context.tag]);
  for (const flag of ['--draft', '--prerelease', '--latest=false', '--verify-tag', '--notes-file']) assert.ok(create.includes(flag));
  assert.ok(create.includes('example/quiz'));
  assert.ok(!create.includes('--clobber'));
  for (const file of assets) assert.ok(create.includes(file));
  assert.equal(calls.length, 5);
});

test('upload failure is reported as a possibly incomplete draft without retry or publication', async (t) => {
  const f = await fixture(t);
  await f.collect();
  /** @type {string[][]} */
  const calls = [];
  await assert.rejects(createReleaseDraft(f.root, f.context, async (args) => {
    calls.push(args);
    if (calls.length === 1) return '[[]]';
    if (calls.length === 2) return JSON.stringify({ object: { type: 'commit', sha: input.commit } });
    throw new Error('upload interrupted');
  }), /不完整草稿/);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => !args.includes('edit') && !args.includes('delete')));
});

test('post-upload verification rejects public or incomplete releases without modifying them', async (t) => {
  const f = await fixture(t);
  await f.collect();
  for (const record of [{ draft: false, prerelease: true, assets: [] }, { draft: true, prerelease: false, assets: [] }, { draft: true, prerelease: true, assets: [] }]) {
    let calls = 0;
    await assert.rejects(createReleaseDraft(f.root, f.context, async (args) => {
      calls += 1;
      assert.ok(!args.includes('edit') && !args.includes('delete'));
      if (calls === 1) return '[[]]';
      if (calls === 2) return JSON.stringify({ object: { type: 'commit', sha: input.commit } });
      if (calls === 3) return 'created';
      return JSON.stringify([[{ tag_name: f.context.tag, ...record }]]);
    }), /不完整草稿/);
    assert.equal(calls, 4);
  }
});

test('workflow preserves the online build before overwrite and gates writes behind checks', async () => {
  const checks = await readFile(new URL('../../../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  const release = await readFile(new URL('../../../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
  const sequence = ['npm run build -- --target x86_64-pc-windows-msvc\n', 'release-artifacts.mjs stage exe', 'npm run bundle:nsis', 'release-artifacts.mjs stage nsis', 'npm run bundle:offline', 'release-artifacts.mjs stage offline', 'release-artifacts.mjs finalize', 'uses: actions/upload-artifact@'];
  let previous = -1;
  for (const step of sequence) {
    const position = checks.replace(/\r\n/g, '\n').indexOf(step);
    assert.ok(position > previous, `Missing or misplaced build/collection step: ${step}`);
    previous = position;
  }
  assert.match(checks, /collect_release:[\s\S]*?default: false/);
  assert.doesNotMatch(checks, /contents: write|release-github\.mjs/);
  assert.match(release, /tags: \['desktop-v\*'\]/);
  assert.doesNotMatch(release, /pull_request|branches:|workflow_run|secrets: inherit/);
  assert.match(release, /checks:\s+needs: validate\s+uses: \.\/\.github\/workflows\/desktop\.yml/);
  assert.match(release, /draft:\s+needs: \[validate, checks\][\s\S]*?permissions:\s+contents: write/);
  assert.equal((release.match(/contents: write/g) ?? []).length, 1);
  assert.doesNotMatch(release, /always\(\)|continue-on-error/);
});

test('installer packaging reuses one x64 build and only changes bundle settings', async () => {
  const checks = await readFile(new URL('../../../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((checks.match(/- run: npm run build\b/g) ?? []).length, 1);
  assert.doesNotMatch(checks, /npm run build:(?:nsis|offline)/);
  for (const [kind, mode] of [['nsis', 'downloadBootstrapper'], ['offline', 'offlineInstaller']]) {
    assert.equal(scripts[`bundle:${kind}`], `tauri bundle --config src-tauri/tauri.${kind}.conf.json --target x86_64-pc-windows-msvc`);
    const config = JSON.parse(await readFile(new URL(`../src-tauri/tauri.${kind}.conf.json`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(config).sort(), ['$schema', 'bundle']);
    assert.equal(config.bundle.active, true);
    assert.deepEqual(config.bundle.targets, ['nsis']);
    assert.equal(config.bundle.windows.webviewInstallMode.type, mode);
  }
});

test('Rust dependency cache is restored after selecting the toolchain and shared with releases', async () => {
  const checks = await readFile(new URL('../../../.github/workflows/desktop.yml', import.meta.url), 'utf8');
  const cache = checks.indexOf('uses: Swatinem/rust-cache@');
  assert.ok(cache > checks.indexOf('rustup default 1.99.1'));
  assert.ok(cache < checks.indexOf('cargo clippy'));
  assert.match(checks, /workspaces: apps\/desktop\/src-tauri -> target/);
  assert.match(checks, /shared-key: windows-2025-x64/);
  assert.match(checks, /save-if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/);
  assert.doesNotMatch(checks, /cache-workspace-crates: ['"]?true|cache-on-failure: ['"]?true/);
});
