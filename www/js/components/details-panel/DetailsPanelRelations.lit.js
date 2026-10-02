import { html } from '../../vendor/lit.js';
import { getIconTemplate } from '../../services/IconService.js';

const CATEGORY_ORDER = ['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed'];

/**
 * Project links from explicit baseline lookups; unloaded relation targets are valid.
 * @param {{relations: object[], projectId: string, featureUrl: string, projects: object[],
 *   linkedFeatures: Map<string, object>, stateColors: object, stateCategories: Map<string, string>}} input
 */
export function buildDetailsPanelRelationsModel({
  relations, projectId, featureUrl, projects, linkedFeatures, stateColors, stateCategories,
}) {
  const grouped = new Map();
  for (const relation of relations) {
    if (!grouped.has(relation.type)) grouped.set(relation.type, []);
    grouped.get(relation.type).push(relation);
  }
  const types = [...grouped.keys()];
  types.sort((first, second) => first === 'Parent' ? -1 : second === 'Parent' ? 1 : 0);
  const categoryOrder = (linked) => {
    const index = CATEGORY_ORDER.indexOf(stateCategories.get(linked.state));
    return index < 0 ? CATEGORY_ORDER.length : index;
  };
  return {
    groups: types.map((type) => {
      const relationsForType = grouped.get(type);
      let title = type;
      if (type === 'Parent') {
        const otherPlans = new Set();
        for (const relation of relationsForType) {
          const linked = linkedFeatures.get(String(relation.id));
          if (linked && String(linked.project) !== String(projectId)) {
            const project = projects.find((item) => item.id === linked.project);
            if (project && project.name) otherPlans.add(project.name);
          }
        }
        if (otherPlans.size === 1) title = `Parent (in ${[...otherPlans][0]})`;
        else if (otherPlans.size > 1) title = 'Parent (in multiple plans)';
      }
      if (type === 'Child') {
        relationsForType.sort((first, second) => {
          const firstLinked = linkedFeatures.get(String(first.id));
          const secondLinked = linkedFeatures.get(String(second.id));
          if (firstLinked && !secondLinked) return -1;
          if (!firstLinked && secondLinked) return 1;
          return firstLinked && secondLinked ? categoryOrder(firstLinked) - categoryOrder(secondLinked) : 0;
        });
      }
      return {
        title,
        items: relationsForType.map((relation) => {
          const id = relation.id ? String(relation.id) : '';
          const linked = linkedFeatures.get(id);
          let href = relation.url;
          if (!href && featureUrl && id) href = featureUrl.replace(/(\d+)(?!.*\d)/, id);
          const stateColor = linked ? stateColors[linked.state] : undefined;
          return {
            id,
            type,
            href,
            title: linked && linked.title ? linked.title : type === 'Child' && id ? '(task state not loaded)' : '',
            iconType: linked ? linked.type : 'epic',
            loaded: Boolean(linked),
            state: linked ? linked.state : '',
            stateBackground: stateColor ? stateColor.background : '#9e9e9e',
          };
        }),
      };
    }),
  };
}

function renderRelationIcon(item) {
  if (item.type === 'Parent' || (item.type === 'Child' && item.loaded)) {
    return getIconTemplate(item.iconType);
  }
  if (item.type === 'Successor') return '➡️';
  if (item.type === 'Predecessor') return '⬅️';
  return '🔗';
}

/** Render relation presentation without reaching into application state. */
export function renderDetailsPanelRelations({ model }) {
  return html`
    <div class="details-label">Links:</div>
    <div class="details-value">
      ${model.groups.length === 0 ? html`<div class="details-value">—</div>` :
        model.groups.map((group) => html`
          <div class="relations-group">
            <div class="group-title">${group.title}</div>
            <ul class="azure-relations-list">
              ${group.items.map((item) => html`
                <li class="azure-relation-item">
                  <div class="relation-icon">${renderRelationIcon(item)}</div>
                  <div class="relation-content">
                    ${item.type === 'Child' && item.loaded ? html`
                      <div class="relation-state-indicator"
                        style="background: ${item.stateBackground};" title=${item.state}></div>
                    ` : ''}
                    <div class="relation-title">
                      <a class="details-link" href=${item.href} target="_blank"
                        >${item.id}${item.title ? ' ' + item.title : ''}</a>
                    </div>
                  </div>
                </li>
              `)}
            </ul>
          </div>
        `)}
    </div>
  `;
}
