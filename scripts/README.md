PlannerTool API CLI
===================

A tiny CLI to interact with the PlannerTool server API.

Usage
-----

Set the server base URL (optional):

```bash
export API_BASE=http://localhost:8000
```

Create a session (prints session id):

```bash
python3 scripts/api_cli.py create-session user@example.com
```

Check health:

```bash
python3 scripts/api_cli.py health
```

GET an endpoint (include session id via env or flag):

```bash
python3 scripts/api_cli.py get /api/health
python3 scripts/api_cli.py get /api/projects --session $SESSION_ID
```

POST JSON (data can be a JSON string or @filename):

```bash
python3 scripts/api_cli.py post /api/some -d '{"key": "value"}'
python3 scripts/api_cli.py post /api/some -d @payload.json
```

Notes
-----
- Uses `requests` (already present in `requirements.txt`).
- Session id header: `X-Session-Id`.
