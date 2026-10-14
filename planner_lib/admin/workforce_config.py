"""Atomic editing operations for migrated team/workforce configurations."""
from __future__ import annotations

from base64 import b32encode
from collections.abc import Mapping, Iterable
from contextlib import AbstractContextManager
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from secrets import token_bytes
from time import time_ns
from typing import Any, Literal, cast

from typing_extensions import TypedDict

from planner_lib.admin.config_manager import ConfigManager
from planner_lib.admin.workforce_deletion import TeamDeletionReview, build_deletion_review
from planner_lib.admin.workforce_graphs import validate_membership_graphs
from planner_lib.domain.teams import (
    UPDATE_FIELDS, AllocationDefinition, TeamCatalogue, TeamConfiguration, TeamDefinition,
)
from planner_lib.domain.workforce import (
    StaffingDefinition, SupplierDefinition, SupplierProfile,
    WorkforceCatalogue, WorkforceConfiguration,
)
from planner_lib.storage.base import StorageBackend


DefinitionKind = Literal['team', 'group', 'supplier', 'profile', 'staffing']


class WorkforceSnapshot(TypedDict):
    """Coherent editable configurations and their server-computed content revision."""

    revision: str
    teams: TeamConfiguration
    workforce: WorkforceConfiguration


class WorkforceConflictError(ValueError):
    """The caller's configuration revision no longer matches current storage."""


class WorkforceUnavailableError(ValueError):
    """Canonical editing requires an explicitly migrated team/workforce store."""


def _timestamp_identity() -> str:
    timestamp = time_ns().to_bytes(8, 'big')
    return b32encode(timestamp + token_bytes(8)).decode('ascii').rstrip('=').lower()


class WorkforceConfigManager:
    """Own canonical editing operations; requires migrated schemas and atomic storage."""

    CREATE_FIELDS = {
        'team': {'name', 'short_name', 'group_id'},
        'group': {'name', 'short_name'},
        'supplier': {'name', 'external'},
        'profile': {'name', 'monthly_project_hours', 'hourly_rate'},
        'staffing': {'team_id', 'supplier_id', 'profile_id', 'fte'},
    }

    def __init__(self, storage: StorageBackend, *, task_storage: StorageBackend | None = None) -> None:
        self._storage = storage
        self._task_storage = task_storage
        self._configs = ConfigManager(storage)

    def _snapshot(self) -> WorkforceSnapshot:
        teams = self._configs.get_config('teams')
        if not isinstance(teams, Mapping) or teams.get('schema_version') != 3:
            raise WorkforceUnavailableError('Workforce editing requires migrated teams schema v3')
        if not self._storage.exists('config', 'workforce'):
            raise WorkforceUnavailableError('Workforce editing requires migrated workforce schema v2')
        workforce = self._storage.load('config', 'workforce')
        if not isinstance(workforce, Mapping) or workforce.get('schema_version') != 2:
            raise WorkforceUnavailableError('Workforce editing requires migrated workforce schema v2')
        catalogue = TeamCatalogue(teams)
        workforce = WorkforceCatalogue(workforce, catalogue).definitions()
        encoded = json.dumps(
            {'teams': teams, 'workforce': workforce}, sort_keys=True, allow_nan=False,
            separators=(',', ':'),
        ).encode('utf-8')
        return WorkforceSnapshot(
            revision=sha256(encoded).hexdigest(),
            teams=TeamConfiguration(
                schema_version=3, teams=deepcopy(teams['teams']), groups=deepcopy(teams['groups']),
            ),
            workforce=workforce,
        )

    def read_snapshot(self) -> WorkforceSnapshot:
        """Read both configurations under one transaction without mutable storage aliases."""
        with self._storage.transaction():
            return self._snapshot()

    def has_canonical_teams(self) -> bool:
        """Identify canonical teams so legacy editing endpoints cannot bypass their owner."""
        teams = self._configs.get_config('teams')
        return isinstance(teams, Mapping) and teams.get('schema_version') == 3

    def _current(self, expected_revision: str) -> WorkforceSnapshot:
        current = self._snapshot()
        if current['revision'] != expected_revision:
            raise WorkforceConflictError('Workforce configuration changed; reload before saving')
        return current

    @staticmethod
    def _assert_identities(
        previous: Iterable[Mapping[str, Any]], candidate: Iterable[Mapping[str, Any]],
        context: str, issued: set[tuple[str, str]], *, allow_removal: bool = False,
    ) -> None:
        old_records = {record['id']: record for record in previous}
        new_records = {record['id']: record for record in candidate}
        for identity, record in old_records.items():
            if identity not in new_records:
                if not allow_removal:
                    raise ValueError(f'Cannot remove {context} {identity} through ordinary save')
                continue
            if 'allocation_token' in record and (
                new_records[identity]['allocation_token'] != record['allocation_token']
            ):
                raise ValueError(f'{context} {identity} allocation_token is immutable')
            new_record = new_records[identity]
            if record.get('migration_incomplete', False) and 'migration_incomplete' not in new_record:
                raise ValueError(f'{context} {identity} migration review must be completed explicitly')
            for field in UPDATE_FIELDS:
                if (field in record) != (field in new_record) or (
                    field in record and record[field] != new_record[field]
                ):
                    raise ValueError(f'{context} {identity} {field} is server-owned')
        for identity in new_records.keys() - old_records.keys():
            if (context, identity) not in issued:
                raise ValueError(f'New {context} identities require server creation')
            if UPDATE_FIELDS & new_records[identity].keys():
                raise ValueError(f'{context} {identity} last_updated is server-owned')

    def _validate(
        self, previous: WorkforceSnapshot, candidate: WorkforceSnapshot,
        issued: set[tuple[str, str]],
    ) -> None:
        teams = TeamCatalogue(candidate['teams'])
        old_teams = TeamCatalogue(previous['teams'])
        workforce = WorkforceCatalogue(candidate['workforce'], teams)
        old_workforce = WorkforceCatalogue(previous['workforce'], old_teams)
        for context, key in [('team', 'teams'), ('group', 'groups')]:
            self._assert_identities(
                previous['teams'][key], candidate['teams'][key], context, issued,
            )
        self._assert_identities(
            previous['workforce']['suppliers'], candidate['workforce']['suppliers'],
            'supplier', issued,
        )
        old_suppliers = {
            supplier['id']: supplier for supplier in previous['workforce']['suppliers']
        }
        for supplier in candidate['workforce']['suppliers']:
            old_supplier = old_suppliers.get(supplier['id'])
            old_profiles = [] if old_supplier is None else old_supplier['profiles']
            self._assert_identities(
                old_profiles, supplier['profiles'], f'profile:{supplier["id"]}', issued,
            )
        self._assert_identities(
            previous['workforce']['staffing'], candidate['workforce']['staffing'],
            'staffing', issued, allow_removal=True,
        )
        old_by_id = {entry['id']: entry for entry in previous['teams']['teams']}
        new_by_id = {entry['id']: entry for entry in teams.definitions()}
        for team in candidate['teams']['teams']:
            group_id = team['group_id']
            previous_team = old_by_id.get(team['id'])
            retained = previous_team is not None and previous_team['group_id'] == group_id
            if group_id is not None and new_by_id[group_id]['archived'] and not retained:
                raise ValueError(f'Team {team["id"]} cannot join archived group {group_id}')
        workforce.validate_staffing_changes(old_workforce)
        workforce.group_bases()
        previous_memberships = {
            team['id']: team['group_id'] for team in previous['teams']['teams']
            if team['group_id'] is not None
        }
        candidate_memberships = {
            team['id']: team['group_id'] for team in candidate['teams']['teams']
            if team['group_id'] is not None
        }
        if previous_memberships != candidate_memberships:
            if self._task_storage is None:
                raise ValueError('Membership changes require the retained task storage port')
            validate_membership_graphs(
                self._storage, self._task_storage, previous_memberships, candidate_memberships,
            )

    @staticmethod
    def _dated_records(snapshot: WorkforceSnapshot) -> dict[tuple[str, str], dict[str, Any]]:
        records: dict[tuple[str, str], dict[str, Any]] = {}
        for kind, key in [('team', 'teams'), ('group', 'groups')]:
            for record in snapshot['teams'][key]:
                records[(kind, record['id'])] = cast(dict[str, Any], record)
        for supplier in snapshot['workforce']['suppliers']:
            records[('supplier', supplier['id'])] = cast(dict[str, Any], supplier)
            for profile in supplier['profiles']:
                records[(f'profile:{supplier["id"]}', profile['id'])] = cast(dict[str, Any], profile)
        for row in snapshot['workforce']['staffing']:
            records[('staffing', row['id'])] = cast(dict[str, Any], row)
        return records

    @classmethod
    def _stamp_dates(cls, previous: WorkforceSnapshot, candidate: WorkforceSnapshot) -> None:
        old_records = cls._dated_records(previous)
        new_records = cls._dated_records(candidate)
        changed = {
            key for key, record in new_records.items()
            if key not in old_records or record != old_records[key]
        }
        removed = old_records.keys() - new_records.keys()
        if not changed and not removed:
            return
        changed.update(removed)
        changed_suppliers = {
            supplier['id'] for supplier in candidate['workforce']['suppliers']
            if ('supplier', supplier['id']) not in old_records or any(
                supplier[field] != old_records[('supplier', supplier['id'])][field]
                for field in ('name', 'external', 'archived')
            )
        }
        for snapshot in (previous, candidate):
            for row in snapshot['workforce']['staffing']:
                if (('staffing', row['id']) in changed or ('staffing', row['id']) in removed
                    or row['supplier_id'] in changed_suppliers
                    or (f'profile:{row["supplier_id"]}', row['profile_id']) in changed):
                    changed.add(('team', row['team_id']))
            for team in snapshot['teams']['teams']:
                if ('team', team['id']) in changed and team['group_id'] is not None:
                    changed.add(('group', team['group_id']))
        timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        for key in changed & new_records.keys():
            record = new_records[key]
            record['last_updated'] = timestamp

    def _persist(
        self, previous: WorkforceSnapshot, candidate: WorkforceSnapshot,
    ) -> WorkforceSnapshot:
        self._stamp_dates(previous, candidate)
        if previous['teams'] != candidate['teams']:
            self._configs.save_config('teams', candidate['teams'])
        if previous['workforce'] != candidate['workforce']:
            self._configs.save_config('workforce', candidate['workforce'])
        return self._snapshot()

    def save_configuration(
        self, teams: TeamConfiguration, workforce: WorkforceConfiguration,
        expected_revision: str,
    ) -> WorkforceSnapshot:
        """Save edits atomically, rejecting stale revisions, identity changes and omissions."""
        with self._storage.transaction(), self._task_transaction():
            previous = self._current(expected_revision)
            candidate = WorkforceSnapshot(
                revision=expected_revision, teams=deepcopy(teams), workforce=deepcopy(workforce),
            )
            self._validate(previous, candidate, set())
            return self._persist(previous, candidate)

    def _task_transaction(self) -> AbstractContextManager[None]:
        if self._task_storage is None:
            raise WorkforceUnavailableError('Canonical mutations require the retained task storage port')
        return self._task_storage.transaction()

    def review_team_deletion(
        self, team_id: str, *, task_storage: StorageBackend,
    ) -> TeamDeletionReview:
        """Return retained-reference impact and a receipt without contacting ADO or writing."""
        with self._storage.transaction(), task_storage.transaction():
            review, _ = build_deletion_review(self._storage, task_storage, self._snapshot(), team_id)
            return review

    def delete_team(
        self, team_id: str, expected_revision: str, *, acknowledged: bool,
        review_revision: str, task_storage: StorageBackend,
    ) -> WorkforceSnapshot:
        """Delete one explicitly acknowledged team and its staffing atomically."""
        if acknowledged is not True:
            raise ValueError('Team deletion requires explicit destructive acknowledgement')
        with self._storage.transaction(), task_storage.transaction():
            previous = self._current(expected_revision)
            review, config_changes = build_deletion_review(self._storage, task_storage, previous, team_id)
            if review['review_revision'] != review_revision:
                raise WorkforceConflictError('Team deletion review changed; review again before deleting')
            candidate = deepcopy(previous)
            candidate['teams']['teams'] = [
                team for team in candidate['teams']['teams'] if team['id'] != team_id
            ]
            candidate['workforce']['staffing'] = [
                row for row in candidate['workforce']['staffing'] if row['team_id'] != team_id
            ]
            teams = TeamCatalogue(candidate['teams'])
            WorkforceCatalogue(candidate['workforce'], teams).group_bases()
            for key, content in config_changes.items():
                self._configs.save_config(key, content)
            return self._persist(previous, candidate)

    @staticmethod
    def _issue_identity(snapshot: WorkforceSnapshot) -> str:
        identities: set[str] = set()
        tokens: set[str] = set()
        for record in [*snapshot['teams']['teams'], *snapshot['teams']['groups']]:
            identities.add(record['id'])
            tokens.add(record['allocation_token'].strip().lower())
        for supplier in snapshot['workforce']['suppliers']:
            identities.add(supplier['id'])
            for profile in supplier['profiles']:
                identities.add(profile['id'])
        for row in snapshot['workforce']['staffing']:
            identities.add(row['id'])
        while True:
            identity = _timestamp_identity()
            if identity not in identities and identity.strip().lower() not in tokens:
                return identity

    def create_definition(
        self, kind: DefinitionKind, fields: Mapping[str, Any], expected_revision: str,
        *, supplier_id: str | None = None,
    ) -> WorkforceSnapshot:
        """Issue and persist one identity using client-provided editable fields only."""
        if kind not in self.CREATE_FIELDS:
            raise ValueError(f'Unknown workforce definition kind: {kind}')
        expected_fields = self.CREATE_FIELDS[kind]
        if not isinstance(fields, Mapping) or fields.keys() != expected_fields:
            raise ValueError(f'{kind} creation fields must be exactly {sorted(expected_fields)}')
        if kind == 'profile' and supplier_id is None:
            raise ValueError('Profile creation requires supplier_id')
        if kind != 'profile' and supplier_id is not None:
            raise ValueError('Only profile creation accepts supplier_id')
        with self._storage.transaction(), self._task_transaction():
            previous = self._current(expected_revision)
            candidate = deepcopy(previous)
            identity = self._issue_identity(previous)
            context = kind
            if kind == 'team':
                candidate['teams']['teams'].append(TeamDefinition(
                    id=identity, allocation_token=identity, archived=False,
                    name=fields['name'], short_name=fields['short_name'], group_id=fields['group_id'],
                ))
            elif kind == 'group':
                candidate['teams']['groups'].append(AllocationDefinition(
                    id=identity, allocation_token=identity, archived=False,
                    name=fields['name'], short_name=fields['short_name'],
                ))
            elif kind == 'supplier':
                candidate['workforce']['suppliers'].append(SupplierDefinition(
                    id=identity, archived=False, name=fields['name'],
                    external=fields['external'], profiles=[],
                ))
            elif kind == 'profile':
                suppliers = {
                    supplier['id']: supplier for supplier in candidate['workforce']['suppliers']
                }
                if supplier_id not in suppliers:
                    raise ValueError(f'Unknown supplier: {supplier_id}')
                if suppliers[supplier_id]['archived']:
                    raise ValueError(f'Cannot create a profile on archived supplier {supplier_id}')
                suppliers[supplier_id]['profiles'].append(SupplierProfile(
                    id=identity, archived=False, name=fields['name'],
                    monthly_project_hours=fields['monthly_project_hours'],
                    hourly_rate=fields['hourly_rate'],
                ))
                context = f'profile:{supplier_id}'
            else:
                candidate['workforce']['staffing'].append(StaffingDefinition(
                    id=identity, team_id=fields['team_id'], supplier_id=fields['supplier_id'],
                    profile_id=fields['profile_id'], fte=fields['fte'],
                ))
            self._validate(previous, candidate, {(context, identity)})
            return self._persist(previous, candidate)