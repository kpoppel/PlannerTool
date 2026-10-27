# Entra ID / Azure DevOps PoC

Copy this entire directory to the target machine. Nothing outside this folder is
needed: no Planner image, code, configuration, accounts, data, or Python environment.
Docker Engine with the Compose plugin is the only runtime prerequisite. Building
requires access to the container registry and Python package index. Running needs
outbound HTTPS to Microsoft Entra and Azure DevOps.

The PoC signs in individual users through MSAL authorization code flow with PKCE,
reads their ADO identity/projects, and tests token refresh. It never writes to ADO.
It is deployed at `/auth/`, with its single Entra callback at `/auth/callback`.
It is the starting point for a shared token service; the instance-facing API,
secure handoff, encrypted persistent storage, and service authentication are not
implemented yet. Planner instances are not connected to this PoC.

## 1. Get the registration and hostname

Use your configured server hostname, for example `planner.example.com`, resolving
from users' browsers. The `/auth/` path can share the hostname with other Planner
instances. In the tenant connected to the ADO organization:

1. Register a **single-tenant Web application**.
2. Register the exact callback `https://planner.example.com/auth/callback`.
   Substitute your actual hostname. Leave implicit grants/public-client flows off.
3. Add **Azure DevOps > Delegated permissions > user_impersonation** and obtain
   consent according to tenant policy. No Graph or app-only permissions are needed.
4. Get the tenant ID, application/client ID, and a short-lived client secret
   **value**, not its ID. Assign test users if enterprise app assignment is required.
5. Users must already have ADO organization access. Do not add an ADO service user.

The client secret authenticates the client during token exchange; ADO requests
still execute with each signed-in user's delegated access token and permissions.
Use Entra work/school accounts; personal Microsoft account support is not in scope.

## 2. Configure the copied folder

On the server, in this directory:

```bash
cp .env.example .env
chmod 600 .env
mkdir -p certificates
```

Edit `.env` with your hostname (no scheme, port, or path), tenant/client GUIDs,
and ADO organization name (not its URL). The callback is derived from the hostname.
`POC_BACKEND_PORT` is a loopback-only diagnostic port; it is not the public port.
Keep real hostnames, tenant/client IDs, organization names, and credentials only
in ignored local configuration, not in tracked examples, tests, or documentation.
The committed examples use reserved example domains and dummy values.

Store the secret directly in a file without putting it in shell history:

```bash
umask 077
read -rsp 'Entra client secret: ' secret
printf '\n'
printf '%s' "$secret" > entra-client-secret
unset secret
```

Compose mounts this file as a Docker secret. Do not put it in `.env` or send it in
chat. Secret/configuration/certificate files are excluded from Git, and only the
app and dependency file enter the image build context. Protect the copied folder
and backups. Docker administrators can access container secrets.

## 3. Select how HTTPS is served

### Option A: Dedicated Caddy with Let's Encrypt

Use this if ports 80 and 443 are free on the target machine:

```bash
docker compose --profile https up -d --build
```

Leave `CADDY_CONFIG=Caddyfile`. Caddy obtains and renews a trusted certificate and
redirects HTTP to HTTPS. This stock image uses HTTP/TLS-ALPN ACME challenges:
public DNS and required inbound connectivity must support validation. An
internal-only hostname/server needs an IT-provided certificate (Option B), or a
separately configured DNS-01-capable Caddy build. No public app exposure is needed
when using your company's certificate and internal DNS.

Caddy certificate/account state persists in named volumes. Do not delete these
volumes during routine restarts. Do not enable request/body logging on the callback.

### Option B: Dedicated Caddy with a company certificate

Put the matching PEM certificate chain and unencrypted server private key at:

```text
certificates/fullchain.pem
certificates/privkey.pem
```

Protect the key with restricted host permissions and set
`CADDY_CONFIG=Caddyfile.company` in `.env`, then run:

```bash
docker compose --profile https up -d --build
```

The certificate must match your hostname and be trusted by test users' browsers.
IT must arrange renewal; Caddy does not renew manually supplied certificates.
This TLS certificate is separate from the Entra client secret used by the app.

### Option C: Keep the server's existing Caddy

If Caddy already owns ports 80/443, **do not start this folder's `https` profile**:

```bash
docker compose up -d --build
```

For a Caddy process running directly on the same host, add this route to its
existing HTTPS hostname site, before catch-all handlers:

```caddyfile
redir /auth /auth/
handle_path /auth/* {
    reverse_proxy 127.0.0.1:8767
}
```

Use your actual hostname and backend port. For an IT-supplied certificate, add
the appropriate `tls /path/to/fullchain.pem /path/to/privkey.pem` directive there.

For **Caddy running in Docker**, localhost means the Caddy container, not this
backend. Connect that Caddy container to the PoC's network instead:

```bash
docker network connect entra-id-poc YOUR_EXISTING_CADDY_CONTAINER
```

Then use `reverse_proxy entra-id:8000` inside the `/auth/*` handler. To retain that network
membership across container recreation, declare the `entra-id-poc` network as
external in the existing Caddy Compose setup and attach its service to it. Preserve
all existing Planner routes. Validate and reload Caddy using its normal procedure.

The existing deployment's bare `:80` Caddy site is not sufficient: add the HTTPS
hostname site and ensure its container publishes port 443 and persists TLS state.

## 4. Check the deployment

Open `https://YOUR_HOSTNAME/auth/`, then:

1. Sign in, complete tenant MFA/consent, and return to the HTTPS PoC.
2. Check the Entra tenant/object identity, then **ADO identity** to see the actual
   ADO authenticated and authorized users returned by `connectionData`.
3. Open **Projects** for the first 100 visible projects.
4. Use **Refresh token** to exercise refresh rather than reuse the access token.
5. Repeat in a separate browser profile as another user; compare identities and
   permissions. Signing out of one profile must not sign out the other.
6. Exercise revocation/Conditional Access with IT. Reauthentication must be
   required when renewal fails, with no substitute credentials. Existing access
   tokens need not stop working immediately after revocation.

```bash
docker compose ps
docker compose logs --tail=50 entra-id
docker compose --profile https logs --tail=50 caddy
```

Rebuild/recreate with the same startup command after app/configuration changes.
To stop the bundle: `docker compose --profile https down` (preserves TLS volumes).
Avoid `down -v` unless intentionally deleting Caddy's saved certificates/state.

If registration redirects do not match, check the actual public HTTPS hostname
and registered callback, not the internal HTTP backend port. This standalone
Compose setup serves the PoC only under `/auth/`, independently of Planner instance
paths. The configured callback is `https://YOUR_HOSTNAME/auth/callback`.

## Security and PoC boundaries

- HTTPS uses `form_post` callbacks. A temporary HttpOnly `SameSite=None; Secure`
  cookie binds the browser to MSAL's state/nonce/PKCE data. Successful sign-in
  rotates the ID and uses `SameSite=Lax; Secure` for the authenticated session.
- Callback forms are bounded and single-use. No access/refresh tokens are exposed
  to browser storage or HTML. Proxy headers cannot choose the callback origin.
  POST commands check the configured public origin. Host checking and cookie
  scope are derived from the configured callback.
- MSAL uses `https://app.vssps.visualstudio.com/.default` plus its OIDC/offline
  scopes. Tokens are opaque; the PoC does not parse ADO access tokens.
- Each browser has an independent in-memory client/cache. Pending logins last
  10 minutes; signed-in sessions one hour. Expired entries are purged on later
  requests. Restart clears all sessions. Run one app instance/worker only.
- Sign-out discards the local session; it does not globally sign out Microsoft
  or revoke previously issued tokens. Refresh/policy failures require sign-in.
- No persistent token cache, automated claims-challenge handling, certificate
  client authentication, or Planner account migration is included.
- This is a diagnostic PoC, not a hardened production authentication service.
  Restrict access to the test audience through network and Entra assignment policy.
- Reads verify identity/access, **not write audit attribution**. A later approved
  write against a disposable work item is needed to verify Changed By/history.

## Existing Docker Caddy route

Inside the existing HTTPS hostname site, use:

```caddyfile
redir /auth /auth/
handle_path /auth/* {
    reverse_proxy entra-id:8000
}
```

Place this before other catch-all handlers and retain the existing Planner routes.
The app derives its `/auth/` public links and cookie path from the configured
callback. Caddy strips `/auth` before proxying; the app's internal callback route
is `/callback`, so the public URL is `/auth/callback`, not `/auth/auth/callback`.
There is no per-instance Entra callback in this target design. A future token
service must register and authenticate allowed Planner clients itself.

## Local Python development and tests

These commands run entirely inside this folder, even after copying it away from
PlannerTool:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
```

Tests mock Entra/ADO, including an actual MSAL PKCE/state test with offline
metadata. No credentials or Microsoft network calls are required by the tests.

To run the PoC without an app registration, start its local-only authentication
and ADO fixtures:

```bash
ENTRA_AUTH_MODE=mock \
ENTRA_REDIRECT_URI=http://localhost:8766/auth/callback \
ENTRA_LISTEN_PORT=8766 \
.venv/bin/python app.py
```

Open `http://localhost:8766/auth/` and use **Sign in with mock identity**. This
mode uses fixed test `tid`/`oid` claims and a deliberately invalid mock access
token; its ADO identity and project responses are local fixtures. It never calls
Entra or Azure DevOps, and it refuses non-localhost callback/listener settings.
The default `ENTRA_AUTH_MODE=entra` continues to use MSAL and real ADO requests.

For direct Python launch, export `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
`ADO_ORGANIZATION`, `ENTRA_CLIENT_SECRET_FILE` (or `ENTRA_CLIENT_SECRET`), and
`ENTRA_REDIRECT_URI`, then run `python app.py`. Direct Python execution does not
read `.env`; that file is consumed by Docker Compose. `ENTRA_LISTEN_HOST` defaults
to `127.0.0.1`; HTTPS mode's internal port defaults to 8765 and can be overridden
with `ENTRA_LISTEN_PORT`. For local HTTP development only, an explicit
`http://localhost:8766/auth/callback` is allowed and derives its listening port.
Open `http://localhost:8766/auth/` when running that local configuration.
Local HTTP uses query callbacks with non-Secure cookies; access logging stays off.

## Microsoft references

- https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow