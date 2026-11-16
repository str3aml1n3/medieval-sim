#!/usr/bin/env bash
# Run an export script with the repo on PYTHONPATH and ZenKit's harmless shutdown noise filtered out.
# usage: ./run.sh export_world.py      (set PYTHON=/path/to/python if it isn't on PATH)
set -o pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python}"
ROOT="$(pwd -W 2>/dev/null || pwd)"
# ZenKit's Python objects print "Exception ignored in __del__" at interpreter exit; hide only that noise.
PYTHONUNBUFFERED=1 PYTHONPATH="$ROOT" "$PY" -E -s "$@" 2>&1 \
  | grep -v "__del__\|Traceback (most recent call last)\|_delete\|Exception ignored\|site-packages\|^\s*~*\^*\s*$"
