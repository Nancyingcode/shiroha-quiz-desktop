'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { setImmediate } = require('node:timers');
const { readFileSync } = require('node:fs');
const source = readFileSync(require.resolve('../../apps/web/app.js'), 'utf8');

for (const fail of [false, true]) {
  test(`PDF extraction releases document after ${fail ? 'failure' : 'success'}`, async () => {
    let destroyed = 0;
    const pdf = { numPages: 1, getPage: async () => ({ getTextContent: async () => {
      if (fail) throw new Error('damaged page');
      return { items: [] };
    } }), destroy: async () => { destroyed++; } };
    const context = vm.createContext({ Uint8Array,
      ShirohaPlatform: { files: { readBuffer: async () => new ArrayBuffer(0) } },
      loadLocalPdfJs: async () => ({ lib: { getDocument: () => ({ promise: Promise.resolve(pdf), destroy: pdf.destroy }) } }),
      pdfDocumentOptions: x => x, pdfItemsToLines: () => 'A self authored question with enough text for extraction',
      toast() {}, warnDev() {}, extractPdfTextLite: async () => 'Fallback self authored question with enough text',
    });
    vm.runInContext(source.slice(source.indexOf('async function extractPdfText(file)'), source.indexOf('async function loadLocalPdfJs')), context);
    await context.extractPdfText({});
    assert.equal(destroyed, 1);
  });
}

test('failed OCR releases canvas, worker and PDF without losing the failure status', async () => {
  const canvas = { width: 1000, height: 1000 };
  let destroyed = 0; let terminated = 0;
  const status = [];
  const context = vm.createContext({ Uint8Array,
    ocrImportState: { file: {}, running: false }, $: () => null,
    setOcrStatus: text => status.push(text), setOcrButtonsEnabled() {}, toast() {}, warnDev() {},
    ShirohaPlatform: { files: { readBuffer: async () => new ArrayBuffer(0) } },
    loadLocalPdfJs: async () => ({ lib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }), destroy: async () => { destroyed++; } }) } }),
    pdfDocumentOptions: x => x,
    createOcrWorker: async () => ({ worker: { recognize: async () => { throw new Error('broken recognition'); }, terminate: async () => { terminated++; } } }),
    renderPdfPageToCanvas: async () => canvas,
  });
  vm.runInContext(source.slice(source.indexOf('async function startPdfOcrImport()'), source.indexOf('async function renderPdfPageToCanvas')), context);
  await context.startPdfOcrImport();
  assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
  assert.equal(destroyed, 1); assert.equal(terminated, 1);
  assert.match(status.at(-1), /broken recognition/);
});

test('cancelling pending recognition releases resources and permits retry without late results', async () => {
  let finishOldRecognition; let recognitionStarted;
  const pending = new Promise(resolve => { finishOldRecognition = resolve; });
  const started = new Promise(resolve => { recognitionStarted = resolve; });
  const canvases = [];
  const buttons = [];
  let destroyed = 0; let terminated = 0; let workers = 0;
  const context = vm.createContext({ Uint8Array,
    ocrImportState: { file: {}, running: false }, $: () => null,
    setOcrStatus() {}, setOcrButtonsEnabled: enabled => buttons.push(enabled), toast() {}, warnDev() {},
    ShirohaPlatform: { files: { readBuffer: async () => new ArrayBuffer(0) } },
    loadLocalPdfJs: async () => ({ lib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }), destroy: async () => { destroyed++; } }) } }),
    pdfDocumentOptions: x => x, formatOcrPages: pages => pages.map(page => page.text).join('\n'),
    createOcrWorker: async () => {
      const first = ++workers === 1;
      return { worker: {
        recognize: () => { recognitionStarted(); return first ? pending : Promise.resolve({ data: { text: 'new result' } }); },
        // Tesseract 5.1.1 终止 Worker 时不会结束仍在等待的识别 Promise。
        terminate: async () => { terminated++; },
      } };
    },
    renderPdfPageToCanvas: async () => { const canvas = { width: 1000, height: 1000 }; canvases.push(canvas); return canvas; },
  });
  vm.runInContext(source.slice(source.indexOf('async function startPdfOcrImport()'), source.indexOf('async function renderPdfPageToCanvas')), context);
  let completed = false;
  const running = context.startPdfOcrImport().then(() => { completed = true; });
  await started;
  context.ocrImportState.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, true, 'cancellation must not await the terminated Worker');
  await running;
  assert.equal(context.ocrImportState.running, false);
  assert.equal(context.ocrImportState.cancel, null);
  assert.deepEqual(canvases[0], { width: 1, height: 1 });
  assert.equal(destroyed, 1); assert.equal(terminated, 1);
  assert.equal(buttons.at(-1), false);
  await context.startPdfOcrImport();
  finishOldRecognition({ data: { text: 'late old result' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.ocrImportState.text, 'new result');
  assert.equal(context.ocrImportState.running, false);
  assert.equal(destroyed, 2); assert.equal(terminated, 2);
  assert.equal(buttons.at(-1), true);
});

test('switching import source cannot receive a late OCR result', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const context = vm.createContext({ Uint8Array,
    ocrImportState: { file: {}, running: false }, $: () => null,
    setOcrStatus() {}, setOcrButtonsEnabled() {}, toast() {}, warnDev() {},
    ShirohaPlatform: { files: { readBuffer: async () => new ArrayBuffer(0) } },
    loadLocalPdfJs: async () => ({ lib: { getDocument: () => ({ promise: Promise.resolve({ numPages: 1 }), destroy: async () => {} }) } }),
    pdfDocumentOptions: x => x, formatOcrPages: () => 'old result',
    createOcrWorker: async () => ({ worker: { recognize: () => pending, terminate: async () => {} } }),
    renderPdfPageToCanvas: async () => ({ width: 100, height: 100 }),
  });
  vm.runInContext(source.slice(source.indexOf('async function startPdfOcrImport()'), source.indexOf('async function renderPdfPageToCanvas')), context);
  const running = context.startPdfOcrImport();
  await new Promise(resolve => setImmediate(resolve));
  context.ocrImportState = { file: { name: 'new.pdf' }, text: '', pages: [], running: false };
  finish({ data: { text: 'old result' } });
  await running;
  assert.equal(context.ocrImportState.text, '');
});

test('oversized PDF pages are rejected before allocating a canvas', async () => {
  let allocated = false;
  const context = vm.createContext({ document: { createElement() { allocated = true; throw new Error('allocated'); } } });
  vm.runInContext(source.slice(source.indexOf('async function renderPdfPageToCanvas'), source.indexOf('function formatOcrPages')), context);
  await assert.rejects(context.renderPdfPageToCanvas({ getPage: async () => ({ getViewport: () => ({ width: 100000, height: 100000 }), cleanup() {} }) }, 1), /像素/);
  assert.equal(allocated, false);
});
