#!/usr/bin/env bash
# Build the UI when it is missing or older than its sources, then serve.
# Arguments go to `slate serve`:  ./start.sh --host 100.64.0.1 --port 8750
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"   # where uv installs itself; systemd does not carry it
built=src/agentslate/static/index.html
if [ ! -f "$built" ] || [ -n "$(find frontend -path frontend/node_modules -prune -o -type f -newer "$built" -print -quit)" ]; then
  (cd frontend && npm install --silent && npm run build)
fi
exec uv run slate serve "$@"
