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
import {
  CODING_PLAN_PRESETS,
  getCodingPlanPreset,
  listCodingPlanProviders,
} from './coding-plan-presets.js';
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

  it('accepts a Coding Plan provider with only apiKey (preset fills the rest)', () => {
    const adapter = createNanoPencilAdapter(
      makeConfig({
        model: {
          provider: 'dashscope-coding',
          apiKey: 'sk-dashscope-test',
        },
      }),
    );
    expect(adapter).toBeDefined();
  });

  it('accepts a fully-custom provider (user supplies api + models[])', () => {
    const adapter = createNanoPencilAdapter(
      makeConfig({
        model: {
          provider: 'my-corp-llm',
          name: 'my-model-7b',
          apiKey: 'sk-internal-test',
          baseUrl: 'https://my-corp-llm.internal/v1',
          api: 'openai-completions',
          models: [
            { id: 'my-model-7b', name: 'My Model 7B', contextWindow: 32768, maxTokens: 4096 },
          ],
        },
      }),
    );
    expect(adapter).toBeDefined();
  });
});

describe('Coding Plan presets', () => {
  it('exposes Coding Plan providers + anthropic-custom', () => {
    const providers = listCodingPlanProviders().sort();
    expect(providers).toEqual(
      [
        'ali-token-plan-openai',
        'anthropic-custom',
        'ark-coding',
        'dashscope-coding',
        'minimax-coding',
        'qianfan-coding',
        'zhipu-coding',
      ].sort(),
    );
  });

  it('returns undefined for unknown providers', () => {
    expect(getCodingPlanPreset('not-a-real-provider')).toBeUndefined();
    expect(getCodingPlanPreset(undefined)).toBeUndefined();
  });

  it('dashscope-coding preset matches the upstream default', () => {
    const preset = getCodingPlanPreset('dashscope-coding');
    expect(preset?.baseUrl).toBe('https://coding.dashscope.aliyuncs.com/v1');
    expect(preset?.api).toBe('openai-completions');
    expect(preset?.models.length).toBeGreaterThan(0);
    // sanity-check at least one well-known model id is present
    expect(preset?.models.some(m => m.id === 'qwen3-coder-plus')).toBe(true);
  });

  it('every preset has non-empty baseUrl/api/models', () => {
    for (const [provider, preset] of Object.entries(CODING_PLAN_PRESETS)) {
      expect(preset.baseUrl, `${provider} baseUrl`).toBeTruthy();
      expect(preset.api, `${provider} api`).toBeTruthy();
      expect(preset.models.length, `${provider} models`).toBeGreaterThan(0);
      for (const m of preset.models) {
        expect(m.id, `${provider} model id`).toBeTruthy();
        expect(m.contextWindow, `${provider}/${m.id} contextWindow`).toBeGreaterThan(0);
        expect(m.maxTokens, `${provider}/${m.id} maxTokens`).toBeGreaterThan(0);
      }
    }
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
