import { useEffect, useState } from 'react';

const KEYBOARD_HEIGHT_THRESHOLD = 120;

const isTextEntryTarget = (element: Element | null): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
};

export default function useVisualViewportKeyboardOpen(enabled = true): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setOpen(false);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame = 0;
    let baselineHeight = Math.max(window.innerHeight, viewport.height);

    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const textEntryFocused = isTextEntryTarget(document.activeElement);
        if (!textEntryFocused) {
          baselineHeight = Math.max(baselineHeight, window.innerHeight, viewport.height);
          setOpen(false);
          return;
        }
        const viewportReduction = baselineHeight - viewport.height;
        const layoutReduction = window.innerHeight - viewport.height;
        setOpen(Math.max(viewportReduction, layoutReduction) >= KEYBOARD_HEIGHT_THRESHOLD);
      });
    };

    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    measure();

    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('focusout', measure);
    };
  }, [enabled]);

  return open;
}
