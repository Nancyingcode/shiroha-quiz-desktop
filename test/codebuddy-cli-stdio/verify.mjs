import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

assert.ok(process.argv[2], 'Usage: node verify.mjs <run-directory>');
const summary = JSON.parse(await readFile(path.join(process.argv[2], 'summary.json'), 'utf8'));
const cases = new Map(summary.observations.map(item => [item.scenario, item]));
const requestCounts = {
  stop: 1, length: 4, content_filter: 1, eof: 1, done_only: 1, malformed: 3,
  tool: 2, cancel: 1, timeout: 1, password: 1, interrupt: 1,
};
assert.equal(cases.size, Object.keys(requestCounts).length);
for (const [name, expectedCount] of Object.entries(requestCounts)) {
  const item = cases.get(name);
  assert.ok(item, `Missing case: ${name}`);
  assert.equal(item.requestCount, expectedCount, name);
  assert.equal(item.unexpectedRoutes, 0, name);
  assert.deepEqual(item.serverErrors, [], name);
  assert.deepEqual(item.markerFiles, [], name);
  assert.equal(item.toolsAdvertised, false, name);
  assert.equal(item.parentRulesSent, false, name);
  assert.equal(item.toolFileExists, false, name);
  assert.equal(item.connectionClosedBeforeCleanup, true, name);
  assert.ok(item.ports.length > 0, name);
  assert.ok(item.ports.every(port => port.LocalAddress === '127.0.0.1'), name);
  const proxy = item.localRoutes.find(route => route.route === '/internal/hooks/services/invoke');
  assert.equal(proxy.status, 200, name);
  assert.equal(proxy.errorCode, 'MISSING_SERVICE_ID', name);
  if (name === 'cancel' || name === 'timeout') {
    assert.equal(item.stopReason, name);
    assert.notEqual(item.exit.code, 0);
    assert.deepEqual(item.result, []);
  } else {
    assert.equal(item.stopReason, null, name);
    assert.equal(item.exit.code, 0, name);
    assert.equal(item.result.length, 1, name);
  }
}
const successfulResult = cases.get('stop').result;
for (const name of ['length', 'content_filter', 'eof', 'done_only', 'tool', 'password']) {
  assert.deepEqual(cases.get(name).result, successfulResult, name);
}
for (const name of ['stop', 'content_filter', 'eof', 'done_only']) {
  assert.deepEqual(cases.get(name).partialStops, ['end_turn'], name);
}
assert.equal(cases.get('malformed').result[0].is_error, true);
const interrupt = cases.get('interrupt');
assert.equal(interrupt.result[0].terminal_reason, 'aborted_streaming');
assert.equal(interrupt.controlResponses.find(item => item.request_id === 'probe-interrupt').interrupted, true);
assert.deepEqual(interrupt.controlResponses.map(item => item.request_id),
  ['probe-initialize', 'probe-get_auth_methods', 'probe-logout', 'probe-interrupt']);
console.log('11 recorded scenarios reproduced. P0 remains BLOCKED: gateway access and incomplete terminal semantics.');
