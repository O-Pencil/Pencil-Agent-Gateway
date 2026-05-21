---
title: Pencil Agent Gateway Tool Callback Protocol (v0.2)
status: draft
scope: tool-callback-protocol-design
owner: pencil-agent-gateway maintainers
created: 2026-05-20
updated: 2026-05-20
related:
  - docs/02-api-contract.md
  - docs/03-adapter-architecture.md
  - docs/04-asgard-editor-integration.md (§3.5)
  - docs/05-caller-runtime.md
  - docs/08-asgard-editor-end-to-end.md
  - nanopencil-editor/docs/technical-proposals/pencil-platform-roadmap.md (阶段四 · 工具回传)
---

# Pencil Agent Gateway Tool Callback Protocol (v0.2)

> **状态：draft / 起草**
> 本协议是 Gateway v0.2 的核心交付物。本文只定义协议形状与边界，不做实现细节；实现里程碑见 §15。

## DIP Metadata

```text
[WHO]  Gateway maintainers + caller integrators (editor / CLI / 3rd-party) implementing local tool execution against a remote PencilAgent
[FROM] EngineAdapter emits `tool_request` events; Gateway routes these to the originating caller via SSE
[TO]   Caller-side tool runtime (e.g. editor's read_file/write_file) executes the tool and posts a `tool_response` back through Gateway HTTP
[HERE] Wire format, lifecycle, auth, and EngineEvent extension contract for the dual-channel (SSE outbound + HTTP inbound) tool callback flow
```

---

## 1. Goal

Let Remote HTTP callers (editor, CLI remote mode, 3rd-party clients) provide **local tool execution** to a remote PencilAgent that runs inside Gateway, while keeping the request side OpenAI-compatible.

Concretely: enable a writing chat in `nanopencil-editor` Remote HTTP mode to call `read_file` / `write_file` / shell tools that exist only on the user's machine, with the Agent reasoning happening at the Gateway.

This closes the **capability gap** between local ACP mode and Remote HTTP mode that currently forces editor users to pick between "use local tools" and "use a remote/shared Agent".

## 2. Why Now

Aligned with editor roadmap stage 4 (work-track A). v0.1 ships OpenAI-compatible text/SSE only; `tools` / `tool_choice` are accepted-and-ignored. Without callback the only way to deliver local tools is to:

- (a) stay on ACP local mode — loses shared/remote PencilAgent benefits, or
- (b) reimplement every tool inside Gateway — kills Gateway's "no engine internals" boundary and explodes scope.

A dual-channel callback contract is the minimum increment that unlocks this without growing the engine's surface or breaking OpenAI compatibility.

## 3. Non-Goals (v0.2)

- **No full DAG / workflow engine.** Tools are single-shot request/response; multi-step workflows belong to caller code.
- **No tool registry inside Gateway.** Gateway does not own tool definitions; the caller advertises them per-request.
- **No parallel tool fan-out in the first cut.** v0.2 first cut serializes tool calls per turn; parallel callbacks are a v0.2.x extension (see §16).
- **No image/binary tool results.** Tool I/O is JSON-serializable strings only.
- **No persistent tool history.** The caller may persist responses; Gateway does not store them.
- **No cross-session tool calls.** A `tool_call_id` is valid only within the session that created it.

## 4. Architecture

Two channels, both terminated by Gateway:

```text
                     SSE  (outbound — Gateway → caller)
                ┌───────────────────────────────────┐
                │   event: pencil.tool_request      │
                │   data:  { tool_call_id, name,    │
                │            arguments, ... }       │
Caller ◄────────┘                                   │
   │                                                │
   │  POST /v1/agents/:agentId/sessions/:sid/tool_response
   │            HTTP (inbound — caller → Gateway)
   ▼
Gateway ── relays response back into the active EngineAdapter run loop
   │
   ▼
PencilAgent / EngineAdapter continues; next text_delta or another tool_request follows
```

Both channels share the same `session_id` and the same Bearer API Key. The SSE stream that carried the `tool_request` MUST stay open until the caller posts `tool_response` (or times out) — Gateway resumes the same EngineAdapter iterator after the response lands.

### 4.1 Why Not WebSocket

Considered and rejected for v0.2:

- Editor and CLI already use plain `fetch` for SSE; adding a WS dependency widens caller surface area for ~zero protocol gain.
- HTTP POST is debuggable with curl; WS isn't.
- WS keeps a persistent socket per session; Gateway already manages SSE per turn — a second long-lived socket doubles connection accounting.

WS-based callback may revisit in v0.3 if benchmarks justify it.

### 4.2 Why Not Embed Response in Next `/v1/chat/completions`

Considered: have caller stop the SSE stream, then send a new chat request with the tool result in `messages`. Rejected because:

- It breaks "one turn = one SSE stream" — the Agent loop has to be paused and re-entered with full context replay.
- It doubles latency for every tool call (TCP + TLS + auth + history rehydration).
- It can't carry mid-turn tool state (intermediate `thinking` events would be lost).

The dual-channel approach keeps a single Agent run alive across multiple tool round-trips.

## 5. Caller Capability Advertisement

A caller declares which tools it can execute by extending the existing `/v1/chat/completions` request body. The shape is intentionally close to OpenAI tools but lives under an explicit Pencil namespace to avoid confusion with model-native tools:

```json
{
  "model": "pencil/writing-assistant",
  "messages": [...],
  "stream": true,
  "session_id": "draft-001",
  "pencil_client_tools": [
    {
      "name": "read_file",
      "description": "Read a UTF-8 file from the caller's workspace",
      "parameters": {
        "type": "object",
        "properties": { "path": { "type": "string" } },
        "required": ["path"]
      },
      "timeout_ms": 8000
    }
  ]
}
```

Rules:

- `pencil_client_tools` is optional. If absent, Gateway runs in v0.1 behavior (no callback; PencilAgent must not emit `tool_request`).
- If present, Gateway forwards this advertisement to the EngineAdapter via `EngineRunRequest.clientTools`.
- The EngineAdapter is responsible for grounding the Agent on what tools exist; PencilAgents that don't support tools simply ignore the field.
- `timeout_ms` is per-tool; the Gateway-wide default is `30_000`. Per-tool value caps at `120_000`.
- Tool names must match `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`.

The OpenAI-native `tools` / `tool_choice` fields stay accepted-and-ignored in v0.2 to avoid two competing surfaces. A future v0.3 may bridge them.

## 6. SSE Event: `pencil.tool_request`

Emitted on the open `/v1/chat/completions` stream when the EngineAdapter yields a `tool_request`.

```text
event: pencil.tool_request
data: {
  "tool_call_id": "tc_01HXYZ...",
  "session_id": "draft-001",
  "agent_id": "writing-assistant",
  "name": "read_file",
  "arguments": { "path": "chapters/01.md" },
  "timeout_ms": 8000,
  "issued_at": "2026-05-20T08:12:33.512Z"
}
```

Field rules:

| Field | Required | Notes |
|---|---|---|
| `tool_call_id` | yes | ULID-style; unique within the session lifetime |
| `session_id` | yes | echoes the request's `session_id` for client-side correlation |
| `agent_id` | yes | resolved id (no `pencil/` prefix) |
| `name` | yes | matches one of the advertised `pencil_client_tools[].name` |
| `arguments` | yes | JSON object that conforms to the advertised `parameters` schema; Gateway does NOT validate schema in v0.2 first cut (caller side validates) |
| `timeout_ms` | yes | effective timeout — Gateway picks `min(advertisedToolTimeout, agentDefault, 120000)` |
| `issued_at` | yes | RFC 3339 UTC timestamp |

If the EngineAdapter emits `tool_request` for a tool name the caller did not advertise, Gateway converts it to an `error` event with code `tool_not_advertised` and aborts the turn. This is a protocol violation, not a runtime fallback.

## 7. HTTP Endpoint: `POST .../tool_response`

```http
POST /v1/agents/:agentId/sessions/:sessionId/tool_response
Authorization: Bearer <same-api-key-as-the-streaming-request>
Content-Type: application/json
```

```json
{
  "tool_call_id": "tc_01HXYZ...",
  "status": "ok",
  "output": "<UTF-8 string up to 256 KiB>"
}
```

Error form:

```json
{
  "tool_call_id": "tc_01HXYZ...",
  "status": "error",
  "error": {
    "code": "tool_runtime_error",
    "message": "ENOENT: chapters/01.md"
  }
}
```

Field rules:

| Field | Required | Notes |
|---|---|---|
| `tool_call_id` | yes | must match an outstanding `pencil.tool_request` for this session |
| `status` | yes | `ok` \| `error` \| `cancelled` |
| `output` | yes when `status=ok` | UTF-8 string ≤ 256 KiB; binary or larger payloads are out of scope (§3) |
| `error` | yes when `status=error` | `{code, message}`; `code` is a stable lowercase identifier the caller picks |

Response codes:

| Status | Meaning |
|---|---|
| 202 Accepted | Gateway accepted the response and resumed the Agent run; the SSE stream remains the source of truth |
| 401 | API Key invalid or expired |
| 403 | API Key cannot access this `agentId`/`sessionId` |
| 404 | `tool_call_id` unknown or already resolved (idempotent: don't retry) |
| 409 | `tool_call_id` already received a response (caller bug; ignore) |
| 410 | session was cancelled or timed out before response arrived |
| 413 | `output` exceeded 256 KiB |
| 422 | request shape invalid |

Gateway MUST NOT return tool output on this HTTP response body. Tool result text belongs in the SSE stream as subsequent `text_delta` (or in a follow-up `pencil.tool_request`). This keeps the SSE stream the single source of truth for turn progress.

## 8. EngineEvent Extension

`EngineEvent` (see `docs/03-adapter-architecture.md` §2) adds:

```ts
export type EngineEvent =
  | { type: "text_delta"; text: string }
  | { type: "done"; finishReason: "stop" | "length" | "cancelled" | "tool_calls" }
  | { type: "error"; error: Error }
  | {
      type: "tool_request";
      toolCallId: string;
      name: string;
      arguments: Record<string, unknown>;
      timeoutMs: number;
    };
```

Notes:

- `finishReason: "tool_calls"` is now allowed (was reserved-but-forbidden in v0.1).
- The EngineAdapter MUST surface tool results back into the underlying engine through whatever mechanism the adapter chooses; Gateway delivers the result via a single channel: the `EngineAdapter.provideToolResponse(toolCallId, response)` method (added to the interface, see §9).

## 9. EngineAdapter Contract Extension

```ts
export interface EngineAdapter {
  readonly id: string;
  initialize?(): Promise<void>;
  run(request: EngineRunRequest): AsyncIterable<EngineEvent>;
  provideToolResponse?(
    toolCallId: string,
    response: ToolCallResponse
  ): Promise<void>;
  dispose?(): Promise<void>;
}

export type ToolCallResponse =
  | { status: "ok"; output: string }
  | { status: "error"; error: { code: string; message: string } }
  | { status: "cancelled" };
```

Rules:

- If an adapter does not implement `provideToolResponse`, Gateway treats it as not-tool-capable: any inbound `tool_response` POST returns 404, and emitting `tool_request` raises `engine_misconfigured`.
- The adapter is responsible for matching `toolCallId` back to its internal pending tool call. Gateway is a pass-through for the id.
- `provideToolResponse` MUST be safe to call exactly once per `toolCallId`; subsequent calls return without effect.

`EngineRunRequest` also extends:

```ts
export type EngineRunRequest = {
  // ...existing fields
  clientTools?: ClientToolAdvertisement[];
};

export type ClientToolAdvertisement = {
  name: string;
  description?: string;
  parameters?: JsonSchema;
  timeoutMs?: number;
};
```

The default `NanoPencilEngineAdapter` becomes responsible for binding `clientTools` to nano-pencil's tool surface (engine-side detail; spec'd in nanoPencil v0.x).

## 10. Auth & Isolation

- A `tool_response` POST MUST use the same Bearer API Key that opened the SSE stream. Gateway records the key hash with the `tool_call_id` and rejects mismatches with `403`.
- A `tool_call_id` is bound to one `(agentId, sessionId)` pair. Cross-session reuse returns `404`.
- Asgard, when proxying, MUST forward the original caller's effective key to Gateway; Asgard's own internal key cannot resolve a tool call issued under a user's session.

## 11. Lifecycle / State Machine

```text
pending  ── on tool_response (ok|error) ──► resolved
pending  ── on timeout (timeout_ms)     ──► timed_out  ── Gateway emits error event, aborts turn
pending  ── on caller cancel / abort    ──► cancelled  ── EngineAdapter notified with status=cancelled
pending  ── on session end / kill       ──► invalidated (subsequent POST → 410)
```

- Pending tool calls are kept in memory only; Gateway does not persist them across restarts (a restart aborts in-flight turns — caller retries the original chat request).
- `timed_out` is reported on the SSE stream as `event: error, data: {code: "tool_timeout", tool_call_id}` followed by `data: [DONE]`.

## 12. Cancellation

Two cancellation paths:

1. **Caller-side AbortController** on the SSE fetch → Gateway treats the turn as cancelled; any pending tool calls move to `cancelled` and `EngineAdapter.provideToolResponse(id, {status:"cancelled"})` is invoked.
2. **Explicit tool-only cancel** via `POST .../tool_response` with `status:"cancelled"` → cancels the specific tool but keeps the turn alive; the Agent may recover (e.g. fall back to text) or fail the turn itself.

The Agent run is bound to one SSE stream; if the stream dies, all pending tools die with it.

## 13. Error Mapping (SSE side)

When Gateway emits `event: error` during a tool flow, `data.code` uses these stable values:

| code | trigger |
|---|---|
| `tool_not_advertised` | EngineAdapter requested a tool not in `pencil_client_tools` |
| `tool_timeout` | tool didn't respond within `timeout_ms` |
| `tool_payload_too_large` | inbound `output` exceeded 256 KiB |
| `tool_invalid_response` | `tool_response` POST body failed validation |
| `engine_misconfigured` | adapter emitted `tool_request` but lacks `provideToolResponse` |
| `session_lost` | session died (server restart, eviction) before response arrived |

These compose with existing error codes (`unauthorized`, `agent_not_found`, etc.) defined in `docs/02-api-contract.md`.

## 14. Backward Compatibility

- v0.1 clients that do NOT send `pencil_client_tools`: Gateway runs as today; PencilAgents that don't emit `tool_request` keep working unchanged.
- v0.1 clients that DO send the field but talk to a PencilAgent on a non-tool-capable EngineAdapter: Gateway forwards advertisement to the adapter, adapter ignores it, no behavior change. No error is raised — silence is the correct response.
- v0.2 Gateway talking to a v0.1 caller with no callback support: if the EngineAdapter still tries to emit `tool_request`, Gateway converts it to `tool_not_advertised` error.
- The OpenAI-native `tools` / `tool_choice` fields remain accepted-and-ignored. Mixing them with `pencil_client_tools` is allowed; the OpenAI ones are still ignored.

This means v0.2 ships **purely additive** — no v0.1 caller code breaks.

## 15. Implementation Plan

Three small milestones, each independently testable. Estimates use single-developer-day units.

### M-tools-1: Wire format & EngineAdapter contract (1.5 d)

- Extend `EngineEvent` and `EngineAdapter` types (§8, §9).
- Extend `EngineRunRequest` with `clientTools`.
- Wire `pencil_client_tools` parsing in `/v1/chat/completions` request schema.
- Add `tool_call_id` correlation table in Gateway (in-memory, per-process).
- Add `POST /v1/agents/:agentId/sessions/:sessionId/tool_response` route (returns 404 until M-tools-2).
- Update `MockEngineAdapter` to support scripted tool requests for tests.
- Unit tests: schema validation, id correlation, idempotent receipt.

**Verification**: `MockEngineAdapter` emits a tool_request, integration test acts as caller and posts a response; Gateway resumes and completes the turn.

### M-tools-2: NanoPencilEngineAdapter integration (2 d)

- Bind `clientTools` to nano-pencil's tool surface (depends on nano-pencil exposing a "remote tool" registration API — coordinate with nanoPencil maintainers).
- Implement `provideToolResponse` against nano-pencil's pending tool call queue.
- Map nano-pencil tool emissions to `EngineEvent.tool_request`.
- Honor cancellation through both adapter dispose and explicit `cancelled` response.

**Verification**: end-to-end test — real nano-pencil engine + scripted tool advertisement, request triggers tool call, mock caller responds, model continues.

### M-tools-3: Lifecycle, timeout, error mapping (1 d)

- Implement timeout per §11 (driven by `min(advertised, default, 120000)`).
- Implement error code emission per §13.
- Implement 401/403/404/409/410/413/422 on the response endpoint per §7.
- Add metrics: `tool_calls_total{outcome}`, `tool_call_duration_ms`.

**Verification**: failure tests (timeout, oversized output, mismatched key, unknown id) all map to spec.

### Out of M-tools-1/2/3

Deferred to v0.2.x once first cut lands:

- Parallel tool fan-out within one turn.
- Tool argument JSON Schema enforcement at Gateway boundary.
- Per-tool rate limiting.
- Structured tool tracing (OpenTelemetry spans).
- WS-based callback channel (only if measured latency wins justify it).

## 16. Open Questions

Pre-implementation decisions still owned:

1. **Parallel tool calls.** Should v0.2 first cut allow the engine to emit two `tool_request` events before the first is resolved? Current draft says no (serialized). Decision affects `provideToolResponse` ordering and caller event handling.
2. **Caller heartbeat.** Do we want the caller to send a `tool_progress` heartbeat for long-running tools, preventing premature timeout? Default: no — caller sets a generous `timeout_ms` and Gateway honors it.
3. **Asgard's role.** Does Asgard proxy `tool_response` POSTs the same way it proxies chat completions, or do callers go straight to Gateway? Default: Asgard proxies — keeps the audit trail and key boundary consistent (see also `docs/04-asgard-editor-integration.md` §3.5).
4. **Tool argument size cap.** Do we cap `arguments` JSON like we cap `output` at 256 KiB? Default: yes, same cap.
5. **Session-pool eviction.** When sessions get evicted (LRU or restart), pending tools die. Should we provide a `pencil.session_lost` SSE before close? Default: yes — explicit beats silent.

Decisions should land before M-tools-2 starts.

---

## Appendix A: Editor-Side Caller Sketch

Non-normative; illustrates how `nanopencil-editor` `HttpChatProvider` would consume the protocol:

```ts
// 1. Open the completion stream as today, but advertise client tools
const sse = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: `pencil/${agentId}`,
    messages,
    stream: true,
    session_id: sessionId,
    pencil_client_tools: editorToolRegistry.advertise(),
  }),
  signal: abortController.signal,
});

// 2. Inside the SSE reader loop, handle pencil.tool_request:
async function onSseEvent(event: SseEvent) {
  if (event.type === "pencil.tool_request") {
    const { tool_call_id, name, arguments: args } = event.data;
    const response = await editorToolRegistry.execute(name, args);
    await fetch(
      `${baseUrl}/v1/agents/${agentId}/sessions/${sessionId}/tool_response`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tool_call_id, status: "ok", output: response }),
      }
    );
    // The SSE stream continues; next text_delta or another tool_request arrives.
  }
}
```

Notes for editor implementers:

- The fetch of `tool_response` must NOT block the SSE reader loop on a shared body stream; run them concurrently.
- On `AbortController.abort()`, do not also POST a `cancelled` response — Gateway already cancels pending tools when the SSE stream closes.

## Appendix B: Cross-Project Touchpoints

| Project | Change required |
|---|---|
| `nano-pencil` | Expose a "register remote tool" / pending tool queue API for `NanoPencilEngineAdapter` to bind into; emit tool requests and consume responses through that API. |
| `pencil-agent-gateway` (this repo) | All §6–§13 work; see §15 milestones. |
| `nanopencil-editor` | New SSE event handling for `pencil.tool_request`; tool registry advertisement; minimal P0 tools (read_file/write_file) before opening to full ACP tool surface. |
| `Asgard Platform` | Pass-through `tool_response` POSTs alongside chat completions; ensure proxy preserves the caller's session-bound key. Update `docs/04-asgard-editor-integration.md` §3.5 once decisions in §16 settle. |
