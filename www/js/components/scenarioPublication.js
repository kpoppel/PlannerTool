import { cmd, sel } from '../application/imports.js';
import { store } from '../application/store.js';
import { dataService } from '../services/dataService.js';
import { groupService } from '../services/GroupService.js';
import { assessReconciliation } from '../plugins/reconciliation/assessment.js';
import { canonicalEvidence } from '../plugins/reconciliation/exceptions.js';
import { reconciliation } from '../plugins/reconciliation/runtime.js';

export const PUBLISH_FIELDS = ['start', 'end', 'capacity', 'state', 'iterationPath', 'tags'];
const REVERSE_RELATION = { Parent: 'Child', Child: 'Parent', Related: 'Related',
  Predecessor: 'Successor', Successor: 'Predecessor' };

export function publishableFields(localRelations) {
  return localRelations ? [...PUBLISH_FIELDS, 'relations'] : PUBLISH_FIELDS;
}

export function projectPublication({ source, overrides, selected, referencePlanIds,
  projects, hierarchy, today, includeReconciliation = true, localRelations = false }) {
  const sourceById = new Map(source.map((task) => [String(task.id), task]));
  const referencePlans = new Set(referencePlanIds.map(String));
  const writes = [];
  const localOnly = [];
  const publishFields = publishableFields(localRelations);
  for (const [id, override] of Object.entries(overrides)) {
    const localFields = Object.keys(override).filter((field) => !publishFields.includes(field));
    if (localFields.length > 0) localOnly.push({ id, fields: localFields });
    const fields = publishFields.filter((field) => field in override && selected.has(`${id}:${field}`));
    if (fields.length === 0) continue;
    const task = sourceById.get(id);
    if (task === undefined) throw new Error(`Source task ${id} is unavailable`);
    writes.push({ id, project: String(task.project), title: task.title, revision: task.revision,
      classification: referencePlans.has(String(task.project)) ? 'reference-plan' : 'foreign-plan',
      fields: fields.map((field) => ({ field, before: task[field], after: override[field] })) });
  }
  const writesById = new Map(writes.map((write) => [write.id, write]));
  const resultingById = new Map(source.map((task) => {
    const write = writesById.get(String(task.id));
    return [String(task.id), write === undefined ? task : { ...task,
      ...Object.fromEntries(write.fields.map((entry) => [entry.field, entry.after])) }];
  }));
  const relationWrites = writes.filter((write) => write.fields.some((entry) => entry.field === 'relations'));
  const relationOwners = new Set(relationWrites.map((write) => write.id));
  const relationImpact = new Set();
  const foreignRelations = new Set();
  for (const write of relationWrites) {
    const { before, after } = write.fields.find((entry) => entry.field === 'relations');
    for (const link of [...before, ...after]) {
      const targetId = String(link.id);
      const target = resultingById.get(targetId);
      if (target === undefined) continue;
      if (String(target.project) !== write.project) foreignRelations.add(targetId);
      if (relationOwners.has(targetId)) continue;
      const reverse = REVERSE_RELATION[link.type];
      const relations = target.relations.filter((edge) => edge.type !== reverse || String(edge.id) !== write.id);
      if (after.some((edge) => edge.type === link.type && String(edge.id) === targetId)) {
        relations.push({ type: reverse, id: write.id });
      }
      resultingById.set(targetId, { ...target, relations });
      relationImpact.add(targetId);
    }
  }
  const resulting = [...resultingById.values()].map((task) => {
    const identity = String(task.id);
    if (!relationOwners.has(identity) && !relationImpact.has(identity)) return task;
    const parent = task.relations.find((link) => link.type === 'Parent');
    return { ...task, parentId: parent === undefined ? null : parent.id };
  });
  if (!includeReconciliation && !localRelations) {
    return { writes, localOnly, crossPlan: [], findings: [], resulting };
  }
  const findings = includeReconciliation ? assessReconciliation({ features: resulting, sourceFeatures: source,
    scopeIds: new Set(sourceById.keys()), projects, hierarchy, today })
    .filter((finding) => finding.path.some((id) => writesById.has(id) || relationImpact.has(id))) : [];
  const affectedIds = new Set(writes.filter((write) => write.classification === 'foreign-plan')
    .map((write) => write.id));
  for (const id of foreignRelations) affectedIds.add(id);
  for (const finding of findings) {
    const loadedIds = finding.path.filter((id) => sourceById.has(id));
    const planIds = new Set(loadedIds.map((id) => String(sourceById.get(id).project)));
    if (planIds.size > 1) {
      for (const id of loadedIds) affectedIds.add(id);
    }
  }
  const crossPlan = [...affectedIds].map((id) => ({
    id, title: sourceById.get(id).title, project: String(sourceById.get(id).project),
    written: writesById.has(id), findings: findings.filter((finding) => finding.path.includes(id)) }));
  return { writes, localOnly, crossPlan, findings, resulting };
}
export function buildPublishModalStateAdapter() {
  const baselineFeatures = sel.feature.getBaselineFeatures();
  const teams = sel.selection.getTeams();
  const projects = sel.selection.getProjects();
  const featuresById = new Map(
    sel.feature.getEffectiveFeatures().map((feature) => [String(feature.id), feature])
  );
  for (const feature of baselineFeatures) {
    const key = String(feature.id);
    if (!featuresById.has(key)) featuresById.set(key, feature);
  }

  return {
    baselineFeatures,
    teams,
    projects,
    getFeatureTitleById: (id) => {
      const feature = featuresById.get(String(id));
      if (feature === undefined) return String(id);
      return feature.title;
    },
  };
}

function publicationContext() {
  const projects = sel.selection.getProjects();
  const now = new Date();
  return { source: sel.feature.getBaselineFeatures(),
    referencePlanIds: projects.filter((project) => project.selected).map((project) => String(project.id)),
    projects, hierarchy: sel.feature.getTaskTypeHierarchy(),
    today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` };
}

function reviewLocalWrites(context, features) {
  const overrides = Object.fromEntries(features.map(({ id, ...fields }) => [id, fields]));
  const selected = new Set(features.flatMap(({ id, ...fields }) =>
    Object.keys(fields).map((field) => `${id}:${field}`)));
  return projectPublication({ ...context, overrides, selected,
    includeReconciliation: reconciliation.snapshot.status !== 'inactive' });
}

function reviewImpact(review) {
  return canonicalEvidence({ findings: review.findings,
    writes: review.writes.map(({ id, project, classification }) => ({ id, project, classification })),
    crossPlan: review.crossPlan.map(({ id, project }) => ({ id, project })) });
}

function localWritePayload(writes) {
  return writes.map(({ id, revision, fields }) => {
    if (!Number.isInteger(revision) || revision < 1 || fields.some(({ before }) => before === undefined)) {
      throw new Error(`The reviewed revision or field values are unavailable for task ${id}`);
    }
    return { id, ...Object.fromEntries(fields.map(({ field, after }) => [field, after])),
      base: { revision, fields: Object.fromEntries(fields.map(({ field, before }) => [field, before])) } };
  });
}


export async function publishScenario(scenario) {
  if (!sel.scenario.getScenarioAccess(scenario.id).canEdit) {
    return { ok: false, error: { code: 'scenario_read_only', message: 'Scenario is read-only' } };
  }
  if (sel.scenario.getActiveScenarioId() !== scenario.id) {
    return { ok: false, error: { code: 'scenario_changed', message: 'Activate the scenario before publishing' } };
  }
  let invalidated = false;
  const unsubscribe = store.subscribe((state) => state.scenarios, (next) => {
    if (next.activeId !== scenario.id || !sel.scenario.getScenarioAccess(scenario.id).canEdit) invalidated = true;
  });
  const assertCurrent = () => {
    if (invalidated || !sel.scenario.getScenarioAccess(scenario.id).canEdit) {
      throw new Error('Publication stopped because the scenario or edit access changed. Review again before publishing.');
    }
  };
  try {
    const fullScenarios = sel.scenario.getScenarios();
    const fullScenario = fullScenarios.find((s) => s.id === scenario.id);
    const overrides = fullScenario.overrides;
    const pendingGroupChanges = sel.group.getPendingGroupChanges();
    const hasFeatureChanges = Object.keys(overrides).length > 0;
    const hasGroupChanges = pendingGroupChanges.length > 0;
    const decisions = reconciliation.decisionSummary(fullScenario);
    if (!hasFeatureChanges && !hasGroupChanges && decisions.length === 0) {
      console.log('[ScenarioMenu] No changes to save');
      return { ok: true, data: { cancelled: true } };
    }

    const backend = await dataService.getTaskBackend();
    assertCurrent();
    if (!backend.ok) throw new Error(backend.error.message);
    const { capabilities } = backend.data;
    const fieldMerge = capabilities.includes('field_merge');
    const getContext = () => ({ ...publicationContext(), localRelations: capabilities.includes('relations_publish') });
    let context = getContext();
    let conflicts = [];
    let features, groupChanges;
    const { openPublishScenarioModal } = await import('./modalHelpers.js');
    for (;;) {
      assertCurrent();
      const result = await openPublishScenarioModal({ overrides, pendingGroupChanges,
        state: buildPublishModalStateAdapter(), decisions, publicationContext: context, conflicts });
      assertCurrent();
      if (result === null) return { ok: true, data: { cancelled: true } };
      ({ features = [], groupChanges = [] } = result);
      if (features.length === 0 && groupChanges.length === 0) {
        return { ok: true, data: { cancelled: true } };
      }
      const reviewed = fieldMerge ? reviewLocalWrites(context, features) : canonicalEvidence(context);
      await cmd.scenario.invalidateAndRefreshBaseline();
      assertCurrent();
      const current = getContext();
      if (!fieldMerge) {
        if (canonicalEvidence(current) !== reviewed) {
          throw new Error('Source data changed since review. Review the scenario again before publishing.');
        }
        break;
      }
      const currentIds = new Set(current.source.map((task) => String(task.id)));
      const available = features.filter(({ id }) => currentIds.has(String(id)));
      if (reviewImpact(reviewLocalWrites(current, available)) !== reviewImpact(reviewed)) {
        throw new Error('Publication impact changed since review. Review the scenario again before publishing.');
      }
      if (features.length === 0) break;
      const published = await dataService.publishBaseline(localWritePayload(reviewed.writes));
      assertCurrent();
      if (!published.ok && published.error.code === 'task_conflict') {
        conflicts = published.error.detail.conflicts;
        await cmd.scenario.refreshBaseline();
        assertCurrent();
        context = getContext();
        continue;
      }
      if (!published.ok) throw new Error(published.error.message);
      if (published.data.errors.length > 0) {
        throw new Error(`Feature publishing failed: ${published.data.errors.join('; ')}`);
      }
      break;
    }

    // 1. Persist accepted group changes.
    //    - create (from scenario.scenarioGroups): POST → get real ID → promote out of the scenario
    //    - update (baseline group fields): PUT /api/groups/{id}
    //    - update with members (from groupOverrides): included in PUT payload
    //    - delete: DELETE /api/groups/{id} → drop the override
    const affectedPlanIds = new Set();
    // Sub-groups created in the same batch reference their parent by temp id.
    const realIdByTempId = new Map();
    try {
      for (const op of groupChanges) {
        assertCurrent();
        if (op.type === 'create' && op.group) {
          // op.group.members is the selected list produced by the publishing modal.
          const committedMembers = new Set(op.group.members.map(String));
          // Original members include those deselected in the publishing modal.
          const originalGroup = pendingGroupChanges.find((change) =>
            change.type === 'create' && String(change.group.id) === String(op.group.id)
          ).group;
          const originalMembers = originalGroup.members.map(String);

          const parentId = op.group.parent_id;
          const payload = {
            plan_id: op.group.plan_id,
            name: op.group.name,
            color: op.group.color === undefined ? null : op.group.color,
            rank: op.group.rank,
            parent_id: parentId === null || parentId === undefined
              ? null
              : (realIdByTempId.has(String(parentId))
                ? realIdByTempId.get(String(parentId)) : String(parentId)),
            members: [...committedMembers],
          };
          const created = await dataService.createGroup(payload);
          assertCurrent();
          if (!created.ok) throw new Error(created.error.message);
          const realId = String(created.data.id);
          realIdByTempId.set(String(op.group.id), realId);
          // Uncommitted members stay pending against the now-real group.
          const uncommittedMembers = originalMembers.filter((tid) => !committedMembers.has(tid));
          cmd.group.promoteGroupToBaseline(op.group.id, realId, uncommittedMembers);
          affectedPlanIds.add(String(op.group.plan_id));
        } else if (op.type === 'update' && op.groupId) {
          const updatePayload = { ...op.fields };
          const memberDeltas = op.memberDeltas === undefined ? [] : op.memberDeltas;

          // Apply accepted deltas to baseline membership, not the effective override.
          if (memberDeltas.length > 0) {
            const baseGroup = sel.group.getBaselineGroupById(op.groupId);
            const baseMembers = new Set(baseGroup.members.map(String));
            for (const { taskId, op: delta } of memberDeltas) {
              if (delta === 'add') baseMembers.add(String(taskId));
              else baseMembers.delete(String(taskId));
            }
            updatePayload.members = [...baseMembers];
          }

          const updated = await dataService.updateGroup(op.groupId, updatePayload);
          assertCurrent();
          if (!updated.ok) throw new Error(updated.error.message);

          // Drop only committed deltas; other pending edits stay.
          cmd.group.clearGroupOverride(op.groupId, memberDeltas.map((delta) => String(delta.taskId)));
          const group = sel.group.getBaselineGroupById(op.groupId);
          affectedPlanIds.add(String(group.plan_id));
        } else if (op.type === 'delete' && op.groupId) {
          const group = sel.group.getBaselineGroupById(op.groupId);
          const deleted = await dataService.deleteGroup(op.groupId);
          assertCurrent();
          if (!deleted.ok) throw new Error(deleted.error.message);
          affectedPlanIds.add(String(group.plan_id));
          cmd.group.clearGroupOverride(op.groupId, null);
        }
        const saved = await cmd.scenario.saveScenario(scenario.id);
        assertCurrent();
        if (!saved.ok) throw new Error(saved.error.message);
      }
    } finally {
      if (affectedPlanIds.size > 0) {
        for (const planId of affectedPlanIds) {
          groupService.evictPlan(planId);
        }
        await groupService.loadGroupsForPlans([...affectedPlanIds]);
      }
    }

    // 2. Persist accepted feature overrides.
    if (!fieldMerge && features.length > 0) {
      assertCurrent();
      const published = await dataService.publishBaseline(features);
      assertCurrent();
      if (!published.ok) throw new Error(published.error.message);
      if (published.data.errors.length > 0) {
        if (published.data.updated > 0) await cmd.scenario.refreshBaseline();
        throw new Error(`Feature publishing failed: ${published.data.errors.join('; ')}`);
      }
      console.log('[ScenarioMenu] Saved feature changes', features);
    }

    // 3. Save the scenario to disk whenever anything was committed so the
    //    stored overrides and pendingGroupChanges reflect the new data.
    //    This prevents stale temp IDs, already-deleted groups, and already-
    //    committed overrides from reappearing after a page reload.
    if (features.length > 0) {
      assertCurrent();
      const saved = await cmd.scenario.saveScenario(scenario.id);
      assertCurrent();
      if (!saved.ok) throw new Error(saved.error.message);
    }

    // 4. Refresh baseline so the board reflects the now-persisted data.
    if (features.length > 0 || groupChanges.length > 0) {
      try {
        await cmd.scenario.refreshBaseline();
        console.log('[ScenarioMenu] Baseline refreshed after save');
      } catch (refreshErr) {
        console.warn('[ScenarioMenu] Baseline refresh failed:', refreshErr);
      }
    }
    return { ok: true, data: { features, groupChanges } };
  } catch (err) {
    console.error('[ScenarioMenu] Failed to save:', err);
    return { ok: false, error: { message: err.message } };
  } finally {
    unsubscribe();
  }
}
