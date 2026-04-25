/**
 * Route Integration Tests
 *
 * [WHO]  Test suite for HTTP routes
 * [FROM] Hono app, routes, auth middleware, registry
 * [TO]  Vitest test runner
 * [HERE] src/routes/routes.test.ts — verifies agents CRUD, models, auth boundaries
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../app.js';
import { setConfig, loadConfig } from '../config.js';
import { initRegistry } from '../agent/registry.js';
import { initSessionStore } from '../store/session.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DATA_DIR = join(process.cwd(), '.grub-test-data-routes');

function cleanTestDataDir() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function setupTestApp() {
  cleanTestDataDir();

  const config = {
    gateway: {
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'error',
      corsOrigins: '*',
      requestTimeoutMs: 120000,
    },
    apiKeys: [
      { key: 'pk_full', label: 'full-access', allowedAgents: '*' as const },
      { key: 'pk_limited', label: 'limited-access', allowedAgents: ['writer'] as string[] },
    ],
    dataDir: TEST_DATA_DIR,
    agents: [],
  };

  setConfig(config);
  initRegistry(TEST_DATA_DIR);
  initSessionStore(TEST_DATA_DIR);

  return createApp();
}

async function makeRequest(app: any, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  const init: RequestInit = {
    method,
    headers: reqHeaders,
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  const req = new Request(`http://localhost${path}`, init);
  return app.fetch(req);
}

describe('Health endpoints', () => {
  it('should return 200 for /healthz without auth', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'GET', '/healthz');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });

  it('should return 200 for /readyz without auth', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'GET', '/readyz');
    expect(res.status).toBe(200);
  });
});

describe('Authentication', () => {
  it('should reject requests without API key', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'GET', '/v1/models');
    expect(res.status).toBe(401);
  });

  it('should reject requests with invalid API key', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'GET', '/v1/models', undefined, {
      Authorization: 'Bearer invalid-key',
    });
    expect(res.status).toBe(401);
  });

  it('should accept requests with valid API key', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'GET', '/v1/models', undefined, {
      Authorization: 'Bearer pk_full',
    });
    expect(res.status).toBe(200);
  });
});

describe('Agents CRUD', () => {
  it('should create an agent via POST /v1/agents', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'POST', '/v1/agents', {
      id: 'writer',
      name: 'Writer',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
    }, {
      Authorization: 'Bearer pk_full',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('writer');
    expect(json.modelId).toBe('pencil/writer');
    expect(json.status).toBe('ready');
  });

  it('should list agents via GET /v1/agents', async () => {
    const app = setupTestApp();
    // Create first
    await makeRequest(app, 'POST', '/v1/agents', {
      id: 'writer',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
    }, { Authorization: 'Bearer pk_full' });

    const res = await makeRequest(app, 'GET', '/v1/agents', undefined, {
      Authorization: 'Bearer pk_full',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThanOrEqual(1);
  });

  it('should delete an agent via DELETE /v1/agents/:id', async () => {
    const app = setupTestApp();
    // Create first
    await makeRequest(app, 'POST', '/v1/agents', {
      id: 'to-delete',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
    }, { Authorization: 'Bearer pk_full' });

    const res = await makeRequest(app, 'DELETE', '/v1/agents/to-delete', undefined, {
      Authorization: 'Bearer pk_full',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
  });

  it('should return 404 when deleting non-existent agent', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'DELETE', '/v1/agents/nonexistent', undefined, {
      Authorization: 'Bearer pk_full',
    });
    expect(res.status).toBe(404);
  });

  it('should reject agent creation without id', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'POST', '/v1/agents', {
      name: 'No ID Agent',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
    }, { Authorization: 'Bearer pk_full' });
    expect(res.status).toBe(400);
  });
});

describe('Models endpoint', () => {
  it('should return model list in OpenAI format', async () => {
    const app = setupTestApp();
    // Create an agent
    await makeRequest(app, 'POST', '/v1/agents', {
      id: 'model-test',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-6' },
    }, { Authorization: 'Bearer pk_full' });

    const res = await makeRequest(app, 'GET', '/v1/models', undefined, {
      Authorization: 'Bearer pk_full',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe('list');
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(1);
    expect(json.data[0].object).toBe('model');
  });
});

describe('Chat endpoint validation', () => {
  it('should reject chat request without model', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
    }, { Authorization: 'Bearer pk_full' });
    expect(res.status).toBe(422);
  });

  it('should reject chat request with empty messages', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'POST', '/v1/chat/completions', {
      model: 'pencil/test',
      messages: [],
    }, { Authorization: 'Bearer pk_full' });
    expect(res.status).toBe(422);
  });

  it('should reject n != 1', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'POST', '/v1/chat/completions', {
      model: 'pencil/test',
      messages: [{ role: 'user', content: 'Hello' }],
      n: 2,
    }, { Authorization: 'Bearer pk_full' });
    expect(res.status).toBe(422);
  });

  it('should reject JSON mode response_format', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'POST', '/v1/chat/completions', {
      model: 'pencil/test',
      messages: [{ role: 'user', content: 'Hello' }],
      response_format: { type: 'json_object' },
    }, { Authorization: 'Bearer pk_full' });
    expect(res.status).toBe(422);
  });

  it('should reject chat request for non-existent agent', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'POST', '/v1/chat/completions', {
      model: 'pencil/nonexistent',
      messages: [{ role: 'user', content: 'Hello' }],
    }, { Authorization: 'Bearer pk_full' });
    expect(res.status).toBe(404);
  });
});

describe('CORS', () => {
  it('should include CORS headers on responses', async () => {
    const app = setupTestApp();
    const res = await makeRequest(app, 'GET', '/healthz');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeDefined();
  });
});
