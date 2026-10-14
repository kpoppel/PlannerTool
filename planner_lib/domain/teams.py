"""Domain types for configured teams."""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from typing_extensions import NotRequired, TypedDict


class DomainTeam(TypedDict):
    """A team as defined in the local teams.yml configuration."""
    id: str             # slug e.g. 'team-architecture'
    name: str           # full display name
    short_name: Optional[str]


UPDATE_FIELDS = frozenset({'last_updated'})


class RecordUpdate(TypedDict):
    """Server-owned UTC update instant; absent means history was not recorded."""

    last_updated: NotRequired[str]


def record_update(record: Mapping[str, Any]) -> RecordUpdate:
    """Validate and copy the update instant without inventing a historical date."""
    if 'last_updated' not in record:
        return RecordUpdate()
    value = record['last_updated']
    if not isinstance(value, str) or not value.endswith('Z'):
        raise ValueError('last_updated must be a UTC ISO timestamp ending in Z')
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError('last_updated must be a UTC ISO timestamp') from error
    if parsed.tzinfo != timezone.utc:
        raise ValueError('last_updated must be a UTC ISO timestamp')
    return RecordUpdate(last_updated=value)


class AllocationDefinition(RecordUpdate):
    """Persisted identity and presentation fields for a workforce team or group."""

    id: str
    allocation_token: str
    name: str
    short_name: str
    archived: bool


class TeamDefinition(AllocationDefinition):
    """A workforce team with at most one group membership."""

    group_id: Optional[str]
    migration_incomplete: NotRequired[bool]


class TeamConfiguration(TypedDict):
    """Team schema v3; workforce staffing is owned by a separate configuration."""

    schema_version: int
    teams: list[TeamDefinition]
    groups: list[AllocationDefinition]


class AllocationTarget(AllocationDefinition):
    """Canonical catalogue entry, including archived identities."""

    kind: Literal['team', 'group']
    group_id: NotRequired[Optional[str]]
    migration_incomplete: NotRequired[bool]


class TeamCatalogue:
    """Validated snapshot of schema v3 identities, independent of UI availability."""

    def __init__(self, config: Mapping[str, Any]) -> None:
        fields = {'schema_version', 'teams', 'groups'}
        missing = fields - config.keys()
        unexpected = config.keys() - fields
        if missing or unexpected:
            raise ValueError(
                f'Invalid team configuration fields: missing {sorted(missing)}, '
                f'unexpected {sorted(unexpected)}'
            )
        if type(config['schema_version']) is not int or config['schema_version'] != 3:
            raise ValueError('Team configuration requires schema_version 3')
        self._by_id: dict[str, AllocationTarget] = {}
        self._by_token: dict[str, str] = {}
        self._members: dict[str, list[str]] = {}

        for kind, key in [('team', 'teams'), ('group', 'groups')]:
            records = config[key]
            if not isinstance(records, list):
                raise ValueError(f'Team configuration {key} must be a list')
            for record in records:
                entry = self._validate_definition(record, kind)
                identity = entry['id']
                token = entry['allocation_token'].strip().lower()
                if identity in self._by_id:
                    raise ValueError(f'Duplicate allocation ID: {identity}')
                if token in self._by_token:
                    raise ValueError(f'Duplicate allocation token: {entry["allocation_token"]}')
                self._by_id[identity] = entry
                self._by_token[token] = identity
                if entry['kind'] == 'group':
                    self._members[identity] = []

        for entry in self._by_id.values():
            if entry['kind'] == 'team':
                group_id = entry['group_id']
                if group_id is not None:
                    if group_id not in self._members:
                        raise ValueError(f'Unknown group {group_id} for team {entry["id"]}')
                    self._members[group_id].append(entry['id'])

    @staticmethod
    def _validate_definition(record: Any, kind: str) -> AllocationTarget:
        if not isinstance(record, Mapping):
            raise ValueError(f'{kind} definition must be an object')
        fields = {'id', 'allocation_token', 'name', 'short_name', 'archived'}
        if kind == 'team':
            fields.add('group_id')
        missing = fields - record.keys()
        review_fields = {'migration_incomplete'} if kind == 'team' else set()
        unexpected = record.keys() - fields - UPDATE_FIELDS - review_fields
        if missing or unexpected:
            raise ValueError(
                f'Invalid {kind} fields: missing {sorted(missing)}, unexpected {sorted(unexpected)}'
            )
        for field in ['id', 'allocation_token', 'name', 'short_name']:
            value = record[field]
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f'{kind} {field} must be a nonempty string')
        if record['id'] != record['id'].strip():
            raise ValueError(f'{kind} id must not have surrounding whitespace')
        token = record['allocation_token']
        if any(character in token for character in ':\r\n') or token.strip().startswith('#'):
            raise ValueError(f'{kind} allocation_token cannot round trip through capacity blocks')
        if type(record['archived']) is not bool:
            raise ValueError(f'{kind} archived must be a boolean')
        entry = AllocationTarget(
            id=record['id'], allocation_token=token, name=record['name'],
            short_name=record['short_name'], archived=record['archived'],
            kind='team' if kind == 'team' else 'group',
        )
        entry.update(record_update(record))
        if kind == 'team':
            group_id = record['group_id']
            if group_id is not None and (
                not isinstance(group_id, str) or not group_id.strip()
            ):
                raise ValueError('team group_id must be a nonempty string or null')
            entry['group_id'] = group_id
            if 'migration_incomplete' in record:
                if type(record['migration_incomplete']) is not bool:
                    raise ValueError('team migration_incomplete must be a boolean')
                if record['migration_incomplete'] and not record['archived']:
                    raise ValueError('Incomplete migrated teams must remain archived until review is completed')
                entry['migration_incomplete'] = record['migration_incomplete']
        return entry

    def definitions(self) -> list[AllocationTarget]:
        """Return all team/group identities, including archives, without mutable aliases."""
        return [entry.copy() for entry in self._by_id.values()]

    def allocation_choices(self) -> list[AllocationTarget]:
        """Return non-archived candidates; plan availability is a separate projection."""
        return [entry.copy() for entry in self._by_id.values() if not entry['archived']]

    def token_to_id(self, token: str) -> str:
        """Resolve a token using the legacy trimmed, lowercase comparison namespace."""
        normalized = token.strip().lower()
        if normalized not in self._by_token:
            raise ValueError(f'Unknown allocation token: {token}')
        return self._by_token[normalized]

    def id_to_token(self, identity: str) -> str:
        """Return the exact persisted token, never a display label."""
        if identity not in self._by_id:
            raise ValueError(f'Unknown allocation ID: {identity}')
        return self._by_id[identity]['allocation_token']

    def member_team_ids(self, group_id: str) -> list[str]:
        """Return explicit group members, retaining archives for historical calculations."""
        if group_id not in self._members:
            raise ValueError(f'Allocation ID is not a group: {group_id}')
        return list(self._members[group_id])
