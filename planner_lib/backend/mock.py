"""MockFixtureBackend and MockGeneratorBackend: BackendPort wrappers for demo/test mode.

Both classes delegate to the existing AzureMockClient / AzureMockGeneratorClient
implementations (which handle fixture loading and synthetic data generation)
and wrap their output with AzureAdapter.to_domain() to produce DomainTask objects.

The existing mock clients remain as the internal implementation; these wrappers
are the new public BackendPort surface that the application composes.

Credential handling: mock backends accept any non-empty token (or no token
at all) for reads — they never contact a live ADO endpoint.  Writes are
either persisted to disk (when persist_enabled/persist_dir is set) or are
no-ops that update in-memory state only.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendCredential, BackendPort
from planner_lib.backend.adapter import AzureAdapter
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry

logger = logging.getLogger(__name__)


class _MockBackendBase(BackendPort):
    """Shared helpers for both mock backends."""

    def __init__(self, storage, team_repository=None, capacity_service=None, local_backend=None):
        self._adapter = AzureAdapter()
        self._team_repository = team_repository
        self._capacity_service = capacity_service
        self._storage = storage
        self._config = local_backend

    def _build_type_canonical(self) -> Dict[str, str]:
        type_canonical: Dict[str, str] = {}
        try:
            if self._config is not None:
                projects = self._config.fetch_projects()
                hierarchy = (projects[0].get('task_type_hierarchy') or []) if projects else []
            else:
                gs = self._storage.load('config', 'global_settings')
                hierarchy = (gs.get('task_type_hierarchy', []) if isinstance(gs, dict) else [])
            for level in hierarchy:
                for t in (level.get('types') or []):
                    type_canonical[str(t).lower()] = t
        except Exception:
            pass
        return type_canonical

    def _enrich(
        self,
        raw_items: List[dict],
        area_path: str,
        iteration_map: Dict[str, Any],
    ) -> List[DomainTask]:
        type_canonical = self._build_type_canonical()
        from planner_lib.util import slugify
        project_slug = slugify(
            area_path.split('\\')[0] if '\\' in area_path else
            area_path.split('/')[0] if '/' in area_path else area_path,
            prefix='project-',
        )
        results: List[DomainTask] = []
        for raw_wi in raw_items or []:
            try:
                task = self._adapter.to_domain(
                    raw_wi=raw_wi,
                    project_slug=project_slug,
                    team_repository=self._team_repository or _NullTeamRepository(),
                    type_canonical=type_canonical,
                    iteration_map=iteration_map,
                    capacity_service=self._capacity_service,
                )
                results.append(task)
            except Exception as exc:
                logger.warning("Mock: failed to enrich item %s: %s", raw_wi.get('id', '?'), exc)
        return results

    def invalidate_cache(self) -> Dict[str, Any]:
        return {'ok': True, 'invalidated': [], 'errors': []}


class _NullTeamRepository:
    """Fallback when no team_repository is provided — all team names map to None."""
    def name_to_id(self, name: str) -> Optional[str]:
        return None


# ---------------------------------------------------------------------------
# MockFixtureBackend
# ---------------------------------------------------------------------------

class MockFixtureBackend(_MockBackendBase):
    """Fixture-replay BackendPort — replays pre-recorded ADO SDK responses.

    Parameters
    ----------
    organization_url:
        Azure DevOps org slug (used for constructing client).
    storage:
        Disk cache StorageBackend.
    fixture_dir:
        Path to directory containing ``sdk_*.json`` fixture files.
    team_service, capacity_service:
        Optional; needed for team-name mapping and capacity parsing.
    memory_cache:
        Optional MemoryCacheManager.
    persist_enabled:
        When True, mutations from write_task() are persisted back to the
        fixture JSON files so changes survive across restarts.
    """

    FEATURE_FLAG: str = 'use_azure_mock'

    @classmethod
    def config_schema(cls) -> Dict[str, Any]:
        """JSON Schema properties for this backend's feature_flags entries."""
        return {
            'use_azure_mock': {
                'type': 'boolean',
                'title': 'Use Azure Fixture Mock',
                'description': (
                    'Replay pre-recorded Azure DevOps SDK responses from disk instead '
                    'of calling the live API. Record fixture data first with '
                    'scripts/record_azure_mock.py.'
                ),
                'default': False,
            },
            'azure_mock_data_dir': {
                'type': 'string',
                'title': 'Fixture Mock Data Directory',
                'description': 'Path to the directory containing recorded fixture files (used when use_azure_mock is true)',
                'default': 'data/azure_mock',
                'x-showWhen': 'use_azure_mock',
            },
            'azure_mock_persist_enabled': {
                'type': 'boolean',
                'title': 'Persist Fixture Mutations',
                'description': (
                    'Write every save-to-cloud mutation (dates, state, description, relations) '
                    'back to the fixture files in azure_mock_data_dir. '
                    'Allows testing write operations against anonymised fixture data.'
                ),
                'default': False,
                'x-showWhen': 'use_azure_mock',
            },
        }

    @classmethod
    def build_from_flags(cls, feature_flags: Dict[str, Any], **services: Any) -> 'MockFixtureBackend':
        """Construct a MockFixtureBackend from feature_flags and injected services."""
        return cls(
            organization_url=services.get('org_url', ''),
            storage=services['storage'],
            fixture_dir=feature_flags.get('azure_mock_data_dir', 'data/azure_mock'),
            local_backend=services.get('config_backend'),
            team_repository=services.get('team_repository'),
            capacity_service=services.get('capacity_service'),
            persist_enabled=bool(feature_flags.get('azure_mock_persist_enabled', False)),
        )

    def __init__(
        self,
        organization_url: str,
        storage,
        fixture_dir: str,
        team_repository=None,
        capacity_service=None,
        local_backend=None,
        persist_enabled: bool = False,
    ) -> None:
        super().__init__(storage, team_repository, capacity_service, local_backend)
        from planner_lib.azure.AzureMockClient import AzureMockClient
        logger.info(
            "MockFixtureBackend: initialised (fixture_dir=%r, persist_enabled=%s)",
            fixture_dir,
            persist_enabled,
        )
        self._client = AzureMockClient(
            organization_url,
            storage=storage,
            fixture_dir=fixture_dir,
            persist_enabled=persist_enabled,
        )

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
        **kwargs,
    ) -> List[DomainTask]:
        with self._client.connect('mock-pat') as client:
            raw_items = client.get_work_items(
                area_path,
                task_types=task_types,
                include_states=include_states,
            )
            iteration_map: Dict[str, Any] = {}
            try:
                azure_project = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
                iters = client.get_iterations(azure_project)
                if isinstance(iters, dict):
                    # Fixture mock returns a classification node tree dict
                    iteration_map = self._flatten_iter_tree(iters)
                elif isinstance(iters, list):
                    for it in iters:
                        norm = it.get('path', '')
                        if norm:
                            iteration_map[norm] = {'startDate': it.get('startDate'), 'finishDate': it.get('finishDate'), 'name': it.get('name')}
            except Exception:
                pass
        return self._enrich(raw_items, area_path, iteration_map)

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        """Apply updates in mock client's in-memory store."""
        errors: List[str] = []
        updated = 0
        try:
            with self._client.connect('mock-pat') as client:
                if self._adapter.has_date_update(updates):
                    client.update_work_item_dates(task_id, **self._adapter.extract_date_kwargs(updates))
                if self._adapter.has_iteration_update(updates):
                    client.update_work_item_iteration_path(task_id, updates['iterationPath'])
                if self._adapter.has_tags_update(updates):
                    client.update_work_item_tags(task_id, updates.get('tags'))
                updated = 1
        except Exception as exc:
            errors.append(str(exc))
        return WriteResult(ok=len(errors) == 0, updated=updated, errors=errors)

    def fetch_history(
        self,
        work_item_id: int,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]:
        try:
            with self._client.connect('mock-pat') as client:
                revisions = client.get_task_revision_history(
                    work_item_id=work_item_id,
                    start_field='Microsoft.VSTS.Scheduling.StartDate',
                    end_field='Microsoft.VSTS.Scheduling.TargetDate',
                    iteration_field='System.IterationPath',
                )
        except Exception:
            revisions = []
        entries: List[DomainHistoryEntry] = []
        for rev in revisions:
            changed_at = rev.get('changed_at', '')
            changed_by = rev.get('changed_by', '')
            for change in rev.get('changes', []):
                entries.append(DomainHistoryEntry(field=change.get('field', ''), value=change.get('new_value'), changed_at=changed_at, changed_by=changed_by))
        return entries

    def fetch_teams(self, project: str, credential: Optional[BackendCredential] = None) -> List[Dict[str, Any]]:
        with self._client.connect('mock-pat') as client:
            return client.get_all_teams(project)

    def fetch_plans(self, project: str, credential: Optional[BackendCredential] = None) -> List[Dict[str, Any]]:
        with self._client.connect('mock-pat') as client:
            return client.get_all_plans(project)

    def fetch_markers(self, area_path: str, plan_id: Optional[str] = None, credential: Optional[BackendCredential] = None) -> List[Dict[str, Any]]:
        return []

    def fetch_iterations(self, project: str, root_paths: Optional[List[str]] = None, credential: Optional[BackendCredential] = None) -> Dict[str, Any]:
        with self._client.connect('mock-pat') as client:
            iters = client.get_iterations(project)
        if isinstance(iters, dict):
            return self._flatten_iter_tree(iters)
        return {}

    @staticmethod
    def _flatten_iter_tree(node: dict, result: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Flatten a classification-node tree to iteration_path → {startDate, finishDate, name}."""
        if result is None:
            result = {}
        attrs = node.get('attributes')
        path = node.get('path', '')
        name = node.get('name', '')
        if attrs and path:
            import re
            norm = re.sub(r'^[^\\]+\\Iterations?\\?', '', path)
            if norm:
                result[norm] = {
                    'startDate': attrs.get('startDate'),
                    'finishDate': attrs.get('finishDate'),
                    'name': name,
                }
        for child in (node.get('children') or []):
            MockFixtureBackend._flatten_iter_tree(child, result)
        return result


# ---------------------------------------------------------------------------
# MockGeneratorBackend
# ---------------------------------------------------------------------------

class MockGeneratorBackend(_MockBackendBase):
    """Synthetic-data BackendPort — generates coherent ADO-like data from config files.

    Parameters
    ----------
    organization_url:
        Azure DevOps org slug.
    storage:
        Disk cache StorageBackend.
    data_dir:
        Root directory containing config/ sub-directory (projects.yml, teams.yml…).
    config_dict:
        Optional generator overrides (seed, n_plans, items_per_area, …).
    team_service, capacity_service:
        Optional enrichment services.
    memory_cache:
        Optional MemoryCacheManager.
    persist_dir:
        Optional path; when set, generated data is persisted as JSON fixture files.
    """

    FEATURE_FLAG: str = 'use_azure_mock_generator'

    @classmethod
    def config_schema(cls) -> Dict[str, Any]:
        """JSON Schema properties for this backend's feature_flags entries."""
        return {
            'use_azure_mock_generator': {
                'type': 'boolean',
                'title': 'Use Azure Synthetic Data Generator',
                'description': (
                    'Generate a coherent synthetic dataset from config files instead of '
                    'calling the live API (takes priority over use_azure_mock).'
                ),
                'default': False,
            },
            'generator_persist_enabled': {
                'type': 'boolean',
                'title': 'Persist Generated Data',
                'description': (
                    'Write the generated dataset to disk and persist every save-to-cloud mutation. '
                    'Requires a fixed seed (generator_config.seed) for reproducible results. '
                    'Uses generator_persist_dir as the target; defaults to data/azure_mock_generated when not set.'
                ),
                'default': False,
                'x-showWhen': 'use_azure_mock_generator',
            },
            'generator_persist_dir': {
                'type': 'string',
                'title': 'Generator Persist Directory',
                'description': 'Directory for persisted fixture files (defaults to data/azure_mock_generated when generator_persist_enabled is true)',
                'x-showWhen': 'generator_persist_enabled',
            },
            'generator_config': {
                'type': 'object',
                'title': 'Synthetic Generator Configuration',
                'description': 'Fine-grained control over the synthetic data generator (used when use_azure_mock_generator is true)',
                'x-showWhen': 'use_azure_mock_generator',
                'properties': {
                    'seed': {
                        'type': 'integer',
                        'title': 'Random Seed',
                        'description': 'Fix the seed for reproducible datasets; omit for a random dataset each run',
                    },
                    'n_plans': {
                        'type': 'integer',
                        'title': 'Number of Plans',
                        'default': 6,
                        'minimum': 1,
                    },
                    'default_items_per_area': {
                        'type': 'integer',
                        'title': 'Default Items per Area Path',
                        'default': 20,
                        'minimum': 1,
                    },
                    'n_pis': {
                        'type': 'integer',
                        'title': 'Number of Program Increments',
                        'default': 6,
                        'minimum': 1,
                    },
                    'sprints_per_pi': {
                        'type': 'integer',
                        'title': 'Sprints per PI',
                        'default': 4,
                        'minimum': 1,
                    },
                    'revisions_min': {
                        'type': 'integer',
                        'title': 'Minimum Revisions per Item',
                        'default': 2,
                        'minimum': 1,
                    },
                    'revisions_max': {
                        'type': 'integer',
                        'title': 'Maximum Revisions per Item',
                        'default': 12,
                        'minimum': 1,
                    },
                    'people_per_team': {
                        'type': 'integer',
                        'title': 'People per Team (fallback)',
                        'description': 'Used when no people.yml is available',
                        'default': 7,
                        'minimum': 1,
                    },
                },
                'additionalProperties': True,
            },
        }

    @classmethod
    def build_from_flags(cls, feature_flags: Dict[str, Any], **services: Any) -> 'MockGeneratorBackend':
        """Construct a MockGeneratorBackend from feature_flags and injected services."""
        data_dir = feature_flags.get('data_dir', 'data')
        cfg_dict = dict(feature_flags.get('generator_config') or {})
        persist_dir = feature_flags.get('generator_persist_dir') or cfg_dict.pop('persist_dir', None)
        if not persist_dir and feature_flags.get('generator_persist_enabled', False):
            persist_dir = f"{data_dir}/azure_mock_generated"
        return cls(
            organization_url=services.get('org_url', ''),
            storage=services['storage'],
            data_dir=data_dir,
            config_dict=cfg_dict or None,
            local_backend=services.get('config_backend'),
            team_repository=services.get('team_repository'),
            capacity_service=services.get('capacity_service'),
            persist_dir=persist_dir,
        )

    def __init__(
        self,
        organization_url: str,
        storage,
        data_dir: str = 'data',
        config_dict: Optional[dict] = None,
        team_repository=None,
        capacity_service=None,
        local_backend=None,
        persist_dir: Optional[str] = None,
    ) -> None:
        super().__init__(storage, team_repository, capacity_service, local_backend)
        from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
        logger.info(
            "MockGeneratorBackend: initialised (data_dir=%r, persist_dir=%r)",
            data_dir,
            persist_dir,
        )
        self._client = AzureMockGeneratorClient(
            organization_url,
            storage=storage,
            data_dir=data_dir,
            config_dict=config_dict,
            persist_dir=persist_dir,
        )

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
        **kwargs,
    ) -> List[DomainTask]:
        with self._client.connect('mock-pat') as client:
            raw_items = client.get_work_items(
                area_path,
                task_types=task_types,
                include_states=include_states,
            )
            iteration_map: Dict[str, Any] = {}
            try:
                azure_project = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
                # Generator returns a classification-node tree dict
                tree = client.get_iterations(azure_project)
                if isinstance(tree, dict):
                    iteration_map = MockFixtureBackend._flatten_iter_tree(tree)
            except Exception:
                pass
        return self._enrich(raw_items, area_path, iteration_map)

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        errors: List[str] = []
        updated = 0
        try:
            with self._client.connect('mock-pat') as client:
                if self._adapter.has_date_update(updates):
                    client.update_work_item_dates(task_id, **self._adapter.extract_date_kwargs(updates))
                if self._adapter.has_iteration_update(updates):
                    client.update_work_item_iteration_path(task_id, updates['iterationPath'])
                if self._adapter.has_tags_update(updates):
                    client.update_work_item_tags(task_id, updates.get('tags'))
                updated = 1
        except Exception as exc:
            errors.append(str(exc))
        return WriteResult(ok=len(errors) == 0, updated=updated, errors=errors)

    def fetch_history(
        self,
        work_item_id: int,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]:
        try:
            with self._client.connect('mock-pat') as client:
                revisions = client.get_task_revision_history(
                    work_item_id=work_item_id,
                    start_field='Microsoft.VSTS.Scheduling.StartDate',
                    end_field='Microsoft.VSTS.Scheduling.TargetDate',
                    iteration_field='System.IterationPath',
                )
        except Exception:
            revisions = []
        entries: List[DomainHistoryEntry] = []
        for rev in revisions:
            changed_at = rev.get('changed_at', '')
            changed_by = rev.get('changed_by', '')
            for change in rev.get('changes', []):
                entries.append(DomainHistoryEntry(field=change.get('field', ''), value=change.get('new_value'), changed_at=changed_at, changed_by=changed_by))
        return entries

    def fetch_teams(self, project: str, credential: Optional[BackendCredential] = None) -> List[Dict[str, Any]]:
        with self._client.connect('mock-pat') as client:
            return client.get_all_teams(project)

    def fetch_plans(self, project: str, credential: Optional[BackendCredential] = None) -> List[Dict[str, Any]]:
        with self._client.connect('mock-pat') as client:
            return client.get_all_plans(project)

    def fetch_markers(self, area_path: str, plan_id: Optional[str] = None, credential: Optional[BackendCredential] = None) -> List[Dict[str, Any]]:
        return []

    def fetch_iterations(self, project: str, root_paths: Optional[List[str]] = None, credential: Optional[BackendCredential] = None) -> Dict[str, Any]:
        with self._client.connect('mock-pat') as client:
            tree = client.get_iterations(project)
        if isinstance(tree, dict):
            return MockFixtureBackend._flatten_iter_tree(tree)
        return {}
