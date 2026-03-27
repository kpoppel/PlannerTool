#!/usr/bin/env python3
#  HOW to use this tool
#   Backup:
#    python3 scripts/server_backup_restore.py --base-url http://localhost:8001 --email <email> backup
#   Creates a file in "backups/" with a timestamped name.
#
#   Restore:
#    python3 scripts/server_backup_restore.py --base-url http://localhost:8001 --email <email> restore --input backups/<json file>
#  Restores the server state from the specified backup file.
#
import os
import json
import argparse
from datetime import datetime
import requests

# Define paths to backup/restore
DATA_DIR = "data"
BACKUP_DIR = "backups"

# Ensure the backup directory exists
os.makedirs(BACKUP_DIR, exist_ok=True)

def authenticate(email, base_url):
    """Authenticate with the server and return the session token."""
    url = f"{base_url}/api/session"
    response = requests.post(url, json={"email": email})
    if response.status_code == 401:
        raise ValueError("Authentication failed. Ensure the admin email is correct and has access.")
    response.raise_for_status()
    return response.json().get("sessionId")

def api_backup(session_id, base_url, output_file):
    """Trigger a backup via the API and save the JSON file."""
    url = f"{base_url}/admin/v1/backup"
    headers = {"X-Session-Id": session_id}
    response = requests.get(url, headers=headers)
    response.raise_for_status()

    with open(output_file, "w") as f:
        json.dump(response.json(), f, indent=4)
    print(f"Backup saved to {output_file}.")

def api_restore(session_id, base_url, input_file):
    """Upload a JSON file via the API to restore the server."""
    url = f"{base_url}/admin/v1/restore"
    headers = {"X-Session-Id": session_id}
    with open(input_file, "r") as f:
        data = json.load(f)
        response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    print("Restore completed.")

def main():
    parser = argparse.ArgumentParser(description="Backup and restore server data via API.")
    parser.add_argument("--base-url", required=True, help="Base URL of the server (e.g., http://localhost:8000).")
    parser.add_argument("--email", required=True, help="Admin email for authentication.")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # Backup command
    backup_parser = subparsers.add_parser("backup", help="Backup server data.")
    backup_parser.add_argument(
        "--output",
        default=f"{BACKUP_DIR}/backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        help="Output file for the backup (default: backups/backup_<timestamp>.json)",
    )

    # Restore command
    restore_parser = subparsers.add_parser("restore", help="Restore server data.")
    restore_parser.add_argument(
        "--input",
        required=True,
        help="Input JSON file to restore from.",
    )

    args = parser.parse_args()

    # Authenticate and get session token
    session_id = authenticate(args.email, args.base_url)

    if args.command == "backup":
        api_backup(session_id, args.base_url, args.output)
    elif args.command == "restore":
        api_restore(session_id, args.base_url, args.input)

if __name__ == "__main__":
    main()