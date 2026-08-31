"""The MCP server — the agent's interface to the store.

Tool contracts mirror an agent's native file tools: *_edit takes an exact
old_string/new_string and fails on zero or ambiguous matches; reads clip
at a limit with a continuation footer. Mounted at /mcp by app.py.
"""

import functools
import io
import mimetypes
import os
import shutil
import threading
from contextlib import contextmanager

from mcp.server import MCPServer
from mcp.server.mcpserver import Image as MCPImage
from mcp.server.mcpserver.exceptions import ToolError

from . import store, views
from .store import connect

FETCH_LIMIT = store.FETCH_LIMIT
SKILLS = os.path.join(os.path.dirname(__file__), "skills")
SERVER_URL = "http://127.0.0.1:8750"  # app.serve overwrites with the bound address

INSTRUCTIONS = f"""Agent Slate is the shared state between you and the user — persistent across sessions, machines and harnesses; the user sees all of it in the web UI.

When to act:
- Session start: the bundle (tasks, notes, brain, machine and project memory) arrives through a hook; if it hasn't, call session_start(cwd, host, repo) first (repo = `git remote get-url origin` in the cwd, empty outside git).
- As work lands: log_append("task", "acme/website: a1b2c3f — what") — one headline per finished piece naming its main commits, prefixed with the project's page key, one project per line; details go to its memory page.
- Deliverables (reports, designs, documents) go on a nest canvas, with a one-line pointer in chat.
- Session end: when the user signs off, load the `slate-session-end` skill and run it.
- Writes: *_edit takes exact old_string/new_string and fails on zero or ambiguous matches; *_set replaces wholesale — only with content you wrote or read first.

What lives here:
- notes: one entry per day, at most {store.NOTE_LIMIT} chars — a story of the day, written at session end (`slate-notes` skill). The summary (summary_get / summary_set, {store.SUMMARY_LIMIT} chars) is the storyline, folded at session end (`slate-storyline` skill).
- tasks: headlines only; a day holds {store.TASK_LIMIT} chars, prefixes excluded.
- brain: what is true — the user, the world, where the work stands; general only, at most {store.BRAIN_LIMIT:,} chars; project detail goes to memory. Prefer brain_edit; the `slate-brain` skill before restructuring.
- memory: a tree of pages. A project's page is keyed by its repository's path on its host (`acme/website`), a project outside git by its folder name, subpages beneath (`acme/website/deploy`). A page holds purpose, catches, decisions, results and tidbits (dated, appended freely at any time) — never what the repo answers. A new page is created with the user; the `slate-memory` skill beyond a one-line edit.
- canvases and the nest: live documents the user edits in the UI; named boards of widgets (canvases, images, html, files).
- search covers everything above."""

mcp = MCPServer("slate", instructions=INSTRUCTIONS, log_level="WARNING")


def tool(fn):
    """Register a tool whose refusals reach the model: only a ToolError
    carries its message through the SDK; every ValueError (a cap, a
    missing page, a full board) becomes one."""

    @functools.wraps(fn)
    def run(*args, **kwargs):
        # one at a time: an *_edit is a read-modify-write, and two of them
        # landing together on one page would lose one — the agent does
        # fire edits in parallel
        with TOOLS:
            try:
                return fn(*args, **kwargs)
            except ValueError as e:
                raise ToolError(str(e)) from e

    return mcp.tool()(run)


TOOLS = threading.Lock()


def _clip(text, offset, limit):
    if offset:
        text = text[offset:]
    if len(text) <= limit:
        return text
    return (
        text[:limit] + f"\n[…{len(text) - limit:,} more chars — continue with "
        f"offset={offset + limit}]"
    )


def _edit(content, old_string, new_string, replace_all):
    if not old_string:
        raise ValueError("old_string must not be empty")
    n = content.count(old_string)
    if n == 0:
        raise ValueError("old_string not found — nothing changed")
    if n > 1 and not replace_all:
        raise ValueError(
            f"old_string matches {n} times — add context to make it unique, or pass replace_all"
        )
    return content.replace(old_string, new_string)


@contextmanager
def _write_lock(db):
    """Hold SQLite's writer lock across an MCP read-modify-write."""
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
    except Exception:
        db.rollback()
        raise


# ------------------------------------------------------------ session start


@tool
def session_start(cwd: str = "", host: str = "", repo: str = "") -> str:
    """The session-start bundle: task log, notes, brain, this machine's
    memory (machines/<host>) and the project memory — the page keyed by
    the repository's path, resolved from repo (the cwd's `git remote
    get-url origin`) or, outside git, by the cwd's path suffix. Call it
    first when no bundle arrived through a hook."""
    return views.session_bundle(cwd, host, repo=repo)


# --------------------------------------------------------------- daily logs


@tool
def log_read(
    log: str, day: str = "", grep: str = "", offset: int = 0, limit: int = FETCH_LIMIT
) -> str:
    """Read a daily log ('note' or 'task'). No args: the recent view shown at
    session start. day=YYYY-MM-DD: that day's entry. grep: matching lines
    across the whole log (case-insensitive substring). Returns at most limit
    chars from offset, with a continuation footer when cut."""
    views.log_cfg(log)
    db = connect()
    if day:
        hit = views.log_day(db, log, day)
        if hit is None:
            raise ValueError(f"no entry for {day}")
        return _clip(f"## {day}\n{hit}", offset, limit)
    if grep:
        hits = views.log_grep(db, log, grep)
        return _clip("\n".join(hits), offset, limit) if hits else "no matches"
    return _clip(views.show_log(db, log), offset, limit)


@tool
def log_append(log: str, text: str) -> str:
    """Append a line to today's draft of a daily log ('note' or 'task').
    Today's draft is wet ink until 6am; past days are frozen."""
    views.log_cfg(log)
    db = connect()
    cur = store.get_draft(db, log)
    new = f"{cur}\n{text}" if cur else text
    store.write_draft(db, log, new)
    return f"noted: {store.draft_len(log, new)}/{store.log_limit(log)} characters"


@tool
def log_rewrite(log: str, text: str) -> str:
    """Replace today's draft of a daily log ('note' or 'task') entirely.
    Pass the full new draft; empty text clears it. Only ever send a
    payload you composed or read — never an unexamined round-trip."""
    views.log_cfg(log)
    db = connect()
    if not text.strip():
        store.clear_draft(db, log)
        return "today's draft cleared"
    store.write_draft(db, log, text)
    return f"draft rewritten: {store.draft_len(log, text)}/{store.log_limit(log)} characters"


# -------------------------------------------------------------------- brain


@tool
def brain_get() -> str:
    """Read the brain (your persistent memory) with its budget header."""
    return views.brain_view(connect())


@tool
def brain_set(content: str) -> str:
    """Replace the brain entirely. Pass the full new content (no budget
    header — that is generated). Prefer brain_edit for small corrections."""
    return views.brain_write(connect(), content)


@tool
def brain_edit(old_string: str, new_string: str, replace_all: bool = False) -> str:
    """Edit the brain in place: old_string must match exactly and (unless
    replace_all) uniquely, like a file Edit tool."""
    db = connect()
    with _write_lock(db):
        store.brain_set(db, _edit(store.brain_get(db), old_string, new_string, replace_all))
    return f"brain edited: {len(store.brain_get(db))}/{store.BRAIN_LIMIT} chars"


# ------------------------------------------------------------------ summary


@tool
def summary_get() -> str:
    """The fold's check and input in one. '[nothing to fold]' when no note
    has frozen since the last fold — stop there. Otherwise the storyline
    with the frozen notes to fold in: load the `slate-storyline` skill, write the
    result with summary_set. Today's note waits for the next fold."""
    return views.fold_view(connect())


@tool
def summary_set(text: str) -> str:
    """Replace the storyline — only ever with a text built from what
    summary_get returned under the `slate-storyline` skill: the pending notes
    folded in, the oldest material compressed out. Every frozen note counts
    as folded from now on (the watermark moves to the latest note before
    today). At most summary_limit chars (config.yaml)."""
    through = store.summary_set(connect(), text)
    return f"summary set: {len(text)}/{store.SUMMARY_LIMIT} chars, through {through or '—'}"


# ------------------------------------------------------------------- memory


@tool
def memory_list(path: str = "") -> str:
    """The memory tree, one level: the top-level pages, or the subpages of
    path — `- [name](name) — label` each. Read a page with memory_get."""
    db = connect()
    tree = views.memory_tree(db, path.strip("/"))
    if tree:
        return tree
    return f"no subpages under {path}" if path else "no memory yet"


@tool
def memory_get(path: str, offset: int = 0, limit: int = FETCH_LIMIT) -> str:
    """Read one memory page by path (`acme/website`, `acme/website/deploy`)
    — its content, then the list of its subpages. Returns at most limit
    chars from offset, with a continuation footer."""
    db = connect()
    path = path.strip("/")
    content = store.memory_get(db, path, touch=True)
    if content is None:
        raise ValueError(f"no memory page {path}")
    return _clip(views.memory_page(db, path, content), offset, limit)


@tool
def memory_set(path: str, content: str) -> str:
    """Write one memory page wholesale (create or replace). Prefer
    memory_edit for changes to an existing page. The first line is the
    page's title and must describe it — every read of the parent lists
    the page by that line; never list subpages by hand. A new page — at
    any depth — is created together with the user: propose the path and
    write on their ok. The exception is a new project's missing path-keyed
    page, created by the session-end sweep without another confirmation."""
    store.memory_set(connect(), path, content)
    return f"saved: {path}"


@tool
def memory_edit(path: str, old_string: str, new_string: str, replace_all: bool = False) -> str:
    """Edit a memory page in place: old_string must match exactly and
    (unless replace_all) uniquely, like a file Edit tool."""
    db = connect()
    path = path.strip("/")
    with _write_lock(db):
        content = store.memory_get(db, path)
        if content is None:
            raise ValueError(f"no memory page {path}")
        store.memory_set(db, path, _edit(content, old_string, new_string, replace_all))
    return f"edited: {path}"


@tool
def memory_rm(path: str) -> str:
    """Delete one memory page. A page with subpages is refused — remove
    those first."""
    if not store.memory_rm(connect(), path.strip("/")):
        raise ValueError(f"no memory page {path}")
    return f"deleted: {path}"


# ------------------------------------------------------------------- search


@tool
def search(
    query: str,
    path: str = "",
    canvas: int = 0,
    history: bool = False,
    context: int = 0,
    offset: int = 0,
    limit: int = FETCH_LIMIT,
) -> str:
    """Case-insensitive substring search across everything here: brain,
    all memory pages, notes, tasks, live canvas content and saved html
    documents. path scopes to one memory page and everything beneath it;
    canvas scopes to one canvas (history=True includes its archived
    versions). context=N adds N lines around each hit. Returns at most
    limit chars from offset, with a continuation footer."""
    db = connect()
    q = query.lower()
    hits = []

    def scan(text, where):
        lines = text.splitlines()
        if context <= 0:
            hits.extend(f"{where}: {line.strip()}" for line in lines if q in line.lower())
            return
        show = set()
        for i, line in enumerate(lines):
            if q in line.lower():
                show.update(range(max(0, i - context), min(len(lines), i + context + 1)))
        prev = None
        for i in sorted(show):
            if prev is not None and i > prev + 1:
                hits.append("--")
            hits.append(f"{where}:{i + 1}: {lines[i]}")
            prev = i

    def done():
        return _clip("\n".join(hits), offset, limit) if hits else "no matches"

    if canvas:
        doc = store.canvas_resolve_file(store.canvas_get(db, canvas))
        if not doc:
            raise ValueError(f"no canvas #{canvas}")
        scan(doc["content"], f"canvas #{canvas}")
        if history:
            for v in store.canvas_versions(db, canvas):
                scan(
                    store.canvas_version_get(db, v["id"])["content"],
                    f"canvas #{canvas} v{v['id']} ({v['ts']})",
                )
        return done()
    if path:
        path = path.strip("/")
        pages = [p for p in store.memory_pages(db) if p == path or p.startswith(path + "/")]
        if not pages:
            raise ValueError(f"no memory page {path}")
        for p in pages:
            scan(store.memory_get(db, p), f"memory {p}")
        return done()
    scan(store.brain_get(db), "brain")
    scan(store.summary_get(db)[0], "notes summary")
    for p in store.memory_pages(db):
        scan(store.memory_get(db, p), f"memory {p}")
    for log in ("note", "task"):
        for d, b in store.get_days(db, log):
            scan(b, f"{log} {d}")
    for c in store.canvas_all(db):
        doc = store.canvas_resolve_file(store.canvas_get(db, c["id"]))
        scan(doc["content"], f'canvas #{c["id"]} "{doc["label"]}"')
    for h in store.html_all(db):
        scan(store.html_get(db, h["id"])["content"], f'html doc #{h["id"]} "{h["title"]}"')
    return done()


# ------------------------------------------------------------------- skills


def _skill_names():
    return sorted(
        d for d in os.listdir(SKILLS) if os.path.isfile(os.path.join(SKILLS, d, "SKILL.md"))
    )


@tool
def skill_load(skill: str) -> str:
    """Load a skill — the method for one kind of work — and follow it for
    the task at hand: "slate-notes" (writing the day's note), "slate-brain"
    (what the brain holds and how it is kept), "slate-memory" (what goes in
    memory pages, keying, creation, the ceiling), "slate-session-end" (what
    gets written when the user signs off), "slate-storyline" (writing the
    rolling summary the session starts from), "slate-tutorial" (a first tour
    for a new user, one step per turn)."""
    if skill not in _skill_names():
        raise ValueError(f"no skill {skill!r} — available: {', '.join(_skill_names())}")
    with open(os.path.join(SKILLS, skill, "SKILL.md")) as f:
        return f"[skill {skill} — follow this protocol]\n\n{f.read()}"


# ------------------------------------------------------------------- canvas


@tool
def canvas_create(content: str = "", path: str = "", show: bool = True) -> str:
    """Create a canvas — a live document the user reads and edits in the
    UI. Pass content, or path to a file on the server's disk (a
    file-backed canvas is read live at view time, read-only for the user).
    show=True makes it the canvas the UI's canvas page opens on; show=False
    creates it quietly, to place on a board or open later by id. A canvas has no
    stored title — its first non-empty line names it, so give written work
    a heading. Returns the id; quote it as #id. Canvases link to each other
    with [label](#/canvas?id=7). Prose is one line per paragraph, never
    hard-wrapped; blank lines between paragraphs, newlines for structure."""
    db = connect()
    if content:
        cid = store.canvas_add(db, content, shown=show)
        return (
            f"canvas [#{cid}]: {store.canvas_label(content)} "
            f"({len(content):,} chars{'' if show else '; not shown'})"
        )
    if not path:
        raise ValueError("pass content, or a path to a file on the server")
    path = os.path.abspath(os.path.expanduser(path))
    try:
        size = os.path.getsize(path)
    except OSError as e:
        raise ValueError(str(e)) from e
    cid = store.canvas_add(db, "", path, shown=show)
    return (
        f"canvas [#{cid}]: {os.path.basename(path)} (the file, read live; "
        f"{size:,} bytes{'' if show else '; not shown'})"
    )


def _writable(db, id):
    doc = store.canvas_get(db, id)
    if not doc:
        raise ValueError(f"no canvas #{id}")
    if doc["source"]:
        raise ValueError(f"#{id} is file-backed ({doc['source']}) — edit the file")
    return doc


@tool
def canvas_set(id: int, content: str) -> str:
    """Replace a canvas's content outright. The user's superseded edits are
    archived automatically, so either side can diff the other's changes.
    Prefer canvas_edit for changes to existing content. Prose rules as
    canvas_create. File-backed canvases can't be written."""
    db = connect()
    _writable(db, id)
    store.canvas_edit_by(db, id, content, "agent")
    return f"canvas [#{id}]: {store.canvas_label(content)} (set, {len(content):,} chars)"


@tool
def canvas_edit(id: int, old_string: str, new_string: str, replace_all: bool = False) -> str:
    """Exact-string edit of a canvas's live content — the same contract as
    memory_edit. Versioning and prose rules as canvas_set."""
    db = connect()
    with _write_lock(db):
        doc = _writable(db, id)
        content = _edit(doc["content"], old_string, new_string, replace_all)
        store.canvas_edit_by(db, id, content, "agent")
    return f"edited canvas [#{id}]: {store.canvas_label(content)} ({len(content):,} chars)"


@tool
def canvas_get(id: int, version: int = 0, offset: int = 0, limit: int = FETCH_LIMIT) -> str:
    """Read a canvas's live content by id — read before replacing. version:
    a vN id from canvas_history fetches that archived run instead. Returns
    at most limit chars from offset, with a continuation footer."""
    db = connect()
    doc = store.canvas_resolve_file(store.canvas_get(db, id))
    if not doc:
        raise ValueError(f"no canvas #{id}")
    if version:
        v = store.canvas_version_get(db, version)
        if not v or v["canvas_id"] != id:
            raise ValueError(f"canvas #{id} has no version v{version}")
        return (
            f"canvas [#{id}] v{version}: {doc['label']} (by {v['author']}, {v['ts']}, "
            f"{len(v['content']):,} chars, archived)\n\n" + _clip(v["content"], offset, limit)
        )
    return (
        f"canvas [#{doc['id']}]: {doc['label']} (by {doc['author']}, {doc['ts']}, "
        f"{len(doc['content']):,} chars)\n\n" + _clip(doc["content"], offset, limit)
    )


@tool
def canvas_history(id: int) -> str:
    """A canvas's archived runs, newest first — version id, author, when,
    size. Fetch one with canvas_get(version=N), grep them with
    search(canvas=id, history=True)."""
    db = connect()
    doc = store.canvas_get(db, id)
    if not doc:
        raise ValueError(f"no canvas #{id}")
    head = (
        f"canvas [#{id}]: {doc['label']} — live by {doc['author']}, {doc['ts']}, "
        f"{len(doc['content']):,} chars"
    )
    vs = store.canvas_versions(db, id)
    if not vs:
        return head + "; no archived versions"
    return "\n".join(
        [head + f"; {len(vs)} archived:"]
        + [f"v{v['id']} — {v['author']}, {v['ts']}, {v['chars']:,} chars" for v in vs]
    )


@tool
def canvas_show(id: int) -> str:
    """Make an existing canvas the one the UI's canvas page opens on — no write."""
    db = connect()
    doc = store.canvas_get(db, id)
    if not doc:
        raise ValueError(f"no canvas #{id}")
    store.canvas_mark_shown(db, id)
    return f"canvas [#{id}]: {doc['label']} (shown)"


# ---------------------------------------------------------------- html docs


@tool
def html_get(id: int, version: int = 0, offset: int = 0, limit: int = FETCH_LIMIT) -> str:
    """Read a saved html document by its permanent id. version: a vN id
    from html_history. Returns at most limit chars from offset."""
    db = connect()
    doc = store.html_get(db, id)
    if not doc:
        raise ValueError(f"no html document #{id}")
    if version:
        v = store.html_version_get(db, version)
        if not v or v["html_id"] != id:
            raise ValueError(f"html document #{id} has no version v{version}")
        return (
            f"html [doc #{id}] v{version}: {v['title']} (by {v['author']}, {v['ts']}, "
            f"{len(v['content']):,} chars, archived)\n\n" + _clip(v["content"], offset, limit)
        )
    return (
        f"html [doc #{id}]: {doc['title']} (by {doc['author']}, {doc['ts']}, "
        f"{len(doc['content']):,} chars)\n\n" + _clip(doc["content"], offset, limit)
    )


@tool
def html_set(id: int, content: str, title: str = "") -> str:
    """Replace a saved html document's content, keeping its id; title
    renames it (empty keeps the current one). The outgoing state is
    snapshotted and every placed widget refreshes. Prefer html_edit for a
    small change."""
    db = connect()
    with _write_lock(db):
        doc = store.html_get(db, id)
        if not doc:
            raise ValueError(f"no html document #{id}")
        label = title.strip() or doc["title"]
        store.html_edit_by(db, id, label, content, "agent")
    return f"html [doc #{id}]: {label} (set, {len(content):,} chars)"


@tool
def html_edit(
    id: int, old_string: str, new_string: str, replace_all: bool = False, title: str = ""
) -> str:
    """Exact-string edit of a saved html document, keeping its id; title
    renames it in the same save. Snapshot and refresh as html_set."""
    db = connect()
    with _write_lock(db):
        doc = store.html_get(db, id)
        if not doc:
            raise ValueError(f"no html document #{id}")
        content = _edit(doc["content"], old_string, new_string, replace_all)
        label = title.strip() or doc["title"]
        store.html_edit_by(db, id, label, content, "agent")
    return f"edited html [doc #{id}]: {label} ({len(content):,} chars)"


@tool
def html_copy(id: int, title: str = "") -> str:
    """Copy a saved html document into a new id with its own history;
    title defaults to '<current title> copy'."""
    db = connect()
    copied = store.html_copy(db, id, title.strip(), "agent")
    if copied is None:
        raise ValueError(f"no html document #{id}")
    return f"html [doc #{copied}]: {store.html_get(db, copied)['title']} (copied from doc #{id})"


@tool
def html_history(id: int) -> str:
    """A saved html document's snapshots, newest first. Fetch one with
    html_get(id, version=N)."""
    db = connect()
    doc = store.html_get(db, id)
    if not doc:
        raise ValueError(f"no html document #{id}")
    head = (
        f"html [doc #{id}]: {doc['title']} — live by {doc['author']}, {doc['ts']}, "
        f"{len(doc['content']):,} chars"
    )
    vs = store.html_versions(db, id)
    if not vs:
        return head + "; no archived versions"
    return "\n".join(
        [head + f"; {len(vs)} archived:"]
        + [
            f"v{v['id']} — {v['title']} — {v['author']}, {v['ts']}, {v['chars']:,} chars"
            for v in vs
        ]
    )


# --------------------------------------------------------------------- nest


def _place(db, board, col, row, w, h):
    """Validate a w×h rect at (col,row); col=row=0 auto-places."""
    cols, rows = store.nest_size(db, board)
    if not 1 <= w <= cols or not 1 <= h <= rows:
        raise ValueError(f"size is w 1–{cols}, h 1–{rows}")
    if not col and not row:
        spot = store.nest_free_cell(db, board, w, h)
        if not spot:
            raise ValueError(
                f"no free {w}×{h} spot — the board is {cols}×{rows}; "
                "nest_view shows it, rm or shrink something first"
            )
        return spot
    if not (1 <= col <= cols and 1 <= row <= rows):
        raise ValueError(f"col is 1–{cols}, row 1–{rows} — the board is {cols}×{rows}")
    if col + w - 1 > cols or row + h - 1 > rows:
        raise ValueError("that rect runs off the board")
    return col, row


def _covered(db, before, board):
    new = sorted(store.nest_hidden_ids(store.nest_all(db, board)) - before)
    return f"; covers {', '.join(f'w{i}' for i in new)} — hidden until uncovered" if new else ""


@tool
def nest_view(board: str = "") -> str:
    """One board's state: every widget with its position, what it shows
    and who placed it. Read before adding. An image or file widget's items
    are read with nest_read — the printed paths are the server's own disk,
    for when you are on it. Defaults to "main"; the header names every
    board."""
    db = connect()
    board = board.strip() or "main"
    ws = store.nest_all(db, board)
    boards = ", ".join(f'"{s}"' for s in store.nest_boards(db))
    if not ws:
        return f'board "{board}" is empty. boards: {boards}'
    cols, rows = store.nest_size(db, board)
    hidden = store.nest_hidden_ids(ws)
    lines = [
        f'board "{board}" ({cols}×{rows}) — {len(ws)} widgets'
        + (f", {len(hidden)} hidden under overlaps" if hidden else "")
        + f". boards: {boards}"
    ]
    for w in ws:
        if w["kind"] == "canvas":
            c = store.canvas_get(db, int(w["ref"]))
            what = f'canvas #{w["ref"]} "{c["label"] if c else "?"}"'
        elif w["kind"] == "html":
            doc = store.html_get(db, int(w["ref"]))
            what = f'html "{doc["title"] if doc else "?"}" (doc #{w["ref"]})'
        else:
            what = f'{w["kind"]} "{w["title"]}" at ' + ", ".join(
                i["p"] for i in store.nest_items(w)
            )
            if w["descr"]:
                what += f" — {w['descr'][:80]}{'…' if len(w['descr']) > 80 else ''}"
        size = f" {w['w']}×{w['h']}" if (w["w"], w["h"]) != (1, 1) else ""
        hid = " HIDDEN (covered)" if w["id"] in hidden else ""
        lines.append(
            f"[w{w['id']}] {w['col']},{w['row']}{size} {what}{hid} — {w['author']}, {w['ts']}"
        )
    return "\n".join(lines)


# MCP clients bound an SSE event at 1MB (httpx2 DEFAULT_MAX_EVENT_SIZE_BYTES)
# and drop the connection over it; base64 adds a third, so pictures leave
# here no bigger than this.
PICTURE_CAP = 700_000


def _picture(path):
    """The image at path as a tool result — big ones re-encoded down under
    PICTURE_CAP; the original stays untouched."""
    from PIL import Image as PILImage  # heavy import — only pictures pay it

    img = PILImage.open(path)
    if max(img.size) <= 1600 and os.path.getsize(path) <= PICTURE_CAP:
        return MCPImage(path=path)
    edge = 1600
    while True:
        copy = img.copy()
        copy.thumbnail((edge, edge))
        buf = io.BytesIO()
        copy.convert("RGB").save(buf, "JPEG", quality=85)
        if buf.tell() <= PICTURE_CAP or edge <= 400:
            return MCPImage(data=buf.getvalue(), format="jpeg")
        edge //= 2


@tool
def nest_read(id: int, i: int = 0, offset: int = 0, limit: int = FETCH_LIMIT):
    """Read one stored item of an image or file widget: the picture itself
    (big ones downscaled), or a text file's content (at most limit chars
    from offset). i indexes the widget's items in nest_view's order. Works
    from any machine — no access to the server's disk needed. Other binaries
    are refused with their type and size; a canvas or html widget reads
    through canvas_get / html_get."""
    db = connect()
    w = store.nest_get(db, id)
    if not w:
        raise ValueError(f"no nest widget w{id}")
    if w["kind"] in ("canvas", "html"):
        reader = "canvas_get" if w["kind"] == "canvas" else "html_get"
        raise ValueError(f"w{id} shows {w['kind']} #{w['ref']} — read it with {reader}({w['ref']})")
    items = store.nest_items(w)
    if not 0 <= i < len(items):
        raise ValueError(f"w{id} has {len(items)} item(s) — i is 0–{len(items) - 1}")
    path, name = items[i]["p"], items[i]["n"]
    if (mimetypes.guess_type(path)[0] or "").startswith("image/"):
        return [f'w{id} item {i}: "{name}"', _picture(path)]
    try:
        with open(path) as f:
            text = f.read()
    except UnicodeDecodeError:
        ctype = mimetypes.guess_type(name)[0] or "unknown type"
        raise ValueError(
            f'w{id} item {i} "{name}" is binary ({ctype}, {os.path.getsize(path):,} bytes) '
            "— only images and text read through this tool"
        ) from None
    except OSError as e:
        raise ValueError(str(e)) from e
    return f'w{id} item {i}: "{name}" ({len(text):,} chars)\n\n{_clip(text, offset, limit)}'


@tool
def nest_add(
    kind: str,
    col: int = 0,
    row: int = 0,
    w: int = 1,
    h: int = 1,
    canvas_id: int = 0,
    html_id: int = 0,
    content: str = "",
    title: str = "",
    description: str = "",
    file: str | list[str] = "",
    board: str = "",
) -> str:
    """Put a widget on a board. kind "canvas": pass canvas_id, or content to
    create one on the spot (its first line names it) — the widget shows the
    canvas live and the user can edit it there. kind "image": pass file —
    one image path on the server's disk, or a list — plus a title and a
    description when the pictures need words. kind "html": pass html_id
    of a saved document, or content — one complete self-contained html
    document (inline css/js) — or file, a .html path on the server; it
    renders in a sandboxed iframe sized to the tile. kind "file": pass
    file, any path or list of paths on the server — a download card (and
    the way the user hands files over: their uploads are readable with
    nest_read). Every path is the server's own disk: an image or file on
    another machine POSTs its bytes instead, and the missing-file error
    prints the exact curl. Files are copied into the store. The board is
    a grid, 4×4 unless resized (nest_view names the size): col,row is the
    top-left cell, omit both for the first free fit; w,h the size in cells.
    Widgets stack: a rect placed over others hides them until it moves —
    the return names what got covered. board names a board ("main" by
    default; a new name creates one). Returns the widget id (quote as wN)."""
    if kind not in ("canvas", "image", "html", "file"):
        raise ValueError("kind is 'canvas', 'image', 'html' or 'file'")
    db = connect()
    board = store.nest_ensure_board(db, board) if board.strip() else "main"
    col, row = _place(db, board, col, row, w, h)
    before = store.nest_hidden_ids(store.nest_all(db, board))
    if kind == "canvas":
        if canvas_id:
            doc = store.canvas_get(db, canvas_id)
            if not doc:
                raise ValueError(f"no canvas #{canvas_id}")
        elif content:
            doc = store.canvas_get(db, store.canvas_add(db, content))
        else:
            raise ValueError("pass canvas_id of an existing canvas, or content for a new one")
        wid = store.nest_add(db, board, "canvas", col, row, str(doc["id"]), w=w, h=h)
        return (
            f'nest [w{wid}]: canvas #{doc["id"]} "{doc["label"]}" at {col},{row} '
            f'({w}×{h}) on "{board}"{_covered(db, before, board)}'
        )
    if kind == "html":
        if html_id:
            doc = store.html_get(db, html_id)
            if not doc:
                raise ValueError(f"no html document #{html_id}")
            did, label = doc["id"], doc["title"]
        else:
            markup = content
            if not markup and isinstance(file, str) and file:
                src = os.path.expanduser(file)
                if os.path.splitext(src)[1].lower() not in (".html", ".htm"):
                    raise ValueError(f"not an html document: {src}")
                try:
                    with open(src) as f:
                        markup = f.read()
                except OSError as e:
                    raise ValueError(f"unreadable: {e}") from e
            if not markup:
                raise ValueError(
                    "an html widget needs html_id, content, or file (.html on the server)"
                )
            label = title.strip() or store.html_title(markup) or "html"
            did = store.html_add(db, label, markup)
        wid = store.nest_add(db, board, "html", col, row, str(did), label, w=w, h=h)
        return (
            f'nest [w{wid}]: html "{label}" (doc #{did}) at {col},{row} ({w}×{h}) '
            f'on "{board}"{_covered(db, before, board)}'
        )
    srcs = [os.path.expanduser(f) for f in ([file] if isinstance(file, str) else file) if f]
    if not srcs:
        raise ValueError(f"a {kind} widget needs file — a path on the server, or a list of them")
    for src in srcs:
        if kind == "image" and not (mimetypes.guess_type(src)[0] or "").startswith("image/"):
            raise ValueError(f"not an image: {src} — use kind 'file' for the rest")
        if not os.path.isfile(src):
            raise ValueError(
                f"no such file on the server: {src} — a file on your machine POSTs "
                f"its bytes instead: curl -F files=@'{src}' "
                f"'{SERVER_URL}/api/nest/upload?board={board}&author=agent'"
            )
    title = title or (
        os.path.basename(srcs[0])
        if len(srcs) == 1
        else f"{len(srcs)} {'images' if kind == 'image' else 'files'}"
    )
    wid = store.nest_add(db, board, kind, col, row, "", title, w=w, h=h, descr=description)
    os.makedirs(store.NEST_DIR, exist_ok=True)
    items = []
    for i, src in enumerate(srcs, 1):
        dst = os.path.join(store.NEST_DIR, f"{wid}-{i}{os.path.splitext(src)[1].lower()}")
        try:
            shutil.copyfile(src, dst)
        except OSError as e:
            store.nest_set_items(db, wid, items)
            store.nest_rm(db, wid)
            raise ValueError(f"copy failed: {e}") from e
        items.append({"p": dst, "n": os.path.basename(src)})
    store.nest_set_items(db, wid, items)
    return (
        f'nest [w{wid}]: {kind} "{title}" at {col},{row} ({w}×{h}) on "{board}"'
        f"{_covered(db, before, board)}"
    )


@tool
def nest_move(id: int, col: int, row: int) -> str:
    """Move a widget (keeping its size) so its top-left cell lands at
    col,row. It lands on top of the stack — what it covers hides."""
    db = connect()
    wg = store.nest_get(db, id)
    if not wg:
        raise ValueError(f"no nest widget w{id}")
    col, row = _place(db, wg["board"], col, row, wg["w"], wg["h"])
    before = store.nest_hidden_ids(store.nest_all(db, wg["board"]))
    store.nest_place(db, id, col, row, wg["w"], wg["h"])
    return f'nest [w{id}]: {wg["kind"]} "{wg["title"]}" → {col},{row}{_covered(db, before, wg["board"])}'


@tool
def nest_rm(id: int) -> str:
    """Take a widget off its board. A canvas or html document behind it
    stays; an image or file widget's stored copy is deleted."""
    w = store.nest_rm(connect(), id)
    if not w:
        raise ValueError(f"no nest widget w{id}")
    if w["kind"] == "canvas":
        return f"nest [w{id}]: canvas #{w['ref']} removed (the canvas itself stays)"
    if w["kind"] == "html":
        return f'nest [w{id}]: html "{w["title"]}" removed (doc #{w["ref"]} stays)'
    return f'nest [w{id}]: {w["kind"]} "{w["title"]}" removed'
