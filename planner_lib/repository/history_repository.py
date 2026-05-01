"""HistoryRepository: application-layer facade for task revision history.

Provides the single authoritative source for work-item revision history,
replacing the former HistoryService.

Public API:

  read(tasks, project_id, user_id, ...) -> dict
    Returns ``{'page', 'per_page', 'total', 'tasks'}`` with per-task history.

    ``tasks`` must be a ``List[DomainTask]``.  Callers that need to filter
    by project should call ``TaskRepository.read(project_id=…)`` first and
    pass the resulting list here.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import HistoryBackend, BackendCredential
from planner_lib.domain.tasks import DomainTask
from planner_lib.domain.history import DomainHistoryEntry, DomainTaskHistory

logger = logging.getLogger(__name__)


class HistoryRepository:
    """Application-layer repository for task revision history.

    Parameters
    ----------
    backend:
        BackendPort implementation — ``fetch_history()`` is called per task.
    credential_provider:
        CredentialProvider — provides ``get_credential(user_id)``.
    """

    def __init__(self, backend: HistoryBackend, credential_provider) -> None:
        self._backend = backend
        self._credential_provider = credential_provider
        logger.info("HistoryRepository: initialised (backend=%s)", type(backend).__name__)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read(
        self,
        tasks: List[DomainTask],
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        team_id: Optional[str] = None,
        plan_id: Optional[str] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        page: int = 1,
        per_page: int = 100,
    ) -> Dict[str, Any]:
        """Fetch revision history for a page of tasks.

        Parameters
        ----------
        tasks:
            Pre-resolved list of DomainTask dicts to fetch history for.
            Callers should call ``TaskRepository.read(project_id=…)`` first
            when a project filter is required.
        project_id, team_id, plan_id:
            Optional filters applied to *tasks* before pagination.
        since, until:
            ISO date strings for date-range filtering of history entries.
        page, per_page:
            Pagination parameters (1-indexed).
        user_id:
            Session-level user id for credential lookup.
        """

        if not user_id:
            logger.error("user_id is required for fetching history")
            return {'page': page, 'per_page': per_page, 'total': 0, 'tasks': []}

        credential = self._credential_provider.get_credential(user_id)
        if credential is None:
            logger.error("No credential for user '%s'; history unavailable", user_id)
            return {'page': page, 'per_page': per_page, 'total': 0, 'tasks': []}

        # Apply filters
        filtered = list(tasks)
        if plan_id:
            filtered = [t for t in filtered if t.get('plan_id') == plan_id]

        # team_id filter: tasks don't carry team_id directly in DomainTask; skip for now
        # (same as the original HistoryService behaviour)

        total = len(filtered)
        start_idx = (page - 1) * per_page
        page_tasks = filtered[start_idx: start_idx + per_page]

        result_tasks: List[dict] = []
        for task in page_tasks:
            work_item_id = int(task.get('id', 0))
            if not work_item_id:
                logger.warning("Skipping task with invalid ID: %s", task)
                continue
            try:
                entries: List[DomainHistoryEntry] = self._backend.fetch_history(
                    work_item_id=work_item_id,
                    credential=credential,
                )
                # Convert DomainHistoryEntry dicts to legacy format expected by frontend
                history_entries: List[dict] = [
                    {
                        'field': e.get('field'),
                        'value': e.get('value'),
                        'changed_at': e.get('changed_at', ''),
                        'changed_by': e.get('changed_by', ''),
                    }
                    for e in entries
                ]
                history_entries.sort(key=lambda x: x.get('changed_at', ''))
                history_entries = self._deduplicate_history(history_entries)
                history_entries = self._compute_pairing_hints(history_entries)

                if since or until:
                    history_entries = [
                        e for e in history_entries
                        if (not since or (e.get('changed_at', '')[:10] >= since))
                        and (not until or (e.get('changed_at', '')[:10] <= until))
                    ]

                result_tasks.append({
                    'task_id': work_item_id,
                    'title': task.get('title', ''),
                    'plan_id': task.get('plan_id', ''),
                    'history': history_entries,
                })
            except Exception as exc:
                logger.warning("Failed to process history for task %d: %s", work_item_id, exc)
                result_tasks.append({
                    'task_id': work_item_id,
                    'title': task.get('title', ''),
                    'plan_id': task.get('plan_id', ''),
                    'history': [],
                })

        return {'page': page, 'per_page': per_page, 'total': total, 'tasks': result_tasks}

    @staticmethod
    def _deduplicate_history(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove consecutive duplicate values per field."""
        if not history:
            return []
        last_values: Dict[str, Any] = {}
        result: List[dict] = []
        for entry in history:
            field = entry.get('field')
            value = entry.get('value')
            if field not in last_values or last_values[field] != value:
                result.append(entry)
                last_values[field] = value
        return result

    @staticmethod
    def _compute_pairing_hints(
        history: List[Dict[str, Any]], delta_seconds: int = 60
    ) -> List[Dict[str, Any]]:
        """Add ``pair_id`` hints to entries changed at similar times by the same user."""
        if not history:
            return []

        parsed: List[tuple] = []
        for entry in history:
            ts_str = entry.get('changed_at', '')
            try:
                if not ts_str:
                    parsed.append((None, entry))
                    continue
                if 'T' in ts_str:
                    ts_str = ts_str.replace('Z', '+00:00')
                    ts = datetime.fromisoformat(ts_str)
                else:
                    ts = datetime.fromisoformat(ts_str + 'T00:00:00')
                parsed.append((ts, entry))
            except Exception:
                parsed.append((None, entry))

        pair_id = 1
        pair_assignments: Dict[int, int] = {}

        for i, (ts, entry) in enumerate(parsed):
            if ts is None or i in pair_assignments:
                continue
            for j in range(i + 1, min(len(parsed), i + 4)):
                if j in pair_assignments:
                    continue
                other_ts, other_entry = parsed[j]
                if other_ts is None:
                    continue
                diff = abs((ts - other_ts).total_seconds())
                if (
                    entry.get('changed_by') == other_entry.get('changed_by')
                    and entry.get('field') != other_entry.get('field')
                    and diff <= delta_seconds
                ):
                    pair_assignments[i] = pair_id
                    pair_assignments[j] = pair_id
                    pair_id += 1
                    break

        result: List[dict] = []
        for i, (_ts, entry) in enumerate(parsed):
            out_entry = dict(entry)
            if i in pair_assignments:
                out_entry['pair_id'] = pair_assignments[i]
            result.append(out_entry)
        return result
