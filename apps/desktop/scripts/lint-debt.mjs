import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { createConfig } from '../eslint.rules.mjs';
import { legacyStyleFiles, semanticDebt } from '../eslint.migration.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--file')) {
  throw new Error('Usage: node scripts/lint-debt.mjs [--file repository-relative-path]');
}
const files = args.length ? [args[1]]
  : [...new Set([...legacyStyleFiles, ...Object.keys(semanticDebt)])];
for (const file of files) {
  const relative = path.relative(root, path.resolve(root, file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Debt diagnostics must stay inside the repository.');
  }
}
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: createConfig({ debt: true, semanticOnly: true }),
});
const results = await lint.lintFiles(files);
const semanticResultCount = results.length;
const styleFiles = files.filter((file) => legacyStyleFiles.includes(file));
if (styleFiles.length) {
  const styleLint = new ESLint({
    cwd: root, overrideConfigFile: true, overrideConfig: createConfig({ debt: true }),
  });
  const styleResults = await styleLint.lintFiles(styleFiles);
  for (const result of styleResults) {
    result.messages = result.messages.filter((message) => message.fatal
      || message.ruleId === null || message.ruleId.startsWith('@stylistic/'));
  }
  results.push(...styleResults);
}
const failures = results.flatMap((result) => result.messages.filter((message) => message.fatal
  || message.ruleId === null).map((message) => `${result.filePath}: ${message.message}`));
if (failures.length) {
  throw new Error(failures.join('\n'));
}
const report = results.map((result, index) => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const message of result.messages) {
    const rule = message.ruleId;
    if (rule) {
      counts[rule] = (counts[rule] || 0) + 1;
    }
  }
  return {
    kind: index < semanticResultCount ? 'semantic' : 'format',
    file: path.relative(root, result.filePath).replaceAll('\\', '/'),
    counts,
    diagnostics: result.messages.map(({ ruleId, line, column, message }) => ({
      rule: ruleId, line, column, message,
    })),
  };
});
console.log(JSON.stringify({
  scope: 'semantic diagnostics plus deferred Stylistic files; execution/parse failures exit nonzero',
  files: report,
}, null, 2));
