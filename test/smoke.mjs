/**
 * E2E Smoke Test — 验证 Gateway 端到端可用
 *
 * [WHO]  开发者本地手动测试
 * [FROM] Gateway HTTP API
 * [TO]   终端输出
 * [HERE] test/smoke.mjs — 创建 Agent + 发消息（非流式 + 流式 + session 记忆）
 *
 * 默认走 "inherited" 模式：让 Gateway 沿用你本机 `~/.nanopencil/` 里登录的
 * provider/model（也就是你 `nanopencil /login` 进的那个）。这是 Gateway 设计
 * 的主路径——provider/model 切换由 nano-pencil SDK 负责，Gateway 只做 HTTP 壳。
 *
 * 用法（默认，推荐）:
 *   node test/smoke.mjs
 *   node test/smoke.mjs http://localhost:8080
 *
 * 显式指定 provider/model（仍走本机 auth）:
 *   PENCIL_PROVIDER=anthropic PENCIL_MODEL=claude-sonnet-4-5-20250929 node test/smoke.mjs
 *
 * BYO key（传入云厂商裸 key，不走本机 auth）:
 *   PENCIL_PROVIDER=anthropic PENCIL_MODEL=claude-sonnet-4-5-20250929 \
 *   PENCIL_API_KEY=sk-ant-xxx node test/smoke.mjs
 */

const BASE = process.argv[2] || 'http://localhost:8080';
const GATEWAY_KEY = 'pk_dev_default';

const PROVIDER = process.env.PENCIL_PROVIDER || '';
const MODEL = process.env.PENCIL_MODEL || '';
const PROVIDER_KEY = process.env.PENCIL_API_KEY || '';

// 构造 model 字段：
//  - 没设任何 env       → 完全省略 model，让 SDK 用本机默认
//  - 设了 PROVIDER+MODEL → 作为 override
//  - 还设了 PROVIDER_KEY → BYO 模式
function buildModelField() {
  if (!PROVIDER && !MODEL && !PROVIDER_KEY) return undefined;
  const m = {};
  if (PROVIDER) m.provider = PROVIDER;
  if (MODEL) m.name = MODEL;
  if (PROVIDER_KEY) m.apiKey = PROVIDER_KEY;
  return m;
}

// ── helpers ──────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${GATEWAY_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function ok(label, { status, json }) {
  if (status >= 200 && status < 300) {
    console.log(`  ✅ ${label} (${status})`);
    return json;
  }
  console.log(`  ❌ ${label} (${status})`, json);
  return null;
}

// ── 测试 ──────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Gateway E2E Smoke Test`);
  console.log(`   Target: ${BASE}`);
  const modelField = buildModelField();
  if (!modelField) {
    console.log(`   Model:  (沿用本机 nano-pencil 默认)\n`);
  } else {
    const tags = [];
    if (modelField.provider) tags.push(`provider=${modelField.provider}`);
    if (modelField.name) tags.push(`name=${modelField.name}`);
    if (modelField.apiKey) tags.push(`mode=byo-key`);
    else tags.push(`mode=inherited`);
    console.log(`   Model:  ${tags.join(' ')}\n`);
  }

  // 0. Health
  console.log('── Health ──');
  ok('healthz', await api('GET', '/healthz'));

  // 1. 创建 Agent
  console.log('\n── 创建 Agent ──');
  const agentId = 'smoke-test-' + Date.now();
  {
    const body = { id: agentId, name: 'Smoke Test Agent' };
    if (modelField) body.model = modelField;
    const r = await api('POST', '/v1/agents', body);
    const result = ok('POST /v1/agents', r);
    if (!result) process.exit(1);
    console.log(`     modelId: ${result.modelId}`);
  }

  // 2. 验证 models 列表
  console.log('\n── Models ──');
  {
    const r = await api('GET', '/v1/models');
    const result = ok('GET /v1/models', r);
    if (result) {
      const found = result.data.find(m => m.id === `pencil/${agentId}`);
      console.log(`     ${found ? '✅' : '❌'} pencil/${agentId} 在列表中`);
    }
  }

  // 3. 非流式对话
  console.log('\n── 非流式对话 ──');
  {
    const r = await api('POST', '/v1/chat/completions', {
      model: `pencil/${agentId}`,
      messages: [{ role: 'user', content: '用一句话介绍你自己，提到你的名字叫小铅笔。' }],
    });
    const result = ok('POST /v1/chat/completions (non-stream)', r);
    if (result) {
      const reply = result.choices?.[0]?.message?.content || '';
      console.log(`     回复: ${reply.slice(0, 100)}${reply.length > 100 ? '...' : ''}`);
    }
  }

  // 4. 流式对话
  console.log('\n── 流式对话 ──');
  {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `pencil/${agentId}`,
        messages: [{ role: 'user', content: '说三个字：你好世界' }],
        stream: true,
      }),
    });

    if (res.status !== 200) {
      console.log(`  ❌ stream request failed (${res.status})`);
    } else {
      let text = '';
      let chunks = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const str = decoder.decode(value, { stream: true });
        for (const line of str.split('\n')) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]\n') continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) { text += delta; chunks++; }
          } catch {}
        }
      }
      console.log(`  ✅ stream 收到 ${chunks} 个 delta`);
      console.log(`     回复: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);
    }
  }

  // 5. Session 记忆
  console.log('\n── Session 记忆 ──');
  {
    const sessionId = 'memory-test-' + Date.now();
    const r1 = await api('POST', '/v1/chat/completions', {
      model: `pencil/${agentId}`,
      messages: [{ role: 'user', content: '记住这个密码：7482' }],
      session_id: sessionId,
    });
    ok('第一轮 (记住密码)', r1);

    const r2 = await api('POST', '/v1/chat/completions', {
      model: `pencil/${agentId}`,
      messages: [{ role: 'user', content: '我刚才让你记住的密码是什么？只回复数字' }],
      session_id: sessionId,
    });
    const result = ok('第二轮 (回忆密码)', r2);
    if (result) {
      const reply = result.choices?.[0]?.message?.content || '';
      const hasIt = reply.includes('7482');
      console.log(`     ${hasIt ? '✅' : '⚠️'} 记忆${hasIt ? '正常' : '可能丢失'}: ${reply.slice(0, 80)}`);
    }
  }

  // 6. 清理
  console.log('\n── 清理 ──');
  ok('DELETE agent', await api('DELETE', `/v1/agents/${agentId}`));

  console.log('\n✅ Smoke test 完成\n');
}

main().catch(err => {
  console.error('\n❌ 测试异常:', err.message);
  process.exit(1);
});
