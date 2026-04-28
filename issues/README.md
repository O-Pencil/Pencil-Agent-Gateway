---
title: Issue Tracker (file-backed)
status: active
scope: gateway-known-issues
owner: pencil-agent-gateway maintainers
created: 2026-04-26
updated: 2026-04-26
---

# Pencil Agent Gateway — Known Issues

## DIP Metadata

```text
[WHO]  Gateway maintainers and AI coding agents working on follow-up fixes
[FROM] Code review of the M0–M7 MVP (commit 42832b6 + post-review fixes)
[TO]   A backlog of correctness, hygiene, and operational issues to be resolved before v0.1 release
[HERE] /issues/ — flat directory of file-backed issues, one Markdown file per issue
```

## Format

Each issue file uses the following frontmatter:

```yaml
---
id: ####
title: short title
severity: blocker | high | medium | low
status: open | in-progress | resolved | wontfix
area: <module path or topic>
reported: YYYY-MM-DD
updated: YYYY-MM-DD
related-files:
  - path/to/file.ts
related-commits:
  - <git sha>   # optional, set when fixed
---
```

The body must contain the same `[WHO] / [FROM] / [TO] / [HERE]` DIP metadata
block as the rest of the repo, followed by sections: **Symptom**, **Root cause**,
**Proposed fix**, and **Notes**.

## Numbering

Issue files are numbered in the order they were filed (`0001-…md`). The number
is opaque — it is **not** the same as the position in the original review list.
Cross-references are kept inside each file under "Notes".

## Index

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| 0004 | chat.ts double-feeds user messages into engine context | high | resolved |
| 0005 | NanoPencilEngineAdapter calls `ensureInitialized()` twice | low | resolved |
| 0006 | Empty model response thrown as `EngineError` | medium | resolved |
| 0007 | AgentRegistry replaces instances without disposing the old engine | high | resolved |
| 0008 | SIGINT/SIGTERM does not dispose per-agent engines | high | resolved |
| 0009 | `AuthStorage` / `ModelRegistry` are constructed but never wired into PencilAgent | medium | open |
| 0010 | `loadConfig` silent fallback boots Gateway with zero API keys | high | resolved |
| 0011 | `default.yaml` is shipped but YAML loading is rejected at runtime | medium | open |
