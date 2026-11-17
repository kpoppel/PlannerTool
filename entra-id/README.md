# Entra ID Authentication Broker

This independently runnable service authenticates users for registered PlannerTool
instances. It never imports PlannerTool. Use the manifest-driven configuration in
[Deployment](../docs/DEPLOYMENT.md) for connected instances, including Entra
registration, HTTPS ingress, protected secrets and persistent storage.

The service has one browser callback, `/auth/callback`, and an authenticated
instance API defined in [protocol-v1.json](protocol-v1.json). MSAL handles Entra
authorization code flow with PKCE and token renewal. Encrypted MSAL caches and
session-owned grants survive restarts. Tokens never enter browser responses.
The standalone diagnostic app is removed. Use the root `scripts/run_dev.sh --auth-env`
launcher for source-reloading local development; see the localhost HTTPS setup in
[Deployment](../docs/DEPLOYMENT.md#local-development-with-entra-id). Registration is
required in both mock and live modes. Real-tenant acceptance remains outstanding.

## Entra Registration

1. Register a single-tenant **Web** application in the tenant connected to ADO.
2. Register the exact `https://planner.example.com/auth/callback` URL, substituting
   your hostname. Leave implicit grants and public-client flows disabled.
3. Add **Azure DevOps > Delegated permissions > user_impersonation** and obtain
   consent according to tenant policy. No Graph or app-only permissions are needed.
4. Configure tenant/client GUIDs, organization name and an application certificate
   through the deployment manifest and protected PEM files. Upload the public
   certificate under **Certificates & secrets > Certificates** and retain the
   matching unencrypted RSA private key only on the broker. Application secrets
   remain supported as an alternative.
5. Users must already have ADO organization access. No ADO service user is needed.

For this deployment, prefer certificate-backed Entra authentication over application
secrets, and Entra over PATs. MSAL signs short-lived client assertions and derives a
SHA-256 certificate thumbprint; the private key is never sent to Entra. Either Entra
credential authenticates token exchanges; ADO operations still use each signed-in
user's delegated token and permissions. These are explicit choices, not automatic
downgrade paths. Keep real deployment identifiers and credentials in ignored local
configuration. Never enable callback query/body logs. See the deployment guide for
certificate rotation and expiry handling; application certificates are not HTTPS
server certificates.

## Direct Python Launch

Install this directory's requirements in an activated virtual environment. Export
`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ADO_ORGANIZATION`,
`ENTRA_REDIRECT_URI`,
`ENTRA_AUTH_MODE`, `ENTRA_ADO_TRANSPORT`, `ENTRA_BROKER_PUBLIC_URL`,
`ENTRA_BROKER_KEY_FILE`, `ENTRA_BROKER_STORE` and `ENTRA_BROKER_REGISTRY_FILE`.
Use the deployment generator for the registry format and per-instance secrets.
Select exactly one application credential: `ENTRA_CLIENT_CERTIFICATE_FILE` plus
`ENTRA_CLIENT_CERTIFICATE_KEY_FILE` (recommended PEM certificate and unencrypted RSA
key), or `ENTRA_CLIENT_SECRET_FILE` (or `ENTRA_CLIENT_SECRET`, but not both). Protect
credential files with mode 0600. Both certificate fields are required together.
Registry entries contain only `completion_url` and `secret_file`. Regenerate managed
registries; remove obsolete `scenario` fields from hand-maintained registries.

Run `python app.py --check` to validate local registration and credentials without
network requests, starting HTTP or opening the token store. Certificate validation
checks matching RSA keys of at least 2048 bits and validity dates. Credential files
must be nonempty, readable and mode 0600. A PFX bundle must first be converted to
PEM as described in the deployment guide. This check cannot prove the public
certificate/secret is registered in Entra or that tenant consent permits access.

Run `python app.py` to serve; startup repeats the same validation. The listener defaults to loopback; configure its port with
`ENTRA_LISTEN_PORT`. Direct Python execution does not load an env file. Live mode
requires HTTPS ingress and uses form-post callbacks. Mock mode permits an explicit
`http://localhost:PORT/auth/callback`; it never creates an MSAL client and returns
only unusable fixture ADO tokens. Neither mode substitutes credentials on failure.

The Docker image uses `/opt/venv` and runs as broker UID 1000. Provision protected
credential-file ownership on the host for that UID; do not relax permissions or
mount application private keys into PlannerTool/Caddy. For a generated stack, run
`docker compose --project-directory deployment run --rm --no-deps auth-central python app.py --check`,
substituting your auth service and usual Compose options. Configuration errors name
the setting and refer to the deployment guide without printing credential values.

## Tests

From the repository root, with the virtual environment activated:

```bash
python -m pytest -q entra-id
```

Tests run without credentials or Microsoft network access. They cover browser and
instance binding, replay, encrypted persistence, renewal, revocation and mock handoff.