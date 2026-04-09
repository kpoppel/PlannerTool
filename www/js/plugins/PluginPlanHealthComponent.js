/**
 * PluginPlanHealthComponent - Detects and displays plan health issues
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import {
  FeatureEvents,
  ProjectEvents,
  TeamEvents,
  TimelineEvents,
} from '../core/EventRegistry.js';
import { state } from '../services/State.js';
import { findInBoard } from '../components/board-utils.js';
import { pluginManager } from '../core/PluginManager.js';

export class PluginPlanHealthComponent extends LitElement {
  static properties = {
    visible: { type: Boolean },
    checks: { type: Array },
    loading: { type: Boolean },
    collapsedSections: { type: Object },
  };

  constructor() {
    super();
    this.visible = false;
    this.checks = []; // Array of check results with { id, name, issues: [...] }
    this.loading = false;
    // Start with all sections collapsed by default for overview
    this.collapsedSections = {
      'parent-child-dates': true,
      'ghosted-children': true,
      'parent-child-teams': true,
      orphans: true,
      'hierarchy-violations': true,
      'dependency-violations': true,
      'state-consistency': true,
    };
  }

  static styles = css`
    :host {
      display: none;
      position: fixed;
      z-index: 200;
      pointer-events: none;
    }

    :host([visible]) {
      display: block;
    }

    .floating-toolbar {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      pointer-events: auto;
      z-index: 200;
      min-width: 280px;
      max-width: 400px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .toolbar-title {
      font-size: 14px;
      font-weight: 600;
      color: #333;
      margin-bottom: 12px;
    }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      border: none;
      color: #999;
      font-size: 16px;
      cursor: pointer;
      border-radius: 4px;
      margin: 0;
    }

    .close-btn:hover {
      color: #333;
      background: #f0f0f0;
    }

    .refresh-btn {
      padding: 6px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 12px;
      margin-bottom: 12px;
      width: 100%;
    }

    .refresh-btn:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }

    .issue-count {
      font-size: 12px;
      padding: 8px 0;
      color: #666;
      margin-bottom: 8px;
    }

    .issue-count.has-issues {
      color: #d32f2f;
      font-weight: 600;
    }

    .issue-count.no-issues {
      color: #2e7d32;
    }

    .check-section {
      margin-bottom: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    }

    .check-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: #f5f5f5;
      cursor: pointer;
      user-select: none;
      transition: background 0.2s;
    }

    .check-header:hover {
      background: #eeeeee;
    }

    .check-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .check-name {
      font-size: 13px;
      font-weight: 600;
      color: #333;
    }

    .check-badge {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }

    .check-badge.has-issues {
      background: #ffebee;
      color: #d32f2f;
    }

    .check-badge.no-issues {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .check-toggle {
      font-size: 12px;
      color: #666;
      transition: transform 0.2s;
    }

    .check-toggle.collapsed {
      transform: rotate(-90deg);
    }

    .check-content {
      max-height: 400px;
      overflow-y: auto;
      transition: max-height 0.3s ease-out;
    }

    .check-content.collapsed {
      max-height: 0;
      overflow: hidden;
    }

    .issues-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .issue-item {
      padding: 10px;
      margin-bottom: 8px;
      border-left: 4px solid #ff9800;
      background: #fff3e0;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .issue-item:hover {
      background: #ffe0b2;
    }

    .issue-item.severity-error {
      border-left-color: #d32f2f;
      background: #ffebee;
    }

    .issue-item.severity-error:hover {
      background: #ffcdd2;
    }

    .issue-item.severity-warning {
      border-left-color: #ff9800;
      background: #fff3e0;
    }

    .issue-item.severity-warning:hover {
      background: #ffe0b2;
    }

    .issue-type {
      font-size: 11px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .issue-title {
      font-size: 13px;
      font-weight: 500;
      color: #333;
      margin-bottom: 4px;
    }

    .issue-description {
      font-size: 12px;
      color: #666;
      line-height: 1.4;
    }

    .loading {
      text-align: center;
      padding: 20px;
      color: #999;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    // Listen for feature updates to re-check health
    this._featureListener = () => {
      if (this.visible) {
        requestAnimationFrame(() => this._checkHealth());
      }
    };

    bus.on(FeatureEvents.UPDATED, this._featureListener);
    bus.on(ProjectEvents.CHANGED, this._featureListener);
    bus.on(TeamEvents.CHANGED, this._featureListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this._featureListener) {
      bus.off(FeatureEvents.UPDATED, this._featureListener);
      bus.off(ProjectEvents.CHANGED, this._featureListener);
      bus.off(TeamEvents.CHANGED, this._featureListener);
    }
  }

  open() {
    this.visible = true;
    this.setAttribute('visible', '');
    this._checkHealth();
  }

  close() {
    this.visible = false;
    this.removeAttribute('visible');
  }

  async refresh() {
    await this._checkHealth();
  }

  /**
   * Check for parent features where children have dates exceeding parent's date range
   * Skips ghosted (unplanned) cards and only checks visible features
   */
  _checkParentChildDateMismatches(features, childrenByParent, visibleIds) {
    const issues = [];

    // Create a feature lookup map for quick access
    const featureMap = new Map(features.map((f) => [String(f.id), f]));

    // Iterate through all features that have children
    for (const [parentId, childIds] of childrenByParent.entries()) {
      if (!childIds || childIds.length === 0) continue;

      const parentIdStr = String(parentId);

      // Skip if parent is not visible
      if (!visibleIds.has(parentIdStr)) continue;

      const parent = featureMap.get(parentIdStr);
      if (!parent || !parent.start || !parent.end) continue; // Skip if parent has no dates

      const parentStart = new Date(parent.start);
      const parentEnd = new Date(parent.end);

      // Check each child
      for (const childId of childIds) {
        const childIdStr = String(childId);

        // Skip if child is not visible
        if (!visibleIds.has(childIdStr)) continue;

        const child = featureMap.get(childIdStr);
        if (!child) continue;

        // Skip ghosted children - they're unplanned so date mismatches are expected
        if (!child.start || !child.end) continue;

        const childStart = new Date(child.start);
        const childEnd = new Date(child.end);

        // Check if child dates exceed parent dates
        const startsBefore = childStart < parentStart;
        const endsAfter = childEnd > parentEnd;

        if (startsBefore || endsAfter) {
          let description = '';
          if (startsBefore && endsAfter) {
            description = `Child "${child.title}" (${child.start} → ${child.end}) starts before and ends after parent "${parent.title}" (${parent.start} → ${parent.end})`;
          } else if (startsBefore) {
            description = `Child "${child.title}" starts ${child.start}, before parent "${parent.title}" starts ${parent.start}`;
          } else {
            description = `Child "${child.title}" ends ${child.end}, after parent "${parent.title}" ends ${parent.end}`;
          }

          // Ensure IDs are stored as strings for consistent matching
          issues.push({
            type: 'parent-child-dates',
            severity: 'warning',
            title: 'Child dates exceed parent',
            description,
            parentId: parentIdStr,
            childId: childIdStr,
            featureId: childIdStr, // Navigate to the child when clicked
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check for unplanned (ghosted) children where the parent is planned
   * Only checks visible features
   */
  _checkGhostedChildrenWithPlannedParent(features, childrenByParent, visibleIds) {
    const issues = [];

    // Create a feature lookup map for quick access
    const featureMap = new Map(features.map((f) => [String(f.id), f]));

    // Iterate through all features that have children
    for (const [parentId, childIds] of childrenByParent.entries()) {
      if (!childIds || childIds.length === 0) continue;

      const parentIdStr = String(parentId);

      // Skip if parent is not visible
      if (!visibleIds.has(parentIdStr)) continue;

      const parent = featureMap.get(parentIdStr);
      // Only check parents that are planned (have dates)
      if (!parent || !parent.start || !parent.end) continue;

      // Check each child
      for (const childId of childIds) {
        const childIdStr = String(childId);

        // Skip if child is not visible
        if (!visibleIds.has(childIdStr)) continue;

        const child = featureMap.get(childIdStr);
        if (!child) continue;

        // Check if child is ghosted (unplanned - no start or end date)
        const isGhosted = !child.start || !child.end;

        if (isGhosted) {
          issues.push({
            type: 'ghosted-child',
            severity: 'warning',
            title: 'Unplanned child of planned parent',
            description: `Child "${child.title}" is unplanned but parent "${parent.title}" is scheduled (${parent.start} → ${parent.end})`,
            parentId: parentIdStr,
            childId: childIdStr,
            featureId: childIdStr, // Navigate to the child when clicked
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check for parent-child team allocation mismatches
   * Verifies that parent teams match child teams (not checking percentages)
   */
  _checkParentChildTeamMismatches(features, childrenByParent, visibleIds) {
    const issues = [];

    // Create a feature lookup map for quick access
    const featureMap = new Map(features.map((f) => [String(f.id), f]));

    // Iterate through all features that have children
    for (const [parentId, childIds] of childrenByParent.entries()) {
      if (!childIds || childIds.length === 0) continue;

      const parentIdStr = String(parentId);

      // Skip if parent is not visible
      if (!visibleIds.has(parentIdStr)) continue;

      const parent = featureMap.get(parentIdStr);
      if (!parent) continue;

      // Get parent team IDs from capacity array
      const parentTeamIds = new Set();
      if (parent.capacity && Array.isArray(parent.capacity)) {
        parent.capacity.forEach((c) => {
          if (c.team) parentTeamIds.add(String(c.team));
        });
      }

      // Skip if parent has no team allocations
      if (parentTeamIds.size === 0) continue;

      // Collect all team IDs from children
      const childTeamIds = new Set();
      const childrenWithTeams = [];

      for (const childId of childIds) {
        const childIdStr = String(childId);

        // Skip if child is not visible
        if (!visibleIds.has(childIdStr)) continue;

        const child = featureMap.get(childIdStr);
        if (!child) continue;

        // Get child team IDs
        if (child.capacity && Array.isArray(child.capacity)) {
          child.capacity.forEach((c) => {
            if (c.team) {
              childTeamIds.add(String(c.team));
              if (!childrenWithTeams.includes(child)) {
                childrenWithTeams.push(child);
              }
            }
          });
        }
      }

      // Skip if no children have team allocations
      if (childTeamIds.size === 0) continue;

      // Check for teams on parent not used by any child
      const parentOnlyTeams = [...parentTeamIds].filter((tid) => !childTeamIds.has(tid));

      // Check for teams used by children but not on parent
      const childOnlyTeams = [...childTeamIds].filter((tid) => !parentTeamIds.has(tid));

      if (parentOnlyTeams.length > 0) {
        // Get team names for better error messages
        const teamNames = parentOnlyTeams
          .map((tid) => {
            const teamCap = parent.capacity.find((c) => String(c.team) === tid);
            return teamCap ? this._getTeamName(tid) : tid;
          })
          .join(', ');

        issues.push({
          type: 'parent-child-teams',
          severity: 'warning',
          title: 'Parent has teams not in children',
          description: `Parent "${parent.title}" has team allocation(s) for ${teamNames}, but no children use these teams`,
          parentId: parentIdStr,
          featureId: parentIdStr,
        });
      }

      if (childOnlyTeams.length > 0) {
        // Get team names for better error messages
        const teamNames = childOnlyTeams.map((tid) => this._getTeamName(tid)).join(', ');

        issues.push({
          type: 'parent-child-teams',
          severity: 'warning',
          title: 'Children use teams not on parent',
          description: `Children of "${parent.title}" use ${teamNames}, but parent has no allocation for these teams`,
          parentId: parentIdStr,
          featureId: parentIdStr,
        });
      }
    }

    return issues;
  }

  /**
   * Helper to get team name from team ID
   */
  _getTeamName(teamId) {
    try {
      const teams = state.teams || [];
      const team = teams.find((t) => String(t.id) === String(teamId));
      return team ? team.name : `Team ${teamId}`;
    } catch (e) {
      return `Team ${teamId}`;
    }
  }

  /**
   * Check for orphaned features/epics in team plans.
   * - Epics that belong to a team plan but have no parent epic which is in a project plan
   * - Features (non-epics) that belong to a team plan but have no parent epic
   */
  _checkOrphans(features, childrenByParent, visibleIds) {
    const issues = [];

    try {
      const allFeatures = state.getEffectiveFeatures ? state.getEffectiveFeatures() : [];
      const featureMap = new Map(allFeatures.map((f) => [String(f.id), f]));

      const projects = state.projects || [];
      const projectMap = new Map((projects || []).map((p) => [String(p.id), p]));

      // Find all plan ids that are type 'team'
      const teamPlanIds = new Set(
        (projects || []).filter((p) => String(p.type) === 'team').map((p) => String(p.id))
      );

      // Determine the minimum (top) hierarchy level present per team plan among visible
      // features.  Items at that level are the natural root of the plan and are never
      // flagged as orphans even when they have no parent.
      const planMinLevel = new Map(); // planId → min type-level number
      for (const feature of features) {
        if (!visibleIds.has(String(feature.id))) continue;
        const projectIdStr = feature.project ? String(feature.project) : null;
        if (!projectIdStr || !teamPlanIds.has(projectIdStr)) continue;
        const level = state.getTypeLevel(feature.type);
        const current = planMinLevel.get(projectIdStr);
        if (current === undefined || level < current) {
          planMinLevel.set(projectIdStr, level);
        }
      }

      for (const feature of features) {
        const featureIdStr = String(feature.id);

        // Only consider visible features
        if (!visibleIds.has(featureIdStr)) continue;

        const projectIdStr = feature.project ? String(feature.project) : null;
        if (!projectIdStr || !teamPlanIds.has(projectIdStr)) continue;

        const typeLevel = state.getTypeLevel(feature.type);
        const topLevel = planMinLevel.get(projectIdStr) ?? 9999;

        // Top-level type for this plan: not flagged as orphan
        if (typeLevel === topLevel) continue;

        const typeLabel =
          state.getTypeDisplayName(feature.type) ||
          (feature.type ?
            feature.type.charAt(0).toUpperCase() + feature.type.slice(1)
          : 'Item');

        const parentId = feature.parentId || null;
        if (!parentId) {
          issues.push({
            featureId: feature.id,
            type: 'Orphan',
            title: `Orphaned ${typeLabel}`,
            description: `${typeLabel} has no parent (expected a parent for a non-root item in this plan)`,
            severity: 'warning',
          });
          continue;
        }

        const parent = featureMap.get(String(parentId));
        if (!parent) {
          issues.push({
            featureId: feature.id,
            type: 'Orphan',
            title: `Orphaned ${typeLabel}`,
            description: `${typeLabel} has a parent ID but the parent cannot be found`,
            severity: 'warning',
          });
        }
        // If parent exists the item is not orphaned — hierarchy correctness is
        // checked separately by _checkHierarchyViolations.
      }
    } catch (e) {
      console.error('[PlanHealth] Error checking orphans:', e);
    }

    return issues;
  }

  /**
   * Check for hierarchy violations: parenting relationships that contradict the
   * configured task-type hierarchy (same-level parenting, or reverse parenting).
   *
   * This is separate from orphan detection:
   *   - Orphan check: item has no valid parent
   *   - Hierarchy check: item has a parent, but the parent's type is wrong
   *
   * @param {Array} features - visible feature list
   * @param {Set<string>} visibleIds
   * @returns {Array} issues
   */
  _checkHierarchyViolations(features, visibleIds) {
    const issues = [];

    try {
      const hierarchy = state.taskTypeHierarchy;
      if (!hierarchy || hierarchy.length === 0) return issues; // no hierarchy configured

      const allFeatures = state.getEffectiveFeatures ? state.getEffectiveFeatures() : [];
      const featureMap = new Map(allFeatures.map((f) => [String(f.id), f]));

      const projects = state.projects || [];
      const projectMap = new Map((projects || []).map((p) => [String(p.id), p]));

      const teamPlanIds = new Set(
        (projects || []).filter((p) => String(p.type) === 'team').map((p) => String(p.id))
      );

      // Determine the minimum (top) hierarchy level present per team plan among visible
      // features.  Items at that level MUST be anchored to a project-type plan.
      const planMinLevel = new Map(); // planId → min type-level number
      for (const feature of features) {
        if (!visibleIds.has(String(feature.id))) continue;
        const planId = feature.project ? String(feature.project) : null;
        if (!planId || !teamPlanIds.has(planId)) continue;
        const level = state.getTypeLevel(feature.type);
        const current = planMinLevel.get(planId);
        if (current === undefined || level < current) {
          planMinLevel.set(planId, level);
        }
      }

      for (const feature of features) {
        const featureIdStr = String(feature.id);
        if (!visibleIds.has(featureIdStr)) continue;

        const planId = feature.project ? String(feature.project) : null;
        const typeLevel = state.getTypeLevel(feature.type);
        const typeLabel =
          state.getTypeDisplayName(feature.type) || feature.type || 'Item';

        // ----------------------------------------------------------------
        // Check A: top-level item in a team plan must have a parent in a
        // project-type plan.  Without it the team plan floats unanchored.
        //
        // Only fires for items at the plan's minimum hierarchy level that
        // have no resolvable parent (no parentId, or parentId not in feature
        // map).  Items that DO have an existing parent (even a wrong-type
        // parent) are handed off to Check B, which will flag the cross-type
        // violation there instead.
        // ----------------------------------------------------------------
        let isTopLevelAnchoredToProject = false;
        if (planId && teamPlanIds.has(planId)) {
          const topLevel = planMinLevel.get(planId) ?? 9999;
          if (typeLevel === topLevel) {
            const parentId = feature.parentId || null;
            const parent = parentId ? featureMap.get(String(parentId)) : null;

            if (parent) {
              // Parent found — check if it's in a project-type plan.
              // If yes, this is properly anchored; skip Check B (same-type
              // cross-plan anchoring is intentional, not a hierarchy error).
              // If no (parent is in a team plan etc.), let Check B flag it.
              const parentPlanId = parent.project ? String(parent.project) : null;
              const parentPlan = parentPlanId ? projectMap.get(parentPlanId) : null;
              if (parentPlan != null && String(parentPlan.type) === 'project') {
                isTopLevelAnchoredToProject = true;
              }
              // else: parent in wrong plan type → Check B will catch it
            } else {
              // No parent or parent not resolvable → unanchored root
              issues.push({
                featureId: feature.id,
                type: 'HierarchyViolation',
                title: `Unanchored ${typeLabel}`,
                description: `${typeLabel} is the top-level type in this team plan but has no parent in a project plan (the team plan is not connected to a project)`,
                severity: 'warning',
              });
            }
          }
        }

        // Skip Check B for top-level items correctly anchored to a project plan
        // (e.g., team-Epic parented by a project-Epic — same type is expected).
        if (isTopLevelAnchoredToProject) continue;

        // ----------------------------------------------------------------
        // Check B: items with a parent → validate parent type is higher in
        // the hierarchy (existing same-level / reverse-parenting checks).
        // ----------------------------------------------------------------
        const parentId = feature.parentId || null;
        if (!parentId) continue;

        const parent = featureMap.get(String(parentId));
        if (!parent) continue; // orphan check handles missing parent

        const childLevel = typeLevel;
        const parentLevel = state.getTypeLevel(parent.type);

        // If either type is unknown (9999) skip — we cannot evaluate hierarchy
        // for types not present in the configuration.
        if (childLevel === 9999 || parentLevel === 9999) continue;

        const parentTypeLabel =
          state.getTypeDisplayName(parent.type) || parent.type || 'Item';

        if (parentLevel === childLevel) {
          issues.push({
            featureId: feature.id,
            type: 'HierarchyViolation',
            title: `Hierarchy Violation: ${typeLabel}`,
            description: `${typeLabel} is parented by another ${parentTypeLabel} (same hierarchy level — expected a higher-level parent)`,
            severity: 'warning',
          });
        } else if (parentLevel > childLevel) {
          // Parent is deeper in the hierarchy than the child → reverse parenting
          issues.push({
            featureId: feature.id,
            type: 'HierarchyViolation',
            title: `Hierarchy Violation: ${typeLabel}`,
            description: `${typeLabel} is parented by ${parentTypeLabel} which is at a lower hierarchy level (reverse parenting)`,
            severity: 'warning',
          });
        }
        // parentLevel < childLevel → correct hierarchy, no issue
      }
    } catch (e) {
      console.error('[PlanHealth] Error checking hierarchy violations:', e);
    }

    return issues;
  }

  /**
   * Check for dependency date violations
   * Verifies that tasks don't start before their predecessors or after their successors
   */
  _checkDependencyDateViolations(features, visibleIds) {
    const issues = [];

    // Create a feature lookup map for quick access
    const featureMap = new Map(features.map((f) => [String(f.id), f]));

    for (const feature of features) {
      const featureIdStr = String(feature.id);

      // Skip if feature is not visible
      if (!visibleIds.has(featureIdStr)) continue;

      // Skip if feature has no start date
      if (!feature.start) continue;

      // Skip if feature has no relations
      if (!feature.relations || !Array.isArray(feature.relations)) continue;

      const featureStartDate = new Date(feature.start);

      for (const rel of feature.relations) {
        let otherId = null;
        let relType = 'Related';

        // Parse relation format (can be string/number or object)
        if (typeof rel === 'string' || typeof rel === 'number') {
          otherId = String(rel);
          relType = 'Predecessor';
        } else if (rel && rel.id) {
          otherId = String(rel.id);
          relType = rel.type || rel.relationType || 'Related';
        } else {
          continue;
        }

        // Only check Predecessor and Successor relations
        if (relType !== 'Predecessor' && relType !== 'Successor') continue;

        // Skip if related feature is not visible
        if (!visibleIds.has(otherId)) continue;

        const otherFeature = featureMap.get(otherId);
        if (!otherFeature || !otherFeature.start) continue;

        const otherStartDate = new Date(otherFeature.start);

        if (relType === 'Predecessor') {
          // Feature should not start before its predecessor
          if (featureStartDate < otherStartDate) {
            issues.push({
              type: 'dependency-violation',
              severity: 'warning',
              title: 'Task starts before predecessor',
              description: `"${feature.title}" starts ${feature.start}, before its predecessor "${otherFeature.title}" starts ${otherFeature.start}`,
              featureId: featureIdStr,
              relatedId: otherId,
            });
          }
        } else if (relType === 'Successor') {
          // Feature should not start after its successor
          if (featureStartDate > otherStartDate) {
            issues.push({
              type: 'dependency-violation',
              severity: 'warning',
              title: 'Task starts after successor',
              description: `"${feature.title}" starts ${feature.start}, after its successor "${otherFeature.title}" starts ${otherFeature.start}`,
              featureId: featureIdStr,
              relatedId: otherId,
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Check for state consistency issues
   * 1. Tasks with past end dates that aren't in "New" or "Defined" state
   * 2. Parents with state != "Active" that have children with state == "Active|Resolved|Defined"
   * 3. Tasks planned in the future that are "Active" or "Resolved"
   * Note: Skips ghosted (unplanned) cards
   */
  _checkStateConsistency(features, childrenByParent, visibleIds) {
    const issues = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day for comparison

    // Create a feature lookup map for quick access
    const featureMap = new Map(features.map((f) => [String(f.id), f]));

    for (const feature of features) {
      const featureIdStr = String(feature.id);

      // Skip if feature is not visible
      if (!visibleIds.has(featureIdStr)) continue;

      // Skip ghosted cards - they're unplanned so state checks don't apply
      const isGhosted = !feature.start || !feature.end;
      if (isGhosted) continue;

      // Check 0: Start date must be before or equal to end date
      if (feature.start && feature.end) {
        const startDate = new Date(feature.start);
        const endDate = new Date(feature.end);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        if (startDate > endDate) {
          issues.push({
            type: 'state-consistency',
            severity: 'error',
            title: 'Start date after end date',
            description: `"${feature.title}" starts ${feature.start} but ends ${feature.end} (start is after end)`,
            featureId: featureIdStr,
          });
        }
      }

      const status = feature.state || '';
      const statusLower = status.toLowerCase();

      // Check 1: Tasks that ended in the past should be marked as complete
      if (feature.end) {
        const endDate = new Date(feature.end);
        endDate.setHours(0, 0, 0, 0);

        if (
          endDate < today &&
          (statusLower === 'new' ||
            statusLower === 'defined' ||
            statusLower === 'active' ||
            statusLower === '')
        ) {
          issues.push({
            type: 'state-consistency',
            severity: 'warning',
            title: 'Past task not marked as complete',
            description: `"${feature.title}" ended ${feature.end} (in the past) but has state "${status || '(empty)'}" - should be "Closed"`,
            featureId: featureIdStr,
          });
        }
      }

      // Check 3: Tasks planned in the future that are "Active" or "Resolved"
      if (feature.start) {
        const startDate = new Date(feature.start);
        startDate.setHours(0, 0, 0, 0);

        if (
          startDate > today &&
          (statusLower === 'active' || statusLower === 'resolved')
        ) {
          issues.push({
            type: 'state-consistency',
            severity: 'warning',
            title: 'Future task marked Active/Resolved',
            description: `"${feature.title}" starts ${feature.start} (in the future) but is marked as "${status}"`,
            featureId: featureIdStr,
          });
        }
      }
    }

    // Check 2: Parent/child state mismatches
    for (const [parentId, childIds] of childrenByParent.entries()) {
      if (!childIds || childIds.length === 0) continue;

      const parentIdStr = String(parentId);

      // Skip if parent is not visible
      if (!visibleIds.has(parentIdStr)) continue;

      const parent = featureMap.get(parentIdStr);
      if (!parent) continue;

      const parentStatus = (parent.state || '').toLowerCase();

      // Only check if parent is NOT active
      if (parentStatus === 'active') continue;

      // Check if any children have problematic states
      const problematicChildren = [];

      for (const childId of childIds) {
        const childIdStr = String(childId);

        // Skip if child is not visible
        if (!visibleIds.has(childIdStr)) continue;

        const child = featureMap.get(childIdStr);
        if (!child) continue;

        const childStatus = (child.state || '').toLowerCase();

        // Child has a state that should require active parent
        if (
          childStatus === 'active' ||
          childStatus === 'resolved' ||
          childStatus === 'defined'
        ) {
          problematicChildren.push({ title: child.title, status: child.state });
        }
      }

      if (problematicChildren.length > 0) {
        const childList = problematicChildren
          .map((c) => `"${c.title}" (${c.status})`)
          .join(', ');
        issues.push({
          type: 'state-consistency',
          severity: 'warning',
          title: 'Parent/child state mismatch',
          description: `Parent "${parent.title}" has state "${parent.state || ''}" but has active/resolved/defined children: ${childList}`,
          featureId: parentIdStr,
        });
      }
    }

    return issues;
  }

  /**
   * Run all health checks
   */
  async _checkHealth() {
    this.loading = true;
    this.requestUpdate();

    try {
      // Get only the features that are currently visible/rendered on the board
      // This respects filters like "show only project hierarchy", team selection, etc.
      const board = findInBoard('feature-board');

      // Get full feature data from state (includes all properties like status)
      const allFeatures = state.getEffectiveFeatures() || [];

      // Get IDs of visible features from board
      let visibleIds = new Set();
      if (board && board.features && Array.isArray(board.features)) {
        visibleIds = new Set(
          board.features.map((f) => String(f.feature?.id)).filter(Boolean)
        );
      } else {
        // Fallback: all features are considered visible
        visibleIds = new Set(allFeatures.map((f) => String(f.id)));
      }

      // Filter to only visible features but keep full feature data with all properties
      const visibleFeatures = allFeatures.filter((f) => visibleIds.has(String(f.id)));

      const childrenByParent = state.childrenByParent || new Map();

      const checkResults = [];

      // Run parent-child date check (only for visible features)
      const dateIssues = this._checkParentChildDateMismatches(
        visibleFeatures,
        childrenByParent,
        visibleIds
      );
      checkResults.push({
        id: 'parent-child-dates',
        name: 'Parent/Child Date Mismatches',
        description: 'Children with dates outside parent date range',
        issues: dateIssues,
      });

      // Run ghosted children check (only for visible features)
      const ghostedIssues = this._checkGhostedChildrenWithPlannedParent(
        visibleFeatures,
        childrenByParent,
        visibleIds
      );
      checkResults.push({
        id: 'ghosted-children',
        name: 'Unplanned Children',
        description: 'Unplanned children of planned parents',
        issues: ghostedIssues,
      });

      // Run team allocation mismatch check (only for visible features)
      const teamIssues = this._checkParentChildTeamMismatches(
        visibleFeatures,
        childrenByParent,
        visibleIds
      );
      checkResults.push({
        id: 'parent-child-teams',
        name: 'Team Allocation Mismatches',
        description: 'Parent and child team assignments do not match',
        issues: teamIssues,
      });

      // Run orphan detection for team-plan features/epics
      const orphanIssues = this._checkOrphans(
        visibleFeatures,
        childrenByParent,
        visibleIds
      );
      checkResults.push({
        id: 'orphans',
        name: 'Orphaned Items',
        description:
          'Team-plan items that have no valid parent but are not the top-level type for this plan',
        issues: orphanIssues,
      });

      // Run hierarchy violation check: parented by wrong type (same-level or reverse)
      const hierarchyIssues = this._checkHierarchyViolations(
        visibleFeatures,
        visibleIds
      );
      checkResults.push({
        id: 'hierarchy-violations',
        name: 'Hierarchy Violations',
        description:
          'Items parented by a same-level or lower-level type, contradicting the configured hierarchy',
        issues: hierarchyIssues,
      });

      // Run dependency date violation check (only for visible features)
      const dependencyIssues = this._checkDependencyDateViolations(
        visibleFeatures,
        visibleIds
      );
      checkResults.push({
        id: 'dependency-violations',
        name: 'Dependency Date Violations',
        description: 'Tasks with incorrect start dates relative to dependencies',
        issues: dependencyIssues,
      });

      // Run state consistency check (only for visible features)
      const stateIssues = this._checkStateConsistency(
        visibleFeatures,
        childrenByParent,
        visibleIds
      );
      checkResults.push({
        id: 'state-consistency',
        name: 'State Consistency Issues',
        description: 'Tasks with inconsistent status/date combinations',
        issues: stateIssues,
      });

      // Future checks can be added here:
      // - Features with no capacity assigned
      // - Features overlapping with team capacity
      // - Features with suspicious duration (too short/long)
      // - Orphaned features (no project assigned)

      this.checks = checkResults;
    } catch (error) {
      console.error('[PlanHealth] Error checking health:', error);
      this.checks = [];
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  _handleIssueClick(issue) {
    if (issue.featureId) {
      const issueIdStr = String(issue.featureId);

      // Find and select the feature
      const features = state.getEffectiveFeatures() || [];
      const feature = features.find((f) => String(f.id) === issueIdStr);

      if (feature) {
        bus.emit(FeatureEvents.SELECTED, feature);
      }

      // Scroll to the feature card
      try {
        const board = findInBoard('feature-board');
        if (board && typeof board.centerFeatureById === 'function') {
          board.centerFeatureById(issueIdStr);
        } else {
          // Fallback: manually scroll to center the card
          const timeline = findInBoard('#timelineSection');
          const fb = findInBoard('feature-board');
          const card = findInBoard(
            `feature-card-lit[data-feature-id="${issueIdStr}"]`
          );
          if (card && timeline && fb) {
            const targetX =
              card.offsetLeft - timeline.clientWidth / 2 + card.clientWidth / 2;
            const targetY = card.offsetTop - fb.clientHeight / 2 + card.clientHeight / 2;
            timeline.scrollTo({ left: targetX, behavior: 'smooth' });
            fb.scrollTo({ top: targetY, behavior: 'smooth' });
          }
        }
      } catch (e) {
        console.warn('[PlanHealth] Failed to scroll to feature:', e);
      }
    }
  }

  _handleRefresh() {
    this._checkHealth();
  }

  _handleClose() {
    // Call plugin.deactivate() which will call this.close()
    const plugin = pluginManager.get('plugin-plan-health');
    if (plugin) plugin.deactivate();
  }

  _toggleCheckSection(checkId) {
    this.collapsedSections = {
      ...this.collapsedSections,
      [checkId]: !this.collapsedSections[checkId],
    };
    this.requestUpdate();
  }

  render() {
    if (!this.visible) return html``;

    const totalIssues = this.checks.reduce((sum, check) => sum + check.issues.length, 0);
    const hasIssues = totalIssues > 0;

    return html`
      <div class="floating-toolbar">
        <button class="close-btn" @click=${this._handleClose} title="Close">×</button>
        <div class="toolbar-title">🏥 Plan Health</div>

        <button
          class="refresh-btn"
          @click=${this._handleRefresh}
          ?disabled=${this.loading}
        >
          ${this.loading ? 'Checking...' : '🔄 Check Again'}
        </button>

        ${this.loading ?
          html` <div class="loading">Analyzing plan...</div> `
        : html`
            <div class="issue-count ${hasIssues ? 'has-issues' : 'no-issues'}">
              ${hasIssues ?
                `Found ${totalIssues} issue${totalIssues !== 1 ? 's' : ''} across ${this.checks.filter((c) => c.issues.length > 0).length} check${this.checks.filter((c) => c.issues.length > 0).length !== 1 ? 's' : ''}`
              : '✓ No issues found'}
            </div>

            ${this.checks.map((check) => {
              const collapsed = this.collapsedSections[check.id];
              const checkHasIssues = check.issues.length > 0;

              return html`
                <div class="check-section">
                  <div
                    class="check-header"
                    @click=${() => this._toggleCheckSection(check.id)}
                  >
                    <div class="check-header-left">
                      <div class="check-name">${check.name}</div>
                      <span
                        class="check-badge ${checkHasIssues ? 'has-issues' : 'no-issues'}"
                      >
                        ${checkHasIssues ? check.issues.length : '✓'}
                      </span>
                    </div>
                    <span class="check-toggle ${collapsed ? 'collapsed' : ''}">▼</span>
                  </div>

                  <div class="check-content ${collapsed ? 'collapsed' : ''}">
                    ${checkHasIssues ?
                      html`
                        <ul class="issues-list">
                          ${check.issues.map(
                            (issue) => html`
                              <li
                                class="issue-item severity-${issue.severity}"
                                @click=${() => this._handleIssueClick(issue)}
                                title="Click to navigate to feature"
                              >
                                <div class="issue-type">${issue.type}</div>
                                <div class="issue-title">${issue.title}</div>
                                <div class="issue-description">${issue.description}</div>
                              </li>
                            `
                          )}
                        </ul>
                      `
                    : html`
                        <div
                          style="padding: 12px; text-align: center; color: #666; font-size: 12px;"
                        >
                          No issues found
                        </div>
                      `}
                  </div>
                </div>
              `;
            })}
          `}
      </div>
    `;
  }
}

customElements.define('plugin-plan-health', PluginPlanHealthComponent);
