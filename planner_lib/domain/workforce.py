"""Anonymous workforce definitions and calculation bases for schema v2."""
from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from math import isfinite
from typing import Any, Literal

from typing_extensions import TypedDict

from planner_lib.domain.teams import UPDATE_FIELDS, RecordUpdate, TeamCatalogue, record_update


class SupplierProfile(RecordUpdate):
    """Supplier-owned monthly project hours and hourly rate."""

    id: str
    name: str
    monthly_project_hours: float
    hourly_rate: float
    archived: bool


class SupplierDefinition(RecordUpdate):
    """An internal provider or external company with reusable profiles."""

    id: str
    name: str
    external: bool
    archived: bool
    profiles: list[SupplierProfile]


class StaffingDefinition(RecordUpdate):
    """An anonymous fractional-FTE assignment to a team and supplier profile."""

    id: str
    team_id: str
    supplier_id: str
    profile_id: str
    fte: float


class WorkforceConfiguration(TypedDict):
    """Workforce schema v2 without legacy site, person or cost configurations."""

    schema_version: int
    suppliers: list[SupplierDefinition]
    staffing: list[StaffingDefinition]


class AccountingBasis(TypedDict):
    """One classification's monthly workforce calculation basis."""

    fte: float
    monthly_hours: float
    monthly_cost: float


class WorkforceBasis(TypedDict):
    """Separate internal and external bases, with no combined charged total."""

    internal: AccountingBasis
    external: AccountingBasis


class ProfileBasis(AccountingBasis):
    """A supplier/profile breakdown of a team's anonymous staffing."""

    supplier_id: str
    profile_id: str
    external: bool


class TeamBasis(WorkforceBasis):
    """A team's monthly bases and supplier/profile breakdowns."""

    profiles: list[ProfileBasis]


class WorkforceCatalogue:
    """Validated workforce snapshot keyed by persisted team/supplier/profile identities."""

    def __init__(self, config: Mapping[str, Any], teams: TeamCatalogue) -> None:
        fields = {'schema_version', 'suppliers', 'staffing'}
        candidate = self._object(config, fields, 'workforce configuration')
        if type(candidate['schema_version']) is not int or candidate['schema_version'] != 2:
            raise ValueError('Workforce configuration requires schema_version 2')
        self._teams = teams
        self._by_supplier: dict[str, SupplierDefinition] = {}
        self._by_profile: dict[tuple[str, str], SupplierProfile] = {}
        self._staffing: list[StaffingDefinition] = []
        team_kinds = {entry['id']: entry['kind'] for entry in teams.definitions()}

        for source in self._records(candidate['suppliers'], 'suppliers'):
            record = self._object(
                source, {'id', 'name', 'external', 'archived', 'profiles'}, 'supplier',
            )
            supplier_id = self._string(record, 'id', 'supplier')
            if supplier_id in self._by_supplier:
                raise ValueError(f'Duplicate supplier ID: {supplier_id}')
            supplier = SupplierDefinition(
                id=supplier_id, name=self._string(record, 'name', 'supplier'),
                external=self._boolean(record, 'external', 'supplier'),
                archived=self._boolean(record, 'archived', 'supplier'), profiles=[],
            )
            supplier.update(record_update(record))
            self._by_supplier[supplier_id] = supplier
            for source_profile in self._records(record['profiles'], 'profiles'):
                profile_record = self._object(
                    source_profile,
                    {'id', 'name', 'monthly_project_hours', 'hourly_rate', 'archived'},
                    'profile',
                )
                profile = SupplierProfile(
                    id=self._string(profile_record, 'id', 'profile'),
                    name=self._string(profile_record, 'name', 'profile'),
                    monthly_project_hours=self._quantity(profile_record, 'monthly_project_hours'),
                    hourly_rate=self._quantity(profile_record, 'hourly_rate'),
                    archived=self._boolean(profile_record, 'archived', 'profile'),
                )
                profile.update(record_update(profile_record))
                key = (supplier_id, profile['id'])
                if key in self._by_profile:
                    raise ValueError(f'Duplicate profile ID: {supplier_id}/{profile["id"]}')
                self._by_profile[key] = profile
                supplier['profiles'].append(profile)

        staffing_ids: set[str] = set()
        for source in self._records(candidate['staffing'], 'staffing'):
            record = self._object(
                source, {'id', 'team_id', 'supplier_id', 'profile_id', 'fte'}, 'staffing',
            )
            row = StaffingDefinition(
                id=self._string(record, 'id', 'staffing'),
                team_id=self._string(record, 'team_id', 'staffing'),
                supplier_id=self._string(record, 'supplier_id', 'staffing'),
                profile_id=self._string(record, 'profile_id', 'staffing'),
                fte=self._quantity(record, 'fte'),
            )
            row.update(record_update(record))
            if row['id'] in staffing_ids:
                raise ValueError(f'Duplicate staffing ID: {row["id"]}')
            staffing_ids.add(row['id'])
            if row['team_id'] not in team_kinds:
                raise ValueError(f'Unknown team {row["team_id"]} for staffing {row["id"]}')
            if team_kinds[row['team_id']] != 'team':
                raise ValueError(f'Staffing {row["id"]} allocation ID {row["team_id"]} is not a team')
            if row['supplier_id'] not in self._by_supplier:
                raise ValueError(f'Unknown supplier {row["supplier_id"]} for staffing {row["id"]}')
            if (row['supplier_id'], row['profile_id']) not in self._by_profile:
                raise ValueError(f'Unknown profile {row["profile_id"]} for staffing {row["id"]}')
            self._staffing.append(row)

    @staticmethod
    def _object(value: Any, fields: set[str], context: str) -> Mapping[str, Any]:
        if not isinstance(value, Mapping):
            raise ValueError(f'{context} must be an object')
        missing = fields - value.keys()
        allowed_updates = UPDATE_FIELDS if context in {'supplier', 'profile', 'staffing'} else set()
        unexpected = value.keys() - fields - allowed_updates
        if missing or unexpected:
            raise ValueError(
                f'Invalid {context} fields: missing {sorted(map(str, missing))}, '
                f'unexpected {sorted(map(str, unexpected))}'
            )
        return value

    @staticmethod
    def _records(value: Any, context: str) -> list[Any]:
        if not isinstance(value, list):
            raise ValueError(f'Workforce {context} must be a list')
        return value

    @staticmethod
    def _string(record: Mapping[str, Any], field: str, context: str) -> str:
        value = record[field]
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f'{context} {field} must be a nonempty string')
        if field != 'name' and value != value.strip():
            raise ValueError(f'{context} {field} must not have surrounding whitespace')
        return value

    @staticmethod
    def _boolean(record: Mapping[str, Any], field: str, context: str) -> bool:
        value = record[field]
        if type(value) is not bool:
            raise ValueError(f'{context} {field} must be a boolean')
        return value

    @staticmethod
    def _quantity(record: Mapping[str, Any], field: str) -> float:
        value = record[field]
        if type(value) not in (int, float):
            raise ValueError(f'Workforce {field} must be a finite nonnegative number')
        try:
            quantity = float(value)
        except OverflowError as error:
            raise ValueError(f'Workforce {field} must be finite') from error
        if not isfinite(quantity) or quantity < 0:
            raise ValueError(f'Workforce {field} must be a finite nonnegative number')
        return quantity

    @staticmethod
    def _empty_account() -> AccountingBasis:
        return AccountingBasis(fte=0.0, monthly_hours=0.0, monthly_cost=0.0)

    @staticmethod
    def _add_basis(target: AccountingBasis, source: AccountingBasis, identity: str) -> None:
        target['fte'] += source['fte']
        target['monthly_hours'] += source['monthly_hours']
        target['monthly_cost'] += source['monthly_cost']
        if not all(isfinite(value) for value in (
            target['fte'], target['monthly_hours'], target['monthly_cost'],
        )):
            raise ValueError(f'Workforce basis for {identity} has non-finite totals')

    def definitions(self) -> WorkforceConfiguration:
        """Return all supplier profiles and staffing, including archived references."""
        return WorkforceConfiguration(
            schema_version=2, suppliers=deepcopy(list(self._by_supplier.values())),
            staffing=deepcopy(self._staffing),
        )

    def supplier_choices(self) -> list[SupplierDefinition]:
        """Return active suppliers and their active profiles, independent of historical basis."""
        choices: list[SupplierDefinition] = []
        for supplier in self._by_supplier.values():
            if not supplier['archived']:
                choice = supplier.copy()
                choice['profiles'] = [
                    profile.copy() for profile in supplier['profiles'] if not profile['archived']
                ]
                choices.append(choice)
        return choices

    def validate_staffing_changes(self, previous: WorkforceCatalogue) -> None:
        """Reject newly assigned archives while permitting retained references and FTE edits."""
        previous_rows = {row['id']: row for row in previous._staffing}
        teams = {entry['id']: entry for entry in self._teams.definitions()}
        for row in self._staffing:
            old_row = previous_rows.get(row['id'])
            retained_team = old_row is not None and old_row['team_id'] == row['team_id']
            retained_supplier = (
                old_row is not None and old_row['supplier_id'] == row['supplier_id']
            )
            retained_profile = (
                retained_supplier and old_row is not None
                and old_row['profile_id'] == row['profile_id']
            )
            supplier = self._by_supplier[row['supplier_id']]
            profile = self._by_profile[(row['supplier_id'], row['profile_id'])]
            if teams[row['team_id']]['archived'] and not retained_team:
                raise ValueError(
                    f'Staffing {row["id"]} cannot select archived team {row["team_id"]}'
                )
            if supplier['archived'] and not retained_supplier:
                raise ValueError(
                    f'Staffing {row["id"]} cannot select archived supplier {row["supplier_id"]}'
                )
            if profile['archived'] and not retained_profile:
                raise ValueError(
                    f'Staffing {row["id"]} cannot select archived profile {row["profile_id"]}'
                )

    def team_bases(self) -> dict[str, TeamBasis]:
        """Compute separate monthly accounts and profile breakdowns for every known team."""
        bases = {
            entry['id']: TeamBasis(
                internal=self._empty_account(), external=self._empty_account(), profiles=[],
            )
            for entry in self._teams.definitions() if entry['kind'] == 'team'
        }
        profiles: dict[tuple[str, str, str], ProfileBasis] = {}
        for row in self._staffing:
            supplier = self._by_supplier[row['supplier_id']]
            profile = self._by_profile[(row['supplier_id'], row['profile_id'])]
            account: Literal['internal', 'external'] = (
                'external' if supplier['external'] else 'internal'
            )
            hours = row['fte'] * profile['monthly_project_hours']
            contribution = AccountingBasis(
                fte=row['fte'], monthly_hours=hours, monthly_cost=hours * profile['hourly_rate'],
            )
            self._add_basis(bases[row['team_id']][account], contribution, row['team_id'])
            key = (row['team_id'], row['supplier_id'], row['profile_id'])
            if key not in profiles:
                profiles[key] = ProfileBasis(
                    supplier_id=row['supplier_id'], profile_id=row['profile_id'],
                    external=supplier['external'], fte=0.0, monthly_hours=0.0, monthly_cost=0.0,
                )
                bases[row['team_id']]['profiles'].append(profiles[key])
            self._add_basis(profiles[key], contribution, row['id'])

        for basis in bases.values():
            for account_basis in (basis['internal'], basis['external']):
                account_basis['monthly_cost'] = round(account_basis['monthly_cost'], 2)
            for profile_basis in basis['profiles']:
                profile_basis['monthly_cost'] = round(profile_basis['monthly_cost'], 2)
        return bases

    def group_bases(self) -> dict[str, WorkforceBasis]:
        """Roll up member team bases separately; groups are never additional charged staffing."""
        teams = self.team_bases()
        groups: dict[str, WorkforceBasis] = {}
        for entry in self._teams.definitions():
            if entry['kind'] != 'group':
                continue
            basis = WorkforceBasis(internal=self._empty_account(), external=self._empty_account())
            for team_id in self._teams.member_team_ids(entry['id']):
                self._add_basis(basis['internal'], teams[team_id]['internal'], entry['id'])
                self._add_basis(basis['external'], teams[team_id]['external'], entry['id'])
            basis['internal']['monthly_cost'] = round(basis['internal']['monthly_cost'], 2)
            basis['external']['monthly_cost'] = round(basis['external']['monthly_cost'], 2)
            groups[entry['id']] = basis
        return groups