---
title: Multi-Pencil DingTalk Integration
status: draft
scope: multi-pencil-channel-architecture
owner: pencil-agent-gateway maintainers
created: 2026-05-03
updated: 2026-05-03
---

# Multi-Pencil DingTalk Integration

## DIP Metadata

```text
[WHO]  Gateway maintainers and operators running multiple Pencil instances
[FROM] Existing channel docs (13-channel-integration.md), single-pencil startup scripts
[TO]   Multiple isolated PencilAgents + optional cross-pencil communication
[HERE] Architecture for memory isolation, multi-pencil startup, and inter-pencil messaging
```

---

## 1. 当前状态确认

### 1.1 记忆隔离 ✅ 已实现

基于 commit 93d087c 的 `start-pencil.sh`，每个 Pencil 实例使用独立的 `NANOPENCIL_CODING_AGENT_DIR`：

```
~/.pencils/pencil-01/   ← Pencil-01 专属
├── memory/             ← 独立记忆存储
├── soul/              ← 独立灵魂配置
├── auth.json          ← 独立认证
├── models.json        ← 独立模型配置
└── settings.json      ← 独立设置

~/.pencils/pencil-02/   ← Pencil-02 专属（待创建）
```

**防护机制**：`start-pencil.sh` 有路径校验，如果 `NANOPENCIL_CODING_AGENT_DIR` 指向 `pencils/` 目录会报错退出。

### 1.2 启动脚本已支持多实例

```bash
./scripts/start-pencil.sh pencil-01 --with-channels  # 启动 Gateway + Channel Server
./scripts/start-relay-dingtalk.sh pencil-01         # 启动钉钉 Stream Relay
```

---

## 2. 架构设计

### 2.1 整体拓扑

```
┌─────────────────────────────────────────────────────────────────┐
│                        Operator Local Machine                    │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │   pencil-01      │    │   pencil-02      │                   │
│  │  Gateway :18080  │    │  Gateway :28080  │                   │
│  │  Channel :18090  │    │  Channel :28090  │                   │
│  └────────┬─────────┘    └────────┬─────────┘                   │
│           │                       │                               │
│  ┌────────┴────────┐    ┌──────────┴────────┐                      │
│  │ DingTalk Relay │    │ DingTalk Relay │                      │
└──────────┼────────────────────┼──────────────────────────────────┘
           │ 钉钉 Robot A       │ 钉钉 Robot B
           ▼                    ▼
   ┌───────────────┐    ┌───────────────┐
   │  钉钉应用 A   │    │  钉钉应用 B   │
   └───────────────┘    └───────────────┘
```

### 2.2 端口规划

| 实例 | Gateway 端口 | Channel 端口 |
|------|-------------|-------------|
| pencil-01 | 18080 | 18090 |
| pencil-02 | 28080 | 28090 |
| pencil-03 | 38080 | 38090 |

---

## 3. 多机器人通信方案

有三种可行方案：

| 方案 | 复杂度 | 说明 |
|------|--------|------|
| **A. Gateway 内部路由** | 低 | Channel → Gateway → 其他 Gateway HTTP |
| **B. Channel 层消息路由** | 中 | `@pencil-02:` 路由指令 ⭐推荐 |
| **C. MCP 协议调用** | 高 | nano-pencil MCP 工具跨实例调用 |

### 3.1 方案 B 设计：@pencil-NAME: 路由

**语法**：`@pencil-02: 你好，能帮我查一下吗？`

**实现**：修改 `src/channels/app.ts` 增加 `parseInterPencilTarget()` 和跨实例 HTTP 转发。

### 3.2 配置扩展

```json
{
  "channels": {
    "interPencil": {
      "enabled": true,
      "allowAll": false,
      "allowedTargets": ["pencil-02", "pencil-03"]
    }
  }
}
```

---

## 4. 实施路线图

### 阶段 1：基础多实例 ✅ 已就绪

```bash
# 1. 复制配置
cp -r pencils/.example pencils/pencil-02

# 2. 修改 pencils/pencil-02/config.json（改端口）

# 3. 创建 pencils/pencil-02/.env.dingtalk

# 4. 启动
./scripts/start-pencil.sh pencil-02 --with-channels &
./scripts/start-relay-dingtalk.sh pencil-02 &
```

### 阶段 2：跨实例通信 📋 待实现

- [ ] `parseInterPencilTarget()` 函数
- [ ] 跨实例 HTTP 转发逻辑
- [ ] 配置项 `channels.interPencil`
- [ ] 单元测试

**预计工作量**：约 2-3 小时

---

## 5. 决策点

1. **只需多机器人独立工作** → 阶段 1 已够用
2. **需要跨实例通信** → 实现方案 B

---

*文档版本：v0.1 — 待实现阶段 2*
