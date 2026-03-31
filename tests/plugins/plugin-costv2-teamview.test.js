import { expect } from '@open-wc/testing';
import { renderTeamView } from '../../www/js/plugins/PluginCostV2TeamView.js';

describe('PluginCostV2 Team View render paths', () => {
  it('returns an empty-state when no data present', () => {
    const res = renderTeamView({});
    expect(res).to.be.ok;
  });

  it('renders team-level empty table when no teams', () => {
    const component = {
      months: [new Date('2026-01-01')],
      monthsMap: {},
      expandedTeams: new Set(),
      data: { teams: [] },
    };
    const res = renderTeamView(component);
    expect(res).to.be.ok;
  });
});
