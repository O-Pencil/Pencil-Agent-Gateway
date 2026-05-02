#!/usr/bin/env bash
# [WHO]  Local pencil operator double-checking which pencil they're about to touch
# [FROM] $HOME/.pencils/<name>/{settings,auth,models}.json
# [TO]   stdout — a one-screen summary so you don't accidentally edit the wrong pencil
# [HERE] scripts/check-pencil.sh — read-only diagnostic; safe to run any time
#
# Usage:
#   ./scripts/check-pencil.sh <pencil-name>
#
# Common gotcha this catches:
#   - You forgot to set NANOPENCIL_CODING_AGENT_DIR before running `nanopencil`,
#     so /model wrote to ~/.nanopencil/agent/ instead of ~/.pencils/<name>/.
#   - settings.json has no defaultModel → Gateway returns "No model selected".
#   - auth.json has a key for a provider that defaultProvider doesn't reference.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <pencil-name>" >&2
  exit 64
fi

PENCIL_NAME="$1"
AGENT_DIR="${HOME}/.pencils/${PENCIL_NAME}"

# Resolve repo root regardless of where the script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GATEWAY_CONFIG="${REPO_ROOT}/pencils/${PENCIL_NAME}/config.json"

echo "==== pencil: ${PENCIL_NAME} ===="
echo "agentDir:        ${AGENT_DIR}"
echo "gatewayConfig:   ${GATEWAY_CONFIG}"
echo

if [[ ! -d "${AGENT_DIR}" ]]; then
  echo "[!] agentDir does not exist yet."
  echo "    run:  NANOPENCIL_CODING_AGENT_DIR=\"${AGENT_DIR}\" nanopencil"
  echo "          then in the TUI:  /login   /model"
  exit 1
fi

# settings.json
SETTINGS="${AGENT_DIR}/settings.json"
if [[ -f "${SETTINGS}" ]]; then
  echo "-- settings.json --"
  cat "${SETTINGS}"
  PROVIDER="$(grep -o '"defaultProvider"[^,}]*' "${SETTINGS}" | sed 's/.*"defaultProvider"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)"
  MODEL="$(grep -o '"defaultModel"[^,}]*'    "${SETTINGS}" | sed 's/.*"defaultModel"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)"
  echo
else
  echo "[!] settings.json missing."
  PROVIDER=""
  MODEL=""
fi

# auth.json
AUTH="${AGENT_DIR}/auth.json"
if [[ -f "${AUTH}" ]]; then
  echo "-- auth.json (providers with keys) --"
  grep -oE '"[a-zA-Z0-9_-]+":[[:space:]]*\{' "${AUTH}" | sed 's/[":[:space:]{]//g' | sort -u | sed 's/^/  /'
  echo
else
  echo "[!] auth.json missing — no provider has been logged in yet."
fi

# Sanity checks
echo "-- diagnosis --"
RC=0

if [[ -z "${PROVIDER}" ]]; then
  echo "  [FAIL] defaultProvider is not set in settings.json — Gateway will reject chat with 'No model selected'."
  RC=1
fi
if [[ -z "${MODEL}" ]]; then
  echo "  [FAIL] defaultModel is not set in settings.json — Gateway will reject chat with 'No model selected'."
  RC=1
fi

if [[ -n "${PROVIDER}" && -f "${AUTH}" ]]; then
  if ! grep -q "\"${PROVIDER}\"[[:space:]]*:" "${AUTH}"; then
    echo "  [FAIL] defaultProvider '${PROVIDER}' has no key in auth.json. Run /login for it inside the TUI."
    RC=1
  fi
fi

# Gateway port quick-scan
if [[ -f "${GATEWAY_CONFIG}" ]]; then
  PORT="$(grep -A2 '"gateway"' "${GATEWAY_CONFIG}" | grep '"port"' | head -1 | sed 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/' || true)"
  if [[ -n "${PORT}" ]]; then
    if curl -sf -m 1 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
      echo "  [OK]   Gateway already listening on port ${PORT}"
    else
      echo "  [info] Gateway not running on port ${PORT} — start with: ./scripts/start-pencil.sh ${PENCIL_NAME}"
    fi
  fi
else
  echo "  [FAIL] ${GATEWAY_CONFIG} missing — copy from pencils/.example/config.json"
  RC=1
fi

if [[ "${RC}" -eq 0 ]]; then
  echo "  [OK]   ready: provider=${PROVIDER}  model=${MODEL}"
fi

exit "${RC}"
