import { useEffect, useState } from "react";
import { fetchSignedImageUrl } from "../../services/records";
import { signedUrlCache } from "../../services/signedUrlCache";

interface RecordThumbnailProps {
  record: {
    id: string;
    hasImage?: boolean;
    imageMimeType?: string | null;
    thumbnailUrl?: string | null;
    foods: Array<{ name: string }>;
  };
  size?: "thumb" | "fallback-letter";
  alt: string;
}

/**
 * Image source priority for a record:
 *   1. Legacy inline `thumbnailUrl` (one-shot localStorage migration).
 *   2. OSS-backed image, fetched on demand via the auth-gated
 *      `/api/records/:id/image-url` endpoint and cached in memory
 *      until ~1 minute before the server-stated expiry.
 *
 * On 401 / 404 / network failure the placeholder is shown.
 */
export function RecordThumbnail({ record, size = "thumb", alt }: RecordThumbnailProps) {
  const [src, setSrc] = useState<string | null>(() => {
    if (record.thumbnailUrl) return record.thumbnailUrl;
    if (!record.hasImage) return null;
    return signedUrlCache.get(record.id);
  });
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (record.thumbnailUrl) {
      setSrc(record.thumbnailUrl);
      return;
    }
    if (!record.hasImage) {
      setSrc(null);
      return;
    }
    const cached = signedUrlCache.get(record.id);
    if (cached) {
      setSrc(cached);
      return;
    }
    fetchSignedImageUrl(record.id)
      .then(({ url, expiresIn }) => {
        if (cancelled) return;
        signedUrlCache.set(record.id, url, expiresIn);
        setSrc(url);
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [record.id, record.hasImage, record.thumbnailUrl]);

  const className = size === "thumb" ? "thumb thumb-fallback-letter" : "thumb thumb-letter";

  if (errored || (!src && !record.foods.length)) {
    return <div className={className}>{getFirstLetter(record)}</div>;
  }
  if (!src) {
    return <div className={className}>{getFirstLetter(record)}</div>;
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

function getFirstLetter(record: RecordThumbnailProps["record"]): string {
  const name = record.foods[0]?.name || "饭";
  return name.trim().charAt(0) || "饭";
}
