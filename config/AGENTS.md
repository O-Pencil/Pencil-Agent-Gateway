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
  "agents": []
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
