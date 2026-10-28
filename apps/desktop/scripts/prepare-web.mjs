import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const entries = ['index.html', 'app.js', 'training.js', 'styles.css', 'question-bank.js', 'app-icon.png', 'data', 'media', 'libs', 'platform'];
export const requiredAssets = [
  'platform/validation.js', 'platform/browser.js', 'platform/browser-network.js', 'platform/browser-credentials.js', 'platform/save-queue.js', 'platform/index.js',
  'index.html', 'app.js', 'training.js', 'styles.css', 'question-bank.js', 'app-icon.png',
  'libs/pdf.min.mjs', 'libs/pdf.worker.min.mjs',
  'libs/wasm/openjpeg.wasm', 'libs/standard_fonts/LiberationSans-Regular.ttf',
  'libs/cmaps/Adobe-GB1-UCS2.bcmap', 'libs/iccs/CGATS001Compat-v2-micro.icc',
  'libs/ocr/tesseract/tesseract.min.js', 'libs/ocr/tesseract/worker.min.js',
  'libs/ocr/core/tesseract-core-simd-lstm.wasm.js', 'libs/ocr/core/tesseract-core-lstm.wasm.js',
  'libs/ocr/lang/eng.traineddata.gz', 'libs/ocr/lang/chi_sim.traineddata.gz',
  'libs/mathjax/tex-mml-chtml.js', 'libs/mathjax/output/chtml/fonts/woff-v2/MathJax_Main-Regular.woff',
];

/** @param {string} parent @param {string} child */
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** @param {string} target @param {Map<string, import('node:fs').Stats>} [inspected] */
async function rejectLinks(target, inspected = new Map()) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw new Error(`Linked assets/output are not supported: ${target}`);
  inspected.set(target, stat);
  if (stat.isDirectory()) {
    for (const name of await readdir(target)) await rejectLinks(path.join(target, name), inspected);
  }
  return inspected;
}

/** @param {string} html */
export function optimizeDesktopHtml(html) {
  // Desktop opens directly into the initialized page; retaining the Web splash keeps
  // a full-window animation and its image alive after the application is ready.
  const withoutSplash = html.replace(/<div class="app-splash"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*(?=<div class="app">)/, '');
  if (/class="app-splash"/.test(withoutSplash)) throw new Error('Unsupported Web splash structure');
  return withoutSplash
    .replace('在本机浏览器中记住 API Key', '使用 Windows 凭据管理器记住 API Key')
    .replace('API Key 默认只保留在当前标签页；勾选“在本机浏览器中记住”后也不会进入 Web 完整备份。', 'API Key 默认只保留在当前进程；选择记住后保存在 Windows 凭据管理器，不会进入备份。')
    .replace(/(<aside class="side">)\s*<div class="brand">\s*<img\b[^>]*>\s*<div>[\s\S]*?<\/div>\s*<\/div>/, '$1')
    .replace(/<link\b[^>]*rel="preload"[^>]*href="\.\/media\/(?:home_welcome_avatar|import_question_bank_folder)\.webp"[^>]*>\s*/g, '')
    .replace(/<img\b(?![^>]*\bloading=)(?=[^>]*src="\.\/media\/(?!splash_mascot\.webp|peeking\.webp)[^"]+")/g, '<img loading="lazy" decoding="async"');
}

/** @param {string} html */
export function externalizeEvents(html) {
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html) || /\b(?:href|src)\s*=\s*["']\s*javascript:/i.test(html)) {
    throw new Error('Unsupported inline script in Web entry point');
  }
  /** @type {string[]} */
  const handlers = [];
  const transformed = html.replace(/\s(on[a-z]+)\s*=\s*(["'])([\s\S]*?)\2/gi, (_match, attribute, _quote, body) => {
    const type = String(attribute).slice(2).toLowerCase();
    if (!['click', 'error'].includes(type)) throw new Error(`Unsupported inline handler: ${attribute}`);
    const index = handlers.length;
    const code = String(body).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    // Bind trusted repository handlers at build time: CSP never needs eval or inline script permission.
    handlers.push(`document.querySelector('[data-desktop-event-${index}]').addEventListener('${type}', function(event) {\n${code}\n});`);
    return ` data-desktop-event-${index}=""`;
  });
  if (/\son[a-z]+\s*=/i.test(transformed)) throw new Error('Unsupported inline handler syntax');
  if (!/<\/body>/i.test(transformed)) throw new Error('Web entry point has no closing body');
  return {
    html: transformed.replace(/<\/body>/i, '  <script src="./desktop-events.js"></script>\n</body>'),
    script: `'use strict';\n${handlers.join('\n')}\n`,
  };
}

/** @param {string} html */
function applyDesktopStyles(html) {
  if (!/<head\b[^>]*>/i.test(html) || !/<\/head>/i.test(html)) throw new Error('Web entry point has no complete head');
  if (!/<body\b[^>]*>/i.test(html) || !/<\/body>/i.test(html)) throw new Error('Web entry point has no complete body');
  return html
    .replace(/<\/head>/i, '  <link rel="stylesheet" href="./desktop.css">\n</head>')
    .replace(/<body\b[^>]*>/i, (body) => {
      const attribute = body.match(/\sclass\s*=\s*(?:(["'])([\s\S]*?)\1|([^\s"'=<>`]+))/i);
      if (!attribute) return body.replace(/>$/, ' class="desktop-mist-blue">');
      const classes = (attribute[2] ?? attribute[3] ?? '').split(/\s+/).filter(Boolean);
      if (classes.includes('desktop-mist-blue')) return body;
      const quote = attribute[1] || '"';
      return body.replace(attribute[0], ` class=${quote}${[...classes, 'desktop-mist-blue'].join(' ')}${quote}`);
    });
}

/** @typedef {{ source?: string, contents?: Uint8Array | string } | null} Asset */

/** @param {string} source @param {Map<string, import('node:fs').Stats>} inspected @param {Map<string, Asset>} expected */
function collectAssets(source, inspected, expected) {
  // 安全扫描按父目录优先遍历，复用其结果以免再次逐文件查询元数据。
  for (const [input, metadata] of inspected) {
    const name = path.relative(source, input);
    if (!entries.includes(name.split(path.sep)[0])) continue;
    const parent = path.dirname(name);
    if (parent !== '.' && !expected.has(parent)) continue;
    const basename = path.basename(input);
    const license = /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(basename);
    const tooling = /\.(?:ps1|cmd|md|map)$/i.test(input) || /^readme(?:\.|$)/i.test(basename) || basename === 'package.json';
    if (!license && tooling) continue;
    expected.set(name, metadata.isDirectory() ? null : { source: input });
  }
}

/** @param {string} file */
async function statIfPresent(file) {
  try { return await lstat(file); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** @param {string} output @param {Map<string, Asset>} expected */
async function synchronizeAssets(output, expected) {
  const root = await statIfPresent(output);
  if (root && !root.isDirectory()) await rm(output);
  await mkdir(output, { recursive: true });
  // 调用方已检查整棵树；同步与编译必须串行，不能让另一个进程同时修改生成目录。
  /** @param {string} directory */
  async function prune(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const name = path.relative(output, file);
      const wanted = expected.get(name);
      const wrongType = expected.has(name) && entry.isDirectory() !== (wanted === null);
      if (!expected.has(name) || wrongType) await rm(file, { recursive: true, force: true });
      else if (entry.isDirectory()) await prune(file);
    }
  }
  await prune(output);
  for (const [name, asset] of expected) {
    const file = path.join(output, name);
    if (asset === null) {
      await mkdir(file, { recursive: true });
      continue;
    }
    // 按文件比较字节，不信任时间戳；未变化输出的 mtime 用于避免下游重复构建。
    const contents = asset.source ? await readFile(asset.source) : Buffer.from(asset.contents ?? '');
    const metadata = await statIfPresent(file);
    if (metadata?.size === contents.length && contents.equals(await readFile(file))) continue;
    await writeFile(file, contents);
  }
}

/** @param {string} sourceDir @param {string} projectDir */
export async function prepareWeb(sourceDir, projectDir) {
  const source = await realpath(sourceDir);
  const project = await realpath(projectDir);
  if (contains(source, project) || contains(project, source)) throw new Error('Source and desktop directories must not overlap');
  const output = path.resolve(project, 'dist');
  if (path.dirname(output) !== project) throw new Error('Output must stay within the desktop project');
  const sourceFiles = await rejectLinks(source);
  try { await rejectLinks(output); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  for (const name of requiredAssets) {
    const stat = await lstat(path.join(source, name));
    if (!stat.isFile()) throw new Error(`Missing offline asset: ${name}`);
  }
  const frontend = path.join(project, 'frontend');
  const stylesheet = path.join(frontend, 'desktop.css');
  // Check both path components before reading so a frontend junction cannot bypass the asset boundary.
  const frontendStat = await lstat(frontend);
  if (frontendStat.isSymbolicLink()) throw new Error(`Linked assets/output are not supported: ${frontend}`);
  if (!frontendStat.isDirectory()) throw new Error(`Missing desktop frontend directory: ${frontend}`);
  const stylesheetStat = await lstat(stylesheet);
  if (stylesheetStat.isSymbolicLink()) throw new Error(`Linked assets/output are not supported: ${stylesheet}`);
  if (!stylesheetStat.isFile()) throw new Error(`Missing desktop stylesheet: ${stylesheet}`);
  const desktopCss = await readFile(stylesheet);
  const titlebarAssets = new Map();
  for (const name of ['titlebar.html', 'titlebar.js', 'bridge.js', 'adapter.js', 'harness.js', 'codebuddy-login.js']) {
    const input = path.join(frontend, name);
    const inputStat = await lstat(input);
    if (inputStat.isSymbolicLink() || !inputStat.isFile()) throw new Error(`Invalid or linked titlebar asset: ${input}`);
    titlebarAssets.set(name, await readFile(input, 'utf8'));
  }
  const transformed = externalizeEvents(optimizeDesktopHtml(await readFile(path.join(source, 'index.html'), 'utf8')));
  const bridge = await build({ entryPoints: [path.join(frontend, 'bridge.js')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', legalComments: 'inline' });
  const desktopHtml = applyDesktopStyles(transformed.html)
    .replace(/<script src="\.\/(?:platform\/index|app)\.js"><\/script>/, script => `<script src="./bridge.js"></script>\n<script src="./adapter.js"></script>\n<script src="./harness.js"></script>\n<script src="./codebuddy-login.js"></script>\n${script}`)
    .replace(/<body\b[^>]*>/i, body => `${body}\n${titlebarAssets.get('titlebar.html')}`)
    .replace(/<\/body>/i, '  <script src="./titlebar.js"></script>\n</body>');
  /** @type {Map<string, Asset>} */
  const expected = new Map();
  for (const name of entries) {
    const input = path.join(source, name);
    try { await lstat(input); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT' && ['data', 'media'].includes(name)) continue;
      throw error;
    }
  }
  collectAssets(source, sourceFiles, expected);
  expected.set('index.html', { contents: desktopHtml });
  expected.set('desktop.css', { contents: desktopCss });
  expected.set('desktop-events.js', { contents: transformed.script });
  expected.set('bridge.js', { contents: bridge.outputFiles[0].contents });
  for (const name of ['titlebar.js', 'adapter.js', 'harness.js', 'codebuddy-login.js']) {
    expected.set(name, { contents: titlebarAssets.get(name) ?? '' });
  }
  // Only entries within this fixed generated directory are removed, after overlap, link and input checks above.
  await synchronizeAssets(output, expected);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await prepareWeb(path.resolve(desktopRoot, '../web'), desktopRoot);
  console.log(`Desktop assets prepared: ${output}`);
}
