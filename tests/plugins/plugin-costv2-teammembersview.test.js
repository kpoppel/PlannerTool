import { expect } from '@open-wc/testing';
import { renderTeamMembersView } from '../../www/js/plugins/PluginCostTeamMembersView.js';

describe('PluginCost TeamMembers View render paths', () => {
  it('returns an empty-state when no data present', () => {
    const res = renderTeamMembersView({ costTeams: null });
    expect(res).to.be.ok;
  });

  it('renders a canonical workforce empty state', () => {
    const component = {
      costTeams: { catalogue: [], teams: {}, groups: {}, suppliers: [] },
    };
    const res = renderTeamMembersView(component);
    expect(res).to.be.ok;
  });
});
