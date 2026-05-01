# Pencil Agent Gateway Configuration

> P2 | Configuration module for Gateway runtime settings

## DIP Metadata

```text
[WHO]  Gateway operators and developers
[FROM] Environment variables, deployment configs
[TO]   Gateway server at startup
[HERE] config/ — Runtime configuration files
```

---

## Configuration Files

| File | Purpose | Format |
|------|---------|--------|
| `default.json` | Default Gateway configuration | JSON |

---

## Configuration Schema

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 8080,
    "logLevel": "info",
    "corsOrigins": "*",
    "requestTimeoutMs": 120000
  },
  "apiKeys": [
    {
      "key": "pk_dev_default",
      "label": "development",
      "allowedAgents": "*"
    }
  ],
  "dataDir": "./data",
  "agents": [],
  "channels": {
    "enabled": false,
    "server": { "host": "0.0.0.0", "port": 8090 },
    "gateway": { "baseUrl": "http://127.0.0.1:8080", "apiKey": "pk_dev_default" },
    "allowlist": { "allowAll": false, "senderIds": [], "chatIds": [] },
    "routes": [],
    "accounts": { "feishu": {}, "wechat": {} }
  }
}
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `HOST` | Server host | `0.0.0.0` |
| `LOG_LEVEL` | Log level | `debug`, `info`, `warn`, `error` |
| `DATA_DIR` | Data directory | `./data` |
| `GATEWAY_CONFIG` | Config file path | `./config/production.json` |
| `API_KEY` | Quick-start API key | `pk_quick_start` |
| `GATEWAY_ALLOW_NO_AUTH` | Allow startup without API keys | `1` |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown timeout | `10000` |
| `CHANNEL_HOST` | Optional channel wrapper host | `0.0.0.0` |
| `CHANNEL_PORT` | Optional channel wrapper port | `8090` |
| `CHANNEL_GATEWAY_BASE_URL` | Gateway URL used by channel wrapper | `http://127.0.0.1:8080` |
| `CHANNEL_GATEWAY_API_KEY` | API key used by channel wrapper | `pk_channel` |

---

## API Key Configuration

### Full Access
```json
{
  "key": "pk_full_access",
  "label": "production",
  "allowedAgents": "*"
}
```

### Limited Access
```json
{
  "key": "pk_limited",
  "label": "specific-agents-only",
  "allowedAgents": ["writer", "coder"]
}
```

---

## Agent Configuration

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "soul": {
    "systemPrompt": "You are a helpful assistant...",
    "styleTags": ["professional", "concise"]
  },
  "memory": {
    "mode": "short-term",
    "maxTurns": 20
  },
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-6"
  },
  "engine": {
    "type": "nano-pencil"
  }
}
```

### Model Configuration Modes

**Inherited Mode** (recommended for self-host):
```json
{
  "id": "my-agent"
  // model omitted — uses local nano-pencil default
}
```

## Channel Configuration

The optional `channels` block is only for the stage-one WeChat/Feishu text wrapper. Route entries map a platform conversation to a hosted PencilAgent model id:

```json
{
  "channels": {
    "enabled": true,
    "gateway": {
      "baseUrl": "http://127.0.0.1:8080",
      "apiKey": "pk_dev_default",
      "defaultAgentModel": "pencil/writing-assistant"
    },
    "allowlist": {
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

**BYO Key Mode**:
```json
{
  "id": "my-agent",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-6",
    "apiKey": "sk-ant-..."
  }
}
```

---

*Parent: [../AGENTS.md](../AGENTS.md)*
