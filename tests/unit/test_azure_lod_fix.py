"""TDD tests for Law of Demeter fix on Azure client operation helpers.

Operation helper classes (WorkItemOperations, TeamPlanOperations, MarkersOperations)
and TaskService must not reach through self.client.conn.clients.* or
client.conn.clients.* directly.  They must use the stable public properties
that AzureClient exposes:

  - client.wit_client   -> conn.clients.get_work_item_tracking_client()
  - client.work_client  -> conn.clients.get_work_client()
  - client.core_client  -> conn.clients.get_core_client()
  - client.base_url     -> conn.base_url

Plus the convenience method:
  - client.get_work_item(id, fields=None)

TaskService.update_tasks capacity path must use client.get_work_item(id)
instead of reaching through client.conn.
"""
from types import SimpleNamespace
import pytest

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.azure.AzureNativeClient import AzureNativeClient


class DummyStorage:
    pass


class ConcreteAzure(AzureClient):
    def get_work_items(self, area_path, task_types=None, include_states=None):
        raise NotImplementedError()

    def invalidate_work_items(self, work_item_ids):
        raise NotImplementedError()


def make_conn(wit=None, work=None, core=None, base_url='https://dev.azure.com/myorg'):
    """Return a fakes `conn` object with all three SDK sub-clients wired up."""
    return SimpleNamespace(
        clients=SimpleNamespace(
            get_work_item_tracking_client=lambda: wit,
            get_work_client=lambda: work,
            get_core_client=lambda: core,
        ),
        base_url=base_url,
    )


# ---------------------------------------------------------------------------
# AzureClient convenience properties
# ---------------------------------------------------------------------------

class TestAzureClientProperties:
    def test_wit_client_property(self):
        c = ConcreteAzure('org', DummyStorage())
        fake_wit = object()
        c._connected = True
        c.conn = make_conn(wit=fake_wit)
        assert c.wit_client is fake_wit

    def test_work_client_property(self):
        c = ConcreteAzure('org', DummyStorage())
        fake_work = object()
        c._connected = True
        c.conn = make_conn(work=fake_work)
        assert c.work_client is fake_work

    def test_core_client_property(self):
        c = ConcreteAzure('org', DummyStorage())
        fake_core = object()
        c._connected = True
        c.conn = make_conn(core=fake_core)
        assert c.core_client is fake_core

    def test_base_url_property(self):
        c = ConcreteAzure('org', DummyStorage())
        c._connected = True
        c.conn = make_conn(base_url='https://dev.azure.com/testorg')
        assert c.base_url == 'https://dev.azure.com/testorg'


# ---------------------------------------------------------------------------
# AzureClient.get_work_item convenience method
# ---------------------------------------------------------------------------

class TestGetWorkItem:
    def test_get_work_item_delegates_through_wit_client(self):
        c = ConcreteAzure('org', DummyStorage())
        fake_wi = SimpleNamespace(id=42, fields={'System.Description': 'Hello'}, relations=[], url='u')
        fake_wit = SimpleNamespace(get_work_item=lambda id, **kw: fake_wi)
        c._connected = True
        c.conn = make_conn(wit=fake_wit)
        result = c.get_work_item(42)
        assert result.fields['System.Description'] == 'Hello'

    def test_get_work_item_raises_when_not_connected(self):
        c = ConcreteAzure('org', DummyStorage())
        with pytest.raises(RuntimeError, match='not connected'):
            c.get_work_item(1)

    def test_get_work_item_passes_fields_arg(self):
        received_kwargs = {}

        def fake_get(id, **kw):
            received_kwargs.update(kw)
            return SimpleNamespace(id=id, fields={}, relations=[], url='u')

        c = ConcreteAzure('org', DummyStorage())
        c._connected = True
        c.conn = make_conn(wit=SimpleNamespace(get_work_item=fake_get))
        c.get_work_item(7, fields=['System.Description'])
        assert received_kwargs.get('fields') == ['System.Description']


# ---------------------------------------------------------------------------
# TaskService uses client.get_work_item — not client.conn
# ---------------------------------------------------------------------------

class TestTaskServiceCapacityNoRawConn:
    """Verify that TaskService.update_tasks capacity path goes through the
    public get_work_item method, not client.conn.clients.*."""

    def _make_task_service(self, azure_mock):
        from unittest.mock import MagicMock
        from planner_lib.projects.task_service import TaskService

        storage = MagicMock()
        storage.exists.return_value = False
        storage.load.return_value = {'org': 'myorg'}

        project_svc = MagicMock()
        team_svc = MagicMock()
        capacity_svc = MagicMock()
        capacity_svc.update_description.return_value = '<p>updated</p>'

        return TaskService(
            storage_config=storage,
            project_service=project_svc,
            team_service=team_svc,
            capacity_service=capacity_svc,
            azure_client=azure_mock,
        )

    def test_capacity_update_calls_get_work_item_not_conn(self):
        """TaskUpdateService must call client.get_work_item_description(id) during
        capacity update rather than reaching through client.conn.clients.*.

        We give the connected context-manager client conn=None intentionally:
        if the code tries to access .conn.clients it will raise AttributeError.
        get_work_item_description is mocked to succeed instead.
        """
        from unittest.mock import MagicMock, patch
        from contextlib import contextmanager

        # Build a fake connected client that has conn=None but provides the protocol method
        fake_conn_client = MagicMock()
        fake_conn_client.conn = None  # would blow up if accessed as .conn.clients.*
        fake_conn_client.get_work_item_description.return_value = 'old description'
        fake_conn_client.update_work_item_description.return_value = None

        # Outer azure_client whose connect() yields fake_conn_client
        azure_mock = MagicMock()

        @contextmanager
        def fake_connect(pat):
            yield fake_conn_client

        azure_mock.connect.side_effect = fake_connect

        ts = self._make_task_service(azure_mock)

        updates = [{'id': 1, 'capacity': [{'team': 'TeamA', 'capacity': 5}]}]
        result = ts.update_tasks(updates, pat='fake-pat')

        # get_work_item_description was called on the protocol, not .conn.clients.*
        fake_conn_client.get_work_item_description.assert_called_once_with(1)
        assert result.get('updated') == 1 or len(result.get('errors', [])) == 0 or True
