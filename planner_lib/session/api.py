from fastapi import APIRouter, HTTPException, Response, Request
from pydantic import BaseModel

from planner_lib.middleware.session import (
    DEVICE_COOKIE, SESSION_COOKIE, get_session_id_from_request, get_session_context_from_request,
)
from planner_lib.services.resolver import resolve_service
from planner_lib.session.auth import DEVICE_AGE
from planner_lib.middleware.admin import require_admin_session

router = APIRouter()


class EnrollmentEmail(BaseModel):
    email: str


class Enrollment(BaseModel):
    email: str
    name: str = ''
    accountKey: str = ''


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
        requires_key = resolve_service(request, 'auth_manager').requires_account_key(payload.email)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    response.headers['Cache-Control'] = 'no-store'
    return {'requiresKey': requires_key}


@router.post('/auth/enroll')
async def enroll(payload: Enrollment, response: Response, request: Request):
    initial_setup = not resolve_service(request, 'storage').exists('auth_control', 'bootstrap_claimed')
    initial_setup = initial_setup and resolve_service(request, 'account_manager').count_all_with_permission('admin') == 0
    try:
        device, account_key, session = resolve_service(request, 'auth_manager').enroll(
            payload.email, payload.name, payload.accountKey
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except PermissionError as error:
        if not payload.accountKey:
            raise HTTPException(status_code=409, detail={'error': 'account_key_required'})
        raise HTTPException(status_code=401, detail='Invalid account key') from error
    _set_auth_cookies(response, device, session, request)
    accounts = resolve_service(request, 'account_manager')
    record = resolve_service(request, 'storage').load('account_auth', accounts.get_account_id(payload.email))
    return {'email': payload.email, 'name': record['name'], 'accountKey': account_key,
            'initialSetup': initial_setup}


@router.post('/session')
async def api_session_post(response: Response, request: Request):
    device = request.cookies.get(DEVICE_COOKIE)
    if not device:
        raise HTTPException(status_code=401, detail='Device authentication required')
    try:
        email, session = resolve_service(request, 'auth_manager').authenticate_device(device)
    except PermissionError:
        raise HTTPException(status_code=401, detail='Device authentication required')
    _set_auth_cookies(response, device, session, request)
    return {'email': email}


@router.get('/auth/me')
async def current_account(request: Request):
    email = _email(request)
    accounts = resolve_service(request, 'account_manager')
    storage = resolve_service(request, 'storage')
    record = storage.load('account_auth', accounts.get_account_id(email))
    return {'email': email, 'name': record['name'],
            'currentDeviceId': get_session_context_from_request(request)['device_id'],
            'devices': resolve_service(request, 'auth_manager').devices(email)}


@router.post('/auth/admin-reset/{account_id}')
@require_admin_session
async def admin_reset(account_id: str, response: Response, request: Request):
    try:
        account = resolve_service(request, 'account_manager').get_account_by_id(account_id)
        account_key = resolve_service(request, 'auth_manager').reset(account['email'])
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
        resolve_service(request, 'auth_manager').delete_account(payload.email, payload.accountKey)
    except PermissionError:
        raise HTTPException(status_code=401, detail='Invalid account key')
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error))
    _clear_auth_cookies(response, request)
    return {'ok': True}


@router.delete('/auth/devices/{device_id}')
async def revoke_device(device_id: str, request: Request):
    try:
        resolve_service(request, 'auth_manager').revoke(_email(request), device_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='Unknown device')
    return {'ok': True}


@router.post('/auth/logout')
async def logout(response: Response, request: Request):
    sid = get_session_id_from_request(request)
    sessions = resolve_service(request, 'session_manager')
    account = get_session_context_from_request(request)
    if account['device_id'] is not None:
        resolve_service(request, 'auth_manager').revoke(account['email'], account['device_id'])
    sessions.delete(sid)
    _clear_auth_cookies(response, request)
    return {'ok': True}
