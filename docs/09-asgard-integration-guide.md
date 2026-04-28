---
title: Asgard ↔ Pencil Agent Gateway 集成指南
status: active
scope: integration-guide-asgard
owner: pencil-agent-gateway maintainers
created: 2026-04-28
updated: 2026-04-28
---

# Asgard ↔ Pencil Agent Gateway 集成指南

## DIP Metadata

```text
[WHO]  Asgard 后端开发者、Gateway 维护者、nanopencil-editor 接入者
[FROM] Asgard 用户在平台上创建/启用一个 PencilAgent，并从 editor 或 OpenAI-compatible client 调用它
[TO]   Pencil Agent Gateway HTTP API；Gateway 内部托管的 PencilAgent 实例
[HERE] Asgard 如何把 PencilAgent 作为一种平台 Agent 类型接入；不是 MCP 集成，不 import Gateway/nano-pencil 代码
```

## 1. 定位

Pencil Agent Gateway 是 **PencilAgent serving 层**。它负责在一个 Node.js 服务里托管多个 PencilAgent 实例，并把每个实例暴露成 OpenAI-compatible model：

```text
PencilAgent = nano-pencil engine + extended Soul + memory + model

Asgard Platform
  -> Gateway POST /v1/agents
  -> Gateway creates/updates one PencilAgent instance
  -> model id = pencil/<gateway_agent_id>
```

Asgard 的定位不变：用户、API key、Marketplace、计费、权限、控制台、容器编排。Asgard **不通过 MCP** 创建或调用 PencilAgent；MCP 仍可作为 Asgard 现有旁路能力保留，但 editor 主链路走 OpenAI-compatible HTTP/SSE。

### 1.1 和现有 Asgard AgentEngine 的关系

Asgard 当前有内置 `AgentEngine` registry，例如 `asgard/code-refactor`、`asgard/hanhan-style`。接入 Gateway 后，Asgard 的 agent 执行层变成可路由后端：

| Asgard agent 类型 | `model` 形态 | 执行位置 | 说明 |
|---|---|---|---|
| 内置 AgentEngine | `asgard/code-refactor` | Asgard API 进程 | 现有实现，可继续存在 |
| PencilAgent | `pencil/<gateway_agent_id>` | Pencil Agent Gateway | 新增类型，Asgard 只做鉴权和反代 |
| MCP Tool | tool name | Asgard MCP server | 旁路协议，不参与本方案 |

因此 Asgard 不需要把 nano-pencil 装进 FastAPI，也不需要在 `app/mcp` 下接 Gateway。正确边界是新增一个 `PencilAgentBackend` HTTP client，并在 `/v1/chat/completions` 里按 `model` 或 DB `agent_type` 路由。

## 2. 核心约束

1. **Asgard 是主存，Gateway 是运行副本**
   - Soul、memory、model、owner、权限存在 Asgard DB。
   - Gateway 持久化 `agents/*.json` 是运行副本和重启恢复用，不是业务主数据。

2. **Asgard 创建 Gateway agent-id**
   - 推荐 `asgard-u_<user_uuid>-tpl_<template_id>` 或 `asgard-<user_uuid>-<agent_uuid>`。
   - user-facing name 可以改，`gateway_agent_id` 不改。
   - 同一用户的一个 PencilAgent 对应 Gateway 里的一个 PencilAgent 实例。

3. **默认 per-user agent，不共享运行实例**
   - 不同用户即使启用同一个模板，也各自创建一个 Gateway agent。
   - 这样 Soul 个性化、配额、审计、未来 memory 都不会串。

4. **editor 永远只看 Asgard**
   - editor 配置 `Asgard baseUrl + Asgard user-key + agent-id`。
   - Gateway internal key 只存在 Asgard backend 和 Gateway 之间。

5. **凭据默认走 inherited 模式**
   - Asgard 不把 cloud provider key 存 DB，也不下发到 editor。
   - Gateway 容器通过 `/root/.nanopencil/auth.json` 或 provider env 拿默认凭据。
   - BYO key 只作为企业/隔离部署的后续模式。

## 3. Asgard 侧数据模型

当前 `Asgard-api/app/models.py` 已有：

- `Agent.agent_id`
- `Agent.parameters`
- `APIKey`
- `UsageLog`

最小接入可以复用 `agents` 表，把 PencilAgent 作为一种 `agent_type` 存在 `parameters` 里：

```json
{
  "agent_type": "pencil-agent",
  "gateway_agent_id": "asgard-u_42-tpl_writer",
  "soul": {
    "systemPrompt": "你是小铅笔，专注帮用户做长篇小说创作。",
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
  "gateway_status": "ready",
  "last_synced_at": "2026-04-28T00:00:00Z"
}
```

如果要做得更干净，建议新增两张表：

```sql
CREATE TABLE pencil_agent_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_soul TEXT NOT NULL,
  default_memory_max_turns INT NOT NULL DEFAULT 30,
  default_provider TEXT,
  default_model TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE pencil_user_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  template_id TEXT REFERENCES pencil_agent_templates(id),
  gateway_agent_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  soul_prompt TEXT NOT NULL,
  memory_max_turns INT NOT NULL DEFAULT 30,
  model_provider TEXT,
  model_name TEXT,
  status TEXT NOT NULL DEFAULT 'syncing',
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

无论复用还是新表，Asgard 必须能回答两个问题：

- 当前 user-key 是否能调用 `pencil/<gateway_agent_id>`？
- 当前 Asgard agent 的 Soul/Memory/Model 同步到 Gateway 了吗？

## 4. 配置

Asgard API 增加：

```python
class Settings(BaseSettings):
    pencil_gateway_url: str = "http://pencil-gateway:8080"
    pencil_gateway_internal_key: str = ""
    pencil_gateway_connect_timeout_s: float = 5.0
    pencil_gateway_read_timeout_s: Optional[float] = None
```

Gateway 增加一把 internal API key，例如 `config/default.yaml`：

```yaml
auth:
  keys:
    - key: pk_internal_asgard
      label: asgard-internal
      allowedAgents: ["*"]
```

所有 Asgard -> Gateway 请求都带：

```http
Authorization: Bearer ${PENCIL_GATEWAY_INTERNAL_KEY}
X-Request-Id: <uuid>
X-Asgard-User: <asgard user id>
X-Asgard-Agent: <gateway_agent_id>
```

这些 header 是审计和串日志用；Gateway v0.1 不用 `X-Asgard-*` 做鉴权，鉴权仍靠 internal key。

## 5. 创建 PencilAgent

### 5.1 Asgard API 流程

```text
User clicks "Create PencilAgent"
  -> Asgard validates template/model/soul
  -> Asgard creates DB row status=syncing
  -> Asgard POSTs /v1/agents to Gateway
  -> Gateway creates AgentInstance + NanoPencilEngineAdapter
  -> Asgard marks DB row status=ready
  -> Asgard returns agent_id/user-key instructions to UI/editor
```

### 5.2 Gateway 请求

```http
POST http://pencil-gateway:8080/v1/agents
Authorization: Bearer pk_internal_asgard
Content-Type: application/json
X-Request-Id: req_123
X-Asgard-User: u_42
X-Asgard-Agent: asgard-u_42-tpl_writer
```

```json
{
  "id": "asgard-u_42-tpl_writer",
  "name": "小铅笔",
  "soul": {
    "systemPrompt": "你是小铅笔，专注帮用户做长篇小说创作。",
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
  "engine": {
    "type": "nano-pencil"
  }
}
```

返回：

```json
{
  "id": "asgard-u_42-tpl_writer",
  "modelId": "pencil/asgard-u_42-tpl_writer",
  "status": "ready"
}
```

### 5.3 幂等和失败处理

`POST /v1/agents` 在 Gateway v0.1 是 create-or-replace。同 id 重试是安全的，但会 dispose 旧 engine。Asgard 创建流程应这样处理：

```python
async def create_pencil_agent(user, template, body):
    gateway_agent_id = f"asgard-u_{user.uuid}-tpl_{template.id}"

    row = await db.insert_agent(
        agent_id=f"pencil/{gateway_agent_id}",
        agent_type="pencil-agent",
        status="syncing",
        parameters={...},
    )

    try:
        await pencil_gateway.create_agent(...)
    except Exception as exc:
        await db.mark_agent_status(row.id, "error", str(exc))
        raise

    await db.mark_agent_status(row.id, "ready")
    return row
```

失败后不要删除 DB row；保留 `status=error`，让用户重试同步，避免生成新 id 导致旧配置孤儿化。

## 6. Chat 路由

Asgard 当前 `/v1/chat/completions` 已经做了 API key、Agent DB 查询、quota 和内置 engine 调用。接入 Gateway 时，改成按 agent 类型分发：

```python
@router.post("/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    raw: Request,
    api_key: APIKey = Depends(get_api_key_from_header),
    db: AsyncSession = Depends(get_db),
):
    agent = await load_agent_for_model(db, request.model)
    user = await load_user(db, api_key.user_id)
    enforce_quota(api_key, request)
    enforce_user_can_call(api_key, agent)

    if is_pencil_agent(agent):
        return await pencil_gateway.proxy_chat(
            request=raw,
            body=request.model_dump(exclude_none=True),
            user=user,
            agent=agent,
            api_key=api_key,
        )

    return await run_builtin_agent_engine(request, agent, api_key)
```

`is_pencil_agent` 可以先判断：

```python
request.model.startswith("pencil/")
# 或 Agent.parameters["agent_type"] == "pencil-agent"
```

建议最终以 DB 为准：`model` 只是 caller 输入，DB 才是平台内 agent 类型和权限来源。

## 7. SSE 反向代理

Asgard 对 PencilAgent 的 chat 请求本质是 reverse proxy。流式响应不要解析，不要用 `EventSourceResponse` 重新包装成新的事件流；直接透传 Gateway 的 bytes。

```python
import httpx
from starlette.background import BackgroundTask
from fastapi.responses import StreamingResponse, JSONResponse

class PencilAgentBackend:
    def __init__(self, settings):
        self.client = httpx.AsyncClient(
            base_url=settings.pencil_gateway_url,
            timeout=httpx.Timeout(
                connect=settings.pencil_gateway_connect_timeout_s,
                read=settings.pencil_gateway_read_timeout_s,
                write=30.0,
                pool=30.0,
            ),
        )
        self.internal_key = settings.pencil_gateway_internal_key

    def gateway_headers(self, request, user, gateway_agent_id):
        return {
            "Authorization": f"Bearer {self.internal_key}",
            "Content-Type": "application/json",
            "X-Request-Id": request.headers.get("x-request-id") or new_request_id(),
            "X-Asgard-User": str(user.uuid),
            "X-Asgard-Agent": gateway_agent_id,
        }

    async def proxy_chat(self, request, body, user, agent, api_key):
        gateway_agent_id = agent.parameters["gateway_agent_id"]
        body["model"] = f"pencil/{gateway_agent_id}"

        headers = self.gateway_headers(request, user, gateway_agent_id)

        if body.get("stream"):
            upstream = await self.client.send(
                self.client.build_request(
                    "POST",
                    "/v1/chat/completions",
                    json=body,
                    headers=headers,
                ),
                stream=True,
            )
            return StreamingResponse(
                upstream.aiter_raw(),
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type", "text/event-stream"),
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                    "X-Request-Id": headers["X-Request-Id"],
                },
                background=BackgroundTask(upstream.aclose),
            )

        upstream = await self.client.post(
            "/v1/chat/completions",
            json=body,
            headers=headers,
        )
        try:
            payload = upstream.json()
        except Exception:
            payload = {"error": {"message": upstream.text}}
        return JSONResponse(payload, status_code=upstream.status_code)
```

SSE 四条硬规则：

1. 用 `aiter_raw()`，不要 `aiter_lines()`。
2. 关闭代理缓冲：`X-Accel-Buffering: no`，nginx/Caddy 也要关。
3. `read_timeout` 设为 `None` 或足够长；模型可能长时间不吐 token。
4. status code 保真透传；body 可以映射成 Asgard 错误结构，但不要把 404/422 都变成 500。

## 8. `/v1/models`

editor 和 OpenAI-compatible client 通常会调用 `/v1/models`。Asgard 应返回当前 user-key 可见的模型集合：

```json
{
  "object": "list",
  "data": [
    {
      "id": "pencil/asgard-u_42-tpl_writer",
      "object": "model",
      "created": 1714000000,
      "owned_by": "asgard"
    }
  ]
}
```

实现方式：

- 内置 Asgard Agent 继续返回 `asgard/...`。
- PencilAgent 返回 `pencil/<gateway_agent_id>`。
- 不直接把 Gateway `/v1/models` 全量暴露给用户；Asgard 必须按当前 user-key/用户权限过滤。

## 9. editor 集成入口

editor 只需要三项：

```text
Asgard Base URL: https://asgard.example.com
API Key:         asgard_xxx
Agent ID:        asgard-u_42-tpl_writer
```

editor 请求 Asgard：

```json
{
  "model": "pencil/asgard-u_42-tpl_writer",
  "messages": [
    { "role": "user", "content": "继续写第三章。" }
  ],
  "stream": true,
  "session_id": "workspace_doc_1"
}
```

Asgard 校验 user-key 后，把 `Authorization` 换成 Gateway internal key，再转发给 Gateway。editor 不知道 Gateway URL，也不持有 Gateway key。

更多 editor 侧实现见 [10-editor-integration-guide.md](./10-editor-integration-guide.md)。

## 10. Gateway 当前能力和缺口

当前 Gateway 已有：

- `POST /v1/agents`
- `GET /v1/agents`
- `DELETE /v1/agents/:id`
- `GET /v1/models`
- `POST /v1/chat/completions`
- SSE streaming
- API key allowedAgents
- `@pencil-agent/nano-pencil` adapter
- per-agent/per-session in-memory isolation

上线前必须确认或补齐：

| 项 | 状态 | 对 Asgard 的影响 |
|---|---|---|
| `soul.systemPrompt` 注入 nano-pencil session | 待确认/待补 | 不补则 Asgard 创建 Soul 没效果 |
| `temperature` / `max_tokens` 传给 SDK | 待补 | UI 参数会被忽略 |
| request abort 传给 nano-pencil | 待补 | editor 停止后模型可能继续跑 |
| `usage` 返回真实 token | 待补 | 计费先只能估算或记 0 |
| `GET /v1/agents/:id` | 待补 | Asgard 可先用 list 过滤 |
| `PUT /v1/agents/:id` | 待补 | 更新 Soul/Memory 暂用 POST replace，会丢运行时 session |
| session delete API | 待补 | editor “重新开始对话”先换新 `session_id` |

P0：Soul 注入、参数传递、SSE 反代、容器部署。其余可以排 v0.1.1。

## 11. 错误映射

Gateway 返回 OpenAI-compatible error shape：

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "agent_not_found",
    "message": "Agent instance 'pencil/unknown' not found"
  }
}
```

Asgard 建议映射：

| Gateway HTTP | Gateway code | Asgard 处理 |
|---|---|---|
| 401 | `unauthorized` | Asgard internal key 配错；告警，不暴露细节 |
| 403 | `forbidden_agent` | internal key scope 配错或 agent 越权；告警 |
| 404 | `agent_not_found` | 标记 agent `missing`，提示用户重新同步 |
| 408 | `client_cancelled` | 正常取消，不计费 |
| 409 | `agent_conflict` | 幂等重试；必要时重新同步 |
| 422 | `unsupported_feature` | editor/client 请求字段不支持 |
| 500 | `engine_error` | 模型或 nano-pencil 运行失败；message 可给用户动作线索 |

## 12. 部署拓扑

推荐 v0.1：

```text
Internet
  -> Asgard ingress / Caddy / nginx
      -> asgard-web
      -> asgard-api
          -> pencil-agent-gateway (internal network only)
              -> nano-pencil SDK
              -> model provider
```

Gateway、Postgres、provider key 都不直接暴露给公网。`PENCIL_GATEWAY_INTERNAL_KEY` 只在 Asgard API secret 和 Gateway config 中出现。

Gateway 凭据：

```yaml
services:
  pencil-gateway:
    image: pencil-agent-gateway:0.1
    volumes:
      - gateway-data:/data
      - ./secrets/nanopencil-auth.json:/root/.nanopencil/auth.json:ro
    environment:
      DATA_DIR: /data
      LOG_LEVEL: info
```

详细容器方案见 [11-containerized-deployment.md](./11-containerized-deployment.md)。

## 13. Asgard 实施清单

```text
□ 配置：PENCIL_GATEWAY_URL / PENCIL_GATEWAY_INTERNAL_KEY
□ 新增 PencilAgentBackend（httpx AsyncClient，create_agent/proxy_chat/list_models）
□ Agent DB 增加 pencil-agent 类型和 gateway_agent_id/soul/memory/model 参数
□ 创建 PencilAgent 流程：DB status=syncing -> Gateway POST /v1/agents -> status=ready
□ /v1/chat/completions 按 agent type 路由；pencil-agent 走 Gateway proxy
□ /v1/models 返回当前 user-key 可见的 asgard/* + pencil/* 模型
□ SSE 透传使用 StreamingResponse + aiter_raw + X-Accel-Buffering: no
□ user-key 权限检查覆盖 pencil/<gateway_agent_id>
□ UsageLog 先记录估算 token/成本；Gateway usage 补齐后改为真实 usage
□ 错误码映射并保留 X-Request-Id 串日志
□ editor 只配置 Asgard URL、Asgard user-key、agent-id
□ MCP 文档标注为旁路能力，不作为 PencilAgent 创建/调用链路
```

## 14. curl 联调

Asgard 先直连 Gateway 验证创建：

```bash
curl -sS -X POST "$PENCIL_GATEWAY_URL/v1/agents" \
  -H "Authorization: Bearer $PENCIL_GATEWAY_INTERNAL_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Asgard-User: u_42" \
  -H "X-Asgard-Agent: asgard-u_42-tpl_writer" \
  -d '{
    "id":"asgard-u_42-tpl_writer",
    "name":"小铅笔",
    "soul":{"systemPrompt":"你是小铅笔，专注帮用户写作。"},
    "memory":{"mode":"short-term","maxTurns":30},
    "model":{"provider":"anthropic","name":"claude-sonnet-4-5-20250929"},
    "engine":{"type":"nano-pencil"}
  }'
```

再通过 Asgard 对外 API 验证 editor 同款请求：

```bash
curl -N -X POST "https://asgard.example.com/v1/chat/completions" \
  -H "Authorization: Bearer $ASGARD_USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"pencil/asgard-u_42-tpl_writer",
    "messages":[{"role":"user","content":"继续写第三章。"}],
    "stream":true,
    "session_id":"workspace_doc_1"
  }'
```

通过条件：

- Gateway logs 有同一个 `X-Request-Id`。
- Asgard 不解析 SSE，终端能持续收到 `data:` chunk。
- `model` 始终是 `pencil/<gateway_agent_id>`。
- editor 不需要知道 Gateway URL。

