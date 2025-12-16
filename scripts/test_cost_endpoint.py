#!/usr/bin/env python3
"""CLI test for /api/cost endpoint.

Starts a session, fetches baseline data, posts to /api/cost, then posts revisions.
"""
import requests
import sys
from pprint import pprint

BASE = 'http://localhost:8000'

def start_session(email='user@example.com'):
    r = requests.post(f'{BASE}/api/session', json={'email': email})
    r.raise_for_status()
    sid = r.json().get('sessionId')
    return sid

def fetch_baseline(session_id):
    headers = {'X-Session-Id': session_id}
    r = requests.get(f'{BASE}/api/projects', headers=headers)
    r.raise_for_status()
    projects = r.json()
    r = requests.get(f'{BASE}/api/tasks', headers=headers)
    r.raise_for_status()
    tasks = r.json()
    return projects, tasks

def post_cost(session_id, features=None, revisions=None):
    headers = {'X-Session-Id': session_id}
    payload = {}
    if features is not None:
        payload['features'] = features
    if revisions is not None:
        payload['revisions'] = revisions
    r = requests.post(f'{BASE}/api/cost', headers=headers, json=payload)
    r.raise_for_status()
    return r.json()

def main():
    sid = start_session()
    print('Session:', sid)
    projects, tasks = fetch_baseline(sid)
    print('\nProjects:')
    pprint(projects[:3])
    print('\nTasks sample:')
    sample_features = []
    for t in (tasks or [])[:10]:
        # normalize expected fields for cost engine
        sample_features.append({
            'id': t.get('id'),
            'project': t.get('project'),
            'team': t.get('team'),
            'start': t.get('start'),
            'end': t.get('end'),
            'capacity': t.get('capacity', 1.0),
        })

    print('\nPosting baseline cost...')
    baseline = post_cost(sid, features=sample_features)
    pprint(baseline)

    if sample_features:
        first = sample_features[0]
        tid = first.get('id')
        print('\nPosting revised dates for task', tid)
        rev1 = [{'taskId': tid, 'start': first.get('start'), 'end': first.get('end')}]
        r1 = post_cost(sid, features=sample_features, revisions=rev1)
        pprint(r1)

        print('\nPosting revised capacity for task', tid)
        rev2 = [{'taskId': tid, 'capacity': 0.5}]
        r2 = post_cost(sid, features=sample_features, revisions=rev2)
        pprint(r2)

if __name__ == '__main__':
    main()
