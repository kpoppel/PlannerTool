# Task History Plugin Documentation

## Overview

The Task History Plugin displays the change history of task start dates, end dates, and iteration assignments as an interactive timeline overlay. It helps teams visualize how task schedules have evolved over time.

## Features

- **Visual History Timeline**: Shows start and end date changes as colored lines with dots
  - Amber lines for start date history
  - Green lines for end date history
  - Large dots for original and current values
  - Small dots for intermediate changes

- **Fish-bone Connectors**: Connects related start/end changes that occurred together
  - Grey dashed lines for valid paired changes
  - Red dashed lines for invalid cases (start after end)

- **Interactive Tooltips**: Hover or focus on dots to see:
  - Task title
  - Date value
  - Who made the change
  - When it was changed
  - Whether it's the original or current value

- **Keyboard Accessible**: All dots are keyboard-focusable (Tab navigation) with tooltips on focus

## Architecture

### Backend Components

#### 1. Azure Revision Fetching (`planner_lib/azure/work_items.py`)

New method: `get_task_revision_history(work_item_id, start_field, end_field, iteration_field)`

- Fetches all revisions for a work item from Azure DevOps
- Filters to only track changes in start date, end date, and iteration path
- Returns normalized revision records with timestamps and change details
- Supports configurable field mappings for different Azure projects

#### 2. History Service (`planner_lib/projects/history_service.py`)

Class: `HistoryService`

Key methods:
- `list_task_history()`: Main entry point for fetching task history
- `_deduplicate_history()`: Removes consecutive duplicate values
- `_compute_pairing_hints()`: Identifies start/end changes that occurred together

Features:
- Fetches history for multiple tasks efficiently
- Applies pagination for large result sets
- Supports filtering by project, team, plan, and date range
- Deduplicates consecutive identical values server-side
- Adds pairing hints for fish-bone connector rendering

#### 3. API Endpoint (`planner_lib/projects/api.py`)

Endpoint: `GET /api/history/tasks`

Query parameters:
- `project`: Filter by project ID (optional)
- `team`: Filter by team ID (optional)
- `plan`: Filter by plan ID (optional)
- `since`: Start date filter (ISO format, optional)
- `until`: End date filter (ISO format, optional)
- `page`: Page number (default: 1)
- `per_page`: Items per page (default: 100, max: 500)

Response format:
```json
{
  "page": 1,
  "per_page": 100,
  "total": 123,
  "tasks": [
    {
      "task_id": 12345,
      "title": "Feature name",
      "plan_id": "plan_1",
      "history": [
        {
          "field": "start|end|iteration",
          "value": "2025-05-08",
          "changed_at": "2025-05-08T09:10:00Z",
          "changed_by": "alice",
          "pair_id": 1
        }
      ]
    }
  ]
}
```

### Frontend Components

#### 1. PluginHistory.js

Lifecycle wrapper that:
- Registers the plugin with the plugin manager
- Handles activation/deactivation
- Manages component lifecycle
- Provides metadata (name, description, icon)

#### 2. PluginHistoryComponent.js

Main Lit component that:
- Creates an SVG overlay on the feature board
- Fetches history data from the API on activation
- Locates card positions on the timeline
- Renders history lines, dots, and connectors
- Manages tooltips and keyboard interactions
- Syncs with timeline scroll and zoom

Key rendering logic:
- `_renderTaskHistory()`: Main entry point for each task
- `_drawHistoryLine()`: Draws colored lines and dots for start/end history
- `_drawFishboneConnectors()`: Draws connectors for paired changes
- `_calcX()`: Converts dates to x-coordinates on the timeline

Visual design follows the prototype in `backup/history/mockup-1_prototype.html`

## Configuration

### Field Mappings

The plugin supports custom field names per project. Configure in `data/config/projects.yml`:

```yaml
project_map:
  - name: "My Project"
    type: "project"
    area_path: "MyOrg\\MyProject"
    field_mappings:
      start_field: "Custom.StartDate"
      end_field: "Custom.EndDate"
      iteration_field: "System.IterationPath"
```

If not specified, defaults to:
- Start: `Microsoft.VSTS.Scheduling.StartDate`
- End: `Microsoft.VSTS.Scheduling.TargetDate`
- Iteration: `System.IterationPath`

### Plugin Registration

The plugin is registered in `www/js/modules.config.json`:

```json
{
  "id": "plugin-history",
  "name": "Task History",
  "version": "1.0.0",
  "description": "Display task date change history on timeline",
  "path": "../plugins/PluginHistory.js",
  "export": "default",
  "enabled": true,
  "activated": false,
  "exclusive": true,
  "mountPoint": "feature-board",
  "dependencies": []
}
```

## Usage

### Activating the Plugin

1. Open the PlannerTool web interface
2. Select a project from the sidebar
3. Open the plugin menu (typically in the toolbar)
4. Click "Task History" to activate

### Using the Plugin

1. **View History**: Once activated, the plugin fetches and displays history for all visible tasks
2. **Inspect Changes**: Hover over or Tab to dots to see change details
3. **Identify Issues**: Red connectors highlight invalid date ranges (start after end)
4. **Refresh Data**: Click the Refresh button to reload history from Azure
5. **Close**: Click the X to deactivate and hide the overlay

## Performance Considerations

- History data is fetched lazily only when the plugin is opened
- Server-side pagination limits initial data load (default: 100 tasks)
- Revision fetching uses Azure DevOps SDK efficiently with caching where possible
- Frontend rendering uses SVG for efficient overlay display
- Tooltips are lightweight HTML elements, not SVG

## Testing

Unit tests are located in `tests/unit/test_history_api.py`:

- API endpoint tests with various filters
- History service deduplication logic
- Pairing hint computation
- Error handling (no PAT, missing data)

Run tests with:
```bash
pytest tests/unit/test_history_api.py -v
```

## Azure Permissions

The plugin requires these Azure DevOps API permissions:
- Work Items: Read (to fetch revisions)
- Project and Team: Read (to access project metadata)

Ensure the Personal Access Token (PAT) used has these scopes enabled.

## Troubleshooting

### No history displayed
- Check that the project has tasks with date changes in Azure DevOps
- Verify PAT has work item read permissions
- Check browser console for API errors

### Cards not found
- The plugin looks for cards using `data-work-item-id` or `data-task-id` attributes
- If cards aren't found, coordinate with the board team to add stable selectors

### Performance issues with many tasks
- Use date range filters (`since`/`until`) to limit history scope
- Adjust `per_page` parameter to fetch fewer tasks per request
- Consider server-side caching for frequently accessed projects

## Future Enhancements

Potential improvements for future versions:
- Iteration change visualization (color-coded segments)
- Export history to CSV/JSON
- Comparison view (side-by-side history of multiple tasks)
- Animation to "replay" schedule changes over time
- Filtering by change author
- Integration with baseline/scenario comparisons
