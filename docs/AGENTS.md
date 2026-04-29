# Pencil Agent Gateway Documentation

> P2 | Documentation module for architecture and integration guides

## DIP Metadata

```text
[WHO]  AI coding agents and human developers seeking Gateway architecture details
[FROM] Product requirements, implementation decisions, integration needs
[TO]   Implementation code, deployment configs, integration partners
[HERE] docs/ — Architecture docs, API contracts, integration guides, glossary
```

---

## Documentation Structure

| File | Purpose | Status |
|------|---------|--------|
| `00-product-boundary.md` | Product scope, goals, non-goals | ✅ Complete |
| `01-development-plan.md` | Milestones, task breakdown | ✅ Complete |
| `02-api-contract.md` | OpenAI-compatible API spec | ✅ Complete |
| `03-adapter-architecture.md` | Engine adapter design | ✅ Complete |
| `04-asgard-editor-integration.md` | Asgard/editor integration overview | ✅ Complete |
| `05-caller-runtime.md` | Caller SDK/runtime design | ✅ Complete |
| `06-glossary.md` | Terminology definitions | ✅ Complete |
| `07-m7-nano-pencil-integration.md` | M7 milestone: nano-pencil integration | ✅ Complete |
| `08-asgard-editor-end-to-end.md` | End-to-end integration guide | ✅ Complete |
| `09-asgard-integration-guide.md` | Asgard-specific integration | ✅ Complete |
| `10-editor-integration-guide.md` | Editor-specific integration | ✅ Complete |
| `11-containerized-deployment.md` | Docker/K8s deployment | ✅ Complete |
| `README.md` | Docs index | ✅ Complete |

---

## Document Categories

### Product & Planning
- `00-product-boundary.md` — What Gateway is and isn't
- `01-development-plan.md` — Development roadmap

### API & Protocol
- `02-api-contract.md` — OpenAI-compatible endpoints
- `03-adapter-architecture.md` — Engine abstraction layer

### Integration
- `04-asgard-editor-integration.md` — High-level integration
- `09-asgard-integration-guide.md` — Asgard specifics
- `10-editor-integration-guide.md` — Editor specifics
- `05-caller-runtime.md` — SDK/runtime for callers

### Implementation
- `07-m7-nano-pencil-integration.md` — nano-pencil SDK usage
- `08-asgard-editor-end-to-end.md` — Full integration flow
- `11-containerized-deployment.md` — Deployment guide

### Reference
- `06-glossary.md` — Terms: PencilAgent, EngineAdapter, etc.
- `README.md` — Documentation index

---

## Key Concepts

| Term | Definition |
|------|------------|
| **PencilAgent** | Configured Agent instance (= nano-pencil engine + Soul + memory + model + personality) |
| **EngineAdapter** | Abstraction for different agent engines |
| **Gateway** | HTTP serving layer, NOT the engine itself |
| **Caller** | Any HTTP client: OpenAI SDK, curl, Asgard, editor, etc. |
| **BYO Key** | Mode where agent carries its own API key |
| **Inherited** | Mode where Gateway uses host's nano-pencil auth |

---

## Reading Order

1. New to Gateway? → `00-product-boundary.md` → `02-api-contract.md`
2. Implementing integration? → `04-asgard-editor-integration.md` → specific guide
3. Deploying? → `11-containerized-deployment.md`
4. Contributing code? → `03-adapter-architecture.md` → `../src/AGENTS.md`

---

*Parent: [../AGENTS.md](../AGENTS.md)*
