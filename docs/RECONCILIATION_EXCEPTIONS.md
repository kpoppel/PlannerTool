# Reconciliation Exceptions

## Decisions

Use **Accept exception** for a deliberate discrepancy, not Reviewed or Ignore.
Acceptance does not correct task data. Any authenticated scenario editor may stage
an acceptance. The agreed live policy permits authenticated editors to publish and
revoke acceptances too; it does not infer authority from plan contacts or teams.

The invalidation policy is whole-task change, not relevant-evidence-only change.
Changes to an involved task, either end of a relationship, recorded links, scenario
overrides, or assessment configuration require renewed acceptance. An unrelated
title edit counts. ADO changes become observable when refreshed cached task data
reaches the application; acceptance cannot establish freshness between refreshes.
Revisions included in task payloads are part of the evidence, as are all other
cached task fields. Byte-identical refreshes do not count as observed changes.

## Scenario Record

Slice 4 stores decisions in the existing opaque scenario extension:

```text
scenario.pluginData['plugin-reconciliation'] = {
  version: 1,
  decisions: [{
    id, identity: { rule, taskId, relatedId, path },
    category, findingTitle, taskTitle, planId, planName,
    actor, acceptedAt, reason, evidence,
    status: 'active' | 'revoked',
    revokedAt?, revocationReason?
  }]
}
```

Identity includes the rule, task, relationship endpoint and relevant path, not
merely the task ID. Evidence is a canonical snapshot of involved cached source
tasks, scenario overrides, and relevant plan/rule configuration. It is not a
security signature. Missing context/informational findings cannot be accepted.
Task/plan labels are retained for the decision summary even if task data changes.

Actor is the remembered signed-in email for provisional scenario attribution.
It is client-controlled and MUST NOT establish live authority or authoritative
audit attribution. Live publication must stamp the authenticated server actor.

Acceptance and undo go through `cmd.pluginScenarioData.set`, making the scenario
dirty even with no task-field changes. Baseline and read-only scenarios cannot
stage decisions. Saving persists decisions only in that user's scenario, through
the existing authenticated scenario endpoint. No live register is written.

The controller tracks saved decision snapshots independently from later scenario
edits. Failed saves retain pending decisions. Edits during an in-flight save stay
dirty; only submitted decisions are reported saved. `ScenarioEvents.SAVED` now
includes the submitted `scenario` alongside `scenarioId` for that distinction.

All loaded scenarios are revalidated when observed source/override data changes
while the plugin runs, including when another scenario is selected. Invalidated
records remain revoked, so task revert does not restore acceptance. Re-enable
validates current evidence before presenting acceptance. The UI cannot detect an
update and revert that both happened while it was disabled or offline and left
no changed source revision; server revision tracking is required for that case.

The check-shield marker has accessible Accepted exception text and separate
pending/saved labels. Remaining findings retain their warning marker; task-change
styling is independent. Acceptance does not remove assessed findings or change
category task counts. The category-filtered Accepted exceptions view includes
active and revoked decisions, actor/time/reason and undo without advancing tasks.
One current decision is retained per finding ID; deliberate reacceptance replaces
its prior revoked entry. Otherwise records remain until the scenario is deleted.
This is decision history, not an append-only compliance audit.

## Live Register Contract (Slice 5)

The live register is a separate server-owned namespace,
`reconciliation_live_exceptions`, in the instance's active-generation storage.
Its key includes stable backend identity, rule, task, relationship and path; task
IDs from different backends or instances cannot collide. Nothing in Slice 4
creates or activates this register, and no client-only baseline storage is used.

Only explicitly selected acceptances included in a successful publication can
enter it. Validate against the resulting live data, after selected successful task
writes, never against unpublished scenario overrides. Reject stale/missing task
evidence. Failed and unselected decisions remain scenario work. Scenario saves,
clones and switches do not make live acceptances effective.

Publication and revocation must use authenticated cookie sessions, stamp server
actor/time, and compare expected source and decision revisions atomically. Stale
concurrent operations return a conflict instead of silently overwriting another
decision. Scenario persistence retains its existing last-writer contract; Slice 4
adds no multi-client merge or locking protocol.

Server-side invalidation must run on cache refresh, backend publication and task/
relationship mutation, independently of whether the UI/plugin is enabled. On reads
and re-enable, validate against current cached revisions before trusting a live
acceptance. ADO changes are first observed during backend cache refresh; the
register cannot claim observation before that refresh. Updating either endpoint
or the path revokes acceptance even if the conflicting dates themselves did not
change. Preserve revoked records for an explicit audit/retention policy; do not
silently reactivate them if tasks revert. A general server-plugin framework is
not required by this contract.

Live shared visibility, atomic concurrency, permissions, server invalidation,
retention policy, partial publication and the full save/publish modal summary are
Slice 5 implementation and verification gates, not delivered Slice 4 behavior.

## Verification

Focused regressions cover acceptance-only saves and failures, edits during saves,
baseline/scenario separation, unrelated plugin edits, changes to either involved
task, observed source updates while viewing Baseline, read-only/input guards,
incomplete assessment rejection, disable/re-enable and mixed marker/undo behavior.
Isolated Chromium fixtures verify desktop 1366px/1024px interaction and the actual
scenario POST envelope. Backend storage tests use an in-memory store, not active
accounts/data, and verify that scenario saves create no shared/live namespace.