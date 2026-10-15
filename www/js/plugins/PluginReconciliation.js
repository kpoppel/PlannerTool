import { MenuPlugin } from './MenuPlugin.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';
import { reconciliation } from './reconciliation/runtime.js';
import { categoryCounts, statusText } from './reconciliation/presentation.js';
import { closeReconciliationReview, isReconciliationReviewOpen,
  toggleReconciliationReview } from './reconciliation/ReconciliationReview.lit.js';

export class PluginReconciliation extends MenuPlugin {
  static get defaultId() { return 'plugin-reconciliation'; }

  constructor(id = PluginReconciliation.defaultId, config = {}) {
    super(id, config);
  }

  async init() {
    await import('./reconciliation/ReconciliationTaskMarker.lit.js');
    this._unsubscribe = reconciliation.subscribe(() => {
      bus.emit(PluginEvents.MENU_STATUS_CHANGED, { id: this.id });
    });
    reconciliation.start();
    this.initialized = true;
  }

  getMetadata() {
    return { ...super.getMetadata(), attentionCount: reconciliation.snapshot.groups.length,
      attentionCounts: categoryCounts(reconciliation.snapshot),
      attentionStatus: statusText(reconciliation.snapshot),
      menuBehavior: 'toggle', menuActive: isReconciliationReviewOpen() };
  }

  toggleMenu() {
    if (!this.initialized) throw new Error(`Menu plugin ${this.id} is not initialized`);
    toggleReconciliationReview();
  }

  async destroy() {
    if (this.initialized) {
      this._unsubscribe();
      reconciliation.stop();
      closeReconciliationReview();
    }
    await super.destroy();
  }

}

export default PluginReconciliation;