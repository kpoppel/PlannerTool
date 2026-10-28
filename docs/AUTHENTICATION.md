# Authentication

PlannerTool uses the deployment-selected login adapter and credential policy.
The authentication service owns its upstream provider, identity verification and token renewal.
PlannerTool consumes a provider-neutral broker contract, not provider-specific identity claims.
PlannerTool does not seed demo accounts, require empty storage, install network
isolation, replace ADO settings, or purge PATs and enrollment records on startup.

A deployment may start from a physical copy of server data. Preserve its encryption
key when copied credentials must remain readable. Changing the deployment login
source advances the authentication epoch once, invalidating old-source sessions
without deleting accounts, permissions, saved user data, or stored credentials.
Subsequent restarts with the same login source do not advance the epoch.

Credential consumers use typed PAT or Bearer credentials from the policy/provider.
The auth service's `fixture` token type marks fake Bearer authority. The credential
provider rejects it immediately with HTTP 403 and `ado_credential_unusable`, before
invoking any ADO fetch or SDK connection. The notification explains that the token
is fake and no ADO request was sent. Local login and work remain available; an
existing task snapshot can be returned with the same warning. This decision does
not prompt for login or replay the operation. Backend and organization configuration
remain unchanged. Broker mode does not determine credential validity.

Verified identities use a trusted broker issuer and opaque subject. A new identity
gets an unprivileged account, except that the first verified account on a genuinely
empty live installation becomes administrator. Restrict access during initial setup.
At first live activation, PlannerTool snapshots existing accounts as eligible for
one-time email claims. A validated Entra ID token's `email` claim may claim a matching
eligible account, preserving its UUID, permissions and owned data. Later-created
accounts are never added to this snapshot. Matching is case-insensitive; a claim
is consumed permanently and subsequent sign-ins use issuer/subject, not email.

If Entra omits `email`, PlannerTool creates a separate account with an empty contact
email. Configuration offers **Existing account email > Link account** while legacy
accounts remain eligible. The user-confirmed action moves the fresh external identity
and its saved views/scenarios into the existing account, keeps the destination UUID
and permissions, ends old source-account sessions and reloads the tool. A data-key
collision rejects the entire merge rather than overwriting either account's data.

This manual migration claim deliberately requires only the entered email, not proof
of the old account. Any signed-in Entra user who knows an eligible account's email
can claim it, including an administrator account. This is an explicitly accepted
migration policy, not email verification. Restrict the enterprise application's
audience until migration is complete. Already-linked accounts cannot be claimed or
reassigned, and changes to an identity's email cannot move an established link.

Mock sign-in deliberately allows entering an existing account email, including an
administrator's, and reuses that account's UUID, permissions and saved data. The
broker explicitly marks this sandbox-only assertion; PlannerTool rejects it outside
mock mode. Unknown mock emails create unprivileged accounts. Never expose this
impersonation mechanism as production authentication.

Revision 44 is the single upgrade from dev. It initializes authentication policy
and external identity metadata and expires pre-policy sessions, preserving accounts,
permissions, PATs, enrollment credentials and user data. Broker metadata is pinned
to its public URL, upstream mode and protocol; each instance has its own protected
service secret and exact registered callback. Changing broker authority advances
the policy epoch and discards mock links before live account claims. Restarts with
unchanged authority do not advance the epoch. Intermediate branch formats and
transition journals are not supported.

PlannerTool uses generated browser credentials, not user-chosen passwords or
email verification. Each installation has independent accounts and credentials.

## Local Access and Remote Authority

PlannerTool accounts and permissions govern application access until account
removal by an administrator. Browser sessions still expire under the existing
PlannerTool rules. Reuse that expiry mechanism without adding an Entra-specific
application timeout or periodic directory-disablement checks.

Entra governs delegated ADO authority separately. ADO denial, expired credentials,
interaction requirements or broker unavailability must not invalidate an otherwise
valid PlannerTool session. Authorized cached/local work remains available; remote
operations report their failure without borrowing credentials or changing mode.
New Entra sign-in still needs the broker, and an expired application session cannot
use cached data merely because the account still exists.

Acquire/refresh ADO credentials on demand for active-user remote work, including
renewal during an already-running user job. Do not keep idle credentials alive
with scheduled refresh. Local/profile reads do not request an ADO token. Honor
issuer-provided token expiry; the expected one-hour IT setting is not a hardcoded
PlannerTool timer or a guaranteed disabled-account revocation bound. Renewal and
remote enforcement depend on tenant policy and MSAL outcomes. Local offboarding
remains an administrator's task.

The mock journey uses explicit fake credentials at the ADO boundary. Real Entra
registration, consent and upstream token acquisition are separate auth-service
responsibilities. Real-tenant acceptance remains required.

Expired or revoked local broker grants now report `interaction_required` without
deleting the PlannerTool session. Local account removal, logout, source/epoch
changes, invalid bindings and the existing idle/absolute session limits still
invalidate application access. `/api/auth/me` retains the local account and never
acquires an ADO token; known local grant expiry/revocation needs no broker request.

If credential acquisition for `GET /api/tasks` reports `interaction_required`,
`access_denied`, `auth_unavailable` or `ado_credential_unusable`, the API can return the existing complete
snapshot with HTTP 200 and the corresponding warning in `X-Backend-Diagnostics`.
This cache-only read neither starts remote work nor acquires another credential.
An empty snapshot is valid. If project configuration has changed, the last complete
snapshot remains readable with an additional configuration-change warning; it is
not treated as current configuration data for live reads or refreshes. A missing
snapshot preserves the original remote failure. Invalid sessions and configuration
errors do not enter this path. Writes and explicit remote refreshes remain
credential-gated, with no automatic write replay after recovery.

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

**Admin > Data Sources** shows an authentication mode selector only for the live
Azure DevOps backend. PAT remains active in enrollment installations; a connected
Entra deployment reports Entra as active. The production selector is disabled and
shows effective mode and broker readiness. Instance administrators cannot stage
or override deployment policy: `POST /api/auth/settings` returns HTTP 409 with
`deployment_policy_required`. Ordinary Save cannot change mode, epoch, sessions
or credentials. The injected preview remains only a test composition.

The component accepts a non-persisted `authenticationSettings` model containing
`activeMode` (`pat` or `entra`) and `activationUnavailableReason`. Tests can inject
synthetic settings without an authentication service. The production model reports
the effective mode outside an explicitly injected preview. Production models have
`deploymentControlled: true` and load non-secret `/api/auth/settings` readiness.
This operation never acquires an ADO access token.

Manifests require top-level `ado_authentication: disabled|pat|entra` and explicit
`auth_service` connections for instances that use the shared service. Neither
`backend` nor `authentication_provider` belongs in the instance manifest. Backend
selection comes from the instance's persisted Admin > Data Sources configuration.
The generator derives login wiring from the connection and deployment credential
policy: connected instances use Entra login under `entra`; otherwise enrollment
remains active. An Entra login can use a local backend without changing source,
epoch or sessions. Under PAT/enrollment, the application does not initialize a
broker login adapter or expose staged login and linking workflows.

Generated `PLANNER_ADO_AUTHENTICATION` constrains remote authority, not backend
selection. `disabled` rejects live ADO and remote wiki configuration; `entra`
requires a connected Entra login for either remote transport. These checks cover
startup, settings and import. Mock auth does not restrict backend selection;
fake credentials cannot enter live ADO transport. Regenerate deployments that previously set
`PLANNER_INSTANCE_BACKEND`; that duplicated backend setting is no longer accepted.

Mock upstreams can use the server's real DNS hostname over HTTPS. Set top-level
`https_hostname` and the matching auth-service `public_url` in the deployment
manifest. Caddy terminates TLS; application/broker traffic uses private Compose
service addresses. PlannerTool has no mock-specific network sandbox. HTTP is
allowed only for explicit localhost callbacks. Mock sign-in accepts an account
email and impersonates that local account, not production authentication. Restrict access to copied data
and retain the deployment's encryption key; never expose a mock-login deployment
as production authentication.

Logical backup excludes active authentication policy, PATs, enrollment keys,
devices, sessions, external links and grants. Imported
credential-bearing backups are rejected before writes. Restored enrollment
accounts receive fresh unknown key hashes and no devices, preventing public
claiming of privileged accounts; use an explicit operator reset to issue fresh
keys. Entra account replacement is rejected to preserve the destination's proven
admin links. Physical backups can still contain old credentials and require
separate offline recovery and revocation review.

### Authentication Presentation

Discovery supplies one shared client to planner and administration in broker mode;
enrollment/PAT installations retain their existing controls. Capabilities hide PAT
editing, remembered browsers, key resets and manual account creation in broker
mode. Component tests inject observable fixtures from `tests/helpers/mockAuth.js`;
fixtures are not shipped with application assets and cannot select a production
identity or policy.

### External Identity and Delegated Credentials

External links use a broker-authenticated `issuer` and opaque `subject`; PlannerTool
does not interpret the subject or decode tokens. The key hashes the structured
issuer/subject pair, so equal subjects from different issuers cannot collide.
Links are additionally pinned to the broker public URL, protocol and upstream mode.
A new verified identity receives a new account UUID and no permissions, subject to
the first-admin bootstrap and one-time legacy claims described above; its internal
account lookup key ends in `@identity.invalid`. Display/contact email and name
come from the verified identity link. Existing accounts retain their UUIDs and
permissions through one-time existing-account claims. The impersonation assertion
is accepted only from a configured mock broker.

The login handoff returns `{identity: {issuer, subject, name, email?}, grant,
expires_at}` inside the authenticated protocol envelope. The optional
`link_existing_by_email: true` identity field is reserved for mock deployments.
Browser discovery/profile responses use `mode: broker`; the generic Sign in control
does not choose or interpret the upstream provider. Existing deployment policy
names still select the connected broker without exposing its identity claims.

Backend credential requests name the resource (`ado` for the current ADO backend).
The broker returns `{resource, token_kind, access_token, expires_at}` in the same
environment-bound envelope. Only the matching resource and a fresh Bearer token
are accepted for live calls. Provider registration, MSAL, consent, refresh tokens
and provider claim mapping remain inside the auth service; new provider adapters
implement this contract without changing PlannerTool account linking.

`POST /api/auth/links/claim` accepts `{email}` from a same-origin authenticated live
broker session and implements the one-way existing-account merge described above.
There is no staged linking, unlink or reassignment API. Linking never changes
local permissions or bypasses final-admin deletion protection.

Each login owns a separate local binding and broker grant. Ordinary logout
revokes only that session/grant, including local revocation during broker outage.
Other sessions, instances and corporate SSO remain independent. Deleted accounts
cannot acquire or renew credentials; their external links are removed.

The selected delegated provider requires request-scoped identity plus the exact
session binding. Token acquisition validates broker URL, protocol, mode, resource,
credential kind and fresh-enough expiry. Credentials carry acting UUID, binding,
epoch, expiry and explicit fixture/live transport metadata; no refresh token is
accepted. Profile reads never acquire a token. SDK/wiki authentication selects
Basic or Bearer explicitly, and delegated SDK requests renew through the provider
without retrying an ADO denial. Failures retain the credential actually used.
Task refresh renews before building and checks account/grant/epoch under an
authoritative transaction before publishing its shared snapshot.

Credential probes belong to the test harness, not production HTTP routes. Fake
tokens are rejected during acquisition, including before wiki operations, without
credentials in responses.
The live SDK and wiki path reject fixture credentials before constructing a live
connection. Broker fixture `access_denied` returns 403 without revoking the grant;
interaction stays 409 and outage 503. No failure selects PAT or another grant.

Logical backups omit external links, sessions and broker grants; account
restore clears destination links and requires new identity proof. Cross-instance
link import is rejected. Physical operator recovery is independent of deployment
login selection. Live acceptance remains outstanding. Mock grant expiry is not
evidence of upstream account disablement.

The live broker now owns authorization-code flow with PKCE and encrypted durable
MSAL caches. HTTPS uses a browser-bound `form_post` callback; verified identities
must match the configured tenant, audience and issuer. Only a validated `email`
claim is used for automatic legacy claims; `preferred_username` is not substituted.
Delegated tokens are acquired on demand through MSAL, including renewal in active
jobs. Status/profile requests never refresh tokens. Each local broker grant has a
30-day maximum lifetime; local application session expiry remains independent.
Broker logout revokes its session-owned grant without signing out other sessions.
MSAL cache data and refresh tokens remain encrypted in the broker and never enter
the handoff or PlannerTool responses. Registration/consent, Conditional Access and
real ADO access/renewal still require tenant-backed acceptance.

### Frontend Adapter Contract

`www/js/services/authClient.js` owns the observable client and Entra HTTP adapter.
Clients expose `discover`, `status`, `signIn`, `completeLogin`, `recover`,
`handleDecision`, `saveSettings`, `logout` and `deleteAccount` alongside state and
subscriptions. The existing enrollment adapter retains the current session route
and enrollment dialog; discovery cannot activate a source. Both REST
providers accept the same explicitly injected `authentication` client. Their
enrollment/PAT composition retains the existing admin cookie behavior.

The following PlannerTool HTTP contract is exercised against the mock auth
service and covered by mocked frontend contracts. It is not the broker
protocol. URLs are relative to the instance API URL, including its subpath.

| Operation | Request | Successful response |
| --- | --- | --- |
| Public discovery | `GET /auth/config` | `{mode: 'broker', capabilities}`; no account or credential acquisition |
| Common profile/status | `GET /auth/me` | Client state, including UUID profile or `account: null`; no ADO token acquisition |
| Begin sign-in/reauthentication | `POST /auth/login/begin` | Browser transaction passed to the injected login presenter |
| Complete sign-in | `POST /auth/login/complete` | Client state; presenter supplies the browser-bound completion object |
| Instance logout | `POST /auth/logout` | Signed-out client state |

Entra profiles also return locally owned `permissions`. Logout includes the
boolean `revocation_pending`: local revocation is complete even if remote grant
cleanup failed. The browser displays a one-time instance-scoped cleanup notice;
the remote grant expires within its configured TTL. No grant/token is placed in
browser storage. Neither ordinary logout nor this notice logs out other instances
or corporate Entra.

### Normal UI Composition

`www/js/services/authStartup.js` discovers policy once per page/instance, reads
the initial profile, and shares one client with both REST providers. Normal
planner startup and the admin login page offer Entra sign-in; account Settings,
Users, Data Sources and top-menu PAT repair follow its capabilities. Entra local
preference saves do not call the unsupported PAT settings operation.

Sign-in opens a user-initiated popup. `X-Planner-Login-Target` accepts only `app`
or `admin` for this composition; the server records that target with the bound
transaction. The callback alone redeems the handoff and sends a CSP-protected
completion message containing only instance, state and error/success. The opener
checks its exact origin, window, instance and state, then reads status; it never
redeems the same code again. Without an opener, the callback returns to a fixed
instance-local app/admin destination. Closing/cancelling the popup does not
authenticate a user.

Same-account repair leaves the page and drafts intact. A different returning UUID
blocks stale provider responses, clears old-account browser data and reloads.
Authentication writes are never automatically replayed. An invalid local session
cannot read cached server data. An authenticated Entra user without local admin
permission receives 403, not a session-expiry recovery loop.

Discovery does not contact the broker. A valid local profile can report
`status: 'unavailable'` with its existing UUID and permissions during a broker
outage; local/admin access remains available. Begin/remote acquisition still fail
with typed errors. Local offboarding remains an administrator's task.

Enrollment profile PAT status uses existing stored presence/rejection metadata,
without acquiring or decrypting a PAT. Presence is not proof of token usability;
credential acquisition and remote validation remain separate operation boundaries.
No additional migration or session invalidation is introduced by this close-out.

State and discovery responses must declare broker mode; a PAT response is rejected,
not used as a fallback. Authenticated profiles require a string `uuid`. No token
is acquired, stored, logged or attached to browser requests by this client. The
HTTP adapter uses same-origin cookies and never retries its authentication writes.
The presenter returns `false` on cancellation, without completing login. Entra
PAT editing is rejected, and real Entra account deletion remains unavailable until
its policy is approved. Mock account deletion remains synthetic only.

Failures use `{error: code}` with these frozen frontend decisions:

| HTTP | Code | Permitted recovery |
| --- | --- | --- |
| 401 | `session_expired`, `invalid_session` | Login; safe reads may be retried once for the same account |
| 409 | `interaction_required` | Explicit reauthentication; no automatic login or request replay |
| 403 | `access_denied` | None; do not loop through login |
| 503 | `auth_unavailable`, `auth_configuration_error` | None; retry later or repair configuration |
| 403 | `pat_required`, `pat_invalid` | Explicit PAT repair in a PAT-capable composition only |

Unknown or mismatched HTTP auth decisions fail closed. Denial, interaction and
outage notifications preserve the local identity. Claims challenges and broker
secrets are not part of this browser contract.

Recovery is single-flight on the shared client, scoped by its instance, fixed
source and current account UUID. Same-account repair preserves drafts. A different
UUID, logout or sign-in from an unknown previous identity increments the generation,
blocks subsequent operations and invokes
the account-context invalidator before publishing the identity. Its default clears
PlannerTool browser data and reloads, discarding in-memory drafts. Tests inject an
explicit invalidator instead. Old in-flight responses and late login completions
are rejected. Startup initializes the client from its authoritative profile before
loading local work.
Enrollment currently receives email rather than UUID from existing routes; known
email changes use the same clear/reload boundary, and successful interactive
enrollment re-reads the profile before deciding whether a read may be replayed.
Sessions are bound to account UUID, login source and policy epoch.

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

## Authentication boundaries

Deployment selects enrollment/PAT or external broker login/delegated credentials.

| Boundary | Current owner and contract |
| --- | --- |
| Login and profile | `EnrollmentLoginAdapter` delegates enrollment, remembered-browser renewal, device/key management and profile projection to `AuthManager`. `EnrollmentSessionBinding` owns the persisted device binding used by session validation. |
| Identity and permissions | `SessionManager` persists hashed session IDs under `auth_sessions`; `get_session_context_from_request` resolves account UUID, email and device ID once per request. Permission checks remain request-scoped. No backend token belongs in this identity. |
| Remote credentials | `get_session_credential_from_request` and repositories use the selected `PatCredentialPolicy` or `DelegatedCredentialProvider` with the session UUID. Local/static/mock consumers do not request user credentials. |
| PAT policy and storage | `PatCredentialPolicy` selects the current requirement and handles credential rejection. `AccountManager` owns PAT validation, encryption, save and token-comparison rejection, so a failed operation cannot reject a replacement PAT. |
| Wire authentication | `planner_lib/azure/authentication.py` selects Basic or Bearer authentication for SDK and wiki clients from explicit `BackendCredential.kind`, without inferring kind from token syntax. |
| Backend failures | `BackendAuthError` retains operation credential/status context until the HTTP boundary in `main.py` maps it through the selected policy to existing public errors. Existing PAT 401/403 classification is unchanged. |
| Browser recovery | Both REST providers compose `createAuthRecovery` from `authRecovery.js`. `RestProviderBase` invokes injected callbacks, without importing enrollment or PAT dialogs. Injected clients share source/account-scoped recovery; PAT repair is notification-driven. |

PAT-specific public endpoints and UI may still use `pat_required`, `pat_invalid`
and PAT fields. Logical backup/restore and migrations also handle PATs explicitly;
they are persistence owners, not alternative live credential acquisition paths.
Wiki access can target an organization independently of the work-item backend.

Automatic session and network replay is restricted to GET/HEAD reads. An operation
can prohibit even read replay with `{safeRead: false}`; this option is stripped
before fetch. POST, PUT, PATCH and DELETE are never automatically replayed, even
after successful repair or an ambiguous network failure. Response/notification
observer errors cannot replay a completed operation. Original failure bodies and
partial-success results remain available for explicit reconciliation/resubmission.
PAT 403 repair and backend interaction/denial/outage never replay requests.

The login adapter establishes identity and issues a local session; the credential
provider supplies typed delegated ADO authority independently. Login-source changes
do not remove PATs. An arbitrary OIDC identity token is not an Azure DevOps access token.

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