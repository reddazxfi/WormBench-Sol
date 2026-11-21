import React from 'react';
import { Library } from 'lucide-react';
import { usePxlLibrary, type PxlPickerAccept } from '../context/PxlLibraryContext';

interface SpritePickButtonProps {
  accept: PxlPickerAccept;
  onPick: (file: File, framesHint?: number) => void;
  label?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  title?: string;
}

/**
 * Secondary source button placed beside file upload inputs so any image or WAV
 * slot can pick directly from loaded Project X `.pxl` libraries.
 */
export const SpritePickButton: React.FC<SpritePickButtonProps> = ({
  accept,
  onPick,
  label,
  disabled = false,
  compact = false,
  className,
  title,
}) => {
  const { libraries, openPicker } = usePxlLibrary();

  const defaultTitle =
    libraries.length > 0
      ? `Pick ${accept === 'sound' ? 'a WAV' : 'an image'} from loaded .pxl libraries (${libraries.length} open)`
      : `Open a .pxl library and pick ${accept === 'sound' ? 'a WAV' : 'an image'}`;

  if (compact) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => openPicker({ accept, label, onPick })}
        title={title ?? defaultTitle}
        aria-label={title ?? `Pick ${accept} from .pxl library`}
        className={
          className ??
          'rounded p-0.5 text-stone-500 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-amber-950/40 dark:hover:text-amber-300 cursor-pointer'
        }
      >
        <Library className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => openPicker({ accept, label, onPick })}
      title={title ?? defaultTitle}
      className={
        className ??
        'inline-flex items-center gap-1 rounded-md border border-amber-300/80 bg-amber-50/75 px-2 py-1 text-[11px] font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-900/40 whitespace-nowrap shrink-0 cursor-pointer'
      }
    >
      <Library className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span>Library</span>
    </button>
  );
};
