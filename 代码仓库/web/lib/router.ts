import { useEffect, useState, useCallback } from 'react';

export function useRoute(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);
  return [path, navigate];
}