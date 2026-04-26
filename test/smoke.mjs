/**
 * E2E Smoke Test — 验证 Gateway 端到端可用
 *
 * [WHO]  开发者本地手动测试
 * [FROM] Gateway HTTP API
 * [TO]   终端输出
 * [HERE] test/smoke.mjs — 创建 Agent + 发消息（非流式 + 流式 + session 记忆）
 *
 * 用法:
 *   ANTHROPIC_API_KEY=sk-ant-xxx node test/smoke.mjs
 *   ANTHROPIC_API_KEY=sk-ant-xxx node test/smoke.mjs http://localhost:8080
 */

const BASE = process.argv[2] || 'http://localhost:8080';
const API_KEY = 'pk_dev_default';
const PROVIDER_KEY = process.env.ANTHROPIC_API_KEY;

if (!PROVIDER_KEY) {
  console.error('❌ 请设置 ANTHROPIC_API_KEY 环境变量');
  console.error('   ANTHROPIC_API_KEY=sk-ant-xxx node test/smoke.mjs');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
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
  console.log(`   Target: ${BASE}\n`);

  // 0. Health
  console.log('── Health ──');
  {
    const r = await api('GET', '/healthz');
    ok('healthz', r);
  }

  // 1. 创建 Agent
  console.log('\n── 创建 Agent ──');
  const agentId = 'smoke-test-' + Date.now();
  {
    const r = await api('POST', '/v1/agents', {
      id: agentId,
      name: 'Smoke Test Agent',
      model: {
        provider: 'anthropic',
        name: 'claude-sonnet-4-6',
        apiKey: PROVIDER_KEY,
      },
    });
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
  let reply1 = '';
  {
    const r = await api('POST', '/v1/chat/completions', {
      model: `pencil/${agentId}`,
      messages: [{ role: 'user', content: '用一句话介绍你自己，提到你的名字叫小铅笔。' }],
    });
    const result = ok('POST /v1/chat/completions (non-stream)', r);
    if (result) {
      reply1 = result.choices?.[0]?.message?.content || '';
      console.log(`     回复: ${reply1.slice(0, 100)}${reply1.length > 100 ? '...' : ''}`);
    }
  }

  // 4. 流式对话
  console.log('\n── 流式对话 ──');
  {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
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
      const body = res.body;
      const reader = body.getReader();
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
    // 第一轮：告诉 Agent 一个秘密
    const r1 = await api('POST', '/v1/chat/completions', {
      model: `pencil/${agentId}`,
      messages: [{ role: 'user', content: '记住这个密码：7482' }],
      session_id: sessionId,
    });
    ok('第一轮 (记住密码)', r1);

    // 第二轮：问它密码
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
  {
    const r = await api('DELETE', `/v1/agents/${agentId}`);
    ok('DELETE agent', r);
  }

  console.log('\n✅ Smoke test 完成\n');
}

main().catch(err => {
  console.error('\n❌ 测试异常:', err.message);
  process.exit(1);
});
