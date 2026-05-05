---
title: Pencil Agent Gateway Docs Index
status: active
scope: docs-index
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-05-03
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

13. [12-asgard-web-ui-guide.md](./12-asgard-web-ui-guide.md)
   - Asgard-web 前端接入指南：信息架构、4 个核心页面（Agent 列表 / 创建表单 / 对话窗 / Key 管理）、SSE 消费 + AbortController、错误展示模式。

13. [13-channel-integration.md](./13-channel-integration.md)
   - 钉钉/微信/飞书第一版 channel wrapper 边界：平台消息归一化、路由、allowlist、通过 Gateway HTTP 调用 PencilAgent，以及未来拆出 `pencil-channel-gateway` 的迁移规则。含 v0.1 扩展实现（去重、401 友好提示、AI Card 流式）。

14. [14-multi-pencil-architecture.md](./14-multi-pencil-architecture.md)
   - 多 Pencil 实例架构：记忆隔离、启动脚本、跨实例通信方案（A/B/C 三种方案对比）。

15. [15-editor-gateway-minimal-integration.md](./15-editor-gateway-minimal-integration.md)
   - 不经过 Asgard 的最小 editor ↔ Gateway 接入指南：部署 Gateway、创建 PencilAgent、配置 editor `remote-http`、消费 OpenAI SSE、验收清单。

16. [16-pencils-storage-layout.md](./16-pencils-storage-layout.md)
   - Pencils 单根存储布局（`~/.pencils/`）、env 覆盖、云端 + 本地混合（"领养"模板含 Soul + memory seed + settings）、与 nanoPencil `multi-agent-fs-design.md` 合并方案；Workspace 作为 Agent 平级一等公民；Teams 与 Gateway 调度模型对齐；ID/Name 区分 + `agent.json` 元数据；Gateway / nanoPencil 改动清单与执行顺序。

17. [17-nanopencil-multi-agent-impact-eval.md](./17-nanopencil-multi-agent-impact-eval.md)
   - Step B 评估产物：nanoPencil 源码改造影响面（72 处 path-derived 调用、18 个文件、3 类硬编码点）；`AgentDirContext` 抽象；与 nanoPencil `docs/multi-agent-fs-design.md` 概念对齐与合并方案；Teams 5 阶段重构计划（in-process leader → 多 Agent Gateway 协作）；`team-state-store.ts` env 名 latent bug 顺手修；19 个可独立合并 PR 的拆分清单。

## Status

These documents are the source of truth for the v0.1 build until code exists.
When implementation begins, API or architecture changes must update the matching document in the same pull request.
