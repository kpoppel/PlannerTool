"""Opt-in throughput measurement with isolated authenticated ASGI requests."""

import asyncio
import time
from types import SimpleNamespace

import httpx
import pytest

pytestmark = [pytest.mark.real_auth, pytest.mark.performance]
REQUEST_COUNT = 4
SIMULATED_IO_SECONDS = 0.1


def test_concurrent_task_reads_improve_throughput(client, record_property):
    assert client.post('/api/auth/enroll', json={
        'email': 'throughput@example.com', 'name': 'Throughput Measurement',
    }).status_code == 200
    task = {'id': '1', 'title': 'Measured task'}

    def read_tasks(**kwargs):
        time.sleep(SIMULATED_IO_SECONDS)
        return [task]

    client.app.state.container.register_singleton(
        'task_repository', SimpleNamespace(read=read_tasks),
    )

    async def measure():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app),
            base_url='http://testserver', cookies=client.cookies,
        ) as http_client:
            started = time.perf_counter()
            sequential = [await http_client.get('/api/tasks') for _ in range(REQUEST_COUNT)]
            sequential_seconds = time.perf_counter() - started
            started = time.perf_counter()
            concurrent = await asyncio.gather(*[
                http_client.get('/api/tasks') for _ in range(REQUEST_COUNT)
            ])
            concurrent_seconds = time.perf_counter() - started
        for response in sequential + concurrent:
            assert response.status_code == 200
            assert response.json() == [task]
        return sequential_seconds, concurrent_seconds

    sequential_seconds, concurrent_seconds = asyncio.run(measure())
    record_property('sequential_seconds', sequential_seconds)
    record_property('concurrent_seconds', concurrent_seconds)
    record_property('concurrent_to_sequential_ratio', concurrent_seconds / sequential_seconds)
    assert concurrent_seconds < sequential_seconds * 0.75