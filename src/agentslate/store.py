"""The sqlite store — the single home of everything Slate carries.

One database (SLATE_DB, default ~/.local/share/agentslate/slate.db), WAL
mode so the MCP server and the web UI overlap safely. Two directories sit
next to it: images/ (pictures pasted into canvases) and nest/ (stored
copies of image and file widgets).

  entries(log, day, body)         notes + tasks, one row per day. Today's
                                  row is wet ink; past days are frozen by
                                  construction — writes only ever target
                                  (log, today).
  brain(id=1, content)            the agent's persistent memory. Wet ink.
  memory(path, content)           memory pages, a tree: a page's children
                                  are the pages one segment below its path.
                                  A project's page is keyed by its
                                  repository's path (acme/website), a
                                  folder outside git by its name; subpages
                                  sit beneath (acme/website/deploy);
                                  machines under machines/<host>.
  canvas(id, content, source,     live documents: the id is permanent, the
         author, shown_at, ...)   row is the live state. No stored titles —
                                  the label is the first non-empty line.
                                  source '' = written text, a path =
                                  file-backed (read live at view time),
  canvas_version                  superseded canvas content, cut by author
                                  switches and idle gaps: nearby edits
                                  coalesce; a new run archives the outgoing
                                  one — either side can diff the other.
  html_doc / html_version         the html widgets' documents + history.
  image(id, name, content_type)   pictures pasted into canvases.
  nest(id, kind, col, row, w, h,  the boards: one row per widget, spanning
       z, board, ref, title, ...) w×h cells from (col,row). kind 'canvas'
                                  (ref = canvas id), 'image' / 'file' (ref =
                                  JSON item list under NEST_DIR), 'html'
                                  (ref = html_doc id). Higher z covers.
  kv(k, v)                        small settings: board list and sizes,
                                  memory and canvas locks.

Authors are 'agent' (MCP writes) or 'user' (web UI writes).
"""

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta

import yaml

DB_PATH = os.environ.get("SLATE_DB", os.path.expanduser("~/.local/share/agentslate/slate.db"))
IMAGES_DIR = os.path.join(os.path.dirname(DB_PATH), "images")
NEST_DIR = os.path.join(os.path.dirname(DB_PATH), "nest")
CONFIG_PATH = os.path.join(os.path.dirname(DB_PATH), "config.yaml")

# Settings overridden by config.yaml beside the database. The size ceilings
# keep session-start bundles under harness output caps and pages disciplined;
# an over-cap write is refused with the reason.
DEFAULTS = {
    "note_limit": 1_000,  # chars per day in the notes
    "task_limit": 1_000,  # chars per day in the task log, prefixes ride free
    "task_keep": 30,  # task lines shown at session start, in whole days
    "summary_limit": 3_000,  # the notes summary
    "brain_limit": 5_000,  # the brain, hard
    "page_limit": 5_000,  # any memory page — one fetch
    "fetch_limit": 5_000,  # chars a read tool returns per call
    "canvas_version_idle_seconds": 60,  # same author, new run after this idle gap
}


def read_config(path):
    """DEFAULTS overridden by the yaml at path, if there is one."""
    try:
        with open(path) as f:
            cfg = yaml.safe_load(f) or {}
    except FileNotFoundError:
        cfg = {}
    unknown = sorted(set(cfg) - set(DEFAULTS))
    if unknown:
        raise ValueError(f"{path}: unknown keys {unknown} — the keys are {sorted(DEFAULTS)}")
    return {**DEFAULTS, **cfg}


CONFIG = read_config(CONFIG_PATH)
NOTE_LIMIT = CONFIG["note_limit"]
TASK_LIMIT = CONFIG["task_limit"]
TASK_KEEP = CONFIG["task_keep"]
SUMMARY_LIMIT = CONFIG["summary_limit"]
BRAIN_LIMIT = CONFIG["brain_limit"]
PAGE_LIMIT = CONFIG["page_limit"]
FETCH_LIMIT = CONFIG["fetch_limit"]
CANVAS_VERSION_IDLE_SECONDS = CONFIG["canvas_version_idle_seconds"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
  log  TEXT NOT NULL,
  day  TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (log, day)
);
CREATE TABLE IF NOT EXISTS brain (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory (
  path        TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  updated_at  TEXT,
  accessed_at TEXT
);
CREATE TABLE IF NOT EXISTS canvas (
  id       INTEGER PRIMARY KEY,
  ts       TEXT,
  content  TEXT NOT NULL,
  source   TEXT NOT NULL DEFAULT '',
  author   TEXT NOT NULL DEFAULT 'agent',
  shown_at TEXT,
  starred  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS canvas_version (
  id        INTEGER PRIMARY KEY,
  canvas_id INTEGER NOT NULL,
  ts        TEXT,
  content   TEXT NOT NULL,
  author    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS html_doc (
  id      INTEGER PRIMARY KEY,
  ts      TEXT,
  title   TEXT NOT NULL,
  content TEXT NOT NULL,
  author  TEXT NOT NULL DEFAULT 'agent'
);
CREATE TABLE IF NOT EXISTS html_version (
  id      INTEGER PRIMARY KEY,
  html_id INTEGER NOT NULL,
  ts      TEXT,
  title   TEXT NOT NULL,
  content TEXT NOT NULL,
  author  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS image (
  id           TEXT PRIMARY KEY,
  ts           TEXT,
  name         TEXT NOT NULL,
  content_type TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nest (
  id     INTEGER PRIMARY KEY,
  ts     TEXT,
  kind   TEXT NOT NULL,
  col    INTEGER NOT NULL,
  row    INTEGER NOT NULL,
  w      INTEGER NOT NULL DEFAULT 1,
  h      INTEGER NOT NULL DEFAULT 1,
  z      INTEGER NOT NULL DEFAULT 0,
  board  TEXT NOT NULL DEFAULT 'main',
  ref    TEXT NOT NULL,
  title  TEXT NOT NULL DEFAULT '',
  descr  TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT 'agent'
);
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
"""


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(SCHEMA)
    return db


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today():
    """The day runs 6am-6am: late-night work counts as the same day."""
    return (datetime.now() - timedelta(hours=6)).strftime("%Y-%m-%d")


def kv_get(db, k, default=""):
    r = db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return r[0] if r else default


def kv_set(db, k, v):
    db.execute(
        "INSERT INTO kv (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v)
    )
    db.commit()


def repo_hosts(db):
    """{page key: git web host} — learned from session-start remotes, so the
    UI can link a key (`acme/website`) to its repo (`https://github.com/…`)."""
    return json.loads(kv_get(db, "repo_hosts", "{}"))


def repo_host_learn(db, key, host):
    hosts = repo_hosts(db)
    if hosts.get(key) != host:
        kv_set(db, "repo_hosts", json.dumps({**hosts, key: host}))


# ------------------------------------------------------------------ entries


# A task line's `project: ` prefix — the UI renders it as a chip. No spaces
# (a page key never has one, prose with a colon does), room for a long key.
# Kept in step with CHIP_LINE_RE in frontend/src/pages/Logs.tsx.
TASK_PREFIX_RE = re.compile(r"^[^\s:]{1,48}:[ \t]+", re.MULTILINE)


def draft_len(log, body):
    """Chars a draft counts against its log's limit. Task prefixes are
    identity, not content — they ride free."""
    if log != "task":
        return len(body)
    return len(body) - sum(len(m.group()) for m in TASK_PREFIX_RE.finditer(body))


def log_limit(log):
    return TASK_LIMIT if log == "task" else NOTE_LIMIT


def get_draft(db, log):
    row = db.execute("SELECT body FROM entries WHERE log=? AND day=?", (log, today())).fetchone()
    return row[0] if row else ""


def write_draft(db, log, body):
    used = draft_len(log, body)
    limit = log_limit(log)
    if used > limit:
        raise ValueError(
            f"draft full: that would be {used}/{limit} characters "
            f"({used - limit} over) — rewrite tighter to free space"
        )
    db.execute(
        "INSERT INTO entries (log, day, body) VALUES (?,?,?) "
        "ON CONFLICT(log, day) DO UPDATE SET body=excluded.body",
        (log, today(), body),
    )
    db.commit()


def clear_draft(db, log):
    db.execute("DELETE FROM entries WHERE log=? AND day=?", (log, today()))
    db.commit()


def get_days(db, log):
    """[(day, body)] oldest first."""
    return db.execute("SELECT day, body FROM entries WHERE log=? ORDER BY day", (log,)).fetchall()


# ------------------------------------------------------------------ summary


def summary_get(db):
    """(text, through): the notes summary and the last day folded into it
    — '' before the first fold."""
    return kv_get(db, "note_summary"), kv_get(db, "note_summary_through")


def summary_set(db, text):
    """Replace the summary and count every frozen note as folded: the
    watermark moves to the latest note day before today. Returns it."""
    check_page(text, "summary", SUMMARY_LIMIT)
    frozen = [d for d, b in get_days(db, "note") if d < today() and b.strip()]
    through = frozen[-1] if frozen else kv_get(db, "note_summary_through")
    kv_set(db, "note_summary", text)
    kv_set(db, "note_summary_through", through)
    return through


# -------------------------------------------------------------------- brain


def check_page(content, what, limit):
    if len(content) > limit:
        split = (
            ""
            if what in ("brain", "summary")
            else " Where a section has obviously earned its own subpage, propose the split "
            "— the user decides."
        )
        raise ValueError(
            f"{what} too big: {len(content)}/{limit} chars "
            f"({len(content) - limit} over the hard cap). Nothing was written — "
            f"cut it by at least 10%, up to half where garbage has accumulated, "
            f"then add what you came to write. Never spill into another page.{split}"
        )


def brain_get(db):
    row = db.execute("SELECT content FROM brain WHERE id=1").fetchone()
    return row[0] if row else ""


def brain_set(db, content):
    check_page(content, "brain", BRAIN_LIMIT)
    db.execute(
        "INSERT INTO brain (id, content) VALUES (1, ?) "
        "ON CONFLICT(id) DO UPDATE SET content=excluded.content",
        (content,),
    )
    db.commit()


# ------------------------------------------------------------------- memory


def memory_path(path):
    """A clean page path: segments joined by single slashes, none empty."""
    parts = [p.strip() for p in path.strip().split("/")]
    if not parts or any(not p or p in (".", "..") for p in parts):
        raise ValueError(f"bad memory path {path!r}")
    return "/".join(parts)


def memory_pages(db):
    """Every page path, sorted."""
    return [r[0] for r in db.execute("SELECT path FROM memory ORDER BY path")]


def memory_children(db, path=""):
    """The pages one segment below path ('' = the top level) — as paths.
    A child may be implicit: a path with pages beneath it but no page of
    its own still lists (its content is None to readers)."""
    prefix = f"{path}/" if path else ""
    seen = []
    for p in memory_pages(db):
        if p.startswith(prefix) and p != path:
            child = prefix + p[len(prefix) :].split("/")[0]
            if child not in seen:
                seen.append(child)
    return seen


def memory_get(db, path, touch=False):
    """`touch` marks a deliberate read (the MCP memory_get); search sweeps,
    hook loads and UI views leave accessed_at alone."""
    row = db.execute("SELECT content FROM memory WHERE path=?", (path,)).fetchone()
    if row and touch:
        db.execute("UPDATE memory SET accessed_at=? WHERE path=?", (now(), path))
        db.commit()
    return row[0] if row else None


def memory_set(db, path, content):
    path = memory_path(path)
    check_page(content, path, PAGE_LIMIT)
    db.execute(
        "INSERT INTO memory (path, content, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(path) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at",
        (path, content, now()),
    )
    db.commit()


def memory_all(db):
    """[(path, content, updated_at, accessed_at)], for the UI."""
    return db.execute(
        "SELECT path, content, updated_at, accessed_at FROM memory ORDER BY path"
    ).fetchall()


def memory_rm(db, path, recursive=False):
    """Delete a page. With recursive, everything beneath it goes too;
    without, a page with subpages is refused. Returns the rows removed."""
    path = memory_path(path)
    below = [p for p in memory_pages(db) if p.startswith(path + "/")]
    if below and not recursive:
        raise ValueError(f"{path} has {len(below)} subpage(s) — remove those first")
    removed = sum(
        db.execute("DELETE FROM memory WHERE path=?", (target,)).rowcount
        for target in [path, *below]
    )
    db.commit()
    return removed


# ------------------------------------------------------------------- canvas


def first_line(content):
    """The first non-empty line, markdown stripped — what names a canvas or
    a memory page."""
    for line in content.splitlines():
        t = re.sub(r"[*_`]|\[|\]\([^)]*\)", "", line.strip().lstrip("#").strip()).strip()
        if t:
            return t
    return ""


def canvas_label(content, source=""):
    """A canvas's display label: its first line, clipped; a file-backed
    canvas with unread content labels as its file's basename."""
    return first_line(content)[:60] or (os.path.basename(source) if source else "(empty)")


def canvas_add(db, content, source="", author="agent", shown=False):
    cur = db.execute(
        "INSERT INTO canvas (ts, content, source, author, shown_at) VALUES (?,?,?,?,?)",
        (now(), content, source, author, now() if shown else None),
    )
    db.commit()
    return cur.lastrowid


def canvas_mark_shown(db, doc_id):
    cur = db.execute("UPDATE canvas SET shown_at=? WHERE id=?", (now(), doc_id))
    db.commit()
    return cur.rowcount > 0


def canvas_edit_by(db, doc_id, content, author):
    """Replace the live content. A write that changes nothing is nothing
    (no version, no author flip); nearby same-author edits coalesce into the
    live row; an author switch or configured idle gap archives the outgoing
    run first. A same-author write that lands exactly on the last archived
    run is a revert: that run comes back as the live row and the undone run
    is dropped. The other author writing that text is a new run — the
    outgoing one is archived like any other."""
    # The read, version decision and live write are one transaction. MCP
    # and UI connections can otherwise both read the old row, then let the
    # later writer erase the first one's run without ever archiving it.
    if not db.in_transaction:
        db.execute("BEGIN IMMEDIATE")
    try:
        r = db.execute("SELECT ts, content, author FROM canvas WHERE id=?", (doc_id,)).fetchone()
        if r is None:
            db.rollback()
            return False
        if content == r[1]:
            db.commit()
            return True
        stamp = now()
        idle = (
            r[2] == author
            and r[0]
            and datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S")
            - datetime.strptime(r[0], "%Y-%m-%d %H:%M:%S")
            >= timedelta(seconds=CANVAS_VERSION_IDLE_SECONDS)
        )
        last = db.execute(
            "SELECT id, ts, content, author FROM canvas_version WHERE canvas_id=? "
            "ORDER BY id DESC LIMIT 1",
            (doc_id,),
        ).fetchone()
        if last and content == last[2] and r[2] == author and not idle:
            db.execute("DELETE FROM canvas_version WHERE id=?", (last[0],))
            db.execute(
                "UPDATE canvas SET content=?, ts=?, author=? WHERE id=?",
                (last[2], last[1], last[3], doc_id),
            )
            db.commit()
            return True
        if r[2] != author or idle:
            db.execute(
                "INSERT INTO canvas_version (canvas_id, ts, content, author) VALUES (?,?,?,?)",
                (doc_id, r[0], r[1], r[2]),
            )
        db.execute(
            "UPDATE canvas SET content=?, ts=?, author=? WHERE id=?",
            (content, stamp, author, doc_id),
        )
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise


def canvas_get(db, doc_id=None):
    """A canvas's live state by id; without an id, the last-shown one."""
    q = (
        "SELECT id, ts, content, source, author, starred, "
        "(SELECT COUNT(*) FROM canvas_version v WHERE v.canvas_id=canvas.id) FROM canvas"
    )
    if doc_id:
        r = db.execute(q + " WHERE id=?", (doc_id,)).fetchone()
    else:
        r = db.execute(
            q + " WHERE shown_at IS NOT NULL ORDER BY shown_at DESC, id DESC LIMIT 1"
        ).fetchone()
    return (
        {
            "id": r[0],
            "ts": r[1],
            "label": canvas_label(r[2], r[3]),
            "content": r[2],
            "source": r[3],
            "author": r[4],
            "starred": bool(r[5]),
            "versions": r[6],
        }
        if r
        else None
    )


def canvas_resolve_file(doc):
    """A file-backed canvas stores no copy — read the file fresh."""
    if doc and not doc["content"] and doc["source"]:
        try:
            with open(doc["source"], errors="replace") as f:
                doc["content"] = f.read()
        except OSError as e:
            doc["content"] = f"(file unreadable: {e})"
        doc["label"] = canvas_label(doc["content"], doc["source"])
    return doc


def canvas_versions(db, canvas_id):
    rows = db.execute(
        "SELECT id, ts, author, length(content) FROM canvas_version "
        "WHERE canvas_id=? ORDER BY id DESC",
        (canvas_id,),
    ).fetchall()
    return [{"id": r[0], "ts": r[1], "author": r[2], "chars": r[3]} for r in rows]


def canvas_version_get(db, version_id):
    r = db.execute(
        "SELECT id, canvas_id, ts, content, author FROM canvas_version WHERE id=?", (version_id,)
    ).fetchone()
    return (
        {"id": r[0], "canvas_id": r[1], "ts": r[2], "content": r[3], "author": r[4]} if r else None
    )


def canvas_star(db, doc_id, on):
    db.execute("UPDATE canvas SET starred=? WHERE id=?", (1 if on else 0, doc_id))
    db.commit()


def canvas_rm(db, doc_id):
    """Delete a canvas outright — live row, history, and any widget showing it."""
    r = db.execute("SELECT content, source FROM canvas WHERE id=?", (doc_id,)).fetchone()
    if r is None:
        return None
    db.execute("DELETE FROM canvas WHERE id=?", (doc_id,))
    db.execute("DELETE FROM canvas_version WHERE canvas_id=?", (doc_id,))
    db.execute("DELETE FROM nest WHERE kind='canvas' AND ref=?", (str(doc_id),))
    db.commit()
    return canvas_label(r[0], r[1])


def canvas_all(db):
    """Every canvas, latest-touched first, metadata only."""
    rows = db.execute(
        "SELECT id, ts, content, source, starred FROM canvas ORDER BY ts DESC, id DESC"
    ).fetchall()
    return [
        {
            "id": r[0],
            "ts": r[1],
            "label": canvas_label(r[2], r[3]),
            "source": r[3],
            "starred": bool(r[4]),
        }
        for r in rows
    ]


# ------------------------------------------------------------------- images


def image_add(db, name, content_type):
    iid = uuid.uuid4().hex
    db.execute(
        "INSERT INTO image (id, ts, name, content_type) VALUES (?,?,?,?)",
        (iid, now(), name, content_type),
    )
    db.commit()
    return iid


def image_get(db, iid):
    r = db.execute("SELECT id, ts, name, content_type FROM image WHERE id=?", (iid,)).fetchone()
    return {"id": r[0], "ts": r[1], "name": r[2], "content_type": r[3]} if r else None


# ---------------------------------------------------------------- html docs


def html_title(markup):
    """A document's <title>, or ''."""
    m = re.search(r"<title[^>]*>([^<]+)</title>", markup, re.I)
    return m.group(1).strip() if m else ""


def html_add(db, title, content, author="agent"):
    cur = db.execute(
        "INSERT INTO html_doc (ts, title, content, author) VALUES (?,?,?,?)",
        (now(), title, content, author),
    )
    db.commit()
    return cur.lastrowid


def html_get(db, doc_id):
    r = db.execute(
        "SELECT id, ts, title, content, author, "
        "(SELECT count(*) FROM html_version WHERE html_id=html_doc.id) "
        "FROM html_doc WHERE id=?",
        (doc_id,),
    ).fetchone()
    return (
        {"id": r[0], "ts": r[1], "title": r[2], "content": r[3], "author": r[4], "versions": r[5]}
        if r
        else None
    )


def html_all(db):
    rows = db.execute(
        "SELECT id, ts, title, length(content), author, "
        "(SELECT count(*) FROM html_version WHERE html_id=html_doc.id) "
        "FROM html_doc ORDER BY id DESC"
    ).fetchall()
    return [
        {"id": r[0], "ts": r[1], "title": r[2], "chars": r[3], "author": r[4], "versions": r[5]}
        for r in rows
    ]


def html_edit_by(db, doc_id, title, content, author):
    """Edit a document, snapshotting its outgoing state; placements follow
    the id, so a title change reaches them too."""
    if not db.in_transaction:
        db.execute("BEGIN IMMEDIATE")
    try:
        old = db.execute(
            "SELECT ts, title, content, author FROM html_doc WHERE id=?", (doc_id,)
        ).fetchone()
        if not old:
            db.rollback()
            return False
        if old[1] == title and old[2] == content:
            db.commit()
            return True
        db.execute(
            "INSERT INTO html_version (html_id, ts, title, content, author) VALUES (?,?,?,?,?)",
            (doc_id, old[0], old[1], old[2], old[3]),
        )
        db.execute(
            "UPDATE html_doc SET ts=?, title=?, content=?, author=? WHERE id=?",
            (now(), title, content, author, doc_id),
        )
        db.execute("UPDATE nest SET title=? WHERE kind='html' AND ref=?", (title, str(doc_id)))
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise


def html_copy(db, doc_id, title="", author="agent"):
    doc = html_get(db, doc_id)
    if not doc:
        return None
    return html_add(db, title or f"{doc['title']} copy", doc["content"], author)


def html_versions(db, doc_id):
    rows = db.execute(
        "SELECT id, ts, title, length(content), author FROM html_version "
        "WHERE html_id=? ORDER BY id DESC",
        (doc_id,),
    ).fetchall()
    return [{"id": r[0], "ts": r[1], "title": r[2], "chars": r[3], "author": r[4]} for r in rows]


def html_version_get(db, version_id):
    r = db.execute(
        "SELECT id, html_id, ts, title, content, author FROM html_version WHERE id=?", (version_id,)
    ).fetchone()
    return (
        {"id": r[0], "html_id": r[1], "ts": r[2], "title": r[3], "content": r[4], "author": r[5]}
        if r
        else None
    )


def html_rm(db, doc_id):
    db.execute("DELETE FROM html_doc WHERE id=?", (doc_id,))
    db.execute("DELETE FROM html_version WHERE html_id=?", (doc_id,))
    db.execute("DELETE FROM nest WHERE kind='html' AND ref=?", (str(doc_id),))
    db.commit()


# --------------------------------------------------------------------- nest
# Boards: a grid that always fits the window (cells stretch, no scroll).
# Widgets stack — a higher-z rect hides what it covers until it moves.


def nest_boards(db):
    return json.loads(kv_get(db, "nest_boards", '["main"]'))


def nest_ensure_board(db, name):
    name = name.strip()
    if not name or len(name) > 40:
        raise ValueError("a board name is 1-40 chars")
    names = nest_boards(db)
    if name not in names:
        kv_set(db, "nest_boards", json.dumps(names + [name]))
    return name


def nest_rename_board(db, old, new):
    new = new.strip()
    if old == "main":
        raise ValueError("main stays main — it is the default landing")
    if not new or len(new) > 40:
        raise ValueError("a board name is 1-40 chars")
    names = nest_boards(db)
    if old not in names:
        raise ValueError(f'no board "{old}"')
    if new in names:
        raise ValueError(f'"{new}" already exists')
    kv_set(db, "nest_boards", json.dumps([new if n == old else n for n in names]))
    db.execute("UPDATE nest SET board=? WHERE board=?", (new, old))
    v = kv_get(db, f"nest_size:{old}")
    if v:
        kv_set(db, f"nest_size:{new}", v)
    db.execute("DELETE FROM kv WHERE k=?", (f"nest_size:{old}",))
    db.commit()


def nest_drop_board(db, name):
    """Delete a board: its widgets, its name, its size."""
    if name == "main":
        raise ValueError("main stays — it is the default landing")
    names = nest_boards(db)
    if name not in names:
        raise ValueError(f'no board "{name}"')
    nest_clear(db, name)
    kv_set(db, "nest_boards", json.dumps([n for n in names if n != name]))
    db.execute("DELETE FROM kv WHERE k=?", (f"nest_size:{name}",))
    db.commit()


def nest_size(db, board):
    v = kv_get(db, f"nest_size:{board}")
    if not v:
        return 4, 4
    c, r = v.split("x")
    return int(c), int(r)


def nest_set_size(db, board, cols, rows):
    if not (1 <= cols <= 12 and 1 <= rows <= 12):
        raise ValueError("grid is 1-12 cells each way")
    kv_set(db, f"nest_size:{board}", f"{cols}x{rows}")


_NEST_FIELDS = "id, ts, kind, col, row, w, h, z, board, ref, title, descr, author"


def _nest_row(r):
    return dict(zip(_NEST_FIELDS.replace(" ", "").split(","), r, strict=True))


def nest_all(db, board):
    rows = db.execute(
        f"SELECT {_NEST_FIELDS} FROM nest WHERE board=? ORDER BY row, col", (board,)
    ).fetchall()
    return [_nest_row(r) for r in rows]


def nest_count(db):
    return db.execute("SELECT COUNT(*) FROM nest").fetchone()[0]


def nest_get(db, wid):
    r = db.execute(f"SELECT {_NEST_FIELDS} FROM nest WHERE id=?", (wid,)).fetchone()
    return _nest_row(r) if r else None


def _overlaps(wg, col, row, w, h):
    return (
        wg["col"] < col + w
        and col < wg["col"] + wg["w"]
        and wg["row"] < row + h
        and row < wg["row"] + wg["h"]
    )


def nest_hidden_ids(ws):
    """Widgets hidden by a higher visible rectangle.

    A hidden widget no longer occupies the board, so it cannot hide a
    widget beneath it. Walk from the top down and keep only visible
    rectangles as occluders.
    """
    visible = []
    hidden = set()
    for widget in sorted(ws, key=lambda item: item["z"], reverse=True):
        if any(
            _overlaps(top, widget["col"], widget["row"], widget["w"], widget["h"])
            for top in visible
        ):
            hidden.add(widget["id"])
        else:
            visible.append(widget)
    return hidden


def nest_fit(db, board, col, row, w=1, h=1):
    """The visible widget standing in the way of a w×h rect, if any."""
    ws = nest_all(db, board)
    hidden = nest_hidden_ids(ws)
    for wg in ws:
        if wg["id"] not in hidden and _overlaps(wg, col, row, w, h):
            return wg
    return None


def nest_free_cell(db, board, w=1, h=1):
    cols, rows = nest_size(db, board)
    for row in range(1, rows - h + 2):
        for col in range(1, cols - w + 2):
            if not nest_fit(db, board, col, row, w, h):
                return col, row
    return None


def _next_z(db):
    return db.execute("SELECT COALESCE(MAX(z), 0) + 1 FROM nest").fetchone()[0]


def nest_add(db, board, kind, col, row, ref, title="", author="agent", w=1, h=1, descr=""):
    cur = db.execute(
        "INSERT INTO nest (ts, kind, col, row, w, h, z, board, ref, title, descr, author) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (now(), kind, col, row, w, h, _next_z(db), board, ref, title, descr, author),
    )
    db.commit()
    return cur.lastrowid


def nest_items(w):
    """An image/file widget's items: [{'p': path under NEST_DIR, 'n': original
    name}]. The ref stores basenames, so the data directory can move."""
    items = json.loads(w["ref"]) if w["ref"].startswith("[") else []
    return [{"p": os.path.join(NEST_DIR, it["p"]), "n": it["n"]} for it in items]


def nest_set_items(db, wid, items):
    """items as nest_items returns them; only basenames are stored."""
    stored = [{"p": os.path.basename(it["p"]), "n": it["n"]} for it in items]
    db.execute("UPDATE nest SET ref=? WHERE id=?", (json.dumps(stored), wid))
    db.commit()


def nest_place(db, wid, col, row, w, h):
    """Move or resize a widget; it lands on top of the stack."""
    db.execute(
        "UPDATE nest SET col=?, row=?, w=?, h=?, z=? WHERE id=?", (col, row, w, h, _next_z(db), wid)
    )
    db.commit()


def nest_rm(db, wid):
    """Delete a widget row and return it (so a stored copy can be cleaned);
    also removes the stored copies of image and file widgets."""
    w = nest_get(db, wid)
    if w:
        db.execute("DELETE FROM nest WHERE id=?", (wid,))
        db.commit()
        if w["kind"] in ("image", "file"):
            for it in nest_items(w):
                try:
                    os.remove(it["p"])
                except OSError:
                    pass
    return w


def nest_clear(db, board):
    for w in nest_all(db, board):
        nest_rm(db, w["id"])
