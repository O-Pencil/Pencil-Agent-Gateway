---
title: Pencil Agent Gateway Adapter Architecture
status: active
scope: adapter-architecture
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Pencil Agent Gateway Adapter Architecture

## DIP Metadata

```text
[WHO]  Gateway maintainers and future engine extension authors
[FROM] PencilAgent-facing Gateway route layer and Agent registry
[TO]   Pencil/nano-pencil SDK and future Agent engines
[HERE] Stable adapter boundary between HTTP/SDK serving and Agent engine internals
```

## 1. Core Principle

Gateway code must depend on `EngineAdapter`, not directly on `nano-pencil` internals.

```text
routes/chat.ts
  -> AgentRegistry
  -> AgentInstance
  -> EngineAdapter
  -> NanoPencilEngineAdapter
  -> nano-pencil SDK
```

This keeps `nano-pencil` independent and allows future engine extensions without rewriting HTTP routes.

## 2. EngineAdapter

```ts
export type EngineRole = "system" | "user" | "assistant";

export type EngineMessage = {
  role: EngineRole;
  content: string;
};

export type EngineRunRequest = {
  agentId: string;
  sessionId: string;
  messages: EngineMessage[];
  systemPrompt?: string;
  model?: {
    provider: string;
    name: string;
    apiKey?: string;
    baseUrl?: string;
  };
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

// Open discriminated union: v0.2 may extend with `tool_request`, `thinking`, `usage`, etc.
// Always extend by adding new `type` cases; never repurpose existing ones.
export type EngineEvent =
  | { type: "text_delta"; text: string }
  | { type: "done"; finishReason: "stop" | "length" | "cancelled" }
  | { type: "error"; error: Error }
  // Reserved future cases (not emitted in v0.1):
  // | { type: "tool_request"; ... }
  // | { type: "thinking"; ... }
  // | { type: "usage"; promptTokens: number; completionTokens: number }
  ;

export interface EngineAdapter {
  readonly id: string;
  initialize?(): Promise<void>;
  run(request: EngineRunRequest): AsyncIterable<EngineEvent>;
  dispose?(): Promise<void>;
}
```

Note: v0.1 intentionally does not expose a separate non-streaming method. Routes that need a non-streaming response collect events from `run` and accumulate `text_delta` until `done`. This keeps a single execution path and avoids divergent semantics between stream and non-stream modes.

Future `finishReason` values will likely include `tool_calls` and `content_filter` once the corresponding event types are added; v0.1 implementations must not emit those values yet.

## 3. NanoPencilEngineAdapter

The default implementation wraps `@pencil-agent/nano-pencil`.

Rules:

1. Only this adapter imports `@pencil-agent/nano-pencil`.
2. SDK version compatibility lives here.
3. SDK event names are translated into Gateway-level `EngineEvent`.
4. Gateway routes never inspect nano-pencil internal event payloads.
5. If nano-pencil later exposes a Gateway extension API, this adapter is the only layer that changes.

## 4. AgentInstance

```ts
export type AgentInstance = {
  id: string;
  modelId: `pencil/${string}`;
  config: AgentConfig;
  engine: EngineAdapter;
};
```

Responsibilities:

- Hold normalized config.
- Own engine adapter instance.
- Resolve session memory.
- Build final engine request.
- Hide storage and engine details from route handlers.

## 5. Registry

`AgentRegistry` responsibilities:

- Load instances at startup.
- Create/update/delete instances.
- Map OpenAI `model` to Agent ID.
- Enforce API Key allowed agent scope.
- Provide list for `/v1/models`.

It must not:

- Call model providers directly.
- Store user accounts.
- Know Asgard database details.
- Know editor UI details.

## 6. Storage Adapter

MVP file storage:

```text
/data/
├── agents/
│   ├── writing-assistant.json
│   └── code-reviewer.json
└── sessions/
    └── writing-assistant/
        └── draft-001.jsonl
```

Interface:

```ts
export interface GatewayStore {
  listAgents(): Promise<AgentConfig[]>;
  saveAgent(agent: AgentConfig): Promise<void>;
  deleteAgent(id: string): Promise<void>;
  readSession(agentId: string, sessionId: string): Promise<EngineMessage[]>;
  appendSession(agentId: string, sessionId: string, messages: EngineMessage[]): Promise<void>;
}
```

### 6.1 Path Safety

`agentId` and `sessionId` are used as filesystem path components. The store implementation MUST sanitize both before touching the filesystem:

- Allowed character set: `[a-zA-Z0-9_-]` plus a single `/` is forbidden (no `/`, no `\`, no `.`, no `..`, no NUL).
- Reject IDs that fail the pattern with a 400 response. Do not silently coerce.
- Resolve the final path and verify it is still inside the configured `DATA_DIR`; reject otherwise.

This protects against path-traversal exploits via crafted `session_id` headers/body fields and against accidental ID collisions across operating systems.

### 6.2 Future storage implementations

- SQLite
- Postgres
- S3-compatible object storage
- Asgard-managed external storage

## 7. Memory Boundary

v0.1 memory is short-term session memory.

Allowed:

- Keep recent messages.
- Per Agent and per session isolation.
- Configurable `maxTurns`.

Not allowed in v0.1:

- Vector database.
- Global long-term memory.
- Cross-agent memory sharing.
- User profile memory.

## 8. Tool Boundary

v0.1 ignores OpenAI `tools`.

v0.2 may add:

```text
SSE: event: pencil.tool_request
HTTP/WS: tool_response callback
```

Rules:

- Tool execution policy belongs to clients or platform.
- Gateway may route tool requests, but should not silently execute user-local tools.
- editor local file/shell tools must remain editor-side.
- Asgard hosted tools must be explicit platform tools.

## 9. Channel Boundary

Telegram/Slack/Discord/WeChat adapters should not implement `EngineAdapter`.

They belong to future `pencil-channel-gateway`:

```text
ChannelAdapter
  -> NormalizedMessage
  -> OpenAI-compatible HTTP request
  -> Pencil Agent Gateway
```

This preserves separation:

- EngineAdapter: Agent engine boundary.
- ChannelAdapter: external chat app boundary.
- Gateway routes: HTTP serving boundary.

## 10. Extension Model

Future extension points:

```ts
type GatewayExtension = {
  engines?: EngineAdapterFactory[];
  stores?: StoreFactory[];
  auth?: AuthProviderFactory[];
  lifecycleHooks?: GatewayHook[];
};
```

Do not implement this in v0.1. Keep the code structured so it can be introduced without rewriting route handlers.

## 11. Design Checklist

Before adding a dependency or feature, ask:

1. Is this Agent engine logic? If yes, it probably belongs in `nano-pencil`.
2. Is this platform/user/billing logic? If yes, it belongs in Asgard.
3. Is this chat app protocol logic? If yes, it belongs in Channel Gateway.
4. Is this HTTP serving/auth/routing/config logic? If yes, it belongs here.
