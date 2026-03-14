# Review Modal — Save to Azure

When pushing scenario changes back to Azure DevOps the application opens a Review Modal that lists proposed updates. This modal helps prevent accidental or broad overwrites.

What the modal shows

- A list of changed items with a summary of fields that differ from the baseline (dates, allocations, state changes, etc.).
- For each item, a checkbox to include or exclude the change from the push operation.
- An aggregate summary (number of items selected, total fields to update).

How to use it

1. Review each item and expand details when needed to inspect exact field changes.
2. Uncheck any changes you do not want to push.
3. Confirm to push selected changes to Azure DevOps. Progress and results are displayed; errors are shown inline for failed updates.

Safety notes

- The modal only proposes changes — nothing is written until you confirm.
- Use the granular checkboxes to avoid accidental bulk updates.
