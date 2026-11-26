"""SQL transaction contract used by Local repositories."""
from contextlib import AbstractContextManager
from typing import Any, Iterable, Protocol, Sequence


class SqlTransaction(Protocol):
    def execute(self, statement: str, parameters: Sequence[Any] = ()) -> Any: ...

    def executemany(self, statement: str, parameters: Iterable[Sequence[Any]]) -> Any: ...


class LocalSqlStore(Protocol):
    @property
    def IntegrityError(self) -> type[Exception]: ...

    def read(self) -> AbstractContextManager[SqlTransaction]: ...

    def write(self) -> AbstractContextManager[SqlTransaction]: ...