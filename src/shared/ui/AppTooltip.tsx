import { cloneElement, type ReactElement } from 'react';
import { createTooltipController, Tooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/react/tooltip';

/**
 * The App's hint tooltip (CW-165). It replaces the native `title` attribute: it has the App look, opens on hover
 * and at once on keyboard focus, and closes on Escape.
 *
 * All hints share one tooltip element, which `AppTooltipHost` renders once at the App root. `AppTooltip` adds no
 * element of its own: it connects its one child to that tooltip. Feature code must use these parts and must not
 * import ui-sdk tooltip parts directly.
 */
const controller = createTooltipController<string>();

export function AppTooltipHost() {
  return (
    <Tooltip controller={controller} container={typeof document === 'undefined' ? undefined : document.body}>
      <TooltipContent<string> className="app-tooltip" sideOffset={6} collisionPadding={8}>
        {(state) => state.payload}
      </TooltipContent>
    </Tooltip>
  );
}

type AppTooltipProps = {
  /** The hint. No tooltip shows when the text is not set. */
  text: string | false | null | undefined;
  /** The one element that the hint belongs to. It must have its own name: text or an `aria-label`. */
  children: ReactElement<{ 'aria-label'?: string }>;
};

export function AppTooltip({ text, children }: AppTooltipProps) {
  const hint = text || '';
  // The hint stays on the element as its description, as `title` did, so a screen reader and the page markup
  // have it before the tooltip opens. A hint that repeats the name of the element is not said twice.
  const description = hint && hint !== children.props['aria-label'] ? hint : undefined;

  // The trigger stays in the tree when the text is not set, so the child is not created again when a hint
  // appears or goes away. The host hides an empty tooltip.
  return (
    <TooltipTrigger
      controller={controller}
      payload={hint}
      aria-description={description}
      // ui-sdk gives its trigger the button type. Only a button takes that attribute.
      render={children.type === 'button' ? children : cloneElement(children, { type: null } as object)}
    />
  );
}
