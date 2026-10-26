import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { validateUpstream, createGuardedRelay, validateCandidate } from './guard.mjs';

const TEXT = '{"ok":true}';
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'fixture', choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const good = chunk({ role: 'assistant' }) + chunk({ content: TEXT }) + chunk({}, 'stop') + 'data: [DONE]\n\n';

test('完整原始 SSE 才生成正文证明', () => {
  assert.equal(validateUpstream(Buffer.from(good)).text, TEXT);
  assert.equal(validateUpstream(Buffer.from(good.replaceAll('\n', '\r\n'))).text, TEXT);
});

for (const [name, source] of Object.entries({
  eof: chunk({ content: TEXT }),
  doneOnly: chunk({ content: TEXT }) + 'data: [DONE]\n\n',
  stopOnly: chunk({ content: TEXT }) + chunk({}, 'stop'),
  filtered: chunk({ content: TEXT }) + chunk({}, 'content_filter') + 'data: [DONE]\n\n',
  length: chunk({ content: TEXT }) + chunk({}, 'length') + 'data: [DONE]\n\n',
  tool: chunk({ tool_calls: [{ id: 'tool', function: { name: 'Write' } }] }) + chunk({}, 'stop') + 'data: [DONE]\n\n',
  malformed: good.replace('data: [DONE]', 'data: {broken'),
  duplicate: good + 'data: [DONE]\n\n',
  lateText: good + chunk({ content: 'late' }),
  error: 'data: {"error":{"message":"failure"}}\n\n' + good,
  extraChoice: 'data: {"id":"fixture","choices":[{"index":0,"delta":{}},{"index":1,"delta":{}}]}\n\n' + good,
})) {
  test(`拒绝 ${name}，不依赖 CLI 自报 success`, () => {
    assert.throws(() => validateUpstream(Buffer.from(source)));
  });
}
test('拒绝损坏 UTF-8 和超过上限的响应', () => {
  assert.throws(() => validateUpstream(Buffer.from([0xff])));
  assert.throws(() => validateUpstream(Buffer.alloc(1024 * 1024 + 1)));
});

function events() {
  const base = { session_id: 'session', _requestId: 'request' };
  const streamed = event => ({ ...base, type: 'stream_event',
    _meta: { 'codebuddy.ai/modelRequestId': 'model-request' }, event });
  return [
    { type: 'system', subtype: 'init', session_id: 'session' },
    streamed({ type: 'message_start', message: { id: 'model-request', role: 'assistant', content: [], stop_reason: null } }),
    streamed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    streamed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: TEXT } }),
    streamed({ type: 'content_block_stop', index: 0 }),
    streamed({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
    streamed({ type: 'message_stop' }),
    { ...base, type: 'assistant', message: { id: 'model-request', role: 'assistant', content: [{ type: 'text', text: TEXT }] } },
    { ...base, type: 'result', subtype: 'success', is_error: false, result: TEXT },
  ];
}
const proof = () => ({ state: 'verified', forwarded: 1, rejected: 0, ...validateUpstream(Buffer.from(good)) });
test('stdout 正常也必须有独立上游证明', () => {
  assert.equal(validateCandidate(events(), null).code, 'terminal_unverified');
  assert.equal(validateCandidate(events(), proof()).accepted, true);
});
test('取消优先于迟到成功', () => {
  assert.equal(validateCandidate(events(), proof(), true).code, 'cancelled');
});
for (const [name, mutate] of [
  ['assistant不一致', list => { list[7].message.content[0].text = 'refusal'; }],
  ['result不一致', list => { list[8].result = 'different'; }],
  ['错session', list => { list[5].session_id = 'other'; }],
  ['错request', list => { list[8]._requestId = 'other'; }],
  ['重复终态', list => { list.push(list[8]); }],
  ['终态后事件', list => { list.push(list[4]); }],
  ['工具', list => { list[2].event.content_block.type = 'tool_use'; }],
  ['开始消息嵌套工具', list => { list[1].event.message.content = [{ type: 'tool_use' }]; }],
  ['最终assistant异常停止', list => { list[7].message.stop_reason = 'tool_use'; }],
  ['第二模型回合', list => { list.splice(7, 0, list[1]); }],
  ['取消标记', list => { list[8].terminal_reason = 'aborted_streaming'; }],
]) {
  test(`宿主拒收${name}`, () => {
    const list = events();
    mutate(list);
    assert.equal(validateCandidate(list, proof()).accepted, false);
  });
}

test('能力值和路径检查不耗预算，并发请求最多一个到达上游', async () => {
  let calls = 0;
  const upstream = createServer(async (_request, response) => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 50));
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end(good);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const relay = await createGuardedRelay(`http://127.0.0.1:${upstream.address().port}`);
  const body = JSON.stringify({ model: 'poc-model', stream: true, messages: [] });
  try {
    assert.equal((await fetch(relay.endpoint + '/chat/completions', { method: 'POST', body })).status, 403);
    assert.equal((await fetch(relay.endpoint + '/internal/hooks/services/invoke', {
      method: 'POST', headers: relay.headers, body,
    })).status, 404);
    const responses = await Promise.all([1, 2, 3].map(() => fetch(relay.endpoint + '/chat/completions', {
      method: 'POST', headers: relay.headers, body,
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409, 409]);
    assert.equal(calls, 1);
    assert.equal(relay.evidence().forwarded, 1);
    assert.equal(relay.evidence().rejected, 2);
  } finally {
    await relay.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('关闭转发层取消上游，迟到完成不能恢复证明', async () => {
  let markStarted;
  let markClosed;
  const started = new Promise(resolve => { markStarted = resolve; });
  const closed = new Promise(resolve => { markClosed = resolve; });
  const upstream = createServer((_request, response) => {
    response.once('close', markClosed);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': waiting\n\n');
    markStarted();
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const relay = await createGuardedRelay(`http://127.0.0.1:${upstream.address().port}`);
  const downstream = fetch(relay.endpoint + '/chat/completions', {
    method: 'POST', headers: relay.headers,
    body: JSON.stringify({ model: 'poc-model', stream: true }),
  }).catch(() => null);
  try {
    await started;
    await relay.close();
    await downstream;
    await closed;
    assert.equal(relay.evidence().state, 'cancelled');
    assert.equal(relay.evidence().forwarded, 1);
    assert.equal(validateCandidate(events(), relay.evidence()).accepted, false);
  } finally {
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});
