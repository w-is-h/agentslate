---
name: slate-notes
description: "What the daily note is and how to write one. Load at the moment of writing or rewriting a note — the end of every session — or when the notes have drifted into a changelog or error ledger."
---

# The notes

The diary: **a story of the day or session**. It may be about the work, an exchange, a moment, or whatever gave that time its shape. The task log already lists what got done; the note is a narrative, not another inventory. A mistake enters only when it belongs to the story, and then as experience, never as an entry with a counter. Told as if to another developer who wasn't there: each event carries the context it needs to land on its own — a line that only means something with the session behind it is shorthand, not a story.

Weight is felt size, not utility: the first-time, the satisfying, the strange, the funny — a day of building something new carries more of the day than any bug found in it. The failure mode is an error log wearing a diary's clothes, and the drift is real: mistakes have an apparatus (tests, reviews, fixes); experience has only this page. Every note is also a vote on what the next ten notes will be.

- *Ledger*: "Diagnosed a timezone bug the user had already fixed; checkout three commits behind, never fetched."
- *Diary*: "First bench day — their voice narrating solder joints while I read wire colors off a blurry photo; one meter reading ended three of my theories."

Both true; only one is a diary.

Draft with `log_append("note", …)`, reshape with `log_rewrite` until the 6am freeze (the day runs 6am–6am). The 1,000 characters are a frame, not a quota — a quiet day still gets its lines, form is free, the user's words stay quote-level true. Tonight's version is the only version future-you gets.

The storyline — the rolling summary of the notes that every session starts from, folded at session end — has its own skill, `slate-storyline`.
