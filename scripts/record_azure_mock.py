#!/usr/bin/env python3
"""Record live Azure DevOps API responses as anonymized SDK-level JSON fixtures.

The fixtures are consumed by ``AzureMockClient`` which injects a mock
``Connection`` into ``AzureCachingClient``.  Because the mock operates at the
SDK boundary, all caching, normalisation, and business logic in the
planner_lib azure layer is fully exercised against the recorded data.

Usage:
    AZURE_DEVOPS_PAT=<pat> python scripts/record_azure_mock.py [options]

Options:
    --data-dir DIR       PlannerTool data directory (default: data)
    --output-dir DIR     Fixture output directory (default: <data-dir>/azure_mock)
    --with-history       Also record per-work-item revision history (slow)

Fixture files produced (all prefixed sdk_):
    sdk_teams__<proj>.json                        Core client / get_teams
    sdk_plans__<proj>.json                        Work client / get_plans
    sdk_timeline__<proj>__<plan_id>.json          Work client / get_delivery_timeline_data
    sdk_plan_markers__<proj>__<plan_id>.json      Work client / get_plan (markers only)
    sdk_team_field_values__<proj>__<team>.json    Work client / get_team_field_values
    sdk_backlog_config__<proj>__<team>.json       Work client / get_backlog_configurations
    sdk_iterations__<proj>.json                   WIT client  / get_classification_node
    sdk_work_item_types__<proj>.json              WIT client  / get_work_item_types
    sdk_wiql__<area>.json                         WIT client  / query_by_wiql (IDs only)
    sdk_work_items__<area>.json                   WIT client  / get_work_items (full)
    sdk_revisions__<id>.json                      WIT client  / get_revisions (optional)
    _manifest.json                                Recording metadata

Anonymization (all IDs, dates, states, paths are preserved):
    Work item titles       → "Work Item <id>"
    Work item descriptions → null
    Assignee displayName   → consistent "Person N" mapping
    Plan names             → "Plan N"
    Marker label/name      → "Marker N"
    History changed_by     → consistent "Person N" mapping
    URLs                   → real org replaced with "anonymous-org"
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger("record_azure_mock")


# ---------------------------------------------------------------------------
# File-key helper (must match AzureMockClient._safe_key)
# ---------------------------------------------------------------------------

def _safe_key(value: str) -> str:
    safe = value.replace('\\', '__').replace('/', '__').replace(' ', '_')
    return re.sub(r'[^A-Za-z0-9_\-]', '', safe)


# ---------------------------------------------------------------------------
# SDK object → plain JSON dict serializer
# ---------------------------------------------------------------------------

def _sdk_to_dict(obj: Any) -> Any:
    """Recursively convert an Azure DevOps SDK model object to a plain dict."""
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {k: _sdk_to_dict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sdk_to_dict(item) for item in obj]
    # msrest Model.as_dict() is the canonical serializer
    if hasattr(obj, 'as_dict'):
        try:
            return _sdk_to_dict(obj.as_dict())
        except Exception:
            pass
    # datetime → ISO string
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    # Generic object introspection
    if hasattr(obj, '__dict__'):
        d = {k: _sdk_to_dict(v) for k, v in obj.__dict__.items() if not k.startswith('_')}
        return d if d else str(obj)
    return str(obj)


def _chunks(lst: list, n: int):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


# ---------------------------------------------------------------------------
# Anonymizer
# ---------------------------------------------------------------------------

class Anonymizer:
    """Replace sensitive text fields with deterministic pseudonyms."""

    def __init__(self, org_name: str = '') -> None:
        self._org = org_name
        self._person_map: Dict[str, str] = {}
        self._person_ctr = 0
        self._plan_map: Dict[str, str] = {}
        self._plan_ctr = 0
        self._marker_ctr = 0

    # -- person display names -----------------------------------------------

    def person(self, name: Any) -> str:
        key = str(name).strip() if name else ''
        if not key:
            return ''
        if key not in self._person_map:
            self._person_ctr += 1
            self._person_map[key] = f"Person {self._person_ctr}"
        return self._person_map[key]

    def _anon_identity(self, identity: Any) -> Any:
        """Anonymize an IdentityRef dict (displayName, uniqueName, …)."""
        if not identity:
            return identity
        if isinstance(identity, dict):
            d = dict(identity)
            d['displayName'] = self.person(d.get('displayName') or d.get('uniqueName'))
            # Replace entire email with person@example.com pattern
            d['uniqueName'] = 'person@example.com'
            # Anonymize URL field inside identity
            if 'url' in d:
                d['url'] = self._anon_url(d['url'])
            # Remove image URLs — they would expose the real org
            d.pop('imageUrl', None)
            d.pop('_links', None)
            return d
        return self.person(str(identity))

    # -- URL anonymization --------------------------------------------------

    def _anon_url(self, url: Any) -> Any:
        """Replace Azure DevOps URLs with localhost equivalents."""
        if not url:
            return url
        s = str(url)
        # Replace organization name in dev.azure.com URLs
        if self._org:
            s = re.sub(
                r'(https://dev\.azure\.com/)' + re.escape(self._org) + r'(/|$)',
                r'\1anonymous-org\2',
                s,
            )
        # Replace Visual Studio URLs with localhost
        s = re.sub(r'https://[a-zA-Z0-9\-]+\.vssps\.visualstudio\.com/[A-Za-z0-9\-]+/', 'http://localhost:8002/', s)
        s = re.sub(r'https://dev\.azure\.com/[^/]+/', 'http://localhost:8002/', s)
        return s

    @staticmethod
    def _anon_field_name(field_name: str) -> str:
        """Replace organization-specific field prefixes with generic ones."""
        # Replace custom org prefixes (like WSA., WEF_) with generic ORG prefix
        # Keep standard System., Microsoft. prefixes unchanged
        if not field_name.startswith(('System.', 'Microsoft.')):
            # Match pattern like "WSA.Something" or "WEF_Something"
            field_name = re.sub(r'^[A-Z]{2,}[._]', 'ORG.', field_name)
        return field_name

    def _deep_anon_urls(self, obj: Any) -> Any:
        """Recursively anonymize all URLs in a nested data structure."""
        if isinstance(obj, dict):
            result = {}
            for k, v in obj.items():
                # Anonymize field names
                new_k = self._anon_field_name(k) if isinstance(k, str) else k
                # Anonymize URL values
                if k == 'url' and isinstance(v, str):
                    result[new_k] = self._anon_url(v)
                # Anonymize identity objects
                elif isinstance(v, dict) and ('displayName' in v or 'uniqueName' in v):
                    result[new_k] = self._anon_identity(v)
                # Recurse into nested structures
                else:
                    result[new_k] = self._deep_anon_urls(v)
            return result
        elif isinstance(obj, (list, tuple)):
            return [self._deep_anon_urls(item) for item in obj]
        else:
            return obj

    # -- description anonymization ----------------------------------------

    @staticmethod
    def _anon_description(text: Any) -> Optional[str]:
        """Replace description text with a placeholder but preserve
        ``[PlannerTool Team Capacity]…[/PlannerTool Team Capacity]`` blocks,
        which carry structured capacity data needed by PlannerTool.
        """
        if not text:
            return None
        raw = str(text)
        # Extract capacity block(s) to re-inject after scrubbing
        cap_pattern = re.compile(
            r'(\[PlannerTool Team Capacity\].*?\[/PlannerTool Team Capacity\])',
            re.DOTALL | re.IGNORECASE,
        )
        capacity_blocks = cap_pattern.findall(raw)
        placeholder = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>'
        if capacity_blocks:
            return placeholder + '\n' + '\n'.join(capacity_blocks)
        return placeholder

    # -- work item fields ---------------------------------------------------

    def anon_work_item(self, d: dict) -> dict:
        """In-place anonymize a serialized WorkItem dict."""
        wid = d.get('id', '?')
        fields: dict = d.get('fields') or {}

        fields['System.Title'] = f"Work Item {wid}"
        fields['System.Description'] = self._anon_description(fields.get('System.Description'))
        fields['System.History'] = None

        # Anonymize all identity objects in ALL fields (standard and custom)
        for key, value in list(fields.items()):
            if isinstance(value, dict) and ('displayName' in value or 'uniqueName' in value):
                fields[key] = self._anon_identity(value)
        
        # Anonymize custom field names (WSA.* -> ORG.*, WEF_* -> ORG.*, etc.)
        anon_fields = {}
        for key, value in fields.items():
            anon_key = self._anon_field_name(key)
            anon_fields[anon_key] = value
        d['fields'] = anon_fields

        # URL field on the work item itself
        if d.get('url'):
            d['url'] = self._anon_url(d['url'])

        # Relation URLs
        for rel in (d.get('relations') or []):
            if isinstance(rel, dict) and rel.get('url'):
                rel['url'] = self._anon_url(rel['url'])

        return d

    # -- plans --------------------------------------------------------------

    def anon_plan_name(self, name: Any) -> str:
        key = str(name).strip() if name else ''
        if not key:
            return ''
        if key not in self._plan_map:
            self._plan_ctr += 1
            self._plan_map[key] = f"Plan {self._plan_ctr}"
        return self._plan_map[key]

    def anon_plans(self, plans: list) -> list:
        for p in plans:
            if isinstance(p, dict) and p.get('name'):
                p['name'] = self.anon_plan_name(p['name'])
        return plans

    # -- markers ------------------------------------------------------------

    def anon_markers(self, markers: list) -> list:
        for m in (markers or []):
            if not isinstance(m, dict):
                continue
            self._marker_ctr += 1
            label = f"Marker {self._marker_ctr}"
            for key in ('label', 'name', 'title'):
                if key in m:
                    m[key] = label
        return markers

    # -- revision history ---------------------------------------------------

    def anon_revisions(self, revisions: list) -> list:
        for rev in (revisions or []):
            if not isinstance(rev, dict):
                continue
            # Anonymize top-level URL
            if 'url' in rev:
                rev['url'] = self._anon_url(rev['url'])
            
            fields: dict = rev.get('fields') or {}
            
            # Anonymize all identity objects in ALL fields (not just standard ones)
            for key, value in list(fields.items()):
                # Handle identity objects anywhere (standard and custom fields)
                if isinstance(value, dict) and ('displayName' in value or 'uniqueName' in value):
                    fields[key] = self._anon_identity(value)
            
            # Anonymize description but keep capacity blocks in revisions
            if 'System.Description' in fields:
                fields['System.Description'] = self._anon_description(fields['System.Description'])
            fields.pop('System.History', None)
            
            # Anonymize title in each revision
            wid = fields.get('System.Id', '?')
            if fields.get('System.Title'):
                fields['System.Title'] = f"Work Item {wid}"
            
            # Anonymize custom field names (WSA.* -> ORG.*, WEF_* -> ORG.*, etc.)
            anon_fields = {}
            for key, value in fields.items():
                anon_key = self._anon_field_name(key)
                anon_fields[anon_key] = value
            rev['fields'] = anon_fields
            
        return revisions


# ---------------------------------------------------------------------------
# Null storage (satisfies StorageProtocol, never touches disk)
# ---------------------------------------------------------------------------

class _NullStorage:
    def save(self, *a): pass
    def load(self, *a): raise KeyError
    def delete(self, *a): pass
    def list_keys(self, *a): return []
    def exists(self, *a): return False
    def configure(self, **kw): pass


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def _load_yaml(path: Path) -> dict:
    try:
        import yaml
    except ImportError:
        raise SystemExit("PyYAML is required: pip install pyyaml")
    with open(path, encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def _load_configs(data_dir: Path):
    cfg_dir = data_dir / 'config'
    srv_path = cfg_dir / 'server_config.yml'
    if not srv_path.exists():
        raise SystemExit(f"server_config.yml not found at {srv_path}")
    server_cfg = _load_yaml(srv_path)

    proj_path = cfg_dir / 'projects.yml'
    projects = []
    if proj_path.exists():
        projects = (_load_yaml(proj_path).get('project_map') or [])
    else:
        logger.warning("projects.yml not found — no areas to record")
    return server_cfg, projects


# ---------------------------------------------------------------------------
# Fixture saving
# ---------------------------------------------------------------------------

def _save(out_dir: Path, filename: str, data: Any) -> None:
    dest = out_dir / filename
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, default=str, ensure_ascii=False)
    n = len(data) if isinstance(data, list) else (1 if data else 0)
    logger.debug("  → %s  (%s)", filename, n)


# ---------------------------------------------------------------------------
# WIQL builder (mirrors AzureNativeClient logic)
# ---------------------------------------------------------------------------

def _build_wiql(area_path: str, task_types: Optional[List[str]], include_states: Optional[List[str]]) -> str:
    sanitized = area_path.lstrip('/\\').replace('/', '\\').replace('Area\\', '')
    escaped = sanitized.replace("'", "''").replace('\\', '\\\\')
    types = [f"'{t}'" for t in (task_types or ['epic', 'feature'])]
    if include_states:
        states_clause = f"AND [System.State] IN ({','.join(f'{chr(39)}{s}{chr(39)}' for s in include_states)})"
    else:
        states_clause = "AND [System.State] NOT IN ('Closed', 'Removed')"
    return (
        f"SELECT [System.Id] FROM WorkItems "
        f"WHERE [System.WorkItemType] IN ({','.join(types)}) "
        f"AND [System.AreaPath] = '{escaped}' "
        f"{states_clause} "
        f"ORDER BY [Microsoft.VSTS.Common.StackRank] ASC"
    )


# ---------------------------------------------------------------------------
# Main recording logic
# ---------------------------------------------------------------------------

def record(data_dir: str, output_dir: str, with_history: bool, pat: str) -> None:
    from planner_lib.azure.AzureNativeClient import AzureNativeClient
    from azure.devops.v7_1.work_item_tracking.models import Wiql
    try:
        from azure.devops.v7_1.work.models import TeamContext
    except ImportError:
        TeamContext = None

    data_path = Path(data_dir)
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    server_cfg, projects = _load_configs(data_path)
    org = server_cfg.get('azure_devops_organization')
    if not org:
        raise SystemExit("azure_devops_organization is not set in server_config.yml")

    logger.info("Organization : %s", org)
    logger.info("Output dir   : %s", out_path.resolve())
    logger.info("Areas        : %d configured", len(projects))

    anon = Anonymizer(org_name=org)

    # Use AzureNativeClient to set up a real SDK Connection object
    native = AzureNativeClient(organization_url=org, storage=_NullStorage(), cache_plans=False)

    manifest: Dict[str, Any] = {
        'organization': 'anonymous-org',
        'projects': [],
        'areas': [],
        'plan_count': 0,
        'work_item_count': 0,
        'history_count': 0,
        'with_history': with_history,
    }

    with native.connect(pat) as c:
        conn = c.conn
        core_client = conn.clients.get_core_client()
        work_client = conn.clients.get_work_client()
        wit_client = conn.clients.get_work_item_tracking_client()

        # Derive unique project names from configured area paths
        project_set: set = set()
        for proj_cfg in projects:
            area = (proj_cfg.get('area_path') or '').strip()
            if area:
                proj = area.split('\\')[0] if '\\' in area else area.split('/')[0]
                project_set.add(proj)

        if not project_set:
            logger.warning("No area_path entries found — nothing to record.")
            return

        # ---------------------------------------------------------------
        # 1. Per-project: teams, plans, iterations, work item types,
        #    per-plan timeline + markers, per-team field values + backlog
        # ---------------------------------------------------------------
        for proj in sorted(project_set):
            manifest['projects'].append(proj)
            logger.info("[%s] Recording teams …", proj)
            raw_teams = _sdk_to_dict(core_client.get_teams(project_id=proj))
            raw_teams = raw_teams if isinstance(raw_teams, list) else (raw_teams.get('value') or [])
            raw_teams = anon._deep_anon_urls(raw_teams)
            _save(out_path, f"sdk_teams__{_safe_key(proj)}.json", raw_teams)
            logger.info("[%s]   %d teams", proj, len(raw_teams))

            logger.info("[%s] Recording plans …", proj)
            raw_plans = _sdk_to_dict(work_client.get_plans(project=proj))
            raw_plans = raw_plans if isinstance(raw_plans, list) else (raw_plans.get('value') or [])
            anon_plans = anon._deep_anon_urls(anon.anon_plans(raw_plans))
            _save(out_path, f"sdk_plans__{_safe_key(proj)}.json", anon_plans)
            manifest['plan_count'] += len(anon_plans)
            logger.info("[%s]   %d plans", proj, len(anon_plans))

            for plan_d in anon_plans:
                plan_id = str(plan_d.get('id', ''))
                plan_name = plan_d.get('name', plan_id)
                if not plan_id:
                    continue

                # Timeline (team → plan association)
                try:
                    tl = _sdk_to_dict(work_client.get_delivery_timeline_data(proj, plan_id))
                    tl = anon._deep_anon_urls(tl or {})
                    _save(out_path, f"sdk_timeline__{_safe_key(proj)}__{plan_id}.json", tl)
                except Exception as exc:
                    logger.warning("[%s] plan %s timeline failed: %s", proj, plan_name, exc)
                    _save(out_path, f"sdk_timeline__{_safe_key(proj)}__{plan_id}.json", {'teams': []})

                # Plan markers
                try:
                    full_plan = _sdk_to_dict(work_client.get_plan(project=proj, id=plan_id))
                    props = (full_plan or {}).get('properties') or {}
                    markers_raw = props.get('markers') or []
                    anon.anon_markers(markers_raw)
                    _save(out_path, f"sdk_plan_markers__{_safe_key(proj)}__{plan_id}.json", markers_raw)
                except Exception as exc:
                    logger.warning("[%s] plan %s markers failed: %s", proj, plan_name, exc)
                    _save(out_path, f"sdk_plan_markers__{_safe_key(proj)}__{plan_id}.json", [])

            logger.info("[%s] Recording iterations …", proj)
            try:
                node = _sdk_to_dict(wit_client.get_classification_node(
                    project=proj, structure_group='iterations', depth=10))
                _save(out_path, f"sdk_iterations__{_safe_key(proj)}.json", node or {})
            except Exception as exc:
                logger.warning("[%s] iterations failed: %s", proj, exc)

            logger.info("[%s] Recording work item types …", proj)
            try:
                types_raw = _sdk_to_dict(wit_client.get_work_item_types(proj))
                types_raw = types_raw if isinstance(types_raw, list) else []
                types_raw = anon._deep_anon_urls(types_raw)
                _save(out_path, f"sdk_work_item_types__{_safe_key(proj)}.json", types_raw)
                logger.info("[%s]   %d types", proj, len(types_raw))
            except Exception as exc:
                logger.warning("[%s] work item types failed: %s", proj, exc)

            # Per-team: field values + backlog config
            for team_d in raw_teams:
                team_name = team_d.get('name') or ''
                if not team_name:
                    continue
                team_key = f"{_safe_key(proj)}__{_safe_key(team_name)}"

                try:
                    ctx = TeamContext(project=proj, team=team_name) if TeamContext else {'project': proj, 'team': team_name}
                    fv = _sdk_to_dict(work_client.get_team_field_values(team_context=ctx))
                    vals = (fv or {}).get('values') or []
                    vals = anon._deep_anon_urls(vals)
                    _save(out_path, f"sdk_team_field_values__{team_key}.json", vals)
                except Exception as exc:
                    logger.warning("[%s] team '%s' field values failed: %s", proj, team_name, exc)

                try:
                    ctx = TeamContext(project=proj, team=team_name) if TeamContext else {'project': proj, 'team': team_name}
                    bc = _sdk_to_dict(work_client.get_backlog_configurations(team_context=ctx))
                    bc = anon._deep_anon_urls(bc or {})
                    _save(out_path, f"sdk_backlog_config__{team_key}.json", bc)
                except Exception as exc:
                    logger.warning("[%s] team '%s' backlog config failed: %s", proj, team_name, exc)

        # ---------------------------------------------------------------
        # 2. Per-area: WIQL result (ordered IDs) + full work items
        # ---------------------------------------------------------------
        all_work_item_ids: List[int] = []

        for proj_cfg in projects:
            area = (proj_cfg.get('area_path') or '').strip()
            if not area:
                continue
            proj = area.split('\\')[0] if '\\' in area else area.split('/')[0]
            task_types = proj_cfg.get('task_types') or None
            include_states = proj_cfg.get('include_states') or None
            area_key = _safe_key(area)

            logger.info("[%s] WIQL for area '%s' …", proj, area)
            wiql_str = _build_wiql(area, task_types, include_states)
            try:
                result = wit_client.query_by_wiql(wiql=Wiql(query=wiql_str))
                task_ids = [int(getattr(wi, 'id', 0)) for wi in (getattr(result, 'work_items', []) or [])]
            except Exception as exc:
                logger.warning("[%s] WIQL failed for '%s': %s", proj, area, exc)
                task_ids = []

            wiql_data = [{'id': wid} for wid in task_ids]
            _save(out_path, f"sdk_wiql__{area_key}.json", wiql_data)
            logger.info("[%s]   %d items in WIQL result", proj, len(task_ids))

            logger.info("[%s] Fetching full work items …", proj)
            work_items_data: List[dict] = []
            for batch in _chunks(task_ids, 200):
                try:
                    items = wit_client.get_work_items(batch, expand='relations')
                    for item in items or []:
                        d = _sdk_to_dict(item)
                        anon.anon_work_item(d)
                        work_items_data.append(d)
                except Exception as exc:
                    logger.warning("[%s] get_work_items batch failed: %s", proj, exc)

            _save(out_path, f"sdk_work_items__{area_key}.json", work_items_data)
            manifest['areas'].append(area)
            manifest['work_item_count'] += len(work_items_data)
            logger.info("[%s]   %d work items saved", proj, len(work_items_data))

            all_work_item_ids.extend(task_ids)

        # ---------------------------------------------------------------
        # 3. Optional: per-work-item revision history
        # ---------------------------------------------------------------
        if with_history:
            unique_ids = sorted(set(all_work_item_ids))
            logger.info("Recording revision history for %d work items …", len(unique_ids))
            for wid in unique_ids:
                try:
                    revs = _sdk_to_dict(wit_client.get_revisions(id=wid))
                    revs = revs if isinstance(revs, list) else []
                    anon.anon_revisions(revs)
                    _save(out_path, f"sdk_revisions__{wid}.json", revs)
                except Exception as exc:
                    logger.warning("  revision history for %d failed: %s", wid, exc)
            manifest['history_count'] = len(unique_ids)
        else:
            logger.info("Skipping revision history (pass --with-history to include).")

    _save(out_path, '_manifest.json', manifest)
    logger.info(
        "Done. %d areas | %d work items | %d history files → %s",
        len(manifest['areas']),
        manifest['work_item_count'],
        manifest['history_count'],
        out_path.resolve(),
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--data-dir', default='data',
                        help='PlannerTool data directory (default: data)')
    parser.add_argument('--output-dir', default=None,
                        help='Fixture output directory (default: <data-dir>/azure_mock)')
    parser.add_argument('--with-history', action='store_true',
                        help='Also record per-work-item revision history (slow)')
    parser.add_argument('--verbose', action='store_true',
                        help='Enable debug logging')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    pat = os.environ.get('AZURE_DEVOPS_PAT', '')
    if not pat:
        raise SystemExit("AZURE_DEVOPS_PAT environment variable must be set.")

    output_dir = args.output_dir or str(Path(args.data_dir) / 'azure_mock')
    record(data_dir=args.data_dir, output_dir=output_dir,
           with_history=args.with_history, pat=pat)


if __name__ == '__main__':
    main()
