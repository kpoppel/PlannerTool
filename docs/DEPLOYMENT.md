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

Register a single-tenant **Web** application with the exact callback
`https://planner.example.test/auth/callback`. Configure delegated Azure DevOps
`user_impersonation` permission and obtain tenant-required consent. Users need
their own ADO organization access. Keep implicit grants and public-client flows off.

Set `mode: entra`, real tenant/client IDs and the ADO organization name in
`registration`. Add `registration.client_secret_file` pointing to the secret **value**
in a mode-0600 file, such as `/etc/plannertool/entra-client-secret`. Never put it in
YAML, history, chat or source control. The generator mounts it, never generates it.
Allow broker outbound HTTPS to Entra and PlannerTool HTTPS to ADO.

Rerun the ordinary deployment command after editing registration. No manual migration
or source change is required. Restrict initial access: the first verified account on
empty data becomes admin; existing accounts follow the one-time email claim policy
in [Authentication](AUTHENTICATION.md). Offline tests do not prove consent, tenant
policy or real ADO renewal; validate those with a limited audience before cutover.

## Access From Your Computer

Browse to `https://planner.example.test/planning/` using your hostname/instance.
`public_url` must match `https_hostname`; Caddy alone publishes ports and terminates
TLS. Internal-CA clients must trust the exported root. Apps/broker use private Compose
DNS. Plain HTTP is limited to explicit `http://localhost:PORT/auth/` loopback ingress.

Mock login accepts an account email without seeding accounts/data; fake credentials
are rejected before ADO/wiki calls, preserving local/cached work. Live login redirects
to Entra. Both return to the originating instance; logout affects only that session.

## Verify and Operate

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

In any situaion you need to have a secret encryption key.

# Generate a 32 character secrey encryption key

To generate an encryption key run this command line:

   ```bash
   # Generate a random encryption key (do this once and save it securely!)
   openssl rand -base64 32 > .encryption_key

   # Alternatives:
   tr -dc A-Za-z0-9_ < /dev/urandom | head -c 32 > .encryption_key
   # or:
   python3 -c "import secrets; print(secrets.token_urlsafe(24))" > .encryption_key

   # Make it user accessible only
   chmod 600 .encryption_key
   ```

This key is used to encrypt Personal Access Tokens (PATs) at rest.

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
   certificate_file: /etc/plannertool/tls/fullchain.pem
   key_file: /etc/plannertool/tls/key.pem
   ca_file: /etc/plannertool/tls/company-ca.pem
```

Paths resolve relative to the manifest, not the generated Compose directory.
`certificate_file` must contain the hostname-matching leaf certificate followed
by intermediate certificates; `key_file` must be its matching, unencrypted PEM
private key with mode 0600. Keep private keys outside the repository. Deployment
validates the pair before generation and mounts both files read-only into Caddy.
The optional `ca_file` supplies trusted CA certificates for deployment's readiness
check; omit it if the deployment host already trusts the issuing CA. Client/browser
trust must be configured separately. An explicit self-signed server certificate
can also be supplied, with that certificate as `ca_file` and installed client trust.
This mode performs no public ACME challenges. You own renewal: replace the supplied
files and restart Caddy to load them, then rerun deployment to verify the result.
For example, `docker compose --project-directory deployment restart caddy`; preserve
your usual project-name and environment-file options. Switching from internal to
provided TLS does not require changing the hostname or auth service public URL.

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

**Set the encryption key**: Before starting the containers, you must set the `PLANNER_SECRET_KEY` environment variable. 

   ```bash
   # Create the environment file for docker compose
   echo "PLANNER_SECRET_KEY="$(cat .encryption_key) > deployment/.env
   ```
**Note**: For production deployments, consider using Docker secrets or a secrets management service

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



   If running by docker container or development mode, set the environment variable
   ```
   # Create the environment file for docker compose
   echo "PLANNER_SECRET_KEY="$(cat .encryption_key) > deployment/.env

   export PLANNER_SECRET_KEY=$(cat .encryption_key)
   ```

   **Important**: 
   - Store the `.encryption_key` file securely and back it up
   - Never commit `.encryption_key` to version control
   - The same key must be used consistently or encrypted PATs cannot be decrypted
   - For production deployments, consider using Docker secrets or a secrets management service

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
