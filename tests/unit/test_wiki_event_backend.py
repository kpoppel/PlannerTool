"""Unit tests for AzureWikiEventBackend.

Uses MagicMock to stub out the ADO wiki client — no real ADO connection needed.
"""
from __future__ import annotations

import json
import re
from unittest.mock import MagicMock, patch, PropertyMock
import pytest

from planner_lib.azure.wiki_events import AzureWikiEventBackend


_CRED = {'token': 'test-pat', 'user_id': 'user@example.com'}

_ORG = 'my-org'
_PROJECT = 'MyProject'
_WIKI_ID = 'MyProject.wiki'
_PAGE_PATH = '/PlannerTool/Events'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_backend(org=_ORG, project=_PROJECT, wiki_id=_WIKI_ID, page_path=_PAGE_PATH):
    class _FakeProjectRepo:
        def get_project_map(self):
            return [
                {"id": "plan-1", "name": "Plan 1"},
                {"id": "plan-2", "name": "Plan 2"},
                {"id": "p", "name": "P"},
                {"id": "us", "name": "US"},
            ]

    return AzureWikiEventBackend(
        organization_url=org,
        project=project,
        wiki_id=wiki_id,
        page_path=page_path,
        project_repository=_FakeProjectRepo(),
    )


# ---------------------------------------------------------------------------
# Missing-config guard in _get_wiki_client
# ---------------------------------------------------------------------------

class TestMissingConfig:
    def test_empty_org_url_raises_runtime_error_on_first_use(self):
        """Backend with no org URL configured raises RuntimeError (not silent)."""
        b = _make_backend(org='')
        with pytest.raises(RuntimeError, match="organization URL"):
            b.fetch_events(credential=_CRED)

    def test_empty_project_raises_runtime_error(self):
        b = _make_backend(project='')
        with pytest.raises(RuntimeError, match="project"):
            b.fetch_events(credential=_CRED)

    def test_empty_wiki_id_raises_runtime_error(self):
        b = _make_backend(wiki_id='')
        with pytest.raises(RuntimeError, match="wiki_id"):
            b.fetch_events(credential=_CRED)

    def test_no_credential_raises_permission_error_even_with_empty_fields(self):
        b = _make_backend(project='', wiki_id='')
        with pytest.raises(PermissionError):
            b.fetch_events(credential=None)


def _page_response(content: str, etag: str = '"abc123"'):
    """Build a fake wiki page response."""
    resp = MagicMock()
    resp.page.content = content
    resp.eTag = etag
    return resp


def _empty_page_response():
    return _page_response('', '-1')


def _events_to_content(events: dict) -> str:
    """Render events dict into the wiki page format used by the backend."""
    backend = _make_backend()
    return backend._render_page(events)


# ---------------------------------------------------------------------------
# _parse_events
# ---------------------------------------------------------------------------

class TestParseEvents:
    def test_empty_string_returns_empty_dict(self):
        b = _make_backend()
        assert b._parse_events('') == {}

    def test_parses_valid_data_block(self):
        b = _make_backend()
        events = {'abc': {'id': 'abc', 'date': '2026-05-01', 'title': 'T', 'plan_id': 'p'}}
        content = _events_to_content(events)
        assert b._parse_events(content) == events

    def test_ignores_corrupt_json(self):
        b = _make_backend()
        content = '<!-- planner-tool-events\nnot valid json\n-->'
        assert b._parse_events(content) == {}

    def test_missing_data_block_returns_empty(self):
        b = _make_backend()
        content = '# Some page\nNo data block here.'
        assert b._parse_events(content) == {}


# ---------------------------------------------------------------------------
# _render_page
# ---------------------------------------------------------------------------

class TestRenderPage:
    def test_contains_data_block(self):
        b = _make_backend()
        events = {'x1': {'id': 'x1', 'date': '2026-06-01', 'title': 'Go Live', 'plan_id': 'p1'}}
        content = b._render_page(events)
        assert '<!-- planner-tool-events' in content
        assert '"x1"' in content

    def test_empty_events_renders_no_table(self):
        b = _make_backend()
        content = b._render_page({})
        assert '|------|' not in content
        assert 'No events configured' in content

    def test_events_render_as_table_rows(self):
        b = _make_backend()
        events = {
            'a': {'id': 'a', 'date': '2026-05-01', 'title': 'Release', 'plan_id': 'plan-1'},
            'b': {'id': 'b', 'date': '2026-06-01', 'title': 'Freeze', 'plan_id': 'plan-2'},
        }
        content = b._render_page(events)
        assert '| 2026-05-01 | Release |' in content
        assert '| 2026-06-01 | Freeze |' in content

    def test_render_parse_roundtrip(self):
        b = _make_backend()
        events = {
            'e1': {'id': 'e1', 'date': '2026-07-04', 'title': 'Independence', 'plan_id': 'us'},
        }
        content = b._render_page(events)
        assert b._parse_events(content) == events


# ---------------------------------------------------------------------------
# fetch_events
# ---------------------------------------------------------------------------

class TestFetchEvents:
    def test_no_credential_raises_permission_error(self):
        b = _make_backend()
        with pytest.raises(PermissionError):
            b.fetch_events(credential=None)

    def test_returns_empty_list_when_page_not_found(self):
        b = _make_backend()
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.side_effect = Exception('not found')
            result = b.fetch_events(credential=_CRED)
        assert result == []

    def test_returns_all_events(self):
        b = _make_backend()
        events = {
            'a1': {'id': 'a1', 'date': '2026-01-01', 'title': 'A', 'plan_id': 'p'},
            'a2': {'id': 'a2', 'date': '2026-02-01', 'title': 'B', 'plan_id': 'p'},
        }
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.fetch_events(credential=_CRED)
        assert len(result) == 2

    def test_filters_by_plan_id(self):
        b = _make_backend()
        events = {
            'a1': {'id': 'a1', 'date': '2026-01-01', 'title': 'A', 'plan_id': 'plan-1'},
            'a2': {'id': 'a2', 'date': '2026-02-01', 'title': 'B', 'plan_id': 'plan-2'},
        }
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.fetch_events(plan_id='plan-1', credential=_CRED)
        assert len(result) == 1
        assert result[0]['id'] == 'a1'


# ---------------------------------------------------------------------------
# fetch_event
# ---------------------------------------------------------------------------

class TestFetchEvent:
    def test_no_credential_raises(self):
        b = _make_backend()
        with pytest.raises(PermissionError):
            b.fetch_event('x', credential=None)

    def test_returns_event_by_id(self):
        b = _make_backend()
        events = {'abc': {'id': 'abc', 'date': '2026-03-01', 'title': 'T', 'plan_id': 'p'}}
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.fetch_event('abc', credential=_CRED)
        assert result['id'] == 'abc'

    def test_raises_key_error_for_missing_id(self):
        b = _make_backend()
        content = b._render_page({})
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            with pytest.raises(KeyError):
                b.fetch_event('missing', credential=_CRED)


# ---------------------------------------------------------------------------
# create_event
# ---------------------------------------------------------------------------

class TestCreateEvent:
    def test_no_credential_raises(self):
        b = _make_backend()
        with pytest.raises(PermissionError):
            b.create_event('2026-01-01', 'T', 'p', credential=None)

    def test_creates_event_and_returns_it(self):
        b = _make_backend()
        content = b._render_page({})
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.create_event('2026-05-01', 'Release', 'plan-1', credential=_CRED)
        assert result['date'] == '2026-05-01'
        assert result['title'] == 'Release'
        assert result['plan_id'] == 'plan-1'
        assert 'id' in result

    def test_write_called_with_updated_content(self):
        b = _make_backend()
        content = b._render_page({})
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content, '"v1"')
            b.create_event('2026-05-01', 'Event', 'p', credential=_CRED)
            # create_or_update_page must be called once
            assert mock_wc.return_value.create_or_update_page.call_count == 1
            call_kwargs = mock_wc.return_value.create_or_update_page.call_args
            assert call_kwargs.kwargs.get('version') == '"v1"' or call_kwargs.args[4] == '"v1"'


# ---------------------------------------------------------------------------
# update_event
# ---------------------------------------------------------------------------

class TestUpdateEvent:
    def test_no_credential_raises(self):
        b = _make_backend()
        with pytest.raises(PermissionError):
            b.update_event('x', credential=None)

    def test_raises_key_error_when_event_missing(self):
        b = _make_backend()
        content = b._render_page({})
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            with pytest.raises(KeyError):
                b.update_event('missing', date='2026-01-01', credential=_CRED)

    def test_updates_date(self):
        b = _make_backend()
        events = {'e1': {'id': 'e1', 'date': '2026-01-01', 'title': 'T', 'plan_id': 'p'}}
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.update_event('e1', date='2026-12-31', credential=_CRED)
        assert result['date'] == '2026-12-31'
        assert result['title'] == 'T'  # unchanged

    def test_updates_title(self):
        b = _make_backend()
        events = {'e1': {'id': 'e1', 'date': '2026-01-01', 'title': 'Old', 'plan_id': 'p'}}
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.update_event('e1', title='New', credential=_CRED)
        assert result['title'] == 'New'

    def test_updates_plan_id(self):
        b = _make_backend()
        events = {'e1': {'id': 'e1', 'date': '2026-01-01', 'title': 'T', 'plan_id': 'old-plan'}}
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.update_event('e1', plan_id='new-plan', credential=_CRED)
        assert result['plan_id'] == 'new-plan'


# ---------------------------------------------------------------------------
# delete_event
# ---------------------------------------------------------------------------

class TestDeleteEvent:
    def test_no_credential_raises(self):
        b = _make_backend()
        with pytest.raises(PermissionError):
            b.delete_event('x', credential=None)

    def test_returns_false_when_event_missing(self):
        b = _make_backend()
        content = b._render_page({})
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.delete_event('not-there', credential=_CRED)
        assert result is False

    def test_returns_true_and_removes_event(self):
        b = _make_backend()
        events = {'e1': {'id': 'e1', 'date': '2026-01-01', 'title': 'T', 'plan_id': 'p'}}
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            # First call (read) returns page with event; after delete write happens
            mock_wc.return_value.get_page.return_value = _page_response(content)
            result = b.delete_event('e1', credential=_CRED)
        assert result is True
        # Verify write was called
        assert mock_wc.return_value.create_or_update_page.call_count == 1

    def test_write_does_not_contain_deleted_event(self):
        b = _make_backend()
        events = {'e1': {'id': 'e1', 'date': '2026-01-01', 'title': 'Remove Me', 'plan_id': 'p'}}
        content = b._render_page(events)
        with patch.object(b, '_get_wiki_client') as mock_wc:
            mock_wc.return_value.get_page.return_value = _page_response(content)
            b.delete_event('e1', credential=_CRED)
            written_params = mock_wc.return_value.create_or_update_page.call_args.kwargs.get('parameters') \
                or mock_wc.return_value.create_or_update_page.call_args.args[0]
        assert 'Remove Me' not in written_params.content
