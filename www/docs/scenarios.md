# Scenarios & Saving

Baseline vs Scenarios
- Baseline: live snapshot from Azure DevOps.
- Scenario: a local copy where you can experiment without modifying the baseline.

Workflow
1. Clone baseline to create a new scenario.
2. Make edits (move cards, update allocations, change dates).
3. Save locally (unless autosave is enabled).
4. Use "Save to Azure" to open the review modal and choose which changes to push.

Review modal
- Lists changed fields and affected items.
- Select/deselect individual changes before pushing to Azure DevOps.

Safety notes
- Only selected changes are pushed. The app will not automatically overwrite source data.
