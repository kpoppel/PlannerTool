import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import '../../www/js/components/OnboardingModal.lit.js';

describe('OnboardingModal expanded tests', () => {
  beforeEach(() => {
    // ensure clean localStorage
    try {
      localStorage.removeItem('az_planner:onboarding_seen');
    } catch (e) {}
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
    document.body.appendChild(el);

    // wait for a short time for lifecycle hooks
    await new Promise((r) => setTimeout(r, 20));

    const inner = el.renderRoot && el.renderRoot.querySelector('modal-lit');
    expect(inner).to.exist;
    expect(inner.open).to.equal(true);

    el.remove();
  });

  it('_dontShowAgain sets localStorage and closes inner modal', async () => {
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
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 20));

    // call dontShowAgain
    el._dontShowAgain();

    expect(localStorage.getItem('az_planner:onboarding_seen')).to.equal('1');

    // inner should be closed or element removed
    const inner = el.renderRoot && el.renderRoot.querySelector('modal-lit');
    if (inner) expect(inner.open).to.equal(false);

    // cleanup
    try {
      el.remove();
    } catch (e) {}
  });
});
