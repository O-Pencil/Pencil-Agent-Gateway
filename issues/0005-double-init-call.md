---
id: 0005
title: NanoPencilEngineAdapter calls ensureInitialized() twice
severity: low
status: resolved
area: src/engine/nano-adapter.ts
reported: 2026-04-26
updated: 2026-04-26
related-files:
  - src/engine/nano-adapter.ts
related-commits:
  - <set-on-commit>
---

## DIP Metadata

```text
[WHO]  Gateway engine adapter maintainer
[FROM] Old NanoPencilEngineAdapter.run() entry path
[TO]   PencilAgent.init()
[HERE] /issues/0005 — record of a copy/paste bug eliminated during the per-session adapter rewrite
```

## Symptom

`NanoPencilEngineAdapter.run()` contained two consecutive
`await this.ensureInitialized()` calls. Both invocations short-circuited via
`agent.isInitialized()` after the first, but it was confusing to read and
made the call graph visibly redundant.

## Root cause

Copy/paste residue from an earlier iteration of the adapter.

## Proposed fix (applied)

The adapter was rewritten to construct PencilAgent instances **per session**
inside `getOrCreateAgent(sessionId)`, which calls `init()` exactly once before
caching the instance in `Map<sessionId, PencilAgent>`. The redundant call site
no longer exists.

## Notes

- Original review numbering: problem #5.
- Fix landed in the same commit as the per-session adapter rewrite.
