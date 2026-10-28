import argparse
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from deploy import (
    generate_caddyfile,
    generate_docker_compose,
    validate_https_hostname,
)


INSTANCES = [{"name": "planning"}]


def test_https_readiness_checks_trust_and_hostname(monkeypatch):
    from unittest.mock import MagicMock
    from deploy import wait_for_https

    context = MagicMock()
    connection = MagicMock()
    monkeypatch.setattr('deploy.ssl.create_default_context', lambda: context)
    connect = MagicMock(return_value=connection)
    monkeypatch.setattr('deploy.socket.create_connection', connect)
    wait_for_https('planner.example.com')
    connect.assert_called_once_with(('127.0.0.1', 443), timeout=5)
    context.wrap_socket.assert_called_once_with(
        connection.__enter__.return_value, server_hostname='planner.example.com',
    )


def test_https_readiness_uses_explicit_ca_without_disabling_verification(monkeypatch):
    import ssl
    from unittest.mock import MagicMock
    from deploy import wait_for_https

    context = ssl.create_default_context()
    monkeypatch.setattr(context, 'wrap_socket', MagicMock())
    create_context = MagicMock(return_value=context)
    monkeypatch.setattr('deploy.ssl.create_default_context', create_context)
    monkeypatch.setattr('deploy.socket.create_connection', MagicMock())
    wait_for_https('planner.example.test', cafile='/private/company-ca.pem')
    create_context.assert_called_once_with(cafile='/private/company-ca.pem')
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED


def test_https_readiness_retries_until_certificate_is_ready(monkeypatch):
    import ssl
    from unittest.mock import MagicMock
    from deploy import wait_for_https

    context = MagicMock()
    context.wrap_socket.side_effect = [ssl.SSLError('certificate pending'), MagicMock()]
    monkeypatch.setattr('deploy.ssl.create_default_context', lambda: context)
    monkeypatch.setattr('deploy.socket.create_connection', MagicMock())
    pause = MagicMock()
    monkeypatch.setattr('deploy.time.sleep', pause)
    wait_for_https('planner.example.com')
    assert context.wrap_socket.call_count == 2
    pause.assert_called_once_with(2)


def test_https_readiness_timeout_reports_tls_failure(monkeypatch):
    import ssl
    from unittest.mock import MagicMock
    from deploy import wait_for_https

    monkeypatch.setattr('deploy.socket.create_connection', MagicMock(
        side_effect=ssl.SSLCertVerificationError('hostname mismatch'),
    ))
    monkeypatch.setattr('deploy.time.monotonic', MagicMock(side_effect=[0, 121]))
    with pytest.raises(RuntimeError, match='hostname mismatch'):
        wait_for_https('planner.example.com')


def test_https_start_failure_reports_certificate_diagnostics(tmp_path, monkeypatch, capsys):
    import shlex
    from deploy import main

    manifest = tmp_path / 'instances.yml'
    manifest.write_text(
        'ado_authentication: pat\nhttps_hostname: planner.example.com\n'
        'instances:\n  - name: planning\n    image: plannertool:test\n'
    )
    env_file = tmp_path / 'protected.env'
    env_file.write_text('PLANNER_SECRET_KEY=isolated-test-key\n')
    env_file.chmod(0o600)
    output = tmp_path / 'generated stack'
    commands = []
    monkeypatch.setattr('deploy.subprocess.run', lambda command, **options: commands.append(command))

    def reject_certificate(hostname):
        assert hostname == 'planner.example.com'
        raise RuntimeError('HTTPS certificate is not ready')

    monkeypatch.setattr('deploy.wait_for_https', reject_certificate)
    monkeypatch.setattr(sys, 'argv', [
        'deploy.py', '--config', str(manifest), '--output-dir', str(output),
        '--env-file', str(env_file), '--project-name', 'planner-test', '--apply', '--start',
    ])
    with pytest.raises(SystemExit) as result:
        main()
    assert result.value.code == 1
    rendered = capsys.readouterr().out
    assert 'Deployment successful!' not in rendered
    assert 'Containers remain running' in rendered
    assert 'DNS A/AAAA' in rendered
    assert commands[-1][-3:] == ['up', '-d', '--wait']
    assert shlex.split(rendered.splitlines()[-1].strip()) == [
        'docker', 'compose', '--project-name', 'planner-test', '--env-file', str(env_file),
        '--project-directory', str(output), 'logs', '--tail=100', 'caddy',
    ]


def test_http_generation_remains_the_default():
    caddyfile = generate_caddyfile(INSTANCES)
    compose = generate_docker_compose(INSTANCES, "test")

    assert caddyfile.startswith(":80 {")
    assert "handle_path /planning/*" in caddyfile
    assert compose["services"]["caddy"]["ports"] == ["80:80"]
    assert compose["volumes"] == {"data-planning": {}}


def test_https_generation_enables_caddy_tls_and_persists_state():
    hostname = validate_https_hostname("Planner.Example.com")
    caddyfile = generate_caddyfile(INSTANCES, hostname)
    compose = generate_docker_compose(INSTANCES, "test", hostname)

    assert caddyfile.startswith("planner.example.com {")
    assert compose["services"]["caddy"]["ports"] == [
        "80:80",
        "443:443",
        "443:443/udp",
    ]
    assert "./Caddyfile:/etc/caddy/Caddyfile" in compose["services"]["caddy"]["volumes"]
    assert "caddy_data:/data" in compose["services"]["caddy"]["volumes"]
    assert "caddy_config:/config" in compose["services"]["caddy"]["volumes"]
    assert compose["volumes"] == {
        "caddy_data": {},
        "caddy_config": {},
        "data-planning": {},
    }


def test_internal_tls_generation_uses_local_ca_without_acme():
    from deploy import load_https_tls

    tls = load_https_tls({'https_tls': {'mode': 'internal'}}, 'instances.yml', 'planner.example.test')
    caddyfile = generate_caddyfile(INSTANCES, 'planner.example.test', https_tls=tls)
    assert '    tls internal\n' in caddyfile
    compose = generate_docker_compose(INSTANCES, 'test', 'planner.example.test', https_tls=tls)
    assert 'caddy_data:/data' in compose['services']['caddy']['volumes']


def test_provided_tls_generation_mounts_certificate_and_key_read_only():
    tls = {'mode': 'provided', 'certificate_file': '/private/company.pem', 'key_file': '/private/key.pem'}
    caddyfile = generate_caddyfile(INSTANCES, 'planner.example.test', https_tls=tls)
    assert 'auto_https disable_certs' in caddyfile
    assert 'tls /etc/caddy/tls/certificate.pem /etc/caddy/tls/key.pem' in caddyfile
    compose = generate_docker_compose(INSTANCES, 'test', 'planner.example.test', https_tls=tls)
    mounts = compose['services']['caddy']['volumes'][-2:]
    assert [mount['source'] for mount in mounts] == ['/private/company.pem', '/private/key.pem']
    assert all(mount['read_only'] and not mount['bind']['create_host_path'] for mount in mounts)


@pytest.fixture
def tls_files(tmp_path):
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'planner.example.test')])
    now = datetime.now(timezone.utc)
    certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now - timedelta(minutes=1))
                   .not_valid_after(now + timedelta(days=1))
                   .add_extension(x509.SubjectAlternativeName([x509.DNSName('planner.example.test')]), critical=False)
                   .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
                   .sign(key, hashes.SHA256()))
    certificate_file = tmp_path / 'certificate.pem'
    certificate_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_file = tmp_path / 'key.pem'
    key_file.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
    ))
    key_file.chmod(0o600)
    return {'mode': 'provided', 'certificate_file': certificate_file.name,
            'key_file': key_file.name, 'ca_file': certificate_file.name}


def test_provided_tls_validates_pem_files_relative_to_manifest(tls_files, tmp_path):
    from deploy import load_https_tls

    tls = load_https_tls({'https_tls': tls_files}, tmp_path / 'instances.yml', 'planner.example.test')
    for field in ('certificate_file', 'key_file', 'ca_file'):
        assert tls[field] == str(tmp_path / tls_files[field])


@pytest.mark.parametrize('defect', ['missing', 'permissions', 'malformed', 'mismatch', 'encrypted'])
def test_provided_tls_rejects_invalid_key_material(tls_files, tmp_path, defect):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from deploy import load_https_tls

    key = tmp_path / tls_files['key_file']
    if defect == 'missing':
        key.unlink()
    elif defect == 'permissions':
        key.chmod(0o644)
    elif defect == 'malformed':
        key.write_text('not a private key')
    else:
        encryption = (serialization.BestAvailableEncryption(b'test-only-password')
                      if defect == 'encrypted' else serialization.NoEncryption())
        key.write_bytes(ec.generate_private_key(ec.SECP256R1()).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption,
        ))
    with pytest.raises((ValueError, OSError)):
        load_https_tls({'https_tls': tls_files}, tmp_path / 'instances.yml', 'planner.example.test')


def test_internal_ca_export_retries_and_exports_only_public_root(tmp_path, monkeypatch):
    import subprocess
    from unittest.mock import MagicMock
    from deploy import export_internal_ca

    prefix = ['docker', 'compose', '--project-name', 'preview']
    run = MagicMock(side_effect=[
        subprocess.CompletedProcess([], 1), subprocess.CompletedProcess([], 0),
    ])
    monkeypatch.setattr('deploy.subprocess.run', run)
    monkeypatch.setattr('deploy.time.sleep', MagicMock())
    destination = export_internal_ca(prefix, str(tmp_path))
    assert destination == str(tmp_path / 'tls' / 'caddy-root.crt')
    assert run.call_count == 2
    assert run.call_args.args[0] == prefix + [
        'cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', destination,
    ]
    assert run.call_args.kwargs['cwd'] == str(tmp_path)


def test_internal_ca_export_timeout_is_actionable(tmp_path, monkeypatch):
    import subprocess
    from unittest.mock import MagicMock
    from deploy import export_internal_ca

    monkeypatch.setattr('deploy.subprocess.run', MagicMock(return_value=subprocess.CompletedProcess([], 1)))
    monkeypatch.setattr('deploy.time.monotonic', MagicMock(side_effect=[0, 121]))
    with pytest.raises(RuntimeError, match='public root certificate'):
        export_internal_ca(['docker', 'compose'], str(tmp_path))


@pytest.mark.parametrize('mode', ['internal', 'provided'])
def test_private_https_start_uses_selected_trust_without_acme(mode, tls_files, tmp_path, monkeypatch, capsys):
    import yaml
    from unittest.mock import MagicMock
    from deploy import main

    settings = {'mode': 'internal'} if mode == 'internal' else tls_files
    manifest = tmp_path / 'instances.yml'
    manifest.write_text(yaml.safe_dump({
        'ado_authentication': 'pat', 'https_hostname': 'planner.example.test', 'https_tls': settings,
        'instances': [{'name': 'planning', 'image': 'plannertool:test'}],
    }))
    output = tmp_path / 'deployment'
    monkeypatch.setattr('deploy.subprocess.run', MagicMock())
    root = str(output / 'tls' / 'caddy-root.crt')
    export = MagicMock(return_value=root)
    monkeypatch.setattr('deploy.export_internal_ca', export)
    verify = MagicMock()
    monkeypatch.setattr('deploy.wait_for_https', verify)
    monkeypatch.setattr(sys, 'argv', [
        'deploy.py', '--config', str(manifest), '--output-dir', str(output), '--apply', '--start',
    ])
    main()
    verify.assert_called_once_with('planner.example.test', cafile=(
        root if mode == 'internal' else str(tmp_path / tls_files['ca_file'])
    ))
    assert export.call_count == (1 if mode == 'internal' else 0)
    rendered = capsys.readouterr().out
    assert 'no public ACME challenges' in rendered
    assert 'Public DNS A/AAAA' not in rendered
    assert 'Deployment successful!' in rendered
    directive = 'tls internal' if mode == 'internal' else 'tls /etc/caddy/tls/'
    assert directive in (output / 'Caddyfile').read_text()


@pytest.mark.parametrize('settings,hostname', [
    ({'mode': 'unknown'}, 'planner.example.test'),
    ({'mode': 'internal'}, None),
    ({'mode': 'internal', 'key_file': 'key.pem'}, 'planner.example.test'),
    ({'mode': 'provided'}, 'planner.example.test'),
])
def test_invalid_tls_policy_is_rejected(settings, hostname):
    from deploy import load_https_tls

    with pytest.raises(ValueError):
        load_https_tls({'https_tls': settings}, 'instances.yml', hostname)


@pytest.mark.parametrize("hostname", [
    "https://planner.example.com",
    "planner.example.com:443",
    "planner.example.com/path",
    "planner.example.com\n:80",
    "*.planner.example.com",
])
def test_https_hostname_rejects_non_dns_site_addresses(hostname):
    with pytest.raises(argparse.ArgumentTypeError):
        validate_https_hostname(hostname)


@pytest.mark.parametrize('instance', [
    {'name': 'auth'}, {'name': 'alpha', 'backend': 'ado'},
    {'name': 'alpha', 'authentication_provider': 'sandbox'},
    {'name': 'alpha', 'authentication_provider': 'entra'},
])
def test_invalid_authentication_policy_is_rejected(instance):
    with pytest.raises(ValueError):
        generate_docker_compose([instance], 'test')


def test_duplicate_names_rejected():
    with pytest.raises(ValueError, match='unique'):
        generate_caddyfile(INSTANCES * 2)


@pytest.mark.parametrize('mode,valid', [
    ('pat', True), ('entra', True), ('disabled', True), (None, False),
])
def test_deployment_owns_credential_mode_not_backend_selection(mode, valid):
    from deploy_auth import validate_deployment_policy

    config = {'ado_authentication': mode, 'instances': [{'name': 'planning'}]}
    if valid:
        assert validate_deployment_policy(config) == mode
    else:
        with pytest.raises(ValueError):
            validate_deployment_policy(config)


@pytest.fixture
def sandbox_manifest(tmp_path):
    import yaml
    from auth_sandbox import create_sandbox
    from deploy_auth import load_auth_services

    manifest = create_sandbox(tmp_path / 'sandbox')
    config = yaml.safe_load(manifest.read_text())
    services = load_auth_services(config, manifest, None)
    return config, services, manifest


def test_mixed_sandbox_generation_is_isolated_and_secret_scoped(sandbox_manifest):
    config, services, manifest = sandbox_manifest
    compose = generate_docker_compose(config['instances'], 'test', auth_services=services)
    caddy = generate_caddyfile(config['instances'], auth_services=services)
    assert compose['services']['caddy']['ports'] == ['127.0.0.1:18880:80']
    assert compose['networks']['default']['internal'] is True
    auth = compose['services']['auth-sandbox']
    assert set(compose['services']) == {
        'caddy', 'planner-alpha', 'planner-beta', 'planner-local', 'auth-sandbox',
    }
    assert auth['build']['context'] == str(Path(__file__).resolve().parents[2] / 'entra-id')
    app_builds = [service['build'] for name, service in compose['services'].items()
                  if name.startswith('planner-') and 'build' in service]
    assert app_builds == [{
        'context': str(Path(__file__).resolve().parents[2]), 'dockerfile': 'docker/Dockerfile',
    }]
    assert 'ports' not in auth
    assert auth['environment']['ENTRA_AUTH_MODE'] == 'mock'
    assert 'auth-sandbox-state:/app/state' in auth['volumes']
    alpha = compose['services']['planner-alpha']
    assert 'PLANNER_AUTH_URL=http://auth-sandbox:8000/auth/' in alpha['environment']
    assert 'PLANNER_AUTH_PUBLIC_URL=http://localhost:18880/auth/' in alpha['environment']
    assert 'PLANNER_ADO_AUTHENTICATION=entra' in alpha['environment']
    assert 'PLANNER_AUTH_PROVIDER=entra' in alpha['environment']
    assert 'PLANNER_AUTH_PROVIDER=enrollment' in compose['services']['planner-local']['environment']
    assert all(not value.startswith('PLANNER_INSTANCE_BACKEND=')
               for name, service in compose['services'].items() if name.startswith('planner-')
               for value in service['environment'])
    assert alpha['secrets'] == [{'source': 'client-alpha', 'target': 'auth-client'}]
    assert 'secrets' not in compose['services']['planner-local']
    assert 'depends_on' not in compose['services']['planner-local']
    assert caddy.index('handle /auth/*') < caddy.index('handle_path /alpha/*')
    rendered = str(compose) + caddy
    for name in ('client-alpha', 'client-beta', 'broker-key', 'entra-secret'):
        assert (manifest.parent / name).read_text() not in rendered


def test_auth_instances_use_image_command_and_uvicorn_environment(sandbox_manifest, monkeypatch):
    import importlib
    from click.testing import CliRunner

    uvicorn_main = importlib.import_module('uvicorn.main')
    config, services, manifest = sandbox_manifest
    compose = generate_docker_compose(config['instances'], 'test', auth_services=services)
    calls = []
    monkeypatch.setattr(uvicorn_main, 'run', lambda *args, **kwargs: calls.append(kwargs))
    for name in ('alpha', 'beta'):
        planner = compose['services']['planner-' + name]
        assert 'command' not in planner
        environment = dict(value.split('=', 1) for value in planner['environment'])
        result = CliRunner().invoke(uvicorn_main.main, [
            'planner:make_app', '--factory', '--host', '0.0.0.0', '--port', '8000',
            '--root-path', environment['ROOT_PATH'],
        ], env=environment)
        assert result.exit_code == 0, result.output
        assert calls[-1]['root_path'] == '/' + name
        assert calls[-1]['access_log'] is False
        assert calls[-1]['proxy_headers'] is True
        assert calls[-1]['forwarded_allow_ips'] == '*'
    local = compose['services']['planner-local']
    assert 'command' not in local
    assert not any(value.startswith('UVICORN_') for value in local['environment'])


def test_env_mode_conflict_and_registry_mismatch_rejected(sandbox_manifest):
    import yaml
    from deploy_auth import load_auth_services

    config, services, manifest = sandbox_manifest
    env_file = manifest.parent / 'registration.env'
    env_file.write_text(env_file.read_text() + 'ENTRA_AUTH_MODE=entra\n')
    with pytest.raises(ValueError, match='contradicts'):
        load_auth_services(yaml.safe_load(manifest.read_text()), manifest, None)


def test_missing_secret_file_and_unknown_reference_rejected(sandbox_manifest):
    import yaml
    from deploy_auth import load_auth_services

    config, services, manifest = sandbox_manifest
    config['instances'][0]['auth_service'] = 'missing'
    with pytest.raises(ValueError, match='Unknown'):
        load_auth_services(config, manifest, None)
    config = yaml.safe_load(manifest.read_text())
    (manifest.parent / 'client-alpha').unlink()
    with pytest.raises(ValueError, match='Missing'):
        load_auth_services(config, manifest, None)


def test_mock_rejects_mismatched_http_and_https_ingress(sandbox_manifest):
    from deploy_auth import load_auth_services

    config, services, manifest = sandbox_manifest
    with pytest.raises(ValueError, match='matching configured HTTPS ingress'):
        load_auth_services(config, manifest, 'planner.example.test')


def test_dry_run_writes_nothing_and_redacts_secrets(sandbox_manifest, monkeypatch, capsys, tmp_path):
    from deploy import main

    config, services, manifest = sandbox_manifest
    output = tmp_path / 'not-created'
    monkeypatch.setattr(sys, 'argv', ['deploy.py', '--config', str(manifest), '--output-dir', str(output)])
    with pytest.raises(SystemExit) as result:
        main()
    assert result.value.code == 0
    assert not output.exists()
    rendered = capsys.readouterr().out
    for name in ('client-alpha', 'client-beta', 'broker-key', 'entra-secret'):
        disclosed = (manifest.parent / name).read_text() in rendered
        assert disclosed is False


def test_pinned_images_are_not_rebuilt_or_pruned(sandbox_manifest, monkeypatch, tmp_path):
    import yaml
    from deploy import main

    config, services, manifest = sandbox_manifest
    pinned = yaml.safe_load(manifest.read_text())
    for instance in pinned['instances']:
        del instance['build_from_source']
    del pinned['auth_services']['sandbox']['build_from_source']
    manifest.write_text(yaml.safe_dump(pinned))
    commands = []
    monkeypatch.setattr('deploy.subprocess.run', lambda command, **options: commands.append(command))
    output = tmp_path / 'generated'
    monkeypatch.setattr(sys, 'argv', ['deploy.py', '--config', str(manifest), '--output-dir', str(output),
                                    '--apply', '--start'])
    main()
    assert commands == [
        ['docker', 'compose', 'config', '--quiet'],
        ['docker', 'compose', 'up', '-d', '--wait'],
    ]


def test_operator_env_and_project_are_used_for_validation_and_start(sandbox_manifest, monkeypatch, tmp_path):
    import yaml
    from deploy import main

    config, services, manifest = sandbox_manifest
    env_file = manifest.parent / '.env'
    output = tmp_path / 'generated'
    commands = []
    monkeypatch.setattr('deploy.subprocess.run', lambda command, **options: commands.append((command, options)))
    monkeypatch.setattr(sys, 'argv', [
        'deploy.py', '--config', str(manifest), '--output-dir', str(output),
        '--env-file', str(env_file), '--project-name', 'planner-auth-demo', '--apply', '--start',
    ])
    main()
    prefix = ['docker', 'compose', '--project-name', 'planner-auth-demo', '--env-file', str(env_file)]
    assert [command for command, options in commands] == [
        prefix + ['config', '--quiet'], prefix + ['build'], prefix + ['up', '-d', '--wait'],
    ]
    assert all(options['cwd'] == str(output) for command, options in commands)
    rendered = yaml.safe_load((output / 'docker-compose.yml').read_text())
    assert rendered['name'] == 'planner-auth-demo'
    assert '${PLANNER_SECRET_KEY:?' in rendered['services']['planner-alpha']['environment'][1]
    assert env_file.read_text().split('=', 1)[1].strip() not in str(rendered)


def test_generated_start_hint_preserves_operator_configuration(sandbox_manifest, monkeypatch, tmp_path, capsys):
    import shlex
    from deploy import main

    config, services, manifest = sandbox_manifest
    output = tmp_path / 'generated stack'
    env_file = manifest.parent / '.env'
    monkeypatch.setattr(sys, 'argv', [
        'deploy.py', '--config', str(manifest), '--output-dir', str(output),
        '--env-file', str(env_file), '--project-name', 'planner-auth-demo', '--apply',
    ])
    main()
    hint = capsys.readouterr().out.splitlines()[-1].strip()
    assert shlex.split(hint) == [
        'docker', 'compose', '--project-name', 'planner-auth-demo', '--env-file', str(env_file),
        '--project-directory', str(output), 'up', '-d', '--wait',
    ]


def test_invalid_operator_env_fails_before_generation(sandbox_manifest, monkeypatch, tmp_path):
    from deploy import main

    config, services, manifest = sandbox_manifest
    output = tmp_path / 'not-created'
    env_file = manifest.parent / '.env'
    env_file.chmod(0o644)
    monkeypatch.setattr(sys, 'argv', [
        'deploy.py', '--config', str(manifest), '--output-dir', str(output),
        '--env-file', str(env_file), '--apply', '--start',
    ])
    with pytest.raises(SystemExit) as result:
        main()
    assert result.value.code == 2
    assert not output.exists()


def test_failed_compose_validation_does_not_build_or_start(sandbox_manifest, monkeypatch, tmp_path):
    import subprocess
    from deploy import main

    config, services, manifest = sandbox_manifest
    commands = []

    def reject(command, **options):
        commands.append(command)
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr('deploy.subprocess.run', reject)
    monkeypatch.setattr(sys, 'argv', [
        'deploy.py', '--config', str(manifest), '--output-dir', str(tmp_path / 'generated'),
        '--apply', '--start',
    ])
    with pytest.raises(SystemExit) as result:
        main()
    assert result.value.code == 1
    assert commands == [['docker', 'compose', 'config', '--quiet']]


def test_failed_shared_stack_build_does_not_start(sandbox_manifest, monkeypatch, tmp_path):
    import subprocess
    from deploy import main

    config, services, manifest = sandbox_manifest
    commands = []

    def run(command, **options):
        commands.append(command)
        if command[-1] == 'build':
            raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr('deploy.subprocess.run', run)
    monkeypatch.setattr(sys, 'argv', [
        'deploy.py', '--config', str(manifest), '--output-dir', str(tmp_path / 'generated'),
        '--apply', '--start',
    ])
    with pytest.raises(SystemExit) as result:
        main()
    assert result.value.code == 1
    assert commands == [
        ['docker', 'compose', 'config', '--quiet'], ['docker', 'compose', 'build'],
    ]


@pytest.mark.parametrize('https_hostname', [None, 'planner.example.test'])
def test_operator_manifest_manages_auth_wiring_without_a_sandbox_generator(tmp_path, monkeypatch, https_hostname):
    import yaml
    from deploy import main

    config = {
        'ado_authentication': 'entra',
        'auth_services': {'central': {
            'mode': 'mock', 'environment_id': 'preview', 'generation': 'initial',
            'public_url': 'http://localhost:18884/auth/', 'volume_source': 'auth-central-state',
            'registration': {
                'tenant_id': '11111111-1111-1111-1111-111111111111',
                'client_id': '22222222-2222-2222-2222-222222222222', 'organization': 'example',
            },
        }},
        'instances': [
            {'name': name, 'auth_service': 'central'}
            for name in ('roadmap', 'delivery')
        ] + [{'name': 'records'}],
    }
    if https_hostname is not None:
        config['https_hostname'] = https_hostname
        config['auth_services']['central']['public_url'] = f'https://{https_hostname}/auth/'
    manifest = tmp_path / 'instances.yml'
    manifest.write_text(yaml.safe_dump(config))
    commands = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr('deploy.subprocess.run', lambda command, **options: commands.append(command))
    verified = []
    monkeypatch.setattr('deploy.wait_for_https', lambda hostname: verified.append(hostname))
    monkeypatch.setattr(sys, 'argv', ['deploy.py', '--apply', '--start'])

    main()
    output = tmp_path / 'deployment'
    rendered = yaml.safe_load((output / 'docker-compose.yml').read_text())
    assert set(rendered['services']) == {
        'caddy', 'auth-central', 'planner-roadmap', 'planner-delivery', 'planner-records',
    }
    assert 'build' in rendered['services']['auth-central']
    assert 'build' in rendered['services']['planner-roadmap']
    assert rendered['services']['auth-central']['environment']['ENTRA_AUTH_MODE'] == 'mock'
    assert rendered['networks']['default']['internal'] is True
    assert 'ports' not in rendered['services']['auth-central']
    if https_hostname is not None:
        assert rendered['services']['caddy']['ports'] == ['80:80', '443:443', '443:443/udp']
        assert (output / 'Caddyfile').read_text().startswith(https_hostname + ' {')
        assert 'caddy_data:/data' in rendered['services']['caddy']['volumes']
    registry = next(value.split(':', 1)[0] for value in rendered['services']['auth-central']['volumes']
                    if '/app/config/instances.json' in value)
    assert set(__import__('json').loads(Path(registry).read_text())['instances']) == {'roadmap', 'delivery'}
    secret_paths = [Path(value['file']) for value in rendered['secrets'].values()]
    originals = {path: path.read_bytes() for path in secret_paths}
    assert all(path.stat().st_mode & 0o077 == 0 for path in secret_paths)
    assert manifest.read_text() == yaml.safe_dump(config)
    assert commands == [
        ['docker', 'compose', 'config', '--quiet'], ['docker', 'compose', 'build'],
        ['docker', 'compose', 'up', '-d', '--wait'],
    ]
    assert verified == ([] if https_hostname is None else [https_hostname])
    main()
    assert {path: path.read_bytes() for path in secret_paths} == originals


@pytest.mark.parametrize('kind', ['instance', 'auth_service'])
def test_source_build_policy_requires_a_boolean(sandbox_manifest, kind):
    from deploy_auth import load_auth_services

    config, services, manifest = sandbox_manifest
    target = config['instances'][0] if kind == 'instance' else config['auth_services']['sandbox']
    target['build_from_source'] = 'true'
    with pytest.raises(ValueError, match='boolean'):
        load_auth_services(config, manifest, None)
