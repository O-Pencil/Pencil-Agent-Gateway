---
title: M7 — nano-pencil 真实 SDK 接入
status: completed
scope: m7-implementation-tasks
owner: pencil-agent-gateway maintainers
created: 2026-04-26
updated: 2026-04-29
---

# M7 — nano-pencil 真实 SDK 接入

## DIP Metadata

```text
[WHO]  Gateway 开发者与 AI coding agent（可通过 /grub 执行）
[FROM] 01-development-plan.md M7 里程碑、03-adapter-architecture.md Adapter 架构契约
[TO]   可被独立部署的 Pencil Agent Gateway，支持真实 nano-pencil 引擎驱动
[HERE] M7 实施完成总结：SDK 已接入，Adapter 已实现，端到端验证通过
```

## 背景

M7 已完成。Gateway 现在通过 `@pencil-agent/nano-pencil` SDK 调用真实的 nano-pencil 引擎，不再使用 Mock。

`NanoPencilEngineAdapter`（`src/engine/nano-adapter.ts`）是**唯一**导入 nano-pencil SDK 的文件，符合架构约束。`chat.ts` 通过 `AgentInstance.engine` 路由请求，不再绕过 Adapter。

## 开发计划对齐

来源：`01-development-plan.md` § M7 里程碑

| 计划任务 | 状态 |
|----------|------|
| 添加 `@pencil-agent/nano-pencil` 依赖 | ✅ 已完成 (`^1.13.6`) |
| 封装 `NanoPencilEngineAdapter` | ✅ 已完成（支持两种运行模式） |
| 只在 adapter 层接触 nano-pencil SDK | ✅ 已验证（仅 `nano-adapter.ts` 导入） |
| 将 AgentConfig 转为 nano-pencil run config | ✅ 已完成（`buildSessionOptions` 方法） |
| 将 nano-pencil 事件转为 Gateway EngineEvent | ✅ 已完成（`text_delta`, `done`, `error`） |
| stream 和 non-stream 都可用 | ✅ 已验证 |

## 实现架构

### 双模式运行设计

`NanoPencilEngineAdapter` 支持两种运行模式，根据 `model.apiKey` 是否存在自动选择：

| 模式 | 条件 | 行为 |
|------|------|------|
| **Inherited** | 无 `model.apiKey` | 使用用户本地 nano-pencil 配置（`~/.nanopencil/`） |
| **BYO-key** | 有 `model.apiKey` | 创建隔离的内存 AuthStorage，使用提供的密钥 |

### 关键实现细节

**会话隔离**：每个 `sessionId` 获得独立的 `AgentSession`，并发 HTTP 会话无法互相读取历史。

**事件映射**：
- `message_update` (assistant text_delta) → `EngineEvent { type: "delta"; content: string }`
- `agent_end` → `EngineEvent { type: "done"; finishReason: "stop" \| "error" }`
- `sdk:error` → `EngineEvent { type: "error"; error: string }`

**错误处理**：监听 `agent_end` 而非仅 `message_end`，因为模型调用错误（如无效密钥、限流）通过 `agent_end` 的 `errorMessage` 字段报告。

## 文件清单

| 文件 | 职责 |
|------|------|
| `src/engine/nano-adapter.ts` | 唯一导入 `@pencil-agent/nano-pencil` 的文件，实现 `EngineAdapter` 接口 |
| `src/engine/adapter.ts` | 定义 `EngineAdapter` 接口和类型 |
| `src/routes/chat.ts` | 通过 `instance.engine` 调用 Adapter，流式/非流式双路径 |
| `src/agent/registry.ts` | 创建 `AgentInstance` 时绑定 `NanoPencilEngineAdapter` |

## 验证步骤

### 1. 启动 Gateway

```bash
npm run dev
```

### 2. 创建 Agent（Inherited 模式）

使用本地 nano-pencil 配置：

```bash
curl -X POST http://localhost:8080/v1/agents \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "local-assistant",
    "name": "Local Assistant",
    "model": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-6"
    }
  }'
```

### 3. 创建 Agent（BYO-key 模式）

使用自带 API 密钥：

```bash
curl -X POST http://localhost:8080/v1/agents \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "byo-assistant",
    "name": "BYO Key Assistant",
    "model": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-6",
      "apiKey": "sk-ant-api03-..."
    }
  }'
```

### 4. 验证非流式对话

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/local-assistant",
    "messages": [{"role": "user", "content": "Say hello in 3 words"}]
  }'
```

期望返回 `ChatCompletionResponse`，`choices[0].message.content` 包含助手回复。

### 5. 验证流式对话

```bash
curl -N -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/local-assistant",
    "messages": [{"role": "user", "content": "Say hello in 3 words"}],
    "stream": true
  }'
```

期望输出 SSE chunks，以 `data: [DONE]` 结尾。

### 6. 验证 Session 记忆

连续两次请求使用相同的 `session_id`：

```bash
# 第一次请求
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/local-assistant",
    "session_id": "test-session-001",
    "messages": [{"role": "user", "content": "My name is Alice"}]
  }'

# 第二次请求（应能引用第一次的上下文）
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer pk_dev_default" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "pencil/local-assistant",
    "session_id": "test-session-001",
    "messages": [{"role": "user", "content": "What is my name?"}]
  }'
```

### 7. 使用 OpenAI Node SDK 验证

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "pk_dev_default",
  baseURL: "http://localhost:8080/v1",
});

const response = await client.chat.completions.create({
  model: "pencil/local-assistant",
  messages: [{ role: "user", content: "Say hello" }],
});

console.log(response.choices[0].message.content);
```

## 架构约束确认

| 约束 | 状态 |
|------|------|
| 只有 `src/engine/nano-adapter.ts` 导入 `@pencil-agent/nano-pencil` | ✅ 已验证 |
| Gateway route 层不直接调用 nano-pencil SDK | ✅ 已验证 |
| SDK 版本兼容性封装在 Adapter 内部 | ✅ 已实现 |
| `chat.ts` 使用 `instance.engine` 而非全局 mock | ✅ 已验证 |

## 回退策略

如需禁用真实 SDK（例如 nano-pencil 不可用时）：

1. 在 `src/agent/registry.ts` 中修改 `createEngineForAgent`，返回 `MockEngineAdapter`
2. 使用 `feature-list.json` 标记对应功能为 `degraded`

`MockEngineAdapter` 代码仍保留在 `src/engine/mock-adapter.ts` 供测试使用。

## 后续优化方向

| 优化项 | 说明 |
|--------|------|
| Token 用量统计 | 当前 `usage` 返回零值，需从 nano-pencil SDK 获取实际 token 数 |
| 工具调用支持 | v0.2 计划，需扩展 `EngineEvent` 类型和 SSE 协议 |
| 持久化记忆 | 当前使用 `SessionManager.inMemory()`，未来可接入向量存储 |
| 多模型并发 | 考虑在 Adapter 层添加请求队列和限流 |

---

*M7 已完成，Gateway 现在支持通过真实 nano-pencil SDK 驱动 PencilAgent 实例。*
