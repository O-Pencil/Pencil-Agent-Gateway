---
title: 全栈生产部署快速指南
status: active
scope: deployment-runbook
owner: pencil-agent-gateway maintainers
created: 2026-04-29
updated: 2026-04-29
---

# 全栈生产部署快速指南

## DIP Metadata

```text
[WHO]  自托管运维 / 创业初期 SRE
[FROM] 一台干净的 Linux 机器（≥ 4 vCPU / 8 GiB RAM 推荐）
[TO]   一个对外 https://${DOMAIN} 的 Asgard 平台，背后串 Pencil Agent Gateway → nano-pencil
[HERE] 5 容器 docker compose 编排：caddy + asgard-web + asgard-api + asgard-db + pencil-gateway
```

完整拓扑、资源估算、监控/备份、扩展路径见 [../docs/11-containerized-deployment.md](../docs/11-containerized-deployment.md)。本文件只讲操作步骤。

---

## 0. 前置

- Linux + Docker Engine ≥ 24 + Docker Compose v2
- 域名 A 记录指向这台机器，**80/443 通**（Caddy 申 LE 证书要）
- 至少 8 GiB RAM（4 GiB 只够 Demo 档）
- 三个仓库镜像就位：
  - `pencil-agent-gateway:latest`（本仓库 `docker build .`，或拉 registry）
  - `asgard-api:latest`（Asgard-api 仓库）
  - `asgard-web:latest`（Asgard-web 仓库）

如果你想从源码本地构建 Gateway，编辑 `docker-compose.production.yml` 的 `pencil-gateway` 服务，把 `image:` 注释掉、`build:` 取消注释。

---

## 1. 一次性配置

```bash
cd Pencil-Agent-Gateway/deploy

# 1.1 复制模板
cp .env.example .env
cp Caddyfile.example Caddyfile
cp gateway.json.example gateway.json

# 1.2 生成两把强密钥
echo "JWT_SECRET_KEY=$(openssl rand -hex 32)" >> .env
echo "GATEWAY_INTERNAL_KEY=$(openssl rand -hex 24)" >> .env

# 1.3 改 .env：DOMAIN / ACME_EMAIL / POSTGRES_PASSWORD
$EDITOR .env

# 1.4 把 GATEWAY_INTERNAL_KEY 同步到 gateway.json
#   把 .env 里 GATEWAY_INTERNAL_KEY=xxx 的 xxx
#   填到 gateway.json 的 apiKeys[0].key
$EDITOR gateway.json

# 1.5 改 Caddyfile 里没有占位符（用 {$DOMAIN} 由 compose 注入），通常不用动
```

> 第 1.4 步是手工同步，将来如果 Gateway 支持 env 引用 internal key（`apiKeys[0].key: ${GATEWAY_INTERNAL_KEY}`），这步可以删。当前需要保持两边一致。

---

## 2. 首次注入 nano-pencil 凭据（inherited 模式）

Asgard 不持有 cloud provider key，全靠 Gateway 容器内的 `/root/.nanopencil/auth.json`。**先在宿主机生成一份**：

```bash
# 在宿主机本地装一次 nano-pencil（仅用于生成 auth.json）
npm i -g @pencil-agent/nano-pencil

# 跟 nano-pencil 走 OAuth / API key 登录流程
nanopencil login
# 完成后在 ~/.nanopencil/auth.json 出现凭据文件

# 把它拷到 gateway 容器持久化卷
docker compose -f docker-compose.production.yml up -d pencil-gateway
docker compose -f docker-compose.production.yml \
    cp ~/.nanopencil/auth.json pencil-gateway:/root/.nanopencil/auth.json
docker compose -f docker-compose.production.yml restart pencil-gateway
```

（如果你走 BYO-key / env 模式，把 `ANTHROPIC_API_KEY` 写到 `.env` 就够了，跳过这一节。）

---

## 3. 启动全栈

```bash
docker compose -f docker-compose.production.yml up -d

# 等 60s 让 Caddy 申请证书 + 各服务 healthcheck 转 healthy
docker compose -f docker-compose.production.yml ps
```

期望状态：5 个容器都 `healthy`。

```bash
# 访问验证
curl -fsS https://${DOMAIN}/api/healthz   # asgard-api
curl -fsS https://${DOMAIN}/              # asgard-web (200，HTML)

# 内网验 gateway（在 asgard-api 容器里发起）
docker compose -f docker-compose.production.yml exec asgard-api \
    python -c "import urllib.request; print(urllib.request.urlopen('http://pencil-gateway:8080/healthz').read())"
```

Gateway **不要**对外暴露 8080。它只在 `internal` 网络里给 asgard-api 调。

---

## 4. 日常运维

### 4.1 升级 Gateway 单服务

```bash
docker compose -f docker-compose.production.yml pull pencil-gateway
docker compose -f docker-compose.production.yml up -d --no-deps pencil-gateway
```

Gateway 已实现优雅停机（`SHUTDOWN_TIMEOUT_MS=10000`），rolling restart 不丢请求。

### 4.2 回滚

```bash
# 改回老镜像 tag
GATEWAY_TAG=0.1.2 docker compose -f docker-compose.production.yml \
    up -d --no-deps pencil-gateway
```

### 4.3 看日志

```bash
docker compose -f docker-compose.production.yml logs -f pencil-gateway
docker compose -f docker-compose.production.yml logs -f asgard-api
# Caddy access log 落卷
docker compose -f docker-compose.production.yml exec caddy \
    tail -f /var/log/caddy/access.log
```

### 4.4 备份

参考 [../docs/11-containerized-deployment.md §5.2](../docs/11-containerized-deployment.md)，最小集合：

```bash
# 每天 03:00 备 Postgres
0 3 * * * docker compose -f /path/to/docker-compose.production.yml exec -T asgard-db \
    pg_dump -U ${POSTGRES_USER} ${POSTGRES_DB} | gzip > /backup/asgard-$(date +%F).sql.gz

# 每周 04:00 备 Gateway 落地 (agents/*.json + sessions)
0 4 * * 0 tar czf /backup/gateway-data-$(date +%F).tar.gz \
    -C /var/lib/docker/volumes/pencil-stack_gateway-data .
```

> Gateway sessions 丢可以接受（短期记忆），**`agents/*.json` 丢了用户的 Agent 全没**——这才是真正必须备的部分。

---

## 5. 故障演练（上线前一遍过）

参考 [../docs/11-containerized-deployment.md §8](../docs/11-containerized-deployment.md)：

```text
□ kill pencil-gateway 容器 → compose 自动重启；in-flight SSE 收到 done(error)
□ stop asgard-db 5s 再起 → asgard-api 的 chat 请求得到合理错误，不 500 panic
□ 删 gateway-data 卷 → 重启后 agents 列表为空（用户需重新走 Asgard 同步）
□ 用错 internal-key → asgard-api 收到 401，logs 不泄露 key 全文
□ docker compose down --timeout 30 → Gateway 看到 SIGTERM，干净退出
□ kill 客户端连接 → Gateway logs 看到 abort，session 回 idle
□ provider 返 403 → 用户收到 "Engine reported error: 403 ..." 中文化人类可读
```

---

## 6. 凭据铁律

| 凭据 | 谁持有 | 在哪 |
|---|---|---|
| Postgres 密码 | asgard-db / asgard-api | `.env` → `POSTGRES_PASSWORD` |
| JWT secret | asgard-api | `.env` → `JWT_SECRET_KEY` |
| **Gateway internal-key** | asgard-api 调 gateway | `.env` → `GATEWAY_INTERNAL_KEY` + `gateway.json` |
| **cloud provider key** | gateway 容器内 | mount auth.json **或** `ANTHROPIC_API_KEY` env |
| user-key | asgard-api 颁发，用户持有 | DB `pencil_user_keys` 表 |

绝不：
- ❌ 不把 cloud provider key 落 Asgard DB
- ❌ 不把 internal-key 暴给 editor / 终端用户
- ❌ 不把 user-key 写到日志
- ❌ 不把 `.env` / `gateway.json` 提交到 git
