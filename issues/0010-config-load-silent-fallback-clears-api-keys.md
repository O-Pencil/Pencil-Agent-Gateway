---
id: 0010
title: loadConfig silent fallback boots Gateway with zero API keys
severity: high
status: open
area: src/config.ts
reported: 2026-04-26
updated: 2026-04-26
related-files:
  - src/config.ts
  - src/server.ts
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

## Proposed fix

Differentiate "no config requested" from "config requested but bad":

1. If `GATEWAY_CONFIG` is **explicitly set** and the path either does not
   exist or fails to parse, throw immediately and let `server.ts` exit with
   a non-zero status.
2. If the path was the implicit default (`config/default.json`) and it does
   not exist, fall back to env-only — but log at WARN and require at least
   one API key sourced from env (e.g., `API_KEY=...`). If there is no key
   from any source, refuse to start.
3. Make the WARN message in the fallback path explicit:
   `"Falling back to env-only config; this means apiKeys is currently empty
   and all authenticated routes will return 401"`.

## Notes

- Original review numbering: problem #10.
- See also issue 0011 (`default.yaml` shipped but YAML loading rejected).
  Both touch the same `loadConfig` flow and should be tackled together.
