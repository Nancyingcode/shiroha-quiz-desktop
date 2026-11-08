'use strict';
const { runWebScripts } = require('./source-tools.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { setImmediate } = require('node:timers');

for (const fail of [false, true]) {
  test(`PDF extraction releases document after ${fail ? 'failure' : 'success'}`, async () => {
    let destroyed = 0;
    const pdf = { numPages: 1, getPage: async () => ({ getTextContent: async () => {
      if (fail) { throw new Error('damaged page'); }
      return { items: [{ str: 'A self authored question with enough text for extraction', transform: [0, 0, 0, 0, 0, 0] }] };
    } }), destroy: async () => { destroyed++; } };
    const context = vm.createContext({ Uint8Array, TextDecoder });
    context.window = context;
    context.__pdfjsMixed = { lib: { getDocument: () => ({ promise: Promise.resolve(pdf), destroy: pdf.destroy }) } };
    runWebScripts(context, ['pdf-import.js']);
    const reader = context.ShirohaPdf.create({
      readBuffer: async () => new TextEncoder().encode('(Fallback self authored question with enough text) Tj').buffer,
      toast() {}, warnDev() {},
    });
    const text = await reader.extractPdfText({});
    assert.match(text, fail ? /Fallback/ : /第1页/);
    assert.equal(destroyed, 1);
  });
}

function ocrFixture({ recognize, viewport = { width: 1000, height: 1000 } }) {
  const stats = { destroyed: 0, terminated: 0, cleaned: 0, canvases: [] };
  const elements = Object.fromEntries([
    'ocr-panel', 'ocr-result', 'ocr-status', 'ocr-cancel-btn', 'ocr-start-btn',
    'ocr-use-text-btn', 'ocr-copy-btn', 'ocr-download-docx-btn', 'ocr-language', 'ocr-page-limit',
  ].map((id) => [id, { value: '', classList: { add() {}, remove() {} } }]));
  const document = {
    querySelector: (selector) => elements[selector.slice(1)] || null,
    createElement(tag) {
      if (tag === 'script') { return {}; }
      if (tag === 'canvas') {
        const canvas = { width: 0, height: 0, getContext: () => ({}) };
        stats.canvases.push(canvas);
        return canvas;
      }
      throw new Error(`unexpected element: ${tag}`);
    },
    head: { appendChild: (script) => Promise.resolve().then(() => script.onload()) },
  };
  const page = {
    getViewport: () => viewport,
    render: () => ({ promise: Promise.resolve() }),
    cleanup: () => { stats.cleaned++; },
  };
  const pdf = { loadLocalPdfJs: async () => ({ lib: { getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
    destroy: async () => { stats.destroyed++; },
  }) } }), pdfDocumentOptions: (data) => ({ data }) };
  const context = vm.createContext({ document, Uint8Array });
  context.window = context;
  context.Tesseract = { createWorker: async () => ({
    recognize,
    terminate: async () => { stats.terminated++; },
  }) };
  runWebScripts(context, ['ocr-import.js']);
  const session = context.ShirohaOcrImport.create({
    pdf, readBuffer: async () => new ArrayBuffer(0), toast() {}, warnDev() {},
  });
  session.setOcrImportSource({ name: '自建.pdf' });
  return { session, elements, stats };
}

test('failed OCR releases canvas, worker and PDF without losing the failure status', async () => {
  const { session, elements, stats } = ocrFixture({ recognize: async () => { throw new Error('broken recognition'); } });
  await session.startPdfOcrImport();
  assert.deepEqual([stats.canvases[0].width, stats.canvases[0].height], [1, 1]);
  assert.equal(stats.destroyed, 1); assert.equal(stats.terminated, 1); assert.equal(stats.cleaned, 1);
  assert.match(elements['ocr-status'].textContent, /broken recognition/);
  assert.equal(session.isRunning(), false);
});

test('cancelling pending recognition releases resources and permits retry without late results', async () => {
  let finishOldRecognition; let recognitionStarted;
  const pending = new Promise((resolve) => { finishOldRecognition = resolve; });
  const started = new Promise((resolve) => { recognitionStarted = resolve; });
  let calls = 0;
  const { session, elements, stats } = ocrFixture({ recognize: () => {
    recognitionStarted();
    return ++calls === 1 ? pending : Promise.resolve({ data: { text: 'new result' } });
  } });
  let completed = false;
  const running = session.startPdfOcrImport().then(() => { completed = true; });
  await started;
  elements['ocr-cancel-btn'].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, true, 'cancellation must not await the terminated Worker');
  await running;
  assert.equal(session.isRunning(), false);
  assert.deepEqual([stats.canvases[0].width, stats.canvases[0].height], [1, 1]);
  assert.equal(stats.destroyed, 1); assert.equal(stats.terminated, 1);
  assert.equal(elements['ocr-use-text-btn'].disabled, true);
  await session.startPdfOcrImport();
  finishOldRecognition({ data: { text: 'late old result' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(session.currentOcrText(), /new result/);
  assert.doesNotMatch(session.currentOcrText(), /late old result/);
  assert.equal(session.isRunning(), false);
  assert.equal(stats.destroyed, 2); assert.equal(stats.terminated, 2);
  assert.equal(elements['ocr-use-text-btn'].disabled, false);
});

test('switching import source cannot receive a late OCR result', async () => {
  let finish; let recognitionStarted;
  const pending = new Promise((resolve) => { finish = resolve; });
  const started = new Promise((resolve) => { recognitionStarted = resolve; });
  const { session, stats } = ocrFixture({ recognize: () => { recognitionStarted(); return pending; } });
  const running = session.startPdfOcrImport();
  await started;
  session.setOcrImportSource({ name: 'new.pdf' });
  finish({ data: { text: 'old result' } });
  await running;
  assert.equal(session.currentOcrText(), '');
  assert.equal(session.getFile().name, 'new.pdf');
  assert.equal(stats.destroyed, 1); assert.equal(stats.terminated, 1);
});

test('oversized PDF pages are rejected before allocating a canvas', async () => {
  const { session, elements, stats } = ocrFixture({
    recognize: async () => ({}), viewport: { width: 100000, height: 100000 },
  });
  await session.startPdfOcrImport();
  assert.match(elements['ocr-status'].textContent, /像素/);
  assert.equal(stats.canvases.length, 0);
  assert.equal(stats.cleaned, 1); assert.equal(stats.destroyed, 1); assert.equal(stats.terminated, 1);
});
