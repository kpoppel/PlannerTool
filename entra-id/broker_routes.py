"""Authenticated instance protocol and isolated sandbox browser flow."""
import hmac
import html
import json
import re
import secrets
import threading
import time
from urllib.parse import urlencode
from uuid import UUID, uuid5

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from broker import BrokerStore, CODE_TTL, ProtocolError, digest, read_secret


BROWSER_COOKIE = 'planner_broker_browser'


def install_broker(app, settings, config):
    store = BrokerStore(config)
    app.state.broker_store = store
    origin = settings.origin
    secret_hashes = {name: digest(read_secret(value['secret_file']))
                     for name, value in config.instances.items()}
    limits = {}
    limit_lock = threading.Lock()

    @app.exception_handler(ProtocolError)
    async def protocol_error(request, error):
        return JSONResponse({'error': error.code}, status_code=error.status)

    @app.middleware('http')
    async def bounded_protocol(request, call_next):
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 16384:
                return JSONResponse({'error': 'request_too_large'}, status_code=413)
        request._body = bytes(body)
        return await call_next(request)

    def require_ready():
        if config.mode != 'mock':
            raise ProtocolError('auth_configuration_error', 503)

    def throttle(request):
        peer = request.client.host if request.client else 'unknown'
        now = time.monotonic()
        with limit_lock:
            for key, value in list(limits.items()):
                if now - value[0] >= 60:
                    del limits[key]
            if peer not in limits:
                if len(limits) >= 1024:
                    raise ProtocolError('rate_limited', 429)
                limits[peer] = [now, 0]
            limits[peer][1] += 1
            if limits[peer][1] > 300:
                raise ProtocolError('rate_limited', 429)

    async def authenticate(request, fields):
        throttle(request)
        owner = request.headers.get('x-planner-instance', '')
        supplied = request.headers.get('authorization', '')
        expected = secret_hashes.get(owner)
        if (expected is None or not supplied.startswith('Bearer ')
                or not hmac.compare_digest(digest(supplied[7:]), expected)):
            raise ProtocolError('invalid_instance', 403)
        if request.headers.get('content-type', '').split(';')[0] != 'application/json':
            raise ProtocolError('invalid_request')
        try:
            payload = await request.json()
        except ValueError as error:
            raise ProtocolError('invalid_request') from error
        if not isinstance(payload, dict) or set(payload) != set(fields) | set(store.metadata()):
            raise ProtocolError('invalid_request')
        if any(payload[key] != value for key, value in store.metadata().items()):
            raise ProtocolError('invalid_environment', 403)
        if any(not isinstance(payload[key], str) or len(payload[key]) > 2048 for key in fields):
            raise ProtocolError('invalid_request')
        require_ready()
        return owner, payload

    @app.get('/health')
    def health():
        return {'healthy': True}

    @app.get('/v1/readiness')
    def readiness():
        return JSONResponse({**store.metadata(), 'ready': config.mode == 'mock',
                             'live_capable': False}, status_code=200 if config.mode == 'mock' else 503)

    @app.post('/v1/transactions/begin')
    async def begin(request: Request):
        owner, payload = await authenticate(request, {'completion_url', 'challenge', 'state'})
        reference, expires = store.begin(owner, payload['completion_url'], payload['challenge'], payload['state'])
        return {**store.metadata(), 'transaction': reference, 'expires_at': expires,
                'authorization_url': config.public_url + 'v1/browser/authorize?' + urlencode({'transaction': reference})}

    @app.post('/v1/deployment/readiness')
    async def deployment_readiness(request: Request):
        owner, payload = await authenticate(request, set())
        return {**store.metadata(), 'ready': True, 'instances': sorted(config.instances),
                'completion_urls': {name: value['completion_url'] for name, value in config.instances.items()},
                'tenant': settings.tenant_id, 'organization': settings.organization}

    @app.post('/v1/transactions/redeem')
    async def redeem(request: Request):
        owner, payload = await authenticate(request, {'transaction', 'code', 'verifier'})
        return store.redeem(owner, payload['transaction'], payload['code'], payload['verifier'])

    @app.post('/v1/grants/{operation}')
    async def grant_operation(operation: str, request: Request):
        if operation not in ('status', 'token', 'revoke'):
            raise ProtocolError('unknown_operation', 404)
        fields = {'grant', 'resource'} if operation == 'token' else {'grant'}
        owner, payload = await authenticate(request, fields)
        return store.grant(owner, payload['grant'], operation, payload.get('resource'))

    @app.get('/v1/browser/authorize')
    def authorize(request: Request):
        throttle(request)
        require_ready()
        if list(request.query_params) != ['transaction']:
            raise ProtocolError('invalid_request')
        reference = request.query_params['transaction']
        browser = secrets.token_urlsafe(32)
        store.bind_browser(reference, browser)
        response = HTMLResponse(
            '<!doctype html><html lang="en"><title>Sandbox sign-in</title><h1>Sandbox sign-in</h1>'
            f'<form method="post" action="{settings.root_path}/v1/browser/choose">'
            f'<input type="hidden" name="transaction" value="{html.escape(reference)}">'
            '<label for="email">Account email</label>'
            '<input id="email" name="email" type="email" autocomplete="email" maxlength="254" required>'
            '<button name="action" value="sign_in">Sign in</button>'
            '<button name="action" value="cancel" formnovalidate>Cancel</button></form></html>')
        response.set_cookie(BROWSER_COOKIE, browser, httponly=True, samesite='lax',
                            secure=settings.secure, path=settings.root_path + '/', max_age=300)
        return response

    @app.post('/v1/browser/choose')
    async def choose(request: Request):
        from urllib.parse import parse_qs

        throttle(request)
        require_ready()
        if request.headers.get('origin') != origin:
            raise ProtocolError('invalid_origin', 403)
        try:
            values = parse_qs((await request.body()).decode(), strict_parsing=True)
        except (ValueError, UnicodeDecodeError) as error:
            raise ProtocolError('invalid_request') from error
        if set(values) - {'transaction', 'email', 'action'} or any(len(value) != 1 for value in values.values()):
            raise ProtocolError('invalid_request')
        if 'transaction' not in values or 'action' not in values:
            raise ProtocolError('invalid_request')
        reference = values['transaction'][0]
        action = values['action'][0]
        if action not in ('sign_in', 'cancel'):
            raise ProtocolError('invalid_identity')
        identity = None
        if action == 'sign_in':
            if 'email' not in values:
                raise ProtocolError('invalid_identity')
            email = values['email'][0].strip().casefold()
            if len(email) > 254 or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
                raise ProtocolError('invalid_identity')
            identity = {'tid': settings.tenant_id,
                        'oid': str(uuid5(UUID(settings.tenant_id), email)),
                        'name': email, 'email': email}
        browser = request.cookies.get(BROWSER_COOKIE, '')
        upstream_code = secrets.token_urlsafe(32)
        with store.connection() as connection:
            transaction = store.get(connection, reference, 'transaction')
            if transaction['browser'] is None or not hmac.compare_digest(transaction['browser'], digest(browser)):
                raise ProtocolError('invalid_browser')
            store.put(connection, upstream_code, 'upstream', transaction['owner'],
                      store.clock() + CODE_TTL, {'transaction': reference, 'browser': digest(browser),
                                                'identity': identity})
        return RedirectResponse(settings.root_path + '/callback?' + urlencode({
            'state': reference, 'code': upstream_code}), status_code=303)

    @app.get('/callback')
    def callback(request: Request):
        throttle(request)
        require_ready()
        if (set(request.query_params) != {'state', 'code'}
                or len(request.query_params.multi_items()) != 2):
            raise ProtocolError('invalid_request')
        reference = request.query_params['state']
        upstream_code = request.query_params['code']
        browser = request.cookies.get(BROWSER_COOKIE, '')
        with store.connection() as connection:
            upstream = store.get(connection, upstream_code, 'upstream')
            if (upstream['transaction'] != reference
                    or not hmac.compare_digest(upstream['browser'], digest(browser))):
                raise ProtocolError('invalid_browser')
            transaction = store.get(connection, reference, 'transaction')
            connection.execute('DELETE FROM records WHERE id=?', (digest(upstream_code),))
            if upstream['identity'] is None or transaction['scenario'] == 'cancel':
                connection.execute('DELETE FROM records WHERE id=?', (digest(reference),))
                return RedirectResponse(transaction['completion'] + '?' + urlencode({
                    'state': transaction['state'], 'error': 'cancelled'}), status_code=303)
        transaction, code = store.authorize(reference, browser, upstream['identity'])
        return RedirectResponse(transaction['completion'] + '?' + urlencode({
            'state': transaction['state'], 'code': code}), status_code=303)