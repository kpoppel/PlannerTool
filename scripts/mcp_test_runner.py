#!/usr/bin/env python3
"""Token-lean local test runner exposed as an MCP stdio server.

Runs pytest, vitest and playwright with JUnit reporters and returns compact
summaries: counts, failing test ids and trimmed error excerpts. Full logs and
reports are kept under .test-runs/ for on-demand inspection.

MCP server:  .venv/bin/python scripts/mcp_test_runner.py
CLI:         .venv/bin/python scripts/mcp_test_runner.py --cli vitest tests/core/foo.test.js
"""
from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import signal
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
FRAMEWORKS = ('pytest', 'vitest', 'playwright')
DEFAULT_TIMEOUTS = {'pytest': 900, 'vitest': 900, 'playwright': 1800}
DEFAULT_PLAYWRIGHT_CONFIG = 'tests/playwright.config.js'
ANSI_RE = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
NOISE_RE = re.compile(r'node_modules|site-packages|<frozen |node:internal')
MAX_WAIT_SECONDS = 1800


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
        self._lock = threading.Lock()
        self._seq = 0
        self._results: dict[str, RunResult] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._procs: dict[str, subprocess.Popen] = {}

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

    def build_command(self, framework: str, targets: list[str], test_name: str | None,
                      bail: bool, playwright_config: str | None) -> tuple[list[str], dict[str, str]]:
        if framework not in FRAMEWORKS:
            raise ValueError(f'Unknown framework {framework!r}; expected one of {FRAMEWORKS}')
        for target in targets:
            self._validate_target(target)
        if test_name is not None and (not test_name or test_name.startswith('-')):
            raise ValueError(f'Invalid test_name {test_name!r}')
        junit = str(self.out_dir / f'{framework}.xml')
        env: dict[str, str] = {}
        if framework == 'pytest':
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
            cmd = [self._npx(), 'playwright', 'test', '-c', config, *targets, '--reporter=line,junit']
            if test_name:
                cmd += ['-g', test_name]
            if bail:
                cmd.append('-x')
            env = {'PLAYWRIGHT_JUNIT_OUTPUT_NAME': junit}
        return cmd, env

    # ---- execution ------------------------------------------------------------

    def start(self, framework: str, targets: list[str] | None = None, test_name: str | None = None,
              bail: bool = False, playwright_config: str | None = None, timeout: int | None = None,
              extra_args: list[str] | None = None) -> RunResult:
        cmd, env = self.build_command(framework, list(targets) if targets else [], test_name, bail,
                                      playwright_config)
        if extra_args:
            cmd += extra_args
        with self._lock:
            if framework in self._threads and self._threads[framework].is_alive():
                raise ValueError(f'{framework} run #{self._results[framework].run_id} is still running; '
                                 'use get_status(wait_seconds=...) or cancel_run')
            self._seq += 1
            result = RunResult(self._seq, framework, cmd, time.time())
            self._results[framework] = result
            thread = threading.Thread(
                target=self._execute,
                args=(result, env, DEFAULT_TIMEOUTS[framework] if timeout is None else timeout),
                daemon=True,
            )
            self._threads[framework] = thread
            thread.start()
        return result

    def _execute(self, result: RunResult, extra_env: dict[str, str], timeout: int) -> None:
        self.out_dir.mkdir(exist_ok=True)
        junit = self.out_dir / f'{result.framework}.xml'
        junit.unlink(missing_ok=True)
        env = {**os.environ, **extra_env, 'FORCE_COLOR': '0', 'NO_COLOR': '1'}
        with self.log_path(result.framework).open('w') as log:
            log.write(f'$ {shlex.join(result.command)}\n')
            log.flush()
            # stdin must not inherit the MCP protocol channel.
            proc = subprocess.Popen(result.command, cwd=self.root, env=env, stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            self._procs[result.framework] = proc
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
        elif result.failures:
            result.status = 'FAILED'
        else:
            result.status = 'ERROR'

    def cancel(self, framework: str) -> str:
        thread = self._threads.get(framework)
        if thread is None or not thread.is_alive():
            return f'{framework}: nothing running'
        self._results[framework].status = 'CANCELLING'
        os.killpg(self._procs[framework].pid, signal.SIGTERM)
        thread.join(30)
        return f'{framework} run #{self._results[framework].run_id} cancelled'

    def wait(self, framework: str, seconds: float) -> None:
        thread = self._threads.get(framework)
        if thread is not None:
            thread.join(min(seconds, MAX_WAIT_SECONDS))

    def result(self, framework: str) -> RunResult | None:
        return self._results.get(framework)

    def log_path(self, framework: str) -> Path:
        return self.out_dir / f'{framework}.log'

    def rerun_args(self, framework: str) -> tuple[list[str], list[str]]:
        """Return (targets, extra_args) that re-run the last failures."""
        last = self._results.get(framework)
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
            last = tail(self.log_path(fw), 1)
            progress = f'\nlast log line: {last[0][:200]}' if last else ''
            return (f'{fw} RUNNING run #{result.run_id} ({time.time() - result.started:.0f}s elapsed)'
                    f'{progress}')
        out = [f'{fw} {result.status} run #{result.run_id}: {result.total} tests, {result.failed} failed, '
               f'{result.skipped} skipped ({result.duration:.1f}s, exit {result.exit_code})']
        if result.note:
            out.append(f'note: {result.note}')
        for failure in result.failures[:max_failures]:
            out.append(f'✗ {failure.test_id}')
            out += [f'  {ln}' for ln in excerpt(failure, fw, excerpt_lines)]
        if len(result.failures) > max_failures:
            out.append(f'… +{len(result.failures) - max_failures} more failures (get_failures)')
        if result.status in ('ERROR', 'TIMEOUT'):
            out.append(f'--- log tail ({self.log_path(fw).relative_to(self.root)}) ---')
            out += tail(self.log_path(fw), log_lines)
        return '\n'.join(out)

    def format_failures(self, framework: str, match: str | None, lines: int, limit: int = 10) -> str:
        result = self._results.get(framework)
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

Framework = Literal['pytest', 'vitest', 'playwright']


def build_server(runner: Runner) -> MCPServer:
    # Sync tools run in worker threads, so blocking runs don't stall pings or status queries.
    # structured_output=False: plain text only, avoiding a duplicated JSON copy of each result.
    mcp = MCPServer('plannertool-tests', instructions=(
        'Run project tests with compact output. Prefer narrow targets during TDD; use get_failures/get_log '
        'only when the summary is insufficient. Full logs: .test-runs/<framework>.log'))

    def checked(call):
        try:
            return call()
        except ValueError as exc:
            raise ToolError(str(exc)) from exc

    def finish(result: RunResult, wait: bool, max_failures: int = 5) -> str:
        if not wait:
            return f'{result.framework} run #{result.run_id} started; poll with get_status'
        runner.wait(result.framework, MAX_WAIT_SECONDS)
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
            description='Block until finished. false = run in background; poll with get_status.')] = True,
        timeout_seconds: Annotated[int | None, Field(ge=1)] = None,
        max_failures: Annotated[int, Field(ge=0, description='Failures to show.')] = 5,
    ) -> str:
        """Run pytest, vitest or playwright. Returns counts, failing test ids and short error excerpts
        (log tail only on crashes)."""
        result = checked(lambda: runner.start(framework, targets, test_name, bail, playwright_config,
                                              timeout_seconds))
        return finish(result, wait, max_failures)

    @mcp.tool(structured_output=False)
    def rerun_failed(framework: Framework, wait: bool = True) -> str:
        """Re-run only the tests that failed in the last run of a framework."""
        def start() -> RunResult:
            targets, extra = runner.rerun_args(framework)
            config = None
            if framework == 'playwright':
                previous = runner.result(framework).command
                config = previous[previous.index('-c') + 1]
            return runner.start(framework, targets, None, False, config, None, extra)
        return finish(checked(start), wait)

    @mcp.tool(structured_output=False)
    def get_status(
        framework: Annotated[Framework | None, Field(description='Omit for one line per framework.')] = None,
        wait_seconds: Annotated[float, Field(ge=0, description='Block until the run finishes or this elapses.')] = 0,
    ) -> str:
        """Status of the latest run: one line per framework, or the full summary for one framework."""
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
    def get_failures(
        framework: Framework,
        filter: Annotated[str | None, Field(description='Substring of the test id.')] = None,
        lines: Annotated[int, Field(ge=1, description='Lines per failure.')] = 30,
    ) -> str:
        """Longer error excerpts for failures of the latest run."""
        return runner.format_failures(framework, filter, lines)

    @mcp.tool(structured_output=False)
    def get_log(
        framework: Framework,
        lines: Annotated[int, Field(ge=1)] = 40,
        grep: Annotated[str | None, Field(description='Case-insensitive regex filter.')] = None,
    ) -> str:
        """Tail of the raw log of the latest run."""
        found = tail(runner.log_path(framework), lines, grep)
        return '\n'.join(found) if found else f'{framework}: no log output'

    @mcp.tool(structured_output=False)
    def cancel_run(framework: Framework) -> str:
        """Stop a running test process."""
        return runner.cancel(framework)

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
    runner = Runner()
    if args.cli is None:
        build_server(runner).run('stdio')
        return 0
    result = runner.start(args.cli, args.targets, args.test_name, args.bail, args.playwright_config)
    runner.wait(args.cli, MAX_WAIT_SECONDS)
    print(runner.format(result))
    return 0 if result.status == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
