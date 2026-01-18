from typing import Any, Protocol
import pickle
import json
import yaml

class Serializer(Protocol):
    """Serialize/deserialize Python values for backends that store bytes/text.

    Implementations should be symmetric: `dump` -> bytes, `load` <- bytes.
    """

    def dump(self, value: Any) -> bytes: ...

    def load(self, data: bytes) -> Any: ...


class PickleSerializer:
    """Default serializer using pickle (binary).

    This is a practical default since stored values may be arbitrary Python
    objects. Consumers can choose `JSONSerializer` when interoperable text
    is desired.
    """

    def dump(self, value: Any) -> bytes:
        return pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)

    def load(self, data: bytes) -> Any:
        return pickle.loads(data)


class JSONSerializer:
    """Serializer using JSON (text). Caller must ensure values are JSON-serializable."""

    def dump(self, value: Any) -> bytes:
        return json.dumps(value, default=lambda o: o.__dict__).encode("utf-8")

    def load(self, data: bytes) -> Any:
        return json.loads(data.decode("utf-8"))

class YAMLSerializer:
    """Serializer using YAML (text). Caller must ensure values are YAML-serializable."""

    def dump(self, value: Any) -> bytes:
        return yaml.dump(value).encode("utf-8")
    
    def load(self, data: bytes) -> Any:
        return yaml.safe_load(data.decode("utf-8"))
    
class EncryptedSerializer:
        """Serializer that encrypts payloads using Fernet (symmetric, authenticated).

        Notes and recommendations:
        - Fernet is an authenticated symmetric cipher (AES-CBC + HMAC under the hood
            via the cryptography library) and is suitable for encrypting application
            payloads when you manage the symmetric key securely.
        - `base_serializer` defaults to JSON (text) but is intentionally set inside
            `__init__` to avoid mutable/side-effectful default arguments.
        - For passphrase-derived keys, use `from_password` which applies PBKDF2 to
            derive a secure key with a salt.
        - Key rotation and metadata (key id, algorithm version) should be handled
            at a higher layer; this class focuses on encrypt/decrypt with a single key.
        """

        def __init__(
            self,
            *,
            key: bytes | None = None,
            password: str | None = None,
            iterations: int = 390000,
            base_serializer: Serializer | None = None,
        ) -> None:
            """Create an EncryptedSerializer.

            Provide either `key` (a Fernet key) or `password` (a passphrase). When
            using `password`, each encrypted payload will include a random salt and
            KDF params to allow key derivation on decrypt.
            """
            self._key = key
            self._password = password
            self._iterations = iterations
            self.base_serializer = base_serializer or JSONSerializer()

        def _derive_key(self, password: str, salt: bytes, iterations: int) -> bytes:
            import base64
            from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.backends import default_backend

            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=salt,
                iterations=iterations,
                backend=default_backend(),
            )
            return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))

        def dump(self, value: Any) -> bytes:
            """Serialize and encrypt value, returning a framed JSON blob.

            The frame includes version, kdf params (when password-mode) and the
            base64-encoded ciphertext so the loader can derive the key and decrypt.
            """
            import os
            import base64
            from cryptography.fernet import Fernet
            inner = self.base_serializer.dump(value)

            if self._password is not None:
                salt = os.urandom(16)
                key = self._derive_key(self._password, salt, self._iterations)
                f = Fernet(key)
                ct = f.encrypt(inner)
                frame = {
                    "v": 1,
                    "mode": "password",
                    "kdf": "pbkdf2",
                    "iterations": self._iterations,
                    "salt": base64.urlsafe_b64encode(salt).decode("ascii"),
                    "ct": base64.urlsafe_b64encode(ct).decode("ascii"),
                }
                return json.dumps(frame).encode("utf-8")

            if self._key is not None:
                f = Fernet(self._key)
                ct = f.encrypt(inner)
                frame = {"v": 1, "mode": "key", "ct": base64.urlsafe_b64encode(ct).decode("ascii")}
                return json.dumps(frame).encode("utf-8")

            raise ValueError("EncryptedSerializer requires either `key` or `password`")

        def load(self, data: bytes) -> Any:
            """Parse framed blob, derive key if needed, decrypt and deserialize."""
            import base64
            from cryptography.fernet import Fernet

            frame = json.loads(data.decode("utf-8"))
            mode = frame.get("mode")
            if mode == "password":
                if self._password is None:
                    raise ValueError("serializer was not configured with a password")
                salt = base64.urlsafe_b64decode(frame["salt"].encode("ascii"))
                iterations = frame.get("iterations", self._iterations)
                key = self._derive_key(self._password, salt, iterations)
                f = Fernet(key)
                ct = base64.urlsafe_b64decode(frame["ct"].encode("ascii"))
                pt = f.decrypt(ct)
                return self.base_serializer.load(pt)

            if mode == "key":
                if self._key is None:
                    raise ValueError("serializer was not configured with a key")
                f = Fernet(self._key)
                ct = base64.urlsafe_b64decode(frame["ct"].encode("ascii"))
                pt = f.decrypt(ct)
                return self.base_serializer.load(pt)

            raise ValueError("unknown frame format")
