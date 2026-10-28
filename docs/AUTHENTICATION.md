# Authentication

Deployment selects enrollment/PAT or external broker login/delegated ADO credentials.
PlannerTool owns accounts, permissions and sessions; the broker owns upstream identity
verification and token renewal. Backend selection remains in **Admin > Data Sources**.
See [deployment](DEPLOYMENT.md) for manifest configuration.

Revision 44 is the single upgrade from dev: it initializes policy and identity metadata
and expires pre-policy sessions. Accounts, permissions, PATs, enrollment and user data
are preserved. Login-source or broker-authority changes advance the policy epoch once;
unchanged restarts do not. Broker authority is its public URL, mode and protocol.
Each instance has a distinct protected service secret and exact registered callback.
Mock links are discarded on authority changes. Intermediate branch schemas are unsupported.
Startup never seeds accounts, replaces backend settings, purges credentials or installs
network isolation. Physical copies need the original encryption key to read credentials.

## External Accounts

Identities are keyed by trusted issuer and opaque subject, not email. New identities
are unprivileged; only the first verified account on genuinely empty live data becomes
administrator. At first live activation, existing accounts become eligible for one-time,
case-insensitive claims using the validated ID token's `email` claim. A claim preserves
the account UUID, permissions and data and is permanently consumed. Later-created
accounts are ineligible; established identity links never follow email changes.

Without an email claim, the user gets a separate account with empty contact email.
**Configuration > Existing account email > Link account** can merge it into an eligible
account, moving views/scenarios, retaining the destination UUID/permissions, ending old
source sessions and reloading the browser. Data-key collisions roll back the merge.
This accepted migration policy requires only the entered email, not proof of ownership:
any signed-in user can claim an eligible administrator account. Restrict the enterprise
application audience until migration is complete. There is no unlink/reassignment API.

Mock sign-in deliberately impersonates an entered email, including administrators,
preserving existing permissions and data. Its `link_existing_by_email` assertion is
rejected outside mock mode. Unknown emails create unprivileged accounts. Never expose
mock authentication as production authentication.

## Local Access and Remote Authority

Local accounts, permissions and normal session expiry govern application access;
Entra disablement is not polled. Local offboarding remains an administrator's task.
ADO denial, grant expiry/revocation and broker outages do not end a valid local session.
New login still requires the broker; expired local sessions cannot read cached data.

Credentials are acquired/renewed only for active-user remote work, including running
jobs, never on an idle timer or profile read. Issuer expiry and tenant/MSAL outcomes
govern remote enforcement; an expected one-hour token lifetime is not a disablement bound.
`fixture` tokens are rejected before any ADO/wiki request with `ado_credential_unusable`.
They do not change login, backend settings or permissions and do not trigger recovery.

For `interaction_required`, `access_denied`, `auth_unavailable` or `ado_credential_unusable`,
`GET /api/tasks` can return the existing complete snapshot with HTTP 200 and a warning
in `X-Backend-Diagnostics`, without starting remote work. Empty snapshots are valid;
configuration changes add a warning. Missing snapshots preserve the original error.
Invalid sessions/configuration errors never use this path. Writes and explicit remote
refreshes remain credential-gated.

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

Scenario ownership uses this account UUID, never an email or administrator role.
Scenario reads expose computed `access: {canEdit, reason}` metadata. It is not
persisted and client-supplied capabilities or owner fields cannot grant access.
Stored read-only protection is checked transactionally for save and delete;
omitting or changing the submitted `readonly` flag does not remove that lock.
The synthetic `baseline` identity cannot be saved or deleted through the API.
Denied protected writes return HTTP 403 with `error: scenario_read_only`.

Sharing is not enabled yet. Future shared reads must retain the original owner
and grant editing only to that owner, without an administrator override. Before
sharing ships, publication must also authorize an explicit source-scenario
identity on the server; current generic task/group write endpoints do not carry
that context and frontend permission checks alone cannot provide that guarantee.

An unrecognized browser sees enrollment on startup. Enter an email and real name,
then save the account key and confirm it was saved. The first enrollment for
each account is trusted: this intentionally accepts the small intranet rollout
window in which someone could enroll another person's existing account. Once
enrolled, email and name alone can never authenticate that account again.

On a fresh installation, the first enrolled account becomes administrator and
is redirected to admin configuration. New installations default to the synthetic
generator mock for demo use; registration and demo administration require no ADO
PAT. Existing installations retain their configured backend. To use live Azure
DevOps, the administrator selects the live backend and organization in Data
Sources and enters their PAT in account configuration. Do not publish the service to users until
the administrator completes configuration. Initial admin claiming happens once,
not whenever the installation happens to have no administrators.

Administrators can pre-create accounts in **Admin > Users > Add user**, then use
the account's permission editor to grant delegated or full administrator access.
The account ID and permissions are assigned immediately, while browser
enrollment remains pending. The user then enters that email and their name in
the normal enrollment dialog, receives their own device and account key, and
retains the permissions assigned by the administrator. Creating an account
does not sign the administrator into it or issue another user's credentials.

## Release acknowledgement and public help

The permanent illustrated release page is served at
`/static/docs/releases/v5.0.0/index.html`; enrollment help remains at
`/static/docs/account-access/index.html`, including before authentication.
Neither page contains credentials or changes acknowledgement state.

`GET /api/auth/release-notes` returns `{releaseId, acknowledged}` for the
authenticated account. `POST /api/auth/release-notes` accepts `{releaseId}` for
the published release only. Ownership comes from the session account ID, never
the request body. Both responses are non-cacheable; these account self-service
routes remain available without a working ADO PAT. The separate
`release_acknowledgements` namespace stores the last acknowledged release by
account ID and is cleared with account deletion. Missing records mean unread;
no authentication schema upgrade is required. Full filesystem backups include
the record; selective logical account exports do not promise to preserve read state.

Planner and administration startup show an unread release before application
data loads. Explicit Continue records it across browsers; failed saves keep the
reader open for retry. Help retains a link to the permanent page, and the
Enrollment and save-key screens retain a contextual enrollment-help link.

## Azure DevOps credentials

### Deployment Authentication Policy

The manifest requires `ado_authentication: disabled|pat|entra`. Connected instances
use broker login under `entra`; other instances retain enrollment. Generated
`PLANNER_ADO_AUTHENTICATION` rejects live ADO/wiki configuration when disabled or
when Entra is required but disconnected, at startup, save and import. Backend saves
cannot change mode, epoch, sessions or credentials. Per-instance `backend`,
`authentication_provider` and generated `PLANNER_INSTANCE_BACKEND` are unsupported.

### External Identity and Delegated Credentials

Broker messages bind public URL, mode and protocol. Redemption returns
`{identity: {issuer, subject, name, email?}, grant, expires_at}`; `ado` token requests
return `{resource, token_kind, access_token, expires_at}`. PlannerTool hashes the
issuer/subject pair and never decodes provider tokens. Internal lookup addresses
end in `@identity.invalid`; contact details come from the identity link.

Each login owns a binding and encrypted grant. Acquisition checks acting UUID,
session, epoch, authority, resource, token kind and expiry. SDK/wiki authentication
is explicitly Basic or Bearer; task refresh revalidates authority transactionally
before publication. Credentials are never borrowed across users or switched to PAT
on failure; deleted accounts cannot renew.

The live broker uses MSAL authorization-code flow with PKCE, a browser-bound
`form_post` callback and encrypted persistent caches. Verified tenant, audience and
issuer must match; automatic claims use `email`, never `preferred_username`. Grants
last at most 30 days. Status does not refresh tokens; caches/refresh tokens never
enter PlannerTool or the browser. Real registration, consent, Conditional Access
and ADO renewal require tenant-backed acceptance, not mock tests.

### Frontend Adapter Contract

Planner and administration share one discovered broker client. PAT/local mode keeps
enrollment and PAT controls; broker capabilities hide those, device/key management,
manual account creation and self-deletion. Routes below are relative to the instance
API URL, including its subpath:

| Operation | Request | Successful response |
| --- | --- | --- |
| Public discovery | `GET /auth/config` | `{mode: 'broker', capabilities}`; no account or credential acquisition |
| Common profile/status | `GET /auth/me` | Client state, including UUID profile or `account: null`; no ADO token acquisition |
| Begin sign-in/reauthentication | `POST /auth/login/begin` | Browser transaction passed to the injected login presenter |
| Browser callback | `GET /auth/login/callback` | Redeems the bound handoff and notifies the opener |
| Existing account claim | `POST /auth/links/claim` | Updated profile after the one-way merge |
| Instance logout | `POST /auth/logout` | Signed-out client state |

Sign-in uses a popup and a bound `app`/`admin` return target, never an arbitrary URL.
Only the callback redeems the handoff. Its CSP-protected message contains instance,
state and error/success; the opener checks origin, window, instance and state, then
reads the profile. Closing/cancelling does not authenticate. Without an opener, the
callback returns to the fixed instance-local destination.

Profiles expose local permissions, not credentials. Discovery is local; profiles
never acquire ADO tokens and may report `unavailable` without losing identity.
Logout revokes the current session/grant, not other sessions/instances or corporate
SSO. Local revocation survives broker failure; `revocation_pending` produces a
one-time notice. Browser requests use same-origin cookies, never tokens or grants.

Failures use `{error: code}`:

| HTTP | Code | Permitted recovery |
| --- | --- | --- |
| 401 | `session_expired`, `invalid_session` | Login; safe reads may be retried once for the same account |
| 409 | `interaction_required` | Explicit reauthentication; no automatic login or request replay |
| 403 | `access_denied` | None; do not loop through login |
| 403 | `ado_credential_unusable` | None; fake ADO authority cannot be repaired through login |
| 503 | `auth_unavailable`, `auth_configuration_error` | None; retry later or repair configuration |
| 403 | `pat_required`, `pat_invalid` | Explicit PAT repair in a PAT-capable composition only |

Unknown/mismatched decisions fail closed. Recovery is single-flight per client.
Same-account repair preserves drafts; changed/previously unknown identity clears
browser data and reloads. Stale responses and late login completions are rejected.
Enrollment applies the same boundary for changed email. Only GET/HEAD can replay
automatically, once after session recovery for the same account; `{safeRead: false}`
disables that too. Writes, backend denials and observer errors never replay.

PATs are required only when the live Azure DevOps backend is selected. Enrollment
and User Management require a PAT for each new live-ADO account. Selecting live
ADO also activates this requirement for existing accounts. The server checks
the submitted PAT against the configured organization before saving it. Missing
and rejected credentials return HTTP 400 `pat_required` or `pat_invalid` without
creating an account, rotating its account key, or overwriting its stored PAT.
Validation outages return HTTP 503 `backend_unavailable` instead.

Only operations that need Azure DevOps request credentials. Local updates,
including account-key resets and permission changes, do not require a valid PAT.
The credential policy owns PAT acquisition and withholds missing or rejected
credentials without blocking cached reads. Actual ADO operations return HTTP 403
`pat_required` or `pat_invalid` through the central backend error handler.
Both frontends post a deduplicated
notification with an action to open the cancellable **Set your Azure DevOps PAT**
dialog. The failed request does not wait for repair or replay after it. Account
identity, enrollment, session renewal, credential configuration, sign-out,
account deletion and authorized local administration remain reachable. Remote
administration operations still require the acting account's credential. A PAT
rejection does not send an authenticated user back to enrollment.

Saving, updating and deleting views, scenarios, groups, local events and local
event categories do not require or load a PAT, including when live ADO is the
work-item backend and the account's PAT is missing or rejected. Session, ownership
and validation checks still apply. Wiki-backed events retain their credential
requirement independently of local event storage.

Browse calls, administration and request-triggered cache refreshes use only the
acting account's PAT. Failed background refreshes retain the shared snapshot and
report credential failures only to the initiating account. Another user's valid
credential is never borrowed. PATs are encrypted at rest, entered in masked
fields, and never persisted in browser preferences or exposed in error messages.

## Code Ownership

`EnrollmentLoginAdapter`/`BrokerLoginAdapter` establish identity; `SessionManager`
validates UUID, source, epoch and device/binding once per request. Remote consumers
use `PatCredentialPolicy`/`DelegatedCredentialProvider`; local/static/mock work does
not acquire user credentials. `AccountManager` owns PAT storage and comparison-based
rejection so failures cannot reject a replacement PAT. Azure authentication selects
Basic/Bearer by explicit kind, never token syntax. `BackendAuthError` carries the
operation credential to the central HTTP handler. Both REST providers share
`createAuthRecovery`; original errors and partial results remain available.

## Delegated administration

Administrators grant independent permissions in **Admin > Users** by selecting an
email address or selecting accounts and choosing **Edit permissions**. Bulk edits
use **Keep unchanged**, **Grant**, and **Revoke** for each permission, followed by
a review of the affected accounts. Saves occur per account, not as one atomic
operation; failed accounts remain selected and are reported individually for retry.
Create a regular account first, then select the required grants;
existing accounts need no re-enrollment. Users open `/admin/` with their normal
browser session and see only permitted sections. The top-bar settings gear has
a dropdown chevron. Its **Administration** group lists the screens the account
can access and opens the selected screen directly. Administration keeps the shared
top bar with a **Planner** link back to the user application. Personal settings
remain available through **Settings > Configuration** in either application.

| Permission | Editable configuration |
| --- | --- |
| `manage_projects` | Projects, container levels, allocation availability and project iteration-set associations |
| `manage_workforce_teams` | Teams, groups, staffing composition and confirmed team deletion |
| `manage_workforce_costs` | Suppliers, profiles, monthly project hours and hourly rates |
| `manage_iterations` | Iteration sets, backend iteration browsing and removal of project associations |

Grants apply installation-wide, not only to a user's own projects or teams. Project
management includes editing and archiving existing projects, not just adding them.
Combine grants when a user maintains several areas. Workforce delegates can read
the shared team/staffing/supplier catalogue, but writes to the other area are
rejected by the server. Project managers can read the catalogue and iteration sets
needed for project configuration. Backend browsing uses the current user's PAT.

Full `admin` access includes every grant. Only full administrators can manage
users or permissions, credentials and data sources, server/global settings,
plugins, area mappings, caches, reload utilities, backups and bulk workforce
import/export. Existing administrator protections remain in effect. Permission
changes are checked on each request; open pages may need reloading to update
navigation, but revocation immediately prevents subsequent unauthorized requests.
No data migration or additional account enrollment is required.

`GET /admin/check` returns `{ "ok": true, "permissions": [...] }` for an
administrator or delegate. Unauthenticated requests are rejected; an authenticated
delegate attempting another administration area receives HTTP 403.

## User activity and mailing lists

The Users screen lists each account once, including administrators. Search,
access views, and permission filters narrow the list. Permission filters use
effective access, so administrators match every delegated permission. Selection
can span pages; changing a filter clears the selection to prevent hidden edits.

**Mailing list** supports selected accounts, all matching accounts, or all users.
Addresses can be copied with semicolons or one address per line, or downloaded as
an email-only CSV. These operations do not send mail. Use BCC when distributing
mail to users who should not see one another's addresses.

The sortable **Last active** column shows the date of recorded authenticated
activity in the browser's local timezone; its tooltip contains the full timestamp.
The first click sorts oldest recorded activity first. Unknown dates remain last
in either sort direction. `GET /admin/v1/users` includes `lastActive` as Unix seconds,
or `null` when no activity has been recorded. Unknown history is displayed as
**Not recorded**, not evidence that an account has never been used.

New sessions and authenticated session reads update activity, including automatic
requests from an open browser. Updates are coalesced to at most once per minute.
This is not a measure of keyboard or mouse activity, nor an audit log. Tracking
begins with this release; historical dates are not reconstructed. Activity is
stored by account ID in `account_activity`, independently of expiring sessions.
Sign-out, access reset, and session expiry do not clear it; account deletion does.
Full filesystem backups preserve it; selective logical account exports do not
promise to preserve activity history. No account schema migration is required.

## Remembered browsers and sessions

Generated credentials contain 256 bits of randomness. The server persists only
their SHA-256 hashes, device IDs, and expiry dates in `account_auth`; plaintext
credentials are carried in HTTP-only, SameSite=Lax cookies. Session identifiers
are hashed in `auth_sessions`; records do not persist decrypted PATs. Browser
cookies are scoped to the installation's reverse-proxy root path.

Authenticated handlers share a request-local identity context, so session/device
idle-expiry updates occur once per request. Identity resolution itself never
loads or decrypts a PAT. The live-ADO policy checks the account credential before
protected data routes, excluding identity/configuration and authorized local
administration. Remote consumers resolve credentials through the provider using
the authenticated account UUID, never an identity supplied in the request body.
Neither identities nor decrypted PATs
are cached across requests or shared between users; later requests read current
credentials. Each server worker reuses only the Fernet cryptographic setup for
the configured encryption secret, replacing it if that secret changes. This does
not re-encrypt existing PATs when rotating the secret.

Local/static and mock work-item operations do not acquire account credentials,
including task reads, refreshes, publication, markers, history, and cost inputs.
Configured iteration snapshots are local reads. Sessions and permissions remain
required. ADO mocks retain the live client's credential validation, connection
lifecycle, and data-processing path, replacing only the SDK connection and its
responses. Mock composition supplies an explicit synthetic credential instead
of acquiring a user's PAT. Explicitly live project/wiki browsing and wiki-backed
events still use the acting account's credential independently of the selected
work-item backend.

With remote task caching enabled, all registered users are assumed authorized
for every configured project and share one complete task snapshot. A stale task
read or explicit task refresh may start a background job using that request's
credential. The credential exists only for the job lifetime; neither the PAT
nor the initiating account is persisted with the snapshot or refresh status.
There is no unattended scheduler or retained last-active-user credential.
Later requests resolve current credentials again. Application shutdown drains
active task refresh work before closing storage.

Before renewing cookies, middleware checks persisted session and device validity
again without decrypting the PAT or refreshing idle expiry. Revocation during a
handler therefore prevents cookie renewal.

The board fetches missing plans' baseline groups in one request and deduplicates
in-flight group loads within that browser application. Only requested plans enter
the cache; already-loaded plans and unsaved local groups are preserved. Plan
deselection, publishing refreshes, and account changes invalidate older responses.
Sign-out, account deletion, and entry into enrollment clear the browser's group
cache. Browser instances do not share group caches or pending requests; baseline
groups on the server remain shared planning data.

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
non-cached `POST /api/auth/enrollment-status` reports `requiresKey` and `requiresPat`;
it does not enroll, issue credentials, or rotate a key. The modal shows Real name
for first enrollment, Account key for enrolled accounts, and a masked PAT field
when live ADO is selected.
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

Logical backups include the schema revision, not schema state or generation pointers.
They exclude PATs, account keys, remembered devices, sessions, authentication policy,
external links and grants. Credential-bearing or incompatible imports are rejected
before writes; live restore does not migrate historical formats.

Config, User accounts, Views and Scenarios can be selected independently. Leaving
**User accounts** unchecked preserves current accounts and credentials. Restored
enrollment accounts have fresh unknown key hashes and no devices: an operator must
issue new account keys, including for administrators. Entra account replacement is
rejected to protect established administrator identity links. Successful restore
clears active sessions, including config-only restore; rate limits remain in force.

Physical recovery is separate and may contain old credentials. Preserve the original
encryption key, isolate recovery and review revocation before exposing it. Logical
restore cannot revive old devices or keys. See [MIGRATIONS.md](MIGRATIONS.md).

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