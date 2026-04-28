---
title: 容器化部署 Asgard + Gateway 全栈
status: active
scope: deployment
owner: pencil-agent-gateway maintainers
created: 2026-04-28
updated: 2026-04-28
---

# 容器化部署 Asgard + Gateway 全栈

## DIP Metadata

```text
[WHO]  自托管运维 / 创业初期 SRE
[FROM] 一台 Linux 机器（裸金属 / VPS / 公有云 VM 都行）
[TO]   一个对外暴露 HTTPS 的 Asgard 服务，背后串 Gateway → nano-pencil
[HERE] 单机 docker compose 编排：5 个容器，含 TLS 终止与持久化。规模上去之后的拆分路径
```

## 1. 部署拓扑

```
                  Internet
                      │
                      ▼ :443
           ┌─────────────────────┐
           │ Caddy (TLS + reverse proxy)
           │  /api/* → asgard-api:8000
           │  /     → asgard-web:80
           └─────────┬───────────┘
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
 ┌──────────┐ ┌────────────┐ ┌──────────┐
 │asgard-web│ │ asgard-api │ │ pencil-  │
 │(nginx +  │ │ (FastAPI)  │ │ gateway  │
 │ vite     │ │            │ │ (Node)   │
 │ build)   │ │            │ │          │
 └──────────┘ └─────┬──────┘ └──────────┘
                    │              ▲
                    ▼              │
              ┌──────────┐         │
              │ asgard-db│         │
              │(Postgres)│         │ internal-key
              └──────────┘         │
                                   │
                                   └── asgard-api 用 GATEWAY_INTERNAL_KEY 调
                                       gateway 走容器内网（不出宿主机）
```

**外部只暴露 Caddy 的 443**。Gateway / Postgres / Asgard-API 都只在内部 docker network 里，宿主机端口不映射。

## 2. 资源估算

测得 / 经验值（每容器 RSS）：

| 容器 | 镜像 | idle 内存 | 单活跃 session 增量 | 备注 |
|---|---|---|---|---|
| caddy | `caddy:2-alpine` | 20-40 MiB | trivial | TLS 自动续签 |
| asgard-web | `nginx:alpine` 静态 | 15-30 MiB | trivial | 只服务 Vite 产物 |
| asgard-api | `python:3.11-slim` | 80-120 MiB | +20-50 MiB / 并发请求 | uvicorn 异步，1 worker 起步够 |
| asgard-db | `postgres:15-alpine` | 80-120 MiB | +2-5 MiB / 连接 | 小型按 OK；上千用户切独立 RDS |
| pencil-gateway | `node:20-alpine` | **110 MiB** | **+80-200 MiB / session** | 唯一显著的内存消费者，每个 sessionId 一份 PencilAgent inMemory |

「session」这里指**活跃对话**：用户最近用过 30 分钟内仍在内存里的那种。一个 editor 用户写一晚上小说大约就一两个活跃 session。

### 2.1 三档配置

| 档位 | vCPU | RAM | 磁盘 | 同时活跃 session | 估算用户基数 | 适合场景 |
|---|---|---|---|---|---|---|
| **Demo / 你的开发机** | 2 | 4 GiB | 30 GiB | ~3 | 单人测试 | 跑通 smoke、给 PM 演示 |
| **Beta / 内测** | 4 | 8 GiB | 80 GiB SSD | 10-15 | ≤50 注册用户 | 真用户跑写作 |
| **Production starter** | 8 | 16 GiB | 200 GiB SSD | 30-50 | ≤500 用户 | 上线第一道压力 |
| **Scale-out** | 16+ | 32+ GiB | 500+ GiB SSD | 100+ | 上千 | 该拆 db、Gateway 多副本 |

> 你之前的开发机：2 vCPU / 3.4 GiB RAM / 580 MiB available — 这台**只够跑 Demo 档**且要关掉其它进程；做 Beta 之前先扩到 8 GiB RAM 是必须的。

### 2.2 内存预算示例（Beta 档 8 GiB）

```
caddy             40 MiB
asgard-web        30 MiB
asgard-api       150 MiB（含运行时高峰）
asgard-db        300 MiB（含 shared_buffers 配置）
pencil-gateway   110 MiB idle + 15 sessions × 150 MiB ≈ 2.4 GiB
                 ─────────────────────────────────────────
                 ≈ 3 GiB 容器总占用
                 + 1 GiB OS + 1 GiB buffer/cache + 1 GiB safety
                 = 5 GiB 实际占用，留 3 GiB margin → 8 GiB 妥
```

### 2.3 CPU 走向

CPU 不是 Gateway 的瓶颈 —— 大部分时间在等 cloud LLM API。真消耗 CPU 的是：

- Asgard-api 的 SSE 反代（异步 IO 友好，单 worker 撑得住几十并发）
- Postgres（看用户量）
- nginx/Caddy（trivial）

只要 **load avg < vCPU 数** 就 OK。Beta 档 4 vCPU，看到持续 > 3 就该升档。

## 3. 一键部署（生产模板）

仓库 `deploy/` 目录有可直接 `docker compose up -d` 的模板。

### 3.1 文件

```
deploy/
├── README.md
├── docker-compose.production.yml    # 全栈 5 容器
├── Caddyfile.example                # TLS + 反代
└── .env.example                     # 所有 secrets
```

### 3.2 步骤

```bash
# 1. clone & 进 deploy 目录
git clone <gateway-repo> && cd Pencil-Agent-Gateway/deploy

# 2. 改 .env（最少改 DOMAIN / GATEWAY_INTERNAL_KEY / JWT_SECRET / POSTGRES_PASSWORD）
cp .env.example .env
$EDITOR .env

# 3. 改 Caddyfile 的 example.com → 你的真域名
cp Caddyfile.example Caddyfile
$EDITOR Caddyfile

# 4. 拉镜像 + 起服务
docker compose -f docker-compose.production.yml up -d

# 5. 一次性给 Gateway 注入 nano-pencil auth（方案 B：mount auth.json）
docker compose -f docker-compose.production.yml \
    cp ./secrets/nanopencil-auth.json gateway:/root/.nanopencil/auth.json
docker compose -f docker-compose.production.yml restart gateway

# 6. 验证
curl https://your-domain.com/api/healthz                # asgard-api
curl https://your-domain.com/                            # asgard-web (200)
```

域名解析到这台机器的 443，Caddy 自动申请 LE 证书。

### 3.3 升级 / 回滚

```bash
# 升级 gateway 单服务
docker compose pull gateway && docker compose up -d --no-deps gateway

# 回滚到上一个 tag
GATEWAY_TAG=0.1.2 docker compose up -d --no-deps gateway
```

Gateway 已实现优雅停机（`SHUTDOWN_TIMEOUT_MS=10000`，issue 0008 修复），rolling 不丢请求。

## 4. 凭据管理（铁律）

| 凭据 | 谁持有 | 在哪 |
|---|---|---|
| Postgres 密码 | asgard-db / asgard-api | `.env` → `POSTGRES_PASSWORD` |
| JWT secret | asgard-api | `.env` → `JWT_SECRET_KEY` |
| **Gateway internal-key** | asgard-api 调 gateway 用 | `.env` → `GATEWAY_INTERNAL_KEY` |
| **cloud provider key**（Anthropic 等） | gateway 容器**内** | mount `auth.json` 或 `ANTHROPIC_API_KEY` env，**不入数据库** |
| user-key | asgard-api 颁发，用户持有 | DB pencil_user_keys 表 |

**绝不**:

- ❌ 不把 cloud provider key 落 Asgard DB
- ❌ 不把 internal-key 暴给 editor / 用户
- ❌ 不把 user-key 写日志
- ❌ 不把 .env 提交到 git（`.gitignore` 默认覆盖）

## 5. 监控 / 备份

### 5.1 监控（Beta 档够用的轻量套）

- **Caddy access log** → 落 `/var/log/caddy/`，定期 logrotate
- **容器健康**：`docker compose ps` 查每个 service 的 healthy 状态；compose 模板里都配了 healthcheck
- **磁盘**：watch `df -h` —— 落地数据是 `gateway-data` (sessions/agents) + Postgres
- **Gateway 进程内**：v0.1 只暴露 `/healthz` + `/readyz`；想要 metrics 等 G11（计划中）

Production starter 档及以上建议加 Prometheus + Grafana（占额外 ~500 MiB）。

### 5.2 备份

```bash
# 每天凌晨备 Postgres
0 3 * * * docker compose exec -T db pg_dump -U postgres asgard | gzip > /backup/asgard-$(date +%F).sql.gz

# 每周备 gateway 落地（agents 配置 + sessions）
0 4 * * 0 tar czf /backup/gateway-data-$(date +%F).tar.gz -C /var/lib/docker/volumes/deploy_gateway-data .
```

异地至少留 14 天，Asgard DB 和 Gateway agents 配置一起备。**Gateway sessions 丢了不可怕**（短期记忆，丢了用户重开就行），**agents/*.json 丢了**用户的 Soul 就没了。

## 6. 何时该拆

下面任一发生，就该往 Scale-out 走：

| 触发 | 该拆什么 |
|---|---|
| Postgres CPU > 50% 持续 1h | DB 切独立机器（managed Postgres / RDS） |
| Gateway 总内存接近物理 RAM 70% | Gateway 多副本（无状态，sessions 用 Redis 集中存储 —— 待 v0.2） |
| asgard-api 日志频繁 timeout | 加 worker 数量 / 拆独立机器 |
| 单台机器 vCPU 长期 > 80% | 整体上 k8s，每服务独立 deployment |

## 7. k8s 形态（Scale-out 草图，作为后期参考）

```yaml
# 5 个 Deployment + 4 个 Service + 1 个 Ingress
deployment/asgard-web    -> Service (ClusterIP)  ─┐
deployment/asgard-api    -> Service (ClusterIP)  ─┼─ Ingress (TLS)
deployment/gateway       -> Service (ClusterIP)  ─┘   ← 仅 asgard-api 内网访问
deployment/postgres      -> Service (ClusterIP)
deployment/caddy/nginx   ── 不再需要（Ingress controller 替代）

PVC:
  postgres-data         50Gi RWO
  gateway-data          20Gi RWO
  nanopencil-auth       Secret 挂载
```

Gateway 多副本时，**sessions 池化必须改成集中存储**（Redis）—— 当前实现是进程内 Map，多副本会出现"用户上一句路由到副本 A，下一句路由到副本 B 看不到上下文"。这是 v0.2 的工作。

## 8. 故障演练清单

部署完先把这几个故障人为制造一遍，确认监控有响应、恢复路径通：

```
□ kill gateway 容器 → compose restart 自动起；in-flight 请求 SSE 收到 done(error) 而非永久 hang
□ docker compose stop db 5s 再起 → asgard-api 的 chat 请求得到合理错误，不 500 内核 panic
□ Gateway data 卷丢 → 重启后 agents 列表为空（用户需重新走 Asgard 同步流程）
□ cloud provider 返 403 → user 收到 "Engine reported error: 403 ..." 中文化的人类可读
□ docker compose down --timeout 30 → Gateway 看到 SIGTERM，引擎 disposeAll 完成后干净退出（issue 0008 已修）
□ user 用错 key (Bearer xxx) → 401，logs 不泄露 key 全文
□ 客户端断开（kill curl） → Gateway logs 看到 abort，session 进入 idle（待 G4 上线后会真正中断模型）
```

每条都过了，再正式开放给用户。
