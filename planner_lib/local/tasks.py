"""Transactional local task creation and canonical task projection."""
import json
import math
from datetime import datetime, timezone
from uuid import uuid4

from planner_lib.domain.iteration_sets import iteration_preset_id
from planner_lib.local.catalogue import _default_columns, _default_value, _is_date, _typed_default


CREATE_FIELDS = {'project', 'typeId', 'title', 'description', 'assignee', 'start', 'end',
                 'customFields', 'tags', 'iterationPresetId'}
RELATION_TYPES = {'parent': ('Child', 'Parent'), 'dependency': ('Successor', 'Predecessor'),
                  'related': ('Related', 'Related')}


class LocalTasks:
    def __init__(self, database, storage):
        self._database = database
        self._storage = storage

    def create(self, payload, actor):
        if not isinstance(payload, dict) or set(payload) - CREATE_FIELDS:
            raise ValueError('Unsupported local task creation fields')
        for key in ('project', 'typeId', 'title'):
            if not isinstance(payload.get(key), str) or not payload[key].strip():
                raise ValueError(f'{key} is required')
        for key in ('description', 'assignee', 'tags'):
            if payload.get(key) is not None and not isinstance(payload[key], str):
                raise ValueError(f'{key} must be text')
        start, end = payload.get('start'), payload.get('end')
        preset = payload.get('iterationPresetId')
        if preset is not None and (not isinstance(preset, str) or not preset or start is not None or end is not None):
            raise ValueError('Specify an iteration preset or explicit dates, not both')
        iteration_sets = self._storage.load('config', 'iterations')['iteration_sets'] if preset is not None else []
        for key, value in (('start', start), ('end', end)):
            if value is not None and (not isinstance(value, str) or not _is_date(value)):
                raise ValueError(f'{key} must be YYYY-MM-DD')
        if start is not None and end is not None and start > end:
            raise ValueError('start must not follow end')
        custom = payload.get('customFields', {})
        if not isinstance(custom, dict):
            raise ValueError('customFields must be an object')
        task_id = str(uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        tags = sorted({tag.strip() for tag in (payload.get('tags') or '').split(';') if tag.strip()})
        with self._database.write() as connection:
            assignment = connection.execute('''
                SELECT states.state_id, schemas.schema_id, presets.iteration_set_id
                FROM plan_definitions AS plans
                JOIN task_types AS types ON types.type_id = ?
                JOIN processes USING (process_id)
                JOIN task_type_workflows AS workflows ON workflows.type_id = types.type_id
                JOIN workflow_states AS states ON states.workflow_id = workflows.workflow_id AND states.is_initial
                JOIN task_type_field_schemas AS schemas ON schemas.type_id = types.type_id
                LEFT JOIN plan_iteration_sets AS presets ON presets.plan_id = plans.plan_id
                WHERE plans.plan_id = ? AND plans.backend_id = 'local' AND NOT plans.archived
                    AND processes.backend_id = plans.backend_id
                    AND (types.backlog_level = 'task' OR EXISTS (
                        SELECT 1 FROM plan_task_types WHERE plan_id = plans.plan_id AND type_id = types.type_id))
            ''', (payload['typeId'], payload['project'])).fetchone()
            if assignment is None:
                raise ValueError('Task type is not available in the active owning plan')
            custom_values = self._custom_values(connection, assignment['schema_id'], custom)
            if preset is not None:
                start, end = self._assign_preset(connection, assignment['iteration_set_id'], iteration_sets, preset)
            connection.execute('''
                INSERT INTO tasks (task_id, plan_id, type_id, state_id, title, description, assignee,
                    start_date, end_date, iteration_id, revision, created_at, created_by, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            ''', (task_id, payload['project'], payload['typeId'], assignment['state_id'],
                  payload['title'].strip(), payload.get('description'), payload.get('assignee'),
                  start, end, preset, timestamp, actor, timestamp, actor))
            connection.executemany('INSERT INTO task_custom_values VALUES (?, ?, ?, ?, ?)',
                                   [(task_id, *value) for value in custom_values])
            connection.executemany('INSERT INTO task_tags VALUES (?, ?)', [(task_id, tag) for tag in tags])
            task = self._read(connection, task_id)[0]
            fields = ('title', 'type', 'state', 'project', 'description', 'assignee', 'start', 'end',
                      'tags', 'iterationPath')
            changes = {field: task[field] for field in fields if task[field] is not None}
            changes.update({f'customFields.{key}': value for key, value in task['customFields'].items()})
            self._record_history(connection, task_id, 1, actor, timestamp, changes)
            return task

    @staticmethod
    def _assign_preset(connection, set_id, iteration_sets, preset_id):
        for iteration_set in iteration_sets:
            if iteration_set['id'] != set_id or iteration_set['source_type'] not in ('manual', 'generated'):
                continue
            for value in iteration_set['values']:
                path = value['path'].strip()
                if iteration_preset_id(set_id, path) != preset_id:
                    continue
                start, end = value['startDate'], value['finishDate']
                connection.execute('''
                    INSERT INTO iteration_sets VALUES (?, 'local', ?) ON CONFLICT(iteration_set_id) DO NOTHING
                ''', (set_id, set_id))
                connection.execute('''
                    INSERT INTO iterations VALUES (?, ?, ?, ?, ?) ON CONFLICT(iteration_id) DO NOTHING
                ''', (preset_id, set_id, path, start, end))
                return start, end
        raise ValueError('Iteration preset is not available in the owning plan')

    @staticmethod
    def _record_history(connection, task_id, revision, actor, timestamp, changes):
        batch_id = str(uuid4())
        connection.executemany('''
            INSERT INTO task_history (task_id, revision, field_key, new_value, actor_id, changed_at, batch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', [(task_id, revision, field, json.dumps(value, allow_nan=False), actor, timestamp, batch_id)
              for field, value in changes.items()])

    @staticmethod
    def _custom_values(connection, schema_id, supplied):
        rows = list(connection.execute('''
            SELECT schema.*, fields.field_key, fields.value_type
            FROM field_schema_fields AS schema JOIN field_definitions AS fields USING (field_id)
            WHERE schema.schema_id = ? ORDER BY schema.position
        ''', (schema_id,)))
        unknown = set(supplied) - {row['field_key'] for row in rows}
        if unknown:
            raise ValueError(f'Fields not in the task schema: {", ".join(sorted(unknown))}')
        values = []
        for row in rows:
            key, kind = row['field_key'], row['value_type']
            value = supplied.get(key, _default_value(row, kind))
            if value is None:
                if row['required']:
                    raise ValueError(f'{key} is required')
                continue
            options = [option[0] for option in connection.execute(
                'SELECT option_value FROM field_enum_options WHERE field_id = ?', (row['field_id'],)
            )] if kind == 'enum' else []
            _typed_default(value, {'type': kind, 'key': key, 'options': options})
            if kind in ('integer', 'number'):
                if isinstance(value, int) and not -(2 ** 63) <= value < 2 ** 63:
                    raise ValueError(f'{key} is outside the supported numeric range')
                if (not math.isfinite(value) or (row['min_value'] is not None and value < row['min_value'])
                        or (row['max_value'] is not None and value > row['max_value'])):
                    raise ValueError(f'{key} is outside its allowed range')
            if row['max_length'] is not None and len(value) > row['max_length']:
                raise ValueError(f'{key} exceeds its maximum length')
            values.append((row['field_id'], *_default_columns(value, kind)))
        return values

    def read(self):
        with self._database.connect() as connection:
            connection.execute('BEGIN')
            return self._read(connection)

    def read_collection(self):
        with self._database.connect() as connection:
            connection.execute('BEGIN')
            selected = {}
            for row in connection.execute('''
                SELECT plans.plan_id, types.process_id, types.name FROM plan_definitions AS plans
                LEFT JOIN plan_task_types USING (plan_id) LEFT JOIN task_types AS types USING (type_id)
                WHERE plans.backend_id = 'local' AND NOT plans.archived ORDER BY plans.display_order
            '''):
                types = selected.setdefault(row['plan_id'], set())
                if row['process_id'] is not None:
                    types.add((row['process_id'], row['name']))
            return self._read(connection), selected

    @staticmethod
    def _read(connection, task_id=None):
        filter_sql = ' AND tasks.task_id = ?' if task_id is not None else ''
        params = (task_id,) if task_id is not None else ()
        rows = connection.execute('''
            SELECT tasks.*, plans.name AS plan_name, types.name AS type_name, types.process_id,
                   states.name AS state_name, states.category, iterations.name AS iteration_name,
                   iterations.start_date AS iteration_start, iterations.finish_date AS iteration_end
            FROM tasks JOIN plan_definitions AS plans USING (plan_id)
            JOIN task_types AS types USING (type_id) JOIN states USING (state_id)
            LEFT JOIN iterations USING (iteration_id)
            WHERE tasks.deleted_at IS NULL AND plans.backend_id = 'local'
        ''' + filter_sql + ' ORDER BY tasks.created_at, tasks.task_id', params)
        tasks = {}
        for row in rows:
            identity, owner = row['task_id'], row['plan_id']
            tasks[identity] = {
                'id': identity, 'project': owner, 'title': row['title'], 'type': row['type_name'],
                'process_id': row['process_id'], 'state': row['state_name'], 'stateCategory': row['category'],
                'revision': row['revision'], 'description': row['description'], 'assignee': row['assignee'],
                'start': row['start_date'] or row['iteration_start'], 'end': row['end_date'] or row['iteration_end'],
                'iterationPath': row['iteration_name'], 'parentId': None, 'relations': [], 'childrenComplete': True,
                'customFields': {}, 'capacity': [], 'tags': None, 'url': f'#task={identity}',
                'sourcePlanIds': [owner], 'sourcePlanName': row['plan_name'], 'presentationPlanIds': [owner],
            }
        for row in connection.execute('''
            SELECT vals.*, fields.field_key, fields.value_type FROM task_custom_values AS vals
            JOIN field_definitions AS fields USING (field_id) JOIN tasks USING (task_id)
            WHERE tasks.deleted_at IS NULL
        ''' + filter_sql, params):
            if row['task_id'] in tasks:
                value = _default_value({'default_text': row['value_text'], 'default_integer': row['value_integer'],
                                        'default_real': row['value_real']}, row['value_type'])
                tasks[row['task_id']]['customFields'][row['field_key']] = value
        for row in connection.execute('''
            SELECT task_id, team_id, capacity FROM task_allocations JOIN tasks USING (task_id)
            WHERE tasks.deleted_at IS NULL
        ''' + filter_sql + ' ORDER BY team_id', params):
            if row['task_id'] in tasks:
                tasks[row['task_id']]['capacity'].append({'team': row['team_id'], 'capacity': row['capacity']})
        tags = {}
        for row in connection.execute('''
            SELECT task_id, tag FROM task_tags JOIN tasks USING (task_id) WHERE tasks.deleted_at IS NULL
        ''' + filter_sql + ' ORDER BY tag', params):
            if row['task_id'] in tasks:
                tags.setdefault(row['task_id'], []).append(row['tag'])
        for identity, values in tags.items():
            tasks[identity]['tags'] = '; '.join(values)
        if task_id is None:
            for row in connection.execute('SELECT * FROM task_relations ORDER BY source_task_id, target_task_id, kind'):
                source, target = tasks.get(row['source_task_id']), tasks.get(row['target_task_id'])
                if source is None or target is None:
                    continue
                forward, reverse = RELATION_TYPES[row['kind']]
                source['relations'].append({'type': forward, 'id': target['id']})
                target['relations'].append({'type': reverse, 'id': source['id']})
                if row['kind'] == 'parent':
                    target['parentId'] = source['id']
        return list(tasks.values())

    def fetch_history(self, work_item_id, credential=None):
        with self._database.connect() as connection:
            return [
                {'field': 'iteration' if row['field_key'] == 'iterationPath' else row['field_key'],
                 'value': json.loads(row['new_value']) if row['new_value'] is not None else None,
                 'changed_at': row['changed_at'], 'changed_by': row['actor_id']}
                for row in connection.execute('''
                    SELECT field_key, new_value, changed_at, actor_id FROM task_history
                    WHERE task_id = ? AND field_key IN ('start', 'end', 'iterationPath')
                    ORDER BY revision, history_id
                ''', (work_item_id,))
            ]