"""AzureWikiEventBackend: stores plan events as a structured ADO wiki page.

Each event is persisted in a single wiki page at a configurable path.  The
page has two sections:

1. A human-readable Markdown table (for direct wiki browsing).
2. A machine-readable JSON block embedded in an HTML comment so that
   PlannerTool can read and round-trip the full event data without
   depending on Markdown parsing.

Format of the JSON block::

    <!-- planner-tool-events
    {"event_id": {...}, ...}
    -->

The ETag returned by ADO on every GET is used as the If-Match version on
every PUT to detect conflicting concurrent edits and surface a clear error
rather than silently losing data.

Configuration (admin ``events_config``)
----------------------------------------
``event_backend``  — ``"ado_wiki"`` to activate this backend.
``ado_wiki``       — sub-object:
    ``project``    — ADO project name or ID.
    ``wiki_id``    — Wiki identifier (name or GUID).
    ``page_path``  — Wiki page path, e.g. ``/PlannerTool/Events``.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Dict, List, Optional

from planner_lib.backend.port import BackendCredential

logger = logging.getLogger(__name__)

# Delimiter used to embed the JSON register inside the wiki page content.
_DATA_START = "<!-- planner-tool-events"
_DATA_END = "-->"


class AzureWikiEventBackend:
    """EventBackend that persists events in an Azure DevOps wiki page.

    Parameters
    ----------
    organization_url:
        Azure DevOps organization name or full URL, e.g. ``"MyCompany"`` or
        ``"https://dev.azure.com/MyCompany"``.  Stored independently of the
        work-item backend so that a mock or static task backend can coexist
        with a live wiki event backend.
    project:
        ADO project name or ID.
    wiki_id:
        Wiki identifier (name or GUID).  For a project wiki this is typically
        ``<ProjectName>.wiki``.
    page_path:
        Path to the wiki page that stores events,
        e.g. ``/PlannerTool/Events``.
    """

    def __init__(
        self,
        organization_url: str,
        project: str,
        wiki_id: str,
        page_path: str = "/PlannerTool/Events",
    ) -> None:
        self._organization_url = organization_url
        self._project = project
        self._wiki_id = wiki_id
        self._page_path = page_path

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_wiki_client(self, credential: BackendCredential):
        """Return a live ADO wiki client connected with the supplied credential."""
        from azure.devops.connection import Connection
        from msrest.authentication import BasicAuthentication

        org_url = self._organization_url
        if not org_url:
            raise RuntimeError("Azure DevOps organization URL is not configured")
        if not self._project:
            raise RuntimeError(
                "AzureWikiEventBackend: 'project' is not configured. "
                "Set it under Admin → Events Configuration → Azure DevOps Wiki Settings."
            )
        if not self._wiki_id:
            raise RuntimeError(
                "AzureWikiEventBackend: 'wiki_id' is not configured. "
                "Set it under Admin → Events Configuration → Azure DevOps Wiki Settings."
            )

        creds = BasicAuthentication("", credential["token"])
        conn = Connection(
            base_url=f"https://dev.azure.com/{org_url}",
            creds=creds,
        )
        return conn.clients_v7_0.get_wiki_client()

    def _read_page(self, wiki_client) -> tuple[dict, str]:
        """Fetch the wiki page and return ``(events_dict, etag)``.

        Returns an empty register and a sentinel ETag of ``"-1"`` when the
        page does not yet exist.
        """
        try:
            resp = wiki_client.get_page(
                project=self._project,
                wiki_identifier=self._wiki_id,
                path=self._page_path,
                include_content=True,
            )
            content = (resp.page.content or "") if resp.page else ""
            etag = resp.eTag or "-1"
            return self._parse_events(content), etag
        except Exception as exc:
            logger.debug(
                "wiki_events: page '%s' not found or unreadable (%s) — treating as empty",
                self._page_path,
                exc,
            )
            return {}, "-1"

    def _write_page(self, wiki_client, events: dict, etag: str) -> None:
        """Write the updated events dict back to the wiki page."""
        from azure.devops.v7_0.wiki.models import WikiPageCreateOrUpdateParameters

        content = self._render_page(events)
        params = WikiPageCreateOrUpdateParameters(content=content)
        # version="-1" means "create" (page does not yet exist)
        version = None if etag == "-1" else etag
        wiki_client.create_or_update_page(
            parameters=params,
            project=self._project,
            wiki_identifier=self._wiki_id,
            path=self._page_path,
            version=version,
            comment="Updated by PlannerTool",
        )

    def _parse_events(self, content: str) -> dict:
        """Extract the events register from wiki page *content*.

        Returns an empty dict when the content has no embedded JSON block or
        when the JSON is malformed.
        """
        start = content.find(_DATA_START)
        if start == -1:
            return {}
        end = content.find(_DATA_END, start + len(_DATA_START))
        if end == -1:
            return {}
        raw = content[start + len(_DATA_START):end].strip()
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            logger.warning("wiki_events: could not decode embedded JSON in '%s'", self._page_path)
            return {}

    def _render_page(self, events: dict) -> str:
        """Render *events* dict into the wiki page Markdown + data block."""
        lines: List[str] = [
            "# PlannerTool Events",
            "",
            "> This page is managed by PlannerTool.  "
            "Edit events through the PlannerTool interface to keep the embedded data in sync.",
            "",
        ]

        if events:
            # Group events by plan_id, preserving insertion order per group
            plans: dict[str, list] = {}
            for ev in events.values():
                pid = ev.get("plan_id", "")
                plans.setdefault(pid, []).append(ev)

            # Render one table per plan, plans sorted alphabetically by plan_id
            for plan_id in sorted(plans.keys()):
                plan_events = sorted(
                    plans[plan_id],
                    key=lambda e: e.get("date", ""),
                    reverse=True,  # newest first
                )
                lines += [
                    f"## {plan_id}",
                    "",
                    "| Date | Title |",
                    "|------|-------|",
                ]
                for ev in plan_events:
                    lines.append(
                        f"| {ev.get('date', '')} | {ev.get('title', '')} |"
                    )
                lines.append("")
        else:
            lines.append("*No events configured.*")
            lines.append("")

        lines += [
            "<!-- planner-tool-events",
            json.dumps(events, indent=2),
            "-->",
        ]
        return "\n".join(lines)

    def _require_credential(self, credential: Optional[BackendCredential]) -> BackendCredential:
        if not credential or not credential.get("token"):
            raise PermissionError(
                "AzureWikiEventBackend requires a valid credential (PAT). "
                "Ensure the user session includes a PAT."
            )
        return credential

    # ------------------------------------------------------------------
    # EventBackend protocol
    # ------------------------------------------------------------------

    def fetch_events(
        self,
        plan_id: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        """Return all events, optionally filtered by *plan_id*."""
        cred = self._require_credential(credential)
        wiki_client = self._get_wiki_client(cred)
        events, _etag = self._read_page(wiki_client)
        result = list(events.values())
        if plan_id is not None:
            result = [e for e in result if e.get("plan_id") == plan_id]
        return result

    def fetch_event(
        self,
        event_id: str,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        """Return a single event by ID; raises ``KeyError`` when not found."""
        cred = self._require_credential(credential)
        wiki_client = self._get_wiki_client(cred)
        events, _etag = self._read_page(wiki_client)
        if event_id not in events:
            raise KeyError(event_id)
        return events[event_id]

    def create_event(
        self,
        date: str,
        title: str,
        plan_id: str,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        """Create a new event, persist it, and return it (including generated id)."""
        cred = self._require_credential(credential)
        wiki_client = self._get_wiki_client(cred)
        events, etag = self._read_page(wiki_client)
        event_id = uuid.uuid4().hex
        event: Dict[str, Any] = {
            "id": event_id,
            "date": date,
            "title": title,
            "plan_id": plan_id,
        }
        events[event_id] = event
        self._write_page(wiki_client, events, etag)
        return event

    def update_event(
        self,
        event_id: str,
        date: Optional[str] = None,
        title: Optional[str] = None,
        plan_id: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        """Update fields on an existing event; raises ``KeyError`` when not found."""
        cred = self._require_credential(credential)
        wiki_client = self._get_wiki_client(cred)
        events, etag = self._read_page(wiki_client)
        if event_id not in events:
            raise KeyError(event_id)
        event = events[event_id]
        if date is not None:
            event["date"] = date
        if title is not None:
            event["title"] = title
        if plan_id is not None:
            event["plan_id"] = plan_id
        events[event_id] = event
        self._write_page(wiki_client, events, etag)
        return event

    def delete_event(
        self,
        event_id: str,
        credential: Optional[BackendCredential] = None,
    ) -> bool:
        """Delete an event; returns ``True`` when found and deleted, ``False`` otherwise."""
        cred = self._require_credential(credential)
        wiki_client = self._get_wiki_client(cred)
        events, etag = self._read_page(wiki_client)
        if event_id not in events:
            return False
        del events[event_id]
        self._write_page(wiki_client, events, etag)
        return True
