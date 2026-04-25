---
title: Pencil Agent Gateway 开发计划
status: active
scope: implementation-plan
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Pencil Agent Gateway 开发计划

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway 开发者与代码审查者
[FROM] Caller 接入需求（nanoPencil CLI / editor / Asgard / 3rd-party）、产品边界文档、生态路线图
[TO]   可托管 PencilAgent 实例并对外提供 HTTP/SDK 调用的 Node.js + Hono Gateway、Docker 镜像、OpenAI-compatible API
[HERE] 本文拆分工程任务、里程碑、验收标准和延期项
```

## 1. 总目标

构建一个独立仓库、独立镜像、可自托管、可被 Asgard 管理的 Agent HTTP serving 层，托管 PencilAgent 实例。

v0.1 的成功标准：

1. 任意 caller（nanoPencil CLI / editor / Asgard / 3rd-party）可以通过 HTTP 或 SDK 调用一个目标 PencilAgent。
2. 用户可以通过 Docker 启动 Gateway。
3. 用户可以用 OpenAI SDK 调用 `/v1/chat/completions`。
4. Gateway 可以根据 `model: pencil/<agent-id>` 路由到不同 PencilAgent 实例。
5. 每个 PencilAgent 实例有独立 Soul、model、short-term memory。
6. Asgard 可以通过 HTTP 创建/查询 PencilAgent 并转发对话。
7. nanopencil-editor 可以新增 `HttpChatProvider` 接入 Gateway。

## 2. 功能总览

### 2.1 v0.1 必做

| 模块 | 功能 | 优先级 |
|------|------|--------|
| Server | Hono app、启动配置、错误处理中间件 | P0 |
| Health | `/healthz`、`/readyz` | P0 |
| Auth | Bearer API Key、allowedAgents | P0 |
| Protocol | OpenAI request/response schema | P0 |
| Chat | `/v1/chat/completions` 非流式 | P0 |
| Streaming | SSE chunks、`[DONE]` | P0 |
| Models | `/v1/models` | P0 |
| Agents | `GET/POST/DELETE /v1/agents` | P0 |
| Config | env + YAML/JSON config loading | P0 |
| Store | file-backed agent/session store | P0 |
| Engine | `EngineAdapter` 抽象 | P0 |
| Nano adapter | `NanoPencilEngineAdapter` | P0 |
| Memory | short-term memory by session | P1 |
| Docker | Dockerfile、compose example | P1 |
| Examples | curl + OpenAI SDK examples | P1 |
| Tests | route/auth/protocol/registry unit tests | P1 |
| Docs | README + API contract + deployment guide | P1 |

### 2.2 v0.2 计划

| 模块 | 功能 |
|------|------|
| Tool callback | 自定义 SSE `tool_request` + HTTP/WS `tool_response` |
| Persistent memory | file/SQLite memory profiles |
| Thinking event | optional trace/thinking stream |
| Usage event | token usage normalization |
| Observability | structured logs + request id + trace hooks |
| Asgard contract | internal headers + usage callback |

### 2.3 v0.3 计划

| 模块 | 功能 |
|------|------|
| Multi-container | Asgard 按用户/Agent 启独立容器 |
| Storage adapter | SQLite/Postgres/object storage |
| Multiple engines | 支持非 nano-pencil EngineAdapter |
| Channel Gateway | 对接独立 `pencil-channel-gateway` |
| Admin API hardening | scoped API Keys、audit log、rate limit |

## 3. 里程碑拆分

### M0：仓库基础设施

任务：

- 创建 `package.json`
- 创建 `tsconfig.json`
- 创建 `src/server.ts`
- 创建 `src/app.ts`
- 创建 `src/util/logger.ts`
- 创建 `src/util/errors.ts`
- 配置 `tsx` 或等价 dev runner
- 配置 Vitest
- 配置 TypeScript strict
- 创建 `.gitignore`
- 创建 `Dockerfile` 占位
- 创建 `config/default.yaml`

验收：

- `npm install` 成功。
- `npm run dev` 启动 Hono server。
- `GET /healthz` 返回 200。
- `npm test` 可运行。

### M1：配置加载与运行时上下文

任务：

- 定义 `GatewayConfig`
- 定义 `ApiKeyConfig`
- 定义 `AgentConfig`
- 支持 `${ENV_NAME}` 环境变量插值
- 支持 `GATEWAY_CONFIG` 指定配置文件
- 支持 `PORT` / `HOST`
- 支持 `DATA_DIR`
- 配置校验失败时输出清晰错误
- 增加 `GET /readyz` 检查配置是否可用

验收：

- 缺少必填配置时启动失败。
- env 插值可替换 provider API key。
- 默认配置能启动。

### M2：认证与权限

任务：

- 解析 `Authorization: Bearer <key>`
- API Key 支持 `label`
- API Key 支持 `allowedAgents`
- 未认证返回 OpenAI-compatible error
- 无权限访问 agent 返回 `403`
- health endpoints 不要求鉴权
- 内部请求可带 `X-Asgard-User`，只记录不鉴权
- 增加认证单元测试

验收：

- 无 key 无法访问 `/v1/models`
- 错 key 返回 401
- key 不在 allowedAgents 中返回 403
- `allowedAgents: ["*"]` 可访问所有实例

### M3：Agent Registry

任务：

- 创建 `AgentInstance`
- 创建 `AgentRegistry`
- 实现 `pencil/<id>` 到 instance 的映射
- 支持 `GET /v1/agents`
- 支持 `POST /v1/agents`
- 支持 `DELETE /v1/agents/:id`
- 支持实例配置落盘
- 支持启动时从配置文件加载实例
- 支持 runtime 创建实例后立即出现在 `/v1/models`

验收：

- 创建 `writing-assistant` 后，`/v1/models` 包含 `pencil/writing-assistant`
- 删除实例后，chat 请求返回 `agent_not_found`
- 重启后文件中实例可恢复

### M4：OpenAI Protocol

任务：

- 定义 `ChatCompletionRequest`
- 定义 `ChatCompletionResponse`
- 定义 `ChatCompletionChunk`
- 定义 `ModelListResponse`
- 定义 `OpenAIErrorResponse`
- 支持 `messages`
- 支持 `model`
- 支持 `stream`
- 支持 `temperature`
- 接收但忽略 `tools`
- 接收但忽略 `tool_choice`
- `n != 1` 返回不支持错误
- `response_format` 非默认返回不支持错误

验收：

- OpenAI Node SDK 能发起请求。
- 非法请求返回稳定错误结构。
- schema 单元测试覆盖核心字段。

### M5：Chat 非流式主链

任务：

- 建立 `EngineAdapter` 接口
- 建立 `EngineRunRequest`
- 建立 `EngineRunResult`
- 实现临时 `MockEngineAdapter`
- 实现 `POST /v1/chat/completions`
- 将 `system`/`user`/`assistant` messages 传入 engine
- 将 engine final text 映射成 OpenAI response
- 生成 `chatcmpl-*` id
- 支持 `session_id` 扩展字段或 `X-Pencil-Session`

验收：

- curl 非流式返回 OpenAI-compatible JSON。
- session 隔离可用。
- Mock engine 测试通过。

### M6：SSE 流式主链

任务：

- 实现 SSE writer
- 实现 chunk serializer
- 每个 text delta 输出 `choices[0].delta.content`
- 结束输出 `finish_reason: stop`
- 最后输出 `data: [DONE]`
- 错误时按 OpenAI SSE 风格输出 error 或终止
- 支持 client abort
- 支持 request timeout

验收：

- `curl -N` 能看到增量输出。
- OpenAI Node SDK stream 模式可消费。
- client abort 后 engine run 被取消。

### M7：nano-pencil EngineAdapter

任务：

- 添加 `@pencil-agent/nano-pencil` 依赖
- 封装 `NanoPencilEngineAdapter`
- 只在 adapter 内部接触 nano-pencil SDK API
- 将 AgentConfig 转换为 nano-pencil run config
- 将 nano-pencil text events 转为 gateway delta
- 将 turn complete 转为 finish
- 将 error 转为 OpenAI error
- adapter API 不稳定时加兼容层

验收：

- 使用真实模型可完成一轮对话。
- stream 和 non-stream 都可用。
- 升级 nano-pencil 时只需要改 adapter 层。

### M8：短期记忆

任务：

- 定义 `SessionStore`
- 定义 `SessionRecord`
- 默认 session id 生成策略
- 支持 body `session_id`
- 支持 header `X-Pencil-Session`
- 保存最近 N 轮 messages
- 每个 Agent 独立 session namespace
- `memory.maxTurns` 控制上下文长度
- 文件结构写入 `/data/sessions/<agent-id>/<session-id>.jsonl`

验收：

- 同一 session 能记住上一轮。
- 不同 session 互不污染。
- 不同 Agent 互不污染。

### M9：Docker 与自托管

任务：

- 多阶段 Dockerfile
- `.dockerignore`
- `docker-compose.example.yml`
- volume: `/app/config`
- volume: `/app/data`
- env: `API_KEYS`
- env: provider API keys
- healthcheck
- README 自托管示例

验收：

- `docker build` 成功。
- `docker run` 后 `/healthz` 可访问。
- 挂载 config/data 后实例持久化。

### M10：Asgard 接入契约

任务：

- 定义 Asgard 内部 headers
- 支持 `X-Asgard-User`
- 支持 `X-Asgard-Agent`
- 支持 `X-Request-Id`
- 文档化 `PencilAgentBackend` 需要的配置
- 文档化 Asgard 创建 Agent 时调用 `/v1/agents`
- 文档化 Asgard chat 转发到 `/v1/chat/completions`
- 约定 usage 回传推迟到 v0.2

验收：

- Asgard 只需要 gateway URL + internal API key 即可调用。
- Gateway 不依赖 Asgard 数据库。

### M11：nanopencil-editor 接入契约

任务：

- 确定 URL 配置项
- 确定 API Key 配置项
- 确定 model/agent 选择方式
- 确定 SSE delta 映射到 ChatProvider event
- 确定错误映射
- 确定取消请求行为
- 文档化 v0.1 无 tool callback 限制

验收：

- editor 可配置 Gateway URL。
- editor 可流式显示回复。
- editor 能处理 401/403/404/5xx。

### M12：测试与质量门禁

任务：

- API schema tests
- auth tests
- registry tests
- store tests
- SSE serialization tests
- mock engine route tests
- nano adapter smoke test（可跳过真实 key）
- Docker build CI
- TypeScript strict check

验收：

- PR 必须通过 `npm test`
- PR 必须通过 `npm run typecheck`
- API contract 变化必须更新 docs

## 4. 推荐实现顺序

```text
M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8 -> M9 -> M10 -> M11 -> M12
```

不要先接真实 nano-pencil SDK。先用 `MockEngineAdapter` 把 HTTP contract 固定，再替换底层 engine。

### 4.1 工时估算

估算单位以一个熟悉 Node.js + Hono 的开发者全天工作为标准；接入真实模型/真实 nano-pencil 时按实际等待算入 M7。

| 里程碑 | 估算 | 说明 |
|--------|------|------|
| M0 仓库基础设施 | 0.5 天 | 项目骨架、Hono hello-world、Vitest 配置 |
| M1 配置加载与运行时上下文 | 0.5 天 | env 插值、`/readyz`、配置校验 |
| M2 认证与权限 | 0.5 天 | API Key 中间件、allowedAgents、单元测试 |
| M3 Agent Registry | 1 天 | 实例 CRUD、文件落盘、`/v1/models` |
| M4 OpenAI Protocol | 0.5 天 | 类型与校验，纯 schema 工作 |
| M5 Chat 非流式主链 | 0.5 天 | 含 `MockEngineAdapter` |
| M6 SSE 流式主链 | 1 天 | 含取消/超时；多端兼容性测试 |
| M7 nano-pencil EngineAdapter | 1 天 | SDK 接入与事件映射，依赖真实 key |
| M8 短期记忆 | 0.5 天 | 文件结构 + 取舍策略 |
| M9 Docker 与自托管 | 0.5 天 | 多阶段镜像、healthcheck、compose 样例 |
| M10 Asgard 接入契约 | 0.5 天 | 主要是文档 + 头部约定 |
| M11 nanopencil-editor 接入契约 | 0.5 天 | 主要是文档；编辑器侧改动在该项目里完成 |
| M12 测试与质量门禁 | 1 天 | 串测、CI、文档对齐 |
| **合计** | **8.5 天** | M0–M9 的端到端最小闭环约 6 天 |

时长是单兵估算，并行/Review/集成 buffer 自行加 30–50%。

## 5. 版本切分

| 版本 | 内容 |
|------|------|
| v0.1.0 | OpenAI chat、SSE、API Key、Agent registry、short-term memory、nano-pencil adapter、Docker |
| v0.1.1 | Asgard integration hardening、editor integration fixes、structured logs、better errors |
| v0.2.0 | tool callback、persistent memory、thinking/trace events、usage reporting hooks |
| v0.3.0 | storage adapters、multiple engine adapters、Asgard per-agent container mode |

## 6. 暂缓项

| 项 | 暂缓原因 |
|----|----------|
| Channel adapters | 会污染 Agent serving MVP，另拆项目 |
| Workflow runtime | 属于平台/编排，不属于 Gateway v0.1 |
| Vector memory | 太重，先短期记忆 |
| Full OpenAI tools | 需要 tool callback，v0.2 再做 |
| Web Console | Asgard 提供 UI |
| Multi-tenant user system | Asgard 提供 |

## 7. 完成定义

v0.1 完成必须同时满足：

- OpenAI SDK 可调用 Gateway。
- Docker 镜像可自托管。
- 多 Agent 实例可创建和调用。
- 不同 API Key 可限制实例访问。
- Gateway 能接入真实 nano-pencil SDK。
- Asgard 可通过 HTTP proxy 调用。
- editor 可通过 HTTP provider 流式显示。
