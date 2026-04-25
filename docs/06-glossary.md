---
title: Glossary and Naming Reference
status: active
scope: glossary
owner: pencil-agent-gateway maintainers
created: 2026-04-25
updated: 2026-04-25
---

# Glossary and Naming Reference

## DIP Metadata

```text
[WHO]  Pencil Agent Gateway maintainers, AI coding agents, and ecosystem contributors
[FROM] Cross-project naming drift (nanoPencil / nano-pencil / PencilAgent / Pencil) observed during Gateway design
[TO]   A single normative term table used across Gateway docs and AI agent prompts
[HERE] Repository-level glossary and naming rules that all other Gateway docs must follow
```

## 1. Why This Document Exists

Several closely related names appear across the ecosystem. Without a glossary, AI coding agents working in this repo will treat them as interchangeable, and boundary drift will follow. This file pins the meaning of each term.

The most critical distinction this document fixes:

- **nanoPencil** is an engine project, not an Agent.
- **PencilAgent** is a configured Agent instance built on top of that engine, with its own Soul, memory, model, and personality.
- A PencilAgent has **identity**; an engine does not.

## 2. Term Table

| Term | Refers to | Notes |
|------|-----------|-------|
| **nanoPencil** | The engine project at `/workspace/nanoPencil` | Repository home of `@pencil-agent/nano-pencil` engine SDK and the `nanopencil` CLI binary. **Not itself a PencilAgent.** Provides the engine that PencilAgents are built on. |
| **nano-pencil** | The npm package `@pencil-agent/nano-pencil` published from the nanoPencil repo | Engine SDK only. Wrapped by `NanoPencilEngineAdapter`. |
| **PencilAgent** | A configured Agent instance: **nano-pencil engine + Soul + memory + model + personality** | The unit that has identity. Identified by `pencil/<agent-id>`. Lives inside Pencil Agent Gateway. **`PencilAgent` and "Pencil Agent instance" are synonymous;** prefer `PencilAgent` as the canonical short form. |
| **Pencil** | Umbrella term for the Agent capability that callers consume through Gateway | "Calls Pencil" means "calls a PencilAgent that Gateway is hosting." Not a separate project. |
| **Pencil Agent Gateway** | This repository / service | HTTP serving layer that hosts PencilAgent instances and exposes them over OpenAI-compatible HTTP. |
| **nanoPencil CLI** | The `nanopencil` binary shipped from nanoPencil project | A terminal Agent runtime. When configured to run remotely, it acts as a caller of one PencilAgent through Gateway. |
| **Asgard Platform** | External platform repo (`/workspace/Asgard-platform`) | Hosts users; each user creates multiple PencilAgents. Asgard proxies caller traffic to Gateway. |
| **nanopencil-editor** | External writing client repo | Desktop/Web editor; one of the callers; configures its own writing-focused PencilAgent. |
| **pencil-channel-gateway** | Future separate project | Telegram/Slack/Discord/WeChat adapters. Out of scope here. |

## 3. The PencilAgent Definition (Core)

A **PencilAgent** is a configured running unit:

```text
PencilAgent = nano-pencil engine
            + Soul (system prompt, style tags, behavioral defaults)
            + memory (short-term in v0.1; persistent later)
            + model (provider, name, credentials)
            + personality (tags, voice, optional fine-tunings)
```

A PencilAgent has identity. Two PencilAgents using the same engine but different Souls are different Agents (different writers, different code reviewers, different game NPCs).

## 4. Caller / Hosted Topology

```text
nanoPencil CLI (remote mode)        ┐
nanopencil-editor                    │   HTTP / SSE       Pencil Agent Gateway
Asgard Platform (proxying users)     ├──────────────────► hosts many PencilAgents
3rd-party OpenAI client              │                    (each = engine + Soul + memory + model)
                                     ┘                    │
                                                          ▼
                                                   nano-pencil engine
                                                   (one shared engine SDK)
```

**Each application/client configures its own PencilAgent instance(s).** Examples:

| Caller | Typical PencilAgent configuration |
|--------|-----------------------------------|
| nanoPencil CLI default | a coding-assistant PencilAgent (default Soul, local memory) |
| nanopencil-editor | a writing-assistant PencilAgent (writing Soul, project-scoped memory) |
| Asgard user | multiple PencilAgents per user (one per use case) |
| 3rd-party app | whatever PencilAgents the operator preconfigured |

The same Gateway instance may host many distinct PencilAgents at once; routing is by `model: pencil/<agent-id>`.

## 5. Naming Rules

1. In code, repo paths, package names: prefer the npm-style lowercase hyphenated form (`pencil-agent-gateway`, `nano-pencil`).
2. In prose and product copy: prefer the brand-style form (`Pencil Agent Gateway`, `nanoPencil`, `PencilAgent`).
3. Never write `pencil-gateway` or `Pencil Gateway` as a repository or package name; those forms are ambiguous with future Channel Gateway.
4. When a doc speaks of "the engine," it means `nano-pencil` (the npm SDK) accessed through `NanoPencilEngineAdapter`.
5. When a doc speaks of "an Agent" or "a PencilAgent," it means a configured instance, never the nanoPencil project as a whole.

## 6. Common Anti-Patterns

| Bad | Why | Better |
|-----|-----|--------|
| "PencilAgent calls Gateway" | Reverses caller direction. PencilAgent is what is being called, not who is calling. | "Caller calls a PencilAgent **through** Gateway" |
| "nanoPencil is a PencilAgent" | Conflates engine project with Agent instance | "nanoPencil is the engine project; a PencilAgent is a configured instance built on it" |
| "Pencil Agent instance ≠ PencilAgent" | They are the same thing under this glossary | Use `PencilAgent` as the canonical short form |
| "Install pencil-gateway" | Ambiguous with channel gateway | "Install pencil-agent-gateway" |
| "nanoPencil SDK" | Mixes project name with package role | "nano-pencil SDK" or "nanoPencil's engine SDK" |
| "Pencil engine" | Vague | "nano-pencil engine" |
| "Gateway is primarily for PencilAgent" | Reads as if PencilAgent is a caller | "Gateway primarily hosts PencilAgents and serves callers (nanoPencil CLI, editor, Asgard, third-party)" |

## 7. Cross-Reference

- Repository identity: see [../README.md](../README.md)
- DIP protocol and rules: see [../AGENTS.md](../AGENTS.md)
- Caller-facing runtime contract: see [05-caller-runtime.md](./05-caller-runtime.md)
- Engine boundary and Agent instance internals: see [03-adapter-architecture.md](./03-adapter-architecture.md)
