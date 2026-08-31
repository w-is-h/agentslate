import json
import threading
import time

import pytest

from agentslate import store, views
from agentslate.mcp import _edit


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "slate.db"))
    monkeypatch.setattr(store, "IMAGES_DIR", str(tmp_path / "images"))
    monkeypatch.setattr(store, "NEST_DIR", str(tmp_path / "nest"))
    connection = store.connect()
    yield connection
    connection.close()


def test_memory_paths_and_implicit_children(db):
    store.memory_set(db, " acme / site ", "# Site")
    store.memory_set(db, "acme/site/deploy", "# Deploy")

    assert store.memory_pages(db) == ["acme/site", "acme/site/deploy"]
    assert store.memory_children(db) == ["acme"]
    assert store.memory_children(db, "acme") == ["acme/site"]
    assert store.memory_children(db, "acme/site") == ["acme/site/deploy"]

    for path in ("", "acme//site", "acme/../site"):
        with pytest.raises(ValueError, match="bad memory path"):
            store.memory_path(path)


def test_memory_remove_treats_sql_wildcards_as_plain_path_characters(db):
    store.memory_set(db, "my_site", "remove")
    store.memory_set(db, "my_site/child", "remove too")
    store.memory_set(db, "my-site/notes", "keep")
    store.memory_set(db, "myXsite/notes", "keep too")

    assert store.memory_rm(db, "my_site", recursive=True) == 2
    assert store.memory_pages(db) == ["my-site/notes", "myXsite/notes"]


def test_page_limits_refuse_the_write(db):
    store.memory_set(db, "project", "kept")

    with pytest.raises(ValueError, match="Nothing was written"):
        store.memory_set(db, "project", "x" * (store.PAGE_LIMIT + 1))

    assert store.memory_get(db, "project") == "kept"


def test_config_overrides_defaults_and_refuses_unknown_keys(tmp_path):
    cfg = tmp_path / "config.yaml"
    assert store.read_config(str(cfg)) == store.DEFAULTS
    assert store.DEFAULTS["canvas_version_idle_seconds"] == 60

    cfg.write_text("task_keep: 10\ncanvas_version_idle_seconds: 5\n")
    assert store.read_config(str(cfg)) == {
        **store.DEFAULTS,
        "task_keep": 10,
        "canvas_version_idle_seconds": 5,
    }

    cfg.write_text("tasks_keep: 10\n")
    with pytest.raises(ValueError, match="unknown keys"):
        store.read_config(str(cfg))


def test_resolve_project_by_remote_inside_git_and_by_path_outside(db):
    store.memory_set(db, "acme/site", "# Site")
    store.memory_set(db, "acme/site/deploy", "# Deploy")
    store.memory_set(db, "tools", "# Tools — no repo")

    for url in (
        "git@github.com:acme/site.git",
        "https://github.com/Acme/Site",
        "ssh://git@gitlab.com:22/acme/site.git",
        "github-site:acme/site.git",
    ):
        assert views.resolve_project(db, "/anywhere/at/all", url) == "acme/site"
    # inside a repo the cwd never decides: an unknown remote loads nothing
    assert views.resolve_project(db, "/home/me/acme/site", "git@github.com:other/site.git") == ""
    # outside git: the longest trailing slice that is a page, exact only
    assert views.resolve_project(db, "/home/me/acme/site") == "acme/site"
    assert views.resolve_project(db, "/home/me/acme/site/deploy") == "acme/site/deploy"
    assert views.resolve_project(db, "/home/me/tools") == "tools"
    assert views.resolve_project(db, "/home/me/other/site") == ""


def test_resolve_project_learns_the_repos_web_host(db):
    store.memory_set(db, "acme/site", "# Site")

    views.resolve_project(db, "/anywhere", "git@github.com:acme/site.git")
    assert store.repo_hosts(db) == {"acme/site": "github.com"}
    # a moved repo re-teaches; an SSH alias names nothing reachable
    views.resolve_project(db, "/anywhere", "ssh://git@gitlab.com:22/acme/site.git")
    assert store.repo_hosts(db) == {"acme/site": "gitlab.com"}
    views.resolve_project(db, "/anywhere", "github-site:acme/site.git")
    assert store.repo_hosts(db) == {"acme/site": "gitlab.com"}


def test_task_prefixes_ride_free_of_the_day_budget(db):
    body = "acme/site: shipped\nno prefix here\nacme/site/deploy: out"
    assert store.draft_len("task", body) == len("shipped\nno prefix here\nout")
    assert store.draft_len("note", body) == len(body)
    # a long page key still counts as a prefix; a spaced colon phrase never does
    assert store.draft_len("task", "Big-Organisation/very-long-repository-name: x") == 1
    assert store.draft_len("task", "what we said: x") == len("what we said: x")

    # a task draft over the raw limit but under the billed one is accepted
    store.write_draft(db, "task", "acme/site: " + "x" * store.TASK_LIMIT)
    assert store.get_draft(db, "task").endswith("x" * store.TASK_LIMIT)
    with pytest.raises(ValueError, match=f"{store.TASK_LIMIT + 1}/{store.TASK_LIMIT}"):
        store.write_draft(db, "task", "acme/site: " + "x" * (store.TASK_LIMIT + 1))


def test_session_view_covers_the_last_task_lines_in_whole_days(db, monkeypatch):
    monkeypatch.setattr(store, "TASK_KEEP", 4)
    for day, body in [("2026-01-01", "a\nb"), ("2026-01-02", "c\nd\ne"), ("2026-01-03", "f\ng")]:
        db.execute("INSERT INTO entries (log, day, body) VALUES ('task', ?, ?)", (day, body))

    view = views.show_log(db, "task")
    assert "showing the last 2 (5 tasks)" in view
    assert "## 2026-01-02" in view and "## 2026-01-01" not in view


def test_session_start_shows_summary_and_today_and_the_fold_sees_the_frozen_rest(db, monkeypatch):
    monkeypatch.setattr(store, "today", lambda: "2026-01-04")
    for day in ("2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"):
        db.execute("INSERT INTO entries (log, day, body) VALUES ('note', ?, ?)", (day, f"on {day}"))

    view = views.show_log(db, "note")
    assert "none yet" in view and "## 2026-01-04" in view and "## 2026-01-03" not in view
    fold = views.fold_view(db)
    assert "3 day" in fold and "## 2026-01-01" in fold and "## 2026-01-04" not in fold

    assert store.summary_set(db, "the arc so far") == "2026-01-03"
    assert views.show_log(db, "note").startswith("# notes summary (14/")
    # nothing frozen since the fold: the check answers without the storyline
    assert views.fold_view(db) == "[nothing to fold]"
    # a fold with nothing new frozen keeps the mark
    assert store.summary_set(db, "the arc, reread") == "2026-01-03"


def test_canvas_history_groups_author_runs_and_reverts(db):
    canvas_id = store.canvas_add(db, "agent one", author="agent")
    store.canvas_edit_by(db, canvas_id, "agent two", "agent")
    assert store.canvas_versions(db, canvas_id) == []

    store.canvas_edit_by(db, canvas_id, "user one", "user")
    store.canvas_edit_by(db, canvas_id, "user two", "user")
    store.canvas_edit_by(db, canvas_id, "agent three", "agent")
    assert [version["author"] for version in store.canvas_versions(db, canvas_id)] == [
        "user",
        "agent",
    ]

    store.canvas_edit_by(db, canvas_id, "user two", "agent")
    live = store.canvas_get(db, canvas_id)
    assert live["content"] == "user two"
    assert live["author"] == "user"
    assert live["versions"] == 1


def test_canvas_history_starts_a_same_author_run_after_the_idle_gap(db, monkeypatch):
    monkeypatch.setattr(store, "CANVAS_VERSION_IDLE_SECONDS", 60)
    times = iter(
        [
            "2026-01-01 12:00:00",
            "2026-01-01 12:00:59",
            "2026-01-01 12:01:58",
            "2026-01-01 12:02:58",
        ]
    )
    monkeypatch.setattr(store, "now", lambda: next(times))
    canvas_id = store.canvas_add(db, "one", author="agent")

    store.canvas_edit_by(db, canvas_id, "two", "agent")
    store.canvas_edit_by(db, canvas_id, "three", "agent")
    assert store.canvas_versions(db, canvas_id) == []

    store.canvas_edit_by(db, canvas_id, "four", "agent")
    versions = store.canvas_versions(db, canvas_id)
    assert len(versions) == 1
    assert versions[0]["author"] == "agent"
    assert store.canvas_version_get(db, versions[0]["id"])["content"] == "three"


def test_canvas_idle_gap_prevents_collapsing_a_late_revert(db, monkeypatch):
    monkeypatch.setattr(store, "CANVAS_VERSION_IDLE_SECONDS", 60)
    times = iter(
        [
            "2026-01-01 12:00:00",
            "2026-01-01 12:00:10",
            "2026-01-01 12:00:20",
            "2026-01-01 12:02:00",
        ]
    )
    monkeypatch.setattr(store, "now", lambda: next(times))
    canvas_id = store.canvas_add(db, "agent one", author="agent")
    store.canvas_edit_by(db, canvas_id, "user one", "user")
    store.canvas_edit_by(db, canvas_id, "agent two", "agent")

    store.canvas_edit_by(db, canvas_id, "user one", "agent")

    live = store.canvas_get(db, canvas_id)
    assert live["content"] == "user one"
    assert live["author"] == "agent"
    assert live["ts"] == "2026-01-01 12:02:00"
    assert live["versions"] == 3


def test_canvas_read_decide_write_is_atomic(db, monkeypatch):
    canvas_id = store.canvas_add(db, "base", author="agent")
    first_read = threading.Event()
    release_first = threading.Event()

    def controlled_now():
        if threading.current_thread().name == "first writer":
            first_read.set()
            assert release_first.wait(2)
            return "2026-01-01 12:00:01"
        return "2026-01-01 12:00:02"

    monkeypatch.setattr(store, "now", controlled_now)

    def write(content, author):
        connection = store.connect()
        try:
            store.canvas_edit_by(connection, canvas_id, content, author)
        finally:
            connection.close()

    first = threading.Thread(target=write, name="first writer", args=("first", "user"))
    second = threading.Thread(target=write, name="second writer", args=("second", "agent"))
    first.start()
    assert first_read.wait(2)
    second.start()
    time.sleep(0.1)
    release_first.set()
    first.join(2)
    second.join(2)
    assert not first.is_alive() and not second.is_alive()

    live = store.canvas_get(db, canvas_id)
    versions = [
        store.canvas_version_get(db, v["id"])["content"]
        for v in store.canvas_versions(db, canvas_id)
    ]
    assert {live["content"], *versions} >= {"first", "second"}


def test_html_documents_snapshot_every_changed_save(db):
    doc_id = store.html_add(db, "first", "one", author="user")

    assert store.html_edit_by(db, doc_id, "second", "two", "user")
    assert store.html_edit_by(db, doc_id, "third", "three", "user")
    assert store.html_edit_by(db, doc_id, "third", "three", "user")

    versions = store.html_versions(db, doc_id)
    assert [version["title"] for version in versions] == ["second", "first"]
    assert store.html_get(db, doc_id)["versions"] == 2


def test_hidden_widget_does_not_occlude_widgets_below_it():
    widgets = [
        {"id": 1, "z": 1, "col": 1, "row": 1, "w": 1, "h": 1},
        {"id": 2, "z": 2, "col": 1, "row": 1, "w": 2, "h": 1},
        {"id": 3, "z": 3, "col": 2, "row": 1, "w": 1, "h": 1},
    ]

    assert store.nest_hidden_ids(widgets) == {2}


def test_board_sizes_are_independent(db):
    store.nest_ensure_board(db, "alpha")
    store.nest_set_size(db, "alpha", 6, 4)

    assert store.nest_size(db, "main") == (4, 4)
    assert store.nest_size(db, "alpha") == (6, 4)


def test_removing_file_widget_removes_its_stored_copy(db, tmp_path):
    stored = tmp_path / "nest" / "report.txt"
    stored.parent.mkdir()
    stored.write_text("report")
    widget_id = store.nest_add(
        db, "main", "file", 1, 1, json.dumps([{"p": stored.name, "n": "report.txt"}])
    )

    assert store.nest_rm(db, widget_id)["kind"] == "file"
    assert not stored.exists()
    assert store.nest_get(db, widget_id) is None


def test_reverting_the_other_authors_run_archives_it(db):
    canvas_id = store.canvas_add(db, "agent one", author="agent")
    store.canvas_edit_by(db, canvas_id, "user one", "user")
    # the agent puts its own text back over the user's run: that run is
    # archived, never dropped — only an author undoing itself is a revert
    store.canvas_edit_by(db, canvas_id, "agent one", "agent")

    assert store.canvas_get(db, canvas_id)["author"] == "agent"
    assert [v["author"] for v in store.canvas_versions(db, canvas_id)] == ["user", "agent"]


def test_exact_edit_refuses_an_empty_match():
    with pytest.raises(ValueError, match="must not be empty"):
        _edit("abc", "", "x", replace_all=True)
