import { useEffect, useState, useCallback } from 'react';

function canonicalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

function withTrailingSlash(to: string): string {
  const hashIndex = to.indexOf('#');
  const beforeHash = hashIndex >= 0 ? to.slice(0, hashIndex) : to;
  const hash = hashIndex >= 0 ? to.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex) : '';
  if (!path || path === '/') return to;
  return (path.endsWith('/') ? path : path + '/') + query + hash;
}

export function useRoute(): [string, (to: string) => void] {
  const [path, setPath] = useState(() => canonicalPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(canonicalPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    const href = withTrailingSlash(to);
    window.history.pushState(null, '', href);
    setPath(canonicalPath(new URL(href, window.location.origin).pathname));
    window.scrollTo(0, 0);
  }, []);
  return [path, navigate];
}
