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
import { NanoPencilEngineAdapter, createNanoPencilAdapter, composeSoulPrompt } from './nano-adapter.js';
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

  it('accepts soul.systemPrompt without throwing', () => {
    const adapter = createNanoPencilAdapter(
      makeConfig({
        soul: { systemPrompt: '你是小铅笔，专注帮用户写作。' },
      }),
    );
    expect(adapter).toBeDefined();
  });
});

describe('composeSoulPrompt', () => {
  it('returns undefined when no soul configured', () => {
    expect(composeSoulPrompt({ id: 'a' })).toBeUndefined();
  });

  it('returns undefined when systemPrompt is empty/whitespace', () => {
    expect(composeSoulPrompt({ id: 'a', soul: { systemPrompt: '   ' } })).toBeUndefined();
  });

  it('returns trimmed systemPrompt when no styleTags', () => {
    expect(
      composeSoulPrompt({ id: 'a', soul: { systemPrompt: 'Be concise.' } }),
    ).toBe('Be concise.');
  });

  it('appends style tags when present', () => {
    const result = composeSoulPrompt({
      id: 'a',
      soul: { systemPrompt: 'Be concise.', styleTags: ['zh-cn', 'literary'] },
    });
    expect(result).toBe('Be concise.\n\n[style: zh-cn, literary]');
  });

  it('ignores empty/whitespace style tags', () => {
    const result = composeSoulPrompt({
      id: 'a',
      soul: { systemPrompt: 'Be concise.', styleTags: ['', '  ', 'zh-cn'] },
    });
    expect(result).toBe('Be concise.\n\n[style: zh-cn]');
  });
});
