#!/usr/bin/env python3
"""CLI test for /api/cost endpoint.

Starts a session, fetches baseline data, posts to /api/cost, then posts revisions.
"""
from pprint import pprint
import argparse
from .api_cli import authenticated_session

BASE = 'http://localhost:8000'

def fetch_baseline(session):
    r = session.get(f'{BASE}/api/projects', timeout=30)
    r.raise_for_status()
    projects = r.json()
    r = session.get(f'{BASE}/api/tasks', timeout=30)
    r.raise_for_status()
    tasks = r.json()
    return projects, tasks

def post_cost(session, features=None, revisions=None):
    payload = {}
    if features is not None:
        payload['features'] = features
    if revisions is not None:
        payload['revisions'] = revisions
    r = session.post(f'{BASE}/api/cost', json=payload, timeout=30)
    r.raise_for_status()
    return r.json()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cookies', required=True, help='Private enrolled cookie jar')
    args = parser.parse_args()
    session = authenticated_session(BASE, args.cookies)
    projects, tasks = fetch_baseline(session)
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
    baseline = post_cost(session, features=sample_features)
    pprint(baseline)

    if sample_features:
        first = sample_features[0]
        tid = first.get('id')
        print('\nPosting revised dates for task', tid)
        rev1 = [{'taskId': tid, 'start': first.get('start'), 'end': first.get('end')}]
        r1 = post_cost(session, features=sample_features, revisions=rev1)
        pprint(r1)

        print('\nPosting revised capacity for task', tid)
        rev2 = [{'taskId': tid, 'capacity': 0.5}]
        r2 = post_cost(session, features=sample_features, revisions=rev2)
        pprint(r2)

if __name__ == '__main__':
    main()
