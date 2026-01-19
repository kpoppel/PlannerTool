#!/bin/bash
cd /home/planner/PlannerTool
git pull origin main
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/migrate.py --apply --backup
exec uvicorn planner:app --host 127.0.0.1 --port 8000