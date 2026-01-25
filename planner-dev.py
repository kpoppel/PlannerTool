# Developmetn server for the planner application using in-memory storage backend
from planner_lib.main import create_app, Config
app = create_app(Config(storage_backend='memory'))
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)