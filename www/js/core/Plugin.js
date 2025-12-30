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
   * @returns {{id:string,name:string,title:string,enabled:boolean,version:string,description:string,author:string,dependencies:string[]}}
   */
  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || this.id,
      title: this.config.title || this.config.name || this.id,
      enabled: this.config.enabled === true,
      version: this.config.version || '1.0.0',
      description: this.config.description || '',
      author: this.config.author || 'Unknown',
      dependencies: this.config.dependencies || []
    };
  }
}

export default Plugin;
