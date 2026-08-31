#!/usr/bin/env bash
# Wire Codex CLI on this machine to a running slate: register the MCP
# server, add the SessionStart hook that puts the state bundle in context
# (hooks/session-start.py fetches every part), link the skills in as
# native commands, and turn Codex's own memories off (slate is the memory).
#
#   hooks/codex.sh http://myhost:8750
#
# Idempotent: re-run with a new URL to repoint. Other hooks in
# ~/.codex/hooks.json are left alone.
set -euo pipefail

URL="${1:?usage: hooks/codex.sh http://host:port}"
URL="${URL%/}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if command -v codex >/dev/null; then
  codex mcp remove slate >/dev/null 2>&1 || true
  codex mcp add slate --url "$URL/mcp"
else
  echo "codex not on PATH — register the server yourself:"
  echo "  codex mcp add slate --url $URL/mcp"
fi

python3 - "$URL" "$HERE/session-start.py" <<'PY'
import json, os, sys

url, script = sys.argv[1], sys.argv[2]
path = os.path.expanduser("~/.codex/hooks.json")
try:
    with open(path) as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {"hooks": {}}

hooks = cfg.setdefault("hooks", {})
start = [h for h in hooks.get("SessionStart", [])
         if not any("hooks/session-start.py" in x.get("command", "") for x in h.get("hooks", []))]
start.append({"matcher": "startup|resume|clear|compact",
              "hooks": [{"type": "command", "command": f"python3 {script} {url}",
                         "statusMessage": "Loading slate", "additionalContextLimit": 40000,
                         "timeout": 30}]})
hooks["SessionStart"] = start
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print(f"SessionStart hook → {path}")
PY

# slate is the memory: codex's own memories go off, unless the user has
# already configured the [memories] section themselves
python3 - <<'PY'
import os

path = os.path.expanduser("~/.codex/config.toml")
try:
    with open(path) as f:
        text = f.read()
except FileNotFoundError:
    text = ""
if "[memories]" in text:
    print(f"memories: left as configured in {path}")
else:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as f:
        if text and not text.endswith("\n"):
            f.write("\n")
        f.write("\n# slate is the memory — codex's own stays off\n"
                "[memories]\ngenerate_memories = false\nuse_memories = false\n")
    print(f"built-in memories off → {path}")
PY

# the skills as native commands: links into ~/.codex/skills
mkdir -p "$HOME/.codex/skills"
for d in "$HERE"/../src/agentslate/skills/*/; do
  n="$(basename "$d")"
  target="$HOME/.codex/skills/$n"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    echo "skill: $n skipped — $target already exists and is not a symlink"
    continue
  fi
  ln -s "$(cd "$d" && pwd)" "$target"
  echo "skill: $n → ~/.codex/skills/$n"
done

# The habits live in the user's rules file — a skill only loads when its
# trigger fires, and the scripts never edit rules files. Print the step.
echo
echo "one manual step: the habits ride in your rules file (a skill only loads"
echo "when its trigger fires). Add this to ~/.codex/AGENTS.md, if not already there:"
echo
sed -n '/^```markdown$/,/^```$/p' "$HERE/../README.md" | sed '1d;$d'
echo
echo "done — add the snippet, then open a new codex session; the bundle arrives at start."
