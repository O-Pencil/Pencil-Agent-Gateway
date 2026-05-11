#!/usr/bin/env bash
# Launch Gateway as a public-facing local service on this ECS.
#
# - Reads config/production.json (committed; uses ${API_KEY} / ${PROVIDER_API_KEY})
# - Sources .env.production from repo root (gitignored; holds the actual secrets)
# - Binds to 0.0.0.0:7878 so the security group rule routes inbound traffic in
#
# Usage:
#   cp .env.production.example .env.production
#   # edit .env.production: set API_KEY (your gateway auth) + PROVIDER_API_KEY (sk-cp-...)
#   ./scripts/start-local-public.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${REPO_ROOT}/.env.production"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "error: ${ENV_FILE} not found." >&2
  echo "hint:  cp .env.production.example .env.production  &&  edit it" >&2
  exit 64
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

: "${API_KEY:?API_KEY must be set in .env.production (your gateway auth key)}"
: "${PROVIDER_API_KEY:?PROVIDER_API_KEY must be set in .env.production (e.g. minimax sk-cp-...)}"

export GATEWAY_CONFIG="${REPO_ROOT}/config/production.json"

echo "Starting Pencil Gateway"
echo "  config:    ${GATEWAY_CONFIG}"
echo "  port:      7878 (bind 0.0.0.0)"
echo "  agent:     pencil/default (minimax-coding / MiniMax-M2.5)"
echo "  api key:   ${API_KEY:0:6}...${API_KEY: -4}  (use this in your local curl Authorization header)"
echo

exec npx --no-install tsx src/server.ts
