"""Board routes: the read side plus the user's own actions — add from the
plus cell, upload, move/resize, remove, grid size, boards."""

import mimetypes
import os

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

from . import store
from .api import ItemId, writable
from .store import connect

router = APIRouter()


def _size(p):
    try:
        return os.path.getsize(p)
    except OSError:
        return 0


@router.get("/api/nest")
def nest(board: str = "main"):
    db = connect()
    board = board.strip() or "main"
    if board not in store.nest_boards(db):
        board = "main"
    ws = store.nest_all(db, board)
    hidden = store.nest_hidden_ids(ws)
    out = []
    for w in ws:
        d = {
            k: w[k]
            for k in ("id", "kind", "col", "row", "w", "h", "title", "descr", "author", "ts")
        }
        d["hidden"] = w["id"] in hidden
        if w["kind"] == "canvas":
            d["canvas"] = store.canvas_resolve_file(store.canvas_get(db, int(w["ref"])))
        elif w["kind"] == "html":
            doc = store.html_get(db, int(w["ref"]))
            d["html"] = (
                {k: doc[k] for k in ("id", "ts", "title", "author", "versions")} if doc else None
            )
            d["title"] = doc["title"] if doc else w["title"]
            d["items"] = (
                [
                    {
                        "url": f"/api/nest/item?id={w['id']}&i=0&v={doc['versions']}",
                        "name": f"{doc['title']}.html",
                        "size": 0,
                    }
                ]
                if doc
                else []
            )
        else:
            d["items"] = [
                {
                    "url": f"/api/nest/item?id={w['id']}&i={i}",
                    "name": it["n"],
                    "size": _size(it["p"]),
                }
                for i, it in enumerate(store.nest_items(w))
            ]
        out.append(d)
    cols, rows = store.nest_size(db, board)
    return {
        "cols": cols,
        "rows": rows,
        "widgets": out,
        "board": board,
        "boards": store.nest_boards(db),
    }


@router.get("/api/nest/item")
def nest_item(id: int, i: int = 0):
    db = connect()
    w = store.nest_get(db, id)
    if w and w["kind"] == "html":
        doc = store.html_get(db, int(w["ref"]))
        if not doc:
            return JSONResponse(status_code=404, content={"error": "no such document"})
        return HTMLResponse(
            doc["content"], headers={"Content-Security-Policy": "sandbox allow-scripts"}
        )
    items = store.nest_items(w) if w and w["kind"] in ("image", "file") else []
    if i >= len(items) or not os.path.isfile(items[i]["p"]):
        return JSONResponse(status_code=404, content={"error": "not found"})
    return FileResponse(items[i]["p"], filename=items[i]["n"] if w["kind"] == "file" else None)


# ---------------------------------------------------------------- html docs


@router.get("/api/nest/htmls")
def nest_htmls():
    return {"htmls": store.html_all(connect())}


@router.get("/api/nest/html")
def nest_html(id: int):
    doc = store.html_get(connect(), id)
    if not doc:
        return JSONResponse(status_code=404, content={"error": "no such document"})
    return {"html": doc}


@router.get("/api/nest/html/versions")
def nest_html_versions(id: int):
    db = connect()
    if not store.html_get(db, id):
        return JSONResponse(status_code=404, content={"error": "no such document"})
    return {"versions": store.html_versions(db, id)}


@router.get("/api/nest/html/version")
def nest_html_version(id: int):
    v = store.html_version_get(connect(), id)
    if not v:
        return JSONResponse(status_code=404, content={"error": "no such version"})
    return {"version": v}


class HtmlEdit(BaseModel):
    id: int
    title: str
    content: str


@router.post("/api/nest/html")
def nest_html_edit(req: HtmlEdit):
    title = req.title.strip()
    if not title:
        return JSONResponse(status_code=400, content={"error": "a document needs a title"})
    if not store.html_edit_by(writable(), req.id, title, req.content, "user"):
        return JSONResponse(status_code=404, content={"error": "no such document"})
    return {"ok": True}


class HtmlCopy(BaseModel):
    id: int
    title: str = ""


@router.post("/api/nest/html/copy")
def nest_html_copy(req: HtmlCopy):
    db = writable()
    did = store.html_copy(db, req.id, req.title.strip(), "user")
    if did is None:
        return JSONResponse(status_code=404, content={"error": "no such document"})
    return {"ok": True, "id": did, "html": store.html_get(db, did)}


class HtmlRestore(BaseModel):
    id: int
    version: int


@router.post("/api/nest/html/restore")
def nest_html_restore(req: HtmlRestore):
    db = writable()
    v = store.html_version_get(db, req.version)
    if not v or v["html_id"] != req.id:
        return JSONResponse(status_code=404, content={"error": "no such version"})
    store.html_edit_by(db, req.id, v["title"], v["content"], "user")
    return {"ok": True, "html": store.html_get(db, req.id)}


@router.post("/api/nest/html/rm")
def nest_html_rm(req: ItemId):
    store.html_rm(writable(), req.id)
    return {"ok": True}


# ------------------------------------------------------------------ widgets


class NestAdd(BaseModel):
    col: int
    row: int
    board: str = "main"
    canvas_id: int = 0  # an existing canvas, or
    title: str = ""  # a fresh canvas opening with this heading, or
    content: str = ""  # a fresh canvas holding pasted text, or
    html: str = ""  # a pasted document → a stored doc + html widget, or
    html_id: int = 0  # a saved document, re-placed


@router.post("/api/nest/add")
def nest_add(req: NestAdd):
    db = writable()
    if store.nest_fit(db, req.board, req.col, req.row):
        return JSONResponse(status_code=409, content={"error": "cell occupied"})
    if req.html or req.html_id:
        if req.html_id:
            doc = store.html_get(db, req.html_id)
            if not doc:
                return JSONResponse(status_code=404, content={"error": "no such document"})
            did, title = doc["id"], doc["title"]
        else:
            title = req.title.strip() or store.html_title(req.html) or "html"
            did = store.html_add(db, title, req.html, "user")
        return {
            "ok": True,
            "id": store.nest_add(
                db, req.board, "html", req.col, req.row, str(did), title, author="user"
            ),
        }
    if req.canvas_id:
        doc = store.canvas_get(db, req.canvas_id)
        if not doc:
            return JSONResponse(status_code=404, content={"error": "no such canvas"})
    else:
        content = req.content or (f"# {req.title}\n" if req.title else "")
        doc = store.canvas_get(db, store.canvas_add(db, content, author="user"))
    return {
        "ok": True,
        "id": store.nest_add(
            db, req.board, "canvas", req.col, req.row, str(doc["id"]), author="user"
        ),
    }


@router.post("/api/nest/upload")
async def nest_upload(
    col: int = 0,
    row: int = 0,
    board: str = "main",
    author: str = "user",
    files: list[UploadFile] = File(...),
):
    """Bytes for the board — the UI's drop, and a remote agent's curl (the
    one write MCP can't carry: tool arguments travel through the model, so
    file bytes come here instead). col=row=0 takes the first free cell;
    all images make a gallery, any other mix a file card."""
    db = writable()
    author = "agent" if author == "agent" else "user"
    if not col and not row:
        spot = store.nest_free_cell(db, board)
        if not spot:
            return JSONResponse(status_code=409, content={"error": "board full"})
        col, row = spot
    elif store.nest_fit(db, board, col, row):
        return JSONResponse(status_code=409, content={"error": "cell occupied"})
    types = [(f.content_type or "").split(";")[0] for f in files]
    kind = "image" if all(t.startswith("image/") for t in types) else "file"
    names = [f.filename or "pasted image" for f in files]
    title = (
        names[0] if len(files) == 1 else f"{len(files)} {'images' if kind == 'image' else 'files'}"
    )
    wid = store.nest_add(db, board, kind, col, row, "", title, author=author)
    os.makedirs(store.NEST_DIR, exist_ok=True)
    items = []
    for i, (f, ctype, name) in enumerate(zip(files, types, names, strict=True), 1):
        ext = os.path.splitext(name)[1].lower() or mimetypes.guess_extension(ctype) or ""
        dst = os.path.join(store.NEST_DIR, f"{wid}-{i}{ext}")
        with open(dst, "wb") as out:
            out.write(await f.read())
        items.append({"p": dst, "n": name})
    store.nest_set_items(db, wid, items)
    return {"ok": True, "id": wid}


class Resize(BaseModel):
    id: int
    col: int
    row: int
    w: int
    h: int


@router.post("/api/nest/resize")
def nest_resize(req: Resize):
    """A drag — move or edge resize; the widget lands on top of the stack."""
    db = writable()
    wg = store.nest_get(db, req.id)
    if not wg:
        return JSONResponse(status_code=404, content={"error": "no such widget"})
    cols, rows = store.nest_size(db, wg["board"])
    col = max(1, min(req.col, cols))
    row = max(1, min(req.row, rows))
    store.nest_place(
        db, req.id, col, row, max(1, min(req.w, cols - col + 1)), max(1, min(req.h, rows - row + 1))
    )
    return {"ok": True}


@router.post("/api/nest/rm")
def nest_rm(req: ItemId):
    store.nest_rm(writable(), req.id)
    return {"ok": True}


class Grid(BaseModel):
    cols: int
    rows: int
    board: str = "main"


@router.post("/api/nest/grid")
def nest_grid(req: Grid):
    """Resize the board; widgets that no longer fit are removed."""
    db = writable()
    try:
        store.nest_set_size(db, req.board, req.cols, req.rows)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    for w in store.nest_all(db, req.board):
        if w["col"] + w["w"] - 1 > req.cols or w["row"] + w["h"] - 1 > req.rows:
            store.nest_rm(db, w["id"])
    return {"ok": True}


class Board(BaseModel):
    name: str


@router.post("/api/nest/clear")
def nest_clear(req: Board):
    store.nest_clear(writable(), req.name)
    return {"ok": True}


@router.post("/api/nest/board")
def nest_board(req: Board):
    try:
        store.nest_ensure_board(writable(), req.name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"ok": True}


class BoardRename(BaseModel):
    old: str
    new: str


@router.post("/api/nest/board/rename")
def nest_board_rename(req: BoardRename):
    try:
        store.nest_rename_board(writable(), req.old, req.new)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"ok": True}


@router.post("/api/nest/board/rm")
def nest_board_rm(req: Board):
    try:
        store.nest_drop_board(writable(), req.name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"ok": True}
