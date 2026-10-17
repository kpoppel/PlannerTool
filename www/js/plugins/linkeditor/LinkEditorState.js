/**
 * LinkEditorState.js
 * Manages state for the Link Editor plugin
 * Provides centralized state management for link editing operations
 */

import { cmd, sel } from '../../application/imports.js';
import { store } from '../../application/store.js';

// Link types available for editing
export const LINK_TYPES = {
  PREDECESSOR: 'Predecessor',
  SUCCESSOR: 'Successor',
  RELATED: 'Related',
  PARENT: 'Parent',
};

// Action states
export const ACTIONS = {
  NONE: 'none',
  PREDECESSOR: 'Predecessor',
  SUCCESSOR: 'Successor',
  RELATED: 'Related',
  PARENT: 'Parent',
};

/**
 * LinkEditorState - Singleton state manager
 */
class LinkEditorState {
  constructor() {
    this.enabled = false;
    this.pendingAction = null; // { action: string, fromId: string }
    this.listeners = new Set();
    this.hoveredCardId = null;

    // Track edited relations per feature (stored as scenario overrides)
    // This is not persisted here but rather synced with the active scenario
    this.relationEdits = new Map();
    store.subscribe((state) => state.scenarios, (next, previous) => {
      if (next.activeId !== previous.activeId || !sel.scenario.isActiveScenarioMutable()) {
        this.enabled = false;
        this.pendingAction = null;
        this.hoveredCardId = null;
        this.notify();
      }
    });
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - callback function
   * @returns {Function} unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of state changes
   */
  notify() {
    this.listeners.forEach((fn) => {
      try {
        fn(this);
      } catch (e) {
        console.error('[LinkEditorState] Listener error:', e);
      }
    });
  }

  /**
   * Enable link editing mode
   */
  enable() {
    if (!sel.scenario.isActiveScenarioMutable()) return;
    if (this.enabled) return;
    this.enabled = true;
    this.pendingAction = null;
    this.notify();
  }

  /**
   * Disable link editing mode
   */
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.pendingAction = null;
    this.hoveredCardId = null;
    this.notify();
  }

  /**
   * Start a link action (user clicked a quadrant)
   * @param {string} action - action type (Predecessor, Successor, etc)
   * @param {string} fromId - source feature ID
   */
  startAction(action, fromId) {
    if (!sel.scenario.isActiveScenarioMutable()) return;
    this.pendingAction = { action, fromId };
    this.notify();
  }

  /**
   * Cancel the current pending action
   */
  cancelAction() {
    this.pendingAction = null;
    this.notify();
  }

  /**
   * Complete a link action by selecting a target
   * @param {string} targetId - target feature ID
   * @returns {boolean} true if action was completed
   */
  completeAction(targetId) {
    if (!sel.scenario.isActiveScenarioMutable()) { this.cancelAction(); return false; }
    if (!this.pendingAction) return false;

    const { action, fromId } = this.pendingAction;

    // Prevent self-linking
    if (fromId === targetId) {
      this.cancelAction();
      return false;
    }

    // Create or update the relation
    const changed = this._applyRelationChange(action, fromId, targetId);

    this.cancelAction();
    return changed;
  }

  /**
   * Set currently hovered card
   * @param {string|null} cardId
   */
  setHoveredCard(cardId) {
    if (this.hoveredCardId === cardId) return;
    this.hoveredCardId = cardId;
    this.notify();
  }

  /**
   * Apply a relation change and sync with scenario
   * @private
   */
  _applyRelationChange(action, fromId, targetId) {
    if (!sel.scenario.isActiveScenarioMutable()) return false;
    const feature = sel.feature.getEffectiveFeatureById(fromId);
    if (feature === null) return false;
    const relations = action === ACTIONS.PARENT
      ? feature.relations.filter((relation) => relation.type !== 'Parent')
      : [...feature.relations];
    if (!relations.some((relation) => relation.type === action && String(relation.id) === String(targetId))) {
      relations.push({ type: action, id: targetId });
    }
    return cmd.feature.updateFeatureField(fromId, 'relations', relations) !== null;
  }

  /**
   * Remove a relation
   * @param {string} fromId - source feature ID
   * @param {string} targetId - target feature ID
   * @param {string} relationType - relation type
   */
  removeRelation(fromId, targetId, relationType) {
    // Remove the requested edge from the same scenario override structure used by
    // add/edit operations, so the plugin remains internally consistent.
    import('../../application/imports.js').then(({ sel }) => {
      try {
        const seam = /** @type {any} */ (sel);
        const scenario = /** @type {any} */ (seam.scenario.getActiveScenario());
        if (!scenario) return;

        const baselineFeature = /** @type {any} */ (seam.feature.getBaselineFeatureById(fromId));
        if (!baselineFeature) return;

        // Get current effective relations
        let relations = [];
        if (
          scenario.overrides &&
          scenario.overrides[fromId] &&
          scenario.overrides[fromId].relations
        ) {
          relations = [...scenario.overrides[fromId].relations];
        } else if (baselineFeature.relations) {
          relations = [...baselineFeature.relations];
        }

        // Remove the matching relation
        const filtered = relations.filter((r) => {
          const relType = r.type || r.relationType || 'Related';
          const relId = String(r.id || r);
          return !(relType === relationType && relId === String(targetId));
        });

        // Update scenario override
        if (!scenario.overrides) scenario.overrides = {};
        if (!scenario.overrides[fromId]) {
          scenario.overrides[fromId] = {};
        }
        scenario.overrides[fromId].relations = filtered;

        // Trigger feature update event
        import('../../core/EventBus.js').then(({ bus }) => {
          import('../../core/EventRegistry.js').then(({ FeatureEvents }) => {
            bus.emit(FeatureEvents.UPDATED, { id: fromId });
            console.log(
              '[LinkEditorState] Removed link:',
              relationType,
              fromId,
              '->',
              targetId
            );
          });
        });

        this.notify();
      } catch (err) {
        console.error('[LinkEditorState] Error removing relation:', err);
      }
    });
  }

  /**
   * Clear all state
   */
  clear() {
    this.pendingAction = null;
    this.hoveredCardId = null;
    this.relationEdits.clear();
    this.notify();
  }
}

// Singleton instance
/** @type {LinkEditorState|null} */
let instance = null;

/**
 * Get the global LinkEditorState instance
 * @returns {LinkEditorState}
 */
export function getLinkEditorState() {
  if (!instance) {
    instance = new LinkEditorState();
  }
  return instance;
}

export default LinkEditorState;
