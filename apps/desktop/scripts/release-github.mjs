import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { contextFromEnvironment, releaseDirectory, verifyRelease } from './release-artifacts.mjs';

/** @typedef {import('./release-artifacts.mjs').ReleaseContext} ReleaseContext */
/** @typedef {(args: string[]) => Promise<string>} GhRunner */
/** @typedef {{ tag_name: string, draft: boolean, prerelease?: boolean, assets?: { name: string, size: number }[] }} RemoteRelease */
const executeFile = promisify(execFile);
const maximumTagDepth = 8;
const githubApiTimeoutMs = 120_000;
const githubUploadTimeoutMs = 15 * 60_000;
const githubMaximumResponseBytes = 16 * 1024 * 1024;

/** @type {GhRunner} */
async function runGh(args) {
  const { stdout } = await executeFile('gh', args, {
    encoding: 'utf8', maxBuffer: githubMaximumResponseBytes,
    timeout: args[0] === 'release' ? githubUploadTimeoutMs : githubApiTimeoutMs,
    env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' },
  });
  return stdout;
}

/** @param {ReleaseContext} context @param {GhRunner} run */
async function listReleases(context, run) {
  const pages = JSON.parse(await run(['api', '--paginate', '--slurp', `repos/${context.repository}/releases?per_page=100`]));
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error('GitHub Release 列表响应无效');
  /** @type {RemoteRelease[]} */
  const releases = pages.flat();
  if (releases.some((release) => !release || typeof release.tag_name !== 'string' || typeof release.draft !== 'boolean')) throw new Error('GitHub Release 记录无效');
  return releases;
}

/** @param {ReleaseContext} context @param {GhRunner} run */
async function verifyRemoteTag(context, run) {
  let endpoint = `repos/${context.repository}/git/ref/tags/${context.tag}`;
  // 注释标签可以指向另一个标签；限制解引用层数，异常对象不能被当作已验证提交。
  for (let depth = 0; depth < maximumTagDepth; depth += 1) {
    const { object } = JSON.parse(await run(['api', endpoint]));
    if (!object || !/^[a-f0-9]{40}$/.test(object.sha) || object.sha.length !== 40) throw new Error('GitHub 标签对象无效');
    if (object.type === 'commit') {
      if (object.sha !== context.commit) throw new Error('GitHub 标签已改变，拒绝上传其他提交的制品');
      return;
    }
    if (object.type !== 'tag') throw new Error('GitHub 标签未指向提交');
    endpoint = `repos/${context.repository}/git/tags/${object.sha}`;
  }
  throw new Error('GitHub 标签嵌套超过允许层数');
}

/** @param {string} root @param {ReleaseContext} context @param {GhRunner} [run] */
export async function createReleaseDraft(root, context, run = runGh) {
  const assets = await verifyRelease(root, context);
  const existing = (await listReleases(context, run)).some((release) => release.tag_name === context.tag);
  if (existing) throw new Error('同标签 Release 已存在（可能是草稿），请核对后处理；不会覆盖附件');
  await verifyRemoteTag(context, run);
  const directory = releaseDirectory(root, context);
  try {
    await run(['release', 'create', context.tag, ...assets, '--repo', context.repository,
      '--title', `Shiroha Quiz Windows ${context.version} 预览版`,
      '--notes-file', path.join(directory, 'release-notes.md'),
      '--draft', '--prerelease', '--latest=false', '--verify-tag']);
    const draft = (await listReleases(context, run)).find((release) => release.tag_name === context.tag);
    const remoteAssets = draft?.assets;
    const hasCompleteDraft = draft?.draft === true && draft.prerelease === true
      && Array.isArray(remoteAssets) && remoteAssets.length === assets.length;
    if (!hasCompleteDraft) throw new Error('草稿状态或附件数量不匹配');
    for (const file of assets) {
      const remote = remoteAssets.find((asset) => asset.name === path.basename(file));
      if (!remote || remote.size !== (await stat(file)).size) throw new Error('草稿附件名称或大小不匹配');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知上传错误';
    throw new Error(`Release 上传或核验失败，可能保留不完整草稿；请检查 https://github.com/${context.repository}/releases 。不会自动重试或公开。${detail}`, { cause: error });
  }
  return `https://github.com/${context.repository}/releases`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(await createReleaseDraft(fileURLToPath(new URL('..', import.meta.url)), contextFromEnvironment()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release 草稿创建失败');
    process.exitCode = 1;
  }
}
