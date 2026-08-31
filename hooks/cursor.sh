#!/usr/bin/env bash
# Wire Cursor on this machine to a running slate: register the MCP server
# in ~/.cursor/mcp.json, add the sessionStart hook that puts the state
# bundle in context (hooks/session-start.py --json fetches every part), and
# link the skills in as native skills.
#
#   hooks/cursor.sh http://myhost:8750
#
# Idempotent: re-run with a new URL to repoint. Other servers in mcp.json
# and other hooks in hooks.json are left alone.
set -euo pipefail

URL="${1:?usage: hooks/cursor.sh http://host:port}"
URL="${URL%/}"
HERE="$(cd "$(dirname "$0")" && pwd)"

python3 - "$URL" "$HERE/session-start.py" <<'PY'
import json, os, sys

url, script = sys.argv[1], sys.argv[2]


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, cfg):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")


path = os.path.expanduser("~/.cursor/mcp.json")
cfg = load(path, {})
cfg.setdefault("mcpServers", {})["slate"] = {"url": f"{url}/mcp"}
save(path, cfg)
print(f"MCP server slate → {path}")

path = os.path.expanduser("~/.cursor/hooks.json")
cfg = load(path, {"version": 1, "hooks": {}})
hooks = cfg.setdefault("hooks", {})
start = [h for h in hooks.get("sessionStart", []) if "hooks/session-start.py" not in h.get("command", "")]
start.append({"command": f"python3 {script} {url} --json", "timeout": 30})
hooks["sessionStart"] = start
save(path, cfg)
print(f"sessionStart hook → {path}")
PY

# the skills as native skills: links into ~/.cursor/skills
mkdir -p "$HOME/.cursor/skills"
for d in "$HERE"/../src/agentslate/skills/*/; do
  n="$(basename "$d")"
  target="$HOME/.cursor/skills/$n"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    echo "skill: $n skipped — $target already exists and is not a symlink"
    continue
  fi
  ln -s "$(cd "$d" && pwd)" "$target"
  echo "skill: $n → ~/.cursor/skills/$n"
done

# Cursor accepts the sessionStart hook's output but never injects it (open
# Cursor bug, forum #158452) — the agent loads the bundle itself, told to by
# the rules snippet. The script can't reach User Rules, so print the step.
echo
echo "one manual step: Cursor does not inject sessionStart hook output (open"
echo "Cursor bug), so the agent loads the bundle through the rules snippet."
echo "Add this to Cursor Settings → Rules → User Rules:"
echo
sed -n '/^```markdown$/,/^```$/p' "$HERE/../README.md" | sed '1d;$d'
echo
echo "done — add the snippet above, then open a new Cursor agent conversation."
