export class Plugin {
  constructor(id, config = {}) {
    this.id = id;
    this.config = config;
    this.initialized = false;
    this.active = false;
  }

  async init() {
    throw new Error(`Plugin ${this.id} must implement init()`);
  }

  async activate() {
    throw new Error(`Plugin ${this.id} must implement activate()`);
  }

  async deactivate() {
    throw new Error(`Plugin ${this.id} must implement deactivate()`);
  }

  async destroy() {
    throw new Error(`Plugin ${this.id} must implement destroy()`);
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || this.id,
      version: this.config.version || '1.0.0',
      description: this.config.description || '',
      author: this.config.author || 'Unknown',
      dependencies: this.config.dependencies || []
    };
  }
}

export default Plugin;
