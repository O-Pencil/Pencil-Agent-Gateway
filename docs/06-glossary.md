---
title: Gateway-Internal Glossary (with ecosystem terms pointer)
status: active
scope: gateway-internal-glossary
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-05-22
---

# Gateway-Internal Glossary

> **生态级术语唯一源头**：[nanoPencil/docs/pencil-platform-charter.md §4](https://github.com/O-Pencil/nanoPencil/blob/main/docs/pencil-platform-charter.md#4-术语表)
> nanoPencil / nano-pencil / PencilAgent / Pencil / Pencil Agent Gateway / Asgard Platform / nanopencil-editor / pencil-channel-gateway 等跨项目术语全部以 charter §4 为准。本文档只保留 Gateway 自己仓库内部的具体术语，避免与 charter 重复。

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway maintainers and AI coding agents working inside this repo
[FROM] Cross-project terms are defined in nanoPencil charter §4; this file only defines Gateway-internal vocabulary
[TO]   A precise reference for Gateway-specific abstractions: EngineAdapter / AgentRegistry / ToolCorrelation / etc.
[HERE] Gateway-only glossary; ecosystem terms live in charter
```

## 1. Why this is now a thin glossary

The previous version of this file tried to be the ecosystem-wide naming reference. With the platform charter in place, that responsibility has moved upstream to a single source. This file now lives as a Gateway-only addendum.

If you arrived here looking for the meaning of `nanoPencil` vs `nano-pencil` vs `PencilAgent` — go to charter §4. If you want to know what `EngineAdapter` or `ToolCorrelation` means inside this codebase, stay here.

## 2. Gateway-Internal Terms

| Term | Refers to | File / Module |
|------|-----------|---------------|
| **EngineAdapter** | TypeScript interface that wraps any Agent engine and exposes a uniform `run(req, opts)` + optional `provideToolResponse()` surface. Gateway routes never depend on `nano-pencil` directly — only on EngineAdapter. | `src/engine/adapter.ts` |
| **NanoPencilEngineAdapter** | The default EngineAdapter implementation; wraps `@pencil-agent/nano-pencil` SDK | `src/engine/nano-adapter.ts` |
| **MockEngineAdapter** | Test-only EngineAdapter with scripted tool-request support | `src/engine/mock-adapter.ts` |
| **AgentRegistry** | In-process map: `agentId -> AgentInstance`. Owns PencilAgent CRUD, file-backed persistence under `PENCILS_HOME/agents/<id>/`. | `src/agent/registry.ts` |
| **AgentInstance** | Runtime form of a PencilAgent inside Gateway: id, modelId (`pencil/<id>`), engine reference, config, createdAt/updatedAt | `src/agent/registry.ts` |
| **ToolCorrelation** | v0.2 in-memory table that bridges SSE `pencil.tool_request` outbound and HTTP `tool_response` inbound. One pending entry per `(agentId, sessionId)` (charter §8.1 decision 1). | `src/engine/tool-correlation.ts` |
| **ToolCallEntry** | One row in the correlation table: id + session + agent + apiKey + resolve/reject + timeout handle | `src/engine/tool-correlation.ts` |
| **SessionStore** | File-backed short-term memory for `(agentId, sessionId)` conversation history. Replaced when new agentDir is registered. | `src/store/session.ts` |
| **SAFETY_GUARDRAIL** | System-prompt injection prepended at Soul resolution. Narrowly scoped to deployment-class user questions about this service; not a general safety filter. | `src/engine/nano-adapter.ts` |
| **PENCILS_HOME** | env var; root for per-Pencil agentDir layout. See nanoPencil multi-agent-fs §9.2 for full spec. | `src/config.ts` |
| **AgentDir** | `~/.pencils/agents/<id>/`; the directory holding one PencilAgent's memory / soul / auth / models / settings | `src/config.ts` |
| **Channel adapter** | Gateway-internal alias for the WeChat / DingTalk / Feishu transports under `src/channels/` and `src/relays/`. They are HTTP callers of Gateway, not engine consumers. Long-term home is `pencil-channel-gateway` (see charter §3). | `src/channels/`, `src/relays/` |
| **AsgardHeaders** | Request headers that Gateway accepts for logging / future audit but does not trust for authz: `X-Asgard-User`, `X-Asgard-Agent`, `X-Request-Id` | `src/auth/middleware.ts` |
| **Caller** | Any HTTP client that calls Gateway: editor, nanoPencil CLI (remote mode), Asgard proxy, third-party. Caller's role and configuration live in [05-caller-runtime.md](./05-caller-runtime.md). | conceptual |

## 3. Naming Rules (Gateway-internal only)

1. In Gateway code use the camelCase TS identifiers (`engineAdapter`, `toolCorrelation`, `agentRegistry`).
2. In Gateway docs prose use the brand-style proper noun form for cross-project terms (per charter §4) and the codebase form for internal terms (`EngineAdapter` capitalized as a type, `tool correlation table` as descriptive prose).
3. Never reintroduce ecosystem-wide naming rules here — that section moved to charter §4.

## 4. Cross-Reference

- Ecosystem term table (canonical): [nanoPencil/docs/pencil-platform-charter.md §4](https://github.com/O-Pencil/nanoPencil/blob/main/docs/pencil-platform-charter.md#4-术语表)
- Caller-facing runtime contract: [05-caller-runtime.md](./05-caller-runtime.md)
- EngineAdapter design: [03-adapter-architecture.md](./03-adapter-architecture.md)
- Tool callback v0.2: [18-tool-callback-protocol-v0.2.md](./18-tool-callback-protocol-v0.2.md)
