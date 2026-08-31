import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agentslate import api, nest, store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "slate.db"))
    monkeypatch.setattr(store, "IMAGES_DIR", str(tmp_path / "images"))
    monkeypatch.setattr(store, "NEST_DIR", str(tmp_path / "nest"))
    application = FastAPI()
    application.include_router(api.router)
    application.include_router(nest.router)
    with TestClient(application) as test_client:
        yield test_client


def test_lock_blocks_user_writes_across_api_surfaces(client):
    assert (
        client.post("/api/memory", json={"path": "project", "content": "before"}).status_code == 200
    )
    assert client.post("/api/lock", json={"on": True}).status_code == 200

    memory = client.post("/api/memory", json={"path": "project", "content": "after"})
    nest_add = client.post("/api/nest/add", json={"col": 1, "row": 1, "title": "blocked"})

    assert memory.status_code == 423
    assert memory.json() == {"detail": "Slate is locked"}
    assert nest_add.status_code == 423
    assert store.memory_get(store.connect(), "project") == "before"


def test_memory_remove_rejects_an_invalid_path(client):
    response = client.post("/api/memory/rm", json={"path": ".."})

    assert response.status_code == 400
    assert response.json() == {"error": "bad memory path '..'"}


def test_upload_auto_places_and_takes_the_agent_author(client):
    png = ("files", ("shot.png", b"\x89PNG fake bytes", "image/png"))

    first = client.post("/api/nest/upload?author=agent", files=[png])
    second = client.post("/api/nest/upload", files=[png])
    assert first.status_code == 200 and second.status_code == 200

    widgets = {w["id"]: w for w in client.get("/api/nest").json()["widgets"]}
    a, b = widgets[first.json()["id"]], widgets[second.json()["id"]]
    assert (a["author"], a["col"], a["row"]) == ("agent", 1, 1)
    assert (b["author"], (b["col"], b["row"]) != (1, 1)) == ("user", True)


def test_html_widget_prefers_explicit_title_and_is_sandboxed_when_opened_directly(client):
    made = client.post(
        "/api/nest/add",
        json={
            "col": 1,
            "row": 1,
            "title": "Chosen title",
            "html": "<!doctype html><title>Embedded title</title><script>window.ran = true</script>",
        },
    )
    assert made.status_code == 200
    widget_id = made.json()["id"]

    board = client.get("/api/nest").json()
    assert board["widgets"][0]["title"] == "Chosen title"
    document = client.get(f"/api/nest/item?id={widget_id}")
    assert document.headers["content-security-policy"] == "sandbox allow-scripts"
