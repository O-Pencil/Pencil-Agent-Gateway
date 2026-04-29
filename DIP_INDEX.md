# Pencil Agent Gateway — DIP Documentation Index

> P1 | Dual-phase Isomorphic Documentation (DIP) index for this repository

---

## What is DIP?

**DIP (Dual-phase Isomorphic Documentation)** is a 3-layer fractal documentation protocol:

| Layer | File | Purpose |
|-------|------|---------|
| **P1** | `AGENTS.md` (root) | Project overview, architecture, rules |
| **P2** | `{module}/AGENTS.md` | Module member lists, local navigation |
| **P3** | Source file headers | WHO/FROM/TO/HERE contracts |

**Principle**: Map (docs) and terrain (code) must stay isomorphic. Code changes require doc updates.

---

## Documentation Map

### P1 — Root Documents

| File | Description |
|------|-------------|
| [AGENTS.md](./AGENTS.md) | **Primary P1** — Project rules, architecture boundaries, mission |
| [README.md](./README.md) | User-facing introduction, quick start |
| [DIP_INDEX.md](./DIP_INDEX.md) | This file — DIP navigation hub |

### P2 — Module Documents

| Module | P2 Document | Contents |
|--------|-------------|----------|
| `src/` | [src/AGENTS.md](src/AGENTS.md) | Source code member list, cross-module dependencies |
| `docs/` | [docs/AGENTS.md](docs/AGENTS.md) | Architecture docs index |
| `test/` | [test/AGENTS.md](test/AGENTS.md) | Test organization |
| `config/` | [config/AGENTS.md](config/AGENTS.md) | Configuration reference |

### P3 — File Headers

All source files (`.ts`, `.test.ts`) contain P3 headers:

```typescript
/**
 * [WHO]  Gateway server
 * [FROM] HTTP clients
 * [TO]  Routes, engine adapters
 * [HERE] Main Hono application setup
 */
```

**Files with P3 headers:**
- `src/server.ts`
- `src/app.ts`
- `src/config.ts`
- `src/routes/chat.ts`
- `src/agent/registry.ts`
- `src/auth/middleware.ts`
- `src/engine/adapter.ts`
- `src/engine/nano-adapter.ts`
- `src/engine/mock-adapter.ts`
- `src/protocol/types.ts`
- `src/store/session.ts`
- `src/util/errors.ts`
- `src/util/logger.ts`
- All `*.test.ts` files

---

## Quick Navigation

### By Task

| Task | Start Here |
|------|------------|
| Understand the project | [README.md](./README.md) → [AGENTS.md](./AGENTS.md) |
| Find a specific source file | [src/AGENTS.md](src/AGENTS.md) |
| Understand architecture | [docs/AGENTS.md](docs/AGENTS.md) → specific doc |
| Run/configure tests | [test/AGENTS.md](test/AGENTS.md) |
| Configure the Gateway | [config/AGENTS.md](config/AGENTS.md) |
| Add a new feature | [AGENTS.md](./AGENTS.md) (rules) → [src/AGENTS.md](src/AGENTS.md) (structure) |

### By Role

| Role | Reading Path |
|------|--------------|
| **New developer** | README → AGENTS.md → docs/00-product-boundary.md → src/AGENTS.md |
| **Integrator** | docs/02-api-contract.md → docs/09-asgard-integration-guide.md or docs/10-editor-integration-guide.md |
| **DevOps** | docs/11-containerized-deployment.md → config/AGENTS.md |
| **Contributor** | AGENTS.md (rules) → src/AGENTS.md (structure) → specific source file |

---

## DIP Maintenance

### When to Update

| Change | Required Updates |
|--------|------------------|
| New source file | Add P3 header, update `src/AGENTS.md` member list |
| New module/directory | Create `AGENTS.md` for that module, update parent P2 |
| API change | Update `docs/02-api-contract.md`, relevant P3 headers |
| Architecture change | Update root `AGENTS.md`, relevant P2s |
| Dependency change | Update P3 [FROM] fields |

### Verification

Before committing changes:

1. **P3 Check**: Does every source file have a P3 header?
2. **P2 Check**: Is the member list in `src/AGENTS.md` complete?
3. **P1 Check**: Do architecture boundaries in root `AGENTS.md` still hold?
4. **Link Check**: Do parent links in P2 files resolve?

---

## Cross-Project Independence

This repository's DIP documentation is **self-contained**. It does not depend on sibling projects in the Pencil ecosystem being present at specific paths.

External references (if any) are:
- **Soft references**: Named mentions (e.g., "Asgard Platform", "nano-pencil SDK")
- **Not hard dependencies**: No `../other-project/` paths in critical documentation

The Gateway is designed to be:
- Cloned and run independently
- Understood without sibling project context
- Integrated via standard HTTP/OpenAI API contracts

---

## Document Isomorphism Status

| Layer | Status | Last Verified |
|-------|--------|---------------|
| P1 (root AGENTS.md) | ✅ Current | 2026-04-28 |
| P2 (src/AGENTS.md) | ✅ Current | 2026-04-28 |
| P2 (docs/AGENTS.md) | ✅ Current | 2026-04-28 |
| P2 (test/AGENTS.md) | ✅ Current | 2026-04-28 |
| P2 (config/AGENTS.md) | ✅ Current | 2026-04-28 |
| P3 (source headers) | ✅ Complete | 2026-04-28 |

---

*This DIP index ensures the documentation map stays isomorphic with the code terrain.*
