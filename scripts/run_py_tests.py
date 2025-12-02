import runpy
import sys
print('Running test_health')
runpy.run_path('tests/backend/test_health.py', run_name='__main__')
print('Running test_file_storage')
runpy.run_path('tests/backend/test_file_storage.py', run_name='__main__')
print('All tests ran (assertions raised on failure).')
