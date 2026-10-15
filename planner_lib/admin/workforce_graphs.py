"""Read-only retained canonical graphs for workforce membership validation."""
from collections.abc import Mapping
from copy import deepcopy
from typing import Any

from planner_lib.cost.allocation_rule import allocation_conflicts
from planner_lib.storage.base import StorageBackend


def retained_allocation_graphs(
    storage: StorageBackend, task_storage: StorageBackend,
) -> dict[str, list[dict[str, Any]]]:
    """Apply scenarios to retained tasks; absent-task overrides remain stored but dormant."""
    tasks: dict[str, dict[str, Any]] = {}
    fields = {'id', 'revision', 'capacity', 'start', 'end', 'parentId', 'relations',
              'type', 'stateCategory', 'traversalBoundary', 'excludedChildIds'}
    context_fields = {'stateCategory', 'traversalBoundary', 'excludedChildIds'}
    for key in sorted(task_storage.list_keys('backend_domain')):
        if not key.startswith(('fetch_tasks__', 'fetch_plan_tasks__', 'fetch_task_context__')):
            continue
        records = task_storage.load('backend_domain', key)
        if not isinstance(records, list):
            raise ValueError('Membership validation requires structured retained tasks')
        for record in records:
            if not isinstance(record, Mapping) or 'id' not in record:
                raise ValueError('Retained task requires a canonical ID')
            task = {field: deepcopy(value) for field, value in record.items() if field in fields}
            task_id = str(task['id'])
            previous = tasks.get(task_id)
            if previous is None or task.get('revision', 0) > previous.get('revision', 0):
                tasks[task_id] = task
            elif task.get('revision', 0) == previous.get('revision', 0):
                previous_core = {field: value for field, value in previous.items()
                                 if field not in context_fields}
                incoming_core = {field: value for field, value in task.items()
                                 if field not in context_fields}
                conflicting_context = any(
                    previous[field] != task[field]
                    for field in context_fields & previous.keys() & task.keys()
                )
                if previous_core != incoming_core or conflicting_context:
                    raise ValueError(
                        f'Conflicting retained task snapshots at the same revision: {task_id}'
                    )
                previous.update(task)
    graphs = {'baseline': list(tasks.values())}
    for key in sorted(storage.list_keys('scenarios')):
        if key == 'scenario_register':
            continue
        scenario = storage.load('scenarios', key)
        if not isinstance(scenario, Mapping) or not isinstance(scenario.get('overrides'), Mapping):
            raise ValueError(f'Membership validation requires structured scenario overrides: {key}')
        effective = deepcopy(tasks)
        for task_id, override in scenario['overrides'].items():
            if not isinstance(override, Mapping):
                raise ValueError(f'Scenario override must be structured: {key}/{task_id}')
            identity = str(task_id)
            if identity not in effective:
                continue
            effective[identity].update({
                field: deepcopy(value) for field, value in override.items()
                if field in fields - {'id', 'revision'}
            })
        graphs[f'scenario:{key}'] = list(effective.values())
    return graphs


def validate_membership_graphs(
    storage: StorageBackend, task_storage: StorageBackend,
    previous: Mapping[str, str], candidate: Mapping[str, str],
) -> None:
    """Reject newly introduced group/member conflicts without changing retained allocations."""
    for source, graph in retained_allocation_graphs(storage, task_storage).items():
        existing = {tuple(conflict.items()) for conflict in allocation_conflicts(graph, previous)}
        for conflict in allocation_conflicts(graph, candidate):
            if tuple(conflict.items()) not in existing:
                raise ValueError(
                    f"Allocation conflict {conflict['kind']} in {source}: "
                    f"{conflict['ancestor']} -> {conflict['descendant']}, "
                    f"group {conflict['group']}, team {conflict['team']}"
                )