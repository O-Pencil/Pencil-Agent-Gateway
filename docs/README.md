---
title: Pencil Agent Gateway Docs Index
status: active
scope: docs-index
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-28
---

# Pencil Agent Gateway Docs

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway contributors and AI coding agents
[FROM] Repository README, AGENTS.md, product roadmap, caller integration requirements
[TO]   All planning, API, runtime, and integration documents in this directory
[HERE] Documentation index and reading order for building a Gateway that hosts PencilAgent instances and serves callers over HTTP/SDK
```

## Reading Order

0. [../AGENTS.md](../AGENTS.md)
   - Required instructions for AI coding agents, including DIP protocol and repository boundaries.

1. [00-product-boundary.md](./00-product-boundary.md)
   - Defines what Gateway is, what it is not, naming, deployment shape, and Channel Gateway separation.

2. [01-development-plan.md](./01-development-plan.md)
   - Detailed phased implementation plan from empty repo to v0.1, then v0.2/v0.3 roadmap.

3. [02-api-contract.md](./02-api-contract.md)
   - OpenAI-compatible API contract, auth, SSE, models, agents, errors, cancellation.

4. [03-adapter-architecture.md](./03-adapter-architecture.md)
   - `EngineAdapter`, `AgentInstance`, storage, memory, tool boundary, and future extension model.

5. [04-asgard-editor-integration.md](./04-asgard-editor-integration.md)
   - Asgard integration, nanopencil-editor `HttpChatProvider`, self-hosted client flow, and future Channel Gateway.

6. [05-caller-runtime.md](./05-caller-runtime.md)
   - Caller-side runtime contract for invoking PencilAgents through Gateway HTTP/SDK; covers nanoPencil CLI (remote mode), editor, Asgard, and third-party callers.

7. [06-glossary.md](./06-glossary.md)
   - Normative term table; pins the meaning of nanoPencil / nano-pencil / PencilAgent / Pencil / Pencil Agent Gateway. **PencilAgent = configured Agent instance, NOT the nanoPencil project.**

8. [07-m7-nano-pencil-integration.md](./07-m7-nano-pencil-integration.md)
   - M7 实施任务清单：安装 SDK 依赖、重写 NanoPencilEngineAdapter、修复 chat.ts 路由、端到端验证。

9. [08-asgard-editor-end-to-end.md](./08-asgard-editor-end-to-end.md)
   - Asgard ↔ Gateway ↔ editor 三方端到端集成方案：角色分工、时序、Gateway/Asgard/editor 各端待办、联调里程碑。

10. [09-asgard-integration-guide.md](./09-asgard-integration-guide.md)
   - Asgard 平台侧接入手册：PencilAgent 定位、非 MCP 边界、FastAPI 路由改造、SSE 反代、DB/权限/部署约束。

11. [10-editor-integration-guide.md](./10-editor-integration-guide.md)
   - nanopencil-editor 侧 `remote-http` / `HttpChatProvider` 接入指南，只面向 Asgard，不直连 Gateway。

12. [11-containerized-deployment.md](./11-containerized-deployment.md)
   - Asgard + Gateway 容器化部署、内部网络、凭据、资源估算和运维检查清单。

## Status

These documents are the source of truth for the v0.1 build until code exists.
When implementation begins, API or architecture changes must update the matching document in the same pull request.
