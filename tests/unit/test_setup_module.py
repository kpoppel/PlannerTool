import pytest

from planner_lib import setup as setup_mod


def test_setup_loads_existing_config():
    """setup() returns 0 when the config key already exists in storage."""
    class Store:
        def load(self, namespace, key):
            return {'cfg': True}

    rc = setup_mod.setup([], Store(), 'ns', 'key')
    assert rc == 0


def test_setup_missing_config_prints_and_returns_2(capsys):
    """setup() prints a helpful message and returns 2 when config is absent."""
    class Store:
        def load(self, namespace, key):
            raise FileNotFoundError()

    rc = setup_mod.setup([], Store(), 'ns', 'key')
    captured = capsys.readouterr()
    assert 'Server configuration missing' in captured.out
    assert rc == 2

