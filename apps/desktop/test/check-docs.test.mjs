import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ruleDocuments = ['AGENTS.md', 'rules/rust-style-guide.md', 'docs/AGENTS-适配说明.md'];

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shiroha-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'apps/desktop/scripts/check-docs.mjs');
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(new URL('../scripts/check-docs.mjs', import.meta.url), script);
  for (const relative of [
    'apps/desktop/README.md',
    'docs/superpowers/specs/2026-10-23-tauri-prototype.md',
    'docs/superpowers/plans/2026-10-23-tauri-prototype.md',
    ...ruleDocuments,
  ]) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '# 检查样例\n\n[当前文档](./' + path.basename(file) + ')\n\n```text\n示例\n```\n');
  }
  return {
    root,
    run: () => spawnSync(process.execPath, [script], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true }),
  };
}

test('checks valid project and rule documents independently of the working directory', async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

for (const relative of ruleDocuments) {
  test(`rejects invalid encoding, fences and local links in ${relative}`, async (t) => {
    const f = await fixture(t);
    for (const { content, error } of [
      { content: Buffer.from([0xc3, 0x28]), error: /ERR_ENCODING_INVALID_ENCODED_DATA/ },
      { content: '# 检查样例\n\n```rust\n', error: /Unclosed Markdown fence/ },
      { content: '# 检查样例\n\n[缺失文件](./missing.md)\n', error: /ENOENT/ },
    ]) {
      await writeFile(path.join(f.root, relative), content);
      const result = f.run();
      assert.ifError(result.error);
      assert.equal(result.status, 1, `Expected lint failure for ${relative}: ${error}`);
      assert.match(result.stderr, error);
    }
  });
}
