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

Several closely related names appear across the ecosystem:

```text
nanoPencil   nano-pencil   PencilAgent   Pencil   Pencil Agent   pencil-agent-gateway
```

Without a glossary, AI coding agents working in this repo will treat them as interchangeable, and boundary drift will follow. This file pins the meaning of each term.

## 2. Term Table

| Term | Refers to | Notes |
|------|-----------|-------|
| **nanoPencil** | The project / repository at `/workspace/nanoPencil` | Brand name of the Agent core. Ships the engine SDK and a TUI/CLI Agent runtime. Primary consumer of Gateway. |
| **nano-pencil** | The npm package `@pencil-agent/nano-pencil` published from the nanoPencil repo | The engine SDK that `NanoPencilEngineAdapter` wraps. Lowercased and hyphenated to match the npm name. |
| **PencilAgent** | Synonymous with **nanoPencil** | Used in Gateway docs when referring to the consumer/brand identity. When in doubt, treat `PencilAgent === nanoPencil`. |
| **Pencil** | The umbrella name for the Agent capability surface that callers consume through Gateway | "Calls Pencil" means "calls the Agent capability, which Gateway routes to the configured engine." Not a separate project. |
| **Pencil Agent instance** | A configured running unit: engine + soul + memory + personality | Lives inside Gateway. Identified by `pencil/<agent-id>`. |
| **Pencil Agent Gateway** | This repository / service | HTTP serving layer. Name is normative; do not shorten to `pencil-gateway` in code or repo references. |
| **Asgard Platform** | External platform repo (`/workspace/Asgard-platform`) | Manages users, billing, marketplace; calls Gateway over HTTP. Not in scope here. |
| **nanopencil-editor** | External writing client repo | Desktop/Web editor; one of the HTTP consumers of Gateway. |
| **pencil-channel-gateway** | Future separate project | Telegram/Slack/Discord/WeChat adapters. Explicitly out of scope here. |

## 3. Caller Map

```text
nanoPencil (a.k.a. PencilAgent) ──┐
nanopencil-editor                 ├── HTTP / SSE ──► Pencil Agent Gateway ──► EngineAdapter ──► nano-pencil engine
Asgard Platform                   ├──                                                        (or future engines)
Third-party OpenAI client         ┘
```

The "primary consumer" framing means: when a design decision creates tension between caller groups, prefer what keeps **nanoPencil** runtime ergonomic.

## 4. Naming Rules

1. In code, repo paths, package names: prefer the npm-style lowercase hyphenated form (`pencil-agent-gateway`, `nano-pencil`).
2. In prose and product copy: prefer the brand-style form (`Pencil Agent Gateway`, `nanoPencil`, `PencilAgent`).
3. Never write `pencil-gateway` or `Pencil Gateway` as a repository or package name; those forms are ambiguous with future Channel Gateway.
4. Never refer to `nano-pencil` as the brand-facing entity in user-facing docs; use `nanoPencil` or `PencilAgent` for that.
5. When a doc speaks of "the engine," it means `nano-pencil` (the npm SDK) accessed through `NanoPencilEngineAdapter`.

## 5. Common Anti-Patterns

| Bad | Why | Better |
|-----|-----|--------|
| "Gateway calls PencilAgent" | Reverses caller direction | "PencilAgent calls Gateway, which calls the nano-pencil engine" |
| "Install pencil-gateway" | Ambiguous with channel gateway | "Install pencil-agent-gateway" |
| "nanoPencil SDK" | Mixes project name with package role | "nano-pencil SDK" or "nanoPencil's engine SDK" |
| "Pencil engine" | Vague | "nano-pencil engine" |
| "Pencil Agent runtime is a separate project" | False; it is nanoPencil | "PencilAgent runtime is provided by the nanoPencil project" |

## 6. Cross-Reference

- Repository identity: see [../README.md](../README.md)
- DIP protocol and rules: see [../AGENTS.md](../AGENTS.md)
- Caller-facing runtime contract: see [05-pencilagent-runtime.md](./05-pencilagent-runtime.md)
- Engine boundary: see [03-adapter-architecture.md](./03-adapter-architecture.md)
