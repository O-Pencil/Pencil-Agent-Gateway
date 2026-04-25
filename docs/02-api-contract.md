---
title: Pencil Agent Gateway API Contract
status: active
scope: api-contract
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Pencil Agent Gateway API Contract

## DIP Metadata

```text
[WHO]  Gateway API consumers and maintainers
[FROM] PencilAgent HTTP/SDK client first; also OpenAI-compatible clients, Asgard proxy, nanopencil-editor HttpChatProvider
[TO]   Gateway routes and EngineAdapter calls
[HERE] HTTP request/response, SSE format, auth headers, and error contract used to call Pencil
```

## 1. Base URL

```text
http://localhost:8080
```

All business endpoints require:

```http
Authorization: Bearer <api-key>
```

Health endpoints do not require auth.

## 2. Endpoint Summary

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/healthz` | process health | no |
| GET | `/readyz` | config/engine readiness | no |
| GET | `/v1/models` | OpenAI-compatible model list | yes |
| POST | `/v1/chat/completions` | OpenAI-compatible chat | yes |
| GET | `/v1/agents` | list Agent instances | yes |
| POST | `/v1/agents` | create/update Agent instance | yes |
| DELETE | `/v1/agents/:id` | delete Agent instance | yes |

## 3. Authentication

### 3.1 Request

```http
Authorization: Bearer pk_xxx
```

### 3.2 API Key Model

```ts
type ApiKeyConfig = {
  key: string;
  label?: string;
  allowedAgents: "*" | string[];
};
```

### 3.3 Asgard Headers

Gateway accepts these headers for logs and future audit, but does not trust them for authorization in v0.1:

```http
X-Request-Id: req_xxx
X-Asgard-User: user_xxx
X-Asgard-Agent: agent_xxx
```

Asgard must still call Gateway with an internal API Key.

## 4. OpenAI-Compatible Chat

### 4.1 Request

```http
POST /v1/chat/completions
Authorization: Bearer pk_xxx
Content-Type: application/json
```

```json
{
  "model": "pencil/writing-assistant",
  "messages": [
    {"role": "system", "content": "You are a writing assistant."},
    {"role": "user", "content": "Write a suspenseful opening."}
  ],
  "stream": true,
  "temperature": 0.7,
  "session_id": "draft-001"
}
```

### 4.2 Supported Fields

| Field | Support | Notes |
|-------|---------|-------|
| `model` | required | must be `pencil/<agent-id>` |
| `messages` | required | `system` / `user` / `assistant` |
| `stream` | optional | default `false` |
| `temperature` | optional | forwarded when supported |
| `max_tokens` | optional | forwarded when supported |
| `session_id` | extension | isolates memory |
| `tools` | accepted, ignored | v0.2 |
| `tool_choice` | accepted, ignored | v0.2 |
| `n` | only `1` | reject otherwise |
| `response_format` | text only | JSON mode not in v0.1 |

### 4.3 Non-Streaming Response

```json
{
  "id": "chatcmpl_01J...",
  "object": "chat.completion",
  "created": 1714000000,
  "model": "pencil/writing-assistant",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The hallway light flickered once, then died."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

`usage` may be zero in v0.1 if the engine cannot normalize token usage yet.

### 4.4 Streaming Response

Headers:

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Body:

```text
data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","created":1714000000,"model":"pencil/writing-assistant","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","created":1714000000,"model":"pencil/writing-assistant","choices":[{"index":0,"delta":{"content":"The hallway"},"finish_reason":null}]}

data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","created":1714000000,"model":"pencil/writing-assistant","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

## 5. Models

### 5.1 GET /v1/models

Returns each Agent instance as an OpenAI model.

```json
{
  "object": "list",
  "data": [
    {
      "id": "pencil/writing-assistant",
      "object": "model",
      "created": 1714000000,
      "owned_by": "pencil-agent-gateway"
    }
  ]
}
```

## 6. Agents

### 6.1 Agent Config

```ts
type AgentConfig = {
  id: string;
  name?: string;
  soul?: {
    systemPrompt?: string;
    styleTags?: string[];
  };
  memory?: {
    mode: "short-term";
    maxTurns: number;
  };
  model: {
    provider: string;
    name: string;
    apiKey?: string;
    baseUrl?: string;
  };
  engine?: {
    type: "nano-pencil";
    options?: Record<string, unknown>;
  };
};
```

### 6.2 GET /v1/agents

```json
{
  "data": [
    {
      "id": "writing-assistant",
      "modelId": "pencil/writing-assistant",
      "name": "Writing Assistant",
      "engine": "nano-pencil",
      "memory": {"mode": "short-term", "maxTurns": 20}
    }
  ]
}
```

Sensitive values such as provider API keys must never be returned.

### 6.3 POST /v1/agents

Creates or updates an Agent instance.

```json
{
  "id": "writing-assistant",
  "name": "Writing Assistant",
  "soul": {
    "systemPrompt": "You are a careful writing assistant.",
    "styleTags": ["suspense", "literary"]
  },
  "memory": {
    "mode": "short-term",
    "maxTurns": 20
  },
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-6",
    "apiKey": "${ANTHROPIC_API_KEY}"
  }
}
```

Response:

```json
{
  "id": "writing-assistant",
  "modelId": "pencil/writing-assistant",
  "status": "ready"
}
```

### 6.4 DELETE /v1/agents/:id

Response:

```json
{
  "id": "writing-assistant",
  "deleted": true
}
```

## 7. Errors

All JSON errors use OpenAI-compatible shape:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "agent_not_found",
    "message": "Agent instance 'pencil/unknown' not found"
  }
}
```

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `invalid_request` | malformed request |
| 401 | `unauthorized` | missing/invalid API Key |
| 403 | `forbidden_agent` | API Key cannot access agent |
| 404 | `agent_not_found` | model/agent not found |
| 409 | `agent_conflict` | invalid update conflict |
| 422 | `unsupported_feature` | field accepted by OpenAI but not supported |
| 499 | `client_cancelled` | client disconnected |
| 500 | `engine_error` | engine failed |

## 8. Cancellation

For streaming requests, client disconnect should cancel the underlying engine run.

For non-streaming requests, timeout defaults should be configurable:

```text
GATEWAY_REQUEST_TIMEOUT_MS=120000
```

## 9. Compatibility Rules

1. Do not expose nano-pencil internal event names in v0.1 API.
2. Do not expose provider API keys in any response.
3. Do not reject unknown OpenAI fields unless they would change behavior.
4. Keep extension fields namespaced or documented, e.g. `session_id`.
5. Any breaking API change requires updating this file before code changes merge.
