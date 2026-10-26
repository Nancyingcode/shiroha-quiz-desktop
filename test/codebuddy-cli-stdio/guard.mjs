import assert from 'node:assert/strict';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;
const hash = text => createHash('sha256').update(text).digest('hex');

export function validateUpstream(bytes) {
  assert.ok(bytes.length <= MAX_RESPONSE_BYTES, 'response_too_large');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n');
  assert.ok(source.endsWith('\n\n'), 'incomplete_sse');
  let text = '';
  let completionId;
  let stopped = false;
  let done = false;
  for (const block of source.split('\n\n')) {
    const lines = block.split('\n').filter(line => line && !line.startsWith(':'));
    if (lines.length === 0) continue;
    assert.ok(lines.every(line => line.startsWith('data:')), 'unexpected_sse_field');
    assert.equal(done, false, 'data_after_done');
    const data = lines.map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (data === '[DONE]') {
      assert.equal(stopped, true, 'finish_reason_missing');
      done = true;
      continue;
    }
    const payload = JSON.parse(data);
    assert.ok(payload && typeof payload === 'object' && !payload.error, 'upstream_error');
    assert.ok(typeof payload.id === 'string' && payload.id.length > 0, 'completion_id_missing');
    completionId ??= payload.id;
    assert.equal(payload.id, completionId, 'completion_id_changed');
    assert.ok(Array.isArray(payload.choices), 'choices_missing');
    if (payload.choices.length === 0) {
      assert.ok(stopped && payload.usage, 'unexpected_empty_choices');
      continue;
    }
    assert.equal(payload.choices.length, 1, 'multiple_choices');
    const choice = payload.choices[0];
    assert.equal(choice.index, 0, 'unexpected_choice');
    assert.equal(stopped, false, 'data_after_finish');
    const delta = choice.delta;
    assert.ok(delta && typeof delta === 'object' && !Array.isArray(delta), 'invalid_delta');
    assert.ok(Object.keys(delta).every(key => ['role', 'content'].includes(key)), 'non_text_delta');
    if (delta.role !== undefined) assert.equal(delta.role, 'assistant', 'unexpected_role');
    if (delta.content !== undefined) {
      assert.equal(typeof delta.content, 'string', 'non_text_content');
      text += delta.content;
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      assert.equal(choice.finish_reason, 'stop', 'non_success_finish');
      stopped = true;
    }
  }
  assert.ok(stopped && done && text.length > 0, 'terminal_unverified');
  return { text, digest: hash(text), finishReason: 'stop' };
}

// Evidence is owned by one relay instance per task; it never comes from CLI output or the renderer.
export function validateCandidate(events, proof, cancelled = false) {
  const fail = code => ({ accepted: false, code });
  if (cancelled) return fail('cancelled');
  if (!proof || proof.state !== 'verified' || proof.forwarded !== 1 || proof.rejected !== 0) {
    return fail('terminal_unverified');
  }
  let phase = 'initial';
  let session;
  let request;
  let modelRequest;
  let text = '';
  try {
    assert.equal(proof.digest, hash(proof.text));
    assert.equal(proof.finishReason, 'stop');
    for (const event of events) {
      assert.notEqual(phase, 'finished');
      if (phase === 'initial') {
        assert.equal(event.type, 'system');
        assert.equal(event.subtype, 'init');
        assert.ok(typeof event.session_id === 'string' && event.session_id.length > 0);
        session = event.session_id;
        phase = 'waiting';
        continue;
      }
      assert.equal(event.session_id, session);
      assert.ok(event.parent_tool_use_id === undefined || event.parent_tool_use_id === null);
      assert.ok(typeof event._requestId === 'string' && event._requestId.length > 0);
      request ??= event._requestId;
      assert.equal(event._requestId, request);
      if (event.type === 'system') {
        assert.equal(event.subtype, 'status');
        continue;
      }
      if (event.type === 'stream_event') {
        const part = event.event;
        if (part.type === 'message_start') {
          assert.equal(phase, 'waiting');
          assert.equal(part.message.role, 'assistant');
          assert.ok(part.message.stop_reason === undefined || part.message.stop_reason === null);
          assert.ok(Array.isArray(part.message.content));
          assert.ok(part.message.content.every(item => item.type === 'text' && item.text === ''));
          modelRequest = part.message.id;
          assert.ok(typeof modelRequest === 'string' && modelRequest.length > 0);
          phase = 'started';
        } else if (part.type === 'content_block_start') {
          assert.equal(phase, 'started');
          assert.equal(part.index, 0);
          assert.equal(part.content_block.type, 'text');
          assert.equal(part.content_block.text, '');
          phase = 'text';
        } else if (part.type === 'content_block_delta') {
          assert.equal(phase, 'text');
          assert.equal(part.index, 0);
          assert.equal(part.delta.type, 'text_delta');
          assert.equal(typeof part.delta.text, 'string');
          text += part.delta.text;
        } else if (part.type === 'content_block_stop') {
          assert.equal(phase, 'text');
          assert.equal(part.index, 0);
          phase = 'block-stopped';
        } else if (part.type === 'message_delta') {
          assert.equal(phase, 'block-stopped');
          assert.equal(part.delta.stop_reason, 'end_turn');
          phase = 'message-ending';
        } else if (part.type === 'message_stop') {
          assert.equal(phase, 'message-ending');
          phase = 'message-stopped';
        } else assert.fail('unknown_stream_event');
        assert.equal(event._meta?.['codebuddy.ai/modelRequestId'], modelRequest);
      } else if (event.type === 'assistant') {
        assert.equal(phase, 'message-stopped');
        assert.equal(event.message.id, modelRequest);
        assert.equal(event.message.role, 'assistant');
        assert.ok(event.message.stop_reason === undefined || event.message.stop_reason === null);
        assert.ok(event.message.content.every(part => part.type === 'text' && typeof part.text === 'string'));
        assert.equal(event.message.content.map(part => part.text).join(''), text);
        phase = 'assistant';
      } else if (event.type === 'result') {
        assert.equal(phase, 'assistant');
        assert.equal(event.subtype, 'success');
        assert.equal(event.is_error, false);
        assert.ok(!event.terminal_reason);
        assert.equal((event.permission_denials ?? []).length, 0);
        assert.equal(event.result, text);
        phase = 'finished';
      } else assert.fail('unknown_event');
    }
    assert.equal(phase, 'finished');
    assert.equal(text, proof.text);
    return { accepted: true, text };
  } catch { return fail('candidate_rejected'); }
}

async function boundedRead(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    assert.ok(size <= limit, 'body_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function createGuardedRelay(upstream, expectedBearer = undefined) {
  const target = new URL(upstream);
  assert.equal(target.protocol, 'http:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/');
  assert.ok(!target.username && !target.password && !target.search && !target.hash);
  const capability = randomBytes(32).toString('hex');
  // One instance owns one immutable endpoint and one upstream budget until close; no cross-task reuse.
  const evidence = { state: 'unused', forwarded: 0, rejected: 0 };
  const requests = new Set();
  const controllers = new Set();
  const reply = (response, status, code) => {
    if (!response.destroyed) response.writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: { code } }));
  };
  const handle = async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      reply(response, 404, 'route_denied'); return;
    }
    const supplied = request.headers['x-shiroha-run'];
    const authorized = typeof supplied === 'string' && /^[0-9a-f]{64}$/.test(supplied)
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(capability));
    if (!authorized) { reply(response, 403, 'capability_required'); return; }
    if (expectedBearer !== undefined) {
      evidence.authorizationMatched = request.headers.authorization === `Bearer ${expectedBearer}`;
    }
    if (evidence.state !== 'unused') {
      evidence.rejected += 1;
      reply(response, 409, 'request_budget_exhausted'); return;
    }
    const body = await boundedRead(request, MAX_REQUEST_BYTES);
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    const hasNoTools = payload.tools === undefined || (Array.isArray(payload.tools) && payload.tools.length === 0);
    assert.ok(payload.model === 'poc-model' && payload.stream === true && hasNoTools);
    assert.ok(payload.functions === undefined && payload.function_call === undefined && payload.tool_choice === undefined);
    if (evidence.state !== 'unused') {
      evidence.rejected += 1;
      reply(response, 409, 'request_budget_exhausted'); return;
    }
    // Reserve synchronously before awaiting fetch, including concurrent requests and failures.
    evidence.state = 'pending';
    evidence.forwarded = 1;
    const controller = new globalThis.AbortController();
    controllers.add(controller);
    response.once('close', () => {
      if (!response.writableFinished && evidence.state === 'pending') evidence.state = 'cancelled';
      controller.abort();
    });
    try {
      const result = await fetch(new URL('/chat/completions', target), {
        method: 'POST', body, redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: 'Bearer relay-fake-upstream-key' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      });
      assert.equal(result.status, 200);
      assert.ok(result.headers.get('content-type')?.startsWith('text/event-stream'));
      const bytes = await boundedRead(result.body, MAX_RESPONSE_BYTES);
      assert.equal(controller.signal.aborted, false);
      assert.equal(evidence.state, 'pending');
      Object.assign(evidence, validateUpstream(bytes), { state: 'verified' });
      if (!response.destroyed) response.writeHead(200, { 'content-type': 'text/event-stream' }).end(bytes);
    } finally { controllers.delete(controller); }
  };
  const server = createServer((request, response) => {
    const running = handle(request, response).catch(() => {
      if (evidence.state === 'pending') evidence.state = 'rejected';
      reply(response, 422, 'upstream_unverified');
    }).finally(() => requests.delete(running));
    requests.add(running);
  });
  server.requestTimeout = UPSTREAM_TIMEOUT_MS;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    headers: { 'x-shiroha-run': capability },
    evidence: () => ({ ...evidence }),
    close: async () => {
      if (evidence.state === 'unused' || evidence.state === 'pending') evidence.state = 'cancelled';
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await Promise.allSettled([...requests]);
    },
  };
}
