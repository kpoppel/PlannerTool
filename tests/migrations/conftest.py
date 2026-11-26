import pytest

from planner_lib.database.config_repository import PROJECTIONS
from planner_lib.migrations.contracts import NO_PAT_REVISION, schema_state


@pytest.fixture
def pre_normalization_storage():
    def prepare(handle, revision):
        raw = handle.storage.retained
        for key in PROJECTIONS:
            if handle.storage.exists('config', key):
                raw.save('config', key, handle.storage.load('config', key))
        policy = handle.storage.load('config', 'authentication')
        if revision < NO_PAT_REVISION and policy['backend_credentials'] == 'none':
            # Before revision 49 a policy without delegation held 'pat'.
            raw.save('config', 'authentication', {**policy, 'backend_credentials': 'pat'})
        raw.save('system', 'schema_state', schema_state(revision, initialized=True))
        return raw

    return prepare