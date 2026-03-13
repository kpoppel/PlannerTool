
# PlannerTool — Introduction

Welcome to PlannerTool. This documentation is served from the `www/docs/` folder and rendered inside the application's Help modal.

Quick navigation:

- Use the left-hand index to browse pages.
- Use the search box to filter pages by title or tag.

Contents

1. Overview
2. Examples
3. Assets

Overview

PlannerTool is a lightweight planning UI for working with projects, teams and features. Keep documentation pages as simple Markdown files in `www/docs/`.

Examples and supported features

- Headings (H1..H6)
- Paragraphs
- Lists (bulleted and numbered)
- Code blocks (fenced with ```)
- Inline code using backticks
- Images and asset references (relative to `/static/docs/`)
- Links to external sites or other docs

Example diagram (served from `www/docs/`):

![Sample diagram](diagram-example.svg)

Assets

Place images and other resources alongside markdown files. They will be served at `/static/docs/<filename>` so you can reference them directly in Markdown.

Adding pages

1. Add a new Markdown file under `www/docs/`.
2. Add an entry to `index.json` with a `title`, `file` and optional `tags`.
3. The Help modal will pick up the new doc and render it automatically.

