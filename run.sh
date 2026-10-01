#!/usr/bin/env bash
# Runs the backend (NestJS, watch mode) and frontend (Vite) together.
# Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example to .env and fill it in." >&2
  exit 1
fi

[[ -d node_modules ]] || pnpm install

echo "Building shared types and running migrations..."
pnpm --filter @agent-board/shared build >/dev/null
pnpm db:migrate >/dev/null

pids=()

cleanup() {
  local code="${1:-0}"
  trap - INT TERM EXIT
  echo
  echo "Stopping backend and frontend..."
  for pid in "${pids[@]}"; do
    # Each service runs in its own process group; signal the whole group.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "Stopped."
  exit "$code"
}
trap 'cleanup 0' INT TERM
trap 'cleanup $?' EXIT

# Prefix each line of output with the service name.
start() {
  local name="$1" color="$2"
  shift 2
  set -m # give the background job its own process group
  ( "$@" 2>&1 | sed -u "s/^/$(printf '\033[%sm[%s]\033[0m ' "$color" "$name")/" ) &
  pids+=("$!")
  set +m
}

start shared 90 pnpm --filter @agent-board/shared watch
start api 34 pnpm --filter @agent-board/backend dev
start web 35 pnpm --filter @agent-board/frontend dev

echo "API: http://localhost:3000/api   Web: http://localhost:5173 (Vite picks the next free port if taken)"
echo "Press Ctrl+C to stop both."

# Exit (and stop the others) as soon as any service dies.
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A service exited; shutting down." >&2
      exit 1
    fi
  done
  sleep 1
done
