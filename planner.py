from planner_lib.main import Config, create_app

# Optional: convenience factory for callers who want the default configuration.
# Do NOT call `create_app(Config())` here to avoid import-time side-effects.
def make_app():
    """Zero-arg factory for servers that support factory callables
       Run as: `uvicorn planner:make_app--factory --reload`
    """
    return create_app(Config())

# You can run this module directly for local testing with Uvicorn.
if __name__ == "__main__":
    import uvicorn

    """Run the app with Uvicorn for local testing."""
    app = create_app(Config())
    uvicorn.run(app, host="0.0.0.0", port=8000)
    