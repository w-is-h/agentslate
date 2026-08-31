"""Text renderings shared by the MCP tools and the session-start bundle:
the logs, the brain, a memory page as the bundle carries it, and the bundle itself."""

import re

from . import store
from .store import connect

LOGS = {"note": ("# notes", "notes"), "task": ("# task log", "tasks")}


def log_cfg(log):
    if log not in LOGS:
        raise ValueError("log is 'note' or 'task'")
    return LOGS[log]


def summary_view(db):
    """The notes summary with its size and watermark; a line saying so
    while there is none."""
    summary, through = store.summary_get(db)
    if not summary:
        return "# notes summary — none yet; the session-end fold writes it"
    return f"# notes summary ({len(summary)}/{store.SUMMARY_LIMIT} chars, through {through})\n{summary}"


def fold_view(db):
    """The fold's check and input in one: '[nothing to fold]' when no note
    has frozen since the last fold — and nothing else, the storyline is not
    fetched; otherwise the storyline, then the frozen notes to fold in.
    Today's note is still wet and waits for the next fold."""
    _, through = store.summary_get(db)
    days = [
        (d, b) for d, b in store.get_days(db, "note") if through < d < store.today() and b.strip()
    ]
    if not days:
        return "[nothing to fold]"
    out = [summary_view(db), f"\n# to fold in — {len(days)} day(s)"]
    out.extend(f"\n## {d}\n{b}" for d, b in days)
    return "\n".join(out)


def show_log(db, log):
    """The session-start view, then today's draft budget. Tasks: whole days
    from the end until the last TASK_KEEP lines are covered. Notes: the
    summary and today's note — the frozen days live in the summary."""
    title, noun = log_cfg(log)
    days = [(d, b) for d, b in store.get_days(db, log) if b.strip()]
    out = []
    if log == "note":
        out.append(summary_view(db))
        shown = [(d, b) for d, b in days if d == store.today()]
    else:
        per_day = [sum(1 for ln in b.splitlines() if ln.strip()) for _, b in days]
        show = acc = 0
        while show < len(days) and acc < store.TASK_KEEP:
            show += 1
            acc += per_day[-show]
        if show < len(days):
            out.append(
                f"[{noun}: {len(days)} days — showing the last {show} ({acc} {noun}); "
                f"older days are yours anytime (log_read {log}: day / grep)]"
            )
        else:
            out.append(title)
        shown = days[len(days) - show :]
    for day, body in shown:
        out.append(f"\n## {day}\n{body}")
    out.append(
        f"\n[today is {store.today()} — draft: {store.draft_len(log, store.get_draft(db, log))}"
        f"/{store.log_limit(log)} characters used]"
    )
    return "\n".join(out)


def log_day(db, log, day):
    return dict(store.get_days(db, log)).get(day)


def log_grep(db, log, pattern):
    pat = pattern.lower()
    return [
        f"{d}: {line}"
        for d, b in store.get_days(db, log)
        for line in b.splitlines()
        if pat in line.lower()
    ]


def brain_view(db):
    content = store.brain_get(db)
    return f"# brain ({len(content)}/{store.BRAIN_LIMIT} chars)\n\n{content}"


def brain_write(db, content):
    store.brain_set(db, content.rstrip("\n") + "\n" if content.strip() else "")
    return f"brain updated: {len(store.brain_get(db))}/{store.BRAIN_LIMIT} chars"


def memory_tree(db, path=""):
    """One line per child of path: the child's title linking to its name —
    `- [Website — deployment notes](website)`; a child with pages beneath it but
    no page of its own links by name alone."""
    lines = []
    for c in store.memory_children(db, path):
        name = c.rsplit("/", 1)[-1]
        content = store.memory_get(db, c)
        lines.append(
            f"- [{store.first_line(content) or '(untitled)'}]({name})"
            if content is not None
            else f"- [{name}]({name}) — no page of its own"
        )
    return "\n".join(lines)


def memory_page(db, path, content):
    """A page as every reader gets it: its content, then its subpages,
    one line each — a page always lists what sits beneath it."""
    out = content.rstrip()
    tree = memory_tree(db, path)
    if tree:
        out += f"\n\nsubpages (memory_get {path}/<name>):\n{tree}"
    return out


def memory_index(db, path):
    """The session-start form of a page; empty when there is no page."""
    content = store.memory_get(db, path)
    if content is None:
        return ""
    return f"# memory: {path} (memory_get <path>)\n\n{memory_page(db, path, content)}"


def repo_key(url):
    """A git remote reduced to the page key it names: the repository's path
    on its host (`owner/name`, groups included), lowercased. Scheme, user,
    host and `.git` go — clone URLs vary by protocol and SSH alias, the
    path doesn't."""
    u = url.strip()
    if "://" in u:
        u = u.split("://", 1)[1]
        u = u.split("/", 1)[1] if "/" in u else ""
    elif ":" in u:
        u = u.split(":", 1)[1]
    u = u.strip("/")
    if u.endswith(".git"):
        u = u[:-4]
    return u.lower()


def repo_host(url):
    """The web host a clone URL points at (`github.com`), or '' when it
    isn't one — an SSH alias has no dot and names nothing reachable."""
    u = url.strip()
    if "://" in u:
        u = u.split("://", 1)[1]
    if "@" in u:
        u = u.split("@", 1)[1]
    host = re.split(r"[/:]", u, maxsplit=1)[0]
    return host.lower() if "." in host else ""


def resolve_project(db, path, repo=""):
    """Map a session to a memory page. Inside a git repo the remote decides:
    the page keyed by the repository's path, or nothing — where in the clone
    the session sits doesn't matter. Outside git (no repo, no remote) the
    longest trailing slice of the working directory that is a page. A match
    also teaches the store the repo's web host, which the UI uses to link
    the page key to the repo."""
    known = store.memory_pages(db)
    if repo:
        key = repo_key(repo)
        page = next((p for p in known if p.lower() == key), "")
        if page and (host := repo_host(repo)):
            store.repo_host_learn(db, page, host)
        return page
    parts = [p for p in path.strip("/").split("/") if p]
    for i in range(len(parts)):
        key = "/".join(parts[i:])
        if key in known:
            return key
    return ""


# Claude Code hard-caps a hook's stdout at 10k chars — over the cap it swaps
# the whole output for a file path. Each part stays under it.
HOOK_SAFE = 10_000


def session_bundle(path="", host="", part="", repo=""):
    """The session-start payload: one named part, or all of them joined."""
    db = connect()
    project = resolve_project(db, path, repo) if path or repo else ""
    machine = f"machines/{host}" if host else ""

    thunks = {
        "tasks": lambda: show_log(db, "task"),
        "notes": lambda: show_log(db, "note"),
        "brain": lambda: brain_view(db) if store.brain_get(db) else "",
        "machine": lambda: memory_index(db, machine) if machine and machine != project else "",
        "project": lambda: memory_index(db, project) if project else "",
    }
    if part:
        if part not in thunks:
            raise ValueError(f"unknown part '{part}' — one of: {', '.join(thunks)}")
        text = thunks[part]().strip()
        if len(text) > HOOK_SAFE:
            text = (
                text[:HOOK_SAFE] + "\n[…trimmed to the 10k hook cap — read the rest with the tools]"
            )
        return text + "\n" if text else ""
    return "\n\n".join(s for s in (f().strip() for f in thunks.values()) if s) + "\n"
