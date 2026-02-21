"""PeopleService: managing people database and team assignments."""
from __future__ import annotations

from typing import List, Dict, Any, Optional
import logging
from pathlib import Path

from planner_lib.services.interfaces import StorageProtocol
from planner_lib.people.interfaces import PeopleServiceProtocol
from planner_lib.storage.serializer import YAMLSerializer

logger = logging.getLogger(__name__)


class PeopleService(PeopleServiceProtocol):
    """Service for managing people database.
    
    The service loads people data from two sources:
    1. A database_file specified in config/people.yml
    2. Inline overrides in config/people.yml under database.people
    
    The inline overrides take precedence over entries from the database_file.
    """

    def __init__(self, storage: StorageProtocol, data_dir: str = "data"):
        """Initialize the PeopleService.
        
        Args:
            storage: Storage backend for config files
            data_dir: Base data directory for resolving relative paths
        """
        self._storage = storage
        self._data_dir = Path(data_dir)
        self._people_cache: List[Dict[str, Any]] = []
        self._config: Dict[str, Any] = {}
        self._load_people()

    def _load_people(self) -> None:
        """Load people database from config and database_file."""
        try:
            # Load people configuration
            self._config = self._storage.load("config", "people") or {}
            
            # Get database_file path
            database_file = self._config.get("database_file", "")
            
            # Load people from database_file if specified
            people_from_file: List[Dict[str, Any]] = []
            if database_file:
                people_from_file = self._load_from_database_file(database_file)
            
            # Get inline overrides from config
            config_database = self._config.get("database", {})
            people_overrides = config_database.get("people", []) or []
            
            # Merge: file entries + overrides (by name)
            # Build a map by name for quick lookup
            people_map: Dict[str, Dict[str, Any]] = {}
            
            # Add entries from file first
            for person in people_from_file:
                name = person.get("name", "")
                if name:
                    people_map[name] = person
            
            # Apply overrides (replace or add)
            for person in people_overrides:
                name = person.get("name", "")
                if name:
                    people_map[name] = person
            
            # Convert back to list
            self._people_cache = list(people_map.values())
            
            logger.debug(f"Loaded {len(self._people_cache)} people entries")
            
        except Exception as e:
            logger.error(f"Failed to load people database: {e}", exc_info=True)
            self._people_cache = []
            self._config = {}

    def _load_from_database_file(self, database_file: str) -> List[Dict[str, Any]]:
        """Load people from the specified database_file.
        
        Args:
            database_file: Path to database file (relative to data_dir or absolute)
            
        Returns:
            List of people dictionaries
        """
        try:
            file_path = Path(database_file)
            
            # If relative, resolve against data_dir
            if not file_path.is_absolute():
                file_path = self._data_dir / file_path
            
            if not file_path.exists():
                logger.warning(f"Database file not found: {file_path}")
                return []
            
            # Load YAML file
            serializer = YAMLSerializer()
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            data = serializer.load(content.encode('utf-8'))
            
            # Extract people array
            if isinstance(data, dict):
                database = data.get("database", {})
                if isinstance(database, dict):
                    people = database.get("people", [])
                    if isinstance(people, list):
                        logger.debug(f"Loaded {len(people)} people from {file_path}")
                        return people
            
            logger.warning(f"Database file has unexpected structure: {file_path}")
            return []
            
        except Exception as e:
            logger.error(f"Failed to load database file {database_file}: {e}", exc_info=True)
            return []

    def get_people(self) -> List[Dict[str, Any]]:
        """Get all people entries.
        
        Returns a list of people dictionaries with at minimum:
        - name: str
        - team_name: str (or team: str)
        - site: str
        - external: bool
        """
        return self._people_cache

    def get_people_by_team(self, team_name: str) -> List[Dict[str, Any]]:
        """Get all people assigned to a specific team.
        
        Args:
            team_name: The team name to filter by
            
        Returns:
            List of people dictionaries with matching team_name
        """
        return [
            person for person in self._people_cache
            if person.get("team_name") == team_name or person.get("team") == team_name
        ]

    def reload(self) -> None:
        """Reload the people database from storage.
        
        This re-reads both the database_file and config overrides.
        """
        self._load_people()

    def get_config(self) -> Dict[str, Any]:
        """Get the current people configuration.
        
        Returns:
            The people configuration dictionary
        """
        return self._config
