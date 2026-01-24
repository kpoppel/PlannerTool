import pytest

from planner_lib import setup as setup_mod


def test_get_loaded_config_and_flags():
    # create a BackendConfig-like object
    class Dummy:
        def __init__(self):
            self.feature_flags = {'x': True}
            self.some_prop = 'value'

    setup_mod._loaded_config.clear()
    setup_mod._loaded_config.append(Dummy())

    assert setup_mod.get_loaded_config() is not None
    assert setup_mod.has_feature_flag('x') is True
    assert setup_mod.has_feature_flag('missing') is False
    assert setup_mod.get_property('some_prop') == 'value'
    assert setup_mod.get_property('nope') is None


def test_setup_loads_existing_config():
    # Storage stub that returns a BackendConfig-like object
    class Store:
        def load(self, namespace, key):
            return {'cfg': True}

    setup_mod._loaded_config.clear()
    rc = setup_mod.setup([], Store(), 'ns', 'key')
    assert rc == 0
    assert setup_mod.get_loaded_config() == {'cfg': True}


def test_setup_missing_config_prints_and_returns_2(capsys):
    class Store:
        def load(self, namespace, key):
            raise FileNotFoundError()

    setup_mod._loaded_config.clear()
    rc = setup_mod.setup([], Store(), 'ns', 'key')
    captured = capsys.readouterr()
    assert 'Server configuration missing' in captured.out
    assert rc == 2
