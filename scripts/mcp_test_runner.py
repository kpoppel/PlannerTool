#!/usr/bin/env python3
"""Token-lean local test runner exposed as an MCP stdio server.

Runs pytest, vitest and playwright with JUnit reporters, plus the fixed npm build
check. Returns compact summaries and keeps logs/reports under .test-runs/.

MCP server:  .venv/bin/python scripts/mcp_test_runner.py
CLI:         .venv/bin/python scripts/mcp_test_runner.py --cli vitest tests/core/foo.test.js
"""
from __future__ import annotations

import argparse
from contextlib import closing
import json
import logging
import os
import re
import shlex
import shutil
import signal
import sqlite3
import socket
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

ROOT = Path(__file__).resolve().parent.parent
FRAMEWORKS = ('pytest', 'vitest', 'playwright', 'build')
DEFAULT_TIMEOUTS = {'pytest': 900, 'vitest': 900, 'playwright': 1800, 'build': 600}
DEFAULT_PLAYWRIGHT_CONFIG = 'tests/playwright.config.js'
ANSI_RE = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
NOISE_RE = re.compile(r'node_modules|site-packages|<frozen |node:internal')
MAX_WAIT_SECONDS = 1800
MAX_RUN_LIST = 20
LOGGER = logging.getLogger('planner_test_runner')


def configure_logging(log_file: Path | None = None) -> None:
    if not LOGGER.handlers:
        handlers = [logging.StreamHandler(sys.stderr)]
        if log_file is not None:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            handlers.append(logging.FileHandler(log_file))
        for handler in handlers:
            handler.setFormatter(logging.Formatter(
                '%(asctime)s.%(msecs)03d [%(levelname)s] %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S',
            ))
            LOGGER.addHandler(handler)
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False


@dataclass
class Failure:
    test_id: str
    file: str
    message: str
    details: str


@dataclass
class RunResult:
    run_id: int
    framework: str
    command: list[str]
    started: float
    status: str = 'RUNNING'  # RUNNING | PASSED | FAILED | ERROR | TIMEOUT | CANCELLED
    exit_code: int | None = None
    duration: float = 0.0
    total: int = 0
    failed: int = 0
    skipped: int = 0
    failures: list[Failure] = field(default_factory=list)
    note: str = ''


def _clean(text: str) -> str:
    return ANSI_RE.sub('', text)


def parse_junit(path: Path) -> tuple[int, int, list[Failure]]:
    """Return (total, skipped, failures) from a JUnit XML report of any of the three frameworks."""
    total = skipped = 0
    failures: list[Failure] = []
    for case in ET.parse(path).getroot().iter('testcase'):
        total += 1
        if case.find('skipped') is not None:
            skipped += 1
            continue
        problem = case.find('failure')
        if problem is None:
            problem = case.find('error')
        if problem is None:
            continue
        classname = case.get('classname', '')
        name = case.get('name', '')
        failures.append(Failure(
            test_id=f'{classname} > {name}' if classname else name,
            file=case.get('file', classname),
            message=_clean(problem.get('message', '')),
            details=_clean(problem.text if problem.text is not None else ''),
        ))
    return total, skipped, failures


def excerpt(failure: Failure, framework: str, max_lines: int) -> list[str]:
    text = failure.details if failure.details.strip() else failure.message
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip() and not NOISE_RE.search(ln)]
    # pytest tracebacks end with the assertion ("E ..." lines); JS reporters lead with it.
    return lines[-max_lines:] if framework == 'pytest' else lines[:max_lines]


def tail(path: Path, lines: int, grep: str | None = None) -> list[str]:
    if not path.exists():
        return []
    content = _clean(path.read_text(errors='replace')).splitlines()
    if grep:
        pattern = re.compile(grep, re.IGNORECASE)
        content = [ln for ln in content if pattern.search(ln)]
    return content[-lines:]


class Runner:
    def __init__(self, root: Path = ROOT):
        self.root = root.resolve()
        self.out_dir = self.root / '.test-runs'
        self.history_path = self.out_dir / 'history.sqlite3'
        self.legacy_history_path = self.out_dir / 'history.json'
        self._lock = threading.RLock()
        self._seq = 0
        self._results: dict[str, RunResult] = {}
        self._history: dict[int, RunResult] = {}
        self._threads: dict[int, threading.Thread] = {}
        self._threads_by_run: dict[int, threading.Thread] = {}
        self._procs: dict[int, subprocess.Popen] = {}
        self._port_reservations: dict[int, socket.socket] = {}
        self._load_history()

    def _load_history(self) -> None:
        with closing(self._connect_history()) as connection:
            connection.execute(
                'CREATE TABLE IF NOT EXISTS runs (run_id INTEGER PRIMARY KEY, payload TEXT NOT NULL)'
            )
            connection.execute(
                'CREATE TABLE IF NOT EXISTS runner_sequence '
                '(id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL)'
            )
            connection.execute('INSERT OR IGNORE INTO runner_sequence (id, value) VALUES (1, 0)')
            count = connection.execute('SELECT COUNT(*) FROM runs').fetchone()[0]
            if count == 0 and self.legacy_history_path.exists():
                payload = json.loads(self.legacy_history_path.read_text())
                if payload['version'] != 1:
                    raise ValueError(f'Unsupported test-run history version: {payload["version"]}')
                for entry in payload['runs']:
                    connection.execute(
                        'INSERT OR IGNORE INTO runs (run_id, payload) VALUES (?, ?)',
                        (entry['run_id'], json.dumps(entry, separators=(',', ':'))),
                    )
            maximum = connection.execute('SELECT COALESCE(MAX(run_id), 0) FROM runs').fetchone()[0]
            connection.execute(
                'UPDATE runner_sequence SET value=MAX(value, ?) WHERE id=1', (maximum,)
            )
            connection.commit()
        self._refresh_history(mark_abandoned=True)

    def _connect_history(self) -> sqlite3.Connection:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        return sqlite3.connect(self.history_path, timeout=30)

    @staticmethod
    def _serialize_result(result: RunResult) -> str:
        payload = {
            'run_id': result.run_id,
            'framework': result.framework,
            'command': result.command,
            'started': result.started,
            'status': result.status,
            'exit_code': result.exit_code,
            'duration': result.duration,
            'total': result.total,
            'failed': result.failed,
            'skipped': result.skipped,
            'failures': [failure.__dict__ for failure in result.failures],
            'note': result.note,
        }
        return json.dumps(payload, separators=(',', ':'))

    @staticmethod
    def _deserialize_result(payload: str) -> RunResult:
        values = json.loads(payload)
        values['failures'] = [Failure(**failure) for failure in values['failures']]
        return RunResult(**values)

    def _refresh_history(self, mark_abandoned: bool = False) -> None:
        abandoned = []
        with self._lock:
            with closing(self._connect_history()) as connection:
                rows = connection.execute('SELECT run_id, payload FROM runs ORDER BY run_id').fetchall()
            for run_id, payload in rows:
                thread = self._threads_by_run.get(run_id)
                if thread is not None and thread.is_alive():
                    continue
                result = self._deserialize_result(payload)
                if mark_abandoned and result.status in ('RUNNING', 'CANCELLING'):
                    result.status = 'ERROR'
                    result.note = 'Runner process ended before it recorded a final status.'
                    abandoned.append(result)
                self._history[run_id] = result
            self._results = {}
            for result in self._history.values():
                latest = self._results.get(result.framework)
                if latest is None or result.run_id > latest.run_id:
                    self._results[result.framework] = result
            self._seq = max(self._seq, max(self._history, default=0))
            for result in abandoned:
                self._save_history(result)

    def _allocate_run_id(self) -> int:
        with closing(self._connect_history()) as connection:
            connection.execute('BEGIN IMMEDIATE')
            connection.execute('UPDATE runner_sequence SET value=value+1 WHERE id=1')
            run_id = connection.execute('SELECT value FROM runner_sequence WHERE id=1').fetchone()[0]
            connection.commit()
            return run_id

    def _save_history(self, result: RunResult) -> None:
        with closing(self._connect_history()) as connection:
            connection.execute(
                'INSERT OR REPLACE INTO runs (run_id, payload) VALUES (?, ?)',
                (result.run_id, self._serialize_result(result)),
            )
            connection.commit()

    # ---- command construction -------------------------------------------------

    def playwright_configs(self) -> list[str]:
        found = list(self.root.glob('playwright*.config.*')) + list(self.root.glob('tests/playwright*.config.*'))
        return sorted(str(p.relative_to(self.root)) for p in found)

    def _validate_target(self, target: str) -> None:
        if not target or target.startswith('-'):
            raise ValueError(f'Invalid target {target!r}: must be a path or test id, not an option')
        path_part = re.sub(r':\d+(:\d+)?$', '', target.split('::', 1)[0])
        if not (self.root / path_part).resolve().is_relative_to(self.root):
            raise ValueError(f'Invalid target {target!r}: outside the workspace')

    def _npx(self) -> str:
        npx = shutil.which('npx')
        if npx is None:
            raise ValueError('npx not found on PATH')
        return npx

    def _npm(self) -> str:
        npm = shutil.which('npm')
        if npm is None:
            raise ValueError('npm not found on PATH')
        return npm

    def _reserve_playwright_port(self, run_id: int | None) -> int:
        if run_id is None:
            raise ValueError('Playwright runs require a run ID')
        reservation = socket.socket()
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
        self._port_reservations[run_id] = reservation
        return port

    def build_command(self, framework: str, targets: list[str], test_name: str | None,
                      bail: bool, playwright_config: str | None,
                      run_id: int | None = None) -> tuple[list[str], dict[str, str]]:
        if framework not in FRAMEWORKS:
            raise ValueError(f'Unknown framework {framework!r}; expected one of {FRAMEWORKS}')
        for target in targets:
            self._validate_target(target)
        if test_name is not None and (not test_name or test_name.startswith('-')):
            raise ValueError(f'Invalid test_name {test_name!r}')
        junit = str(self.report_path(framework, run_id))
        env: dict[str, str] = {}
        if framework == 'build':
            if targets or test_name is not None or bail or playwright_config is not None:
                raise ValueError('The build check always runs `npm run build` and takes no test filters')
            cmd = [self._npm(), 'run', 'build']
        elif framework == 'pytest':
            cmd = [sys.executable, '-m', 'pytest', *targets, '--tb=short',
                   '-o', 'junit_family=xunit1', f'--junitxml={junit}']
            if test_name:
                cmd += ['-k', test_name]
            if bail:
                cmd.append('-x')
        elif framework == 'vitest':
            cmd = [self._npx(), 'vitest', 'run', *targets, '--reporter=dot', '--reporter=junit',
                   f'--outputFile.junit={junit}']
            if test_name:
                cmd += ['-t', test_name]
            if bail:
                cmd.append('--bail=1')
            env = {'NODE_OPTIONS': '--no-deprecation', 'NODE_ENV': 'production'}
        else:
            config = DEFAULT_PLAYWRIGHT_CONFIG if playwright_config is None else playwright_config
            if config not in self.playwright_configs():
                raise ValueError(f'Unknown playwright config {config!r}; available: {self.playwright_configs()}')
            port = self._reserve_playwright_port(run_id)
            output_dir = self.out_dir / f'playwright-output-{run_id}'
            cmd = [self._npx(), 'playwright', 'test', '-c', config, *targets,
                   '--reporter=line,junit', '--output', str(output_dir)]
            if test_name:
                cmd += ['-g', test_name]
            if bail:
                cmd.append('-x')
            env = {
                'PLAYWRIGHT_JUNIT_OUTPUT_NAME': junit,
                'PLANNER_PLAYWRIGHT_PORT': str(port),
            }
        return cmd, env

    # ---- execution ------------------------------------------------------------

    def start(self, framework: str, targets: list[str] | None = None, test_name: str | None = None,
              bail: bool = False, playwright_config: str | None = None, timeout: int | None = None,
              extra_args: list[str] | None = None) -> RunResult:
        with self._lock:
            self._refresh_history()
            run_id = self._allocate_run_id()
            self._seq = max(self._seq, run_id)
            cmd, env = self.build_command(framework, list(targets) if targets else [], test_name, bail,
                                          playwright_config, run_id)
            if extra_args:
                cmd += extra_args
            result = RunResult(run_id, framework, cmd, time.time())
            self._results[framework] = result
            self._history[run_id] = result
            LOGGER.info('Starting %s run #%d: %s', framework, run_id, self.describe_selection(result))
            self._save_history(result)
            thread = threading.Thread(
                target=self._execute,
                args=(result, env, DEFAULT_TIMEOUTS[framework] if timeout is None else timeout),
                daemon=True,
            )
            self._threads[run_id] = thread
            self._threads_by_run[run_id] = thread
            thread.start()
        return result

    def _execute(self, result: RunResult, extra_env: dict[str, str], timeout: int) -> None:
        self.out_dir.mkdir(exist_ok=True)
        junit = self.report_path(result.framework, result.run_id)
        junit.unlink(missing_ok=True)
        env = {**os.environ, **extra_env, 'FORCE_COLOR': '0', 'NO_COLOR': '1'}
        with self.log_path(result.framework, result.run_id).open('w') as log:
            log.write(f'$ {shlex.join(result.command)}\n')
            log.flush()
            # stdin must not inherit the MCP protocol channel.
            reservation = self._port_reservations.pop(result.run_id, None)
            if reservation is not None:
                reservation.close()
            proc = subprocess.Popen(result.command, cwd=self.root, env=env, stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            self._procs[result.run_id] = proc
            try:
                result.exit_code = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                result.exit_code = proc.wait()
                result.note = f'killed after {timeout}s timeout'
        result.duration = time.time() - result.started
        if junit.exists():
            try:
                result.total, result.skipped, result.failures = parse_junit(junit)
                result.failed = len(result.failures)
            except ET.ParseError as exc:
                result.note = f'could not parse JUnit report: {exc}'
        if result.note.startswith('killed'):
            result.status = 'TIMEOUT'
        elif result.status == 'CANCELLING':
            result.status = 'CANCELLED'
        elif result.exit_code == 0:
            result.status = 'PASSED'
        elif result.failures or result.framework == 'build':
            result.status = 'FAILED'
        else:
            result.status = 'ERROR'
        with self._lock:
            self._save_history(result)
        log_path = self.log_path(result.framework, result.run_id).relative_to(self.root)
        if result.framework == 'build':
            LOGGER.info(
                'Finished build run #%d: %s (%.1fs, exit %s); log=%s',
                result.run_id, result.status, result.duration, result.exit_code, log_path,
            )
        else:
            LOGGER.info(
                'Finished %s run #%d: %s, %d tests, %d failed, %d skipped (%.1fs); log=%s',
                result.framework, result.run_id, result.status, result.total, result.failed,
                result.skipped, result.duration, log_path,
            )

    def cancel(self, framework: str, run_id: int | None = None) -> str:
        result = self.result(framework, run_id)
        if result is None:
            return f'{framework}: no runs yet' if run_id is None else f'run #{run_id}: not found'
        thread = self._threads_by_run.get(result.run_id)
        if thread is None or not thread.is_alive():
            return f'{framework}: nothing running' if run_id is None else f'run #{run_id}: nothing running'
        proc = self._procs.get(result.run_id)
        if proc is None:
            return f'run #{result.run_id} is still starting; retry cancellation'
        result.status = 'CANCELLING'
        os.killpg(proc.pid, signal.SIGTERM)
        thread.join(30)
        return f'{framework} run #{result.run_id} cancelled'

    def wait(self, framework: str, seconds: float, run_id: int | None = None) -> None:
        result = self.result(framework, run_id)
        thread = None if result is None else self._threads_by_run.get(result.run_id)
        if thread is not None:
            thread.join(min(seconds, MAX_WAIT_SECONDS))

    def result(self, framework: str | None = None, run_id: int | None = None) -> RunResult | None:
        self._refresh_history()
        if run_id is None:
            if framework is None:
                raise ValueError('framework or run_id is required')
            return self._results.get(framework)
        result = self._history.get(run_id)
        if result is not None and framework is not None and framework != result.framework:
            raise ValueError(f'run #{run_id} belongs to {result.framework}, not {framework}')
        return result

    def runs(self, framework: str | None = None, limit: int = MAX_RUN_LIST) -> list[RunResult]:
        self._refresh_history()
        history = sorted(self._history.values(), key=lambda result: result.run_id, reverse=True)
        if framework is not None:
            history = [result for result in history if result.framework == framework]
        return history[:limit]

    def log_path(self, framework: str, run_id: int | None = None) -> Path:
        run_suffix = '' if run_id is None else f'-{run_id}'
        return self.out_dir / f'{framework}{run_suffix}.log'

    def report_path(self, framework: str, run_id: int | None = None) -> Path:
        run_suffix = '' if run_id is None else f'-{run_id}'
        return self.out_dir / f'{framework}{run_suffix}.xml'

    def rerun_args(self, framework: str, run_id: int | None = None) -> tuple[list[str], list[str]]:
        """Return (targets, extra_args) that re-run the last failures."""
        last = self.result(framework, run_id)
        if last is None or not last.failures:
            raise ValueError(f'{framework}: no recorded failures to re-run')
        if framework == 'pytest':
            return [], ['--lf']
        if framework == 'vitest':
            return sorted({f.file for f in last.failures}), []
        return [], ['--last-failed']

    # ---- formatting -----------------------------------------------------------

    def format(self, result: RunResult, max_failures: int = 5, excerpt_lines: int = 8,
               log_lines: int = 25) -> str:
        fw = result.framework
        if result.status in ('RUNNING', 'CANCELLING'):
            last = tail(self.log_path(fw, result.run_id), 1)
            progress = f'\nlast log line: {last[0][:200]}' if last else ''
            return (f'{fw} RUNNING run #{result.run_id} '
                    f'({time.time() - result.started:.0f}s elapsed)'
                    f'{progress}')
        if fw == 'build':
            out = [f'build {result.status} run #{result.run_id} '
                   f'({result.duration:.1f}s, exit {result.exit_code})']
        else:
            out = [f'{fw} {result.status} run #{result.run_id}: {result.total} tests, {result.failed} failed, '
                   f'{result.skipped} skipped ({result.duration:.1f}s, exit {result.exit_code})']
        if result.note:
            out.append(f'note: {result.note}')
        for failure in result.failures[:max_failures]:
            out.append(f'✗ {failure.test_id}')
            out += [f'  {ln}' for ln in excerpt(failure, fw, excerpt_lines)]
        if len(result.failures) > max_failures:
            out.append(f'… +{len(result.failures) - max_failures} more failures (get_failures)')
        if result.status in ('ERROR', 'TIMEOUT') or (fw == 'build' and result.status == 'FAILED'):
            log_path = self.log_path(fw, result.run_id)
            out.append(f'--- log tail ({log_path.relative_to(self.root)}) ---')
            out += tail(log_path, min(log_lines, 8) if fw == 'build' else log_lines)
        return '\n'.join(out)

    def describe_selection(self, result: RunResult) -> str:
        command = result.command
        if result.framework == 'build':
            return 'npm run build'
        if result.framework == 'pytest':
            start = command.index('pytest') + 1
            name_flag = '-k'
        elif result.framework == 'vitest':
            start = command.index('run') + 1
            name_flag = '-t'
        else:
            start = command.index('-c') + 2
            name_flag = '-g'
        end = start
        while end < len(command) and not command[end].startswith('-'):
            end += 1
        targets = command[start:end]
        if targets:
            shown_targets = targets[:2]
            selection = ', '.join(shown_targets)
            if len(targets) > len(shown_targets):
                selection += f', +{len(targets) - len(shown_targets)} more'
        else:
            selection = 'full suite'
        if name_flag in command:
            name = command[command.index(name_flag) + 1]
            selection += f' matching {name!r}'
        if result.framework == 'playwright':
            config = command[command.index('-c') + 1]
            selection += f' ({config})'
        return selection

    def format_failures(self, framework: str, match: str | None, lines: int, limit: int = 10,
                        run_id: int | None = None) -> str:
        result = self.result(framework, run_id)
        if result is None:
            return f'{framework}: no runs yet'
        selected = [f for f in result.failures if match is None or match.lower() in f.test_id.lower()]
        if not selected:
            return f'{framework} run #{result.run_id}: no matching failures'
        out = []
        for failure in selected[:limit]:
            out.append(f'✗ {failure.test_id}  [{failure.file}]')
            out += [f'  {ln}' for ln in excerpt(failure, framework, lines)]
        if len(selected) > limit:
            out.append(f'… +{len(selected) - limit} more (narrow with filter)')
        return '\n'.join(out)


# ---- MCP server --------------------------------------------------------------------

Framework = Literal['pytest', 'vitest', 'playwright', 'build']


def build_server(runner: Runner) -> MCPServer:
    # Sync tools run in worker threads, so blocking runs don't stall pings or status queries.
    # structured_output=False: plain text only, avoiding a duplicated JSON copy of each result.
    mcp = MCPServer('plannertool-tests', instructions=(
        'Prefer this MCP runner over command-line test execution so results stay compact. It runs pytest, '
        'Vitest, Playwright, and the fixed npm run build check. Run narrow targets '
        'during TDD; launch independent targets concurrently with wait=false and poll each run_id. Use '
        'list_runs to recover recent IDs, get_failures/get_log for details, rerun_failed for retries, and '
        'cancel_run to stop a run. CLI is for MCP-unavailable cases or unsupported options. '
        'Artifacts: .test-runs/<framework>-<run-id>.{log,xml}'))

    def checked(call):
        try:
            return call()
        except ValueError as exc:
            raise ToolError(str(exc)) from exc

    def finish(result: RunResult, wait: bool, max_failures: int = 5) -> str:
        if not wait:
            return f'{result.framework} run #{result.run_id} started; poll with get_status(run_id={result.run_id})'
        runner.wait(result.framework, MAX_WAIT_SECONDS, result.run_id)
        return runner.format(result, max_failures=max_failures)

    @mcp.tool(structured_output=False)
    def run_tests(
        framework: Framework,
        targets: Annotated[list[str] | None, Field(
            description='Files, dirs or pytest node ids (path::Class::test). Omit for the full suite.')] = None,
        test_name: Annotated[str | None, Field(
            description='Name filter: pytest -k, vitest -t, playwright -g.')] = None,
        bail: Annotated[bool, Field(description='Stop at the first failure.')] = False,
        playwright_config: Annotated[str | None, Field(
            description=f'Playwright config path (default {DEFAULT_PLAYWRIGHT_CONFIG}).')] = None,
        wait: Annotated[bool, Field(
            description='Block until finished. Set false for background or parallel runs; poll by run_id.')]
            = True,
        timeout_seconds: Annotated[int | None, Field(ge=1)] = None,
        max_failures: Annotated[int, Field(ge=0, description='Failures to show.')] = 5,
    ) -> str:
        """Run pytest, Vitest, Playwright, or the fixed npm run build check with compact results."""
        result = checked(lambda: runner.start(framework, targets, test_name, bail, playwright_config,
                                              timeout_seconds))
        return finish(result, wait, max_failures)

    @mcp.tool(structured_output=False)
    def rerun_failed(framework: Framework, run_id: int | None = None, wait: bool = True) -> str:
        """Re-run only the tests that failed in a selected or latest run."""
        def start() -> RunResult:
            previous = runner.result(framework, run_id)
            targets, extra = runner.rerun_args(framework, None if previous is None else previous.run_id)
            config = None
            if framework == 'playwright':
                config = previous.command[previous.command.index('-c') + 1]
            return runner.start(framework, targets, None, False, config, None, extra)
        return finish(checked(start), wait)

    @mcp.tool(structured_output=False)
    def get_status(
        framework: Annotated[Framework | None, Field(
            description='Filter by framework; omit for the all-framework latest view.')] = None,
        run_id: Annotated[int | None, Field(description='Query a specific run instead of the latest.')] = None,
        wait_seconds: Annotated[float, Field(ge=0, description='Block until the run finishes or this elapses.')] = 0,
    ) -> str:
        """Get one run by ID, the latest run for one framework, or latest statuses for all frameworks."""
        if run_id is not None:
            result = checked(lambda: runner.result(framework, run_id))
            if result is None:
                return f'run #{run_id}: not found'
            runner.wait(result.framework, wait_seconds, run_id)
            return runner.format(result)
        if framework is not None:
            runner.wait(framework, wait_seconds)
            result = runner.result(framework)
            return f'{framework}: no runs yet' if result is None else runner.format(result)
        lines = []
        for name in FRAMEWORKS:
            result = runner.result(name)
            lines.append(f'{name}: no runs yet' if result is None
                         else runner.format(result, max_failures=0).splitlines()[0])
        return '\n'.join(lines)

    @mcp.tool(structured_output=False)
    def list_runs(
        framework: Annotated[Framework | None, Field(description='Omit to include every framework.')] = None,
        limit: Annotated[int, Field(ge=1, le=MAX_RUN_LIST, description='Most recent runs to return.')] = 10,
    ) -> str:
        """List recent run IDs and compact outcomes, newest first."""
        results = runner.runs(framework, limit)
        if not results:
            return 'no test runs yet' if framework is None else f'{framework}: no runs yet'
        return '\n'.join(runner.format(result, max_failures=0).splitlines()[0] for result in results)

    @mcp.tool(structured_output=False)
    def get_failures(
        framework: Framework,
        run_id: Annotated[int | None, Field(description='Query a specific run instead of the latest.')] = None,
        filter: Annotated[str | None, Field(description='Substring of the test id.')] = None,
        lines: Annotated[int, Field(ge=1, description='Lines per failure.')] = 30,
    ) -> str:
        """Get longer error excerpts for a selected or latest run."""
        return checked(lambda: runner.format_failures(framework, filter, lines, run_id=run_id))

    @mcp.tool(structured_output=False)
    def get_log(
        framework: Framework,
        run_id: Annotated[int | None, Field(description='Query a specific run instead of the latest.')] = None,
        lines: Annotated[int, Field(ge=1)] = 40,
        grep: Annotated[str | None, Field(description='Case-insensitive regex filter.')] = None,
    ) -> str:
        """Tail the raw log of a selected or latest run."""
        result = checked(lambda: runner.result(framework, run_id))
        if result is None:
            return f'{framework}: no runs yet' if run_id is None else f'run #{run_id}: not found'
        found = tail(runner.log_path(framework, result.run_id), lines, grep)
        return '\n'.join(found) if found else f'{framework}: no log output'

    @mcp.tool(structured_output=False)
    def cancel_run(framework: Framework, run_id: int | None = None) -> str:
        """Stop the selected run, or the latest run for a framework."""
        return checked(lambda: runner.cancel(framework, run_id))

    return mcp


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--cli', metavar='FRAMEWORK', choices=FRAMEWORKS,
                        help='Run once and print the compact summary instead of serving MCP.')
    parser.add_argument('targets', nargs='*')
    parser.add_argument('-k', '--test-name')
    parser.add_argument('-x', '--bail', action='store_true')
    parser.add_argument('-c', '--playwright-config')
    args = parser.parse_args()
    server_log = None if args.cli is not None else ROOT / '.test-runs' / 'mcp-server.log'
    configure_logging(server_log)
    runner = Runner()
    LOGGER.info('Test runner ready: frameworks=%s', ', '.join(FRAMEWORKS))
    if args.cli is None:
        build_server(runner).run('stdio')
        return 0
    result = runner.start(args.cli, args.targets, args.test_name, args.bail, args.playwright_config)
    runner.wait(args.cli, MAX_WAIT_SECONDS)
    print(runner.format(result))
    return 0 if result.status == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
