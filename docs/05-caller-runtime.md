---
title: Caller Runtime Contract for PencilAgents
status: active
scope: caller-runtime
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Caller Runtime Contract for PencilAgents

## DIP Metadata

```text
[WHO]  Application/client developers integrating with Pencil Agent Gateway, and Gateway maintainers
[FROM] OpenAI-compatible callers including nanoPencil CLI (remote mode), nanopencil-editor, Asgard Platform, and third-party HTTP clients
[TO]   PencilAgent instances hosted in Pencil Agent Gateway, backed by EngineAdapter -> nano-pencil engine
[HERE] Defines how callers configure, select, and invoke PencilAgents through Gateway HTTP/SDK; does not define caller internals
```

## 1. Mental Model

Pencil Agent Gateway hosts **PencilAgent instances**. Each instance has identity (Soul, memory, model, personality). Callers do not embed the engine; they invoke a specific PencilAgent through Gateway.

```text
Caller application
  -> select target PencilAgent (`pencil/<agent-id>`)
  -> call Gateway HTTP or Gateway SDK
  -> Gateway routes to PencilAgent instance
  -> PencilAgent runs through EngineAdapter -> nano-pencil engine
  -> Gateway returns OpenAI-compatible text/SSE
```

Each application configures its own PencilAgent(s). The same Gateway can serve many callers and many PencilAgents simultaneously; routing is by `model` field.

For the formal definition of "PencilAgent", see [06-glossary.md](./06-glossary.md).

## 2. Caller Archetypes

### 2.1 nanoPencil CLI (remote mode)

When `nanopencil` runs in remote mode (instead of embedding the engine locally), it acts as a caller of one preconfigured PencilAgent.

Configuration:

```text
PENCIL_GATEWAY_URL=http://127.0.0.1:8080
PENCIL_GATEWAY_API_KEY=pk_xxx
PENCIL_GATEWAY_AGENT=pencil/coding-assistant
```

Typical PencilAgent for this caller: a coding-focused Agent with code-style Soul and project-scoped memory.

### 2.2 nanopencil-editor

The writing client configures a writing-focused PencilAgent and connects through `HttpChatProvider` (third routing mode after local ACP and internal WS).

Configuration is held in the editor's settings:

```text
gatewayUrl
gatewayApiKey
agentId        // e.g. pencil/writing-assistant
sessionId      // typically derived from workspace/project
```

Typical PencilAgent for this caller: a writing-assistant Agent with literary Soul, longer memory window, and a model tuned for prose.

### 2.3 Asgard Platform

Asgard hosts users; each user creates one or more PencilAgents through Asgard's UI. Asgard proxies user chat traffic to Gateway with an internal API key.

Configuration is held server-side in Asgard:

```text
gateway_url
internal_api_key
per-user agent registry: user_id -> [pencil/<agent-id>, ...]
```

Asgard creates PencilAgents by calling Gateway `POST /v1/agents` with a Soul/memory/model spec it gathered from the user.

### 2.4 Third-party OpenAI-compatible clients

Any OpenAI Node/Python SDK, OpenAI-compatible IDE plugin, or curl script can call Gateway directly. The operator preconfigures the PencilAgents and shares API keys with the relevant clients.

```ts
import OpenAI from "openai";
const client = new OpenAI({
  baseURL: "http://localhost:8080/v1",
  apiKey: "pk_xxx",
});
```

## 3. HTTP Usage

### 3.1 Non-Streaming

```http
POST /v1/chat/completions
Authorization: Bearer pk_xxx
Content-Type: application/json
```

```json
{
  "model": "pencil/writing-assistant",
  "messages": [
    {"role": "user", "content": "Continue this chapter."}
  ],
  "stream": false,
  "session_id": "workspace-novel-2026"
}
```

### 3.2 Streaming

```json
{
  "model": "pencil/writing-assistant",
  "messages": [
    {"role": "user", "content": "Draft the next section."}
  ],
  "stream": true,
  "session_id": "workspace-novel-2026"
}
```

Response is OpenAI-compatible SSE:

```text
data: {"choices":[{"delta":{"content":"First"}}]}
data: {"choices":[{"delta":{"content":" paragraph"}}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

## 4. Gateway SDK (可选，尚未实现)

> **状态**: `@pencil-agent/gateway-sdk` 尚未实现。当前 callers 应直接使用 HTTP 或 OpenAI SDK。

未来计划提供一个轻量级的 Node.js SDK 包装层，方便 typed 调用。在此之前，推荐以下两种方式：

### 4.1 直接使用 OpenAI SDK

Gateway 完全兼容 OpenAI API，可直接使用官方 SDK：

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8080/v1",
  apiKey: "pk_dev_default",
});

// 非流式
const response = await client.chat.completions.create({
  model: "pencil/writing-assistant",
  messages: [{ role: "user", content: "Hello" }],
});

// 流式
const stream = await client.chat.completions.create({
  model: "pencil/writing-assistant",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

### 4.2 直接使用 HTTP/curl

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/writing-assistant",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 4.3 未来 SDK 设计草案

当 `@pencil-agent/gateway-sdk` 实现时，它将：

- 作为 HTTP 的薄包装层
- 保持 OpenAI 兼容的请求语义
- 支持通过 async iterables 进行流式传输
- 支持通过 `AbortSignal` 取消
- **不**导入 `nano-pencil`
- **不**绕过 API Key 认证

## 5. Session Rules

Callers should pass stable session IDs to keep conversation context isolated across tasks/users.

Recommended naming patterns:

| Caller | Pattern |
|--------|---------|
| nanoPencil CLI | `cli-<machine>-<task>` |
| nanopencil-editor | `<workspace-id>-<doc-id>` |
| Asgard user | `<user-id>-<agent-id>-<conversation-id>` |
| 3rd-party | caller's own scheme |

Gateway namespaces sessions per Agent, so:

```text
agent: pencil/writing-assistant + session: workspace-novel-2026
```

is isolated from:

```text
agent: pencil/coding-assistant + session: workspace-novel-2026
```

## 6. PencilAgent Lifecycle from a Caller's Perspective

A caller normally only needs to KNOW which PencilAgent to invoke. PencilAgent CRUD is owned by whoever provisioned the Gateway:

| Caller | Who creates PencilAgents |
|--------|--------------------------|
| nanoPencil CLI | self-host operator (or CLI itself on first run) |
| nanopencil-editor | self-host operator, or Asgard if remote |
| Asgard | Asgard server on user request |
| 3rd-party | self-host operator |

Callers SHOULD treat the PencilAgent as a stable reference (`pencil/<agent-id>`) and not assume they can mutate it.

When callers do need to provision PencilAgents (e.g., setup CLI, embedded device), they call:

```http
POST /v1/agents
Authorization: Bearer <key with admin-capable scope>
```

See [02-api-contract.md §6](./02-api-contract.md) for the full schema.

## 7. Error Handling

| HTTP | Meaning | Caller action |
|------|---------|---------------|
| 401 | invalid API Key | fail startup or mark Gateway unavailable |
| 403 | API Key cannot access this PencilAgent | configuration error |
| 404 | PencilAgent not found | refresh `/v1/models`, fail task, or trigger provisioning |
| 408 | request cancelled before completion | stop local task |
| 422 | unsupported request shape | adjust request |
| 500 | engine failure | retry per task policy |

Callers should differentiate these classes; do not blanket-retry on 4xx.

## 8. Startup Check

Recommended caller startup sequence:

1. `GET /healthz`
2. `GET /readyz`
3. `GET /v1/models`
4. verify configured PencilAgent exists
5. optional smoke chat

For long-lived applications (editor, CLI), repeat step 3–4 after suspected outages.

## 9. Future Extensions (not in v0.1)

| Capability | Scope | Caller impact when shipped |
|------------|-------|----------------------------|
| Tool callbacks | Gateway emits `pencil.tool_request` SSE; caller returns `tool_response` | callers gain ability to provide local tool execution to their PencilAgent |
| Persistent memory | Gateway stores cross-session memory per PencilAgent | callers gain longer-running Agent identity |
| Thinking events | Gateway emits `pencil.thinking` SSE | callers can show reasoning in UI |
| Usage events | Gateway emits token/cost in stream | callers can display cost meter |

All caller-facing extensions will be additive and namespaced (`pencil.*`) so OpenAI compatibility is preserved.
