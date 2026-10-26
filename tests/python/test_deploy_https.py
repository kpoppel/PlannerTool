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
