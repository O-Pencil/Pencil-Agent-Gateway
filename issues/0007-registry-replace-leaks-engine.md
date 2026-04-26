---
id: 0007
title: AgentRegistry replaces instances without disposing the old engine
severity: high
status: open
area: src/agent/registry.ts
reported: 2026-04-26
updated: 2026-04-26
related-files:
  - src/agent/registry.ts
  - src/engine/nano-adapter.ts
---

## DIP Metadata

```text
[WHO]  Gateway agent registry maintainer
[FROM] POST /v1/agents handler — re-registering an existing agent id
[TO]   AgentInstance.engine — must release per-session PencilAgent state when its owner is replaced
[HERE] /issues/0007 — open backlog item: lifecycle hygiene for per-agent EngineAdapter instances
```

## Symptom

Calling `POST /v1/agents` with an `id` that already exists silently replaces
the `AgentInstance` in the registry's `Map`. The previous instance — and the
`NanoPencilEngineAdapter` it owned — is dropped on the floor without
`engine.dispose()` being called.

After the per-session adapter rewrite, each `NanoPencilEngineAdapter` may hold
**multiple** live `PencilAgent` sessions in its internal `Map`. Each of those
holds in-memory state and (for non-`silent` configs) potentially file handles
or timers. Replacing an agent now leaks proportionally to active session
count.

## Root cause

`AgentRegistry.register(config)` does:

```ts
const instance = new AgentInstance(config);
this.instances.set(config.id, instance);
```

It does not look up the previous instance, and `AgentInstance` exposes no
disposal hook for the registry to call.

## Proposed fix

1. Make `AgentInstance` expose `dispose(): Promise<void>` that delegates to
   `this.engine.dispose?.()`.
2. In `AgentRegistry.register`:
   - If an instance already exists for `config.id`, `await previous.dispose()`
     before replacing it.
   - Make `register` async and propagate the await up to the route handler.
3. Add a regression test that registers an agent twice with the same id and
   asserts the first engine's `dispose` was called.

## Notes

- Original review numbering: problem #7.
- Related to issue 0008 (shutdown-time dispose) — the same `dispose` hook is
  needed in both places.
