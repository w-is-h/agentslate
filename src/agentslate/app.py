"""One process, one port: the web UI (built frontend + /api), the MCP
server at /mcp, and the session-start hook endpoint."""

import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mcp.server.transport_security import TransportSecuritySettings

from . import api, nest
from .api import STATIC
from .mcp import mcp

# The MCP endpoint answers any Host header: the network the server is
# bound to (a VPN, localhost) is the authentication boundary.
mcp_app = mcp.streamable_http_app(
    stateless_http=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@asynccontextmanager
async def lifespan(app):
    async with mcp.session_manager.run():
        yield


app = FastAPI(lifespan=lifespan)
app.include_router(api.router)
app.include_router(nest.router)
if os.path.isdir(os.path.join(STATIC, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC, "assets")), name="assets")


@app.get("/")
@app.get("/index.html")
def index():
    page = os.path.join(STATIC, "index.html")
    if not os.path.isfile(page):
        return JSONResponse(
            status_code=503,
            content={
                "error": "frontend not built — run `npm install && npm run build` in frontend/"
            },
        )
    return FileResponse(page)


app.mount("/", mcp_app)  # last: it serves /mcp and nothing else


def serve(host, port):
    from . import mcp as mcp_module

    mcp_module.SERVER_URL = f"http://{host}:{port}"
    print(f"slate: http://{host}:{port}  (mcp at /mcp; ctrl-c to stop)")
    try:
        # MCP clients hold a GET stream open indefinitely; without a bound,
        # shutdown waits for it forever and systemd ends up SIGKILLing.
        uvicorn.run(app, host=host, port=port, log_level="warning", timeout_graceful_shutdown=3)
    except KeyboardInterrupt:
        pass
