import runpy
import sys
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.info('Running test_health')
runpy.run_path('tests/backend/test_health.py', run_name='__main__')
logger.info('Running test_file_storage')
runpy.run_path('tests/backend/test_file_storage.py', run_name='__main__')
logger.info('All tests ran (assertions raised on failure).')
