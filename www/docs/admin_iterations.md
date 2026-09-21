# Admin - Iterations

Iterations lets you group Azure DevOps iterations (sprints) into named "iteration sets" that projects can reference for iteration-aware planning (see [Iterations (timeboxes)](iterations.md) for how this looks to end users).

## Managing iteration sets

The left panel lists existing sets and lets you manage them:

- Click "Add Set" to create a new set, giving it an id, a display name, the Azure DevOps project it is sourced from, and an optional root path to scope which iterations are browsable for it.
- Click an existing set to edit its fields.
- Save persists a set; Delete removes it (with confirmation). Deleting a set that is still referenced by a project should be followed by updating that project in [Admin - Projects](admin_projects.md).
- "Unassociate All" clears every project link from a set without deleting the set itself.

## Browsing Azure iterations

The right panel browses live iterations from Azure DevOps for a selected project:

- Choose an Azure project, optionally filter by name, and select iterations to add to the currently active set.
- The selection count shows how many iterations are currently chosen.

## Notes

A raw JSON editor is available for bulk changes across many iteration sets at once. Browsing requires a valid Personal Access Token with access to the relevant Azure DevOps project.
