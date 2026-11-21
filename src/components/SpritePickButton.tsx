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
          'rounded-md p-1 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer'
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
        'inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800 whitespace-nowrap shrink-0 cursor-pointer'
      }
    >
      <Library className="h-3.5 w-3.5 text-stone-500 dark:text-stone-400" aria-hidden="true" />
      <span>Library</span>
    </button>
  );
};
