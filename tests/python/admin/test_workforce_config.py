"""Transactional configuration contracts for canonical workforce administration."""
from concurrent.futures import ThreadPoolExecutor
from base64 import b32decode
from copy import deepcopy
from pathlib import Path
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock
from typing import cast
from datetime import datetime, timezone

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planner_lib.accounts.constants import AccountPermissions
from planner_lib.admin import api as admin_api
from planner_lib.admin.config_manager import ConfigManager
from planner_lib.admin.service import AdminService
from planner_lib.admin.workforce_service import WorkforceAdminService
from planner_lib.admin.workforce_graphs import retained_allocation_graphs
from planner_lib.admin.workforce_config import (
    DefinitionKind, WorkforceConfigManager, WorkforceConflictError,
)
from planner_lib.storage.diskcache_backend import DiskCacheStorage
from planner_lib.middleware.session import SESSION_COOKIE, SessionManager, SessionMiddleware
from planner_lib.migrations.contracts import TARGET_REVISION


def test_workforce_transfer_round_trip_preserves_identity_and_dates(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    before = manager.read_snapshot()
    document = transfer.export_document()
    assert set(document) == {'format', 'version', 'teams', 'workforce'}
    assert document['teams'] == before['teams']
    assert document['workforce'] == before['workforce']
    preview = transfer.preview(document, {})
    assert preview['ready'] is True
    assert all(record['status'] == 'identical' for record in preview['records'])
    after = transfer.commit(document, {}, before['revision'], preview['review_revision'])
    assert after == before


def test_workforce_transfer_conflicts_require_explicit_skip_or_overwrite(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    before = manager.read_snapshot()
    document = transfer.export_document()
    document['teams']['teams'][0]['name'] = 'Imported team'
    preview = transfer.preview(document, {})
    assert preview['ready'] is False
    assert next(row for row in preview['records'] if row['id'] == 'team-one')['status'] == 'conflict'
    with pytest.raises(ValueError, match='decision'):
        transfer.commit(document, {}, before['revision'], preview['review_revision'])
    decisions = {'team-one': 'skip'}
    skipped = transfer.preview(document, decisions)
    assert transfer.commit(document, decisions, before['revision'], skipped['review_revision']) == before
    decisions = {'team-one': 'overwrite'}
    overwritten = transfer.preview(document, decisions)
    after = transfer.commit(document, decisions, before['revision'], overwritten['review_revision'])
    assert after['teams']['teams'][0] == document['teams']['teams'][0]
    assert after['workforce'] == before['workforce']


def test_workforce_transfer_adds_without_removing_destination_records(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    before = manager.read_snapshot()
    document = transfer.export_document()
    incoming = deepcopy(document['teams']['teams'][0])
    incoming.update(id='imported-team', allocation_token='IMPORTED', name='Imported team')
    document['teams']['teams'] = [incoming]
    document['teams']['groups'] = []
    document['workforce'] = {'schema_version': 2, 'suppliers': [], 'staffing': []}
    preview = transfer.preview(document, {})
    after = transfer.commit(document, {}, before['revision'], preview['review_revision'])
    assert after['teams']['teams'] == [*before['teams']['teams'], incoming]
    assert after['workforce'] == before['workforce']


def test_workforce_transfer_rejects_stale_confirmation(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    before = manager.read_snapshot()
    document = transfer.export_document()
    preview = transfer.preview(document, {})
    document['teams']['teams'][0]['name'] = 'Changed after review'
    with pytest.raises(WorkforceConflictError, match='review'):
        transfer.commit(document, {}, before['revision'], preview['review_revision'])
    assert manager.read_snapshot() == before


def test_workforce_transfer_into_empty_store_preserves_archived_graph_and_dates(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer, parse_document

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    document['teams']['teams'][0].update(
        archived=True, group_id='group-old', last_updated='2025-01-02T03:04:05Z',
    )
    document['workforce']['staffing'][0]['profile_id'] = 'retired'
    document['workforce']['suppliers'][0]['archived'] = True
    manager._storage.save('config', 'teams', {'schema_version': 3, 'teams': [], 'groups': []})
    manager._storage.save('config', 'workforce', {'schema_version': 2, 'suppliers': [], 'staffing': []})
    document = parse_document(yaml.safe_dump(document))
    before = manager.read_snapshot()
    preview = transfer.preview(document, {})
    assert preview['ready'] is True
    after = transfer.commit(document, {}, before['revision'], preview['review_revision'])
    assert after['teams'] == document['teams']
    assert after['workforce'] == document['workforce']


def test_workforce_transfer_token_collision_can_only_be_skipped(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    document['teams']['teams'][0]['id'] = 'other-team'
    document['teams']['teams'][0]['allocation_token'] = ' one '
    document['workforce']['staffing'] = []
    before = manager.read_snapshot()
    preview = transfer.preview(document, {})
    row = next(row for row in preview['records'] if row['id'] == 'other-team')
    assert row['status'] == 'conflict'
    assert row['structural'] is True
    with pytest.raises(ValueError, match='Cannot overwrite'):
        transfer.preview(document, {'other-team': 'overwrite'})
    decisions = {'other-team': 'skip'}
    preview = transfer.preview(document, decisions)
    after = transfer.commit(document, decisions, before['revision'], preview['review_revision'])
    assert after == before


def test_workforce_transfer_merges_nested_profiles_without_removing_local_profiles(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    profile = document['workforce']['suppliers'][0]['profiles'][0]
    profile.update(hourly_rate=99, last_updated='2025-01-01T00:00:00Z')
    document['workforce']['suppliers'][0]['profiles'] = [profile]
    before = manager.read_snapshot()
    decisions = {'standard': 'overwrite'}
    preview = transfer.preview(document, decisions)
    assert next(row for row in preview['records'] if row['id'] == 'supplier-one')['status'] == 'identical'
    after = transfer.commit(document, decisions, before['revision'], preview['review_revision'])
    assert after['workforce']['suppliers'][0]['profiles'] == [
        profile, before['workforce']['suppliers'][0]['profiles'][1],
    ]


def test_workforce_transfer_can_skip_new_dependents_of_a_conflicting_team(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    document['teams']['teams'][0]['id'] = 'imported-team'
    document['workforce']['staffing'][0].update(id='imported-staffing', team_id='imported-team')
    before = manager.read_snapshot()
    decisions = {'imported-team': 'skip'}
    preview = transfer.preview(document, decisions)
    assert preview['ready'] is False
    assert any('Unknown team' in error for error in preview['errors'])
    decisions['imported-staffing'] = 'skip'
    preview = transfer.preview(document, decisions)
    assert preview['ready'] is True
    assert transfer.commit(document, decisions, before['revision'], preview['review_revision']) == before


@pytest.mark.parametrize('path', ['/import/preview', '/import'])
def test_workforce_transfer_rejects_cross_site_writes(
    manager: WorkforceConfigManager, workforce_client: TestClient, path: str,
) -> None:
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce' + path, json={},
                                     headers={'Origin': 'https://other.example.test'})
    assert response.status_code == 403
    assert manager.read_snapshot() == before


@pytest.mark.parametrize('field,value', [('version', 9), ('version', True), ('format', 'other'),
                                        ('accounts', {})])
def test_workforce_transfer_rejects_unknown_envelopes(
    manager: WorkforceConfigManager, field: str, value: object,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    document[field] = value
    with pytest.raises(ValueError):
        transfer.preview(document, {})


def test_workforce_transfer_reference_changes_invalidate_review(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    before = manager.read_snapshot()
    preview = transfer.preview(document, {})
    manager._storage.save('views', 'new-view', {'teams': ['team-one']})
    with pytest.raises(WorkforceConflictError, match='review'):
        transfer.commit(document, {}, before['revision'], preview['review_revision'])
    assert manager.read_snapshot() == before


def test_workforce_transfer_rejects_membership_conflict_and_preserves_references(
    manager: WorkforceConfigManager,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    document['teams']['teams'][0]['group_id'] = 'group-one'
    task = {'id': 'task', 'capacity': [
        {'team': 'team-one', 'capacity': 20}, {'team': 'group-one', 'capacity': 30},
    ]}
    manager._storage.save('backend_domain', 'fetch_task_context__test', [task])
    before = manager.read_snapshot()
    decisions = {'team-one': 'overwrite'}
    preview = transfer.preview(document, decisions)
    assert preview['ready'] is False
    assert any('Allocation conflict' in error for error in preview['errors'])
    with pytest.raises(ValueError, match='Allocation conflict'):
        transfer.commit(document, decisions, before['revision'], preview['review_revision'])
    assert manager.read_snapshot() == before
    assert manager._storage.load('backend_domain', 'fetch_task_context__test') == [task]


def test_workforce_transfer_atomic_rollback_on_second_write_failure(
    manager: WorkforceConfigManager, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from planner_lib.admin.workforce_transfer import WorkforceTransfer

    transfer = WorkforceTransfer(manager)
    document = transfer.export_document()
    document['teams']['teams'][0]['name'] = 'Imported team'
    document['workforce']['staffing'][0]['fte'] = 0.5
    before = manager.read_snapshot()
    decisions = {'team-one': 'overwrite', 'row-one': 'overwrite'}
    preview = transfer.preview(document, decisions)
    original = manager._configs.save_config

    def failing_save(key: str, value: dict) -> None:
        if key == 'workforce':
            raise RuntimeError('injected write failure')
        original(key, value)

    monkeypatch.setattr(manager._configs, 'save_config', failing_save)
    with pytest.raises(RuntimeError, match='injected'):
        transfer.commit(document, decisions, before['revision'], preview['review_revision'])
    assert manager.read_snapshot() == before


@pytest.mark.parametrize('source', [
    'version: 1\nversion: 2', 'key: &anchor []\ncopy: *anchor', '[]',
    '!!python/object:builtins.object {}', 'null', '1: value',
    'key: ' + '[' * 40 + '0' + ']' * 40,
])
def test_workforce_transfer_rejects_unsafe_yaml(source: str) -> None:
    from planner_lib.admin.workforce_transfer import parse_document

    with pytest.raises(ValueError):
        parse_document(source)


def test_workforce_transfer_rejects_oversize_file() -> None:
    from planner_lib.admin.workforce_transfer import MAX_TRANSFER_BYTES, parse_document

    with pytest.raises(ValueError, match='2 MiB'):
        parse_document(' ' * (MAX_TRANSFER_BYTES + 1))


def test_workforce_transfer_http_export_preview_and_commit(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    manager._storage.save('config', 'ado_config', {'pat': 'private-fixture-secret'})
    before = manager.read_snapshot()
    response = workforce_client.get('/admin/v1/workforce/export')
    assert response.status_code == 200
    exported = response.json()['content']
    assert exported['filename'] == 'planner-workforce.yaml'
    assert 'private-fixture-secret' not in exported['source']
    document = yaml.safe_load(exported['source'])
    document['teams']['teams'][0]['name'] = 'HTTP imported'
    payload = {'source': yaml.safe_dump(document), 'decisions': {'team-one': 'overwrite'}}
    response = workforce_client.post('/admin/v1/workforce/import/preview', json=payload)
    assert response.status_code == 200
    preview = response.json()['content']
    assert preview['ready'] is True
    assert manager.read_snapshot() == before
    response = workforce_client.post('/admin/v1/workforce/import', json={
        **payload, 'revision': preview['revision'], 'review_revision': preview['review_revision'],
    })
    assert response.status_code == 200
    assert response.json()['content']['teams']['teams'][0]['name'] == 'HTTP imported'
    assert response.json()['content']['teams']['teams'][0]['allocation_token'] == 'ONE'
    assert manager._storage.load('config', 'ado_config') == {'pat': 'private-fixture-secret'}


@pytest.mark.parametrize('path', ['/export', '/import/preview', '/import'])
def test_workforce_transfer_http_requires_admin(workforce_client: TestClient, path: str) -> None:
    workforce_client.cookies.set(SESSION_COOKIE, workforce_client.app.state.member_session)
    response = (workforce_client.get('/admin/v1/workforce' + path) if path == '/export'
                else workforce_client.post('/admin/v1/workforce' + path, json={}))
    assert response.status_code == 401


@pytest.mark.parametrize('payload', [
    {}, {'source': '[]', 'decisions': {}}, {'source': 'version: 9', 'decisions': {}},
    {'source': 'version: 1\nversion: 2', 'decisions': {}},
    {'source': 'null', 'decisions': {}}, {'source': 'key: value', 'decisions': []},
])
def test_workforce_transfer_http_invalid_file_never_writes(
    manager: WorkforceConfigManager, workforce_client: TestClient, payload: dict,
) -> None:
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce/import/preview', json=payload)
    assert response.status_code in (400, 422)
    assert manager.read_snapshot() == before


def test_admin_routes_expose_workforce_without_legacy_configuration_endpoints() -> None:
    """People, cost configuration and team editing belong exclusively to workforce."""
    paths = {route.path for route in admin_api.router.routes}
    assert '/admin/v1/workforce' in paths
    assert not paths.intersection({
        '/admin/v1/people', '/admin/v1/people/inspect',
        '/admin/v1/cost', '/admin/v1/cost/inspect', '/admin/v1/teams',
    })


@pytest.mark.parametrize('revision', [None, -1, True, '38'])
def test_system_restore_requires_compatible_revision_before_writing(
    manager: WorkforceConfigManager, workforce_client: TestClient, revision: object,
) -> None:
    before = manager.read_snapshot()
    payload = {'config': {'server_config': {'server_name': 'must-not-write'}}}
    if revision is not None:
        payload['schema_revision'] = revision
    for path in ('/admin/v1/restore/validate', '/admin/v1/restore'):
        response = workforce_client.post(path, json=payload)
        assert response.status_code == 400
        assert 'schema' in response.json()['detail']['message']
        assert manager.read_snapshot() == before
        assert not manager._storage.exists('config', 'server_config')


def test_system_restore_compatibility_preflight_is_read_only(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    from planner_lib.migrations.contracts import TARGET_REVISION

    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/restore/validate', json={
        'schema_revision': TARGET_REVISION, 'config': {'server_config': {'server_name': 'Preview'}},
    })
    assert response.status_code == 200
    assert response.json() == {'ok': True, 'schema_revision': TARGET_REVISION}
    assert manager.read_snapshot() == before
    assert not manager._storage.exists('config', 'server_config')


def test_configuration_transaction_rolls_back_all_writes(tmp_path: Path) -> None:
    """A failed operation cannot leave teams and workforce at different revisions."""
    storage = DiskCacheStorage(tmp_path / 'config')
    try:
        storage.save('config', 'teams', {'original': 'teams'})
        storage.save('config', 'workforce', {'original': 'workforce'})
        with pytest.raises(RuntimeError, match='rollback'):
            with storage.transaction():
                storage.save('config', 'teams', {'changed': 'teams'})
                storage.save('config', 'workforce', {'changed': 'workforce'})
                raise RuntimeError('rollback')
        assert storage.load('config', 'teams') == {'original': 'teams'}
        assert storage.load('config', 'workforce') == {'original': 'workforce'}
    finally:
        storage.close()


def test_configuration_transaction_serializes_independent_writers(tmp_path: Path) -> None:
    """Independent storage instances must not lose concurrent read/modify/write updates."""
    first = DiskCacheStorage(tmp_path / 'config')
    second = DiskCacheStorage(tmp_path / 'config')
    try:
        first.save('config', 'counter', 0)

        def increment(index: int) -> None:
            storage = first if index % 2 == 0 else second
            with storage.transaction():
                value = storage.load('config', 'counter')
                storage.save('config', 'counter', value + 1)

        with ThreadPoolExecutor(max_workers=8) as workers:
            list(workers.map(increment, range(24)))
        assert first.load('config', 'counter') == 24
    finally:
        first.close()
        second.close()


@pytest.mark.parametrize('staffed', [True, False])
def test_migration_incomplete_team_requires_explicit_review_before_restore(
    manager: WorkforceConfigManager, staffed: bool,
) -> None:
    """Incomplete migrated identities retain staffing but cannot become active before review."""
    source = manager.read_snapshot()
    record = cast(dict, source['teams']['teams'][0])
    record['archived'] = True
    record['migration_incomplete'] = True
    if not staffed:
        source['workforce']['staffing'] = []
        manager._storage.save('config', 'workforce', source['workforce'])
    manager._storage.save('config', 'teams', source['teams'])
    before = manager.read_snapshot()
    assert before['teams']['teams'][0]['migration_incomplete'] is True
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['archived'] = False
    with pytest.raises(ValueError, match='review'):
        manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert manager.read_snapshot() == before
    candidate['teams']['teams'][0]['migration_incomplete'] = False
    candidate['teams']['teams'][0]['name'] = 'Reviewed team'
    after = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert after['teams']['teams'][0]['id'] == 'team-one'
    assert after['teams']['teams'][0]['allocation_token'] == 'ONE'
    assert after['workforce'] == before['workforce']


@pytest.mark.parametrize('staffed', [True, False])
def test_confirmed_team_deletion_removes_only_identity_and_owned_staffing(
    manager: WorkforceConfigManager, staffed: bool,
) -> None:
    """Deletion is a distinct operation, retaining shared profiles and dating its group."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['group_id'] = 'group-one'
    if not staffed:
        candidate['workforce']['staffing'] = []
    before = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    review = manager.review_team_deletion('team-one', task_storage=manager._storage)
    after = manager.delete_team('team-one', before['revision'], acknowledged=True,
                                review_revision=review['review_revision'], task_storage=manager._storage)
    assert after['teams']['teams'] == []
    assert after['workforce']['staffing'] == []
    assert after['workforce']['suppliers'] == before['workforce']['suppliers']
    assert after['teams']['groups'][0]['last_updated'] != before['teams']['groups'][0]['last_updated']
    assert after['revision'] != before['revision']
    assert manager.read_snapshot() == after


@pytest.mark.parametrize('source', ['baseline', 'scenario'])
@pytest.mark.parametrize('kind', ['same-item', 'descendant-group'])
def test_http_membership_change_rejects_retained_allocation_conflicts(
    manager: WorkforceConfigManager, workforce_client: TestClient, source: str, kind: str,
) -> None:
    """Membership cannot introduce overlapping retained baseline or scenario reservations."""
    root = {'id': 'root', 'start': '2025-01-01', 'end': '2025-01-31',
            'capacity': [{'team': 'team-one', 'capacity': 40}]}
    leaf = {'id': 'leaf', 'parentId': 'root', 'start': '2025-01-06', 'end': '2025-01-10',
            'capacity': []}
    target = root if kind == 'same-item' else leaf
    proposed = [*target['capacity'], {'team': 'group-one', 'capacity': 20}]
    if source == 'baseline':
        target['capacity'] = proposed
    else:
        manager._storage.save('scenarios', 'scenario-one', {
            'overrides': {
                'absent-task': {'capacity': proposed},
                target['id']: {'capacity': proposed},
            },
        })
    manager._storage.save('backend_domain', 'fetch_task_context__forest', [root, leaf])
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['group_id'] = 'group-one'
    response = workforce_client.post('/admin/v1/workforce', json=candidate)
    assert response.status_code == 422
    assert kind in response.json()['detail']['message']
    assert 'team-one' in response.json()['detail']['message']
    assert manager.read_snapshot() == before


@pytest.mark.parametrize('override', [
    {'capacity': [{'team': 'team-one', 'capacity': 40}]},
    {'start': '2026-04-20'},
    {'end': '2026-05-15'},
    {'parentId': 'root'},
    {'relations': [{'type': 'Parent', 'id': 'root'}]},
])
def test_http_membership_change_preserves_overrides_for_absent_tasks(
    manager: WorkforceConfigManager, workforce_client: TestClient, override: dict,
) -> None:
    """Historical overrides remain stored without inventing tasks in the effective graph."""
    task = {'id': 'root', 'revision': 2, 'capacity': []}
    scenario = {'overrides': {'688188': override}}
    manager._storage.save('backend_domain', 'fetch_task_context__forest', [task])
    manager._storage.save('scenarios', 'scenario-one', scenario)
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['group_id'] = 'group-one'
    response = workforce_client.post('/admin/v1/workforce', json=candidate)
    assert response.status_code == 200
    assert manager.read_snapshot()['teams']['teams'][0]['group_id'] == 'group-one'
    assert manager._storage.load('scenarios', 'scenario-one') == scenario
    assert manager._storage.load('backend_domain', 'fetch_task_context__forest') == [task]
    assert retained_allocation_graphs(manager._storage, manager._storage) == {
        'baseline': [task], 'scenario:scenario-one': [task],
    }


@pytest.mark.parametrize('state_category, expected_status', [('Removed', 200), ('InProgress', 422)])
def test_http_membership_change_uses_latest_backend_state(
    manager: WorkforceConfigManager, workforce_client: TestClient,
    state_category: str, expected_status: int,
) -> None:
    """Latest backend removal suppresses reservations without rewriting scenario history."""
    task = {'id': 'root', 'revision': 1, 'stateCategory': 'InProgress', 'capacity': []}
    newest = dict(task, revision=2, stateCategory=state_category)
    scenario = {'overrides': {'root': {'capacity': [
        {'team': 'team-one', 'capacity': 40}, {'team': 'group-one', 'capacity': 20},
    ]}}}
    manager._storage.save('backend_domain', 'fetch_plan_tasks__old', [task])
    manager._storage.save('backend_domain', 'fetch_task_context__new', [newest])
    manager._storage.save('scenarios', 'scenario-one', scenario)
    candidate = manager.read_snapshot()
    candidate['teams']['teams'][0]['group_id'] = 'group-one'
    response = workforce_client.post('/admin/v1/workforce', json=candidate)
    assert response.status_code == expected_status
    assert manager._storage.load('scenarios', 'scenario-one') == scenario


def test_membership_validation_uses_newest_tasks_without_private_metadata(
    manager: WorkforceConfigManager,
) -> None:
    """Older cache snapshots and opaque backend fields cannot control the effective graph."""
    task = {'id': 'root', 'revision': 1, 'start': '2025-01-01', 'end': '2025-01-31',
            'capacity': [{'team': 'team-one', 'capacity': 40}, {'team': 'group-one', 'capacity': 20}]}
    manager._storage.save('backend_domain', 'fetch_tasks__old', [task])
    newest = dict(task, revision=2, capacity=[{'team': 'team-one', 'capacity': 40}],
                  backendData={'capacity': task['capacity']})
    manager._storage.save('backend_domain', 'fetch_task_context__new', [newest])
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['group_id'] = 'group-one'
    after = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert after['teams']['teams'][0]['group_id'] == 'group-one'
    assert manager._storage.load('backend_domain', 'fetch_task_context__new') == [newest]


@pytest.mark.parametrize('enriched_first', [False, True])
def test_membership_validation_merges_same_revision_context_enrichment(
    manager: WorkforceConfigManager, enriched_first: bool,
) -> None:
    """Context-only fields do not turn identical upstream revisions into conflicts."""
    task = {'id': '751031', 'revision': 19, 'capacity': [],
            'start': '2026-04-20', 'end': '2026-05-15', 'parentId': None,
            'relations': [], 'type': 'Feature'}
    enriched = dict(task, stateCategory='Completed', traversalBoundary=False,
                    excludedChildIds=[])
    first, second = (enriched, task) if enriched_first else (task, enriched)
    manager._storage.save('backend_domain', 'fetch_plan_tasks__first', [first])
    manager._storage.save('backend_domain', 'fetch_task_context__second', [second])
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['group_id'] = 'group-one'
    after = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert after['teams']['teams'][0]['group_id'] == 'group-one'
    assert manager._storage.load('backend_domain', 'fetch_plan_tasks__first') == [first]
    assert manager._storage.load('backend_domain', 'fetch_task_context__second') == [second]
    assert retained_allocation_graphs(manager._storage, manager._storage)['baseline'] == [enriched]


@pytest.mark.parametrize('changes', [
    {'capacity': [{'team': 'team-one', 'capacity': 40}]},
    {'end': '2026-05-16'},
    {'parentId': 'another-root'},
    {'stateCategory': 'InProgress'},
    {'traversalBoundary': True},
    {'excludedChildIds': ['child']},
])
def test_membership_validation_rejects_contradictory_same_revision_snapshots(
    manager: WorkforceConfigManager, changes: dict,
) -> None:
    """Complementary enrichment must not hide contradictory retained task evidence."""
    task = {'id': '751031', 'revision': 19, 'capacity': [], 'end': '2026-05-15',
            'parentId': None, 'stateCategory': 'Completed', 'traversalBoundary': False,
            'excludedChildIds': []}
    manager._storage.save('backend_domain', 'fetch_plan_tasks__first', [task])
    manager._storage.save('backend_domain', 'fetch_task_context__second', [dict(task, **changes)])
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['group_id'] = 'group-one'
    with pytest.raises(ValueError, match='Conflicting retained task snapshots.*751031'):
        manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert manager.read_snapshot() == before


def test_membership_edit_keeps_task_transaction_held_through_persistence(
    manager: WorkforceConfigManager, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Do not release reviewed task evidence before the configuration writes are made."""
    remote = DiskCacheStorage(tmp_path / 'separate-graph-cache')
    manager._task_storage = remote
    locked = False
    transaction = remote.transaction
    save = manager._storage.save

    @contextmanager
    def tracked_transaction() -> Iterator[None]:
        nonlocal locked
        with transaction():
            locked = True
            try:
                yield
            finally:
                locked = False

    def checked_save(namespace: str, key: str, value: object) -> None:
        if namespace == 'config' and key == 'teams':
            assert locked, 'Task evidence transaction released before configuration persistence'
        save(namespace, key, value)

    monkeypatch.setattr(remote, 'transaction', tracked_transaction)
    monkeypatch.setattr(manager._storage, 'save', checked_save)
    try:
        before = manager.read_snapshot()
        candidate = deepcopy(before)
        candidate['teams']['teams'][0]['group_id'] = 'group-one'
        manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    finally:
        remote.close()


@pytest.mark.parametrize('acknowledged', [False, None, 'true', 1])
def test_team_deletion_requires_explicit_boolean_acknowledgement(
    manager: WorkforceConfigManager, acknowledged: object,
) -> None:
    """The destructive historical-calculation acknowledgement cannot be coerced."""
    before = manager.read_snapshot()
    with pytest.raises(ValueError, match='acknowledgement'):
        manager.delete_team('team-one', before['revision'], acknowledged=cast(bool, acknowledged),
                    review_revision='unconfirmed', task_storage=manager._storage)
    assert manager.read_snapshot() == before


def test_team_deletion_rejects_stale_revision_and_group_identity(
    manager: WorkforceConfigManager,
) -> None:
    """A changed snapshot or a group cannot be deleted through the team operation."""
    before = manager.read_snapshot()
    with pytest.raises(WorkforceConflictError):
        manager.delete_team('team-one', 'stale', acknowledged=True,
                    review_revision='unconfirmed', task_storage=manager._storage)
    with pytest.raises(ValueError, match='Unknown team'):
        manager.delete_team('group-one', before['revision'], acknowledged=True,
                    review_revision='unconfirmed', task_storage=manager._storage)
    assert manager.read_snapshot() == before


def test_team_deletion_review_preserves_tasks_scenarios_views_and_reports_changes(
    manager: WorkforceConfigManager,
) -> None:
    """Preview covers retained references, and confirmation rewrites owned availability only."""
    storage = manager._storage
    projects = {'allocation_defaults': {'project': ['team-one', 'group-one']},
                'projects': [{'id': 'plan', 'allocatable_ids': ['team-one']}], 'name': 'Keep'}
    scenario = {'overrides': {'task': {'capacity': [{'team': 'team-one', 'capacity': 25}]}},
                'view': {'teams': ['team-one']}}
    view = {'teams': ['team-one', 'group-one'], 'name': 'Keep view'}
    tasks = [{'id': 'task', 'capacity': [{'team': 'team-one', 'capacity': 50}],
              'backendData': {'team': 'team-one'}}]
    for namespace, key, payload in [('config', 'projects', projects),
                                    ('scenarios', 'account_scenario', scenario),
                                    ('views', 'account_view', view),
                                    ('backend_domain', 'fetch_task_context__fixture', tasks)]:
        storage.save(namespace, key, payload)
    before = manager.read_snapshot()
    review = manager.review_team_deletion('team-one', task_storage=storage)
    assert review['revision'] == before['revision']
    assert len(review['availability']) == 2
    assert len(review['retained_allocations']) == 2
    assert {entry['record_id'] for entry in review['retained_allocations']} == {'task'}
    assert len(review['saved_selections']) == 2
    assert [row['id'] for row in review['staffing']] == ['row-one']
    assert review['coverage']['historically_complete'] is False
    assert storage.load('config', 'projects') == projects
    manager.delete_team('team-one', before['revision'], acknowledged=True,
                        review_revision=review['review_revision'], task_storage=storage)
    assert storage.load('config', 'projects') == {
        'allocation_defaults': {'project': ['group-one']},
        'projects': [{'id': 'plan', 'allocatable_ids': []}], 'name': 'Keep',
    }
    assert storage.load('scenarios', 'account_scenario') == scenario
    assert storage.load('views', 'account_view') == view
    assert storage.load('backend_domain', 'fetch_task_context__fixture') == tasks


@pytest.mark.parametrize('selected_teams,expected_count', [
    ({'team-one': True, 'group-one': False}, 1),
    ({'team-one': False, 'group-one': True}, 0),
    ({}, 0),
])
def test_team_deletion_preserves_saved_view_selection_maps(
    manager: WorkforceConfigManager, selected_teams: dict[str, bool], expected_count: int,
) -> None:
    """Saved views use boolean selection maps, including when embedded in scenarios."""
    storage = manager._storage
    view = {'name': 'Saved view', 'selectedTeams': selected_teams}
    scenario = {'view': deepcopy(view), 'overrides': {}}
    storage.save('views', 'account_view', view)
    storage.save('scenarios', 'account_scenario', scenario)

    review = manager.review_team_deletion('team-one', task_storage=storage)
    assert review['saved_selections'] == ([
        {'namespace': 'scenarios', 'key': 'account_scenario', 'path': ['view', 'selectedTeams']},
        {'namespace': 'views', 'key': 'account_view', 'path': ['selectedTeams']},
    ] if expected_count else [])
    manager.delete_team('team-one', review['revision'], acknowledged=True,
                        review_revision=review['review_revision'], task_storage=storage)
    assert storage.load('views', 'account_view') == view
    assert storage.load('scenarios', 'account_scenario') == scenario


@pytest.mark.parametrize('selected_teams', [{'team-one': 'true'}, {'team-one': 1}, None])
def test_team_deletion_rejects_malformed_saved_selection_maps(
    manager: WorkforceConfigManager, selected_teams: object,
) -> None:
    manager._storage.save('views', 'account_view', {'selectedTeams': selected_teams})
    before = manager.read_snapshot()
    with pytest.raises(ValueError, match='Saved team selections'):
        manager.review_team_deletion('team-one', task_storage=manager._storage)
    assert manager.read_snapshot() == before


def test_team_deletion_requires_fresh_reference_review(manager: WorkforceConfigManager) -> None:
    """New reference/configuration evidence invalidates an otherwise current confirmation."""
    before = manager.read_snapshot()
    review = manager.review_team_deletion('team-one', task_storage=manager._storage)
    manager._storage.save('views', 'new-view', {'teams': ['team-one']})
    with pytest.raises(WorkforceConflictError, match='review'):
        manager.delete_team('team-one', before['revision'], acknowledged=True,
                            review_revision=review['review_revision'], task_storage=manager._storage)
    assert manager.read_snapshot() == before


def test_team_deletion_review_reads_separate_cache_without_interpreting_backend_data(
    manager: WorkforceConfigManager, tmp_path: Path,
) -> None:
    """Remote snapshots are reviewed separately and private backend payload remains opaque."""
    cache = DiskCacheStorage(tmp_path / 'remote-cache')
    records = [{'id': 'task', 'capacity': [{'team': 'team-one', 'capacity': 10}],
                'backendData': {'capacity': 'opaque value'}}]
    try:
        cache.save('backend_domain', 'fetch_plan_tasks__fixture', records)
        cache.save('backend_domain', 'taskmeta__fixture', {'fresh_until': 0})
        review = manager.review_team_deletion('team-one', task_storage=cache)
        assert review['coverage']['retained_task_snapshots'] == 1
        assert review['retained_allocations'][0]['record_id'] == 'task'
        manager.delete_team('team-one', review['revision'], acknowledged=True,
                            review_revision=review['review_revision'], task_storage=cache)
        assert cache.load('backend_domain', 'fetch_plan_tasks__fixture') == records
    finally:
        cache.close()


@pytest.mark.parametrize('namespace,key,payload', [
    ('config', 'projects', 'unparsed project data'),
    ('scenarios', 'scenario', 'unparsed scenario data'),
    ('views', 'view', 'unparsed view data'),
    ('backend_domain', 'fetch_task_context__fixture', 'unparsed task data'),
])
def test_team_deletion_review_rejects_uninspectable_retained_data(
    manager: WorkforceConfigManager, namespace: str, key: str, payload: str,
) -> None:
    """Unreadable evidence must not be presented as zero references or authorize deletion."""
    before = manager.read_snapshot()
    manager._storage.save(namespace, key, payload)
    with pytest.raises(ValueError, match='structured'):
        manager.review_team_deletion('team-one', task_storage=manager._storage)
    assert manager.read_snapshot() == before


@pytest.fixture
def manager(tmp_path: Path) -> Iterator[WorkforceConfigManager]:
    """Use only isolated, explicitly migrated team/workforce schemas."""
    storage = DiskCacheStorage(tmp_path / 'config')
    storage.save('config', 'teams', {
        'schema_version': 3,
        'teams': [
            {'id': 'team-one', 'allocation_token': 'ONE', 'name': 'One',
             'short_name': 'One', 'archived': False, 'group_id': None},
        ],
        'groups': [
            {'id': 'group-one', 'allocation_token': 'GROUP', 'name': 'Group',
             'short_name': 'Group', 'archived': False},
            {'id': 'group-old', 'allocation_token': 'OLD-GROUP', 'name': 'Old group',
             'short_name': 'Old group', 'archived': True},
        ],
    })
    storage.save('config', 'workforce', {
        'schema_version': 2,
        'suppliers': [
            {'id': 'supplier-one', 'name': 'Provider', 'external': False, 'archived': False,
             'profiles': [
                 {'id': 'standard', 'name': 'Standard', 'monthly_project_hours': 160,
                  'hourly_rate': 50, 'archived': False},
                 {'id': 'retired', 'name': 'Retired', 'monthly_project_hours': 100,
                  'hourly_rate': 60, 'archived': True},
             ]},
        ],
        'staffing': [
            {'id': 'row-one', 'team_id': 'team-one', 'supplier_id': 'supplier-one',
             'profile_id': 'standard', 'fte': 1},
        ],
    })
    try:
        yield WorkforceConfigManager(storage, task_storage=storage)
    finally:
        storage.close()


@pytest.mark.parametrize('kind,fields,owner', [
    ('team', {'name': 'New team', 'short_name': 'New', 'group_id': 'group-one'}, None),
    ('group', {'name': 'New group', 'short_name': 'New'}, None),
    ('supplier', {'name': 'Company', 'external': True}, None),
    ('profile', {'name': 'Specialist', 'monthly_project_hours': 120,
                 'hourly_rate': 90}, 'supplier-one'),
    ('staffing', {'team_id': 'team-one', 'supplier_id': 'supplier-one',
                  'profile_id': 'standard', 'fte': 0.25}, None),
])
def test_definition_creation_issues_server_identity(
    manager: WorkforceConfigManager, kind: DefinitionKind, fields: dict, owner: str | None,
) -> None:
    """All new definition IDs are server-owned, with allocation tokens equal to new IDs."""
    before = manager.read_snapshot()
    after = manager.create_definition(kind, fields, before['revision'], supplier_id=owner)
    if kind == 'team':
        record = after['teams']['teams'][-1]
        assert record['allocation_token'] == record['id']
    elif kind == 'group':
        record = after['teams']['groups'][-1]
        assert record['allocation_token'] == record['id']
    elif kind == 'supplier':
        record = after['workforce']['suppliers'][-1]
    elif kind == 'profile':
        record = after['workforce']['suppliers'][0]['profiles'][-1]
    else:
        record = after['workforce']['staffing'][-1]
    assert record['id'] not in {'team-one', 'supplier-one', 'standard', 'row-one'}
    assert record['id'] != fields.get('name')
    assert after['revision'] != before['revision']
    assert manager.read_snapshot() == after


@pytest.mark.parametrize('field,value', [
    ('id', 'client-id'), ('allocation_token', 'client-token'), ('archived', True),
])
def test_creation_rejects_client_owned_identity_fields(
    manager: WorkforceConfigManager, field: str, value: object,
) -> None:
    """Clients supply editable fields only, not IDs, tokens or initial archive state."""
    before = manager.read_snapshot()
    fields = {'name': 'New', 'short_name': 'New', 'group_id': None, field: value}
    with pytest.raises(ValueError, match='fields'):
        manager.create_definition('team', fields, before['revision'])
    assert manager.read_snapshot() == before


def test_identity_collision_retries_cover_archived_tokens_and_existing_ids(
    manager: WorkforceConfigManager, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Identity issuance checks the full namespaces while holding the write transaction."""
    candidates = iter(['old-group', 'team-one', 'supplier-one', 'issued-unique'])
    monkeypatch.setattr('planner_lib.admin.workforce_config._timestamp_identity',
                        lambda: next(candidates))
    before = manager.read_snapshot()
    after = manager.create_definition(
        'team', {'name': 'New', 'short_name': 'New', 'group_id': None}, before['revision'],
    )
    assert after['teams']['teams'][-1]['id'] == 'issued-unique'


def test_rename_preserves_identity_tokens_and_anonymous_cost_basis(
    manager: WorkforceConfigManager,
) -> None:
    """A save changes labels without changing persisted IDs or original ADO tokens."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0].update(name='Renamed', short_name='Display')
    candidate['workforce']['suppliers'][0]['name'] = 'Renamed provider'
    after = manager.save_configuration(
        candidate['teams'], candidate['workforce'], before['revision'],
    )
    team = after['teams']['teams'][0]
    assert (team['id'], team['allocation_token']) == ('team-one', 'ONE')
    assert team['name'] == 'Renamed'
    assert after['workforce']['staffing'] == before['workforce']['staffing']


@pytest.mark.parametrize('mutation,message', [
    ('token', 'immutable'), ('team_remove', 'remove'), ('group_remove', 'remove'),
    ('supplier_remove', 'remove'), ('profile_remove', 'remove'), ('new_id', 'creation'),
    ('archived_membership', 'archived group'), ('archived_profile', 'archived profile'),
])
def test_ordinary_save_cannot_bypass_definition_lifecycle(
    manager: WorkforceConfigManager, mutation: str, message: str,
) -> None:
    """Reject identity changes, omission-based deletion and newly assigned archives."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    if mutation == 'token':
        candidate['teams']['teams'][0]['allocation_token'] = 'Changed'
    elif mutation == 'team_remove':
        candidate['teams']['teams'] = []
        candidate['workforce']['staffing'] = []
    elif mutation == 'group_remove':
        candidate['teams']['groups'] = []
    elif mutation == 'supplier_remove':
        candidate['workforce']['suppliers'] = []
        candidate['workforce']['staffing'] = []
    elif mutation == 'profile_remove':
        candidate['workforce']['suppliers'][0]['profiles'].pop()
    elif mutation == 'new_id':
        row = deepcopy(candidate['workforce']['staffing'][0])
        row['id'] = 'client-new-row'
        candidate['workforce']['staffing'].append(row)
    elif mutation == 'archived_membership':
        candidate['teams']['teams'][0]['group_id'] = 'group-old'
    elif mutation == 'archived_profile':
        candidate['workforce']['staffing'][0]['profile_id'] = 'retired'
    with pytest.raises(ValueError, match=message):
        manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert manager.read_snapshot() == before


def test_save_allows_group_membership_archive_and_fractional_fte(
    manager: WorkforceConfigManager,
) -> None:
    """Ordinary edits retain immutable identity while changing editable composition."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0].update(group_id='group-one', archived=True)
    candidate['workforce']['staffing'][0]['fte'] = 0.5
    after = manager.save_configuration(
        candidate['teams'], candidate['workforce'], before['revision'],
    )
    assert after['teams']['teams'][0]['group_id'] == 'group-one'
    assert after['teams']['teams'][0]['archived'] is True
    assert after['workforce']['staffing'][0]['fte'] == 0.5


def test_stale_edit_fails_without_overwriting_newer_configuration(
    manager: WorkforceConfigManager,
) -> None:
    """Require the caller's expected revision to avoid silently overwriting another edit."""
    before = manager.read_snapshot()
    after = manager.create_definition(
        'group', {'name': 'New group', 'short_name': 'New'}, before['revision'],
    )
    with pytest.raises(WorkforceConflictError, match='changed'):
        manager.save_configuration(before['teams'], before['workforce'], before['revision'])
    assert manager.read_snapshot() == after


@pytest.mark.parametrize('backups_enabled', [False, True])
def test_paired_save_failure_rolls_back_first_write(
    manager: WorkforceConfigManager, monkeypatch: pytest.MonkeyPatch, backups_enabled: bool,
) -> None:
    """A failed workforce save rolls back the preceding team write too."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['name'] = 'Must roll back'
    candidate['workforce']['staffing'][0]['fte'] = 0.5
    storage = manager._storage
    storage.save('config', 'server_config', {
        'feature_flags': {'manage_backup_snapshots': backups_enabled},
    })
    original_save = storage.save

    def failing_save(namespace: str, key: str, value: object, ttl_seconds: float | None = None) -> None:
        if key == 'workforce':
            raise OSError('fixture write failure')
        original_save(namespace, key, value, ttl_seconds=ttl_seconds)

    monkeypatch.setattr(storage, 'save', failing_save)
    with pytest.raises(OSError, match='fixture write failure'):
        manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert manager.read_snapshot() == before
    assert not any('_backup_' in key for key in storage.list_keys('config'))


def test_concurrent_creation_rejects_stale_writers_without_lost_updates(
    manager: WorkforceConfigManager,
) -> None:
    """Only one creation from the same revision succeeds, even with concurrent writers."""
    before = manager.read_snapshot()

    def create(index: int) -> bool:
        try:
            manager.create_definition(
                'group', {'name': f'Group {index}', 'short_name': f'G{index}'}, before['revision'],
            )
            return True
        except WorkforceConflictError:
            return False

    with ThreadPoolExecutor(max_workers=8) as workers:
        outcomes = list(workers.map(create, range(8)))
    assert sum(outcomes) == 1
    assert len(manager.read_snapshot()['teams']['groups']) == 3


def test_logical_backup_includes_canonical_workforce(manager: WorkforceConfigManager) -> None:
    """Workforce configuration must not disappear from a complete configuration backup."""
    from planner_lib.migrations.contracts import TARGET_REVISION

    manager._storage.save('system', 'schema_state', {'schema_revision': TARGET_REVISION})
    backup = ConfigManager(manager._storage).get_backup()
    assert backup['config']['workforce'] == manager.read_snapshot()['workforce']


def test_generated_identity_encodes_timestamp_without_name_dependency(
    manager: WorkforceConfigManager, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Creation uses a timestamp and independent entropy rather than editable labels."""
    timestamp = 1_700_000_000_123_456_789
    entropy = b'12345678'
    monkeypatch.setattr('planner_lib.admin.workforce_config.time_ns', lambda: timestamp)
    random_bytes = Mock(return_value=entropy)
    monkeypatch.setattr('planner_lib.admin.workforce_config.token_bytes', random_bytes)
    before = manager.read_snapshot()
    after = manager.create_definition(
        'group', {'name': 'Unrelated label', 'short_name': 'Label'}, before['revision'],
    )
    identity = after['teams']['groups'][-1]['id']
    decoded = b32decode(identity.upper() + '=' * ((-len(identity)) % 8))
    assert decoded[:8] == timestamp.to_bytes(8, 'big')
    assert decoded[8:] == entropy
    random_bytes.assert_called_once_with(8)


@pytest.mark.parametrize('kind,fields,owner,message', [
    ('team', {'name': 'New', 'short_name': 'New', 'group_id': 'group-old'},
     None, 'archived group'),
    ('staffing', {'team_id': 'team-one', 'supplier_id': 'supplier-one',
                  'profile_id': 'retired', 'fte': 1}, None, 'archived profile'),
    ('staffing', {'team_id': 'team-one', 'supplier_id': 'supplier-one',
                  'profile_id': 'standard', 'fte': float('nan')}, None, 'fte'),
    ('profile', {'name': 'Invalid', 'monthly_project_hours': 160, 'hourly_rate': -1},
     'supplier-one', 'hourly_rate'),
    ('profile', {'name': 'New', 'monthly_project_hours': 160, 'hourly_rate': 50},
     None, 'requires supplier_id'),
    ('profile', {'name': 'New', 'monthly_project_hours': 160, 'hourly_rate': 50},
     'missing', 'Unknown supplier'),
    ('supplier', {'name': 'Invalid', 'external': 'yes'}, None, 'boolean'),
])
def test_invalid_creation_leaves_configuration_unchanged(
    manager: WorkforceConfigManager, kind: DefinitionKind, fields: dict,
    owner: str | None, message: str,
) -> None:
    """Rejected creation attempts cannot persist IDs or partial configuration changes."""
    before = manager.read_snapshot()
    with pytest.raises(ValueError, match=message):
        manager.create_definition(kind, fields, before['revision'], supplier_id=owner)
    assert manager.read_snapshot() == before


@pytest.fixture
def workforce_client(manager: WorkforceConfigManager) -> Iterator[TestClient]:
    """Exercise real authorization decorators with private, disposable cookie sessions."""
    accounts = Mock()
    accounts.pat_error.return_value = None
    account_ids = {'admin@fixture.test': 'admin-id', 'member@fixture.test': 'member-id'}
    accounts.get_account_id.side_effect = account_ids.__getitem__
    accounts.get_account_by_id.side_effect = lambda identity: {
        'email': next(email for email, account_id in account_ids.items() if account_id == identity),
    }
    accounts.has_permission.side_effect = lambda email, permission: (
        email == 'admin@fixture.test' and permission == AccountPermissions.ADMIN
    )
    sessions = SessionManager(accounts, manager._storage)
    services = {
        'account_manager': accounts,
        'session_manager': sessions,
        'admin_service': WorkforceAdminService(manager._storage, None, accounts, None,
                          task_storage=manager._storage),
        'remote_cache_storage': manager._storage,
        'cost_service': Mock(),
    }
    app = FastAPI()
    app.state.container = SimpleNamespace(get=services.__getitem__)
    app.state.member_session = sessions.create('member@fixture.test')
    app.add_middleware(SessionMiddleware, session_manager=sessions)
    app.include_router(admin_api.router)
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE, sessions.create('admin@fixture.test'))
        yield client


@pytest.mark.parametrize('permission,section', [
    ('manage_workforce_teams', 'teams'),
    ('manage_workforce_costs', 'costs'),
    ('manage_workforce_costs', 'staffing'),
])
def test_workforce_delegated_save_cannot_change_other_sections(
    manager: WorkforceConfigManager, workforce_client: TestClient, permission: str, section: str,
) -> None:
    accounts = workforce_client.app.state.container.get('account_manager')
    accounts.has_permission.side_effect = lambda email, requested: requested == permission
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    if section == 'teams':
        candidate['workforce']['suppliers'][0]['profiles'][0]['hourly_rate'] = 999
    elif section == 'staffing':
        candidate['workforce']['staffing'][0]['fte'] = 0.75
    else:
        candidate['teams']['teams'][0]['name'] = 'Forbidden team change'
    assert workforce_client.post('/admin/v1/workforce', json=candidate).status_code == 403
    assert manager.read_snapshot() == before

    candidate = deepcopy(before)
    if section == 'teams':
        candidate['teams']['teams'][0]['name'] = 'Delegated team change'
    else:
        candidate['workforce']['suppliers'][0]['profiles'][0]['hourly_rate'] = 99
    assert workforce_client.post('/admin/v1/workforce', json=candidate).status_code == 200


@pytest.mark.parametrize('permission,allowed,denied', [
    ('manage_workforce_teams', 'team', 'supplier'),
    ('manage_workforce_costs', 'supplier', 'team'),
])
def test_workforce_definition_creation_is_permission_scoped(
    manager: WorkforceConfigManager, workforce_client: TestClient,
    permission: str, allowed: str, denied: str,
) -> None:
    accounts = workforce_client.app.state.container.get('account_manager')
    accounts.has_permission.side_effect = lambda email, requested: requested == permission
    before = manager.read_snapshot()
    payload = {'revision': before['revision'], 'fields': {'name': 'New definition'}}
    assert workforce_client.post(
        f'/admin/v1/workforce/definitions/{denied}', json=payload,
    ).status_code == 403
    if allowed == 'team':
        payload['fields'].update(short_name='New', group_id=None)
    else:
        payload['fields']['external'] = False
    assert workforce_client.post(
        f'/admin/v1/workforce/definitions/{allowed}', json=payload,
    ).status_code == 200


def test_workforce_http_read_returns_coherent_snapshot(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """The public admin facade exposes canonical configurations without invalidating reads."""
    response = workforce_client.get('/admin/v1/workforce')
    assert response.status_code == 200
    assert response.json()['content'] == manager.read_snapshot()
    cast(FastAPI, workforce_client.app).state.container.get('cost_service').invalidate_cache.assert_not_called()


def test_canonical_project_snapshot_restore_rejects_unknown_reference(
    manager: WorkforceConfigManager,
) -> None:
    """A snapshot cannot bypass the same availability contract as a normal save."""
    current = {'schema_version': 4, 'container_types': ['project'], 'project_map': [],
               'allocation_defaults': {'project': []}}
    candidate = deepcopy(current)
    candidate['allocation_defaults']['project'] = ['missing']
    manager._storage.save('config', 'projects', current)
    manager._storage.save('config', 'projects_backup_fixture', candidate)
    service = WorkforceAdminService(manager._storage, None, Mock(), None,
                                    task_storage=manager._storage)
    with pytest.raises(ValueError, match='Unknown allocation availability ID'):
        service.restore_snapshot_entry('projects_backup_fixture')
    assert manager._storage.load('config', 'projects') == current


def test_canonical_project_http_availability_is_validated_before_save(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """Invalid availability returns an actionable client error without a persisted edit."""
    current = {'schema_version': 4, 'container_types': ['project'], 'project_map': [],
               'allocation_defaults': {'project': []}}
    manager._storage.save('config', 'projects', current)
    candidate = deepcopy(current)
    candidate['allocation_defaults']['project'] = ['missing']
    rejected = workforce_client.post('/admin/v1/projects', json={'content': candidate})
    assert rejected.status_code == 422
    assert rejected.json()['detail']['error'] == 'invalid_allocation_availability'
    assert manager._storage.load('config', 'projects') == current
    accepted = deepcopy(current)
    accepted['allocation_defaults']['project'] = ['team-one']
    accepted['project_map'] = [{'id': 'plan', 'name': 'Plan', 'area_path': 'Platform',
                                'type': 'project', 'allocatable_ids': [],
                                'task_types': ['Feature'], 'closed_history_days': 0}]
    from tests.python.azure.test_process_catalogue import catalogue
    manager._storage.save('config', 'ado_processes', catalogue())
    manager._storage.save('config', 'global_settings', {
        'schema_version': 2, 'process_order': [], 'type_tiers': {},
    })
    response = workforce_client.post('/admin/v1/projects', json={'content': accepted})
    assert response.status_code == 200
    assert manager._storage.load('config', 'projects') == accepted


@pytest.mark.parametrize('key', ['teams', 'workforce', 'people', 'cost_config'])
def test_canonical_workforce_snapshot_cannot_bypass_lifecycle_owner(
    manager: WorkforceConfigManager, key: str,
) -> None:
    """Generic snapshot restoration must not reset server-owned identity and lifecycle data."""
    manager._storage.save('config', f'{key}_backup_fixture', {'unvalidated': True})
    service = WorkforceAdminService(manager._storage, None, Mock(), None,
                                    task_storage=manager._storage)
    with pytest.raises(WorkforceConflictError, match='canonical Workforce'):
        service.restore_snapshot_entry(f'{key}_backup_fixture')


@pytest.mark.parametrize('key', ['teams', 'workforce'])
def test_canonical_logical_restore_cannot_bypass_workforce_owner(
    manager: WorkforceConfigManager, key: str,
) -> None:
    """A logical backup cannot restore only half of the paired canonical workforce."""
    service = WorkforceAdminService(manager._storage, None, Mock(), None,
                                    task_storage=manager._storage)
    before = manager.read_snapshot()
    with pytest.raises(ValueError, match='both teams and workforce'):
        service.restore_backup({'schema_revision': TARGET_REVISION,
                    'config': {key: {'unvalidated': True}}})
    assert manager.read_snapshot() == before


def test_logical_backup_restore_round_trips_canonical_workforce_and_ids(
    manager: WorkforceConfigManager,
) -> None:
    """A full logical restore reinstates paired workforce definitions with their original IDs."""
    from planner_lib.migrations.contracts import TARGET_REVISION

    manager._storage.save('system', 'schema_state', {'schema_revision': TARGET_REVISION})
    backup = ConfigManager(manager._storage).get_backup()
    original = manager.read_snapshot()
    changed = deepcopy(original)
    changed['teams']['teams'][0]['name'] = 'Changed after backup'
    manager.save_configuration(changed['teams'], changed['workforce'], original['revision'])

    accounts = Mock()
    accounts.get_all_with_permission.return_value = []
    service = WorkforceAdminService(
        manager._storage, None, accounts, None, task_storage=manager._storage,
    )
    result = service.restore_backup(backup)

    restored = manager.read_snapshot()
    assert result['ok'] is True
    assert restored['teams'] == original['teams']
    assert restored['workforce'] == original['workforce']
    assert [team['id'] for team in restored['teams']['teams']] == [
        team['id'] for team in original['teams']['teams']
    ]
    assert [supplier['id'] for supplier in restored['workforce']['suppliers']] == [
        supplier['id'] for supplier in original['workforce']['suppliers']
    ]


def test_logical_restore_rejects_duplicate_workforce_ids_without_writing(
    manager: WorkforceConfigManager,
) -> None:
    """A paired restore cannot reintroduce cross-category identity collisions."""
    before = manager.read_snapshot()
    teams = deepcopy(before['teams'])
    workforce = deepcopy(before['workforce'])
    workforce['suppliers'][0]['id'] = teams['teams'][0]['id']
    workforce['staffing'][0]['supplier_id'] = teams['teams'][0]['id']
    accounts = Mock()
    service = WorkforceAdminService(
        manager._storage, None, accounts, None, task_storage=manager._storage,
    )

    with pytest.raises(ValueError, match='globally unique'):
        service.restore_backup({'schema_revision': TARGET_REVISION,
                    'config': {'teams': teams, 'workforce': workforce}})

    assert manager.read_snapshot() == before


def test_workforce_http_deletion_reviews_then_commits_acknowledged_impact(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """Authenticated review does not write; only explicit fresh confirmation may delete."""
    before = manager.read_snapshot()
    response = workforce_client.get('/admin/v1/workforce/teams/team-one/deletion')
    assert response.status_code == 200
    review = response.json()['content']
    assert review['team']['allocation_token'] == 'ONE'
    assert manager.read_snapshot() == before
    cost = cast(FastAPI, workforce_client.app).state.container.get('cost_service')
    cost.invalidate_cache.assert_not_called()
    payload = {'revision': review['revision'], 'confirmation': {
        'acknowledged': False, 'review_revision': review['review_revision'],
    }}
    rejected = workforce_client.post('/admin/v1/workforce/teams/team-one/deletion', json=payload)
    assert rejected.status_code == 422
    assert manager.read_snapshot() == before
    payload['confirmation']['acknowledged'] = True
    committed = workforce_client.post('/admin/v1/workforce/teams/team-one/deletion', json=payload)
    assert committed.status_code == 200
    assert committed.json()['content'] == manager.read_snapshot()
    assert committed.json()['content']['teams']['teams'] == []
    cost.invalidate_cache.assert_called_once()


def test_team_deletion_rolls_back_dependent_configuration_on_write_failure(
    manager: WorkforceConfigManager, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Availability, staffing, team identity and date stamps must roll back together."""
    manager._storage.save('config', 'projects', {'allocation_defaults': {'project': ['team-one']}})
    before = manager.read_snapshot()
    review = manager.review_team_deletion('team-one', task_storage=manager._storage)
    original = manager._storage.save

    def fail_team_write(namespace: str, key: str, value: object, ttl_seconds: float | None = None) -> None:
        if namespace == 'config' and key == 'teams':
            raise RuntimeError('fixture failed write')
        original(namespace, key, value, ttl_seconds=ttl_seconds)

    monkeypatch.setattr(manager._storage, 'save', fail_team_write)
    with pytest.raises(RuntimeError, match='failed write'):
        manager.delete_team('team-one', before['revision'], acknowledged=True,
                            review_revision=review['review_revision'], task_storage=manager._storage)
    assert manager.read_snapshot() == before
    assert manager._storage.load('config', 'projects') == {'allocation_defaults': {'project': ['team-one']}}


def test_team_deletion_http_preserves_encoded_team_identity(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """An explicitly persisted identity is addressed exactly, not restricted by URL syntax."""
    snapshot = manager.read_snapshot()
    snapshot['teams']['teams'][0]['id'] = 'team/one'
    snapshot['workforce']['staffing'][0]['team_id'] = 'team/one'
    manager._storage.save('config', 'teams', snapshot['teams'])
    manager._storage.save('config', 'workforce', snapshot['workforce'])
    path = '/admin/v1/workforce/teams/team%2Fone/deletion'
    reviewed = workforce_client.get(path)
    assert reviewed.status_code == 200
    review = reviewed.json()['content']
    assert review['team']['id'] == 'team/one'
    deleted = workforce_client.post(path, json={'revision': review['revision'], 'confirmation': {
        'acknowledged': True, 'review_revision': review['review_revision'],
    }})
    assert deleted.status_code == 200
    assert manager.read_snapshot()['teams']['teams'] == []


@pytest.mark.parametrize('role', ['missing', 'invalid', 'member'])
@pytest.mark.parametrize('method,path', [
    ('GET', '/admin/v1/workforce'),
    ('POST', '/admin/v1/workforce'),
    ('POST', '/admin/v1/workforce/definitions/team'),
    ('GET', '/admin/v1/workforce/teams/team-one/deletion'),
    ('POST', '/admin/v1/workforce/teams/team-one/deletion'),
])
def test_workforce_http_requires_admin_cookie_before_handling_payload(
    manager: WorkforceConfigManager, workforce_client: TestClient,
    role: str, method: str, path: str,
) -> None:
    """Missing, expired and non-admin sessions cannot read or mutate canonical inputs."""
    before = manager.read_snapshot()
    workforce_client.cookies.clear()
    if role == 'invalid':
        workforce_client.cookies.set(SESSION_COOKIE, 'invalid-fixture-session')
    elif role == 'member':
        workforce_client.cookies.set(SESSION_COOKIE,
                         cast(FastAPI, workforce_client.app).state.member_session)
    response = workforce_client.request(method, path, json={})
    assert response.status_code == 401
    assert response.json()['detail']['error'] == 'access_denied'
    assert manager.read_snapshot() == before


def test_workforce_http_creation_returns_server_identity_and_refreshes_cost(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """An authorized creation returns the committed revision and invalidates cost afterward."""
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce/definitions/team', json={
        'revision': before['revision'],
        'fields': {'name': 'HTTP team', 'short_name': 'HTTP', 'group_id': 'group-one'},
    })
    assert response.status_code == 200
    after = response.json()['content']
    assert after == manager.read_snapshot()
    record = after['teams']['teams'][-1]
    assert record['allocation_token'] == record['id']
    assert record['name'] == 'HTTP team'
    cast(FastAPI, workforce_client.app).state.container.get('cost_service').invalidate_cache.assert_called_once()


def test_workforce_http_save_preserves_tokens_and_rejects_stale_revision(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """Expose successful label/FTE editing and actionable optimistic-concurrency errors."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['name'] = 'HTTP renamed'
    candidate['workforce']['staffing'][0]['fte'] = 0.75
    saved = workforce_client.post('/admin/v1/workforce', json=candidate)
    assert saved.status_code == 200
    assert saved.json()['content']['teams']['teams'][0]['allocation_token'] == 'ONE'
    after = manager.read_snapshot()
    stale = workforce_client.post('/admin/v1/workforce', json=before)
    assert stale.status_code == 409
    assert stale.json()['detail']['error'] == 'workforce_conflict'
    assert manager.read_snapshot() == after
    cast(FastAPI, workforce_client.app).state.container.get('cost_service').invalidate_cache.assert_called_once()


@pytest.mark.parametrize('payload', [
    {}, [], {'revision': 'anything'},
    {'revision': None, 'teams': {}, 'workforce': {}},
    {'revision': 'anything', 'teams': {}, 'workforce': {}, 'unexpected': True},
])
def test_workforce_http_rejects_invalid_payload_shapes(
    manager: WorkforceConfigManager, workforce_client: TestClient, payload: object,
) -> None:
    """Reject malformed envelopes explicitly, without incidental AttributeErrors or writes."""
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce', json=payload)
    assert response.status_code == 400
    assert response.json()['detail']['error'] == 'invalid_payload'
    assert manager.read_snapshot() == before


def test_workforce_http_rejects_malformed_json(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """JSON parser failures are client errors, not server errors or partial edits."""
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce', content='{',
                                     headers={'content-type': 'application/json'})
    assert response.status_code == 400
    assert manager.read_snapshot() == before


def test_workforce_http_domain_validation_rejects_client_identity(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """The browser cannot bypass server-issued identity by adding its own ID field."""
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce/definitions/team', json={
        'revision': before['revision'],
        'fields': {'id': 'client-id', 'name': 'New', 'short_name': 'New', 'group_id': None},
    })
    assert response.status_code == 422
    assert response.json()['detail']['error'] == 'invalid_workforce'
    assert manager.read_snapshot() == before


@pytest.mark.parametrize('path', [
    '/admin/v1/teams', '/admin/v1/people', '/admin/v1/people/inspect',
    '/admin/v1/cost', '/admin/v1/cost/inspect',
])
@pytest.mark.parametrize('method', ['GET', 'POST'])
def test_removed_admin_endpoints_are_not_available(
    manager: WorkforceConfigManager, workforce_client: TestClient, path: str, method: str,
) -> None:
    """Removed configuration and inspection routes cannot read or mutate workforce."""
    before = manager.read_snapshot()
    response = workforce_client.request(method, path, json={'content': {}})
    assert response.status_code == 404
    assert manager.read_snapshot() == before


def test_workforce_http_refuses_unmigrated_store_without_conversion(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """Introducing endpoints does not implicitly migrate the running legacy instance."""
    legacy = {'schema_version': 2, 'teams': [{'name': 'Legacy', 'short_name': 'LEG', 'exclude': False}]}
    manager._storage.save('config', 'teams', legacy)
    manager._storage.delete('config', 'workforce')
    for method in ('GET', 'POST'):
        response = workforce_client.request(method, '/admin/v1/workforce', json={
            'revision': 'not-active', 'teams': {}, 'workforce': {},
        })
        assert response.status_code == 409
        assert response.json()['detail']['error'] == 'workforce_not_migrated'
    assert manager._storage.load('config', 'teams') == legacy
    assert not manager._storage.exists('config', 'workforce')


def test_workforce_http_rejects_cross_origin_mutations(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """Canonical mutations retain the application's existing same-origin protection."""
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce', json=before,
                                     headers={'origin': 'https://other.example.test'})
    assert response.status_code == 403
    assert manager.read_snapshot() == before


def test_workforce_http_profile_creation_passes_supplier_scope(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """Profile creation carries an explicit supplier owner through the HTTP/service layers."""
    before = manager.read_snapshot()
    response = workforce_client.post('/admin/v1/workforce/definitions/profile', json={
        'revision': before['revision'], 'supplier_id': 'supplier-one',
        'fields': {'name': 'HTTP profile', 'monthly_project_hours': 120, 'hourly_rate': 90},
    })
    assert response.status_code == 200
    profile = response.json()['content']['workforce']['suppliers'][0]['profiles'][-1]
    assert profile['name'] == 'HTTP profile'
    assert profile['id'] not in {'standard', 'retired'}


@pytest.mark.parametrize('mutation', ['token', 'omission'])
def test_workforce_http_save_cannot_change_token_or_omit_team(
    manager: WorkforceConfigManager, workforce_client: TestClient, mutation: str,
) -> None:
    """Whole-document edits cannot bypass immutable token or confirmed deletion rules."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    if mutation == 'token':
        candidate['teams']['teams'][0]['allocation_token'] = 'CHANGED'
    else:
        candidate['teams']['teams'] = []
        candidate['workforce']['staffing'] = []
    response = workforce_client.post('/admin/v1/workforce', json=candidate)
    assert response.status_code == 422
    assert response.json()['detail']['error'] == 'invalid_workforce'
    assert manager.read_snapshot() == before
    cast(FastAPI, workforce_client.app).state.container.get('cost_service').invalidate_cache.assert_not_called()


def test_workforce_http_persistence_failure_rolls_back_and_hides_internal_details(
    manager: WorkforceConfigManager, workforce_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed paired persistence returns a sanitized error without invalidating cost."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['name'] = 'Must roll back'
    candidate['workforce']['staffing'][0]['fte'] = 0.5
    original_save = manager._storage.save

    def failing_save(namespace: str, key: str, value: object, ttl_seconds: float | None = None) -> None:
        if namespace == 'config' and key == 'workforce':
            raise OSError('private fixture details')
        original_save(namespace, key, value, ttl_seconds=ttl_seconds)

    monkeypatch.setattr(manager._storage, 'save', failing_save)
    response = workforce_client.post('/admin/v1/workforce', json=candidate)
    assert response.status_code == 500
    assert response.json()['detail'] == 'Internal server error'
    assert 'private fixture details' not in response.text
    assert manager.read_snapshot() == before
    cast(FastAPI, workforce_client.app).state.container.get('cost_service').invalidate_cache.assert_not_called()


def test_workforce_http_committed_edit_reports_cache_failure_without_failed_save(
    manager: WorkforceConfigManager, workforce_client: TestClient,
) -> None:
    """After commit, cache failure is an explicit warning, not a retryable failed creation."""
    before = manager.read_snapshot()
    cost = cast(FastAPI, workforce_client.app).state.container.get('cost_service')
    cost.invalidate_cache.side_effect = OSError('fixture cache failure')
    response = workforce_client.post('/admin/v1/workforce/definitions/group', json={
        'revision': before['revision'], 'fields': {'name': 'Committed', 'short_name': 'Saved'},
    })
    assert response.status_code == 200
    assert response.json()['ok'] is True
    assert response.json()['content'] == manager.read_snapshot()
    assert response.json()['warnings'][0]['error'] == 'cost_cache_invalidation_failed'
    cost.invalidate_cache.assert_called_once()


@pytest.mark.parametrize('save_method', ['save_config', 'save_config_raw'])
def test_project_save_validates_canonical_availability_before_any_write(
    manager: WorkforceConfigManager, save_method: str,
) -> None:
    """Both generic project writers reject invalid references without creating backups."""
    projects = {
        'schema_version': 4, 'container_types': ['project'], 'project_map': [],
        'allocation_defaults': {'project': ['team-one']},
    }
    manager._storage.save('config', 'projects', projects)
    service = WorkforceAdminService(manager._storage, None, Mock(), None,
                                    task_storage=manager._storage)
    candidate = deepcopy(projects)
    candidate['allocation_defaults']['project'] = ['unknown-team']
    keys = set(manager._storage.list_keys('config'))
    with pytest.raises(ValueError, match='Unknown allocation availability ID'):
        getattr(service, save_method)('projects', candidate)
    assert manager._storage.load('config', 'projects') == projects
    assert set(manager._storage.list_keys('config')) == keys


@pytest.mark.parametrize('key', ['teams', 'workforce', 'people', 'cost_config'])
def test_raw_admin_service_saves_cannot_bypass_canonical_owner(
    manager: WorkforceConfigManager, workforce_client: TestClient, key: str,
) -> None:
    """Derived/raw save delegation cannot accidentally provide a second workforce write path."""
    before = manager.read_snapshot()
    service = cast(FastAPI, workforce_client.app).state.container.get('admin_service')
    with pytest.raises(WorkforceConflictError, match='canonical Workforce'):
        service.save_config_raw(key, {})
    assert manager.read_snapshot() == before


@pytest.mark.parametrize('kind,fields,owner', [
    ('team', {'name': 'Dated', 'short_name': 'Dated', 'group_id': None}, None),
    ('group', {'name': 'Dated', 'short_name': 'Dated'}, None),
    ('supplier', {'name': 'Dated', 'external': False}, None),
    ('profile', {'name': 'Dated', 'monthly_project_hours': 120, 'hourly_rate': 80}, 'supplier-one'),
    ('staffing', {'team_id': 'team-one', 'supplier_id': 'supplier-one',
                  'profile_id': 'standard', 'fte': 0.5}, None),
])
def test_all_created_workforce_records_have_server_owned_last_updated(
    manager: WorkforceConfigManager, kind: DefinitionKind, fields: dict, owner: str | None,
) -> None:
    """Every newly issued identity has a server-issued UTC last_updated instant."""
    before = manager.read_snapshot()
    after = manager.create_definition(kind, fields, before['revision'], supplier_id=owner)
    if kind == 'team':
        record = after['teams']['teams'][-1]
    elif kind == 'group':
        record = after['teams']['groups'][-1]
    elif kind == 'supplier':
        record = after['workforce']['suppliers'][-1]
    elif kind == 'profile':
        record = after['workforce']['suppliers'][0]['profiles'][-1]
    else:
        record = after['workforce']['staffing'][-1]
    assert record['last_updated'].endswith('Z')
    assert datetime.fromisoformat(record['last_updated']).tzinfo is timezone.utc
    assert {'created_at', 'updated_at', 'archived_at'}.isdisjoint(record)


def test_archive_restore_and_noop_last_updated(manager: WorkforceConfigManager) -> None:
    """Archive/restore update the metric; no-op saves do not invent or rewrite it."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['archived'] = True
    archived = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    team = archived['teams']['teams'][0]
    assert 'last_updated' in team
    assert {'created_at', 'updated_at', 'archived_at'}.isdisjoint(team)
    noop = manager.save_configuration(archived['teams'], archived['workforce'], archived['revision'])
    assert noop == archived
    candidate = deepcopy(archived)
    candidate['teams']['teams'][0]['archived'] = False
    restored = manager.save_configuration(candidate['teams'], candidate['workforce'], archived['revision'])
    assert restored['teams']['teams'][0]['last_updated'] >= team['last_updated']
    assert 'last_updated' not in restored['teams']['groups'][0]


def test_staffing_change_dates_also_touch_team_composition(manager: WorkforceConfigManager) -> None:
    """Team dates include anonymous staffing changes rather than labels alone."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['workforce']['staffing'][0]['fte'] = 0.75
    after = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert after['workforce']['staffing'][0]['last_updated'] == after['teams']['teams'][0]['last_updated']
    assert 'last_updated' not in after['workforce']['suppliers'][0]


def test_profile_change_dates_touch_provider_and_affected_team(manager: WorkforceConfigManager) -> None:
    """A reused profile's changed basis dates its owner and affected team composition."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['workforce']['suppliers'][0]['profiles'][0]['hourly_rate'] = 75
    after = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    supplier = after['workforce']['suppliers'][0]
    assert supplier['last_updated'] == supplier['profiles'][0]['last_updated']
    assert supplier['last_updated'] == after['teams']['teams'][0]['last_updated']
    assert 'last_updated' not in supplier['profiles'][1]


def test_unused_profile_changes_do_not_date_unaffected_team(manager: WorkforceConfigManager) -> None:
    """Supplier child updates are not changes to teams using other profiles."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['workforce']['suppliers'][0]['profiles'][1]['hourly_rate'] = 65
    committed = manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert 'last_updated' in committed['workforce']['suppliers'][0]
    assert 'last_updated' in committed['workforce']['suppliers'][0]['profiles'][1]
    assert committed['teams'] == before['teams']
    assert committed['workforce']['staffing'] == before['workforce']['staffing']


def test_client_cannot_forge_workforce_audit_dates(
    manager: WorkforceConfigManager,
) -> None:
    """Whole-document saves cannot replace or invent server-owned record history."""
    before = manager.read_snapshot()
    candidate = deepcopy(before)
    candidate['teams']['teams'][0]['last_updated'] = '2020-01-01T00:00:00Z'
    with pytest.raises(ValueError, match='server-owned'):
        manager.save_configuration(candidate['teams'], candidate['workforce'], before['revision'])
    assert manager.read_snapshot() == before


@pytest.mark.parametrize('kind', ['team', 'group', 'supplier', 'profile', 'staffing'])
def test_last_updated_tracks_each_item_lifecycle(
    manager: WorkforceConfigManager, kind: DefinitionKind, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """All modifications, archives and restorations use the server's current clock."""
    clock = Mock(wraps=datetime)
    monkeypatch.setattr('planner_lib.admin.workforce_config.datetime', clock)

    def item(snapshot: dict) -> dict:
        if kind in {'team', 'group'}:
            key = 'teams' if kind == 'team' else 'groups'
            return snapshot['teams'][key][0]
        if kind == 'supplier':
            return snapshot['workforce']['suppliers'][0]
        if kind == 'profile':
            return snapshot['workforce']['suppliers'][0]['profiles'][0]
        return snapshot['workforce']['staffing'][0]

    transitions = [('fte', 0.25)] if kind == 'staffing' else [
        ('name', 'Changed'), ('archived', True), ('archived', False),
    ]
    previous = manager.read_snapshot()
    for index, (field, value) in enumerate(transitions):
        clock.now.return_value = datetime(2026, 10, 14, 12, index, tzinfo=timezone.utc)
        candidate = deepcopy(previous)
        item(candidate)[field] = value
        committed = manager.save_configuration(
            candidate['teams'], candidate['workforce'], previous['revision'],
        )
        assert item(committed)['last_updated'] == f'2026-10-14T12:0{index}:00Z'
        clock.now.assert_called_with(timezone.utc)
        assert manager.save_configuration(
            committed['teams'], committed['workforce'], committed['revision'],
        ) == committed
        previous = committed