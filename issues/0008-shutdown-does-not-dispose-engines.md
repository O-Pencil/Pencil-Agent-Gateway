---
id: 0008
title: SIGINT/SIGTERM does not dispose per-agent engines
severity: high
status: resolved
area: src/server.ts
reported: 2026-04-26
updated: 2026-04-28
related-files:
  - src/server.ts
  - src/agent/registry.ts
  - src/engine/nano-adapter.ts
related-commits:
  - <set-on-commit>
---

## DIP Metadata

```text
[WHO]  Gateway server bootstrap maintainer
[FROM] OS signals (SIGINT / SIGTERM) — typically Docker stop, k8s preStop, terminal Ctrl-C
[TO]   AgentRegistry.dispose() → AgentInstance.dispose() → EngineAdapter.dispose()
[HERE] /issues/0008 — open backlog item: graceful shutdown must release engines
```

## Symptom

The current `shutdown()` handler in `src/server.ts` only calls
`server.close()` on the Hono/Node HTTP server. It does **not** drain the
`AgentRegistry` or call `engine.dispose()` on each instance. A container
receiving `SIGTERM` therefore exits with:

- live `PencilAgent` sessions abandoned mid-request,
- in-flight model API connections never explicitly closed,
- per-session `Map<sessionId, PencilAgent>` entries (one per HTTP session) all
  garbage-collected without `agent.shutdown()` being awaited.

## Root cause

`server.ts` has no awareness of the registry's lifecycle. `AgentRegistry`
also lacks a `disposeAll()` helper, so even if the bootstrap wanted to call
it, there is no API.

## Proposed fix (applied)

1. `AgentRegistry.disposeAll()` added: iterates instances in parallel and
   `await`s each `instance.dispose()`. Per-instance errors are logged but
   never thrown — graceful shutdown is best-effort.
2. `server.ts` `shutdown(signal)` now:
   - flips a `shuttingDown` guard (signal handlers fire repeatedly under load),
   - calls `server.close()`,
   - races `registry.disposeAll()` against `SHUTDOWN_TIMEOUT_MS` (default 10s),
   - then `process.exit(0)`.
3. A regression test (`should disposeAll engines on shutdown`) confirms each
   instance's `engine.dispose` is invoked once.

## Notes

- Original review numbering: problem #8.
- `SHUTDOWN_TIMEOUT_MS` env var is honored if set; otherwise 10000ms.
- `SessionStore` flush hook is intentionally left out — sessions are
  written through synchronously today (see future LRU/TTL work).
