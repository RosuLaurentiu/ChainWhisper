import { useEffect, useState } from 'react';

/** Release background startup after first content, or a bounded wait if that read fails to settle. */
export default function useInitialReadPriority(scope: string | null, pending: boolean): boolean {
  const [releasedScope, setReleasedScope] = useState<string | null>(null);
  const defer = Boolean(scope) && pending && releasedScope !== scope;
  useEffect(() => {
    if (!scope || !defer) return;
    // A stalled foreground read must not starve required notifications forever.
    const timer = window.setTimeout(() => setReleasedScope(scope), 30_000);
    return () => window.clearTimeout(timer);
  }, [scope, defer]);
  return defer;
}
