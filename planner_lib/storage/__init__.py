"""Storage abstraction package for PlannerTool.

Provides a simple factory `create_storage` to compose a persistence backend
with a serializer. This keeps import sites simple while allowing flexible
combinations for testing and runtime configuration.

Examples:

	# Raw access (no serialization)
	>>> from planner_lib.storage import create_storage
	>>> s = create_storage(serializer='raw', data_dir='./tmp')
	>>> s.save('ns', 'key', b'binary data')
	>>> s.load('ns', 'key')
	b'binary data'

	# YAML serialization (human-readable configs)
	>>> sy = create_storage(serializer='yaml', data_dir='./tmp')
	>>> sy.save('ns', 'config', {'foo': 'bar', 'count': 42})
	>>> sy.load('ns', 'config')
	{'foo': 'bar', 'count': 42}

	# JSON serialization
	>>> sj = create_storage(serializer='json', data_dir='./tmp')
	>>> sj.save('ns', 'data', {'items': [1, 2, 3]})
	>>> sj.load('ns', 'data')
	{'items': [1, 2, 3]}

	# Encrypted serializer with password (values are transparently encrypted)
	>>> se = create_storage(serializer='encrypted', password='s3cr3t', data_dir='./tmp_enc')
	>>> se.save('ns', 'secret', {'foo': 'bar'})
	>>> se.load('ns', 'secret')
	{'foo': 'bar'}

"""

from typing import Optional

from .base import StorageBackend, SerializerBackend
from .serializer import JSONSerializer, EncryptedSerializer, YAMLSerializer

__all__ = [
	"create_storage",
	"StorageBackend"
]

def create_storage(
	*,
	backend: str = "file",
	serializer: str = "raw",
	password: Optional[str] = None,
	key: Optional[bytes] = None,
	data_dir: str = "./data",
) -> StorageBackend:
	"""Create and return a storage backend instance.

	Parameters
	- backend: 'file' (file-based), 'memory' (in-memory for tests), or 'diskcache' (SQLite-backed cache).
	- data_dir: path for file/diskcache backend.
	- serializer: 'raw' (no serialization), 'yaml', 'json', or 'encrypted'.
	  If provided, the returned storage will transparently serialize/deserialize values.
	- password: password for encrypted serializer (mutually exclusive with key).
	- key: encryption key for encrypted serializer (mutually exclusive with password).
	"""
	# Backend selection
	if backend == "file":
		from .file_backend import FileStorageBackend
		be = FileStorageBackend(data_dir=data_dir)
	elif backend == "memory":
		from .memory_backend import MemoryStorage
		be = MemoryStorage()
	elif backend == "diskcache":
		from .diskcache_backend import DiskCacheStorage
		be = DiskCacheStorage(data_dir=data_dir)
	else:
		raise ValueError(f"unsupported backend: {backend}")

	# Serializer selection
	if serializer == "yaml":
		ser = YAMLSerializer()
	elif serializer == "json":
		ser = JSONSerializer()
	elif serializer == "encrypted":
		ser = EncryptedSerializer(key=key, password=password)
	elif serializer == "raw":
		# No serialization - return raw backend directly
		return be
	else:
		raise ValueError(f"unsupported serializer: {serializer}")

	# Set file extension on backend if it supports it (file backend does)
	if hasattr(be, 'file_extension') and hasattr(ser, 'file_extension'):
		be.file_extension = ser.file_extension

	# Wrap backend with serializer
	return SerializerBackend(be, ser)