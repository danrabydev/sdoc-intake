#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${OPENBAO_TOKEN:-}" && -n "${OPENBAO_TOKEN_FILE:-}" && -f "$OPENBAO_TOKEN_FILE" ]]; then
  export OPENBAO_TOKEN="$(tr -d '\n' <"$OPENBAO_TOKEN_FILE")"
fi

# Wait for peripherals OpenBao token file when running in Compose before first init completes.
if [[ -z "${OPENBAO_TOKEN:-}" && -f /var/lib/reqalm/secrets/openbao-root.token ]]; then
  for _ in $(seq 1 90); do
    if [[ -s /var/lib/reqalm/secrets/openbao-root.token ]]; then
      export OPENBAO_TOKEN="$(tr -d '\n' </var/lib/reqalm/secrets/openbao-root.token)"
      break
    fi
    sleep 1
  done
fi

exec "$@"
