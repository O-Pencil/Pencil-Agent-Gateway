/**
 * [WHO]  Pencil-Agent-Gateway channel server
 * [FROM] Depends on DingTalk OpenAPI (proactive send), DingTalk app credentials
 * [TO]   External callers (scheduled tasks, webhooks, admin tools) that need to push outbound messages to DingTalk without an inbound event
 * [HERE] REQS/REQ-001-proactive-send.md — replaces OpenClaw as the DingTalk proactive send path for scheduled reports
 */

---

## Requirement: DingTalk Proactive Outbound (Pull-based Push)

### ID
`REQ-001-proactive-send`

### Category
Channel Enhancement / Outbound Messaging

### Status
Proposed

---

## 1. Problem Statement

Pencil-Agent-Gateway currently handles DingTalk messages reactively:

```
DingTalk group @bot → Stream relay → Gateway webhook → reply via sessionWebhook
```

There is **no API path** for the Gateway to push a message to DingTalk on its own (scheduled task trigger, admin push, etc.). This forces the system to depend on OpenClaw for outbound daily reports, creating a second机器人 dependency.

The goal is to make **Pencil-Agent-Gateway the sole DingTalk robot** by adding a proactive outbound API.

---

## 2. Proposed Solution

### Option A: HTTP API endpoint (preferred)

Expose a new route in the channel server:

```
POST /channels/dingtalk/:accountId/send
Authorization: Bearer <webhookSecret>
Content-Type: application/json

{
  "chatId": "cidbh3M1Gr8v5tq4f5h0rgmug==",   // target conversation
  "messageType": "markdown",                  // or "text"
  "content": "日报内容...",                   // message body
  "atSender": "senderId"                     // optional: @mention a specific user
}
```

Behavior:
1. Authenticate via `webhookSecret` (same as relay auth)
2. Look up `clientId/clientSecret` for the named account
3. Acquire DingTalk `access_token` via `gettoken` API (cached)
4. POST to DingTalk `/message/sendToConversation` OpenAPI
5. Return `{ ok: true, messageId: "..." }` or error

**Flow after implementing Option A:**
```
scheduled task (9:00 AM)
  → curl POST /channels/dingtalk/default/send
  → Gateway acquires token + calls DingTalk API
  → message delivered to group
  → no OpenClaw dependency
```

### Option B: SDK method via NanoPencilEngineAdapter

Add a `sendMessage(channel, accountId, message)` method to the EngineAdapter or a dedicated `ChannelSender` service, callable from within the Gateway process.

Tradeoff: couples the send logic to the engine lifecycle; Option A is more flexible (REST-first).

---

## 3. API Contract

### Request

```
POST /channels/dingtalk/:accountId/send
Headers:
  Authorization: Bearer <webhookSecret>
  Content-Type: application/json
Body:
  {
    "chatId": string,        // required — DingTalk conversation ID
    "messageType": "markdown" | "text",
    "content": string,        // required — message body
    "atSender": string       // optional — sender ID to @mention
  }
```

### Response

```json
// 200 OK
{ "ok": true, "messageId": "dingtalk-message-id" }

// 400 Bad Request
{ "ok": false, "error": "missing chatId" }

// 401 Unauthorized
{ "ok": false, "error": "invalid webhookSecret" }

// 502 Bad Gateway
{ "ok": false, "error": "DingTalk API error: <detail>" }
```

### DingTalk API call

Use the existing `openapi.ts` helpers (`getDingTalkAccessToken`) and POST to:

```
POST https://api.dingtalk.com/v1.0/message/sendToConversation
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "robotCode": "<clientId>",
  "conversationId": "<chatId>",
  "msgArg": "{\"msgContent\":\"<content>\"}",
  "msgType": "markdown"   // or "text"
}
```

---

## 4. Security Considerations

- **WebhookSecret auth**: same mechanism as the relay — prevents unauthorized external callers
- **Rate limits**: DingTalk enforces per-robot rate limits on proactive sends (~40msg/min per conversation); document and consider adding a queue
- **Token exposure**: access_token is never exposed to callers; Gateway manages lifecycle internally
- **Allowlist**: respect `channels.allowlist.chatIds` — if `allowAll: false` and `chatIds` is set, reject sends to unlisted chats

---

## 5. Use Cases

1. **Scheduled daily report** (primary): cron task fires at 9 AM, triggers this endpoint, report lands in DingTalk group
2. **Admin push**: operator calls `curl` directly to push a message
3. **Alert automation**: if an internal error threshold is crossed, Gateway proactively notifies the on-call
4. **Multi-pencil routing**: different pencils can push to different chats via different accounts

---

## 6. Dependencies

- Existing `openapi.ts` helpers (`getDingTalkAccessToken`)
- Existing `DingTalkAdapter` outbound types (`OutboundMessage`)
- `clientId/clientSecret` already read from env vars in config
- No new npm packages required

---

## 7. Out of Scope

- Inbound message parsing (already handled by relay + webhook)
- Multi-media messages (images, files, cards in first version — text/markdown only)
- Delivery receipts / read status
- Fan-out to multiple chats in one call

---

## 8. Verification Plan

1. `curl -X POST http://127.0.0.1:18090/channels/dingtalk/default/send` with valid secret → message appears in group
2. Same call without secret → 401 returned
3. Send to unlisted `chatId` with `allowAll: false` → 403 rejected
4. Concurrent sends do not stampede `gettoken` (verify single inflight token fetch)
5. Report scheduled task fires at 9 AM → DingTalk receives message without OpenClaw involvement
