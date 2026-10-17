---
applyTo: "www/js/**/*.js"
---

# Strict Fail-Fast Contracts (LLM Agent Instruction)

## Purpose
Prevent defensive code patterns that hide real failures in internal application logic.

This instruction is mandatory for all agent-generated edits in `www/js`.

## Core Policy
1. Internal contracts must fail fast.
2. Do not add robustness patterns for code paths we own end-to-end.
3. Use tests to prove invariants instead of fallbacks.

## Forbidden In Internal Contracts
Applies to internal seams and first-party consumers:
- `www/js/application/**`
- `www/js/components/**`
- `www/js/plugins/**` when calling `cmd.*`, `sel.*`, store, bus, or other first-party APIs

Do not add, and remove when touched:
1. Optional seam calls:
- `sel.x?.y?.(...)`
- `cmd.x?.y?.(...)`
2. Silent defaults masking missing contracts:
- `sel.*(...) || []`
- `sel.*(...) || {}`
- `sel.*(...) || null`
- `x ?? defaultValue` where `x` must be guaranteed by contract
3. Function-existence checks for known internal APIs:
- `if (typeof something === 'function') ...` for first-party symbols that are required by design
- `instanceof Function` for required internal symbols

Required behavior instead:
- Call internal APIs directly.
- Let violations fail in test/dev.
- Add or update tests to enforce the expected contract.

## Allowed Boundary Guards (Must Be Commented)
Guards are allowed only at explicit boundaries where variability is real.

1. External payload boundary (API/storage/network inputs)
Required comment:
- `Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.`

2. Plugin capability boundary (optional plugin methods by contract)
Required comment:
- `Capability guard: plugin method is optional by plugin contract; call only when implemented.`

3. DOM/custom-element lifecycle boundary (not connected/upgraded yet)
Required comment:
- `Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.`

4. Platform feature detection boundary (browser/runtime support differences)
Required comment:
- `Platform guard: API availability differs across runtimes; this branch preserves compatible behavior.`

If a guard does not match one of these four boundary classes, remove it.

## PR/Change Checklist For Agents
Before finalizing any change:
1. Search touched files for:
- `?.`
- `??`
- `typeof ... === 'function'`
- `instanceof Function`
- `|| []`, `|| {}`, `|| null`
2. For each hit:
- Remove it if internal-contract code.
- Keep it only if boundary-required, and add the exact required comment.
3. Add/adjust tests so missing internal contracts fail loudly.

## Priority Targets (First Cleanup Slices)
1. `www/js/components/Sidebar.lit.js`
2. `www/js/components/FeatureBoard.lit.js`
3. `www/js/plugins/PluginExportTimelineComponent.js`
4. `www/js/application/selectors/selectionSelectors.js`
5. `www/js/application/commands/viewCommands.js`
6. `www/js/application/commands/viewRestoreCommands.js`

## Source Assessment
See supporting assessment and inventories:
- `backup/architecture_v6/ROBUSTNESS_PATTERN_ASSESSMENT.md`
- `backup/architecture_v6/inventories/`
