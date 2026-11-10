import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {{ pull_request?: { base?: { sha?: string, ref?: string }, head?: { sha?: string } } }} PullRequestEvent */
/** @typedef {{ mode: 'full' | 'changed', reason: string, changed: string[], files: string[] }} LintPlan */
/** @typedef {{ ok: boolean, json: () => Promise<unknown> }} ApiResponse */
/** @typedef {{ id: number, path: string, head_sha: string, head_branch: string,
 * event: string, status: string, conclusion: string }} WorkflowRun */
/** @typedef {{ name: string, conclusion: string, steps?: Array<{ name: string, conclusion: string }> }} WorkflowJob */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const desktop = fileURLToPath(new URL('..', import.meta.url));
const jsFile = /\.(?:js|mjs|cjs)$/i;
const shaPattern = /^[a-f\d]{40}$/i;

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync('git', ['--no-optional-locks', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
}

/** @param {string} file */
function affectsLintConfiguration(file) {
  const name = path.posix.basename(file);
  return file.startsWith('.github/workflows/')
    || file.startsWith('.husky/')
    || file === 'apps/desktop/.stylelintignore'
    || file === 'apps/desktop/stylelint-suppressions.json'
    || /^apps\/desktop\/scripts\/(?:lint[^/]*|check-docs)\.mjs$/i.test(file)
    || /^apps\/desktop\/test\/lint-[^/]*\.mjs$/i.test(file)
    || /^(?:eslint(?:\.|$)|\.eslint|prettier(?:\.|$)|\.prettier|tsconfig(?:\.|$)|jsconfig(?:\.|$))/i.test(name)
    || /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/i.test(name)
    || /^(?:\.gitignore|\.gitattributes|\.editorconfig|\.npmrc|\.nvmrc|\.node-version)$/i.test(name)
    || /\.config\.[^.]+$/i.test(name);
}

/**
 * A successful push to the target commit must have run the full lint check.
 * @param {{ baseSha: string, baseRef: string, repository: string, token: string, apiUrl: string,
 *   request?: (url: string, options: RequestInit) => Promise<ApiResponse> }} options
 */
export async function hasPassedBaseline(options) {
  const { baseSha, baseRef, repository, token, apiUrl } = options;
  if (!token || !shaPattern.test(baseSha) || !/^[^/]+\/[^/]+$/.test(repository)) { return false; }
  const request = options.request ?? fetch;
  const [owner, repo] = repository.split('/').map(encodeURIComponent);
  const endpoint = `${apiUrl.replace(/\/$/, '')}/repos/${owner}/${repo}/actions/runs`;
  const query = new URLSearchParams({ head_sha: baseSha, event: 'push', status: 'success', per_page: '100' });
  const init = { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000) };
  try {
    const response = await request(`${endpoint}?${query}`, init);
    if (!response.ok) { return false; }
    const data = /** @type {{ workflow_runs?: WorkflowRun[] }} */ (await response.json());
    const candidates = (data.workflow_runs ?? []).filter((run) => run.path === '.github/workflows/desktop.yml'
      && run.head_sha === baseSha && run.head_branch === baseRef && run.event === 'push'
      && run.status === 'completed' && run.conclusion === 'success');
    for (const run of candidates) {
      const jobs = await request(`${endpoint}/${run.id}/jobs?per_page=100`, init);
      if (!jobs.ok) { return false; }
      const result = /** @type {{ jobs?: WorkflowJob[] }} */ (await jobs.json());
      const checked = (result.jobs ?? []).some((job) => job.name === 'checks' && job.conclusion === 'success'
        && job.steps?.some((step) => ['Run npm run lint', 'CI lint'].includes(step.name)
          && step.conclusion === 'success'));
      if (checked) { return true; }
    }
  } catch {
    // 无法证明基线通过时必须全量检查；网络或权限错误不能变成跳过检查。
    return false;
  }
  return false;
}

/**
 * @param {{ root: string, eventName: string, event: PullRequestEvent, sha: string,
 *   hasBaseline: (baseSha: string, baseRef: string) => Promise<boolean> }} options
 * @returns {Promise<LintPlan>}
 */
export async function planCiLint(options) {
  const full = (/** @type {string} */ reason) => /** @type {LintPlan} */ ({
    mode: 'full', reason, changed: [], files: [],
  });
  if (options.eventName !== 'pull_request') { return full('非普通 PR，执行全量检查'); }
  const base = options.event.pull_request?.base?.sha ?? '';
  const baseRef = options.event.pull_request?.base?.ref ?? '';
  const head = options.event.pull_request?.head?.sha ?? '';
  if (!shaPattern.test(base) || !shaPattern.test(head) || !shaPattern.test(options.sha) || !baseRef) {
    return full('PR 事件缺少有效的提交信息');
  }
  let changed;
  let candidates;
  try {
    const actual = git(options.root, ['rev-parse', 'HEAD']).trim();
    if (actual !== options.sha) { throw new Error('CI 检出的提交与预期提交不一致'); }
    const parents = git(options.root, ['show', '-s', '--format=%P', 'HEAD']).trim().split(' ');
    if (parents.length !== 2 || parents[0] !== base || parents[1] !== head) {
      return full('检出提交与 PR 目标分支或源分支不一致');
    }
    git(options.root, ['cat-file', '-e', `${base}^{commit}`]);
    git(options.root, ['cat-file', '-e', `${head}^{commit}`]);
    const diff = ['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z'];
    changed = git(options.root, [...diff, base, options.sha]).split('\0').filter(Boolean);
    candidates = git(options.root, [...diff, '--diff-filter=ACMT', base, options.sha]).split('\0').filter(Boolean);
  } catch (error) {
    if (error instanceof Error && error.message === 'CI 检出的提交与预期提交不一致') { throw error; }
    return full('无法可靠获取 PR 比较范围');
  }
  const config = changed.find(affectsLintConfiguration);
  if (config) { return full(`检查配置或运行环境发生变化：${config}`); }
  if (!await options.hasBaseline(base, baseRef)) { return full('无法确认目标提交已通过完整检查'); }
  return { mode: 'changed', reason: '基于目标提交和实际检出的合并结果', changed,
    files: candidates.filter((file) => jsFile.test(file)) };
}

/** @param {string} repositoryRoot @param {string[]} files */
export async function lintChangedFiles(repositoryRoot, files) {
  if (!files.length) {
    console.log('No changed JavaScript files to check.');
    return true;
  }
  const { ESLint } = await import('eslint');
  const lint = new ESLint({ cwd: repositoryRoot,
    overrideConfigFile: path.join(repositoryRoot, 'apps/desktop/eslint.platform.config.mjs') });
  const modes = new Map();
  // Windows 可能把 Git 符号链接检出为普通文件，因此必须同时验证索引中的类型。
  for (let start = 0; start < files.length; start += 64) {
    const selected = files.slice(start, start + 64);
    const entries = git(repositoryRoot, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...selected]);
    for (const entry of entries.split('\0').filter(Boolean)) {
      const separator = entry.indexOf('\t');
      const [mode, , stage] = entry.slice(0, separator).split(' ');
      if (stage === '0') { modes.set(entry.slice(separator + 1), mode); }
    }
  }
  /** @type {import('eslint').ESLint.LintResult[]} */
  const results = [];
  for (const file of files) {
    const target = path.join(repositoryRoot, file);
    if (await lint.isPathIgnored(target)) { continue; }
    const mode = modes.get(file);
    if ((mode !== '100644' && mode !== '100755') || !(await lstat(target)).isFile()) {
      throw new Error(`无法检查非普通 JavaScript 文件：${file}`);
    }
    const source = await readFile(target, 'utf8');
    const [result] = await lint.lintText(source, { filePath: target });
    results.push(result);
  }
  const output = await (await lint.loadFormatter('stylish')).format(results);
  if (output) { console.log(output); }
  console.log(`Checked ${results.length} changed JavaScript files.`);
  return !results.some((result) => result.errorCount || result.warningCount);
}

/** @param {string} script */
function runNpm(script) {
  const npm = process.env.npm_execpath;
  if (!npm) { throw new Error('请通过 npm run lint:ci 启动检查。'); }
  const result = spawnSync(process.execPath, [npm, 'run', script], { cwd: desktop, stdio: 'inherit', windowsHide: true });
  if (result.error) { throw result.error; }
  return result.status === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const expected = process.env.LINT_EXPECTED_SHA ?? '';
  const actual = git(root, ['rev-parse', 'HEAD']).trim();
  if (!shaPattern.test(expected) || actual !== expected) {
    throw new Error('CI 检出的提交与预期提交不一致');
  }
  // CI 必须验证原始提交，而不是前置步骤意外修改后的文件。
  git(root, ['diff', '--quiet', 'HEAD', '--']);
  const event = /** @type {PullRequestEvent} */ (JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')));
  const plan = await planCiLint({ root, eventName: process.env.GITHUB_EVENT_NAME ?? '', event, sha: expected,
    hasBaseline: (baseSha, baseRef) => hasPassedBaseline({ baseSha, baseRef,
      repository: process.env.GITHUB_REPOSITORY ?? '', token: process.env.GITHUB_TOKEN ?? '',
      apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com' }) });
  console.log(`CI lint: ${plan.mode} (${plan.reason})`);
  if (plan.mode === 'full') {
    if (!runNpm('lint')) { process.exitCode = 1; }
  } else {
    const passed = await lintChangedFiles(root, plan.files);
    const cssChanged = plan.changed.some((file) => /\.css$/i.test(file));
    const cssPassed = !cssChanged || runNpm('lint:css');
    // 文档检查涉及链接目标，仍保持项目级检查；规则回归由同一 CI job 的 npm test 执行。
    const docsPassed = runNpm('lint:docs');
    if (!passed || !docsPassed || !cssPassed) { process.exitCode = 1; }
  }
}
