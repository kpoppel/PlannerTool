"""Admin API façade.

This module composes sub-routers from focused route modules into a single
``router`` that is included by ``main.py``.

Function names used by unit tests are re-exported here so that existing
``from planner_lib.admin import api as admin_api`` imports continue to work.
"""
from fastapi import APIRouter

from planner_lib.admin.setup_routes import (
    router as _setup_router,
    admin_setup_status,
    admin_setup,
    admin_static,
    admin_root,
    admin_check,
    api_admin_reload_config,
)
from planner_lib.admin.config_routes import (
    router as _config_router,
    _backup_existing,
    admin_get_projects,
    admin_save_projects,
    admin_get_global_settings,
    admin_save_global_settings,
    admin_get_iterations,
    admin_save_iterations,
    admin_browse_iterations,
    admin_get_area_mappings,
    admin_save_area_mappings,
    admin_refresh_area_mapping,
    admin_refresh_all_area_mappings,
    admin_toggle_plan_enabled,
    admin_get_teams,
    admin_save_teams,
    admin_get_people,
    admin_save_people,
    admin_inspect_people,
    admin_get_schema,
    admin_get_backup,
    admin_restore_backup,
    admin_get_cost,
    admin_inspect_cost,
    admin_save_cost,
    admin_get_system,
    admin_save_system,
)
from planner_lib.admin.users_routes import (
    router as _users_router,
    admin_get_users,
    admin_save_users,
    admin_cache_invalidate,
    admin_cache_cleanup,
)

router = APIRouter()
router.include_router(_setup_router)
router.include_router(_config_router)
router.include_router(_users_router)

__all__ = [
    'router',
    # private helpers (backward compat)
    '_backup_existing',
    # setup
    'admin_setup_status', 'admin_setup', 'admin_static', 'admin_root',
    'admin_check', 'api_admin_reload_config',
    # config
    'admin_get_projects', 'admin_save_projects',
    'admin_get_global_settings', 'admin_save_global_settings',
    'admin_get_iterations', 'admin_save_iterations', 'admin_browse_iterations',
    'admin_get_area_mappings', 'admin_save_area_mappings',
    'admin_refresh_area_mapping', 'admin_refresh_all_area_mappings',
    'admin_toggle_plan_enabled',
    'admin_get_teams', 'admin_save_teams',
    'admin_get_people', 'admin_save_people', 'admin_inspect_people',
    'admin_get_schema',
    'admin_get_backup', 'admin_restore_backup',
    'admin_get_cost', 'admin_inspect_cost', 'admin_save_cost',
    'admin_get_system', 'admin_save_system',
    # users + cache
    'admin_get_users', 'admin_save_users',
    'admin_cache_invalidate', 'admin_cache_cleanup',
]
