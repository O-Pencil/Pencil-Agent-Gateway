---
title: Pencil Agent Gateway 产品边界
status: active
scope: gateway-boundary
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-05-22
---

# Pencil Agent Gateway 产品边界

> **生态发展路线唯一源头**：[nanoPencil/docs/pencil-platform-charter.md](https://github.com/O-Pencil/nanoPencil/blob/main/docs/pencil-platform-charter.md)
> 本文档专注 Gateway 自身的产品边界。生态级拓扑、术语、阶段、跨项目工作线请直接读 charter。

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway 维护者，以及在本仓库工作的 AI coding agents
[FROM] OpenAI-compatible callers：nanoPencil CLI（远程模式）、nanopencil-editor、Asgard Platform、第三方 HTTP 客户端、未来 Channel Gateway
[TO]   PencilAgent 实例（= nano-pencil engine + Soul + memory + model + personality），通过 EngineAdapter 落到 nano-pencil
[HERE] 本仓库定义托管 PencilAgent 实例并对外提供 OpenAI 兼容 HTTP/SDK serving 层：协议、鉴权、实例路由、部署边界
```

## 1. 核心定义

Pencil Agent Gateway 是一个 **Agent serving gateway**，**托管 PencilAgent 实例并对外提供调用接口**。

PencilAgent 是配置好的运行单元（`nano-pencil engine + Soul + memory + model + personality`），有身份。Gateway 的职责是把这些 PencilAgent 包装成可部署、可调用、可被平台管理的 HTTP 服务：

```text
Caller (nanoPencil CLI / editor / Asgard / 3rd-party)
  -> Pencil Agent Gateway
  -> PencilAgent 实例
  -> EngineAdapter
  -> nano-pencil engine
```

它不是 Agent 引擎本体，也不是 SaaS 平台。术语口径见 [06-glossary.md](./06-glossary.md)。

## 2. 为什么拆出来

目标是让 `nano-pencil` 保持足够轻量和独立：

- `nano-pencil` 可以继续作为 SDK 被 import。
- `nano-pencil` 可以继续作为 ACP CLI 被 Desktop 本地直连。
- `nano-pencil` 不需要内置 HTTP server、API Key、Docker 部署、多实例托管。
- 未来 `nano-pencil` 可以通过 extension/adapter 的方式接入 Gateway。
- 未来其他 Agent 引擎也可以实现同一套 `EngineAdapter`，被 Gateway 托管。
- Caller 只需要稳定的 HTTP/SDK 面即可调用某个 PencilAgent，不需要理解 Pencil 引擎内部结构。
- 同一份 nano-pencil engine 可以同时托管多个 PencilAgent（不同 Soul / 不同 memory / 不同 model），互相隔离。

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

> **生态级拓扑与 4 项目职责表已收口到 charter**，本文档不再重复。
> 唯一源头：[nanoPencil/docs/pencil-platform-charter.md §2-§3](https://github.com/O-Pencil/nanoPencil/blob/main/docs/pencil-platform-charter.md)。
>
> 本仓库（Pencil-Agent-Gateway）在生态中的定位：**Agent Gateway 层**——HTTP serving，OpenAI 兼容 API + SSE，托管 PencilAgent 实例，EngineAdapter 抽象。不做用户系统、计费、Marketplace、渠道 bot。详细职责表见 charter §3。

## 5. Gateway 做什么

MVP 必须覆盖：

- 任意 caller（nanoPencil CLI / editor / Asgard / 3rd-party）通过 HTTP/SDK 调用一个目标 PencilAgent
- OpenAI-compatible `/v1/chat/completions`
- SSE streaming
- `/v1/models`（每个 PencilAgent 暴露为一个 model id）
- API Key 鉴权
- PencilAgent 实例注册表
- PencilAgent 配置加载（Soul + memory + model）
- 短期 session memory（每个 PencilAgent + 每个 sessionId 独立）
- `nano-pencil` 默认 EngineAdapter
- Docker 单容器部署（一个容器可托管多个 PencilAgent）
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
| 大规模 Telegram/Slack/Discord/微信 adapter | 渠道复杂度高，应独立；当前仓库只允许阶段性 WeChat/Feishu 文本 wrapper | `pencil-channel-gateway` |
| Desktop 本地文件工具执行 | 客户端本地能力 | `nanopencil-editor` |
| Caller 业务逻辑 | Gateway 只提供托管 PencilAgent + HTTP/SDK 调用面 | 各 caller 自己 |

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

Telegram、Slack、Discord、微信、飞书等渠道适配，不应该长期塞进 Agent Gateway MVP。

当前仓库允许一个阶段性例外：`src/channels/` 中的 WeChat/Feishu 文本 wrapper。它只能作为 Gateway HTTP caller 工作，不能直接访问 `AgentRegistry`、`EngineAdapter` 或 `nano-pencil`。

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

当前仓库应优先保持 HTTP serving 主链路。阶段性 Channel 能力必须保持可迁移边界，并通过 OpenAI-compatible HTTP 面调用 Gateway。
