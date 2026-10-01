import { afterEach, describe, expect, it } from 'vitest';
import PluginRegistry from '../../www/js/core/pluginRegistry.js';
import modulesConfig from '../../www/js/modules.config.json';

const config = modulesConfig.modules.find((entry) => entry.id === 'plugin-reconciliation');
const schemaFiles = import.meta.glob('../../www/js/plugins/*.schema.json', {
  query: '?raw', import: 'default', eager: true,
});

describe('Reconciliation plugin shell', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  async function openMenu() {
    const plugin = new PluginRegistry[config.id](config.id, config);
    await plugin.init();
    const element = plugin.createMenuElement();
    document.body.appendChild(element);
    await element.updateComplete;
    return { plugin, element };
  }

  it('registers an enabled nonexclusive menu, not a startup tool', () => {
    expect(config.type).toBe('menu');
    expect(config.enabled).toBe(true);
    expect(config.activateOnStartup).toBe(false);
    expect(config.exclusive).toBe(false);
    expect(config.menuPosition).toBe('before-tools');
  });

  it('publishes a discoverable JSON configuration schema for the admin page', () => {
    const className = config.id.split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
    const schemaJson = schemaFiles[`../../www/js/plugins/${className}.schema.json`];
    expect(schemaJson).toBeTypeOf('string');
    const schemaData = JSON.parse(schemaJson);
    expect(schemaData).toEqual({
      schema: {
        type: 'object',
        title: 'Reconciliation Configuration',
        properties: {},
        required: [],
      },
      defaultConfig: {},
    });
  });

  it('requires initialization before creating its menu', () => {
    const plugin = new PluginRegistry[config.id](config.id, config);
    expect(() => plugin.createMenuElement()).toThrow('not initialized');
  });

  it('opens without activation, fabricated records, or a board scope dependency', async () => {
    const { plugin, element } = await openMenu();
    expect(plugin.initialized).toBe(true);
    expect(plugin.active).toBe(false);
    expect(element.shadowRoot.querySelectorAll('[data-queue]')).toHaveLength(8);
    expect(element.shadowRoot.querySelector('[role="status"]').textContent)
      .toContain('Reconciliation queue unavailable.');
    expect(element.shadowRoot.querySelectorAll('input, select')).toHaveLength(0);
    await expect(plugin.activate()).rejects.toThrow('not activated');
    await plugin.destroy();
    expect(plugin.initialized).toBe(false);
  });

  it('switches every responsibility queue and updates the detail heading', async () => {
    const { element } = await openMenu();
    for (const button of element.shadowRoot.querySelectorAll('[data-queue]')) {
      button.click();
      await element.updateComplete;
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(element.shadowRoot.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
      expect(element.shadowRoot.querySelector('h3').textContent).toBe(button.textContent);
    }
  });

  it('requests dismissal through the composed menu-close contract', async () => {
    const { element } = await openMenu();
    let closeEvent;
    document.body.addEventListener('menu-close', (event) => { closeEvent = event; }, { once: true });
    element.shadowRoot.querySelector('.close').click();
    expect(closeEvent.bubbles).toBe(true);
    expect(closeEvent.composed).toBe(true);
  });
});