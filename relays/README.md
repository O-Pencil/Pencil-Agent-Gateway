# Channel Relays

> External processes that bridge a chat platform's native protocol (WebSocket, callback, push) into the Gateway's HTTP webhook surface.

## DIP Metadata

```text
[WHO]  Operators running channel-platform bridges (DingTalk Stream, Feishu callback, WeChat poll, ...)
[FROM] Native chat platform protocols (Stream Mode WebSocket, OAuth callbacks, etc.)
[TO]   Pencil-Agent-Gateway channel webhook endpoints (e.g. POST /channels/dingtalk/<accountId>/webhook)
[HERE] relays/ — independent subprojects, one per platform; each ships its own package.json and node_modules
```

## Why Separate Subprojects?

The Gateway's channel wrapper deliberately accepts **only HTTP webhooks**. It does not embed platform SDKs, manage Stream Mode WebSockets, or hold platform OAuth tokens. This boundary is documented in [`docs/13-channel-integration.md`](../docs/13-channel-integration.md):

> The channel wrapper intentionally does not embed the DingTalk SDK or manage the Stream Mode WebSocket. That responsibility belongs to the relay/MCP process.

A relay therefore lives **outside** the Gateway process:

```
DingTalk Stream Mode (WebSocket)
  -> relays/dingtalk/                   (this directory)
  -> POST /channels/dingtalk/.../webhook
  -> Pencil-Agent-Gateway channel wrapper
  -> Pencil-Agent-Gateway HTTP API
  -> PencilAgent
```

When a future `pencil-channel-gateway` is split out (see backlog `GW-CH-01`), the relays move with it unchanged — the Gateway's HTTP contract stays the same.

## Layout

```
relays/
├── README.md            (this file)
└── dingtalk/            DingTalk Stream Mode bridge
    ├── package.json     dingtalk-stream + node-fetch only
    ├── tsconfig.json
    ├── src/
    │   └── index.ts
    └── README.md
```

Each relay:

- has its own `package.json` and isolated `node_modules`
- imports **nothing** from `Pencil-Agent-Gateway/src/`
- talks to the Gateway through the same HTTP API any third-party caller would use
- reads its credentials from `pencils/<pencil-name>/.env.<channel>` (sourced by the relay launcher script)

## Run

Each relay has its own README with platform-specific setup. The common pattern is:

```bash
./scripts/start-relay-dingtalk.sh pencil-01
```

That launcher:

1. sources `pencils/pencil-01/.env.dingtalk` so credentials and shared secrets are in env
2. ensures `relays/dingtalk/node_modules` exists
3. launches the relay with `tsx`

## Adding a New Platform

1. `cp -r relays/dingtalk relays/<platform>` and adapt `src/index.ts` to the new SDK.
2. Add a matching `pencils/<pencil>/.env.<platform>` template alongside `.env.dingtalk`.
3. Wire a Gateway adapter in `Pencil-Agent-Gateway/src/channels/<platform>/adapter.ts` if one doesn't exist.
4. Bind the platform inside `pencils/<pencil>/config.json` under `channels.accounts.<platform>` and `channels.routes`.
5. Write a `scripts/start-relay-<platform>.sh` launcher mirroring `start-relay-dingtalk.sh`.
