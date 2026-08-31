---
name: slate-storyline
description: "How the storyline is written — the rolling summary of the notes that every session starts from, folded at session end. Load before every fold (summary_get → summary_set), and when the storyline reads as private shorthand."
---

# The storyline

The storyline is the narrative of the work: what was built and decided over the last weeks, how it went, where it stands — told in order, weighted toward recent weeks. A session starts from it; the detail lives in the daily notes, the task log, memory and canvases, reached by `log_read`, `search`, `memory_get`, `canvas_get`.

**Written for a reader with no memory.** The reader is an agent that just booted: it has its rules, the brain and this page, nothing else. Every sentence has to land without the daily notes behind it.

- Real names — projects, tools, people, files, commit hashes, canvas ids — so the reader can search on from here. "the acme/website deploy review (#12)" leads somewhere; "a cold read of a stranger's repo" leads nowhere.
- No allusions, callbacks or in-jokes. A quote from the user comes with what it was about.
- Each paragraph stands alone and carries its when — a date, or "late August".
- Outcomes, not only moments: what was decided, what was left open, what comes next.
- Mistakes stay out. The notes hold them; this is the story of the work.
- A story of what happened, never what to do: no rules, instructions, preferences or notes on how the user communicates — those live in the rules files and the brain. What was decided is an event and belongs; the principle it expresses does not.

**Shape.** `summary_limit` chars (3,000 by default), hard cap. Chronological, oldest first, ending with where things stand now. Recency bias: the last two weeks in some detail, the month before in a paragraph, anything older in a few lines or gone — when room is needed, the oldest material goes first. Your voice, story and outcome; the task log's headlines and the brain's facts are not repeated, but the storyline names what they are about.

**The fold** — the last part of session end. One call, `summary_get`: it answers `[nothing to fold]` when no note has frozen since the last fold — then that's it, stop; nothing else is fetched or checked. Otherwise it returns the storyline and the frozen notes to fold in: rewrite, never append — integrate the new days, compress the old, keep it readable from the top — and write it with `summary_set`. Today's note is still wet and waits for the next fold. Nothing older than what `summary_get` shows is ever reread.
