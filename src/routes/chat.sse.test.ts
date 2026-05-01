/**
 * SSE Serialization Unit Tests
 *
 * [WHO]  Test suite for SSE chunk serialization
 * [FROM] chat.ts SSE helpers (serializeChunk, createDeltaChunk, SSE_DONE)
 * [TO]  Vitest test runner
 * [HERE] src/routes/chat.sse.test.ts — verifies SSE format, delta chunks, done sentinel
 */

import { describe, it, expect } from 'vitest';
import { serializeChunk, createDeltaChunk, serializeError, SSE_DONE } from './chat.js';

describe('serializeChunk', () => {
  it('should serialize a chunk as data: line', () => {
    const chunk = {
      id: 'chatcmpl_123',
      object: 'chat.completion.chunk',
      created: 1714000000,
      model: 'pencil/test-agent',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    };
    const result = serializeChunk(chunk);
    expect(result).toBe(`data: ${JSON.stringify(chunk)}\n\n`);
  });

  it('should produce valid SSE format', () => {
    const chunk = {
      id: 'test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test',
      choices: [{ index: 0, delta: {}, finish_reason: null }],
    };
    const result = serializeChunk(chunk);
    expect(result).toMatch(/^data: \{.*\}\n\n$/);
  });
});

describe('SSE_DONE', () => {
  it('should be the correct sentinel value', () => {
    expect(SSE_DONE).toBe('data: [DONE]\n\n');
  });
});

describe('serializeError', () => {
  it('forwards the upstream message verbatim inside an OpenAI-shaped envelope', () => {
    const out = serializeError('429 week allocated quota exceeded.');
    expect(out.startsWith('data: ')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(true);
    const body = JSON.parse(out.slice(6, -2));
    expect(body).toEqual({
      error: {
        type: 'engine_error',
        code: 'engine_error',
        message: '429 week allocated quota exceeded.',
      },
    });
  });

  it('preserves multi-line / structured error messages', () => {
    const msg = 'Upstream returned:\n{"code":"throttling","message":"quota exceeded"}';
    const out = serializeError(msg);
    const body = JSON.parse(out.slice(6, -2));
    expect(body.error.message).toBe(msg);
  });
});

describe('createDeltaChunk', () => {
  it('should create a chunk with role delta', () => {
    const chunk = createDeltaChunk('chatcmpl_1', 1714000000, 'pencil/test', { role: 'assistant' }, null);
    expect(chunk.id).toBe('chatcmpl_1');
    expect(chunk.object).toBe('chat.completion.chunk');
    expect(chunk.created).toBe(1714000000);
    expect(chunk.model).toBe('pencil/test');
    expect(chunk.choices[0].delta.role).toBe('assistant');
    expect(chunk.choices[0].delta.content).toBeUndefined();
    expect(chunk.choices[0].finish_reason).toBeNull();
  });

  it('should create a chunk with content delta', () => {
    const chunk = createDeltaChunk('chatcmpl_1', 1714000000, 'pencil/test', { content: 'Hello' }, null);
    expect(chunk.choices[0].delta.content).toBe('Hello');
  });

  it('should create a chunk with finish reason', () => {
    const chunk = createDeltaChunk('chatcmpl_1', 1714000000, 'pencil/test', {}, 'stop');
    expect(chunk.choices[0].finish_reason).toBe('stop');
    expect(chunk.choices[0].delta).toEqual({});
  });

  it('should create a chunk with length finish reason', () => {
    const chunk = createDeltaChunk('chatcmpl_1', 1714000000, 'pencil/test', {}, 'length');
    expect(chunk.choices[0].finish_reason).toBe('length');
  });

  it('should create a chunk with cancelled finish reason', () => {
    const chunk = createDeltaChunk('chatcmpl_1', 1714000000, 'pencil/test', {}, 'cancelled');
    expect(chunk.choices[0].finish_reason).toBe('cancelled');
  });
});
