---
title: nanopencil-editor ↔ Pencil-Agent-Gateway 最小集成指南
status: active
scope: editor-gateway-minimal-integration
owner: pencil-agent-gateway maintainers
created: 2026-05-03
updated: 2026-05-03
---

# nanopencil-editor ↔ Pencil-Agent-Gateway 最小集成指南

## DIP Metadata

```text
[WHO]  nanopencil-editor 前端 / 桌面端开发者，以及只想先部署 Gateway 的集成者
[FROM] editor 用户在设置面板配置 "remote-http" 服务模式
[TO]   Pencil Agent Gateway（OpenAI-compatible HTTP + SSE）
[HERE] 不经过 Asgard 的最小 editor-gateway-integration：先让 editor 通过 HTTP 调用 PencilAgent
```

## 1. 当前目标

这份文档只覆盖最小可用链路：

```text
nanopencil-editor
  -> HTTP/SSE
Pencil-Agent-Gateway
  -> nano-pencil AgentSession
  -> 模型供应商
```

本阶段不接 Asgard，不做平台账号、商城、计费、用户级 agent 管理，也不需要 Asgard 反向代理。用户只要部署 `Pencil-Agent-Gateway`，在 Gateway 里创建一个 PencilAgent，然后让 editor 用 HTTP 调用它。

已有 [10-editor-integration-guide.md](./10-editor-integration-guide.md) 是 Asgard 版方案，核心前提是 "editor 永远只看到 Asgard"。这个前提对当前最小集成不成立；本指南是从那个方案里拆出的直连 Gateway 版本。

## 2. 集成边界

### 2.1 本阶段要做

- editor 新增或复用 `remote-http` 模式。
- `HttpChatProvider` 直接请求 Gateway 的 OpenAI-compatible API。
- Gateway 负责 API Key 鉴权、PencilAgent 路由、SSE 流式输出、短期 session 记忆。
- editor 只消费文本流，把 OpenAI SSE 映射回现有 `CLIEvent`。
- `session_id` 由 editor 生成并稳定传给 Gateway。

### 2.2 本阶段不做

- 不接 Asgard API / Asgard-web / Asgard DB。
- 不使用 Asgard user-key；这里用 Gateway 自己的 `Authorization: Bearer <api-key>`。
- 不做多租户权限模型；Gateway 的 `apiKeys[].allowedAgents` 只做最小 agent 访问控制。
- 不做 editor 本地工具回调。OpenAI SSE 是单向文本流，不够承载本地 `read_file` / `write_file` 确认流程。
- 不要求 editor 持久化完整对话历史。服务端按 `session_id` 维护短期上下文。

## 3. 最小部署步骤

### 3.1 启动 Gateway

开发环境：

```bash
cd Pencil-Agent-Gateway
npm install
npm run dev
```

默认监听：

```text
http://localhost:8080
```

检查健康状态：

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

默认开发 API Key 来自 `config/default.json`：

```text
pk_dev_default
```

生产环境必须换成自定义 key，并把 editor 可用的 key 限制到需要的 agent：

```json
{
  "apiKeys": [
    {
      "key": "pk_editor_xxx",
      "label": "editor-local",
      "allowedAgents": ["pencil/writing-assistant"]
    }
  ]
}
```

### 3.2 配置模型凭据

Gateway 有两种运行方式：

| 模式 | 适合场景 | 做法 |
|---|---|---|
| Inherited | 本机已有 nano-pencil 登录态 | 让 Gateway 使用宿主机 `~/.nanopencil/` 和已选模型 |
| BYO-key | 容器或独立部署 | 创建 agent 时在 `model.apiKey` 里传供应商 key |

最小联调推荐先用 Inherited，减少变量。如果 Gateway 容器里没有 nano-pencil 登录态，再用 BYO-key。

### 3.3 创建 PencilAgent

Inherited 模式：

```bash
curl -X POST http://localhost:8080/v1/agents \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "writing-assistant",
    "name": "Writing Assistant",
    "soul": {
      "systemPrompt": "You are a careful writing assistant."
    },
    "memory": {
      "mode": "short-term",
      "maxTurns": 20
    }
  }'
```

BYO-key 模式：

```bash
curl -X POST http://localhost:8080/v1/agents \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "writing-assistant",
    "name": "Writing Assistant",
    "soul": {
      "systemPrompt": "You are a careful writing assistant."
    },
    "memory": {
      "mode": "short-term",
      "maxTurns": 20
    },
    "model": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-6",
      "apiKey": "sk-ant-..."
    }
  }'
```

确认 agent 已注册：

```bash
curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer pk_dev_default"
```

期望包含：

```json
{
  "id": "pencil/writing-assistant",
  "object": "model"
}
```

### 3.4 验证 Gateway 流式输出

```bash
curl -N -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/writing-assistant",
    "messages": [
      {"role": "user", "content": "写一个两句话的悬疑开头"}
    ],
    "stream": true,
    "session_id": "editor_smoke_001"
  }'
```

期望输出形如：

```text
data: {"id":"chatcmpl_...","object":"chat.completion.chunk",...,"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl_...","object":"chat.completion.chunk",...,"choices":[{"delta":{"content":"..."},"finish_reason":null}]}

data: {"id":"chatcmpl_...","object":"chat.completion.chunk",...,"choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

## 4. editor 侧配置模型

### 4.1 用户可见字段

设置面板里 `remote-http` 只需要这三个字段：

| 字段 | 示例 | 说明 |
|---|---|---|
| Gateway Base URL | `http://localhost:8080` | 直连 Gateway；不是 Asgard URL |
| Gateway API Key | `pk_dev_default` | Gateway `apiKeys` 中配置的 key |
| Agent ID | `writing-assistant` | 不带 `pencil/` 前缀，provider 内部补齐 |

字段校验：

- `baseUrl` 必须是 `http://` 或 `https://` URL，保存时去掉末尾 `/`。
- `apiKey` 非空；生产 key 建议遮码显示。
- `agentId` 建议匹配 `^[a-zA-Z0-9_-]+$`。

### 4.2 `HttpChatProviderConfig`

```ts
export interface HttpChatProviderConfig {
  baseUrl: string;      // e.g. "http://localhost:8080"
  apiKey: string;       // Gateway API Key
  agentId: string;      // e.g. "writing-assistant"; 不带 "pencil/"
  timeoutMs?: number;   // 默认 120_000
  fetchImpl?: typeof fetch;
}
```

### 4.3 测试连接

设置面板的 "测试连接" 按钮直接调 Gateway：

```ts
async function testConnection(cfg: HttpChatProviderConfig) {
  const baseUrl = cfg.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });

  if (!res.ok) {
    return { ok: false, message: `Gateway HTTP ${res.status}` };
  }

  const json = await res.json();
  const modelId = `pencil/${cfg.agentId}`;
  const found = (json.data || []).some((m: any) => m.id === modelId);

  return {
    ok: found,
    message: found ? `已找到 ${modelId}` : `Gateway models 中没有 ${modelId}`,
  };
}
```

如果 Web 版 editor 直接从浏览器访问 Gateway，Gateway 需要开启 CORS。开发时可以配置：

```text
GATEWAY_CORS_ORIGINS=*
```

桌面 Tauri 环境通常不受浏览器同源策略限制，但保持 CORS 配置能让 Web 构建和本地调试少踩坑。

## 5. `HttpChatProvider` 请求契约

### 5.1 发起一轮聊天

每次只发送本轮用户输入和稳定 `session_id`：

```ts
const res = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: `pencil/${agentId}`,
    messages: [{ role: 'user', content: text }],
    stream: true,
    session_id: sessionId,
  }),
  signal: abortController.signal,
});
```

不要把完整 UI 历史每轮重传给 Gateway。Gateway 的 AgentSession 会按 `session_id` 维护短期上下文；editor 重传完整历史会造成重复记忆和 token 浪费。

### 5.2 SSE 映射

editor 只需要处理 OpenAI-compatible chunk：

| Gateway SSE | editor 事件 |
|---|---|
| `choices[0].delta.content` | `CLIEvent` 的 `text_chunk` |
| `choices[0].finish_reason` | `CLIEvent` 的 `turn_complete` |
| `data: [DONE]` | 确认本轮流结束 |
| JSON error / HTTP 非 2xx | `CLIEvent` 的 `error` |

首个 chunk 可能只有 `delta.role = "assistant"`，没有 `content`。这不是错误，直接忽略即可。

### 5.3 取消

用户点停止时调用：

```ts
abortController.abort();
```

editor 侧把 `AbortError` 当作用户主动取消，不展示红色错误。Gateway 收到客户端断开后会尽量中断底层执行；如果模型供应商或当前适配器不能立即停止，服务端可能仍会短暂运行，但 editor 流已经结束。

## 6. `session_id` 策略

Gateway 用 `session_id` 隔离短期记忆。editor 应该按 "workspace + 文档 + agent" 生成稳定 id：

```ts
function buildGatewaySessionId(input: {
  workspaceId: string;
  documentId: string;
  agentId: string;
}) {
  const raw = `${input.workspaceId}_${input.documentId}_${input.agentId}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}
```

建议：

- 同一文档重复打开使用同一个 `session_id`，这样短期上下文连续。
- 不同文档使用不同 `session_id`，避免上下文串扰。
- "重新开始对话" 在 Gateway session 删除接口稳定前，可以生成一个新 `session_id` 后缀，例如 `..._${Date.now()}`。

## 7. 错误处理

Gateway 错误体是 OpenAI-compatible shape：

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "agent_not_found",
    "message": "Agent instance 'pencil/unknown' not found"
  }
}
```

editor 展示建议：

| HTTP | 常见原因 | 展示给用户 |
|---|---|---|
| 401 | API Key 缺失或错误 | "Gateway API Key 无效，请检查设置" |
| 403 | key 的 `allowedAgents` 不包含该 agent | "当前 Key 没有权限调用这个 Agent" |
| 404 | `pencil/<agentId>` 不存在 | "Gateway 中没有这个 Agent，请先创建或检查 Agent ID" |
| 408 | 请求开始前已取消 | 不必报错，按取消处理 |
| 422 | 请求字段不支持 | "请求格式不被 Gateway 支持"；同时记录开发日志 |
| 500 | nano-pencil 或模型供应商失败 | 展示 `error.message`，提示稍后重试或检查 Gateway 日志 |

## 8. editor 侧实施清单

```text
□ 新增 / 调整 HttpChatProvider：baseUrl 指向 Gateway，不再假设 Asgard
□ settings.ts：保存 remote-http.baseUrl / apiKey / agentId
□ ChatProvider 类型：保留或新增 mode = "remote-http"
□ RoutedChatProvider：remote-http -> HttpChatProvider
□ 设置面板：Remote HTTP tab，字段命名为 Gateway Base URL / Gateway API Key / Agent ID
□ 测试连接：GET /v1/models，检查 pencil/<agentId>
□ sendMessage：POST /v1/chat/completions，stream=true，带 session_id
□ SSE parser：delta.content -> text_chunk，finish_reason / [DONE] -> turn_complete
□ cancelTurn：AbortController.abort()
□ session_id utility：workspace + document + agent 稳定生成
□ smoke：本地 Gateway + writing-assistant agent + editor 发送一轮文本
```

## 9. Gateway 侧实施清单

```text
□ npm run dev 能启动，/healthz 和 /readyz 正常
□ 至少有一个 Gateway API Key
□ API Key 的 allowedAgents 包含 pencil/<agentId>
□ 已创建 PencilAgent：POST /v1/agents
□ GET /v1/models 能看到 pencil/<agentId>
□ curl -N POST /v1/chat/completions 能收到 data: [DONE]
□ Web 版 editor 需要时已配置 GATEWAY_CORS_ORIGINS
□ 生产部署已替换 pk_dev_default，且不把模型供应商 key 暴露给 editor
```

## 10. 升级到 Asgard 版时怎么迁移

当后续要接 Asgard 时，editor 的 `HttpChatProvider` 可以基本保留，变化点是配置来源和 baseUrl：

| 当前最小版 | Asgard 版 |
|---|---|
| `baseUrl = Gateway URL` | `baseUrl = Asgard URL` |
| `apiKey = Gateway API Key` | `apiKey = Asgard user-key` |
| `GET /v1/models` 直接到 Gateway | Asgard 过滤后返回当前用户可见 agent |
| `POST /v1/chat/completions` 直接到 Gateway | Asgard 鉴权后反代到 Gateway |
| editor 知道 Gateway 存在 | editor 只知道 Asgard |

因此当前实现时不要把类名写成 `AsgardChatProvider`，也不要把错误文案写死为 "Asgard"。推荐命名保持 `HttpChatProvider` / `RemoteHttpProvider`，让它既能直连 Gateway，也能在未来切到 Asgard 反代。
