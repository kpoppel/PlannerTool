/**
 * LinkEditorState.js
 * Manages state for the Link Editor plugin
 * Provides centralized state management for link editing operations
 */

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
    if (!this.pendingAction) return false;

    const { action, fromId } = this.pendingAction;

    // Prevent self-linking
    if (fromId === targetId) {
      this.cancelAction();
      return false;
    }

    // Create or update the relation
    this._applyRelationChange(action, fromId, targetId);

    this.cancelAction();
    return true;
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
    // Import state management here to avoid circular dependencies
    import('../../services/State.js').then(({ state }) => {
      try {
        const scenario = state.scenarioManager?.getActiveScenario();
        if (!scenario) {
          console.warn('[LinkEditorState] No active scenario');
          return;
        }

        // Get the baseline feature
        const baselineFeature = state.baselineStore?.getFeatureById()?.get(fromId);
        if (!baselineFeature) {
          console.warn('[LinkEditorState] Feature not found:', fromId);
          return;
        }

        // Get current effective relations (baseline + override)
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

        // Apply the change based on action type
        if (action === ACTIONS.PARENT) {
          // Parent is special - replace any existing Parent relation
          relations = relations.filter((r) => {
            const relType = r.type || r.relationType || 'Related';
            return relType !== 'Parent';
          });
          relations.push({ type: 'Parent', id: targetId });
        } else {
          // For Predecessor, Successor, Related - add if not exists
          const existingIndex = relations.findIndex((r) => {
            const relType = r.type || r.relationType || 'Related';
            const relId = String(r.id || r);
            return relType === action && relId === String(targetId);
          });

          if (existingIndex === -1) {
            relations.push({ type: action, id: targetId });
          }
        }

        // Update scenario override
        if (!scenario.overrides) scenario.overrides = {};
        if (!scenario.overrides[fromId]) {
          scenario.overrides[fromId] = {};
        }
        scenario.overrides[fromId].relations = relations;

        // Trigger feature update event
        import('../../core/EventBus.js').then(({ bus }) => {
          import('../../core/EventRegistry.js').then(({ FeatureEvents }) => {
            bus.emit(FeatureEvents.UPDATED, { id: fromId });
            console.log(
              '[LinkEditorState] Created link:',
              action,
              fromId,
              '->',
              targetId
            );
          });
        });

        this.notify();
      } catch (err) {
        console.error('[LinkEditorState] Error applying relation change:', err);
      }
    });
  }

  /**
   * Remove a relation
   * @param {string} fromId - source feature ID
   * @param {string} targetId - target feature ID
   * @param {string} relationType - relation type
   */
  removeRelation(fromId, targetId, relationType) {
    import('../../services/State.js').then(({ state }) => {
      try {
        const scenario = state.scenarioManager?.getActiveScenario();
        if (!scenario) return;

        const baselineFeature = state.baselineStore?.getFeatureById()?.get(fromId);
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
