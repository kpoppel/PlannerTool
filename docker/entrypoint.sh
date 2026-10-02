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

# External config mounts are not server-owned and must remain untouched.
data_root="${DATA_DIR:?DATA_DIR must be set}"
mkdir -p "$data_root"
chown planner:planner "$data_root"
for name in cache generations remote_cache database.lock database-entry.lock active-generation.json upgrade-state.json migrations.json; do
  if [ -e "$data_root/$name" ]; then
    chown -R -h planner:planner "$data_root/$name"
  fi
done

if [ -d "$data_root/cache" ] && [ ! -e "$data_root/active-generation.json" ] && [ -f "$data_root/config/server_config.yml" ]; then
  chown -h planner:planner "$data_root/config/server_config.yml"
fi

# Execute the command passed to this script as the 'planner' user
exec gosu planner "$@"