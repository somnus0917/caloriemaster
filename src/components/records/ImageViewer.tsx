import { useEffect, useState } from "react";
import { fetchSignedImageUrl } from "../../services/records";
import { signedUrlCache } from "../../services/signedUrlCache";

interface ImageViewerProps {
  recordId: string;
  hasImage: boolean;
  hasOriginalImage: boolean;
  alt: string;
  onClose: () => void;
}

/**
 * Full-screen image viewer that loads the original image on demand.
 * Shows a loading spinner while fetching, and allows closing via
 * backdrop click, Escape key, or the close button.
 */
export function ImageViewer({ recordId, hasImage, hasOriginalImage, alt, onClose }: ImageViewerProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!hasOriginalImage && !hasImage) {
      setLoading(false);
      setErrored(true);
      return;
    }

    // Try original first, fall back to thumbnail
    const type = hasOriginalImage ? "original" : "thumbnail";
    const cached = signedUrlCache.get(recordId, type);
    if (cached) {
      setSrc(cached);
      setLoading(false);
      return;
    }

    fetchSignedImageUrl(recordId, type)
      .then(({ url, expiresIn }) => {
        if (cancelled) return;
        signedUrlCache.set(recordId, url, expiresIn, type);
        setSrc(url);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recordId, hasImage, hasOriginalImage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="image-viewer-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="image-viewer-content">
        <button
          className="image-viewer-close"
          type="button"
          onClick={onClose}
          aria-label="关闭"
        >
          ✕
        </button>
        {loading && (
          <div className="image-viewer-loading">
            <div className="spinner" />
            <p>加载中...</p>
          </div>
        )}
        {errored && (
          <div className="image-viewer-error">
            <p>图片加载失败</p>
          </div>
        )}
        {src && !loading && !errored && (
          <img
            className="image-viewer-img"
            src={src}
            alt={alt}
            onClick={onClose}
          />
        )}
      </div>
    </div>
  );
}