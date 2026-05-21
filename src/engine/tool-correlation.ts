/**
 * Pencil Agent Gateway Tool Correlation Table
 *
 * [WHO]  Gateway server
 * [FROM] Chat completion route (registers on tool_request emit) +
 *        tool_response route (resolves on inbound POST)
 * [TO]  EngineAdapter.provideToolResponse — unblocks the running engine loop
 * [HERE] In-memory per-process correlation table that owns the lifecycle of
 *        a pending tool call (pending / resolved / timed_out / cancelled).
 *
 * Design constraints from docs/18 §16:
 *   - Decision 1: at most one pending tool call per (agentId, sessionId).
 *     Emitting a second tool_request while one is pending is a protocol
 *     violation and surfaces as `engine_misconfigured` to the caller.
 *   - Decision 5: when a session is invalidated while a tool is pending,
 *     the caller is notified explicitly (this module exposes a hook that
 *     the chat route uses to emit pencil.session_lost before closing).
 */

import { logger } from '../util/logger.js';
import type { ToolCallResponse } from './adapter.js';

/**
 * Lifecycle state of a pending tool call.
 */
export type ToolCallState =
  | 'pending'
  | 'resolved'
  | 'timed_out'
  | 'cancelled'
  | 'invalidated';

/**
 * Internal entry in the correlation table.
 */
export interface ToolCallEntry {
  toolCallId: string;
  sessionId: string;
  agentId: string;
  /** API Key string of the streaming caller. */
  apiKey: string;
  /** Tool name; used only for diagnostics. */
  name: string;
  state: ToolCallState;
  createdAt: number;
  /** Resolves the awaiting engine loop when caller POSTs tool_response. */
  resolve: (response: ToolCallResponse) => void;
  /** Reject if Gateway can't deliver (timeout, cancel, eviction). */
  reject: (error: Error) => void;
  /** Pending timeout handle so we can clear on resolve. */
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

/**
 * Snapshot returned to callers; intentionally hides resolve/reject.
 */
export interface ToolCallSnapshot {
  toolCallId: string;
  sessionId: string;
  agentId: string;
  name: string;
  state: ToolCallState;
  createdAt: number;
}

function toSnapshot(entry: ToolCallEntry): ToolCallSnapshot {
  return {
    toolCallId: entry.toolCallId,
    sessionId: entry.sessionId,
    agentId: entry.agentId,
    name: entry.name,
    state: entry.state,
    createdAt: entry.createdAt,
  };
}

/**
 * Tool correlation table — in-memory per-process.
 *
 * Restart aborts in-flight turns; persistence is intentionally out of scope
 * for v0.2 first cut (docs/18 §15 "Out of M-tools-1/2/3").
 */
export class ToolCorrelation {
  private byId = new Map<string, ToolCallEntry>();
  /** Index for §16 decision 1: at most one pending per (agentId, sessionId). */
  private pendingBySession = new Map<string, string>();

  private sessionKey(agentId: string, sessionId: string): string {
    return `${agentId}::${sessionId}`;
  }

  /**
   * Register a fresh tool call and await the caller's response.
   *
   * Returns a Promise the engine loop awaits. The promise resolves with the
   * caller's ToolCallResponse, or rejects if Gateway delivers a timeout /
   * cancellation / eviction signal.
   *
   * Throws synchronously when the (agentId, sessionId) already has a pending
   * tool call — this is decision 1: serialized only.
   */
  register(params: {
    toolCallId: string;
    sessionId: string;
    agentId: string;
    apiKey: string;
    name: string;
    timeoutMs: number;
  }): Promise<ToolCallResponse> {
    const { toolCallId, sessionId, agentId, apiKey, name, timeoutMs } = params;
    const sKey = this.sessionKey(agentId, sessionId);

    if (this.pendingBySession.has(sKey)) {
      throw new Error(
        `serialized_violation: session ${sKey} already has a pending tool call ` +
          `(${this.pendingBySession.get(sKey)}); engine emitted ${toolCallId}`,
      );
    }
    if (this.byId.has(toolCallId)) {
      throw new Error(`duplicate_tool_call_id: ${toolCallId}`);
    }

    return new Promise<ToolCallResponse>((resolve, reject) => {
      const entry: ToolCallEntry = {
        toolCallId,
        sessionId,
        agentId,
        apiKey,
        name,
        state: 'pending',
        createdAt: Date.now(),
        resolve,
        reject,
      };
      entry.timeoutHandle = setTimeout(() => {
        this.timeOut(toolCallId);
      }, timeoutMs);
      this.byId.set(toolCallId, entry);
      this.pendingBySession.set(sKey, toolCallId);
      logger.debug('tool_call registered', { toolCallId, agentId, sessionId, timeoutMs });
    });
  }

  /**
   * Look up an entry without state-machine side effects.
   */
  lookup(toolCallId: string): ToolCallSnapshot | null {
    const entry = this.byId.get(toolCallId);
    return entry ? toSnapshot(entry) : null;
  }

  /**
   * Look up the underlying entry (for owners who need apiKey/sessionId check).
   * Returns a shallow projection so callers can validate ownership without
   * gaining the resolve/reject capability accidentally.
   */
  lookupFull(toolCallId: string): Pick<ToolCallEntry, 'toolCallId' | 'sessionId' | 'agentId' | 'apiKey' | 'name' | 'state' | 'createdAt'> | null {
    const entry = this.byId.get(toolCallId);
    if (!entry) return null;
    return {
      toolCallId: entry.toolCallId,
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      apiKey: entry.apiKey,
      name: entry.name,
      state: entry.state,
      createdAt: entry.createdAt,
    };
  }

  /**
   * Caller POSTed a response — resolve and unblock the engine loop.
   *
   * Returns one of:
   *   - 'ok'           — resolved this call cleanly
   *   - 'not_found'    — id unknown
   *   - 'already'      — id existed but state is no longer pending (409 hint)
   *   - 'invalidated'  — session died before this call (410 hint)
   */
  deliver(
    toolCallId: string,
    response: ToolCallResponse,
  ): 'ok' | 'not_found' | 'already' | 'invalidated' {
    const entry = this.byId.get(toolCallId);
    if (!entry) return 'not_found';
    if (entry.state === 'invalidated') return 'invalidated';
    if (entry.state !== 'pending') return 'already';

    entry.state = 'resolved';
    this.clearTimer(entry);
    this.pendingBySession.delete(this.sessionKey(entry.agentId, entry.sessionId));
    entry.resolve(response);
    logger.debug('tool_call delivered', { toolCallId, status: response.status });
    return 'ok';
  }

  /**
   * Timeout fired before the caller responded.
   */
  timeOut(toolCallId: string): void {
    const entry = this.byId.get(toolCallId);
    if (!entry || entry.state !== 'pending') return;
    entry.state = 'timed_out';
    this.clearTimer(entry);
    this.pendingBySession.delete(this.sessionKey(entry.agentId, entry.sessionId));
    entry.reject(new ToolTimeoutError(toolCallId));
    logger.info('tool_call timed_out', { toolCallId, agentId: entry.agentId, sessionId: entry.sessionId });
  }

  /**
   * Caller aborted the SSE stream — cancel pending tool, notify engine.
   */
  cancel(toolCallId: string): void {
    const entry = this.byId.get(toolCallId);
    if (!entry || entry.state !== 'pending') return;
    entry.state = 'cancelled';
    this.clearTimer(entry);
    this.pendingBySession.delete(this.sessionKey(entry.agentId, entry.sessionId));
    entry.resolve({ status: 'cancelled' });
    logger.debug('tool_call cancelled', { toolCallId });
  }

  /**
   * Session was evicted/lost. Pending tool reports invalidated.
   */
  invalidateSession(agentId: string, sessionId: string): ToolCallSnapshot | null {
    const sKey = this.sessionKey(agentId, sessionId);
    const id = this.pendingBySession.get(sKey);
    if (!id) return null;
    const entry = this.byId.get(id);
    if (!entry) return null;
    entry.state = 'invalidated';
    this.clearTimer(entry);
    this.pendingBySession.delete(sKey);
    entry.reject(new SessionLostError(sessionId));
    return toSnapshot(entry);
  }

  /**
   * Clear resolved/cancelled/timed_out/invalidated entries older than `maxAgeMs`.
   * Pending entries are never reaped — they live until terminal state.
   * Returns number of entries reaped. Intended to be called by tests or by a
   * future periodic janitor (out of M-tools-1 scope).
   */
  reap(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let n = 0;
    for (const [id, entry] of this.byId) {
      if (entry.state !== 'pending' && entry.createdAt < cutoff) {
        this.byId.delete(id);
        n += 1;
      }
    }
    return n;
  }

  /**
   * Returns number of currently pending tool calls. For tests / metrics.
   */
  pendingCount(): number {
    return this.pendingBySession.size;
  }

  /**
   * Test helper: clear all entries.
   */
  reset(): void {
    for (const entry of this.byId.values()) {
      this.clearTimer(entry);
    }
    this.byId.clear();
    this.pendingBySession.clear();
  }

  private clearTimer(entry: ToolCallEntry): void {
    if (entry.timeoutHandle !== undefined) {
      clearTimeout(entry.timeoutHandle);
      entry.timeoutHandle = undefined;
    }
  }
}

export class ToolTimeoutError extends Error {
  constructor(public toolCallId: string) {
    super(`tool_call ${toolCallId} timed out`);
    this.name = 'ToolTimeoutError';
  }
}

export class SessionLostError extends Error {
  constructor(public sessionId: string) {
    super(`session ${sessionId} was invalidated while a tool call was pending`);
    this.name = 'SessionLostError';
  }
}

let singleton: ToolCorrelation | null = null;

/**
 * Process-wide singleton. Reset between test cases via `getToolCorrelation().reset()`.
 */
export function getToolCorrelation(): ToolCorrelation {
  if (!singleton) {
    singleton = new ToolCorrelation();
  }
  return singleton;
}

/**
 * Test helper: swap the singleton (rarely needed; prefer `.reset()`).
 */
export function _setToolCorrelationForTests(instance: ToolCorrelation | null): void {
  singleton = instance;
}
