# AGENTS.md

## DIP Metadata

```text
[WHO]  AI coding agents and human maintainers editing Pencil Agent Gateway
[FROM] Product roadmap, Gateway docs, OpenAI API spec, nano-pencil SDK
[TO]   HTTP callers (OpenAI SDK, curl, Asgard Platform, nanopencil-editor, nanoPencil CLI remote mode)
[HERE] Repository-level development rules, DIP protocol, architecture boundaries, and implementation guardrails — this is a self-contained HTTP gateway, not dependent on sibling projects in the Pencil ecosystem
```

## Mission

This repository hosts **PencilAgent instances** (each = `nano-pencil engine + Soul + memory + model + personality`) and serves callers — nanoPencil CLI in remote mode, nanopencil-editor, Asgard Platform, and third-party HTTP clients — over a stable OpenAI-compatible HTTP/SSE API.

The core runtime flow is:

```text
Caller application
  -> selects target PencilAgent (`pencil/<agent-id>`)
  -> HTTP client or Gateway SDK
  -> Pencil Agent Gateway
  -> EngineAdapter
  -> nano-pencil engine
```

Build the Gateway as a small, stable serving layer. Keep Agent engine logic independent and lightweight. **PencilAgent is what the Gateway hosts, not who calls the Gateway.** For terminology, see [docs/06-glossary.md](./docs/06-glossary.md).

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
[FROM] OpenAI-compatible caller request (nanoPencil CLI, editor, Asgard proxy, 3rd-party)
[TO]   AgentRegistry -> PencilAgent instance -> EngineAdapter -> nano-pencil
[HERE] Validate request, enforce auth, route to PencilAgent instance, serialize OpenAI-compatible response
```

## Architecture Boundaries

| Boundary | Belongs Here | Does Not Belong Here |
|----------|--------------|----------------------|
| HTTP serving | Hono routes, API Key auth, SSE, OpenAI-compatible schema | model provider internals |
| Engine bridge | `EngineAdapter`, `NanoPencilEngineAdapter` | direct SDK calls scattered across routes |
| PencilAgent hosting | AgentRegistry, AgentInstance config, Soul/memory/model storage | caller business logic |
| Caller access | HTTP client contract, optional Gateway SDK | caller-side application logic |
| Platform integration | Asgard HTTP contract and headers | Asgard users, billing, marketplace UI |
| Editor integration | editor HTTP provider contract | editor UI implementation |
| Channels | stage-one WeChat/Feishu HTTP wrapper that calls Gateway as a client | channel logic inside EngineAdapter, AgentRegistry, or nano-pencil |

## Mandatory Rules

1. Do not import `nano-pencil` outside the engine adapter layer.
2. Do not add user registration, billing, marketplace, or console UI.
3. Keep channel adapters isolated under `src/channels/`; they must call Gateway over HTTP and must not import `AgentRegistry`, `EngineAdapter`, or `@pencil-agent/nano-pencil`.
4. Do not implement workflow/DAG orchestration in v0.1.
5. Keep `/v1/chat/completions` OpenAI-compatible.
6. Keep Pencil-specific extensions documented and namespaced.
7. Keep Gateway usable by callers through HTTP first, optional SDK second.
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
- Primary callers: nanoPencil CLI (remote mode), nanopencil-editor, Asgard Platform, 3rd-party OpenAI clients
- Primary served object: PencilAgent instances (`= nano-pencil engine + Soul + memory + model + personality`)
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

The `sdk/` directory, when added, is for a small caller-facing client wrapper around Gateway HTTP calls. It must not bypass HTTP semantics or import engine internals.

## Caller Runtime Contract

Callers (nanoPencil CLI in remote mode, editor, Asgard, 3rd-party) should be able to use either:

```text
HTTP:
  POST /v1/chat/completions
  GET  /v1/models

SDK:
  const client = new PencilGatewayClient({ baseUrl, apiKey })
  client.chat({ model: "pencil/<agent-id>", messages, stream, sessionId })
```

The SDK is a convenience wrapper over HTTP, not a separate private protocol.

## Deferral Rules

Defer these unless explicitly requested:

- additional channel gateway implementation beyond the stage-one WeChat/Feishu text wrapper
- bidirectional local tool callback
- persistent vector memory
- multi-tenant user system
- Asgard container orchestration code
- web console
- workflow runtime

## Review Checklist

Before finishing a change, check:

- Does this preserve the rule that Gateway HOSTS PencilAgents and SERVES callers (rather than calling out as PencilAgent)?
- Is the engine still independent?
- Is the route layer free of nano-pencil internals?
- Does the API remain OpenAI-compatible?
- Are docs and DIP metadata updated?
- Are postponed platform/channel features still out of scope?
