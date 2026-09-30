/**
 * Module: Plugin
 * Base class for application plugins.
 * Intent: provide a minimal lifecycle and metadata contract.
 * Subclasses should implement `init`, `activate`, `deactivate`, `destroy` as needed.
 */
export class Plugin {
  constructor(id, config = {}) {
    this.id = id;
    this.config = config;
    this.initialized = false;
    this.active = false;
  }

  /**
   * Initialize plugin resources.
   * Override to perform async setup.
   * @returns {Promise<void>}
   * @throws {Error} when not implemented by subclass
   */
  async init() {
    throw new Error(`Plugin ${this.id} must implement init()`);
  }

  /**
   * Activate plugin runtime behavior (register event handlers, etc.).
   * @returns {Promise<void>}
   * @throws {Error} when not implemented by subclass
   */
  async activate() {
    throw new Error(`Plugin ${this.id} must implement activate()`);
  }

  /**
   * Deactivate plugin runtime behavior.
   * @returns {Promise<void>}
   * @throws {Error} when not implemented by subclass
   */
  async deactivate() {
    throw new Error(`Plugin ${this.id} must implement deactivate()`);
  }

  /**
   * Tear down and release resources.
   * @returns {Promise<void>}
   * @throws {Error} when not implemented by subclass
   */
  async destroy() {
    throw new Error(`Plugin ${this.id} must implement destroy()`);
  }

  /**
   * Return metadata describing the plugin configuration and capabilities.
  * @returns {{id:string,type:'hidden'|'tool'|'menu',name:string,enabled:boolean,
  * version:string,description:string,icon:string,dependencies:string[],exclusive:boolean,
  * persistent:boolean,fullscreen:boolean,menuPosition?:'before-tools'|'after-tools'}}
   */
  getMetadata() {
    return {
      id: this.id,
      type: this.config.type,
      name: this.config.name,
      enabled: this.config.enabled === true,
      version: this.config.version,
      description: this.config.description,
      icon: this.config.icon,
      dependencies: this.config.dependencies,
      exclusive: this.config.exclusive,
      persistent: this.config.persistent === true,
      fullscreen: this.isFullscreen,
      menuPosition: this.config.menuPosition,
    };
  }

  get isFullscreen() { return false; }
}

export default Plugin;
