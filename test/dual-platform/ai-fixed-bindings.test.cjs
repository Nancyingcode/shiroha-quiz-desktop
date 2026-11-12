'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('AI 六个固定按钮直接绑定原处理器，缺节点和重复绑定不改变调用语义', () => {
  const calls = [];
  const handlers = {};
  for (const name of ['test', 'toggleDiagnostic', 'copyDiagnostic', 'copyCors', 'clear']) {
    handlers[name] = function handler(event) {
      calls.push({ name, receiver: this, event });
      return name;
    };
  }
  const selectors = {
    '#ai-test-connection-v99': 'test',
    '#ai-toggle-diagnostics-v375': 'toggleDiagnostic',
    '#ai-copy-diagnostics-v375': 'copyDiagnostic',
    '#ai-copy-ollama-cors-v375': 'copyCors',
    '#ai-clear-settings-v99': 'clear',
    '#ai-organize-import-btn-v99': 'open',
  };
  for (const absent of [null, ...Object.keys(selectors)]) {
    const nodes = Object.fromEntries(Object.keys(selectors).filter((key) => key !== absent).map((key) => [key, {}]));
    nodes['#ai-import-panel-v99'] = { classList: { contains: () => true } };
    nodes['#ai-preview-panel-v991'] = { classList: { contains: () => true } };
    const context = vm.createContext({});
    let source = fs.readFileSync(path.join(__dirname, '../../apps/web/ai-import-panel.js'), 'utf8');
    // 单行锚点：不依赖文件换行符（CRLF/LF），也不受逐行排版规则影响。
    const anchor = 'bindAiImportEventsV99,';
    assert(source.includes(anchor));
    source = source.replace(anchor, 'bindAiImportEventsV99, openAiImportPanelV99,');
    vm.runInContext(source, context);
    let notices = 0;
    const panel = context.ShirohaAiImportPanel.create({
      draft: { questions: [] },
      sessions: { importRequest: {}, previewRequest: {} },
      platform: {},
      select: (selector) => nodes[selector] || null,
      selectAll: () => [],
      settings: { ...handlers, render() {} },
      requests: {},
      editor: { isEditing: () => true },
      preview: {},
      limits: {},
      showNotice: () => { notices += 1; },
    });
    panel.bindAiImportEventsV99();
    panel.bindAiImportEventsV99();
    for (const [selector, name] of Object.entries(selectors)) {
      const node = nodes[selector];
      if (!node) { continue; }
      const original = name === 'open' ? panel.openAiImportPanelV99 : handlers[name];
      assert.equal(node.onclick, original, selector);
      const event = { selector };
      const result = node.onclick(event);
      if (name === 'open') {
        assert.equal(result, undefined);
        assert.equal(notices, 1);
      } else {
        assert.equal(result, name);
        assert.equal(calls.at(-1).receiver, node);
        assert.equal(calls.at(-1).event, event);
      }
    }
  }
  assert.equal(calls.length, 30);
});
