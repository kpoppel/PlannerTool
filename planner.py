from planner_lib.main import Config, create_app
from planner_lib.main_dist import create_dist_app

# Optional: convenience factory for callers who want the default configuration.
# Do NOT call `create_app(Config())` here to avoid import-time side-effects.
def make_app():
    """Zero-arg factory for dev server (serves from www/)
       Run as: `uvicorn planner:make_app --factory --reload --port 8001`
    """
    return create_app(Config())


def make_dist_app():
    """Zero-arg factory for production server (serves from dist/)
       Run as: `uvicorn planner:make_dist_app --factory --port 8001`
    """
    return create_dist_app(Config())


# You can run this module directly for local testing with Uvicorn.
if __name__ == "__main__":
    import uvicorn

    """Run the app with Uvicorn for local testing."""
    app = create_app(Config())
    uvicorn.run(app, host="0.0.0.0", port=8000)
    