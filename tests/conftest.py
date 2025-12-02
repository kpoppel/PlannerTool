"""Pytest configuration helpers for test collection.

Ensure the project root is on sys.path so tests can import the package
without requiring PYTHONPATH to be set externally.
"""
import sys
from pathlib import Path


def pytest_configure(config):
    # Insert repo root (one level up from tests/) to sys.path
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root))
