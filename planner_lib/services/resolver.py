from typing import Any
import logging
from fastapi import HTTPException
from starlette.requests import Request

logger = logging.getLogger(__name__)


def resolve_service(request: Request, name: str) -> Any:
    """Resolve a named service from the application's service container.

    This function no longer consults legacy `app.state.<name>` attributes.
    It requires that `app.state.container` exists and has the named
    registration, otherwise an HTTP 500 is raised.
    """
    container = getattr(request.app.state, 'container', None)
    if container is None:
        logger.error("Service container not attached to app.state")
        raise HTTPException(status_code=500, detail="Internal server error")
    try:
        return container.get(name)
    except KeyError:
        logger.error("Service '%s' not registered in container", name)
        raise HTTPException(status_code=500, detail="Internal server error")


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

