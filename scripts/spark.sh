#!/usr/bin/env bash
# Always-on install on the NVIDIA DGX Spark without Docker: systemd user services for the API and the web apps, using
# the GPU model servers on the Spark for the assistant / report LLM and the photo explanations.
#
#   scripts/spark.sh install     write the settings file (first time), build, install and start both services
#   scripts/spark.sh restart     rebuild the web app if the code changed, restart both services
#   scripts/spark.sh status      service state, model backends and the URLs to open
#   scripts/spark.sh logs        follow both services' logs
#   scripts/spark.sh uninstall   stop and remove the services (keeps the settings file and the database)
#
# Settings live in ~/.config/vehiclesense/env (VHI_* variables, see app/backend/vhi/config.py). Ports: API_PORT (8120,
# localhost only) and WEB_PORT (3120, all interfaces). Browsers only need WEB_PORT: the web server proxies /api,
# /media and the /ws WebSocket to the API. Use either this or scripts/dev.sh, not both at once.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/app/web"
UNITS="$HOME/.config/systemd/user"
ENV_FILE="${VHI_ENV_FILE:-$HOME/.config/vehiclesense/env}"
API_PORT="${API_PORT:-8120}"
WEB_PORT="${WEB_PORT:-3120}"
SERVICES=(vehiclesense-api vehiclesense-web)

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

host_ip() { tailscale ip -4 2>/dev/null | head -1 || true; }

write_env() {
  [[ -f "$ENV_FILE" ]] && return
  mkdir -p "$(dirname "$ENV_FILE")"
  local ip; ip="$(host_ip)"; ip="${ip:-$(hostname -I | awk '{print $1}')}"
  cat >"$ENV_FILE" <<EOF
# VehicleSense AI settings (VHI_* variables, see app/backend/vhi/config.py). After editing: scripts/spark.sh restart
# LLM for the owner assistant and report summaries: an OpenAI-compatible server on the GPU (TensorRT-LLM, vLLM, NIM).
VHI_LLM_URL=${VHI_LLM_URL:-http://127.0.0.1:8355/v1}
VHI_LLM_MODEL=${VHI_LLM_MODEL:-nvidia/Qwen3-30B-A3B-FP4}
# Vision-language model for plain-words photo explanations on the AI vision page (leave empty to switch off).
VHI_VLM_URL=${VHI_VLM_URL:-http://127.0.0.1:8101/v1}
VHI_VLM_MODEL=${VHI_VLM_MODEL:-vision}
# Base URL in report and check-in QR codes: an address phones can reach.
VHI_PUBLIC_BASE_URL=${VHI_PUBLIC_BASE_URL:-http://$ip:$WEB_PORT}
EOF
  say "wrote $ENV_FILE"
}

build_web() {
  # rewrites to the API are fixed at build time; rebuild when the port or the code changed
  local stamp="$WEB/.next/vhi-api-port"
  if [[ ! -f "$WEB/.next/BUILD_ID" || "$(cat "$stamp" 2>/dev/null)" != "$API_PORT" \
        || -n "$(find "$WEB/app" "$WEB/components" "$WEB/lib" "$WEB/next.config.mjs" -newer "$WEB/.next/BUILD_ID" -type f 2>/dev/null | head -1)" ]]; then
    say "building the web app"
    (cd "$WEB" && VHI_API_INTERNAL="http://127.0.0.1:$API_PORT" npx next build >/dev/null)
    echo "$API_PORT" >"$stamp"
  fi
}

write_units() {
  mkdir -p "$UNITS"
  cat >"$UNITS/vehiclesense-api.service" <<EOF
[Unit]
Description=VehicleSense AI - API (FastAPI, models, live pipeline) on :$API_PORT
After=network-online.target

[Service]
WorkingDirectory=$ROOT/app/backend
EnvironmentFile=$ENV_FILE
ExecStart=$ROOT/.venv/bin/python -m uvicorn vhi.main:app --host 127.0.0.1 --port $API_PORT
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  cat >"$UNITS/vehiclesense-web.service" <<EOF
[Unit]
Description=VehicleSense AI - web apps (Next.js) on :$WEB_PORT
After=vehiclesense-api.service
Wants=vehiclesense-api.service

[Service]
WorkingDirectory=$WEB
ExecStart=$WEB/node_modules/.bin/next start -p $WEB_PORT
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
}

wait_up() {
  for _ in $(seq 1 300); do
    curl -sf "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "not up after 5 minutes - see: scripts/spark.sh logs" >&2
  return 1
}

cmd_install() {
  [[ -x "$ROOT/.venv/bin/python" && -d "$WEB/node_modules" ]] || "$ROOT/scripts/dev.sh" setup
  "$ROOT/scripts/dev.sh" stop >/dev/null 2>&1 || true
  write_env
  (cd "$ROOT/app/backend" && "$ROOT/.venv/bin/python" -m vhi.ml.train --missing >/dev/null)
  build_web
  write_units
  systemctl --user enable --now "${SERVICES[@]}"
  say "starting (the first start seeds the database, about 1-2 minutes)"
  wait_up && cmd_status
}

cmd_restart() {
  build_web
  systemctl --user restart "${SERVICES[@]}"
  wait_up && cmd_status
}

cmd_status() {
  for s in "${SERVICES[@]}"; do printf '  %-18s %s\n' "$s" "$(systemctl --user is-active "$s" 2>/dev/null || true)"; done
  curl -sf "http://127.0.0.1:$WEB_PORT/api/system/status" | "$ROOT/.venv/bin/python" -c '
import json, sys
d = json.load(sys.stdin)
print("  database:", d["database"], "| bus:", d["bus"]["kind"])
print("  assistant + reports:", d["llm"]["backend"])
print("  photo explanations:", (d.get("vlm") or {}).get("backend") or "off")' 2>/dev/null || echo "  API not answering yet"
  local ip; ip="$(host_ip)"
  echo "  open: http://$(hostname -I | awk '{print $1}'):$WEB_PORT${ip:+  or  http://$ip:$WEB_PORT (Tailscale)}"
}

cmd_uninstall() {
  systemctl --user disable --now "${SERVICES[@]}" 2>/dev/null || true
  for s in "${SERVICES[@]}"; do rm -f "$UNITS/$s.service"; done
  systemctl --user daemon-reload
  say "removed the services (settings kept in $ENV_FILE)"
}

case "${1:-status}" in
  install) cmd_install ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) journalctl --user -f -n 100 -u vehiclesense-api -u vehiclesense-web ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
