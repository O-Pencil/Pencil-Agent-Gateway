/**
 * Tool Response Route Tests
 *
 * [WHO]  Test suite for POST /v1/agents/:agentId/sessions/:sessionId/tool_response
 * [FROM] Hono app + tool-response route + tool-correlation singleton
 * [TO]  Vitest test runner
 * [HERE] src/routes/tool-response.test.ts — verifies docs/18 §7 status codes
 *        (202/401/403/404/409/410/413/422) using a pre-seeded correlation entry
 *        instead of a full chat-route SSE round-trip (covered in chat.tools.test.ts).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { setConfig } from '../config.js';
import { initRegistry } from '../agent/registry.js';
import { initSessionStore } from '../store/session.js';
import { getToolCorrelation } from '../engine/tool-correlation.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DATA_DIR = join(process.cwd(), '.grub-test-data-tool-response');

function cleanTestDataDir() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function setupTestApp() {
  cleanTestDataDir();

  setConfig({
    gateway: {
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'error',
      corsOrigins: '*',
      requestTimeoutMs: 120000,
    },
    apiKeys: [
      { key: 'pk_full', label: 'full', allowedAgents: '*' as const },
      { key: 'pk_other', label: 'other', allowedAgents: '*' as const },
    ],
    dataDir: TEST_DATA_DIR,
    agents: [],
  });

  initRegistry(TEST_DATA_DIR);
  initSessionStore(TEST_DATA_DIR);

  return createApp();
}

async function postToolResponse(
  app: any,
  agentId: string,
  sessionId: string,
  body: unknown,
  apiKey = 'pk_full',
): Promise<Response> {
  const path = `/v1/agents/${agentId}/sessions/${sessionId}/tool_response`;
  const req = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  return app.fetch(req);
}

/**
 * Seed a pending tool call directly into the correlation singleton.
 * Returns the awaiting Promise so the test can verify it resolves.
 */
function seedTool(opts: {
  toolCallId: string;
  sessionId: string;
  agentId: string;
  apiKey: string;
  name?: string;
  timeoutMs?: number;
}) {
  return getToolCorrelation().register({
    toolCallId: opts.toolCallId,
    sessionId: opts.sessionId,
    agentId: opts.agentId,
    apiKey: opts.apiKey,
    name: opts.name ?? 'read_file',
    timeoutMs: opts.timeoutMs ?? 5_000,
  });
}

describe('POST /v1/agents/:agentId/sessions/:sessionId/tool_response', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = setupTestApp();
  });

  beforeEach(() => {
    getToolCorrelation().reset();
  });

  it('202 on valid OK response and resolves awaiting promise', async () => {
    const p = seedTool({
      toolCallId: 'tc_ok',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });

    const res = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_ok',
      status: 'ok',
      output: 'hello',
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ accepted: true, tool_call_id: 'tc_ok' });

    const delivered = await p;
    expect(delivered).toEqual({ status: 'ok', output: 'hello' });
  });

  it('202 on valid error response', async () => {
    const p = seedTool({
      toolCallId: 'tc_err',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });

    const res = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_err',
      status: 'error',
      error: { code: 'enoent', message: 'no file' },
    });
    expect(res.status).toBe(202);

    const delivered = await p;
    expect(delivered).toEqual({ status: 'error', error: { code: 'enoent', message: 'no file' } });
  });

  it('401 when API Key missing', async () => {
    const req = new Request(`http://localhost/v1/agents/writer/sessions/sess-a/tool_response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_call_id: 'x', status: 'cancelled' }),
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(401);
  });

  it('403 when a different API Key tries to respond', async () => {
    const p = seedTool({
      toolCallId: 'tc_diff_key',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });
    // Avoid unhandled rejection if test gets that far.
    p.catch(() => {});

    const res = await postToolResponse(
      app,
      'writer',
      'sess-a',
      { tool_call_id: 'tc_diff_key', status: 'cancelled' },
      'pk_other',
    );
    expect(res.status).toBe(403);

    // Cleanup the entry.
    getToolCorrelation().cancel('tc_diff_key');
    await p;
  });

  it('404 for unknown tool_call_id', async () => {
    const res = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_nope',
      status: 'cancelled',
    });
    expect(res.status).toBe(404);
  });

  it('404 when agentId/sessionId path does not match the registered tool', async () => {
    const p = seedTool({
      toolCallId: 'tc_mismatch',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });
    p.catch(() => {});

    const res = await postToolResponse(app, 'writer', 'sess-OTHER', {
      tool_call_id: 'tc_mismatch',
      status: 'cancelled',
    });
    expect(res.status).toBe(404);

    getToolCorrelation().cancel('tc_mismatch');
    await p;
  });

  it('409 when responding twice to the same tool_call_id', async () => {
    const p = seedTool({
      toolCallId: 'tc_dup',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });

    const r1 = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_dup',
      status: 'ok',
      output: 'first',
    });
    expect(r1.status).toBe(202);
    await p;

    const r2 = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_dup',
      status: 'ok',
      output: 'second',
    });
    expect(r2.status).toBe(409);
  });

  it('410 when session was invalidated before the response arrived', async () => {
    const p = seedTool({
      toolCallId: 'tc_gone',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });
    p.catch(() => {});

    getToolCorrelation().invalidateSession('writer', 'sess-a');

    const res = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_gone',
      status: 'ok',
      output: 'x',
    });
    expect(res.status).toBe(410);

    await expect(p).rejects.toBeTruthy();
  });

  it('413 when output exceeds 256 KiB', async () => {
    const p = seedTool({
      toolCallId: 'tc_big',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });
    p.catch(() => {});

    const huge = 'a'.repeat(256 * 1024 + 1);
    const res = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_big',
      status: 'ok',
      output: huge,
    });
    expect(res.status).toBe(413);

    getToolCorrelation().cancel('tc_big');
    await p;
  });

  it('422 when body is malformed', async () => {
    // Pre-seed so the (writer, sess-a) path is legitimate; the test is about
    // body validation, not lookup.
    const p = seedTool({
      toolCallId: 'tc_bad_body',
      sessionId: 'sess-a',
      agentId: 'writer',
      apiKey: 'pk_full',
    });
    p.catch(() => {});

    // status missing entirely.
    const r1 = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_bad_body',
    });
    expect(r1.status).toBe(422);

    // status="ok" but output not a string.
    const r2 = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_bad_body',
      status: 'ok',
      output: 12345,
    });
    expect(r2.status).toBe(422);

    // status="error" missing error.code.
    const r3 = await postToolResponse(app, 'writer', 'sess-a', {
      tool_call_id: 'tc_bad_body',
      status: 'error',
      error: { message: 'no code' },
    });
    expect(r3.status).toBe(422);

    getToolCorrelation().cancel('tc_bad_body');
    await p;
  });

  it('422 when path params contain unsafe characters', async () => {
    // Use a char that survives URL normalization but fails validateSafeId
    // ([a-zA-Z0-9_-]+ only). A literal dot in sessionId qualifies.
    const res = await postToolResponse(app, 'writer', 'sess.a', {
      tool_call_id: 'whatever',
      status: 'cancelled',
    });
    expect(res.status).toBe(422);
  });
});
