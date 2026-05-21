/**
 * MockEngineAdapter Unit Tests
 *
 * [WHO]  Test suite for MockEngineAdapter
 * [FROM] MockEngineAdapter.run + scriptTool + provideToolResponse
 * [TO]  Vitest test runner
 * [HERE] src/engine/mock-adapter.test.ts — verifies the v0.1 baseline streaming
 *        behavior and the v0.2 scripted tool_request loop used for M-tools-1.
 */

import { describe, it, expect } from 'vitest';
import { MockEngineAdapter } from './mock-adapter.js';
import type { EngineDeltaEvent, ToolCallResponse } from './adapter.js';

function collectDeltas(adapter: MockEngineAdapter, agentId: string, opts?: {
  clientTools?: { name: string; timeoutMs?: number }[];
  driveToolResponse?: (toolCallId: string) => ToolCallResponse;
}): Promise<{
  text: string;
  events: EngineDeltaEvent[];
  toolCallIds: string[];
}> {
  const events: EngineDeltaEvent[] = [];
  const toolCallIds: string[] = [];

  const run = adapter.run(
    {
      agentId,
      sessionId: 'sess-test',
      messages: [{ role: 'user', content: 'hi' }],
      clientTools: opts?.clientTools,
    },
    {
      stream: true,
      onDelta: (event) => {
        events.push({ ...event });
        if (event.type === 'tool_request' && event.toolCallId) {
          toolCallIds.push(event.toolCallId);
          if (opts?.driveToolResponse) {
            const response = opts.driveToolResponse(event.toolCallId);
            // Fire async on next microtask so the adapter's await sees it.
            queueMicrotask(() => {
              void adapter.provideToolResponse(event.toolCallId!, response);
            });
          }
        }
      },
    },
  );

  return run.then((res) => ({
    text: res.text,
    events,
    toolCallIds,
  }));
}

describe('MockEngineAdapter v0.1 baseline', () => {
  it('streams the default response as character deltas + done', async () => {
    const adapter = new MockEngineAdapter();
    adapter.setResponse('writer', 'hi');
    const out = await collectDeltas(adapter, 'writer');
    const contentDeltas = out.events.filter((e) => e.type === 'delta').map((e) => e.content);
    expect(contentDeltas.join('')).toBe('hi');
    expect(out.events[out.events.length - 1].type).toBe('done');
    expect(out.text).toBe('hi');
  });
});

describe('MockEngineAdapter v0.2 scripted tool_request', () => {
  it('emits a tool_request, awaits the response, then continues streaming', async () => {
    const adapter = new MockEngineAdapter();
    adapter.setResponse('writer', '');
    adapter.scriptTool('writer', {
      name: 'read_file',
      arguments: { path: 'README.md' },
      replyText: 'OK',
    });

    const out = await collectDeltas(adapter, 'writer', {
      clientTools: [{ name: 'read_file' }],
      driveToolResponse: () => ({ status: 'ok', output: 'file contents' }),
    });

    const toolEvents = out.events.filter((e) => e.type === 'tool_request');
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].toolName).toBe('read_file');
    expect(toolEvents[0].toolArguments).toEqual({ path: 'README.md' });
    expect(toolEvents[0].toolCallId).toMatch(/^tc_mock_\d{6}$/);

    const contentDeltas = out.events.filter((e) => e.type === 'delta').map((e) => e.content);
    expect(contentDeltas.join('')).toBe('OK');
    expect(out.events[out.events.length - 1].type).toBe('done');
  });

  it('emits multiple scripted tools serially', async () => {
    const adapter = new MockEngineAdapter();
    adapter.setResponse('writer', '');
    adapter.scriptTool('writer', {
      name: 'read_file',
      arguments: { path: 'a.md' },
      replyText: 'a',
    });
    adapter.scriptTool('writer', {
      name: 'read_file',
      arguments: { path: 'b.md' },
      replyText: 'b',
    });

    const out = await collectDeltas(adapter, 'writer', {
      clientTools: [{ name: 'read_file' }],
      driveToolResponse: () => ({ status: 'ok', output: 'data' }),
    });

    const toolEvents = out.events.filter((e) => e.type === 'tool_request');
    expect(toolEvents).toHaveLength(2);
    // Order: tool_request -> delta(s) for a -> tool_request -> delta(s) for b -> done
    const types = out.events.map((e) => e.type);
    const firstToolIdx = types.indexOf('tool_request');
    const secondToolIdx = types.indexOf('tool_request', firstToolIdx + 1);
    const firstDoneIdx = types.indexOf('done');
    // Second tool request comes before done.
    expect(secondToolIdx).toBeLessThan(firstDoneIdx);
    // Some delta exists between the two tool requests.
    expect(secondToolIdx).toBeGreaterThan(firstToolIdx + 1);
  });

  it('aborts when scripted call sets consumeOnError=abort and response is error', async () => {
    const adapter = new MockEngineAdapter();
    adapter.scriptTool('writer', {
      name: 'read_file',
      arguments: { path: 'x' },
      replyText: 'should not appear',
      consumeOnError: 'abort',
    });

    const out = await collectDeltas(adapter, 'writer', {
      clientTools: [{ name: 'read_file' }],
      driveToolResponse: () => ({
        status: 'error',
        error: { code: 'tool_runtime_error', message: 'boom' },
      }),
    });

    const errorEvents = out.events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error).toMatch(/tool_runtime_error/);
    // No done event when aborted.
    expect(out.events.some((e) => e.type === 'done')).toBe(false);
  });

  it('script is one-shot per run', async () => {
    const adapter = new MockEngineAdapter();
    adapter.scriptTool('writer', {
      name: 'read_file',
      arguments: {},
      replyText: 'x',
    });

    const first = await collectDeltas(adapter, 'writer', {
      clientTools: [{ name: 'read_file' }],
      driveToolResponse: () => ({ status: 'ok', output: 'r' }),
    });
    expect(first.events.filter((e) => e.type === 'tool_request')).toHaveLength(1);

    // Second run: no scripted tool emitted.
    const second = await collectDeltas(adapter, 'writer');
    expect(second.events.filter((e) => e.type === 'tool_request')).toHaveLength(0);
  });
});
