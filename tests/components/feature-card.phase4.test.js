import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

const mockSel = vi.hoisted(() => ({
  view: {
    getHighlightFeatureRelationMode: () => false,
  },
}));

const mockState = vi.hoisted(() => ({
  getEffectiveFeatureById: () => null,
  featureStateService: {
    isStateInCategory: () => false,
  },
  _viewService: {
    packedMode: false,
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: mockSel,
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
}));

import { FeatureCardLit } from '../../www/js/components/FeatureCard.lit.js';

describe('FeatureCard Phase 4 selector seam', () => {
  beforeEach(() => {
    mockSel.view.getHighlightFeatureRelationMode = () => false;
    mockState.getEffectiveFeatureById = () => null;
  });

  it('emits selected event without connected-set request when highlight mode is off', () => {
    const card = new FeatureCardLit();
    card.feature = { id: 'f1' };
    card.bus = { emit: vi.fn() };

    card._handleClick({ composedPath: () => [], detail: 1 });

    expect(card.bus.emit).toHaveBeenCalledWith(FeatureEvents.SELECTED, { id: 'f1' });
    expect(card.bus.emit).not.toHaveBeenCalledWith(
      FeatureEvents.REQUEST_CONNECTED_SET,
      expect.anything()
    );
  });

  it('uses sel.view highlight mode to request connected set before selected event', () => {
    const feature = { id: 'f2' };
    mockSel.view.getHighlightFeatureRelationMode = () => true;
    mockState.getEffectiveFeatureById = () => feature;

    const card = new FeatureCardLit();
    card.feature = feature;
    card.bus = { emit: vi.fn() };

    card._handleClick({ composedPath: () => [], detail: 1 });

    expect(card.bus.emit).toHaveBeenCalledWith(FeatureEvents.REQUEST_CONNECTED_SET, feature);
    expect(card.bus.emit).toHaveBeenCalledWith(FeatureEvents.SELECTED, feature);
  });
});
