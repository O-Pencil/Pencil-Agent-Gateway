# Pencil Agent Gateway Source

> P2 | Source code module member list

## DIP Metadata

```text
[WHO]  AI coding agents working on Pencil Agent Gateway source code
[FROM] AGENTS.md (root), README.md, docs/
[TO]   Compiled dist/, executed by Node.js runtime
[HERE] src/ — TypeScript source code organized by functional domain
```

---

## Module Structure

```
src/
├── server.ts              # Server bootstrap and lifecycle
├── app.ts                 # Hono app setup and middleware
├── config.ts              # Configuration loading and validation
├── routes/
│   ├── chat.ts            # OpenAI-compatible chat endpoints
│   ├── chat.sse.test.ts   # SSE streaming tests
│   └── routes.test.ts     # Route integration tests
├── channels/
│   ├── app.ts             # Optional channel webhook Hono app
│   ├── types.ts           # Channel adapter/message/route contracts
│   ├── router.ts          # Channel allowlist, routing, session ids
│   ├── gateway-client.ts  # HTTP caller for /v1/chat/completions
│   ├── dingtalk/          # DingTalk relay/MCP-compatible adapter
│   ├── feishu/            # Feishu webhook and reply adapter
│   └── wechat/            # WeChat webhook and XML reply adapter
├── agent/
│   ├── registry.ts        # Agent instance management
│   └── registry.test.ts   # Registry tests
├── auth/
│   ├── middleware.ts      # API Key authentication
│   └── middleware.test.ts # Auth middleware tests
├── engine/
│   ├── adapter.ts         # Engine adapter interface
│   ├── nano-adapter.ts    # Nano-pencil engine adapter
│   └── mock-adapter.ts    # Mock engine for testing
├── protocol/
│   ├── types.ts           # OpenAI-compatible types
│   └── types.test.ts      # Protocol type tests
├── store/
│   ├── session.ts         # Session persistence
│   └── session.test.ts    # Session store tests
└── util/
    ├── errors.ts          # Error classes
    ├── errors.test.ts     # Error tests
    └── logger.ts          # Logging utility
```

---

## Member List

### Entry Points

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `server.ts` | Server bootstrap, graceful shutdown, initialization orchestration | `main()` |
| `app.ts` | Hono app factory, middleware chain, route mounting | `createApp()`, `AppEnv` |
| `channel-server.ts` | Optional channel webhook server bootstrap | `main()` |

### Configuration

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `config.ts` | Config loading from JSON/env, validation, interpolation | `loadConfig()`, `getConfig()`, `GatewayConfig` |

### Routes (HTTP Layer)

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `routes/chat.ts` | OpenAI-compatible `/v1/chat/completions` endpoint, streaming/non-streaming | `handleChatCompletion()` |

### Channels (Optional Wrapper)

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `channels/app.ts` | DingTalk/WeChat/Feishu webhook route mounting | `createChannelApp()` |
| `channels/types.ts` | Normalized channel contracts | `ChannelAdapter`, `NormalizedMessage`, `ChannelRoute`, `OutboundMessage` |
| `channels/router.ts` | Allowlist, route matching, safe `session_id` generation | `resolveChannelMessage()` |
| `channels/gateway-client.ts` | Thin HTTP caller into Gateway chat API | `runChannelMessage()` |
| `channels/dingtalk/adapter.ts` | DingTalk Stream/MCP relay parsing and session webhook replies | `DingTalkAdapter`, `normalizeDingTalkPayload()` |
| `channels/feishu/adapter.ts` | Feishu challenge/text parsing and reply API | `FeishuAdapter`, `normalizeFeishuPayload()` |
| `channels/wechat/adapter.ts` | WeChat signature/XML parsing and text replies | `verifyWeChatSignature()`, `renderWeChatTextReply()` |

### Agent Management

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `agent/registry.ts` | Agent instance lifecycle, persistence, model ID mapping | `AgentRegistry`, `AgentInstance`, `getRegistry()` |

### Authentication

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `auth/middleware.ts` | API Key validation, CORS, request ID injection | `authMiddleware` |

### Engine Adapters

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `engine/adapter.ts` | Engine adapter abstraction interface | `EngineAdapter`, `EngineRunRequest`, `EngineRunResult` |
| `engine/nano-adapter.ts` | Nano-pencil SDK integration, BYO-key vs inherited modes | `NanoPencilEngineAdapter`, `createNanoPencilAdapter()` |
| `engine/mock-adapter.ts` | Test double for engine adapter | `MockEngineAdapter` |

### Protocol Types

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `protocol/types.ts` | OpenAI API schema types, validation | `ChatCompletionRequest`, `ChatCompletionResponse`, `validateChatRequest()` |

### Session Store

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `store/session.ts` | Conversation history persistence per agent/session | `SessionStore`, `getSessionStore()` |

### Utilities

| File | Responsibility | Key Exports |
|------|----------------|-------------|
| `util/errors.ts` | Gateway error hierarchy, HTTP status mapping | `GatewayError`, `NotFoundError`, `EngineError` |
| `util/logger.ts` | Structured logging with levels | `logger`, `LogLevel` |

---

## Cross-Module Dependencies

```
server.ts
  -> config.ts (loadConfig)
  -> app.ts (createApp)
  -> agent/registry.ts (initRegistry)
  -> store/session.ts (initSessionStore)

channel-server.ts
  -> config.ts (loadConfig)
  -> channels/app.ts (createChannelApp)

app.ts
  -> config.ts (getConfig)
  -> auth/middleware.ts (authMiddleware)
  -> routes/chat.ts (handleChatCompletion)
  -> agent/registry.ts (getRegistry)
  -> util/errors.ts (GatewayError)
  -> util/logger.ts (logger)

routes/chat.ts
  -> agent/registry.ts (getRegistry)
  -> store/session.ts (getSessionStore)
  -> protocol/types.ts (ChatCompletionRequest)
  -> util/errors.ts (NotFoundError)
  -> util/logger.ts (logger)

channels/app.ts
  -> channels/router.ts (resolveChannelMessage)
  -> channels/gateway-client.ts (runChannelMessage)
  -> channels/dingtalk/adapter.ts
  -> channels/feishu/adapter.ts
  -> channels/wechat/adapter.ts

agent/registry.ts
  -> engine/adapter.ts (EngineAdapter)
  -> engine/nano-adapter.ts (createNanoPencilAdapter)
  -> config.ts (AgentConfig)
  -> util/errors.ts (InvalidRequestError)
  -> util/logger.ts (logger)

engine/nano-adapter.ts
  -> engine/adapter.ts (EngineAdapter)
  -> config.ts (AgentConfig)
  -> util/errors.ts (EngineError)
  -> util/logger.ts (logger)
  -> @pencil-agent/nano-pencil (external SDK)
```

---

## Key Design Patterns

1. **Registry Pattern**: `AgentRegistry` singleton manages all agent instances
2. **Adapter Pattern**: `EngineAdapter` abstracts different agent engines
3. **Middleware Chain**: Hono middleware for auth, CORS, request ID
4. **Session Isolation**: Per-session `AgentSession` prevents cross-talk
5. **Dual Mode Engine**: BYO-key vs inherited authentication modes

---

*Parent: [../AGENTS.md](../AGENTS.md)*
