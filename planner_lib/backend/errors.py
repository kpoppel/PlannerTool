"""Typed backend errors.

These give the data backends a small, explicit vocabulary for *why* a live
fetch failed, so the layers above (``CachingBackend``, repositories, the API)
can react by type instead of sniffing exception strings.

Only backends that talk to a remote system (the live Azure DevOps backend) ever
raise these.  Local/static/mock backends never fail this way, so they never
need to import this module.

Contract
--------
``AzureDevOpsBackend`` guarantees that any failure contacting ADO surfaces as a
``BackendError`` subclass — never a raw SDK/HTTP exception.  ``CachingBackend``
relies on this: it catches ``BackendError`` to decide whether to serve stale
cached content, and uses the concrete subclass to pick the user-facing message.
"""
from __future__ import annotations


class BackendError(Exception):
    """Base class for recoverable failures contacting a remote data backend."""


class BackendAuthError(BackendError):
    """Authentication/authorization failed.

    Raised when the credential is missing, empty, invalid, or expired — i.e.
    the user must fix their Personal Access Token.
    """


class BackendUnavailableError(BackendError):
    """The remote backend is unreachable or returned a transient server error.

    Raised for network failures, timeouts, and 5xx-style responses — i.e. an
    outage outside the user's control.
    """


# Substrings (lower-cased) that identify an authentication/authorization failure
# in raw Azure DevOps SDK / HTTP exception messages.  Anything not matching is
# treated as a transient availability problem.
_AUTH_MARKERS = (
    'invalid_pat',
    'unauthorized',
    '401',
    'forbidden',
    '403',
    'tf400813',   # ADO: "The user is not authorized to access this resource."
    'vs30063',    # ADO: "You are not authorized to access ..."
    'authentication',
    'personal access token',
)


def classify_ado_exception(exc: Exception) -> BackendError:
    """Map a raw exception from the ADO SDK to a typed ``BackendError``.

    This is the single place where ADO failure strings are interpreted.  An
    already-typed ``BackendError`` is returned unchanged so the classifier is
    safe to apply at multiple boundaries without re-wrapping.
    """
    if isinstance(exc, BackendError):
        return exc
    txt = str(exc).lower()
    if any(marker in txt for marker in _AUTH_MARKERS):
        return BackendAuthError(str(exc))
    return BackendUnavailableError(str(exc))
