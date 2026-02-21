"""Protocol definitions for people service."""
from typing import Protocol, List, Dict, Any, runtime_checkable


@runtime_checkable
class PeopleServiceProtocol(Protocol):
    """Protocol for PeopleService public surface.
    
    The PeopleService manages the people database, loading from
    a configured database_file and merging with inline overrides.
    """

    def get_people(self) -> List[Dict[str, Any]]:
        """Get all people entries.
        
        Returns a list of people dictionaries with at minimum:
        - name: str
        - team_name: str  
        - site: str
        - external: bool
        
        Additional fields may be present depending on the database.
        """
        ...

    def get_people_by_team(self, team_name: str) -> List[Dict[str, Any]]:
        """Get all people assigned to a specific team.
        
        Args:
            team_name: The team name to filter by
            
        Returns:
            List of people dictionaries with matching team_name
        """
        ...

    def reload(self) -> None:
        """Reload the people database from storage.
        
        This re-reads both the database_file and config overrides.
        """
        ...
