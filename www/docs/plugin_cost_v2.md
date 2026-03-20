# Cost Analysis Plugin (v2)

## Overview

PluginCostV2 provides a three-view cost analysis tool for planning and budget management. It offers monthly cost/hours breakdowns across projects, tasks, and teams with explicit error handling and trustworthy reporting.

## Purpose

The plugin serves three primary use cases:

1. **Project View**: Per-project team-month breakdown tables showing which teams are allocated to each project and their monthly cost/hours distribution
2. **Task View**: Parent/child task tree with budget deviation indicators to identify planning discrepancies
3. **Team View**: Per-team feature allocation tables showing what features each team is working on

## Key Features

- **Three tabbed views**: Project, Task, Team - easily switch between perspectives
- **Monthly breakdowns**: All views show monthly Internal/External cost and hours columns
- **Budget deviation detection**: Identifies when parent task allocations differ from sum of children (>10% threshold)
- **Dataset expansion**: Automatically includes child tasks via parent/child relations to avoid filter-induced misreporting
- **Cost/Hours toggle**: Switch between cost and hours display modes across all views
- **Date range control**: Filter data by custom date range (From/To dates)
- **Explicit error handling**: No silent failures - clear error messages when data is missing or incomplete

## How to Use

### Opening the Plugin

1. Select one or more delivery plans from **Top menu → Plan**
2. Select one or more teams from **Top menu → Team**
3. Open **Tools menu → Cost Analysis (v2)**

### Project View

Shows per-project team-month breakdown tables:

- One table per selected project
- Rows: teams allocated to the project
- Columns: monthly Internal/External pairs (e.g., Jan Int, Jan Ext, Feb Int, etc.)
- Click project header to expand and see individual features
- All child features included automatically via parent/child relations

**Use case**: "How much is Team A costing Project X each month?"

### Task View

Shows parent/child task tree with budget deviation indicators:

- Orphan tasks (no parent) shown at top level
- Parent tasks with children are expandable
- Budget deviation shown when parent's own allocation differs from sum of children
- Deviation indicator color-coded:
  - **Red**: >20% deviation (high)
  - **Orange**: 10-20% deviation (medium)
- Click parent task to expand and see:
  - Parent own vs children sum comparison table
  - List of child tasks
  - Per-team detail breakdown
- Tree structure preserves parent/child relationships

**Use case**: "Is this Epic's budget consistent with its child Features?"

### Team View

Shows per-team feature allocation tables:

- One table per selected team
- Lists all features allocated to that team
- Shows project name for context
- Monthly Internal/External cost/hours for that team's allocation only
- Team total row at bottom
- Features allocated to multiple teams appear in multiple tables

**Use case**: "What features is Team B working on and what's our monthly spend?"

### Controls

**Tab buttons**: Switch between Project, Task, Team views

**Date range**: 
- **From** and **To** date pickers filter data to specified range
- Months automatically adjust based on date range
- Default: current year (Jan 1 - Dec 31)

**View mode toggle**:
- **Cost**: Display monetary values (default)
- **Hours**: Display hour allocations

**Close button**: Exit the plugin and return to timeline

## Data Expansion Behavior

To ensure accurate reporting, the plugin **internally expands datasets** to include all related tasks via parent/child relations, regardless of current filters:

- **Project view**: Includes all child features of selected projects
- **Task view**: Uses tasks visible on timeline (selected projects AND teams intersection)
- **Team view**: Includes all features allocated to selected teams

This prevents errors caused by parent tasks being visible while their children are filtered out, which would lead to incorrect totals.

## Budget Deviation Explanation

Budget deviation compares:
- **Parent Own**: Cost/hours directly allocated to the parent task itself
- **Children Sum**: Sum of cost/hours allocated to all child tasks

**Deviation formula**: `(Parent Own - Children Sum) / Children Sum × 100%`

A positive deviation means the parent has MORE allocation than its children sum. A negative deviation means LESS.

**Why it matters**: Large deviations indicate planning inconsistencies:
- Parent task may have been sized before breaking down into features
- Child tasks may have grown beyond original parent estimate
- Allocation may not have been updated after feature decomposition

## Empty States

If you see "No Projects Selected" or "No Teams Selected":
- Go to **Top menu → Plan** to select projects
- Go to **Top menu → Team** to select teams
- Return to the plugin via **Tools → Cost Analysis (v2)**

If you see "No features available":
- Ensure your selected projects have features with dates and team allocations
- Check that features have `capacity` arrays assigned (visible in task details)

## Error Messages

The plugin shows clear error messages when data is missing or invalid:

- **"Failed to load cost data"**: Server communication issue - check network/session
- **"No features available"**: No features found for selected projects/teams
- **"Invalid data structure"**: Data from server doesn't match expected schema

All errors are logged to browser console for debugging.

## Comparison with Original Cost Plugin

| Feature | Original Cost Plugin | Cost Analysis (v2) |
|---------|---------------------|-------------------|
| Views | Two (Projects, Teams) | Three (Project, Task, Team) |
| Monthly breakdown | Per-feature only | Per-project team, per-task, per-team feature |
| Task tree | No | Yes with budget deviation |
| Dataset expansion | Uses data funnel (may miss children) | Explicitly expands via parent/child |
| Error handling | Silent failures possible | Explicit errors always shown |
| Deviation detection | Yes (Epic level) | Yes (Task level with detail) |

## Technical Details

### Files

- `www/js/plugins/PluginCostV2.js` - Plugin lifecycle wrapper
- `www/js/plugins/PluginCostV2Component.js` - LitElement UI component
- `www/js/plugins/PluginCostV2Calculator.js` - Pure utility functions
- `www/js/modules.config.json` - Plugin registration config

### Data Sources

- **Cost data**: Fetched from `/api/cost` endpoint
- **Features**: From `state.getEffectiveFeatures()` with scenario overrides applied
- **Parent/child relations**: From `state.childrenByEpic` map
- **Selected projects**: From `state.projects.filter(p => p.selected)`
- **Selected teams**: From `state.teams.filter(t => t.selected)`

### Calculation Logic

**Month allocation**: Features are allocated to months proportionally based on overlapping days. If a feature spans Jan 15 - Feb 15 (31 days), Jan gets 17/31 and Feb gets 14/31 of the total cost/hours.

**Team fraction**: If a feature has capacity `[{team: 'A', capacity: 80}, {team: 'B', capacity: 20}]`, then Team A gets 80% of the allocated cost/hours and Team B gets 20%.

**Budget deviation**: Calculated independently for internal/external cost and hours using the formula above.

## Troubleshooting

**Plugin doesn't appear in Tools menu**: Check `www/js/modules.config.json` and ensure `plugin-cost-v2` has `enabled: true`.

**Deviation indicators not showing**: Ensure parent tasks have both direct capacity allocation AND children with capacity. The deviation is only calculated when both exist.

**Team tables show zero values**: Verify that features have `capacity` arrays assigned with team allocations. Check task details panel to confirm.

**Monthly columns don't match data**: Check the From/To date range - it filters which months are displayed.

## Future Enhancements

Potential improvements for future versions:

- CSV/Excel export per view
- Configurable deviation threshold (currently hardcoded at 10%)
- Team color coding matching timeline
- Pagination for large datasets
- Drill-down from any view to feature detail panel
- Comparison mode (baseline vs scenario)
- Quick-action buttons (Select All Projects, Clear Selection)
- Mobile/responsive layout

## Developer Notes

### Testing

Unit tests: `tests/plugins/PluginCostV2Calculator.test.js`
Integration tests: `tests/plugins/PluginCostV2Component.test.js`

Run tests: `npm test -- PluginCostV2`

### Architecture Principles

1. **Simplicity**: Small, focused functions; avoid over-engineering
2. **Explicit errors**: Throw with context; no silent failures
3. **Purity**: Calculator functions are side-effect free
4. **Testability**: Logic separated from UI rendering

### Key Dependencies

- LitElement for UI rendering
- `state` service for projects/teams/features/childrenByEpic
- `dataService.getCost()` for cost data
- Month helpers from `PluginCostCalculator.js`

## Support

For issues or questions:
- Check browser console for error details
- Review `/memories/session/plan.md` for implementation plan
- Refer to source code comments for detailed function documentation
