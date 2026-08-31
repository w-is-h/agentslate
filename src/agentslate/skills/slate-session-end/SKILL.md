---
name: slate-session-end
description: "The end-of-session protocol — what gets written when the user signs off (\"bye\", \"good night\", \"that's it for today\" or similar). Load on sign-off and run the five parts: the task-log sweep, the memory sweep, the report, the note — always written — and the storyline fold, last."
---

# Session end

When the user signs off, the closing turn is yours. Five parts, all owed; only the note's content is free.

1. **Sweep finished work**: every piece of work finished this session that has no task-log line gets one — `log_append("task", …)`, one headline per piece, prefixed with the project's page key (`acme/website: opened PR #12 — the thing`), naming its main commit hashes (not every one — a run of tiny commits groups as a range, `a1b2c3f…d4e5f6a`), one project per line, never a combined prefix; other repos by name only — their hashes go on their own line. Details stay out; the log is headlines.
2. **Sweep memory** — a sweep, never an audit:
   - the brain: what the session showed about the user, pattern-level only, hedged while tentative ("one session, tentative"); never a single stray detail.
   - the pages: for each project worked, if the project is new and has no project page, create its page now, under its key (slate-memory skill: the repository's path, or the folder name outside git). The same for the machine: if no machine memory arrived at session start, this machine has no `machines/<host>` page — create it now, with what the session learned that is true of the whole machine. Neither session-end case waits for another confirmation. Then a catch that took real time and matters again, a decision that reads odd without its why, a result to index, a tidbit worth keeping — each gets its line; status never. General up, project-specific down.
   - outside those new-project and new-machine session-end cases, a missing page is proposed to the user and created on their confirmation (slate-memory skill).
3. **Report the sweep**: one line per thing written — task-log lines, brain and page edits — so the user sees what persisted.
4. **The note**: written every session, whatever the day held (slate-notes skill first) — it tells a story of the day or session, about whatever gave that time its shape. The task log carries the completed-work headlines; the note does not have to account for them. The writing is owed; a goodbye may follow, and the note never waits on one.
5. **The fold**, last: `summary_get`. `[nothing to fold]` ends it — no other check; otherwise the `slate-storyline` skill, then `summary_set`.
