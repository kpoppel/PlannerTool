"""Strict authentication policy for manifest-driven deployment generation."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import yaml


def validate_deployment_policy(config):
    mode = config.get('ado_authentication')
    if mode not in ('disabled', 'pat', 'entra'):
        raise ValueError('Deployment requires ado_authentication: disabled|pat|entra')
    for instance in config['instances']:
        backend = instance.get('backend')
        if backend not in ('local', 'ado'):
            raise ValueError('Every instance requires backend: local|ado')
        expected = 'entra' if backend == 'ado' and mode == 'entra' else 'enrollment'
        if backend == 'ado' and mode == 'disabled':
            raise ValueError('ADO instances require a deployment ADO authentication policy')
        if instance['authentication_provider'] != expected:
            raise ValueError('Instance login contradicts deployment ADO authentication policy')
        instance['_ado_authentication'] = mode
    return mode


def validate_instances(instances):
    names = set()
    for instance in instances:
        name = instance['name']
        if (not re.fullmatch(r'[a-z][a-z0-9_-]{0,62}', name)
                or name in {'auth', 'admin', 'api', 'static', 'caddy'} or name in names):
            raise ValueError('Instance names must be unique, safe and not reserved')
        names.add(name)
        if instance.get('authentication_provider') not in ('enrollment', 'entra'):
            raise ValueError('Every instance requires authentication_provider: enrollment|entra; upgrade the manifest')
        if instance['authentication_provider'] == 'entra':
            if not instance.get('auth_service') or not instance.get('auth_client_secret_file'):
                raise ValueError('Entra instances require auth_service and auth_client_secret_file')
        elif ('auth_service' in instance) != ('auth_client_secret_file' in instance):
            raise ValueError('Staged broker requires both service reference and secret file')


def protected_file(base, value):
    path = (base / value).resolve()
    if not path.is_file():
        raise ValueError(f'Missing authentication configuration file: {path.name}')
    if path.stat().st_mode & 0o077:
        raise ValueError(f'Authentication configuration requires mode 0600: {path.name}')
    return str(path)


def load_auth_services(config, manifest_path, https_hostname):
    instances = config['instances']
    validate_instances(instances)
    validate_deployment_policy(config)
    base = Path(manifest_path).resolve().parent
    referenced = {instance['auth_service'] for instance in instances if 'auth_service' in instance}
    if any(instance['backend'] == 'local' and 'auth_service' in instance for instance in instances):
        raise ValueError('Local-only instances must not depend on the ADO broker')
    if referenced - set(config.get('auth_services', {})):
        raise ValueError('Unknown auth service reference')
    services = {}
    registry_secrets = set()
    for name in referenced:
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,40}', name):
            raise ValueError('Invalid auth service name')
        if name not in config.get('auth_services', {}):
            raise ValueError('Unknown auth service reference')
        service = dict(config['auth_services'][name])
        required = {'mode', 'environment_id', 'generation', 'public_url', 'env_file',
                    'registry_file', 'key_file', 'client_secret_file', 'volume_source'}
        if not required <= set(service) or set(service) - required - {'image'}:
            raise ValueError('Auth service requires explicit configuration, registry, secrets and persistent volume')
        if service['mode'] not in ('mock', 'entra'):
            raise ValueError('Unknown auth service mode')
        for field in ('environment_id', 'generation', 'volume_source'):
            if not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', service[field]):
                raise ValueError('Invalid auth environment, generation or volume name')
        public = urlsplit(service['public_url'])
        if (public.path != '/auth/' or public.query or public.fragment or public.username
                or not public.hostname or public.password):
            raise ValueError('Auth service public URL must have the exact /auth/ root')
        if service['mode'] == 'mock':
            if (https_hostname is not None or public.scheme != 'http'
                    or public.hostname != 'localhost' or not public.port):
                raise ValueError('Sandbox requires loopback-only HTTP browser ingress; no live ingress mixing')
        elif public.scheme != 'https' or public.hostname != https_hostname:
            raise ValueError('Live broker requires matching explicit HTTPS ingress')
        for field in ('env_file', 'registry_file', 'key_file', 'client_secret_file'):
            service[field] = protected_file(base, service[field])
        from cryptography.fernet import Fernet
        Fernet(Path(service['key_file']).read_text().strip().encode())
        env = {}
        for line in Path(service['env_file']).read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            key, separator, value = line.partition('=')
            if not separator or key in env or key.strip() != key or '$' in value:
                raise ValueError('Auth env file requires unique literal KEY=value entries')
            if 'SECRET' in key or 'KEY' in key:
                raise ValueError('Auth env files must not contain secrets; use secret files')
            env[key] = value
        expected = {
            'ENTRA_AUTH_MODE': service['mode'], 'ENTRA_BROKER_ENVIRONMENT': service['environment_id'],
            'ENTRA_BROKER_GENERATION': service['generation'], 'ENTRA_BROKER_PUBLIC_URL': service['public_url'],
            'ENTRA_REDIRECT_URI': service['public_url'] + 'callback',
            'ENTRA_ADO_TRANSPORT': 'fixture' if service['mode'] == 'mock' else 'live',
        }
        allowed = {'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ADO_ORGANIZATION'} | set(expected)
        if set(env) - allowed:
            raise ValueError('Unsupported auth env setting')
        if not {'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ADO_ORGANIZATION'} <= set(env):
            raise ValueError('Both modes require synthetic or live registration settings')
        for key, value in expected.items():
            if key in env and env[key] != value:
                raise ValueError('Auth env contradicts authoritative manifest policy: ' + key)
        from uuid import UUID
        for field in ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID'):
            if str(UUID(env[field])) != env[field]:
                raise ValueError('Registration IDs must be canonical GUIDs')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*', env['ADO_ORGANIZATION']):
            raise ValueError('Invalid ADO organization name')
        registry = json.loads(Path(service['registry_file']).read_text())
        if set(registry) != {'version', 'instances', 'mock_registration'} or registry['version'] != 1:
            raise ValueError('Unsupported instance registry schema')
        members = [instance for instance in instances if instance.get('auth_service') == name]
        if set(registry['instances']) != {instance['name'] for instance in members}:
            raise ValueError('Registry must contain exactly the referencing instances')
        if service['mode'] == 'mock' and registry['mock_registration'] != {
                'tenant_id': env['ENTRA_TENANT_ID'], 'client_id': env['ENTRA_CLIENT_ID'],
                'redirect_uri': expected['ENTRA_REDIRECT_URI'], 'organization': env['ADO_ORGANIZATION']}:
            raise ValueError('Sandbox upstream registration binding mismatch')
        for instance in members:
            registration = registry['instances'][instance['name']]
            callback = f'{public.scheme}://{public.netloc}/{instance["name"]}/api/auth/login/callback'
            if (registration['completion_url'] != callback
                    or registration['secret_file'] != '/run/secrets/client-' + instance['name']):
                raise ValueError('Registry completion or per-instance secret mount mismatch')
            source = protected_file(base, instance['auth_client_secret_file'])
            secret = Path(source).read_text().strip()
            if len(secret) < 43 or secret in registry_secrets:
                raise ValueError('Each instance needs a distinct high-entropy secret')
            registry_secrets.add(secret)
            instance['_auth_secret_path'] = source
        service['_environment'] = {**env, **expected}
        service['_members'] = members
        services[name] = service
    if len(services) > 1:
        raise ValueError('One central /auth/ service per ingress; use a separate sandbox stack')
    return services


def add_auth_compose(compose, instances, services, version):
    validate_instances(instances)
    for instance in instances:
        environment = compose['services']['planner-' + instance['name']]['environment']
        environment.append('PLANNER_AUTH_PROVIDER=' + instance['authentication_provider'])
        if '_ado_authentication' in instance:
            environment.extend([
                'PLANNER_ADO_AUTHENTICATION=' + instance['_ado_authentication'],
                'PLANNER_INSTANCE_BACKEND=' + instance['backend'],
            ])
    if not services:
        return
    compose['secrets'] = {}
    sandbox = any(service['mode'] == 'mock' for service in services.values())
    if sandbox:
        service = next(iter(services.values()))
        port = urlsplit(service['public_url']).port
        compose['services']['caddy']['ports'] = [f'127.0.0.1:{port}:80']
        compose['networks'] = {'default': {'internal': True}, 'ingress': {}}
        compose['services']['caddy']['networks'] = ['default', 'ingress']
    for name, service in services.items():
        dns = 'auth-' + name
        key_name = dns + '-key'
        secret_name = dns + '-entra-secret'
        compose['secrets'][key_name] = {'file': service['key_file']}
        compose['secrets'][secret_name] = {'file': service['client_secret_file']}
        environment = {**service['_environment'],
                       'ENTRA_LISTEN_HOST': '0.0.0.0', 'ENTRA_LISTEN_PORT': '8000',
                       'ENTRA_NETWORK': 'private-compose', 'ENTRA_INTERNAL_HOST': dns,
                       'ENTRA_CLIENT_SECRET_FILE': '/run/secrets/entra-secret',
                       'ENTRA_BROKER_KEY_FILE': '/run/secrets/broker-key',
                       'ENTRA_BROKER_REGISTRY_FILE': '/app/config/instances.json',
                       'ENTRA_BROKER_STORE': '/app/state/protected/broker.sqlite'}
        auth = {
            'image': service.get('image', 'plannertool-auth:' + version),
            'environment': environment,
            'volumes': [service['registry_file'] + ':/app/config/instances.json:ro',
                        service['env_file'] + ':/app/config/registration.env:ro',
                        service['volume_source'] + ':/app/state'],
            'secrets': [{'source': key_name, 'target': 'broker-key'},
                        {'source': secret_name, 'target': 'entra-secret'}],
            'read_only': True, 'cap_drop': ['ALL'],
            'security_opt': ['no-new-privileges:true'], 'restart': 'unless-stopped',
            'healthcheck': {'test': ['CMD', 'python', '-c',
                f"import urllib.request; urllib.request.urlopen('http://{dns}:8000/auth/health', timeout=2)"],
                'interval': '10s', 'timeout': '3s', 'retries': 3},
        }
        for instance in service['_members']:
            instance_name = instance['name']
            secret_id = 'client-' + instance_name
            compose['secrets'][secret_id] = {'file': instance['_auth_secret_path']}
            auth['secrets'].append({'source': secret_id, 'target': secret_id})
            planner = compose['services']['planner-' + instance_name]
            planner['command'] = ['uvicorn', 'planner:make_app', '--factory', '--host', '0.0.0.0',
                                  '--port', '8000', '--root-path', '/' + instance_name, '--no-access-log']
            planner['secrets'] = [{'source': secret_id, 'target': 'auth-client'}]
            planner['environment'].extend([
                'PLANNER_AUTH_INSTANCE=' + instance_name,
                'PLANNER_AUTH_URL=http://' + dns + ':8000/auth/',
                'PLANNER_AUTH_PUBLIC_URL=' + service['public_url'],
                'PLANNER_AUTH_ENVIRONMENT=' + service['environment_id'],
                'PLANNER_AUTH_GENERATION=' + service['generation'],
                'PLANNER_AUTH_UPSTREAM_MODE=' + service['mode'],
                'PLANNER_AUTH_SECRET_FILE=/run/secrets/auth-client',
                'PLANNER_AUTH_ISOLATED_SANDBOX=' + ('1' if sandbox else '0'),
            ])
            planner['depends_on'] = {dns: {'condition': 'service_started', 'required': False}}
        compose['services'][dns] = auth
        compose['volumes'][service['volume_source']] = {}