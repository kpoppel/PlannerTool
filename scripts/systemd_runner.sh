#!/bin/bash
cd /home/planner/PlannerTool
git pull origin main
source .venv/bin/activate
pip install -r requirements.txt
exec uvicorn planner:make_app --factory --host 127.0.0.1 --port 8000