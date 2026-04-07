"""Closed-task filtering: include Completed items only when they have an open ancestor.

Rule: a work item in the ``Completed`` Azure DevOps state category is included
in the result set **only** if at least one ancestor (transitively via the
``Parent`` relation) has a state that is *not* in the ``Completed`` category.

Items whose entire ancestor chain is Completed — or that are roots with no
parent at all — are excluded.

These functions are deliberately decoupled from the Azure client and the
service layer so they can be unit-tested without any live Azure connection.
They operate on plain ``dict`` objects in the same shape that
``WorkItemOperations.get_work_items`` returns.
"""
from __future__ import annotations

import logging
from typing import Callable, List

logger = logging.getLogger(__name__)

# The Azure DevOps category string for "done" work.
# Exposed as a module constant so callers can easily extend the set of
# categories to treat as closed (e.g. add 'Removed') if needed.
COMPLETED_CATEGORY: str = 'Completed'


def get_completed_states(include_states: List[str], state_categories: dict) -> List[str]:
    """Return the subset of *include_states* whose Azure category is ``Completed``.

    Args:
        include_states:  State names configured for the project (e.g. ``['Active', 'Closed']``).
        state_categories: Mapping of ``{state_name: azure_category}`` from project metadata.

    Returns:
        State names whose category equals :data:`COMPLETED_CATEGORY`.
    """
    return [s for s in include_states if state_categories.get(s) == COMPLETED_CATEGORY]


def get_non_completed_states(include_states: List[str], state_categories: dict) -> List[str]:
    """Return the subset of *include_states* whose Azure category is **not** ``Completed``.

    Args:
        include_states:  State names configured for the project.
        state_categories: Mapping of ``{state_name: azure_category}`` from project metadata.

    Returns:
        State names whose category is anything other than :data:`COMPLETED_CATEGORY`.
    """
    return [s for s in include_states if state_categories.get(s) != COMPLETED_CATEGORY]


def _is_completed(task: dict, state_categories: dict) -> bool:
    """Return True if the task's state maps to the Completed category."""
    return state_categories.get(task.get('state', '')) == COMPLETED_CATEGORY


def _has_open_ancestor(
    task_id: str,
    tasks_by_id: dict,
    state_categories: dict,
    fetch_by_ids_fn: Callable[[List[int]], List[dict]],
    extra_cache: dict,
    visited: set,
) -> bool:
    """Return True if any transitive ancestor (via ``Parent`` relation) is not Completed.

    Traverses the ``Parent`` relation chain from *task_id* upward.  Items not
    present in *tasks_by_id* are fetched via *fetch_by_ids_fn* and stored in
    *extra_cache* to avoid duplicate requests.  A ``visited`` set prevents
    infinite loops in malformed relation graphs.

    Rules:
    - If an ancestor's state category is NOT Completed → return True (open).
    - If all reachable ancestors are Completed → return False.
    - If an item has no Parent relation (root item) → return False.
    - Unknown / unreachable parents are skipped conservatively.

    Args:
        task_id:          String ID of the item to check.
        tasks_by_id:      Pre-built ``{str_id: task}`` dict covering all items fetched
                          by the primary queries (regular + completed).
        state_categories: ``{state_name: azure_category}`` from project metadata.
        fetch_by_ids_fn:  ``callable(ids: List[int]) -> List[dict]`` used to resolve
                          parent items not yet in ``tasks_by_id``.
        extra_cache:      Mutable dict populated with additionally fetched items so
                          repeated traversals do not re-request the same ID.
        visited:          Set of task IDs already seen in this traversal path (cycle guard).
    """
    if task_id in visited:
        return False
    visited.add(task_id)

    task = tasks_by_id.get(task_id) or extra_cache.get(task_id)
    if task is None:
        # Cannot determine — treat as not having an open ancestor
        return False

    parent_ids = [
        r['id']
        for r in (task.get('relations') or [])
        if r.get('type') == 'Parent'
    ]

    if not parent_ids:
        # Root of the hierarchy — no open ancestor above
        return False

    for parent_id in parent_ids:
        parent = tasks_by_id.get(parent_id) or extra_cache.get(parent_id)
        if parent is None:
            # Fetch from Azure (parent may be outside the configured area path)
            try:
                fetched = fetch_by_ids_fn([int(parent_id)])
                for f in fetched:
                    extra_cache[str(f['id'])] = f
                parent = extra_cache.get(parent_id)
            except Exception as exc:
                logger.warning(
                    "Failed to fetch parent %s during closed-task traversal: %s",
                    parent_id, exc,
                )

        if parent is None:
            # Still unreachable; skip this branch
            continue

        if not _is_completed(parent, state_categories):
            # Found a non-Completed ancestor — this completed item qualifies
            return True

        # Parent is also Completed — continue up the chain
        if _has_open_ancestor(
            parent_id, tasks_by_id, state_categories, fetch_by_ids_fn, extra_cache, visited
        ):
            return True

    return False


def filter_completed_with_open_ancestors(
    completed_tasks: List[dict],
    all_tasks_by_id: dict,
    state_categories: dict,
    fetch_by_ids_fn: Callable[[List[int]], List[dict]],
) -> List[dict]:
    """Filter *completed_tasks* to those with at least one non-Completed ancestor.

    This implements the primary business rule described in the module docstring.
    Results maintain the original item order.

    Args:
        completed_tasks:  Work items in the Completed category to evaluate.
        all_tasks_by_id:  ``{str_id: task}`` map of every item already fetched
                          (both regular and completed tasks combined).  Providing
                          a combined map avoids redundant Azure fetches for items
                          that appear as parents in both queries.
        state_categories: ``{state_name: azure_category}`` from project metadata.
        fetch_by_ids_fn:  Callable used to resolve unknown parent items.  Receives
                          a ``List[int]`` of IDs and must return plain task dicts
                          with at least ``id``, ``state`` and ``relations`` keys.

    Returns:
        The subset of *completed_tasks* whose transitive ancestor closure
        contains at least one non-Completed item.
    """
    if not completed_tasks:
        return []

    # Shared cache for parents fetched during this filter run
    extra_cache: dict = {}
    result = []

    for task in completed_tasks:
        task_id = str(task['id'])
        if _has_open_ancestor(
            task_id, all_tasks_by_id, state_categories,
            fetch_by_ids_fn, extra_cache, set(),
        ):
            result.append(task)

    logger.debug(
        "Closed-task filter: %d completed tasks evaluated, %d qualify (have open ancestors)",
        len(completed_tasks),
        len(result),
    )
    return result
