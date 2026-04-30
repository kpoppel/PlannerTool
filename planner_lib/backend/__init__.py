"""Backend package.

Provides the BackendPort protocol and concrete implementations:
- AzureDevOpsBackend  — live Azure DevOps via the azure-devops SDK
- CachingBackend      — transparent TTL cache wrapper (composition)
- StaticBackend       — read-only YAML/JSON file backend (standalone mode)
- MockFixtureBackend  — fixture-replay backend for tests / demo
- MockGeneratorBackend — synthetic-data backend for tests / demo

Credential handling is separated into CredentialProvider so the data
path never carries raw PAT strings.

BackendRegistry (registry.py) is the single place to add or remove backends.
"""
from planner_lib.backend.port import (
    BackendCredential,
    CredentialProvider,
    BackendPort,
)

__all__ = [
    'BackendCredential',
    'CredentialProvider',
    'BackendPort',
]
