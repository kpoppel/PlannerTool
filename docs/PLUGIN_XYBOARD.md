# Design document

The XY-board (in early development) is a plugin which can display a table crossing two task properties.
The task types to include in the table is selectable.

The table is only for display, but can for example show tables of:
- Assignee, versus tak type
- Task type versus State
- State versus Priority
- ...

All fields where a value is, a cross can be made.
While a table of assignee vs state with User Story is effectively a kanban board, there is no plan to create
a kanban board since a generalised board changing any two properties is an advanced change to the program and scope.

# Current implementation shortfalls
- Complex fields with lists or maps render as "(object)".
  - They either need to be unpacked, or skipped as valid candidates.
- The UI is vey basic - buy may be sufficient
- The table has sticky left and top column/row, but the table is visible left and above these. Styling is bad.
- Plugin configuration in general is to be determined.
  - Most of the existing plugins have no configuration of their own, but this one could benefit from
    allowing the user to configure it to reduce the fields shown in the drop-down lists.
  - Plugin configuration could be global (set by admin), or user defined.
  - If global configuration is added, then the admin interface must be aware of the plugins and
    plugins must register an admin-interface too.

# Implementation notes

## Files changed
`planner_lib/azure/work_items.py`
`planner_lib/backend/adapter.py`
`planner_lib/domain/tasks.py`
- Adding support for a "fields" field which holds all fields not already part of the basic set.

`tests/backend/test_extra_fields.py`
- test the extra fields from ADC are retrieved

`tests/plugins/xyBoardUtils.test.js`
- Unit tests for the xy boads

`www/js/core/pluginRegistry.js`
- Registering the plugin code

`www/js/modules.config.json`
- Plugin enabling registration

`www/js/plugins/PluginXYBoard.js`
`www/js/plugins/PluginXYBoardComponent.lit.js`
`www/js/plugins/xyBoardUtils.js`
`www/js/components/XYCard.lit.js`
- XY board components.
- TODO: XYCard.lit.js does not belong outside www/js/lugins - must go to www/js/plugins/xyboard/...