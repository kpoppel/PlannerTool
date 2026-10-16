"""Workforce-only interchange with additive, revision-bound import reviews."""
from collections.abc import Mapping
from copy import deepcopy
from hashlib import sha256
import json
from typing import Any

import yaml

from planner_lib.admin.workforce_config import (
    WorkforceConfigManager, WorkforceConflictError, WorkforceSnapshot,
)
from planner_lib.admin.workforce_graphs import retained_allocation_graphs
from planner_lib.domain.allocation_availability import validate_available_ids, validate_project_availability


MAX_TRANSFER_BYTES = 2 * 1024 * 1024
FORMAT = 'plannertool-workforce'


class WorkforceLoader(yaml.SafeLoader):
    """Reject duplicate keys, aliases and oversized structures at the file boundary."""

    def __init__(self, stream: str) -> None:
        super().__init__(stream)
        self._nodes = 0
        self._depth = 0

    def compose_node(self, parent: Any, index: Any) -> Any:
        self._nodes += 1
        self._depth += 1
        if self.check_event(yaml.AliasEvent) or self._nodes > 100000 or self._depth > 32:
            raise ValueError('Workforce YAML cannot contain aliases or excessively nested structures')
        try:
            return super().compose_node(parent, index)
        finally:
            self._depth -= 1

    def construct_mapping(self, node: Any, deep: bool = False) -> dict[str, Any]:
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in result:
                raise ValueError('Workforce YAML requires unique string mapping keys')
            result[key] = self.construct_object(value_node, deep=deep)
        return result


WorkforceLoader.yaml_implicit_resolvers = {
    key: [(tag, pattern) for tag, pattern in resolvers if tag != 'tag:yaml.org,2002:timestamp']
    for key, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def parse_document(source: str) -> dict[str, Any]:
    """Parse bounded safe YAML; timestamp strings retain their literal representation."""
    if not isinstance(source, str) or len(source.encode('utf-8')) > MAX_TRANSFER_BYTES:
        raise ValueError('Workforce file must be UTF-8 YAML no larger than 2 MiB')
    try:
        document = yaml.load(source, Loader=WorkforceLoader)
    except yaml.YAMLError as error:
        raise ValueError('Invalid workforce YAML document') from error
    if not isinstance(document, dict):
        raise ValueError('Workforce file must contain an object')
    return document


def _digest(value: Any) -> str:
    return sha256(json.dumps(value, sort_keys=True, allow_nan=False,
                             separators=(',', ':')).encode('utf-8')).hexdigest()


def _records(snapshot: Mapping[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
    records = {}
    for kind, key in [('team', 'teams'), ('group', 'groups')]:
        for record in snapshot['teams'][key]:
            records[record['id']] = (kind, deepcopy(record))
    for supplier in snapshot['workforce']['suppliers']:
        record = deepcopy(supplier)
        profiles = record.pop('profiles')
        records[record['id']] = ('supplier', record)
        for profile in profiles:
            records[profile['id']] = (f'profile:{record["id"]}', profile)
    for row in snapshot['workforce']['staffing']:
        records[row['id']] = ('staffing', deepcopy(row))
    return records


class WorkforceTransfer:
    """Use the canonical owner's transactions and lifecycle checks for portable identities."""

    def __init__(self, manager: WorkforceConfigManager) -> None:
        self._manager = manager

    def export_document(self) -> dict[str, Any]:
        snapshot = self._manager.read_snapshot()
        return {'format': FORMAT, 'version': 1,
                'teams': snapshot['teams'], 'workforce': snapshot['workforce']}

    def _validate_document(self, document: Any) -> None:
        if not isinstance(document, dict) or document.keys() != {
            'format', 'version', 'teams', 'workforce',
        }:
            raise ValueError('Expected a workforce-only export with format, version, teams and workforce')
        if document['format'] != FORMAT or type(document['version']) is not int or document['version'] != 1:
            raise ValueError('Unsupported workforce transfer format or version')
        if not isinstance(document['teams'], dict) or not isinstance(document['workforce'], dict):
            raise ValueError('Workforce file requires paired teams and workforce objects')
        self._manager.validate_configuration(document['teams'], document['workforce'])

    def _merge(
        self, previous: WorkforceSnapshot, document: dict[str, Any], decisions: dict[str, str],
    ) -> tuple[WorkforceSnapshot, list[dict[str, Any]]]:
        self._validate_document(document)
        if not isinstance(decisions, dict) or any(
            not isinstance(identity, str) or choice not in ('skip', 'overwrite')
            for identity, choice in decisions.items()
        ):
            raise ValueError('Import decisions must be skip or overwrite for each conflicting ID')
        existing = _records(previous)
        incoming = _records(document)
        token_owners = {
            record['allocation_token'].strip().lower(): identity
            for identity, (_, record) in existing.items() if 'allocation_token' in record
        }
        if decisions.keys() - incoming.keys():
            raise ValueError('Import decisions reference records not present in the file')
        merged = deepcopy(existing)
        rows = []
        for identity, (kind, record) in incoming.items():
            old = existing.get(identity)
            token_owner = token_owners.get(record['allocation_token'].strip().lower()) if (
                'allocation_token' in record
            ) else None
            token_collision = token_owner is not None and token_owner != identity
            comparison = existing[token_owner] if token_collision else old
            structural = old is not None and (
                old[0] != kind or ('allocation_token' in record and
                                  old[1]['allocation_token'] != record['allocation_token'])
            )
            structural = structural or token_collision
            status = 'new' if old is None else ('identical' if old == (kind, record) else 'conflict')
            if structural:
                status = 'conflict'
            decision = decisions.get(identity)
            if decision is not None and status != 'conflict' and not (
                status == 'new' and decision == 'skip'
            ):
                raise ValueError(f'Only new or conflicting records accept import decisions: {identity}')
            if structural and decision == 'overwrite':
                raise ValueError(f'Cannot overwrite identity, token or profile ownership for {identity}')
            rows.append({'id': identity, 'kind': kind, 'name': record.get('name', identity),
                         'status': status, 'structural': structural, 'decision': decision,
                         'current': None if comparison is None else comparison[1], 'incoming': record})
            if (status == 'new' and decision != 'skip') or (
                status == 'conflict' and decision == 'overwrite'
            ):
                merged[identity] = (kind, record)
        candidate = deepcopy(previous)
        candidate['teams']['teams'] = [record for kind, record in merged.values() if kind == 'team']
        candidate['teams']['groups'] = [record for kind, record in merged.values() if kind == 'group']
        suppliers = []
        for kind, record in merged.values():
            if kind == 'supplier':
                supplier = deepcopy(record)
                supplier['profiles'] = [profile for owner, profile in merged.values()
                                        if owner == f'profile:{supplier["id"]}']
                suppliers.append(supplier)
        candidate['workforce']['suppliers'] = suppliers
        candidate['workforce']['staffing'] = [record for kind, record in merged.values() if kind == 'staffing']
        return candidate, rows

    def _evidence(self) -> dict[str, Any]:
        storage = self._manager._storage
        evidence: dict[str, Any] = {'config': {}, 'scenarios': {}, 'views': {}}
        for key in ('projects', 'area_plan_map'):
            if storage.exists('config', key):
                evidence['config'][key] = storage.load('config', key)
        for namespace in ('scenarios', 'views'):
            for key in sorted(storage.list_keys(namespace)):
                evidence[namespace][key] = storage.load(namespace, key)
        evidence['graphs'] = retained_allocation_graphs(storage, self._manager._task_storage)
        return evidence

    def _validate_candidate(self, previous: WorkforceSnapshot, candidate: WorkforceSnapshot) -> None:
        manager = self._manager
        catalogue = manager.validate_configuration(candidate['teams'], candidate['workforce'])
        issued = {(kind, identity) for identity, (kind, _) in _records(candidate).items()}
        manager._validate(previous, candidate, issued, imported=True)
        if manager._storage.exists('config', 'projects'):
            validate_project_availability(manager._storage.load('config', 'projects'), catalogue.definitions())
        if manager._storage.exists('config', 'area_plan_map'):
            self._validate_availability(manager._storage.load('config', 'area_plan_map'),
                                        {entry['id']: entry for entry in catalogue.definitions()})

    @classmethod
    def _validate_availability(cls, value: Any, catalogue: Mapping[str, Any]) -> None:
        if isinstance(value, dict):
            for field, child in value.items():
                if field == 'allocatable_ids':
                    validate_available_ids(child, catalogue)
                else:
                    cls._validate_availability(child, catalogue)
        elif isinstance(value, list):
            for child in value:
                cls._validate_availability(child, catalogue)

    def _review(
        self, previous: WorkforceSnapshot, document: dict[str, Any], decisions: dict[str, str],
    ) -> tuple[dict[str, Any], WorkforceSnapshot]:
        candidate, records = self._merge(previous, document, decisions)
        errors = []
        if any(row['status'] == 'conflict' and row['decision'] is None for row in records):
            errors.append('Choose a skip or overwrite decision for every conflicting record')
        try:
            self._validate_candidate(previous, candidate)
        except ValueError as error:
            errors.append(str(error))
        evidence = self._evidence()
        review = {'revision': previous['revision'], 'records': records, 'errors': errors,
                  'ready': not errors, 'coverage': {
                      'historically_complete': False,
                      'retained_tasks': len(evidence['graphs']['baseline']),
                      'scenarios': len(evidence['scenarios']), 'views': len(evidence['views']),
                  }}
        review['review_revision'] = _digest({'document': document, 'decisions': decisions,
                                            'review': review, 'evidence': evidence})
        return review, candidate

    def preview(self, document: dict[str, Any], decisions: dict[str, str]) -> dict[str, Any]:
        with self._manager._storage.transaction(), self._manager._task_transaction():
            review, _ = self._review(self._manager._snapshot(), document, decisions)
            return review

    def commit(
        self, document: dict[str, Any], decisions: dict[str, str], revision: str,
        review_revision: str,
    ) -> WorkforceSnapshot:
        manager = self._manager
        with manager._storage.transaction(), manager._task_transaction():
            previous = manager._current(revision)
            review, candidate = self._review(previous, document, decisions)
            if review['review_revision'] != review_revision:
                raise WorkforceConflictError('Import review changed; preview the file again before importing')
            if not review['ready']:
                raise ValueError('; '.join(review['errors']))
            for key in ('teams', 'workforce'):
                if candidate[key] != previous[key]:
                    manager._configs.save_config(key, candidate[key])
            return manager._snapshot()