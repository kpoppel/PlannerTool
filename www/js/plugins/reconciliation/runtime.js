import { store } from '../../application/store.js';
import { cmd, sel } from '../../application/imports.js';
import { ReconciliationController } from './ReconciliationController.js';

export const reconciliation = new ReconciliationController({
	store,
	commands: {
		pluginScenarioData: { set: (...args) => cmd.pluginScenarioData.set(...args) },
	},
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