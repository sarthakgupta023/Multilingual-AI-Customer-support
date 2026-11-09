#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATA="$ROOT/.local-postgres"
if [ ! -f "$DATA/PG_VERSION" ]; then
  echo 'Local PostgreSQL cluster not initialized. See README.md.' >&2
  exit 1
fi
case "${1:-status}" in
  start) pg_ctl -D "$DATA" -l "$DATA/server.log" -o '-h 127.0.0.1 -p 55432' -w start ;;
  stop) pg_ctl -D "$DATA" -w stop ;;
  status) pg_ctl -D "$DATA" status ;;
  *) echo 'Usage: scripts/local-postgres.sh start|stop|status' >&2; exit 2 ;;
esac
