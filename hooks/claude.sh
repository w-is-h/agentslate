#!/usr/bin/env bash
# Wire Claude Code on this machine to a running slate: register the MCP
# server, add the SessionStart hooks that put the state bundle in context
# (one curl per part — Claude Code caps a hook's output at 10k), link the
# skills in as native commands, and turn Claude Code's own auto memory off
# (slate is the memory).
#
#   hooks/claude.sh http://myhost:8750
#
# Idempotent: re-run with a new URL to repoint. Anything else in
# ~/.claude/settings.json is left alone.
set -euo pipefail

URL="${1:?usage: hooks/claude.sh http://host:port}"
URL="${URL%/}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if command -v claude >/dev/null; then
  claude mcp remove --scope user slate >/dev/null 2>&1 || true
  claude mcp add --transport http --scope user slate "$URL/mcp"
else
  echo "claude not on PATH — register the server yourself:"
  echo "  claude mcp add --transport http --scope user slate $URL/mcp"
fi

python3 - "$URL" <<'PY'
import json, os, sys

url = sys.argv[1]
path = os.path.expanduser("~/.claude/settings.json")
try:
    with open(path) as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}

TAG = "# slate"
curl = f'curl -fsS -m 10 "{url}/hook/session-start?part=%s"'
# the tasks part reports an unreachable slate; the rest stay silent (a
# failing hook command is shown to the user as an error)
cmds = [
    "printf '# where we are\\n\\nhost: %s\\ncwd:  %s\\nnow:  %s\\n' "
    "\"$(hostname -s)\" \"$(pwd)\" \"$(date '+%a %Y-%m-%d %H:%M %Z')\"",
    (curl % "tasks") + " || echo '[slate unreachable — no shared state this session]'",
    (curl % "notes") + " || true",
    (curl % "brain") + " || true",
    f'curl -fsS -m 10 -G --data-urlencode "path=$PWD" --data-urlencode "host=$(hostname -s)" '
    f'"{url}/hook/session-start?part=machine" || true',
    # an ssh-alias remote (git@github-x:o/r) hides the web host — resolve
    # the alias through ssh -G so the server can learn the repo's host
    'r=$(git remote get-url origin 2>/dev/null); '
    'case $r in *://*) ;; *:*) a=${r%%:*}; a=${a#*@}; '
    "case $a in *.*) ;; *) n=$(ssh -G \"$a\" 2>/dev/null | awk '/^hostname /{print $2}'); "
    '[ -n "$n" ] && [ "$n" != "$a" ] && r="git@$n:${r#*:}"; esac; esac; '
    f'curl -fsS -m 10 -G --data-urlencode "path=$PWD" --data-urlencode "repo=$r" '
    f'"{url}/hook/session-start?part=project" || true',
]
hooks = cfg.setdefault("hooks", {})
start = [h for h in hooks.get("SessionStart", [])
         if not any(TAG in x.get("command", "") for x in h.get("hooks", []))]
start.append({"hooks": [{"type": "command", "command": f"{c} {TAG}", "timeout": 15}
                        for c in cmds]})
hooks["SessionStart"] = start
# slate is the memory — Claude Code's own auto memory stays off
cfg["autoMemoryEnabled"] = False
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print(f"SessionStart hooks + auto memory off → {path}")
PY

# the skills as native commands (/slate-notes, /slate-session-end …): links into ~/.claude/skills
mkdir -p "$HOME/.claude/skills"
for d in "$HERE"/../src/agentslate/skills/*/; do
  n="$(basename "$d")"
  target="$HOME/.claude/skills/$n"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    echo "skill: $n skipped — $target already exists and is not a symlink"
    continue
  fi
  ln -s "$(cd "$d" && pwd)" "$target"
  echo "skill: $n → ~/.claude/skills/$n"
done

# The habits live in the user's rules file — a skill only loads when its
# trigger fires, and the scripts never edit rules files. Print the step.
echo
echo "one manual step: the habits ride in your rules file (a skill only loads"
echo "when its trigger fires). Add this to ~/.claude/CLAUDE.md, if not already there:"
echo
sed -n '/^```markdown$/,/^```$/p' "$HERE/../README.md" | sed '1d;$d'
echo
echo "done — add the snippet, then open a new claude session; the bundle arrives at start."
