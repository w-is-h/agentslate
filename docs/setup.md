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

## Public MCP, private dashboard

Optional, and only for agents that cannot join the private network — a cloud sandbox, a CI runner, a machine that is not yours. Everywhere else the quick start is the whole story: Slate bound to a private address, no proxy, no token.

Slate has no authentication of its own, and `/mcp` is not a write-only inbox: every tool is behind it, so an open `/mcp` is an open brain. What makes this safe enough is a reverse proxy that owns the only public listener and passes exactly two paths through, only with a bearer token:

- `/mcp` — the MCP endpoint.
- `/hook/session-start` — the state bundle the wiring scripts fetch at session start. Leave it out and remote agents simply start cold and call `session_start(cwd, host, repo)` themselves.

Everything else — the web UI, `/api` — stays on the private network, where it needs no token.

`deploy/` holds the three files this takes, each parameterized: nothing in them names your machine, and the values live in one environment file you keep on the server.

### The values

Copy `deploy/slate.env.example` to `/etc/slate.env` and fill it in:

```sh
SLATE_DOMAIN=slate.example.com    # a name on a domain you own, pointed at this machine
SLATE_TOKEN=…                     # openssl rand -hex 32
SLATE_PRIVATE_IP=100.64.0.1       # the VPN or VPC address the dashboard is served on
SLATE_PORT=8750                   # the port agents in the network already use
SLATE_UPSTREAM=127.0.0.1:8750     # where Slate itself listens
```

The token is the whole boundary for the public endpoint, so the file belongs to Caddy and to no one else:

```sh
sudo install -o root -g caddy -m 640 slate.env /etc/slate.env
```

`SLATE_DOMAIN` has to be **a domain you own**, with an A record pointing at the machine; Caddy gets the certificate for it on its own, so the name must resolve before Caddy starts, and ports 80 and 443 must be open to the internet — and only those.

Resist the wildcard-DNS shortcut — `sslip.io`, `nip.io`, and the rest. None of them are on the [Public Suffix List](https://publicsuffix.org/list/), so Let's Encrypt counts every certificate under them against one shared quota for the whole service; issuance fails once the week's is spent, by strangers, and you find out at renewal. The address also carries the machine's IP in it, so a new IP re-wires every agent.

If a CDN or proxy already answers for the name, it terminates TLS itself and reads everything that passes — the memory and the brain in both directions, and the bearer token with them. Either point the record straight at the machine, or accept that the proxy is a party to the state you keep here.

### The proxy

With [Caddy](https://caddyserver.com) installed as a system service:

```sh
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo cp deploy/caddy.service.d/slate.conf /etc/systemd/system/caddy.service.d/
sudo systemctl daemon-reload && sudo systemctl restart caddy
```

The Caddyfile reads every value as `{$SLATE_…}`, substituted when Caddy loads the config, which is why the drop-in points the service at `/etc/slate.env`. It serves two listeners: the private address, with the dashboard and `/api` and `/mcp` behind no token at all, and the public name, where only the two paths above answer and only with the token — everything else is a 404, token or not. The private listener keeps the address agent machines already use, so nothing inside the network has to be rewired; it binds a VPN interface, which may appear after Caddy starts, so the drop-in also asks systemd to retry.

### Slate itself

Slate moves back to the loopback address, where nothing but the proxy can reach it. In the systemd unit from the quick start:

```ini
ExecStart=%h/agentslate/start.sh --host 127.0.0.1 --port 8750
Environment=SLATE_URL=http://100.64.0.1:8750
```

`SLATE_URL` is the address Slate names when it hands out a link of its own — the bound one is now the loopback, which is nobody's address but the server's.

### The agents

Machines outside the network wire to the public name with the token as a second argument:

```sh
hooks/claude.sh https://slate.example.com <token>   # Claude Code
hooks/codex.sh  https://slate.example.com <token>   # Codex CLI — also needs SLATE_TOKEN exported
hooks/cursor.sh https://slate.example.com <token>   # Cursor
```

The token goes into that machine's harness config in the clear, the same way any MCP key does, and it grants everything: full read and write of the memory, the brain, the logs, the canvases and the boards. One machine losing it means changing `/etc/slate.env`, reloading Caddy, and re-running the scripts everywhere. Treat a public `/mcp` as the exception for agents that have no other way in — machines you can put on the network belong on the network.

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
