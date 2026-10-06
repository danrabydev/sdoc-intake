#!/usr/bin/env sh
# Render PlantUML under docs/design/c4. Requires Java + plantuml on PATH.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v plantuml >/dev/null 2>&1; then
  echo "plantuml not found; install from https://plantuml.com/starting" >&2
  exit 1
fi
find "$ROOT/docs/design/c4" -name '*.puml' -print | while read -r f; do
  plantuml -tpng "$f"
done
echo "Rendered PNGs alongside .puml sources under docs/design/c4"
