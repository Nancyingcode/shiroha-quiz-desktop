import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareWeb } from '../scripts/prepare-web.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const web = path.resolve(desktop, '../web');
const injected = new Set(['bridge.js', 'adapter.js', 'harness.js', 'codebuddy-login.js', 'titlebar.js', 'desktop-events.js']);
const offline = [
  'libs/pdf.min.mjs', 'libs/pdf.worker.min.mjs', 'libs/wasm/openjpeg.wasm',
  'libs/ocr/tesseract/tesseract.min.js', 'libs/ocr/tesseract/worker.min.js',
  'libs/ocr/core/tesseract-core-simd-lstm.wasm.js', 'libs/ocr/core/tesseract-core-lstm.wasm.js',
  'libs/ocr/lang/eng.traineddata.gz', 'libs/ocr/lang/chi_sim.traineddata.gz',
  'libs/mathjax/tex-mml-chtml.js', 'libs/mathjax/output/chtml/fonts/woff-v2/MathJax_Main-Regular.woff',
];

/** @param {string} html */
function scripts(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2].replace(/^\.\//, ''));
}

/** @param {string} output @param {string[]} expected */
async function assertScripts(output, expected) {
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  const index = expected.indexOf('platform/index.js');
  assert(index >= 0);
  const actual = scripts(html);
  const desktopExpected = [...expected.slice(0, index), 'bridge.js', 'adapter.js', 'harness.js', 'codebuddy-login.js',
    ...expected.slice(index), 'desktop-events.js', 'titlebar.js'];
  assert.deepEqual(actual, desktopExpected);
  assert.equal(new Set(actual).size, actual.length);
  for (const name of expected) {
    assert.deepEqual(await readFile(path.join(output, name)), await readFile(path.join(web, name)), name);
  }
}

/** @param {string} directory */
async function licensePaths(directory) {
  /** @type {string[]} */
  const found = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(entry.name)) {
      found.push(path.relative(web, path.join(entry.parentPath, entry.name)));
    }
  }
  return found;
}

test('actual Web and generated desktop scripts retain order, bytes, offline assets and timestamps', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const temp = await mkdtemp(path.join(tempRoot, 'shiroha-actual-assets-'));
  t.after(async () => {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-actual-assets-'));
    const link = path.join(actual, 'desktop/node_modules');
    try {
      assert((await lstat(link)).isSymbolicLink());
      await rm(link);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; }
    }
    await rm(actual, { recursive: true, force: true });
  });
  const project = path.join(temp, 'desktop');
  await mkdir(project);
  await cp(path.join(desktop, 'frontend'), path.join(project, 'frontend'), { recursive: true });
  await symlink(path.join(desktop, 'node_modules'), path.join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const sourceHtml = await readFile(path.join(web, 'index.html'), 'utf8');
  const expected = scripts(sourceHtml);
  assert(expected.length > 30);
  assert.equal(new Set(expected).size, expected.length);
  assert(expected.every((name) => !injected.has(name)));
  const output = await prepareWeb(web, project);
  await assertScripts(output, expected);
  const licenses = await licensePaths(path.join(web, 'libs'));
  assert(licenses.length > 0);
  const thirdParty = (await readdir(path.join(web, 'libs'), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:js|mjs|cjs)$/i.test(entry.name))
    .map((entry) => path.relative(web, path.join(entry.parentPath, entry.name)));
  assert(thirdParty.length > 0);
  for (const name of [...offline, ...licenses, ...thirdParty]) {
    assert.deepEqual(await readFile(path.join(output, name)), await readFile(path.join(web, name)), name);
  }
  const old = new Date('2001-01-01T00:00:00Z');
  const unchanged = [...new Set(['index.html', 'desktop-events.js', ...expected, ...offline, ...licenses, ...thirdParty])];
  for (const name of unchanged) { await utimes(path.join(output, name), old, old); }
  await prepareWeb(web, project);
  await assertScripts(output, expected);
  for (const name of unchanged) { assert.equal((await stat(path.join(output, name))).mtimeMs, old.getTime(), name); }

  const first = expected.find((name) => name === 'training.js');
  assert(first);
  const original = await readFile(path.join(output, first));
  await writeFile(path.join(output, first), 'corrupted');
  await assert.rejects(assertScripts(output, expected));
  await writeFile(path.join(output, first), original);
  await rm(path.join(output, first));
  await assert.rejects(assertScripts(output, expected), { code: 'ENOENT' });
  await writeFile(path.join(output, first), original);
  const generated = await readFile(path.join(output, 'index.html'), 'utf8');
  const swapped = generated.replace('src="./training.js"', 'src="./temporary.js"')
    .replace('src="./quiz-core.js"', 'src="./training.js"')
    .replace('src="./temporary.js"', 'src="./quiz-core.js"');
  assert.notEqual(swapped, generated);
  await writeFile(path.join(output, 'index.html'), swapped);
  await assert.rejects(assertScripts(output, expected));
  await writeFile(path.join(output, 'index.html'), generated.replace('<script src="./bridge.js"></script>\n', ''));
  await assert.rejects(assertScripts(output, expected));
  const wrongBridgeOrder = generated.replace('src="./adapter.js"', 'src="./temporary.js"')
    .replace('src="./harness.js"', 'src="./adapter.js"')
    .replace('src="./temporary.js"', 'src="./harness.js"');
  assert.notEqual(wrongBridgeOrder, generated);
  await writeFile(path.join(output, 'index.html'), wrongBridgeOrder);
  await assert.rejects(assertScripts(output, expected));
  const wrongFinalOrder = generated.replace('src="./desktop-events.js"', 'src="./temporary.js"')
    .replace('src="./titlebar.js"', 'src="./desktop-events.js"')
    .replace('src="./temporary.js"', 'src="./titlebar.js"');
  assert.notEqual(wrongFinalOrder, generated);
  await writeFile(path.join(output, 'index.html'), wrongFinalOrder);
  await assert.rejects(assertScripts(output, expected));
});
