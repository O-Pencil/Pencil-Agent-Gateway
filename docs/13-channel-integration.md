---
title: Pencil Channel Integration
status: active
scope: channel-integration
owner: pencil-agent-gateway maintainers
created: 2026-05-01
updated: 2026-05-01
---

# Pencil Channel Integration

## DIP Metadata

```text
[WHO]  Gateway maintainers adding first-party message platform adapters
[FROM] WeChat/Feishu webhooks, DingTalk Stream/MCP relays, and future chat channel events
[TO]   Pencil Agent Gateway HTTP API (`/v1/chat/completions`)
[HERE] Stage-one channel wrapper that normalizes external chat messages and calls Gateway as an HTTP caller; it does not own Agent engine, registry, billing, or platform UI concerns
```

## 1. Boundary Decision

The long-term boundary remains a separate `pencil-channel-gateway`. Channel adapters are transport concerns: they maintain provider credentials, verify webhooks, normalize platform events, enforce allowlists, map messages to stable sessions, and deliver outbound replies.

For the first implementation, the channel wrapper may live in this repository as a staged module because it needs to validate WeChat/Feishu integration quickly. It must stay isolated so it can be moved into a separate service later without rewriting Agent serving code.

## 2. Runtime Flow

```text
DingTalk / WeChat / Feishu event
  -> ChannelAdapter
  -> NormalizedMessage
  -> ChannelRouter
  -> Gateway HTTP client
  -> POST /v1/chat/completions
  -> PencilAgent
  -> outbound delivery through the same ChannelAdapter
```

The channel wrapper is a caller of Gateway. It must not import `@pencil-agent/nano-pencil`, `AgentRegistry`, or any `EngineAdapter` implementation.

## 3. First Scope

v0.1 channel support is intentionally narrow:

- text-only inbound messages
- text-only outbound replies
- DingTalk Stream Mode or MCP-compatible HTTP relay payload parsing and session-webhook markdown replies
- WeChat webhook verification and XML text replies
- Feishu challenge handling, text event parsing, and reply API delivery when app credentials are configured
- local JSON configuration for accounts, allowlists, and channel-to-agent routing
- deterministic `session_id` generation from channel/account/chat/thread identity

Out of scope:

- voice, images, files, reactions, message edits, and streaming message updates
- user registration, billing, marketplace, or Asgard UI
- workflow/DAG orchestration
- local tool execution
- direct engine or registry access from channel code

## 4. Configuration Shape

Channel configuration is optional and lives under `channels` in the existing Gateway config:

```json
{
  "channels": {
    "enabled": true,
    "server": { "host": "0.0.0.0", "port": 8090 },
    "gateway": {
      "baseUrl": "http://127.0.0.1:8080",
      "apiKey": "pk_dev_default",
      "defaultAgentModel": "pencil/writing-assistant",
      "timeoutMs": 120000
    },
    "allowlist": {
      "allowAll": false,
      "senderIds": ["ou_xxx", "wechat-open-id"],
      "chatIds": ["oc_xxx"]
    },
    "routes": [
      {
        "channel": "feishu",
        "accountId": "default",
        "chatId": "oc_xxx",
        "agentModel": "pencil/writing-assistant"
      }
    ],
    "accounts": {
      "dingtalk": {
        "default": {
          "webhookSecret": "${DINGTALK_RELAY_SECRET}",
          "requireMention": true,
          "freeResponseChatIds": [],
          "mentionPatterns": ["^小铅笔"]
        }
      },
      "feishu": {
        "default": {
          "appId": "${FEISHU_APP_ID}",
          "appSecret": "${FEISHU_APP_SECRET}",
          "verificationToken": "${FEISHU_VERIFICATION_TOKEN}"
        }
      },
      "wechat": {
        "default": {
          "token": "${WECHAT_TOKEN}"
        }
      }
    }
  }
}
```

Routing is deterministic. The most specific route wins; otherwise the wrapper falls back to `channels.gateway.defaultAgentModel` when configured.

## 5. DingTalk Relay Contract

DingTalk is integrated as a relay-friendly channel in this repository. The preferred production shape is:

```text
DingTalk Stream Mode client or MCP server
  -> POST /channels/dingtalk/:accountId/webhook
  -> Channel wrapper
  -> Gateway HTTP
  -> sessionWebhook reply
```

The POST body may be a raw DingTalk chatbot payload, a `dingtalk-stream` callback body with `data`, or an MCP/bridge envelope with `message` or `event`. The payload must include text content plus conversation/sender identity and should include `sessionWebhook` so the adapter can reply. When `accounts.dingtalk.<accountId>.webhookSecret` is configured, the relay must send either `Authorization: Bearer <secret>`, `X-Pencil-Channel-Secret`, or `X-Dingtalk-Channel-Secret`.

The channel wrapper intentionally does not embed the DingTalk SDK or manage the Stream Mode WebSocket. That responsibility belongs to the relay/MCP process. This keeps DingTalk credentials and reconnect behavior outside the Agent engine and preserves the same move-out path to a future `pencil-channel-gateway`.

## 6. Migration Rule

When channel behavior grows beyond this first scope, move the module into `pencil-channel-gateway` and keep the same HTTP caller contract:

```text
pencil-channel-gateway -> OpenAI-compatible HTTP -> Pencil Agent Gateway
```

No migrated channel service should depend on Gateway internals.
