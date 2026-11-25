"""Typed projections of the existing ADO configuration and display documents."""

from uuid import UUID

from planner_lib.azure.catalogue import validate_display
from planner_lib.domain.plans import validate_plan_common


def _ordered(connection, query, key):
    return [value for value, in connection.execute(query + ' ORDER BY position', key)]


def _flag(value):
    if type(value) is not bool:
        raise ValueError('Expected a boolean configuration flag')
    return value


def write_projects(connection, value):
    connection.execute('DELETE FROM ado_projects')
    connection.execute('DELETE FROM ado_plan_kinds')
    for position, kind in enumerate(value['container_types']):
        connection.execute('INSERT INTO ado_plan_kinds VALUES (?, ?)', (kind, position))
        connection.executemany('INSERT INTO allocation_defaults VALUES (?, ?, ?)',
                               ((kind, team, order)
                                for order, team in enumerate(value['allocation_defaults'][kind])))
    areas = set()
    for position, plan in enumerate(value['project_map']):
        validate_plan_common(plan, value['container_types'])
        plan_id = plan['id']
        area = plan['area_path'].replace('/', '\\').strip('\\').casefold()
        if str(UUID(plan_id)) != plan_id or not area or area in areas:
            raise ValueError('Invalid plan ID or duplicate ADO area path')
        areas.add(area)
        connection.execute('INSERT INTO ado_projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                           (plan_id, position, plan['name'], plan['type'], plan['area_path'],
                            plan['closed_history_days'], _flag(plan['archived']) if 'archived' in plan else None,
                            'iteration_uuid' in plan, plan.get('iteration_uuid'), 'allocatable_ids' in plan))
        connection.executemany('INSERT INTO ado_project_task_types VALUES (?, ?, ?)',
                               ((plan_id, order, name) for order, name in enumerate(plan['task_types'])))
        connection.executemany('INSERT INTO ado_project_allocation VALUES (?, ?, ?)',
                               ((plan_id, team, order)
                                for order, team in enumerate(plan.get('allocatable_ids', []))))


def read_projects(connection):
    kinds = _ordered(connection, 'SELECT kind FROM ado_plan_kinds', ())
    if not kinds:
        raise KeyError('projects')
    plans = []
    for row in connection.execute('SELECT * FROM ado_projects ORDER BY position'):
        key = (row['project_id'],)
        plan = {
            'id': key[0], 'name': row['name'], 'type': row['kind'], 'area_path': row['area_path'],
            'closed_history_days': row['closed_history_days'],
            'task_types': _ordered(connection, 'SELECT name FROM ado_project_task_types WHERE project_id = ?', key),
        }
        if row['archived'] is not None:
            plan['archived'] = bool(row['archived'])
        if row['iteration_present']:
            plan['iteration_uuid'] = row['iteration_id']
        if row['allocation_override']:
            plan['allocatable_ids'] = _ordered(connection,
                'SELECT team_id FROM ado_project_allocation WHERE project_id = ?', key)
        plans.append(plan)
    return {'schema_version': 4, 'container_types': kinds, 'project_map': plans,
            'allocation_defaults': {kind: _ordered(connection,
                'SELECT team_id FROM allocation_defaults WHERE kind = ?', (kind,)) for kind in kinds}}


def write_catalogue(connection, value):
    connection.execute('DELETE FROM ado_processes')
    for position, process in enumerate(value['processes']):
        process_id = process['id']
        connection.execute('''INSERT INTO ado_processes (process_id, position, name, parent_name, loaded_at)
            VALUES (?, ?, ?, ?, ?)''',
            (process_id, position, process['name'], process.get('parent_name'), process['loaded_at']))
        connection.executemany('INSERT INTO ado_process_projects VALUES (?, ?, ?)',
                               ((process_id, project, order) for order, project in enumerate(process['projects'])))
        for order, item in enumerate(process['types']):
            reference = item['reference_name']
            connection.execute('INSERT INTO ado_task_types VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                               (process_id, reference, order, item['name'], item['backlog_level'],
                                item['backlog'], _flag(item['imported']), _flag(item['missing'])))
            connection.executemany('INSERT INTO ado_task_type_states VALUES (?, ?, ?, ?, ?, ?)',
                                   ((process_id, reference, index, state['name'], state['category'], state['order'])
                                    for index, state in enumerate(item['states'])))


def read_catalogue(connection):
    processes = []
    for row in connection.execute('SELECT * FROM ado_processes ORDER BY position'):
        key = (row['process_id'],)
        types = []
        for item in connection.execute('''SELECT reference_name, name, backlog_level, backlog, imported, missing
            FROM ado_task_types WHERE process_id = ? ORDER BY position''', key):
            types.append({**dict(item), 'imported': bool(item['imported']), 'missing': bool(item['missing']),
                          'states': [dict(state) for state in connection.execute('''
                SELECT name, category, display_order AS "order" FROM ado_task_type_states
                WHERE process_id = ? AND reference_name = ? ORDER BY position''', (*key, item['reference_name']))]})
        process = {'id': key[0], 'name': row['name'], 'loaded_at': row['loaded_at'], 'types': types,
                   'projects': _ordered(connection, 'SELECT project_name FROM ado_process_projects WHERE process_id = ?', key)}
        if row['parent_name'] is not None:
            process['parent_name'] = row['parent_name']
        processes.append(process)
    return {'schema_version': 1, 'processes': processes}


def write_display(connection, value):
    validate_display(read_catalogue(connection), value)
    connection.execute('DELETE FROM ado_process_display_order')
    for position, process in enumerate(value['process_order']):
        connection.execute('INSERT INTO ado_process_display_order VALUES (?, ?)', (process, position))
        connection.executemany('INSERT INTO ado_type_display_tiers VALUES (?, ?, ?, ?)',
                               ((process, name, tier, order)
                                for tier, names in enumerate(value['type_tiers'][process])
                                for order, name in enumerate(names)))


def read_display(connection):
    processes = _ordered(connection, 'SELECT process_id FROM ado_process_display_order', ())
    tiers = {}
    for process in processes:
        tiers[process] = []
        for tier, name in connection.execute('''SELECT tier, name FROM ado_type_display_tiers
            WHERE process_id = ? ORDER BY tier, position''', (process,)):
            if tier == len(tiers[process]):
                tiers[process].append([])
            tiers[process][tier].append(name)
    return {'schema_version': 2, 'process_order': processes, 'type_tiers': tiers}


def write_area_mappings(connection, value):
    connection.execute('INSERT OR REPLACE INTO area_mapping_settings VALUES (1, ?)', (value.get('last_update'),))
    connection.execute('DELETE FROM area_mapping_projects')
    for position, (project, entry) in enumerate(value.items()):
        if project == 'last_update':
            continue
        connection.execute('INSERT INTO area_mapping_projects VALUES (?, ?, ?, ?)',
                           (project, position, entry.get('last_update'), 'areas' in entry))
        for order, (area, mapping) in enumerate(entry.get('areas', {}).items()):
            plans = mapping.get('plans', {})
            shape = 0 if 'plans' not in mapping else 1 if isinstance(plans, dict) else 2
            connection.execute('INSERT INTO area_mappings VALUES (?, ?, ?, ?, ?)',
                               (project, area, order, mapping.get('last_update'), shape))
            entries = plans.items() if shape == 1 else ((plan, {}) for plan in plans)
            connection.executemany('INSERT INTO area_delivery_plans VALUES (?, ?, ?, ?, ?, ?)',
                                   ((project, area, index, plan_id, info.get('name'),
                                     _flag(info['enabled']) if 'enabled' in info else None)
                                    for index, (plan_id, info) in enumerate(entries)))


def read_area_mappings(connection):
    settings = connection.execute('SELECT last_update FROM area_mapping_settings').fetchone()
    if settings is None:
        raise KeyError('area_plan_map')
    value = {'last_update': settings[0]} if settings[0] is not None else {}
    for project, updated, has_areas in connection.execute('''SELECT project_id, last_update, areas_present
        FROM area_mapping_projects ORDER BY position'''):
        entry = {'last_update': updated} if updated is not None else {}
        value[project] = entry
        if not has_areas:
            continue
        entry['areas'] = {}
        for area, updated, shape in connection.execute('''SELECT area_path, last_update, plans_shape
            FROM area_mappings WHERE project_id = ? ORDER BY position''', (project,)):
            mapping = {'last_update': updated} if updated is not None else {}
            entry['areas'][area] = mapping
            if not shape:
                continue
            rows = connection.execute('''SELECT delivery_plan_id, name, enabled FROM area_delivery_plans
                WHERE project_id = ? AND area_path = ? ORDER BY position''', (project, area))
            if shape == 1:
                mapping['plans'] = {key: {**({'name': name} if name is not None else {}),
                                          **({'enabled': bool(enabled)} if enabled is not None else {})}
                                    for key, name, enabled in rows}
            else:
                mapping['plans'] = [key for key, _, _ in rows]
    return value