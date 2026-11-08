'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb } = require('./web-source.cjs');

test('DOCX 正文按顺序保留图片、公式、表格与外部块占位', async () => {
  const { api } = loadWeb();
  const xml = '<w:document><w:body>'
    + '<w:p><w:r><w:t>题目 &amp; 图片</w:t><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p>'
    + '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:altChunk r:id="chunk1"/></w:body></w:document>';
  const rels = '<Relationships><Relationship Id="image1" Type="http://x/relationships/image" Target="media/picture.png"/></Relationships>';
  const blob = api.zipStoreFiles([
    { name: 'word/document.xml', text: xml },
    { name: 'word/_rels/document.xml.rels', text: rels },
    { name: 'word/media/picture.png', data: new Uint8Array([0, 1, 2, 255]) },
  ]);
  const output = await api.extractDocxText({ arrayBuffer: () => blob.arrayBuffer() });
  assert.match(output, /题目 & 图片\n!\[DOCX图片1\]\(data:image\/png;base64,AAEC\/w==\)/);
  assert.match(output, /【DOCX公式OMML：\(1\)\/\(2\)】/);
  assert.match(output, /【DOCX表格开始】\n\| 甲 \| 乙 \|/);
  const withChunk = api.docxXmlToText(xml, { image1: '图片' }, { chunk1: '外部正文' });
  assert(withChunk.indexOf('图片') < withChunk.indexOf('【DOCX公式OMML'));
  assert(withChunk.indexOf('【DOCX表格开始】') < withChunk.indexOf('外部正文'));
});

test('缺失正文或无法读取唯一外部正文时保留原错误', async () => {
  const { api } = loadWeb();
  const missing = api.zipStoreFiles([{ name: 'other', text: '' }]);
  await assert.rejects(api.extractDocxText({ arrayBuffer: () => missing.arrayBuffer() }), /未找到 word\/document.xml/);
  const chunk = api.zipStoreFiles([{ name: 'word/document.xml', text: '<w:body><w:altChunk r:id="missing"/></w:body>' }]);
  await assert.rejects(api.extractDocxText({ arrayBuffer: () => chunk.arrayBuffer() }), /外部内容块/);
});

test('PDF 文本按页面和坐标排序；文字层失败回退并释放文档', async () => {
  const { api, context } = loadWeb();
  let destroyed = 0;
  context.document.querySelector = () => ({ appendChild() {} });
  context.document.createElement = () => ({ querySelector: () => ({}) });
  context.setTimeout = () => 1;
  context.__pdfjsMixed = {
    mode: '测试 PDF.js',
    lib: { getDocument: () => ({
      promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [
        { str: 'second line', transform: [0, 0, 0, 0, 0, 10] },
        { str: 'question', transform: [0, 0, 0, 0, 20, 20] },
        { str: 'self authored', transform: [0, 0, 0, 0, 0, 20] },
      ] }) }) }),
      destroy: async () => { destroyed += 1; },
    }) },
  };
  const file = { arrayBuffer: async () => new TextEncoder().encode('(Fallback self authored question text) Tj').buffer };
  assert.equal(await api.extractPdfText(file), '【第1页】\nself authored question\nsecond line');
  assert.equal(destroyed, 1);
  context.__pdfjsMixed.lib.getDocument = () => ({
    promise: Promise.reject(new Error('damaged PDF')),
    destroy: async () => { destroyed += 1; },
  });
  assert.equal(await api.extractPdfText(file), 'Fallback self authored question text');
  assert.equal(destroyed, 2);
});
