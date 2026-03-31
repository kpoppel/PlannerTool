import { expect } from '@open-wc/testing';
import { renderTeamMembersView } from '../../www/js/plugins/PluginCostV2TeamMembersView.js';

describe('PluginCostV2 TeamMembers View render paths', () => {
  it('returns an empty-state when no data present', () => {
    const res = renderTeamMembersView({});
    expect(res).to.be.ok;
  });

  it('renders team members table when teams present but no members', () => {
    const component = {
      months: [new Date('2026-01-01')],
      monthsMap: {},
      data: { teams: [{ id: 't1', name: 'T1', members: [] }] },
    };
    const res = renderTeamMembersView(component);
    expect(res).to.be.ok;
  });
});
