#!/usr/bin/env bash
# Stops the local harness. `--clean` also deletes dev/local-supabase/.data.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$HERE/.data"
PG_CTL="${PG_CTL:-$(command -v pg_ctl || echo /opt/homebrew/bin/pg_ctl)}"

for svc in gateway postgrest; do
  pidfile="$DATA/$svc.pid"
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo "stopped $svc ($pid)"
    fi
    rm -f "$pidfile"
  fi
done

if [[ -f "$DATA/pg/postmaster.pid" ]]; then
  "$PG_CTL" -D "$DATA/pg" -m fast -w stop >/dev/null && echo "stopped postgres"
fi

if [[ "${1:-}" == "--clean" ]]; then
  rm -rf "$DATA" && echo "removed $DATA"
fi
