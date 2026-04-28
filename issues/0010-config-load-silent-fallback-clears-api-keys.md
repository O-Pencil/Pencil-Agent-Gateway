---
id: 0010
title: loadConfig silent fallback boots Gateway with zero API keys
severity: high
status: resolved
area: src/config.ts
reported: 2026-04-26
updated: 2026-04-28
related-files:
  - src/config.ts
  - src/server.ts
related-commits:
  - <set-on-commit>
---

## DIP Metadata

```text
[WHO]  Gateway configuration loader maintainer
[FROM] config/default.json (or path supplied via GATEWAY_CONFIG)
[TO]   getConfig() consumers — auth middleware, registry, agent loader
[HERE] /issues/0010 — open backlog item: a missing or malformed config must fail loud
```

## Symptom

`loadConfig()` wraps `loadConfigFile(...)` in a try/catch. On any failure
(missing file, malformed JSON, permission error) it logs `WARN "Failed to
load config file, using defaults"` and synthesizes a fallback object whose
`apiKeys` is `[]`.

With zero API keys, every authenticated route returns 401 — but the operator
has no obvious signal that the cause is "config never loaded". From the
outside the Gateway looks like it forgot every key.

## Root cause

The fallback was originally meant to support running with environment
variables only. It is too lenient: it silently wins even when the user
explicitly pointed `GATEWAY_CONFIG` at a path that exists but is malformed.

## Proposed fix (applied)

1. `loadConfig` now distinguishes "explicit path" (caller arg or
   `GATEWAY_CONFIG` env) from "implicit default":
   - **Explicit + load fails** → throws `InvalidRequestError` with the
     underlying file/parse error. `server.ts` propagates this to `process.exit(1)`.
   - **Implicit + missing** → falls back to env-only (unchanged behavior),
     but seeds `apiKeys` from `API_KEY` env if present.
2. `server.ts` now refuses to start with `apiKeys.length === 0` unless
   `GATEWAY_ALLOW_NO_AUTH=1` is set, with a precise error message that names
   the three escape hatches (config file / `API_KEY` env / explicit override).
3. Loud WARN logs added for both "fell back to env-only" and
   "fallback produced zero API keys".

## Notes

- Original review numbering: problem #10.
- See also issue 0011 (`default.yaml` shipped but YAML loading rejected).
  That one is still open and lives entirely inside `loadConfig`.
