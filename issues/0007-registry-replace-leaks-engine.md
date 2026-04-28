---
id: 0007
title: AgentRegistry replaces instances without disposing the old engine
severity: high
status: resolved
area: src/agent/registry.ts
reported: 2026-04-26
updated: 2026-04-28
related-files:
  - src/agent/registry.ts
  - src/engine/nano-adapter.ts
related-commits:
  - <set-on-commit>
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

## Proposed fix (applied)

1. `AgentInstance.dispose()` now delegates to `this.engine.dispose?.()` and
   logs (but never re-throws) any error.
2. `AgentRegistry.register(config)` is now async; it `await previous.dispose()`
   before replacing.
3. `AgentRegistry.delete(id)` also disposes before removing.
4. Route handlers (`POST /v1/agents`, `DELETE /v1/agents/:id`) updated to
   await both calls.
5. Regression test added: registering the same id twice fires `engine.dispose`
   on the first instance.

## Notes

- Original review numbering: problem #7.
- Pairs with issue 0008 (shutdown-time dispose) — same `engine.dispose()` hook.
