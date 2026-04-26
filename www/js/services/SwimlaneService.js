/**
 * SwimlaneService
 *
 * Pure functions for plan swimlane grouping on the FeatureBoard.
 *
 * Swimlane mode activates automatically when two or more plans are selected,
 * or when the "Team Allocated" expansion filter is active. In swimlane mode
 * features are grouped into horizontal bands — one per visible plan or team —
 * and each band is sorted/packed independently.
 *
 * No DOM or Lit imports — all functions are pure and fully unit-testable.
 *
 * Swimlane types:
 *   'plan'          — a currently-selected project
 *   'expanded-plan' — an unselected project pulled in by parent/child or
 *                     relation expansion; shown as a secondary band
 *   'team'          — a selected team shown when expandTeamAllocated is active
 *
 * @module SwimlaneService
 */

/**
 * Width of the sticky plan-name label column in pixels.
 * Consumed by FeatureBoard when rendering the label overlay.
 */
export const SWIMLANE_LABEL_WIDTH_PX = 140;

/**
 * Vertical gap (px) inserted between consecutive swimlane bands to make the
 * boundary visually clear.
 */
export const SWIMLANE_BAND_GAP_PX = 8;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine whether swimlane mode should be active.
 *
 * Swimlane mode is on when:
 *  - Two or more projects are selected, OR
 *  - The "Team Allocated" expansion filter is active (this can produce
 *    team swimlanes even with 0 or 1 plan selected).
 *
 * @param {Array<{id:string, selected:boolean}>} projects   All loaded projects.
 * @param {{expandParentChild:boolean, expandRelations:boolean, expandTeamAllocated:boolean}|null} expansionState
 * @returns {boolean}
 */
export function isSwimlaneMode(projects, expansionState) {
  const selectedCount = (projects || []).filter((p) => p.selected).length;
  return selectedCount >= 2 || !!(expansionState && expansionState.expandTeamAllocated);
}

/**
 * Build an ordered list of swimlane descriptors for the current view.
 *
 * The order is:
 *   1. Plan swimlanes for each selected project (in their list order).
 *   2. Expanded-plan swimlanes for unselected projects whose features appear in
 *      `visibleFeatures` (only added when expandParentChild or expandRelations is on).
 *   3. Team swimlanes for each selected team (only added when expandTeamAllocated is on).
 *
 * @param {Array<{id:string, name:string, color:string, selected:boolean}>} projects
 * @param {Array<{id:string, name:string, color:string, selected:boolean}>} teams
 * @param {{expandParentChild:boolean, expandRelations:boolean, expandTeamAllocated:boolean}|null} expansionState
 * @param {Array<{project:string}>} visibleFeatures  Features that passed the visibility filter.
 * @returns {Array<{id:string, name:string, color:string, type:'plan'|'expanded-plan'|'team'}>}
 */
export function buildSwimlaneList(projects, teams, expansionState, visibleFeatures) {
  const swimlanes = [];
  const addedIds = new Set();

  // --- 1. Plan swimlanes: selected projects ---
  for (const project of projects || []) {
    if (!project.selected) continue;
    swimlanes.push({
      id: project.id,
      name: project.name,
      color: project.color,
      type: 'plan',
    });
    addedIds.add(project.id);
  }

  // --- 2. Expanded-plan swimlanes: unselected projects in visible features ---
  // Only relevant when parent/child or relation expansion pulls in cross-project features.
  if (expansionState && (expansionState.expandParentChild || expansionState.expandRelations)) {
    const projectsById = new Map((projects || []).map((p) => [p.id, p]));
    for (const feature of visibleFeatures || []) {
      const pid = feature.project;
      if (pid && !addedIds.has(pid)) {
        const p = projectsById.get(pid);
        if (p) {
          swimlanes.push({
            id: p.id,
            name: p.name,
            color: p.color,
            type: 'expanded-plan',
          });
          addedIds.add(pid);
        }
      }
    }
  }

  // --- 3. Team swimlanes: selected teams when expandTeamAllocated is active ---
  if (expansionState && expansionState.expandTeamAllocated) {
    for (const team of teams || []) {
      if (!team.selected) continue;
      swimlanes.push({
        id: team.id,
        name: team.name,
        color: team.color,
        type: 'team',
      });
    }
  }

  return swimlanes;
}

/**
 * Assign a feature to the most appropriate swimlane.
 *
 * Assignment priority (first match wins):
 *
 * 1. Own project is a *plan* swimlane (selected project) → use it directly.
 * 2. expandParentChild is on → walk the parent chain upward; use the swimlane
 *    of the first ancestor whose project is a plan swimlane (B-child follows
 *    A-parent into A's band).
 * 3. expandTeamAllocated is on AND the feature's project is NOT selected →
 *    use the team swimlane for the first matching selected-team capacity entry.
 * 4. Own project is an *expanded-plan* swimlane → use it.
 * 5. Fallback: first swimlane in the list.
 *
 * @param {{id:string, project:string, parentId:string|null, capacity:Array<{team:string, capacity:number}>}} feature
 * @param {Array<{id:string, type:string}>} swimlanes   Ordered swimlane list from buildSwimlaneList().
 * @param {Map<string, {project:string, parentId:string|null}>} allFeaturesById  Lookup for parent walking.
 * @param {{expandParentChild:boolean, expandTeamAllocated:boolean}|null} expansionState
 * @param {Set<string>} selectedProjectIds  IDs of currently-selected projects.
 * @param {Set<string>} selectedTeamIds     IDs of currently-selected teams.
 * @returns {string|null}  Swimlane ID, or null if the swimlane list is empty.
 */
export function assignFeatureToSwimlane(
  feature,
  swimlanes,
  allFeaturesById,
  expansionState,
  selectedProjectIds,
  selectedTeamIds
) {
  if (!swimlanes || swimlanes.length === 0) return null;

  const swimlaneById = new Map(swimlanes.map((s) => [s.id, s]));
  const ownSwimlane = swimlaneById.get(feature.project);

  // --- Priority 1: parent chain walk (expandParentChild) ---
  // When parent/child expansion is active a B-plan feature whose ancestor lives
  // in an A-plan swimlane follows the ancestor — this takes precedence over the
  // feature's own-project assignment so linked tasks migrate to their parent's band.
  if (expansionState && expansionState.expandParentChild) {
    const planSwimlaneIds = new Set(
      swimlanes.filter((s) => s.type === 'plan').map((s) => s.id)
    );
    let current = feature;
    // visited guards against cycles in malformed data
    const visited = new Set([String(feature.id)]);
    while (current && current.parentId) {
      const parentId = String(current.parentId);
      if (visited.has(parentId)) break; // cycle detected — stop
      visited.add(parentId);
      const parent = allFeaturesById.get(parentId);
      if (!parent) break;
      if (parent.project && planSwimlaneIds.has(parent.project)) {
        // Ancestor is in a plan swimlane → this feature follows it
        return parent.project;
      }
      current = parent;
    }
  }

  // --- Priority 2: own project in a plan swimlane ---
  if (ownSwimlane && ownSwimlane.type === 'plan') {
    return ownSwimlane.id;
  }

  // --- Priority 3: team swimlane (expandTeamAllocated) ---
  // Only for features whose project is NOT a selected-plan (those already handled in priority 1)
  if (expansionState && expansionState.expandTeamAllocated) {
    if (!selectedProjectIds.has(feature.project)) {
      if (Array.isArray(feature.capacity)) {
        for (const cap of feature.capacity) {
          if (cap.capacity > 0 && selectedTeamIds.has(cap.team)) {
            const teamLane = swimlaneById.get(cap.team);
            if (teamLane && teamLane.type === 'team') return teamLane.id;
          }
        }
      }
    }
  }

  // --- Priority 4: own project in an expanded-plan swimlane ---
  if (ownSwimlane) return ownSwimlane.id;

  // --- Priority 5: fallback to first swimlane ---
  return swimlanes[0].id;
}
