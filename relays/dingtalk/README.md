# DingTalk Stream Relay

> Forwards a DingTalk robot's Stream Mode messages into a Pencil-Agent-Gateway channel webhook. Independent of the Gateway process.

## DIP Metadata

```text
[WHO]  One Node process per (DingTalk app credential, target Gateway) pair
[FROM] DingTalk Stream Mode WebSocket
[TO]   Pencil-Agent-Gateway POST /channels/dingtalk/<accountId>/webhook
[HERE] relays/dingtalk/ — independent subproject; ships its own package.json
```

## Why It Exists

DingTalk's preferred robot integration is **Stream Mode** — a long-lived WebSocket from the bot back to your service. The Gateway deliberately exposes only HTTP webhooks (so it can be moved into a future `pencil-channel-gateway` without rewriting). This relay closes that gap.

## Prereqs

- A DingTalk H5/internal app with a "robot" published to its target group(s).
- The robot's **AppKey** and **AppSecret** (Stream Mode authenticates with these).
- A Pencil-Agent-Gateway instance running with `channels.enabled = true` and a configured `dingtalk.<accountId>` block.
- Node.js 18+ (uses global `fetch`).

## Configure (per pencil)

Credentials live alongside the pencil they're bound to:

```
Pencil-Agent-Gateway/pencils/<pencil-name>/.env.dingtalk
```

Required keys:

```bash
DINGTALK_CLIENT_ID=<robot AppKey>
DINGTALK_CLIENT_SECRET=<robot AppSecret>
DINGTALK_ROBOT_CODE=<robot code>            # optional today; reserved for outbound APIs
DINGTALK_RELAY_SECRET=<random>              # shared with Gateway
GATEWAY_CHANNEL_URL=http://127.0.0.1:18090
DINGTALK_ACCOUNT_ID=default
```

`DINGTALK_RELAY_SECRET` must match `channels.accounts.dingtalk.<accountId>.webhookSecret` in the same pencil's `config.json` (which references it as `${DINGTALK_RELAY_SECRET}`).

The whole `pencils/*` tree is gitignored, so this file never gets committed.

## Run

```bash
# from Pencil-Agent-Gateway/
./scripts/start-relay-dingtalk.sh pencil-01
```

That launcher sources `pencils/pencil-01/.env.dingtalk`, ensures `relays/dingtalk/node_modules` exists, and execs the relay.

## Lifecycle

```
DingTalk robot
  │  WebSocket (Stream Mode)
  ▼
relays/dingtalk (this process)
  │  POST /channels/dingtalk/<accountId>/webhook
  │  Authorization: Bearer ${DINGTALK_RELAY_SECRET}
  ▼
Pencil-Agent-Gateway channel server (port 18090)
  │  resolves channel route → pencil/<id>
  │  POST /v1/chat/completions (Gateway)
  ▼
PencilAgent (NanoPencilEngineAdapter)
  │
  ▼
Reply text → Gateway → DingTalk adapter → sessionWebhook reply (markdown)
```

The relay always ACKs `SUCCESS` to DingTalk after attempting the forward. Operator-visible errors (bad webhookSecret, route mismatch, engine failure) appear in this process's stdout, not in DingTalk. If you want DingTalk to auto-retry on Gateway 5xx, swap `EventAck.SUCCESS → EventAck.LATER` in `src/index.ts` on the `status >= 500` path.

## Move-Out Path

When `pencil-channel-gateway` becomes its own repo, this directory moves over wholesale. Nothing here imports from `Pencil-Agent-Gateway/src/`; only the HTTP contract remains.
