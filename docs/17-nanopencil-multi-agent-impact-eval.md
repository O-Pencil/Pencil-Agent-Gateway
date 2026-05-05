---
title: nanoPencil 多 Agent 改造影响面评估（Step B）
status: design
scope: nanopencil-source-impact-evaluation
owner: pencil-agent-gateway maintainers
created: 2026-05-05
updated: 2026-05-05
---

# nanoPencil 多 Agent 改造影响面评估（Step B）

## DIP Metadata

```text
[WHO]  nanoPencil + Pencil-Agent-Gateway 维护者；做 Step B 评估的人
[FROM] doc 16 §10 Step B 任务（"先调研后动手"）；
       nanoPencil 当前 v1.13.x 源码（config.ts / main.ts / core/* / extensions/defaults/team）；
       /root/workspace/nanoPencil/docs/multi-agent-fs-design.md（既有 nanoPencil 多 Agent 设计）
[TO]   doc 16 §10 Step C 改造的 PR 拆分依据；与既有 multi-agent-fs-design.md 概念对齐确认；
       Teams 重构方向（user 反馈："原有 team 已不适合在单实例内执行"）
[HERE] docs/17-nanopencil-multi-agent-impact-eval.md
```

---

## 0. TL;DR（先看这里）

### 0.1 评估结论

| 维度 | 结论 |
|---|---|
| 改 `getAgentDir()` 默认值的影响面 | **小**——大部分调用点在 boot 期 / TUI 模块级，多 agent 场景不会跑到 |
| 真正"卡 multi-agent"的硬编码点 | **6 处**（persona / session / soul / mcp ×2 / security-audit）+ Teams `team-state-store.ts` |
| 已经接受 `agentDir` 注入的好公民 | **5 处**（sdk / extensions loader / keybindings / skills / model-registry）|
| `multi-agent-fs-design.md` 与 doc 16 是否一致 | **概念一致**，三处用词需统一（详见 §6） |
| Teams 当前实现是否适合多 Agent | **不适合**——teammate 是 metadata blob，无独立 soul/memory/sessions；user 判断正确 |
| nanoPencil 现有功能受影响范围 | 单用户 CLI 行为完全保留；多 agent 是叠加层，不破坏单 agent 路径 |

### 0.2 改造原则（一行版）

> **`getAgentDir()` 不删，作为单 agent 默认值兜底；硬编码点改为接受 `agentDir` 参数 / context；Teams 重写为"多 Agent 进程级 / 黑板协作"。**

### 0.3 与既有 `multi-agent-fs-design.md` 的关系

> nanoPencil 仓库已有 `docs/multi-agent-fs-design.md`（4 阶段演进路径 + Mind/Embodiment 解耦哲学）。本文是它的**实施配套**——把 4 阶段的具体源码改动列清楚，并与本仓库 doc 16 合并。两份文档现已概念对齐：
> - 根目录：`~/.pencils/`（doc 16 决策；multi-agent-fs-design.md 写的是 `~/.nanopencil/`，需要它一并 migrate 到 `.pencils/` 或留 alias，详见 §6）
> - Mind = `agents/<id>/`，Embodiment = `workspaces/<ws_id>/`
> - 演进 4 阶段对齐 doc 16 §7/§10 的 Step A–G

---

## 1. 当前 nanoPencil 数据访问拓扑

```
                       ┌────────────────────────────────────┐
                       │  config.ts                          │
                       │  ───────────────                    │
                       │  getAgentDir():                     │
                       │    process.env.NANOPENCIL_CODING_   │
                       │      AGENT_DIR                      │
                       │    ?? ~/.nanopencil/agent/          │
                       │                                     │
                       │  CONFIG_DIR_NAME = ".nanopencil"    │
                       │  ENV_AGENT_DIR =                    │
                       │    "NANOPENCIL_CODING_AGENT_DIR"    │
                       │  + getModelsPath / getAuthPath /    │
                       │    getSettingsPath / getSessionsDir │
                       │    全部 = join(getAgentDir(), ...)   │
                       └─────────────────┬──────────────────┘
                                         │ getAgentDir() ×72 callsites
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
   ┌────▼─────┐                  ┌──────▼─────┐                   ┌──────▼─────┐
   │ Boot 期   │                  │ Stateless  │                   │ Stateful   │
   │ 单调用    │                  │ 函数 API   │                   │ Singleton  │
   │           │                  │ 已支持注入  │                   │ 模块级常量  │
   │ main.ts   │                  │ sdk.ts     │                   │ persona-   │
   │ migrations│                  │ skills     │                   │ manager    │
   │ index.ts  │                  │ keybindings│                   │ session-   │
   │ TUI       │                  │ extensions │                   │ manager    │
   │ 模式      │                  │ model-reg. │                   │ soul-integ.│
   │           │                  │            │                   │ mcp-config │
   │           │                  │            │                   │ mcp-client │
   │           │                  │            │                   │ team-state │
   │           │                  │            │                   │ security-  │
   │           │                  │            │                   │  audit log │
   └───────────┘                  └────────────┘                   └────────────┘
       OK                              OK                              ❌
   不需要改                       直接传 agentDir                  必须重构
```

数字：**72** 个 path 派生调用，分布在 **18** 个文件，可按上图三分类。

---

## 2. 文件级清单（按改造类别）

### 2.1 ✅ 已接受 `agentDir` 注入（无需改）

| 文件 | 注入入口 | 说明 |
|---|---|---|
| `core/runtime/sdk.ts` | `createAgentSession({ agentDir? })` | Gateway 已通过 `opts.agentDir` 走这条路；fallback 是 `getDefaultAgentDir()` 包装 |
| `core/extensions/loader.ts:496` | `loadExtensions(cwd, agentDir = getAgentDir())` | 默认参数 = `getAgentDir()`，传非空值就跑指定 dir |
| `core/keybindings.ts:138` | `KeybindingsManager.create(agentDir = getAgentDir())` | 同上 |
| `core/skills.ts:362` | `loadSkills({ agentDir? })` | options 字段 |
| `core/model-registry.ts` | constructor `(authStorage, modelsJsonPath?, options?)` | Gateway 已用 `join(agentDir, "models.json")` 走这条 |

**Status**：这 5 处是设计范本——所有 path-derived 模块都该长这样。改造目标 = 把 §2.2 的硬编码点都改成这个模式。

### 2.2 ❌ 模块级硬编码（必须改）

下表是真正会"卡 multi-agent"的点。每条都标了改造难度（C0–C3）：

| 文件 | 行号/位置 | 现状 | 问题 | 难度 |
|---|---|---|---|---|
| `core/persona/persona-manager.ts` | 15,17 | `const PERSONAS_DIR = join(getAgentDir(), "personas")` 模块级 const | import 时就求值，进程内只能有一个 persona dir；多 agent 切 dir 失效 | **C2** 重构成 class 接受 agentDir |
| `core/session/session-manager.ts` | 428,1375 | `join(getDefaultAgentDir(), "sessions", ...)` 直接用全局 dir | session 落到错位置（不是当前 agent 的）| **C1** 改成传参 |
| `core/soul-integration.ts` | 46 | `let soulDir = join(getAgentDir(), "soul")` 函数级 | 只在函数内调用，但参数传不进来 | **C1** 加 agentDir 形参 |
| `core/mcp/mcp-config.ts` | 150,161,202 | 三处 `getAgentDir()` 直接调 | mcp.json 永远从全局 dir 读 | **C2** 加 agentDir 形参或 context |
| `core/mcp/mcp-client.ts` | 185 | `AuthStorage.create(join(getAgentDir(), "auth.json"))` | mcp 客户端鉴权走全局 auth | **C1** 走 sdk 注入的 authStorage |
| `extensions/defaults/security-audit/engine/logger.ts` | 3 处 | `getAgentDir()` 直接调 | audit log 写到全局 dir | **C1** 改成 agentDir 形参 |
| `extensions/defaults/team/team-state-store.ts` | 17–21 | 自定义 `resolveAgentDir()` 用 **`NANOPENCIL_AGENT_DIR`**（不是 `NANOPENCIL_CODING_AGENT_DIR`）| 与 config.ts 的 env 名不一致——是个**潜伏 bug** | **C1** 复用 config.ts 的 getAgentDir + 接受注入 |

**关于 `team-state-store.ts:17-21`**：

```typescript
function resolveAgentDir(): string {
  return process.env.NANOPENCIL_AGENT_DIR || join(homedir(), ".nanopencil", "agent");
}
```

env 名应当是 `NANOPENCIL_CODING_AGENT_DIR`（与 `config.ts` 的 `ENV_AGENT_DIR` 一致）。今天没爆炸只因为：CLI 默认目录与 Teams 默认目录都是 `~/.nanopencil/agent/`。一旦用户设了 `NANOPENCIL_CODING_AGENT_DIR=~/somewhere`，CLI 数据走过去、Teams 数据还在 `~/.nanopencil/agent/teams/`——分裂。

**Step B 顺手修这个 bug**，难度 C0（删掉 5 行 + 复用 config.ts 的 getAgentDir）。

### 2.3 🟡 Boot 期 / TUI 模式级调用（保留即可）

| 文件 | 调用次数 | 说明 |
|---|---|---|
| `main.ts` | 7 | CLI 启动入口；单 agent 启动模式下永远跑当前 agentDir，OK |
| `migrations.ts` | 5 | 一次性迁移；boot 时跑一次 |
| `index.ts` | 1 | 包导出，无副作用 |
| `nanopencil-defaults.ts` | 3 | seed 默认 models.json/auth.json |
| `modes/interactive/*.ts` | 10 | TUI 是单 agent 模式；切 agent 走"重启 TUI 或 spawn 子 TUI"路径 |
| `core/utils/shell.ts` | 1 | 工具函数 |

**判断**：这些点不需要改成多 agent。CLI 的"切 agent"由 `--agent <id>` 参数（doc 16 §10 Step C）决定，进程**启动时**就把 `NANOPENCIL_CODING_AGENT_DIR` 设好；启动后再切走"杀进程 + 重启"——比强行做"运行时切 agentDir"的复杂度低 10 倍。

---

## 3. 改造抽象：`AgentDirContext`

### 3.1 提案

新增 `core/agent-dir/agent-dir-context.ts`：

```typescript
/**
 * AgentDirContext — represents one "agent slot" (id + dir) for a unit of work.
 *
 * Today everything calls getAgentDir() lazily, which means a single Node
 * process can serve only one agent. Multi-agent (Gateway, Teams, future
 * editor multi-connection) needs a context-passing pattern: each request /
 * teammate carries its own AgentDirContext, threaded down to MCP / sessions
 * / persona / soul / audit-log writers.
 */
export interface AgentDirContext {
  /** Slug id, [a-z0-9._-]{1,64}; matches the directory name. */
  readonly id: string;
  /** Absolute path; trusted to exist or be creatable. */
  readonly path: string;
  /** Optional — if the agent was adopted from cloud, the origin metadata. */
  readonly origin?: AgentOriginMetadata;
}

/**
 * Default context = the legacy single-agent path. Pass-through for code
 * paths not yet plumbed with an explicit context (boot, migrations, TUI).
 */
export function defaultAgentDirContext(): AgentDirContext {
  return {
    id: "default",
    path: getAgentDir(), // existing function
  };
}

/** Build a context from an explicit dir + id (Gateway / Teams use this). */
export function agentDirContextOf(id: string, path: string): AgentDirContext {
  return { id, path };
}
```

为什么用 context 而不是单纯传 `agentDir: string`：
1. 多个 path 派生（auth/models/settings/sessions/...）从同一个 base 派生，统一打包
2. 未来加字段（origin、tenant、workspaceId）不用改所有签名
3. 类型里写明"这是一个 agent 的容器"——比纯 string 自描述

### 3.2 §2.2 的硬编码点改造模板

```typescript
// Before (persona-manager.ts:15)
import { getAgentDir } from "../../config.js";
const PERSONAS_DIR = join(getAgentDir(), "personas");

class PersonaManager {
  list() { return readdir(PERSONAS_DIR); }
}

// After
import { type AgentDirContext, defaultAgentDirContext } from "../agent-dir/agent-dir-context.js";

class PersonaManager {
  constructor(private readonly ctx: AgentDirContext = defaultAgentDirContext()) {}

  private get personasDir() {
    return join(this.ctx.path, "personas");
  }

  list() { return readdir(this.personasDir); }
}
```

要点：
- **保留兼容**：默认参数 = `defaultAgentDirContext()`，老调用者无感。
- **lazy resolve**：`get personasDir()` 每次调用现算，避免 import-time 副作用。
- **签名只加不删**：现有调用者一行不改也能跑。

---

## 4. Teams 现状与重构方向

### 4.1 现状（Step B 调研）

`extensions/defaults/team/`：

```
team-runtime.ts          ← 主调度（in-process leader/teammate 模式）
team-state-store.ts      ← teammate 元数据落盘 ~/.nanopencil/agent/teams/<id>.json
team-orchestrator.ts     ← 任务派发
team-harness.ts          ← teammate 执行包装
team-mailbox.ts          ← teammate 间消息
team-transcript.ts       ← 对话记录
team-presets.ts          ← 预设角色模板
team-permissions.ts      ← 权限模型
team-psyche.ts           ← teammate 性格描述
team-dashboard.ts        ← TUI 视图
```

**关键观察**：

1. **teammate 不是真 Agent slot**——`team-state-store.ts` 落的是单个 JSON（`{ id, name, label, mode, status, persona, model, ... }`），无独立 soul/memory/sessions/auth。teammate 共享 leader 的 agentDir。
2. **teammate 用 `cwd` 区分工作空间**（`team-runtime.ts:219` `cwd: worktree?.path ?? spec.baseCwd`），跟着 `WorktreeManager` 走 git worktree——这是 Workspace 雏形，但没有持久化到 `~/.nanopencil/agent/workspaces/`。
3. **协作走 in-memory mailbox**（`team-mailbox.ts`），不是黑板模式。leader 进程崩了，所有未读消息丢失。
4. **生命周期跟 leader 进程**——leader 退出 = teammate 全死。

### 4.2 用户判断验证：「原有 team 已不适合在单实例内执行」

**同意**。理由：

- **隔离性差**：所有 teammate 写同一个 agentDir 的 sessions/，对话历史互相污染；persona 切换跨 teammate 漂移。
- **可恢复性差**：进程崩了 teammate 全死，没有"接着上次的工作"能力。
- **跨会话协作差**：leader 不在 = teammate 不在；用户登出再登入，team 上下文丢了。
- **与 Gateway 模型不通**：Gateway 已经是"每个 Agent 一个 slot + HTTP 协调"的成熟拓扑；Teams 内嵌另一套 leader/follower 是重复造轮子。

### 4.3 重构方向（接 doc 16 §9.6）

```
                    ┌────────────────────────────────────┐
                    │  Pencil-Agent-Gateway 进程         │
                    │  ────────────────────              │
                    │  AgentRegistry：                   │
                    │   ├── pencil-01  → AgentInstance   │
                    │   ├── pencil-02  → AgentInstance   │
                    │   ├── reviewer   → AgentInstance   │
                    │   └── ...                          │
                    │                                    │
                    │  HTTP /v1/chat/completions         │
                    │  HTTP /v1/teams/<team_id>/dispatch │
                    └─────────────────────┬──────────────┘
                                          │
                    ┌─────────────────────┴──────────────┐
                    │  ~/.pencils/                       │
                    │  ├── agents/                       │
                    │  │   ├── pencil-01/                │
                    │  │   ├── pencil-02/                │
                    │  │   └── reviewer/                 │
                    │  └── workspaces/                   │
                    │      └── <ws_id>/                  │
                    │          ├── teams/                │
                    │          │   └── <team_id>.json    │
                    │          ├── shared_mem.db   ← 黑板 │
                    │          └── sessions-index/       │
                    └────────────────────────────────────┘

新模型：
  - 每个 teammate ↔ Gateway 里的一个 AgentInstance（独立 agentDir）
  - Team 是 workspace 范畴的概念（一个 team 绑一个 workspace）
  - 协作走 workspace shared_mem.db（黑板）+ Gateway HTTP（同步指令）
  - Team 配置（成员、规则、状态）落 workspaces/<ws_id>/teams/<team_id>.json
  - Leader 是个角色（哪个 agent 当 dispatcher），不是进程绑定
```

**迁移路径**（doc 16 §10 Step F 的具体化）：

| 阶段 | 行动 | 兼容承诺 |
|---|---|---|
| F1 | 在 nanoPencil 里加 "remote teammate" 模式：teammate 不再 in-process spawn，而是通过 HTTP 调本机 Gateway（Gateway 必须先起来） | 旧 in-process 模式保留为 `--legacy` flag |
| F2 | `team-state-store.ts` 改成 `~/.pencils/workspaces/<ws_id>/teams/<team_id>.json`，schema 升级（含 member agent ids 列表、rule、leaderId） | 旧 `<dir>/teams/<id>.json` 自动迁移到新位置 |
| F3 | `team-mailbox.ts` 改成基于 workspace `shared_mem.db` 的黑板事件订阅 | 旧 in-memory mailbox 在 legacy mode 保留 |
| F4 | Leader 选举 / 故障转移：基于 Gateway side 的 `/v1/teams/<id>/leader` 状态 | 单 leader 模式仍可用 |
| F5 | 移除 `--legacy`；Teams 完全切到多 Agent 进程模型 | major bump 时机；保留 release notes 说明 |

每一步都可独立发版，不必一口气切。

---

## 5. 风险与测试

### 5.1 高风险点

| 风险 | 触发场景 | 缓解 |
|---|---|---|
| **persona-manager 的 import-time 副作用** | 模块级 `PERSONAS_DIR` 常量；重构时漏掉某个 reader 仍读旧常量 | 删掉旧 const，让 grep `PERSONAS_DIR` 帮助定位所有 reader |
| **session-manager 双路径** | `getDefaultAgentDir()` 在 1455 行长文件里出现两次；改一处漏一处会导致 session 写到错位置 | 改成 SessionManager 实例字段，TS 编译器会报漏改的点 |
| **mcp-client 的 AuthStorage 重影**| Gateway 已经在 sdk.ts 注入 authStorage，但 mcp-client.ts 自己又拿了一份从 `getAgentDir()` 读的 auth.json | 改 mcp-client 接受外部 authStorage，去掉自创路径 |
| **Teams 跨进程依赖** | F1 后 teammate 必须能联到本机 Gateway，端口冲突 / 防火墙会爆 | F1 默认走 unix socket（macOS/Linux）+ 命名管道（Windows）；HTTP 端口是退路 |
| **team-state-store env 名 bug** | 修复后用户原本设了 `NANOPENCIL_AGENT_DIR` 期待 Teams 走那个路径——会感觉 Teams 数据"消失了" | release note 说明；提供 `pencils migrate` 检测 + 提示 |

### 5.2 测试矩阵

```
                  Single CLI    Multi-pencil    Teams (legacy)   Teams (new)
                  ----------    ------------    --------------   -----------
agent boot       ✓ unchanged   ✓ new           ✓ unchanged      ✓ new
session write    ✓ same path   ✓ per-agent     ✓ shared (old)   ✓ per-agent
persona switch   ✓ unchanged   ✓ per-agent     ✓ unchanged      ✓ per-teammate
mcp config       ✓ unchanged   ✓ per-agent     ✓ unchanged      ✓ per-teammate
soul evolution   ✓ unchanged   ✓ per-agent     ✓ unchanged      ✓ per-teammate
crash recovery   ✓ unchanged   ✓ unchanged     ✗ lose context   ✓ workspace replay
```

每条线对应 1 套集成测试。重构 PR 必须保证「Single CLI」和「Teams (legacy)」两列**字节级一致**，否则就是回归。

### 5.3 nanoPencil 既有测试覆盖

```bash
$ find /root/workspace/nanoPencil -name "*.test.ts" | wc -l
# 用此命令确认数量；当前未做精确统计
```

需在改造前补：
- `core/persona/persona-manager.test.ts` —— 多 PersonaManager 实例并存
- `core/session/session-manager.test.ts` —— 多 agentDir session 隔离
- `core/mcp/mcp-config.test.ts` —— per-agent mcp.json 加载
- `extensions/defaults/team/team-state-store.test.ts` —— env 名修复回归 + 多 store 并存

---

## 6. 与 nanoPencil `multi-agent-fs-design.md` 的对齐

### 6.1 概念对齐

| 维度 | multi-agent-fs-design.md | doc 16（本仓库）| 决策 |
|---|---|---|---|
| 哲学 | Mind / Embodiment 解耦 | 同 | ✓ 完全一致 |
| 根目录 | `~/.nanopencil/` | `~/.pencils/` | **以 doc 16 为准（PENCILS_HOME 默认）**；nanoPencil 里把 `CONFIG_DIR_NAME` 从 `.nanopencil` 改 `.pencils`，加 alias 兼容 |
| agents/ 子树 | `agents/<id>/{soul,memory,sessions,config}` | `agents/<id>/{agent.json,soul,memory,sessions,auth.json,settings.json,...}` | **doc 16 更细**（含 agent.json 元数据 §11.2.1）；multi-agent-fs-design.md 升级即可 |
| workspaces/ | `workspaces/<project_id>/{.pencil_context,shared_mem.db}` | 同 + `teams/`、`agent-overrides/`、`sessions-index/`、`policies.json` | **doc 16 更细**；二者无冲突 |
| gateway/ | `gateway/{registry,global_config}` | `gateway/{registry/agents/<id>.json,channels/...,sessions/}` | 概念一致，命名小调 |
| channels/ | `channels/`（外部集成持久化）| 同 | ✓ |
| evals/ | `evals/`（性能 trace）| 同（§9.3 列出但未细化）| ✓ |
| 演进阶段 | Shadow → Migration → PAAS → O-Mesh | doc 16 Step A–G | 阶段细化 + 落到具体 PR |

### 6.2 三处用词需统一

1. **CONFIG_DIR_NAME**：multi-agent-fs-design.md 用 `.nanopencil`，doc 16 用 `.pencils`。**采纳 `.pencils`**（doc 16 Q1），`.nanopencil` 通过 `NANOPENCIL_HOME` env alias + `pencils migrate` 命令兼容。需要在 nanoPencil 这边改 `package.json:nanopencilConfig.configDir`。
2. **"主 Agent (Dispatcher)"**：multi-agent-fs-design.md §4.1 提"调度网关"，doc 16 用 "Leader / Dispatcher"。**统一用 "Dispatcher"**（更中性，避免和 Gateway 这个项目名混淆）。
3. **"每个 Agent 都是独立的槽位"**：multi-agent-fs-design.md 用"槽位"，doc 16 用 "slot / agent slot"。**保留中文"槽位" + 英文 "slot"**。

### 6.3 二者合并后的"事实上唯一文档"

> 目标：**一份文档树管所有事**，不再有"两个仓库各写一份多 agent 设计"。

建议的最终拓扑：

- `Pencil-Agent-Gateway/docs/16-pencils-storage-layout.md` —— **设计与决策的源头**（doc 16）
- `Pencil-Agent-Gateway/docs/17-nanopencil-multi-agent-impact-eval.md` —— 本评估（Step B 产物）
- `nanoPencil/docs/multi-agent-fs-design.md` —— **改成"指向 doc 16 的导览"** + nanoPencil 自身改造记录（保留它的演进 4 阶段，但具体内容指 doc 16）

避免双源真相漂移，是长期维护的硬要求。

---

## 7. nanoPencil 改造任务列表（可直接拆 PR）

每个任务标注 **PR 复杂度**（S/M/L）+ **依赖**：

### Phase 1：基础设施（不引入新行为）

| ID | 任务 | 复杂度 | 依赖 | 描述 |
|---|---|---|---|---|
| N1 | `AgentDirContext` 抽象 | S | — | 新增 `core/agent-dir/agent-dir-context.ts`；`defaultAgentDirContext() = { id: "default", path: getAgentDir() }` |
| N2 | `package.json` 加 `PENCILS_HOME` 支持 | S | — | `config.ts` 读 `PENCILS_HOME` env；CONFIG_DIR_NAME 仍 `.nanopencil`；新 default = `$PENCILS_HOME/agents/default` if PENCILS_HOME set, else legacy |
| N3 | `team-state-store.ts` env 名修复 | S | — | `NANOPENCIL_AGENT_DIR` → `NANOPENCIL_CODING_AGENT_DIR`，复用 config.ts 的 `getAgentDir`；这是个独立 bugfix，可先合 |

### Phase 2：硬编码点改造（无行为变化，纯重构）

| ID | 任务 | 复杂度 | 依赖 | 描述 |
|---|---|---|---|---|
| N4 | `persona-manager.ts` 重构 | M | N1 | 删模块级常量，改 class 接受 AgentDirContext；callers 用 default context 兜底 |
| N5 | `session-manager.ts` 改 ctor 注入 | M | N1 | `SessionManager.create(cwd, agentDirCtx?)`；两处 `getDefaultAgentDir()` 移除 |
| N6 | `soul-integration.ts` 加形参 | S | N1 | 函数签名加 `agentDirCtx?: AgentDirContext` |
| N7 | `mcp-config.ts` + `mcp-client.ts` 改 | M | N1 | mcp 配置 / 客户端走注入的 agentDir + authStorage |
| N8 | `security-audit/engine/logger.ts` 改 | S | N1 | logger 接受 agentDir |

### Phase 3：用户可见的新行为

| ID | 任务 | 复杂度 | 依赖 | 描述 |
|---|---|---|---|---|
| N9 | `nanopencil --agent <id>` flag | M | N1–N8 | CLI 启动时选 agent slot；`--agent default` 等价旧行为 |
| N10 | `agent.json` reader/writer | S | N1 | 启动时检测 `agentDir/agent.json`，写元数据；缺失时按 default 兜底 |
| N11 | `pencils migrate` 子命令 | M | N1, N3 | 检测 `~/.nanopencil/agent/` → `~/.pencils/agents/default/`，幂等，写 `.migrations/applied.jsonl` |
| N12 | Default `CONFIG_DIR_NAME` → `.pencils` | M | N9, N11 | release-gated；旧位置 fallback 至少跨 1 个 minor |

### Phase 4：Workspace 一等公民

| ID | 任务 | 复杂度 | 依赖 | 描述 |
|---|---|---|---|---|
| N13 | `WorkspaceManager` 新建 | L | N9 | 独立 workspace 抽象（不替换 WorktreeManager，而是上层）；落盘 `workspaces/<ws_id>/manifest.json` |
| N14 | `<ws_id>` 派生算法 | S | N13 | 实现 doc 16 §12.2；CLI/Gateway 共享 `packages/agent-core/workspace-id.ts` |
| N15 | sessions 双轴索引 | M | N13 | sessions 主存仍在 agentDir，副索引到 workspace |

### Phase 5：Teams 重构（user 关注点）

| ID | 任务 | 复杂度 | 依赖 | 描述 |
|---|---|---|---|---|
| N16 | Teams "remote teammate" 模式 | L | N9, N13 | teammate 走 HTTP → 本机 Gateway；旧 in-process = `--legacy-team` |
| N17 | `team-state-store` 落 workspace | M | N13, N16 | teammate metadata 移到 `workspaces/<ws_id>/teams/<team_id>.json` |
| N18 | mailbox → 黑板 | L | N13, N17 | 基于 `shared_mem.db` 的事件订阅 |
| N19 | 移除 `--legacy-team` | S | N16-18 落地 ≥ 1 个 minor 版本后 | major bump |

每个 PR 独立，CI 全过，不破坏 single-CLI 行为。Phase 1–2 是必做地基；3–5 按业务优先级排。

---

## 8. 关键文件 cheatsheet（用于改造时 grep）

```bash
# 找模块级硬编码点
rg "join\(getAgentDir\(\)" --type ts -g '!**/*.d.ts' -g '!**/dist/**'

# 找接受 agentDir 注入的调用
rg "agentDir\??: string" --type ts core/

# 找 NANOPENCIL_*_AGENT_DIR 直接读 env 的（应当只有 config.ts）
rg "NANOPENCIL.*AGENT_DIR" --type ts -g '!**/*.d.ts' -g '!**/dist/**'

# Teams 内的硬编码
rg "agent" extensions/defaults/team/ --type ts -g '!**/*.test.ts'
```

---

## 9. 与本仓库（Pencil-Agent-Gateway）的承接

| 已落地 | doc 引用 |
|---|---|
| `~/.pencils/agents/<id>/` 默认 + env 层级 | doc 16 Step A（已合并 commit `2ea04e9`）|
| 旧 `~/.pencils/<id>/` fallback + warn | 同上 |
| AgentConfig.agentDir 显式 | issue 0012 已合并 |

| 等 nanoPencil 改完才能补的 | 说明 |
|---|---|
| Gateway 移除 `start-pencil.sh` env 兜底 | 等 N9（`nanopencil --agent`）能直接 launch agent slot |
| `/v1/agents/adopt` 接口 | 等 N10（agent.json 写入）+ Asgard 的 Pencil 包 schema |
| Gateway 主动管 workspace | 等 N13（WorkspaceManager） |
| `/v1/teams/...` 接口 | 等 N16-N18 |

---

## 10. 待确认（与 doc 16 §16 联动）

1. [ ] **本评估文档是否承接 multi-agent-fs-design.md**：建议把 nanoPencil 那边的文档改写成"导览 + nanoPencil 自身改造记录"，避免双源；需要 nanoPencil 维护者拍板。
2. [ ] **Phase 5（Teams 重构）的优先级**：现在做 vs 等 multi-pencil 跑稳之后做？
3. [ ] **`--legacy-team` 兼容窗口**：1 minor / 3 minor / 直接 major break？
4. [ ] **`AgentDirContext` 类型放哪个 package**：`core/agent-dir/`（私有）还是 `packages/agent-core/`（让 Gateway 也能 import）？
5. [ ] **`agent.json` 由谁先写**：CLI 第一次启动时（N10）还是 Gateway 第一次注册时（先 ship Gateway 侧）？影响 schema "first-writer wins" 协议。
6. [ ] N3（team-state-store env 名修复）是否单独发一个紧急 patch？这个是 latent bug，不依赖任何其他改动。

---

## 11. 关联

- [docs/16-pencils-storage-layout.md](./16-pencils-storage-layout.md) —— 顶层设计；本文是它 §10 Step B 的产物
- [issues/0012-gateway-data-directory-alignment.md](../issues/0012-gateway-data-directory-alignment.md) —— Step A（agentDir/dataDir 显式化）已落地
- nanoPencil [`docs/multi-agent-fs-design.md`](../../nanoPencil/docs/multi-agent-fs-design.md) —— 哲学源头；待与 doc 16 合并
- nanoPencil `config.ts:207` `getAgentDir()` —— 改造重心
- nanoPencil `extensions/defaults/team/` —— Phase 5 重构对象
