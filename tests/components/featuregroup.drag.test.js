import { describe, expect, it, vi } from 'vitest';
import { FeatureGroup } from '../../www/js/components/FeatureGroup.lit.js';

describe('FeatureGroup drag interactions', () => {
  function pointerEventLike(overrides = {}) {
    const target = {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    };
    return {
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      preventDefault: () => {},
      stopPropagation: () => {},
      currentTarget: target,
      ...overrides,
    };
  }

  it('emits group-toggle on click-like pointer interaction', async () => {
    await customElements.whenDefined('feature-group');
    const el = document.createElement('feature-group');
    el.group = { id: 'g1', name: 'G1' };
    const spy = vi.fn();
    el.addEventListener('group-toggle', spy);

    el._onPointerDown(pointerEventLike({ clientX: 10, clientY: 10 }));
    el._onPointerUp(pointerEventLike({ clientX: 10, clientY: 10 }));

    expect(spy).toHaveBeenCalledOnce();
  });

  it('emits drag preview and drag end after pointer movement passes threshold', async () => {
    await customElements.whenDefined('feature-group');
    const el = document.createElement('feature-group');
    el.group = { id: 'g1', name: 'G1' };
    const previewSpy = vi.fn();
    const endSpy = vi.fn();
    el.addEventListener('group-drag-preview', previewSpy);
    el.addEventListener('group-drag-end', endSpy);

    el._onPointerDown(pointerEventLike({ clientX: 10, clientY: 10 }));
    el._onPointerMove(pointerEventLike({ clientX: 24, clientY: 10 }));
    el._onPointerUp(pointerEventLike({ clientX: 24, clientY: 10 }));

    expect(previewSpy).toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalledOnce();
    const previewDetail = previewSpy.mock.calls[0][0].detail;
    const endDetail = endSpy.mock.calls[0][0].detail;
    expect(previewDetail.deltaX).toBe(14);
    expect(previewDetail.deltaY).toBe(0);
    expect(endDetail.deltaX).toBe(14);
    expect(endDetail.deltaY).toBe(0);
  });

  it('updates live drag preview state for visual feedback', async () => {
    await customElements.whenDefined('feature-group');
    const el = document.createElement('feature-group');
    el.group = { id: 'g1', name: 'G1' };
    el.start = '2025-01-10';
    el.end = '2025-01-20';
    el.style.left = '120px';
    el._dateFromLeftPx = vi
      .fn()
      .mockReturnValueOnce(new Date('2025-01-10T00:00:00Z'))
      .mockReturnValueOnce(new Date('2025-01-12T00:00:00Z'));

    el._onPointerDown(pointerEventLike({ clientX: 10, clientY: 10 }));
    el._onPointerMove(pointerEventLike({ clientX: 24, clientY: 16 }));

    expect(el._dragDx).toBe(14);
    expect(el._dragDy).toBe(0);
    expect(el._dragDeltaDays).toBe(2);
    expect(el._previewStart).toBe('2025-01-12');
    expect(el._previewEnd).toBe('2025-01-22');
  });

  it('clears the visual preview before notifying group drag-end listeners', async () => {
    await customElements.whenDefined('feature-group');
    const el = document.createElement('feature-group');
    el.group = { id: 'g1', name: 'G1' };
    const endSpy = vi.fn(() => ({
      dragDx: el._dragDx,
      dragDy: el._dragDy,
      dragDeltaDays: el._dragDeltaDays,
    }));
    el.addEventListener('group-drag-end', endSpy);

    el._onPointerDown(pointerEventLike({ clientX: 10, clientY: 10 }));
    el._onPointerMove(pointerEventLike({ clientX: 24, clientY: 10 }));
    el._onPointerUp(pointerEventLike({ clientX: 24, clientY: 10 }));

    expect(endSpy).toHaveBeenCalledOnce();
    expect(endSpy.mock.results[0].value).toEqual({
      dragDx: 0,
      dragDy: 0,
      dragDeltaDays: 0,
    });
  });

  it('does not animate the drag transform after drop', () => {
    expect(FeatureGroup.styles.cssText).not.toContain('transform 80ms ease');
  });

  it('locks drag to one axis after direction is detected', async () => {
    await customElements.whenDefined('feature-group');
    const el = document.createElement('feature-group');
    el.group = { id: 'g1', name: 'G1' };
    const previewSpy = vi.fn();
    const endSpy = vi.fn();
    el.addEventListener('group-drag-preview', previewSpy);
    el.addEventListener('group-drag-end', endSpy);

    // First significant movement is vertical-dominant, so lock should be vertical.
    el._onPointerDown(pointerEventLike({ clientX: 10, clientY: 10 }));
    el._onPointerMove(pointerEventLike({ clientX: 12, clientY: 24 }));
    el._onPointerMove(pointerEventLike({ clientX: 28, clientY: 40 }));
    el._onPointerUp(pointerEventLike({ clientX: 28, clientY: 40 }));

    const firstPreview = previewSpy.mock.calls[0][0].detail;
    const secondPreview = previewSpy.mock.calls[1][0].detail;
    const endDetail = endSpy.mock.calls[0][0].detail;
    expect(firstPreview.axis).toBe('vertical');
    expect(firstPreview.deltaX).toBe(0);
    expect(secondPreview.deltaX).toBe(0);
    expect(endDetail.deltaX).toBe(0);
    expect(endDetail.axis).toBe('vertical');
  });
});
