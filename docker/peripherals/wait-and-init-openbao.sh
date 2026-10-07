#!/usr/bin/env bash
set -euo pipefail

export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"

for _ in $(seq 1 90); do
  # OpenBao answers /v1/sys/health with 501 (uninitialized) / 503 (sealed) before init/unseal, so wait for
  # *any* HTTP response here; openbao-init.sh does the init/unseal. (`curl -f` would spin the full timeout.)
  bao_code="$(curl -s -o /dev/null -w '%{http_code}' "$BAO_ADDR/v1/sys/health" 2>/dev/null || true)"
  if pg_isready -U "${POSTGRES_USER:-reqalm}" -d "${POSTGRES_DB:-reqalm}" >/dev/null 2>&1 \
    && [[ "$bao_code" != "000" && -n "$bao_code" ]]; then
    break
  fi
  sleep 1
done

/docker/openbao-init.sh
