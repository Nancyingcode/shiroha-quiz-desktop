import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { optimizeDesktopHtml, prepareWeb, requiredAssets } from '../scripts/prepare-web.mjs';

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shiroha-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const web = path.join(root, 'web');
  const desktop = path.join(root, 'desktop');
  await mkdir(web);
  await mkdir(desktop);
  for (const name of requiredAssets) {
    await mkdir(path.dirname(path.join(web, name)), { recursive: true });
    await writeFile(path.join(web, name), 'fixture');
  }
  const html = '<html><body><button onclick="this.textContent=&quot;done&quot;">Go</button><img onerror="this.hidden=true"><script src="./app.js"></script></body></html>';
  await writeFile(path.join(web, 'index.html'), html);
  return { root, web, desktop, html, dist: path.join(desktop, 'dist') };
}

test('desktop startup omits splash resources but keeps navigation artwork available on demand', () => {
  const html = `<head><link rel="preload" as="image" href="./media/home_welcome_avatar.webp" />
    <link rel="preload" as="image" href="./media/import_question_bank_folder.webp" />
    <link rel="preload" as="image" href="./media/peeking.webp" /></head><body>
    <div class="app-splash" aria-hidden="true"><div class="app-splash-card"><img src="./media/home_welcome_avatar.webp" /><div>Title</div></div></div>
    <div class="app"><img src="./media/splash_mascot.webp" /><img src="./media/import_question_bank_folder.webp" alt="Import" />
    <img src="./app-icon.png" /><img src="./media/peeking.webp" /></div></body>`;
  const result = optimizeDesktopHtml(html);
  assert.doesNotMatch(result, /app-splash|home_welcome_avatar/);
  assert.match(result, /<img loading="lazy" decoding="async" src="\.\/media\/import_question_bank_folder.webp" alt="Import"/);
  assert.match(result, /<img src="\.\/media\/splash_mascot.webp"/);
  assert.match(result, /<img src="\.\/media\/peeking.webp"/);
  assert.match(result, /<img src="\.\/app-icon.png"/);
  assert.match(result, /rel="preload" as="image" href="\.\/media\/peeking.webp"/);
  assert.equal(optimizeDesktopHtml(result), result);
  assert.throws(() => optimizeDesktopHtml('<div class="app-splash">changed structure</div>'), /splash/i);
});

test('stages offline resources and licenses, excludes tooling, and leaves Web source intact', async (t) => {
  const f = await fixture(t);
  for (const name of ['serve.ps1', 'open.cmd', 'README.md', 'libs/README.txt', 'libs/debug.js.map', 'libs/LICENSE', 'libs/LICENSE.md']) {
    await writeFile(path.join(f.web, name), name);
  }
  await prepareWeb(f.web, f.desktop);
  for (const name of requiredAssets.filter((name) => name !== 'index.html')) {
    assert.equal(await readFile(path.join(f.dist, name), 'utf8'), 'fixture');
  }
  assert.equal(await readFile(path.join(f.dist, 'libs/LICENSE'), 'utf8'), 'libs/LICENSE');
  assert.equal(await readFile(path.join(f.dist, 'libs/LICENSE.md'), 'utf8'), 'libs/LICENSE.md');
  for (const name of ['serve.ps1', 'open.cmd', 'README.md', 'libs/README.txt', 'libs/debug.js.map']) {
    await assert.rejects(readFile(path.join(f.dist, name)), { code: 'ENOENT' });
  }
  assert.equal(await readFile(path.join(f.web, 'index.html'), 'utf8'), f.html);
  const first = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  await writeFile(path.join(f.dist, 'stale.js'), 'stale');
  await prepareWeb(f.web, f.desktop);
  assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), first);
  assert.equal((await readdir(f.dist)).includes('stale.js'), false);
});

test('moves handlers to an external script while preserving click/error behavior and this', async (t) => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const html = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.match(html, /src="\.\/desktop-events\.js"/);
  const elements = [
    { textContent: 'Go', hidden: false },
    { textContent: '', hidden: false },
  ];
  /** @type {Array<{ type: string, callback: (this: object, event: object) => void }>} */
  const events = [];
  let index = 0;
  const document = {
    querySelector() {
      const element = elements[index++];
      return Object.assign(element, {
        /** @param {string} type @param {(this: object, event: object) => void} callback */
        addEventListener(type, callback) { events.push({ type, callback }); },
      });
    },
  };
  vm.runInNewContext(await readFile(path.join(f.dist, 'desktop-events.js'), 'utf8'), { document });
  assert.deepEqual(events.map((event) => event.type), ['click', 'error']);
  events.forEach((event, i) => event.callback.call(elements[i], {}));
  assert.equal(elements[0].textContent, 'done');
  assert.equal(elements[1].hidden, true);
});

test('rejects unsupported inline execution before replacing existing output', async (t) => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const previous = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  await writeFile(path.join(f.web, 'index.html'), '<body onload="alert(1)"></body>');
  await assert.rejects(prepareWeb(f.web, f.desktop), /inline|handler/i);
  assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), previous);
  await writeFile(path.join(f.web, 'index.html'), '<body><script>alert(1)</script></body>');
  await assert.rejects(prepareWeb(f.web, f.desktop), /inline|script/i);
});

test('rejects missing offline assets and overlapping directories', async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.web, 'libs/pdf.worker.min.mjs'));
  await assert.rejects(prepareWeb(f.web, f.desktop), /pdf\.worker/);
  await assert.rejects(prepareWeb(f.web, f.web), /overlap/i);
});

test('rejects directory links instead of reading or removing their targets', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'keep');
  await symlink(outside, f.dist, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWeb(f.web, f.desktop), /link/i);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});
