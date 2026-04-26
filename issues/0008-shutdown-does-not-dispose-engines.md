---
id: 0008
title: SIGINT/SIGTERM does not dispose per-agent engines
severity: high
status: open
area: src/server.ts
reported: 2026-04-26
updated: 2026-04-26
related-files:
  - src/server.ts
  - src/agent/registry.ts
  - src/engine/nano-adapter.ts
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

## Proposed fix

1. Add `AgentRegistry.disposeAll(): Promise<void>` that iterates instances and
   awaits `instance.dispose()` for each (see issue 0007 for the per-instance
   `dispose`).
2. In `server.ts` `shutdown(signal)`:
   - Stop accepting new connections (`server.close()`).
   - `await registry.disposeAll()`.
   - Then `process.exit(0)`.
3. Bound the wait with a configurable `shutdownTimeoutMs` (default ~10s) so a
   stuck engine cannot block container termination indefinitely. On timeout,
   log a warning and exit anyway.

## Notes

- Original review numbering: problem #8.
- Pairs with issue 0007 — both want the same `EngineAdapter.dispose()` plumbed
  through the registry.
- Optional: also dispose the `SessionStore` (flush pending writes) once it
  becomes async (see future LRU/TTL work).
