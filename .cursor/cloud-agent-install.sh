#!/usr/bin/env bash
# Cursor Cloud Agent install — idempotent; safe on Linux, macOS/WSL Git Bash (LF line endings).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not on PATH (expected Node 22 from .cursor/Dockerfile base image)" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: Node >= 22 required (got $(node -v))" >&2
  exit 1
fi

export COREPACK_ENABLE_AUTO_PIN=0
corepack enable
corepack prepare pnpm@10.33.3 --activate 2>/dev/null || true

pnpm install --frozen-lockfile

install_py_deps() {
  if python3 -m pip install --user 'pyyaml>=6.0' 'ruamel.yaml>=0.18' 2>/dev/null; then
    export PATH="${HOME}/.local/bin:${PATH}"
  else
    python3 -m pip install --break-system-packages 'pyyaml>=6.0' 'ruamel.yaml>=0.18'
  fi
}

if ! python3 -c "import yaml, ruamel" 2>/dev/null; then
  install_py_deps
fi
python3 -c "import yaml; from ruamel.yaml import YAML"

echo "cloud-agent-install: ok (node $(node -v), pnpm $(pnpm -v), python3 $(python3 --version))"
