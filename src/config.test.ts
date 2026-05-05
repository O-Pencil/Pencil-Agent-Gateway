/**
 * loadConfig() — issue 0012 + doc 16 Step A path resolution contract
 *
 * [WHO]  Vitest test runner
 * [FROM] src/config.ts loadConfig()
 * [TO]   Pins the contract that:
 *          - `dataDir` defaults to $PENCILS_GATEWAY_DIR (~/.pencils/gateway/)
 *          - `agentDir` defaults to $PENCILS_AGENTS_DIR/<id> (~/.pencils/agents/<id>/)
 *          - PENCILS_HOME / PENCILS_AGENTS_DIR / PENCILS_GATEWAY_DIR override
 *          - NANOPENCIL_HOME is an alias for PENCILS_HOME
 *          - legacy ~/.pencils/<id>/ data falls back without auto-migration
 *        Without these invariants, multi-pencil isolation silently breaks
 *        and post-issue-0012 users would orphan their data on Step A upgrade.
 * [HERE] src/config.test.ts — uses tmpdir + writeFileSync to feed loadConfig
 *        a real config file (it goes through fs.readFileSync internally).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function makeTmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pgw-home-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.NANOPENCIL_CODING_AGENT_DIR;
  delete process.env.PENCILS_HOME;
  delete process.env.NANOPENCIL_HOME;
  delete process.env.PENCILS_AGENTS_DIR;
  delete process.env.PENCILS_GATEWAY_DIR;
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

describe('loadConfig — per-agent agentDir defaults (Step A)', () => {
  it('defaults each agent to $PENCILS_HOME/agents/<id>/', () => {
    const home = makeTmpHome();
    process.env.PENCILS_HOME = home;
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [
        { id: 'pencil-01', name: 'Pencil One' },
        { id: 'pencil-02', name: 'Pencil Two' },
      ],
    });
    const cfg = loadConfig(path);
    expect(cfg.agents[0].agentDir).toBe(join(home, 'agents', 'pencil-01'));
    expect(cfg.agents[1].agentDir).toBe(join(home, 'agents', 'pencil-02'));
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

describe('loadConfig — Step A env hierarchy', () => {
  it('PENCILS_HOME shifts both dataDir and agents/<id>/', () => {
    const home = makeTmpHome();
    process.env.PENCILS_HOME = home;
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.dataDir).toBe(join(home, 'gateway'));
    expect(cfg.agents[0].agentDir).toBe(join(home, 'agents', 'p'));
  });

  it('NANOPENCIL_HOME is honoured as alias for PENCILS_HOME', () => {
    const home = makeTmpHome();
    process.env.NANOPENCIL_HOME = home;
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.dataDir).toBe(join(home, 'gateway'));
    expect(cfg.agents[0].agentDir).toBe(join(home, 'agents', 'p'));
  });

  it('PENCILS_AGENTS_DIR overrides the agents/ subtree independently', () => {
    const home = makeTmpHome();
    const agentsDir = makeTmpHome();
    process.env.PENCILS_HOME = home;
    process.env.PENCILS_AGENTS_DIR = agentsDir;
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p' }],
    });
    const cfg = loadConfig(path);
    // dataDir derives from PENCILS_HOME (gateway/), agentDir from PENCILS_AGENTS_DIR
    expect(cfg.dataDir).toBe(join(home, 'gateway'));
    expect(cfg.agents[0].agentDir).toBe(join(agentsDir, 'p'));
  });

  it('PENCILS_GATEWAY_DIR overrides dataDir default while leaving agents/ on home', () => {
    const home = makeTmpHome();
    const gwDir = makeTmpHome();
    process.env.PENCILS_HOME = home;
    process.env.PENCILS_GATEWAY_DIR = gwDir;
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.dataDir).toBe(gwDir);
    expect(cfg.agents[0].agentDir).toBe(join(home, 'agents', 'p'));
  });

  it('explicit dataDir in config still wins over PENCILS_GATEWAY_DIR', () => {
    const home = makeTmpHome();
    process.env.PENCILS_HOME = home;
    process.env.PENCILS_GATEWAY_DIR = '/should/be/ignored';
    const path = makeTmpConfig({
      ...baseGateway,
      dataDir: '~/custom-gw',
      agents: [],
    });
    const cfg = loadConfig(path);
    expect(cfg.dataDir).toBe(resolve(homedir(), 'custom-gw'));
  });
});

describe('loadConfig — Step A legacy fallback', () => {
  it('falls back to ~/.pencils/<id>/ when it has real data and new path is missing', () => {
    const home = makeTmpHome();
    process.env.PENCILS_HOME = home;
    // Simulate a pre-Step-A install with auth.json under the bare-id path.
    mkdirSync(join(home, 'legacy-pencil'), { recursive: true });
    writeFileSync(join(home, 'legacy-pencil', 'auth.json'), '{}', 'utf-8');

    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'legacy-pencil', name: 'Legacy' }],
    });
    const cfg = loadConfig(path);
    // Resolved to the legacy location, not the new agents/ subtree.
    expect(cfg.agents[0].agentDir).toBe(join(home, 'legacy-pencil'));
  });

  it('does NOT fall back when the legacy folder is empty', () => {
    const home = makeTmpHome();
    process.env.PENCILS_HOME = home;
    mkdirSync(join(home, 'p'), { recursive: true });
    // No auth/settings/models — looks like a stray empty dir; ignore.
    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.agents[0].agentDir).toBe(join(home, 'agents', 'p'));
  });

  it('does NOT fall back when the new path already exists', () => {
    const home = makeTmpHome();
    process.env.PENCILS_HOME = home;
    // Both legacy and new exist — assume migrate already ran. New wins.
    mkdirSync(join(home, 'p'), { recursive: true });
    writeFileSync(join(home, 'p', 'auth.json'), '{}', 'utf-8');
    mkdirSync(join(home, 'agents', 'p'), { recursive: true });

    const path = makeTmpConfig({
      ...baseGateway,
      agents: [{ id: 'p', name: 'p' }],
    });
    const cfg = loadConfig(path);
    expect(cfg.agents[0].agentDir).toBe(join(home, 'agents', 'p'));
  });
});
