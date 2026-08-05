from planner_lib.main import Config, create_app

# Do NOT call create_app(Config()) here to avoid import-time side-effects.
def make_app():
    """Zero-arg uvicorn factory — serves the Vite-built dist/ bundle.
       Run as: `uvicorn planner:make_app --factory --reload --port 8001`
       Note: run `npm run build` first if dist/ doesn't exist.
    """
    return create_app(Config())


# You can run this module directly for local testing with Uvicorn.
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(Config()), host="0.0.0.0", port=8000)
