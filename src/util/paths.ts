/**
 * Path resolution helpers
 *
 * [WHO]  Gateway config + adapter
 * [FROM] Imported by config.ts and engine/nano-adapter.ts
 * [TO]   Centralized ~ expansion and config-relative path resolution
 * [HERE] src/util/paths.ts
 *
 * Both helpers are deliberately tiny — `expandHome` and `resolveAgainst`
 * exist only to remove ambiguity from how user-facing paths in config.json
 * (or env vars) become absolute. Issue 0012 motivates these:
 *   - dataDir/agentDir defaults need `~/.pencils/...` to mean homedir, not
 *     the literal `~` character on disk.
 *   - relative `dataDir: "./data"` in `pencils/<name>/config.json` should
 *     resolve against the directory of that config file, NOT process.cwd()
 *     — otherwise launching from a different cwd silently writes the
 *     registry into the wrong place.
 */

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/**
 * Expand a leading `~` or `~/` in `p` to the user's home directory.
 * No-op for paths that don't start with `~`.
 */
export function expandHome(p: string): string {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolve `p` against `base` if `p` is relative; otherwise pass through after
 * `~` expansion. `base` itself is also `~`-expanded so chained call sites stay
 * predictable when the operator passes a base like `~/configs`.
 */
export function resolveAgainst(base: string, p: string): string {
  const expanded = expandHome(p);
  if (isAbsolute(expanded)) return expanded;
  return resolve(expandHome(base), expanded);
}
