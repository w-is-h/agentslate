"""`slate serve [--host H] [--port N]` — everything runs in this one process."""

import sys

USAGE = """slate — shared state for you and your agent

  slate serve [--host H] [--port N]   web UI + MCP (/mcp) + hook endpoint
                                      default 127.0.0.1:8750; bind your VPN
                                      address to reach it from other machines
  SLATE_DB=path                       the sqlite file (default
                                      ~/.local/share/agentslate/slate.db)"""


def arg(argv, flag, default, cast=str):
    return cast(argv[argv.index(flag) + 1]) if flag in argv else default


def main():
    argv = sys.argv[1:]
    if argv[:1] == ["serve"]:
        from .app import serve

        serve(arg(argv, "--host", "127.0.0.1"), arg(argv, "--port", 8750, int))
    else:
        print(USAGE)
        sys.exit(0 if argv[:1] in (["-h"], ["--help"]) else 1)
