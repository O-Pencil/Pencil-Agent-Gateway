---
title: M7 — nano-pencil 真实 SDK 接入
status: active
scope: m7-implementation-tasks
owner: pencil-agent-gateway maintainers
created: 2026-04-26
updated: 2026-04-26
---

# M7 — nano-pencil 真实 SDK 接入

## DIP Metadata

```text
[WHO]  Gateway 开发者与 AI coding agent（可通过 /grub 执行）
[FROM] 01-development-plan.md M7 里程碑、03-adapter-architecture.md Adapter 架构契约
[TO]   可被独立部署的 Pencil Agent Gateway，支持真实 nano-pencil 引擎驱动
[HERE] M7 的具体实施任务清单：安装依赖、重写 Adapter、修复 chat.ts 路由、端到端验证
```

## 背景

当前 `NanoPencilEngineAdapter`（`src/engine/nano-adapter.ts`）是 Mock 实现，内部委托给 `MockEngineAdapter`。`chat.ts` 也绕过了 Registry 中 AgentInstance 绑定的 engine，直接使用了全局 mock。

M7 完成后，Gateway 将调用真实的 `@pencil-agent/nano-pencil` SDK，实现端到端的 Agent 引擎驱动。

## 开发计划对齐

来源：`01-development-plan.md` § M7 里程碑

| 计划任务 | 当前状态 |
|----------|----------|
| 添加 `@pencil-agent/nano-pencil` 依赖 | ❌ 未开始 |
| 封装 `NanoPencilEngineAdapter` | ❌ 仅为 Mock 壳 |
| 只在 adapter 层接触 nano-pencil SDK | ⚠️ 当前 `chat.ts` 绕过了 adapter |
| 将 AgentConfig 转为 nano-pencil run config | ❌ 未开始 |
| 将 nano-pencil text/done/error 事件转为 Gateway EngineEvent | ❌ 未开始 |
| stream 和 non-stream 都可用 | ❌ 未验证 |

## 任务清单

### 任务 1：安装 @pencil-agent/nano-pencil 依赖

**目标**：在 Gateway 中安装 nano-pencil SDK 作为生产依赖。

**验收**：
- `npm install @pencil-agent/nano-pencil` 成功。
- `package.json` 中 `dependencies` 包含 `@pencil-agent/nano-pencil`。
- TypeScript 编译无类型冲突。

**注意事项**：
- 源码仓库位于 `/Users/cl/Project/nano-pencil`，如果尚未发布 npm，可能需要通过 `file:` 或 `link:` 方式引用。
- 检查 nano-pencil 的 `package.json` `exports` 字段，确认正确的 import 路径。
- 留意 nano-pencil SDK 暴露的 API 是否稳定（v0.x 可能还在变化中）。

---

### 任务 2：重写 NanoPencilEngineAdapter 对接真实 SDK

**目标**：将 `src/engine/nano-adapter.ts` 从 Mock 壳改为真实 nano-pencil SDK 调用。

**文件**：`src/engine/nano-adapter.ts`

**实施步骤**：

1. **阅读 nano-pencil SDK API**：
   - 检查 `@pencil-agent/nano-pencil` 的导出接口
   - 确认 SDK 的对话发起方式（同步调用 vs 事件流）
   - 确认 SDK 接受的配置格式

2. **移除 Mock 依赖**：
   - 删除 `MockEngineAdapter` 的 `import` 和委托
   - 删除 `setResponse` 等 Mock 专用方法

3. **实现 `run` 方法**：
   - 将 `EngineRunRequest` 中的参数映射到 nano-pencil SDK 的调用参数
   - 处理 `agentId`、`sessionId`、`messages`、`systemPrompt`、`model`、`temperature`、`maxTokens`、`signal`
   - 将 `AgentConfig.model`（`provider` / `name` / `apiKey` / `baseUrl`）转为 nano-pencil 的模型配置

4. **事件映射**（流式路径）：
   - nano-pencil text 事件 → `EngineEvent { type: "text_delta"; text: string }`
   - nano-pencil turn complete 事件 → `EngineEvent { type: "done"; finishReason: "stop" | "length" | "cancelled" }`
   - nano-pencil error 事件 → `EngineEvent { type: "error"; error: Error }`

5. **非流式路径**：
   - 收集所有 `text_delta` 直到 `done`，返回完整文本
   - `EngineRunResult` 的 `text` 和 `finishReason` 来自事件累积

**验收**：
- `NanoPencilEngineAdapter` 不再依赖 `MockEngineAdapter`。
- `run` 方法返回 `AsyncIterable<EngineEvent>`。
- 适配器能正确映射 SDK 的事件到 Gateway 的 `EngineEvent` 类型。
- `createNanoPencilAdapter(config)` 接收真实的 `AgentConfig`。

**架构约束**（来自 `03-adapter-architecture.md`）：
- `src/engine/nano-adapter.ts` 是**唯一**可以 `import @pencil-agent/nano-pencil` 的文件。
- Gateway 的 route 层不得直接调用 nano-pencil SDK。
- SDK 版本兼容性封装在 Adapter 内部。

---

### 任务 3：修改 chat.ts 使用 AgentInstance 绑定的 engine

**目标**：修复 `src/routes/chat.ts` 中绕过 Adapter 的全局 mock 问题。

**文件**：`src/routes/chat.ts`

**当前问题**：
```typescript
// 当前代码：硬编码使用全局 mock
const engine = getMockEngine();
```

**修复后**：
```typescript
// 应该使用 instance 绑定的 engine
const engine = instance.engine;
```

**实施步骤**：

1. 删除 `getMockEngine()` 函数及 `MockEngineAdapter` 的 import。
2. 删除全局 `mockEngine` 变量。
3. `handleChatCompletion` 中从 `registry.getByModelId(request.model)` 获取 `instance` 后，使用 `instance.engine` 作为引擎。
4. 确认 `AgentInstance` 的 `engine` 字段类型与 `EngineAdapter` 接口一致。
5. 确认 `AgentRegistry.register()` 在创建实例时正确绑定了 `NanoPencilEngineAdapter`。
6. 确认非流式和流式两个路径都使用 `instance.engine`。

**验收**：
- `chat.ts` 中不再出现 `MockEngineAdapter` 或 `getMockEngine`。
- 所有请求通过 `AgentInstance.engine` 路由。
- 编译通过，类型检查无误。

---

### 任务 4：验证流式和非流式都能走通真实模型

**目标**：端到端验证 Gateway 通过真实 nano-pencil SDK 完成对话。

**验证步骤**：

1. **启动 Gateway**：
   ```bash
   npm run dev
   ```

2. **创建 Agent 实例**：
   ```bash
   curl -X POST http://localhost:8080/v1/agents \
     -H "Authorization: Bearer pk_dev_default" \
     -H "Content-Type: application/json" \
     -d '{
       "id": "test-assistant",
       "name": "Test Assistant",
       "model": {
         "provider": "anthropic",
         "name": "claude-sonnet-4-6",
         "apiKey": "${ANTHROPIC_API_KEY}"
       }
     }'
   ```

3. **验证非流式对话**：
   ```bash
   curl -X POST http://localhost:8080/v1/chat/completions \
     -H "Authorization: Bearer pk_dev_default" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "pencil/test-assistant",
       "messages": [{"role": "user", "content": "Say hello in 3 words"}]
     }'
   ```
   期望返回 `ChatCompletionResponse`，`choices[0].message.content` 有内容。

4. **验证流式对话**：
   ```bash
   curl -N -X POST http://localhost:8080/v1/chat/completions \
     -H "Authorization: Bearer pk_dev_default" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "pencil/test-assistant",
       "messages": [{"role": "user", "content": "Say hello in 3 words"}],
       "stream": true
     }'
   ```
   期望输出 SSE chunks，以 `data: [DONE]` 结尾。

5. **验证 OpenAI Node SDK**：
   ```typescript
   import OpenAI from "openai";
   const client = new OpenAI({
     apiKey: "pk_dev_default",
     baseURL: "http://localhost:8080/v1",
   });
   const response = await client.chat.completions.create({
     model: "pencil/test-assistant",
     messages: [{ role: "user", content: "Say hello" }],
   });
   console.log(response.choices[0].message.content);
   ```

6. **验证 session 记忆**：
   连续两次请求用同一个 `session_id`，第二次请求应能引用第一次的上下文。

**验收**：
- 步骤 1–6 全部通过。
- 流式响应可被 curl 和 OpenAI Node SDK 消费。
- 非流式响应返回完整 JSON。
- session 记忆在连续对话中生效。

---

## 实施顺序

```
任务 1（安装依赖）
  → 任务 2（重写 Adapter）
  → 任务 3（修复 chat.ts）
  → 任务 4（端到端验证）
```

每个任务完成后应确保 `npm run typecheck` 和 `npm test` 不失败（任务 4 之前可用 Mock Adapter 运行测试）。

## 回退策略

如果 nano-pencil SDK 当前 API 不稳定或尚不可用：
- 保留 `MockEngineAdapter` 作为 fallback。
- `NanoPencilEngineAdapter` 可保留 `initialize?` 钩子用于懒加载或失败降级。
- 在 `feature-list.json` 中标记对应任务为 `blocked` 而非 `failed`。
