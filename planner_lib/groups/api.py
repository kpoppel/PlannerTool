"""REST API endpoints for groups.

Endpoints:
  GET    /api/groups          — list all groups (optional ?plan_id= filter)
  GET    /api/groups/{id}     — get a single group
  POST   /api/groups          — create a new group
  PUT    /api/groups/{id}     — update an existing group
  DELETE /api/groups/{id}     — delete a group (cascade sub-groups)

All endpoints require an active session.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, field_validator
from typing import Optional

from planner_lib.middleware import require_session
from planner_lib.services.resolver import resolve_service

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class GroupCreate(BaseModel):
    plan_id: str
    name: str
    parent_id: Optional[str] = None
    color: Optional[str] = None
    rank: int = 0

    @field_validator("plan_id")
    @classmethod
    def _validate_plan_id(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("plan_id must not be empty")
        return v.strip()

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("color")
    @classmethod
    def _validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if v and not v.startswith("#"):
            raise ValueError("color must be a hex string starting with '#'")
        return v or None


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None
    color: Optional[str] = None
    rank: Optional[int] = None
    plan_id: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("color")
    @classmethod
    def _validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        # Allow empty string to clear color
        if v and not v.startswith("#"):
            raise ValueError("color must be a hex string starting with '#'")
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _repo(request: Request):
    return resolve_service(request, "group_repository")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/groups")
@require_session
async def api_groups_list(request: Request):
    """List all groups. Optional ?plan_id= query parameter to filter by plan."""
    plan_id = request.query_params.get("plan_id")
    try:
        return await asyncio.to_thread(_repo(request).list_groups, plan_id=plan_id)
    except Exception as e:
        logger.error("Error listing groups: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/groups/{group_id}")
@require_session
async def api_groups_get(group_id: str, request: Request):
    """Get a single group by ID."""
    try:
        return await asyncio.to_thread(_repo(request).get_group, group_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Group not found")
    except Exception as e:
        logger.error("Error fetching group %s: %s", group_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/groups", status_code=201)
@require_session
async def api_groups_create(request: Request, payload: dict = Body(default={})):
    """Create a new group."""
    try:
        data = GroupCreate.model_validate(payload)
    except Exception as e:
        raise RequestValidationError(errors=getattr(e, "errors", lambda: [{"msg": str(e)}])())
    try:
        return await asyncio.to_thread(
            _repo(request).create_group,
            plan_id=data.plan_id,
            name=data.name,
            parent_id=data.parent_id,
            color=data.color,
            rank=data.rank,
        )
    except Exception as e:
        logger.error("Error creating group: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/groups/{group_id}")
@require_session
async def api_groups_update(group_id: str, request: Request, payload: dict = Body(default={})):
    """Update an existing group. Only supplied fields are changed."""
    try:
        data = GroupUpdate.model_validate(payload)
    except Exception as e:
        raise RequestValidationError(errors=getattr(e, "errors", lambda: [{"msg": str(e)}])())
    try:
        return await asyncio.to_thread(
            _repo(request).update_group,
            group_id=group_id,
            name=data.name,
            parent_id=data.parent_id,
            color=data.color,
            rank=data.rank,
            plan_id=data.plan_id,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Group not found")
    except Exception as e:
        logger.error("Error updating group %s: %s", group_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/groups/{group_id}")
@require_session
async def api_groups_delete(group_id: str, request: Request):
    """Delete a group and cascade-delete its sub-groups."""
    try:
        deleted = await asyncio.to_thread(_repo(request).delete_group, group_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"ok": True, "id": group_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error deleting group %s: %s", group_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
