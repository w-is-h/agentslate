---
name: slate-memory
description: "The spec of memory — what belongs in a page and what stays out, how pages are keyed and nested, how a page gets created, links, the ceiling and what a refused write means. Load for any memory work beyond a one-line edit — a new page, restructuring, a cap refusal."
---

# Memory writing

Memory has two readers: the future session that opens this project and needs to work fast and right, and the user, who reads the same pages in the UI. Write for both. Every line passes one test: could a reader get this from the repo? Then it stays out.

## What belongs, what stays out

A page explains what a project is, what took learning, and the odd thing worth keeping. Five kinds of line, nothing else:

- **Purpose** — what it is, what it does, for whom: a paragraph.
- **Catches** — what cost time once and cannot be changed: another system's behavior, hardware, a limit chosen on purpose, a small thing hard to find. A bug is fixed, never recorded; a quirk of our own code that can be fixed is fixed — memory never holds what a commit could remove.
- **Decisions** — only the important ones: not obvious from the code and still mattering for future work — with the why, dated and attributed. A routine call, or one the code itself makes plain, stays out.
- **Results** — one sentence per experiment stating the outcome, linking its canvas.
- **Tidbits** — loose bits that fit nowhere above: something fun, a stray observation, a thing that may be useful later. The bar is low — append freely, at any point in a session, and a bit of randomness is fine. Each tidbit ends with its date (`… (2026-08-31)`) so pruning is easy later; still short in size, and the first section to go when the page is trimmed.

Out: anything the repo answers — layout, config values, module behavior, ports, launch recipes, the current commit. A code change must never require a memory change. Out: status and progress — the repo and the project's task manager hold them; a handover for a thread that continues next session goes on a canvas on the project's board, written only when the user asks for it or wraps the session naming the continuation, never by default. Out: history (the conversation archive and git hold it), general knowledge. A line that stopped being true is deleted.

Canvas links belong only where the canvas is the artifact — a result, a document the project keeps on a canvas — never as overflow for what the page should say. Board state never goes in memory — a board is its own record.

Routing: every fact lives in the widest page it's true for — true of the whole machine → `machines/<host>`, true of this project → the project's page, true of one subsystem → that subpage; the brain holds only what crosses everything.

## Pages

Memory is a tree of pages. A page is keyed by a path; its subpages sit one segment below it, any depth: `acme/website` is a project's page, `acme/website/deploy` a subpage of it, `machines/myhost` a machine's page.

**Subpages are never listed by hand.** Every read of a page — the tools, the session-start bundle, the UI — appends the list of its subpages, generated from the tree: a link and the subpage's first line. So **the first line of a page is its title and must describe it** — it is the one line a reader sees before deciding to open it: `# Website — deployment and runtime notes`, never `# notes`. Plain words only: no code spans, quotes, or other markup in that line — it is rendered as a link label everywhere.

The project page is injected at session start when the project opens: purpose, catches, decisions, results, and the list of subpages. A subpage is one distinct concept, feature, or subsystem — the deeper dive behind one line of its parent. A subpage that withers folds back into its parent.

- **Keying**: a repository's page is keyed by the repository's path on its host — `github.com/acme/website` → `acme/website`; nested groups verbatim (`acme/platform/api`); host and `.git` dropped; case as the host has it. The session-start hook resolves the cwd's `origin` to that key — from any subfolder, worktree or machine — and no other key loads inside a repo. Outside git (no repo, or no remote) the key is the folder name (`blogs`), the parent folder prepended only when the name is taken (`acme/blogs`); the hook resolves the cwd by longest exact suffix against existing pages. Machines under `machines/`. Pages that are neither — a company, a topic — take any key, anywhere in the tree; an organisation's own page sits at the organisation's key (`acme`), above its repositories.
- **A page is created together with the user, with the session-end exceptions** — at any depth. During ordinary work, derive the key, propose it, and write on their ok; they may rename it, and a non-standard key is theirs to choose with the auto-load cost named in the proposal. At session end, if a project worked that session is new and has no project page, create its page under its key during the sweep without asking again; the same for the machine the session ran on when it has no `machines/<host>` page. When the user asks for a structure, however deep, build it as asked.
- Prefer `memory_edit`; `memory_set` only with a payload written literally or read first.

## Links

Links target page paths, the same shape as the UI's url: `[deploy](deploy)` a subpage or sibling of the current page, `[machines/myhost](machines/myhost)` any page by full path. A canvas mention is always a link — the id as text, the canvas's name (trimmed to ~50 chars) as the hover title: `[#341](#/canvas?id=341 "Benchmark results")`. Other things (skills, `file:line`) are prose, never pseudo-links.

## The ceiling

5,000 chars per page, enforced by the store; a ceiling, not a target — most pages live nowhere near it. A refused write: cut the page by at least 10%, and by up to half where garbage has accumulated — never just enough to squeeze the new line in — then add what you came to write; the headroom is the point. Tidbits go first, unless something else is plainly the bloat — a section that overgrew, lines gone stale — then that. Never spill into another page to dodge the cap; where a section has obviously earned its own subpage, propose the split at the refusal — the user decides, and the page is created on their word. The deeper editing — dedup, separating what earns its own page, currency — happens when the user asks for a review of the pages against these rules.

## Conventions

- **Human-readable prose**: full sentences, active voice, plain words — a page reads on the first pass, without the reader reconstructing context around fragments. Bad: "Wiring: backend needs `SEARCH_URL`; batch derived." Good: "The backend reaches the search service through `SEARCH_URL` and derives the batch endpoint from it." Identifiers (paths, SHAs, ids) stay exact; it's the prose around them that stays human.
- Wet ink: delete what stopped being true; rewrite what can be said shorter. A page that only grows is drifting.
- Duplication: usually remove; keep it only where it genuinely helps the reader.
- Machines by full hostname; paths name their machine (`myhost:~/x`).

## Staleness

The code is gold: a memory claim the repo contradicts is fixed or deleted in the same pass.
