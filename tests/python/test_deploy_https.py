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


INSTANCES = [{"name": "planning", "authentication_provider": "enrollment"}]


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
    {'name': 'alpha'}, {'name': 'auth', 'authentication_provider': 'enrollment'},
    {'name': 'alpha', 'authentication_provider': 'sandbox'},
    {'name': 'alpha', 'authentication_provider': 'entra'},
])
def test_invalid_authentication_policy_is_rejected(instance):
    with pytest.raises(ValueError):
        generate_docker_compose([instance], 'test')


def test_duplicate_names_rejected():
    with pytest.raises(ValueError, match='unique'):
        generate_caddyfile(INSTANCES * 2)


@pytest.mark.parametrize('mode,backend,provider,valid', [
    ('pat', 'ado', 'enrollment', True),
    ('entra', 'ado', 'entra', True),
    ('entra', 'ado', 'enrollment', False),
    ('pat', 'ado', 'entra', False),
    ('disabled', 'ado', 'enrollment', False),
    ('disabled', 'local', 'enrollment', True),
    ('entra', 'local', 'enrollment', True),
    ('entra', 'local', 'entra', False),
    (None, 'local', 'enrollment', False),
])
def test_deployment_owns_ado_mode(mode, backend, provider, valid):
    from deploy_auth import validate_deployment_policy

    config = {'ado_authentication': mode, 'instances': [
        {'name': 'alpha', 'backend': backend, 'authentication_provider': provider}]}
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
    assert 'ports' not in auth
    assert auth['environment']['ENTRA_AUTH_MODE'] == 'mock'
    assert 'auth-sandbox-state:/app/state' in auth['volumes']
    alpha = compose['services']['planner-alpha']
    assert 'PLANNER_AUTH_URL=http://auth-sandbox:8000/auth/' in alpha['environment']
    assert 'PLANNER_AUTH_PUBLIC_URL=http://localhost:18880/auth/' in alpha['environment']
    assert alpha['secrets'] == [{'source': 'client-alpha', 'target': 'auth-client'}]
    assert 'secrets' not in compose['services']['planner-local']
    assert 'depends_on' not in compose['services']['planner-local']
    assert caddy.index('handle /auth/*') < caddy.index('handle_path /alpha/*')
    rendered = str(compose) + caddy
    for name in ('client-alpha', 'client-beta', 'broker-key', 'entra-secret'):
        assert (manifest.parent / name).read_text() not in rendered


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


def test_sandbox_rejects_live_https_ingress(sandbox_manifest):
    from deploy_auth import load_auth_services

    config, services, manifest = sandbox_manifest
    with pytest.raises(ValueError, match='loopback'):
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
    from deploy import main

    config, services, manifest = sandbox_manifest
    commands = []
    monkeypatch.setattr('deploy.subprocess.run', lambda command, **options: commands.append(command))
    output = tmp_path / 'generated'
    monkeypatch.setattr(sys, 'argv', ['deploy.py', '--config', str(manifest), '--output-dir', str(output),
                                    '--apply', '--start'])
    main()
    assert commands == [['docker', 'compose', 'up', '-d']]
