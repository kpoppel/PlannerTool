from typing import List, Dict, Any, Optional
from .config import load_cost_config
from .engine import calculate
import logging
logger = logging.getLogger(__name__)


def estimate_costs(session: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Traverse features/tasks from a session-like dict and compute costs using `calculate`.

    Returns nested mapping { project_id: { task_id: cost_dict } }
    """
    cfg = load_cost_config()
    features = session.get("features", []) if session else []

    projects: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for f in features:
        logger.debug("Estimating cost for feature/task: %s", f)
        fid = f.get("id")
        project_id = f.get("project")
        start = f.get("start")
        end = f.get("end")
        capacity = f.get("capacity")

        cost = calculate(cfg, start=start, end=end, capacity=capacity)

        if project_id not in projects:
            projects[project_id] = {}
        projects[project_id][fid] = cost

    return projects
