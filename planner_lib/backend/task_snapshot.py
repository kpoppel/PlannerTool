"""Complete task snapshots with request-triggered, single-flight refresh."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4

from planner_lib.backend.errors import BackendUnavailableError

logger = logging.getLogger(__name__)
NAMESPACE = 'backend_domain'
SNAPSHOT_KEY = 'fetch_task_context__complete'
META_KEY = 'task_snapshot_metadata'
EPOCH_KEY = 'task_snapshot_epoch'
RETRY_SECONDS = 60


class TaskSnapshot:
    def __init__(self, storage, backend, ttl):
        self._storage = storage
        self._backend = backend
        self._ttl = ttl
        self._state_lock = threading.Lock()
        self._build_lock = threading.Lock()
        self._thread = None
        self._closed = False
        self._served = threading.local()

    def _load(self, key):
        try:
            return self._storage.load(NAMESPACE, key)
        except KeyError:
            return None

    def changed(self):
        self._storage.save(NAMESPACE, EPOCH_KEY, uuid4().hex)

    def _cached(self, identity, guard):
        with guard(), self._storage.transaction():
            metadata = self._load(META_KEY)
            if metadata is None or metadata['identity'] != identity():
                return None, None
            return self._load(SNAPSHOT_KEY), metadata

    def read(self, build, identity, guard, credential):
        tasks, metadata = self._cached(identity, guard)
        if tasks is not None:
            self._served.metadata = metadata
            now = time.time()
            if (credential is not None and metadata['fresh_until'] is not None
                    and now >= metadata['fresh_until'] and now >= metadata['retry_after']):
                self.refresh(build, identity, guard, credential)
            return tasks
        with self._build_lock:
            tasks, metadata = self._cached(identity, guard)
            if tasks is not None:
                self._served.metadata = metadata
                return tasks
            return self._build(build, identity, guard, credential)

    def _build(self, build, identity, guard, credential):
        started = time.monotonic()
        with guard(), self._storage.transaction():
            expected_identity = identity()
            epoch = self._load(EPOCH_KEY)
            if epoch is None:
                self.changed()
                epoch = self._load(EPOCH_KEY)
        tasks = build(self._backend, credential)
        with guard(), self._storage.transaction():
            if identity() != expected_identity or self._load(EPOCH_KEY) != epoch:
                raise BackendUnavailableError('Task refresh superseded by a write or configuration change')
            previous = self._load(SNAPSHOT_KEY)
            previous_metadata = self._load(META_KEY)
            if (previous and not tasks and previous_metadata is not None
                    and previous_metadata['identity'] == expected_identity):
                raise BackendUnavailableError('Task refresh returned no data; keeping the complete snapshot')
            completed = time.time()
            ttl = self._ttl()
            for key in list(self._storage.list_keys(NAMESPACE)):
                if key != SNAPSHOT_KEY and key.startswith((
                    'fetch_tasks__', 'fetch_plan_tasks__', 'fetch_task_context__',
                )):
                    self._storage.delete(NAMESPACE, key)
            self._storage.save(NAMESPACE, SNAPSHOT_KEY, tasks)
            metadata = {
                'identity': expected_identity, 'generation': uuid4().hex,
                'completed_at': completed,
                'fresh_until': None if ttl is None else completed + ttl.total_seconds(),
                'retry_after': 0, 'error': None,
            }
            self._storage.save(NAMESPACE, META_KEY, metadata)
            self._served.metadata = metadata
        logger.info('Task snapshot committed (%d tasks, %.3fs)', len(tasks), time.monotonic() - started)
        return tasks

    def refresh(self, build, identity, guard, credential):
        with self._state_lock:
            if self._closed:
                raise BackendUnavailableError('Task refresh is shutting down')
            if self._thread is not None:
                return {'status': 'already_running'}

            def run():
                try:
                    with self._build_lock:
                        self._build(build, identity, guard, credential)
                except Exception as exc:
                    with guard(), self._storage.transaction():
                        metadata = self._load(META_KEY)
                        if metadata is not None and metadata['identity'] == identity():
                            metadata = dict(metadata, error=type(exc).__name__,
                                            retry_after=time.time() + RETRY_SECONDS)
                            self._storage.save(NAMESPACE, META_KEY, metadata)
                    logger.warning('Task snapshot refresh failed (%s); retaining cached data', type(exc).__name__)
                finally:
                    with self._state_lock:
                        self._thread = None

            self._thread = threading.Thread(target=run, name='task-snapshot-refresh', daemon=True)
            self._thread.start()
        return {'status': 'queued'}

    def diagnostics(self, identity, guard):
        with guard(), self._storage.transaction():
            metadata = self._load(META_KEY)
            if metadata is None or metadata['identity'] != identity():
                return []
            served = getattr(self._served, 'metadata', None)
            if served is not None and served['identity'] == metadata['identity']:
                error = metadata['error'] if served['generation'] == metadata['generation'] else served['error']
                metadata = dict(served, error=error)
        with self._state_lock:
            updating = self._thread is not None
        age = max(0, int(time.time() - metadata['completed_at']))
        updated = datetime.fromtimestamp(metadata['completed_at'], timezone.utc).isoformat(timespec='seconds')
        stale = metadata['fresh_until'] is not None and time.time() >= metadata['fresh_until']
        status = 'fresh'
        severity = 'info'
        if updating:
            status = 'updating in background; reload later to load updated data'
        elif metadata['error'] is not None:
            status = 'refresh failed; keeping cached data'
            severity = 'warning'
        elif stale:
            status = 'stale'
        return [{
            'code': 'task_cache_freshness', 'severity': severity,
            'message': f'Task cache updated {updated} ({age}s ago): {status}.',
        }]

    def close(self):
        with self._state_lock:
            self._closed = True
            thread = self._thread
        if thread is not None:
            thread.join()