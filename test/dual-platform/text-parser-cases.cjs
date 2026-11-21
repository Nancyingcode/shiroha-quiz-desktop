'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { loadWeb } = require('./web-source.cjs');
const { IMAGE } = require('./fixtures/dataset.cjs');

const fixture = (name) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const cases = [
  { name: '重复题号', text: fixture('dual-questions.txt') },
  { name: '共用材料', text: fixture('material.txt') },
  { name: '全角与粘连选项', text: '一、单选题\n１．哪一项正确？Ａ．甲Ｂ．乙Ｃ．丙\n答案：Ｂ\n２．下一题？\nA. 左 B. 右\n答案：A' },
  { name: '分卷及多空', text: '第一卷\n一、填空题\n1. 首都是____，简称____。\n答案：北京；京\n二、简答题\n2. 简述保存步骤。\n答案：先保存再退出。' },
  {
    name: 'Word 图片与答案',
    text: '一、单选题\n1. 根据图选择（ ）\n![题图](data:image/png;base64,aGVsbG8=)\nA. 甲\nB. 乙\n答案：B\n解析：根据图判断。',
  },
];
const repairText = [
  '一、单选题', '1. 甲问题？', 'A. 甲', 'B. 乙', '答案：A',
  '2. 乙问题？', 'A. 甲', 'B. 乙', 'C. 丙', '答案：C',
  '3. 丙问题？', 'A. 甲', 'B. 乙', '答案：B',
].join('\n');

const recruitmentImage = `![题图](${IMAGE})`;
const recruitmentQuestionParts = [
  {
    name: '共享材料限定在资料分析分区',
    text: [
      '第一部分 资料分析', '根据以下资料回答1至2题。', '甲地种植松树十棵，乙地种植柏树八棵。',
      '1. 甲地种植哪种树？', 'A. 松树', 'B. 柏树',
      '2. 乙地种植哪种树？', 'A. 松树', 'B. 柏树',
      '第二部分 数学运算', '3. 两地一共种植多少棵树？', 'A. 十八棵', 'B. 十棵',
    ].join('\n'),
    numbers: [1, 2, 3],
    answerMap: { 1: ['a'], 2: ['B'], 3: ['A'] },
    analysisMap: { 1: '根据甲地记录。', 3: '十加八等于十八。' },
  },
  {
    name: '纯图片题保留内嵌图和 Word 图片占位',
    text: [`1. ${recruitmentImage}`, '2. [[DOCX_IMAGE_1]]', '3. 缺少作答依据的文字。'].join('\n'),
    numbers: [1, 2, 3],
    group: '三、图形推理',
    restore: (text) => text.replace('[[DOCX_IMAGE_1]]', recruitmentImage),
  },
  {
    name: '答案区截断且预期题号可排除独立例题',
    text: [
      '8. 这是例题吗？', 'A. 是', 'B. 否',
      '10. 正文题的结果是什么？', 'A. 甲', 'B. 乙',
      '参考答案', 'C. 答案区内容', '10. 【解析】选 C。',
    ].join('\n'),
    numbers: [10, 11],
  },
];

function stable(value) {
  return JSON.parse(JSON.stringify(value));
}

function recruitmentQuestionPartSnapshot(entry, args) {
  const marker = '    return Object.freeze({';
  const { api, context } = loadWeb({
    deterministicIds: true,
    parserSourceTransform(source) {
      assert.equal(source.split(marker).length, 2);
      return source.replace(marker, [
        '    globalThis.__recruitmentQuestionParts = {',
        '      parseRecruitmentQuestionPart,',
        '      parseRecruitmentQuestionPartByExpectedNumbers,',
        '    };',
        marker,
      ].join('\n'));
    },
  });
  const questions = context.__recruitmentQuestionParts[entry](...args);
  return stable(questions.map((question) => ({
    ...question,
    recruitmentOptions: api.getRecruitmentOptionsV58915(question),
  })));
}

function recruitmentQuestionPartSnapshots() {
  return recruitmentQuestionParts.map((part) => {
    const { name, text, numbers } = part;
    const args = [part.answerMap, part.analysisMap, part.group, part.restore];
    return {
      name,
      automatic: recruitmentQuestionPartSnapshot('parseRecruitmentQuestionPart', [text, ...args]),
      byExpectedNumbers: recruitmentQuestionPartSnapshot('parseRecruitmentQuestionPartByExpectedNumbers', [
        text, numbers, ...args,
      ]),
    };
  });
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

module.exports = {
  cases,
  parseSnapshots,
  recruitmentQuestionPartSnapshots,
  repairSnapshot,
  stable,
};
