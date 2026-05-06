---
title: Gateway 侧行动手册（多 Agent 存储）
status: active
scope: gateway-multi-agent-action-plan
owner: pencil-agent-gateway maintainers
created: 2026-05-04
updated: 2026-05-06
sourceOfTruth: nanoPencil/docs/multi-agent-fs-design.md
---

# Gateway 侧行动手册（多 Agent 存储）

> **核心设计文档**：[`nanoPencil/docs/multi-agent-fs-design.md`](../../nanoPencil/docs/multi-agent-fs-design.md)（唯一权威源）
>
> 本文档只覆盖 **Gateway 侧**的任务、状态和待办。所有设计决策、目录布局、schema 定义、nanoPencil 改造细节都在核心文档里。

## DIP Metadata

```text
[WHO]  Pencil-Agent-Gateway 维护者
[FROM] nanoPencil/docs/multi-agent-fs-design.md（核心设计）
[TO]   Gateway 源码改造 PR
[HERE] docs/16-pencils-storage-layout.md — Gateway 侧行动手册，非设计文档
```

---

## 1. 已落地

| 任务 | Commit | 状态 |
|------|--------|------|
| `PENCILS_HOME` / `PENCILS_AGENTS_DIR` / `PENCILS_GATEWAY_DIR` 三档 env 解析 | `2ea04e9` | ✅ |
| `NANOPENCIL_HOME` / `NANOPENCIL_CODING_AGENT_DIR` 兼容别名 | `2ea04e9` | ✅ |
| `agentDir` 默认 `$PENCILS_AGENTS_DIR/<id>`（`~/.pencils/agents/<id>/`） | `2ea04e9` | ✅ |
| `dataDir` 默认 `$PENCILS_GATEWAY_DIR`（`~/.pencils/gateway/`） | `2ea04e9` | ✅ |
| 旧布局 `~/.pencils/<id>/` 自动检测 + 保留 + 警告 | `2ea04e9` | ✅ |
| `nano-adapter` 改用 per-instance `this.agentDir` | `2ea04e9` | ✅ |
| 测试 154/154 通过 | `2ea04e9` | ✅ |

## 2. 待落地任务

> 任务 ID 前缀 `G` = Gateway 侧任务；`N` = nanoPencil 侧任务（阻塞 Gateway）。

### G2 — Agent ID 校验（无阻塞，可立即做）

**内容**：`AgentRegistry.register()` + `loadConfig()` 加正则校验 `^[a-z0-9][a-z0-9._-]{0,63}$`。非法 id 直接 400。

**参考**：核心文档 §4.1、§4.5

### G3 — 注册时写 `agent.json`（等 N10）

**内容**：`POST /v1/agents` 和 `PUT /v1/agents/:id` 时，Gateway 同时写 `agents/<id>/agent.json`（schema 见核心文档 §4.2）。

**阻塞**：nanoPencil N10（`agent.json` reader/writer）先落地，确认 schema 兼容。

**写入规则**：Gateway 写 `id` / `createdAt` / `origin.type` / `engine`；用户改 `displayName` / `description` / `tags`。如果 `agent.json` 已存在（CLI 先创建的），Gateway 做 merge 而非覆盖。

### G4 + G8 — 错误信息 path hint 更新（等 N12）

**内容**：`nano-adapter.ts` 和 `channels/app.ts` 里的错误提示 `nanopencil /login` → 改路径为 `~/.pencils/agents/<id>/`。

**阻塞**：N12（`CONFIG_DIR_NAME` 切到 `.pencils`），否则提示路径还没统一。

### G5 — 移除 `start-pencil.sh` env 兜底（等 N9）

**内容**：等 CLI 支持 `nanopencil --agent <id>` 直接 launch agent slot 后，删掉 shell 层的 env 包装。

**阻塞**：N9（`--agent` flag）

### G1 — `/v1/agents/adopt` 领养接口（等 N10 + Asgard）

**内容**：接收核心文档 §7.1 的 Pencil 包，落到 `agents/<templateId>/{soul, memory, settings}` 后注册 agent。

**阻塞**：
- nanoPencil N10（`agent.json` schema 稳定）
- Asgard 出包能力（`pencil_template` 表 + admin UI）
- `memorySeed` 落盘格式确认（核心文档 §15 问题 5）

### G6 — `/v1/workspaces` 接口（等 N13-N14）

**内容**：
- `POST /v1/workspaces` 创建 workspace（写 `manifest.json`）
- `AgentConfig` 增加 `workspaceId?: string`
- `buildSessionOptions` 把 workspace 信息传给引擎

**阻塞**：nanoPencil N13（WorkspaceManager）+ N14（`ws_id` 派生算法）

### G7 — `/v1/teams/<team_id>/dispatch`（等 N16-N18）

**内容**：Teams 重构后的 HTTP 协调入口。每个 teammate 是 Gateway 里的一个 AgentInstance，协作走 workspace 黑板。

**阻塞**：nanoPencil N16-N18（remote teammate + team-state 落 workspace + mailbox→黑板）

## 3. 执行顺序图

```
Now ──────────────────────────────────────────────────────────────►

  ✅ Step A（已落地）
     │
     ├─► G2 ID 校验（无阻塞）
     │
     │      nanoPencil Phase 1-3
     │      ┌────────────────────────┐
     │      │ N1-N8 基础设施+改造    │
     │      │ N9 --agent flag        │──► G5 移除 shell 兜底
     │      │ N10 agent.json         │──► G3 注册写 agent.json
     │      │ N11 pencils migrate    │
     │      │ N12 CONFIG_DIR_NAME    │──► G4/G8 path hint
     │      └────────────────────────┘
     │
     │      nanoPencil Phase 4
     │      ┌────────────────────────┐
     │      │ N13 WorkspaceManager   │
     │      │ N14 ws_id 派生         │──► G6 /v1/workspaces
     │      │ N15 sessions 双轴      │
     │      └────────────────────────┘
     │
     │      nanoPencil Phase 5
     │      ┌────────────────────────┐
     │      │ N16-N18 Teams 重构     │──► G7 /v1/teams dispatch
     │      │ N19 移除 legacy        │
     │      └────────────────────────┘
     │
     │      Asgard 出包
     │      ┌────────────────────────┐
     │      │ Pencil 包 schema       │──► G1 /v1/agents/adopt
     │      └────────────────────────┘
```

**关键路径**：Gateway 目前能做的只有 **G2**（ID 校验）。其余全部等 nanoPencil 对应 Phase 完成。

## 4. Gateway 代码变更涉及的文件

| 文件 | 任务 | 改动 |
|------|------|------|
| `src/agent/registry.ts` | G2, G3 | 加 ID 正则校验；register/update 时写 `agent.json` |
| `src/routes/agents.ts` | G3 | PUT endpoint 触发 `agent.json` merge |
| `src/config.ts` | G4 | 更新默认路径提示文本 |
| `src/engine/nano-adapter.ts` | G4, G8 | 错误信息路径更新 |
| `src/channels/app.ts` | G8 | 错误信息路径更新 |
| `src/routes/adopt.ts` (new) | G1 | 新增 adopt 接口 |
| `src/routes/workspaces.ts` (new) | G6 | 新增 workspace CRUD |
| `src/routes/teams.ts` (new) | G7 | 新增 team dispatch |

## 5. 关联

- **核心设计文档**：[`nanoPencil/docs/multi-agent-fs-design.md`](../../nanoPencil/docs/multi-agent-fs-design.md) — 唯一权威源
- **Step A PR**：commit `2ea04e9`（PENCILS_HOME 层 + agentDir 默认值）
- **issue 0012**：[`issues/0012-gateway-data-directory-alignment.md`](../issues/0012-gateway-data-directory-alignment.md)
- **Step B 评估归档**：[`docs/17-nanopencil-multi-agent-impact-eval.md`](./17-nanopencil-multi-agent-impact-eval.md)
