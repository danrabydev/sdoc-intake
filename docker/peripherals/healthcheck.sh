#!/usr/bin/env bash
set -euo pipefail
pg_isready -U "${POSTGRES_USER:-reqalm}" -d "${POSTGRES_DB:-reqalm}" >/dev/null
curl -sf "http://127.0.0.1:8200/v1/sys/health" >/dev/null
