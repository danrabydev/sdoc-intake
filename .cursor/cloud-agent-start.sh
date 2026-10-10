#!/usr/bin/env bash
# Cursor Cloud Agent start — no long-running services; tests use in-process PGlite (no Docker).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null
command -v pnpm >/dev/null
command -v python3 >/dev/null
python3 -c "import yaml; from ruamel.yaml import YAML"

# Optional: hybrid devenv uses Docker Compose on the host; cloud agents do not require it for pnpm test.
exit 0
