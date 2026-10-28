'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadWeb, plain } = require('./web-source.cjs');

test('分页页码覆盖首尾、中间与紧凑布局，不使用省略号隐藏单个页码', () => {
  const { api } = loadWeb();
  assert.deepEqual(plain(api.listPageNumbers(1, 1)), [1]);
  assert.deepEqual(plain(api.listPageNumbers(3, 7)), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(plain(api.listPageNumbers(3, 50)), [1, 2, 3, 4, 5, 'ellipsis', 50]);
  assert.deepEqual(plain(api.listPageNumbers(25, 50)), [1, 'ellipsis', 23, 24, 25, 26, 27, 'ellipsis', 50]);
  assert.deepEqual(plain(api.listPageNumbers(50, 50)), [1, 'ellipsis', 46, 47, 48, 49, 50]);
  assert.deepEqual(plain(api.listPageNumbers(25, 50, true)), [1, 'ellipsis', 24, 25, 26, 'ellipsis', 50]);
  assert.deepEqual(plain(api.listPageNumbers(3, 50, true)), [1, 2, 3, 4, 'ellipsis', 50]);
});

test('分页范围涵盖四档条数、空列表和删除后末页回退', () => {
  const { api } = loadWeb();
  for (const size of [10, 20, 50, 100]) {
    const range = api.listPageRange(103, 99, size);
    assert.equal(range.page, Math.ceil(103 / size) - 1);
    assert.equal(range.end, 103);
    assert.equal(range.start, range.page * size);
  }
  assert.deepEqual(plain(api.listPageRange(0, 4, 10)), { page: 0, pages: 1, start: 0, end: 0 });
  assert.deepEqual(plain(api.listPageRange(20, 2, 10)), { page: 1, pages: 2, start: 10, end: 20 });
});
