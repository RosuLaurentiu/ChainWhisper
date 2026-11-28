import type { MouseEvent, ReactNode } from 'react';
import { Dialog, DialogContent } from '@ui-sdk/react/dialog';

/**
 * The App's modal dialog (CW-160). ui-sdk supplies the behaviour: top layer, focus trap, inert page,
 * scroll lock, Escape and focus return. The App supplies the look: `surfaceClassName` is the full-screen
 * layer (for example `modal-backdrop`) and the children are the visible card.
 *
 * Feature code must use this wrapper and must not import `@ui-sdk/react/dialog` directly.
 */
type AppDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Class of the full-screen layer behind the card. A press on this layer closes the dialog. */
  surfaceClassName: string;
  /** Accessible name. Give `labelledBy` when the dialog shows a heading, otherwise `label`. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /** Element that receives the dialog markup. The default is the place where the dialog is rendered. */
  container?: Element | null;
  children: ReactNode;
};

export default function AppDialog({
  open,
  onClose,
  surfaceClassName,
  label,
  labelledBy,
  describedBy,
  container,
  children
}: AppDialogProps) {
  const closeOnSurfacePress = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      container={container}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        className={`app-dialog-surface ${surfaceClassName}`}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={closeOnSurfacePress}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
