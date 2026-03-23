"""Production application factory serving from dist/ directory.

This module extends the dev setup from main.py but serves the built/bundled 
assets from the dist/ directory instead of www/.

To run in production:
    uvicorn planner:make_dist_app --factory --port 8001
"""
from pathlib import Path
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from planner_lib.main import create_app, Config


def create_dist_app(config: Config):
    """Create FastAPI app configured to serve production assets from dist/."""
    # Create the base app with all services and middleware
    app = create_app(config)
    
    # Override the root route and static mount to serve from dist/
    # Remove the existing routes first
    app.router.routes = [route for route in app.router.routes if not (
        hasattr(route, 'path') and route.path in ['/', '/static']
    )]
    
    # Serve built index.html at root
    @app.get("/", response_class=HTMLResponse)
    async def root():
        dist_index = Path('dist/index.html')
        if not dist_index.exists():
            raise FileNotFoundError(
                "dist/index.html not found. Run 'npm run build' to generate production assets."
            )
        return dist_index.read_text(encoding='utf-8')
    
    # Mount dist/ directory at /static for all bundled assets
    app.mount("/static", StaticFiles(directory="dist"), name="static")
    
    return app
