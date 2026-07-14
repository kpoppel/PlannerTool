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
    this.api = null;
  }

  setApi(api) {
    this.api = api;
  }

  get _api() {
    if (!this.api) throw new Error('LinkEditorState requires PlannerApi');
    return this.api;
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
    const updated = this._applyRelationChange(action, fromId, targetId);

    this.cancelAction();
    return updated;
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
    try {
      const feature = this._api.features.getById(fromId);
      if (!feature) {
        console.warn('[LinkEditorState] Feature not found:', fromId);
        return false;
      }

      let relations = Array.isArray(feature.relations) ? [...feature.relations] : [];
      if (action === ACTIONS.PARENT) {
        relations = relations.filter((relation) => {
          const relationType = relation.type || relation.relationType || 'Related';
          return relationType !== ACTIONS.PARENT;
        });
        relations.push({ type: ACTIONS.PARENT, id: targetId });
      } else if (!relations.some((relation) => {
        const relationType = relation.type || relation.relationType || 'Related';
        return relationType === action && String(relation.id || relation) === String(targetId);
      })) {
        relations.push({ type: action, id: targetId });
      }

      const updated = this._api.features.updateRelations(fromId, relations);
      if (updated) {
        console.log('[LinkEditorState] Created link:', action, fromId, '->', targetId);
        this.notify();
      }
      return updated;
    } catch (error) {
      console.error('[LinkEditorState] Error applying relation change:', error);
      return false;
    }
  }

  /**
   * Remove a relation
   * @param {string} fromId - source feature ID
   * @param {string} targetId - target feature ID
   * @param {string} relationType - relation type
   */
  removeRelation(fromId, targetId, relationType) {
    try {
      const feature = this._api.features.getById(fromId);
      if (!feature) return false;

      const relations = (feature.relations || []).filter((relation) => {
        const type = relation.type || relation.relationType || 'Related';
        return !(type === relationType && String(relation.id || relation) === String(targetId));
      });
      const updated = this._api.features.updateRelations(fromId, relations);
      if (updated) {
        console.log('[LinkEditorState] Removed link:', relationType, fromId, '->', targetId);
        this.notify();
      }
      return updated;
    } catch (error) {
      console.error('[LinkEditorState] Error removing relation:', error);
      return false;
    }
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
