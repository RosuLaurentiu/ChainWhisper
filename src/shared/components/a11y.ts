import type { KeyboardEvent } from 'react';

type RovingFocusOrientation = 'horizontal' | 'vertical' | 'both';

type RovingFocusOptions = {
  orientation?: RovingFocusOrientation;
  selector?: string;
};

const DEFAULT_ROVING_SELECTOR =
  'button:not(:disabled), [role="tab"]:not([aria-disabled="true"]), [role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"])';

export const moveFocusWithin = (
  event: KeyboardEvent<HTMLElement>,
  { orientation = 'both', selector = DEFAULT_ROVING_SELECTOR }: RovingFocusOptions = {}
) => {
  const horizontal = orientation === 'horizontal' || orientation === 'both';
  const vertical = orientation === 'vertical' || orientation === 'both';
  const direction =
    event.key === 'Home'
      ? 'first'
      : event.key === 'End'
        ? 'last'
        : horizontal && event.key === 'ArrowRight'
          ? 'next'
          : horizontal && event.key === 'ArrowLeft'
            ? 'previous'
            : vertical && event.key === 'ArrowDown'
              ? 'next'
              : vertical && event.key === 'ArrowUp'
                ? 'previous'
                : null;

  if (!direction) {
    return false;
  }

  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector)).filter(
    (item) => !item.hasAttribute('hidden') && item.getAttribute('aria-hidden') !== 'true'
  );
  if (items.length === 0) {
    return false;
  }

  const activeIndex = Math.max(0, items.findIndex((item) => item === document.activeElement));
  const nextIndex =
    direction === 'first'
      ? 0
      : direction === 'last'
        ? items.length - 1
        : direction === 'next'
          ? (activeIndex + 1) % items.length
          : (activeIndex - 1 + items.length) % items.length;

  event.preventDefault();
  items[nextIndex]?.focus();
  return true;
};

export const closeDetailsOnEscape = (event: KeyboardEvent<HTMLDetailsElement>) => {
  if (event.key !== 'Escape' || !event.currentTarget.open) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.open = false;
  event.currentTarget.querySelector('summary')?.focus();
};
