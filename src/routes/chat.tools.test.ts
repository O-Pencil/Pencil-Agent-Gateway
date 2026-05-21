/**
 * Chat + Tool Callback End-to-End Integration Test
 *
 * [WHO]  Test suite for v0.2 SSE pencil.tool_request -> POST tool_response loop
 * [FROM] POST /v1/chat/completions with pencil_client_tools + MockEngineAdapter
 *        scripted tool emission + POST /v1/agents/:id/sessions/:sid/tool_response
 * [TO]   Vitest test runner
 * [HERE] src/routes/chat.tools.test.ts — M-tools-1 acceptance test per docs/18 §15.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createApp } from '../app.js';
import { setConfig } from '../config.js';
import { initRegistry, getRegistry } from '../agent/registry.js';
import { initSessionStore } from '../store/session.js';
import { getToolCorrelation } from '../engine/tool-correlation.js';
import { MockEngineAdapter } from '../engine/mock-adapter.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineAdapter } from '../engine/adapter.js';

const TEST_DATA_DIR = join(process.cwd(), '.grub-test-data-chat-tools');

function cleanDir() {
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function setupApp() {
  cleanDir();
  setConfig({
    gateway: {
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'error',
      corsOrigins: '*',
      requestTimeoutMs: 120000,
    },
    apiKeys: [{ key: 'pk_full', label: 'full', allowedAgents: '*' as const }],
    dataDir: TEST_DATA_DIR,
    agents: [],
  });
  initRegistry(TEST_DATA_DIR);
  initSessionStore(TEST_DATA_DIR);
  return createApp();
}

/**
 * Register an agent and swap its engine for a MockEngineAdapter.
 * The `engine` field is `readonly` at type level only — runtime assignment is
 * allowed and is the lightest way to inject a mock without adding a test-only
 * engine type to the production switch.
 */
async function createMockAgent(app: ReturnType<typeof createApp>, id: string): Promise<MockEngineAdapter> {
  const req = new Request(`http://localhost/v1/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer pk_full',
    },
    body: JSON.stringify({
      id,
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
    }),
  });
  const res = await app.fetch(req);
  expect(res.status).toBe(200);

  const instance = getRegistry().get(id)!;
  const mock = new MockEngineAdapter();
  (instance as unknown as { engine: EngineAdapter }).engine = mock;
  return mock;
}

interface ParsedSse {
  rawEvents: { event: string | null; data: string }[];
  toolRequests: Array<{
    tool_call_id: string;
    session_id: string;
    agent_id: string;
    name: string;
    arguments: Record<string, unknown>;
    timeout_ms: number;
  }>;
  deltas: string[];
  done: boolean;
  errors: { type?: string; code?: string; message?: string }[];
}

function parseSse(text: string): ParsedSse {
  const parsed: ParsedSse = {
    rawEvents: [],
    toolRequests: [],
    deltas: [],
    done: false,
    errors: [],
  };
  const frames = text.split('\n\n').filter((f) => f.length > 0);
  for (const frame of frames) {
    let eventName: string | null = null;
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) eventName = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    parsed.rawEvents.push({ event: eventName, data });
    if (eventName === 'pencil.tool_request') {
      parsed.toolRequests.push(JSON.parse(data));
    } else if (data === '[DONE]') {
      parsed.done = true;
    } else if (data.startsWith('{')) {
      const obj = JSON.parse(data);
      if (obj.error) {
        parsed.errors.push(obj.error);
      } else if (obj.choices?.[0]?.delta?.content) {
        parsed.deltas.push(obj.choices[0].delta.content);
      }
    }
  }
  return parsed;
}

async function streamChat(
  app: ReturnType<typeof createApp>,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const req = new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer pk_full',
    },
    body: JSON.stringify(body),
  });
  const res = await app.fetch(req);
  return { status: res.status, text: await res.text() };
}

describe('chat + pencil_client_tools end-to-end', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = setupApp();
  });

  beforeEach(() => {
    getToolCorrelation().reset();
  });

  it('M-tools-1 happy path: tool_request -> tool_response -> resume -> done', async () => {
    const mock = await createMockAgent(app, 'writer');
    mock.setResponse('writer', '');
    mock.scriptTool('writer', {
      name: 'read_file',
      arguments: { path: 'README.md' },
      replyText: 'After-tool',
    });

    // Start the SSE call in parallel and respond from the test side.
    const chatPromise = streamChat(app, {
      model: 'pencil/writer',
      messages: [{ role: 'user', content: 'read it' }],
      stream: true,
      session_id: 'sess-1',
      pencil_client_tools: [{ name: 'read_file' }],
    });

    // Poll for a pending tool_call_id; the route handler registers it
    // synchronously after the engine emits via onDelta. We use a tight retry.
    let toolCallId: string | null = null;
    for (let i = 0; i < 50 && !toolCallId; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const pending = getToolCorrelation().pendingCount();
      if (pending > 0) {
        // Find by scanning known prefix.
        for (let n = 1; n <= 10; n++) {
          const id = `tc_mock_${n.toString().padStart(6, '0')}`;
          if (getToolCorrelation().lookup(id)?.state === 'pending') {
            toolCallId = id;
            break;
          }
        }
      }
    }
    expect(toolCallId).not.toBeNull();

    // POST tool_response from the caller side.
    const responseReq = new Request(
      `http://localhost/v1/agents/writer/sessions/sess-1/tool_response`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer pk_full',
        },
        body: JSON.stringify({
          tool_call_id: toolCallId,
          status: 'ok',
          output: 'file contents',
        }),
      },
    );
    const respRes = await app.fetch(responseReq);
    expect(respRes.status).toBe(202);

    const { status, text } = await chatPromise;
    expect(status).toBe(200);
    const parsed = parseSse(text);

    expect(parsed.toolRequests).toHaveLength(1);
    expect(parsed.toolRequests[0].name).toBe('read_file');
    expect(parsed.toolRequests[0].session_id).toBe('sess-1');
    expect(parsed.toolRequests[0].agent_id).toBe('writer');
    expect(parsed.toolRequests[0].tool_call_id).toBe(toolCallId);

    // Content delta(s) after tool completes.
    expect(parsed.deltas.join('')).toBe('After-tool');
    expect(parsed.done).toBe(true);
    expect(parsed.errors).toHaveLength(0);
  });

  it('emits tool_not_advertised when engine requests an unadvertised tool', async () => {
    const mock = await createMockAgent(app, 'writer2');
    mock.setResponse('writer2', '');
    mock.scriptTool('writer2', {
      name: 'shell_exec',
      arguments: { cmd: 'ls' },
      replyText: 'never',
    });

    const { status, text } = await streamChat(app, {
      model: 'pencil/writer2',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
      session_id: 'sess-2',
      pencil_client_tools: [{ name: 'read_file' }],
    });

    expect(status).toBe(200);
    const parsed = parseSse(text);
    expect(parsed.errors.some((e) => e.code === 'tool_not_advertised')).toBe(true);
    expect(parsed.done).toBe(true);
  });

  it('rejects pencil_client_tools without stream:true (422)', async () => {
    await createMockAgent(app, 'writer3');
    const { status } = await streamChat(app, {
      model: 'pencil/writer3',
      messages: [{ role: 'user', content: 'go' }],
      stream: false,
      pencil_client_tools: [{ name: 'read_file' }],
    });
    expect(status).toBe(422);
  });

  it('rejects malformed pencil_client_tools at validation (422)', async () => {
    await createMockAgent(app, 'writer4');
    const { status } = await streamChat(app, {
      model: 'pencil/writer4',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
      pencil_client_tools: [{ name: '0_starts_with_digit' }],
    });
    expect(status).toBe(422);
  });
});
