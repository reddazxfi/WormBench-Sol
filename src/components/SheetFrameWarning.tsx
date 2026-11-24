import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { frameFit } from '../utils/sheetFrames';
import { imagePixelSize } from '../utils/imagePixelSize';

interface SheetFrameWarningProps {
  /** Object URL or asset URL of the sheet; measured when no size is given. */
  preview?: string;
  /** Known pixel size (a hold sheet stores it on upload), skips the measuring. */
  width?: number;
  height?: number;
  /** Declared frame count: `frames` in mod.toml, `cyclical` in the builder. */
  frames: number;
  className?: string;
}

/**
 * The engine slices a vertical sheet with `height / frames` and refuses an image
 * that does not divide evenly (`initgraphic` fails, so the sprite never loads).
 * This says so before the export can carry it, with the two ways to fix it.
 */
export const SheetFrameWarning: React.FC<SheetFrameWarningProps> = ({
  preview,
  width,
  height,
  frames,
  className = '',
}) => {
  const [measured, setMeasured] = useState<{ width: number; height: number }>();

  useEffect(() => {
    let live = true;
    if (!preview || (width && height)) {
      setMeasured(undefined);
      return () => {
        live = false;
      };
    }
    imagePixelSize(preview)
      .then((px) => {
        if (live) setMeasured(px);
      })
      .catch(() => {
        if (live) setMeasured(undefined);
      });
    return () => {
      live = false;
    };
  }, [preview, width, height]);

  const fit = frameFit(width ?? measured?.width, height ?? measured?.height, frames);
  if (!fit || fit.ok) return null;

  const w = width ?? measured!.width;
  const h = height ?? measured!.height;
  // Nearest height that divides, so the sheet can simply be cropped.
  const cropTo = h - fit.remainder;
  const countHints = [...fit.divisors]
    .sort((a, b) => Math.abs(a - frames) - Math.abs(b - frames))
    .slice(0, 4);

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50/80 p-2.5 text-[11px] text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200 ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="font-semibold">
          {frames} frames don't divide the sheet height
        </p>
        <p>
          {w}×{h} px across {frames} frames leaves {fit.remainder} px over, so the engine can't
          slice it ({h} ÷ {frames} = {fit.cell} px per frame with the remainder dropped) and fails
          to load the image at all, which leaves the sprite invisible in game.
        </p>
        <p className="text-rose-800/90 dark:text-rose-300/90">
          Fix it either way: crop the sheet to {w}×{cropTo} ({fit.cell} px per frame)
          {countHints.length > 0
            ? `, or use a frame count that divides ${h}: ${countHints.join(', ')}.`
            : `.`}
        </p>
      </div>
    </div>
  );
};
