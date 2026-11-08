// scope 列表与 .vscode/settings.json 中 Copilot 生成指令保持一致，改动时两处同步。
const scopes = [
  'web',
  'desktop',
  'native',
  'tauri',
  'parser',
  'shared',
  'test',
  'docs',
  'lint',
  'ci',
  'tooling',
  'deps',
];

// config-conventional 的 subject-full-stop 只检查英文句点，中文句号需要单独规则才能拦住。
const subjectNoCjkFullStop = (parsed) => [
  !(parsed.subject ?? '').endsWith('。'),
  'subject 结尾不要使用中文句号',
];

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{ rules: { 'subject-no-cjk-full-stop': subjectNoCjkFullStop } }],
  rules: {
    'header-max-length': [2, 'always', 72],
    'subject-max-length': [2, 'always', 50],
    'subject-full-stop': [2, 'never', '.'],
    'subject-no-cjk-full-stop': [2, 'always'],
    // 中文 subject 夹英文标识符时 config-conventional 的 case 规则会误判。
    'subject-case': [0],
    // 历史提交的 scope 不规整（原生、Web、review 等），硬失败会挡住既有习惯，先只警告。
    'scope-enum': [1, 'always', scopes],
    // 生成器正文常是超长单行，硬失败会频繁挡提交，降级为警告。
    'body-max-line-length': [1, 'always', 100],
    'footer-max-line-length': [0],
  },
  // VS Code 产生的合并提交与 revert 不应被拦。
  ignores: [(message) => /^Merge /.test(message) || /^Revert /.test(message)],
};
