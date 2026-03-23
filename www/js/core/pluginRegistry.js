// Minimal registry mapping module `id` (from modules.config.json) to
// plugin constructor functions. Keep this file small so the loader can
// simply do `const ctor = PluginRegistry[id]`.

import { SamplePlugin } from '../plugins/SamplePlugin.js';
import PluginMarkers from '../plugins/PluginMarkers.js';
import PluginCost from '../plugins/PluginCost.js';
import PluginCostV2 from '../plugins/PluginCostV2.js';
import PluginExportTimeline from '../plugins/PluginExportTimeline.js';
import PluginAnnotations from '../plugins/PluginAnnotations.js';
import PluginGraph from '../plugins/PluginGraph.js';
import PluginPlanHealth from '../plugins/PluginPlanHealth.js';
import PluginHistory from '../plugins/PluginHistory.js';
import PluginLinkEditor from '../plugins/PluginLinkEditor.js';

const PluginRegistry = {
  'sample-plugin': SamplePlugin,
  'plugin-markers': PluginMarkers,
  'plugin-cost': PluginCost,
  'plugin-cost-v2': PluginCostV2,
  'plugin-export-timeline': PluginExportTimeline,
  'plugin-annotations': PluginAnnotations,
  'plugin-graph': PluginGraph,
  'plugin-plan-health': PluginPlanHealth,
  'plugin-history': PluginHistory,
  'plugin-link-editor': PluginLinkEditor,
};

export default PluginRegistry;
