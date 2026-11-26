"""Transactional local task persistence, history and canonical projection."""
import json
import math
from datetime import datetime, timezone
from uuid import uuid4

from planner_lib.domain.iteration_sets import iteration_preset_id
from planner_lib.domain.tasks import TaskConflictError
from planner_lib.local.catalogue import _default_columns, _default_value, _is_date, _typed_default
from planner_lib.local.sql_port import LocalSqlStore


CREATE_FIELDS = {'project', 'typeId', 'title', 'description', 'assignee', 'start', 'end',
                 'customFields', 'tags', 'iterationPresetId'}
RELATION_TYPES = {'parent': ('Child', 'Parent'), 'dependency': ('Successor', 'Predecessor'),
                  'related': ('Related', 'Related')}
EDIT_COLUMNS = {'title': 'title', 'description': 'description', 'assignee': 'assignee',
                'start': 'start_date', 'end': 'end_date'}
EDIT_FIELDS = set(EDIT_COLUMNS) | {'state', 'tags', 'customFields', 'iterationPath', 'capacity', 'relations', 'rank'}
RANK_GAP = 1024.0
RANK_LIMIT = 1e12


class LocalTasks:
    def __init__(self, database: LocalSqlStore, storage):
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
                JOIN workflow_states AS states ON states.workflow_id = workflows.workflow_id AND states.is_initial = 1
                JOIN task_type_field_schemas AS schemas ON schemas.type_id = types.type_id
                LEFT JOIN plan_iteration_sets AS presets ON presets.plan_id = plans.plan_id
                WHERE plans.plan_id = ? AND plans.backend_id = 'local' AND plans.archived = 0
                    AND processes.backend_id = plans.backend_id
                    AND (types.backlog_level = 'task' OR EXISTS (
                        SELECT 1 FROM plan_task_types WHERE plan_id = plans.plan_id AND type_id = types.type_id))
            ''', (payload['typeId'], payload['project'])).fetchone()
            if assignment is None:
                raise ValueError('Task type is not available in the active owning plan')
            custom_values = self._custom_values(connection, assignment['schema_id'], custom)
            if preset is not None:
                start, end = self._assign_preset(connection, assignment['iteration_set_id'], iteration_sets, preset)
            number, rank = connection.execute('''
                SELECT COALESCE(MAX(task_number), 0) + 1, COALESCE(MAX(task_rank), 0) + ? FROM tasks
            ''', (RANK_GAP,)).fetchone()
            connection.execute('''
                INSERT INTO tasks (task_id, plan_id, type_id, state_id, title, description, assignee,
                    start_date, end_date, iteration_id, revision, created_at, created_by, updated_at, updated_by,
                    task_number, task_rank)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
            ''', (task_id, payload['project'], payload['typeId'], assignment['state_id'],
                  payload['title'].strip(), payload.get('description'), payload.get('assignee'),
                  start, end, preset, timestamp, actor, timestamp, actor, number, rank))
            connection.executemany('INSERT INTO task_custom_values VALUES (?, ?, ?, ?, ?)',
                                   [(task_id, *value) for value in custom_values])
            connection.executemany('INSERT INTO task_tags VALUES (?, ?)', [(task_id, tag) for tag in tags])
            task = self._read(connection, task_id)[0]
            fields = ('title', 'type', 'state', 'project', 'description', 'assignee', 'start', 'end',
                      'tags', 'iterationPath', 'rank')
            changes = {field: task[field] for field in fields if task[field] is not None}
            changes.update({f'customFields.{key}': value for key, value in task['customFields'].items()})
            self._record_history(connection, task_id, 1, actor, timestamp, str(uuid4()), {}, changes)
            return task

    def update_batch(self, edits, actor, validate):
        timestamp, batch_id = datetime.now(timezone.utc).isoformat(), str(uuid4())
        if not isinstance(edits, list):
            raise ValueError('Local task updates must be a list')
        with self._database.write() as connection:
            originals = {task['id']: task for task in self._read(connection)}
            edits_by_id = {}
            conflicts = []
            for edit in edits:
                if not isinstance(edit, dict) or set(edit) != {'id', 'revision', 'before', 'fields'}:
                    raise ValueError('Local task updates require id, revision, before and fields')
                identity, revision, before, fields = (edit[key] for key in ('id', 'revision', 'before', 'fields'))
                if not isinstance(identity, str) or not identity or identity in edits_by_id:
                    raise ValueError('Each local task update requires a unique task ID')
                if (type(revision) is not int or revision < 1 or not isinstance(fields, dict)
                        or not isinstance(before, dict) or fields.keys() != before.keys()
                        or not fields or fields.keys() - EDIT_FIELDS):
                    raise ValueError('Local task updates require a revision and a baseline for every editable field')
                edits_by_id[identity] = fields
                if identity not in originals:
                    conflicts.append({'taskId': identity, 'field': None, 'reason': 'missing_task',
                                      'base': before, 'current': None, 'proposed': fields, 'revision': None})
                    continue
                original = originals[identity]
                if 'customFields' in fields:
                    previous, proposed = before['customFields'], fields['customFields']
                    if not isinstance(previous, dict) or not isinstance(proposed, dict):
                        raise ValueError('customFields and its baseline must be objects')
                    changes = self._custom_changes(previous, proposed)
                    reviewed = {f'customFields.{key}': previous.get(key) for key in sorted(previous.keys() | changes.keys())}
                    proposed_values = {f'customFields.{key}': proposed.get(key) for key in previous.keys() | changes.keys()}
                    if not reviewed:
                        reviewed, proposed_values = {'customFields': {}}, {'customFields': {}}
                    conflicts.extend(self._base_conflicts(connection, original, revision,
                        self._scalar_fields(before) | reviewed, self._scalar_fields(fields) | proposed_values,
                        self._scalar_fields(fields).keys() | {f'customFields.{key}' for key in changes}))
                    merged = dict(original['customFields'])
                    for key, value in changes.items():
                        if value is None:
                            merged.pop(key, None)
                        else:
                            merged[key] = value
                    edits_by_id[identity] = {**fields, 'customFields': merged}
                else:
                    conflicts.extend(self._base_conflicts(connection, original, revision, before, fields))
            if conflicts:
                raise TaskConflictError(conflicts)
            for identity, fields in edits_by_id.items():
                self._apply_fields(connection, originals[identity], fields)
            relations = {identity: fields['relations'] for identity, fields in edits_by_id.items()
                         if 'relations' in fields}
            if relations:
                self._replace_relations(connection, relations)
            resulting = self._read(connection)
            validate(originals, resulting)
            for current in resulting:
                original = originals[current['id']]
                changes = {field: current[field] for field in sorted(EDIT_FIELDS - {'customFields'})
                           if current[field] != original[field]}
                changes.update({f'customFields.{key}': value for key, value in
                                self._custom_changes(original['customFields'], current['customFields']).items()})
                if changes:
                    self._commit_revision(connection, original, actor, timestamp, batch_id, changes)
                    current['revision'] = original['revision'] + 1
            by_id = {task['id']: task for task in resulting}
            return [by_id[identity] for identity in edits_by_id]

    def delete(self, identity, revision, actor):
        if type(revision) is not int or revision < 1:
            raise ValueError('Deleting a local task requires its revision')
        timestamp, batch_id = datetime.now(timezone.utc).isoformat(), str(uuid4())
        with self._database.write() as connection:
            originals = {task['id']: task for task in self._read(connection)}
            current = originals.get(identity)
            if current is None or current['revision'] != revision:
                raise TaskConflictError([{'taskId': identity, 'field': 'deletedAt', 'base': revision,
                                          'current': None, 'proposed': None,
                                          'reason': 'missing_task' if current is None else 'overlap',
                                          'revision': current['revision'] if current is not None else None}])
            connection.execute('UPDATE tasks SET deleted_at = ? WHERE task_id = ?', (timestamp, identity))
            connection.execute('DELETE FROM task_relations WHERE source_task_id = ? OR target_task_id = ?',
                               (identity, identity))
            changes = {'deletedAt': timestamp}
            if current['relations']:
                changes['relations'] = []
            self._commit_revision(connection, current, actor, timestamp, batch_id, changes)
            for task in self._read(connection):
                original = originals[task['id']]
                if task['relations'] != original['relations']:
                    self._commit_revision(connection, original, actor, timestamp, batch_id,
                                          {'relations': task['relations']})

    @staticmethod
    def _base_conflicts(connection, current, revision, before, fields, edited=None):
        identity = current['id']
        history = {}
        for row in connection.execute('''
            SELECT field_key, new_value FROM task_history WHERE task_id = ? AND revision <= ?
            ORDER BY revision, history_id
        ''', (identity, revision)):
            history[row['field_key']] = json.loads(row['new_value']) if row['new_value'] is not None else None
        conflicts = []
        initial = {'customFields': {}, 'capacity': [], 'relations': []}
        for field, base in before.items():
            historical = history.get(field, initial.get(field))
            value = LocalTasks._field_value(current, field)
            if field == 'relations' and isinstance(base, list) and all(
                    isinstance(link, dict) and isinstance(link.get('type'), str) and isinstance(link.get('id'), str)
                    for link in base):
                base = sorted(base, key=lambda link: (link['type'], link['id']))
            if revision > current['revision'] or not history or not LocalTasks._same_value(historical, base):
                reason = 'unverified_base'
            elif (edited is None or field in edited) and not LocalTasks._same_value(value, base):
                reason = 'overlap'
            else:
                continue
            conflicts.append({'taskId': identity, 'field': field, 'reason': reason, 'base': base,
                              'current': value, 'proposed': fields[field], 'revision': current['revision']})
        return conflicts

    @staticmethod
    def _field_value(task, field):
        if field.startswith('customFields.'):
            return task.get('customFields', {}).get(field.removeprefix('customFields.'))
        return task.get(field)

    @staticmethod
    def _scalar_fields(fields):
        return {key: value for key, value in fields.items() if key != 'customFields'}

    @staticmethod
    def _custom_changes(before, proposed):
        keys = sorted(set(before) | set(proposed))
        return {key: proposed.get(key) for key in keys
                if not LocalTasks._same_value(before.get(key), proposed.get(key))}

    @staticmethod
    def _same_value(first, second):
        if type(first) is bool or type(second) is bool:
            return first is second
        if isinstance(first, dict) and isinstance(second, dict):
            return first.keys() == second.keys() and all(
                LocalTasks._same_value(value, second[key]) for key, value in first.items())
        if isinstance(first, list) and isinstance(second, list):
            return len(first) == len(second) and all(map(LocalTasks._same_value, first, second))
        return first == second

    @staticmethod
    def _commit_revision(connection, current, actor, timestamp, batch_id, changes):
        revision = current['revision'] + 1
        connection.execute('UPDATE tasks SET revision = ?, updated_at = ?, updated_by = ? WHERE task_id = ?',
                           (revision, timestamp, actor, current['id']))
        LocalTasks._record_history(connection, current['id'], revision, actor, timestamp, batch_id, current, changes)

    @staticmethod
    def _rank_before(connection, identity, destination):
        if set(destination) != {'beforeTaskId'}:
            raise ValueError('A rank move requires beforeTaskId')
        before = destination['beforeTaskId']
        rows = list(connection.execute('''
            SELECT task_id, task_rank FROM tasks
            WHERE deleted_at IS NULL AND task_id <> ?
            ORDER BY task_rank, task_number, task_id
        ''', (identity,)))
        if before is None:
            index = len(rows)
        elif isinstance(before, str):
            index = next((index for index, row in enumerate(rows) if row['task_id'] == before), None)
            if index is None:
                raise ValueError('A rank move must target another active task')
        else:
            raise ValueError('beforeTaskId must be a task ID or null')

        left = rows[index - 1]['task_rank'] if index else None
        right = rows[index]['task_rank'] if index < len(rows) else None
        if left is None:
            rank = RANK_GAP if right is None else max(-RANK_LIMIT, right - RANK_GAP)
        elif right is None:
            rank = min(RANK_LIMIT, left + RANK_GAP)
        else:
            rank = left + (right - left) / 2
            if not left < rank < right:
                rank = math.nextafter(left, right)
        if (-RANK_LIMIT <= rank <= RANK_LIMIT and (left is None or left < rank)
                and (right is None or rank < right)):
            return rank

        task_ids = [row['task_id'] for row in rows]
        task_ids.insert(index, identity)
        connection.executemany('UPDATE tasks SET task_rank = ? WHERE task_id = ?', [
            ((position + 1) * RANK_GAP, task_id)
            for position, task_id in enumerate(task_ids) if task_id != identity
        ])
        return (index + 1) * RANK_GAP

    def _apply_fields(self, connection, current, fields):
        identity = current['id']
        row = connection.execute('''
            SELECT tasks.*, schemas.schema_id, workflows.workflow_id, presets.iteration_set_id
            FROM tasks JOIN task_type_field_schemas AS schemas USING (type_id)
            JOIN task_type_workflows AS workflows USING (type_id)
            LEFT JOIN plan_iteration_sets AS presets USING (plan_id)
            WHERE task_id = ?
        ''', (identity,)).fetchone()
        columns = {}
        for field, value in fields.items():
            if field not in EDIT_COLUMNS:
                continue
            if field in ('start', 'end') and value == '':
                value = None
            if field == 'title' and (not isinstance(value, str) or not value.strip()):
                raise ValueError('title is required')
            if value is not None and not isinstance(value, str):
                raise ValueError(f'{field} must be text')
            if field in ('start', 'end') and value is not None and not _is_date(value):
                raise ValueError(f'{field} must be YYYY-MM-DD')
            columns[EDIT_COLUMNS[field]] = value.strip() if field == 'title' else value
        if 'rank' in fields:
            rank = fields['rank']
            if isinstance(rank, dict):
                rank = self._rank_before(connection, identity, rank)
            if type(rank) not in (int, float) or not -RANK_LIMIT <= rank <= RANK_LIMIT:
                raise ValueError('rank must be a finite number between -1e12 and 1e12')
            columns['task_rank'] = rank
        if 'iterationPath' in fields and fields['iterationPath'] != current['iterationPath']:
            path = fields['iterationPath']
            columns['iteration_id'] = None
            if path is not None and path != '':
                if not isinstance(path, str) or row['iteration_set_id'] is None:
                    raise ValueError('Iteration path is not available in the owning plan')
                preset = iteration_preset_id(row['iteration_set_id'], path)
                sets = self._storage.load('config', 'iterations')['iteration_sets']
                self._assign_preset(connection, row['iteration_set_id'], sets, preset)
                columns['iteration_id'] = preset
        start, end = (columns.get(key, row[key]) for key in ('start_date', 'end_date'))
        if start is not None and end is not None and start > end:
            raise ValueError('start must not follow end')
        if 'state' in fields and fields['state'] != current['state']:
            state = fields['state']
            if not isinstance(state, str):
                raise ValueError('state must be text')
            target = connection.execute('''
                SELECT states.state_id FROM workflow_states JOIN states USING (state_id)
                WHERE workflow_id = ? AND states.name = ? AND (
                    EXISTS (SELECT 1 FROM workflow_transitions WHERE workflow_id = workflow_states.workflow_id
                        AND from_state_id = ? AND to_state_id = states.state_id)
                    OR EXISTS (SELECT 1 FROM workflow_any_transitions WHERE workflow_id = workflow_states.workflow_id
                        AND to_state_id = states.state_id))
            ''', (row['workflow_id'], state, row['state_id'])).fetchone()
            if target is None:
                raise ValueError(f'Invalid workflow transition from {current["state"]} to {state}')
            columns['state_id'] = target['state_id']
        if columns:
            assignments = ', '.join(f'{column} = ?' for column in columns)
            connection.execute(f'UPDATE tasks SET {assignments} WHERE task_id = ?', (*columns.values(), identity))
        if 'tags' in fields:
            tags = fields['tags']
            if tags is not None and not isinstance(tags, str):
                raise ValueError('tags must be text')
            values = sorted({tag.strip() for tag in (tags or '').split(';') if tag.strip()})
            connection.execute('DELETE FROM task_tags WHERE task_id = ?', (identity,))
            connection.executemany('INSERT INTO task_tags VALUES (?, ?)', [(identity, tag) for tag in values])
        if 'customFields' in fields:
            custom = fields['customFields']
            if not isinstance(custom, dict):
                raise ValueError('customFields must be an object')
            values = self._custom_values(connection, row['schema_id'], custom, use_defaults=False)
            connection.execute('DELETE FROM task_custom_values WHERE task_id = ?', (identity,))
            connection.executemany('INSERT INTO task_custom_values VALUES (?, ?, ?, ?, ?)',
                                   [(identity, *value) for value in values])
        if 'capacity' in fields:
            capacity = fields['capacity']
            if not isinstance(capacity, list) or not all(
                    isinstance(entry, dict) and set(entry) == {'team', 'capacity'} for entry in capacity):
                raise ValueError('capacity must be a list of {team, capacity}')
            connection.execute('DELETE FROM task_allocations WHERE task_id = ?', (identity,))
            connection.executemany('INSERT INTO task_allocations VALUES (?, ?, ?)',
                                   [(identity, entry['team'], entry['capacity']) for entry in capacity])

    @staticmethod
    def _replace_relations(connection, updates):
        active = dict(connection.execute('SELECT task_id, type_id FROM tasks WHERE deleted_at IS NULL'))
        existing = {tuple(row) for row in connection.execute('SELECT * FROM task_relations')}
        edges = {}
        for identity, links in updates.items():
            if not isinstance(links, list):
                raise ValueError('relations must be a list')
            authored = set()
            for link in links:
                if (not isinstance(link, dict) or set(link) != {'type', 'id'}
                        or not isinstance(link['id'], str) or link['id'] not in active or link['id'] == identity):
                    raise ValueError('Relations require a different active local target task')
                target = link['id']
                direction = link['type']
                for kind, (forward, reverse) in RELATION_TYPES.items():
                    if direction in (forward, reverse):
                        if kind == 'related':
                            source, destination = sorted((identity, target))
                        else:
                            source, destination = (identity, target) if direction == forward else (target, identity)
                        authored.add((source, destination, kind))
                        break
                else:
                    raise ValueError('Unknown local relation type')
            edges[identity] = authored
        desired = set().union(*edges.values())
        for source, target, kind in desired:
            if any(endpoint in edges and (source, target, kind) not in edges[endpoint]
                   for endpoint in (source, target)):
                raise ValueError('Conflicting reciprocal relation selections')
        removed = {edge for edge in existing if (edge[0] in edges or edge[1] in edges) and edge not in desired}
        parents = {}
        rules = {tuple(row) for row in connection.execute(
            'SELECT parent_type_id, child_type_id FROM task_type_parent_rules')}
        for source, target, kind in (existing - removed) | desired:
            if kind != 'parent' or source not in active or target not in active:
                continue
            if target in parents:
                raise ValueError('A task can have only one parent')
            if (active[source], active[target]) not in rules:
                raise ValueError('Task types do not allow this parent/child relation')
            parents[target] = source
        visited = set()
        for target in parents:
            path = set()
            while target in parents and target not in visited:
                if target in path:
                    raise ValueError('Parent relations must not form a cycle')
                path.add(target)
                target = parents[target]
            visited.update(path)
        connection.executemany('DELETE FROM task_relations WHERE source_task_id = ? AND target_task_id = ? AND kind = ?',
                               sorted(removed))
        connection.executemany('INSERT INTO task_relations VALUES (?, ?, ?)', sorted(desired - existing))

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
                    INSERT INTO task_iteration_sets VALUES (?, 'local', ?) ON CONFLICT(iteration_set_id) DO NOTHING
                ''', (set_id, set_id))
                connection.execute('''
                    INSERT INTO task_iteration_refs VALUES (?, ?, ?, ?, ?) ON CONFLICT(iteration_id) DO UPDATE SET
                    start_date = excluded.start_date, finish_date = excluded.finish_date
                ''', (preset_id, set_id, path, start, end))
                return start, end
        raise ValueError('Iteration preset is not available in the owning plan')

    @staticmethod
    def _record_history(connection, task_id, revision, actor, timestamp, batch_id, before, changes):
        connection.executemany('''
            INSERT INTO task_history (task_id, revision, field_key, old_value, new_value, actor_id, changed_at, batch_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', [(task_id, revision, field, json.dumps(LocalTasks._field_value(before, field), allow_nan=False),
               json.dumps(value, allow_nan=False), actor, timestamp, batch_id)
              for field, value in changes.items()])

    @staticmethod
    def _custom_values(connection, schema_id, supplied, *, use_defaults=True):
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
            value = supplied.get(key, _default_value(row, kind) if use_defaults else None)
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
        with self._database.read() as connection:
            return self._read(connection)

    def read_collection(self):
        with self._database.read() as connection:
            selected = {}
            for row in connection.execute('''
                SELECT plans.plan_id, types.process_id, types.name FROM plan_definitions AS plans
                LEFT JOIN plan_task_types USING (plan_id) LEFT JOIN task_types AS types USING (type_id)
                WHERE plans.backend_id = 'local' AND plans.archived = 0 ORDER BY plans.display_order
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
                   states.name AS state_name, states.category, iterations.name AS iteration_name
            FROM tasks JOIN plan_definitions AS plans USING (plan_id)
            JOIN task_types AS types USING (type_id) JOIN states USING (state_id)
            LEFT JOIN task_iteration_refs AS iterations USING (iteration_id)
            WHERE tasks.deleted_at IS NULL AND plans.backend_id = 'local'
        ''' + filter_sql + ' ORDER BY tasks.task_rank, tasks.task_number, tasks.task_id', params)
        tasks = {}
        for row in rows:
            identity, owner = row['task_id'], row['plan_id']
            tasks[identity] = {
                'id': identity, 'project': owner, 'title': row['title'], 'type': row['type_name'],
                'process_id': row['process_id'], 'state': row['state_name'], 'stateCategory': row['category'],
                'revision': row['revision'], 'description': row['description'], 'assignee': row['assignee'],
                'number': row['task_number'], 'rank': row['task_rank'],
                'start': row['start_date'], 'end': row['end_date'],
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
            for task in tasks.values():
                task['relations'].sort(key=lambda link: (link['type'], link['id']))
        return list(tasks.values())

    def fetch_history(self, work_item_id, credential=None):
        with self._database.read() as connection:
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