import { plannerApplication } from '../../www/js/application/plannerApplication.js';
import { PALETTE } from '../../www/js/services/ColorService.js';
import { selectFeatureDirtyMetadata } from '../../www/js/application/selectors/featureSelectors.js';

const { runtime } = plannerApplication.services;
const { commands } = plannerApplication;

runtime.initProjectTeamBaseline = (projects, teams) => {
  runtime.projectTeamService.initFromBaseline(projects || [], teams || []);
};

runtime.setBaselineFeatures = (features) => {
  runtime.baselineFeatures = Array.isArray(features) ? features : [];
  runtime.baselineStore.setFeatures(runtime.baselineFeatures);
  runtime.dataInitService._buildLookupMaps(runtime.baselineFeatures);
  runtime.featureService.setChildrenByParent(runtime.childrenByParent);
};

runtime.recomputeDerived = (featureBase, override) =>
  selectFeatureDirtyMetadata(featureBase, override);

// Route legacy state-facade calls through the command layer used by refactored runtime.
runtime.setProjectSelected = (id, selected) => commands.setProjectSelected(id, selected);
runtime.setTeamSelected = (id, selected) => commands.setTeamSelected(id, selected);
runtime.cloneScenario = (sourceId, name) => commands.cloneScenario(sourceId, name);
runtime.setExpansionState = (options) => commands.setExpansionState(options);
runtime.updateFeatureDates = (updates) => commands.updateFeatureDates(updates);

Object.defineProperties(runtime, {
  _projectTeamService: { get: () => runtime.projectTeamService },
  _stateFilterService: { get: () => runtime.stateFilterService },
  _viewService: { get: () => runtime.viewService },
  _dataInitService: { get: () => runtime.dataInitService },
  _featureService: { get: () => runtime.featureService },
});

export { PALETTE, runtime as state };
