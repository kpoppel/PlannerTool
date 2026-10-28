# Entra ID Authentication Broker

This independently runnable service authenticates users for registered PlannerTool
instances. It never imports PlannerTool. Use the manifest-driven configuration in
[Deployment](../docs/DEPLOYMENT.md) for connected instances, including Entra
registration, HTTPS ingress, protected secrets and persistent storage.

The service has one browser callback, `/auth/callback`, and an authenticated
instance API defined in [protocol-v1.json](protocol-v1.json). MSAL handles Entra
authorization code flow with PKCE and token renewal. Encrypted MSAL caches and
session-owned grants survive restarts. Tokens never enter browser responses.
The standalone diagnostic app and development stacks are removed. Registration
is required in both mock and live modes. Real-tenant acceptance remains outstanding.

## Entra Registration

1. Register a single-tenant **Web** application in the tenant connected to ADO.
2. Register the exact `https://planner.example.com/auth/callback` URL, substituting
   your hostname. Leave implicit grants and public-client flows disabled.
3. Add **Azure DevOps > Delegated permissions > user_impersonation** and obtain
   consent according to tenant policy. No Graph or app-only permissions are needed.
4. Configure tenant/client GUIDs, organization name and client-secret **value**
   through the deployment manifest and protected secret files.
5. Users must already have ADO organization access. No ADO service user is needed.

The client secret authenticates token exchanges; ADO operations use each signed-in
user's delegated token and permissions. Keep real deployment identifiers and
credentials in ignored local configuration. Never enable callback query/body logs.

## Direct Python Launch

Install this directory's requirements in an activated virtual environment. Export
`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ADO_ORGANIZATION`,
`ENTRA_CLIENT_SECRET_FILE` (or `ENTRA_CLIENT_SECRET`), `ENTRA_REDIRECT_URI`,
`ENTRA_AUTH_MODE`, `ENTRA_ADO_TRANSPORT`, `ENTRA_BROKER_PUBLIC_URL`,
`ENTRA_BROKER_KEY_FILE`, `ENTRA_BROKER_STORE` and `ENTRA_BROKER_REGISTRY_FILE`.
Use the deployment generator for the registry format and per-instance secrets.

Run `python app.py`. The listener defaults to loopback; configure its port with
`ENTRA_LISTEN_PORT`. Direct Python execution does not load an env file. Live mode
requires HTTPS ingress and uses form-post callbacks. Mock mode permits an explicit
`http://localhost:PORT/auth/callback`; it never creates an MSAL client and returns
only unusable fixture ADO tokens. Neither mode substitutes credentials on failure.

## Tests

From the repository root, with the virtual environment activated:

```bash
python -m pytest -q entra-id
```

Tests run without credentials or Microsoft network access. They cover browser and
instance binding, replay, encrypted persistence, renewal, revocation and mock handoff.