#!/usr/bin/env python3
#  HOW to use this tool
#   Backup:
#    python3 -m scripts.server_backup_restore --base-url http://localhost:8001 --cookies <private-cookie-file> backup
#   Creates a file in "backups/" with a timestamped name.
#
#   Restore:
#    python3 -m scripts.server_backup_restore --base-url http://localhost:8001 --cookies <private-cookie-file> restore --input backups/<json file>
#  Restores the server state from the specified backup file.
#
import os
import json
import argparse
from datetime import datetime
from .api_cli import authenticated_session

# Define paths to backup/restore
DATA_DIR = "data"
BACKUP_DIR = "backups"

def api_backup(session, base_url, output_file):
    """Trigger a backup via the API and save the JSON file."""
    url = f"{base_url}/admin/v1/backup"
    response = session.get(url, headers={'Accept': 'application/json'}, timeout=30)
    response.raise_for_status()

    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)
    descriptor = os.open(output_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as f:
        json.dump(response.json(), f, indent=4)
    print(f"Backup saved to {output_file}.")

def api_restore(session, base_url, input_file, *, restore_accounts=True):
    """Upload a JSON file via the API to restore the server."""
    url = f"{base_url}/admin/v1/restore"
    with open(input_file, "r") as f:
        data = json.load(f)
    if not restore_accounts:
        data.pop('accounts', None)
        data.pop('authentication', None)
    elif 'accounts' in data:
        print('Account keys may revert to older keys; newer keys may stop working. Revoked '
              'browsers or deleted accounts may return. Active sessions will end. Users who '
              'cannot enroll, sign in again, or delete their account need Users > Reset access '
              'and a replacement account key. Ensure an administrator has restored credentials '
              'before continuing; otherwise the operator reset procedure is required.')
        if input('Type restore to overwrite user accounts: ') != 'restore':
            print('Restore cancelled.')
            return
    response = session.post(url, headers={'Accept': 'application/json'}, json=data, timeout=30)
    response.raise_for_status()
    print("Restore completed.")
    if 'accounts' in data:
        print('Sign in again using snapshot-valid credentials. Use Reset access for users whose keys no longer work.')

def main():
    parser = argparse.ArgumentParser(description="Backup and restore server data via API.")
    parser.add_argument("--base-url", required=True, help="Base URL of the server (e.g., http://localhost:8000).")
    parser.add_argument('--cookies', required=True, help='Private enrolled admin cookie jar')

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
    restore_parser.add_argument('--skip-accounts', action='store_true',
                                help='Preserve current accounts, PATs, keys, and browser credentials')

    args = parser.parse_args()

    # Authenticate and get session token
    session = authenticated_session(args.base_url, args.cookies)

    if args.command == "backup":
        api_backup(session, args.base_url, args.output)
    elif args.command == "restore":
        api_restore(session, args.base_url, args.input, restore_accounts=not args.skip_accounts)

if __name__ == "__main__":
    main()