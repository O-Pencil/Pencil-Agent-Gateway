---
title: Pencils Storage Layout — Single Root, Cloud + Local Hybrid
status: design
scope: pencils-data-layout-and-cloud-local-split
owner: pencil-agent-gateway maintainers
created: 2026-05-04
updated: 2026-05-04
---

# Pencils Storage Layout — Single Root, Cloud + Local Hybrid

## DIP Metadata

```text
[WHO]  Pencil-ecosystem operators (CLI users, Gateway operators, editor users) and contributors
       working across nanoPencil CLI, Pencil-Agent-Gateway, and nanopencil-editor
[FROM] Issue 0012 (Gateway data directory alignment), legacy split between
       ~/.nanopencil/agent/ (CLI) and ~/.pencils/<id>/ (Gateway), three concrete
       user scenarios surfaced in roadmap discussions
[TO]   A single canonical `~/.pencils/` root used by CLI, Gateway, and editor;
       env-overridable; cloud + local hybrid for cloud-distributed personas
       (韩寒 / 莫言 / …) with strict private-data isolation
[HERE] docs/16-pencils-storage-layout.md — design document, not yet implemented.
       Captures decisions made on 2026-05-04 and serves as the reference for
       upcoming changes in nano-pencil, Pencil-Agent-Gateway, and editor repos.
```

---

## 1. Decisions (2026-05-04)

| ID | Question | Decision |
|---|---|---|
| Q1 | 单根用 `~/.nanopencil/` 还是 `~/.pencils/`？| **`~/.pencils/`**（Pencils 品牌；env 可覆盖根） |
| Q2 | 改 nanoPencil CLI 让其落到统一根？ | **改**，但需先评估 nanoPencil 源码影响面（详见 §7）|
| Q3 | Asgard 云端"韩寒"类 agent 存什么？ | **选项 Z**：Soul + initial memory + tuned settings（即开即用包）|
| Q4 | 自动迁移老路径？ | **保守**：只打印警告 + 提供一键迁移脚本，不自动 rename |

### 决策的理由

**Q1 选 `.pencils/`**：Pencils 是产品品牌的复数（"一支铅笔=一个 persona"），与 multi-instance 现实匹配。`.nanopencil` 是历史 CLI 实现细节，留下名字不利于把生态推到 editor + Gateway + cloud 三方协作的整体性叙事。CLI 用户基数尚可承受迁移；env 留逃生口。

**Q2 改 CLI 但谨慎**：CLI 的 `getAgentDir()` 在 nanoPencil 整个 codebase 里是 hot path（被 settings/models/auth/sessions/skills/themes/extensions 各处引用）。改默认值是 1 行，但要带上幂等迁移逻辑，且需评估 plugin/extension 兼容。先调研再动。

**Q3 选项 Z**：让"领养韩寒"的体验=即开即用。云端不只发 systemPrompt，还发 initial memory seed（30 条代表性段落 / 写作样本）+ 推荐 model/温度/maxTurns。用户首次对话就有"韩寒味"，而不是空 Soul 慢慢调。代价是云端要存更结构化的"Pencil 包"（详见 §5）。

**Q4 保守迁移**：自动 rename 文件系统目录在多用户/多盘符/Windows 路径上风险高。给一条命令 `pencils migrate` 让用户主动执行，配合启动时的"检测到旧布局，建议运行 X"warning，零意外。

---

## 2. Final Directory Layout

```text
~/.pencils/                                 ← Pencils 生态唯一根（NANOPENCIL_HOME 可覆盖；
                                              env 名沿用历史以兼容 nanoPencil CLI）
│
├── agents/                                 ← 所有个体 pencil 槽（CLI + Gateway 共用）
│   │
│   ├── default/                            ← 单 CLI 兼容槽（自动从 ~/.nanopencil/agent/
│   │   │                                     由 `pencils migrate` 一次性搬过来）
│   │   ├── auth.json                       ← provider keys（绝不上传云端）
│   │   ├── models.json                     ← provider 目录 + Coding Plan 映射
│   │   ├── settings.json                   ← defaultProvider / defaultModel / theme
│   │   ├── .PENCIL.md                      ← agent 自描述（CLI 已有）
│   │   ├── soul/                           ← 灵魂/人设（profile.json + evolutions/）
│   │   ├── memory/                         ← 长期记忆（语义记忆库）
│   │   └── sessions/                       ← 历史会话（隐私，本地自治）
│   │
│   ├── pencil-01/                          ← 多 pencil 本地手工槽
│   │   └── …（同 default 结构）
│   │
│   ├── 韩寒/                                ← 云端"领养"模式（cloud → local seed）
│   │   ├── auth.json                       ← 用户自己的 key（仍本地）
│   │   ├── models.json
│   │   ├── settings.json                   ← 来自云端模板（用户可改）
│   │   ├── soul/
│   │   │   ├── template.json               ← 来自云端，read-mostly（version 标识）
│   │   │   ├── profile.json                ← 用户演化版（local source of truth）
│   │   │   └── evolutions/                 ← 演化历史
│   │   ├── memory/
│   │   │   ├── seed/                       ← 云端下发的 initial memory（read-only mirror）
│   │   │   └── user/                       ← 用户使用过程中累积（local source of truth）
│   │   └── sessions/
│   │
│   └── 莫言/                                ← 同上
│
└── gateway/                                ← Gateway 进程级元数据（不属于任何单 agent）
    ├── registry/                           ← AgentRegistry 持久化
    │   └── agents/
    │       └── <id>.json                   ← 每个 PencilAgent 的注册配置（POST /v1/agents 持久化体）
    ├── channels/                           ← Channel 状态
    │   ├── dingtalk/
    │   │   └── token-cache.json            ← access_token 持久化（避免重启重拉）
    │   └── dedup/                          ← 跨重启 dedup（可选；当前是内存）
    └── sessions/                           ← Gateway 短期 session 快照（已有，从 dataDir 挪进来）
```

### 几条不破不立的规则

1. **`agents/<id>/` 是 nanoPencil CLI 的"agentDir"语义**——CLI 里每一处用 `getAgentDir()` 的地方都对应这一层。Gateway 通过 `AgentConfig.agentDir` 显式指向这个目录，CLI 通过 `NANOPENCIL_CODING_AGENT_DIR` 或新的 `PENCILS_AGENT_DIR` 指向。两者共用同一个文件结构，互不踩。
2. **`gateway/` 永远不出现 agent 业务数据**——只有元数据（registry persistence、channel 状态、token cache）。这条让"卸载 Gateway"等价于"删 gateway/"，不会误删 agent。
3. **`soul/` + `memory/` 各自分模板层和用户层**——template 是 cloud→local 的只读镜像，profile/user 是 local source of truth。reset 操作 = 清空 user + 重新 pull template。

---

## 3. Environment Variable Hierarchy

```text
PENCILS_HOME                ← 生态根（默认 ~/.pencils）。改这一个所有派生值跟着挪
                              env 别名：NANOPENCIL_HOME（兼容 nanoPencil 老用户）

PENCILS_AGENTS_DIR          ← agents/ 子树（默认 $PENCILS_HOME/agents）
                              很少需要单独覆盖，给容器场景挂载 PV 用

PENCILS_GATEWAY_DIR         ← gateway/ 子树（默认 $PENCILS_HOME/gateway）
                              当 Gateway 元数据要单独挂高 IO 卷时用

PENCILS_AGENT_DIR           ← 单 agent override（默认随 AgentConfig.agentDir）
                              env 别名：NANOPENCIL_CODING_AGENT_DIR（兼容 CLI）
                              CLI 进程读这个；Gateway 读 AgentConfig.agentDir，env 是 fallback
```

派生关系：

```text
PENCILS_HOME = ~/.pencils
  ├── PENCILS_AGENTS_DIR  = $PENCILS_HOME/agents
  └── PENCILS_GATEWAY_DIR = $PENCILS_HOME/gateway
PENCILS_AGENT_DIR (per-process override) = $PENCILS_AGENTS_DIR/<id>
```

只设 `PENCILS_HOME` 是最常用姿势；其余三个仅在罕见拓扑下使用。

---

## 4. 三个用户场景的数据流

### S1 — 单用户 CLI（无 Gateway、无云端）

```text
~/.pencils/agents/default/      ← 由 `pencils migrate` 一次性从 ~/.nanopencil/agent/ 搬来
  └── 全部数据本地
```

CLI 启动时检查 `PENCILS_AGENT_DIR` → `NANOPENCIL_CODING_AGENT_DIR`（兼容）→ `$PENCILS_AGENTS_DIR/default/`（默认）。
新用户直接落 `default/`；老用户走迁移脚本。

### S2 — 云端 Gateway + 本地长期记忆（混合模式）

```
┌──────────────────────────────────────┐         ┌─────────────────────────────────┐
│  Cloud (Asgard)                      │         │  Local (~/.pencils/agents/韩寒/) │
│  ──────────────────                  │         │  ──────────────────              │
│  Agent template 库                    │  ─────► │  soul/template.json   (镜像)     │
│   • soul: systemPrompt/styleTags      │  pull   │  memory/seed/         (镜像)     │
│   • initial memory seed               │         │  settings.json        (默认值)    │
│   • settings (model/temp/maxTurns)    │         │                                  │
│   • version (semver)                  │         │  soul/profile.json    (用户改)    │
│                                      │         │  soul/evolutions/     (本地)     │
│  *Asgard 数据库后续可选作为 source*    │         │  memory/user/         (本地)     │
│                                      │         │  sessions/            (本地)     │
│                                      │         │  auth.json            (本地)     │
└──────────────────────────────────────┘         └─────────────────────────────────┘
            ▲                                                ▲
            │ 「领养」时一次性 pull                              │ 用户对话时本地积累
            │ 「重置模板」时再次 pull（覆盖 template.json）       │ provider key 永远本地
            │                                                │
            └────────────── 同步规则参见 §5 ─────────────────┘
```

**关键属性**：

- 云端只是模板分发 + 元数据 store；**所有用户私域数据（auth、session、user-memory）永不上传**。
- 用户更换/丢失本地数据，"重新领养"可恢复 template + seed，但用户演化的 profile/memory 丢失。
- 云端 template 升级（韩寒 v1 → v2）时 editor/Gateway UI 提示 "is it ok to overwrite template.json?"，profile 不动。

### S3 — Editor 同时连本地 + 云端混合 agents

```yaml
# nanopencil-editor connections.yaml（本地）
connections:
  - id: 我的本地默认                               # 直连 CLI 子进程
    transport: local-cli
    agentDir: ~/.pencils/agents/default

  - id: 我的本地 pencil-01                         # 走本地 Gateway
    transport: gateway-http
    baseUrl: http://127.0.0.1:18080
    apiKey: pk_dev_default
    agentModel: pencil/pencil-01

  - id: 韩寒-试用                                   # 云端 Gateway，纯远程
    transport: gateway-http
    baseUrl: https://asgard-api.onrender.com
    apiKey: sk-asgard-xxx
    agentModel: pencil/韩寒
    cloudOnly: true                              # 不写本地 agentDir

  - id: 韩寒-领养版                                  # 云端模板 + 本地状态
    transport: gateway-http
    baseUrl: http://127.0.0.1:18080              # 本地 Gateway 接管
    apiKey: pk_dev_default
    agentModel: pencil/韩寒
    sourceTemplate:                              # 元信息：从哪来、什么版本
      origin: https://asgard-api.onrender.com
      templateId: hanhan
      version: 1.2.0
```

四种连接对调用方接口完全一致（OpenAI-compat），差别只在 `transport` + `baseUrl`。`local-cli` 由 editor spawn nanopencil 子进程并设好 `PENCILS_AGENT_DIR`，其余走 HTTP。

---

## 5. 云端 Pencil 包格式（方案 Z 的具体 schema）

Asgard 给"韩寒/莫言"这种 agent 存的不是单纯 systemPrompt，而是一个完整即开即用包：

```jsonc
{
  "templateId": "hanhan",                     // 唯一 id
  "version": "1.2.0",                         // semver；用户重置模板靠这个判断
  "displayName": "韩寒",
  "description": "70 后小说家的写作助手……",
  "soul": {
    "systemPrompt": "你是韩寒……",
    "styleTags": ["sarcastic", "minimalist", "zh-cn-novel"]
  },
  "memorySeed": [                             // initial memory（option Z 核心）
    {
      "kind": "writing-sample",
      "title": "三重门 第一章片段",
      "content": "……",
      "tags": ["voice", "rhythm"]
    },
    {
      "kind": "stylistic-rule",
      "content": "倾向短句，避免华丽形容词堆叠",
      "tags": ["voice"]
    }
    // … 30 条左右
  ],
  "settings": {
    "defaultProvider": "dashscope-coding",
    "defaultModel": "qwen3-coder-plus",
    "temperature": 0.85,
    "memoryMaxTurns": 32
  },
  "compatibility": {
    "minNanoPencilVersion": "1.13.0",
    "minGatewayVersion": "0.2.0"
  }
}
```

**领养时的本地落盘**（在 `~/.pencils/agents/韩寒/`）：

| 包字段 | 落到本地哪里 | 后续行为 |
|---|---|---|
| `soul.*` | `soul/template.json` | template 字段 read-mostly；用户改写复制到 `soul/profile.json` |
| `memorySeed[]` | `memory/seed/*.json`（每条一文件，按 kind 分目录）| read-only 镜像；积累的新记忆进 `memory/user/` |
| `settings.*` | `settings.json` | 默认值；用户可改 |
| `templateId / version` | `soul/template.json` 头部 + `.PENCIL.md` 元数据 | 升级判断 / 兼容矩阵 |
| `compatibility.*` | 不落盘，仅做 admission check | 本地版本不达标时领养拒绝 |

**Memory 合并规则**：会话里 `memory/seed/` 与 `memory/user/` 一起进 retrieval（seed 优先用于 voice 一致性，user 优先用于话题连续性）。

**云端不存什么**：

- ❌ `auth.json`（用户的 provider key）
- ❌ `sessions/`（对话历史，隐私）
- ❌ `memory/user/`（用户演化记忆）

这三类数据云端**永远不接收**。即便用户主动想"备份 sessions 到云端"，也另立 issue 单独评估隐私 + 加密方案，不在 Pencil 包内。

---

## 6. 数据归属一览表

| 数据类型 | 云端（Asgard / Gateway 云端）| 本地（~/.pencils/agents/<id>/）| 同步方向 | 在 §2 布局中 |
|---|---|---|---|---|
| Soul 模板（systemPrompt、styleTags）| **source of truth**（template）| mirror（template.json）| cloud → local（pull on adopt）| `soul/template.json` |
| Soul 演化（用户 patch）| 不存 | **source of truth** | 不同步 | `soul/profile.json` + `evolutions/` |
| 初始 memory seed | **source of truth** | mirror | cloud → local（pull on adopt）| `memory/seed/` |
| 用户长期记忆 | 不存 | **source of truth** | 不同步 | `memory/user/` |
| 对话 sessions | 不存 | **source of truth** | 不同步 | `sessions/` |
| auth.json（provider keys）| **绝不上传** | **source of truth** | 不同步 | `auth.json` |
| settings.json（model/temp）| 模板默认值 | **source of truth** | cloud → local（pull on adopt only）| `settings.json` |
| models.json（provider 目录）| 模板可选 | **source of truth** | 同上 | `models.json` |
| Gateway registry（POST /v1/agents 注册体）| 不涉及 | **source of truth** | 不同步 | `gateway/registry/agents/<id>.json` |
| DingTalk token cache | 不涉及 | **source of truth** | 不同步 | `gateway/channels/dingtalk/token-cache.json` |

记忆口诀：**模板可云端，私域必本地，认证不出门**。

---

## 7. 落地实施路线（先调研，后动手）

### 第 0 步：评估 nanoPencil 源码影响面（**Q2 前置**）

需要 grep 的范围：

- `getAgentDir()` 调用点：`config.ts`、`main.ts`、`core/runtime/sdk.ts`、`core/model-registry.ts` 已知；其余靠静态搜索补全。
- `CONFIG_DIR_NAME` 的引用：当前来自 `package.json` 的 `nanopencilConfig.configDir`，硬编码 `.nanopencil`。
- `ENV_AGENT_DIR` = `NANOPENCIL_CODING_AGENT_DIR` 的所有读取者。
- 第三方扩展（plugins/extensions）是否依赖固定路径——这是兼容风险来源。

**输出**：一份"CLI 改造评估"，列影响文件、所需测试改动、向后兼容策略。这个完成前 §2 的 `agents/default/` 落盘只在 Gateway 单方面落（兼容 CLI 的 `~/.nanopencil/agent/`）。

### 第 1 步：Gateway 切根（小步快走）

- 把 `loadConfig` 默认值从 `~/.pencils/<id>/` 改成 `~/.pencils/agents/<id>/`，dataDir 从 `~/.pencils/gateway/` 不动（已对）。
- 加 `PENCILS_HOME` / `PENCILS_AGENTS_DIR` / `PENCILS_GATEWAY_DIR` env 解析；`NANOPENCIL_HOME` / `NANOPENCIL_CODING_AGENT_DIR` 作为别名兜底。
- 启动时检测 `~/.pencils/<id>/`（旧布局，没有 `agents/` 中间层）存在 → 打印 warning + 给迁移命令。
- 文档（pencils/README.md、issue 0012）跟进新路径。

### 第 2 步：CLI 改造（依赖 §7 第 0 步评估）

- `getAgentDir()` 默认改为 `$PENCILS_HOME/agents/default/`。
- 迁移逻辑：检测 `~/.nanopencil/agent/` 存在 + 新位置不存在 → warning + 提示 `pencils migrate`，**不自动 rename**（Q4 保守）。
- 新增 CLI 命令 `nanopencil migrate` 或 `pencils migrate`：原子 rename + 写迁移日志，失败可回滚。
- 兼容窗口：保留 `~/.nanopencil/agent/` 的读取支持 N 个 minor 版本（带 deprecation log），之后移除。

### 第 3 步：云端 Pencil 包格式（依赖 §5 schema 定稿）

- Asgard 端：定义 `pencil_template` 表、给 admin UI 加 "creating template" 流；初始版本仅含 systemPrompt + styleTags + memorySeed（手工录入）。
- Gateway 端：新增 `POST /v1/agents/adopt` 接收 Pencil 包 → 自动落到 `~/.pencils/agents/<templateId>/`，注册 agent。`/v1/agents` POST 仍保留作为低层接口。
- nanopencil-editor：`connections.yaml` 增加 `sourceTemplate` 元数据；提供"试用 → 领养"的 UI 升级路径。

### 第 4 步：迁移脚本

`scripts/pencils-migrate.sh`（Linux/macOS）+ `scripts/pencils-migrate.ps1`（Windows）：

```text
检测项                          建议动作
─────────────────────────────────────────────────────
~/.nanopencil/agent/ 存在        → mv 到 ~/.pencils/agents/default/
~/.pencils/<id>/ 存在            → mv 到 ~/.pencils/agents/<id>/
~/.pencils/gateway/ 不存在        → mkdir
冲突（两侧都有）                  → 报错退出，不擅自合并
```

幂等、dry-run 默认开启，要求 `--apply` 才真动文件。日志写 `~/.pencils/migrate.log`。

---

## 8. 暂不在本设计内的话题（Out of Scope）

- **跨设备同步**：sessions、user memory 的多设备同步（涉及加密、冲突解决，单独 issue）。
- **Soul template marketplace**：用户互相分享/出售 Pencil 包的市场层（Asgard 产品线决策，先做技术地基）。
- **多用户 Gateway 单进程**：当前 multi-pencil 仍是 multi-instance 单租户，不做单进程多租户。
- **Memory 检索算法**：seed vs user 两层 memory 的 ranking，待 nano-pencil mem-core 决定。
- **加密 at rest**：`auth.json` 现在是明文存盘；未来若需要 OS keychain 整合，单独评估。

---

## 9. 与 nanoPencil 多 Agent 设计的合并（2026-05-04 增补）

nanoPencil 仓库 `docs/multi-agent-fs-design.md` 同期独立提出了多 Agent 文件系统设计，核心哲学**"心智（Mind）与具身（Embodiment）解耦"**——Agent 是心智、Workspace 是具身。这与本文 §2 的布局几乎收敛，但补上了 Workspace 这一**横向维度**，是本文 §2 之前缺的。

### 9.1 名字之争：`~/.nanopencil/` vs `~/.pencils/`

| 立场 | nanoPencil 文档 | 本文 §1（Q1 决策）| 协调 |
|---|---|---|---|
| 根目录 | `~/.nanopencil/` | `~/.pencils/` | **采用 `~/.pencils/`**（Pencils 品牌，env 可改，见 §3）。`PENCILS_HOME` 是 single source of truth；`NANOPENCIL_HOME` 作为 alias 兼容老用户。 |
| 内部子目录命名 | `agents/` `workspaces/` `gateway/` `channels/` `evals/` | 同上（除 `workspaces/` 之前缺）| **完全采用** nanoPencil 的子目录命名 |

### 9.2 Workspace 维度的引入（用户问题的答案）

**问题**：工作空间（每个项目一份的记忆/事实）在 Agent 外还是 Agent 内？

**答案**：**在 Agent 外，与 `agents/` 同级**。这是 nanoPencil 设计文档的核心选择，本文采纳。

理由：

- 一个 Workspace 可被**多个 Agent 进入**（Team 场景：韩寒 + 莫言一起写一本小说，需要共享文件树/git/项目规则，但各保留独立人格）。
- 一个 Agent 可进入**多个 Workspace**（"我的 default pencil"今天写 repo-A 明天写 repo-B；Agent 的 soul/长期记忆持续，工作空间事实跟项目走）。
- 把 Workspace 塞进 Agent 会导致两个反模式：换项目丢上下文；Team 协作要把工作空间状态在 N 个 Agent 目录之间同步，永远不一致。

### 9.3 完整目录布局（合并版，覆盖 §2）

```text
~/.pencils/                                   ← 生态根（PENCILS_HOME 覆盖）
│
├── agents/                                   ← 【个体心智】每 Agent 一槽
│   ├── default/                              ← CLI 单用户兼容槽
│   ├── pencil-01/                            ← 本地手工槽
│   ├── 韩寒/                                  ← 云端领养槽（cloud → local seed）
│   └── <id>/
│       ├── soul/                             ← template + profile + evolutions
│       ├── memory/                           ← seed（云端镜像）+ user（本地累积）
│       ├── sessions/                         ← 会话历史，**按 workspace 索引隔离**（见 §9.5）
│       ├── auth.json                         ← provider keys（绝不上传）
│       ├── settings.json                     ← model/temp/maxTurns
│       ├── models.json                       ← provider 目录 + Coding Plan 映射
│       └── .PENCIL.md                        ← agent 自描述
│
├── workspaces/                               ← 【具身共享】项目级事实区
│   └── <project_id>/                         ← project_id = git remote hash 或用户指定
│       ├── .pencil_context                   ← 项目快照（file tree、git state、LSP 信号）
│       ├── shared_mem.db                     ← O-Mesh 黑板：项目共识（"本项目禁用 Promise.then"）
│       ├── teams/                            ← Team 编排状态（mailbox、transcript）
│       └── policies.json                     ← 该 workspace 的写入白名单等策略
│
├── gateway/                                  ← 【调度元数据】Gateway 进程级状态
│   ├── registry/agents/<id>.json             ← AgentRegistry 持久化
│   ├── channels/dingtalk/token-cache.json
│   └── sessions/                             ← Gateway 短期 SSE session
│
├── channels/                                 ← 【感官接口】外部集成插件持久化
│   └── (e.g. 飞书订阅 token、企微回调签名等长期凭据)
│
└── evals/                                    ← 【自省】Pencil-Evaluate 性能 Trace（与 agents 解耦）
```

### 9.4 数据归属（合并 Workspace 维度后的全表）

| 数据类型 | 云端 | 本地哪里 | 归属轴 | 同步方向 |
|---|---|---|---|---|
| Soul template | ✓ source | `agents/<id>/soul/template.json` | Agent | cloud → local（adopt）|
| Soul profile（用户演化）| ✗ | `agents/<id>/soul/profile.json` + `evolutions/` | Agent | 不同步 |
| Memory seed | ✓ source | `agents/<id>/memory/seed/` | Agent | cloud → local（adopt）|
| Memory user（个人偏好）| ✗ | `agents/<id>/memory/user/` | Agent | 不同步 |
| 项目事实 / 黑板 | ✗（隐私）| `workspaces/<proj>/shared_mem.db` | **Workspace** | 不同步 |
| 项目快照 | ✗ | `workspaces/<proj>/.pencil_context` | **Workspace** | 不同步 |
| Sessions（会话历史）| ✗ | `agents/<id>/sessions/` 主存 + `workspaces/<proj>/sessions-index/` 副索引 | **Agent × Workspace** | 不同步 |
| auth.json | ✗（绝不上传）| `agents/<id>/auth.json` | Agent | 不同步 |
| settings/models | template | `agents/<id>/{settings,models}.json` | Agent | template 一次性 |
| Gateway registry | ✗ | `gateway/registry/agents/<id>.json` | Gateway 元数据 | 不同步 |
| Channel state | ✗ | `gateway/channels/...` 或 `channels/...` | Gateway / 通道 | 不同步 |
| Eval traces | 视部署而定 | `evals/` | 全局 | 单独评估 |

口诀升级：**心智归 Agent，事实归 Workspace，元数据归 Gateway，私域必本地，认证不出门**。

### 9.5 Sessions 的"双轴索引"

会话历史既是 Agent 的（"我说过什么"），也是 Workspace 的（"这个项目里发生过什么"）。隐私决定**主存放 Agent 内**（不能让别的 Agent 偷看你和 default 的对话），但 Team 场景需要 Workspace 视角。

- 主存：`agents/<id>/sessions/<sessionId>.jsonl`（完整内容）。
- 副索引：`workspaces/<proj>/sessions-index/<sessionId>.json`（只存 metadata：agentId、startTime、ended、turns；**不复制内容**）。
- Team 调度器要看 workspace 全景时聚合副索引；查具体内容仍要回到对应 Agent 目录读，受 Agent 的访问策略限制（同 leader 才能跨 Agent 读）。

### 9.6 Agent Teams 的对齐（继续讨论）

nanoPencil 现有的 `extensions/defaults/team/` 与 Pencil-Agent-Gateway 在概念上**等价**：

| 维度 | nanoPencil Teams | Pencil-Agent-Gateway |
|---|---|---|
| 目的 | 单 CLI 进程内多 Agent 协作 | 多 Agent 实例供 HTTP 客户端调用 |
| Agent 状态归属 | 应当落到 `agents/<id>/`（迁移目标）| 已经使用 `agents/<id>/`（本文 §7 已规划）|
| 调度器 | TUI 内的 dispatcher（当前 leader/teammate 主从）| Gateway 进程（HTTP 路由）|
| 通信 | 应当迁到 workspace 黑板（multi-agent-fs-design §4）| 当前是 HTTP；Team 场景下也可走黑板 |
| Workspace | 当前藏在 `core/workspace/worktree-manager.ts`（per-teammate 临时目录）| 当前不感知 workspace |

**对齐后的最终模型**：

```
                  ┌──────────────────────────────────────────────┐
                  │   shared:  ~/.pencils/agents/<id>/            │  ← 心智独立、长效
                  │   shared:  ~/.pencils/workspaces/<proj>/      │  ← 具身共享、协作面
                  └──────────────────────────────────────────────┘
                           ▲                          ▲
                           │                          │
        ┌──────────────────┴────┐    ┌────────────────┴───────────────┐
        │  nanoPencil CLI Teams │    │  Pencil-Agent-Gateway          │
        │  (in-process)         │    │  (cross-process HTTP)          │
        │                       │    │                                │
        │  Dispatcher (leader)  │    │  HTTP router                   │
        │  ├── Agent A (心智)    │    │  ├── Agent A (心智)             │
        │  ├── Agent B (心智)    │    │  ├── Agent B (心智)             │
        │  └── 共用 Workspace    │    │  └── 共用 Workspace（如启用）   │
        └───────────────────────┘    └────────────────────────────────┘

        两者读写的是同一份 ~/.pencils/，差别只在调度边界
```

**Teams 的 workspace 归属问题**：
- Team 启动时绑定一个 `<project_id>` → `workspaces/<project_id>/`，所有 teammate 共享。
- 不同 Team session 可指向同一 workspace（项目层并行协作），也可各开独立 workspace（沙箱 / 临时分支 / worktree）。
- 当前 `WorktreeManager` 创建的 git worktree 应当注册到 `workspaces/<project_id>/.pencil_context.worktrees[]`，让外部观察者（Gateway 也算）能看到所有活动 worktree 的状态。

下一步讨论：
- Teams 是否完全切到 Gateway 进程模型（即"Teams 就是本地启动的 Gateway"），还是保持 in-process 模式作为"轻量协作"？
- workspace 黑板（`shared_mem.db`）的 schema：使用 SQLite 还是 mem-core 的现有抽象？写权限模型（哪个 Agent 能写哪个 namespace）？
- workspace 创建时机：CLI 进入项目目录时自动建？Gateway 第一次收到带 `workspace` header 的请求时建？

---

## 10. 改动清单 — Gateway vs nanoPencil

| 项目 | 责任仓库 | 改动 | 阻塞依赖 |
|---|---|---|---|
| **`PENCILS_HOME` env + `~/.pencils/agents/<id>/` 根** | **Gateway** | ✅ **Step A 已落地（2026-05-04）**：`agentDir` 默认 `$PENCILS_AGENTS_DIR/<id>`（即 `~/.pencils/agents/<id>/`）；`dataDir` 默认 `$PENCILS_GATEWAY_DIR`（`~/.pencils/gateway/`，registry 子目录化推迟到 Step C 与迁移工具一起做）；`PENCILS_HOME` / `PENCILS_AGENTS_DIR` / `PENCILS_GATEWAY_DIR` 解析就绪；`NANOPENCIL_HOME` / `NANOPENCIL_CODING_AGENT_DIR` 兼容别名；pre-Step-A 用户的 `~/.pencils/<id>/` 旧布局**自动检测+保留+警告**，避免 upgrade 后丢数据 | 无 |
| **AgentConfig.agentDir 已落** | **Gateway** | 已合并（issue 0012 落地）。第二轮把默认值从 `~/.pencils/<id>` 改成 `~/.pencils/agents/<id>` | 上一行 |
| **Workspace 字段** | **Gateway** | `AgentConfig` / `ChannelRoute` 增加 `workspaceId?: string`；`buildSessionOptions` 把 `workspaces/<id>/` 信息传给引擎；`/v1/agents/adopt` 接收云端包时支持指定 workspace | nanoPencil 接受 workspaceId 参数后才闭环 |
| **错误信息里的 agentDir 提示** | **Gateway** | `nano-adapter.ts` 错误信息里 hint `nanopencil /login` 时把路径改成 `~/.pencils/agents/<id>/`；`channels/app.ts:108` 同 | 上面两行落地后顺手 |
| **领养接口 `/v1/agents/adopt`** | **Gateway** | 新接口接收 §5 的 Pencil 包 schema，落到 `~/.pencils/agents/<templateId>/{soul,memory,settings}` 后注册；幂等 | §5 schema 定稿 + Asgard 出包能力 |
| **Pencils 包 schema** | **Asgard**（云端定义）| `pencil_template` 表 + admin UI；先 systemPrompt + styleTags + memorySeed[] 手工录入版 | 业务侧排期 |
| **`getAgentDir()` 默认改 `~/.pencils/agents/default/`** | **nanoPencil** | `config.ts:207` 默认值改写；`CONFIG_DIR_NAME` 从 `.nanopencil` 改 `.pencils`（或加抽象层兼容）；增加 `PENCILS_HOME` 读取；保留 `NANOPENCIL_*` env 别名 | 第 0 步源码评估完成 |
| **WorkSpace 一等公民化** | **nanoPencil** | `core/workspace/worktree-manager.ts` 之上加 `WorkspaceManager`，落盘到 `~/.pencils/workspaces/<id>/`；CLI 启动时根据 cwd / git remote 推 `<project_id>`；session 写入时同步副索引 | multi-agent-fs-design §4 设计落地 |
| **Sessions 双轴索引** | **nanoPencil** | sessions 主存 + workspace 副索引落盘；`/sessions list` 支持按 workspace 过滤 | 上一行 |
| **`pencils migrate` 命令** | **nanoPencil** | 子命令：`~/.nanopencil/agent/` → `~/.pencils/agents/default/`；`~/.pencils/<id>/`（Gateway 旧布局）→ `~/.pencils/agents/<id>/`；幂等、dry-run 默认开 | 路径决策定型 |
| **Teams 切到统一 agents 目录** | **nanoPencil** | `extensions/defaults/team/` 的 teammate 状态从临时目录迁到 `agents/<id>/`；team mailbox/transcript 落到 `workspaces/<id>/teams/` | WorkSpace 管理器先到位 |
| **多 Agent 启动**：`nanopencil --agent <id>` | **nanoPencil** | CLI 支持以哪个 agent slot 启动；不指定就用 `default` | `getAgentDir()` 抽象完成 |
| **CLI 改完后 Gateway 移除 `start-pencil.sh` 旧逻辑** | **Gateway** | 删 `NANOPENCIL_CODING_AGENT_DIR` 兜底逻辑，全部走 AgentConfig | nanoPencil 改完 |
| **editor connections.yaml 形态** | **nanopencil-editor**（不在本仓库）| §4.S3 中的连接清单 schema 与"试用 vs 领养"UI | 独立排期 |

### 10.1 顺序建议

```
Step A  (Gateway 单方)   → 切根到 ~/.pencils/agents/<id>/，env 兼容别名上线
Step B  (nanoPencil 评估) → 第 0 步源码影响面调研（产出评估报告）
Step C  (nanoPencil 改造) → getAgentDir() 抽象 + 迁移命令；CLI default 落 ~/.pencils/agents/default/
Step D  (Asgard + Gateway) → §5 Pencil 包 schema 定型 + /v1/agents/adopt 接口
Step E  (nanoPencil)     → WorkspaceManager + Sessions 双轴索引落盘
Step F  (nanoPencil)     → Teams 切到统一 agents/ 目录、workspace 黑板
Step G  (清理)           → Gateway 移除环境变量兜底；编辑器统一连接 schema
```

A、B、D 可并行；C 阻塞 E/F/G；E 阻塞 F。

---

## 11. 长期维护视角下的目录补完

> 一旦布局对用户可见，新增容易、删除难。本节列"现在不一定都建，但**位**要预留好"的扩展点，并把命名规则写死，让未来五年的演化都能塞进同一棵树。

### 11.1 Dot-prefix 保留位（runtime 状态，用户永远不直接编辑）

```text
~/.pencils/
├── .pencils-version             ← {schemaVersion: "1.0.0", createdAt, lastMigratedAt}
├── .migrations/
│   └── applied.jsonl            ← 每次 `pencils migrate` 写一行；幂等判定看这里
├── .locks/                      ← 多进程互斥（CLI + Gateway 同时跑时）
│   └── <agent_id>.lock          ← 文件锁；进程 PID + 取得时刻
├── .trash/                      ← 软删除回收站（TTL 30 天后清理）
│   ├── agents/<id>-<ts>/        ← rename 而不是 rm
│   └── workspaces/<ws>-<ts>/
├── .backups/                    ← 破坏性操作前自动快照（migrate / adopt overwrite 等）
│   └── <ts>-<reason>/
├── .cache/                      ← 可再生数据，删了无业务影响
│   ├── model-catalogs/          ← 各 provider 模型清单的本地镜像
│   └── http/                    ← 远程拉取 Pencil 包时的 ETag/304 缓存
└── (业务目录见下)
```

**约定**：
- 凡是 `.<name>` 起头的子目录都视为 runtime 状态；用户备份配置时**只需要** rsync 非 dot 入口即可拿到一份完整可恢复包。`pencils migrate` 检测未识别的 dot 目录时**保留**而不删（forward-compat：未来版本可能引入新 dot 目录，老版本不能误删）。
- 业务目录用复数（`agents/`、`workspaces/`、`channels/`、`evals/`），保留单数命名给"单例 / 元数据"（`gateway/`、`shared_mem.db` 等）。这条规则降低未来同名冲突。

### 11.2 Schema 版本与可演化字段

每个持久化文件首字段都带 `version`（semver），缺省视为 `"0.0.0"`。例：

```jsonc
// agents/<id>/soul/profile.json
{
  "version": "1.0.0",
  "agentId": "han-han",
  "fields": {
    "systemPrompt": "...",
    "styleTags": [...]
  },
  "extensions": {}     // ← 任何未来扩展都进 extensions.<key>，老 reader 可忽略
}
```

**版本演进规则**（强约束）：
- **加字段**：minor 凸（1.0.0 → 1.1.0）；老 reader 必须忽略未知字段。
- **改字段语义**：major 凸（1.0.0 → 2.0.0）；启动时强制 `pencils migrate` 才能继续读。
- **删字段**：先标 `deprecated: true` 一个 minor 周期，再删；删除是 major 凸。
- 所有 reader 必须做 `version <= supportedMax` 检查；高于自己的版本提示用户升级 nano-pencil。

这一条今天就要落，否则一个月后改 soul/profile 字段就开始硬迁移。

### 11.3 命名空间预留清单（位先占好，feature 后补）

下表列出未来很可能要加的目录/文件，**现在 documented 但 optional**——存在性检查 lazy，缺失视为该 feature 未启用。

| 路径 | 用途 | 优先级 |
|---|---|---|
| `agents/<id>/extensions/` | 该 Agent 私有的 skill / MCP / prompt template（覆盖全局） | 中 |
| `agents/<id>/channels.json` | 这个 Agent 在哪些 channel 接收消息（DingTalk acct X、Feishu acct Y）| 中 |
| `agents/<id>/.activity-log.jsonl` | append-only 操作审计（POST agents、reconfigure、adopt、delete）| 低 |
| `agents/<id>/policies.json` | 该 Agent 的工具白名单 / 写入范围 / 调用频率上限 | 中 |
| `workspaces/<ws>/extensions/` | 项目级 MCP（如 npm-mcp、jira-mcp），所有进入此 workspace 的 Agent 共享 | 中 |
| `workspaces/<ws>/agent-overrides/<id>/` | 见 §13（Agent×Workspace 偏好）| 高 |
| `workspaces/<ws>/.activity-log.jsonl` | 项目维度的 append-only log（哪个 Agent 何时写了哪个文件）| 中 |
| `workspaces/<ws>/secrets.enc` | 项目级凭据（CI token、staging key 等）；用 OS keychain 加密 | 低 |
| `gateway/instances.json` | 多 Gateway 实例发现（同机起多个 Gateway 监听不同 port 时）| 低 |
| `gateway/.runtime/` | 进程级临时（PID 文件、socket fd、健康度心跳）| 低 |
| `channels/.tokens/` | 跨 Agent 共享的长寿凭据（企业版 DingTalk app token 多 Agent 共用）| 中 |
| `evals/runs/<run_id>/` | 单次评测的 trace + verdict | 低 |
| `evals/baselines/<agent_id>/` | 该 Agent 的能力基线快照 | 低 |
| `<root>/.shared/` | 跨 Agent 跨 Workspace 全局共享（如全局禁词、全局 rate-limit 策略）| 低 |

**预留原则**：每个 path 在文档里有一句话说明"如果你看到这个目录，意味着 X feature 已启用"，但 nanoPencil/Gateway **不强制创建**。code 路径 `existsSync(path) && featureFlag()` 双判定，feature 没做完时 path 就是空。

### 11.4 长期维护原则

1. **格式三选一**：JSON（配置）/ JSONL（append-only 日志、sessions、memory entries）/ SQLite（需要索引查询的，如 `shared_mem.db`、`sessions-index`）。新增不要引入第四种。
2. **永远不硬删**：任何 destructive 操作（delete agent / reset soul / drop workspace）都先 `mv` 到 `.trash/<source>-<ts>/`，TTL 30 天后由 `pencils gc` 真删。这条让 user-error 可恢复。
3. **写前快照**：`pencils migrate` / `adopt --overwrite` / `reset-template` 之前自动 rsync 到 `.backups/<ts>-<reason>/`，附 `manifest.txt` 说明改动范围。
4. **幂等 migrate**：`pencils migrate` 重跑是 no-op，`.migrations/applied.jsonl` 是 source of truth；不依赖 mv 到 `.nanopencil-old` 之类的"看到了就当没做过"启发式。
5. **Reader 宽容、Writer 严格**：读到不认识的字段、未知 dot 目录、新版本 schema → 跳过 + warn；写出永远走当前 schema 版本。
6. **路径分隔符**：所有持久化路径用 POSIX `/`，存到 disk 时跨平台归一化；只在面向 OS API 时（fs.readFile）转 native sep。Windows 不能因为 `\` vs `/` 差异破坏 git 共享 `.pencil_context`。
7. **大小写敏感性**：`<id>` / `<ws_id>` 全部小写 + 限定字符集 `[a-z0-9._-]{1,64}`。"韩寒"这种中文 displayName 走 `manifest.json:displayName` 字段，目录名用 `pencil/<sha-of-name>` 派生 ID 或用户显式 ASCII slug。**不要让操作系统大小写敏感性差异变成 bug**。
8. **路径长度**：避免 Windows MAX_PATH（260）。`<id>` ≤ 64 字符 + 子树深度 ≤ 5。`evals/runs/<run_id>/<step>/<artifact>.json` 已经接近上限，再深就要回到 "id 哈希两层"模式。
9. **`pencils doctor` 命令**：未来必加。定期检测 schema 版本、孤儿 lock、过期 trash、未识别 dot 目录、`.pencil_context` 与实际 cwd 漂移等，单一入口让用户排错。
10. **Public 接口的稳定性**：`agents/<id>/`、`workspaces/<id>/`、`agents/<id>/auth.json`、`agents/<id>/settings.json`、`workspaces/<id>/manifest.json` 视为**公共接口**——任何破坏性改动需要 major bump。其余路径（`.cache`、`evals/runs`）是 internal，可自由演化。

---

## 12. Workspace 身份模型（解决"云端 project 怎么存"）

`<project_id>`（也写作 `<ws_id>`）是一个**稳定不可变的 opaque 标识**，与项目的物理位置解耦。Workspace 通过 **manifest + bindings** 把多种存在形式（本地路径 / git remote / 云端 URI）挂上来。

### 12.1 Manifest schema

```jsonc
// ~/.pencils/workspaces/<ws_id>/manifest.json
{
  "version": "1.0.0",
  "id": "ws_a3f5b9c1",                    // 不可变；rename 不变
  "displayName": "我的小说 / novel-2026",
  "createdAt": "2026-05-04T10:00:00Z",
  "primary": "local-path",                 // bindings 里的哪一项是当前 source of truth
  "bindings": [
    {
      "type": "local-path",
      "path": "/Users/lucy/projects/novel",
      "addedAt": "2026-05-04T10:00:00Z"
    },
    {
      "type": "git-remote",
      "url": "git@github.com:lucy/novel.git",
      "addedAt": "2026-05-04T10:00:01Z"
    },
    {
      "type": "cloud-uri",
      "uri": "asgard://workspace/12345",   // 由 cloud 端点定义协议
      "providerId": "asgard-default",      // 多云时区分
      "addedAt": "2026-05-10T14:00:00Z"
    }
  ],
  "extensions": {}
}
```

### 12.2 四种典型 binding 组合

| 场景 | bindings | primary | 行为 |
|---|---|---|---|
| 纯本地项目 | `local-path` | `local-path` | `.pencil_context` 实时反映 fs；shared_mem.db 本地写 |
| 本地 + git 远程 | `local-path` + `git-remote` | `local-path` | 同上；`.pencil_context` 额外记录 git remote/branch；用户克隆到第二台机器时**这是同一个 ws_id**（用 git remote 作识别）|
| 仅有 git 远程（未克隆）| `git-remote` | `git-remote` | `.pencil_context` 是 cloud 拉取的快照（`git ls-tree --recursive` JSON 化）；shared_mem.db 仍本地（用户私有）；调用 Asgard 拉详细信息 |
| 纯云端项目（如 Google Doc 风）| `cloud-uri` | `cloud-uri` | `.pencil_context` 是云端的 capability 描述（"该云项目支持 read/write API"）；shared_mem.db 本地；Agent 操作通过 cloud-uri 协议发出 |

**`<ws_id>` 生成**（按优先级）：
1. 用户显式 `--workspace-id ws_xxx` 指定。
2. 第一个 binding 是 `git-remote` → `ws_${sha256(remote_url).slice(0,12)}`（同一 git remote 在所有人 / 所有机器上都是同一个 ws_id，自然支持团队共享）。
3. 第一个 binding 是 `local-path` → `ws_${sha256(realpath).slice(0,12)}`（同一台机器同一目录稳定；换机器即使路径相同也是新 id，因为 realpath 不同；这是 feature 不是 bug——机器 A 的项目和机器 B 的项目即便目录一样，记忆也应该独立，除非通过 git-remote binding 显式关联）。
4. 第一个 binding 是 `cloud-uri` → `ws_${sha256(uri).slice(0,12)}`。

### 12.3 Binding 演化

支持的迁移：
- 本地项目后来加 git remote → 给已有 ws 加 binding；ws_id 不变。
- 本地项目从机器 A 通过 git push 同步到机器 B → B 上 `nanopencil` 进入该 cwd 时检测 git remote 命中已有 ws_id → 自动复用同一 manifest 模板（但 sessions/shared_mem.db 仍各自机器独立——见 §11.4 #2，云端不存隐私数据）。
- 把云端项目"克隆到本地" → cloud-uri ws 的 manifest 加 local-path binding，primary 切换。

不支持的（拒绝执行 + 错误提示）：
- 直接合并两个不同 ws_id 到一个——如果用户真要合并，走 `pencils workspace merge <a> <b>` 显式命令，落 `.backups/`。
- 改 ws_id——id 是不可变约定，rename 走 displayName。

### 12.4 云端 Workspace 的同步边界

**严格遵循 §9.4 数据归属**：云端 workspace 提供的**元数据**（项目结构、API capability、协作者列表）可以拉到本地缓存，但**项目级 shared_mem.db / 用户级 sessions** 永远本地。这意味着：

- 同一团队的 A、B 两人各自连同一个 cloud workspace → 双方各有一份 shared_mem.db，**不自动合并**。如要协同写黑板，走 cloud Asgard backend 中转（v0.x 不做）。
- 这条决策避免了"用户私域数据被悄悄上传"的隐私事故。Team 共享黑板是 P1 feature，需要单独设计同步协议 + 加密 + 冲突解决，**不在本文范围**。

---

## 13. 三层 Habits 模型（每个 Agent 在不同 Workspace 的偏好）

> "本地文件系统里面是否还需要保留不同 Agent 的使用习惯" —— 用户问。
> 答：保留，且分三层，**精确层覆盖通用层**。

### 13.1 三层模型

```
Layer 1  agents/<id>/                     ← Agent 全局偏好（这个人格本身的习惯）
                ├── settings.json          ← model/temp/maxTurns 默认
                ├── memory/user/           ← 跨项目的偏好沉淀（"我喜欢 async/await"）
                └── soul/profile.json      ← 演化后的人格

Layer 2  workspaces/<ws>/                 ← Workspace 全局事实（项目本身的规则）
                ├── shared_mem.db          ← 项目共识（"本项目禁用 Promise.then"）
                ├── policies.json          ← 项目级写入白名单
                └── extensions/            ← 项目级 MCP

Layer 3  workspaces/<ws>/agent-overrides/<id>/   ← Agent × Workspace 交叉
                ├── style-overrides.json   ← 这个 agent 在这个项目里的专属风格调整
                ├── memory-overrides/      ← "韩寒在写技术文档项目时调研过的人物原型"
                └── tool-prefs.json        ← 这个 agent 在这个项目里更喜欢用 grep 而不是 ripgrep
```

### 13.2 运行时 merge 规则

调用链路：调度器（Gateway / Teams Dispatcher / CLI）拿到 `(agentId, wsId)` 后构造 effective config：

```text
effective.systemPrompt = agents/<id>/soul/profile.json :: systemPrompt
                       ⊕ workspaces/<ws>/policies.json :: extraSystemPromptForAgents[<id>]    (rare)

effective.styleTags    = agents/<id>/soul/profile.json :: styleTags
                       ⊕ workspaces/<ws>/agent-overrides/<id>/style-overrides.json :: extraStyleTags

effective.memory       = agents/<id>/memory/user/                                   (always primary)
                       ∪ workspaces/<ws>/agent-overrides/<id>/memory-overrides/    (project-specific)
                       ∪ workspaces/<ws>/shared_mem.db                              (project facts as context)
                       ∪ agents/<id>/memory/seed/                                   (cloud seed if any)

effective.tools        = baseTools
                       ⊕ agents/<id>/extensions/                                    (agent-private skills)
                       ⊕ workspaces/<ws>/extensions/                                (project-shared skills)

effective.policies     = workspaces/<ws>/policies.json (write whitelist, etc.)
                       ⋂ agents/<id>/policies.json     (agent self-restraint)
```

冲突时**精确层赢**：style-overrides 覆盖 styleTags，但 memory 是 union 不是替换（不同层贡献不同维度）。Policies 是 intersection（任一层禁就是禁，安全方向）。

### 13.3 为什么要分到三层（而不是塞 Agent 全局）

**反例**：把"韩寒在小说项目里更细腻 / 在技术文档项目里更克制"塞 `agents/han-han/soul/profile.json` ——则下次切去技术文档项目时，soul/profile 会被"还原成 default"或者"被技术风格污染"。

**正解**：基线人格在 Layer 1，项目特化在 Layer 3，这两层永远不互相写。用户切项目时 Layer 3 自然变化，Layer 1 不动，**人格稳定 + 项目敏感**两全。

### 13.4 写入路径（谁能写哪一层）

| 写入者 | Layer 1 | Layer 2 | Layer 3 |
|---|---|---|---|
| 用户手工 / `nanopencil` 内 `/style` 命令 | ✓（默认）| ✓ 显式 | ✓ 显式 `--scope=ws` |
| Agent 自身（自我演化）| 写 `evolutions/`，不直接改 profile | ✗（项目事实需要外部确认）| 写 `memory-overrides/`，不直接改 style-overrides |
| Team Dispatcher | ✗ | ✓（黑板写入）| ✗ |
| Gateway adopt 接口 | ✓ 初次落盘 template | ✗ | ✗ |
| Asgard cloud sync | ✓ template 字段 | ✗（云端不存项目事实）| ✗ |

`evolutions/` 是 append-only 演化日志；用户审阅后才"提升"为 profile.json 的字段——避免 LLM 自我演化失控。

---

## 14. 改动清单更新（合并 §11–§13 后）

§10 的清单需要追加以下条目：

| 项目 | 责任仓库 | 改动 | 阶段 |
|---|---|---|---|
| `.pencils-version` 文件 + reader | **nanoPencil + Gateway** | 启动时读，不存在则按当前版本写一次；版本差异时阻塞启动并提示 migrate | Step A |
| `.migrations/applied.jsonl` 协议 | **nanoPencil**（migrate 命令侧）| 协议定义；Gateway 不直接写 | Step C |
| `.trash/`、`.backups/`、`.locks/` 三个保留目录 | **nanoPencil + Gateway** | 不强建；引入对应 feature 时再建 | 按需 |
| `.cache/` 用于 model catalog 镜像 | **Gateway 或 nanoPencil** | 当前 token cache 已在 `gateway/channels/dingtalk/`，可挪入 `.cache/` | 中期 |
| Workspace `manifest.json` schema | **nanoPencil**（业务定义）| §12.1；先实现 local-path、git-remote 两类 binding | Step E（与 WorkspaceManager 同步）|
| `<ws_id>` 派生算法 | **nanoPencil** | §12.2 优先级链；CLI/Gateway 共用同一份实现，建议放 `packages/agent-core/workspace-id.ts` 暴露给两侧 | Step E |
| Agent×Workspace overrides 目录 | **nanoPencil** | §13.1 Layer 3 落盘 + merge 算法；CLI 进入项目时延迟 mkdir | Step E |
| Schema 版本检查中间件 | **nanoPencil + Gateway** | 每个持久化文件 reader 加 version 守卫 | Step C 起持续 |

§7 的执行顺序补一步：**Step A 同时把 §11.1 的 dot-prefix 保留位写到 nanoPencil/Gateway 的 README 与启动检查里**——先写文档比先写代码更重要，未来 PR 才知道哪里能加哪里不能动。

---

## 15. 关联

- [issues/0012-gateway-data-directory-alignment.md](../issues/0012-gateway-data-directory-alignment.md) — 上一轮 dataDir/agentDir 显式化（已落地）。
- [docs/14-multi-pencil-architecture.md](./14-multi-pencil-architecture.md) — multi-pencil 当前架构（早于本文）。
- [docs/15-editor-gateway-minimal-integration.md](./15-editor-gateway-minimal-integration.md) — editor ↔ Gateway 最小集成。
- nanoPencil `docs/multi-agent-fs-design.md` — Mind/Embodiment 解耦设计（与本文已合并）。
- nanoPencil `extensions/defaults/team/` — 现有 Teams 实现（待按 §9.6 重构）。
- nanoPencil `core/workspace/worktree-manager.ts` — 现有 worktree 管理（升级为 WorkspaceManager）。

---

## 16. 待确认

1. [ ] §9.6 — Teams 是切到"本地拉起 Gateway"的同构模式，还是保持 in-process 协作模式？影响 §10 的 Step F 范围。
2. [ ] §9.5 — sessions 副索引使用文件目录还是 SQLite？mem-core 当前实现倾向哪种？
3. [ ] §5 — `memorySeed` 落盘格式（per-file JSON / JSONL / mem-core 抽象）。
4. [x] §12 已回答：`<project_id>` 派生算法（用户显式 > git-remote > local-path > cloud-uri）。
5. [ ] §10 Step B — nanoPencil 源码评估的承担者与时间盒。
6. [ ] Windows 路径处理：`%USERPROFILE%\.pencils\` vs `~`（Powershell 用户与 WSL 用户的预期不同）；`<id>` 大小写规则（§11.4 #7）需要 CLI 进入项目时 normalize 实现。
7. [ ] `pencils migrate` 是 nanoPencil 子命令还是独立脚本（影响发布）。
8. [ ] §12.4 — Cloud workspace 的同步协议留到 P1：何时引入？由 Asgard 还是 Gateway 主导？
9. [ ] §13.4 — Agent 自我演化的 `evolutions/` → `profile.json` "提升"流程的 UI（CLI `/promote` 命令？编辑器审阅面板？）
10. [ ] §11.3 命名空间预留清单：哪些是 v0.x 必建，哪些可推到 v1（涉及发布顺序）。
