
# Quick Usage

## Opening Help

Click the Help (?) button in the top bar or sidebar to open this modal. Use the search box to filter pages by title or tag.

## Common tasks

- Create a new project by clicking the + button on the Projects list.
- Rename or clone scenarios from the Scenario menu.
- Toggle condensed/expanded views from the View menu.

## Example: Start dev server

```bash
# Activate venv and run dev server (from repository root)
source .venv/bin/activate
uvicorn planner:make_app --factory --reload
```

## Linking docs

You can link to other docs or external resources:

- Internal: `[Introduction](intro.md)` (the Help modal will open the referenced file when selected from the index)
- External: `[Project site](https://example.com)`

## Tips for doc authors

- Keep pages focused and small — break long guides into topic-based files.
- Use `index.json` tags to enable quick discovery via search.
- Store images under `www/docs/` and reference them by filename.

