import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFile, copyFile, mkdir, readFile, readdir, rename, stat, symlink, unlink, utimes, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

/** @param {string} project @param {string} name */
async function copyScript(project, name) {
  await copyFile(new URL(`../scripts/${name}`, import.meta.url), path.join(project, 'scripts', name));
}

/** @param {import('node:test').TestContext} t */
async function stylesFixture(t) {
  const fixture = await repositoryFixture(t);
  const project = path.join(fixture.temporary, 'apps/desktop');
  const scss = path.join(fixture.temporary, 'apps/web-scss/ai-panels.scss');
  const css = path.join(fixture.temporary, 'apps/web/styles/ai-panels.css');
  const feedbackScss = path.join(path.dirname(scss), 'controls-and-feedback.scss');
  const feedbackCss = path.join(path.dirname(css), 'controls-and-feedback.css');
  await mkdir(path.dirname(scss));
  await mkdir(path.dirname(css));
  await writeFile(scss, '@mixin label { color: var(--muted); }\r\n.panel { @include label; }\r\n');
  await writeFile(feedbackScss, '.control:focus { outline-offset: -2px; }\n');
  await copyScript(project, 'styles.mjs');
  await copyScript(project, 'styles-targets.mjs');
  return {
    ...fixture,
    project,
    scss,
    css,
    feedbackScss,
    feedbackCss,
  };
}

test('styles:check is read-only and styles:build writes a stable CSS file', async (t) => {
  const { run, css, feedbackCss } = await stylesFixture(t);

  const missing = run('styles.mjs', ['--check']);
  assert.notEqual(missing.status, 0, missing.stdout);
  assert.match(missing.stderr, /ai-panels\.css.*controls-and-feedback\.css.*styles:build/s);
  await assert.rejects(readFile(css), { code: 'ENOENT' });
  await assert.rejects(readFile(feedbackCss), { code: 'ENOENT' });

  const first = run('styles.mjs', ['--build']);
  assert.equal(first.status, 0, first.stderr);
  const generated = await readFile(css, 'utf8');
  const feedback = await readFile(feedbackCss, 'utf8');
  assert.match(generated, /^\/\*.*ai-panels\.scss.*styles:build.*\*\/\n/);
  assert(generated.endsWith('.panel {\n  color: var(--muted);\n}\n'));
  assert.doesNotMatch(generated, /\r|sourceMappingURL/);
  assert.match(feedback, /^\/\*.*controls-and-feedback\.scss.*styles:build.*\*\/\n/);
  assert(feedback.endsWith('.control:focus {\n  outline-offset: -2px;\n}\n'));
  assert.doesNotMatch(feedback, /\r|sourceMappingURL/);
  assert.deepEqual((await readdir(path.dirname(css))).sort(), ['ai-panels.css', 'controls-and-feedback.css']);
  await utimes(css, 1000000000, 1000000000);
  await utimes(feedbackCss, 1000000000, 1000000000);
  const timestamp = (await stat(css)).mtimeMs;
  const feedbackTimestamp = (await stat(feedbackCss)).mtimeMs;
  const second = run('styles.mjs', ['--build']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await stat(css)).mtimeMs, timestamp);
  assert.equal((await stat(feedbackCss)).mtimeMs, feedbackTimestamp);

  const matching = run('styles.mjs', ['--check']);
  assert.equal(matching.status, 0, matching.stderr);
  await appendFile(css, '.edited { display: none; }\n');
  const edited = await readFile(css);
  const stale = run('styles.mjs', ['--check']);
  assert.notEqual(stale.status, 0, stale.stdout);
  assert.match(stale.stderr, /ai-panels\.css.*styles:build/s);
  assert.deepEqual(await readFile(css), edited);

  const rebuilt = run('styles.mjs', ['--build']);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(await readFile(css, 'utf8'), generated);
  assert.equal((await stat(feedbackCss)).mtimeMs, feedbackTimestamp);

  await unlink(feedbackCss);
  const missingFeedback = run('styles.mjs', ['--check']);
  assert.notEqual(missingFeedback.status, 0, missingFeedback.stdout);
  assert.match(missingFeedback.stderr, /controls-and-feedback\.css.*styles:build/s);
  await assert.rejects(readFile(feedbackCss), { code: 'ENOENT' });
  const rebuiltFeedback = run('styles.mjs', ['--build']);
  assert.equal(rebuiltFeedback.status, 0, rebuiltFeedback.stderr);
  assert.equal(await readFile(feedbackCss, 'utf8'), feedback);
});

test('failed SCSS compilation or a linked output directory preserves existing CSS', async (t) => {
  const {
    run,
    temporary,
    scss,
    css,
    feedbackScss,
    feedbackCss,
  } = await stylesFixture(t);
  const existingAi = '/* existing AI CSS */\n';
  const existingFeedback = '/* existing feedback CSS */\n';
  await writeFile(css, existingAi);
  await writeFile(feedbackCss, existingFeedback);
  for (const input of [scss, feedbackScss]) {
    const source = await readFile(input);
    await appendFile(input, '.broken {');
    for (const mode of ['--build', '--check']) {
      const failed = run('styles.mjs', [mode]);
      assert.notEqual(failed.status, 0, failed.stdout);
      assert(failed.stderr.includes(path.basename(input)), failed.stderr);
      assert.equal(await readFile(css, 'utf8'), existingAi);
      assert.equal(await readFile(feedbackCss, 'utf8'), existingFeedback);
    }
    await writeFile(input, source);
  }
  const generatedFiles = ['ai-panels.css', 'controls-and-feedback.css'];
  assert.deepEqual((await readdir(path.dirname(css))).sort(), generatedFiles);

  const elsewhere = path.join(temporary, 'unrelated');
  await rename(path.dirname(css), elsewhere);
  await symlink(elsewhere, path.dirname(css), 'junction');
  const linked = run('styles.mjs', ['--build']);
  assert.notEqual(linked.status, 0, linked.stdout);
  assert.match(linked.stderr, /链接/);
  assert.equal(await readFile(path.join(elsewhere, 'ai-panels.css'), 'utf8'), existingAi);
  assert.equal(await readFile(path.join(elsewhere, 'controls-and-feedback.css'), 'utf8'), existingFeedback);
  assert.deepEqual((await readdir(elsewhere)).sort(), generatedFiles);
});

test('the desktop preparation entry refuses stale CSS before replacing dist', async (t) => {
  const {
    project,
    run,
    css,
    feedbackCss,
  } = await stylesFixture(t);
  await copyScript(project, 'prepare-web.mjs');
  const built = run('styles.mjs', ['--build']);
  assert.equal(built.status, 0, built.stderr);
  const dist = path.join(project, 'dist');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), 'previous desktop build');

  for (const artifact of [css, feedbackCss]) {
    const generated = await readFile(artifact);
    const stale = '/* stale CSS */\n';
    await writeFile(artifact, stale);
    const failed = run('prepare-web.mjs');
    assert.notEqual(failed.status, 0, failed.stdout);
    assert(failed.stderr.includes(path.basename(artifact)), failed.stderr);
    assert.match(failed.stderr, /styles:build/);
    assert.equal(await readFile(artifact, 'utf8'), stale);
    assert.deepEqual(await readdir(dist), ['index.html']);
    assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), 'previous desktop build');
    await writeFile(artifact, generated);
  }
});

test('SCSS lint checks valid mixins and rejects unknown directives in partials', async (t) => {
  const { project, scss } = await stylesFixture(t);
  await copyFile(new URL('../stylelint.scss.config.mjs', import.meta.url), path.join(project, 'stylelint.scss.config.mjs'));
  await copyFile(new URL('../package.json', import.meta.url), path.join(project, 'package.json'));
  const lint = () => spawnSync('pnpm run --silent lint:scss', {
    cwd: project,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', PNPM_CONFIG_PM_ON_FAIL: 'ignore' },
  });
  const passing = lint();
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);

  await writeFile(path.join(path.dirname(scss), '_invalid.SCSS'), '@incldue missing;\n');
  const failing = lint();
  assert.notEqual(failing.status, 0, failing.stdout);
  assert.match(failing.stdout + failing.stderr, /scss\/at-rule-no-unknown/);
});
