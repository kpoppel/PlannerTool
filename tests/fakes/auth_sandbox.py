#!/usr/bin/env python3
"""Generate synthetic auth fixtures for tests; never modify an existing stack."""
import argparse
import json
import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet
import yaml


def create_sandbox(directory, port=18880, ado_authentication='entra'):
    if ado_authentication not in ('pat', 'entra'):
        raise ValueError('Sandbox ADO policy must be pat or entra')
    directory = Path(directory).resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    public = f'http://localhost:{port}/auth/'
    registration = {
        'tenant_id': '11111111-1111-1111-1111-111111111111',
        'client_id': '22222222-2222-2222-2222-222222222222',
        'organization': 'example', 'redirect_uri': public + 'callback',
    }

    def write(name, value):
        path = directory / name
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(value)

    write('broker-key', Fernet.generate_key().decode())
    write('entra-secret', secrets.token_urlsafe(32))
    write('.env', 'PLANNER_SECRET_KEY=' + secrets.token_urlsafe(48) + '\n')
    write('registration.env', '\n'.join([
        'ENTRA_TENANT_ID=' + registration['tenant_id'],
        'ENTRA_CLIENT_ID=' + registration['client_id'],
        'ADO_ORGANIZATION=' + registration['organization'], '',
    ]))
    registry = {'version': 1, 'mock_registration': registration, 'instances': {}}
    instances = []
    for name in ('alpha', 'beta'):
        write('client-' + name, secrets.token_urlsafe(32))
        registry['instances'][name] = {
            'completion_url': f'http://localhost:{port}/{name}/api/auth/login/callback',
            'secret_file': '/run/secrets/client-' + name, 'scenario': 'success',
        }
        instances.append({'name': name,
                          'auth_service': 'sandbox', 'auth_client_secret_file': 'client-' + name,
                          'image': 'plannertool:phase-d-sandbox', 'build_from_source': True})
    instances.append({'name': 'local',
                      'image': 'plannertool:phase-d-sandbox', 'build_from_source': True})
    write('instances.json', json.dumps(registry, indent=2) + '\n')
    direct_registry = json.loads(json.dumps(registry))
    for name, value in direct_registry['instances'].items():
        value['secret_file'] = str(directory / ('client-' + name))
    write('direct-instances.json', json.dumps(direct_registry, indent=2) + '\n')
    standalone_registry = {**registry, 'instances': {'alpha': registry['instances']['alpha']}}
    write('standalone-instances.json', json.dumps(standalone_registry, indent=2) + '\n')
    write('standalone.env', '\n'.join([
        'ENTRA_TENANT_ID=' + registration['tenant_id'],
        'ENTRA_CLIENT_ID=' + registration['client_id'],
        'ADO_ORGANIZATION=' + registration['organization'],
        f'SANDBOX_PORT={port}',
        'SANDBOX_REGISTRY_FILE=' + str(directory / 'standalone-instances.json'),
        'SANDBOX_ENTRA_SECRET_FILE=' + str(directory / 'entra-secret'),
        'SANDBOX_KEY_FILE=' + str(directory / 'broker-key'),
        'SANDBOX_INSTANCE_SECRET_FILE=' + str(directory / 'client-alpha'), '',
    ]))
    manifest = {'ado_authentication': ado_authentication, 'auth_services': {'sandbox': {
        'mode': 'mock',
        'public_url': public, 'env_file': 'registration.env', 'registry_file': 'instances.json',
        'key_file': 'broker-key', 'client_secret_file': 'entra-secret',
        'volume_source': 'auth-sandbox-state', 'image': 'plannertool-auth:phase-d-sandbox',
        'build_from_source': True,
    }}, 'instances': instances}
    write('manifest.yml', yaml.safe_dump(manifest, sort_keys=False))
    return directory / 'manifest.yml'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--port', type=int, default=18880)
    parser.add_argument('--ado-authentication', choices=('pat', 'entra'), default='entra')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Sandbox port must be between 1024 and 65535')
    print('Created synthetic configuration: ' + str(create_sandbox(
        args.directory, args.port, args.ado_authentication)))