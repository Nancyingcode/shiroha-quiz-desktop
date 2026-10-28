'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sourcePath = path.resolve(__dirname, '../../apps/web/app.js');
const source = readFileSync(sourcePath, 'utf8');
const exportedNames = [
  'listPageNumbers', 'listPageRange',
  'renderReviewOptions', 'renderReviewAnswerSummary', 'renderPracticeWrongOverview',
  'repairCircledCombinationQuestion',
  'displayOptionTextV589',
  'normalizeQuestion', 'normalizeBackupPayloadV23', 'serializeBankForCrossExportV53',
  'buildQuestionBanksExportPayloadV598', 'buildBackupPayloadV23', 'buildNativeCompatibleBackupZipV611',
  'buildNativeInteropStateV24', 'readBackupFileV24', 'applyBackupAssetsV24',
  'countUnresolvedBackupImagesV24', 'parseZipEntries', 'unzipEntry', 'unzipEntryBytes', 'zipStoreFiles',
  'sameAnswerForQuestion', 'scoreOf', 'makeAnswerDetail', 'recordPracticeAnswer',
  'practiceItemKeyV8916', 'getPracticeAnswerStateV26', 'addWrong', 'markRight', 'getWrongEntries',
  'parseTextQuestions', 'parseAnswerEntries', 'mergeQuestionAnswers', 'upgradeState', 'serializeState',
];

function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
}

function loadWeb({ state, local = {}, session = {}, scoreDefaults = {} } = {}) {
  const storageKey = source.match(/^const KEY='([^']+)';/m)?.[1];
  assert(storageKey, '主状态键变化，请更新测试加载器。');
  const logs = [];
  const document = {
    getElementById(id) {
      if (id === 'shiroha-rich-question-style-v55') return {};
      return null;
    },
    addEventListener() {},
    querySelector(selector) {
      if (selector.startsWith('#score-')) return { value: String(scoreDefaults[selector.slice(7)] ?? 1) };
      throw new Error(`业务特征测试意外依赖 DOM：${selector}`);
    },
    querySelectorAll() { throw new Error('业务特征测试意外查询 DOM 集合。'); },
  };
  class TestFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.();
      }, () => this.onerror?.());
    }
  }
  const sandbox = {
    // 字符串渲染测试不挂载 DOM；公式排版由浏览器回归验证。
    requestAnimationFrame() { return 1; },
    structuredClone, Blob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Response, DecompressionStream,
    URL, atob, btoa, crypto: webcrypto, FileReader: TestFileReader, document,
    localStorage: memoryStorage({ ...local, ...(state ? { [storageKey]: JSON.stringify(state) } : {}) }),
    sessionStorage: memoryStorage(session),
    console: { warn: (...args) => logs.push(args.map(String).join(' ')), log: (...args) => logs.push(args.map(String).join(' ')) },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  const context = vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.resolve(__dirname, '../../apps/web/platform/validation.js'), 'utf8'), context);
  vm.runInContext(readFileSync(path.resolve(__dirname, '../../apps/web/platform/browser.js'), 'utf8'), context);
  context.ShirohaPlatform = { files: context.ShirohaBrowser.files, media: context.ShirohaBrowser.media };
  const startup = /\nstartApplication\(\);\s*\n\}\)\(\);/;
  assert.equal((source.match(new RegExp(startup.source, 'g')) || []).length, 1, '启动边界变化，请更新测试加载器。');
  // 在测试副本中取消页面启动；所有被测解析、评分、转换和 ZIP 代码仍来自真实业务源码。
  const bridge = `\nObject.assign(state, migrateState(${JSON.stringify(state || null)} || blankState(), KEY));\nglobalThis.__test = {${exportedNames.join(',')}, snapshot: () => JSON.parse(JSON.stringify(state)), practiceSnapshot: () => JSON.parse(JSON.stringify(practice))};\n})();`;
  vm.runInContext(source.replace(startup, bridge), context, { filename: sourcePath, timeout: 5000 });
  return { api: context.__test, logs };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

module.exports = { loadWeb, plain };
