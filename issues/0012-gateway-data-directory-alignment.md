# 0012 - Gateway 数据存储位置与系统目录对齐

## 状态

- **创建日期**: 2026-05-03
- **优先级**: 高
- **标签**: architecture, data-storage, cloud-deployment

---

## 问题描述

### 1. 当前问题

Gateway 的数据存储在项目目录内 (`./data/`)，与 nano-pencil CLI 的系统目录 (`~/.pencils/`) 不对齐。

**当前结构**:
```
Pencil-Agent-Gateway/
├── config/default.json
└── data/                    # ⚠️ 问题：放项目内
    └── agents/
        └── <agent-id>.json
```

**期望结构** (与 nano-pencil 共用系统目录):
```
~/.pencils/
├── pencil-01/               # Agent 1 (nano-pencil CLI 管理)
│   ├── soul/
│   ├── memory/
│   └── sessions/
└── gateway/                 # Gateway 元数据
    └── instances/
```

### 2. 用户反馈

用户提到：
- nano-pencil CLI 的数据都在 `~/.nanopencil/` 或 `~/.pencils/` 下
- 之前创建的钉钉 Agent 在 `C:\Users\PC\.pencils\pencil-01\`
- Gateway 的数据不应该跟随项目目录，应该跟系统走

### 3. 云端部署需求

Gateway 后续需要支持云端部署：
- **本地存储**: 记忆、会话（隐私数据）
- **云端存储**: 灵魂/人设（可下发）

---

## 背景分析

### nano-pencil 数据结构

```
~/.pencils/<agent-id>/
├── .PENCIL.md              # Agent 配置
├── soul/                   # 灵魂/人设
│   ├── profile.json
│   ├── memory.json
│   └── evolutions.json
├── memory/                 # 语义记忆
├── sessions/               # 会话历史
└── settings.json
```

### Gateway 已有设计

1. **配置加载** (`src/config.ts`):
   - `dataDir` 从配置文件或 `DATA_DIR` 环境变量读取
   - 默认 `./data`
   - 支持 env interpolation

2. **Agent 注册** (`src/agent/registry.ts`):
   - `AgentRegistry` 构造函数接收 `dataDir`
   - Agent 配置保存到 `{dataDir}/agents/<id>.json`

3. **Session 存储** (`src/store/session.ts`):
   - 短期会话存在 `{dataDir}/sessions/`

---

## 需要决策的问题

### 问题 1: Agent 数据归属

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A**: Gateway 作为代理层 | Agent 数据在 `~/.pencils/<id>/`，Gateway 只做路由 | 数据天然隔离，nano-pencil CLI 可直接管理 | 需要 Gateway 理解 nano-pencil 数据格式 |
| **B**: Gateway 独立数据目录 | `~/.pencils/gateway/` 下管理所有 Agent | 完全独立，不耦合 | 需要维护两套数据体系 |

### 问题 2: 创建 Agent 的方式

| 方案 | 描述 |
|------|------|
| **HTTP API** | 通过 `POST /v1/agents` 创建（当前设计） |
| **CLI 驱动** | 通过 nano-pencil CLI 创建，Gateway 作为代理 |

### 问题 3: 云端/本地数据边界

| 数据类型 | 存储位置 | 同步策略 |
|----------|---------|---------|
| Soul/Profile | 云端 + 本地 | 可从云端下发，本地缓存 |
| Memory | 本地 | 私有，不上传 |
| Sessions | 本地 | 私有，可加密 |
| Gateway Sessions | 本地 | 短期记忆，可定期清理 |

---

## 可能的实现方案

### 方案 A: 与 nano-pencil 共用目录

```
~/.pencils/
├── pencil-01/              # nano-pencil CLI 创建
│   ├── soul/
│   ├── memory/
│   └── sessions/
└── gateway/                # Gateway 元数据（轻量）
    ├── config.json         # API Keys、端口等
    └── instances/          # 软链接或配置指向
        └── writing-assistant -> ../pencil-01
```

**启动时**:
```bash
DATA_DIR=~/.pencils/gateway npm run dev
```

**创建 Agent**:
1. Gateway 调用 nano-pencil CLI 创建 `~/.pencils/<id>/`
2. 或 Gateway 自身创建目录，模拟 nano-pencil 结构

### 方案 B: 独立 gateway 子目录

```
~/.pencils/
├── pencil-01/
├── pencil-02/
└── gateway/                 # Gateway 自己的数据
    ├── config.json          # API Keys、端口
    ├── agents/              # Agent 配置
    │   └── <id>.json
    ├── sessions/            # Gateway 短期会话
    └── cache/
```

---

## 相关文件

- `src/config.ts` - 配置加载
- `src/agent/registry.ts` - Agent 注册与持久化
- `src/store/session.ts` - Session 存储
- `src/engine/nano-adapter.ts` - nano-pencil 引擎适配

---

## 待确认

1. [ ] Agent 数据归属：方案 A 还是方案 B？
2. [ ] 创建 Agent 方式：HTTP API 还是 CLI 驱动？
3. [ ] 云端下发 Soul 的优先级：高/中/低
4. [ ] 当前是否需要先让 editor-gateway 跑通最小链路（暂时用项目内 data 目录）？

---

## 关联文档

- `docs/15-editor-gateway-minimal-integration.md` - Editor-Gateway 最小集成
- `docs/10-editor-integration-guide.md` - Asgard 版方案（已废弃）
- `nanopencil-editor/docs/technical-proposals/pencil-platform-roadmap.md` - Pencil 生态演进路线