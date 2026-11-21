import React, { useEffect, useState } from 'react';
import { FileQuestion, Film, Music, Pause, Play } from 'lucide-react';
import type { PxlArt } from '../types/pxl';
import { basenameOfAsset } from '../utils/pxl/readSpriteScripts';

interface PxlArtTileProps {
  art: PxlArt;
  libraryName?: string;
  /** Called when the user clicks to pick/use this asset (picker mode). */
  onSelect?: () => void;
  actionLabel?: string;
}

function formatBytes(len: number): string {
  if (len < 1024) return `${len} B`;
  if (len < 1024 * 1024) return `${(len / 1024).toFixed(1)} KB`;
  return `${(len / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Renders a single `.pxl` `file` entry with a lazy Blob URL created on mount
 * and revoked on unmount, keeping memory bounded even for 271-item libraries.
 */
export const PxlArtTile: React.FC<PxlArtTileProps> = ({
  art,
  libraryName,
  onSelect,
  actionLabel = 'Use',
}) => {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const isImgUnsupported = /\.img$/i.test(art.name);
  const needsBlob = (art.kind === 'image' && !isImgUnsupported) || art.kind === 'sound';

  useEffect(() => {
    if (!needsBlob) return;
    const bytes = art.bytesOf();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: art.mime }));
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [art, needsBlob]);

  useEffect(() => {
    return () => {
      if (audioEl) {
        audioEl.pause();
      }
    };
  }, [audioEl]);

  const toggleAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!blobUrl) return;
    if (audioEl && playing) {
      audioEl.pause();
      setPlaying(false);
      return;
    }
    const el = audioEl ?? new Audio(blobUrl);
    if (!audioEl) {
      el.onended = () => setPlaying(false);
      setAudioEl(el);
    }
    el.currentTime = 0;
    void el.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  };

  const baseName = basenameOfAsset(art.name);

  return (
    <div
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      className={`group flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 ${
        onSelect
          ? 'cursor-pointer transition-colors hover:border-forge-500 hover:bg-forge-50/30 dark:hover:border-forge-500 dark:hover:bg-forge-950/20'
          : ''
      }`}
    >
      <div className="relative flex h-24 items-center justify-center bg-stone-100/80 p-2 dark:bg-stone-950/60">
        {art.kind === 'image' && !isImgUnsupported && blobUrl ? (
          <img
            src={blobUrl}
            alt={baseName}
            loading="lazy"
            className={`max-h-20 max-w-full object-contain ${
              (art.frames ?? 1) > 1 ? 'object-top' : ''
            }`}
            style={{ imageRendering: 'pixelated' }}
          />
        ) : art.kind === 'sound' ? (
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={toggleAudio}
              aria-label={playing ? `Stop ${baseName}` : `Play ${baseName}`}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <span className="flex items-center gap-1 text-[10px] font-medium text-stone-500 dark:text-stone-400">
              <Music className="h-3 w-3" />
              WAV
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-stone-400">
            <FileQuestion className="h-5 w-5" />
            <span className="text-[10px]">
              {isImgUnsupported ? '.img (not decoded)' : 'binary'}
            </span>
          </div>
        )}

        {art.frames !== undefined && art.frames > 1 && (
          <span
            title="Frame count from LoadSprite script"
            className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white shadow-2xs"
          >
            <Film className="h-2.5 w-2.5" />
            {art.frames}f
          </span>
        )}

        {onSelect && (
          <span className="absolute right-1.5 top-1.5 rounded bg-forge-600 px-1.5 py-0.5 text-[9px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
            {actionLabel}
          </span>
        )}
      </div>

      <div className="space-y-0.5 border-t border-stone-100 px-2.5 py-1.5 dark:border-stone-800/80">
        <div
          className="truncate font-mono text-[11px] font-semibold text-stone-800 dark:text-stone-200"
          title={art.name}
        >
          {baseName}
        </div>
        <div className="flex items-center justify-between gap-1 text-[10px] text-stone-400 dark:text-stone-500">
          <span>
            {art.width && art.height ? `${art.width}×${art.height}` : formatBytes(art.length)}
          </span>
          <span className="truncate">{libraryName ?? formatBytes(art.length)}</span>
        </div>
      </div>
    </div>
  );
};
