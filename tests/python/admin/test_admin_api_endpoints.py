"""Team and system configuration handlers honor the admin-service boundary."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from planner_lib.admin import api as admin_api


@pytest.mark.parametrize('get_handler, save_handler, config_key', [
    (admin_api.admin_get_teams, admin_api.admin_save_teams, 'teams'),
    (admin_api.admin_get_system, admin_api.admin_save_system, 'server_config'),
])
def test_configuration_handlers_forward_content(get_handler, save_handler, config_key):
    service = SimpleNamespace(
        get_config=Mock(return_value=''), save_config=Mock(),
        reload_config=Mock(), invalidate_cache=Mock(),
    )
    container = SimpleNamespace(get=lambda name: service)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(container=container)))

    missing = asyncio.run(get_handler.__wrapped__(request))
    assert missing['content'] == ''
    service.get_config.assert_called_once_with(config_key, default='')

    service.get_config.return_value = 'configured-text'
    configured = asyncio.run(get_handler.__wrapped__(request))
    assert configured['content'] == 'configured-text'

    async def read_payload():
        return {'content': json.dumps({'configured': True})}

    request.json = read_payload
    saved = asyncio.run(save_handler.__wrapped__(request))
    assert saved['ok'] is True
    service.save_config.assert_called_once_with(config_key, json.dumps({'configured': True}))