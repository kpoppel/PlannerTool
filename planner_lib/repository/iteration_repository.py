"""IterationRepository: sprint / iteration data for all configured projects.

Provides the single authoritative source for iteration data.
"""
from __future__ import annotations

import logging
from datetime import date as _date
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import IterationsBackend, IterationConfigBackend, BackendCredential
from planner_lib.domain.iterations import DomainIteration, DomainIterationGroup, DomainIterationsByProject

logger = logging.getLogger(__name__)


class IterationRepository:
    """Repository for sprint / iteration data.

    Parameters
    ----------
    backend:
        BackendPort implementation — ``fetch_iterations()`` is called per project.
    project_repository:
        ProjectRepository — provides ``get_project_map()``.
    credential_provider:
        CredentialProvider — provides ``get_credential(user_id)``.
    local_backend:
        IterationConfigBackend — provides ``fetch_iterations_config()``.
    """

    def __init__(self, backend: IterationsBackend, project_repository, credential_provider, iteration_config: IterationConfigBackend) -> None:
        self._backend = backend
        self._project_service = project_repository  # internal alias
        self._credential_provider = credential_provider
        self._iteration_config = iteration_config
        logger.info("IterationRepository: initialised (backend=%s)", type(backend).__name__)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_iterations(
        self,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> DomainIterationsByProject:
        """Return project-keyed effective iteration sets.

        Parameters
        ----------
        project_id:
            When supplied, only the matching configured project's iteration set is returned.
        user_id:
            Session user id for optional credential lookup on a cache miss.
        """
        project_map = self._project_service.get_project_map()
        credential = self._get_optional_credential(user_id)
        iterations_config = self._iteration_config.fetch_iterations_config()

        out: DomainIterationsByProject = {}
        # Track (source_project, frozen_roots) combos already fetched to avoid
        # duplicate backend calls when multiple configured projects share the
        # same ADO iteration source.
        fetched_combos: Dict[tuple[str, tuple[str, ...]], List[DomainIteration]] = {}

        for project in project_map:
            pid = project.get('id')
            if project_id and pid != project_id:
                continue

            resolution = self._resolve_iteration_source(project, iterations_config)
            source_project = resolution.get('sourceProject', '')
            raw_roots = resolution.get('roots', [])
            if not source_project:
                continue

            combo = (source_project, tuple(raw_roots))
            try:
                if combo not in fetched_combos:
                    iters_map: Dict[str, Any] = self._backend.fetch_iterations(
                        source_project,
                        root_paths=raw_roots or None,
                        credential=credential,
                    )
                    fetched_combos[combo] = self._normalize_iterations(iters_map)

                out[str(pid)] = DomainIterationGroup(
                    projectId=str(pid),
                    projectName=str(project.get('name') or ''),
                    sourceProject=source_project,
                    roots=list(raw_roots),
                    iterations=list(fetched_combos[combo]),
                    matchedRuleId=resolution.get('matchedRuleId'),
                    fallbackUsed=bool(resolution.get('fallbackUsed', False)),
                    resolutionWarnings=list(resolution.get('warnings') or []),
                )
            except Exception as exc:
                logger.warning(
                    "Failed to fetch iterations for configured project '%s' "
                    "(source_project='%s', roots=%s): %s",
                    project.get('name') or '?',
                    source_project,
                    raw_roots,
                    exc,
                )

        return out

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_iteration_source(project: dict, iterations_config: dict) -> Dict[str, Any]:
        """Resolve source ADO project and iteration roots for one configured project.

        Supports rule-based schema v2 while remaining backward compatible with
        the legacy shape:
        {
          "azure_project": "...",
          "default_roots": [...],
          "project_overrides": { ... }
        }
        """
        configured_name = str(project.get('name') or '').strip()
        area_path = str(project.get('area_path') or '')
        area_project = (
            area_path.split('\\')[0]
            if '\\' in area_path
            else area_path.split('/')[0]
            if '/' in area_path
            else area_path
        )
        normalized_cfg = IterationRepository._normalize_iterations_config(
            iterations_config,
            area_project=area_project,
        )

        selected = IterationRepository._select_best_rule(
            configured_name=configured_name,
            area_path=area_path,
            rules=normalized_cfg.get('rules') or [],
        )

        default_cfg = normalized_cfg.get('default') or {}
        fallback_project = str(default_cfg.get('source_project') or area_project).strip()
        fallback_roots = IterationRepository._clean_roots(default_cfg.get('roots'))

        warnings: List[str] = []
        if selected is None:
            if normalized_cfg.get('rules'):
                warnings.append('no_rule_matched_using_default')
            if not fallback_project:
                warnings.append('missing_default_source_project')
            return {
                'sourceProject': fallback_project,
                'roots': fallback_roots,
                'matchedRuleId': None,
                'fallbackUsed': bool(normalized_cfg.get('rules')),
                'warnings': warnings,
            }

        source_project = str(selected.get('source_project') or fallback_project).strip()
        roots = IterationRepository._clean_roots(selected.get('roots'))
        if not roots:
            roots = fallback_roots
            warnings.append('rule_missing_roots_using_default')

        if not source_project:
            warnings.append('rule_missing_source_project')

        return {
            'sourceProject': source_project,
            'roots': roots,
            'matchedRuleId': selected.get('rule_id'),
            'fallbackUsed': False,
            'warnings': warnings,
        }

    @staticmethod
    def _normalize_iterations_config(iterations_config: dict, area_project: str) -> Dict[str, Any]:
        """Normalize iteration config into a v2-like shape.

        Returned shape:
        {
          "default": {"source_project": str, "roots": list[str]},
          "rules": list[dict]
        }
        """
        cfg = iterations_config if isinstance(iterations_config, dict) else {}

        has_v2_shape = isinstance(cfg.get('rules'), list) or isinstance(cfg.get('default'), dict)
        if has_v2_shape:
            default_obj = cfg.get('default') if isinstance(cfg.get('default'), dict) else {}
            fallback_project = str(default_obj.get('source_project') or cfg.get('azure_project') or area_project).strip()
            fallback_roots = IterationRepository._clean_roots(
                default_obj.get('roots') if 'roots' in default_obj else cfg.get('default_roots')
            )

            normalized_rules: List[Dict[str, Any]] = []
            for idx, raw_rule in enumerate(cfg.get('rules') or []):
                if not isinstance(raw_rule, dict):
                    continue
                normalized_rules.append(
                    IterationRepository._normalize_rule(raw_rule, idx)
                )

            return {
                'default': {
                    'source_project': fallback_project,
                    'roots': fallback_roots,
                },
                'rules': normalized_rules,
            }

        # Legacy compatibility: synthesize low-priority rules from
        # project_overrides and keep defaults from legacy root fields.
        fallback_project = str(cfg.get('azure_project') or area_project).strip()
        fallback_roots = IterationRepository._clean_roots(cfg.get('default_roots'))

        normalized_rules = []
        project_overrides = cfg.get('project_overrides') if isinstance(cfg.get('project_overrides'), dict) else {}
        for idx, (project_name, override) in enumerate(project_overrides.items()):
            if not isinstance(override, dict):
                continue
            normalized_rules.append(
                {
                    'rule_id': f'legacy-project-{idx + 1}',
                    'enabled': True,
                    'priority': 10,
                    'match': {
                        'project_names': [str(project_name)],
                        'area_path_prefixes': [],
                    },
                    'source_project': str(override.get('azure_project') or fallback_project).strip(),
                    'roots': IterationRepository._clean_roots(override.get('roots')),
                }
            )

        return {
            'default': {
                'source_project': fallback_project,
                'roots': fallback_roots,
            },
            'rules': normalized_rules,
        }

    @staticmethod
    def _normalize_rule(raw_rule: Dict[str, Any], idx: int) -> Dict[str, Any]:
        match_obj = raw_rule.get('match') if isinstance(raw_rule.get('match'), dict) else {}
        project_names = IterationRepository._as_string_list(
            match_obj.get('project_names', match_obj.get('project_name'))
        )
        area_prefixes = IterationRepository._as_string_list(
            match_obj.get('area_path_prefixes', match_obj.get('area_path_prefix'))
        )

        priority_raw = raw_rule.get('priority', 100)
        try:
            priority = int(priority_raw)
        except Exception:
            priority = 100

        return {
            'rule_id': str(raw_rule.get('rule_id') or raw_rule.get('id') or f'rule-{idx + 1}'),
            'enabled': bool(raw_rule.get('enabled', True)),
            'priority': priority,
            'match': {
                'project_names': project_names,
                'area_path_prefixes': area_prefixes,
            },
            'source_project': str(
                raw_rule.get('source_project') or raw_rule.get('azure_project') or ''
            ).strip(),
            'roots': IterationRepository._clean_roots(raw_rule.get('roots')),
        }

    @staticmethod
    def _as_string_list(value: Any) -> List[str]:
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        if isinstance(value, str):
            val = value.strip()
            return [val] if val else []
        return []

    @staticmethod
    def _clean_roots(value: Any) -> List[str]:
        roots = IterationRepository._as_string_list(value)
        return [r for r in roots if r]

    @staticmethod
    def _select_best_rule(
        configured_name: str,
        area_path: str,
        rules: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        name_l = configured_name.lower()
        area_l = area_path.replace('/', '\\').lower()
        best: Optional[tuple[int, int, int, Dict[str, Any]]] = None

        for idx, rule in enumerate(rules or []):
            if not isinstance(rule, dict) or not rule.get('enabled', True):
                continue

            match_obj = rule.get('match') if isinstance(rule.get('match'), dict) else {}
            rule_names = [n.lower() for n in IterationRepository._as_string_list(match_obj.get('project_names'))]
            rule_prefixes = [
                p.replace('/', '\\').lower()
                for p in IterationRepository._as_string_list(match_obj.get('area_path_prefixes'))
            ]

            # All configured match dimensions must pass when present.
            if rule_names and name_l not in rule_names:
                continue

            matched_prefix_len = 0
            if rule_prefixes:
                candidates = [p for p in rule_prefixes if area_l.startswith(p)]
                if not candidates:
                    continue
                matched_prefix_len = max(len(p) for p in candidates)

            try:
                priority = int(rule.get('priority', 100))
            except Exception:
                priority = 100

            candidate = (priority, matched_prefix_len, -idx, rule)
            if best is None or candidate > best:
                best = candidate

        return best[3] if best is not None else None

    @staticmethod
    def _normalize_iterations(iters_map: Dict[str, Any]) -> List[DomainIteration]:
        """Normalize and sort backend iteration maps for one effective source."""
        out: List[DomainIteration] = []
        seen_paths: set[str] = set()

        for path, iter_data in (iters_map or {}).items():
            if path in seen_paths:
                continue
            seen_paths.add(path)
            leaf = path.split('\\')[-1] if '\\' in path else path
            out.append(DomainIteration(
                path=path,
                name=iter_data.get('name', leaf),
                startDate=iter_data.get('startDate'),
                finishDate=iter_data.get('finishDate'),
            ))

        today_str = _date.today().isoformat()

        def _sort_key(it: DomainIteration):
            finish = it.get('finishDate') or ''
            is_current_or_future = not finish or finish[:10] >= today_str
            return (not is_current_or_future, it.get('startDate') or '')

        out.sort(key=_sort_key)
        return out

    def _get_optional_credential(self, user_id: Optional[str]) -> Optional[BackendCredential]:
        if not user_id:
            return None
        try:
            return self._credential_provider.get_credential(user_id)
        except Exception:
            return None
