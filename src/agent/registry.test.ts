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

  it('should register a new agent', () => {
    const config = makeAgentConfig();
    const instance = registry.register(config);
    expect(instance.id).toBe('test-agent');
    expect(instance.modelId).toBe('pencil/test-agent');
  });

  it('should get agent by ID', () => {
    const config = makeAgentConfig();
    registry.register(config);
    const instance = registry.get('test-agent');
    expect(instance).toBeDefined();
    expect(instance?.modelId).toBe('pencil/test-agent');
  });

  it('should get agent by model ID', () => {
    const config = makeAgentConfig();
    registry.register(config);
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

  it('should list all agents', () => {
    registry.register(makeAgentConfig({ id: 'agent-a' }));
    registry.register(makeAgentConfig({ id: 'agent-b' }));
    const all = registry.getAll();
    expect(all).toHaveLength(2);
  });

  it('should return models in OpenAI format', () => {
    registry.register(makeAgentConfig({ id: 'agent-a' }));
    registry.register(makeAgentConfig({ id: 'agent-b' }));
    const models = registry.getModels();
    expect(models).toHaveLength(2);
    expect(models[0].object).toBe('model');
  });

  it('should check existence', () => {
    registry.register(makeAgentConfig());
    expect(registry.has('test-agent')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should check model ID existence', () => {
    registry.register(makeAgentConfig());
    expect(registry.hasModelId('pencil/test-agent')).toBe(true);
    expect(registry.hasModelId('pencil/nonexistent')).toBe(false);
  });

  it('should delete an agent', () => {
    registry.register(makeAgentConfig());
    const deleted = registry.delete('test-agent');
    expect(deleted).toBe(true);
    expect(registry.has('test-agent')).toBe(false);
  });

  it('should return false when deleting non-existent agent', () => {
    expect(registry.delete('nonexistent')).toBe(false);
  });

  it('should persist agent to file', () => {
    const config = makeAgentConfig();
    registry.register(config);
    const filePath = join(TEST_DATA_DIR, 'agents', 'test-agent.json');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    const saved = JSON.parse(content);
    expect(saved.id).toBe('test-agent');
  });

  it('should load agents from directory on startup', async () => {
    // Manually create a persisted agent file
    const agentsDir = join(TEST_DATA_DIR, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const config = makeAgentConfig();
    const filePath = join(agentsDir, 'test-agent.json');
    require('fs').writeFileSync(filePath, JSON.stringify(config, null, 2));

    // Create a new registry and load
    const newRegistry = new AgentRegistry(TEST_DATA_DIR);
    await newRegistry.load();
    expect(newRegistry.has('test-agent')).toBe(true);
  });

  it('should load agents from config', () => {
    const configs = [
      makeAgentConfig({ id: 'agent-x' }),
      makeAgentConfig({ id: 'agent-y' }),
    ];
    registry.loadFromConfig(configs);
    expect(registry.has('agent-x')).toBe(true);
    expect(registry.has('agent-y')).toBe(true);
    expect(registry.getAll()).toHaveLength(2);
  });

  it('should skip config entries without id', () => {
    registry.loadFromConfig([{ model: { provider: 'anthropic', name: 'claude' } } as AgentConfig]);
    expect(registry.getAll()).toHaveLength(0);
  });
});
