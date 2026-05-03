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
DATA_DIR="${PENCIL_DIR}/data"
# Default agentDir is isolated per pencil. If you already use `nanopencil` with the
# stock home, set NANOPENCIL_CODING_AGENT_DIR before this script (e.g. to
# "$HOME/.nanopencil/agent") so Gateway reads the same auth.json/models.json as the CLI.
DEFAULT_AGENT_DIR="${HOME}/.pencils/${PENCIL_NAME}"
AGENT_DIR="${NANOPENCIL_CODING_AGENT_DIR:-${DEFAULT_AGENT_DIR}}"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "error: ${CONFIG_PATH} not found" >&2
  echo "hint:  cp -r pencils/.example pencils/${PENCIL_NAME} && edit pencils/${PENCIL_NAME}/config.json" >&2
  exit 66
fi

if [[ ! -d "${AGENT_DIR}" ]]; then
  echo "warn:  ${AGENT_DIR} does not exist — nanopencil has no auth/settings here yet." >&2
  echo "hint:  NANOPENCIL_CODING_AGENT_DIR=\"${AGENT_DIR}\" nanopencil /login" >&2
fi

mkdir -p "${DATA_DIR}"

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
export DATA_DIR="${DATA_DIR}"
# Always export a single source of truth for the Node process (npx tsx + channel server).
# Pre-set value wins (e.g. match CLI: $HOME/.nanopencil/agent); else use per-pencil default.
export NANOPENCIL_CODING_AGENT_DIR="${NANOPENCIL_CODING_AGENT_DIR:-${AGENT_DIR}}"

# Common mistake: pointing at the repo's pencils/<name>/ (Gateway config only) — not auth.json.
if [[ "${NANOPENCIL_CODING_AGENT_DIR}" == *"/Pencil-Agent-Gateway/pencils/"* ]] ||
  [[ "${NANOPENCIL_CODING_AGENT_DIR}" == *"/pencils/pencil-"* && "${NANOPENCIL_CODING_AGENT_DIR}" != *"/.pencils/"* ]]; then
  echo "error: NANOPENCIL_CODING_AGENT_DIR looks like the Gateway repo folder, not nanopencil data." >&2
  echo "       Use the same directory as the CLI: export NANOPENCIL_CODING_AGENT_DIR=\"\$HOME/.nanopencil/agent\"" >&2
  echo "       (optional isolate slot: \$HOME/.pencils/${PENCIL_NAME})" >&2
  exit 64
fi

cd "${REPO_ROOT}"

echo "pencil:    ${PENCIL_NAME}"
echo "config:    ${CONFIG_PATH}"
echo "data:      ${DATA_DIR}"
echo "agentDir:  ${NANOPENCIL_CODING_AGENT_DIR}"

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
