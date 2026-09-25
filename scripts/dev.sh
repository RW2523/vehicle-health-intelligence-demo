#!/usr/bin/env bash
# One-command local runner for the VehicleSense AI demo (no Docker needed).
#
#   scripts/dev.sh setup     create .venv, install Python + Node dependencies
#   scripts/dev.sh start     seed (if needed), train missing models, build the web app, start API :8000 + web :3000
#   scripts/dev.sh stop      stop both servers
#   scripts/dev.sh restart   stop + start
#   scripts/dev.sh status    show what is running
#   scripts/dev.sh seed      re-seed reference data, vehicles, history and fleets from data/curated (--force)
#   scripts/dev.sh reset     clear reports, bookings, lane sessions and evidence (keeps the seeded world), then start
#   scripts/dev.sh train     retrain the tabular/audio models (vision models are committed; see README)
#   scripts/dev.sh test      backend test suite (pytest)
#   scripts/dev.sh e2e       Playwright end-to-end tests against the running servers
#   scripts/dev.sh logs      tail both server logs
#
# Environment: VHI_DATABASE_URL (default SQLite), VHI_MQTT_URL (default in-process bus), VHI_OLLAMA_URL (optional LLM),
# API_PORT (8000), WEB_PORT (3000), PYTHON (python3.11+ used to create the venv).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACK="$ROOT/app/backend"
WEB="$ROOT/app/web"
VENV="$ROOT/.venv"
RUN="$BACK/var/run"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"
PY="$VENV/bin/python"
mkdir -p "$RUN"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

running() { [[ -f "$RUN/$1.pid" ]] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

stop_one() {
  local name=$1
  if running "$name"; then
    local pid; pid=$(cat "$RUN/$name.pid")
    pkill -P "$pid" 2>/dev/null || true   # child processes (e.g. next-server workers)
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    say "stopped $name (pid $pid)"
  fi
  rm -f "$RUN/$name.pid"
}

wait_http() {
  local url=$1 name=$2
  for _ in $(seq 1 300); do
    curl -sf "$url" >/dev/null 2>&1 && { say "$name ready: $url"; return 0; }
    sleep 1
  done
  echo "$name did not come up - see $RUN/$name.log" >&2
  return 1
}

cmd_setup() {
  local base="${PYTHON:-python3}"
  [[ -x "$PY" ]] || { say "creating $VENV"; "$base" -m venv "$VENV"; }
  "$PY" -m pip install -q --upgrade pip
  "$PY" -m pip install -q -r "$BACK/requirements.txt"
  say "installing web dependencies"
  (cd "$WEB" && npm ci --no-audit --no-fund)
  say "setup done"
}

cmd_seed() { (cd "$BACK" && "$PY" -m vhi.seed --force); }

cmd_reset() {
  cmd_stop
  (cd "$BACK" && "$PY" -m vhi.seed --reset-runtime)
  say "runtime state cleared (reports, bookings, lane sessions, evidence); the seeded demo world is kept"
  cmd_start
}

cmd_train() { (cd "$BACK" && "$PY" -m vhi.ml.train "$@"); }

cmd_start() {
  [[ -x "$PY" ]] || cmd_setup
  [[ -d "$WEB/node_modules" ]] || (cd "$WEB" && npm ci --no-audit --no-fund)
  say "training any missing models"
  (cd "$BACK" && "$PY" -m vhi.ml.train --missing >/dev/null)
  if [[ ! -f "$WEB/.next/BUILD_ID" || -n "$(find "$WEB/app" "$WEB/components" "$WEB/lib" -newer "$WEB/.next/BUILD_ID" -type f 2>/dev/null | head -1)" ]]; then
    say "building the web app"
    (cd "$WEB" && npx next build >"$RUN/web-build.log" 2>&1) || { tail -30 "$RUN/web-build.log"; exit 1; }
  fi
  if ! running api; then
    say "starting API on :$API_PORT (seeds the database on first run)"
    (cd "$BACK" || exit 1; nohup "$PY" -m uvicorn vhi.main:app --host 0.0.0.0 --port "$API_PORT" >"$RUN/api.log" 2>&1 </dev/null & echo $! >"$RUN/api.pid")
  fi
  wait_http "http://127.0.0.1:$API_PORT/api/health" api
  if ! running web; then
    say "starting web on :$WEB_PORT"
    (cd "$WEB" || exit 1; VHI_API_INTERNAL="http://127.0.0.1:$API_PORT" nohup ./node_modules/.bin/next start -p "$WEB_PORT" >"$RUN/web.log" 2>&1 </dev/null & echo $! >"$RUN/web.pid")
  fi
  wait_http "http://127.0.0.1:$WEB_PORT/" web
  say "open http://localhost:$WEB_PORT  (API docs: http://localhost:$API_PORT/docs)"
}

cmd_stop() { stop_one web; stop_one api; }

cmd_status() {
  for n in api web; do
    if running "$n"; then echo "$n: running (pid $(cat "$RUN/$n.pid"))"; else echo "$n: stopped"; fi
  done
  curl -sf "http://127.0.0.1:$API_PORT/api/system/status" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print("database:", d["database"], "| bus:", d["bus"]["kind"], "| assistant:", d["llm"]["backend"])' 2>/dev/null || true
}

cmd_test() { (cd "$BACK" && "$PY" -m pytest -q "$@"); }

cmd_e2e() {
  local chromium="PW_CHROMIUM="
  [[ -x /opt/pw-browsers/chromium ]] && chromium="PW_CHROMIUM=/opt/pw-browsers/chromium"
  (cd "$WEB" && env "$chromium" VHI_PYTHON="$PY" E2E_BASE_URL="http://localhost:$WEB_PORT" npx playwright test "$@")
}

cmd_logs() { tail -n 50 -f "$RUN/api.log" "$RUN/web.log"; }

case "${1:-start}" in
  setup) cmd_setup ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  seed) cmd_seed ;;
  reset) cmd_reset ;;
  train) shift; cmd_train "$@" ;;
  test) shift; cmd_test "$@" ;;
  e2e) shift; cmd_e2e "$@" ;;
  logs) cmd_logs ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
