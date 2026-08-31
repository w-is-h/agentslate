"""The web UI's routes: the one-payload /api/all behind a version token,
the user's writes (memory, canvases), the lock, exports, images, file
serving, and the session-start hook endpoint."""

import os
import sqlite3
import threading

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel

from . import pdf, store, views
from .store import connect

STATIC = os.path.join(os.path.dirname(__file__), "static")

router = APIRouter()

_vdb = None
_vdb_lock = threading.Lock()


def writable():
    """A UI write connection. The MCP has its own unguarded connection:
    the global lock freezes the user's surfaces while agents keep working."""
    db = connect()
    if store.kv_get(db, "locked", "0") == "1":
        db.close()
        raise HTTPException(status_code=423, detail="Slate is locked")
    return db


@router.get("/api/version")
def version():
    """Cheap change token: the db's data_version; `page` is the build's
    mtime — the client reloads outright when that moves."""
    global _vdb
    with _vdb_lock:
        if _vdb is None:
            connect().close()
            _vdb = sqlite3.connect(store.DB_PATH, check_same_thread=False)
        dv = _vdb.execute("PRAGMA data_version").fetchone()[0]
    index = os.path.join(STATIC, "index.html")
    page = int(os.path.getmtime(index)) if os.path.isfile(index) else 0
    return {"v": str(dv), "page": page}


@router.get("/api/all")
def api_all():
    db = connect()
    summary, through = store.summary_get(db)
    return {
        "today": store.today(),
        "notes": [{"day": d, "body": b} for d, b in store.get_days(db, "note")],
        "tasks": [{"day": d, "body": b} for d, b in store.get_days(db, "task")],
        "brain": store.brain_get(db),
        "brain_limit": store.BRAIN_LIMIT,
        "note_summary": summary,
        "note_summary_through": through,
        "note_summary_limit": store.SUMMARY_LIMIT,
        "memory_page_limit": store.PAGE_LIMIT,
        "locked": store.kv_get(db, "locked", "0") == "1",
        "repo_hosts": store.repo_hosts(db),
        "memory": [
            {"path": p, "content": c, "updated": u, "accessed": a}
            for p, c, u, a in store.memory_all(db)
        ],
        "nest": store.nest_count(db),
    }


@router.get("/api/file")
def file(path: str = ""):
    """A text file linked from prose, restricted to the home directory."""
    real = os.path.realpath(os.path.expanduser(path))
    home = os.path.realpath(os.path.expanduser("~"))
    if not real.startswith(home + os.sep) or not os.path.isfile(real):
        return JSONResponse(status_code=404, content={"error": "not found"})
    try:
        with open(real) as f:
            content = f.read()
    except UnicodeDecodeError:
        return JSONResponse(status_code=415, content={"error": "not a text file"})
    return {"name": os.path.basename(real), "content": content}


class MemSave(BaseModel):
    path: str
    content: str


@router.post("/api/memory")
def memory_save(req: MemSave):
    try:
        store.memory_set(writable(), req.path, req.content)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"ok": True}


class Switch(BaseModel):
    on: bool


@router.post("/api/lock")
def lock(req: Switch):
    """The one lock: on, the UI renders memory pages and canvases read-only
    everywhere; toggled from any of them. The agent's tools are unaffected."""
    store.kv_set(connect(), "locked", "1" if req.on else "0")
    return {"ok": True}


class MemRm(BaseModel):
    path: str


@router.post("/api/memory/rm")
def memory_rm(req: MemRm):
    """The user's delete: the page and everything beneath it."""
    try:
        pages = store.memory_rm(writable(), req.path.strip("/"), recursive=True)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"ok": True, "pages": pages}


@router.get("/api/memory/pdf")
def memory_pdf(path: str):
    path = path.strip("/")
    content = store.memory_get(connect(), path)
    if content is None:
        return JSONResponse(status_code=404, content={"error": "no page"})
    return pdf.response(pdf.fname(path), path, content, True)


# -------------------------------------------------------------------- brain


class BrainSave(BaseModel):
    content: str


@router.post("/api/brain")
def brain_save(req: BrainSave):
    try:
        store.brain_set(writable(), req.content)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"ok": True}


@router.get("/api/brain/pdf")
def brain_pdf():
    return pdf.response("brain", "brain", store.brain_get(connect()), True)


# ------------------------------------------------------------------- canvas


@router.get("/api/canvas")
def canvas(id: int = 0):
    return {"canvas": store.canvas_resolve_file(store.canvas_get(connect(), id or None))}


@router.get("/api/canvas/versions")
def canvas_versions(id: int):
    return {"versions": store.canvas_versions(connect(), id)}


@router.get("/api/canvas/version")
def canvas_version(id: int):
    v = store.canvas_version_get(connect(), id)
    if not v:
        return JSONResponse(status_code=404, content={"error": "no version"})
    return {"version": v}


@router.get("/api/canvases")
def canvases():
    return {"canvases": store.canvas_all(connect())}


@router.get("/api/canvas/pdf")
def canvas_pdf(id: int):
    doc = store.canvas_resolve_file(store.canvas_get(connect(), id))
    if not doc:
        return JSONResponse(status_code=404, content={"error": "no canvas"})
    meta = f"#{doc['id']} · {doc['author']} · {doc['ts']}"
    return pdf.response(pdf.fname(doc["label"]), meta, doc["content"], pdf.markdownish(doc))


@router.get("/api/canvas/md")
def canvas_md(id: int):
    """The content as it is, downloaded."""
    doc = store.canvas_resolve_file(store.canvas_get(connect(), id))
    if not doc:
        return JSONResponse(status_code=404, content={"error": "no canvas"})
    return Response(
        doc["content"],
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{pdf.fname(doc["label"])}.md"'},
    )


class CanvasEdit(BaseModel):
    id: int
    content: str


@router.post("/api/canvas")
def canvas_edit(req: CanvasEdit):
    try:
        return {"ok": store.canvas_edit_by(writable(), req.id, req.content, "user")}
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


class CanvasFlag(BaseModel):
    id: int
    on: bool


@router.post("/api/canvas/star")
def canvas_star(req: CanvasFlag):
    store.canvas_star(writable(), req.id, req.on)
    return {"ok": True}


class ItemId(BaseModel):
    id: int


@router.post("/api/canvas/rm")
def canvas_rm(req: ItemId):
    return {"ok": store.canvas_rm(writable(), req.id) is not None}


# ------------------------------------------------------------------- images
# Pasted into any livemd editor, uploaded once, served immutable; a canvas
# references one as [name.png](/api/images/<id>).

INLINE = {"image/png", "image/jpeg", "image/gif", "image/webp"}


@router.post("/api/images")
async def image_upload(file: UploadFile = File(...)):
    ctype = (file.content_type or "").split(";")[0]
    if ctype not in INLINE:
        return JSONResponse(
            status_code=415, content={"error": "images only — png, jpg, gif or webp"}
        )
    name = file.filename or "image"
    iid = store.image_add(writable(), name, ctype)
    os.makedirs(store.IMAGES_DIR, exist_ok=True)
    with open(os.path.join(store.IMAGES_DIR, iid), "wb") as out:
        out.write(await file.read())
    return {"id": iid, "name": name}


@router.get("/api/images/{iid}")
def image(iid: str):
    meta = store.image_get(connect(), iid)
    path = os.path.join(store.IMAGES_DIR, iid)
    if not meta or not os.path.isfile(path):
        return JSONResponse(status_code=404, content={"error": "not found"})
    return FileResponse(
        path,
        media_type=meta["content_type"],
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


# --------------------------------------------------------------------- hook


@router.get("/hook/session-start")
def session_start(path: str = "", host: str = "", part: str = "", repo: str = ""):
    """The session-start bundle the harness hook curls — one part per call
    (each under the 10k hook cap), or everything without `part`. `repo` is
    the cwd's git remote; it decides the project page inside a repo."""
    try:
        return PlainTextResponse(views.session_bundle(path, host, part, repo))
    except ValueError as e:
        return PlainTextResponse(str(e), status_code=400)
