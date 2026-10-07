#!/usr/bin/env bash
set -euo pipefail

export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
MARKER="/var/lib/reqaml/openbao/.reqaml-dev-init-done"
SECRETS_DIR="/var/lib/reqaml/secrets"
TOKEN_FILE="${SECRETS_DIR}/openbao-root.token"

mkdir -p "$(dirname "$MARKER")" "$SECRETS_DIR"

bao_http_code() {
  curl -s -o /dev/null -w '%{http_code}' "$BAO_ADDR/v1/sys/health" 2>/dev/null || true
}

# Wait for the OpenBao listener (any HTTP status; 501/503 are expected before init/unseal).
for _ in $(seq 1 60); do
  code="$(bao_http_code)"
  if [[ -n "$code" && "$code" != "000" ]]; then
    break
  fi
  sleep 1
done

if [[ -f "${SECRETS_DIR}/openbao-unseal.key" ]]; then
  unseal_key="$(tr -d '\n' <"${SECRETS_DIR}/openbao-unseal.key")"
  bao operator unseal "$unseal_key" >/dev/null 2>&1 || true
fi
if [[ -f "$TOKEN_FILE" ]]; then
  export BAO_TOKEN="$(tr -d '\n' <"$TOKEN_FILE")"
fi

if [[ -f "$MARKER" ]]; then
  exit 0
fi

health_code="$(bao_http_code)"
if [[ "$health_code" == "501" ]]; then
  echo "Initializing dev OpenBao (1 key share; dev-only seal material)..."
  init="$(bao operator init -key-shares=1 -key-threshold=1 -format=json)"
  unseal="$(echo "$init" | jq -r '.unseal_keys_b64[0]')"
  root="$(echo "$init" | jq -r '.root_token')"

  echo "$unseal" >"${SECRETS_DIR}/openbao-unseal.key"
  chmod 600 "${SECRETS_DIR}/openbao-unseal.key"
  echo "$root" >"$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"

  bao operator unseal "$unseal" >/dev/null
  export BAO_TOKEN="$root"
elif [[ ! -f "$TOKEN_FILE" ]]; then
  echo "OpenBao is initialized but ${TOKEN_FILE} is missing; reset dev volumes: docker compose down -v" >&2
  exit 1
fi

# Dev marker (ARCH-DEVENV-KEYS / FIX-DENY-DEV-KEK-IN-PROD). Transit keys have no custom metadata
# endpoint, so the marker lives on the Transit mount description, which the app reads from
# GET /v1/sys/mounts/transit and refuses in production.
DEV_MARK="reqaml_dev=true: dev-only Transit KeyProvider (never valid in production)"
if bao secrets list -format=json | jq -e 'has("transit/")' >/dev/null; then
  bao secrets tune -description="$DEV_MARK" transit/ >/dev/null
else
  bao secrets enable -description="$DEV_MARK" transit >/dev/null
fi
if ! bao read transit/keys/reqaml-kek >/dev/null 2>&1; then
  bao write -f transit/keys/reqaml-kek \
    type=aes256-gcm96 \
    exportable=false \
    allow_plaintext_backup=false >/dev/null
fi

echo "ReqAML dev OpenBao initialized (dev-marked Transit mount, KEK reqaml-kek)."
touch "$MARKER"
