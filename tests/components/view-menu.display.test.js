import { expect } from '@open-wc/testing';
import '../../www/js/components/ViewMenu.lit.js';
import { cmd } from '../../www/js/application/imports.js';
import { bus } from '../../www/js/core/EventBus.js';
import { TimelineEvents, ViewEvents } from '../../www/js/core/EventRegistry.js';

describe('ViewMenu display controls', () => {
  it('routes timeline, card, sorting, and graph controls through view commands', () => {
    const menu = document.createElement('view-menu');
    const originalTimeline = cmd.view.setTimelineScale;
    const originalDisplay = cmd.view.setDisplayMode;
    const originalSort = cmd.view.setFeatureSortMode;
    const originalGraph = cmd.view.setCapacityViewMode;
    const calls = [];
    cmd.view.setTimelineScale = (value) => calls.push(['timeline', value]);
    cmd.view.setDisplayMode = (value) => calls.push(['display', value]);
    cmd.view.setFeatureSortMode = (value) => calls.push(['sort', value]);
    cmd.view.setCapacityViewMode = (value) => calls.push(['graph', value]);

    menu._setTimelineScale('months');
    menu._setDisplayMode('compact');
    menu._setFeatureSortMode('date');
    menu._setGraphType('project');

    expect(calls).to.deep.equal([
      ['timeline', 'months'],
      ['display', 'compact'],
      ['sort', 'date'],
      ['graph', 'project'],
    ]);
    cmd.view.setTimelineScale = originalTimeline;
    cmd.view.setDisplayMode = originalDisplay;
    cmd.view.setFeatureSortMode = originalSort;
    cmd.view.setCapacityViewMode = originalGraph;
  });

  it('re-renders when display-control events update selector state', async () => {
    const menu = document.createElement('view-menu');
    document.body.appendChild(menu);
    await menu.updateComplete;
    let redraws = 0;
    const originalRequestUpdate = menu.requestUpdate.bind(menu);
    menu.requestUpdate = () => {
      redraws += 1;
      return originalRequestUpdate();
    };

    bus.emit(TimelineEvents.SCALE_CHANGED);
    bus.emit(ViewEvents.DISPLAY_MODE);
    bus.emit(ViewEvents.SORT_MODE);
    bus.emit(ViewEvents.CAPACITY_MODE);

    expect(redraws).to.equal(4);
    menu.remove();
  });

  it('uses menu-row styling for display controls while retaining a primary save action', async () => {
    const menu = document.createElement('view-menu');
    document.body.appendChild(menu);
    await menu.updateComplete;

    const styles = menu.shadowRoot.querySelector('style').textContent;
    expect(styles).to.include('.segment-btn:hover');
    expect(styles).to.include('background: rgba(255, 255, 255, 0.18)');
    expect(styles).to.include('.save-view-btn');
    menu.remove();
  });

  it('visually separates non-interactive section headings from selectable options', async () => {
    const menu = document.createElement('view-menu');
    document.body.appendChild(menu);
    await menu.updateComplete;

    const styles = menu.shadowRoot.querySelector('style').textContent;
    expect(styles).to.include('.display-title');
    expect(styles).to.include('background: rgba(255, 255, 255, 0.08)');
    expect(styles).to.include('text-transform: uppercase');
    menu.remove();
  });
});