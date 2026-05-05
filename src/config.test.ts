/**
 * loadConfig() — issue 0012 dataDir + agentDir resolution
 *
 * [WHO]  Vitest test runner
 * [FROM] src/config.ts loadConfig()
 * [TO]   Pins the contract that dataDir defaults to ~/.pencils/gateway/ and
 *        agentDir defaults to ~/.pencils/<config.id>/ — without that
 *        invariant, multi-pencil isolation silently breaks. See 0012.
 * [HERE] src/config.test.ts — uses tmpdir + writeFileSync to feed loadConfig
 *        a real config file (it goes through fs.readFileSync internally).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from './config.js';

const tmpDirs: string[] = [];

function makeTmpConfig(json: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pgw-cfg-'));
  tmpDirs.push(dir);
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(json), 'utf-8');
  return path;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.NANOPENCIL_CODING_AGENT_DIR;
});

const baseGateway = {
  gateway: {
    host: '127.0.0.1',
    port: 8080,
    logLevel: 'info',
    corsOrigins: '*',
    requestTimeoutMs: 30000,
  },
  apiKeys: [{ key: 'pk_test', label: 't', allowedAgents: '*' }],
};

describe('loadConfig — dataDir resolution (issue 0012)', () => {
  it('defaults dataDir to ~/.pencils/gateway when unset', () => {
    const path = makeTmpConfig({ ...baseGateway, agents: [] });
    const cfg = loadConfig(path);
    expect(cfg.dataDir).toBe(resolve(homedir(), '.pencils', 'gateway'));
  });

  it('expands ~ prefix in explicit dataDir', () => {
    const path = makeTmpConfig({ ...baseGateway, dataDir: '~/custom-data', agents: [] });
    const cfg = loadConfig(path);
    expect(cfg.dataDir).toBe(resolve(homedir(), 'custom-data'));
  });

  it('resolves relative dataDir against the config file directory, not cwd', () => {
    // The whole point of this test: launching with `cd /` should not write
    // the registry into `/data`. It should land next to the config file.
    const path = makeTmpConfig({ ...baseGateway, dataDir: './data', agents: [] });
    const cfg = loadConfig(path);
    expect(cfg.dataDir.startsWith(tmpdir())).toBe(true);
    expect(cfg.dataDir.endsWith('data')).toBe(true);
  });

  it('keeps absolute dataDir unchanged', () => {
    const abs = resolve(tmpdir(), 'absolute-data');
    const path = makeTmpConfig({ ...baseGateway, dataDir: abs, agents: [] });
    const cfg = loadConfig(path);
    expect(cfg.dataDir).toBe(abs);
  });
});

describe('loadConfig — per-agent agentDir defaults (issue 0012)', () => {
  it('defaults each agent to ~/.pencils/<id>/', () => {
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [
        { id: 'pencil-01', name: 'Pencil One' },
        { id: 'pencil-02', name: 'Pencil Two' },
      ],
    });
    const cfg = loadConfig(path);
    expect(cfg.agents[0].agentDir).toBe(resolve(homedir(), '.pencils', 'pencil-01'));
    expect(cfg.agents[1].agentDir).toBe(resolve(homedir(), '.pencils', 'pencil-02'));
  });

  it('honours explicit agentDir with ~ expansion', () => {
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p', agentDir: '~/custom/agent' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.agents[0].agentDir).toBe(resolve(homedir(), 'custom/agent'));
  });

  it('uses NANOPENCIL_CODING_AGENT_DIR as fallback when agentDir is unset', () => {
    process.env.NANOPENCIL_CODING_AGENT_DIR = '~/from-env';
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.agents[0].agentDir).toBe(resolve(homedir(), 'from-env'));
  });

  it('explicit agentDir wins over NANOPENCIL_CODING_AGENT_DIR', () => {
    process.env.NANOPENCIL_CODING_AGENT_DIR = '~/from-env';
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p', agentDir: '~/explicit' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.agents[0].agentDir).toBe(resolve(homedir(), 'explicit'));
  });
});
