""" Constants for accounts"""
class AccountPermissions:
    ADMIN = 'admin'
    MANAGE_PROJECTS = 'manage_projects'
    MANAGE_WORKFORCE_TEAMS = 'manage_workforce_teams'
    MANAGE_WORKFORCE_COSTS = 'manage_workforce_costs'
    MANAGE_ITERATIONS = 'manage_iterations'

    DELEGATED = (MANAGE_PROJECTS, MANAGE_WORKFORCE_TEAMS, MANAGE_WORKFORCE_COSTS,
                 MANAGE_ITERATIONS)
    ALL = (ADMIN, *DELEGATED)
