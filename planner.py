from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from planner_lib.config.health import get_health


app = FastAPI(title="AZ Planner Dev Server")

# Serve static UI from www/ under /static
app.mount("/static", StaticFiles(directory="www"), name="static")

@app.get("/", response_class=HTMLResponse)
async def root():
    # Redirect-style: serve index quickly
    with open("www/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/dev", response_class=HTMLResponse)
async def dev_page():
    return FileResponse("www/dev.html")

@app.get("/api/health")
async def api_health():
    return get_health()
