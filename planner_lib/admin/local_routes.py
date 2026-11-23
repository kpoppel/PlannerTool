"""Local backend administration: catalogue and plan definitions."""
import asyncio

from fastapi import APIRouter, HTTPException, Request

from planner_lib.accounts.constants import AccountPermissions
from planner_lib.local.catalogue import CatalogueInUseError, LocalCatalogue, StaleRevisionError
from planner_lib.local.plans import LocalPlans, PlanInUseError
from planner_lib.middleware.admin import require_permission
from planner_lib.services.resolver import resolve_service

router = APIRouter()


def _catalogue(request) -> LocalCatalogue:
    return LocalCatalogue(resolve_service(request, 'planner_database'))


def _plans(request) -> LocalPlans:
    return LocalPlans(resolve_service(request, 'planner_database'), resolve_service(request, 'storage'))


async def _content(request):
    try:
        payload = await request.json()
    except ValueError:
        payload = None
    if not isinstance(payload, dict) or set(payload) != {'content'}:
        raise HTTPException(400, detail={'error': 'invalid_payload', 'message': 'Expecting {"content": ...}'})
    return payload['content']


async def _run(operation, *args):
    try:
        return {'content': await asyncio.to_thread(operation, *args)}
    except StaleRevisionError as error:
        raise HTTPException(409, detail={'error': 'stale_revision', 'message': str(error)}) from error
    except (CatalogueInUseError, PlanInUseError) as error:
        raise HTTPException(409, detail={'error': 'definition_in_use', 'message': str(error)}) from error
    except ValueError as error:
        raise HTTPException(400, detail={'error': 'invalid_definition', 'message': str(error)}) from error


@router.get('/admin/v1/local/catalogue')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_get_local_catalogue(request: Request):
    return await _run(_catalogue(request).read)


@router.put('/admin/v1/local/catalogue')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_save_local_catalogue(request: Request):
    return await _run(_catalogue(request).save, await _content(request))


@router.post('/admin/v1/local/catalogue/starter')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_create_starter_catalogue(request: Request):
    content = await _content(request)
    if not isinstance(content, dict) or set(content) != {'revision'} or type(content['revision']) is not int:
        raise HTTPException(400, detail={'error': 'invalid_payload', 'message': 'Expecting {"revision": n}'})
    return await _run(_catalogue(request).create_starter, content['revision'])


@router.get('/admin/v1/local/plans')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_get_local_plans(request: Request):
    return await _run(_plans(request).read)


@router.put('/admin/v1/local/plans')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_save_local_plans(request: Request):
    return await _run(_plans(request).save, await _content(request))
