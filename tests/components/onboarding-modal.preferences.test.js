import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import '../../www/js/components/OnboardingModal.lit.js';

describe('OnboardingModal shared documentation view', () => {
  beforeEach(() => {
    // ensure clean localStorage
    try {
      localStorage.removeItem('az_planner:onboarding_seen');
    } catch (e) {
      // localStorage may be unavailable in this environment
    }
  });

  it('firstUpdated opens inner modal when mounted', async () => {
    // Provide a minimal modal-lit so firstUpdated can set open=true
    if (!customElements.get('modal-lit')) {
      class FakeModal extends HTMLElement {
        constructor() {
          super();
          this.open = false;
        }
        close() {
          this.open = false;
        }
      }
      customElements.define('modal-lit', FakeModal);
    }

    const el = document.createElement('onboarding-modal');
    window.IS_VITE_DEV = true;
    document.body.appendChild(el);

    // wait for a short time for lifecycle hooks
    await new Promise((r) => setTimeout(r, 20));

    const inner = el.renderRoot && el.renderRoot.querySelector('modal-lit');
    expect(inner).to.exist;
    expect(inner.open).to.equal(true);
    expect(el.renderRoot.querySelector('iframe').getAttribute('src'))
      .to.equal('/docs/onboarding/index.html?embedded=1');

    el.remove();
    delete window.IS_VITE_DEV;
  });

  it('closes without persisting an onboarding display flag', async () => {
    // Provide modal-lit with close spy
    if (!customElements.get('modal-lit')) {
      class FakeModal extends HTMLElement {
        constructor() {
          super();
          this.open = true;
        }
        close() {
          this.open = false;
        }
      }
      customElements.define('modal-lit', FakeModal);
    }

    const el = document.createElement('onboarding-modal');
    window.IS_VITE_DEV = true;
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 20));

    el.renderRoot.querySelector('button').click();
    expect(localStorage.getItem('az_planner:onboarding_seen')).to.equal(null);

    // inner should be closed or element removed
    const inner = el.renderRoot && el.renderRoot.querySelector('modal-lit');
    if (inner) expect(inner.open).to.equal(false);

    // cleanup
    try {
      el.remove();
    } catch (e) {
      // element may already be detached
    }
    delete window.IS_VITE_DEV;
  });
});
