# Tool - Link Editor

Link Editor is an interactive way to create dependency links between features directly on the board, instead of typing them into the Details Panel.

This tool may be disabled on your installation by default; ask your administrator to enable "Link Editor" in the Admin UI's Plugins screen if it does not appear in your Tools menu (see [Admin - Plugins](admin_plugins.md)).

## Opening the tool

Open the Top Menu → Tools → "Link Editor". A floating panel appears describing the current state ("Link editing active" or a pending action).

## Creating a link

1. Hover over a feature card. Four coloured zones appear around its edges: left (Predecessor), right (Successor), top (Parent), bottom (Related).
2. Click the zone matching the relationship you want to create. The panel shows the pending action and target instructions.
3. Click the target card to complete the link. It is saved immediately to the active scenario.
4. Press Escape at any point to cancel the pending action.

## Relationship types

- Predecessor: the target feature must be completed before this one starts.
- Successor: this feature must be completed before the target starts.
- Parent: this feature becomes a parent container for the target.
- Related: a soft dependency used for cross-team awareness rather than a hard constraint.

## Notes

- While Link Editor is active, board panning by drag is disabled to avoid accidental clicks; scrolling still works normally.
- Use the Details Panel to review or delete existing links — Link Editor only creates new ones.
- Links created here are ordinary Azure DevOps work item links and are included in the [Review Modal](review_modal.md) like any other change.
