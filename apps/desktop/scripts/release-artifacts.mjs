import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ ref: string, tag: string, version: string, commit: string, repository: string, runId: string, runAttempt: string }} ReleaseContext */
const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const metadataName = 'release-metadata.json';
const checksumName = 'SHA256SUMS.txt';
const notesName = 'release-notes.md';

/** @param {{ ref?: string, commit?: string, repository?: string, runId?: string, runAttempt?: string }} input */
export function releaseContext(input) {
  const { ref = '', commit = '', repository = '', runId = '', runAttempt = '' } = input;
  const match = /^refs\/tags\/desktop-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(ref);
  if (!match || match[0] !== ref) throw new Error('Release 必须使用 desktop-v<major>.<minor>.<patch> 标签');
  if (!/^[a-f0-9]{40}$/.test(commit) || commit.length !== 40) throw new Error('Release commit 必须是完整 SHA');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) || /\s/.test(repository)) throw new Error('Release repository 无效');
  for (const value of [runId, runAttempt]) {
    if (!/^[1-9]\d*$/.test(value) || /\s/.test(value)) throw new Error('Release run identity 无效');
  }
  return { ref, tag: ref.slice('refs/tags/'.length), version: match[1], commit, repository, runId, runAttempt };
}

export function contextFromEnvironment() {
  return releaseContext({
    ref: process.env.GITHUB_REF, commit: process.env.RELEASE_COMMIT || process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
}

/** @param {string} root @param {ReleaseContext} context */
export function releaseDirectory(root, context) {
  return path.join(root, '.reports', 'desktop-release', `${context.runId}-${context.runAttempt}`);
}

/** @param {ReleaseContext} context */
export function binaryNames(context) {
  const prefix = `Shiroha-Quiz_${context.version}_windows-x64`;
  return { exe: `${prefix}.exe`, nsis: `${prefix}-setup.exe`, offline: `${prefix}-offline-setup.exe` };
}

/** @param {string} file */
async function rejectLinkedPath(file) {
  const absolute = path.resolve(file);
  const drive = path.parse(absolute).root;
  let current = drive;
  // CI 的同一次运行独占暂存目录；逐层检查也阻止父目录 junction 将读写引向工作树外。
  for (const part of path.relative(drive, absolute).split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Release 不接受链接路径: ${current}`);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

/** @param {string} file */
async function nonemptyFile(file) {
  await rejectLinkedPath(file);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Release 需要非空普通文件: ${file}`);
  return stat;
}

/** @param {string} file */
async function readText(file) {
  await nonemptyFile(file);
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
}

/** @param {string} source @param {boolean} lockfile */
function cargoVersion(source, lockfile) {
  const blocks = source.split(lockfile ? /^\[\[package\]\]\s*$/m : /^\[package\]\s*$/m).slice(1);
  const packages = blocks.map((block) => block.split(/^\[/m)[0]);
  const application = packages.filter((block) => /^name\s*=\s*"shiroha-quiz-desktop"\s*$/m.test(block));
  if (application.length !== 1) throw new Error('Cargo 应用包版本记录缺失或重复');
  return /^version\s*=\s*"([^"]+)"\s*$/m.exec(application[0])?.[1];
}

/** @param {string} root @param {ReleaseContext} context */
export async function validateVersions(root, context) {
  const validated = releaseContext(context);
  if (validated.tag !== context.tag || validated.version !== context.version) throw new Error('Release 版本上下文不一致');
  /** @param {string} name */
  const read = (name) => readText(path.join(root, name));
  const pkg = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const versions = [pkg?.version, lock?.version, lock?.packages?.['']?.version, config?.version,
    cargoVersion(await read('src-tauri/Cargo.toml'), false), cargoVersion(await read('src-tauri/Cargo.lock'), true)];
  if (versions.some((version) => version !== context.version)) throw new Error('Release 标签与应用/锁文件版本不一致');
}

/** @param {ReleaseContext} context */
function metadata(context) {
  return `${JSON.stringify({ ...context, target: 'x86_64-pc-windows-msvc', artifacts: binaryNames(context) }, null, 2)}\n`;
}

/** @param {string} root @param {ReleaseContext} context */
async function verifyMetadata(root, context) {
  await validateVersions(root, context);
  const stored = await readText(path.join(releaseDirectory(root, context), metadataName));
  if (stored !== metadata(context)) throw new Error('Release 元数据与当前标签、提交或运行不一致');
}

/** @param {string} root @param {ReleaseContext} context */
export async function initializeRelease(root, context) {
  await validateVersions(root, context);
  const output = releaseDirectory(root, context);
  await rejectLinkedPath(output);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(output, metadataName), metadata(context), { flag: 'wx' });
  return output;
}

/** @param {string} root @param {ReleaseContext} context @param {string} kind */
export async function stageArtifact(root, context, kind) {
  const names = binaryNames(context);
  if (kind !== 'exe' && kind !== 'nsis' && kind !== 'offline') throw new Error('Release 制品类型无效');
  await verifyMetadata(root, context);
  const output = releaseDirectory(root, context);
  if (kind !== 'exe') await nonemptyFile(path.join(output, names.exe));
  if (kind === 'offline') await nonemptyFile(path.join(output, names.nsis));
  const source = kind === 'exe'
    ? path.join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/shiroha-quiz-desktop.exe')
    : path.join(root, `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Shiroha Quiz_${context.version}_x64-setup.exe`);
  const destination = path.join(output, names[kind]);
  await nonemptyFile(source);
  await rejectLinkedPath(destination);
  await copyFile(source, destination, constants.COPYFILE_EXCL);
}

/** @param {string} file */
async function sha256(file) {
  await nonemptyFile(file);
  const hash = createHash('sha256');
  // 离线安装包包含完整运行时；流式摘要避免把多个大附件同时载入内存。
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string} root @param {ReleaseContext} context */
async function checksums(root, context) {
  const names = binaryNames(context);
  const directory = releaseDirectory(root, context);
  /** @type {Map<string, string>} */
  const digests = new Map();
  for (const name of [...Object.values(names), metadataName]) digests.set(name, await sha256(path.join(directory, name)));
  if (digests.get(names.nsis) === digests.get(names.offline)) throw new Error('普通和离线安装包字节相同，请分别在构建后收集');
  return [...digests].map(([name, digest]) => `${digest}  ${name}\n`).join('');
}

/** @param {ReleaseContext} context */
function releaseNotes(context) {
  const names = binaryNames(context);
  const repositoryUrl = `https://github.com/${context.repository}`;
  return `# Shiroha Quiz Windows ${context.version} 预览版

标签：\`${context.tag}\`；提交：[\`${context.commit}\`](${repositoryUrl}/commit/${context.commit})。
构建记录：[${context.runId} / ${context.runAttempt}](${repositoryUrl}/actions/runs/${context.runId}/attempts/${context.runAttempt})。

| 附件 | 用途 |
| --- | --- |
| \`${names.exe}\` | 独立 EXE，需要已有 WebView2；用户数据仍保存在应用数据目录，不是数据便携版 |
| \`${names.nsis}\` | 普通安装包，缺少 WebView2 时联网准备运行时 |
| \`${names.offline}\` | 离线安装包，包含 WebView2 安装程序 |

安装包未签名。现有验证环境为 Windows 11 26200 x64、WebView2 155.0.4283.62；Windows 10、最低运行时版本及干净系统安装、覆盖升级、卸载保留等尚未完成验收。CI 成功不代表正式发行验收通过。

离线包构建时仍需下载运行时，不包含 Codex/CodeBuddy 的按需运行组件；组件首次准备、登录及 AI 服务仍需联网。升级前请导出完整备份并关闭应用，升级后核对题库、图片、收藏和学习记录。详见[该版本桌面说明](${repositoryUrl}/blob/${context.commit}/apps/desktop/README.md)。

下载后在 PowerShell 运行 \`Get-FileHash -Algorithm SHA256 '.\\文件名.exe'\`，将 Hash 与 \`SHA256SUMS.txt\` 中同名文件的摘要比较（忽略大小写）。\`release-metadata.json\` 记录版本、提交和构建运行信息；摘要也覆盖该文件。

维护者公开此草稿前须核对附件、摘要与安装验收结果，保留未验收项和预发布标识。
`;
}

/** @param {string} root @param {ReleaseContext} context */
export async function finalizeRelease(root, context) {
  await verifyMetadata(root, context);
  const output = releaseDirectory(root, context);
  const sums = await checksums(root, context);
  for (const name of [notesName, checksumName]) await rejectLinkedPath(path.join(output, name));
  await writeFile(path.join(output, notesName), releaseNotes(context), { flag: 'wx' });
  await writeFile(path.join(output, checksumName), sums, { flag: 'wx' });
  await verifyRelease(root, context);
}

/** @param {string} root @param {ReleaseContext} context */
export async function verifyRelease(root, context) {
  await verifyMetadata(root, context);
  const output = releaseDirectory(root, context);
  const assetNames = [...Object.values(binaryNames(context)), metadataName, checksumName];
  const expected = [...assetNames, notesName].sort();
  if (JSON.stringify((await readdir(output)).sort()) !== JSON.stringify(expected)) throw new Error('Release 文件清单不匹配');
  if (await readText(path.join(output, checksumName)) !== await checksums(root, context)) throw new Error('Release SHA-256 校验失败');
  if (await readText(path.join(output, notesName)) !== releaseNotes(context)) throw new Error('Release 发布说明不匹配');
  return assetNames.map((name) => path.join(output, name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const context = contextFromEnvironment();
    const [command, kind] = process.argv.slice(2);
    switch (command) {
      case 'validate': await validateVersions(desktopRoot, context); break;
      case 'init': await initializeRelease(desktopRoot, context); break;
      case 'stage': await stageArtifact(desktopRoot, context, kind); break;
      case 'finalize': await finalizeRelease(desktopRoot, context); break;
      case 'verify': await verifyRelease(desktopRoot, context); break;
      default: throw new Error('用法: release-artifacts.mjs validate|init|stage <exe|nsis|offline>|finalize|verify');
    }
    console.log(`Release ${command}: ${context.tag} (${context.commit})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release 制品处理失败');
    process.exitCode = 1;
  }
}
