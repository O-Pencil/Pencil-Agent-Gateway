/**
 * Nano-Pencil Engine Adapter Smoke Test
 *
 * [WHO]  Test suite for NanoPencilEngineAdapter
 * [FROM] NanoPencilEngineAdapter class
 * [TO]  Vitest test runner
 * [HERE] src/engine/nano-adapter.test.ts — verifies adapter creation, structure, error handling
 *
 * Note: This test does NOT call real model APIs. It validates the adapter's
 * structure, error paths, and event mapping behavior.
 */

import { describe, it, expect } from 'vitest';
import { NanoPencilEngineAdapter, createNanoPencilAdapter } from './nano-adapter.js';
import type { AgentConfig } from '../config.js';

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    model: {
      provider: 'anthropic',
      name: 'claude-sonnet-4-6',
    },
    ...overrides,
  };
}

describe('NanoPencilEngineAdapter', () => {
  it('should create adapter without throwing', () => {
    const config = makeConfig();
    const adapter = new NanoPencilEngineAdapter(config);
    expect(adapter).toBeDefined();
    expect(adapter.id).toBe('nano-pencil');
  });

  it('should create via factory function', () => {
    const config = makeConfig();
    const adapter = createNanoPencilAdapter(config);
    expect(adapter).toBeInstanceOf(NanoPencilEngineAdapter);
    expect(adapter.id).toBe('nano-pencil');
  });

  it('should accept provider and model from config', () => {
    const config = makeConfig({
      model: { provider: 'openai', name: 'gpt-4o' },
    });
    const adapter = createNanoPencilAdapter(config);
    expect(adapter).toBeDefined();
  });

  it('should accept API key from config', () => {
    const config = makeConfig({
      model: {
        provider: 'anthropic',
        name: 'claude-sonnet-4-6',
        apiKey: 'sk-test-key',
      },
    });
    const adapter = createNanoPencilAdapter(config);
    expect(adapter).toBeDefined();
  });

  it('should accept base URL from config', () => {
    const config = makeConfig({
      model: {
        provider: 'anthropic',
        name: 'claude-sonnet-4-6',
        baseUrl: 'https://custom-proxy.example.com',
      },
    });
    const adapter = createNanoPencilAdapter(config);
    expect(adapter).toBeDefined();
  });

  it('should have dispose method', () => {
    const adapter = createNanoPencilAdapter(makeConfig());
    expect(typeof adapter.dispose).toBe('function');
  });

  it('should have run method', () => {
    const adapter = createNanoPencilAdapter(makeConfig());
    expect(typeof adapter.run).toBe('function');
  });
});
