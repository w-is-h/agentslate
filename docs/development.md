# Development

[Back to the README](../README.md)

Agent Slate has a Python backend and a React frontend. The production frontend is compiled into the Python package and served by the same process as the API and MCP server.

## Run locally

From the repository root, start the backend:

```sh
uv run slate serve
```

For frontend development, run Vite in a second terminal:

```sh
cd frontend
npm install
npm run dev
```

Vite serves the development UI and proxies `/api` to the backend on `127.0.0.1:8750`.

To build the frontend into `src/agentslate/static/`:

```sh
cd frontend
npm run build
```

`./start.sh` performs this build automatically when the compiled UI is missing or older than its sources.

## Checks

Run the backend checks from the repository root:

```sh
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Run the frontend checks from `frontend/`:

```sh
npm run lint
npm run build
```

## Repository map

| Path | Responsibility |
|---|---|
| `src/agentslate/store.py` | SQLite schema, storage operations, limits, and data directories. |
| `src/agentslate/mcp.py` | MCP server instructions and tools. |
| `src/agentslate/api.py` | Web API, uploads, and session-start endpoint. |
| `src/agentslate/nest.py` | Board, widget, file, image, and HTML operations. |
| `src/agentslate/views.py` | Text and session-context views over stored state. |
| `src/agentslate/app.py` | FastAPI application and the combined web/MCP process. |
| `frontend/src/pages/` | Desktop pages and the compact phone application. |
| `frontend/src/components/` | Shared UI, editors, and nest components. |
| `frontend/src/api/`, `frontend/src/hooks/`, `frontend/src/lib/` | Browser data access, stateful behavior, and pure helpers. |
| `hooks/` | Claude Code, Codex CLI, and Cursor wiring scripts. |
| `src/agentslate/skills/` | The built-in skills. |
| `tests/` | Storage behavior and regression tests. |

Runtime settings default in `DEFAULTS` near the top of `src/agentslate/store.py`; `config.yaml` beside the database overrides them ([setup](setup.md#configuration)).

## A populated demo

`demo/seed.py` fills an empty database with an invented week — a staff engineer and her agent: notes, tasks, brain, memory pages, canvases with history, an html document, images and a file on three boards. Point it at its own database and serve that:

```sh
SLATE_DB=~/.local/share/agentslate-demo/slate.db uv run python demo/seed.py
SLATE_DB=~/.local/share/agentslate-demo/slate.db ./start.sh --port 8751
```

It refuses a database that already has content; delete the directory to reseed.
