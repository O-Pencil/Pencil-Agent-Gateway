---
title: Asgard-web ↔ PencilAgent UI 接入指南
status: active
scope: integration-guide-asgard-web
owner: pencil-agent-gateway maintainers
created: 2026-04-29
updated: 2026-04-29
---

# Asgard-web ↔ PencilAgent UI 接入指南

## DIP Metadata

```text
[WHO]  Asgard-web 前端开发者（React 19 + Vite + Tailwind）
[FROM] 用户在 Asgard 网页里点点点：浏览 Agent / 创建 PencilAgent / 在平台上聊天
[TO]   Asgard-api 的 /api/* 路由（不是 Gateway 直连——Gateway 永远只在内部网络）
[HERE] PencilAgent 类型 Agent 的 UI 信息架构、4 个核心页面、SSE 消费、错误处理
```

> 后端契约见 [09-asgard-integration-guide.md](./09-asgard-integration-guide.md)。前端**不直连 Gateway**——所有 PencilAgent 调用都走 Asgard-api 反代，前端只看 `/api/*`。

---

## 1. 信息架构

```text
登录 ─┬─→ Console（用户首页 / 概览）
      │
      ├─→ Agent Market    （只读，所有 Agent 模板和别人公开的 Agent）
      │   └─→ "Use this template" → 跳到创建页
      │
      ├─→ My Agents       （我创建的 PencilAgent 列表）
      │   ├─→ Create new          → 创建/编辑表单
      │   ├─→ Edit Soul/Memory    → 同上一个表单
      │   └─→ Open conversation   → 对话窗
      │
      ├─→ Conversations   （我的对话列表，按时间倒序）
      │   └─→ 选中一段 → 对话窗
      │
      └─→ Settings
          └─→ API Keys    （生成 / 列表 / 撤销，给 editor 用）
```

当前仓库已有 `pages/AgentMarket.jsx`、`pages/Console.jsx`、`pages/PencilAgentLab.jsx`。建议把 PencilAgent 相关功能集中到 `PencilAgentLab` 改名 `MyAgents` 或拆成单独路由，再加 `Conversations` 和 `Settings/ApiKeys` 两个新页。

---

## 2. 四个核心页面

### 2.1 My Agents（PencilAgent 列表）

数据源：`GET /api/pencil/agents`

**展示字段**：
- name（用户取的名字）
- soulPreview（systemPrompt 的前 60 字截断）
- model（"anthropic / claude-sonnet-4-6" 这种二段式）
- updatedAt（相对时间："2 天前更新"）
- 状态徽标：`syncing` | `ready` | `error`（来自 Asgard DB）

**操作**：
- 主按钮：Create PencilAgent → 跳 §2.2
- 卡片操作：Edit / Open chat / Delete（带确认）

**空状态**：第一次用的用户引导 "从模板创建" 或 "从零开始"，引到 Agent Market 或 §2.2。

### 2.2 Create / Edit PencilAgent 表单

**字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| name | text | ✅ | 用户友好名字，可改 |
| soul.systemPrompt | textarea (8 行+) | ✅ | Agent 的"灵魂"——Asgard 的卖点。占满主区域，给 placeholder 示例 |
| soul.styleTags | tag input | – | 可选；逗号分隔，存 `string[]` |
| memory.maxTurns | number | – | 默认 30；范围 5-100 |
| model.provider | select | – | `anthropic` / `openai` / `google`；默认空 = 沿用 Gateway 默认 |
| model.name | select（依赖 provider） | – | 依 provider 给可选项；空 = 沿用默认 |

**保存语义**（很重要）：

```text
Create  → POST /api/pencil/agents       （Asgard 调 Gateway POST /v1/agents）
Edit    → PUT  /api/pencil/agents/:id   （Asgard 调 Gateway PUT /v1/agents/:id）
```

**Edit 流程必须显示提示**：

> ⚠️ 修改 Soul 后，**新建对话**才会用上新 Soul；正在进行中的对话仍是旧人格。
> 想立刻全部生效？打开一段老对话点"新建对话"按钮。

依据见 [09 §15.3](./09-asgard-integration-guide.md)。这个提示很关键——用户改 Soul 看不到效果会以为坏了。

### 2.3 Conversations 列表

数据源：`GET /api/pencil/conversations?agent_id=&page=`（Asgard 自己的 conversations 表，见 [09 §15.1](./09-asgard-integration-guide.md)）

**列表项**：
- title（首条用户消息前 30 字截断；空就显示"新对话"）
- agent name（这段对话挂在哪个 Agent 上）
- last_message_at（相对时间）
- message_count

**操作**：进入 → §2.4；删除（仅删 Asgard DB row，Gateway sessions 让它自然蒸发）。

### 2.4 Chat 对话窗

布局：
```
┌─────────────────────────────────────┐
│ Header: agent name + 新建对话按钮      │
├─────────────────────────────────────┤
│                                     │
│  消息流（自动滚到底）                  │
│  ─ user (右对齐)                     │
│  ─ assistant (左对齐，markdown 渲染)  │
│  ─ 流式中: 末尾 │ 光标动画            │
│                                     │
├─────────────────────────────────────┤
│ Input: [textarea]   [Stop] [Send]   │
└─────────────────────────────────────┘
```

**核心交互**：

1. **Send 按钮**：禁用条件 = 输入为空 或 正在流式接收。
2. **Stop 按钮**：流式中显示，点了 abort 当前 fetch（见 §3.2）。
3. **新建对话按钮**：生成新 `session_id`（前端 `crypto.randomUUID()` 即可），开新空对话。**不调 Gateway**。
4. **失败重试**：上一条 assistant 出错时，下方显示一个 "重试" 链接，重发同样的 messages。

**消息状态机**（前端单条 message 上挂的字段）：

```ts
type MessageState =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; status: 'streaming'; content: string }
  | { kind: 'assistant'; status: 'done'; content: string }
  | { kind: 'assistant'; status: 'error'; error: string };
```

### 2.5 API Keys 管理

只为给 editor / 三方 OpenAI client 用准备的 user-key（不是 Gateway internal-key）。

**字段**：label（用户备注），prefix（脱敏显示如 `sk_user_xxxxx****`），createdAt，lastUsedAt。

**操作**：Generate（**只在生成那一刻显示完整 key 一次**，复制按钮，关掉就再也看不到），Revoke。

---

## 3. SSE 消费（关键技术点）

Asgard-api 把 Gateway 的 SSE 透传给前端，所以前端就是普通的 OpenAI SSE 消费。

### 3.1 fetch + ReadableStream

```ts
async function streamChat({
  agentId,
  sessionId,
  messages,
  onDelta,
  onDone,
  onError,
  signal,
}: {
  agentId: string;
  sessionId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
  signal: AbortSignal;
}) {
  const res = await fetch('/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: `pencil/${agentId}`,
      messages,
      session_id: sessionId,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    onError(err?.error?.message || `HTTP ${res.status}`);
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 按 SSE 协议逐行处理
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handleBlock(block, onDelta, onDone);
    }
  }
}

function handleBlock(
  block: string,
  onDelta: (s: string) => void,
  onDone: () => void,
) {
  for (const line of block.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') {
      onDone();
      return;
    }
    try {
      const chunk = JSON.parse(data);
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') onDelta(delta);
    } catch {
      // 忽略坏行
    }
  }
}
```

### 3.2 AbortController 取消

```tsx
function useSendMessage() {
  const controllerRef = useRef<AbortController | null>(null);

  const send = async (text: string) => {
    controllerRef.current?.abort();           // 防御重复 send
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await streamChat({ ..., signal: controller.signal });
    } catch (err) {
      if (err.name !== 'AbortError') onError(err);
    }
  };

  const cancel = () => controllerRef.current?.abort();

  return { send, cancel };
}
```

> ⚠️ v0.1 Gateway 的 abort 还**没有**真正中断模型调用（issue 排在 v0.1.1）。前端 abort 后用户立刻看不到 token，但 cloud provider 那边可能还在跑——这只影响计费精度，不影响 UI。

### 3.3 别用 `EventSource`

`EventSource` 只支持 GET，且不能传 Authorization header。**强制用 fetch + ReadableStream**。

---

## 4. 状态管理建议

仓库当前没有引入 react-query / zustand / redux。给两个低侵入方案：

**方案 A — 最小代价**：用 React 19 的 `use(promise)` + 本地 `useState` + 自己的 `useStream` hook。适合早期。

**方案 B — 推荐方案**：引入 `@tanstack/react-query` 处理 Agent 列表 / Conversations 这种"服务器状态"，对话窗内部状态用 `useState` / `useReducer`。

**不要**：
- ❌ 把对话流式 chunk 推到全局 store —— 会在 throttle/不可中断的渲染下卡顿
- ❌ 在每条 delta 触发整树 re-render —— 用 ref + forceUpdate 或者 useSyncExternalStore，至少把流式更新限制在 Message 子组件里

---

## 5. 错误展示

参考 [09 §15.6](./09-asgard-integration-guide.md) 的映射表。前端不要直接渲染 `error.message`，用一个映射函数：

```ts
const FRIENDLY: Record<string, string> = {
  agent_not_found:   '这个 Agent 不存在或已被删除，请刷新列表',
  forbidden_agent:   '你没有权限使用这个 Agent',
  client_cancelled: '',                                  // 静默
  engine_error:     'Agent 暂时无法响应，请稍后再试',
  unauthorized:     '登录已过期，请重新登录',
};

export function userFacing(err: { code?: string; message?: string }) {
  if (!err) return '未知错误';
  return FRIENDLY[err.code || ''] ?? '出了点问题，请稍后再试';
}
```

特别地：
- **5xx 全部展示模糊文案**——详细原因属于运维信息，不要给终端用户看。
- **streaming 中途断开**：把已收到的部分留在消息里 + 末尾加 `[连接中断，点击重试]`。

---

## 6. 端点映射（对前端可见的全部）

后端契约见 09，前端需要的就这些（都是 Asgard-api 的，**不**是 Gateway 直接）：

```text
# Auth
POST   /api/auth/login
POST   /api/auth/logout

# 用户 user-key
GET    /api/keys
POST   /api/keys                    {label} → {key, prefix}
DELETE /api/keys/:id

# Agent CRUD
GET    /api/pencil/agents           → list
POST   /api/pencil/agents           {name, soul, memory, model}
GET    /api/pencil/agents/:id       → detail
PUT    /api/pencil/agents/:id       同 POST 的 body
DELETE /api/pencil/agents/:id

# Agent 模板（Market）
GET    /api/pencil/templates

# 对话历史
GET    /api/pencil/conversations?agent_id=&page=
POST   /api/pencil/conversations    {agent_id, title?} → {id (= session_id)}
DELETE /api/pencil/conversations/:id

# 对话流（透传 Gateway，OpenAI 兼容）
POST   /api/v1/chat/completions     OpenAI 兼容；带 model = "pencil/<agent_id>" 和 session_id
```

注意 `/api/v1/chat/completions` 路径里有 `v1`（OpenAI SDK 兼容），其他都是 `/api/pencil/*`（Asgard 专属）。Asgard 后端可以把它们都挂在同一个 FastAPI 上。

---

## 7. 实施清单（前端）

```text
□ 路由：/agents, /agents/:id/edit, /conversations, /conversations/:id, /settings/keys
□ 把 PencilAgentLab.jsx 拆成 AgentList + AgentForm 两个页面（或保留 Lab 作壳，里面用 sub-route）
□ 创建/编辑表单：systemPrompt textarea、styleTags 输入、provider/model 联动 select
□ 编辑页"修改 Soul 后需新建对话才会生效"提示
□ Chat 页：消息流 + Markdown 渲染 + 流式光标 + Stop 按钮
□ useStreamChat hook：fetch + ReadableStream + AbortController
□ Conversations 列表与新建对话按钮（生成 UUID v4 作 session_id）
□ user-key 管理页：生成时一次性显示全 key 并附复制按钮
□ 错误映射函数 + 5xx 模糊文案
□ Empty / Loading / Error 三态都画到位（尤其 Empty 引导用户用模板）
□ E2E：登录 → 新建 Agent → 发消息收到流式回复 → 改 Soul → 新对话生效
```

---

## 8. 可以晚点做的

| 功能 | 推荐版本 | 原因 |
|---|---|---|
| Markdown 高亮 / 代码块复制 | v0.1.1 | 锦上添花，不影响 MVP |
| 消息编辑 / 重新生成 | v0.1.1 | 需要 Asgard 改 conversations schema |
| 多模态（图片附件） | v0.2 | Gateway 还没接 image content |
| 工具调用可视化 | v0.2 | Gateway tool callback 协议未上线 |
| Agent 公开分享到 Market | v0.2 | 需要审核 / 内容安全 |
| Token 用量 / 计费看板 | 等 Gateway usage 落地 | 当前 Gateway 返 0 token |
