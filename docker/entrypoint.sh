#!/bin/sh
set -e

# Check for required environment variables
if [ -z "$PLANNER_SECRET_KEY" ]; then
  echo "ERROR: PLANNER_SECRET_KEY environment variable is not set"
  echo "This key is required for encrypting Personal Access Tokens (PATs) at rest."
  echo "Generate a key with: openssl rand -base64 32"
  echo "Set it in docker-compose.yml or pass via: docker run -e PLANNER_SECRET_KEY=..."
  exit 1
fi

# Set ownership of the data directory to the planner user.
# This handles permissions for both bind mounts and named volumes at runtime.
# Errors are ignored (|| true) to prevent failure when encountering read-only files (e.g., external_database mount).
chown -R planner:planner /app/data 2>/dev/null || true

# Run migrations as the planner user before starting the application.
# Migrations are applied automatically on container start to ensure data schemas are up-to-date.
# The --apply flag is used to actually execute migrations (not just dry-run).
if [ -f /app/scripts/migrate.py ]; then
  echo "Running migrations..."
  gosu planner python3 /app/scripts/migrate.py --apply || {
    echo "WARNING: Migrations failed. Check logs for details."
    echo "The application will start anyway, but some features may not work correctly."
  }
else
  echo "Migration script not found, skipping migrations"
fi

# Execute the command passed to this script as the 'planner' user
exec gosu planner "$@"