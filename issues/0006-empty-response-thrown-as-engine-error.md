---
id: 0006
title: Empty model response thrown as EngineError
severity: medium
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
[FROM] PencilAgent.run() return value
[TO]   Non-streaming /v1/chat/completions response
[HERE] /issues/0006 — record of a fix that landed alongside the per-session adapter rewrite
```

## Symptom

`runNonStreaming` previously inspected the text returned by
`PencilAgent.run()` and threw `new EngineError('Engine returned empty
response')` whenever the trimmed text was empty. This converted legitimate
empty completions (content-filter, deliberate "no answer", explicit refusal,
zero-length stop sequences) into HTTP 500s.

## Root cause

Defensive coding pattern that conflated "no text" with "engine failure". An
empty assistant turn is a valid OpenAI-shaped response (`choices[0].message.content === ""`).

## Proposed fix (applied)

The empty-response check was removed during the adapter rewrite. The adapter
now returns whatever the SDK produces, and lets the caller decide how to react.

## Notes

- Original review numbering: problem #6.
- If observability of "empty completions" is needed later, log a warning at
  WARN level instead of throwing — it is information, not an error.
