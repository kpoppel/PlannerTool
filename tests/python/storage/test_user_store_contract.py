"""Scenario and view persistence contracts, independent of their implementation."""

import pytest

from planner_lib.scenarios import scenario_store
from planner_lib.storage.diskcache_backend import DiskCacheStorage
from planner_lib.views import view_store


@pytest.fixture
def storage(tmp_path):
    backend = DiskCacheStorage(tmp_path / 'cache')
    yield backend
    backend.close()


@pytest.fixture(params=[scenario_store, view_store], ids=['scenarios', 'views'])
def store_api(request, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    module = request.param
    if module is scenario_store:
        return (
            module.save_user_scenario, module.load_user_scenario,
            module.delete_user_scenario, module.list_user_scenarios,
        )
    return (
        module.save_user_view, module.load_user_view,
        module.delete_user_view, module.list_user_views,
    )


def test_create_update_and_delete_preserve_identity_and_metadata(store_api, storage):
    save, load, delete, list_items = store_api
    payload = {'name': 'Original', 'view': {'zoom': 2}}

    metadata = save(storage, 'owner', None, payload)
    item_id = metadata['id']
    assert item_id
    assert metadata['user'] == 'owner'
    assert list_items(storage, 'owner') == [metadata]
    assert load(storage, 'owner', item_id)['view'] == {'zoom': 2}
    assert payload == {'name': 'Original', 'view': {'zoom': 2}}

    updated = save(storage, 'owner', item_id, {'name': 'Updated', 'view': {'zoom': 3}})
    assert updated['id'] == item_id
    assert list_items(storage, 'owner') == [updated]
    assert load(storage, 'owner', item_id)['view'] == {'zoom': 3}

    assert delete(storage, 'owner', item_id) is True
    assert list_items(storage, 'owner') == []
    with pytest.raises(KeyError):
        load(storage, 'owner', item_id)
    assert delete(storage, 'owner', item_id) is False


def test_same_item_id_is_isolated_between_owners(store_api, storage):
    save, load, delete, list_items = store_api
    first = save(storage, 'first', 'shared-id', {'name': 'First'})
    second = save(storage, 'second', 'shared-id', {'name': 'Second'})

    assert list_items(storage, 'first') == [first]
    assert list_items(storage, 'second') == [second]
    assert load(storage, 'first', 'shared-id')['name'] == 'First'
    assert load(storage, 'second', 'shared-id')['name'] == 'Second'
    with pytest.raises(KeyError):
        load(storage, 'outsider', 'shared-id')
    assert delete(storage, 'outsider', 'shared-id') is False

    assert delete(storage, 'first', 'shared-id') is True
    assert list_items(storage, 'second') == [second]
    assert load(storage, 'second', 'shared-id')['name'] == 'Second'


def test_scenarios_and_views_do_not_overwrite_each_other(storage, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    scenario_store.save_user_scenario(storage, 'owner', 'same-id', {'name': 'Scenario'})
    view_store.save_user_view(storage, 'owner', 'same-id', {'name': 'View'})

    assert scenario_store.load_user_scenario(storage, 'owner', 'same-id')['name'] == 'Scenario'
    assert view_store.load_user_view(storage, 'owner', 'same-id')['name'] == 'View'
    scenario_store.delete_user_scenario(storage, 'owner', 'same-id')
    assert view_store.load_user_view(storage, 'owner', 'same-id')['name'] == 'View'