---
title: Pencil Agent Gateway Docs Index
status: active
scope: docs-index
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Pencil Agent Gateway Docs

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway contributors and AI coding agents
[FROM] Repository README, AGENTS.md, product roadmap, and PencilAgent runtime requirements
[TO]   All planning, API, runtime, and integration documents in this directory
[HERE] Documentation index and reading order for building a Gateway that PencilAgent can call through HTTP/SDK
```

## Reading Order

0. [../AGENTS.md](../AGENTS.md)
   - Required instructions for AI coding agents, including DIP protocol and repository boundaries.

1. [00-product-boundary.md](./00-product-boundary.md)
   - Defines what Gateway is, what it is not, naming, deployment shape, and Channel Gateway separation.

2. [01-development-plan.md](./01-development-plan.md)
   - Detailed phased implementation plan from empty repo to v0.1, then v0.2/v0.3 roadmap.

3. [02-api-contract.md](./02-api-contract.md)
   - OpenAI-compatible API contract, auth, SSE, models, agents, errors, cancellation.

4. [03-adapter-architecture.md](./03-adapter-architecture.md)
   - `EngineAdapter`, `AgentInstance`, storage, memory, tool boundary, and future extension model.

5. [04-asgard-editor-integration.md](./04-asgard-editor-integration.md)
   - Asgard integration, nanopencil-editor `HttpChatProvider`, self-hosted client flow, and future Channel Gateway.

6. [05-pencilagent-runtime.md](./05-pencilagent-runtime.md)
   - Primary runtime contract for PencilAgent calling Pencil through Gateway HTTP or Gateway SDK.

7. [06-glossary.md](./06-glossary.md)
   - Normative term table; pins the meaning of nanoPencil / nano-pencil / PencilAgent / Pencil / Pencil Agent Gateway.

## Status

These documents are the source of truth for the v0.1 build until code exists.
When implementation begins, API or architecture changes must update the matching document in the same pull request.
