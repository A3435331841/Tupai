import { useEffect, useState } from 'react';
import { fetchAssetBlob, apiUrl } from '@/lib/api';

// Private assets require the session header; load via fetch + object URL.
// Public logical paths (template covers) can load directly.
export function AssetImage({ path, alt, className, isPublic }: {
  path: string; alt: string; className?: string; isPublic?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(isPublic ? apiUrl(path) : null);
  useEffect(() => {
    if (isPublic) { setUrl(apiUrl(path)); return; }
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchAssetBlob(path).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setUrl(null); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, isPublic]);
  if (!url) return <div className={className} aria-label={alt} data-placeholder="true" />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}