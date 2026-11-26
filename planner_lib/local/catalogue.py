"""Editable catalogue of the local task backend.

The admin API exchanges one versioned document; storage is relational. Saving
applies the document as a diff in one transaction, so definitions that tasks
or plans still reference cannot be removed without an explicit reassignment.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, List
from uuid import uuid4

from planner_lib.backend.selection import LOCAL_BACKEND_ID

CATEGORIES = ('Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed')
VALUE_TYPES = ('string', 'text', 'integer', 'number', 'boolean', 'date', 'enum')
BACKLOG_LEVELS = ('portfolio', 'requirement', 'task', 'none')
FIELD_KEY = re.compile(r'^[a-z][a-z0-9_]*$')
DOCUMENT_KEYS = {'revision', 'states', 'fields', 'field_schemas', 'workflows', 'processes'}


class StaleRevisionError(Exception):
    """The document was edited by someone else since it was read."""


class CatalogueInUseError(Exception):
    """A removed definition is still referenced by tasks or plans."""


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _keys(item, required, label):
    _require(isinstance(item, dict) and set(item) == set(required),
             f'{label} must have exactly the fields: {", ".join(sorted(required))}')


def _identity(value, label):
    _require(isinstance(value, str) and value.strip() == value and value, f'{label} id must be a nonempty string')
    return value


def _name(value, label):
    _require(isinstance(value, str) and value.strip(), f'{label} name must not be empty')
    return value.strip()


def _unique(values, label):
    folded = [value.casefold() if isinstance(value, str) else value for value in values]
    _require(len(folded) == len(set(folded)), f'Duplicate {label}')


def _member(value, identities, message):
    _require(isinstance(value, str) and value in identities, message)


def _typed_default(value, field):
    kind = field['type']
    if value is None:
        return None
    if kind in ('string', 'text'):
        _require(isinstance(value, str), f'Default for {field["key"]} must be text')
    elif kind == 'enum':
        _require(value in field['options'], f'Default for {field["key"]} must be one of its options')
    elif kind == 'integer':
        _require(type(value) is int, f'Default for {field["key"]} must be an integer')
    elif kind == 'number':
        _require(type(value) in (int, float), f'Default for {field["key"]} must be a number')
    elif kind == 'boolean':
        _require(type(value) is bool, f'Default for {field["key"]} must be true or false')
    else:
        _require(isinstance(value, str) and _is_date(value), f'Default for {field["key"]} must be YYYY-MM-DD')
    return value


def _is_date(value):
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def validate_catalogue(document: Any) -> Dict[str, Any]:
    """Validate structure and cross-references; return the normalized document."""
    _keys(document, DOCUMENT_KEYS, 'Catalogue')
    _require(type(document['revision']) is int and document['revision'] >= 0, 'Catalogue revision is required')
    for key in DOCUMENT_KEYS - {'revision'}:
        _require(isinstance(document[key], list), f'{key} must be a list')

    states = []
    for item in document['states']:
        _keys(item, {'id', 'name', 'category'}, 'State')
        _require(item['category'] in CATEGORIES, f'Unknown state category: {item["category"]!r}')
        states.append({'id': _identity(item['id'], 'State'), 'name': _name(item['name'], 'State'),
                       'category': item['category']})
    _unique([state['id'] for state in states], 'state ids')
    _unique([state['name'] for state in states], 'state names')
    state_ids = {state['id'] for state in states}

    fields = []
    for item in document['fields']:
        _keys(item, {'id', 'key', 'label', 'type', 'options'}, 'Field')
        _require(isinstance(item['key'], str) and FIELD_KEY.fullmatch(item['key']),
                 'Field keys use lowercase letters, digits and underscores')
        _require(item['type'] in VALUE_TYPES, f'Unknown field type: {item["type"]!r}')
        options = item['options']
        _require(isinstance(options, list) and all(isinstance(o, str) and o.strip() == o and o for o in options),
                 'Field options must be nonempty strings')
        _unique(options, f'options for {item["key"]}')
        _require(bool(options) == (item['type'] == 'enum'), 'Only enum fields have options, and they need at least one')
        fields.append({'id': _identity(item['id'], 'Field'), 'key': item['key'],
                       'label': _name(item['label'], 'Field'), 'type': item['type'], 'options': list(options)})
    _unique([field['id'] for field in fields], 'field ids')
    _unique([field['key'] for field in fields], 'field keys')
    fields_by_id = {field['id']: field for field in fields}

    schemas = []
    for item in document['field_schemas']:
        _keys(item, {'id', 'name', 'fields'}, 'Field schema')
        _require(isinstance(item['fields'], list), 'Field schema fields must be a list')
        entries = []
        for entry in item['fields']:
            _keys(entry, {'field_id', 'required', 'default', 'min', 'max', 'max_length'}, 'Field schema entry')
            _member(entry['field_id'], fields_by_id, f'Unknown field in schema: {entry["field_id"]!r}')
            field = fields_by_id[entry['field_id']]
            _require(type(entry['required']) is bool, 'Field schema required must be true or false')
            numeric = field['type'] in ('integer', 'number')
            for bound in ('min', 'max'):
                _require(entry[bound] is None or (numeric and type(entry[bound]) in (int, float)),
                         f'{bound} applies to numeric fields only')
            _require(entry['min'] is None or entry['max'] is None or entry['min'] <= entry['max'],
                     'min must not exceed max')
            _require(entry['max_length'] is None or (
                field['type'] in ('string', 'text') and type(entry['max_length']) is int and entry['max_length'] > 0),
                'max_length applies to text fields and must be positive')
            entries.append({**entry, 'default': _typed_default(entry['default'], field)})
        _unique([entry['field_id'] for entry in entries], 'fields in a schema')
        schemas.append({'id': _identity(item['id'], 'Field schema'),
                        'name': _name(item['name'], 'Field schema'), 'fields': entries})
    _unique([schema['id'] for schema in schemas], 'field schema ids')
    _unique([schema['name'] for schema in schemas], 'field schema names')
    schema_ids = {schema['id'] for schema in schemas}

    workflows = []
    for item in document['workflows']:
        _keys(item, {'id', 'name', 'states', 'initial', 'transitions', 'from_any'}, 'Workflow')
        name = _name(item['name'], 'Workflow')
        members = item['states']
        _require(isinstance(members, list) and members, f'Workflow {name} needs states')
        for member in members:
            _member(member, state_ids, f'Workflow {name} uses unknown states')
        _unique(members, f'states in workflow {name}')
        _require(item['initial'] in members, f'Workflow {name} needs one initial state among its states')
        transitions = []
        _require(isinstance(item['transitions'], list), 'Transitions must be a list')
        for transition in item['transitions']:
            _keys(transition, {'from', 'to'}, 'Transition')
            _require(transition['from'] in members and transition['to'] in members,
                     f'Workflow {name} transitions must connect its states')
            _require(transition['from'] != transition['to'], 'A transition must change state')
            transitions.append({'from': transition['from'], 'to': transition['to']})
        _unique([(t['from'], t['to']) for t in transitions], f'transitions in workflow {name}')
        from_any = item['from_any']
        _require(isinstance(from_any, list) and all(state in members for state in from_any),
                 f'Workflow {name} "from any state" targets must be its states')
        _unique(from_any, f'"from any state" targets in workflow {name}')
        workflows.append({'id': _identity(item['id'], 'Workflow'), 'name': name, 'states': list(members),
                          'initial': item['initial'], 'transitions': transitions, 'from_any': list(from_any)})
    _unique([workflow['id'] for workflow in workflows], 'workflow ids')
    _unique([workflow['name'] for workflow in workflows], 'workflow names')
    workflow_ids = {workflow['id'] for workflow in workflows}

    processes = []
    type_ids = []
    for item in document['processes']:
        _keys(item, {'id', 'name', 'types', 'parent_rules'}, 'Process')
        name = _name(item['name'], 'Process')
        _require(isinstance(item['types'], list), 'Process types must be a list')
        types = []
        for entry in item['types']:
            _keys(entry, {'id', 'name', 'backlog_level', 'tier', 'workflow_id', 'field_schema_id'}, 'Task type')
            _require(entry['backlog_level'] in BACKLOG_LEVELS, f'Unknown backlog level: {entry["backlog_level"]!r}')
            _require(type(entry['tier']) is int and entry['tier'] >= 0, 'Type tier must be an integer >= 0')
            _member(entry['workflow_id'], workflow_ids, 'Each task type needs an existing workflow')
            _member(entry['field_schema_id'], schema_ids, 'Each task type needs an existing field schema')
            types.append({**entry, 'id': _identity(entry['id'], 'Task type'), 'name': _name(entry['name'], 'Task type')})
        _unique([entry['name'] for entry in types], f'type names in process {name}')
        local_types = {entry['id'] for entry in types}
        _require(isinstance(item['parent_rules'], list), 'Parent rules must be a list')
        rules = []
        for rule in item['parent_rules']:
            _keys(rule, {'parent', 'child'}, 'Parent rule')
            for end in ('parent', 'child'):
                _member(rule[end], local_types, f'Parent rules in {name} must use its own types')
            _require(rule['parent'] != rule['child'], 'A type cannot be its own parent')
            rules.append({'parent': rule['parent'], 'child': rule['child']})
        _unique([(rule['parent'], rule['child']) for rule in rules], f'parent rules in process {name}')
        type_ids.extend(local_types)
        processes.append({'id': _identity(item['id'], 'Process'), 'name': name, 'types': types,
                          'parent_rules': rules})
    _unique([process['id'] for process in processes], 'process ids')
    _unique([process['name'] for process in processes], 'process names')
    _unique(type_ids, 'task type ids')

    return {'revision': document['revision'], 'states': states, 'fields': fields,
            'field_schemas': schemas, 'workflows': workflows, 'processes': processes}


def _default_columns(value, value_type):
    """Typed scalar columns (text, integer, real) for a field default."""
    if value is None:
        return None, None, None
    if value_type in ('integer', 'boolean'):
        return None, int(value), None
    if value_type == 'number':
        return None, None, float(value)
    return value, None, None


def _default_value(row, value_type):
    if value_type == 'boolean':
        return None if row['default_integer'] is None else bool(row['default_integer'])
    if value_type == 'integer':
        return row['default_integer']
    if value_type == 'number':
        return row['default_real']
    return row['default_text']


class LocalCatalogue:
    """Relational local catalogue behind the backend-neutral display contract."""

    backend_id = LOCAL_BACKEND_ID

    def __init__(self, database) -> None:
        self._database = database

    @staticmethod
    def _revision(connection):
        return connection.execute(
            "SELECT revision FROM document_revisions WHERE document = 'local_catalogue'").fetchone()[0]

    def read(self) -> Dict[str, Any]:
        with self._database.read() as connection:
            return self._read(connection)

    def _read(self, connection) -> Dict[str, Any]:
        local = (LOCAL_BACKEND_ID,)
        states = [{'id': row['state_id'], 'name': row['name'], 'category': row['category']}
                  for row in connection.execute(
                      'SELECT * FROM states WHERE backend_id = ? ORDER BY display_order', local)]
        fields = []
        for row in connection.execute('SELECT * FROM field_definitions WHERE backend_id = ? ORDER BY position', local):
            options = [option[0] for option in connection.execute(
                'SELECT option_value FROM field_enum_options WHERE field_id = ? ORDER BY position', (row['field_id'],))]
            fields.append({'id': row['field_id'], 'key': row['field_key'], 'label': row['label'],
                           'type': row['value_type'], 'options': options})
        types_by_field = {field['id']: field['type'] for field in fields}
        schemas = []
        for row in connection.execute('SELECT * FROM field_schemas WHERE backend_id = ? ORDER BY position', local):
            entries = [{
                'field_id': entry['field_id'], 'required': bool(entry['required']),
                'default': _default_value(entry, types_by_field[entry['field_id']]),
                'min': entry['min_value'], 'max': entry['max_value'], 'max_length': entry['max_length'],
            } for entry in connection.execute(
                'SELECT * FROM field_schema_fields WHERE schema_id = ? ORDER BY position', (row['schema_id'],))]
            schemas.append({'id': row['schema_id'], 'name': row['name'], 'fields': entries})
        workflows = []
        for row in connection.execute('SELECT * FROM workflows WHERE backend_id = ? ORDER BY position', local):
            key = (row['workflow_id'],)
            members = list(connection.execute(
                'SELECT state_id, is_initial FROM workflow_states WHERE workflow_id = ? ORDER BY position', key))
            workflows.append({
                'id': row['workflow_id'], 'name': row['name'],
                'states': [member['state_id'] for member in members],
                'initial': next(member['state_id'] for member in members if member['is_initial']),
                'transitions': [{'from': t['from_state_id'], 'to': t['to_state_id']} for t in connection.execute(
                    'SELECT from_state_id, to_state_id FROM workflow_transitions WHERE workflow_id = ? '
                    'ORDER BY position', key)],
                'from_any': [t[0] for t in connection.execute(
                    'SELECT to_state_id FROM workflow_any_transitions WHERE workflow_id = ? ORDER BY position', key)],
            })
        processes = []
        for row in connection.execute(
                'SELECT p.* FROM processes p JOIN process_display_order o ON o.process_id = p.process_id '
                'WHERE p.backend_id = ? ORDER BY o.position', local):
            key = (row['process_id'],)
            types = [{
                'id': entry['type_id'], 'name': entry['name'], 'backlog_level': entry['backlog_level'],
                'tier': entry['tier'], 'workflow_id': entry['workflow_id'], 'field_schema_id': entry['schema_id'],
            } for entry in connection.execute(
                'SELECT t.*, d.tier, d.position, w.workflow_id, s.schema_id FROM task_types t '
                'JOIN type_display_tiers d ON d.type_id = t.type_id '
                'JOIN task_type_workflows w ON w.type_id = t.type_id '
                'JOIN task_type_field_schemas s ON s.type_id = t.type_id '
                'WHERE t.process_id = ? ORDER BY d.tier, d.position', key)]
            rules = [{'parent': rule[0], 'child': rule[1]} for rule in connection.execute(
                'SELECT r.parent_type_id, r.child_type_id FROM task_type_parent_rules r '
                'JOIN task_types t ON t.type_id = r.parent_type_id WHERE t.process_id = ? ORDER BY r.position', key)]
            processes.append({'id': row['process_id'], 'name': row['name'], 'types': types, 'parent_rules': rules})
        return {'revision': self._revision(connection), 'states': states, 'fields': fields,
                'field_schemas': schemas, 'workflows': workflows, 'processes': processes}

    def save(self, document: Any) -> Dict[str, Any]:
        catalogue = validate_catalogue(document)
        try:
            with self._database.write() as connection:
                if self._revision(connection) != catalogue['revision']:
                    raise StaleRevisionError('The catalogue changed since it was loaded; reload and retry')
                self._apply(connection, catalogue)
                connection.execute(
                    "UPDATE document_revisions SET revision = revision + 1 WHERE document = 'local_catalogue'")
        except self._database.IntegrityError as error:
            raise CatalogueInUseError(
                'A removed definition is still used by tasks or plans; reassign them first') from error
        return self.read()

    def _apply(self, connection, catalogue):
        local = LOCAL_BACKEND_ID
        type_ids = [entry['id'] for process in catalogue['processes'] for entry in process['types']]
        # Owned link rows are rewritten; entities are removed only when absent from the document.
        for statement in (
            'DELETE FROM workflow_any_transitions WHERE workflow_id IN (SELECT workflow_id FROM workflows WHERE backend_id = ?)',
            'DELETE FROM workflow_transitions WHERE workflow_id IN (SELECT workflow_id FROM workflows WHERE backend_id = ?)',
            'DELETE FROM workflow_states WHERE workflow_id IN (SELECT workflow_id FROM workflows WHERE backend_id = ?)',
            'DELETE FROM field_schema_fields WHERE schema_id IN (SELECT schema_id FROM field_schemas WHERE backend_id = ?)',
            'DELETE FROM field_enum_options WHERE field_id IN (SELECT field_id FROM field_definitions WHERE backend_id = ?)',
            'DELETE FROM process_display_order WHERE backend_id = ?',
            'DELETE FROM type_display_tiers WHERE type_id IN (SELECT t.type_id FROM task_types t '
            'JOIN processes p ON p.process_id = t.process_id WHERE p.backend_id = ?)',
            'DELETE FROM task_type_parent_rules WHERE parent_type_id IN (SELECT t.type_id FROM task_types t '
            'JOIN processes p ON p.process_id = t.process_id WHERE p.backend_id = ?)',
            'DELETE FROM task_type_workflows WHERE type_id IN (SELECT t.type_id FROM task_types t '
            'JOIN processes p ON p.process_id = t.process_id WHERE p.backend_id = ?)',
            'DELETE FROM task_type_field_schemas WHERE type_id IN (SELECT t.type_id FROM task_types t '
            'JOIN processes p ON p.process_id = t.process_id WHERE p.backend_id = ?)',
        ):
            connection.execute(statement, (local,))
        # Free unique names so renames and swaps cannot collide before removals. Stored names are
        # stripped, so a leading space never matches a saved value.
        for table, column, key in (('states', 'name', 'state_id'), ('field_schemas', 'name', 'schema_id'),
                                   ('workflows', 'name', 'workflow_id'), ('processes', 'name', 'process_id')):
            connection.execute(f"UPDATE {table} SET {column} = ' ' || {key} WHERE backend_id = ?", (local,))
        existing = list(connection.execute(
            'SELECT field_id, field_key FROM field_definitions WHERE backend_id = ?', (local,)))
        taken = {field['key'] for field in catalogue['fields']} | {row['field_key'] for row in existing}
        spare = (key for key in (f'pending_{n}' for n in range(len(taken) + len(existing))) if key not in taken)
        for row in existing:
            connection.execute('UPDATE field_definitions SET field_key = ? WHERE field_id = ?',
                               (next(spare), row['field_id']))
        connection.execute("UPDATE task_types SET name = ' ' || type_id WHERE process_id IN "
                           "(SELECT process_id FROM processes WHERE backend_id = ?)", (local,))

        for position, state in enumerate(catalogue['states']):
            connection.execute(
                'INSERT INTO states VALUES (?, ?, ?, ?, ?) ON CONFLICT (state_id) DO UPDATE SET '
                'name = excluded.name, category = excluded.category, display_order = excluded.display_order',
                (state['id'], local, state['name'], state['category'], position))
        for position, field in enumerate(catalogue['fields']):
            connection.execute(
                'INSERT INTO field_definitions (field_id, backend_id, field_key, label, value_type, position) '
                'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (field_id) DO UPDATE SET '
                'field_key = excluded.field_key, label = excluded.label, value_type = excluded.value_type, '
                'position = excluded.position',
                (field['id'], local, field['key'], field['label'], field['type'], position))
            for position, option in enumerate(field['options']):
                connection.execute('INSERT INTO field_enum_options VALUES (?, ?, ?)', (field['id'], option, position))
        types_by_field = {field['id']: field['type'] for field in catalogue['fields']}
        for order, schema in enumerate(catalogue['field_schemas']):
            connection.execute(
                'INSERT INTO field_schemas (schema_id, backend_id, name, position) VALUES (?, ?, ?, ?) '
                'ON CONFLICT (schema_id) DO UPDATE SET name = excluded.name, position = excluded.position',
                (schema['id'], local, schema['name'], order))
            for position, entry in enumerate(schema['fields']):
                text, integer, real = _default_columns(entry['default'], types_by_field[entry['field_id']])
                connection.execute(
                    'INSERT INTO field_schema_fields VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (schema['id'], entry['field_id'], position, int(entry['required']), text, integer, real,
                     entry['min'], entry['max'], entry['max_length']))
        for order, workflow in enumerate(catalogue['workflows']):
            connection.execute(
                'INSERT INTO workflows (workflow_id, backend_id, name, position) VALUES (?, ?, ?, ?) '
                'ON CONFLICT (workflow_id) DO UPDATE SET name = excluded.name, position = excluded.position',
                (workflow['id'], local, workflow['name'], order))
            for position, state_id in enumerate(workflow['states']):
                connection.execute('INSERT INTO workflow_states VALUES (?, ?, ?, ?)',
                                   (workflow['id'], state_id, position, int(state_id == workflow['initial'])))
            for position, transition in enumerate(workflow['transitions']):
                connection.execute('INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, '
                                   'position) VALUES (?, ?, ?, ?)',
                                   (workflow['id'], transition['from'], transition['to'], position))
            for position, state_id in enumerate(workflow['from_any']):
                connection.execute('INSERT INTO workflow_any_transitions (workflow_id, to_state_id, position) '
                                   'VALUES (?, ?, ?)', (workflow['id'], state_id, position))
        for order, process in enumerate(catalogue['processes']):
            connection.execute(
                'INSERT INTO processes VALUES (?, ?, ?) ON CONFLICT (process_id) DO UPDATE SET name = excluded.name',
                (process['id'], local, process['name']))
            connection.execute('INSERT INTO process_display_order VALUES (?, ?, ?)', (process['id'], local, order))
            positions: Dict[int, int] = {}
            for entry in process['types']:
                connection.execute(
                    'INSERT INTO task_types VALUES (?, ?, ?, ?) ON CONFLICT (type_id) DO UPDATE SET '
                    'process_id = excluded.process_id, name = excluded.name, backlog_level = excluded.backlog_level',
                    (entry['id'], process['id'], entry['name'], entry['backlog_level']))
                position = positions.get(entry['tier'], 0)
                positions[entry['tier']] = position + 1
                connection.execute('INSERT INTO type_display_tiers VALUES (?, ?, ?)', (entry['id'], entry['tier'], position))
                connection.execute('INSERT INTO task_type_workflows VALUES (?, ?)', (entry['id'], entry['workflow_id']))
                connection.execute('INSERT INTO task_type_field_schemas VALUES (?, ?)',
                                   (entry['id'], entry['field_schema_id']))
            for position, rule in enumerate(process['parent_rules']):
                connection.execute('INSERT INTO task_type_parent_rules (parent_type_id, child_type_id, position) '
                                   'VALUES (?, ?, ?)', (rule['parent'], rule['child'], position))

        self._delete_absent(connection, 'task_types', 'type_id', type_ids,
                            'type_id IN (SELECT t.type_id FROM task_types t JOIN processes p '
                            'ON p.process_id = t.process_id WHERE p.backend_id = ?)')
        for table, column, items in (
            ('processes', 'process_id', catalogue['processes']),
            ('workflows', 'workflow_id', catalogue['workflows']),
            ('field_schemas', 'schema_id', catalogue['field_schemas']),
            ('field_definitions', 'field_id', catalogue['fields']),
            ('states', 'state_id', catalogue['states']),
        ):
            self._delete_absent(connection, table, column, [item['id'] for item in items], 'backend_id = ?')

    @staticmethod
    def _delete_absent(connection, table, column, keep, scope):
        placeholders = ', '.join('?' for _ in keep)
        exclusion = f' AND {column} NOT IN ({placeholders})' if keep else ''
        connection.execute(f'DELETE FROM {table} WHERE {scope}{exclusion}', (LOCAL_BACKEND_ID, *keep))

    def create_starter(self, revision: int) -> Dict[str, Any]:
        """Explicit admin action: populate an empty catalogue with a starter process."""
        current = self.read()
        if current['revision'] != revision:
            raise StaleRevisionError('The catalogue changed since it was loaded; reload and retry')
        if any(current[key] for key in DOCUMENT_KEYS - {'revision'}):
            raise ValueError('The starter catalogue can only be created in an empty catalogue')
        return self.save({**starter_catalogue(), 'revision': revision})

    def work_item_display(self) -> List[dict]:
        catalogue = self.read()
        states = {state['id']: state for state in catalogue['states']}
        workflows = {workflow['id']: workflow for workflow in catalogue['workflows']}
        display = []
        for process in catalogue['processes']:
            tiers: Dict[int, list] = {}
            for entry in process['types']:
                workflow = workflows[entry['workflow_id']]
                state_names = {state_id: states[state_id]['name'] for state_id in workflow['states']}
                allowed = {state_id: set(workflow['from_any']) - {state_id} for state_id in state_names}
                for transition in workflow['transitions']:
                    allowed[transition['from']].add(transition['to'])
                tiers.setdefault(entry['tier'], []).append({'name': entry['name'], 'states': [
                    {'name': states[state_id]['name'], 'category': states[state_id]['category']}
                    for state_id in state_names], 'state_transitions': {
                        name: [target_name for target, target_name in state_names.items() if target in allowed[state_id]]
                        for state_id, name in state_names.items()}})
            display.append({'process_id': process['id'], 'tiers': [tiers[tier] for tier in sorted(tiers)]})
        return display


def starter_catalogue() -> Dict[str, Any]:
    """Epic / Feature / User Story sharing one workflow and an empty field schema."""
    names = [('Open', 'Proposed'), ('Refine', 'Proposed'), ('Ready', 'Proposed'),
             ('In Progress', 'InProgress'), ('Waiting', 'InProgress'), ('Review', 'Resolved'),
             ('Closed', 'Completed')]
    state = {name: str(uuid4()) for name, _ in names}
    edges = [('Open', 'Refine'), ('Refine', 'Open'), ('Refine', 'Ready'), ('Ready', 'Refine'),
             ('Ready', 'In Progress'), ('In Progress', 'Waiting'), ('Waiting', 'In Progress'),
             ('In Progress', 'Review'), ('Review', 'In Progress'), ('Review', 'Closed'), ('Closed', 'Open')]
    workflow_id, schema_id = str(uuid4()), str(uuid4())
    types = [('Epic', 'portfolio'), ('Feature', 'portfolio'), ('User Story', 'requirement')]
    type_ids = {name: str(uuid4()) for name, _ in types}
    return {
        'revision': 0,
        'states': [{'id': state[name], 'name': name, 'category': category} for name, category in names],
        'fields': [],
        'field_schemas': [{'id': schema_id, 'name': 'Default', 'fields': []}],
        'workflows': [{
            'id': workflow_id, 'name': 'Default', 'states': [state[name] for name, _ in names],
            'initial': state['Open'],
            'transitions': [{'from': state[a], 'to': state[b]} for a, b in edges],
            'from_any': [state['Closed']],
        }],
        'processes': [{
            'id': str(uuid4()), 'name': 'Default',
            'types': [{'id': type_ids[name], 'name': name, 'backlog_level': level, 'tier': tier,
                       'workflow_id': workflow_id, 'field_schema_id': schema_id}
                      for tier, (name, level) in enumerate(types)],
            'parent_rules': [{'parent': type_ids['Epic'], 'child': type_ids['Feature']},
                             {'parent': type_ids['Feature'], 'child': type_ids['User Story']}],
        }],
    }
