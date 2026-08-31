#!/usr/bin/env python3
"""SessionStart hook for Codex CLI and Cursor: emit the slate bundle as context.

  session-start.py http://host:port          plain text on stdout (Codex)
  session-start.py http://host:port --json   {"additional_context": ...} (Cursor)

The harness's hook input arrives on stdin; the working directory is taken
from it (Codex: cwd, Cursor: workspace_roots[0]), its git remote from git.
"""

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime

url = sys.argv[1].rstrip("/")
as_json = "--json" in sys.argv[2:]
try:
    stdin = json.load(sys.stdin)
except Exception:
    stdin = {}
cwd = stdin.get("cwd") or (stdin.get("workspace_roots") or [os.getcwd()])[0]
host = os.uname().nodename.split(".")[0]
try:
    git = subprocess.run(
        ["git", "-C", cwd, "remote", "get-url", "origin"], capture_output=True, text=True
    )
    repo = git.stdout.strip()
except OSError:
    repo = ""

# an ssh-alias remote (git@github-x:o/r) hides the web host — resolve the
# alias through ssh -G so the server can learn the repo's host
if repo and "://" not in repo and ":" in repo:
    alias = repo.split(":", 1)[0].split("@")[-1]
    if "." not in alias:
        try:
            cfg = subprocess.run(["ssh", "-G", alias], capture_output=True, text=True).stdout
            real = next(
                (ln.split()[1] for ln in cfg.splitlines() if ln.startswith("hostname ")), ""
            )
            if real and real != alias:
                repo = f"git@{real}:{repo.split(':', 1)[1]}"
        except OSError:
            pass


def fetch(part, **params):
    q = urllib.parse.urlencode({"part": part, **params})
    try:
        with urllib.request.urlopen(f"{url}/hook/session-start?{q}", timeout=10) as r:
            return r.read().decode().strip()
    except Exception:
        return ""


now = datetime.now().astimezone().strftime("%a %Y-%m-%d %H:%M %Z")
parts = [f"# where we are\n\nhost: {host}\ncwd:  {cwd}\nnow:  {now}"]
tasks = fetch("tasks")
parts.append(tasks or "[slate unreachable — no shared state this session]")
for part in ("notes", "brain"):
    if text := fetch(part):
        parts.append(text)
if text := fetch("machine", path=cwd, host=host):
    parts.append(text)
if text := fetch("project", path=cwd, repo=repo):
    parts.append(text)
bundle = "\n\n".join(parts)
print(json.dumps({"additional_context": bundle}) if as_json else bundle)
