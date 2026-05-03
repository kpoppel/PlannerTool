"""REST API endpoints for events.

Endpoints:
  GET    /api/events          — list all events (optional ?plan_id= filter)
  GET    /api/events/{id}     — get a single event
  POST   /api/events          — create a new event
  PUT    /api/events/{id}     — update an existing event
  DELETE /api/events/{id}     — delete an event

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
# Request / response models
# ---------------------------------------------------------------------------

class EventCreate(BaseModel):
    date: str
    title: str
    plan_id: str

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


class EventUpdate(BaseModel):
    date: Optional[str] = None
    title: Optional[str] = None
    plan_id: Optional[str] = None

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
# Routes
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
