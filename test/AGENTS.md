# Pencil Agent Gateway Tests

> P2 | Test module for Gateway functionality verification

## DIP Metadata

```text
[WHO]  Test suite for Pencil Agent Gateway
[FROM] Implementation modules in src/, Vitest framework
[TO]   Test reports, CI/CD pipelines, developer feedback
[HERE] test/ — E2E smoke tests and integration test utilities
```

---

## Test Structure

```
test/
├── smoke.mjs              # E2E smoke test (standalone, no dependencies)
└── AGENTS.md              # This file
```

---

## Test Categories

| Test | Type | Purpose | Command |
|------|------|---------|---------|
| `*.test.ts` in `src/` | Unit/Integration | Module-level testing | `npm test` or `npm run test:run` |
| `smoke.mjs` | E2E | End-to-end verification | `node test/smoke.mjs` |

---

## Unit/Integration Tests (src/**/*.test.ts)

Located alongside source files:

| File | Tests |
|------|-------|
| `src/agent/registry.test.ts` | Agent registration, lookup, persistence |
| `src/auth/middleware.test.ts` | API Key authentication |
| `src/protocol/types.test.ts` | OpenAI protocol types |
| `src/routes/routes.test.ts` | HTTP route integration |
| `src/routes/chat.sse.test.ts` | SSE streaming |
| `src/store/session.test.ts` | Session persistence |
| `src/util/errors.test.ts` | Error classes |

Run with: `npm run test:run`

---

## E2E Smoke Test (smoke.mjs)

Standalone test requiring running server:

```bash
# 1. Start server
npm run dev

# 2. Run smoke test
node test/smoke.mjs
```

**Test Coverage:**
- Health endpoints (`/healthz`, `/readyz`)
- Agent CRUD (`POST/GET/DELETE /v1/agents`)
- Models listing (`GET /v1/models`)
- Chat completion (non-streaming)
- Chat streaming (SSE)
- Authentication boundaries

**Configuration:**
```javascript
const CONFIG = {
  baseUrl: 'http://localhost:8080',
  apiKey: 'pk_dev_default',
};
```

---

## Test Data

Temporary test data directories (auto-created, auto-cleaned):
- `.grub-test-data/` — Unit test data
- `.grub-test-data-routes/` — Route test data

---

## CI Integration

```yaml
# Example GitHub Actions
- run: npm ci
- run: npm run test:run        # Unit/integration tests
- run: npm run dev &           # Start server
- run: sleep 5                 # Wait for startup
- run: node test/smoke.mjs     # E2E smoke test
```

---

*Parent: [../AGENTS.md](../AGENTS.md)*
