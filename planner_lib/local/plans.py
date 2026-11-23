"""Local plan definitions: plan-owned task scope without ADO area paths.

Plan levels, allocation defaults, teams and iteration sets remain in the
configuration store; links to them are validated here on save.
"""
from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any, Dict, List
from uuid import UUID

from planner_lib.backend.selection import LOCAL_BACKEND_ID
from planner_lib.domain.allocation_availability import validate_available_ids
from planner_lib.domain.plans import validate_plan_common
from planner_lib.domain.teams import TeamCatalogue
from planner_lib.local.catalogue import StaleRevisionError

PLAN_KEYS = {'id', 'name', 'type', 'archived', 'task_types', 'closed_history_days',
             'iteration_uuid', 'markers'}
MARKER_KEYS = {'id', 'label', 'date', 'color'}


class PlanInUseError(Exception):
    """A removed plan still owns tasks."""


def _require(condition, message):
    if not condition:
        raise ValueError(message)


class LocalPlans:
    def __init__(self, database, storage) -> None:
        self._database = database
        self._storage = storage

    @staticmethod
    def _revision(connection):
        return connection.execute(
            "SELECT revision FROM document_revisions WHERE document = 'local_plans'").fetchone()[0]

    def read(self) -> Dict[str, Any]:
        with self._database.connect() as connection:
            connection.execute('BEGIN')
            try:
                plans = []
                for row in connection.execute(
                        'SELECT p.*, i.iteration_set_id FROM plan_definitions p '
                        'LEFT JOIN plan_iteration_sets i ON i.plan_id = p.plan_id '
                        'WHERE p.backend_id = ? ORDER BY p.display_order', (LOCAL_BACKEND_ID,)):
                    key = (row['plan_id'],)
                    plan = {
                        'id': row['plan_id'], 'name': row['name'], 'type': row['kind'],
                        'archived': bool(row['archived']),
                        'task_types': [item[0] for item in connection.execute(
                            'SELECT type_id FROM plan_task_types WHERE plan_id = ? ORDER BY rowid', key)],
                        'closed_history_days': row['closed_history_days'],
                        'iteration_uuid': row['iteration_set_id'],
                        'markers': [{'id': m['marker_id'], 'label': m['label'], 'date': m['marker_date'],
                                     'color': m['color']} for m in connection.execute(
                            'SELECT * FROM plan_markers WHERE plan_id = ? ORDER BY marker_date, rowid', key)],
                    }
                    if row['allocation_override']:
                        plan['allocatable_ids'] = [item[0] for item in connection.execute(
                            'SELECT team_id FROM plan_allocatable_teams WHERE plan_id = ? ORDER BY position', key)]
                    plans.append(plan)
                return {'revision': self._revision(connection), 'plans': plans}
            finally:
                connection.execute('ROLLBACK')

    def _validate(self, document, connection):
        _require(isinstance(document, dict) and set(document) == {'revision', 'plans'},
                 'Local plans require exactly revision and plans')
        _require(type(document['revision']) is int, 'Local plans revision is required')
        _require(isinstance(document['plans'], list), 'plans must be a list')
        projects = self._storage.load('config', 'projects')
        levels = projects['container_types']
        definitions = {entry['id']: entry for entry in TeamCatalogue(self._storage.load('config', 'teams')).definitions()}
        iteration_sets = {item['id'] for item in self._storage.load('config', 'iterations')['iteration_sets']}
        selectable = {row['type_id'] for row in connection.execute(
            "SELECT t.type_id FROM task_types t JOIN processes p ON p.process_id = t.process_id "
            "WHERE p.backend_id = ? AND t.backlog_level <> 'task'", (LOCAL_BACKEND_ID,))}
        ids, markers = set(), set()
        for plan in document['plans']:
            _require(isinstance(plan, dict) and PLAN_KEYS <= set(plan) <= PLAN_KEYS | {'allocatable_ids'},
                     'Local plans have exactly: ' + ', '.join(sorted(PLAN_KEYS)) + ' and optional allocatable_ids')
            try:
                _require(str(UUID(plan['id'])) == plan['id'], 'Plan ids must be canonical UUIDs')
            except (TypeError, ValueError, AttributeError):
                raise ValueError('Plan ids must be canonical UUIDs') from None
            _require(plan['id'] not in ids, 'Duplicate plan id')
            ids.add(plan['id'])
            validate_plan_common(plan, levels)
            _require(type(plan['archived']) is bool, 'archived must be true or false')
            _require(len(set(plan['task_types'])) == len(plan['task_types']), 'Duplicate plan task types')
            _require(set(plan['task_types']) <= selectable,
                     f"Plan {plan['name']} selects unknown or task-level types")
            _require(plan['iteration_uuid'] is None or plan['iteration_uuid'] in iteration_sets,
                     f"Plan {plan['name']} uses an unknown iteration set")
            if 'allocatable_ids' in plan:
                validate_available_ids(plan['allocatable_ids'], definitions)
            _require(isinstance(plan['markers'], list), 'markers must be a list')
            for marker in plan['markers']:
                _require(isinstance(marker, dict) and set(marker) == MARKER_KEYS,
                         'Markers have exactly: ' + ', '.join(sorted(MARKER_KEYS)))
                _require(isinstance(marker['id'], str) and marker['id'] and marker['id'] not in markers,
                         'Marker ids must be unique nonempty strings')
                markers.add(marker['id'])
                _require(isinstance(marker['label'], str) and marker['label'].strip(), 'Marker label is required')
                _require(isinstance(marker['date'], str) and _is_date(marker['date']), 'Marker date must be YYYY-MM-DD')
                _require(marker['color'] is None or isinstance(marker['color'], str), 'Marker color must be text')

    def save(self, document: Any) -> Dict[str, Any]:
        try:
            with self._database.write() as connection:
                self._validate(document, connection)
                if self._revision(connection) != document['revision']:
                    raise StaleRevisionError('Local plans changed since they were loaded; reload and retry')
                self._apply(connection, document['plans'])
                connection.execute("UPDATE document_revisions SET revision = revision + 1 WHERE document = 'local_plans'")
        except sqlite3.IntegrityError as error:
            raise PlanInUseError('A removed plan still owns tasks; move or delete them first') from error
        return self.read()

    @staticmethod
    def _apply(connection, plans: List[dict]):
        local = (LOCAL_BACKEND_ID,)
        scope = 'plan_id IN (SELECT plan_id FROM plan_definitions WHERE backend_id = ?)'
        for table in ('plan_task_types', 'plan_allocatable_teams', 'plan_iteration_sets', 'plan_markers'):
            connection.execute(f'DELETE FROM {table} WHERE {scope}', local)
        # Free display positions before rewriting them.
        connection.execute('UPDATE plan_definitions SET display_order = -1 - rowid WHERE backend_id = ?', local)
        keep = [plan['id'] for plan in plans]
        placeholders = ', '.join('?' for _ in keep)
        connection.execute('DELETE FROM plan_definitions WHERE backend_id = ?'
                           + (f' AND plan_id NOT IN ({placeholders})' if keep else ''), (*local, *keep))
        for order, plan in enumerate(plans):
            connection.execute(
                'INSERT INTO plan_definitions (plan_id, backend_id, name, kind, archived, display_order, '
                'closed_history_days, area_path, allocation_override) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?) '
                'ON CONFLICT (plan_id) DO UPDATE SET name = excluded.name, kind = excluded.kind, '
                'archived = excluded.archived, display_order = excluded.display_order, '
                'closed_history_days = excluded.closed_history_days, '
                'allocation_override = excluded.allocation_override',
                (plan['id'], LOCAL_BACKEND_ID, plan['name'].strip(), plan['type'], int(plan['archived']), order,
                 plan['closed_history_days'], int('allocatable_ids' in plan)))
            for type_id in plan['task_types']:
                connection.execute('INSERT INTO plan_task_types VALUES (?, ?)', (plan['id'], type_id))
            for position, team_id in enumerate(plan.get('allocatable_ids', [])):
                connection.execute('INSERT INTO plan_allocatable_teams VALUES (?, ?, ?)', (plan['id'], team_id, position))
            if plan['iteration_uuid'] is not None:
                connection.execute('INSERT INTO plan_iteration_sets VALUES (?, ?)', (plan['id'], plan['iteration_uuid']))
            for marker in plan['markers']:
                connection.execute('INSERT INTO plan_markers VALUES (?, ?, ?, ?, ?)',
                                   (marker['id'], plan['id'], marker['label'].strip(), marker['date'], marker['color']))


def _is_date(value):
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False
