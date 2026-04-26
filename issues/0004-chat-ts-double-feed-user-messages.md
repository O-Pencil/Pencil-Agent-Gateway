---
id: 0004
title: chat.ts double-feeds user messages into engine context
severity: high
status: resolved
area: src/routes/chat.ts
reported: 2026-04-26
updated: 2026-04-26
related-files:
  - src/routes/chat.ts
  - src/store/session.ts
related-commits:
  - <set-on-commit>
---

## DIP Metadata

```text
[WHO]  Gateway chat route maintainer
[FROM] OpenAI-compatible callers calling POST /v1/chat/completions
[TO]   EngineAdapter.run() — must receive a non-duplicated message list
[HERE] /issues/0004 — record of a fix that landed alongside the per-session adapter rewrite
```

## Symptom

Before the fix, `handleChatCompletion` first appended the request's user
messages into `SessionStore`, then built the engine input as
`[...session.messages, ...request.messages]`. Because the user messages had
just been pushed into `session.messages`, they ended up in the merged array
**twice**.

The bug was masked by the engine adapter only ever forwarding the **last** user
message to PencilAgent, but it was a latent correctness hazard for any future
adapter that honors the full history (and a misleading state for anyone
reading the code).

## Root cause

`SessionStore.addMessage` mutates `session.messages` in place. Reading
`session.messages` after the push therefore already contained the request's
user messages, so concatenating `request.messages` again duplicated them.

## Proposed fix (applied)

Stop merging session history into the engine input. Forward `request.messages`
as-is and rely on the engine's own per-session memory (see issue 0003-related
adapter rewrite). The Gateway-side `SessionStore` is now used purely as an
audit log, not as engine context.

## Notes

- Original review numbering: problem #4.
- Fix landed in the same commit that switched the dependency to npm and
  introduced per-session PencilAgent isolation.
- The audit-log behaviour is intentionally conservative — when we eventually
  add a non-stateful adapter (e.g., a stateless OpenAI passthrough), the
  Gateway will need to feed history explicitly. That refactor is out of scope
  for v0.1 and should be tracked separately.
