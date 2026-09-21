# Tool - Plan Health

Plan Health scans the currently visible plan for common scheduling problems and lists them so you can jump straight to the affected feature and fix it.

## Opening the tool

Open the Top Menu → Tools → "Plan Health". A floating "Plan Health" panel appears and runs its checks against the currently visible features.

## Checks performed

- Parent-Child Dates: child feature dates fall outside their parent's start/end range.
- Ghosted Children: a child feature has no dates while its parent is planned.
- Parent-Child Teams: team allocations on a child are inconsistent with its parent.
- Orphans: a feature references a parent that cannot be found.
- Hierarchy Violations: structural inconsistencies in multi-level parent/child nesting.
- Dependency Violations: predecessor/successor dates that contradict the declared order.
- State Consistency: work item state values that are missing or inconsistent with the configured workflow.

## Using the panel

- Each check type is shown as a collapsible section, starting collapsed; expand a section to see its issues.
- A summary indicates whether any issues were found across all checks.
- Click an issue to select and navigate to the affected feature so you can fix it in the [Details Panel](details.md).
- Use the refresh control to re-run all checks after making changes, for example after a batch of edits.

## Notes

Plan Health is read-only: it never changes your data, it only highlights potential problems for you to review and fix.
