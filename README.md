# Pencil Agent Gateway

> HTTP serving layer that hosts PencilAgent instances and exposes them over an OpenAI-compatible API.

Pencil Agent Gateway hosts **PencilAgent instances** (`= nano-pencil engine + Soul + memory + model + personality`) and serves callers — nanoPencil CLI (remote mode), nanopencil-editor, Asgard Platform, and third-party HTTP clients — through a stable OpenAI-compatible HTTP + SSE API.
It keeps the `nano-pencil` engine independent, embeddable, and lightweight, while moving HTTP serving, API keys, multi-instance config, and deployment packaging out of the engine.

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway maintainers and AI coding agents working in this repository
[FROM] OpenAI-compatible callers: nanoPencil CLI (remote mode), nanopencil-editor, Asgard Platform, third-party HTTP clients, and future channel gateways
[TO]   PencilAgent instances backed by EngineAdapter -> nano-pencil engine
[HERE] This repository: the HTTP/API/SDK serving layer that hosts PencilAgents, not the engine and not the platform console
```

## Positioning

Pencil Agent Gateway hosts **PencilAgents**. A PencilAgent is a configured Agent instance — it is **not** the same thing as the nanoPencil project. For the full term table see [docs/06-glossary.md](./docs/06-glossary.md).

At runtime:

```text
Caller (nanoPencil CLI / editor / Asgard / 3rd-party)
  -> selects target PencilAgent (`pencil/<agent-id>`)
  -> calls Pencil Agent Gateway over HTTP/SSE
  -> Gateway routes to the PencilAgent instance
  -> PencilAgent runs through EngineAdapter -> nano-pencil engine
  -> Gateway returns OpenAI-compatible text/SSE events
```

Each application configures its own PencilAgent(s) — different Soul, different memory window, different model — and invokes them through this Gateway. The Gateway is not the Agent engine. It is also not the full SaaS platform.

| Layer | Project | Responsibility |
|------|---------|----------------|
| Agent engine | `nano-pencil` | Model dialogue, tool loop, memory primitives, engine SDK, ACP CLI |
| Serving layer | `pencil-agent-gateway` | OpenAI-compatible HTTP API, SSE streaming, API Key auth, **PencilAgent instance hosting** |
| Platform layer | `Asgard Platform` | Users, billing, marketplace, console, container orchestration |
| Caller layer | `nanopencil-editor`, `nanoPencil CLI` (remote mode), 3rd-party | Writing UX, terminal Agent UX, IDE plugins, etc. — each configures its own PencilAgent(s) |

The Gateway exists because the engine should remain easy to embed and evolve. HTTP serving, API keys, multi-instance config, deployment packaging, and platform integration are operational concerns and should not be forced into `nano-pencil`.

## AI Agent Instructions

AI coding agents working on this repository must read [AGENTS.md](./AGENTS.md) first.
Every major document and architecture-facing module should preserve the DIP metadata shape:

```text
[WHO]  who owns or executes this layer
[FROM] upstream caller or dependency source
[TO]   downstream callee or contract target
[HERE] current file/repository responsibility boundary
```

## Goals

- Expose Agent instances through an OpenAI-compatible API.
- Keep `nano-pencil` usable as a standalone SDK/CLI without dragging in server concerns.
- Allow self-hosted users to run one container and get a working Agent endpoint.
- Allow Asgard to manage the same image through HTTP and container orchestration.
- Leave room for future Engine extensions, so `nano-pencil` is the default engine, not a hard-coded permanent assumption.

## Non-Goals

- No user registration or login inside the Gateway.
- No billing, quota plans, marketplace, or web console.
- No platform database in the MVP.
- No WebSocket API in v0.1.
- No client-side tool callback protocol in v0.1.
- No full workflow/DAG runtime in the Gateway.

## MVP Scope

v0.1 focuses on the core chat serving path:

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /v1/agents`
- `POST /v1/agents`
- `DELETE /v1/agents/:id`
- `GET /healthz`
- `GET /readyz`

The Gateway accepts OpenAI-style requests and maps `model: "pencil/<agent-id>"` to a configured Agent instance.

## Architecture

```text
HTTP Client
  |
  | OpenAI-compatible HTTP + SSE
  v
Pencil Agent Gateway
  |
  | EngineAdapter
  v
nano-pencil SDK
  |
  v
Model providers / memory / engine tools
```

Asgard integrates by routing HTTP requests to Gateway instances:

```text
Asgard Platform
  |
  | Internal HTTP + API Key
  v
Pencil Agent Gateway container
  |
  v
nano-pencil SDK
```

## Planned Tech Stack

- Runtime: Node.js 20+
- Language: TypeScript
- HTTP framework: Hono
- Validation: Zod
- Tests: Vitest
- Storage: local JSON/YAML files for MVP
- Packaging: Docker multi-stage image

## Repository Layout

```text
pencil-agent-gateway/
├── README.md
├── AGENTS.md
├── docs/
│   ├── 00-product-boundary.md
│   ├── 01-development-plan.md
│   ├── 02-api-contract.md
│   ├── 03-adapter-architecture.md
│   ├── 04-asgard-editor-integration.md
│   ├── 05-caller-runtime.md
│   └── 06-glossary.md
├── LICENSE
├── src/
│   ├── server.ts
│   ├── config.ts
│   ├── routes/
│   ├── auth/
│   ├── engine/
│   ├── agent/
│   ├── store/
│   ├── protocol/
│   └── util/
├── config/
├── examples/
└── tests/
```

The code directories will be created during implementation milestones. The docs in this repository are the source of truth for the MVP build.

## Development Phases

1. Repository scaffold and Hono server.
2. OpenAI-compatible chat endpoint, non-streaming first.
3. SSE streaming and OpenAI chunk mapping.
4. API Key middleware and model/agent routing.
5. Agent instance registry and file-backed config.
6. `nano-pencil` EngineAdapter integration.
7. Docker image and self-hosting examples.
8. Asgard proxy contract.
9. `nanopencil-editor` HTTP provider contract.
10. Caller runtime contract (HTTP + optional SDK) for nanoPencil CLI, editor, Asgard, third-party.

See [docs/01-development-plan.md](./docs/01-development-plan.md) for the detailed task breakdown.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start in development mode (with hot reload)
npm run dev

# Server starts at http://localhost:8080
curl http://localhost:8080/healthz
```

### Docker Self-Hosting

```bash
# Build and run
docker compose -f docker-compose.example.yml up -d

# Or build and run manually
docker build -t pencil-agent-gateway:latest .
docker run -d --name pencil-gateway -p 8080:8080 pencil-agent-gateway:latest
```

### Create an Agent

```bash
curl -X POST http://localhost:8080/v1/agents \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "writing-assistant",
    "model": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-6",
      "apiKey": "your-anthropic-api-key"
    }
  }'
```

### Chat (Non-Streaming)

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/writing-assistant",
    "messages": [{"role": "user", "content": "Write a haiku about coding"}]
  }'
```

### Chat (Streaming)

```bash
curl -N -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/writing-assistant",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Use with OpenAI SDK

```typescript
import OpenAI from "openai";
const client = new OpenAI({
  apiKey: "pk_dev_default",
  baseURL: "http://localhost:8080/v1",
});
const response = await client.chat.completions.create({
  model: "pencil/writing-assistant",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);
```

### Production Configuration

```bash
docker run -d -p 8080:8080 \
  -v ./config/default.json:/app/config/default.json:ro \
  -v ./data:/app/data \
  -e ANTHROPIC_API_KEY=your-key \
  pencil-agent-gateway:latest
```

## Naming Note

The precise technical role is **Agent Gateway**: a serving gateway for Agent engines.
If this project later also owns Telegram/Slack/Discord/WeChat adapters, those should be split into a separate **Channel Gateway** to avoid mixing transport-channel concerns with Agent serving concerns.
