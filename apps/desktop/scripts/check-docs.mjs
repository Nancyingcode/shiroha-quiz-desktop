import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const documents = [
  'README.md',
  '../../AGENTS.md',
  '../../rules/rust-style-guide.md',
  '../../docs/AGENTS-适配说明.md',
  '../../docs/superpowers/specs/2026-10-23-tauri-prototype.md',
  '../../docs/superpowers/plans/2026-10-23-tauri-prototype.md',
];

for (const relative of documents) {
  const file = path.resolve(root, relative);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
  const fences = source.match(/^\s*```/gm) || [];
  if (fences.length % 2 !== 0) throw new Error(`Unclosed Markdown fence: ${relative}`);
  const prose = source.replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of prose.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    await access(path.resolve(path.dirname(file), decodeURIComponent(target)));
  }
}
console.log(`Checked UTF-8, fences and local links in ${documents.length} Markdown files.`);
