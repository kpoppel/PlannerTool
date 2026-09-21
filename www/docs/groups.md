# Groups (Virtual Nested Groups)

Groups let you organise features into named, collapsible clusters directly on the timeline without turning them into real work items in Azure DevOps.
A group is a lightweight local grouping (colour, name, optional parent group) that wraps a set of features belonging to a single plan.
Groups are useful for things like "next sprint candidates" or thematic clusters that you do not want to model as a bucket task type.

## Creating a group

- Right-click on empty board background under a single selected plan and choose "New group".
- Right-click a feature card and choose "Add to group" to add it to an existing group, or create a new one from the card.
- Only one plan can be active for group creation from the background menu; select a single plan if the option is not available.

## Group anatomy

- A group renders as a pill spanning from the earliest start date to the latest end date of its child features.
- A feature count badge and the date range are shown inside the pill.
- The pill colour is chosen from a small default palette when the group is created and can be changed by editing the group.
- Groups cannot be dragged or resized directly — their position is entirely driven by the dates of the features inside them.

## Working with groups

- Click the chevron or the pill body to expand or collapse the group, hiding or showing its child feature cards on the board.
- Right-click a group pill for "Rename" and "Delete group". Deleting a group ungroups its features; it does not delete the features themselves.
- Groups can be nested: a sub-group is visually inset and rendered slightly smaller than its parent so the hierarchy is clear at a glance.
- Deleting a group with sub-groups also deletes those sub-groups (their features are ungrouped, not deleted).
- Right-click a feature that already belongs to a group to "Remove from group".

## Scope and persistence

- Groups are scenario-aware: a group created in a scenario lives in that scenario, including the baseline scenario.
- Groups are not written back to Azure DevOps — they exist only inside PlannerTool as a planning aid.
