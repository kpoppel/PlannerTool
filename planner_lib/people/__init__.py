"""People module: managing people database and team assignments."""

from .interfaces import PeopleServiceProtocol
from .people_service import PeopleService

__all__ = [
    "PeopleServiceProtocol",
    "PeopleService",
]
