import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Warns on navigation (both in-app and browser close/refresh) while
 * `isBlocking` is true. Returns the router blocker so UI can render a dialog.
 */
export function useNavigationGuard(isBlocking: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return isBlocking && currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    if (!isBlocking) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isBlocking]);

  return blocker;
}
