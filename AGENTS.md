# AGENTS.md

## DIP Metadata

```text
[WHO]  AI coding agents and human maintainers editing Pencil Agent Gateway
[FROM] Product roadmap, Gateway docs, PencilAgent runtime needs, Asgard/editor integration contracts
[TO]   A stable Gateway that lets PencilAgent call Pencil through HTTP/SDK
[HERE] Repository-level development rules, DIP protocol, architecture boundaries, and implementation guardrails
```

## Mission

This repository exists primarily to serve **PencilAgent**.

The core runtime flow is:

```text
PencilAgent
  -> HTTP client or Gateway SDK
  -> Pencil Agent Gateway
  -> EngineAdapter
  -> Pencil / nano-pencil
```

Build the Gateway as a small, stable serving layer. Keep Agent engine logic independent and lightweight.

## DIP Protocol

Every architecture-facing document and major module must be understandable through:

```text
[WHO]  The actor, owner, or maintainer responsible for this layer.
[FROM] The upstream caller, input source, or dependency this layer receives from.
[TO]   The downstream callee, output target, or contract this layer sends to.
[HERE] The exact responsibility boundary of the current file/module/repository.
```

Use DIP metadata to prevent boundary drift.

Example:

```text
[WHO]  Gateway chat route
[FROM] PencilAgent HTTP request or OpenAI-compatible client request
[TO]   AgentRegistry -> EngineAdapter -> nano-pencil
[HERE] Validate request, enforce auth, route to instance, serialize OpenAI-compatible response
```

## Architecture Boundaries

| Boundary | Belongs Here | Does Not Belong Here |
|----------|--------------|----------------------|
| HTTP serving | Hono routes, API Key auth, SSE, OpenAI-compatible schema | model provider internals |
| Engine bridge | `EngineAdapter`, `NanoPencilEngineAdapter` | direct SDK calls scattered across routes |
| PencilAgent access | HTTP client contract, future Gateway SDK | PencilAgent business logic |
| Platform integration | Asgard HTTP contract and headers | Asgard users, billing, marketplace UI |
| Client integration | editor HTTP provider contract | editor UI implementation |
| Channels | only future HTTP-facing contract | Telegram/Slack/Discord/WeChat adapters |

## Mandatory Rules

1. Do not import `nano-pencil` outside the engine adapter layer.
2. Do not add user registration, billing, marketplace, or console UI.
3. Do not add Telegram/Slack/Discord/WeChat adapters to this repository.
4. Do not implement workflow/DAG orchestration in v0.1.
5. Keep `/v1/chat/completions` OpenAI-compatible.
6. Keep Pencil-specific extensions documented and namespaced.
7. Keep Gateway usable by PencilAgent through HTTP first, SDK second.
8. Update docs before or with any API/architecture change.
9. Preserve DIP metadata in new planning docs.
10. Prefer thin adapters over broad abstractions until a second real implementation exists.

## Implementation Defaults

- Runtime: Node.js 20+
- Language: TypeScript
- HTTP framework: Hono
- Validation: Zod
- Tests: Vitest
- MVP storage: file-backed JSON/YAML
- MVP protocol: HTTP + SSE
- Primary consumer: PencilAgent
- Default engine: nano-pencil through `NanoPencilEngineAdapter`

## Expected Repository Shape

```text
src/
  app.ts
  server.ts
  config.ts
  routes/
  auth/
  protocol/
  agent/
  engine/
  store/
  sdk/
  util/
```

The `sdk/` directory, when added, is for a small PencilAgent-facing client wrapper around Gateway HTTP calls. It must not bypass HTTP semantics or import engine internals.

## PencilAgent Runtime Contract

PencilAgent should be able to use either:

```text
HTTP:
  POST /v1/chat/completions
  GET  /v1/models

SDK:
  const client = new PencilGatewayClient({ baseUrl, apiKey })
  client.chat({ model, messages, stream, sessionId })
```

The SDK is a convenience wrapper over HTTP, not a separate private protocol.

## Deferral Rules

Defer these unless explicitly requested:

- channel gateway implementation
- bidirectional local tool callback
- persistent vector memory
- multi-tenant user system
- Asgard container orchestration code
- web console
- workflow runtime

## Review Checklist

Before finishing a change, check:

- Does this serve PencilAgent calling Pencil through HTTP/SDK?
- Is the engine still independent?
- Is the route layer free of nano-pencil internals?
- Does the API remain OpenAI-compatible?
- Are docs and DIP metadata updated?
- Are postponed platform/channel features still out of scope?
