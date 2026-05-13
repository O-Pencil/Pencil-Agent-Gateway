---
title: Gateway 侧行动手册（多 Agent 存储）
status: active
scope: gateway-multi-agent-action-plan
owner: pencil-agent-gateway maintainers
created: 2026-05-04
updated: 2026-05-13
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
| **G2** — Agent ID 校验（`^[a-z0-9][a-z0-9._-]{0,63}$`）：`AgentRegistry.register()` + `loadConfig()` 启动期 fail-fast | `1df2380` | ✅ |
| **G3** — `register()` / `update()` 写 `<agentDir>/agent.json`（doc 16 §11.2.1 schema）；`createdAt` 在已有文件存在时保留 | `1df2380` | ✅ |
| **P0.5** — Soul 不被 `cwd` 污染：nano-adapter 把 `cwd` 钉到 `agentDir`，并显式 `await loader.reload()` 绕过 SDK 不自动 reload 外部 ResourceLoader 的限制 | `48fe4ea` | ✅ |
| **P1** — `AgentConfig` 加 `kind` / `parentTemplateId` / `origin`；`writeAgentMetadata` 改用 `config.kind ?? 'custom'` 与 `config.origin ?? {type:'local'}`（不再硬编码） | 待提交 | ✅ |

## 2. 待落地任务

> 任务 ID 前缀 `G` = Gateway 侧任务；`N` = nanoPencil 侧任务（阻塞 Gateway）；`P` = SuperAgent / Derived / Custom 路线（核心文档 §10.4）。

### P2 — 派生端点 `POST /api/v1/agents/pencil/<super_id>/derive`（无阻塞）

**内容**：Asgard 复制 super 的 soul template + memory seed → 新 agent 记录（`kind=derived`, `parent_template_id=<super_id>`, `soul_policy=overridable`）；前端"市场"页加"派生我的副本"按钮。Gateway 端无新代码——P1 已让 `AgentConfig.kind/parentTemplateId/origin` 透传到 `agent.json`，派生只是 Asgard 端 ORM 复制 + 调 P1 已有的 `POST /v1/agents` 体。

**参考**：核心文档 §7.5.5、§10.4 P2

### P3 — Gateway 端 soul policy 强制（依赖 nanoPencil soul 持久化）

**内容**：`nano-adapter` / agent metadata 读 `agent.json.kind`（或单独的 `soulPolicy` 字段），`kind=super` 或 `soulPolicy=immutable` 时禁写 `soul/profile.json` 与 `memory/seed/`，破坏性写入返回 403。

**阻塞**：当前 Gateway 用 in-memory SessionManager，soul/memory 子目录还没落盘——等 nanoPencil 真正写 `soul/` 后再加策略层。

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
  ✅ G2 ID 校验 + G3 agent.json 落地（commit 1df2380）
  ✅ P0.5 Soul 防 cwd 污染（commit 48fe4ea）
  ✅ P1 三态分类透传（kind / parentTemplateId / origin）
     │
     ├─► P2 Asgard 派生端点（无阻塞，Gateway 端无新代码）
     │
     │      nanoPencil Phase 1-3（剩余）
     │      ┌────────────────────────┐
     │      │ N9 --agent flag        │──► G5 移除 shell 兜底
     │      │ N11 pencils migrate    │
     │      │ N12 CONFIG_DIR_NAME    │──► G4/G8 path hint
     │      └────────────────────────┘
     │
     │      nanoPencil soul 持久化
     │      ┌────────────────────────┐
     │      │ soul/ 子目录落盘       │──► P3 soul policy 强制
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

**关键路径**：Gateway 等 nanoPencil 把 `soul/` 真正落盘后才能加 P3 策略层；P2 派生纯 Asgard 侧动作。

## 4. Gateway 代码变更涉及的文件

| 文件 | 任务 | 改动 |
|------|------|------|
| `src/agent/registry.ts` | G2, G3, P1 | ID 正则校验；register/update 时写 `agent.json`；`writeAgentMetadata` 用 `config.kind / origin / parentTemplateId`（不再硬编码） |
| `src/config.ts` | P1, G4 | `AgentConfig` 加 `kind / parentTemplateId / origin`；导出 `AgentKind` / `AgentOriginMetadata` 类型；更新默认路径提示文本 |
| `src/engine/nano-adapter.ts` | P0.5, G4, G8 | `cwd` 钉到 `agentDir` + `await loader.reload()`；错误信息路径更新 |
| `src/app.ts` | （现有） | POST/PUT `/v1/agents` 已经直通 `body` 给 registry，P1 字段自动透传 |
| `src/channels/app.ts` | G8 | 错误信息路径更新 |
| `src/routes/adopt.ts` (new) | G1 | 新增 adopt 接口 |
| `src/routes/workspaces.ts` (new) | G6 | 新增 workspace CRUD |
| `src/routes/teams.ts` (new) | G7 | 新增 team dispatch |

## 5. 关联

- **核心设计文档**：[`nanoPencil/docs/multi-agent-fs-design.md`](../../nanoPencil/docs/multi-agent-fs-design.md) — 唯一权威源
- **Step A PR**：commit `2ea04e9`（PENCILS_HOME 层 + agentDir 默认值）
- **issue 0012**：[`issues/0012-gateway-data-directory-alignment.md`](../issues/0012-gateway-data-directory-alignment.md)
- **Step B 评估归档**：[`docs/17-nanopencil-multi-agent-impact-eval.md`](./17-nanopencil-multi-agent-impact-eval.md)
