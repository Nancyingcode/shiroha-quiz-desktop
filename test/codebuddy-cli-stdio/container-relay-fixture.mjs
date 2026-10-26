import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { setInterval, clearInterval } from 'node:timers';
import path from 'node:path';
import { createGuardedRelay } from './guard.mjs';

// Deployed only into a synthetic AppContainer test directory; never accepts a real upstream URL.
const scenario = process.argv[2];
const directory = path.resolve(process.argv[3]);
assert.ok(['stop', 'eof', 'tool'].includes(scenario));
let upstreamCount = 0;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'container-fixture', choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const server = createServer(async (request, response) => {
  let bytes = 0;
  for await (const part of request) {
    bytes += part.length;
    assert.ok(bytes <= 2 * 1024 * 1024);
  }
  if (request.method !== 'POST' || request.url !== '/chat/completions') {
    response.writeHead(404).end(); return;
  }
  upstreamCount += 1;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(': synthetic AppContainer fixture\n\n');
  await new Promise(resolve => setTimeout(resolve, 6_000));
  if (scenario === 'tool') {
    response.end(chunk({ tool_calls: [{ index: 0, id: 'test-tool', type: 'function',
      function: { name: 'Write', arguments: '{}' } }] }, 'tool_calls') + 'data: [DONE]\n\n');
    return;
  }
  response.write(chunk({ role: 'assistant' }) + chunk({ content: '{"ok":true}' }));
  response.end(scenario === 'eof' ? '' : chunk({}, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const relay = await createGuardedRelay(`http://127.0.0.1:${server.address().port}`);
await writeFile(path.join(directory, 'relay-ready.json'), JSON.stringify({
  endpoint: relay.endpoint, headers: relay.headers, pid: process.pid,
  ports: [server.address().port, Number(new URL(relay.endpoint).port)],
}));
// The parent records token isolation and owns process cleanup; snapshots contain only synthetic evidence.
let writing = false;
const timer = setInterval(async () => {
  if (writing) return;
  writing = true;
  try {
    await writeFile(path.join(directory, 'relay-proof.json'), JSON.stringify({ scenario, upstreamCount, ...relay.evidence() }));
  } finally { writing = false; }
}, 100);
process.once('SIGTERM', async () => {
  clearInterval(timer);
  await relay.close();
  server.closeAllConnections();
  server.close();
});
