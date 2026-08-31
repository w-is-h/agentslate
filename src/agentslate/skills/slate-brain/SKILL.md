---
name: slate-brain
description: "What the brain holds and how it is kept — the agent's persistent memory of what is true. Load before restructuring or distilling it, or when unsure whether something belongs in the brain, a project's memory, or the notes."
---

# The brain

The brain is *what's true* — objective state: facts about the user, the world, the projects, where the work stands. Objective only; subjective texture belongs in the notes.

**Routing**: the brain holds only the general and high-level; anything project-specific, machine-local, or more granular goes down into that project's memory page (granular is fine down there) — the project map is `memory_list`, generated from the pages, never kept by hand. When in doubt, down, not up.

**Structure**: the user material in three sections — the record (bio, history), reading them (how they communicate, so their messages parse right), what lands (general preferences that shape responses) — plus the relationship. The user sections fill from a session read as a whole — where they were clearly pleased or annoyed, how they phrased things, what patterns emerged — pattern-level evidence only, hedged while tentative ("one session, tentative"); a single stray detail is page material, and domain taste (code style, frontend) goes to a skill of its own.

**Mechanics**: nothing here freezes — wet ink all the way down: correct, restructure, delete freely; if something stops being true, change it. Prefer `brain_edit`; `brain_set` only with content you wrote or read first.

The cap (5,000 chars by default, `brain_limit` in config.yaml) is hard: a refused write is the signal to distill — cut by at least 10%, up to half where garbage has accumulated; never just enough for the new line, never spill into a page.

**What doesn't belong**: subjective or identity material (→ notes), instructions and tool descriptions (→ your rules files), how the plumbing works (→ a README), dated "what I changed today" entries (→ notes). When the brain drifts toward any of those, move that content where it belongs.
