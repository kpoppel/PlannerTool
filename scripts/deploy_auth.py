"""Strict authentication policy for manifest-driven deployment generation."""
import json
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlsplit

import yaml


def validate_deployment_policy(config):
    mode = config.get('ado_authentication')
    if mode not in ('disabled', 'pat', 'entra'):
        raise ValueError('Deployment requires ado_authentication: disabled|pat|entra')
    for instance in config['instances']:
        instance['_ado_authentication'] = mode
    return mode


def validate_instances(instances, managed_services=()):
    names = set()
    for instance in instances:
        name = instance['name']
        if (not re.fullmatch(r'[a-z][a-z0-9_-]{0,62}', name)
                or name in {'auth', 'admin', 'api', 'static', 'caddy'} or name in names):
            raise ValueError('Instance names must be unique, safe and not reserved')
        names.add(name)
        if 'backend' in instance or 'authentication_provider' in instance:
            raise ValueError('Remove backend and authentication_provider from the deployment manifest; '
                             'select the backend in Admin > Data Sources')
        if 'build_from_source' in instance and type(instance['build_from_source']) is not bool:
            raise ValueError('build_from_source must be a boolean')
        if instance.get('build_from_source') is False and 'image' not in instance:
            raise ValueError('Image-only instances require an explicit image')
        if (instance.get('auth_service') not in managed_services
                and ('auth_service' in instance) != ('auth_client_secret_file' in instance)):
            raise ValueError('An external broker registration requires both service reference and secret file')


def protected_file(base, value):
    path = (base / value).resolve()
    if not path.is_file():
        raise ValueError(f'Missing authentication configuration file: {path.name}')
    if path.stat().st_mode & 0o077:
        raise ValueError(f'Authentication configuration requires mode 0600: {path.name}')
    return str(path)


def write_managed_auth(service, registry, *, apply):
    from cryptography.fernet import Fernet

    directory = Path(service['key_file']).parent
    marker = directory / 'managed.json'
    identity = {key: service[key] for key in ('mode', 'environment_id', 'generation', 'public_url')}
    members = sorted(registry['instances'])
    expected_secrets = {'broker-key', 'client-secret'} | {'client-' + name for name in members}
    existing_members = set()
    if directory.exists():
        if directory.stat().st_mode & 0o077:
            raise ValueError('Managed authentication directory requires mode 0700')
        previous = json.loads(Path(protected_file(directory, 'managed.json')).read_text())
        if (set(previous) != {'version', 'identity', 'instances'} or previous['version'] != 1
                or previous['identity'] != identity):
            raise ValueError('Managed auth environment/mode/URL changed; explicit transition with separate storage required')
        existing_members = set(previous['instances'])
        for name in {'broker-key', 'client-secret'} | {'client-' + name for name in existing_members}:
            protected_file(directory, name)
        Fernet(Path(service['key_file']).read_text().strip().encode())
    if not apply:
        return
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in sorted(expected_secrets):
        path = directory / name
        if path.exists():
            protected_file(directory, name)
            continue
        value = Fernet.generate_key().decode() if name == 'broker-key' else secrets.token_urlsafe(48)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(value + '\n')
    files = {
        'registration.env': '\n'.join(key + '=' + value for key, value in service['_environment'].items()) + '\n',
        'instances.json': json.dumps(registry, indent=2) + '\n',
        'managed.json': json.dumps({'version': 1, 'identity': identity, 'instances': members}, indent=2) + '\n',
    }
    for name, value in files.items():
        temporary = directory / (name + '.tmp')
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(value)
        os.replace(temporary, directory / name)


def load_auth_services(config, manifest_path, https_hostname, *, output_dir='deployment', apply=False):
    instances = config['instances']
    managed_services = {name for name, service in config.get('auth_services', {}).items() if 'registration' in service}
    validate_instances(instances, managed_services)
    validate_deployment_policy(config)
    base = Path(manifest_path).resolve().parent
    referenced = {instance['auth_service'] for instance in instances if 'auth_service' in instance}
    if referenced - set(config.get('auth_services', {})):
        raise ValueError('Unknown auth service reference')
    if len(referenced) > 1:
        raise ValueError('One central /auth/ service per ingress')
    services = {}
    registry_secrets = set()
    for name in referenced:
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,40}', name):
            raise ValueError('Invalid auth service name')
        if name not in config.get('auth_services', {}):
            raise ValueError('Unknown auth service reference')
        service = dict(config['auth_services'][name])
        managed = name in managed_services
        required = {'mode', 'environment_id', 'generation', 'public_url', 'volume_source'}
        required |= {'registration'} if managed else {'env_file', 'registry_file', 'key_file', 'client_secret_file'}
        if not required <= set(service) or set(service) - required - {'image', 'build_from_source'}:
            raise ValueError('Auth service requires explicit configuration, registry, secrets and persistent volume')
        if 'build_from_source' in service and type(service['build_from_source']) is not bool:
            raise ValueError('Auth build_from_source must be a boolean')
        if service.get('build_from_source') is False and 'image' not in service:
            raise ValueError('Image-only auth services require an explicit image')
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
            loopback = (https_hostname is None and public.scheme == 'http'
                        and public.hostname == 'localhost' and public.port is not None)
            https = (https_hostname is not None and public.scheme == 'https'
                     and public.hostname == https_hostname and public.port in (None, 443))
            if not (loopback or https):
                raise ValueError('Mock auth requires localhost HTTP or matching configured HTTPS ingress')
        elif public.scheme != 'https' or public.hostname != https_hostname:
            raise ValueError('Live broker requires matching explicit HTTPS ingress')
        if managed:
            registration = service.pop('registration')
            if set(registration) != {'tenant_id', 'client_id', 'organization'}:
                raise ValueError('Auth registration requires tenant_id, client_id and organization')
            if service['mode'] != 'mock':
                raise ValueError('Managed live Entra activation requires the separately approved live broker gate')
            directory = Path(output_dir).resolve() / '.auth' / name
            service.update({field: str(directory / filename) for field, filename in {
                'env_file': 'registration.env', 'registry_file': 'instances.json',
                'key_file': 'broker-key', 'client_secret_file': 'client-secret',
            }.items()})
            env = {'ENTRA_TENANT_ID': registration['tenant_id'], 'ENTRA_CLIENT_ID': registration['client_id'],
                   'ADO_ORGANIZATION': registration['organization']}
        else:
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
        members = [instance for instance in instances if instance.get('auth_service') == name]
        if managed:
            registry = {'version': 1, 'mock_registration': {
                'tenant_id': env['ENTRA_TENANT_ID'], 'client_id': env['ENTRA_CLIENT_ID'],
                'redirect_uri': expected['ENTRA_REDIRECT_URI'], 'organization': env['ADO_ORGANIZATION'],
            }, 'instances': {instance['name']: {
                'completion_url': f'{public.scheme}://{public.netloc}/{instance["name"]}/api/auth/login/callback',
                'secret_file': '/run/secrets/client-' + instance['name'], 'scenario': 'success',
            } for instance in members}}
            for instance in members:
                if 'auth_client_secret_file' in instance:
                    raise ValueError('Inline auth registration manages instance secrets; do not specify secret files')
                instance['auth_client_secret_file'] = str(directory / ('client-' + instance['name']))
        else:
            registry = json.loads(Path(service['registry_file']).read_text())
        if set(registry) != {'version', 'instances', 'mock_registration'} or registry['version'] != 1:
            raise ValueError('Unsupported instance registry schema')
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
            source = str(directory / ('client-' + instance['name'])) if managed else protected_file(base, instance['auth_client_secret_file'])
            if Path(source).exists():
                secret = Path(source).read_text().strip()
                if len(secret) < 43 or secret in registry_secrets:
                    raise ValueError('Each instance needs a distinct high-entropy secret')
                registry_secrets.add(secret)
            instance['_auth_secret_path'] = source
        service['_environment'] = {**env, **expected}
        service['_members'] = members
        if managed:
            write_managed_auth(service, registry, apply=apply)
        services[name] = service
    if len(services) > 1:
        raise ValueError('One central /auth/ service per ingress; use a separate sandbox stack')
    return services


def add_auth_compose(compose, instances, services, version):
    validate_instances(instances)
    for instance in instances:
        environment = compose['services']['planner-' + instance['name']]['environment']
        provider = 'entra' if ('auth_service' in instance and instance.get('_ado_authentication') == 'entra') else 'enrollment'
        environment.append('PLANNER_AUTH_PROVIDER=' + provider)
        if '_ado_authentication' in instance:
            environment.append('PLANNER_ADO_AUTHENTICATION=' + instance['_ado_authentication'])
    if not services:
        return
    compose['secrets'] = {}
    sandbox = any(service['mode'] == 'mock' for service in services.values())
    if sandbox:
        service = next(iter(services.values()))
        public = urlsplit(service['public_url'])
        if public.scheme == 'http':
            compose['services']['caddy']['ports'] = [f'127.0.0.1:{public.port}:80']
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
        if service.get('build_from_source') is True or 'image' not in service:
            auth['build'] = {'context': str(Path(__file__).resolve().parents[1] / 'entra-id')}
        for instance in service['_members']:
            instance_name = instance['name']
            secret_id = 'client-' + instance_name
            compose['secrets'][secret_id] = {'file': instance['_auth_secret_path']}
            auth['secrets'].append({'source': secret_id, 'target': secret_id})
            planner = compose['services']['planner-' + instance_name]
            planner['command'] = ['uvicorn', 'planner:make_app', '--factory', '--host', '0.0.0.0',
                                  '--port', '8000', '--root-path', '/' + instance_name, '--no-access-log',
                                  '--proxy-headers', '--forwarded-allow-ips', '*']
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