---
title: Asgard and nanopencil-editor Integration Plan
status: active
scope: cross-project-integration
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Asgard and nanopencil-editor Integration Plan

## DIP Metadata

```text
[WHO]  Gateway, Asgard, and nanopencil-editor maintainers
[FROM] Asgard Platform and nanopencil-editor as caller-side integrators
[TO]   Pencil Agent Gateway OpenAI-compatible HTTP API and SDK surface; PencilAgent instances hosted there
[HERE] Cross-project integration contracts; no direct code sharing across project boundaries
```

## 1. Integration Rule

All integration happens over HTTP.

```text
Asgard Platform  -> HTTP -> Pencil Agent Gateway
nanopencil-editor -> HTTP -> Pencil Agent Gateway or Asgard proxy
```

No project imports another project's source code.

## 2. Asgard Integration

### 2.1 MVP Mode: Shared Gateway

One Gateway container serves many Pencil Agent instances.

```text
Asgard
  -> POST /v1/agents
  -> POST /v1/chat/completions
  -> GET /v1/models
```

Asgard owns:

- User account.
- User API Key.
- Billing.
- Marketplace UI.
- Console.
- Request routing.

Gateway owns:

- Internal API Key verification.
- Agent instance config.
- EngineAdapter invocation.
- OpenAI-compatible response.

### 2.2 Asgard Backend Tasks

1. Add `PencilAgentBackend`.
2. Add backend config:
   - `gateway_url`
   - `internal_api_key`
   - `timeout_ms`
3. Add request mapper:
   - Asgard request -> Gateway OpenAI request
4. Add response streamer:
   - Gateway SSE -> Asgard SSE
5. Add Marketplace type:
   - `pencil-agent`
6. Add create-agent flow:
   - User config -> Gateway `POST /v1/agents`
7. Add model mapping:
   - Asgard model id -> `pencil/<agent-id>`
8. Add error mapping:
   - Gateway OpenAI errors -> Asgard API errors

### 2.3 Asgard Headers

```http
Authorization: Bearer <internal-gateway-key>
X-Request-Id: req_xxx
X-Asgard-User: user_xxx
X-Asgard-Agent: agent_xxx
```

Gateway logs these headers but does not treat them as authorization.

### 2.4 Asgard v0.2+

Future Asgard responsibilities:

- Per-user/per-Agent Gateway container.
- Usage metering.
- Quota enforcement.
- Container lifecycle.
- Persistent memory policy.
- Tool policy.

## 3. nanopencil-editor Integration

### 3.1 Provider Mode

Add a third provider mode:

```text
local-acp      -> TauriChatProvider
internal-ws    -> WebSocketChatProvider
remote-http    -> HttpChatProvider
```

### 3.2 HttpChatProvider Config

```ts
type HttpChatProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;      // e.g. pencil/writing-assistant
  sessionId?: string;
};
```

### 3.3 Request Mapping

Editor sends:

```json
{
  "model": "pencil/writing-assistant",
  "messages": [
    {"role": "user", "content": "继续写这一章"}
  ],
  "stream": true,
  "session_id": "workspace-session-id"
}
```

Gateway returns OpenAI-compatible SSE chunks.

Editor maps:

| Gateway | Editor event |
|---------|--------------|
| `delta.content` | `text_chunk` |
| `finish_reason: stop` | `turn_complete` |
| OpenAI error | provider error |
| HTTP 401 | auth error |
| HTTP 403 | permission/config error |
| HTTP 404 agent | model/agent not found |

### 3.4 Editor MVP Limitations

In Gateway v0.1:

- No local tool callback.
- No file/shell tool execution through Gateway.
- No thinking event.
- No multi-agent run view.

Editor must show this mode as remote text Agent capability, not full local workspace Agent capability.

### 3.5 Editor Future v0.2

When Gateway supports tool callback:

- Gateway emits `pencil.tool_request`.
- Editor displays permission UI.
- Editor executes local tool.
- Editor returns `tool_response`.
- Gateway resumes engine turn.

This must be designed separately because OpenAI-compatible SSE alone is not enough for bidirectional local tool execution.

## 4. Self-Hosted Client Integration

Any OpenAI-compatible client should be able to call Gateway:

- OpenAI Node SDK
- OpenAI Python SDK
- curl
- Open WebUI
- custom IDE plugin
- future Channel Gateway

Example:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8080/v1",
  apiKey: "pk_xxx",
});

const stream = await client.chat.completions.create({
  model: "pencil/writing-assistant",
  messages: [{ role: "user", content: "Write a scene." }],
  stream: true,
});
```

## 5. Future Channel Gateway

Channel Gateway should be a separate process/project:

```text
Telegram / Slack / Discord / WeChat
  -> pencil-channel-gateway
  -> OpenAI-compatible HTTP
  -> Pencil Agent Gateway or Asgard
```

Why separate:

- Chat apps have complex webhook/auth/media/retry semantics.
- Agent Gateway should stay a clean serving layer.
- Channel bugs should not risk core OpenAI API serving.
- Different deployment teams may own channel integration.

## 6. End-to-End MVP Flow

### 6.1 Self-hosted

```text
User starts Gateway
  -> Gateway loads config
  -> User calls /v1/models
  -> User calls /v1/chat/completions
  -> Gateway streams response from nano-pencil
```

### 6.2 Asgard

```text
User creates Pencil Agent in Asgard
  -> Asgard calls Gateway /v1/agents
  -> User chats in Asgard
  -> Asgard forwards /v1/chat/completions
  -> Gateway streams response
  -> Asgard streams to browser
```

### 6.3 Editor

```text
User configures remote HTTP provider
  -> Editor opens SSE request to Gateway
  -> Gateway streams OpenAI chunks
  -> Editor renders text chunks
```

## 7. Contract Stability Rules

1. Gateway API changes must be documented before Asgard/editor code changes.
2. Asgard must not rely on Gateway filesystem layout.
3. Editor must not rely on nano-pencil internal events when using HTTP mode.
4. Gateway must keep OpenAI compatibility for the core chat path.
5. Any Pencil-specific extension event must use an explicit `pencil.*` namespace.
