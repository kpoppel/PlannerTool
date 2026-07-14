import { isEnabled } from '../config.js';

class PluginPortfolio {
  constructor(id = 'plugin-portfolio-board', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._host = null;
    this._componentLoaded = false;
    this.initialized = false;
    this.active = false;
    this._savedTimelineBoardDisplay = '';
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Portfolio Board',
      description:
        this.config.description ||
        'Kanban-style portfolio board with team rows and workflow state columns',
      icon: this.config.icon || 'view_kanban',
      section: 'tools',
      autoActivate: false,
      fullscreen: this.config.fullscreen || false,
    };
  }

  async init() {
    if (!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if (!this._componentLoaded) {
      await import('./PluginPortfolioComponent.lit.js');
      this._componentLoaded = true;
    }

    const selector = this.config.mountPoint || 'app';
    this._host =
      document.querySelector(`#${selector}`) ||
      document.querySelector(`.${selector}`) ||
      document.body;
    this.initialized = true;
  }

  async activate() {
    if (!this._componentLoaded) await this.init();
    if (!this._host) {
      const selector = this.config.mountPoint || 'app';
      this._host =
        document.querySelector(`#${selector}`) ||
        document.querySelector(`.${selector}`) ||
        document.body;
    }

    if (!this._el) {
      this._el = document.createElement('plugin-portfolio-board');
      this._el.classList.add('main');
      this._el.style.display = 'none';
      this._host.appendChild(this._el);
    }
    this._el.api = this.api;

    if (this.config.fullscreen) {
      const timelineBoard = document.querySelector('timeline-board');
      if (timelineBoard) {
        this._savedTimelineBoardDisplay = timelineBoard.style.display || '';
        timelineBoard.style.display = 'none';
      }
      this._el.style.display = 'flex';
    }

    if (this._el && typeof this._el.open === 'function') this._el.open();
    this.active = true;
  }

  async deactivate() {
    if (this._el && typeof this._el.close === 'function') this._el.close();

    if (this.config.fullscreen) {
      const timelineBoard = document.querySelector('timeline-board');
      if (timelineBoard) {
        timelineBoard.style.display = this._savedTimelineBoardDisplay || '';
      }
      if (this._el) this._el.style.display = 'none';
    }

    this.active = false;
  }

  async destroy() {
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    this.initialized = false;
    this.active = false;
  }

  toggle() {
    this.active ? this.deactivate() : this.activate();
  }
}

export default PluginPortfolio;
