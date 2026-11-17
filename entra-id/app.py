"""Standalone Entra authentication broker for registered PlannerTool instances."""
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import msal
from cryptography import x509
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from starlette.middleware.trustedhost import TrustedHostMiddleware


def read_credential_file(name, filename):
    source = Path(filename)
    try:
        if source.stat().st_mode & 0o077:
            raise ValueError(f'{name} requires mode 0600; do not broaden private file permissions')
        value = source.read_text()
    except OSError as error:
        raise ValueError(f'{name} must point to a readable file. For Docker, provision '
                         'broker UID 1000 access to the file and parent directories') from error
    if not value.strip():
        raise ValueError(f'{name} must not be empty')
    return value


@dataclass(frozen=True)
class Settings:
    tenant_id: str
    client_id: str
    client_secret: str = field(repr=False)
    organization: str
    redirect_uri: str = 'http://localhost:8765/auth/callback'
    listen_host: str = '127.0.0.1'
    listen_port: int = 8765
    auth_mode: str = 'entra'
    network: str = 'loopback'
    internal_host: str = ''
    broker_config: object = field(default=None, repr=False)
    client_certificate_key: str = field(default='', repr=False)
    client_certificate: str = ''

    def __post_init__(self):
        if self.client_certificate_key or self.client_certificate:
            if self.client_secret:
                raise ValueError('Configure a certificate or a client secret, not both')
            if not self.client_certificate_key.strip() or not self.client_certificate.strip():
                raise ValueError('Certificate requires both a PEM private key and public certificate')
        if self.auth_mode not in ('entra', 'mock'):
            raise ValueError('ENTRA_AUTH_MODE must be "entra" or "mock"')
        if self.network not in ('loopback', 'private-compose'):
            raise ValueError('ENTRA_NETWORK must be loopback or private-compose')
        if self.network == 'private-compose' and (
                not re.fullmatch(r'auth-[a-z][a-z0-9-]*', self.internal_host)
                or self.listen_host != '0.0.0.0'):
            raise ValueError('Private Compose listeners require an explicit auth service hostname')
        for value in (self.tenant_id, self.client_id):
            if value and str(UUID(value)) != value:
                raise ValueError('Tenant and client IDs must be canonical lowercase GUIDs')
        if self.organization and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*', self.organization):
            raise ValueError('ADO_ORGANIZATION must be an organization name, not a URL')
        parsed = urlsplit(self.redirect_uri)
        if (not parsed.hostname or parsed.scheme not in ('http', 'https')
                or parsed.path != '/auth/callback'
                or parsed.query or parsed.fragment or parsed.username or parsed.password):
            raise ValueError('Use an HTTPS callback URL ending in /auth/callback')
        if parsed.scheme == 'http' and (parsed.hostname != 'localhost' or parsed.port is None):
            raise ValueError('HTTP is allowed only for http://localhost:PORT/auth/callback')
        if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', parsed.hostname):
            raise ValueError('The callback must use a lowercase DNS hostname')
        if parsed.port == 0 or not 1 <= self.listen_port <= 65535:
            raise ValueError('Ports must be between 1 and 65535')
        if self.auth_mode == 'mock' and self.network != 'private-compose' and (
                parsed.scheme != 'http' or parsed.hostname != 'localhost'
                or self.listen_host not in ('127.0.0.1', 'localhost', '::1')):
            raise ValueError('Mock listeners require localhost or the private Compose network for HTTPS ingress')

    @classmethod
    def from_env(cls):
        from broker import BrokerConfig

        redirect_uri = os.environ.get('ENTRA_REDIRECT_URI', 'http://localhost:8765/auth/callback')
        secret = os.environ.get('ENTRA_CLIENT_SECRET', '')
        secret_file = os.environ.get('ENTRA_CLIENT_SECRET_FILE', '')
        if secret_file:
            if secret:
                raise ValueError('Set ENTRA_CLIENT_SECRET or ENTRA_CLIENT_SECRET_FILE, not both')
            secret = read_credential_file('ENTRA_CLIENT_SECRET_FILE', secret_file).strip()
        certificate_key_file = os.environ.get('ENTRA_CLIENT_CERTIFICATE_KEY_FILE', '')
        certificate_file = os.environ.get('ENTRA_CLIENT_CERTIFICATE_FILE', '')
        if (certificate_key_file or certificate_file) and (secret or secret_file):
            raise ValueError('Configure a certificate or a client secret file, not both')
        if bool(certificate_key_file) != bool(certificate_file):
            raise ValueError('Certificate requires both ENTRA_CLIENT_CERTIFICATE_KEY_FILE '
                             'and ENTRA_CLIENT_CERTIFICATE_FILE')
        certificate_key = read_credential_file(
            'ENTRA_CLIENT_CERTIFICATE_KEY_FILE', certificate_key_file) if certificate_key_file else ''
        certificate = read_credential_file(
            'ENTRA_CLIENT_CERTIFICATE_FILE', certificate_file) if certificate_file else ''
        parsed = urlsplit(redirect_uri)
        default_port = parsed.port if parsed.scheme == 'http' else 8765
        settings = cls(
            tenant_id=os.environ.get('ENTRA_TENANT_ID', ''),
            client_id=os.environ.get('ENTRA_CLIENT_ID', ''),
            client_secret=secret,
            organization=os.environ.get('ADO_ORGANIZATION', ''),
            redirect_uri=redirect_uri,
            listen_host=os.environ.get('ENTRA_LISTEN_HOST', '127.0.0.1'),
            listen_port=int(os.environ.get('ENTRA_LISTEN_PORT', str(default_port))),
            auth_mode=os.environ.get('ENTRA_AUTH_MODE', 'entra'),
            network=os.environ.get('ENTRA_NETWORK', 'loopback'),
            internal_host=os.environ.get('ENTRA_INTERNAL_HOST', ''),
            client_certificate_key=certificate_key,
            client_certificate=certificate,
        )
        object.__setattr__(settings, 'broker_config', BrokerConfig.from_env(settings))
        if settings.broker_config.public_url != settings.origin + settings.root_path + '/':
            raise ValueError('Broker public URL must match the configured callback')
        return settings

    @property
    def missing(self):
        values = (self.tenant_id, self.client_id, self.client_credential, self.organization)
        names = ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID',
                 'ENTRA_CLIENT_SECRET or ENTRA_CLIENT_CERTIFICATE_KEY_FILE with '
                 'ENTRA_CLIENT_CERTIFICATE_FILE', 'ADO_ORGANIZATION')
        return [name for name, value in zip(names, values) if not value]

    @property
    def client_credential(self):
        if self.client_certificate_key:
            return {'private_key': self.client_certificate_key,
                    'public_certificate': self.client_certificate}
        return self.client_secret

    def validate_credentials(self):
        if self.missing:
            raise ValueError('Broker registration is incomplete: ' + ', '.join(self.missing))
        if self.auth_mode == 'mock':
            return 'Mock (fixture credentials only)'
        if not self.client_certificate:
            return 'Entra application secret'
        try:
            certificate = x509.load_pem_x509_certificate(self.client_certificate.encode())
        except (ValueError, UnsupportedAlgorithm) as error:
            raise ValueError('ENTRA_CLIENT_CERTIFICATE_FILE must contain a PEM X.509 certificate') from error
        try:
            key = serialization.load_pem_private_key(self.client_certificate_key.encode(), password=None)
        except (TypeError, ValueError, UnsupportedAlgorithm) as error:
            raise ValueError('ENTRA_CLIENT_CERTIFICATE_KEY_FILE must contain an unencrypted PEM RSA '
                             'private key; convert PFX files before configuring the broker') from error
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
            raise ValueError('Entra certificate authentication requires an RSA key of at least 2048 bits')
        public_format = serialization.PublicFormat.SubjectPublicKeyInfo
        if (key.public_key().public_bytes(serialization.Encoding.DER, public_format)
                != certificate.public_key().public_bytes(serialization.Encoding.DER, public_format)):
            raise ValueError('Entra certificate and private key must be a matching pair')
        now = datetime.now(timezone.utc)
        if certificate.not_valid_before_utc > now:
            raise ValueError('Entra certificate is not yet valid; check certificate dates and system time')
        if certificate.not_valid_after_utc <= now:
            raise ValueError('Entra certificate has expired; register a replacement and rotate the PEM files')
        return 'Entra certificate (SHA-256 assertions)'

    @property
    def origin(self):
        parsed = urlsplit(self.redirect_uri)
        return f'{parsed.scheme}://{parsed.netloc}'

    @property
    def root_path(self):
        return '/auth'

    @property
    def secure(self):
        return urlsplit(self.redirect_uri).scheme == 'https'


def create_app(settings=None, client_factory=msal.ConfidentialClientApplication):
    from broker_routes import install_broker

    if settings is None:
        settings = Settings.from_env()
    if settings.broker_config is None:
        raise ValueError('Broker registration, secrets and persistent storage are required')
    app = FastAPI(root_path=settings.root_path, docs_url=None, redoc_url=None, openapi_url=None)
    allowed_hosts = [urlsplit(settings.redirect_uri).hostname]
    if settings.network == 'private-compose':
        allowed_hosts.append(settings.internal_host)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    install_broker(app, settings, settings.broker_config, client_factory)

    @app.middleware('http')
    async def protect_responses(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = (
            'same-origin' if request.url.path.endswith('/v1/browser/authorize') else 'no-referrer'
        )
        response.headers['X-Content-Type-Options'] = 'nosniff'
        if settings.secure:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        response.headers['Content-Security-Policy'] = (
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
        )
        return response

    return app


def main(argv=None):
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description='Entra broker: certificate or application-secret authentication')
    parser.add_argument('--check', action='store_true',
                        help='Validate local configuration without network requests or token-store writes')
    arguments = parser.parse_args(argv)
    guidance = '\nSee docs/DEPLOYMENT.md for registration, PEM generation and protected file setup.\n'
    try:
        configuration = Settings.from_env()
        credential = configuration.validate_credentials()
        if arguments.check:
            print('Broker configuration valid: ' + credential + '. Local checks only; Microsoft access is unverified.')
            return
        application = create_app(configuration)
    except KeyError as error:
        parser.exit(2, 'ERROR: Missing required broker setting: ' + str(error.args[0]) + guidance)
    except ValueError as error:
        parser.exit(2, 'ERROR: ' + str(error) + guidance)
    except OSError:
        parser.exit(2, 'ERROR: Cannot access broker configuration or storage. Check protected file paths '
                    'and broker UID 1000 ownership in Docker.' + guidance)
    print('Broker authentication: ' + credential)
    uvicorn.run(application, host=configuration.listen_host,
                port=configuration.listen_port, access_log=False, proxy_headers=False)


if __name__ == '__main__':
    main()