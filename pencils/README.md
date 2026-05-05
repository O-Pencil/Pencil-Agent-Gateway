# Local Pencil Instances

> One folder = one PencilAgent slot, with its own Gateway port pair, dataDir, and config.

## DIP Metadata

```text
[WHO]  Gateway operators running multiple isolated PencilAgent instances locally
[FROM] scripts/start-pencil.sh + per-pencil config + ~/.pencils/<name>/ agentDir
[TO]   Independent Gateway processes, each hosting one (or a few) PencilAgents
[HERE] pencils/ — local-only runtime instance dir; contents are git-ignored except .example/ and this README
```

---

## Naming Convention

A **pencil** is an individual: it has one Soul, one memory, optionally one or more inbound channels.
A **channel** (DingTalk / Feishu / WeChat / OpenAI HTTP) is just an entry point.

Therefore:

- Folder name = the pencil's persona slot, **never** a channel name.
  Good: `pencils/pencil-01/`, `pencils/iris/`, `pencils/scribe/`
  Bad:  `pencils/dingtalk-agent/`, `pencils/feishu-bot/`
- The Gateway PencilAgent id is the **same** as the folder name (`pencil/<name>`).
- The nanopencil agentDir lives at `~/.pencils/<name>/` (separate from `~/.nanopencil/` which is the local CLI's home).

A single pencil can be reachable through multiple channels — bind them in `channels.routes` with the same `agentModel: "pencil/<name>"`.

---

## Port Allocation

Each pencil reserves **two** ports: one for the OpenAI-compatible Gateway, one for the channel webhook server. They count up from 18080:

| Pencil slot | Gateway port | Channel port |
|---|---|---|
| pencil-01   | 18080        | 18090        |
| pencil-02   | 18081        | 18091        |
| pencil-03   | 18082        | 18092        |
| ...         | ...          | ...          |

Avoid 8080/8090 (Gateway defaults) so the local-instance set never collides with a default-config Gateway.

---

## Directory Layout

```text
Pencil-Agent-Gateway/
└── pencils/
    ├── README.md              ← this file (committed)
    ├── .example/              ← templates (committed)
    │   └── config.json
    ├── pencil-01/             ← real instance (gitignored) — Gateway-side config slot
    │   └── config.json        ← GATEWAY_CONFIG for this pencil
    └── pencil-02/             ← another instance (gitignored)
        └── ...

~/.pencils/                    ← user home (Step A layout — see docs/16-pencils-storage-layout.md)
├── agents/                    ← engine-side state per pencil (CLI + Gateway共用)
│   ├── pencil-01/             ← AgentConfig.agentDir for pencil-01
│   │   ├── auth.json          ← API keys (set via `nanopencil /login`)
│   │   ├── settings.json
│   │   ├── models.json
│   │   ├── sessions/
│   │   └── memory/
│   └── pencil-02/
│       └── ...
└── gateway/                   ← Gateway元数据 (default dataDir)
    └── agents/<id>.json       ← AgentRegistry persistence

# 兼容：env 别名 NANOPENCIL_HOME / NANOPENCIL_CODING_AGENT_DIR 仍可用。
# 兼容：pre-Step-A 用户的 ~/.pencils/<id>/ 数据自动检测+保留 + warning，等 `pencils migrate` 上线后再迁。
```

---

## Bootstrap a New Pencil

```bash
# 1) Pick a name (persona slot, not a channel name).
PENCIL=pencil-01

# 2) Copy the template.
mkdir -p pencils/$PENCIL/data
cp pencils/.example/config.json pencils/$PENCIL/config.json

# 3) Edit pencils/$PENCIL/config.json:
#    - gateway.port:  18080 + slot index (e.g. 18080 for pencil-01)
#    - channels.server.port: 18090 + slot index
#    - agents[0].id: "$PENCIL"
#    - (optional) agents[0].soul.systemPrompt: this pencil's voice
#    - (later)   channels.accounts.dingtalk.default.webhookSecret: a shared secret with the relay

# 4) Set up its independent nanopencil home and configure model/key.
#    On Windows + Git Bash: see "Windows Caveats" below — `nanopencil /login`
#    will get the slash mangled into a path. Either run `nanopencil //login`,
#    or just run `nanopencil` and type /login inside the TUI.
NANOPENCIL_CODING_AGENT_DIR="$HOME/.pencils/$PENCIL" nanopencil
#  └─ inside the TUI:   /login   →   /model   (so settings.json gets defaultProvider + defaultModel)

# 5) Start the Gateway for this pencil.
./scripts/start-pencil.sh $PENCIL

# 6) Smoke test (in another shell):
curl -s http://127.0.0.1:18080/v1/agents \
  -H "Authorization: Bearer pk_dev_default"

curl -s -X POST http://127.0.0.1:18080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{"model":"pencil/pencil-01","messages":[{"role":"user","content":"你好"}]}'
```

---

## Windows Caveats (Git Bash / MSYS2)

Git Bash auto-converts any argument that starts with `/` into a Windows path
before passing it to non-MSYS programs. So `nanopencil /login` is silently
rewritten to `nanopencil "C:/Program Files/Git/login"` (or your install root),
which nanopencil sees as a prompt fragment, not a slash command — you end up
with a stray path inside the chat.

Pick one of these workarounds:

| Method | Form | Scope |
|---|---|---|
| Double slash | `nanopencil //login` | per-command, no env change |
| Disable conversion for one call | `MSYS_NO_PATHCONV=1 nanopencil /login` | per-command |
| Type the slash command **inside** the TUI | `nanopencil` then `/login` | always safe — the TUI reads stdin directly |
| Disable globally | add `export MSYS_NO_PATHCONV=1` to `~/.bashrc` | breaks any tool that wants real path conversion — use only if you know what you're doing |

The TUI route is recommended — slash commands are an interactive concept anyway
and the TUI never goes through a shell layer.

After `/login`, also run `/model` so `~/.pencils/<name>/settings.json` gets
both `defaultProvider` and `defaultModel`. The Gateway's NanoPencilEngineAdapter
reads those when it builds a session in inherited mode; without `defaultModel`,
chat requests fail with `engine_error: "No model selected"`.

---

## Bind to DingTalk Later (separate doc)

When the pencil is reachable on its OpenAI endpoint, wire the channel:

1. Fill `channels.enabled = true` and the `accounts.dingtalk.default` block in `pencils/$PENCIL/config.json`.
2. Create `pencils/$PENCIL/.env.dingtalk` with `DINGTALK_CLIENT_ID/CLIENT_SECRET/ROBOT_CODE/RELAY_SECRET`
   (and optionally `DINGTALK_AI_CARD_TEMPLATE_ID`, see below). The launcher sources every `.env.*` file in
   the pencil dir before starting Gateway.
3. Run the stream relay: `./scripts/start-relay-dingtalk.sh $PENCIL`. It POSTs to
   `http://127.0.0.1:18090/channels/dingtalk/default/webhook` with the shared `webhookSecret`.
4. The same pencil can be bound to additional channels by adding more entries in `channels.routes`.

This pattern matches the OpenClaw "inbound channel/account/peer → isolated agent" model: the channel layer
routes traffic; the pencil keeps its single Soul and memory regardless of how many channels reach it.

### Streaming AI Card (typewriter effect)

By default, when **all four** of `clientId`, `clientSecret`, `robotCode`, and `cardTemplateId` are set on the
account, DingTalk replies are delivered as **streaming AI cards** — the user sees a "Pencil 正在回复…" placeholder
within ~1s of @-mentioning the bot, then the card fills in with a typewriter animation as tokens arrive.
When any of those is missing, replies fall back to the legacy single-shot sessionWebhook markdown.

Configure in `pencils/$PENCIL/.env.dingtalk`:

```ini
DINGTALK_CLIENT_ID=ding...
DINGTALK_CLIENT_SECRET=...
DINGTALK_ROBOT_CODE=ding...                                   # usually = CLIENT_ID for stream-mode robots
DINGTALK_AI_CARD_TEMPLATE_ID=8aebdfb9-...396c3dde41a0.schema   # demo template; replace for production
```

The default `DINGTALK_AI_CARD_TEMPLATE_ID` is the public demo template documented at
https://developers.dingtalk.com/document/dingstart/typewriter-effect-streaming-ai-card and works out of the
box for local testing. For production, create your own template:

1. Visit https://open-dev.dingtalk.com/fe/card  (DingTalk card platform).
2. **新建模板** → 卡片场景 = AI 卡片 → 关联本机器人所属应用.
3. Confirm the streaming markdown variable in the template is named `content` (or set
   `DINGTALK_AI_CARD_CONTENT_KEY=<your-key>` accordingly — currently this is configured at the
   `accounts.dingtalk.default.cardContentKey` level in `config.json`).
4. Apply for the `Card.Streaming.Write` permission point on the app.
5. Copy the generated template id into `DINGTALK_AI_CARD_TEMPLATE_ID`.

Disable streaming for a specific account without removing the template: set
`accounts.dingtalk.<name>.streamingEnabled = false` in `config.json`. The legacy sessionWebhook path will be
used while leaving the template configured for other accounts on the same Gateway.

### Env var interpolation in `config.json`

`config.json` supports two reference forms in any string field, mirroring POSIX shell:

| Form | Behaviour | Use for |
|---|---|---|
| `${VAR}` | **Hard ref.** Throws at Gateway startup if `VAR` is unset. | Required values (apiKeys, the channel server itself if you depend on it). |
| `${VAR:-fallback}` | **Soft ref.** Returns `fallback` (may be empty) if `VAR` is unset or empty. | Optional channel features (DingTalk creds, AI card template) so a pencil that hasn't enabled DingTalk doesn't block boot. |

The pencil-01 example uses soft refs for every DingTalk field — boot succeeds even without `pencils/pencil-01/.env.dingtalk`; channel features auto-disable when their inputs are empty (see `resolveStreamingContext` for the streaming path; `verifyDingTalkRelayAuth` is a no-op when `webhookSecret` is empty).

### Per-session FIFO queue

Channel messages on the same chat (sessionId derived from `channel/account/chatType/chatId/threadId`) are
serialised through a process-local FIFO queue inside the channel server. Sending two messages to the same
chat back-to-back yields two replies in order, instead of the second one immediately failing with
`Agent is already processing`. The queue is in-memory only — restart drops pending tasks; DingTalk's own
redelivery logic will re-enqueue any unACKed events on next connect.

---

## Multi-Pencil Same Gateway? (advanced)

Today, NanoPencilEngineAdapter calls `getAgentDir()` globally, so **a single Gateway process can only see one
agentDir**. Hence one folder = one Gateway process. To put multiple pencils with isolated memory in one Gateway
process, the adapter needs to accept a per-agent `agentDir` (tracked in `tasks/pencil-ecosystem-backlog.md` as
T1 of the channel rollout). Until then, prefer one Gateway per pencil — it's cheap and operationally clearer.
