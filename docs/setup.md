# Beyond the quick start

[Back to the README](../README.md)

The README's quick start is the typical setup: Slate as a user service on an always-on machine, bound to its address on a private network (Tailscale or any VPN — never public), every agent machine wired with a hook script. This page covers the other cases. Slate is always one process on one port, serving the web UI, the MCP endpoint at `/mcp`, and the session-start endpoint the hooks fetch.

## One machine only

With no arguments, Slate binds to `127.0.0.1:8750` and is reachable only from the machine it runs on:

```sh
./start.sh
```

Wire the harness on that same machine with `hooks/claude.sh http://127.0.0.1:8750` (or `codex.sh`, `cursor.sh`). To open it up to other machines later, restart with `--host` set to a private address, as in the quick start.

### As a service on a personal machine

On Linux, the quick start's systemd user unit works as written — drop the `--host`/`--port` arguments from `ExecStart` to stay on `127.0.0.1:8750`. A user unit starts at login, which is what a personal machine wants; the `loginctl enable-linger` step is only for machines nobody logs into.

On macOS, the equivalent is a launch agent — `~/Library/LaunchAgents/com.agentslate.plist`, with `ProgramArguments` pointing at your clone (launchd does not expand `~`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.agentslate</string>
  <key>ProgramArguments</key>
  <array><string>/Users/you/agentslate/start.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
```

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agentslate.plist
```

It starts at login and restarts on failure; `launchctl bootout gui/$(id -u)/com.agentslate` stops it. launchd gives agents a minimal `PATH`, so the plist sets one that covers Homebrew's Node — adjust it if yours lives elsewhere.

## What the wiring scripts change

Each `hooks/*.sh` script makes four changes on the machine it runs on:

1. It registers `<url>/mcp` as the `slate` MCP server, in the harness's user-level config.
2. It adds a session-start hook that fetches the state bundle — recent tasks, the notes storyline and today's note, the brain, this machine's memory, this project's memory — and places it in the agent's context.
3. It links Slate's built-in skills into the harness's skills directory.
4. It turns the harness's own memory feature off, so Slate is the only memory: Claude Code's auto memory and Codex's memories (an existing `[memories]` section is left as you set it).

Unrelated settings are preserved. If a skill's name is already taken by a regular directory, the script leaves it alone and reports the collision. Open a new agent session after wiring so the hook runs.

## Another MCP client

Any Streamable HTTP MCP client can use Slate without the scripts by adding:

```text
http://100.64.0.1:8750/mcp
```

The server's instructions tell the agent how Slate is organized. Without a session-start hook, the agent loads the bundle itself by calling `session_start(cwd, host, repo)` at the start of a session — `repo` being the working directory's `git remote get-url origin`, empty outside git — and reads the built-in skills through the `skill_load` tool. The rules-file snippet from the quick start applies unchanged.

## Data location

By default, Slate stores its data under `~/.local/share/agentslate/`:

```text
slate.db    notes, tasks, brain, memory, canvases, and board metadata
images/     images embedded in canvases
nest/       files and images stored on boards
```

Set `SLATE_DB` to place the database elsewhere. The two storage directories are created beside it:

```sh
SLATE_DB=/srv/agentslate/slate.db ./start.sh --host 100.64.0.1 --port 8750
```

In a service unit, set it with `Environment=SLATE_DB=/srv/agentslate/slate.db` in the `[Service]` section.

## Configuration

Settings are read from `config.yaml` beside the database. `example_config.yaml` lists every key and its default, including the size limits and the idle time that starts a new canvas version; copy it and change what you want:

```sh
cp example_config.yaml ~/.local/share/agentslate/config.yaml
```

Every key is optional. The file is read at start; restart Slate after changing it.

## Back up Slate

A complete backup includes the SQLite database and the `images/` and `nest/` directories beside it.

When Slate is stopped, copy the whole data directory. While it is running, use SQLite's backup operation for a consistent database snapshot:

```sh
uv run python -c "import os, sqlite3; source=os.path.expanduser('~/.local/share/agentslate/slate.db'); sqlite3.connect(source).backup(sqlite3.connect('slate-backup.db'))"
```

Copy `images/` and `nest/` separately to preserve uploaded content. If `SLATE_DB` points elsewhere, use that database and its containing directory.
