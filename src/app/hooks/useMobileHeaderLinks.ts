import { useEffect, useState, type RefObject } from 'react';
import type { StateUpdate } from '../../shared/state/storeUtils';

const MOBILE_NAV_BREAKPOINT_PX = 920;
// The same limit as the mobile style rules. innerWidth is rounded, so at a fractional page width
// (display scaling) it can disagree with the styles; the media query uses the exact width.
export const MOBILE_NAV_QUERY = `(max-width: ${MOBILE_NAV_BREAKPOINT_PX}px)`;

type MobileNavViewport = Pick<Window, 'innerWidth'> & { matchMedia?: (query: string) => Pick<MediaQueryList, 'matches'> };

export function isMobileNavViewport(view: MobileNavViewport): boolean {
  return typeof view.matchMedia === 'function'
    ? view.matchMedia(MOBILE_NAV_QUERY).matches
    : view.innerWidth <= MOBILE_NAV_BREAKPOINT_PX;
}

type UseMobileHeaderLinksParams = {
  mobileLinksOpen: boolean;
  setMobileLinksOpen: (next: StateUpdate<boolean>) => void;
  topHeaderRef: RefObject<HTMLElement | null>;
};

export default function useMobileHeaderLinks({
  mobileLinksOpen,
  setMobileLinksOpen,
  topHeaderRef
}: UseMobileHeaderLinksParams) {
  const [isMobileNav, setIsMobileNav] = useState<boolean>(() =>
    typeof window !== 'undefined' ? isMobileNavViewport(window) : false
  );

  useEffect(() => {
    if (!mobileLinksOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || topHeaderRef.current?.contains(target)) {
        return;
      }

      setMobileLinksOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [mobileLinksOpen, setMobileLinksOpen, topHeaderRef]);

  useEffect(() => {
    const handleResize = () => {
      const isMobile = isMobileNavViewport(window);
      setIsMobileNav(isMobile);
      if (!isMobile) {
        setMobileLinksOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    // A sub-pixel width change can cross the limit without a resize event; the query reports each crossing.
    const mobileQuery = typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_NAV_QUERY) : null;
    mobileQuery?.addEventListener('change', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      mobileQuery?.removeEventListener('change', handleResize);
    };
  }, [setMobileLinksOpen]);

  return isMobileNav;
}
