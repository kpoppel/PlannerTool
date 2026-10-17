# Admin - Iterations

The **Iterations** section (`#iterations`, heading "Iterations Configuration") manages iteration sets: named collections of Azure DevOps iterations that plans offer as schedule presets (see [Iterations (timeboxes)](iterations.md)). It requires the `manage_iterations` permission.

![Iterations configuration](img/admin_iterations.png)

## Browse Iterations (left)

1. Choose an Azure project in **Select Azure project**. Its iterations load automatically.
2. Use **Filter iteration paths** to narrow the list. Each iteration shows its start and end dates.
3. Tick one or more paths and click **Make Set from Selection**. The new set contains the selected roots and their descendants and is named after the selection, for example "Iterations (Release 3)".

## Configuration (right)

- **Configured Iteration Sets** lists each set with inline fields: set name, source Azure project, root path (optional) and set ID, plus the number of values and when they were cached.
- Click **Save Configuration** to store new or edited sets.
- **Delete** removes a set on the server immediately. If plans still use the set, you are asked whether to unassociate them all and delete.
- **Raw JSON** / **Form Mode** switches between a JSON editor and the form.

Assign a set to a plan with the **Iteration set** field when creating or editing the plan in [Admin - Plans](admin_plans.md).

## Notes

Browsing requires a valid Personal Access Token with access to the Azure DevOps project. Only iterations with complete start and end dates are offered as presets.
