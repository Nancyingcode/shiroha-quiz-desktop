import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

assert.ok(process.argv[2], 'Usage: node verify-guarded.mjs <run-directory>');
const { observations } = JSON.parse(await readFile(path.join(process.argv[2], 'summary.json'), 'utf8'));
const expected = ['stop', 'length', 'content_filter', 'eof', 'done_only', 'malformed', 'tool', 'cancel', 'timeout', 'interrupt'];
assert.deepEqual(observations.map(item => item.scenario), expected);
for (const item of observations) {
  const label = item.scenario;
  assert.equal(item.requestCount, 1, label);
  assert.equal(item.guard.forwarded, 1, label);
  assert.equal(item.guard.authorizationMatched, true, label);
  assert.equal(item.guard.candidate.accepted, label === 'stop', label);
  assert.deepEqual(item.serverErrors, [], label);
  assert.deepEqual(item.markerFiles, [], label);
  assert.equal(item.unexpectedRoutes, 0, label);
  assert.equal(item.toolFileExists, false, label);
  assert.equal(item.connectionClosedBeforeCleanup, true, label);
  const cancelled = ['cancel', 'timeout', 'interrupt'].includes(label);
  if (cancelled) assert.equal(item.guard.state, 'cancelled', label);
  else if (label !== 'stop') {
    assert.equal(item.guard.state, 'rejected', label);
    assert.equal(item.result[0].is_error, true, label);
  }
}
console.log('10 guarded CLI cases verified: one upstream request each; only complete stop accepted as a transport candidate.');
console.log('Production integration, operating-system isolation and subscription billing are separate gates.');
