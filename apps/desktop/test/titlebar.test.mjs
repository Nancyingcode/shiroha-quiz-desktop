import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../frontend/titlebar.js', import.meta.url), 'utf8');

/** @typedef {{button?: number, detail?: number, preventDefault?: () => void}} EventInput */
class Element {
  hidden = true;
  disabled = true;
  textContent = '';
  title = '';
  right = 0;
  /** @type {Element | null} */
  label = null;
  /** @type {Record<string, string>} */
  dataset = {};
  /** @type {Map<string, string>} */
  attributes = new Map();
  /** @type {Map<string, (event: EventInput) => void>} */
  listeners = new Map();
  /** @param {string} name @param {(event: EventInput) => void} listener */
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  /** @param {string} name @param {string} value */
  setAttribute(name, value) { this.attributes.set(name, value); }
  /** @param {string} name @param {EventInput} [event] */
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
  /** @param {string} selector */
  querySelector(selector) { return selector === 'span' ? this.label : null; }
  getBoundingClientRect() { return { right: this.right }; }
}

function fixture() {
  const elements = new Map(['titlebar', 'window-drag', 'window-status', 'window-minimize', 'window-maximize', 'window-close'].map(name => [`desktop-${name}`, new Element()]));
  /** @param {string} name */
  const get = name => { const result = elements.get(`desktop-${name}`); assert(result); return result; };
  /** @type {string[]} */
  const calls = [];
  const label = new Element(); label.right = 112;
  get('window-drag').label = label;
  /** @type {Map<string, string>} */
  const properties = new Map();
  /** @type {Element[]} */
  const observed = [];
  let resize = () => {};
  class ResizeObserver {
    /** @param {() => void} callback */
    constructor(callback) { resize = callback; }
    /** @param {Element} element */
    observe(element) { observed.push(element); }
  }
  let maximized = false;
  const api = {
    minimize: async () => { calls.push('minimize'); },
    toggleMaximize: async () => { calls.push('toggle'); maximized = !maximized; },
    isMaximized: async () => maximized,
    close: async () => { calls.push('close'); },
    startDragging: async () => { calls.push('drag'); },
  };
  const host = { ShirohaDesktopHost: { window: api }, ResizeObserver, addEventListener() {}, setTimeout, clearTimeout };
  const document = {
    getElementById: (/** @type {string} */ id) => elements.get(id),
    body: { style: { setProperty: (/** @type {string} */ name, /** @type {string} */ value) => { properties.set(name, value); } } },
  };
  const start = () => vm.runInNewContext(source, { window: host, document, ResizeObserver });
  return { get, calls, api, start, host, label, properties, observed, resize: () => resize() };
}

test('navigation toggle follows the title text when its measured width changes', () => {
  const f = fixture(); f.start();
  assert.equal(f.properties.get('--desktop-navigation-toggle-left'), '120px');
  assert.deepEqual(f.observed, [f.label]);
  f.label.right = 147.5;
  f.resize();
  assert.equal(f.properties.get('--desktop-navigation-toggle-left'), '155.5px');
});

test('window actions use only the current window and synchronize maximize/restore labels', async () => {
  const f = fixture(); f.start(); await setImmediate();
  f.get('window-maximize').emit('click'); await setImmediate();
  assert.equal(f.get('window-maximize').title, '还原');
  assert.equal(f.get('titlebar').dataset.maximized, 'true');
  f.get('window-maximize').emit('click'); await setImmediate();
  assert.equal(f.get('window-maximize').title, '最大化');
  f.get('window-minimize').emit('click'); await setImmediate();
  f.get('window-close').emit('click'); await setImmediate();
  assert.deepEqual(f.calls, ['toggle', 'toggle', 'minimize', 'close']);
});

test('title dragging ignores non-left buttons and handles double click without dragging again', async () => {
  const f = fixture(); f.start();
  const drag = f.get('window-drag');
  drag.emit('mousedown', { button: 2, detail: 1 });
  drag.emit('mousedown', { button: 0, detail: 1, preventDefault() {} });
  drag.emit('mousedown', { button: 0, detail: 2, preventDefault() {} });
  await setImmediate();
  assert.deepEqual(f.calls, ['drag', 'toggle']);
});

test('pending actions do not double-submit and failures restore controls with a readable message', async () => {
  const f = fixture();
  /** @type {(reason: Error) => void} */
  let reject = () => {};
  f.api.minimize = () => new Promise((_, rejectAction) => { reject = rejectAction; f.calls.push('minimize'); });
  f.start(); await setImmediate();
  f.get('window-minimize').emit('click');
  f.get('window-minimize').emit('click');
  assert.equal(f.get('window-minimize').disabled, true);
  reject(new Error('native failure')); await setImmediate();
  assert.deepEqual(f.calls, ['minimize']);
  assert.equal(f.get('window-minimize').disabled, false);
  assert.equal(f.get('window-status').hidden, false);
  assert.match(f.get('window-status').textContent, /请重试/);
  assert.doesNotMatch(f.get('window-status').textContent, /native failure/);
});
