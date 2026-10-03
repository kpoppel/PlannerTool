import { store } from '../../application/store.js';
import { sel } from '../../application/imports.js';
import { ReconciliationController } from './ReconciliationController.js';

export const reconciliation = new ReconciliationController({
	store,
	selectors: {
		scope: {
			getResolvedFeatures: () => sel.scope.getResolvedFeatures(),
			getVisibleFeatures: () => sel.scope.getVisibleFeatures(),
		},
		feature: {
			getTaskTypeHierarchy: () => sel.feature.getTaskTypeHierarchy(),
		},
	},
});