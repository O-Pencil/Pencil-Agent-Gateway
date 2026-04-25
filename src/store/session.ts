/**
 * Pencil Agent Gateway Session Store
 *
 * [WHO]  Gateway server
 * [FROM] Chat completion routes
 * [TO]  File system
 * [HERE] Short-term memory management for agent conversations
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ChatMessage } from '../protocol/types.js';
import { logger } from '../util/logger.js';
import { InvalidRequestError } from '../util/errors.js';

/**
 * Validate an ID used as a filesystem path component.
 * Only allows [a-zA-Z0-9_-]. Rejects /, \, ., .., NUL.
 * Throws InvalidRequestError(400) on invalid input.
 */
export function validateSafeId(id: string, fieldName: string): void {
  if (!id || id.length === 0) {
    throw new InvalidRequestError(`${fieldName} must not be empty`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new InvalidRequestError(
      `${fieldName} contains invalid characters. Only [a-zA-Z0-9_-] are allowed. Got: "${id}"`
    );
  }
}

/**
 * Session record - stores conversation history
 */
export interface SessionRecord {
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Session options
 */
export interface SessionOptions {
  maxTurns: number;
}

/**
 * Session store for managing conversation history
 */
export class SessionStore {
  private dataDir: string;
  private sessions = new Map<string, SessionRecord>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    const sessionsDir = join(dataDir, 'sessions');
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
  }

  /**
   * Get or create a session
   */
  getOrCreate(agentId: string, sessionId: string, _options: SessionOptions): SessionRecord {
    validateSafeId(agentId, 'agentId');
    validateSafeId(sessionId, 'sessionId');

    const key = this.getSessionKey(agentId, sessionId);

    let record = this.sessions.get(key);

    if (!record) {
      // Try to load from file
      const loaded = this.loadFromFile(agentId, sessionId);
      if (loaded) {
        record = loaded;
      }
    }

    if (!record) {
      // Create new session
      record = {
        agentId,
        sessionId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sessions.set(key, record);
    }

    return record;
  }

  /**
   * Add a message to a session
   */
  addMessage(agentId: string, sessionId: string, message: ChatMessage, options: SessionOptions): void {
    const record = this.getOrCreate(agentId, sessionId, options);
    record.messages.push(message);
    record.updatedAt = Date.now();

    // Trim to max turns
    this.trimMessages(record, options.maxTurns);

    // Persist to file
    this.saveToFile(record);
  }

  /**
   * Trim messages to max turns
   */
  private trimMessages(record: SessionRecord, maxTurns: number): void {
    // Count turns (user message + assistant response = 1 turn)
    let turnCount = 0;
    let trimIndex = 0;

    for (let i = record.messages.length - 1; i >= 0; i--) {
      if (record.messages[i].role === 'user') {
        turnCount++;
        if (turnCount > maxTurns) {
          trimIndex = i + 1;
          break;
        }
      }
    }

    if (trimIndex > 0) {
      record.messages = record.messages.slice(trimIndex);
      logger.debug('Session messages trimmed', {
        agentId: record.agentId,
        sessionId: record.sessionId,
        trimmed: trimIndex,
        remaining: record.messages.length,
      });
    }
  }

  /**
   * Get session key
   */
  private getSessionKey(agentId: string, sessionId: string): string {
    return `${agentId}:${sessionId}`;
  }

  /**
   * Get session file path, with containment check.
   */
  private getSessionFilePath(agentId: string, sessionId: string): string {
    const agentDir = join(this.dataDir, 'sessions', agentId);
    const filePath = join(agentDir, `${sessionId}.json`);
    // Verify resolved path is within dataDir
    const resolved = resolve(filePath);
    const resolvedDataDir = resolve(this.dataDir);
    if (!resolved.startsWith(resolvedDataDir)) {
      throw new InvalidRequestError(
        `Session path escapes data directory: ${filePath}`
      );
    }
    return filePath;
  }

  /**
   * Save session to file
   */
  private saveToFile(record: SessionRecord): void {
    const filePath = this.getSessionFilePath(record.agentId, record.sessionId);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to save session to file', {
        agentId: record.agentId,
        sessionId: record.sessionId,
        error: err,
      });
    }
  }

  /**
   * Load session from file
   */
  private loadFromFile(agentId: string, sessionId: string): SessionRecord | null {
    const filePath = this.getSessionFilePath(agentId, sessionId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const record = JSON.parse(content) as SessionRecord;
      const key = this.getSessionKey(agentId, sessionId);
      this.sessions.set(key, record);
      return record;
    } catch (err) {
      logger.warn('Failed to load session from file', {
        agentId,
        sessionId,
        error: err,
      });
      return null;
    }
  }

  /**
   * Clear a session
   */
  clear(agentId: string, sessionId: string): void {
    const key = this.getSessionKey(agentId, sessionId);
    this.sessions.delete(key);
  }

  /**
   * Get all sessions for an agent
   */
  getAgentSessions(agentId: string): SessionRecord[] {
    const result: SessionRecord[] = [];
    for (const record of this.sessions.values()) {
      if (record.agentId === agentId) {
        result.push(record);
      }
    }
    return result;
  }
}

// Global session store instance
let sessionStore: SessionStore | null = null;

/**
 * Get or create the global session store
 */
export function getSessionStore(): SessionStore {
  if (!sessionStore) {
    throw new Error('Session store not initialized. Call initSessionStore() first.');
  }
  return sessionStore;
}

/**
 * Initialize the session store with data directory
 */
export function initSessionStore(dataDir: string): SessionStore {
  sessionStore = new SessionStore(dataDir);
  return sessionStore;
}
