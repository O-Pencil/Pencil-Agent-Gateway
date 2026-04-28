---
title: Asgard ↔ Gateway ↔ editor 三方端到端集成方案
status: active
scope: cross-project-integration
owner: pencil-agent-gateway maintainers
created: 2026-04-28
updated: 2026-04-28
---

# Asgard ↔ Gateway ↔ editor 三方端到端集成方案

## DIP Metadata

```text
[WHO]  Asgard 平台、Pencil Agent Gateway、nanopencil-editor 三方维护者
[FROM] 用户在 Asgard 平台创建 PencilAgent，editor 通过 Asgard 调用该 Agent
[TO]   一条端到端流程，使得 editor 可以以"远程文本 Agent"方式接入 PencilAgent
[HERE] 跨项目集成契约 + 各端待办清单；不引入跨仓库源码依赖
```

## 1. 目标场景

```
用户  →  Asgard UI                      ┐
          │                              │
          ├─ 创建 PencilAgent（填 Soul / Memory / Model）
          ├─ 拿到 Asgard 颁发的 user-key
          │                              │
用户  →  editor 桌面                    │
          ├─ 设置面板填: Asgard baseUrl + user-key + agent-id
          └─ 选 "remote-http" provider
                                         │
                editor                   │
                  │ HTTP/SSE             │
                  ▼                      │
                Asgard backend ──────────┤  内部 internal-key
                  │                      │
                  ▼                      │
                Pencil Agent Gateway ────┘
                  │
                  ▼
                nano-pencil SDK → provider/model（来自 Agent 配置）
```

**最终用户视角**：在 Asgard 商店点几下创建一个"小铅笔"Agent，设定它的灵魂（systemPrompt）+ 记忆窗口，拿到一个 agent-id，到 editor 里粘贴 Asgard 的 baseUrl + 自己的 user-key + agent-id，写作时直接对话。

## 2. 角色边界

| 关注点 | Asgard | Gateway | editor |
|--------|--------|---------|--------|
| 用户账户 / 登录 | ✅ | ❌ | ❌ |
| 用户 API Key 颁发 / 撤销 / 配额 | ✅ | ❌ | 持有，存设置 |
| Marketplace / 创建表单 / 列表页 UI | ✅ | ❌ | ❌ |
| Soul / Memory / Model 配置存储 | ✅ 主存（DB） | ✅ 副本（agents/*.json） | ❌ 不持有 |
| Agent 实例运行时（PencilAgent 进程内态） | ❌ | ✅ | ❌ |
| OpenAI-compatible HTTP/SSE 协议 | ✅ 转发 | ✅ 提供 | ✅ 消费 |
| 内部 API Key 到 Gateway | ✅ 持有 1 个 | ✅ 校验 | ❌ |
| 计费 / 用量统计 | ✅ | log + usage 字段（v0.1 多为 0） | ❌ |
| 内容呈现 / Diff / 编辑器 UX | ❌ | ❌ | ✅ |

**核心约束**：editor **永远只看到 Asgard**。它不知道 Gateway 存在；Gateway 也不知道终端用户是谁，只通过 `X-Asgard-User` / `X-Asgard-Agent` header 拿到审计标识。

## 3. 端到端时序

### 3.1 创建 Agent

```
[user]                [Asgard UI]              [Asgard backend]            [Gateway]
  │  open create page  │                         │                          │
  │ ──────────────────▶│                         │                          │
  │  填 soul/memory/   │                         │                          │
  │  model/name        │                         │                          │
  │ ──────────────────▶│  POST /agents (DB row)  │                          │
  │                    │ ───────────────────────▶│                          │
  │                    │                         │  生成 agent-id           │
  │                    │                         │  POST /v1/agents         │
  │                    │                         │  Authorization:          │
  │                    │                         │    Bearer <internal-key> │
  │                    │                         │ ────────────────────────▶│
  │                    │                         │                          │ register
  │                    │                         │ ◀────── 200 {modelId} ───│
  │                    │  返回 agent meta        │                          │
  │                    │ ◀───────────────────────│                          │
  │  显示 agent-id     │                         │                          │
  │ ◀──────────────────│                         │                          │
```

**Asgard backend → Gateway** 的请求体：

```json
POST /v1/agents
Authorization: Bearer <gateway-internal-key>
X-Request-Id: req_xxx
X-Asgard-User: user_42
X-Asgard-Agent: agent_xxx

{
  "id": "asgard-agent-xxx",
  "name": "小铅笔",
  "soul": {
    "systemPrompt": "你是小铅笔，专注帮用户做长篇小说创作……",
    "styleTags": ["zh-cn", "literary"]
  },
  "memory": {
    "mode": "short-term",
    "maxTurns": 30
  },
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-5-20250929"
  },
  "engine": { "type": "nano-pencil" }
}
```

> Gateway agent-id 的唯一性由 Asgard 负责（建议格式 `asgard-{uuid}`）。
> `model.apiKey` **不传**——走 Gateway "inherited" 模式，由 Gateway 容器侧
> 的 `~/.nanopencil/auth.json`/env 提供凭据。或者 Asgard 想为每个 user 用
> 独立 key，就把 key 一起发上来走 BYO 模式。两种都支持。

### 3.2 editor 发起 chat（SSE 流式）

```
[editor]               [Asgard backend]                      [Gateway]
  │ POST /v1/chat/completions                                 │
  │ Authorization: Bearer <user-key>                          │
  │ {model:"pencil/asgard-agent-xxx", stream:true,            │
  │  session_id:"workspace-doc-1", messages:[...]}            │
  │ ────────────────────────────▶                             │
  │                       │ 校验 user-key                     │
  │                       │ user-key → allowed agents 检查    │
  │                       │ 注入 internal-key + headers       │
  │                       │ ────────────────────────────────▶ │
  │                       │                                   │ run agent
  │                       │ ◀─ data: {…delta…}                │
  │ ◀─ data: {…delta…} ───│ 透传                              │
  │                       │ ◀─ data: {…delta…}                │
  │ ◀─ data: {…delta…} ───│                                   │
  │                       │ ◀─ data: [DONE]                   │
  │ ◀─ data: [DONE] ──────│                                   │
```

Asgard 在中间做的事：

1. **AuthN/Z**：拿 user-key 反查用户、确认对 `pencil/asgard-agent-xxx` 有权限。
2. **重写**：把 `Authorization` 换成 internal Gateway key；保留 `X-Asgard-User` / `X-Asgard-Agent` 给 Gateway 审计。
3. **流式透传**：完全不要解析 SSE，原样 pipe；解析破坏 chunk 边界且引入延迟。
4. **错误映射**：Gateway 返 401/403/404/422 → Asgard 业务错误（不要直接回 raw OpenAI error 体）。

## 4. 待办清单

### 4.1 Gateway（本仓库）

| # | 任务 | 估时 | 优先级 | 备注 |
|---|------|------|--------|------|
| G1 | `soul.systemPrompt` **真正注入** PencilAgent | 0.5d | P0 | 现在 config 接受但适配器不用，Asgard 传了等于没传 |
| G2 | `temperature` / `max_tokens` 真正传到 SDK | 0.5d | P0 | 同上，参数收了就丢 |
| G3 | `X-Asgard-User` / `X-Asgard-Agent` 写进 SSE event log（审计） | 0.5d | P1 | Asgard 计费查证用 |
| G4 | 把 `c.req.raw.signal` 真正连到 PencilAgent 的 `AbortController` | 0.5d | P1 | 用户中断 / 超时不再让 model 跑空 |
| G5 | `usage` 字段填实数（从 SDK assistant message 的 `usage` 取） | 0.5d | P1 | Asgard 计费用 |
| G6 | `/v1/agents/:id` `GET` —— Asgard 拿单个 agent 详情用 | 0.25d | P1 | 现在只有 list 没有 single get |
| G7 | `PUT /v1/agents/:id` 更新 Soul/Memory（不重建 PencilAgent，只换 systemPrompt） | 0.5d | P1 | UI 改 systemPrompt 不该让所有现有 session 丢上下文 |
| G8 | `/v1/agents/:id/sessions` —— 查/清 session（编辑器"重新开始对话"按钮） | 0.5d | P2 | |
| G9 | OpenAPI / Swagger spec | 0.5d | P2 | Asgard 后端依据它生 client；现在靠 02-api-contract.md 手抄 |
| G10 | TLS 反代示例（Caddy / nginx 各一份） | 0.25d | P0 | 上线前必备 |
| G11 | 结构化 JSON 日志 + 全链路 traceId（透传 `X-Request-Id`） | 1d | P1 | Asgard 串日志靠这个 |

**Gateway 侧合计：约 5 天**。其中 P0 三项（G1+G2+G10）是"editor 流过来能产生有效结果"的最低门槛。

### 4.2 Asgard 平台

| # | 任务 | 估时 | 备注 |
|---|------|------|------|
| A1 | `PencilAgentBackend` service class（封装对 Gateway 的 HTTP 调用） | 1d | 参考 docs/04 §2.2 |
| A2 | 后端 config：`gateway_url` / `internal_api_key` / `timeout_ms` / `connect_timeout_ms` | 0.25d | env / secret manager 都行 |
| A3 | DB schema：`pencil_agents`（user_id, name, soul_prompt, memory_max_turns, model_provider, model_name, gateway_agent_id, status, created_at） | 0.5d | Asgard 主存 |
| A4 | Marketplace type `pencil-agent` | 0.5d | 用户创建表单的渲染依据 |
| A5 | 创建表单 UI：Name / Soul Prompt（textarea）/ Memory Turns（数字）/ Model（dropdown，options 来自 Gateway `/v1/models` 或一份白名单） | 1d | |
| A6 | 创建后端流程：DB insert → 生成 `gateway_agent_id` → 调 Gateway `POST /v1/agents` → 失败回滚 DB | 0.5d | |
| A7 | API key 颁发：Asgard user-key → 反查后台映射 internal-key + allowed_agents | 1d | 如果今天 Asgard 已有 key 体系，主要是加个 `pencil_agent_ids` 关联 |
| A8 | `POST /v1/chat/completions` 反向代理：透传 SSE，不解析 chunk | 0.5d | Asgard 直接 reverse-proxy 到 Gateway |
| A9 | `GET /v1/models` 反向代理：仅返回当前用户可见的 agent | 0.5d | 即 Asgard 帮 Gateway 做 per-user 过滤，因为 Gateway 自己只认 API key 范围 |
| A10 | 错误码映射表：401→login expired / 403→permission / 404→agent not found / 422→bad request / 5xx→service error | 0.25d | |
| A11 | 用量统计接入：解析 SSE `[DONE]` 前最后一个 chunk 的 usage 写计费表（v0.1 usage 多半为 0，先写 0 不阻塞） | 0.5d | |
| A12 | 容器编排：把 Gateway 镜像挂在 Asgard 同一个内网，HTTPS by Asgard ingress | 0.5d | |

**Asgard 侧合计：约 7 天**。

### 4.3 nanopencil-editor

| # | 任务 | 估时 | 备注 |
|---|------|------|------|
| E1 | 新建 `src/frontend/src/infrastructure/api/chat/HttpChatProvider.ts` | 1d | 仿 `WebSocketChatProvider` 的形状，吃 OpenAI SSE |
| E2 | `src/frontend/src/infrastructure/api/chat/index.ts` 加第三 case：`remote-http -> HttpChatProvider` | 0.25d | RoutedChatProvider 已有切换框架 |
| E3 | 设置面板：`CLIProviderSettingsModal.tsx` 加 "Remote HTTP" tab，填 baseUrl / apiKey / agentId 三个字段 | 1d | 持久化走现有 settings 体系 |
| E4 | OpenAI SSE 解析 + 映射到 `CLIEvent`（`text_chunk` / `turn_complete` / `error`） | 0.5d | OpenAI delta.content → CLIEvent.text_chunk |
| E5 | 错误展示：把 401/403/404 映射到用户能懂的中文提示 | 0.25d | |
| E6 | session 持久化：每个 workspace 文档生成一个稳定 session_id（建议 hash workspace+doc-id） | 0.5d | 让 Asgard/Gateway 的"短期记忆"在跨开关编辑器后还在 |
| E7 | "重新开始对话" 按钮 → 调 `DELETE /v1/agents/:id/sessions/:sid`（依赖 G8） | 0.25d | |
| E8 | 取消按钮：fetch `AbortController` 真正中断 SSE | 0.25d | 配合 Gateway G4 |

**editor 侧合计：约 4 天**。E1-E5 是"能用"，E6-E8 是"好用"。

## 5. 联调里程碑

```
M-A. Gateway 单测 + smoke 通过                       ← 已完成 (2026-04-28)
M-B. Gateway 把 P0 三项做完 (G1+G2+G10)              ← 1-2 天
M-C. Asgard 后端跑通 A1+A2+A3+A6+A7+A8                ← 3-4 天
M-D. editor HttpChatProvider 跑通 E1+E2+E3+E4         ← 2-3 天
M-E. 三方对接，端到端 demo（创建 → 聊天）            ← 0.5-1 天
M-F. 错误流 + 取消流 + 用量统计补齐                  ← 1-2 天
M-G. 上线前最后一公里：TLS、监控、Runbook            ← 1 天
```

**关键路径**：M-B（Gateway P0）→ M-C（Asgard 后端）→ M-E（联调）。M-D（editor）可以和 M-C 并行。

最快端到端 demo（M-E）大约在 M-B 完成后 5-6 天可达，全功能上线 9-12 天。

## 6. 暂缓项（不在本方案范围）

| 项 | 原因 | 计划 |
|----|------|------|
| editor 本地工具回调（read_file/write_file 等） | 需要双向通道，OpenAI SSE 单工架构跑不了 | v0.2 设计——见 docs/04 §3.5 |
| @Context 文件引用 | editor 把内容序列化进 message 即可工作，无需 Gateway 改 | editor 自决，v0.1 内可做 |
| 多模态（图片粘贴） | OpenAI message content blocks 改造 + nano-pencil ImageContent 已支持，需打通 | v0.1.1 |
| 持久向量记忆 | 只有 short-term，长篇创作记忆不够 | v0.2 |
| 用量计费精细化 | usage 字段 v0.1 多为 0，看 nano-pencil 后续暴露 | v0.1.1 |
| Gateway 发布 SDK 包 | 现在 Asgard 直接 fetch 也能用，SDK 是优化 | v0.1.1 |

## 7. 决策待定

1. **Asgard agent-id 命名**：建议 `asgard-{uuid}`，但要确认 Asgard 那边 user-facing id 和 Gateway internal id 的映射策略——是 1:1 还是 user 改了 name 就重建？建议 1:1，Soul/Memory 改走 PUT 不重建。
2. **多用户共用一个 Gateway agent**：当前 Gateway 是 per-agent 全局的，session 用 sessionId 隔离。如果同一个 PencilAgent 给两个 Asgard 用户用，他们的 session 不串台（因为 sessionId 不同），但**配额、Soul、模型都共享**。如果要 per-user 隔离，得让 Asgard 给每个 user 单独建一个 Gateway agent（`asgard-{user_id}-{agent_template_id}`）。建议默认走后者。
3. **Gateway 凭据来源**：是 Asgard 把 cloud key 传到 Gateway（BYO 模式，每 agent 独立），还是 Gateway 容器自己有一份默认 key（inherited 模式）？两种都支持，但要选一种作为产品默认。建议**inherited 模式 + Asgard env 注入**，简单且 key 不下发。

---

附：相关文档

- [02-api-contract.md](./02-api-contract.md) — Gateway HTTP 协议
- [04-asgard-editor-integration.md](./04-asgard-editor-integration.md) — 早期集成轮廓
- [05-caller-runtime.md](./05-caller-runtime.md) — caller 端契约
- [06-glossary.md](./06-glossary.md) — 术语
