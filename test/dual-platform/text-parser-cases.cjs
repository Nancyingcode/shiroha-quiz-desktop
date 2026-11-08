'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { loadWeb } = require('./web-source.cjs');

const fixture = (name) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const cases = [
  { name: '重复题号', text: fixture('dual-questions.txt') },
  { name: '共用材料', text: fixture('material.txt') },
  { name: '全角与粘连选项', text: '一、单选题\n１．哪一项正确？Ａ．甲Ｂ．乙Ｃ．丙\n答案：Ｂ\n２．下一题？\nA. 左 B. 右\n答案：A' },
  { name: '分卷及多空', text: '第一卷\n一、填空题\n1. 首都是____，简称____。\n答案：北京；京\n二、简答题\n2. 简述保存步骤。\n答案：先保存再退出。' },
  { name: 'Word 图片与答案', text: '一、单选题\n1. 根据图选择（ ）\n![题图](data:image/png;base64,aGVsbG8=)\nA. 甲\nB. 乙\n答案：B\n解析：根据图判断。' },
];
const repairText = [
  '一、单选题', '1. 甲问题？', 'A. 甲', 'B. 乙', '答案：A',
  '2. 乙问题？', 'A. 甲', 'B. 乙', 'C. 丙', '答案：C',
  '3. 丙问题？', 'A. 甲', 'B. 乙', '答案：B',
].join('\n');

function stable(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseSnapshots() {
  const { api } = loadWeb({ deterministicIds: true });
  return cases.flatMap(({ name, text }) => ['auto', 'standard', 'volume', 'compact'].map((strategy) => {
    const questions = api.parseTextQuestions(text, strategy);
    const metadata = questions.map((question) => ({
      source: api.getSourceMetaV58910(question),
      recruitmentOptions: api.getRecruitmentOptionsV58915(question),
    }));
    return stable({ name, strategy, questions, metadata, ...api.importState() });
  }));
}

function repairSnapshot() {
  const { api } = loadWeb({ deterministicIds: true });
  const detailed = api.parseTextQuestionsBaseDetailed(repairText);
  const original = detailed.questions.map((question, index) => (
    index === 1 ? { ...question, options: [] } : question
  ));
  const profile = api.analyzeQuestionTextProfile(repairText);
  return stable(api.repairParsedQuestionsLocally(repairText, original, profile));
}

module.exports = { cases, parseSnapshots, repairSnapshot, stable };
