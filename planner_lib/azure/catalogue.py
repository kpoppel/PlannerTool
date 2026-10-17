"""Process catalogue import rules shared by administration and task loading."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone


class CatalogueError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def merge_catalogue(stored: dict, processes: list[dict], loaded_at: str) -> dict:
    previous = {process['id']: process for process in stored['processes']}
    merged = []
    for process in deepcopy(processes):
        priorTypes = {item['reference_name']: item
                      for item in previous.get(process['id'], {'types': []})['types']}
        references = set()
        for item in process['types']:
            reference = item['reference_name']
            references.add(reference)
            item['imported'] = priorTypes.get(reference, {'imported': False})['imported']
            item['missing'] = False
        process['types'].extend(
            {**deepcopy(item), 'missing': True}
            for reference, item in priorTypes.items()
            if reference not in references and item['imported']
        )
        process['loaded_at'] = loaded_at
        merged.append(process)
    present = {process['id'] for process in merged}
    for process in previous.values():
        if process['id'] not in present and any(item['imported'] for item in process['types']):
            missing = deepcopy(process)
            missing['projects'] = []
            missing['types'] = [{**item, 'missing': True} for item in missing['types']
                                if item['imported']]
            merged.append(missing)
    return {'schema_version': 1, 'processes': merged}


def _project(plan: dict) -> str:
    return plan['area_path'].replace('/', '\\').lstrip('\\').split('\\')[0].casefold()


def imported_type_index(catalogue: dict) -> dict:
    return {
        (project.casefold(), item['name'].casefold()): (process, item)
        for process in catalogue['processes'] for project in process['projects']
        for item in process['types'] if item['imported'] and item['backlog_level'] != 'task'
    }


def seed_in_window(item_type: dict, state: str, changed_at, days: int) -> bool:
    category = next(entry['category'] for entry in item_type['states'] if entry['name'] == state)
    if category in ('Proposed', 'InProgress', 'Resolved'):
        return True
    if category != 'Completed' or days == 0 or changed_at is None:
        return False
    changed = date.fromisoformat(str(changed_at)[:10])
    return changed >= datetime.now(timezone.utc).date() - timedelta(days=days)


def work_item_display(catalogue: dict, settings: dict) -> list[dict]:
    processes = {process['id']: process for process in catalogue['processes']}
    display = []
    for process_id in settings['process_order']:
        process = processes[process_id]
        types = {item['name']: item for item in process['types'] if item['imported']}
        tiers = [[{'name': name, 'states': [
            {'name': state['name'], 'category': state['category']}
            for state in sorted(types[name]['states'], key=lambda state: state['order'])
        ]} for name in tier] for tier in settings['type_tiers'][process_id]]
        display.append({'process_id': process_id, 'tiers': tiers})
    return display


def validate_display(catalogue: dict, settings: dict) -> dict:
    try:
        if (not isinstance(settings, dict) or
                set(settings) != {'schema_version', 'process_order', 'type_tiers'} or
                settings['schema_version'] != 2 or not isinstance(settings['process_order'], list) or
                not isinstance(settings['type_tiers'], dict)):
            raise ValueError
        expected = {process['id']: {item['name'] for item in process['types'] if item['imported']}
                    for process in catalogue['processes'] if any(item['imported'] for item in process['types'])}
        order = settings['process_order']
        if len(order) != len(set(order)) or set(order) != set(expected) or set(settings['type_tiers']) != set(expected):
            raise ValueError
        for process_id, names in expected.items():
            tiers = settings['type_tiers'][process_id]
            if not isinstance(tiers, list) or any(not isinstance(tier, list) or not tier for tier in tiers):
                raise ValueError
            actual = [name for tier in tiers for name in tier]
            if len(actual) != len(set(actual)) or set(actual) != names:
                raise ValueError
    except (KeyError, TypeError, ValueError) as error:
        raise CatalogueError('invalid_display', 'Display tiers must contain each imported process and type exactly once') from error
    return deepcopy(settings)


def import_plan_types(catalogue: dict, plans: list[dict]) -> dict:
    selected = deepcopy(catalogue)
    for process in selected['processes']:
        projects = {name.casefold() for name in process['projects']}
        required = {name.casefold() for plan in plans if _project(plan) in projects
                    for name in plan['task_types']}
        for item in process['types']:
            if (item['name'].casefold() in required and item['backlog_level'] != 'task'
                    and not item['missing']):
                item['imported'] = True
    return selected


def resolve_plan_process(plan: dict, catalogue: dict) -> dict:
    project = _project(plan)
    for process in catalogue['processes']:
        if project not in {name.casefold() for name in process['projects']}:
            continue
        imported = {item['name'].casefold() for item in process['types'] if item['imported']}
        if not imported:
            break
        if not plan['task_types'] or any(name.casefold() not in imported for name in plan['task_types']):
            raise CatalogueError('type_not_imported', f"Types for plan {plan['name']} are not imported")
        return process
    raise CatalogueError('process_not_imported', f"Process for plan {plan['name']} is not imported")


def import_selected_types(catalogue: dict, selections: dict) -> dict:
    if not isinstance(selections, dict):
        raise CatalogueError('invalid_imports', 'process_imports must map process IDs to type references')
    selected = deepcopy(catalogue)
    processes = {process['id']: process for process in selected['processes']}
    for process_id, references in selections.items():
        if process_id not in processes or not isinstance(references, list):
            raise CatalogueError('invalid_imports', f'Unknown process or invalid selection: {process_id}')
        types = {item['reference_name']: item for item in processes[process_id]['types']}
        for reference in references:
            if not isinstance(reference, str) or reference not in types:
                raise CatalogueError('type_not_importable', f'Unknown type reference: {reference}')
            item = types[reference]
            if item['backlog_level'] == 'task' or item['missing']:
                raise CatalogueError('type_not_importable', f"{item['name']} cannot be imported")
            item['imported'] = True
    return selected


def validate_plans(content: dict, catalogue: dict) -> dict:
    allowed = {'id', 'name', 'type', 'area_path', 'task_types', 'closed_history_days',
               'iteration_uuid', 'allocatable_ids', 'archived'}
    result = deepcopy(content)
    areas = set()
    for plan in result['project_map']:
        if set(plan) - allowed:
            raise CatalogueError('invalid_plan', 'Unknown plan fields: ' + ', '.join(sorted(set(plan) - allowed)))
        if not isinstance(plan.get('name'), str) or not plan['name'].strip():
            raise CatalogueError('invalid_plan', 'Plan name must not be empty')
        if plan.get('type') not in result['container_types']:
            raise CatalogueError('invalid_plan', f"Unknown plan level for {plan['name']}")
        area = plan.get('area_path')
        if not isinstance(area, str) or not area.strip():
            raise CatalogueError('invalid_plan', f"Area path is required for {plan['name']}")
        area_key = area.replace('/', '\\').strip('\\').casefold()
        if area_key in areas:
            raise CatalogueError('invalid_plan', f'Duplicate area path: {area}')
        areas.add(area_key)
        days = plan.get('closed_history_days')
        if type(days) is not int or days < 0:
            raise CatalogueError('invalid_plan', 'closed_history_days must be an integer >= 0')
        names = plan.get('task_types')
        if (not isinstance(names, list) or not names
                or any(not isinstance(name, str) or not name for name in names)):
            raise CatalogueError('invalid_plan', 'task_types must be a non-empty list of type names')
        process = resolve_plan_process(plan, catalogue)
        canonical = {item['name'].casefold(): item['name']
                     for item in process['types'] if item['imported']}
        plan['task_types'] = [canonical[name.casefold()] for name in names]
    return result


def select_imports(stored: dict, submitted: dict, plans: list[dict]) -> dict:
    if not isinstance(submitted, dict):
        raise CatalogueError('invalid_catalogue', 'Catalogue must be an object')
    selected = deepcopy(stored)
    try:
        if len(submitted['processes']) != len(selected['processes']):
            raise ValueError
        for previous, candidate in zip(selected['processes'], submitted['processes']):
            if len(previous['types']) != len(candidate['types']):
                raise ValueError
            for item, chosen in zip(previous['types'], candidate['types']):
                imported = chosen['imported']
                if type(imported) is not bool:
                    raise ValueError
                if imported and (item['backlog_level'] == 'task'
                                 or (item['missing'] and not item['imported'])):
                    raise CatalogueError('type_not_importable', f"{item['name']} cannot be imported")
                item['imported'] = imported
        if selected != submitted:
            raise ValueError
    except (KeyError, TypeError, ValueError) as error:
        if isinstance(error, CatalogueError):
            raise
        raise CatalogueError('invalid_catalogue', 'Only import selections may be changed; reload the catalogue') from error
    for process in selected['processes']:
        affected = [plan for plan in plans if _project(plan) in
                    {name.casefold() for name in process['projects']}]
        imported = {item['name'].casefold() for item in process['types'] if item['imported']}
        blocked = [plan['name'] for plan in affected if not imported or
                   any(name.casefold() not in imported for name in plan['task_types'])]
        if blocked:
            raise CatalogueError('type_in_use', 'Import selection is required by plans: ' + ', '.join(blocked))
    return selected


def sync_display(catalogue: dict, previous: dict) -> dict:
    processes = {process['id']: process for process in catalogue['processes']
                 if any(item['imported'] for item in process['types'])}
    order = [processId for processId in previous['process_order'] if processId in processes]
    order.extend(processId for processId in processes if processId not in order)
    tiers = {}
    for processId in order:
        imported = {item['name']: item for item in processes[processId]['types'] if item['imported']}
        priorTiers = previous['type_tiers'].get(processId, [])
        current = [[name for name in tier if name in imported] for tier in priorTiers]
        current = [tier for tier in current if tier]
        placed = {name for tier in current for name in tier}
        for name, item in imported.items():
            if name in placed:
                continue
            siblings = next((tier for tier in current if item['backlog'] is not None and
                             any(imported[sibling]['backlog'] == item['backlog'] for sibling in tier)), None)
            if siblings is None:
                current.append([name])
            else:
                siblings.append(name)
            placed.add(name)
        tiers[processId] = current
    return {'schema_version': 2, 'process_order': order, 'type_tiers': tiers}