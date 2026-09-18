import { afterEach, describe, expect, it } from 'vitest';
import { loadLocalPluginData, saveLocalPluginData } from '../../www/js/application/shared/localScenarioPluginData.js';

describe('application/shared/localScenarioPluginData', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns an empty bag when nothing is stored', () => {
    expect(loadLocalPluginData('baseline')).toEqual({});
  });

  it('round-trips a pluginData bag through localStorage', () => {
    saveLocalPluginData('baseline', { 'plugin-annotations': [{ id: 'ann_1' }] });
    expect(loadLocalPluginData('baseline')).toEqual({ 'plugin-annotations': [{ id: 'ann_1' }] });
  });

  it('keys storage per scenario id so scenarios do not clash', () => {
    saveLocalPluginData('baseline', { x: 1 });
    saveLocalPluginData('other', { x: 2 });
    expect(loadLocalPluginData('baseline')).toEqual({ x: 1 });
    expect(loadLocalPluginData('other')).toEqual({ x: 2 });
  });

  it('ignores corrupt stored JSON and falls back to an empty bag', () => {
    localStorage.setItem('plannerTool_localPluginData_baseline', '{not-json');
    expect(loadLocalPluginData('baseline')).toEqual({});
  });

  it('ignores non-object stored payloads and falls back to an empty bag', () => {
    localStorage.setItem('plannerTool_localPluginData_baseline', JSON.stringify([1, 2, 3]));
    expect(loadLocalPluginData('baseline')).toEqual({});
  });
});
