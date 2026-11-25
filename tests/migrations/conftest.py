import pytest

from planner_lib.database.config_repository import PROJECTIONS
from planner_lib.migrations.contracts import schema_state


@pytest.fixture
def pre_normalization_storage():
    def prepare(handle, revision):
        raw = handle.storage.retained
        for key in PROJECTIONS:
            if handle.storage.exists('config', key):
                raw.save('config', key, handle.storage.load('config', key))
        raw.save('system', 'schema_state', schema_state(revision, initialized=True))
        return raw

    return prepare