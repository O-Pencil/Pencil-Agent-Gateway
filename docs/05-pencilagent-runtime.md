---
title: PencilAgent Runtime Usage
status: active
scope: pencilagent-runtime
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# PencilAgent Runtime Usage

## DIP Metadata

```text
[WHO]  PencilAgent runtime and Gateway maintainers
[FROM] PencilAgent after startup
[TO]   Pencil Agent Gateway HTTP API or Gateway SDK, then EngineAdapter-backed Pencil/nano-pencil
[HERE] Defines how PencilAgent calls Pencil through Gateway; does not define PencilAgent internals
```

## 1. Primary Runtime Goal

Pencil Agent Gateway exists first for PencilAgent.

After PencilAgent starts, it should not embed Pencil engine internals directly. It should call Pencil through one of two stable surfaces:

1. HTTP OpenAI-compatible API
2. Gateway SDK wrapper over the same HTTP API

```text
PencilAgent startup
  -> resolve gateway baseUrl/apiKey/model
  -> call Gateway
  -> Gateway calls Pencil/nano-pencil through EngineAdapter
  -> PencilAgent consumes text or stream events
```

## 2. HTTP Usage

### 2.1 Configuration

PencilAgent needs:

```text
PENCIL_GATEWAY_URL=http://127.0.0.1:8080
PENCIL_GATEWAY_API_KEY=pk_xxx
PENCIL_GATEWAY_MODEL=pencil/default
```

### 2.2 Non-Streaming Request

```http
POST /v1/chat/completions
Authorization: Bearer pk_xxx
Content-Type: application/json
```

```json
{
  "model": "pencil/default",
  "messages": [
    {"role": "user", "content": "Continue this plan."}
  ],
  "stream": false,
  "session_id": "pencilagent-main"
}
```

### 2.3 Streaming Request

```json
{
  "model": "pencil/default",
  "messages": [
    {"role": "user", "content": "Draft the next section."}
  ],
  "stream": true,
  "session_id": "pencilagent-main"
}
```

The response is OpenAI-compatible SSE:

```text
data: {"choices":[{"delta":{"content":"First"}}]}
data: {"choices":[{"delta":{"content":" paragraph"}}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

## 3. SDK Usage

The SDK is a thin wrapper over HTTP.

Target shape:

```ts
import { PencilGatewayClient } from "@pencil-agent/gateway-sdk";

const client = new PencilGatewayClient({
  baseUrl: process.env.PENCIL_GATEWAY_URL,
  apiKey: process.env.PENCIL_GATEWAY_API_KEY,
});

const result = await client.chat({
  model: "pencil/default",
  sessionId: "pencilagent-main",
  messages: [{ role: "user", content: "Continue this plan." }],
});

console.log(result.content);
```

Streaming target shape:

```ts
for await (const event of client.streamChat({
  model: "pencil/default",
  sessionId: "pencilagent-main",
  messages: [{ role: "user", content: "Draft the next section." }],
})) {
  if (event.type === "text_delta") process.stdout.write(event.text);
}
```

## 4. SDK Boundary

The SDK must:

- call Gateway HTTP endpoints
- preserve OpenAI-compatible request semantics
- expose a small PencilAgent-friendly API
- support streaming
- support abort/cancel through `AbortSignal`

The SDK must not:

- import `nano-pencil`
- access Gateway file storage
- bypass API Key auth
- introduce a private protocol incompatible with HTTP

## 5. Session Rules

PencilAgent should pass stable session IDs.

Recommended:

```text
pencilagent-main
pencilagent-task-<task-id>
pencilagent-user-<user-id>
```

Gateway maps session IDs per Agent instance, so:

```text
agent: pencil/default + session: pencilagent-main
```

is isolated from:

```text
agent: pencil/writing-assistant + session: pencilagent-main
```

## 6. Error Handling

PencilAgent should treat these as configuration/runtime classes:

| HTTP | Meaning | PencilAgent action |
|------|---------|--------------------|
| 401 | invalid API key | fail startup or mark Gateway unavailable |
| 403 | model not allowed | configuration error |
| 404 | model/agent missing | refresh models or fail task |
| 422 | unsupported request shape | adjust request |
| 499 | client cancelled | stop local task |
| 500 | engine failure | retry according to task policy |

## 7. Startup Check

Recommended startup sequence:

1. `GET /healthz`
2. `GET /readyz`
3. `GET /v1/models`
4. verify configured model exists
5. run optional smoke chat if configured

## 8. Future Tool Callback

v0.1 does not support tool callbacks.

When v0.2 adds tool callbacks, PencilAgent should still enter through Gateway HTTP/SDK. The callback protocol must be documented as a Pencil-specific extension and must not leak nano-pencil internals.
