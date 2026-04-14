"""Production application factory serving from dist/ directory.

This module extends the dev setup from main.py but serves the built/bundled
assets from the dist/ directory instead of www/.

The difference is expressed through Config.static_dir — no post-construction
route mutation is required.

To run in production:
    uvicorn planner:make_dist_app --factory --port 8001
"""
from planner_lib.main import create_app, Config


def create_dist_app(config: Config = None):
    """Create FastAPI app configured to serve production assets from dist/."""
    if config is None:
        config = Config()
    # Override static_dir so _build_app() serves from dist/ without any route
    # surgery after the app is constructed.
    config.static_dir = "dist"
    return create_app(config)
