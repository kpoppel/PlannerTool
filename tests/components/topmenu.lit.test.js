import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../../www/js/components/TopMenu.lit.js';
import { bus } from '../../www/js/core/EventBus.js';
import { ProjectEvents, TeamEvents } from '../../www/js/core/EventRegistry.js';

describe('Top menu selection badges', () => {
  let menu;

  beforeEach(async () => {
    menu = document.createElement('top-menu-bar');
    document.body.appendChild(menu);
    bus.emit(ProjectEvents.CHANGED, []);
    bus.emit(TeamEvents.CHANGED, []);
    await menu.updateComplete;
  });

  afterEach(() => {
    menu.remove();
  });

  describe.each([
    ['Plan', 'planMenuBtn', ProjectEvents.CHANGED],
    ['Team', 'teamMenuBtn', TeamEvents.CHANGED],
  ])('%s', (label, buttonId, event) => {
    it.each([0, 1, 2])('renders the badge for %i selections', async (count) => {
      const items = [
        { id: 'unselected', name: 'Not selected', selected: false },
        { id: 'first', name: `${label} Alpha`, selected: count >= 1 },
        { id: 'second', name: `${label} Beta`, selected: count >= 2 },
      ];
      bus.emit(event, items);
      await menu.updateComplete;

      expect(menu.openMenu).toBeNull();
      const badge = menu.shadowRoot.querySelector(`#${buttonId} .menu-count-badge`);
      if (count === 0) {
        expect(badge).toBeNull();
      } else {
        const expected = count === 1 ? `${label} Alpha` : String(count);
        expect(badge.textContent).toBe(expected);
        expect(badge.title).toBe(expected);
        expect(badge.classList.contains('menu-selection-name')).toBe(count === 1);
      }
    });

    it('updates the name after selection changes and the panel closes', async () => {
      const items = [
        { id: 'first', name: `${label} Alpha`, selected: true },
        { id: 'second', name: `${label} Beta`, selected: true },
      ];
      bus.emit(event, items);
      await menu.updateComplete;
      const button = menu.shadowRoot.getElementById(buttonId);
      button.click();
      await menu.updateComplete;
      expect(menu.openMenu).toBe(label.toLowerCase());

      items[0].selected = false;
      bus.emit(event, items);
      await menu.updateComplete;
      button.click();
      await menu.updateComplete;

      expect(menu.openMenu).toBeNull();
      expect(button.querySelector('.menu-count-badge').textContent).toBe(`${label} Beta`);

      items[1].name = `${label} Renamed`;
      bus.emit(event, items);
      await menu.updateComplete;
      expect(button.querySelector('.menu-count-badge').textContent).toBe(`${label} Renamed`);

      items[1].selected = false;
      bus.emit(event, items);
      await menu.updateComplete;
      expect(button.querySelector('.menu-count-badge')).toBeNull();
    });
  });
});