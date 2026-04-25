/**
 * Session Store Unit Tests
 *
 * [WHO]  Test suite for session store
 * [FROM] SessionStore class, session management logic
 * [TO]  Vitest test runner
 * [HERE] src/store/session.test.ts — verifies session CRUD, isolation, trimming, persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore, initSessionStore, validateSafeId } from './session.js';
import type { ChatMessage } from '../protocol/types.js';

const TEST_DATA_DIR = join(process.cwd(), '.grub-test-data');

function cleanTestDataDir() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

describe('validateSafeId', () => {
  it('should accept valid IDs', () => {
    expect(() => validateSafeId('writing-assistant', 'agentId')).not.toThrow();
    expect(() => validateSafeId('test_session_01', 'sessionId')).not.toThrow();
    expect(() => validateSafeId('a1B2-c3D4', 'test')).not.toThrow();
  });

  it('should reject IDs with path traversal characters', () => {
    expect(() => validateSafeId('../etc/passwd', 'agentId')).toThrow();
    expect(() => validateSafeId('..', 'sessionId')).toThrow();
    expect(() => validateSafeId('foo/bar', 'agentId')).toThrow();
    expect(() => validateSafeId('foo\\bar', 'sessionId')).toThrow();
  });

  it('should reject IDs with dots', () => {
    expect(() => validateSafeId('config.json', 'agentId')).toThrow();
  });

  it('should reject empty IDs', () => {
    expect(() => validateSafeId('', 'agentId')).toThrow();
  });
});

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    cleanTestDataDir();
    store = new SessionStore(TEST_DATA_DIR);
  });

  afterEach(() => {
    cleanTestDataDir();
  });

  it('should create a new session', () => {
    const session = store.getOrCreate('agent-1', 'session-1', { maxTurns: 20 });
    expect(session.agentId).toBe('agent-1');
    expect(session.sessionId).toBe('session-1');
    expect(session.messages).toEqual([]);
  });

  it('should return existing session', () => {
    store.getOrCreate('agent-1', 'session-1', { maxTurns: 20 });
    const session = store.getOrCreate('agent-1', 'session-1', { maxTurns: 20 });
    expect(session.agentId).toBe('agent-1');
    expect(session.sessionId).toBe('session-1');
  });

  it('should add messages to session', () => {
    const msg: ChatMessage = { role: 'user', content: 'Hello' };
    store.addMessage('agent-1', 'session-1', msg, { maxTurns: 20 });

    const session = store.getOrCreate('agent-1', 'session-1', { maxTurns: 20 });
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toEqual(msg);
  });

  it('should isolate sessions by agentId', () => {
    const msgA: ChatMessage = { role: 'user', content: 'Hello from A' };
    const msgB: ChatMessage = { role: 'user', content: 'Hello from B' };

    store.addMessage('agent-A', 'session-1', msgA, { maxTurns: 20 });
    store.addMessage('agent-B', 'session-1', msgB, { maxTurns: 20 });

    const sessionA = store.getOrCreate('agent-A', 'session-1', { maxTurns: 20 });
    const sessionB = store.getOrCreate('agent-B', 'session-1', { maxTurns: 20 });

    expect(sessionA.messages).toHaveLength(1);
    expect(sessionA.messages[0].content).toBe('Hello from A');
    expect(sessionB.messages).toHaveLength(1);
    expect(sessionB.messages[0].content).toBe('Hello from B');
  });

  it('should isolate sessions by sessionId', () => {
    const msg1: ChatMessage = { role: 'user', content: 'Session 1' };
    const msg2: ChatMessage = { role: 'user', content: 'Session 2' };

    store.addMessage('agent-1', 'session-1', msg1, { maxTurns: 20 });
    store.addMessage('agent-1', 'session-2', msg2, { maxTurns: 20 });

    const s1 = store.getOrCreate('agent-1', 'session-1', { maxTurns: 20 });
    const s2 = store.getOrCreate('agent-1', 'session-2', { maxTurns: 20 });

    expect(s1.messages[0].content).toBe('Session 1');
    expect(s2.messages[0].content).toBe('Session 2');
  });

  it('should trim messages when exceeding maxTurns', () => {
    const msg1: ChatMessage = { role: 'user', content: 'Turn 1' };
    const reply1: ChatMessage = { role: 'assistant', content: 'Reply 1' };
    const msg2: ChatMessage = { role: 'user', content: 'Turn 2' };
    const reply2: ChatMessage = { role: 'assistant', content: 'Reply 2' };
    const msg3: ChatMessage = { role: 'user', content: 'Turn 3' };

    store.addMessage('agent-1', 'session-1', msg1, { maxTurns: 2 });
    store.addMessage('agent-1', 'session-1', reply1, { maxTurns: 2 });
    store.addMessage('agent-1', 'session-1', msg2, { maxTurns: 2 });
    store.addMessage('agent-1', 'session-1', reply2, { maxTurns: 2 });
    store.addMessage('agent-1', 'session-1', msg3, { maxTurns: 2 });

    const session = store.getOrCreate('agent-1', 'session-1', { maxTurns: 2 });
    // Should only retain the most recent 2 turns (msg2, reply2, msg3)
    const userMessages = session.messages.filter(m => m.role === 'user');
    expect(userMessages.length).toBeLessThanOrEqual(2);
    expect(session.messages.some(m => m.content === 'Turn 3')).toBe(true);
  });

  it('should persist session to file', () => {
    const msg: ChatMessage = { role: 'user', content: 'Persist me' };
    store.addMessage('agent-1', 'persist-session', msg, { maxTurns: 20 });

    const filePath = join(TEST_DATA_DIR, 'sessions', 'agent-1', 'persist-session.json');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    const saved = JSON.parse(content);
    expect(saved.messages).toHaveLength(1);
    expect(saved.messages[0].content).toBe('Persist me');
  });

  it('should load session from file on new store instance', () => {
    const msg: ChatMessage = { role: 'user', content: 'Load me' };
    store.addMessage('agent-1', 'load-session', msg, { maxTurns: 20 });

    // Create a new store instance (simulates restart)
    const newStore = new SessionStore(TEST_DATA_DIR);
    const session = newStore.getOrCreate('agent-1', 'load-session', { maxTurns: 20 });

    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe('Load me');
  });

  it('should throw InvalidRequestError for invalid agentId', () => {
    expect(() => store.getOrCreate('../etc', 'session-1', { maxTurns: 20 })).toThrow(
      'agentId contains invalid characters'
    );
  });

  it('should throw InvalidRequestError for invalid sessionId', () => {
    expect(() => store.getOrCreate('agent-1', 'foo/bar', { maxTurns: 20 })).toThrow(
      'sessionId contains invalid characters'
    );
  });
});
