import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
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
  await mkdir(path.join(desktop, 'frontend'));
  const desktopCss = 'body.desktop-mist-blue { background: #edf4f8; }';
  await writeFile(path.join(desktop, 'frontend/desktop.css'), desktopCss);
  await writeFile(path.join(desktop, 'frontend/titlebar.html'), '<header id="desktop-titlebar">Shiroha Quiz</header>');
  await writeFile(path.join(desktop, 'frontend/titlebar.js'), '"use strict";');
  await writeFile(path.join(desktop, 'frontend/bridge.js'), '"use strict";');
  await writeFile(path.join(desktop, 'frontend/adapter.js'), '"use strict";');
  await writeFile(path.join(desktop, 'frontend/harness.js'), '"use strict";');
  await writeFile(path.join(desktop, 'frontend/codebuddy-login.js'), '"use strict"; // account fixture');
  for (const name of requiredAssets) {
    await mkdir(path.dirname(path.join(web, name)), { recursive: true });
    await writeFile(path.join(web, name), 'fixture');
  }
  const html = '<html><head><link rel="stylesheet" href="./styles.css"><meta name="theme-color" content="#ffffff"></head><body class="app-ready"><button onclick="this.textContent=&quot;done&quot;">Go</button><img onerror="this.hidden=true"><script src="./app.js"></script></body></html>';
  await writeFile(path.join(web, 'index.html'), html);
  return { root, web, desktop, html, desktopCss, dist: path.join(desktop, 'dist') };
}

/** @param {string} root */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(root, file)] = entry.isDirectory() ? 'directory' : (await readFile(file)).toString('base64');
  }
  return files;
}

test('unchanged outputs retain timestamps, including generated assets', async t => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const before = await snapshot(f.dist);
  const old = new Date('2001-01-01T00:00:00Z');
  for (const name of Object.keys(before)) await utimes(path.join(f.dist, name), old, old);
  await prepareWeb(f.web, f.desktop);
  assert.deepEqual(await snapshot(f.dist), before);
  for (const name of Object.keys(before)) assert.equal((await stat(path.join(f.dist, name))).mtimeMs, old.getTime(), name);
});

test('equal-size source changes with preserved timestamps update only affected outputs', async t => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const old = new Date('2001-01-01T00:00:00Z');
  for (const name of ['app.js', 'index.html', 'desktop.css']) await utimes(path.join(f.dist, name), old, old);
  const input = path.join(f.web, 'app.js');
  const metadata = await stat(input);
  await writeFile(input, 'changed');
  await utimes(input, metadata.atime, metadata.mtime);
  await prepareWeb(f.web, f.desktop);
  assert.equal(await readFile(path.join(f.dist, 'app.js'), 'utf8'), 'changed');
  for (const name of ['index.html', 'desktop.css']) assert.equal((await stat(path.join(f.dist, name))).mtimeMs, old.getTime());
  await writeFile(path.join(f.desktop, 'frontend/desktop.css'), 'body { color: red; }');
  await prepareWeb(f.web, f.desktop);
  assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), 'body { color: red; }');
});

test('incremental cleanup and type changes match a clean generation', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.web, 'media'));
  await writeFile(path.join(f.web, 'media/old.png'), 'old');
  await writeFile(path.join(f.web, 'libs/switch'), 'file');
  await mkdir(path.join(f.web, 'libs/reverse'));
  await writeFile(path.join(f.web, 'libs/reverse/child'), 'child');
  await prepareWeb(f.web, f.desktop);
  await rm(path.join(f.web, 'media'), { recursive: true });
  await rm(path.join(f.web, 'libs/switch'));
  await mkdir(path.join(f.web, 'libs/switch'));
  await writeFile(path.join(f.web, 'libs/switch/child'), 'new');
  await rm(path.join(f.web, 'libs/reverse'), { recursive: true });
  await writeFile(path.join(f.web, 'libs/reverse'), 'file');
  await mkdir(path.join(f.dist, 'stale/empty'), { recursive: true });
  await writeFile(path.join(f.dist, 'stale/old.js'), 'old');
  await prepareWeb(f.web, f.desktop);
  const incremental = await snapshot(f.dist);
  await rm(f.dist, { recursive: true });
  await prepareWeb(f.web, f.desktop);
  assert.deepEqual(incremental, await snapshot(f.dist));
});

test('repairs missing and corrupt outputs without trusting target timestamps', async t => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const before = await snapshot(f.dist);
  await rm(path.join(f.dist, 'bridge.js'));
  await writeFile(path.join(f.dist, 'app.js'), 'corrupt');
  await writeFile(path.join(f.dist, 'index.html'), 'bad');
  await prepareWeb(f.web, f.desktop);
  assert.deepEqual(await snapshot(f.dist), before);
});

test('rebuilds bridge dependencies while preserving unrelated generated files', async t => {
  const f = await fixture(t);
  const frontend = path.join(f.desktop, 'frontend');
  await writeFile(path.join(frontend, 'bridge.js'), 'import { value } from "./value.js"; console.log(value);');
  await writeFile(path.join(frontend, 'value.js'), 'export const value = "before";');
  await prepareWeb(f.web, f.desktop);
  const old = new Date('2001-01-01T00:00:00Z');
  await utimes(path.join(f.dist, 'index.html'), old, old);
  await writeFile(path.join(frontend, 'value.js'), 'export const value = "after";');
  await prepareWeb(f.web, f.desktop);
  assert.match(await readFile(path.join(f.dist, 'bridge.js'), 'utf8'), /after/);
  assert.equal((await stat(path.join(f.dist, 'index.html'))).mtimeMs, old.getTime());
});

test('reused output still rejects nested links before any writes', async t => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const before = await readFile(path.join(f.dist, 'index.html'));
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep'), 'keep');
  await symlink(outside, path.join(f.dist, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(f.web, 'index.html'), f.html.replace('Go', 'Changed'));
  await assert.rejects(prepareWeb(f.web, f.desktop), /link/i);
  assert.deepEqual(await readFile(path.join(f.dist, 'index.html')), before);
  assert.equal(await readFile(path.join(outside, 'keep'), 'utf8'), 'keep');
});

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

test('adds the independent account script after the native bridge without changing the Web entry', async t => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const html = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  assert.match(html, /src="\.\/codebuddy-login\.js"/);
  assert(html.indexOf('src="./bridge.js"') < html.indexOf('src="./codebuddy-login.js"'));
  assert.equal(await readFile(path.join(f.dist, 'codebuddy-login.js'), 'utf8'), '"use strict"; // account fixture');
  assert.equal(await readFile(path.join(f.web, 'index.html'), 'utf8'), f.html);
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

test('loads desktop styles last in the head and preserves the source and existing body classes', async (t) => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const html = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\.\/desktop\.css"\s*\/?>\s*<\/head>/);
  assert.ok(html.indexOf('./styles.css') < html.indexOf('./desktop.css'));
  assert.match(html, /<body class="app-ready desktop-mist-blue">/);
  assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), f.desktopCss);
  assert.equal(await readFile(path.join(f.web, 'index.html'), 'utf8'), f.html);
  assert.equal(await readFile(path.join(f.web, 'styles.css'), 'utf8'), 'fixture');
  assert.equal(await readFile(path.join(f.desktop, 'frontend/desktop.css'), 'utf8'), f.desktopCss);
  await prepareWeb(f.web, f.desktop);
  assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), html);
  assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), f.desktopCss);
});

test('injects local titlebar resources and removes only the navigation brand', async t => {
  const f = await fixture(t);
  const source = f.html.replace('<button onclick=', '<aside class="side"><div class="brand"><img src="./app-icon.png"><div><b>Shiroha Quiz</b><span>练习</span></div></div><button class="nav">首页</button></aside><button onclick=');
  await writeFile(path.join(f.web, 'index.html'), source);
  await prepareWeb(f.web, f.desktop);
  const html = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  assert.match(html, /<body[^>]*>\s*<header id="desktop-titlebar">/);
  assert.match(html, /<script src="\.\/titlebar\.js"><\/script>/);
  assert.doesNotMatch(html, /class="brand"/);
  assert.match(html, /<button class="nav">首页<\/button>/);
  assert.equal(await readFile(path.join(f.dist, 'titlebar.js'), 'utf8'), '"use strict";');
  assert.equal(await readFile(path.join(f.web, 'index.html'), 'utf8'), source);
  for (const file of ['titlebar.html', 'titlebar.js']) {
    const input = path.join(f.desktop, 'frontend', file);
    const content = await readFile(input);
    await rm(input);
    await assert.rejects(prepareWeb(f.web, f.desktop), /titlebar/);
    assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), html);
    await writeFile(input, content);
  }
});

test('adds the desktop body marker once with empty, quoted, or unquoted existing classes', async (t) => {
  const f = await fixture(t);
  for (const [attributes, classes] of [
    ['', 'desktop-mist-blue'],
    [' class=""', 'desktop-mist-blue'],
    [" class='app-ready'", 'app-ready desktop-mist-blue'],
    [' class=app-ready', 'app-ready desktop-mist-blue'],
    [' class="app-ready desktop-mist-blue"', 'app-ready desktop-mist-blue'],
  ]) {
    await writeFile(path.join(f.web, 'index.html'), f.html.replace(' class="app-ready"', `${attributes} data-mode="study"`));
    await prepareWeb(f.web, f.desktop);
    const html = await readFile(path.join(f.dist, 'index.html'), 'utf8');
    const body = html.match(/<body\b[^>]*>/)?.[0] ?? '';
    assert.match(body, new RegExp(`class=["']${classes}["']`));
    assert.match(body, /data-mode="study"/);
    assert.equal((body.match(/desktop-mist-blue/g) ?? []).length, 1);
  }
});

test('rejects missing or invalid desktop styles before replacing existing output', async (t) => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const previous = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  const stylesheet = path.join(f.desktop, 'frontend/desktop.css');
  await rm(stylesheet);
  await assert.rejects(prepareWeb(f.web, f.desktop), /desktop\.css/);
  assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), previous);
  assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), f.desktopCss);
  await mkdir(stylesheet);
  await assert.rejects(prepareWeb(f.web, f.desktop), /desktop.*style|desktop\.css/i);
  assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), previous);
  assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), f.desktopCss);
});

test('rejects incomplete document boundaries before replacing existing output', async (t) => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const previous = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  for (const tag of ['<head>', '</head>', '<body class="app-ready">', '</body>']) {
    await writeFile(path.join(f.web, 'index.html'), f.html.replace(tag, ''));
    await assert.rejects(prepareWeb(f.web, f.desktop), /head|body/i);
    assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), previous);
    assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), f.desktopCss);
  }
});

test('rejects a linked frontend directory before reading desktop styles or replacing output', async (t) => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const previous = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'desktop.css'), 'outside');
  const frontend = path.join(f.desktop, 'frontend');
  await rm(path.join(frontend, 'desktop.css'));
  await rm(frontend, { recursive: true });
  await symlink(outside, frontend, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWeb(f.web, f.desktop), /link/i);
  assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), previous);
  assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), f.desktopCss);
  assert.equal(await readFile(path.join(outside, 'desktop.css'), 'utf8'), 'outside');
});

test('rejects a linked desktop stylesheet before replacing existing output', async (t) => {
  const f = await fixture(t);
  await prepareWeb(f.web, f.desktop);
  const previous = await readFile(path.join(f.dist, 'index.html'), 'utf8');
  const outside = path.join(f.root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'keep');
  const stylesheet = path.join(f.desktop, 'frontend/desktop.css');
  await rm(stylesheet);
  await symlink(outside, stylesheet, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWeb(f.web, f.desktop), /link/i);
  assert.equal(await readFile(path.join(f.dist, 'index.html'), 'utf8'), previous);
  assert.equal(await readFile(path.join(f.dist, 'desktop.css'), 'utf8'), f.desktopCss);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
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
