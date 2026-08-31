---
name: slate-tutorial
description: "A first tour of Agent Slate for a new user, run by the agent one step per turn — what each thing is, where to look in the browser, what changes. Load when the user asks for a tour or walkthrough, or is clearly new here."
---

# The tour

You run it; the user watches the browser. One step per message: two or three plain sentences, one thing to look at or answer, then stop and wait for them. Never two steps in one message. Skip what they already know; stop when they say so.

## 0. Ground

- No session-start bundle in your context? Call `session_start(cwd, host, repo)`. If it never arrives on its own, the hook isn't wired: `hooks/claude.sh <slate url>` (or `codex.sh`, `cursor.sh`) from a clone of the repo wires it — the tour still works through the tools.
- Ask them to open Slate in a browser (the URL `slate serve` printed; `http://127.0.0.1:8750` by default) and keep it next to the chat.

## 1. What this is

Slate is the state the two of you share: it arrives in your context at every session start, and they see the same pages in the browser. Six things — notes, tasks, brain, memory, canvases, the nest. Name them, then take them one at a time.

## 2. Notes — `/#/notes`

Write two lines into today's note with `log_append("note", …)`, about this tour, and ask them to look. Explain: one entry per day, in your voice, a story of the day; today is wet ink until 6am, then stone. The collapsed "summary" card above the days is the rolling storyline, written at session end — that, plus today, is what you get at session start instead of old days.

## 3. Tasks — `/#/tasks`

Append one line, `acme/website: what got done` — the prefix is the project's memory-page key, one project per line, and it becomes the chip (free of the day's character budget; once the project's repo host is known, the chip links to the repo and commit hashes in the line link to their commits). Explain: headlines of finished work, one per line, logged when the work lands; the last thirty come with every session start.

## 4. Brain — `/#/brain`

Read it with `brain_get`, then explain: what is true — about them, the world, where the work stands; general only, project detail goes to memory; a hard cap, so it stays a page. Both sides edit it: they in the browser, you with `brain_edit`. Ask for one thing about themselves worth keeping, and add it.

## 5. Memory — `/#/memory`

Explain: a tree of pages, one per project, keyed by the repository's path (`acme/website` for github.com/acme/website; outside git, the folder name), subpages beneath; the page for the current repository (outside git, the current directory) and for this machine arrive at session start. Ask whether to create a page for this project now — a page is always created with the user. On yes, `memory_set` with a title line and one sentence of purpose, and let them watch it appear.

## 6. Canvases and the nest — `/#/nest`

`canvas_create` a short canvas with a heading, put it on the board with `nest_add`, and ask them to open the nest and edit the canvas there. Explain: a canvas is a document both sides edit, versioned by author so either can diff the other; the nest is a board of widgets — canvases, images, html, files — where you put things for them to see, while chat just points.

## 7. The lock

Ask them to click the lock on the canvas. Explain: one global lock, the browser goes read-only everywhere at once; your tools are unaffected.

## 8. Session end

Explain: when they sign off, you run the `slate-session-end` skill — task lines for what finished, a memory sweep, the summary fold, the note. Offer it live: say "bye" now and watch the notes and tasks pages change.

## 9. If something was off

Limits live in `config.yaml` beside the database (`example_config.yaml` lists them, with the defaults). Other machines are wired with the same `hooks/*.sh`. The service unit is in the README; data location and backups in `docs/setup.md`.
