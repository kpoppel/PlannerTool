import importlib.util
import json
import logging
import sys
from pathlib import Path

import anyio
import pytest
from mcp import Client, StdioServerParameters

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts' / 'mcp_test_runner.py'
_spec = importlib.util.spec_from_file_location('mcp_test_runner', SCRIPT)
mtr = importlib.util.module_from_spec(_spec)
sys.modules['mcp_test_runner'] = mtr
_spec.loader.exec_module(mtr)


def test_parse_junit_counts_failures_errors_and_skips(tmp_path):
    report = tmp_path / 'r.xml'
    report.write_text(
        '<testsuites><testsuite>'
        '<testcase classname="tests/a.test.js" name="ok"/>'
        '<testcase classname="tests/a.test.js" name="bad"><failure message="expected 1">AssertionError: expected 1'
        '\n at node_modules/x.js:1\n at tests/a.test.js:5</failure></testcase>'
        '<testcase classname="tests/b.test.js" name="boom"><error message="TypeError"/></testcase>'
        '<testcase classname="tests/b.test.js" name="skip"><skipped/></testcase>'
        '</testsuite></testsuites>'
    )
    total, skipped, failures = mtr.parse_junit(report)
    assert (total, skipped) == (4, 1)
    assert [f.test_id for f in failures] == ['tests/a.test.js > bad', 'tests/b.test.js > boom']
    assert mtr.excerpt(failures[0], 'vitest', 5) == ['AssertionError: expected 1', ' at tests/a.test.js:5']
    assert mtr.excerpt(failures[1], 'vitest', 5) == ['TypeError']


@pytest.mark.parametrize('target', ['--rootdir=/', '../outside.py', '/etc/passwd'])
def test_build_command_rejects_options_and_paths_outside_workspace(tmp_path, target):
    with pytest.raises(ValueError):
        mtr.Runner(tmp_path).build_command('pytest', [target], None, False, None)


def test_build_command_rejects_project_for_non_playwright_framework(tmp_path):
    with pytest.raises(ValueError, match='only supported for Playwright'):
        mtr.Runner(tmp_path).build_command(
            'pytest', [], None, False, None, project='chromium',
        )


def test_pytest_run_reports_compact_failure_summary(tmp_path):
    (tmp_path / 'test_sample.py').write_text(
        'def test_ok():\n    assert True\n\n'
        'def test_bad():\n    value = 2\n    assert value == 3\n'
    )
    runner = mtr.Runner(tmp_path)
    result = runner.start('pytest', ['test_sample.py'])
    runner.wait('pytest', 120)

    assert (result.status, result.total, result.failed) == ('FAILED', 2, 1)
    summary = runner.format(result)
    assert summary.splitlines()[0].startswith(
        'pytest FAILED run #1: 2 tests, 1 failed, 0 skipped'
    )
    assert 'test_bad' in summary
    assert 'assert 2 == 3' in summary
    assert runner.rerun_args('pytest') == ([], ['--lf'])


def test_failure_summary_keeps_diagnostics_compact_and_details_queryable(tmp_path):
    runner = mtr.Runner(tmp_path)
    result = mtr.RunResult(
        run_id=73, framework='vitest', command=[], started=0, status='FAILED',
        exit_code=1, duration=11.1, total=2, failed=2,
        failures=[
            mtr.Failure(
                test_id='tests/a.test.js > assertion fails', file='tests/a.test.js',
                message='AssertionError: expected false to be true',
                details='AssertionError: expected false to be true\n'
                '  - Expected\n  + Received\n'
                '   at tests/a.test.js:10:5',
            ),
            mtr.Failure(
                test_id='tests/a.test.js > times out', file='tests/a.test.js',
                message='Error: Test timed out in 5000ms.',
                details='Error: Test timed out in 5000ms.\n'
                'If this is a long-running test, pass a timeout value.\n'
                '   at tests/a.test.js:20:5',
            ),
        ],
    )
    runner._history[result.run_id] = result

    summary = runner.format(result)
    details = runner.format_failures('vitest', None, 10, run_id=result.run_id)

    assert summary.splitlines()[0] == (
        'vitest FAILED run #73: 2 tests, 2 failed, 0 skipped (11.1s, exit 1)'
    )
    assert 'assertion fails: AssertionError: expected false to be true' in summary
    assert 'times out: Error: Test timed out in 5000ms.' in summary
    assert 'Expected' not in summary
    assert 'at tests/a.test.js' not in summary
    assert 'details: get_failures(framework="vitest", run_id=73)' in summary
    assert 'at tests/a.test.js:10:5' in details
    assert 'If this is a long-running test' in details


def test_mcp_tools_list_status_and_rejected_target(tmp_path):
    async def scenario():
        async with Client(mtr.build_server(mtr.Runner(tmp_path))) as client:
            tools = {t.name: t for t in (await client.list_tools()).tools}
            status = await client.call_tool('get_status', {})
            rejected = await client.call_tool('run_tests', {'framework': 'pytest', 'targets': ['-x']})
            return tools, status, rejected

    tools, status, rejected = anyio.run(scenario)

    assert set(tools) == {
        'run_tests', 'rerun_failed', 'get_status', 'list_runs', 'get_failures', 'get_log', 'cancel_run',
    }
    assert tools['run_tests'].input_schema['properties']['framework']['enum'] == [
        'pytest', 'vitest', 'playwright', 'build',
    ]
    assert 'project' in tools['run_tests'].input_schema['properties']
    assert status.content[0].text.splitlines()[0] == 'pytest: no runs yet'
    assert status.structured_content is None
    assert rejected.is_error is True
    assert 'must be a path or test id' in rejected.content[0].text


def test_mcp_stdio_server_starts(tmp_path):
    config_path = SCRIPT.parents[1] / '.mcp.json'
    server = json.loads(config_path.read_text())['mcpServers']['plannertool-tests']

    async def scenario():
        params = StdioServerParameters(command=server['command'], args=server['args'])
        async with Client(params) as client:
            return (await client.call_tool('get_status', {'framework': 'vitest'})).content[0].text

    assert anyio.run(scenario).startswith('vitest')


def test_mcp_run_ids_keep_status_and_failures_after_later_runs(tmp_path):
    (tmp_path / 'test_sample.py').write_text('def test_bad():\n    assert 2 == 3\n')
    runner = mtr.Runner(tmp_path)

    async def scenario():
        async with Client(mtr.build_server(runner)) as client:
            first = await client.call_tool('run_tests', {
                'framework': 'pytest', 'targets': ['test_sample.py'], 'wait': False,
            })
            first_status = await client.call_tool('get_status', {'run_id': 1, 'wait_seconds': 120})
            second = await client.call_tool('run_tests', {
                'framework': 'pytest', 'targets': ['test_sample.py'],
            })
            old_status = await client.call_tool('get_status', {'run_id': 1})
            old_failures = await client.call_tool('get_failures', {
                'framework': 'pytest', 'run_id': 1,
            })
            old_log = await client.call_tool('get_log', {
                'framework': 'pytest', 'run_id': 1,
            })
            recent = await client.call_tool('list_runs', {'framework': 'pytest'})
            return first, first_status, second, old_status, old_failures, old_log, recent

    first, first_status, second, old_status, old_failures, old_log, recent = anyio.run(scenario)

    assert first.content[0].text == 'pytest run #1 started; poll with get_status(run_id=1)'
    assert first_status.content[0].text.startswith('pytest FAILED run #1:')
    assert second.content[0].text.startswith('pytest FAILED run #2:')
    assert old_status.content[0].text.startswith('pytest FAILED run #1:')
    assert 'test_bad' in old_failures.content[0].text
    assert 'pytest-1.xml' in old_log.content[0].text
    assert 'pytest-2.xml' not in old_log.content[0].text
    assert 'pytest FAILED run #2:' in recent.content[0].text
    assert 'pytest FAILED run #1:' in recent.content[0].text


def test_runner_history_survives_sequential_cli_processes(tmp_path):
    (tmp_path / 'test_sample.py').write_text('def test_ok():\n    assert True\n')
    first_runner = mtr.Runner(tmp_path)
    first = first_runner.start('pytest', ['test_sample.py'])
    first_runner.wait('pytest', 120)

    second_runner = mtr.Runner(tmp_path)
    second = second_runner.start('pytest', ['test_sample.py'])
    second_runner.wait('pytest', 120)

    reopened_runner = mtr.Runner(tmp_path)

    assert (first.run_id, second.run_id) == (1, 2)
    assert reopened_runner.result('pytest', first.run_id).status == 'PASSED'
    assert reopened_runner.result('pytest', second.run_id).status == 'PASSED'
    assert [result.run_id for result in reopened_runner.runs('pytest')] == [2, 1]
    assert reopened_runner.log_path('pytest', first.run_id).exists()
    assert reopened_runner.log_path('pytest', second.run_id).exists()


def test_stale_runner_keeps_unique_ids_after_another_process_runs(tmp_path):
    (tmp_path / 'test_sample.py').write_text('def test_ok():\n    assert True\n')
    long_lived_runner = mtr.Runner(tmp_path)
    first = long_lived_runner.start('pytest', ['test_sample.py'])
    long_lived_runner.wait('pytest', 120, first.run_id)

    cli_runner = mtr.Runner(tmp_path)
    second = cli_runner.start('pytest', ['test_sample.py'])
    cli_runner.wait('pytest', 120, second.run_id)

    third = long_lived_runner.start('pytest', ['test_sample.py'])
    long_lived_runner.wait('pytest', 120, third.run_id)
    reopened_runner = mtr.Runner(tmp_path)

    assert [first.run_id, second.run_id, third.run_id] == [1, 2, 3]
    assert [result.run_id for result in reopened_runner.runs('pytest')] == [3, 2, 1]
    assert all(reopened_runner.result('pytest', run_id).status == 'PASSED' for run_id in (1, 2, 3))


def test_mcp_allows_parallel_runs_for_the_same_framework(tmp_path):
    for name in ('first', 'second'):
        (tmp_path / f'test_{name}.py').write_text(
            f'import time\n\ndef test_{name}():\n    time.sleep(2)\n'
        )
    runner = mtr.Runner(tmp_path)

    async def scenario():
        async with Client(mtr.build_server(runner)) as client:
            first = await client.call_tool('run_tests', {
                'framework': 'pytest', 'targets': ['test_first.py'], 'wait': False,
            })
            second = await client.call_tool('run_tests', {
                'framework': 'pytest', 'targets': ['test_second.py'], 'wait': False,
            })
            first_status = await client.call_tool('get_status', {'run_id': 1, 'wait_seconds': 120})
            second_status = await client.call_tool('get_status', {'run_id': 2, 'wait_seconds': 120})
            return first, second, first_status, second_status

    first, second, first_status, second_status = anyio.run(scenario)

    assert first.content[0].text.startswith('pytest run #1 started;')
    assert second.is_error is False
    assert second.content[0].text.startswith('pytest run #2 started;')
    assert first_status.content[0].text.startswith('pytest PASSED run #1:')
    assert second_status.content[0].text.startswith('pytest PASSED run #2:')


def test_playwright_runs_receive_distinct_server_ports_and_output_dirs(tmp_path):
    config_dir = tmp_path / 'tests'
    config_dir.mkdir()
    (config_dir / 'playwright.frontend.config.js').touch()
    runner = mtr.Runner(tmp_path)
    first_command, first_env = runner.build_command(
        'playwright', [], None, False, 'tests/playwright.frontend.config.js', 1,
    )
    second_command, second_env = runner.build_command(
        'playwright', [], None, False, 'tests/playwright.frontend.config.js', 2,
    )

    assert first_env['PLANNER_PLAYWRIGHT_PORT'] != second_env['PLANNER_PLAYWRIGHT_PORT']
    assert str(tmp_path / '.test-runs' / 'playwright-output-1') in first_command
    assert str(tmp_path / '.test-runs' / 'playwright-output-2') in second_command
    for reservation in runner._port_reservations.values():
        reservation.close()


def test_playwright_project_is_applied_to_command_and_selection(tmp_path):
    config_dir = tmp_path / 'tests'
    config_dir.mkdir()
    (config_dir / 'playwright.config.js').touch()
    runner = mtr.Runner(tmp_path)

    command, _ = runner.build_command(
        'playwright', ['tests/e2e/release-notes.spec.js'], 'release and enrollment guides',
        False, 'tests/playwright.config.js', 1, project='chromium',
    )
    result = mtr.RunResult(
        run_id=1, framework='playwright', command=command, started=0,
    )

    assert command[command.index('--project') + 1] == 'chromium'
    assert 'project chromium' in runner.describe_selection(result)


def test_run_details_go_to_server_log_not_mcp_summary(tmp_path, caplog):
    (tmp_path / 'test_sample.py').write_text('def test_ok():\n    assert True\n')
    caplog.set_level(logging.INFO)
    runner = mtr.Runner(tmp_path)

    result = runner.start('pytest', ['test_sample.py'])
    runner.wait('pytest', 120, result.run_id)
    summary = runner.format(result)

    assert 'Starting pytest run #1: test_sample.py' in caplog.text
    assert 'Finished pytest run #1: PASSED' in caplog.text
    assert summary.startswith('pytest PASSED run #1: 1 tests, 0 failed, 0 skipped')
    assert 'test_sample.py' not in summary


def test_server_logging_uses_file_handler(tmp_path, capsys):
    logger = mtr.LOGGER
    original_handlers = logger.handlers[:]
    original_propagate = logger.propagate
    for handler in original_handlers:
        logger.removeHandler(handler)
    log_path = tmp_path / 'mcp-server.log'

    try:
        mtr.configure_logging(log_path)
        logger.info('Server lifecycle event')
        for handler in logger.handlers:
            handler.flush()

        assert log_path.read_text().endswith('Server lifecycle event\n')
        assert len(logger.handlers) == 2
        assert any(isinstance(handler, logging.FileHandler) for handler in logger.handlers)
        assert any(type(handler) is logging.StreamHandler for handler in logger.handlers)
        assert 'Server lifecycle event' in capsys.readouterr().err
    finally:
        for handler in logger.handlers[:]:
            logger.removeHandler(handler)
            handler.close()
        for handler in original_handlers:
            logger.addHandler(handler)
        logger.propagate = original_propagate


def test_build_check_uses_fixed_npm_script_and_compact_summary(tmp_path):
    runner = mtr.Runner(tmp_path)
    command, env = runner.build_command('build', [], None, False, None, 1)
    result = mtr.RunResult(
        run_id=1, framework='build', command=command, started=0,
        status='PASSED', exit_code=0, duration=0.6,
    )

    assert command[-2:] == ['run', 'build']
    assert env == {}
    assert runner.describe_selection(result) == 'npm run build'
    assert runner.format(result) == 'build PASSED run #1 (0.6s, exit 0)'
