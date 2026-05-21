/**
 * Tool Correlation State Machine Unit Tests
 *
 * [WHO]  Test suite for tool callback correlation table
 * [FROM] ToolCorrelation register/deliver/cancel/timeOut/invalidateSession
 * [TO]  Vitest test runner
 * [HERE] src/engine/tool-correlation.test.ts — verifies docs/18 §11 lifecycle
 *        + §16 decision 1 serialized constraint.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ToolCorrelation,
  ToolTimeoutError,
  SessionLostError,
  getToolCorrelation,
} from './tool-correlation.js';
import type { ToolCallResponse } from './adapter.js';

function buildParams(overrides: Partial<{
  toolCallId: string;
  sessionId: string;
  agentId: string;
  apiKey: string;
  name: string;
  timeoutMs: number;
}> = {}) {
  return {
    toolCallId: overrides.toolCallId ?? 'tc_test_001',
    sessionId: overrides.sessionId ?? 'sess-a',
    agentId: overrides.agentId ?? 'writer',
    apiKey: overrides.apiKey ?? 'pk_test',
    name: overrides.name ?? 'read_file',
    timeoutMs: overrides.timeoutMs ?? 5000,
  };
}

describe('ToolCorrelation', () => {
  let corr: ToolCorrelation;

  beforeEach(() => {
    corr = new ToolCorrelation();
  });

  afterEach(() => {
    corr.reset();
  });

  describe('register + lookup', () => {
    it('registers a pending tool call and reports it via lookup', () => {
      const p = corr.register(buildParams());
      // The returned promise must not have resolved yet.
      const snap = corr.lookup('tc_test_001');
      expect(snap).not.toBeNull();
      expect(snap!.state).toBe('pending');
      expect(snap!.name).toBe('read_file');
      // Resolve to avoid an unhandled rejection at GC.
      corr.deliver('tc_test_001', { status: 'cancelled' });
      return p; // not awaited content; awaiting prevents unhandled-rejection
    });

    it('returns null for unknown id', () => {
      expect(corr.lookup('tc_missing')).toBeNull();
    });
  });

  describe('serialized constraint (§16 decision 1)', () => {
    it('throws when a second tool_call is registered for the same session', () => {
      const first = corr.register(buildParams({ toolCallId: 'tc_a' }));
      expect(() =>
        corr.register(buildParams({ toolCallId: 'tc_b' })),
      ).toThrow(/serialized_violation/);
      // Clean up the first.
      corr.cancel('tc_a');
      return first;
    });

    it('allows the next call after the first resolves', async () => {
      const first = corr.register(buildParams({ toolCallId: 'tc_a' }));
      corr.deliver('tc_a', { status: 'ok', output: 'done' });
      await first;
      // Now register a second; must not throw.
      const second = corr.register(buildParams({ toolCallId: 'tc_b' }));
      corr.cancel('tc_b');
      await second;
    });

    it('does not block other sessions', () => {
      const a = corr.register(buildParams({ toolCallId: 'tc_a', sessionId: 'sess-1' }));
      // Different sessionId — should be allowed.
      const b = corr.register(buildParams({ toolCallId: 'tc_b', sessionId: 'sess-2' }));
      corr.cancel('tc_a');
      corr.cancel('tc_b');
      return Promise.all([a, b]);
    });
  });

  describe('deliver outcomes', () => {
    it('resolves the awaiting promise with the caller response', async () => {
      const p = corr.register(buildParams());
      const outcome = corr.deliver('tc_test_001', { status: 'ok', output: 'hello' });
      expect(outcome).toBe('ok');
      const got = await p;
      expect(got).toEqual({ status: 'ok', output: 'hello' });
    });

    it('returns not_found for unknown id', () => {
      expect(corr.deliver('tc_nope', { status: 'cancelled' })).toBe('not_found');
    });

    it('returns already for an id that was already resolved', async () => {
      const p = corr.register(buildParams());
      corr.deliver('tc_test_001', { status: 'ok', output: 'first' });
      await p;
      // Second deliver of the same id — already-resolved.
      expect(corr.deliver('tc_test_001', { status: 'ok', output: 'second' })).toBe('already');
    });

    it('returns invalidated after invalidateSession', async () => {
      const p = corr.register(buildParams());
      // catch rejection so unhandled promise rejection doesn't fail the test
      p.catch(() => {});
      corr.invalidateSession('writer', 'sess-a');
      expect(corr.deliver('tc_test_001', { status: 'cancelled' })).toBe('invalidated');
      await expect(p).rejects.toBeInstanceOf(SessionLostError);
    });
  });

  describe('cancel', () => {
    it('resolves the awaiting promise with cancelled status', async () => {
      const p = corr.register(buildParams());
      corr.cancel('tc_test_001');
      const got = await p;
      expect(got).toEqual({ status: 'cancelled' });
    });

    it('cancel after resolve is a no-op', async () => {
      const p = corr.register(buildParams());
      corr.deliver('tc_test_001', { status: 'ok', output: 'x' });
      await p;
      // Should not throw or change state.
      corr.cancel('tc_test_001');
      const snap = corr.lookup('tc_test_001');
      expect(snap?.state).toBe('resolved');
    });
  });

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects awaiting promise with ToolTimeoutError when timer fires', async () => {
      const p = corr.register(buildParams({ timeoutMs: 1000 }));
      // attach rejection handler before advancing so we don't get unhandled rejection
      const verify = expect(p).rejects.toBeInstanceOf(ToolTimeoutError);
      vi.advanceTimersByTime(1500);
      await verify;
      // Pending counter cleared.
      expect(corr.pendingCount()).toBe(0);
    });

    it('does not fire timeout after resolve', async () => {
      const p = corr.register(buildParams({ timeoutMs: 1000 }));
      corr.deliver('tc_test_001', { status: 'ok', output: 'x' });
      vi.advanceTimersByTime(2000);
      const got = await p;
      // Should be the delivered response, not a timeout error.
      expect(got).toEqual({ status: 'ok', output: 'x' });
    });
  });

  describe('invalidateSession', () => {
    it('returns null when no pending tool for that session', () => {
      expect(corr.invalidateSession('writer', 'sess-a')).toBeNull();
    });

    it('invalidates a pending tool and returns its snapshot', async () => {
      const p = corr.register(buildParams());
      p.catch(() => {}); // pre-attach to absorb rejection
      const snap = corr.invalidateSession('writer', 'sess-a');
      expect(snap).not.toBeNull();
      expect(snap!.state).toBe('invalidated');
      // Promise rejects with SessionLostError.
      await expect(p).rejects.toBeInstanceOf(SessionLostError);
    });
  });

  describe('reap', () => {
    it('removes resolved entries older than the cutoff', async () => {
      const p = corr.register(buildParams());
      corr.deliver('tc_test_001', { status: 'ok', output: 'x' });
      await p;
      // Reap with maxAgeMs=0 should drop the resolved entry.
      const n = corr.reap(0);
      expect(n).toBe(1);
      expect(corr.lookup('tc_test_001')).toBeNull();
    });

    it('does not reap pending entries even if old', async () => {
      const p = corr.register(buildParams());
      // Wait a tick so createdAt < cutoff.
      await new Promise((r) => setTimeout(r, 5));
      expect(corr.reap(0)).toBe(0);
      // Cleanup.
      corr.cancel('tc_test_001');
      await p;
    });
  });

  describe('getToolCorrelation singleton', () => {
    it('returns same instance across calls', () => {
      const a = getToolCorrelation();
      const b = getToolCorrelation();
      expect(a).toBe(b);
      a.reset();
    });
  });

  it('rejects duplicate tool_call_id (programming bug guard)', () => {
    const p1 = corr.register(buildParams({ toolCallId: 'tc_dup' }));
    // Cleanup first by cancelling; second register with same id while first still pending hits the serialized check first.
    corr.cancel('tc_dup');
    return p1.then(() => {
      // After resolve, the entry is still in the table (state=cancelled).
      // Re-registering with the same id is a duplicate.
      expect(() => corr.register(buildParams({ toolCallId: 'tc_dup' }))).toThrow(
        /duplicate_tool_call_id/,
      );
    });
  });
});

/**
 * Helper for downstream tests: dummy ToolCallResponse builders.
 */
export function okResponse(output: string): ToolCallResponse {
  return { status: 'ok', output };
}
export function errorResponse(code: string, message: string): ToolCallResponse {
  return { status: 'error', error: { code, message } };
}
