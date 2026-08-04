#!/usr/bin/env bash
# Package phi-portal-backend/src into a Lambda zip (handlers/ + lib/).
# Usage: ./scripts/package-lambdas.sh [output.zip]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist/phi-portal-lambdas.zip}"
STAGE="$(mktemp -d)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$STAGE/handlers" "$STAGE/lib"
cp "$ROOT"/phi-portal-backend/src/handlers/*.js "$STAGE/handlers/"
cp "$ROOT"/phi-portal-backend/src/lib/common.js "$STAGE/lib/"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$STAGE" && zip -r "$OUT" handlers lib)
echo "Wrote $OUT ($(wc -c < "$OUT") bytes)"
unzip -l "$OUT"
