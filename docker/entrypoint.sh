#!/bin/sh
set -e

# Set ownership of the data directory to the planner user.
# This handles permissions for both bind mounts and named volumes at runtime.
# Errors are ignored (|| true) to prevent failure when encountering read-only files (e.g., external_database mount).
chown -R planner:planner /app/data 2>/dev/null || true

# Execute the command passed to this script as the 'planner' user
exec gosu planner "$@"