#!/usr/bin/env bash
set -euo pipefail

export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"

for _ in $(seq 1 90); do
  if pg_isready -U "${POSTGRES_USER:-reqaml}" -d "${POSTGRES_DB:-reqaml}" >/dev/null 2>&1 \
    && curl -sf "$BAO_ADDR/v1/sys/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

/docker/openbao-init.sh
