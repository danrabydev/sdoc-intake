#!/usr/bin/env bash
set -euo pipefail

mkdir -p /var/lib/reqalm/openbao /var/lib/reqalm/secrets

# Start Postgres using the official image entrypoint (background).
docker-entrypoint.sh postgres &
pg_pid=$!

# OpenBao server (dev file storage on persistent volume).
/usr/local/bin/bao server -config=/etc/openbao/openbao.hcl &
bao_pid=$!

# Block until Postgres + OpenBao are initialized (healthcheck-safe).
/wait-and-init-openbao.sh

term_handler() {
  kill "$pg_pid" "$bao_pid" 2>/dev/null || true
  wait "$pg_pid" "$bao_pid" 2>/dev/null || true
}
trap term_handler SIGTERM SIGINT

wait -n "$pg_pid" "$bao_pid"
exit $?
