'use strict';

const { loadWebSource, runWebScripts } = require('./source-tools.cjs');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sourcePath = path.resolve(__dirname, '../../apps/web/app.js');
const source = loadWebSource();
const exportedNames = [
  'listPageNumbers', 'listPageRange',
  'short', 'shuffle', 'parseSlashRegexV51', 'buildFindRegExpV51',
  'renderReviewOptions', 'renderReviewAnswerSummary', 'renderPracticeWrongOverview: practicePage.renderPracticeWrongOverview',
  'renderTrainingQuestion: trainingReviewPage.renderTrainingQuestion',
  'repairCircledCombinationQuestion',
  'displayOptionTextV589',
  'normalizeQuestion', 'normalizeBackupPayloadV23', 'serializeBankForCrossExportV53',
  'buildQuestionBanksExportPayloadV598', 'buildBackupPayloadV23', 'buildNativeCompatibleBackupZipV611',
  'buildNativeInteropStateV24: (banks) => backupData.buildNativeInteropStateV24(state, banks)', 'readBackupFileV24', 'applyBackupAssetsV24',
  'countUnresolvedBackupImagesV24', 'parseZipEntries: globalThis.ShirohaZip.parseZipEntries',
  'unzipEntry: globalThis.ShirohaZip.unzipEntry', 'unzipEntryBytes: globalThis.ShirohaZip.unzipEntryBytes', 'zipStoreFiles', 'createOcrDocxBlob',
  'sameAnswerForQuestion', 'scoreOf', 'makeAnswerDetail', 'recordPracticeAnswer: practicePage.recordPracticeAnswer',
  'parsePracticeNumberRangeV58916', 'formatExactPracticeNumbersV58916',
  'normalizeBlankAnswersV58914', 'normalizeBlankTextV58914: globalThis.ShirohaQuizCore.normalizeBlankTextV58914', 'isMultiBlankQuestionV58914',
  'primaryBlankAnswerV58914', 'cloneBlankAnswersV58914',
  'needsPracticeSelfAssessment: practicePage.needsPracticeSelfAssessment',
  'mergeBackupBanksV23', 'download',
  'practiceItemKeyV8916', 'getPracticeAnswerStateV26', 'addWrong', 'markRight', 'getWrongEntries',
  'parseTextQuestions', 'parseAnswerEntries', 'mergeQuestionAnswers', 'sourceQuestionNumberFromLineV58910: textParser.sourceQuestionNumberFromLineV58910',
  'parseTextQuestionsBaseDetailed: textParser.parseTextQuestionsBaseDetailed', 'repairParsedQuestionsLocally: textParser.repairParsedQuestionsLocally',
  'repairMissingAndStuckQuestionsBySourceV58910: textParser.repairMissingAndStuckQuestionsBySourceV58910',
  'analyzeQuestionTextProfile: textParser.analyzeQuestionTextProfile', 'getSourceMetaV58910: textParser.getSourceMetaV58910',
  'attachSourceMetaV58910: textParser.attachSourceMetaV58910', 'getRecruitmentOptionsV58915: textParser.getRecruitmentOptionsV58915',
  'attachRecruitmentOptionsV58915: textParser.attachRecruitmentOptionsV58915',
  'readTableImportFileV49', 'extractDocxText', 'docxXmlToText', 'extractPdfText',
  'upgradeState', 'serializeState',
];

function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

function loadWeb({ state, local = {}, session = {}, scoreDefaults = {}, deterministicIds = false, parserSourceTransform } = {}) {
  const storageKey = source.stringConstant('KEY');
  const logs = [];
  const document = {
    getElementById(id) {
      if (id === 'shiroha-rich-question-style-v55') { return {}; }
      return null;
    },
    addEventListener() {},
    querySelector(selector) {
      if (selector.startsWith('#score-')) { return { value: String(scoreDefaults[selector.slice(7)] ?? 1) }; }
      throw new Error(`业务特征测试意外依赖 DOM：${selector}`);
    },
    querySelectorAll() { throw new Error('业务特征测试意外查询 DOM 集合。'); },
  };
  class TestFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.();
      }, () => this.onerror?.());
    }
  }
  let nextId = 0;
  const sandbox = {
    // 字符串渲染测试不挂载 DOM；公式排版由浏览器回归验证。
    requestAnimationFrame() { return 1; },
    structuredClone, Blob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Response, DecompressionStream,
    URL, atob, btoa, crypto: deterministicIds ? { randomUUID: () => `test-${++nextId}` } : webcrypto, FileReader: TestFileReader, document,
    localStorage: memoryStorage({ ...local, ...(state ? { [storageKey]: JSON.stringify(state) } : {}) }),
    sessionStorage: memoryStorage(session),
    console: { warn: (...args) => logs.push(args.map(String).join(' ')), log: (...args) => logs.push(args.map(String).join(' ')) },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  const context = vm.createContext(sandbox);
  runWebScripts(context, ['platform/validation.js', 'platform/browser.js']);
  context.ShirohaPlatform = { files: context.ShirohaBrowser.files, media: context.ShirohaBrowser.media };
  runWebScripts(context, ['training.js', 'quiz-core.js', 'text-answers.js']);
  if (parserSourceTransform) {
    const parserPath = path.join(path.dirname(sourcePath), 'text-parser.js');
    const parserSource = parserSourceTransform(readFileSync(parserPath, 'utf8'));
    vm.runInContext(parserSource, context, { filename: parserPath, timeout: 5000 });
  } else {
    runWebScripts(context, ['text-parser.js']);
  }
  runWebScripts(context, ['backup-core.js', 'zip.js', 'backup-archive.js', 'backup-data.js', 'webdav-panel.js', 'docx-import.js', 'pdf-import.js', 'ocr-import.js', 'table-import.js', 'import-preview.js', 'ai-results.js', 'ai-import-sessions.js', 'ai-question-sessions.js', 'ai-settings.js', 'ai-transport.js', 'ai-prompts.js', 'question-view.js', 'bank-page.js', 'saved-questions-page.js', 'training-review-page.js', 'bank-editor.js', 'study-sessions.js', 'exam-page.js', 'practice-selection.js', 'practice-page.js', 'ai-import-panel.js', 'ai-question-panels.js', 'question-editor.js']);
  // 在测试副本中取消页面启动；所有被测解析、评分、转换和 ZIP 代码仍来自真实业务源码。
  const bridge = `\nObject.assign(state, migrateState(${JSON.stringify(state || null)} || blankState(), KEY));\nglobalThis.__test = {${exportedNames.join(',')}, snapshot: () => JSON.parse(JSON.stringify(state)), practiceSnapshot: () => JSON.parse(JSON.stringify(practiceSession.current)), importState: () => ({ report: importDraft.report, warnings: importDraft.warnings, diagnostics: importDraft.diagnostics })};\n`;
  vm.runInContext(source.replaceStartup(bridge), context, { filename: sourcePath, timeout: 5000 });
  return { api: context.__test, logs, context };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

module.exports = { loadWeb, plain };
