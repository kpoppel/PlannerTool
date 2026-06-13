"""REST API endpoints for events and event categories.

Endpoints:
  GET    /api/events                — list all events (optional ?plan_id= filter)
  GET    /api/events/{id}           — get a single event
  POST   /api/events                — create a new event
  PUT    /api/events/{id}           — update an existing event
  DELETE /api/events/{id}           — delete an event

  GET    /api/event-categories      — list all categories
  POST   /api/event-categories      — create a category
  PUT    /api/event-categories/{id} — update a category
  DELETE /api/event-categories/{id} — delete a category

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
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models — events
# ---------------------------------------------------------------------------

class EventCreate(BaseModel):
    date: str
    title: str
    plan_id: str
    category: str = ''
    end_date: Optional[str] = None

    @field_validator("date")
    @classmethod
    def _validate_date(cls, v: str) -> str:
        import re
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("date must be YYYY-MM-DD")
        return v

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("title must not be empty")
        return v.strip()

    @field_validator("plan_id")
    @classmethod
    def _validate_plan_id(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("plan_id must not be empty")
        return v.strip()

    @field_validator("end_date")
    @classmethod
    def _validate_end_date(cls, v: Optional[str]) -> Optional[str]:
        # Allow explicit empty string to signal clearing the end date.
        if v is None:
            return v
        if v == "":
            return v
        import re
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("end_date must be YYYY-MM-DD")
        return v


class EventUpdate(BaseModel):
    date: Optional[str] = None
    title: Optional[str] = None
    plan_id: Optional[str] = None
    category: Optional[str] = None
    end_date: Optional[str] = None

    @field_validator("date")
    @classmethod
    def _validate_date(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        import re
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("date must be YYYY-MM-DD")
        return v

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not v.strip():
            raise ValueError("title must not be empty")
        return v.strip()

    @field_validator("plan_id")
    @classmethod
    def _validate_plan_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not v.strip():
            raise ValueError("plan_id must not be empty")
        return v.strip()

    @field_validator("end_date")
    @classmethod
    def _validate_end_date(cls, v: Optional[str]) -> Optional[str]:
        # Allow explicit empty string to signal clearing the end date.
        if v is None:
            return v
        if v == "":
            return v
        import re
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("end_date must be YYYY-MM-DD")
        return v


# ---------------------------------------------------------------------------
# Request / response models — categories
# ---------------------------------------------------------------------------

class CategoryCreate(BaseModel):
    name: str
    is_special: bool = False

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    is_special: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _repo(request: Request):
    return resolve_service(request, "event_repository")


def _user_id(request: Request) -> str:
    """Return the email/user-id from the current session (empty string if not found)."""
    try:
        sid = get_session_id_from_request(request)
        mgr = resolve_service(request, "session_manager")
        return mgr.get_val(sid, "email") or ""
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Event routes
# ---------------------------------------------------------------------------

@router.get("/events")
@require_session
async def api_events_list(request: Request):
    """List all events. Optional ?plan_id= query parameter to filter by plan."""
    plan_id = request.query_params.get("plan_id")
    try:
        return await asyncio.to_thread(
            _repo(request).list_events, plan_id=plan_id, user_id=_user_id(request)
        )
    except Exception as e:
        logger.error("Error listing events: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/events/{event_id}")
@require_session
async def api_events_get(event_id: str, request: Request):
    """Get a single event by ID."""
    try:
        return await asyncio.to_thread(_repo(request).get_event, event_id, user_id=_user_id(request))
    except KeyError:
        raise HTTPException(status_code=404, detail="Event not found")
    except Exception as e:
        logger.error("Error fetching event %s: %s", event_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/events", status_code=201)
@require_session
async def api_events_create(request: Request, payload: dict = Body(default={})):
    """Create a new event."""
    try:
        data = EventCreate.model_validate(payload)
    except Exception as e:
        raise RequestValidationError(errors=getattr(e, 'errors', lambda: [{'msg': str(e)}])())
    try:
        return await asyncio.to_thread(
            _repo(request).create_event,
            date=data.date,
            title=data.title,
            plan_id=data.plan_id,
            category=data.category,
            end_date=data.end_date,
            user_id=_user_id(request),
        )
    except Exception as e:
        logger.error("Error creating event: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/events/{event_id}")
@require_session
async def api_events_update(event_id: str, request: Request, payload: dict = Body(default={})):
    """Update an existing event. Only supplied fields are changed."""
    try:
        data = EventUpdate.model_validate(payload)
    except Exception as e:
        raise RequestValidationError(errors=getattr(e, 'errors', lambda: [{'msg': str(e)}])())
    try:
        return await asyncio.to_thread(
            _repo(request).update_event,
            event_id=event_id,
            date=data.date,
            title=data.title,
            plan_id=data.plan_id,
            category=data.category,
            end_date=data.end_date,
            user_id=_user_id(request),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Event not found")
    except Exception as e:
        logger.error("Error updating event %s: %s", event_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/events/{event_id}")
@require_session
async def api_events_delete(event_id: str, request: Request):
    """Delete an event."""
    try:
        deleted = await asyncio.to_thread(_repo(request).delete_event, event_id, user_id=_user_id(request))
        if not deleted:
            raise HTTPException(status_code=404, detail="Event not found")
        return {"ok": True, "id": event_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error deleting event %s: %s", event_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# ---------------------------------------------------------------------------
# Category routes
# ---------------------------------------------------------------------------

@router.get("/event-categories")
@require_session
async def api_categories_list(request: Request):
    """List all event categories."""
    try:
        return await asyncio.to_thread(_repo(request).list_categories, user_id=_user_id(request))
    except Exception as e:
        logger.error("Error listing categories: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/event-categories", status_code=201)
@require_session
async def api_categories_create(request: Request, payload: dict = Body(default={})):
    """Create a new event category."""
    try:
        data = CategoryCreate.model_validate(payload)
    except Exception as e:
        raise RequestValidationError(errors=getattr(e, 'errors', lambda: [{'msg': str(e)}])())
    try:
        return await asyncio.to_thread(
            _repo(request).create_category,
            name=data.name,
            is_special=data.is_special,
            user_id=_user_id(request),
        )
    except Exception as e:
        logger.error("Error creating category: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/event-categories/{category_id}")
@require_session
async def api_categories_update(category_id: str, request: Request, payload: dict = Body(default={})):
    """Update an existing event category. Only supplied fields are changed."""
    try:
        data = CategoryUpdate.model_validate(payload)
    except Exception as e:
        raise RequestValidationError(errors=getattr(e, 'errors', lambda: [{'msg': str(e)}])())
    try:
        return await asyncio.to_thread(
            _repo(request).update_category,
            category_id=category_id,
            name=data.name,
            is_special=data.is_special,
            user_id=_user_id(request),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Category not found")
    except Exception as e:
        logger.error("Error updating category %s: %s", category_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/event-categories/{category_id}")
@require_session
async def api_categories_delete(category_id: str, request: Request):
    """Delete an event category."""
    try:
        deleted = await asyncio.to_thread(
            _repo(request).delete_category, category_id, user_id=_user_id(request)
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="Category not found")
        return {"ok": True, "id": category_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error deleting category %s: %s", category_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
