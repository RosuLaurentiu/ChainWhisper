import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

type UseModalA11yOptions = {
  closeDisabled?: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
  onClose: () => void;
};

export const useModalA11y = ({ closeDisabled = false, dialogRef, isOpen, onClose }: UseModalA11yOptions) => {
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const firstFocusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? dialog).focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || closeDisabledRef.current) {
        return;
      }

      event.preventDefault();
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusedElement?.focus();
    };
  }, [dialogRef, isOpen]);
};
