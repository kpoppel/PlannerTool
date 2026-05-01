"""repository package — application-layer repositories built on top of BackendPort
or local config storage.

All data access in the server goes through one of these repositories.
Swapping the backend (live ADO → mock, static, etc.) or the config
storage only requires changes behind the repository interface.

Exports:
    TaskRepository         — reads/writes work items
    HistoryRepository      — reads work-item revision history
    PlanRepository         — reads delivery-plan markers
    IterationRepository    — reads sprint / iteration data
    PeopleRepository       — reads people / team-member data (from config)
    TeamRepository         — reads team definitions (from config)
    ProjectRepository      — reads project definitions (from config)
    ScenarioRepository     — persists user-saved planning scenarios
    ViewRepository         — persists user-saved UI views
    EventRepository        — persists plan-scoped events
"""
from planner_lib.repository.task_repository import TaskRepository
from planner_lib.repository.history_repository import HistoryRepository
from planner_lib.repository.plan_repository import PlanRepository
from planner_lib.repository.iteration_repository import IterationRepository
from planner_lib.repository.people_repository import PeopleRepository
from planner_lib.repository.team_repository import TeamRepository
from planner_lib.repository.project_repository import ProjectRepository
from planner_lib.repository.scenario_repository import ScenarioRepository
from planner_lib.repository.view_repository import ViewRepository
from planner_lib.repository.event_repository import EventRepository

__all__ = [
    'TaskRepository',
    'HistoryRepository',
    'PlanRepository',
    'IterationRepository',
    'PeopleRepository',
    'TeamRepository',
    'ProjectRepository',
    'ScenarioRepository',
    'ViewRepository',
    'EventRepository',
]
