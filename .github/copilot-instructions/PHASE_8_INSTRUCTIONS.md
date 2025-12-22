# Phase 8: Lit Components - Copilot Instructions

**Goal:** Convert FeatureCard and Modal to Lit 3.3.1  
**Pattern:** Parallel implementation with feature flag  
**Duration:** 3 days

---

## Quick Start

```bash
# Install Lit
npm install lit@3.3.1

# Run component tests
npm run test:watch -- --grep "FeatureCardLit|ModalLit"
```

---

## Step 1: Create FeatureCard Component (Day 1)

### File: `www/js/components/FeatureCard.lit.js`

```javascript
import { LitElement, html, css } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { bus } from '../eventBus.js';

export class FeatureCardLit extends LitElement {
  @property({ type: Object }) feature = null;
  @property({ type: Boolean }) selected = false;
  
  static styles = css`
    .feature-card {
      border: 2px solid #ccc;
      border-radius: 4px;
      padding: 12px;
      background: white;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .feature-card:hover {
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      transform: translateY(-2px);
    }
    
    .feature-card.selected {
      border-color: #0078d4;
      background: #f0f8ff;
    }
    
    .feature-title {
      font-weight: bold;
      font-size: 14px;
    }
  `;
  
  render() {
    if (!this.feature) return html`<div>No data</div>`;
    
    const classes = {
      'feature-card': true,
      'selected': this.selected
    };
    
    return html`
      <div class=${classMap(classes)} @click=${this._handleClick}>
        <div class="feature-title">${this.feature.title}</div>
        <div class="feature-id">#${this.feature.id}</div>
      </div>
    `;
  }
  
  _handleClick() {
    bus.emit('details:show', this.feature);
  }
}

customElements.define('feature-card-lit', FeatureCardLit);
```

---

## Step 2: Write FeatureCard Tests (Day 1)

### File: `tests/components/test-feature-card-lit.test.js`

```javascript
import { expect, fixture, html } from '@open-wc/testing';
import '../../www/js/components/FeatureCard.lit.js';

describe('FeatureCardLit', () => {
  it('should render feature title', async () => {
    const feature = { id: 'f1', title: 'Test Feature', capacity: [] };
    
    const el = await fixture(html`
      <feature-card-lit .feature=${feature}></feature-card-lit>
    `);
    
    const title = el.shadowRoot.querySelector('.feature-title');
    expect(title.textContent).to.equal('Test Feature');
  });
  
  it('should emit details:show on click', async () => {
    const feature = { id: 'f1', title: 'Test', capacity: [] };
    let emitted = false;
    
    const bus = (await import('../../www/js/eventBus.js')).bus;
    bus.on('details:show', () => { emitted = true; });
    
    const el = await fixture(html`
      <feature-card-lit .feature=${feature}></feature-card-lit>
    `);
    
    el.shadowRoot.querySelector('.feature-card').click();
    expect(emitted).to.be.true;
  });
  
  // Add 4 more tests
});
```

---

## Step 3: Create Modal Component (Day 2)

### File: `www/js/components/Modal.lit.js`

```javascript
import { LitElement, html, css } from 'lit';
import { property } from 'lit/decorators.js';

export class ModalLit extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: String }) title = '';
  
  static styles = css`
    :host {
      display: none;
    }
    
    :host([open]) {
      display: block;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
    }
    
    .modal-backdrop {
      position: absolute;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
    }
    
    .modal-container {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 8px;
      min-width: 400px;
    }
    
    .modal-header {
      padding: 16px;
      border-bottom: 1px solid #e0e0e0;
    }
  `;
  
  render() {
    return html`
      <div class="modal-backdrop" @click=${this._handleBackdropClick}></div>
      <div class="modal-container">
        <div class="modal-header">
          <h2>${this.title}</h2>
          <button @click=${this.close}>×</button>
        </div>
        <div class="modal-content">
          <slot></slot>
        </div>
      </div>
    `;
  }
  
  close() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('modal-close'));
  }
  
  _handleBackdropClick(e) {
    if (e.target.classList.contains('modal-backdrop')) {
      this.close();
    }
  }
  
  updated(changedProperties) {
    if (changedProperties.has('open')) {
      this.toggleAttribute('open', this.open);
    }
  }
}

customElements.define('modal-lit', ModalLit);
```

---

## Step 4: Write Modal Tests (Day 2)

### File: `tests/components/test-modal-lit.test.js`

```javascript
import { expect, fixture, html } from '@open-wc/testing';
import '../../www/js/components/Modal.lit.js';

describe('ModalLit', () => {
  it('should render title', async () => {
    const el = await fixture(html`
      <modal-lit title="Test Modal" open></modal-lit>
    `);
    
    const title = el.shadowRoot.querySelector('h2');
    expect(title.textContent).to.equal('Test Modal');
  });
  
  it('should close on button click', async () => {
    const el = await fixture(html`
      <modal-lit open></modal-lit>
    `);
    
    const closeBtn = el.shadowRoot.querySelector('button');
    closeBtn.click();
    
    expect(el.open).to.be.false;
  });
  
  // Add 4 more tests
});
```

**Run:** `npm test` → 12 new tests (6 per component)

---

## Step 5: Create Component Factory (Day 3)

### File: `www/js/componentFactory.js`

```javascript
import { featureFlags } from './config.js';

export async function createFeatureCard(feature, container) {
  if (featureFlags.USE_LIT_COMPONENTS) {
    // Use Lit component
    await import('./components/FeatureCard.lit.js');
    const card = document.createElement('feature-card-lit');
    card.feature = feature;
    container.appendChild(card);
    return card;
  } else {
    // Use vanilla
    const { renderFeatureCard } = await import('./featureCard.js');
    return renderFeatureCard(feature, container);
  }
}

export async function createModal(title, content) {
  if (featureFlags.USE_LIT_COMPONENTS) {
    await import('./components/Modal.lit.js');
    const modal = document.createElement('modal-lit');
    modal.title = title;
    modal.innerHTML = content;
    modal.open = true;
    document.body.appendChild(modal);
    return modal;
  } else {
    const { showModal } = await import('./modal.js');
    return showModal(title, content);
  }
}
```

---

## Step 6: Update Feature Flag (Day 3)

### File: `www/js/config.js` (ADD)

```javascript
export const featureFlags = {
  // ... existing flags ...
  USE_LIT_COMPONENTS: false  // ADD THIS
};
```

---

## Step 7: Manual Testing (Day 3)

### Test with Flag OFF (Vanilla)
```javascript
// www/js/config.js
USE_LIT_COMPONENTS: false
```

1. Open app
2. Verify feature cards render
3. Click card → details panel opens
4. Open modal (e.g., scenario creation)
5. Close modal
6. All should work normally

### Test with Flag ON (Lit)
```javascript
// www/js/config.js
USE_LIT_COMPONENTS: true
```

1. Open app
2. Verify feature cards render (Lit version)
3. Inspect element: should see `<feature-card-lit>` in DOM
4. Click card → details panel opens
5. Open modal → should see `<modal-lit>` in DOM
6. Close modal
7. Compare visually: should look identical

### Visual Regression Check
- Take screenshot with flag OFF
- Take screenshot with flag ON
- Compare: colors, spacing, fonts should match

---

## Acceptance Criteria

- [ ] Lit 3.3.1 installed
- [ ] FeatureCardLit created
- [ ] ModalLit created
- [ ] 12 component tests passing (6 per component)
- [ ] 235 total tests passing (223 + 12)
- [ ] componentFactory.js created
- [ ] USE_LIT_COMPONENTS flag added
- [ ] Flag OFF: vanilla works
- [ ] Flag ON: Lit works
- [ ] Visual appearance identical
- [ ] No console errors

---

## Troubleshooting

**Issue:** Lit styles not applying  
**Fix:** Check `static styles = css\`...\`` is before `render()`

**Issue:** Properties not updating  
**Fix:** Use `@property()` decorator, not plain fields

**Issue:** Events not firing  
**Fix:** Use `@click=${handler}` not `onclick="handler()"`

**Issue:** Shadow DOM CSS doesn't inherit  
**Fix:** Use CSS variables: `var(--theme-color)` in both places

---

## Next: Phase 9 - Convert Remaining Components

Phase 9 will convert:
- MainGraph
- Timeline
- Sidebar
- DetailsPanel
- DragManager
- DependencyRenderer

Same pattern: component class + tests + feature flag.
