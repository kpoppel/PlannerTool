# Code Reduction Plan — www/js/plugins

Created: 2026-07-11  
Scope: `/home/planner/PlannerTool/www/js/plugins/` and related tests in `tests/plugins/`  
Baseline total LoC: **22,149** (plugins dir only)

---

## Functional Parts Checklist

| # | Part | Est. LoC Removed | Risk | Status |
|---|------|-----------------|------|--------|
| 1 | Delete dead PluginCostV2 files (wrapper + component) | ~1,216 | Low — not registered, imports non-existent files | ⬜ not-started |
| 2 | Remove disabled legacy PluginCostV1 (wrapper + component + calculator + schema + tests) | ~2,500+ | Medium — registered but disabled; verify no migration path needed | ⬜ not-started |
| 3 | Consolidate duplicate test files (plugin-costv2.test.js / plugin-cost.test.js; SamplePlugin.test.js / sample-plugin.test.js; PluginCostV2Calculator.test.js; PluginCostV2Component.test.js) | ~700 | Low — pure test cleanup | ⬜ not-started |
| 4 | Collapse identical simple lifecycle wrapper boilerplate (PluginEvents, PluginHistory, PluginMarkers, PluginPlanHealth — all ~70 lines each, same structure) | ~150–180 | Low-medium — behavior preserved, replaces 4 one-off classes | ⬜ not-started |

---

## Detailed Findings

### Part 1 — Dead PluginCostV2 (2 files, ~1,216 LoC)

**Files:**
- `www/js/plugins/PluginCostV2.js` (123 lines) — near-identical copy of `PluginCost.js` labelled "A/B testing parallel implementation"
- `www/js/plugins/PluginCostV2Component.js` (1,093 lines) — near-identical copy of `PluginCostComponent.js`

**Evidence it is dead:**
- `PluginCostV2Component.js` imports `PluginCostV2ProjectView.js`, `PluginCostV2TaskView.js`, `PluginCostV2TeamView.js`, `PluginCostV2TeamMembersView.js`, and `PluginCostV2Calculator.js` — **none of these files exist**
- Neither `PluginCostV2` nor `plugin-cost-v2` appears in `pluginRegistry.js` or `modules.config.json`
- `diff` shows only 8 changed lines vs PluginCostComponent — clearly a partial copy

**Action:** Delete both files. No registry or config change needed.

---

### Part 2 — Legacy PluginCostV1 (5 files, ~2,500 LoC)

**Files:**
- `www/js/plugins/PluginCostV1.js` (116 lines) — labelled "Legacy cost analysis plugin"
- `www/js/plugins/PluginCostV1Component.js` (1,583 lines)
- `www/js/plugins/PluginCostV1Calculator.js` (699 lines)
- `www/js/plugins/PluginCostV1.schema.json`
- `tests/plugins/plugin-cost-calculator.test.js` — imports exclusively from `PluginCostV1Calculator.js`

**Evidence it is disabled:**
- `modules.config.json`: `"id": "plugin-cost-v1"`, `"enabled": false`, `"activated": false`
- `PluginCostV1Component.js` carries a `PluginCostCalculator.js` import reference comment saying "see V1Calculator for V1"

**Caution:** `PluginCostV1` is still in `pluginRegistry.js` (imported + mapped). That import must also be removed.  
**Action (requires approval):** Delete 5 files, remove V1 registry entry, remove test file.

---

### Part 3 — Duplicate Test Files (~700 LoC)

| Duplicate pair | Recommended keep | Remove |
|---|---|---|
| `plugin-costv2.test.js` (70L) vs `plugin-cost.test.js` (62L) — both import `PluginCost.js`, describe same class | `plugin-cost.test.js` (shorter, cleaner) | `plugin-costv2.test.js` |
| `PluginCostV2Calculator.test.js` (452L) vs `PluginCostV2Component.test.js` (parts) — both test current `PluginCostCalculator.js` with "V2" in filename | Rename `PluginCostV2Calculator.test.js` → `plugin-cost-calculator.test.js` (after V1 removal in Part 2) | The duplicated V1 test |
| `PluginCostV2Component.test.js` (unknown length) vs `plugin-costv2component.test.js` (133L) — both test `PluginCostComponent` | Keep `PluginCostV2Component.test.js` (larger, more thorough) | `plugin-costv2component.test.js` |
| `SamplePlugin.test.js` (191L) vs `sample-plugin.test.js` (45L) | Keep `SamplePlugin.test.js` (more thorough) | `sample-plugin.test.js` |

---

### Part 4 — Simple Lifecycle Wrapper Boilerplate (~150–180 LoC)

Four plugins share an **identical** ~70-line pattern:
- `PluginEvents.js`, `PluginHistory.js`, `PluginMarkers.js`, `PluginPlanHealth.js`

All four:
1. Have the same constructor fields: `id, config, _el, _componentLoaded, active`
2. Have the same `init()` guard: `if (!isEnabled) return; if (!_componentLoaded) { await import(); _componentLoaded = true; }`
3. Have the same `activate()`: create element → append to `document.body` → call `open()`
4. Have the same `deactivate()`: call `close()`
5. Have the same `destroy()`: `el?.remove(); _el = null; active = false`
6. Have the same `toggle()` and `refresh()` (delegating to el.refresh)

None of them extend the existing `Plugin` base class from `www/js/core/Plugin.js`.

**Approach options:**
- A) Extract a `SimplePlugin` factory function that produces plugin instances from config (component tag, import path, metadata object) — ~30 lines replacing ~280 lines
- B) Add a concrete `SimplePlugin` base class that `PluginEvents`, etc. extend — less radical, keeps each file but removes bodies

**Clarifying questions for this part** (needs architect input before implementation):
1. Will any of these four plugins need custom behavior (extra events, state, etc.) in the near future? If yes, a factory is premature.
2. Is `refresh()` always a simple delegation to `this._el.refresh()`? (Yes for all four — confirmed)
3. Are the `if (!isEnabled('USE_PLUGIN_SYSTEM'))` guards still needed or can they be removed along with consolidation?

---

## Next Steps

Work will proceed one part at a time with explicit approval required before each implementation.

**Current:** Awaiting approval to begin Part 1 (lowest risk, unambiguous dead code).
