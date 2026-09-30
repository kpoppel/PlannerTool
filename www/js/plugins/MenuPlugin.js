import { Plugin } from '../core/Plugin.js';

export class MenuPlugin extends Plugin {
  /** @returns {HTMLElement & {updateComplete?: Promise<boolean>}} */
  createMenuElement() {
    throw new Error(`Menu plugin ${this.id} must implement createMenuElement()`);
  }

  async activate() {
    throw new Error(`Menu plugin ${this.id} is opened by the top menu, not activated`);
  }

  async deactivate() {
    this.active = false;
  }

  async destroy() {
    this.initialized = false;
  }
}