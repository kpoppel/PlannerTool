# Card Anatomy & Recommended Workflows

Card Anatomy

- Header
  - Title: primary identifier of the card.
  - Type badge: Epic / Feature / Story / Task.
  - Quick metadata: assignee, IDs or small icons depending on view.

- Body
  - Short description or summary line.
  - Allocation markers: small bars or icons representing per-team allocations when enabled.

- Footer / Controls
  - Dependency indicators: small link icons when dependency display is enabled.
  - Context menu: right-click (or menu button) to access quick actions (open details, open in ADO, clone, etc.).

- Resize handle
  - Located at the right edge of the card. Drag horizontally to change duration.

- Visual cues
  - Color: project or team color dot used to identify ownership.
  - State dot: a small colored indicator showing the feature state (New, Active, Resolved, etc.).

Interactions

- Click: opens the Details panel.
- Drag: move the card horizontally to change Start/Target dates; Epics may move children depending on expansion settings.
- Resize: drag the right edge to change duration; the timeline updates immediately.
- Hover: shows quick tooltip with key metadata.

Recommended Workflows

1. Baseline review and dataset preparation
  - Open the Sidebar and enable the filters and expansions you need (e.g., show only Features, enable Parent/Child Links for context).
  - Use the Data Funnel counters to ensure the dataset size is appropriate for the review.

2. Load balancing across teams
  - With a view showing relevant projects, inspect allocation bars on cards.
  - Click a Feature to open the Details panel and adjust team allocations. Use the mouse wheel for quick percent changes.
  - Save changes to a scenario. Use the timeline scale to verify allocations across the time window.

3. Rescheduling work
  - Drag cards horizontally to move items in time. For bulk shifts, select parent items or use scenario-based edits to move multiple related items.
  - After re-scheduling, verify capacity graphs (Capacity vs Allocation) using the Graph Type control.

4. Preparing changes for Azure DevOps
  - After editing a scenario, click `Save to Azure` to open the Review modal.
  - Inspect proposed updates, deselect any changes you do not want to push, and confirm to write selected updates to Azure DevOps.

5. Exporting or printing
  - Use the Top Menu tools to export timelines or generate PNG/SVG for offline review.

Troubleshooting common card issues

- Card not movable: check the active view's permissions and whether the item is locked by server settings.
- Allocations not visible: ensure `Team Allocated` expansion is enabled and that allocations exist in the item description.
- Dependency lines hidden: enable `Dependencies` in View Options.
