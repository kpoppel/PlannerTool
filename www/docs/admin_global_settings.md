# Admin - Global Project Settings

This screen configures two hierarchies shared by every project: the task type hierarchy and the state display sequence.

## Task type hierarchy

Defines the parent/child ordering of work item types across the whole installation (for example Initiative → Epic → Feature → Bug/User Story → Sub-Task). This ordering drives how the tool expands and nests cards.

- Task types not yet assigned to a level sit in a highlighted "pool" row at the bottom.
- Click "Add Level" to create a new level, then click pool chips to assign types to the active level.
- Remove a type from a level with its × control; it returns to the pool.
- Every task type must end up in exactly one level — the pool makes it easy to spot anything unassigned.

## State display sequence

Defines the ordered sequence of state categories (and their colours) used to present work item states consistently across the application, independent of how any single Azure DevOps project happens to order its states.

## Editing

- Both hierarchies support a form view and a raw JSON view; toggle between them as needed.
- Save persists the configuration; Reload discards local edits and re-fetches the current server value.

## Impact

Because these settings apply to every project, changes here affect how cards nest and how state colours appear across the whole installation — review with care, ideally with a small set of test projects, before rolling out to a full user base.
