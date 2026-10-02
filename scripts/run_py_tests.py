import pytest

raise SystemExit(pytest.main([
	'tests/python/server/test_health.py',
	'tests/python/storage/test_file_storage.py',
]))
