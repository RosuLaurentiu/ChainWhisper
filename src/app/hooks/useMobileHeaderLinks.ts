import { useEffect, useState, type RefObject } from 'react';
import type { StateUpdate } from '../../shared/state/storeUtils';

const MOBILE_NAV_BREAKPOINT_PX = 920;

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
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_NAV_BREAKPOINT_PX : false
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
      const isMobile = window.innerWidth <= MOBILE_NAV_BREAKPOINT_PX;
      setIsMobileNav(isMobile);
      if (!isMobile) {
        setMobileLinksOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [setMobileLinksOpen]);

  return isMobileNav;
}
