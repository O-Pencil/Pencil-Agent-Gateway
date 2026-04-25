---
title: Pencil Agent Gateway 产品边界
status: active
scope: gateway-boundary
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Pencil Agent Gateway 产品边界

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway 维护者，以及在本仓库工作的 AI coding agents
[FROM] PencilAgent 优先；同时包括 HTTP 客户端、Asgard Platform、nanopencil-editor、未来 Channel Gateway
[TO]   Pencil/nano-pencil EngineAdapter，以及未来其他 Agent EngineAdapter
[HERE] 本仓库只定义给 PencilAgent 调用 Pencil 的 HTTP/SDK serving 层：协议、鉴权、实例路由、部署边界
```

## 1. 核心定义

Pencil Agent Gateway 是一个 **Agent serving gateway**，主要服务对象是 **PencilAgent**。

它的职责是把独立 Agent 引擎包装成可部署、可调用、可被平台管理的 HTTP 服务：

```text
PencilAgent / OpenAI-compatible Client
  -> Pencil Agent Gateway
  -> EngineAdapter
  -> nano-pencil SDK
```

它不是 Agent 引擎本体，也不是 SaaS 平台。

## 2. 为什么拆出来

目标是让 `nano-pencil` 保持足够轻量和独立：

- `nano-pencil` 可以继续作为 SDK 被 import。
- `nano-pencil` 可以继续作为 ACP CLI 被 Desktop 本地直连。
- `nano-pencil` 不需要内置 HTTP server、API Key、Docker 部署、多实例托管。
- 未来 `nano-pencil` 可以通过 extension/adapter 的方式接入 Gateway。
- 未来其他 Agent 引擎也可以实现同一套 `EngineAdapter`，被 Gateway 托管。
- PencilAgent 只需要稳定的 HTTP/SDK 面即可调用 Pencil，不需要理解 Pencil 引擎内部结构。

这符合 DIP 的核心原则：**上层服务依赖稳定抽象，不直接依赖引擎内部实现细节**。

## 3. 命名判断

推荐使用：

```text
pencil-agent-gateway
```

原因：

- `gateway` 表达它是对外 HTTP/API 边界。
- `agent` 表达它服务的是 Agent Engine，而不是一般网络反向代理。
- 避免未来与 `pencil-channel-gateway` 混淆。

文档和代码中应优先使用 `Pencil Agent Gateway`；产品文案可简称 `Pencil Gateway`。

## 4. 四层生态边界

| 层 | 项目 | 做什么 | 不做什么 |
|----|------|--------|----------|
| Engine | `nano-pencil` | 对话、工具 loop、记忆、模型路由、SDK/ACP CLI | HTTP API、API Key、平台多租户 |
| Agent Gateway | 本仓库 | OpenAI API、SSE、API Key、Agent 实例、EngineAdapter | 用户系统、计费、Marketplace、渠道 bot |
| Platform | `Asgard Platform` | 用户、计费、Console、Marketplace、容器编排 | 直接 import nano-pencil 或 Gateway 代码 |
| Client | `nanopencil-editor` | 写作 UX、本地 workspace、本地 ACP、远程 HTTP 接入 | 服务端 Agent 编排、平台账号系统 |

## 5. Gateway 做什么

MVP 必须覆盖：

- PencilAgent 启动后通过 HTTP/SDK 调用 Pencil
- OpenAI-compatible `/v1/chat/completions`
- SSE streaming
- `/v1/models`
- API Key 鉴权
- Agent 实例注册表
- Agent 配置加载
- 短期 session memory
- `nano-pencil` 默认 EngineAdapter
- Docker 单容器部署
- Asgard 通过 HTTP 管理/转发
- editor 通过 HTTP 消费
- 生成并维护给 AI Agent 看的 `AGENTS.md`

后续版本覆盖：

- 持久化记忆
- usage 统计事件
- tool callback 扩展协议
- thinking / trace 扩展事件
- 多 EngineAdapter
- Channel Gateway 对接
- SQLite 或外部存储

## 6. Gateway 不做什么

| 不做 | 原因 | 放到哪里 |
|------|------|----------|
| 用户注册/登录 | Gateway 要可单容器轻量部署 | Asgard |
| 计费套餐 | 平台职责 | Asgard |
| Marketplace | 平台 UI 职责 | Asgard |
| 容器编排 | Gateway 是被编排对象 | Asgard |
| 多 Agent workflow/DAG | 会把 serving 层变成平台层 | 后续 Asgard 或专门 orchestrator |
| Telegram/Slack/Discord/微信 adapter | 渠道复杂度高，应独立 | `pencil-channel-gateway` |
| Desktop 本地文件工具执行 | 客户端本地能力 | `nanopencil-editor` |
| PencilAgent 业务逻辑 | Gateway 只提供调用 Pencil 的 HTTP/SDK 面 | PencilAgent |

## 7. 双部署形态

### 7.1 自托管模式

```text
docker run pencil-agent-gateway
```

适合个人或团队直接部署：

- 本地配置 API Key。
- 文件系统保存实例配置和 session。
- 不依赖 Asgard。
- 用户直接使用 OpenAI-compatible 客户端。

### 7.2 Asgard 托管模式

```text
Asgard -> HTTP proxy -> Pencil Agent Gateway container
```

适合平台用户：

- Asgard 负责用户、计费、Marketplace。
- Gateway 仍只暴露 HTTP。
- Asgard 不 import Gateway 代码。
- v0.1 可共享一个 Gateway 容器。
- v0.3 再演进为每用户/每 Agent 独立容器。

## 8. Channel Gateway 的未来位置

Telegram、Slack、Discord、微信、飞书等渠道适配，不应该塞进 Agent Gateway MVP。

推荐未来拆一个项目：

```text
pencil-channel-gateway
```

它的职责是：

```text
External Chat App
  -> Channel Gateway
  -> OpenAI-compatible HTTP
  -> Pencil Agent Gateway 或 Asgard
```

这样可以保持 Agent Engine、Agent Gateway、Channel Gateway、Asgard 四层职责清楚。

## 9. 当前设计结论

`Pencil Agent Gateway` 这个定义是准确的，但要明确它是 **Agent serving gateway**，不是所有入口的总网关。

当前仓库应先实现 HTTP serving 主链路。Channel 能力不要现在合并进来，只在接口上保留将来可对接的 OpenAI-compatible HTTP 面。
