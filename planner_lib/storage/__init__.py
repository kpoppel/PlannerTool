"""Storage abstraction package for PlannerTool.

Provides a small factory `create_storage` to compose a persistence backend
with a serializer and value-accessor. This keeps import sites simple while
allowing flexible combinations for testing and runtime configuration.

Examples:

	# dict-style access (create nested mappings on set_in)
	>>> from planner_lib.storage import create_storage
	>>> s = create_storage(serializer='pickle', accessor='dict', data_dir='./tmp')
	>>> s.set_in('ns', 'doc', ['a', 'b'], 123)
	>>> s.get_in('ns', 'doc', ['a', 'b'])
	123

	# list-style access (operate on existing list values)
	>>> s2 = create_storage(serializer='pickle', accessor='list', data_dir='./tmp')
	>>> s2.save('ns', 'lst', [0, 1, 2])
	>>> s2.set_in('ns', 'lst', [1], 42)
	>>> s2.get_in('ns', 'lst', [1])
	42

	# encrypted serializer with password (values are transparently encrypted)
	>>> se = create_storage(serializer='encrypted', password='s3cr3t', accessor='dict', data_dir='./tmp_enc')
	>>> se.set_in('ns', 'secret', ['x'], {'foo': 'bar'})
	>>> se.get_in('ns', 'secret', ['x'])
	{'foo': 'bar'}

Accessor helpers
-----------------

The package also provides lightweight in-memory access helpers useful for
tests and interactive use. These are not required by the storage backend but
are convenient when you want container-like operations on nested values.

- `AccessorView` / `StorageProxy`: create a proxy view over a dict/list value
	and use chained indexing (e.g. `view['a']['b'] = 1` or
	`my_view['arr'][0]['x'] = 42`). The factory `StorageProxy(storage, ns, key)`
	returns a view rooted at `storage[ns][key]` (creating intermediate mappings
	as needed).

Example:

		>>> from planner_lib.storage.accessor import StorageProxy
		>>> storage = {}
		>>> v = StorageProxy(storage)
		>>> v['a']['b'] = 123
		>>> storage
		{'a': {'b': 123}}


"""

from typing import Optional

from .base import StorageBackend, ValueNavigatingStorage
from .file_backend import FileStorageBackend
from .serializer import PickleSerializer, JSONSerializer, EncryptedSerializer, YAMLSerializer
from .base import SerializerBackend
from .accessor import DictAccessor, ListAccessor


__all__ = [
	"create_storage",
	"StorageBackend",
	"FileStorageBackend",
]

def create_storage(
	*,
	backend: str = "file",
	serializer: str = "pickle",
	accessor: Optional[str] = "dict",
	password: Optional[str] = None,
	key: Optional[bytes] = None,
	data_dir: str = "./data"
) -> StorageBackend | ValueNavigatingStorage:
	"""Create and return a storage backend instance.

	Parameters
	- backend: currently only 'file' is supported (returns `FileStorageBackend`).
	- data_dir: path for file backend.
	- serializer: 'pickle' or 'json'. If provided, the returned storage will
	  be a `ValueNavigatingStorage` that uses the chosen serializer.
	- accessor: 'dict' or 'list' or None. If provided, the returned storage
	  will expose value-level helpers (`get_in`/`set_in`/`delete_in`). If
	  None, the raw backend is returned.
	"""
	# Backend selection
	if backend == "file":
		be = FileStorageBackend(data_dir=data_dir)
	else:
		raise ValueError(f"unsupported backend: {backend}")

	# Serializer selection
	if serializer == "yaml":
		ser = YAMLSerializer()
	elif serializer == "pickle":
		ser = PickleSerializer()
	elif serializer == "json":
		ser = JSONSerializer()
	elif serializer == "encrypted":
		ser = EncryptedSerializer(key=key, password=password)
	else:
		raise ValueError(f"unsupported serializer: {serializer}")

	# If backend supports an extension attribute, inform it of the
	# serializer's on-disk file extension. This keeps filename handling
	# centralized in the backend while callers continue to use logical keys.
	try:
		be.file_extension = getattr(ser, "file_extension")
	except Exception:
		# ignore if backend doesn't support extensions
		pass
	if accessor is None:
		# if serializer transforms values, wrap the backend with SerializerBackend
		return SerializerBackend(be, ser)
	if accessor == "dict":
		acc = DictAccessor()
	elif accessor == "list":
		acc = ListAccessor()
	else:
		raise ValueError(f"unsupported accessor: {accessor}")

	return ValueNavigatingStorage(be, ser, acc)