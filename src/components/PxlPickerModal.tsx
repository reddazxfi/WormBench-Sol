import React, { useMemo, useRef, useState } from 'react';
import { FolderOpen, Library, Search, X } from 'lucide-react';
import type { PxlArt, PxlLibrary } from '../types/pxl';
import type { PxlActiveScope, PxlPickerRequest } from '../context/PxlLibraryContext';
import { pxlArtToFile } from '../utils/pxl/loadPxl';
import { basenameOfAsset } from '../utils/pxl/readSpriteScripts';
import { PxlArtTile } from './PxlArtTile';

interface PxlPickerModalProps {
  request: PxlPickerRequest;
  libraries: PxlLibrary[];
  activeScope?: PxlActiveScope;
  onAddFiles: (files: FileList) => Promise<void>;
  onClose: () => void;
}

const CHUNK_SIZE = 50;

export const PxlPickerModal: React.FC<PxlPickerModalProps> = ({
  request,
  libraries,
  activeScope,
  onAddFiles,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedLibKey, setSelectedLibKey] = useState<string>('all');
  const scopeList = request.accept === 'sound' ? activeScope?.soundNames : activeScope?.artNames;
  const hasScope = !!activeScope && !!scopeList && scopeList.length > 0;
  const [onlyWeaponArt, setOnlyWeaponArt] = useState<boolean>(hasScope);
  const [limit, setLimit] = useState(CHUNK_SIZE);
  const [loading, setLoading] = useState(false);

  const scopeSet = useMemo(() => {
    const s = new Set<string>();
    if (!scopeList) return s;
    for (const name of scopeList) {
      s.add(name.toLowerCase());
      s.add(basenameOfAsset(name).toLowerCase());
    }
    return s;
  }, [scopeList]);

  const entries = useMemo(() => {
    const out: { lib: PxlLibrary; art: PxlArt }[] = [];
    const libs =
      selectedLibKey === 'all' ? libraries : libraries.filter((l) => l.key === selectedLibKey);

    for (const lib of libs) {
      for (const art of lib.art) {
        if (request.accept === 'image' && (art.kind !== 'image' || /\.img$/i.test(art.name))) {
          continue;
        }
        if (request.accept === 'sound' && art.kind !== 'sound') {
          continue;
        }
        if (onlyWeaponArt && hasScope) {
          const lower = art.name.toLowerCase();
          const base = basenameOfAsset(lower);
          if (!scopeSet.has(lower) && !scopeSet.has(base)) continue;
        }
        out.push({ lib, art });
      }
    }

    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? out.filter(
          ({ art, lib }) =>
            art.name.toLowerCase().includes(needle) ||
            lib.fileName.toLowerCase().includes(needle),
        )
      : out;

    return filtered.sort((a, b) => a.art.name.localeCompare(b.art.name));
  }, [libraries, selectedLibKey, request.accept, onlyWeaponArt, hasScope, scopeSet, query]);

  const visible = entries.slice(0, limit);

  const handleOpenFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      await onAddFiles(files);
    } finally {
      setLoading(false);
    }
  };

  const handlePick = (art: PxlArt) => {
    const file = pxlArtToFile(art);
    request.onPick(file, art.frames);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5 dark:border-stone-800">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wide text-stone-900 dark:text-white">
              <Library className="h-4 w-4 text-amber-500" />
              {request.label ||
                (request.accept === 'sound'
                  ? 'Pick WAV from .pxl Library'
                  : 'Pick Sprite from .pxl Library')}
            </h2>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
              {request.accept === 'sound'
                ? 'Choose a WAV from any open .pxl library. It is copied into your bundle as a normal file.'
                : 'Choose a PNG or GIF from any open .pxl library. LoadSprite frame counts prefill automatically.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-5 py-2.5 dark:border-stone-800">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-stone-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(CHUNK_SIZE);
              }}
              placeholder="Search filename..."
              aria-label="Search library assets"
              className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-8 pr-3 text-xs text-stone-800 focus:outline-hidden focus:ring-2 focus:ring-forge-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
            />
          </div>

          {libraries.length > 1 && (
            <select
              aria-label="Filter by library"
              value={selectedLibKey}
              onChange={(e) => {
                setSelectedLibKey(e.target.value);
                setLimit(CHUNK_SIZE);
              }}
              className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              <option value="all">All libraries ({libraries.length})</option>
              {libraries.map((lib) => (
                <option key={lib.key} value={lib.key}>
                  {lib.fileName}
                </option>
              ))}
            </select>
          )}

          {hasScope && (
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300/80 bg-amber-50/70 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
              <input
                type="checkbox"
                checked={onlyWeaponArt}
                onChange={(e) => {
                  setOnlyWeaponArt(e.target.checked);
                  setLimit(CHUNK_SIZE);
                }}
                className="rounded text-amber-600 focus:ring-amber-500"
              />
              <span>Only {activeScope?.weaponName}</span>
            </label>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pxl"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleOpenFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:border-forge-500 dark:border-stone-700 dark:text-stone-200"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>{loading ? 'Loading...' : 'Open .pxl'}</span>
          </button>
        </div>

        <div className="min-h-[260px] flex-1 overflow-y-auto p-4">
          {libraries.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
              <Library className="h-8 w-8 text-stone-400" />
              <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">
                No `.pxl` libraries loaded yet
              </p>
              <p className="max-w-sm text-[11px] text-stone-500 dark:text-stone-400">
                Open one or more `.pxl` files from your Project X `Libs/` folder to browse their
                sprites and sounds.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-forge-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-forge-700"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Open .pxl file(s)
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-1.5 text-center text-xs text-stone-500">
              <p>
                No matching {request.accept === 'sound' ? 'WAVs' : 'sprites'} found.
              </p>
              {onlyWeaponArt && hasScope && (
                <button
                  type="button"
                  onClick={() => setOnlyWeaponArt(false)}
                  className="text-xs font-semibold text-forge-600 hover:underline dark:text-forge-400"
                >
                  Show all art across loaded libraries
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">
                Showing {visible.length} of {entries.length}{' '}
                {request.accept === 'sound' ? 'WAVs' : 'sprites'}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
                {visible.map(({ lib, art }) => (
                  <PxlArtTile
                    key={`${lib.key}:${art.offset}:${art.name}`}
                    art={art}
                    libraryName={libraries.length > 1 ? lib.fileName : undefined}
                    onSelect={() => handlePick(art)}
                    actionLabel="Pick"
                  />
                ))}
              </div>
              {visible.length < entries.length && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setLimit((prev) => prev + CHUNK_SIZE)}
                    className="rounded-lg border border-stone-300 px-4 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                  >
                    Show {Math.min(CHUNK_SIZE, entries.length - visible.length)} more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
