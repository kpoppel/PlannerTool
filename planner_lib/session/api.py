from fastapi import APIRouter, HTTPException, Response, Request
from fastapi.responses import RedirectResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel, ConfigDict
from typing import Literal

from planner_lib.middleware.session import (
    DEVICE_COOKIE, SESSION_COOKIE, get_session_id_from_request, get_session_context_from_request,
)
from planner_lib.services.resolver import resolve_service
from planner_lib.session.auth import DEVICE_AGE
from planner_lib.middleware.admin import require_admin_session
from planner_lib.accounts.constants import AccountPermissions
from planner_lib.accounts.config import CredentialValidationError

router = APIRouter()
CURRENT_RELEASE = 'v5.0.0'


def _is_entra(request):
    return resolve_service(request, 'authentication_provider') == 'entra'


def _broker_login(request):
    if not _is_entra(request):
        raise HTTPException(403, detail={'error': 'access_denied'})
    return resolve_service(request, 'login_adapter')


def _auth_failure(error):
    return JSONResponse({'error': error.code}, status_code=error.status,
                        headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


@router.get('/auth/config')
async def authentication_config(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    if _is_entra(request):
        return {'mode': 'broker', 'capabilities': resolve_service(request, 'login_adapter').profile()['capabilities']}
    accounts = resolve_service(request, 'account_manager')
    return {'mode': 'pat' if accounts.requires_pat() else 'local', 'capabilities': {
        'pat': accounts.requires_pat(), 'enrollment': True, 'reauthenticate': False,
        'logout': True, 'deleteAccount': True}}


@router.post('/auth/login/begin')
async def login_begin(request: Request, response: Response):
    from planner_lib.session.broker import AuthFailure, LOGIN_COOKIE
    if not _is_entra(request):
        return JSONResponse({'error': 'access_denied'}, status_code=403)
    login = resolve_service(request, 'login_adapter')
    if request.headers.get('origin') != login.settings.completion_url.split('/' + login.settings.instance + '/')[0]:
        return JSONResponse({'error': 'access_denied'}, status_code=403)
    try:
        binding, result = login.begin(request.headers.get('x-planner-login-target', 'app'))
    except AuthFailure as error:
        return _auth_failure(error)
    response.set_cookie(LOGIN_COOKIE, binding, httponly=True, samesite='lax', max_age=300,
                        path=request.scope.get('root_path', '').rstrip('/') + '/api/auth/',
                        secure=request.url.scheme == 'https')
    response.headers['Cache-Control'] = 'no-store'
    return result


class LoginCompletion(BaseModel):
    model_config = ConfigDict(extra='forbid')
    state: str
    code: str


class AuthenticationSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    selected: Literal['enrollment', 'entra']


class LegacyAccountClaim(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str


@router.post('/auth/links/claim')
async def claim_legacy_account(payload: LegacyAccountClaim, request: Request, response: Response):
    from planner_lib.session.broker import AuthFailure

    if not _is_entra(request):
        return JSONResponse({'error': 'access_denied'}, status_code=403)
    context = get_session_context_from_request(request)
    login = resolve_service(request, 'login_adapter')
    origin = login.settings.completion_url.split('/' + login.settings.instance + '/')[0]
    if request.headers.get('origin') != origin:
        return JSONResponse({'error': 'access_denied'}, status_code=403)
    try:
        sid = login.claim_account(context, payload.email)
    except AuthFailure as error:
        return _auth_failure(error)
    except (ValueError, KeyError):
        return JSONResponse({'error': 'access_denied'}, status_code=403)
    response.headers['x-set-session-id'] = sid
    response.headers['Cache-Control'] = 'no-store'
    return login.profile(resolve_service(request, 'session_manager').get(sid))


@router.get('/auth/settings')
@require_admin_session
async def authentication_settings(request: Request, response: Response):
    from planner_lib.session.broker import AuthFailure

    response.headers['Cache-Control'] = 'no-store'
    storage = resolve_service(request, 'storage')
    policy = storage.load('config', 'authentication')
    readiness = 'pat' if resolve_service(request, 'account_manager').requires_pat() else 'local'
    if _is_entra(request):
        try:
            resolve_service(request, 'broker_client').ready()
            readiness = 'ready'
        except AuthFailure:
            readiness = 'unavailable'
    return {**policy, 'deployment_controlled': True, 'readiness': readiness,
            'live_activation': _is_entra(request)}


@router.post('/auth/settings')
@require_admin_session
async def stage_authentication(payload: AuthenticationSelection, request: Request, response: Response):
    return JSONResponse({'error': 'deployment_policy_required'}, status_code=409,
                        headers={'Cache-Control': 'no-store'})


def _complete_login(request, state, code):
    from planner_lib.session.broker import LOGIN_COOKIE
    return _broker_login(request).complete(state, code, request.cookies.get(LOGIN_COOKIE, ''))


@router.post('/auth/login/redirect')
async def login_redirect(request: Request):
    response = Response()
    result = await login_begin(request, response)
    if isinstance(result, Response):
        return result
    redirect = RedirectResponse(result['authorization_url'], status_code=303)
    for key, value in response.raw_headers:
        if key in (b'set-cookie', b'cache-control'):
            redirect.raw_headers.append((key, value))
    return redirect


@router.post('/auth/login/complete')
async def login_complete(payload: LoginCompletion, request: Request, response: Response):
    from planner_lib.session.broker import AuthFailure
    if not _is_entra(request):
        return JSONResponse({'error': 'access_denied'}, status_code=403)
    try:
        sid = _complete_login(request, payload.state, payload.code)
    except AuthFailure as error:
        return _auth_failure(error)
    response.headers['x-set-session-id'] = sid
    response.headers['Cache-Control'] = 'no-store'
    context = resolve_service(request, 'session_manager').get(sid)
    try:
        return resolve_service(request, 'login_adapter').profile(context)
    except AuthFailure as error:
        return _auth_failure(error)


@router.get('/auth/login/callback')
async def login_callback(request: Request):
    from planner_lib.session.broker import AuthFailure, LOGIN_COOKIE
    login = _broker_login(request)
    try:
        pending = login.pending(request.query_params.get('state', ''), request.cookies.get(LOGIN_COOKIE, ''))
    except AuthFailure as error:
        return _auth_failure(error)
    target = pending['return_target']
    if request.query_params.get('error') == 'cancelled':
        if set(request.query_params) != {'state', 'error'} or len(request.query_params.multi_items()) != 2:
            return JSONResponse({'error': 'invalid_session'}, status_code=401)
        try:
            login.cancel(
                request.query_params['state'], request.cookies.get(LOGIN_COOKIE, ''))
        except AuthFailure as error:
            return _auth_failure(error)
        response = _popup_completion(request, pending['state'], target, 'cancelled')
    else:
        if set(request.query_params) != {'state', 'code'} or len(request.query_params.multi_items()) != 2:
            return JSONResponse({'error': 'invalid_session'}, status_code=401)
        try:
            sid = _complete_login(request, request.query_params['state'], request.query_params['code'])
        except AuthFailure as error:
            response = _popup_completion(request, pending['state'], target, error.code)
            response.status_code = error.status
            return response
        response = _popup_completion(request, pending['state'], target)
        if sid is not None:
            response.headers['x-set-session-id'] = sid
    response.delete_cookie(LOGIN_COOKIE, path=request.scope.get('root_path', '').rstrip('/') + '/api/auth/')
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def _popup_completion(request, state, target, error=None):
    import html
    import json
    import secrets
    from urllib.parse import urlsplit

    settings = _broker_login(request).settings
    public = urlsplit(settings.public_url)
    origin = public.scheme + '://' + public.netloc
    destination = '/' + settings.instance + ('/admin' if target == 'admin' else '/')
    nonce = secrets.token_urlsafe(24)
    message = json.dumps({'type': 'planner-auth-complete', 'state': state,
                          'instance': '/' + settings.instance, 'error': error})
    return HTMLResponse(
        '<!doctype html><html lang="en"><title>PlannerTool sign-in</title>'
        + ('<p>Sign-in cancelled.</p>' if error else '<p>Sign-in complete.</p>')
        + '<a href="' + html.escape(destination) + '">Return to PlannerTool</a>'
        + '<script nonce="' + nonce + '">'
        + 'if(window.opener){window.opener.postMessage(' + message + ',' + json.dumps(origin)
        + ');window.close();}else{window.location.replace(' + json.dumps(destination) + ');}'
        + '</script></html>', headers={
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'none'; script-src 'nonce-" + nonce
            + "'; frame-ancestors 'none'; base-uri 'none'",
        })


class ReleaseAcknowledgement(BaseModel):
    releaseId: str


@router.get('/auth/release-notes')
async def release_notes_status(request: Request, response: Response):
    account_id = get_session_context_from_request(request)['account_id']
    storage = resolve_service(request, 'storage')
    response.headers['Cache-Control'] = 'no-store'
    acknowledged = False
    if storage.exists('release_acknowledgements', account_id):
        acknowledged = storage.load('release_acknowledgements', account_id) == CURRENT_RELEASE
    return {'releaseId': CURRENT_RELEASE, 'acknowledged': acknowledged}


@router.post('/auth/release-notes')
async def acknowledge_release(payload: ReleaseAcknowledgement, request: Request, response: Response):
    account_id = get_session_context_from_request(request)['account_id']
    if payload.releaseId != CURRENT_RELEASE:
        raise HTTPException(status_code=400, detail='Unknown release')
    resolve_service(request, 'storage').save('release_acknowledgements', account_id, CURRENT_RELEASE)
    response.headers['Cache-Control'] = 'no-store'
    return {'releaseId': CURRENT_RELEASE, 'acknowledged': True}


class EnrollmentEmail(BaseModel):
    email: str


class Enrollment(BaseModel):
    email: str
    name: str = ''
    accountKey: str = ''
    pat: str | None = None


class AccountDeletion(BaseModel):
    email: str
    accountKey: str
    confirm: bool


def _set_auth_cookies(response: Response, device: str, session: str, request: Request):
    if request.scope.get('root_path', ''):
        response.delete_cookie(SESSION_COOKIE, path='/')
    response.set_cookie(DEVICE_COOKIE, device, httponly=True, samesite='lax',
                        max_age=DEVICE_AGE,
                        path=request.scope.get('root_path', '').rstrip('/') + '/',
                        secure=request.url.scheme == 'https')
    response.headers['x-set-session-id'] = session
    response.headers['Cache-Control'] = 'no-store'


def _email(request: Request):
    return get_session_context_from_request(request)['email']


def _clear_auth_cookies(response: Response, request: Request):
    path = request.scope.get('root_path', '').rstrip('/') + '/'
    for cookie_path in (path, path + 'static/', path + 'admin/static/'):
        response.delete_cookie(SESSION_COOKIE, path=cookie_path)
        response.delete_cookie(DEVICE_COOKIE, path=cookie_path)
    response.headers['Cache-Control'] = 'no-store'


@router.post('/auth/enrollment-status')
async def enrollment_status(payload: EnrollmentEmail, response: Response, request: Request):
    try:
        requires_key = resolve_service(request, 'login_adapter').requires_account_key(payload.email)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    response.headers['Cache-Control'] = 'no-store'
    return {'requiresKey': requires_key,
            'requiresPat': not requires_key
            and resolve_service(request, 'account_manager').requires_pat()}


@router.post('/auth/enroll')
async def enroll(payload: Enrollment, response: Response, request: Request):
    try:
        device, session, result = resolve_service(request, 'login_adapter').enroll(
            payload.email, payload.name, payload.accountKey, payload.pat
        )
    except CredentialValidationError as error:
        raise HTTPException(status_code=400, detail={'error': error.code}) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except PermissionError as error:
        if not payload.accountKey:
            raise HTTPException(status_code=409, detail={'error': 'account_key_required'})
        raise HTTPException(status_code=401, detail='Invalid account key') from error
    _set_auth_cookies(response, device, session, request)
    return result


@router.post('/session')
async def api_session_post(response: Response, request: Request):
    device = request.cookies.get(DEVICE_COOKIE)
    if not device:
        raise HTTPException(status_code=401, detail='Device authentication required')
    try:
        email, session = resolve_service(request, 'login_adapter').authenticate_device(device)
    except PermissionError:
        raise HTTPException(status_code=401, detail='Device authentication required')
    _set_auth_cookies(response, device, session, request)
    return {'email': email}


@router.get('/auth/me')
async def current_account(request: Request):
    if _is_entra(request):
        from planner_lib.session.broker import AuthFailure
        sid = request.cookies.get(SESSION_COOKIE, '')
        context = resolve_service(request, 'session_manager').get(sid)
        try:
            return resolve_service(request, 'login_adapter').profile(context)
        except AuthFailure as error:
            return _auth_failure(error)
    context = get_session_context_from_request(request)
    email = context['email']
    accounts = resolve_service(request, 'account_manager')
    profile = resolve_service(request, 'login_adapter').profile(context['account_id'])
    return {'email': email, 'name': profile['name'],
            'patRequired': accounts.requires_pat(),
            'patError': resolve_service(request, 'credential_policy').credential_error(context['account_id']),
            'permissions': [permission for permission in AccountPermissions.ALL
                            if accounts.has_permission(email, permission)],
            'currentDeviceId': context['device_id'],
            'devices': profile['devices']}


@router.post('/auth/admin-reset/{account_id}')
@require_admin_session
async def admin_reset(account_id: str, response: Response, request: Request):
    try:
        account_key = resolve_service(request, 'login_adapter').reset(account_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='Account not found')
    except ValueError:
        raise HTTPException(status_code=409, detail='Account has not enrolled')
    response.headers['Cache-Control'] = 'no-store'
    return {'accountKey': account_key}


@router.post('/auth/delete-account')
async def delete_account(payload: AccountDeletion, response: Response, request: Request):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail='Account deletion requires confirmation')
    try:
        resolve_service(request, 'login_adapter').delete_account(payload.email, payload.accountKey)
    except PermissionError:
        raise HTTPException(status_code=401, detail='Invalid account key')
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error))
    _clear_auth_cookies(response, request)
    return {'ok': True}


@router.delete('/auth/devices/{device_id}')
async def revoke_device(device_id: str, request: Request):
    try:
        resolve_service(request, 'login_adapter').revoke(_email(request), device_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='Unknown device')
    return {'ok': True}


@router.post('/auth/logout')
async def logout(response: Response, request: Request):
    if _is_entra(request):
        from planner_lib.session.broker import AuthFailure, LOGIN_COOKIE
        login = resolve_service(request, 'login_adapter')
        revocation_pending = False
        try:
            login.logout(request.cookies.get(SESSION_COOKIE, ''))
        except AuthFailure as error:
            import logging
            logging.getLogger(__name__).warning('Local logout complete; broker revocation pending: %s', error.code)
            revocation_pending = True
        _clear_auth_cookies(response, request)
        response.delete_cookie(LOGIN_COOKIE, path=request.scope.get('root_path', '').rstrip('/') + '/api/auth/')
        return {**login.profile(), 'revocation_pending': revocation_pending}
    sid = get_session_id_from_request(request)
    sessions = resolve_service(request, 'session_manager')
    account = get_session_context_from_request(request)
    if account['device_id'] is not None:
        resolve_service(request, 'login_adapter').revoke(account['email'], account['device_id'])
    sessions.delete(sid)
    _clear_auth_cookies(response, request)
    return {'ok': True}
