/**
 * Path helper tests
 *
 * [WHO]  Vitest test runner
 * [FROM] src/util/paths.ts
 * [TO]   Verifies expandHome and resolveAgainst contract used by issue 0012
 *        config resolution. Pure unit tests — no filesystem.
 * [HERE] src/util/paths.test.ts
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { expandHome, resolveAgainst } from './paths.js';

describe('expandHome', () => {
  it('returns input unchanged when no leading ~', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path');
    expect(expandHome('relative/path')).toBe('relative/path');
    expect(expandHome('')).toBe('');
  });

  it('expands a bare ~ to homedir', () => {
    expect(expandHome('~')).toBe(homedir());
  });

  it('expands ~/ prefix to homedir', () => {
    expect(expandHome('~/foo/bar')).toBe(resolve(homedir(), 'foo/bar'));
  });

  it('does not expand ~ embedded mid-path', () => {
    // Important: path/~/foo is a literal — we must not eat the tilde.
    expect(expandHome('/some/~/dir')).toBe('/some/~/dir');
  });
});

describe('resolveAgainst', () => {
  it('returns the path unchanged when already absolute', () => {
    expect(resolveAgainst('/base', '/abs/path')).toBe('/abs/path');
  });

  it('joins relative paths against the base', () => {
    expect(resolveAgainst('/base/dir', './foo')).toBe('/base/dir/foo');
    expect(resolveAgainst('/base/dir', 'foo/bar')).toBe('/base/dir/foo/bar');
  });

  it('expands ~ in both base and target', () => {
    expect(resolveAgainst('/base', '~/data')).toBe(resolve(homedir(), 'data'));
    expect(resolveAgainst('~/configs', './pencil.json')).toBe(
      resolve(homedir(), 'configs/pencil.json'),
    );
  });
});
