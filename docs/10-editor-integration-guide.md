---
title: editor ↔ Gateway/Asgard 集成指南
status: active
scope: integration-guide-editor
owner: pencil-agent-gateway maintainers
created: 2026-04-28
updated: 2026-04-28
---

# editor ↔ Gateway/Asgard 集成指南

## DIP Metadata

```text
[WHO]  nanopencil-editor 前端开发者（HttpChatProvider 的实现者）
[FROM] editor 用户在设置面板配置 "remote-http" 服务模式
[TO]   Asgard backend → Pencil Agent Gateway（OpenAI 兼容 SSE）
[HERE] /docs/10 — editor 怎么写 HttpChatProvider；和 WebSocketChatProvider 形状一致、底层换 OpenAI HTTP
```

## 1. 你要做什么

editor 现有两条 chat 路径：

```
local-acp     → TauriChatProvider     (本地 nanopencil CLI)
service       → WebSocketChatProvider (PCP / @aspect/pencil-client-sdk)
```

加第三条：

```
remote-http   → HttpChatProvider     (OpenAI SSE → Asgard → Gateway)
```

只走文本，不走本地工具回调（v0.1 范围内）。

**你看到的对端永远是 Asgard**，不是 Gateway。Gateway 在 Asgard 后面。配置面板里只有 Asgard 的 baseUrl + Asgard 颁的 user-key。

## 2. HttpChatProvider 设计

文件位置：

- 主实现：`src/frontend/src/infrastructure/api/chat/HttpChatProvider.ts`
- 若当前产品入口使用 `src/web-ui` 镜像 API，则同步到 `src/web-ui/src/infrastructure/api/chat/HttpChatProvider.ts`

形状仿 `WebSocketChatProvider`，实现同一个 `ChatProvider` 接口，事件类型 `CLIEvent` 不变。

### 2.1 配置

```ts
export interface HttpChatProviderConfig {
  baseUrl: string;       // e.g. "https://asgard.example.com"
  apiKey: string;        // Asgard user-key（Bearer ...）
  agentId: string;       // e.g. "asgard-u_42-tpl_writer"
  // 可选：
  timeoutMs?: number;    // 默认 120_000 —— 单轮回答超时
  fetchImpl?: typeof fetch;
}
```

`agentId` 在 Asgard 创建 PencilAgent 后从 Asgard UI / API 拿到。`pencil/` 前缀**由 HttpChatProvider 内部加**，用户不该手填。

### 2.2 接口骨架

```ts
import type {
  ChatProvider, ChatProviderInfo, CLIEvent,
  CLIProviderRegistration, CreateSessionOptions,
} from './ChatProvider';

export class HttpChatProvider implements ChatProvider {
  private cfg: HttpChatProviderConfig;
  private listeners = new Set<(e: CLIEvent) => void>();
  private currentAbort?: AbortController;

  constructor(cfg: HttpChatProviderConfig) { this.cfg = cfg; }

  async listProviders(): Promise<ChatProviderInfo[]> {
    // OpenAI: GET /v1/models —— 透传 Bearer
    const res = await fetch(`${this.cfg.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`models list failed: ${res.status}`);
    const json = await res.json();
    return (json.data || []).map((m: any) => ({
      id: m.id,
      name: m.id,
      providerType: 'external',
      status: 'ready',
    }));
  }

  async registerProvider(_input: CLIProviderRegistration): Promise<boolean> {
    // remote-http 不走 client 端注册流程
    return false;
  }

  async unregisterProvider(_providerId: string): Promise<boolean> {
    // remote-http 没有 client 端 provider registry
    return false;
  }

  async createSession(opts: CreateSessionOptions): Promise<{ sessionId: string }> {
    // session 是 editor 决定的（建议 hash(workspaceId + docId)），
    // HttpChatProvider 不需要持久化创建过程，直接返回稳定 id
    return { sessionId: stableSessionIdFrom(opts) };
  }

  onEvent(cb: (e: CLIEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async sendMessage(sessionId: string, text: string): Promise<{ turnId: string }> {
    this.cancel(); // 上一轮没结束就先停
    const ctl = new AbortController();
    this.currentAbort = ctl;
    const turnId = crypto.randomUUID();
    const roundId = crypto.randomUUID();

    const res = await fetch(`${this.cfg.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: `pencil/${this.cfg.agentId}`,
        messages: [{ role: 'user', content: text }],
        stream: true,
        session_id: sessionId,
      }),
      signal: ctl.signal,
    });

    if (!res.ok) {
      this.emit({ type: 'error', sessionId, message: await mapHttpError(res) });
      return { turnId };
    }

    await this.consumeSSE(res, sessionId, turnId, roundId);
    return { turnId };
  }

  async confirmTool(): Promise<void> {
    // remote-http v0.1 不支持本地工具回调。
  }

  async cancelTurn(_sessionId: string, _turnId: string): Promise<void> {
    this.cancel();
  }

  async setSessionMode(): Promise<void> {}
  async updateConfig(): Promise<void> {}

  async closeSession(_sessionId: string): Promise<void> {
    this.cancel();
  }

  private cancel(): void {
    this.currentAbort?.abort();
    this.currentAbort = undefined;
  }

  private emit(e: CLIEvent) {
    for (const l of this.listeners) l(e);
  }

  private async consumeSSE(res: Response, sessionId: string, turnId: string, roundId: string) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE chunks 以 "\n\n" 分隔；只处理完整 chunk
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleSseBlock(block, sessionId, turnId, roundId);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.emit({ type: 'error', sessionId, message: err.message });
      }
      // AbortError 是用户主动取消，不报错
    }
  }

  private handleSseBlock(block: string, sessionId: string, turnId: string, roundId: string) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') {
        this.emit({ type: 'turn_complete', sessionId, turnId, success: true });
        return;
      }
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        const finish = chunk.choices?.[0]?.finish_reason;
        if (delta) this.emit({ type: 'text_chunk', sessionId, turnId, roundId, text: delta });
        if (finish) this.emit({ type: 'turn_complete', sessionId, turnId, success: finish !== 'error' });
      } catch {
        // 容错：损坏的行直接跳过
      }
    }
  }
}

function stableSessionIdFrom(opts: CreateSessionOptions): string {
  const raw = `${opts.cwd || 'workspace'}_${opts.providerId || 'remote-http'}_${opts.model || 'default'}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || crypto.randomUUID();
}

async function mapHttpError(res: Response): Promise<string> {
  let body: any = {};
  try { body = await res.json(); } catch {}
  const msg = body?.error?.message || res.statusText;
  switch (res.status) {
    case 401: return `登录已失效，请到设置重新填写 API Key`;
    case 403: return `你的 Key 没有权限调用这个 Agent`;
    case 404: return `指定的 Agent 不存在或已被删除`;
    case 408: return `请求被取消`;
    case 422: return `请求字段不合规：${msg}`;
    case 500: return `服务端错误：${msg}`;
    default:  return `HTTP ${res.status}：${msg}`;
  }
}
```

### 2.3 接进 RoutedChatProvider

`src/frontend/src/infrastructure/api/chat/ChatProvider.ts` 先把连接模式扩成三种：

```ts
export type ChatConnectionMode = 'local' | 'service' | 'remote-http';

export interface ChatConnectionSettings {
  mode: ChatConnectionMode;
  serverUrl: string;
  remoteHttp?: {
    baseUrl: string;
    apiKey: string;
    agentId: string;
  };
}
```

`src/frontend/src/infrastructure/api/chat/settings.ts` 增加三项 localStorage key：`baseUrl`、`apiKey`、`agentId`；`getChatConnectionSettings()` 读取 `remote-http` 时保留 HTTP/HTTPS URL，不做 ws/wss 归一化。

`src/frontend/src/infrastructure/api/chat/index.ts` 当前用 `getActiveProvider()` 同步返回 provider；加一个按配置缓存的 `HttpChatProvider`，再加第三 case：

```ts
import { HttpChatProvider } from './HttpChatProvider';

let httpChatProvider: HttpChatProvider | null = null;
let httpChatProviderKey = '';

function getHttpChatProvider(settings: ChatConnectionSettings): HttpChatProvider {
  const cfg = settings.remoteHttp;
  if (!cfg) throw new Error('remote-http settings missing');

  const key = `${cfg.baseUrl}|${cfg.apiKey}|${cfg.agentId}`;
  if (!httpChatProvider || httpChatProviderKey !== key) {
    httpChatProvider = new HttpChatProvider(cfg);
    httpChatProviderKey = key;
  }
  return httpChatProvider;
}

private getActiveProvider(): ChatProvider {
  const settings = getChatConnectionSettings();
  switch (settings.mode) {
    case 'local':       return cliChatProvider;
    case 'service':     return wsChatProvider;
    case 'remote-http': return getHttpChatProvider(settings);
    default: throw new Error(`unknown chat mode: ${settings.mode}`);
  }
}
```

## 3. 设置面板

文件：`src/frontend/src/app/components/dialogs/CLIProviderSettingsModal.tsx`

加第三个 tab："Remote HTTP"，三字段表单：

| 字段 | 校验 | 持久化键 |
|---|---|---|
| Asgard Base URL | URL 形式、`https://` 优先 | `chat.remoteHttp.baseUrl` |
| API Key | 非空、长度 >= 16 | `chat.remoteHttp.apiKey` —— 用户可见时遮码（`pk_xxx****`）|
| Agent ID | `^[a-zA-Z0-9_-]+$` | `chat.remoteHttp.agentId` |

下方加一个 "测试连接" 按钮，点了走：

```ts
async function testConnection(cfg: HttpChatProviderConfig) {
  const res = await fetch(`${cfg.baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` };
  const json = await res.json();
  const found = (json.data || []).some((m: any) => m.id === `pencil/${cfg.agentId}`);
  return { ok: found, msg: found ? `Agent ${cfg.agentId} 在列表里` : `Agent 不在列表里` };
}
```

## 4. session_id 怎么取

editor 的"对话"在用户感知里和"workspace + 文档"绑定。建议：

```ts
const sessionId = `${workspaceId}_${docId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
```

约束（Gateway 强校验）：`^[a-zA-Z0-9_-]+$`，长度有上限。同一 doc 多次开关编辑器拿到同样的 sessionId，记忆就连续了；不同 doc 自然隔离。

"重新开始对话" 按钮 → 等 Gateway G8 上线后调 `DELETE ${baseUrl}/v1/agents/:id/sessions/:sid`；在那之前可以**改一下 sessionId**（比如加随机后缀）来"另起一炉"，旧的让 Gateway 自然过期。

## 5. 错误展示

editor 是给作家用的，把 OpenAI error shape 翻译成用户能动作的中文（见 §2.2 `mapHttpError`）：

| HTTP | 用户看到 | 用户该做 |
|---|---|---|
| 401 | "登录已失效" | 回设置重填 key |
| 403 | "Key 没权限" | 找管理员 / 换 key |
| 404 | "Agent 不存在" | 回 Asgard 看是不是被删了 |
| 422 | "请求格式不对" | 这是 editor 自己的 bug，应该 sentry 上报 |
| 500 + `Engine reported error: ...` | 直接把 message 透出 | 多半是后端模型问题，等等再试 / 联系管理员 |

## 6. 取消（用户点停止）

`HttpChatProvider.cancel()` 里 `AbortController.abort()` 立即让 fetch 抛 `AbortError`，editor 看到的 stream 在下个 chunk 边界结束。**Gateway 侧** 拿到 client abort 还会给 nano-pencil 发 abort（Gateway 待补 G4 后才真正生效；目前可能在客户端断开后 model 仍跑空一段）。这块不是 editor 的事，但要心里有数。

## 7. 你不需要做的事

- ❌ 不要持久化对话历史 —— 服务端按 session_id 维持。editor 只渲染本次会话的 chunks。
- ❌ 不要重传完整 messages 数组 —— 每次只发新 user message + session_id；服务端记忆。
- ❌ 不要解析 nano-pencil 私有事件 —— 你只看 OpenAI SSE。
- ❌ 不要直接调 Gateway —— 永远走 Asgard。

## 8. 快速对接清单（editor）

```
□ src/frontend/src/infrastructure/api/chat/HttpChatProvider.ts —— 实现 ChatProvider
□ src/frontend/src/infrastructure/api/chat/index.ts —— 加 case 'remote-http'
□ src/frontend/src/infrastructure/api/chat/settings.ts —— 加 remoteHttp 字段类型
□ CLIProviderSettingsModal.tsx —— 加 "Remote HTTP" tab + 测试连接按钮
□ 错误中文映射 utility（mapHttpError）
□ session_id 生成 utility（hash workspace + doc）
□ AbortController 接到 "停止" 按钮
□ smoke：本地 docker compose 起 Asgard + Gateway，editor 切到 remote-http 模式跑一轮文本
```
