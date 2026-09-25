#!/usr/bin/env bash
# Always-on install on the NVIDIA DGX Spark without Docker: systemd user services for the API and the web apps, using
# the GPU model servers on the Spark for the assistant / report LLM and the photo explanations.
#
#   scripts/spark.sh install     write the settings file (first time), build, install and start both services
#   scripts/spark.sh restart     rebuild the web app if the code changed, restart both services
#   scripts/spark.sh status      service state, model backends and the URLs to open
#   scripts/spark.sh tunnel      public https URL through a Cloudflare quick tunnel (always on); `tunnel off` removes it
#   scripts/spark.sh url         the current public URL, checked end to end
#   scripts/spark.sh reset       clear reports, bookings, lane sessions and evidence (keeps the seeded world)
#   scripts/spark.sh logs        follow the services' logs
#   scripts/spark.sh uninstall   stop and remove the services (keeps the settings file and the database)
#
# Settings live in ~/.config/vehiclesense/env (VHI_* variables, see app/backend/vhi/config.py). Ports: API_PORT (8120,
# localhost only) and WEB_PORT (3120, all interfaces). Browsers only need WEB_PORT: the web server proxies /api,
# /media and the /ws WebSocket to the API. Use either this or scripts/dev.sh, not both at once.
#
# A quick tunnel needs no Cloudflare account, but its *.trycloudflare.com hostname changes whenever the tunnel service
# restarts (restarting the API or web does not change it). A fixed hostname needs a named tunnel on your own domain.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/app/web"
UNITS="$HOME/.config/systemd/user"
ENV_FILE="${VHI_ENV_FILE:-$HOME/.config/vehiclesense/env}"
API_PORT="${API_PORT:-8120}"
WEB_PORT="${WEB_PORT:-3120}"
SERVICES=(vehiclesense-api vehiclesense-web)
TUNNEL=vehiclesense-tunnel
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/vehiclesense"
CLOUDFLARED="${CLOUDFLARED:-$(command -v cloudflared 2>/dev/null || echo "$HOME/bin/cloudflared")}"

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

write_tunnel_unit() {
  cat >"$UNITS/$TUNNEL.service" <<EOF
[Unit]
Description=VehicleSense AI - public URL (Cloudflare quick tunnel to :$WEB_PORT)
After=network-online.target vehiclesense-web.service
Wants=vehiclesense-web.service

[Service]
Environment=WEB_PORT=$WEB_PORT CLOUDFLARED=$CLOUDFLARED
ExecStart=$ROOT/scripts/spark.sh run-tunnel
Restart=always
RestartSec=5

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

cmd_run_tunnel() {  # the vehiclesense-tunnel service runs this
  mkdir -p "$STATE"
  rm -f "$STATE/public_url"
  : >"$STATE/tunnel.log"
  # wait for the web app, so the tunnel never advertises a dead origin
  for _ in $(seq 1 150); do curl -sf -m 2 "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1 && break; sleep 2; done
  # record the hostname Cloudflare assigns (word-word-word.trycloudflare.com, never api.trycloudflare.com)
  (tail -n +1 -F "$STATE/tunnel.log" 2>/dev/null | grep --line-buffered -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' \
     | while read -r u; do echo "$u" >"$STATE/public_url"; echo "$(date -Is) $u" >>"$STATE/url_history"; done) &
  exec "$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$WEB_PORT" >>"$STATE/tunnel.log" 2>&1
}

cmd_tunnel() {
  if [[ "${1:-on}" == off ]]; then
    systemctl --user disable --now "$TUNNEL" 2>/dev/null || true
    rm -f "$UNITS/$TUNNEL.service" "$STATE/public_url"
    systemctl --user daemon-reload
    say "public URL switched off"
    return
  fi
  [[ -x "$CLOUDFLARED" ]] || { echo "cloudflared not found: install it or set CLOUDFLARED=/path/to/cloudflared" >&2; exit 1; }
  write_tunnel_unit
  mkdir -p "$STATE"
  rm -f "$STATE/public_url"  # so the wait below cannot pick up the previous run's hostname
  : >"$STATE/tunnel.log"
  systemctl --user enable "$TUNNEL" >/dev/null 2>&1
  systemctl --user restart "$TUNNEL"
  say "waiting for Cloudflare to assign the public URL"
  for _ in $(seq 1 90); do
    [[ -s "$STATE/public_url" ]] && grep -q "Registered tunnel connection" "$STATE/tunnel.log" 2>/dev/null && break
    sleep 1
  done
  cmd_url 60
}

cmd_url() {  # [seconds to wait for the new hostname to answer]
  local u code=000 tries=$(( ${1:-0} / 3 + 1 ))
  u="$(cat "$STATE/public_url" 2>/dev/null || true)"
  if [[ -z "$u" ]]; then
    echo "  public URL: none (switch it on with: scripts/spark.sh tunnel)"
    return 1
  fi
  for _ in $(seq 1 "$tries"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$u/api/health" || true)
    [[ "$code" == 200 ]] && break
    sleep 3
  done
  echo "  public URL: $u   [health HTTP $code]"
}

cmd_reset() {
  systemctl --user stop vehiclesense-web vehiclesense-api
  (cd "$ROOT/app/backend" && "$ROOT/.venv/bin/python" -m vhi.seed --reset-runtime >/dev/null)
  systemctl --user start vehiclesense-api vehiclesense-web
  wait_up && say "demo reset: reports, bookings, lane sessions and evidence cleared; the seeded world is kept"
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
  if [[ -f "$UNITS/$TUNNEL.service" ]]; then
    printf '  %-18s %s\n' "$TUNNEL" "$(systemctl --user is-active "$TUNNEL" 2>/dev/null || true)"
    cmd_url || true
  fi
}

cmd_uninstall() {
  systemctl --user disable --now "$TUNNEL" "${SERVICES[@]}" 2>/dev/null || true
  for s in "$TUNNEL" "${SERVICES[@]}"; do rm -f "$UNITS/$s.service"; done
  systemctl --user daemon-reload
  say "removed the services (settings kept in $ENV_FILE)"
}

case "${1:-status}" in
  install) cmd_install ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  tunnel) cmd_tunnel "${2:-on}" ;;
  run-tunnel) cmd_run_tunnel ;;
  url) cmd_url 30 ;;
  reset) cmd_reset ;;
  logs) journalctl --user -f -n 100 -u vehiclesense-api -u vehiclesense-web -u "$TUNNEL" ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
