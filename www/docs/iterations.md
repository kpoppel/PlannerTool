# Iterations — Configuration and Usage

PlannerTool can fetch Azure DevOps iterations (timeboxes) for use when setting task dates.

Key points
- Iterations come from server-side configuration: the application reads an iterations configuration that lists one or more iteration root paths.
- The iterations endpoint requires a valid Personal Access Token (PAT) in your session; if no PAT is present you will be prompted to configure one.
- Admins manage iteration roots in the Admin → Iterations section (server configuration). See your administrator if iterations are missing.

Behavior details
- The server normalizes iteration paths by stripping any redundant 'Iteration'/'Iterations' path segments before returning them to the UI.
- The server filters out iterations without dates and excludes iterations entirely in the past (older than the current year) to keep the list concise.

How to use
1. Ensure your account is configured with a PAT (Configuration → Personal Access Token).
2. Open a card's Details panel and use the Iterations dropdown to pick a named timebox; selecting an iteration updates Start/Target dates.

Admin notes
- Iteration root paths are configured on the server (see `example-iterations.yml` in the repository for the expected format).
- If you are an admin and need to add or browse iterations, open the Admin UI → Iterations and use the Browse action to preview available iterations for a project.
