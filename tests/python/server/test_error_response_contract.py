"""Internal service errors must not disclose secrets in HTTP responses."""

from unittest.mock import Mock

import pytest

from planner_lib.accounts.config import AccountCredentialsPayload

pytestmark = pytest.mark.real_auth


@pytest.mark.parametrize('method, path, service_name, operation, payload', [
    ('GET', '/api/view', 'view_repository', 'list_views', None),
    ('GET', '/api/scenario', 'scenario_repository', 'list_scenarios', None),
    ('POST', '/api/cost/features', 'cost_service', 'estimate_costs', {'features': []}),
    ('GET', '/api/iterations', 'iteration_repository', 'list_iteration_sets', None),
    ('POST', '/api/cache/invalidate', 'cache_coordinator', 'invalidate_all', {}),
])
def test_service_failure_returns_generic_error(
    client, monkeypatch, method, path, service_name, operation, payload,
):
    assert client.post('/api/auth/enroll', json={
        'email': 'errors@example.com', 'name': 'Error Contract',
    }).status_code == 200
    container = client.app.state.container
    container.get('account_manager').update_credentials(
        AccountCredentialsPayload(email='errors@example.com', pat='test-PAT')
    )
    failure = Mock(side_effect=RuntimeError('private-PAT-secret /private/config.yml'))
    monkeypatch.setattr(container.get(service_name), operation, failure)

    response = client.request(method, path, json=payload)

    failure.assert_called_once()
    assert response.status_code == 500
    assert response.json() == 'Internal server error'
    assert 'private-PAT-secret' not in response.text
    assert '/private/config.yml' not in response.text