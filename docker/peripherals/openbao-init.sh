#!/usr/bin/env bash
set -euo pipefail

export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
MARKER="/var/lib/reqaml/openbao/.reqaml-dev-init-done"
SECRETS_DIR="/var/lib/reqaml/secrets"
TOKEN_FILE="${SECRETS_DIR}/openbao-root.token"

mkdir -p "$(dirname "$MARKER")" "$SECRETS_DIR"

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

echo "Waiting for OpenBao..."
for _ in $(seq 1 60); do
  if curl -sf "$BAO_ADDR/v1/sys/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

health_code="$(curl -s -o /dev/null -w '%{http_code}' "$BAO_ADDR/v1/sys/health" || true)"
if [[ "$health_code" != "501" ]]; then
  if [[ -f "$TOKEN_FILE" ]]; then
    export BAO_TOKEN="$(tr -d '\n' <"$TOKEN_FILE")"
    if bao read transit/keys/reqaml-kek >/dev/null 2>&1; then
      touch "$MARKER"
      exit 0
    fi
  fi
fi

init="$(bao operator init -key-shares=1 -key-threshold=1 -format=json)"
unseal="$(echo "$init" | jq -r '.unseal_keys_b64[0]')"
root="$(echo "$init" | jq -r '.root_token')"

echo "$unseal" >"${SECRETS_DIR}/openbao-unseal.key"
chmod 600 "${SECRETS_DIR}/openbao-unseal.key"
echo "$root" >"$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

bao operator unseal "$unseal"
export BAO_TOKEN="$root"

bao secrets enable transit >/dev/null 2>&1 || true
if ! bao read transit/keys/reqaml-kek >/dev/null 2>&1; then
  bao write -f transit/keys/reqaml-kek \
    type=aes256-gcm96 \
    exportable=false \
    allow_plaintext_backup=false
  bao write transit/keys/reqaml-kek/custom_metadata \
    reqaml_dev=true \
    reqaml_purpose=dev-kek
fi

echo "ReqAML dev OpenBao initialized (dev-marked KEK reqaml-kek)."
touch "$MARKER"
