import type { ComponentProps, ReactNode } from 'react';
import { tabs } from '@ui-sdk/core/tabs';
import { createParts } from '@ui-sdk/react/primitive';

/**
 * The App's tab list (CW-161). ui-sdk supplies the behaviour: one tab stop, arrow keys, Home and End,
 * `aria-selected` and the disabled state. The App supplies the look through `className`.
 *
 * The root renders no element, so the tab list keeps its place in the page. Feature code must use these parts
 * and must not import ui-sdk tabs directly.
 */
const parts = createParts(tabs, { list: 'div', tab: 'button' });

type AppTabListProps<T extends string> = {
  /** The selected tab. No tab is selected when the value is not set. */
  value: T | undefined;
  onChange: (value: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
  children: ReactNode;
};

export function AppTabList<T extends string>({ value, onChange, label, className, children }: AppTabListProps<T>) {
  return (
    <parts.Root
      value={value ?? null}
      onValueChange={(next) => {
        if (next !== null && next !== value) {
          onChange(next as T);
        }
      }}
    >
      <parts.List className={className} aria-label={label}>
        {children}
      </parts.List>
    </parts.Root>
  );
}

type AppTabProps = Omit<ComponentProps<typeof parts.Tab>, 'className' | 'type'> & {
  /** Class that the tab always has. */
  className?: string;
  /** Class added while the tab is selected. The App stylesheets use `active`. */
  activeClassName?: string;
};

export function AppTab({ className, activeClassName = 'active', children, ...props }: AppTabProps) {
  return (
    <parts.Tab
      type="button"
      {...props}
      // The App stylesheets style the native disabled state, so a disabled tab stays a disabled button.
      render={props.disabled ? <button disabled /> : undefined}
      className={(state) =>
        [className, state.selected ? activeClassName : undefined].filter(Boolean).join(' ') || undefined
      }
    >
      {children}
    </parts.Tab>
  );
}
