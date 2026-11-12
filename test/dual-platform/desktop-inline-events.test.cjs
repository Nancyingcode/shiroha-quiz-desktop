'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('实际 Web 七处内联事件生成桌面六个 click 并保留导航和折叠', async () => {
  const { externalizeEvents, optimizeDesktopHtml } = await import('../../apps/desktop/scripts/prepare-web.mjs');
  const html = fs.readFileSync(path.join(__dirname, '../../apps/web/index.html'), 'utf8');
  assert.equal((html.match(/\sonclick=/g) || []).length, 6);
  assert.equal((html.match(/\sonerror=/g) || []).length, 1);
  const optimized = optimizeDesktopHtml(html);
  assert.equal((optimized.match(/\sonerror=/g) || []).length, 0);
  const generated = externalizeEvents(optimized);
  assert.equal((generated.html.match(/data-desktop-event-\d+=/g) || []).length, 6);
  assert.doesNotMatch(generated.html, /\son(?:click|error)=/);
  const nodes = Array.from({ length: 6 }, () => ({
    handler: null,
    addEventListener(_type, handler) { this.handler = handler; },
  }));
  const targets = [];
  const collapsed = new Set();
  const toggle = nodes[5];
  toggle.parentElement = {
    classList: {
      toggle(name) {
        if (collapsed.has(name)) { collapsed.delete(name);return false; }
        collapsed.add(name);return true;
      },
    },
  };
  toggle.setAttribute = (name, value) => { toggle[name] = value; };
  const document = {
    querySelector(selector) {
      const event = selector.match(/data-desktop-event-(\d+)/);
      if (event) { return nodes[Number(event[1])]; }
      const nav = selector.match(/data-view="([^"]+)"/);
      if (nav) { return { click() { targets.push(nav[1]); } }; }
      return null;
    },
  };
  vm.runInNewContext(generated.script, { document });
  for (const node of nodes.slice(0, 5)) { node.handler.call(node, { type: 'click' }); }
  assert.deepEqual(targets, ['practice', 'import', 'banks', 'settings', 'settings']);
  toggle.handler.call(toggle, { type: 'click' });
  assert.equal(toggle['aria-pressed'], 'true');
  assert.equal(toggle.textContent, '显示');
  toggle.handler.call(toggle, { type: 'click' });
  assert.equal(toggle['aria-pressed'], 'false');
  assert.equal(toggle.textContent, '隐藏');
});
