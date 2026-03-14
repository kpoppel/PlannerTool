# Admin - Cache Invalidation

Admins can clear cached Azure DevOps data to force fresh data retrieval. Cache invalidation is useful after changing server-side configuration, saving teams/people, or when data appears stale.

What is cleared
- Work items, plans, markers, iterations, and related cached indices.

Where to run it
- Admin UI → Utilities → Cache Invalidation (requires admin access).

Effects
- The next data fetch will retrieve fresh information from Azure DevOps; some operations may be slower immediately after invalidation while caches rebuild.
- Admin endpoints and some server-side operations may trigger automatic invalidation (e.g., updating teams or people).

Troubleshooting
- If projects, teams or iterations appear missing after an admin change, invalidate caches and then refresh your browser.
