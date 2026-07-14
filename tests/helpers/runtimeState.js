import { plannerApplication } from '../../www/js/application/plannerApplication.js';
import { PALETTE } from '../../www/js/services/ColorService.js';
import { selectFeatureDirtyMetadata } from '../../www/js/application/selectors/featureSelectors.js';

const { runtime } = plannerApplication.services;

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

Object.defineProperties(runtime, {
  _projectTeamService: { get: () => runtime.projectTeamService },
  _stateFilterService: { get: () => runtime.stateFilterService },
  _viewService: { get: () => runtime.viewService },
  _dataInitService: { get: () => runtime.dataInitService },
  _featureService: { get: () => runtime.featureService },
});

export { PALETTE, runtime as state };
