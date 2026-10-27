"""Reviewed ADO process catalogue endpoints."""
import asyncio

from fastapi import APIRouter, HTTPException, Request

from planner_lib.accounts.constants import AccountPermissions
from planner_lib.azure.catalogue import CatalogueError
from planner_lib.backend.port import BackendCredential
from planner_lib.middleware.admin import require_permission
from planner_lib.middleware.session import get_session_credentials_from_request
from planner_lib.services.resolver import resolve_service

router = APIRouter()


@router.get('/admin/v1/ado-processes')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_get_ado_processes(request: Request):
    return {'content': resolve_service(request, 'admin_service').reconcile_ado_plan_imports()}


@router.post('/admin/v1/ado-processes/resolve')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_resolve_ado_process(request: Request):
    payload = await request.json()
    if (not isinstance(payload, dict) or set(payload) != {'project'}
            or not isinstance(payload['project'], str) or not payload['project'].strip()):
        raise HTTPException(400, detail={
            'error': 'invalid_project', 'message': 'Provide an ADO project name'})
    project = payload['project'].strip().casefold()
    service = resolve_service(request, 'admin_service')
    stored = service.get_ado_processes()['processes']
    for process in stored:
        if project in {name.casefold() for name in process['projects']}:
            content = service.reconcile_ado_plan_imports()
            return {'content': next(entry for entry in content['processes']
                                    if entry['id'] == process['id'])}
    azure = resolve_service(request, 'azure_client')
    context = get_session_credentials_from_request(request)
    credential = BackendCredential(
        kind='pat',
        token=context['pat'],
        user_id=context['account_id'],
    )
    known = {process['id']: process for process in stored}

    def fetch():
        with azure.connect(credential) as client:
            process = next((entry for entry in client.list_processes()
                            if project in {name.casefold() for name in entry['projects']}), None)
            if process is None:
                raise HTTPException(404, detail={
                    'error': 'project_process_not_found',
                    'message': f"No accessible process found for ADO project {payload['project']}"})
            if process['id'] in known:
                process['types'] = known[process['id']]['types']
            else:
                process['types'] = client.get_process_types(process['id'])
            return process

    process = await asyncio.to_thread(fetch)
    return {'content': service.load_ado_process(process)}


@router.post('/admin/v1/ado-processes/refresh')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_refresh_ado_processes(request: Request):
    service = resolve_service(request, 'admin_service')
    stored = service.get_ado_processes()
    if not stored['processes']:
        return {'ok': True, 'content': stored}
    known = {process['id']: process for process in stored['processes']}
    plans = service.get_config('projects', default={'project_map': []})['project_map']
    plan_projects = {plan['area_path'].replace('/', '\\').lstrip('\\').split('\\')[0].casefold()
                     for plan in plans}
    azure = resolve_service(request, 'azure_client')
    context = get_session_credentials_from_request(request)
    credential = BackendCredential(
        kind='pat',
        token=context['pat'],
        user_id=context['account_id'],
    )

    def fetch():
        with azure.connect(credential) as client:
            processes = [process for process in client.list_processes()
                         if process['id'] in known and (any(
                             name.casefold() in plan_projects for name in process['projects']) or any(
                             item['imported'] for item in known[process['id']]['types']))]
            for process in processes:
                process['types'] = client.get_process_types(process['id'])
            return processes

    processes = await asyncio.to_thread(fetch)
    content = service.refresh_ado_processes(processes)
    return {'ok': True, 'content': content}


@router.post('/admin/v1/ado-processes')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_save_ado_processes(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict) or 'content' not in payload:
        raise HTTPException(400, detail={'error': 'invalid_catalogue', 'message': 'Missing content'})
    try:
        content = resolve_service(request, 'admin_service').save_ado_processes(payload['content'])
    except CatalogueError as error:
        raise HTTPException(400, detail={'error': error.code, 'message': str(error)}) from error
    return {'ok': True, 'content': content}