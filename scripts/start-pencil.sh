#!/usr/bin/env bash
# [WHO]  Local Gateway operator
# [FROM] pencils/<name>/config.json + ~/.pencils/<name>/ agentDir
# [TO]   A dedicated Pencil-Agent-Gateway process for one PencilAgent slot
# [HERE] scripts/start-pencil.sh — parameterized launcher; isolates ports, dataDir, agentDir per pencil
#
# Usage:
#   ./scripts/start-pencil.sh <pencil-name> [--with-channels]
#
# Example:
#   ./scripts/start-pencil.sh pencil-01
#   ./scripts/start-pencil.sh pencil-01 --with-channels
#
# Layout it expects:
#   pencils/<name>/config.json       (Gateway config)
#   pencils/<name>/data/             (Gateway registry persistence)
#   ~/.pencils/<name>/               (nanopencil agentDir; run `nanopencil /login` once first)

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <pencil-name> [--with-channels]" >&2
  exit 64
fi

PENCIL_NAME="$1"
WITH_CHANNELS="${2:-}"

# Resolve repo root regardless of where the script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PENCIL_DIR="${REPO_ROOT}/pencils/${PENCIL_NAME}"
CONFIG_PATH="${PENCIL_DIR}/config.json"
# Issue 0012: dataDir + agentDir defaults are now resolved by the Gateway itself
# (see src/config.ts loadConfig + src/engine/nano-adapter.ts). dataDir defaults
# to ~/.pencils/gateway, agentDir defaults to ~/.pencils/<config.id>. The
# launcher only echoes the resolved values; it does NOT inject path env vars.
#
# NANOPENCIL_CODING_AGENT_DIR remains an *override*: when set, every agent in
# this Gateway process whose AgentConfig.agentDir is unset picks it up.
AGENT_DIR="${NANOPENCIL_CODING_AGENT_DIR:-${HOME}/.pencils/${PENCIL_NAME}}"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "error: ${CONFIG_PATH} not found" >&2
  echo "hint:  cp -r pencils/.example pencils/${PENCIL_NAME} && edit pencils/${PENCIL_NAME}/config.json" >&2
  exit 66
fi

if [[ ! -d "${AGENT_DIR}" ]]; then
  echo "warn:  ${AGENT_DIR} does not exist — nanopencil has no auth/settings here yet." >&2
  echo "hint:  NANOPENCIL_CODING_AGENT_DIR=\"${AGENT_DIR}\" nanopencil /login" >&2
fi

# dataDir creation is handled by AgentRegistry on first start; we no longer
# pre-create a project-local ./data folder. Default `~/.pencils/gateway` is
# created by the Gateway process at boot.

# Load any pencil-local channel credentials (DingTalk/Feishu/WeChat secrets,
# webhook shared secrets, etc). config.json may reference these via
# ${VAR_NAME} interpolation, so they need to be in the env before Gateway
# loads its config. Each .env.<channel> file is shell-sourced — keep them as
# KEY=VALUE pairs without quotes for cross-platform safety.
shopt -s nullglob
for env_file in "${PENCIL_DIR}"/.env.*; do
  if [[ -f "${env_file}" ]]; then
    echo "loading:   ${env_file}"
    set -a; source "${env_file}"; set +a
  fi
done
shopt -u nullglob

export GATEWAY_CONFIG="${CONFIG_PATH}"
# NANOPENCIL_CODING_AGENT_DIR is honoured by the Gateway as the agentDir
# fallback when AgentConfig.agentDir is unset. We only export it when the
# operator already had it set (so we don't shadow a deliberate choice with the
# slot-name default).
if [[ -n "${NANOPENCIL_CODING_AGENT_DIR:-}" ]]; then
  export NANOPENCIL_CODING_AGENT_DIR
fi

cd "${REPO_ROOT}"

echo "pencil:    ${PENCIL_NAME}"
echo "config:    ${CONFIG_PATH}"
echo "agentDir:  ${AGENT_DIR}  (default; AgentConfig.agentDir overrides per-instance)"

if [[ "${WITH_CHANNELS}" == "--with-channels" ]]; then
  echo "mode:      gateway + channel server (parallel)"
  echo
  # Spawn both servers as background children of this shell. Trap cleans them
  # up on Ctrl+C / kill so a stuck child doesn't outlive the launcher.
  npx --no-install tsx watch src/server.ts &
  GW_PID=$!
  npx --no-install tsx watch src/channel-server.ts &
  CH_PID=$!
  trap 'echo; echo "stopping gw=${GW_PID} ch=${CH_PID}"; kill ${GW_PID} ${CH_PID} 2>/dev/null || true; wait 2>/dev/null || true; exit 0' INT TERM
  wait
else
  echo "mode:      gateway only"
  echo
  exec npx --no-install tsx watch src/server.ts
fi
