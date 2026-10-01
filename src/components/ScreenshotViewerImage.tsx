import React, { useState, useEffect } from 'react';
import { ScreenshotLog } from '../types';
import {
  getCachedScreenshot,
  loadCachedScreenshotAsync,
  isValidImageSrc,
} from '../lib/screenshotCache';
import { Monitor, HardDrive, ExternalLink, ImageOff } from 'lucide-react';

interface ScreenshotViewerImageProps {
  screen: ScreenshotLog;
  className?: string;
  alt?: string;
  isModal?: boolean;
}

export const ScreenshotViewerImage: React.FC<ScreenshotViewerImageProps> = ({
  screen,
  className = '',
  alt,
  isModal = false,
}) => {
  const [activeSrc, setActiveSrc] = useState<string>('');
  const [triedDriveFallback, setTriedDriveFallback] = useState(false);
  const [triedCdnFallback, setTriedCdnFallback] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Determine initial best source
  useEffect(() => {
    let isMounted = true;
    setAllFailed(false);
    setTriedDriveFallback(false);
    setTriedCdnFallback(false);
    setIsLoading(true);

    // 1. Check local cache first (pristine local capture)
    const cached = getCachedScreenshot(screen.id);
    if (cached && isValidImageSrc(cached)) {
      setActiveSrc(cached);
      setIsLoading(false);
      return;
    }

    // 2. Check async IndexedDB cache
    loadCachedScreenshotAsync(screen.id).then((asyncCached) => {
      if (!isMounted) return;
      if (asyncCached && isValidImageSrc(asyncCached)) {
        setActiveSrc(asyncCached);
        setIsLoading(false);
        return;
      }

      // 3. Check screen.previewDataUrl
      if (isValidImageSrc(screen.previewDataUrl)) {
        setActiveSrc(screen.previewDataUrl);
        setIsLoading(false);
        return;
      }

      // 4. Drive thumbnail link
      if (screen.driveThumbnailLink) {
        setActiveSrc(screen.driveThumbnailLink);
        setIsLoading(false);
        return;
      }

      // 5. Drive CDN via fileId
      if (screen.driveFileId) {
        setActiveSrc(`https://lh3.googleusercontent.com/d/${screen.driveFileId}`);
        setIsLoading(false);
        return;
      }

      // If nothing is valid
      setAllFailed(true);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [screen.id, screen.previewDataUrl, screen.driveFileId, screen.driveThumbnailLink]);

  const handleImageError = () => {
    // Ladder down to next fallback
    if (!triedDriveFallback && screen.driveFileId) {
      setTriedDriveFallback(true);
      setActiveSrc(`https://drive.google.com/thumbnail?id=${screen.driveFileId}&sz=w1000`);
      return;
    }

    if (!triedCdnFallback && screen.driveFileId) {
      setTriedCdnFallback(true);
      setActiveSrc(`https://lh3.googleusercontent.com/d/${screen.driveFileId}`);
      return;
    }

    setAllFailed(true);
  };

  if (allFailed || !activeSrc) {
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-3 text-center bg-slate-900 text-slate-300 select-none ${className}`}
      >
        <div className="w-9 h-9 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-1.5">
          <Monitor className="w-5 h-5" />
        </div>
        <div className="text-[11px] font-semibold text-slate-200 truncate max-w-full px-2">
          {screen.taskName || 'Desktop Capture'}
        </div>
        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
          {screen.timeFormatted} ({screen.hourKey})
        </div>

        {screen.driveWebLink && (
          <a
            href={screen.driveWebLink}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 hover:underline bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700"
          >
            <HardDrive className="w-3 h-3 text-indigo-400" />
            <span>Open in Google Drive</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full bg-slate-950 overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 z-10">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
      <img
        src={activeSrc}
        alt={alt || screen.taskName || 'Screen capture'}
        onError={handleImageError}
        onLoad={() => setIsLoading(false)}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        className={`w-full h-full ${
          isModal ? 'object-contain' : 'object-cover'
        } transition-all duration-300`}
      />
    </div>
  );
};
