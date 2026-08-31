# How Slate works

[Back to the README](../README.md)

Agent Slate combines durable context for an agent with a shared workspace for the agent and user. Both are stored by one server and exposed through the same web UI and MCP connection.

## Session continuity

The session-start hook sends five pieces of state into each new agent session:

- recent completed-task entries;
- the notes storyline and today's note;
- the brain;
- memory for the current machine, selected by hostname;
- memory for the current project, selected from the working directory.

A project's memory page is keyed by its repository's path on its host — `acme/website` for `github.com/acme/website` — and a session opened anywhere inside a clone of that repository, on any machine, resolves to that page. Outside git the page is keyed by the folder name and selected by the working directory's path suffix. Machine pages live under `machines/<hostname>`.

The hook makes the opening context automatic in Claude Code, Codex CLI, and Cursor. Other MCP clients receive the same bundle by calling `session_start(cwd, host, repo)`.

## The state model

| State | Contents | Contract |
|---|---|---|
| **Notes** | The agent's account of the day's work in its own voice. | One entry per day, up to 1,000 characters. The current day remains editable until 6am. A rolling summary of up to 3,000 characters carries the storyline of the last weeks; session start injects the summary and today's note, and the slate-session-end skill folds the frozen days in. |
| **Task log** | Headlines for finished work, prefixed by project. | One daily entry of up to 1,000 characters; the last 30 tasks, in whole days, are injected at session start. |
| **Brain** | General, objective knowledge about the user, the world, and where the work stands. | Up to 5,000 characters. Project detail belongs in the project's memory page. |
| **Memory** | Project and machine knowledge arranged as a tree of pages. | Each page holds up to 5,000 characters — one tool fetch. Its first line is its title; direct subpages are listed automatically. |
| **Canvases** | Markdown documents written by the agent or user. | A version closes at an author handoff or when the same author returns after the configured idle gap (60 seconds by default). Canvases can also read a file directly from the server. |
| **Nest** | Named grid boards containing canvases, images, files, or HTML documents. | Boards are 4×4 by default, can be resized, and keep their layout between sessions. |

The limits are ceilings that keep session context focused. A write over a hard limit is rejected without changing the stored content. These are the defaults; each is set in `config.yaml` beside the database ([setup](setup.md#configuration)).

## Memory and the shared desk

The brain and memory pages answer, “What should a future session already know?” The brain carries general facts that apply everywhere. Memory pages carry knowledge specific to one project, subsystem, or machine.

Canvases and the nest answer, “What are we working on together?” An agent can place a report on a canvas, pin an image, share generated HTML, or collect files on a project board. The user can edit the same canvas or upload material for the agent to read.

This separation keeps durable context compact while allowing working documents to be as large and visual as the task requires.

## Tools and writes

The MCP tools cover logs, brain, memory, canvases, HTML documents, boards, and search. `search` looks across the long-lived state and shared documents.

Edit tools follow the same contract as an exact file edit: `*_edit` receives an exact `old_string` and `new_string`, then fails if the old text is absent or ambiguous. `*_set` replaces an entire document and is intended for content the agent has already read or composed in full.

The web UI writes as the user and MCP writes as the agent. Canvas autosaves are grouped until the author changes or the same author returns after the configured idle gap, which keeps meaningful checkpoints without producing a version for every keystroke. HTML documents save explicitly, so each save creates a snapshot.

## Built-in skills

A skill is a small set of instructions that an agent loads when its trigger matches. The wiring scripts link these skills into the harness:

| Skill | Purpose |
|---|---|
| `slate-notes` | Write the daily note as a concise account of the experience, rather than a changelog. |
| `slate-storyline` | Fold the frozen daily notes into the rolling summary the next session starts from. |
| `slate-brain` | Decide what belongs in general memory and keep it compact and current. |
| `slate-memory` | Structure project pages, route knowledge to the right page, and respect their limits. |
| `slate-session-end` | Sweep finished work and memory, report what was persisted, write the daily note and fold the storyline when the user signs off. |
| `slate-tutorial` | Walk a new user through Slate, one step per turn. |

Harnesses without native skill support can retrieve the same instructions through `skill_load`.

## Storage

Slate uses SQLite in WAL mode so the MCP server and web UI can work concurrently. The database holds all textual state and board metadata. Images and board files live in directories beside it.

All services run in one process and on one port:

- `/` serves the desktop and phone web UI;
- `/api` serves the UI's JSON and upload endpoints;
- `/mcp` is the Streamable HTTP MCP endpoint;
- `/hook/session-start` serves the state bundle used by harness hooks.
