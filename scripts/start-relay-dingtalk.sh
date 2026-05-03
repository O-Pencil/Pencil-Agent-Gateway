#!/usr/bin/env bash
# [WHO]  Local operator running a DingTalk Stream relay for one pencil
# [FROM] pencils/<pencil-name>/.env.dingtalk + relays/dingtalk/
# [TO]   Pencil-Agent-Gateway channel webhook
# [HERE] scripts/start-relay-dingtalk.sh — sources pencil-local secrets,
#        installs relay deps on first run, execs the relay process

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <pencil-name>" >&2
  exit 64
fi

PENCIL_NAME="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PENCIL_DIR="${REPO_ROOT}/pencils/${PENCIL_NAME}"
ENV_FILE="${PENCIL_DIR}/.env.dingtalk"
RELAY_DIR="${REPO_ROOT}/relays/dingtalk"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "error: ${ENV_FILE} not found" >&2
  echo "hint:  create it from the template in pencils/README.md (Bind to DingTalk Later)" >&2
  exit 66
fi

if [[ ! -d "${RELAY_DIR}/node_modules" ]]; then
  echo "[start-relay-dingtalk] installing relay deps (one-time)..."
  ( cd "${RELAY_DIR}" && npm install --no-audit --no-fund )
fi

echo "[start-relay-dingtalk] pencil=${PENCIL_NAME}"
echo "  env:    ${ENV_FILE}"
echo "  relay:  ${RELAY_DIR}/src/index.ts"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

cd "${RELAY_DIR}"

# tsx watch makes local edits to relays/dingtalk/src/*.ts hot-reload, which
# matters because relay code changes (e.g. ack timing, sessionWebhook payload
# shape) only take effect on a fresh DingTalk Stream connect — without watch,
# operators forget to bounce the process and continue debugging against the
# old code path. The reload briefly drops the WebSocket; in-flight events
# during the reload are lost. Acceptable for local; switch back to plain
# `tsx src/index.ts` when running under a process manager in production.
exec npx --no-install tsx watch src/index.ts
