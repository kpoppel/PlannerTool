# Details Panel

The Details panel displays full metadata for a selected card and provides edit controls.

Header
- Title and type indicator.
- Link to open the item in Azure DevOps when available.

Dates
- Editable Start and Target date fields. Changes are reflected on the timeline immediately.

Team allocations
- Add allocation: choose a team and set percentage.
- Adjust allocation with the mouse wheel over the percent field for 10% steps or enter a precise value.
- Allocations are saved into the scenario and can be written back to Azure DevOps via the review modal.

Description & Notes
- Free-text area for notes and annotations. Annotations can be stored locally.

Actions
- Save / Apply: apply changes to the active scenario.
- Save to Azure: open a review modal to select and push changes to Azure DevOps.
- Cancel / Revert: discard unsaved changes.

Behavior
- Edits affect the active scenario; if autosave is off, use Save to persist locally.
- Pushing to Azure DevOps is explicit and reversible via the review step.

Step-by-step example: change dates and team allocations

1. Open the Details panel
	- Click a card on the timeline. The panel title shows the item `Title` and type (e.g., "Feature").

2. Edit Dates
	- Locate the `Start` and `Target` fields under the "Dates" heading.
	- Click the `Start` value and pick a new date from the date picker.
	- Click the `Target` value or drag the card on the timeline to change the end date.
	- Confirm the updated dates are shown in the panel.

3. Edit Team Allocations
	- Find the "Team allocations" section.
	- To add a new allocation, click the `Add allocation` button.
	- In the new allocation row select a `Team` from the dropdown and enter a `Percent` value (e.g., `40`).
	- To quickly adjust the percent, hover over the `Percent` field and use the mouse wheel for ±10% steps.
	- Existing allocations show as rows with `Team` and `Percent` columns and a delete/trash control to remove them.

4. Add notes (optional)
	- Edit the `Description` or `Notes` field to add context for the change.

5. Save changes locally
	- Click `Save` or `Apply` to persist the edits to the active scenario (local storage or autosave depending on settings).

6. Push selected changes to Azure DevOps (optional)
	- Click `Save to Azure` to open the Review modal.
	- In the Review modal inspect the listed changes, uncheck any you do not want to push, then click `Confirm` (or `Push`) to write selected updates to Azure DevOps.
	- The modal reports success or displays inline errors for failed updates.

7. Cancel or revert
	- If you decide not to keep edits, click `Cancel` or `Revert` to return fields to their previous values.

Notes
 - The panel updates the timeline in near-real time when dates or allocations are edited.
 - Allocations are stored using the PlannerTool format in the item (so they can be round-tripped back to Azure DevOps).
