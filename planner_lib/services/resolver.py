from typing import Any
from fastapi import HTTPException
from starlette.requests import Request


def resolve_service(request: Request, name: str) -> Any:
    """Resolve a named service from the application's service container.

    This function no longer consults legacy `app.state.<name>` attributes.
    It requires that `app.state.container` exists and has the named
    registration, otherwise an HTTP 500 is raised.
    """
    container = getattr(request.app.state, 'container', None)
    if container is None:
        raise HTTPException(status_code=500, detail=f"Service container not configured")
    try:
        return container.get(name)
    except KeyError:
        raise HTTPException(status_code=500, detail=f"Service '{name}' not configured")


def resolve_optional_service(request: Request, name: str) -> Any:
    """Resolve an optional service from the container, returning None if not present.

    Mirrors prior semantics for optional storages but consults the container
    exclusively.
    """
    container = getattr(request.app.state, 'container', None)
    if container is None:
        return None
    try:
        return container.get(name)
    except KeyError:
        return None

