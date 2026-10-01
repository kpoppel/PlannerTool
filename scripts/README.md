PlannerTool API CLI
===================

A tiny CLI to interact with the PlannerTool server API.

Usage
-----

Set the server base URL (optional):

```bash
export API_BASE=http://localhost:8000
```

Enroll the CLI as a remembered browser. Keep both files outside the repository;
the cookie jar grants browser access and the account-key file grants account
access, including deletion. They are created with private permissions.

```bash
export API_BASE=http://localhost:8001
python3 -m scripts.api_cli enroll user@example.com --name 'Example User' \
	--cookies "$HOME/planner-cookies.txt" --key-output "$HOME/planner-account-key.txt"
```

The current key is requested privately, never as a command-line argument. Leave
it blank for first enrollment. Each enrollment rotates the key; save the new
file in secure storage and replace the old saved key. Choose a new output filename
for each enrollment; the CLI will not overwrite an existing key file. If the
response is lost after enrollment, ask an administrator to reset access.

Check health:

```bash
python3 scripts/api_cli.py health
```

GET an endpoint using the protected cookie jar (sessions renew without key use):

```bash
python3 -m scripts.api_cli get /api/projects --cookies "$HOME/planner-cookies.txt"
```

POST JSON (data can be a JSON string or @filename):

```bash
python3 -m scripts.api_cli post /api/scenario --cookies "$HOME/planner-cookies.txt" -d @payload.json
```

Backup and restore use an enrolled administrator's cookie jar:

```bash
python3 -m scripts.server_backup_restore --base-url "$API_BASE" \
	--cookies "$HOME/planner-cookies.txt" backup --output "$HOME/planner-backup.json"
python3 -m scripts.server_backup_restore --base-url "$API_BASE" \
	--cookies "$HOME/planner-cookies.txt" restore --input "$HOME/planner-backup.json" --skip-accounts
```

Omit `--skip-accounts` only when restoring account identities and authentication
is intended. The command warns and requests confirmation: older keys may be
restored, newer keys may stop working, and deleted accounts or revoked browsers
may return. Ensure an administrator has snapshot-valid credentials; use Reset
access for users who cannot enroll, sign in again, or delete their account.
Active sessions are cleared even when accounts are skipped. Backups contain
plaintext PATs; the helper creates a private file and will not overwrite it.

Run the cost endpoint helper as a module with `--cookies` as well:
`python3 -m scripts.test_cost_endpoint --cookies "$HOME/planner-cookies.txt"`.

Notes
-----
- Uses `requests` (already present in `requirements.txt`).
- Session and remembered-browser credentials travel only as cookies, not printed
	IDs or headers. Email alone cannot authenticate an enrolled account.
