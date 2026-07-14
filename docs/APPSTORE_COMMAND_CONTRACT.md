# AppStore Command Contract (Phase 1)

This contract defines the command policy used by implementation phases after mapping is complete.

## 1. Command ownership model

- Commands are the only allowed write path into AppStore.
- Services perform compute and IO only; they return data to commands.
- Selectors are pure derivations over snapshots from `store.getState()`.
- Event emissions are command outputs and occur after successful state commit.

## 2. Command execution envelope

Each command follows the same envelope:

1. Validate payload and required preconditions.
2. Load current snapshot via selectors for decision inputs.
3. Perform external IO through gateways/services when required.
4. Commit exactly one semantic state transition using `store.update(label, reducer)`.
5. Emit domain events after commit.
6. Return deterministic command result payload.

Notes:
- Multi-step writes may use multiple labeled `store.update` calls only when each label represents a distinct atomic state transition.
- Commands must not expose mutable draft references outside reducer scope.

## 3. Transaction label convention

Label format:

`<domain>.<verb>[.<qualifier>]`

Examples:
- `baseline.refresh`
- `feature.updateDates`
- `scenario.activate`
- `group.applyMemberDelta`
- `view.setDisplayMode`

Rules:
- Domain is singular and stable (`application`, `baseline`, `feature`, `selection`, `view`, `scenario`, `group`, `capacity`, `plugin`, `color`).
- Verb is imperative and action-specific.
- Qualifier is optional and only used to disambiguate sub-actions.

## 4. Idempotency classes

Commands are classified for retry behavior:

- Strong idempotent:
  - Repeating with same payload yields same final state and no duplicate external side effects.
  - Typical commands: selection/view setters, expansion toggles, display-mode toggles.
- State idempotent, IO guarded:
  - State commit is idempotent; command must gate duplicate remote writes by key/version.
  - Typical commands: scenario save, group publish, baseline refresh.
- Non-idempotent by design:
  - Creates new identity or explicit append operations.
  - Typical commands: clone scenario, create group.

Each command module must declare its idempotency class in module-level JSDoc.

## 5. Side effect policy

- Bus emissions happen after successful `store.update`.
- For IO failures before commit: no state mutation; emit optional failure event and return typed error.
- For IO failures after local optimistic commit: command must either:
  - perform explicit compensating rollback command, or
  - mark local entity state as `dirty/error` with retry metadata.
- Silent catch-and-drop is not allowed.

## 6. Error contract

- Command returns `{ ok: true, data }` on success.
- Command returns `{ ok: false, error: { code, message, retriable } }` on expected failures.
- Unexpected exceptions are rethrown after adding domain context.

## 7. Selector purity contract

- Selector inputs: snapshot and explicit arguments only.
- Forbidden in selectors: event emission, IO, timer calls, random/time-based mutation, writes.
- Selectors may internally memoize by immutable input identity only if output determinism is preserved.

## 8. Compatibility shell constraints

- Legacy facade methods become thin adapters that call commands/selectors only.
- No new business logic may be added to compatibility methods.
- Any migrated facade method should be deleted from the shell in the next pruning pass.

## 9. UI effect descriptor contract

Some commands may return UI effect descriptors for adapter-driven execution. This
keeps state mutation and UI mutation separate while preserving deterministic command
results.

Descriptor shape:

- `type: 'setSelectedTaskTypes'` + `{ selectedTaskTypes: string[] }`
- `type: 'setGraphType'` + `{ graphType: string }`
- `type: 'setExpansionState'` + `{ expansion: { expandParentChild: boolean, expandRelations: boolean, expandTeamAllocated: boolean } }`
- `type: 'recomputeDataFunnel'`
- `type: 'requestSidebarUpdate'`

Rules:

- Commands/selectors return descriptor objects only; they do not mutate DOM/UI directly.
- Services execute descriptors only via injected UI adapters.
- Direct sidebar/property mutation is forbidden outside adapter implementations.
