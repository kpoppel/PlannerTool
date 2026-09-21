# Admin - People

The People screen maintains the people/resource database used to calculate team capacity and cost, and to check that every team has the people it needs.

## Configuration tab

Edit the people data with the same schema-driven form and raw JSON pattern used elsewhere in the Admin UI (see [Admin - Teams](admin_teams.md) for the pattern). Save persists changes; Reload discards local edits.

## Inspection tab

The Inspection tab is a read-only view of how people map onto teams, useful for catching configuration gaps before they affect capacity numbers:

- Summary cards show totals such as the number of people configured and how many teams are matched or unmatched.
- Each team is shown as a card colour-coded by status:
  - Matched (green): the team has people configured.
  - Unmatched (red): the team exists in configuration but has no people mapped to it.
  - No People (amber): the team has no members configured at all.
  - Excluded (grey): the team is marked as excluded/archived.
- Expand a team to see its member list and related statistics.

Use the Inspection tab after any change to Teams or People to confirm capacity calculations will have the data they need.
