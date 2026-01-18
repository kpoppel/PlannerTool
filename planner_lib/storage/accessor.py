from typing import Any, Sequence, MutableMapping, Protocol

class ValueAccessor(Protocol):
    """Protocol to navigate and mutate an in-memory value (dict/list/other)."""

    def get(self, value: Any, path: Sequence[Any]) -> Any: ...

    def set(self, value: Any, path: Sequence[Any], new: Any) -> Any: ...

    def delete(self, value: Any, path: Sequence[Any]) -> Any: ...


class DictAccessor:
    """Accessor for nested dict-like structures using a sequence of keys.

    Path elements are treated as mapping keys. Missing intermediate mappings
    are created on `set`.
    """

    def get(self, value: MutableMapping, path: Sequence[str]) -> Any:
        cur = value
        for p in path:
            if not isinstance(cur, MutableMapping):
                raise KeyError(f"Path element {p!r} not found in non-mapping")
            cur = cur[p]
        return cur

    def set(self, value: MutableMapping, path: Sequence[str], new: Any) -> Any:
        cur = value
        for p in path[:-1]:
            if p not in cur or not isinstance(cur[p], MutableMapping):
                cur[p] = {}
            cur = cur[p]
        cur[path[-1]] = new
        return value

    def delete(self, value: MutableMapping, path: Sequence[str]) -> Any:
        cur = value
        for p in path[:-1]:
            cur = cur[p]
        del cur[path[-1]]
        return value


class ListAccessor:
    """Accessor for list-like structures using integer indices in the path."""

    def get(self, value: Sequence[Any], path: Sequence[int]) -> Any:
        cur = value
        for p in path:
            cur = cur[p]
        return cur

    def set(self, value: list, path: Sequence[int], new: Any) -> Any:
        cur = value
        for p in path[:-1]:
            cur = cur[p]
        cur[path[-1]] = new
        return value

    def delete(self, value: list, path: Sequence[int]) -> Any:
        cur = value
        for p in path[:-1]:
            cur = cur[p]
        cur.pop(path[-1])
        return value


class MixedAccessor:
    """A convenience accessor that dispatches to DictAccessor or ListAccessor
    depending on the current container type. Path elements that are `int`
    index into lists, otherwise they are mapping keys.
    """

    def __init__(self) -> None:
        self._dict = DictAccessor()
        self._list = ListAccessor()

    def get(self, value: Any, path: Sequence[Any]) -> Any:
        cur = value
        for p in path:
            if isinstance(p, int):
                cur = self._list.get(cur, (p,))
            else:
                cur = self._dict.get(cur, (p,))
        return cur

    def set(self, value: Any, path: Sequence[Any], new: Any) -> Any:
        # Walk all but last element to find parent container
        cur = value
        for p in path[:-1]:
            if isinstance(p, int):
                cur = self._list.get(cur, (p,))
            else:
                # create intermediate mappings if needed
                if not isinstance(cur, MutableMapping):
                    raise TypeError("Expected mapping while setting by key")
                if p not in cur or not isinstance(cur[p], (MutableMapping, list)):
                    cur[p] = {}
                cur = cur[p]

        last = path[-1]
        if isinstance(last, int):
            return self._list.set(cur, (last,), new)
        return self._dict.set(cur, (last,), new)

    def delete(self, value: Any, path: Sequence[Any]) -> Any:
        cur = value
        for p in path[:-1]:
            if isinstance(p, int):
                cur = self._list.get(cur, (p,))
            else:
                cur = self._dict.get(cur, (p,))
        last = path[-1]
        if isinstance(last, int):
            return self._list.delete(cur, (last,))
        return self._dict.delete(cur, (last,))


class AccessorView:
    """A proxy object that exposes mapping/list access to an underlying
    in-memory value using an accessor. Supports chained indexing like
    ``view['a']['b']`` and attribute-like convenience.
    """

    def __init__(self, accessor: ValueAccessor, root: Any, path: Sequence[Any] = ()):  # type: ignore[override]
        self._accessor = accessor
        self._root = root
        self._path = tuple(path)

    def _full_path(self, extra: Sequence[Any]) -> Sequence[Any]:
        return tuple(self._path) + tuple(extra)

    def __getitem__(self, key: Any) -> 'AccessorView':
        # Return a new view at extended path. For leaf get, user can call
        # `view.get()` if they want the actual value.
        return AccessorView(self._accessor, self._root, self._full_path((key,)))

    def __setitem__(self, key: Any, value: Any) -> None:
        full = self._full_path((key,))
        self._accessor.set(self._root, full, value)

    def __delitem__(self, key: Any) -> None:
        full = self._full_path((key,))
        self._accessor.delete(self._root, full)

    def get(self) -> Any:
        return self._accessor.get(self._root, self._path)

    def set(self, value: Any) -> Any:
        return self._accessor.set(self._root, self._path, value)

    def delete(self) -> Any:
        return self._accessor.delete(self._root, self._path)

    def __repr__(self) -> str:  # pragma: no cover - convenience
        try:
            val = self.get()
        except Exception:
            val = '<unreadable>'
        return f"AccessorView(path={self._path}, value={val!r})"


def StorageProxy(storage: MutableMapping, ns: Any = None, key: Any = None) -> AccessorView:
    """Convenience factory to get an AccessorView rooted at a particular
    storage namespace/key. If `ns` and `key` are provided, it will return a
    view at `storage[ns][key]` (creating intermediate dicts as needed).
    Otherwise it returns a view over the whole `storage` object.
    """
    accessor = MixedAccessor()
    root = storage
    if ns is not None and key is not None:
        # create intermediate mapping(s) if needed
        if ns not in root or not isinstance(root[ns], MutableMapping):
            root[ns] = {}
        if key not in root[ns] or not isinstance(root[ns][key], (MutableMapping, list)):
            root[ns][key] = {}
        root = root[ns][key]
    return AccessorView(accessor, root, ())
