"""Standalone Entra authentication broker for registered PlannerTool instances."""
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import msal
from fastapi import FastAPI
from starlette.middleware.trustedhost import TrustedHostMiddleware


ENV_NAMES = ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ADO_ORGANIZATION')


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

    def __post_init__(self):
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
            secret = Path(secret_file).read_text().strip()
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
        )
        object.__setattr__(settings, 'broker_config', BrokerConfig.from_env(settings))
        if settings.broker_config.public_url != settings.origin + settings.root_path + '/':
            raise ValueError('Broker public URL must match the configured callback')
        return settings

    @property
    def missing(self):
        values = (self.tenant_id, self.client_id, self.client_secret, self.organization)
        return [name for name, value in zip(ENV_NAMES, values) if not value]

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


if __name__ == '__main__':
    import uvicorn

    configuration = Settings.from_env()
    uvicorn.run(create_app(configuration), host=configuration.listen_host,
                port=configuration.listen_port, access_log=False, proxy_headers=False)