# Device Authentication

PlannerTool uses generated browser credentials, not user-chosen passwords or
email verification. Each installation has independent accounts and credentials.

## Enrollment and rollout

Before first adoption, stop all older processes and retain an independent full
backup if older-binary recovery is required. Server startup owns upgrades; see
[MIGRATIONS.md](MIGRATIONS.md). Successful upgrades retain no predecessor. Migration
0031 marks existing accounts unenrolled without changing their IDs, permissions,
or encrypted Azure PATs. Existing sessions do not authenticate after the upgrade.

Migration 0032 moves saved views and scenarios from email ownership to stable
account IDs and invalidates legacy email-bound sessions. Email remains the
enrollment lookup and display address, not the owner identity for sessions,
user data, or backend credentials. Deleted accounts' data cannot be inherited
by signing up again with the same email. Orphaned legacy data receives an
unclaimed UUID rather than being assigned to a future account.

An unrecognized browser sees enrollment on startup. Enter an email and real name,
then save the account key and confirm it was saved. The first enrollment for
each account is trusted: this intentionally accepts the small intranet rollout
window in which someone could enroll another person's existing account. Once
enrolled, email and name alone can never authenticate that account again.

On a fresh installation, the first enrolled account becomes administrator and
is redirected to admin configuration. Do not publish the service to users until
the administrator completes configuration. Initial admin claiming happens once,
not whenever the installation happens to have no administrators.

Administrators can pre-create regular or admin accounts in User Management.
The account ID and permissions are assigned immediately, while browser
enrollment remains pending. The user then enters that email and their name in
the normal enrollment dialog, receives their own device and account key, and
retains the permissions assigned by the administrator. Creating an account
does not sign the administrator into it or issue another user's credentials.

## Remembered browsers and sessions

Generated credentials contain 256 bits of randomness. The server persists only
their SHA-256 hashes, device IDs, and expiry dates in `account_auth`; plaintext
credentials are carried in HTTP-only, SameSite=Lax cookies. Session identifiers
are hashed in `auth_sessions`; records do not persist decrypted PATs. Browser
cookies are scoped to the installation's reverse-proxy root path.

Authenticated handlers share a request-local session context, so PAT decryption
and session/device idle-expiry updates occur once per request. Contexts are never
shared between requests; later requests resolve current credentials. Before
renewing cookies, middleware checks persisted session and device validity again
without decrypting the PAT or refreshing idle expiry. Revocation during a handler
therefore prevents cookie renewal.

Enrollment and renewal issue separate `Set-Cookie` headers for `plannerDevice`
and `sessionId`. Compression middleware and reverse proxies must preserve both
headers rather than collapse them into a single-value header mapping.

Sessions have a 14-day idle limit and 30-day absolute limit. Remembered browsers
have a 90-day idle lifetime renewed by authenticated use. Session expiry or a
server restart silently renews a session from a valid browser credential. After
90 inactive days, after revocation, after sign-out, or after clearing cookies,
use **Enrollment** with the account email and current account key. There are no
pairing codes or separate Recovery mode. Successful enrollment consumes the key
and displays its replacement; save it before continuing. A rate-limited,
non-cached `POST /api/auth/enrollment-status` checks only whether the email needs
an account key; it does not enroll, issue credentials, or rotate a key. The modal
shows Real name for first enrollment and Account key for enrolled accounts.
Other enrolled browsers
retain access. Configuration can revoke individual browsers and active sessions.

Configuration's Sign out revokes only the current browser's device and sessions,
expires its installation-scoped cookies, clears PlannerTool-owned localStorage
and sessionStorage entries, and reloads. Local cleanup runs only after successful
server revocation. Server data, account settings, and other devices are retained.
Local storage namespaces are shared across same-origin installations, not scoped
to their URL paths; sign-out removes those shared preferences and local drafts.
Unrelated origin storage is preserved.

Cookie renewal captures the installation root before routing: static mounts can
mutate the request's root path. Logout also expires stale cookies at the
installation's `static/` and `admin/static/` paths created by earlier renewal.

The account key has 256 bits of randomness. Only one `account_key_hash` exists
per enrolled account, and consumption/rotation are atomic even across concurrent
requests. Session renewal and normal authenticated operations do not consume it.
If the latest key is lost, an administrator can use Reset access in User
Management. That revokes every browser and session for the account and produces
a replacement account key
in the same save-and-confirm modal used for enrollment, labeled with the affected
account. Save the key before confirming; it is not retrievable afterward. Resetting
your own account signs you out and returns to the planner after confirmation;
choose Enrollment and use the replacement key, then save the newly rotated key.
For another user's account, hand the key to that user through a trusted channel.
If the only administrator loses
all credentials, operator intervention is required.

## Operator reset

If a reset key was lost, the prior key no longer works and its replacement cannot
be retrieved from the server. Another authenticated administrator can reset the
account again. If no administrator can authenticate, an authorized local operator
can issue a fresh key with the server's existing reset operation:

Replace `user@example.com` with the affected account's email address.

```bash
.venv/bin/python - user@example.com <<'PY'
import sys
from planner_lib.accounts.config import AccountManager
from planner_lib.middleware.session import SessionManager
from planner_lib.session.auth import AuthManager
from planner import Config
from planner_lib.migrations.coordinator import Database

handle = Database(Config().data_dir).prepare()
storage = handle.storage
try:
	accounts = AccountManager(storage)
	sessions = SessionManager(accounts, storage)
	auth = AuthManager(storage, accounts, sessions)
	email = sys.argv[1]
	print(auth.reset(email))
finally:
	handle.close()
PY
```

Stop the server and run from the repository root with `DATA_DIR` set to the active
installation root and its existing encryption key. The coordinator resolves and
validates the selected generation rather than opening a new legacy cache. This revokes every device and session
for the selected account but preserves its account ID, name, PAT, and permissions.
The key is printed only to the local terminal for trusted handoff. Keep it outside
the repository and logs. Open the planner, use Enrollment, and save the next key
shown after successful enrollment.

## Account deletion

Choose **Delete account** in Configuration or in the account-access dialog.
The current account key and explicit confirmation are required, even without a
remembered browser. Deletion removes the account, encrypted PAT, authentication,
all sessions, owned saved views/scenarios, and register entries transactionally.
It does not issue a replacement key. The final administrator cannot be deleted.
Administrator deletion uses the same cleanup. Reusing an email creates a new
account ID and cannot inherit the deleted account's data.

This browser's cookies and local PlannerTool data are cleared after success.
Other browsers lose server access, but their offline drafts cannot be remotely
erased. Existing backup files and migration archives require separate operator
retention management; deletion does not remove shared configuration or Azure data.

## Backup and restore

The server JSON backup includes an `authentication` section with account IDs,
enrollment state, display names, account-key hashes, remembered-device hashes
and expiry dates, and the installation's first-admin bootstrap marker. It does
not contain plaintext browser credentials or account keys. Backups still
contain plaintext Azure PATs; protect them as sensitive files.

Logical backups include a schema revision and never restore the server's schema
state or generation pointer. Incompatible revisions and unsupported unversioned
payload contracts are rejected before writes; live restore does not run migrations.
Filesystem recovery and legacy-layout export are separate offline operations.

Restore lets administrators independently select Config, User accounts, Views,
and Scenarios. Leave **User accounts** unchecked to preserve current accounts,
keys, PATs, permissions, and remembered-browser credentials. Accounts and their
authentication are included or excluded together, never separately.

Selecting User accounts replaces account authentication records and bootstrap state with the
snapshot, removing stale destination credentials. Diskcache backup and restore
run transactionally. All active sessions are cleared
after a successful restore, including config-only restores. Rate-limit counters
are not backed up and existing destination counters remain in force.

Browsers whose credentials are present and unexpired in the snapshot can renew
their sessions. Other browsers require Enrollment with the account key saved at the
time of the backup. Account restores without a complete authentication section
or with old recovery-key fields are rejected before writes; create a new backup
after upgrading rather than restoring a pre-feature account backup. Config-only restores remain
supported. Backups containing email-owned views or scenarios are also rejected
before writes; create a new backup after the server-owned upgrade.

Restoring historical authentication state can revive devices revoked since the
backup, account keys consumed since then, and deleted accounts. Newer saved keys
may no longer work. The UI warns before confirmation and reports reset guidance
afterward. Users who cannot enroll, sign in again, or delete their account need
an administrator to use **Users > Reset access** and provide a replacement key.
Review device access after a
restore and use administrator Reset access to revoke all devices and rotate
the account key for any affected account. Credentials issued after the backup
are not retained by restore; ensure an administrator has a snapshot-valid
device or account key before proceeding. If none can authenticate after restore,
use the operator reset procedure. Historical restore can undo account deletion.

## Transport and browser protection

This rollout explicitly accepts HTTP network interception risk. HTTP-only
cookies prevent direct JavaScript access, but HTTP does not prevent someone
observing or modifying intranet traffic from stealing or replaying credentials.
Cookies use Secure when requests are served over trusted HTTPS. Deploy through
a trusted HTTPS gateway when one becomes available.

Cross-origin browser writes are rejected. Enrollment and key-authorized deletion
are rate-limited. Authentication responses must not be cached; account keys,
session IDs, and device credentials must not be logged. Rotation prevents reuse,
not theft: anyone holding the current key can act first, including deleting the
account. Keep it in a private password manager and use HTTPS.

Reverse proxies must preserve the browser's original Host header so it matches
the Origin header on authentication requests. The Vite development proxy uses
`changeOrigin: false` for both `/api` and `/admin/v1`. Restart Vite after updating
its configuration. A startup `POST /api/session` from an unenrolled browser
should return 401 and open enrollment, not a cross-origin 403.

Clients must no longer create sessions from an email or use X-Session-Id. Browser
session renewal is `POST /api/session` with the remembered-device cookie. PAT
updates through `POST /api/config` require a session and the authenticated email.
The legacy `POST /admin/v1/setup` endpoint is retired.