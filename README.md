# Pencil Agent Gateway

> Runtime gateway for PencilAgent to call Pencil through HTTP or SDK.

Pencil Agent Gateway is the thin service boundary that lets **PencilAgent** call Pencil after startup through a stable HTTP/SDK interface.
It exposes `nano-pencil` as an OpenAI-compatible HTTP + SSE API while keeping the Agent engine independent, embeddable, and lightweight.

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway maintainers and AI coding agents working in this repository
[FROM] PencilAgent first; also Asgard Platform, nanopencil-editor, external HTTP clients, and future channel gateways
[TO]   Pencil through a stable HTTP/SDK surface backed by nano-pencil EngineAdapter
[HERE] This repository: the HTTP/API/SDK serving layer used by PencilAgent, not the Agent engine and not the platform console
```

## Positioning

Pencil Agent Gateway is primarily for **PencilAgent** (the nanoPencil project at `/workspace/nanoPencil`, ecosystem core, npm package `@pencil-agent/nano-pencil`).
For the full term table see [docs/06-glossary.md](./docs/06-glossary.md).

At runtime:

```text
PencilAgent starts
  -> loads Gateway URL or SDK client
  -> calls Pencil Agent Gateway
  -> Gateway calls Pencil/nano-pencil through EngineAdapter
  -> Gateway returns OpenAI-compatible text/SSE events
```

The Gateway is not the Agent engine. It is also not the full SaaS platform.

| Layer | Project | Responsibility |
|------|---------|----------------|
| Agent engine | `nano-pencil` | Model dialogue, tool loop, memory primitives, engine SDK, ACP CLI |
| Serving layer | `pencil-agent-gateway` | OpenAI-compatible HTTP API, SSE streaming, API Key auth, Agent instance config |
| Platform layer | `Asgard Platform` | Users, billing, marketplace, console, container orchestration |
| Client layer | `nanopencil-editor` | Writing UX, local workspace, desktop/web client integration |

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
│   ├── 05-pencilagent-runtime.md
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
10. PencilAgent HTTP/SDK runtime client contract.

See [docs/01-development-plan.md](./docs/01-development-plan.md) for the detailed task breakdown.

## Naming Note

The precise technical role is **Agent Gateway**: a serving gateway for Agent engines.
If this project later also owns Telegram/Slack/Discord/WeChat adapters, those should be split into a separate **Channel Gateway** to avoid mixing transport-channel concerns with Agent serving concerns.
