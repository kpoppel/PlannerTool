# Schema-Based Admin UI System

## Overview

The admin interface has been enhanced with a generic schema-based form generator that makes configuration editing safer, more intuitive, and less error-prone. Instead of editing raw JSON in a textarea, administrators now interact with a validated, structured form UI.

## Architecture

### Backend: Schema Endpoint

**Endpoint**: `GET /admin/v1/schema/{config_type}`

Returns JSON Schema definitions for configuration types:
- `system` - Server configuration (server_name, Azure org, feature flags, etc.)
- `projects` - Project mappings to Azure DevOps area paths
- `teams` - Team definitions and member assignments
- `area_mappings` - Area path to delivery plan mappings

Each schema includes:
- **Type definitions** - String, number, boolean, object, array
- **Validation rules** - Required fields, min/max values, length constraints
- **Enums** - Predefined value choices (e.g., log levels)
- **Descriptions** - Help text for each field
- **Nested structures** - Support for complex objects and arrays

### Frontend: SchemaForm Component

**Location**: `/www-admin/js/components/SchemaForm.lit.js`

A generic Lit element that:
1. Accepts a JSON Schema and data object
2. Dynamically generates an appropriate form UI
3. Validates input against schema constraints
4. Provides real-time feedback on errors

**Features**:
- **Type-aware inputs**: Text, number, select, checkbox based on schema
- **Nested object support**: Renders complex hierarchies with visual grouping
- **Array management**: Add/remove items with inline editing
- **Validation**: Required fields, min/max, format constraints
- **Enum support**: Dropdown menus for predefined choices
- **Responsive design**: Clean, accessible UI with proper focus states

### Updated System Component

**Location**: `/www-admin/js/components/admin/System.lit.js`

The System configuration editor now:
- Loads schema from `/admin/v1/schema/system`
- Uses `<schema-form>` for structured editing
- Validates before saving
- Includes a "Raw JSON Mode" toggle for advanced users
- Shows clear success/error feedback

## Usage Example

### Backend Schema Definition

```python
{
    'type': 'object',
    'title': 'Server Configuration',
    'properties': {
        'server_name': {
            'type': 'string',
            'title': 'Server Name',
            'description': 'Unique identifier for this server instance',
            'minLength': 1
        },
        'log_level': {
            'type': 'string',
            'title': 'Log Level',
            'enum': ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
            'default': 'INFO'
        },
        'feature_flags': {
            'type': 'object',
            'title': 'Feature Flags',
            'properties': {
                'enable_azure_cache': {
                    'type': 'boolean',
                    'title': 'Enable Azure Cache',
                    'default': True
                }
            }
        }
    },
    'required': ['server_name']
}
```

### Frontend Usage

```javascript
import '../SchemaForm.lit.js';

// In your component
render() {
  return html`
    <schema-form 
      .schema=${this.schema}
      .data=${this.config}
      @data-change=${this._handleChange}
    ></schema-form>
  `;
}

async save() {
  const form = this.shadowRoot.querySelector('schema-form');
  if (!form.validate()) {
    alert('Please fix validation errors');
    return;
  }
  const data = form.getData();
  await adminProvider.saveConfig(JSON.stringify(data));
}
```

## Extending to Other Admin Views

To add schema-based editing to other admin components:

1. **Add schema definition** to `/admin/v1/schema/{type}` endpoint in `planner_lib/admin/api.py`
2. **Update component** to:
   - Import SchemaForm: `import '../SchemaForm.lit.js';`
   - Load schema: `await adminProvider.getSchema('config_type')`
   - Replace textarea with: `<schema-form .schema=${schema} .data=${data}>`
   - Add validation before save: `form.validate()`

### Example: Converting Projects Component

```javascript
// 1. Load schema
const schema = await adminProvider.getSchema('projects');

// 2. Replace textarea with form
<schema-form 
  .schema=${this.schema}
  .data=${this.projects}
  @data-change=${this._handleChange}
></schema-form>

// 3. Validate before save
if (!this.shadowRoot.querySelector('schema-form').validate()) {
  return;
}
```

## Benefits

### Safety
- **Validation** prevents invalid data from being saved
- **Type checking** ensures correct data types
- **Required fields** are clearly marked and enforced

### Usability
- **Clear labels** and descriptions for every field
- **Appropriate inputs** for each data type
- **Visual feedback** for errors and success
- **No manual JSON formatting** required

### Maintainability
- **Single source of truth** - schema defines structure and validation
- **Reusable component** - same form generator for all configs
- **Easy updates** - change schema, UI updates automatically
- **Fallback mode** - raw JSON editing still available for power users

## Schema Design Guidelines

When adding new schemas:

1. **Use descriptive titles**: Clear, user-friendly field names
2. **Add descriptions**: Help text explaining purpose and format
3. **Set sensible defaults**: Pre-populate common values
4. **Mark required fields**: Use `required` array in schema
5. **Use enums for choices**: Limit to valid options
6. **Group related fields**: Use nested objects for logical grouping
7. **Add validation**: min/max, minLength, format constraints

## Future Enhancements

Potential improvements:
- **Conditional fields**: Show/hide based on other values
- **Field dependencies**: Validate relationships between fields
- **Rich text editing**: Markdown support for description fields
- **File uploads**: Inline file/image handling
- **Auto-save**: Save draft changes automatically
- **Change history**: Track who changed what and when
- **Import/Export**: Download/upload configurations as files
