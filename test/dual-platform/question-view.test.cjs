'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { runWebScripts } = require('./source-tools.cjs');

test('MathJax 预热合并配置时保留已有赋值语义', () => {
  const texPrototype = { marker: 'tex' };
  const optionsPrototype = { marker: 'options' };
  let reads = 0;
  const tex = { processEscapes: false };
  const options = { skipHtmlTags: ['custom'] };
  Object.defineProperty(tex, '__proto__', { value: texPrototype, enumerable: true });
  Object.defineProperty(options, '__proto__', { value: optionsPrototype, enumerable: true });
  Object.defineProperty(tex, 'customSetting', {
    enumerable: true,
    get() { reads += 1; return 'preserved'; },
  });
  const scripts = [];
  const document = {
    createElement(tag) { assert.equal(tag, 'script'); return {}; },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const window = {
    MathJax: { tex, options },
    requestIdleCallback(callback) { callback(); },
  };
  const context = vm.createContext({ window, document });
  runWebScripts(context, ['question-view.js']);
  context.ShirohaQuestionView.create({}).prewarmMathJaxV56();
  assert.equal(Object.getPrototypeOf(window.MathJax.tex), texPrototype);
  assert.equal(Object.getPrototypeOf(window.MathJax.options), optionsPrototype);
  assert.equal(Object.hasOwn(window.MathJax.tex, '__proto__'), false);
  assert.equal(Object.hasOwn(window.MathJax.options, '__proto__'), false);
  assert.equal(window.MathJax.tex.processEscapes, false);
  assert.equal(window.MathJax.tex.customSetting, 'preserved');
  assert.equal(reads, 1);
  assert.deepEqual(window.MathJax.options.skipHtmlTags, ['custom']);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, './libs/mathjax/tex-mml-chtml.js');
  scripts[0].onload();
});
