"""Concurrent request correctness, without machine-speed assertions."""

import asyncio
from threading import Barrier
from types import SimpleNamespace

import httpx
import pytest

pytestmark = pytest.mark.real_auth
CONCURRENT_REQUESTS = 4


@pytest.fixture
def enrolled_client(client, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert client.post('/api/auth/enroll', json={
        'email': 'concurrency@example.com', 'name': 'Concurrency Contract',
    }).status_code == 200
    return client


def test_task_reads_overlap_and_all_return_the_requested_data(enrolled_client):
    rendezvous = Barrier(CONCURRENT_REQUESTS, timeout=5)
    task = {'id': '1', 'title': 'Concurrent task'}

    def read_tasks(**kwargs):
        rendezvous.wait()
        return [task]

    enrolled_client.app.state.container.register_singleton(
        'task_repository', SimpleNamespace(read=read_tasks),
    )

    async def run_requests():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=enrolled_client.app),
            base_url='http://testserver', cookies=enrolled_client.cookies,
        ) as client:
            return await asyncio.gather(*[
                client.get('/api/tasks') for _ in range(CONCURRENT_REQUESTS)
            ])

    responses = asyncio.run(run_requests())
    assert all(response.status_code == 200 for response in responses)
    assert [response.json() for response in responses] == [[task]] * CONCURRENT_REQUESTS


def test_concurrent_scenario_saves_preserve_every_payload(enrolled_client):
    async def run_requests():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=enrolled_client.app),
            base_url='http://testserver', cookies=enrolled_client.cookies,
        ) as client:
            responses = await asyncio.gather(*[
                client.post('/api/scenario', json={
                    'op': 'save', 'data': {'name': f'Scenario {index}', 'overrides': {}},
                })
                for index in range(CONCURRENT_REQUESTS)
            ])
            assert all(response.status_code == 200 for response in responses)
            identifiers = [response.json()['id'] for response in responses]
            assert len(set(identifiers)) == CONCURRENT_REQUESTS
            listed = await client.get('/api/scenario')
            assert listed.status_code == 200
            assert {item['id'] for item in listed.json()} == set(identifiers)
            for index, identifier in enumerate(identifiers):
                loaded = await client.get('/api/scenario', params={'id': identifier})
                assert loaded.status_code == 200
                assert loaded.json()['name'] == f'Scenario {index}'

    asyncio.run(run_requests())