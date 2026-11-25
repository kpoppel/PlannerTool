# Shared Auth Service

Define `instances.yml`, retain the installation's encryption key, then run
`python scripts/deploy.py --apply --start`. PlannerTool, optional shared auth and
Caddy run in one Compose project. The manifest owns hosting and auth policy;
**Admin > Data Sources** owns backend selection. Per-instance `backend` and
`authentication_provider` fields are rejected.

## Prerequisites

- Docker Engine, Compose plugin 2.20+, Git, Python 3.13 with `.venv` and
   `requirements.txt`. Docker access must not need interactive privilege escalation.
   Docker builds the frontend; host Node is unnecessary.
- Protected files readable by broker UID 1000: directories mode 0700, secrets 0600.
   Have an administrator provision ownership; do not broaden permissions.
- Client DNS resolving the chosen hostname and TCP 443 access to Caddy. Public
   ACME also needs public DNS and ports 80/443; private TLS options are below.
- A protected `deployment/.env` containing the retained `PLANNER_SECRET_KEY`.
   Generate a key only for a new installation; copied data needs its original key.
- Mock sign-in can impersonate administrators. Restrict its audience; never expose
   it as production authentication. See [authentication](AUTHENTICATION.md).

The examples below use the repository root as the working directory and
`BASE_PATH=./etc`: authentication material goes under `./etc/auth/` and TLS material
under `./etc/tls/`. Both directories are ignored by Git. On a hardened host, use
`BASE_PATH="$HOME/.config/plannertool"` or `BASE_PATH="/etc/plannertool"` instead.
If the base changes, replace the literal `./etc/...` values in YAML and env files;
those files do not expand shell variables or `~`.

## Configure and Start

Start from [docker/instances.example.yml](../docker/instances.example.yml), retaining
your instance names and storage/image settings. A shared mock example:

```yaml
https_hostname: planner.example.test
https_tls:
   mode: internal
ado_authentication: entra
auth_services:
   central:
      mode: mock
      public_url: https://planner.example.test/auth/
      volume_source: auth-central-state
      registration:
         tenant_id: 11111111-1111-1111-1111-111111111111
         client_id: 22222222-2222-2222-2222-222222222222
         organization: example
instances:
   - name: planning
     auth_service: central
```

Under `entra`, connected instances use broker login regardless of backend;
unconnected instances retain enrollment but cannot enable live ADO/wiki.
`pat` retains enrollment; `disabled` forbids remote ADO/wiki. Backend saves never
change login mode or sessions. From the repository root:

```bash
source .venv/bin/activate
python scripts/deploy.py --apply --start
```

First `--apply` creates `deployment/.auth/central/` with registration, registry and
distinct secrets. Dry-run writes nothing; later runs reuse authority and fail on
missing retained secrets. The manifest is never rewritten. Back up protected files
with all volumes. Deploy app, browser and broker together; startup applies the single
revision-44 upgrade from dev. Intermediate branch formats are unsupported.

### Live Entra Registration

For this deployment, prefer **Entra with a certificate**, followed by **Entra with
an application secret**, then **PATs**. The first two methods use the same Entra
application registration; select exactly one credential method below. PATs are
created in Azure DevOps and do not require an Entra app registration. These are
explicit choices, not automatic downgrade paths.

| Credential | Created by | Stored locally | Purpose |
| --- | --- | --- | --- |
| Entra application certificate | Your organization or OpenSSL | Public certificate PEM and private key PEM | Broker signs token-exchange assertions |
| Entra application secret | Entra app registration | File containing the secret **value** | Broker authenticates token exchanges |
| Azure DevOps PAT | Each user in Azure DevOps | Entered in PlannerTool's protected PAT field | That user's ADO requests in PAT mode |
| Broker encryption key | Deployment generator or local Python command | Fernet key file | Encrypts the broker's persisted token cache |
| Per-instance shared secret | Deployment generator or local Python command | A distinct secret file for each instance | Authenticates PlannerTool to the broker |
| Installation encryption key | Installation operator | Retained `.encryption_key` / `PLANNER_SECRET_KEY` | Encrypts PlannerTool credentials at rest |

Neither an application certificate nor an application secret is an ADO access token.
MSAL obtains and renews delegated tokens after users sign in; do not generate or
paste OAuth access/refresh tokens into the manifest. Users still need their own ADO
organization access. Application credentials do not enable app-only ADO access.

#### Common Entra App Registration Steps

1. Open the **Microsoft Entra admin center**, select the tenant connected to your
   Azure DevOps organization, then **App registrations > New registration**.
2. Enter a recognizable name, choose **Accounts in this organizational directory
   only**, and add a **Web** redirect URI. For Compose, use the exact
   `https://planner.example.test/auth/callback`, replacing the hostname. For local
   development, use `https://localhost:5174/auth/callback`. Add both only when the
   same registration is deliberately used in both environments.
3. Register the application. From **Overview**, record **Directory (tenant) ID**
   and **Application (client) ID**. Use these GUIDs, not the application object ID.
4. Under **API permissions > Add a permission > APIs my organization uses**, find
   **Azure DevOps**, choose **Delegated permissions > user_impersonation**, then
   **Add permissions**. Obtain administrator consent when tenant policy requires it.
   Do not add Graph or application permissions for this integration.
5. Under **Authentication**, retain the exact Web callback and leave implicit grants
   and public-client flows disabled. Restrict the enterprise application's audience
   during initial rollout and account claiming.
6. Choose **Method A** or **Method B** below. In the manifest set `mode: entra`,
   use the tenant/client GUIDs above and the ADO organization name, not its URL.

#### Method A: Certificate (Recommended)

Use an RSA certificate and matching **unencrypted PEM private key**. The examples
below require OpenSSL 3 and run on the machine that will retain the private key.
Do not use the Caddy/localhost HTTPS key for this purpose.

1. Create a new protected directory under `./etc/auth/` and generate a 3072-bit RSA
   key. Run this once; `mkdir` intentionally fails if the directory already exists,
   so do not rerun it over retained credentials. To keep these files outside the
   checkout, set `BASE_PATH` to a protected path under `$HOME` or system `/etc`.
   Stop on any command failure.

```bash
umask 077
BASE_PATH=./etc
AUTH_DIR="$BASE_PATH/auth"
mkdir -p "$(dirname "$AUTH_DIR")"
mkdir -m 700 "$AUTH_DIR" && \
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
   -out "$AUTH_DIR/entra-private-key.pem"
```

2. Obtain the public certificate using **one** of these routes. Follow your
   organization's certificate policy. Entra supports an explicitly uploaded
   self-signed application certificate; it does not need browser/HTTPS trust.

For a self-signed certificate valid for one year:

```bash
openssl req -new -x509 -sha256 -days 365 \
   -key "$AUTH_DIR/entra-private-key.pem" \
   -subj '/CN=PlannerTool Entra client' \
   -out "$AUTH_DIR/entra-certificate.pem"
```

For an organization-issued certificate, generate a CSR instead:

```bash
openssl req -new -sha256 -key "$AUTH_DIR/entra-private-key.pem" \
   -subj '/CN=PlannerTool Entra client' -out "$AUTH_DIR/entra-request.csr"
```

Submit only the CSR to your certificate authority. Request a signing-capable RSA
certificate according to its policy, and place the returned **leaf certificate in
PEM format** at `$AUTH_DIR/entra-certificate.pem`. Never submit the private key.
If the returned certificate is binary DER, convert it with:

```bash
openssl x509 -inform DER -in issued-certificate.cer \
   -out "$AUTH_DIR/entra-certificate.pem"
```

3. Protect the files and inspect the public certificate's dates and fingerprint:

```bash
chmod 600 "$AUTH_DIR/entra-private-key.pem" "$AUTH_DIR/entra-certificate.pem"
openssl pkey -in "$AUTH_DIR/entra-private-key.pem" -check -noout
openssl x509 -in "$AUTH_DIR/entra-certificate.pem" -noout -subject -dates -fingerprint -sha256
```

Check that these two public-key hashes match before continuing:

```bash
openssl pkey -in "$AUTH_DIR/entra-private-key.pem" -pubout -outform DER | openssl dgst -sha256
openssl x509 -in "$AUTH_DIR/entra-certificate.pem" -pubkey -noout \
   | openssl pkey -pubin -outform DER | openssl dgst -sha256
```

4. In your app registration, open **Certificates & secrets > Certificates > Upload
   certificate** and upload only `entra-certificate.pem`. Confirm its expiry and
   registration. Never upload the private-key file. The portal may display a SHA-1
   thumbprint; do not copy it into configuration. MSAL calculates SHA-256 itself.
5. Configure the two file paths below. The paths are relative to the manifest. If
   `BASE_PATH` was changed, use the corresponding literal absolute or relative paths;
   YAML values do not expand `$AUTH_DIR` or `~`. For Docker, have an administrator
   provision broker UID 1000 access to protected files/directories without broadening
   permissions. For direct local development, the current user owns the files.

```yaml
registration:
   tenant_id: 11111111-1111-1111-1111-111111111111
   client_id: 22222222-2222-2222-2222-222222222222
   organization: example
   client_certificate_file: ./etc/auth/entra-certificate.pem
   client_certificate_key_file: ./etc/auth/entra-private-key.pem
```

Paths may be absolute or relative to the manifest. MSAL derives the SHA-256 certificate
thumbprint and signs short-lived client assertions locally. The private key remains
on the broker; only the public certificate and signed assertion reach Entra. This
application credential is separate from the Caddy/localhost HTTPS certificate.

If your organization supplies a PKCS#12/PFX bundle instead of separate PEM files,
extract the public certificate and unencrypted private key into a new protected
directory. OpenSSL prompts for the bundle password; enter it directly in the terminal,
never in command arguments or chat:

```bash
umask 077
openssl pkcs12 -in supplied-certificate.pfx -clcerts -nokeys \
   -out "$AUTH_DIR/entra-certificate.pem"
openssl pkcs12 -in supplied-certificate.pfx -nocerts -noenc \
   -out "$AUTH_DIR/entra-private-key.pem"
chmod 600 "$AUTH_DIR/entra-certificate.pem" "$AUTH_DIR/entra-private-key.pem"
```

Use an RSA bundle, protect the original PFX too, and perform the same key-match,
upload and path-configuration steps above. The broker expects PEM paths, not a PFX
path or a private-key passphrase setting.

Monitor certificate expiry. To rotate, upload the replacement public certificate
first, update the local certificate/key files and redeploy/recreate the broker, then
verify sign-in and delegated token renewal before removing the old registration.
Keep broker encryption and per-instance keys unchanged during credential rotation.

#### Method B: Application Secret

This remains a fully supported alternative to certificates. Complete the common
Entra registration steps above, then:

1. Open **Certificates & secrets > Client secrets > New client secret** in the app
   registration. Enter a description and choose the shortest practical lifetime
   allowed by your organization's policy, then select **Add**.
2. Copy the new secret's **Value** immediately to your approved secret store. It is
   shown only once. **Secret ID** is not a credential and will not work. Do not
   generate a random local string instead: the value must come from Entra.
3. On the broker host, store the value in a protected file. From the repository root
   with `.venv` activated, the following commands prompt without echoing the secret
   or putting its literal value in shell history. File creation refuses to overwrite
   an existing secret. Use a new directory and stop if any command fails:

```bash
umask 077
BASE_PATH=./etc
SECRET_DIR="$BASE_PATH/auth"
mkdir -p "$(dirname "$SECRET_DIR")"
mkdir -m 700 "$SECRET_DIR"
python -c 'from getpass import getpass; from pathlib import Path; import sys; Path(sys.argv[1]).open("x").write(getpass("Entra client secret Value: ") + "\n")' "$SECRET_DIR/client-secret"
chmod 600 "$SECRET_DIR/client-secret"
```

Run without shell tracing (`set -x`), terminal recording or shared screen capture.
For Docker, provision broker UID 1000 access as described for certificate files.

Configure the secret file, with **neither** certificate field present:

```yaml
registration:
   tenant_id: 11111111-1111-1111-1111-111111111111
   client_id: 22222222-2222-2222-2222-222222222222
   organization: example
   client_secret_file: ./etc/auth/client-secret
```

Replace the example path with the actual protected file path. For a direct broker
or local development launch, use `ENTRA_CLIENT_SECRET_FILE=./etc/auth/client-secret`
and remove both `ENTRA_CLIENT_CERTIFICATE_*` entries. Direct launch also supports
`ENTRA_CLIENT_SECRET`, but never set it together with `ENTRA_CLIENT_SECRET_FILE`;
prefer the file so the value is absent from env files and process environments.

Before expiry, create a second secret in Entra, replace the protected file and
redeploy/recreate the broker. Verify sign-in and renewal before deleting the old
secret in Entra. Do not rotate broker encryption or per-instance keys along with it.

#### Start and Verify Either Entra Method

Never configure both credential methods. Never put private keys or secret values
in YAML, history, chat or source control. The generator mounts credentials only
into the broker; it does not generate live Entra credentials. Allow broker outbound
HTTPS to Entra and PlannerTool HTTPS to ADO.

Rerun the ordinary deployment command after editing registration. No manual migration
or source change is required. Restrict initial access: the first verified account on
empty data becomes admin; existing accounts follow the one-time email claim policy
in [Authentication](AUTHENTICATION.md). Offline tests do not prove consent, tenant
policy or real ADO renewal; validate those with a limited audience before cutover.

### PAT Authentication (No Entra App Registration)

Use this method only when deployment policy permits PATs. It does not configure a
client secret or certificate on the Entra broker.

1. Set top-level `ado_authentication: pat` in the manifest. For a PAT-only deployment,
   omit `auth_services` and each instance's `auth_service`/`auth_client_secret_file`
   settings. Redeploy with the ordinary command.
2. In Azure DevOps, open **User settings > Personal access tokens > New Token**.
   Select the correct organization, a recognizable name and a short expiry. Grant
   only the scopes required by enabled operations: **Work Items (Read)** for reading
   boards and **Wiki (Read)** for reading wiki content; grant write permissions only
   when you intend to use corresponding publishing/editing operations. Tenant policy
   may restrict PAT creation or allowed scopes.
3. Create the PAT and retain its value in your approved secret store immediately;
   Azure DevOps shows it only once. A PAT is issued by Azure DevOps, not generated
   with OpenSSL, and is not an Entra client secret or a PlannerTool account key.
4. Enroll/sign in to PlannerTool. The administrator selects the live Azure DevOps
   backend and organization in **Admin > Data Sources**. Each user supplies their
   own PAT in the masked enrollment or account-configuration field when requested.
   Do not put PATs into the manifest, shared broker files or another user's account.
5. Verify an ADO refresh and any enabled publishing operations. Before PAT expiry,
   create a replacement in Azure DevOps, update that user's PlannerTool configuration,
   verify access and revoke the old PAT.

PATs are encrypted at rest using the installation's retained `PLANNER_SECRET_KEY`.
PAT mode uses PlannerTool enrollment/account-key login, not Entra browser login.

## Access From Your Computer

Browse to `https://planner.example.test/planning/` using your hostname/instance.
`public_url` must match `https_hostname`; Caddy alone publishes ports and terminates
TLS. Internal-CA clients must trust the exported root. Apps/broker use private Compose
DNS. Plain HTTP is limited to explicit `http://localhost:PORT/auth/` loopback ingress.

Mock login accepts an account email without seeding accounts/data; fake credentials
are rejected before ADO/wiki calls, preserving local/cached work. Live login redirects
to Entra. Both return to the originating instance; logout affects only that session.

## Verify and Operate

After generating Compose configuration and building/pulling the selected image, you
can validate broker credentials without starting its HTTP listener or opening its
token store. Substitute your auth service name and retain any normal `--env-file`
or `--project-name` options:

```bash
docker compose --project-directory deployment run --rm --no-deps auth-central python app.py --check
```

This uses the same mounted certificate/key or secret files and the same non-root
UID 1000 as normal broker startup. It reports the selected credential method, not
credential contents. Normal startup performs these checks too: complete credential
selection, nonempty protected files, valid PEM encoding, matching RSA keys of at
least 2048 bits and current certificate dates. The broker image runs Python from
`/opt/venv`; both broker and application images require their own dependencies.

For `requires mode 0600`, restrict the named file's permissions. For unreadable
files, ask the installation administrator to provision UID 1000 ownership/access
to the file and its parent directories; do not make secrets world-readable or run
the broker as root. Convert PFX to PEM using Method A before configuring certificate
paths. A mismatch requires the private key corresponding to the uploaded certificate;
an expired certificate requires registration and deployment of a replacement.

From the repository root on the server:

```bash
docker compose --project-directory deployment ps
curl --fail --silent --show-error https://planner.example.test/auth/v1/readiness
```

Readiness reports local configuration (`ready: true`, expected `upstream_mode`),
not Microsoft connectivity or consent. `--start` waits for Compose; check HTTP
separately. Diagnose with `logs --tail 100 auth-central planner-planning caddy`,
substituting service names. Use `config --quiet`; never publish secrets or unredacted
Compose configuration.

For updates, retain manifest, protected files, project name, ports and volumes;
pull reviewed code and rerun deployment. Stop safely with
`docker compose --project-directory deployment stop`; resume through deployment.
Never delete protected files, rotate retained keys or use `down -v` routinely.

# How to deploy the application for production or development

## Local Development With Entra ID

The ordinary `./scripts/run_dev.sh` retains the PAT/enrollment workflow. To connect
the source-reloading backend and Vite to a local broker, use
`./scripts/run_dev.sh --auth-env ./etc/auth/dev-auth.env`. This trusted shell
env file is sourced and must have no group/other permissions (`chmod 600`). Install
both the root and `entra-id/requirements.txt` dependencies in the active `.venv`.
Never put private keys or client secrets in chat, tracked files or command history.

The launcher always uses the repository's `.venv/bin/python`, even if another Python
is on your shell's `PATH`. If prerequisites are missing, run `scripts/setup-dev.sh`
for the ordinary development environment, then install the broker requirements in
that environment:

```bash
.venv/bin/python -m pip install -r entra-id/requirements.txt
./scripts/run_dev.sh --help
```

For live Entra, provision a browser-trusted localhost TLS certificate/key (for example
with an already installed local CA tool). Register the exact **Web** redirect URI
`https://localhost:5174/auth/callback`, delegated Azure DevOps `user_impersonation`
permission and tenant-required consent. Use a separate app registration or add this
URI to the existing registration. Keep implicit and public-client flows disabled.

Create protected `auth` and `tls` directories. Provision distinct random per-instance
and broker encryption keys in mode-0600 files. The instance key must contain at least
256 bits of random material (43 URL-safe base64 characters); the broker key must be
a Fernet key. Compose `--apply` generates these internal keys automatically; the
following manual generation is only for direct/local development. From the repository
root, activate the existing virtual environment, then run once for a **new** local
broker:

```bash
source .venv/bin/activate
umask 077
BASE_PATH=./etc
DEV_AUTH_DIR="$BASE_PATH/auth/dev"
DEV_TLS_DIR="$BASE_PATH/tls/dev"
mkdir -p "$BASE_PATH/auth" "$BASE_PATH/tls"
mkdir -m 700 "$DEV_AUTH_DIR"
mkdir -m 700 "$DEV_TLS_DIR"
python -c 'from cryptography.fernet import Fernet; from pathlib import Path; import sys; Path(sys.argv[1]).open("x").write(Fernet.generate_key().decode() + "\n")' "$DEV_AUTH_DIR/broker-key"
python -c 'import secrets; from pathlib import Path; import sys; Path(sys.argv[1]).open("x").write(secrets.token_urlsafe(32) + "\n")' "$DEV_AUTH_DIR/instance-secret"
```

Stop on errors. Exclusive creation (`"x"`) refuses to overwrite an existing key.
Generate a different instance-secret file for every additional instance. Keep the
broker key, instance secrets and original installation encryption key across
restarts; none is an Entra application credential. Keep the broker's database inside
the mode-0700 directory too. Do not regenerate keys to repair a failed login.

Choose the application credential independently: follow **Method A** above to
generate/register a certificate and key, or **Method B** to create an Entra-issued
secret value. Place the browser-trusted localhost certificate and key at
`./etc/tls/dev/localhost.pem` and `./etc/tls/dev/localhost-key.pem`. The env example
below uses Method A and the documented `./etc` base. If you selected a different
`BASE_PATH`, replace these paths consistently. Replace registration values locally
and protect the trusted env file with `chmod 600`:

```bash
DATA_DIR=./etc/auth/dev/planner-data
PLANNER_DEV_BACKEND_PORT=8002
PLANNER_AUTH_PROVIDER=entra
PLANNER_ADO_AUTHENTICATION=entra
PLANNER_AUTH_INSTANCE=dev
PLANNER_AUTH_URL=http://localhost:8765/auth/
PLANNER_AUTH_PUBLIC_URL=https://localhost:5174/auth/
PLANNER_AUTH_UPSTREAM_MODE=entra
PLANNER_AUTH_SECRET_FILE=./etc/auth/dev/instance-secret
PLANNER_DEV_TLS_CERT_FILE=./etc/tls/dev/localhost.pem
PLANNER_DEV_TLS_KEY_FILE=./etc/tls/dev/localhost-key.pem
ENTRA_TENANT_ID=your-tenant-guid
ENTRA_CLIENT_ID=your-client-guid
ADO_ORGANIZATION=your-organization
ENTRA_CLIENT_CERTIFICATE_FILE=./etc/auth/entra-certificate.pem
ENTRA_CLIENT_CERTIFICATE_KEY_FILE=./etc/auth/entra-private-key.pem
ENTRA_REDIRECT_URI=https://localhost:5174/auth/callback
ENTRA_AUTH_MODE=entra
ENTRA_ADO_TRANSPORT=live
ENTRA_LISTEN_PORT=8765
ENTRA_BROKER_PUBLIC_URL=https://localhost:5174/auth/
ENTRA_BROKER_KEY_FILE=./etc/auth/dev/broker-key
ENTRA_BROKER_STORE=./etc/auth/dev/broker.sqlite
ENTRA_BROKER_REGISTRY_FILE=./etc/auth/dev/instances.json
```

To use an application secret instead, replace both `ENTRA_CLIENT_CERTIFICATE_*`
entries with `ENTRA_CLIENT_SECRET_FILE=./etc/auth/client-secret`.
Do not configure both credential methods. The Entra application certificate is
distinct from `PLANNER_DEV_TLS_CERT_FILE` and `PLANNER_DEV_TLS_KEY_FILE`.

Create the registry at `ENTRA_BROKER_REGISTRY_FILE`, with the same instance key path
as `PLANNER_AUTH_SECRET_FILE`:

```json
{
   "version": 1,
   "instances": {
      "dev": {
         "completion_url": "https://localhost:5174/dev/api/auth/login/callback",
         "secret_file": "./etc/auth/dev/instance-secret"
      }
   },
   "mock_registration": null
}
```

Check the configuration before starting services:

```bash
./scripts/run_dev.sh --auth-env ./etc/auth/dev-auth.env --check
./scripts/run_dev.sh --auth-env ./etc/auth/dev-auth.env
```

`--check` checks local dependencies, installation-key presence and broker
configuration, including the selected application credential. It starts no services,
makes no Microsoft requests and does not create/open the token database. Normal
startup performs the same preflight before starting broker, backend or Vite; an
invalid certificate or secret configuration stops the entire launch. It does not
test free ports, HTTPS browser trust, Entra registration/consent or actual token
renewal. Use `./scripts/run_dev.sh --check` for the ordinary PAT/enrollment setup.

After starting the launcher, open `https://localhost:5174/dev/` or
`https://localhost:5174/dev/admin/`. Vite terminates TLS and proxies `/auth/` to the
loopback broker and `/dev/api/` to the backend. The backend port defaults to 8001;
the example uses 8002 to avoid an existing dev server. The browser port is fixed by
the registered public URL: stop another listener or choose a different port and
update every callback/public URL and the Entra registration. Broker databases are
bound to their public URL, mode and encryption key: changing the public URL also
requires an explicit new `ENTRA_BROKER_STORE` path or a deliberate store migration.
Retain the previous store; changing only URLs cannot reuse its grants. Ctrl+C stops
all three services. Broker and backend access logging is disabled to keep callback codes out
of logs. Keep using the auth env file on subsequent starts. Authentication is a
deployment choice: use `PLANNER_AUTH_PROVIDER=entra` with
`PLANNER_ADO_AUTHENTICATION=entra`, or `PLANNER_AUTH_PROVIDER=enrollment` with
`PLANNER_ADO_AUTHENTICATION=pat`, then restart the launcher. Data Sources displays
the deployed authentication mode but cannot change it.

For offline mock sign-in, use `http://localhost:5174` everywhere above, remove the
two TLS variables and both `ENTRA_CLIENT_CERTIFICATE_*` entries, set both
`PLANNER_AUTH_UPSTREAM_MODE` and `ENTRA_AUTH_MODE` to `mock`, and set
`ENTRA_ADO_TRANSPORT=fixture`. Supply canonical tenant/client GUIDs. Create a
nonempty dummy credential in your private development directory, not in Entra:

```bash
umask 077
python -c 'from pathlib import Path; import sys; Path(sys.argv[1]).open("x").write("mock-only-not-an-entra-secret\n")' "$DEV_AUTH_DIR/mock-client-secret"
```

Use the activated `.venv` and set `ENTRA_CLIENT_SECRET_FILE` to that file's absolute
path. Retain the broker encryption and per-instance keys generated above.
Set registry `mock_registration` to an object containing
the exact `tenant_id`, `client_id`, `redirect_uri` and `organization` from the env.
Mock credentials cannot access live ADO/wiki. Restrict mock sign-in to your machine.

An empty live store bootstraps the first verified account as administrator. Empty
mock stores do not bootstrap admins; use a deliberate private copy of existing dev
data and its original encryption key when testing mock administrator access. Never
run automated enrollment against the active `data/` directory. Real tenant consent,
login and ADO renewal still require manual acceptance with your registration.

The application has two deployment methods:

1. **Vite dev server** (`run_dev.sh`) — the standard development workflow
2. **Docker** (single container, or Caddy-proxied multi-instance) — production

Whatever you do, using Docker is the most convenient for production.
The Vite dev server is the recommended way to run the app during development.

## Database preparation and upgrades

The server initializes and upgrades its database before opening an HTTP listener;
there is no manual migration prerequisite. `DATA_DIR` is the stable installation
root (`data` locally, `/app/data` in Docker), not a cache or generation directory.
Direct launch, Uvicorn factories, reload, and current multi-worker deployments use
the same schema gate and lifetime leases. Shutdown releases storage ownership.

For the first rollout, stop every old process and reload supervisor: older binaries
do not honor the locks. Keep the existing encryption key, allow room for an
independent candidate, and take your own full backup if older-binary recovery is
required. A successful upgrade deletes its predecessor and retains no automatic
upgrade backup. Failed preparation never starts HTTP; pending post-commit cleanup
also blocks startup until completed. Do not delete lock or control files.

External `config/` mounts and disposable `remote_cache/` are not upgrade generations.
The entrypoint changes ownership only for server-owned paths, leaves external
inputs alone, and never invokes historical migration scripts or continues after
an upgrade failure. The v4.2.1 owned `config/server_config.yml` is a one-time
admission exception: it enters the candidate and is deleted only after activation;
read-only external config mounts are never adopted. Only supported local
filesystems are suitable for generations.
See [MIGRATIONS.md](MIGRATIONS.md) for admission, retry, offline restore/export,
storage sizing, cleanup, and process-crash versus power-loss guarantees.

Every deployment needs an installation encryption key, regardless of its ADO
authentication method. This is separate from all Entra, broker and HTTPS keys.

# Generate the Installation Encryption Key

Only for a **new installation**, run from the repository root using the existing
virtual environment. This generates 32 random bytes, base64-encodes them and writes
the key without printing it. Exclusive creation refuses to overwrite an existing
`.encryption_key`:

```bash
source .venv/bin/activate
umask 077
python -c 'import base64, secrets; from pathlib import Path; Path(".encryption_key").open("x").write(base64.b64encode(secrets.token_bytes(32)).decode() + "\n")'
chmod 600 .encryption_key
```

This key encrypts PlannerTool credentials, including PATs, at rest. For an existing
installation or copied data, restore its **original** key from your protected backup
instead of generating a new one. Changing the key does not re-encrypt old credentials.

**Note:**
- Store the `.encryption_key` file securely and back it up
- Never commit `.encryption_key` to version control
- The same key must be used consistently or encrypted PATs cannot be decrypted

With the key stored in `.encryption_key`, select one of the deployment methods.

# Deploy using Docker

You can deploy using Docker as s single container in a manual way, or using the tools
to setup a Caddy + PlannerTool stack where multiple instances can run side-by-side.

## Building the images

Build both project images (`plannertool` and `plannertool-auth`), each tagged with
the version in `VERSION` and `latest`:

```bash
./scripts/build-image.sh
```

Or manually:
```bash
docker build -f docker/Dockerfile -t plannertool:latest -t plannertool:$(cat VERSION) .
docker build -f entra-id/Dockerfile -t plannertool-auth:latest -t plannertool-auth:$(cat VERSION) entra-id
docker image prune
```

## Docker - manual single instance

Run the container with the volumes mounted:

`docker run -d -p 8000 -v <path-to-data>:/app/data -v <path-to-people-database>/database.yaml:/app/data/config/database.yaml --name plannertool plannertool`

Access at `http://localhost:8000`

## Docker - Caddy-proxied multi-instance (preferred)

The application can be deployed using Docker Compose to host multiple isolated instances on the same server, all routed through a single Caddy reverse proxy.

### Requirements
- Docker
- Docker Compose plugin
- Python 3 with `pyyaml`

### Setup instances

**Define your instances** in a configuration file. By default, the script looks for `instances.yml` in the project root. You can use `docker/instances.example.yml` as a template.

**Run the deployment script** to generate the configuration files. Use the `--config` flag if your file has a different name or location.

   ```bash
   # Generate from default instances.yml
   python3 scripts/deploy.py --apply

   # Generate from a custom config file
   python3 scripts/deploy.py --apply --config path/to/my-instances.yml
   ```

Run the tool without parameters to get more options.  `--apply` builds the files needed. See below for more desciption on the `deploy.py` tool.

The script creates a `deployment/` directory, creates a docker-compose file and Caddyfile, and an index.html file to serve as a landing page for the instances.

### Optional HTTPS

The generated stack uses HTTP on port 80 by default. To enable Caddy-managed HTTPS,
set top-level `https_hostname: planner.example.com` in `instances.yml`. The normal
deployment command then retains HTTPS on subsequent runs. Alternatively, supply
the hostname as a command-line option:

```bash
python3 scripts/deploy.py --config instances.yml --https-hostname planner.example.com --apply
```

The generated Caddy site uses that hostname, publishes TCP ports 80 and 443 (plus
UDP 443), and stores Caddy's certificate/account data in named volumes so certificates
survive container recreation. Start or update the stack with the usual
`cd deployment && docker compose up -d` command. Caddy redirects HTTP to HTTPS.

Select a certificate policy with top-level `https_tls`. Omission means
`mode: acme`, retaining public automatic certificate issuance. There is no automatic
fallback between modes.

For a private server without public DNS, start with Caddy's internal CA:

```yaml
https_hostname: planner.example.test
https_tls:
   mode: internal
```

Caddy issues and renews the server certificate locally; no public DNS, public ACME
challenge or certificate-authority internet access is needed. Clients must still
resolve the hostname through internal DNS or hosts files and reach TCP 443.
On `--apply --start`, deployment exports only the public CA root to
`deployment/tls/caddy-root.crt` (or `tls/caddy-root.crt` under `--output-dir`) and
uses it for strict hostname/certificate verification. Install that public root in
the trusted root store of each client/browser, following company IT policy.
Deployment does not change host or browser trust stores automatically. The root is
self-signed; server certificates are signed by that root. Never distribute the CA
private key from the `caddy_data` volume. Preserve that volume to retain client trust.
Treat the local CA private key as signing authority, not as a disposable cache.

When a company-issued certificate is available, select supplied PEM files:

```yaml
https_hostname: planner.example.test
https_tls:
   mode: provided
   certificate_file: ./etc/tls/fullchain.pem
   key_file: ./etc/tls/key.pem
   ca_file: ./etc/tls/company-ca.pem
```

Paths resolve relative to the manifest, not the generated Compose directory.
`certificate_file` must contain the hostname-matching leaf certificate followed
by intermediate certificates; `key_file` must be its matching, unencrypted PEM
private key with mode 0600. The documented `./etc/tls/` directory is ignored by Git;
never commit private keys. Alternatively, use literal paths under `$HOME` or system
`/etc`. Deployment validates the pair before generation and mounts both files
read-only into Caddy.
The optional `ca_file` supplies trusted CA certificates for deployment's readiness
check; omit it if the deployment host already trusts the issuing CA. Client/browser
trust must be configured separately. An explicit self-signed server certificate
can also be supplied, with that certificate as `ca_file` and installed client trust.
This mode performs no public ACME challenges. You own renewal: replace the supplied
files and restart Caddy to load them, then rerun deployment to verify the result.
For example, `docker compose --project-directory deployment restart caddy`; preserve
your usual project-name and environment-file options. Switching from internal to
provided TLS does not require changing the hostname or auth service public URL.

#### Generating a Certificate Signing Request

Set the TLS basepath and create the protected directory:

```bash
BASE_PATH=./etc
TLS_DIR="$BASE_PATH/tls"
mkdir -p "$TLS_DIR"
chmod 700 "$TLS_DIR"
```

Create `./etc/tls/csr.conf` for the hostname and organization used by your
deployment:

```ini
[req]
default_bits = 3072
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
C = DK
O = Example Company
OU = IT
CN = planner.example.test

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = planner.example.test
```

Replace the example subject and DNS name with values accepted by your certificate
authority. Generate a private key, protect it, and create the CSR:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$TLS_DIR/key.pem"
chmod 600 "$TLS_DIR/key.pem"
openssl req -new -key "$TLS_DIR/key.pem" \
   -out "$TLS_DIR/server.csr" -config "$TLS_DIR/csr.conf"
openssl req -in "$TLS_DIR/server.csr" -noout -text
```

Submit only `./etc/tls/server.csr` to your certificate authority and request a TLS server
certificate for the listed hostname. Confirm the issued certificate includes the
hostname as a subject alternative name; combine the leaf and intermediate certificates
at `./etc/tls/fullchain.pem`, then configure that file and the matching
`./etc/tls/key.pem` using `mode: provided` above. Keep the private key ignored by Git
and mode 0600.

For public ACME issuance (`https_tls: {mode: acme}`), Caddy obtains and renews
certificates automatically. The hostname must resolve to this server and inbound
TCP ports 80 and 443 must be available to Caddy, with no other service occupying
them. Set public DNS A records (and AAAA records if IPv6 is used) to the server's
reachable addresses, and forward these ports through any firewall or NAT. Caddy
also needs outbound DNS and HTTPS access to the certificate authority. Replace
example hostnames with a domain you control; reserved `.test` names cannot obtain
publicly trusted certificates. No manual certificate installation is required.
If both manifest and command line
specify a hostname, they must agree. Without either setting, generation uses HTTP.
For deployments without shared auth, another proxy may terminate HTTPS while
Caddy remains HTTP-only. Shared-auth deployments require the matching HTTPS
ingress and callback configuration described above.

Use `--apply --start` to generate, start and check HTTPS in one deployment. After
container startup, the script waits up to 120 seconds for a certificate trusted
by the configured CA (or the deployment host) and valid for `https_hostname`, connecting to local port
443 with that hostname as TLS SNI. It does not disable certificate verification.
This verifies the local Caddy endpoint, not external DNS or firewall reachability.
If issuance is not ready, deployment exits nonzero and prints a Caddy log command
preserving the chosen project, output directory and protected environment file.
Internal CA export may also take up to 120 seconds on first startup. Containers
remain running for inspection; investigate logs, certificate/trust configuration
and network settings before rerunning deployment. Starting Compose
manually does not run this certificate check.

Keep the Compose project name and `caddy_data` volume unchanged across updates;
do not use `docker compose down -v`, which deletes persisted certificates and
other application volumes. Caddy handles ACME/internal renewals without rerunning
deployment; supplied company certificates require operator-managed renewal.

### Compose Encryption Environment

Before starting containers, provision `PLANNER_SECRET_KEY` in the protected Compose
env file. After `--apply` creates the output directory, run the following from the
repository root for a **new** env file, with `.venv` activated:

```bash
umask 077
python -c 'from pathlib import Path; key = Path(".encryption_key").read_text().strip(); Path("deployment/.env").open("x").write("PLANNER_SECRET_KEY=" + key + "\n")'
chmod 600 deployment/.env
```

This copies the retained installation key; it does not generate another one.
Existing env files are not overwritten. If you already have a protected env file,
retain it and use `--env-file /absolute/path/to/it` when needed. Never print its
contents, commit it or include it in support logs. A secret-management service may
provision the same retained value instead.

To start the services, either run the script with the `--start` flag, or do it manually:
   ```bash
   # Option A: Let the script start everything
   python scripts/deploy.py --apply --start

   # With a custom config file:
   python scripts/deploy.py --config path/to/my-instances.yml --apply --start

   # Option B: Start manually
   cd deployment && docker compose up -d
   ```

### Information on the `deploy.py` tool

The `scripts/deploy.py` script generates a dynamic `Caddyfile`, `docker-compose.yml`, and `index.html` for your configured instances.
By default the script performs a dry-run: it prints usage help and displays the generated files without writing anything to disk. To write the files into the `deployment/` directory and perform actions, pass `--apply`.

With `--apply` and either `--build` (also `-b` or `--build-images`) or `--start`, the
script validates Compose configuration with `config --quiet`. Explicit `--build`
invokes `scripts/build-image.sh` to build both project images, even if the manifest
uses image-only services or has no auth service. Source-declared services are also
built using `docker compose build` to honor their configured tags. `--apply --start` then runs
`docker compose up -d --wait`. The auth service and PlannerTool instances are built
and started together, with persistent per-service volumes and private service DNS.
Caddy uses its upstream image and is not built locally. Any build failure prevents
startup. Generation/startup does not prune images or remove orphaned services/volumes.

Use `--env-file path/to/protected/.env` to select the Compose environment file
explicitly; it must have no group/other access (normally mode 0600). A missing or
empty `PLANNER_SECRET_KEY` fails Compose validation before build/start. Use
`--project-name planner-demo` to isolate the deployment; this name is written into
the generated Compose file. Keep the same environment file and project name for
updates and maintenance. Without `--output-dir`, files are written to `deployment/`.

#### Versioning and Staged Rollouts
By default, instances use an image tagged with the version defined in the `VERSION` file (e.g., `plannertool:v2.1.0`). 
Services without an explicit image receive a native Compose build context and
the current version tag. To use a prebuilt image, set `image:` in the manifest;
it is image-only unless you explicitly add `build_from_source: true`. This setting
is supported on both instances and auth services. An image-only service is never
rebuilt or replaced with a source fallback. `build_from_source: false` requires
an explicit image.

#### Image Cleanup
Image cleanup is an explicit operator task. The deployment script does not run
`docker image prune` or delete images that another deployment might need.

#### Volume Management
By default, instances use isolated Docker named volumes (`data-<name>`). 
If you prefer to store data in a specific folder on your host machine, you can specify `volume_type: bind` and provide a `volume_source` path. The deployment script will automatically create the host directory to prevent Docker from creating it with root permissions.

#### External People Database
If you are maintaining a central people database across instances or managed by an external tool, you can mount it directly into the container using the `external_database` property in your `instances.yml`. Provide the host path to the YAML file, and the deployment script will bind mount it as read-only to `/app/data/config/database.yaml` inside the container.

### Separating Source Code from Deployment

If you want to keep your application source code separate from your production server, you can decouple the build process from the deployment process:

1. **Build and Push:** Build the Docker image on a CI/CD server (or your local machine) and push it to a container registry (e.g., Docker Hub, GitHub Container Registry).
2. **Configure External Image:** In your `instances.yml`, set the `image` property to your fully qualified registry URL (e.g., `image: ghcr.io/myorg/plannertool:v4.2.0`).
3. **Generate Configuration:** Run `python3 scripts/deploy.py` locally. Because the script detects an external image name, it will intentionally omit the `build:` instructions from the generated `docker-compose.yml`.
4. **Deploy:** Copy the generated `deployment/` folder to your production server.
5. **Run:** On the production server, navigate to the `deployment/` folder and execute `docker compose up -d`. 

With this workflow, the production server only needs Docker installed. It does not require Python, the deployment script, or the application source code.
For Compose, use the protected env file described in
[Compose Encryption Environment](#compose-encryption-environment). The development
launcher reads the retained root `.encryption_key` itself; it does not require a
second copy or a new key. Keep all copies and protected backups consistent.

# Deploy using Vite dev server (recommended for development)

The `run_dev.sh` script starts both the Vite dev server (port 5173) and the
uvicorn backend (port 8001) together:

   ```bash
   ./scripts/run_dev.sh
   ```

The Vite server proxies API calls to the backend and provides hot-module reload.

Use the application by browsing to `http://localhost:5173`

# Deploy using uvicorn alone

For backend-only work or quick local testing of the production build, build the
frontend first (uvicorn serves `dist/`):

```bash
# Only if the Lit bundle needs to be updated:
npm run build:vendor

# Build and run:
npm run build
PLANNER_SECRET_KEY=`cat .encryption_key`  uvicorn planner:make_app --port 8000 --factory --reload 2>&1 |tee logfile.log
```

Use the application by browsing to `http://localhost:8000`

# Proxmox/Virtualised Linux Deployment (just for completeness)

On your favorite virtualiser or bare metal machine, install ltest Debian 13.x as the base.

If you want to run using LXC on Proxmox, install Proxmox 9.x . Debian 13 is not supported on Proxmox 8.x.
Use a Debian 13 base template. Setup the LXC, give it reasonable settings (2 CPU, 512 MB RAM, 8 GB disk, Static or DHCP IP)

Login and update the container `apt update; apt upgrade; apt install nginx git python3-venv`. If you intend to use docker, add
`docker.io docker-compose`

Add a non-root user to run the service `adduser planner`. Set a password, then `su planner` and go to the user home directory.

Follow one of the deployment options above.
