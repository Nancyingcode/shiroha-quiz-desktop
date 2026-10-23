import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** @param {Buffer[]} objects */
function pdfFile(objects) {
  /** @type {Buffer[]} */
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'));
  }
  const xref = Buffer.concat(parts).length;
  parts.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** @param {import('playwright-core').Page} page */
export async function documentSmoke(page) {
  const require = createRequire(import.meta.url);
  /** @type {{loadWeb: () => {api: {zipStoreFiles(files: Array<{name: string, text: string}>): Blob}}}} */
  const { loadWeb } = require(fileURLToPath(new URL('../../../test/dual-platform/web-source.cjs', import.meta.url)));
  const api = loadWeb().api;
  const lines = ['1. 中国的首都是哪里？', 'A. 北京', 'B. 上海', '答案：A'];
  const jpeg = await page.evaluate(lines => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 600);
    ctx.fillStyle = 'black'; ctx.font = '56px SimSun';
    lines.forEach((line, index) => ctx.fillText(line, 60, 100 + index * 110));
    const data = canvas.toDataURL('image/jpeg', 0.95).split(',')[1]; canvas.width = 1; canvas.height = 1;
    return data;
  }, lines);
  const image = Buffer.from(jpeg, 'base64');
  const drawing = 'q 600 0 0 300 0 0 cm /Im Do Q';
  const scan = pdfFile([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')]),
    Buffer.from(`<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`),
  ]);
  const content = 'BT /F1 18 Tf 30 200 Td (1. What is the capital of China?) Tj 0 -30 Td (A. Beijing) Tj 0 -30 Td (B. Shanghai) Tj 0 -30 Td (Answer: A) Tj ET';
  const text = pdfFile([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`),
  ]);
  const docx = Buffer.from(await api.zipStoreFiles([
    { name: '[Content_Types].xml', text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', text: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` },
  ]).arrayBuffer());
  const rows = [['题干', 'A', 'B', '答案', '题型'], ['中国的首都是哪里？', '北京', '上海', 'A', '单选']];
  const xlsx = Buffer.from(await api.zipStoreFiles([
    { name: '[Content_Types].xml', text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="自建样本" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((cell, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>` },
  ]).arrayBuffer());
  const names = [];
  let recognized = '';
  for (const [extension, buffer] of /** @type {Array<[string, Buffer]>} */ ([['docx', docx], ['xlsx', xlsx], ['text.pdf', text], ['pdf', scan]])) {
    await page.locator('.nav[data-view="import"]').click();
    await page.locator('#clear-import-btn').click();
    await page.locator('#import-mode').selectOption('normal');
    await page.locator('#import-save-mode-v59').selectOption('new');
    await page.locator('#import-file').setInputFiles({ name: `阶段E.${extension}`, mimeType: 'application/octet-stream', buffer });
    if (extension === 'pdf') {
      await page.locator('#ocr-status').filter({ hasText: '文字层提取失败' }).waitFor({ timeout: 120000 });
      await page.locator('#ocr-language').selectOption('chi_sim+eng');
      await page.evaluate(() => {
        document.getElementById('ocr-start-btn')?.click();
        document.getElementById('ocr-cancel-btn')?.click();
      });
      await page.waitForFunction(() => !(/** @type {HTMLButtonElement | null} */ (document.getElementById('ocr-start-btn')))?.disabled);
      assert.match(await page.locator('#ocr-status').innerText(), /已取消/);
      await page.locator('#ocr-start-btn').click();
      await page.locator('#ocr-status').filter({ hasText: /OCR 完成|OCR 失败/ }).waitFor({ timeout: 120000 });
      assert.match(await page.locator('#ocr-status').innerText(), /OCR 完成/);
      recognized = await page.locator('#ocr-result').inputValue();
      assert.match(recognized.replace(/\s/g, ''), /北京/);
      // OCR 保留人工核对语义；记录原始输出后模拟核对题号、选项分隔和字间空格。
      await page.locator('#ocr-result').fill(lines.join('\n'));
      await page.locator('#ocr-use-text-btn').click();
    } else {
      await page.waitForFunction(expected => (/** @type {HTMLTextAreaElement | null} */ (document.querySelector('#import-text')))?.value.includes(expected), extension === 'text.pdf' ? 'Beijing' : '中国');
    }
    if (extension !== 'xlsx') await page.locator('#parse-import-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('#import-preview tbody tr').length > 0);
    const name = `阶段E-${extension}`;
    await page.locator('#import-bank-name').fill(name);
    await page.locator('#confirm-import-btn').click();
    await page.locator('#active-bank-select option').filter({ hasText: name }).waitFor({ state: 'attached' });
    names.push(name);
  }
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  for (const name of names) assert.equal(await page.locator('#active-bank-select option').filter({ hasText: name }).count(), 1);
  const restored = await page.evaluate(async () => {
    const platform = /** @type {{storage: import('../../web/platform/runtime.d.ts').BrowserStorage}} */ (Reflect.get(window, 'ShirohaPlatform'));
    const snapshot = await platform.storage.read();
    if (!snapshot) throw new Error('保存后没有快照');
    await platform.storage.ensureAll?.(snapshot);
    return snapshot.banks;
  });
  for (const name of names) {
    const bank = restored.find(bank => bank.name === name);
    assert.equal(bank?.questions.length, 1, `${name} 持久化题数`);
    assert.deepEqual(bank?.questions[0].answer, ['A'], `${name} 持久化答案`);
  }
  return { importedAndReloaded: names, chineseScan: true, recognized, manualReviewSimulated: true, realDocumentPipeline: true };
}
