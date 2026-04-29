/**
 * Agent Registry Unit Tests
 *
 * [WHO]  Test suite for agent registry
 * [FROM] AgentRegistry, AgentInstance classes
 * [TO]  Vitest test runner
 * [HERE] src/agent/registry.test.ts — verifies registration, lookup, deletion, persistence, models
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRegistry, initRegistry, AgentInstance } from './registry.js';
import type { AgentConfig } from '../config.js';

const TEST_DATA_DIR = join(process.cwd(), '.grub-test-data');

function cleanTestDataDir() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
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

describe('AgentInstance', () => {
  it('should create instance with correct modelId', () => {
    const config = makeAgentConfig();
    const instance = new AgentInstance(config);
    expect(instance.id).toBe('test-agent');
    expect(instance.modelId).toBe('pencil/test-agent');
  });

  it('should have engine bound by default', () => {
    const config = makeAgentConfig();
    const instance = new AgentInstance(config);
    expect(instance.engine).toBeDefined();
    expect(instance.engine.id).toBe('nano-pencil');
  });

  it('should convert to OpenAI model format', () => {
    const config = makeAgentConfig();
    const instance = new AgentInstance(config);
    const model = instance.toModel();
    expect(model.id).toBe('pencil/test-agent');
    expect(model.object).toBe('model');
    expect(model.owned_by).toBe('pencil-agent-gateway');
  });

  it('should convert to response format without sensitive data', () => {
    const config = makeAgentConfig({
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6', apiKey: 'secret-key' },
    });
    const instance = new AgentInstance(config);
    const response = instance.toResponse();
    expect(response.id).toBe('test-agent');
    expect(response.modelId).toBe('pencil/test-agent');
    expect(response.name).toBe('Test Agent');
    // apiKey should not appear in response
    expect(JSON.stringify(response)).not.toContain('secret-key');
  });
});

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    cleanTestDataDir();
    registry = new AgentRegistry(TEST_DATA_DIR);
  });

  afterEach(() => {
    cleanTestDataDir();
  });

  it('should register a new agent', async () => {
    const config = makeAgentConfig();
    const instance = await registry.register(config);
    expect(instance.id).toBe('test-agent');
    expect(instance.modelId).toBe('pencil/test-agent');
  });

  it('should get agent by ID', async () => {
    const config = makeAgentConfig();
    await registry.register(config);
    const instance = registry.get('test-agent');
    expect(instance).toBeDefined();
    expect(instance?.modelId).toBe('pencil/test-agent');
  });

  it('should get agent by model ID', async () => {
    const config = makeAgentConfig();
    await registry.register(config);
    const instance = registry.getByModelId('pencil/test-agent');
    expect(instance).toBeDefined();
    expect(instance?.id).toBe('test-agent');
  });

  it('should return undefined for non-existent model ID', () => {
    expect(registry.getByModelId('pencil/nonexistent')).toBeUndefined();
  });

  it('should return undefined for non-pencil model prefix', () => {
    expect(registry.getByModelId('openai/gpt-4')).toBeUndefined();
  });

  it('should list all agents', async () => {
    await registry.register(makeAgentConfig({ id: 'agent-a' }));
    await registry.register(makeAgentConfig({ id: 'agent-b' }));
    const all = registry.getAll();
    expect(all).toHaveLength(2);
  });

  it('should return models in OpenAI format', async () => {
    await registry.register(makeAgentConfig({ id: 'agent-a' }));
    await registry.register(makeAgentConfig({ id: 'agent-b' }));
    const models = registry.getModels();
    expect(models).toHaveLength(2);
    expect(models[0].object).toBe('model');
  });

  it('should check existence', async () => {
    await registry.register(makeAgentConfig());
    expect(registry.has('test-agent')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should check model ID existence', async () => {
    await registry.register(makeAgentConfig());
    expect(registry.hasModelId('pencil/test-agent')).toBe(true);
    expect(registry.hasModelId('pencil/nonexistent')).toBe(false);
  });

  it('should delete an agent', async () => {
    await registry.register(makeAgentConfig());
    const deleted = await registry.delete('test-agent');
    expect(deleted).toBe(true);
    expect(registry.has('test-agent')).toBe(false);
  });

  it('should return false when deleting non-existent agent', async () => {
    expect(await registry.delete('nonexistent')).toBe(false);
  });

  it('should persist agent to file', async () => {
    const config = makeAgentConfig();
    await registry.register(config);
    const filePath = join(TEST_DATA_DIR, 'agents', 'test-agent.json');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    const saved = JSON.parse(content);
    expect(saved.id).toBe('test-agent');
  });

  it('should load agents from directory on startup', async () => {
    const agentsDir = join(TEST_DATA_DIR, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const config = makeAgentConfig();
    const filePath = join(agentsDir, 'test-agent.json');
    require('fs').writeFileSync(filePath, JSON.stringify(config, null, 2));

    const newRegistry = new AgentRegistry(TEST_DATA_DIR);
    await newRegistry.load();
    expect(newRegistry.has('test-agent')).toBe(true);
  });

  it('should load agents from config', async () => {
    const configs = [
      makeAgentConfig({ id: 'agent-x' }),
      makeAgentConfig({ id: 'agent-y' }),
    ];
    await registry.loadFromConfig(configs);
    expect(registry.has('agent-x')).toBe(true);
    expect(registry.has('agent-y')).toBe(true);
    expect(registry.getAll()).toHaveLength(2);
  });

  it('should skip config entries without id', async () => {
    await registry.loadFromConfig([{ model: { provider: 'anthropic', name: 'claude' } } as AgentConfig]);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('should dispose old engine when registering same id twice (issue 0007)', async () => {
    const config = makeAgentConfig();
    const first = await registry.register(config);
    let disposed = false;
    (first as unknown as { engine: { dispose: () => Promise<void> } }).engine.dispose =
      async () => { disposed = true; };
    const second = await registry.register(config);
    expect(disposed).toBe(true);
    expect(second).not.toBe(first);
  });

  it('update() preserves engine instance (PUT semantics — no session loss)', async () => {
    const inst = await registry.register(
      makeAgentConfig({ soul: { systemPrompt: 'old prompt' } }),
    );
    const originalEngine = inst.engine;
    let disposed = false;
    (originalEngine as unknown as { dispose: () => Promise<void> }).dispose =
      async () => { disposed = true; };

    const updated = await registry.update('test-agent', {
      id: 'test-agent',
      name: 'Renamed',
      soul: { systemPrompt: 'new prompt' },
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
    });

    expect(updated).toBe(inst); // same wrapper
    expect(updated.engine).toBe(originalEngine); // same engine — point of update vs replace
    expect(disposed).toBe(false); // engine NOT disposed
    expect(updated.name).toBe('Renamed');
    expect(updated.config.soul?.systemPrompt).toBe('new prompt');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
  });

  it('update() calls engine.reconfigure when supported', async () => {
    const inst = await registry.register(makeAgentConfig());
    let reconfigured = false;
    let receivedConfig: AgentConfig | null = null;
    (inst.engine as { reconfigure?: (c: AgentConfig) => void }).reconfigure = (c) => {
      reconfigured = true;
      receivedConfig = c;
    };
    await registry.update('test-agent', {
      id: 'test-agent',
      soul: { systemPrompt: 'updated' },
    });
    expect(reconfigured).toBe(true);
    expect(receivedConfig?.soul?.systemPrompt).toBe('updated');
  });

  it('update() throws when agent does not exist', async () => {
    await expect(
      registry.update('nope', makeAgentConfig({ id: 'nope' })),
    ).rejects.toThrow(/not found/);
  });

  it('update() rejects body with mismatched id', async () => {
    await registry.register(makeAgentConfig({ id: 'a' }));
    await expect(
      registry.update('a', makeAgentConfig({ id: 'b' })),
    ).rejects.toThrow(/immutable/);
  });

  it('update() persists the new config to disk', async () => {
    await registry.register(makeAgentConfig());
    await registry.update('test-agent', {
      id: 'test-agent',
      soul: { systemPrompt: 'persisted' },
    });
    const filePath = join(TEST_DATA_DIR, 'agents', 'test-agent.json');
    const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(saved.soul.systemPrompt).toBe('persisted');
  });

  it('should disposeAll engines on shutdown (issue 0008)', async () => {
    await registry.register(makeAgentConfig({ id: 'agent-a' }));
    await registry.register(makeAgentConfig({ id: 'agent-b' }));
    let disposeCount = 0;
    for (const inst of registry.getAll()) {
      (inst as unknown as { engine: { dispose: () => Promise<void> } }).engine.dispose =
        async () => { disposeCount++; };
    }
    await registry.disposeAll();
    expect(disposeCount).toBe(2);
    expect(registry.getAll()).toHaveLength(0);
  });
});
