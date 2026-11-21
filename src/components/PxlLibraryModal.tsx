import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Download,
  FileCode2,
  FolderOpen,
  Image as ImageIcon,
  Library,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { PxlArt, PxlLibrary, PxlWeapon } from '../types/pxl';
import type { WeaponProject } from '../types/weapon';
import type { PxlActiveScope } from '../context/PxlLibraryContext';
import { parseWepBinary } from '../utils/wepParser';
import { missingLibraryRequires, resolvePxlArt } from '../utils/pxl/loadPxl';
import { importPxlWeapon } from '../utils/pxl/importPxlWeapon';
import { basenameOfAsset } from '../utils/pxl/readSpriteScripts';
import { PxlArtTile } from './PxlArtTile';

interface PxlLibraryModalProps {
  libraries: PxlLibrary[];
  onAddFiles: (files: File[]) => Promise<{ added: PxlLibrary[]; errors: string[] }>;
  onRemoveLibrary: (key: string) => void;
  onOpenWeapon: (
    project: Partial<WeaponProject> & { replaceProject: true },
    scope: PxlActiveScope,
    summary: string[],
  ) => void;
  onAddWeaponToBundle: (
    project: Partial<WeaponProject> & { replaceProject: true },
    scope: PxlActiveScope,
    summary: string[],
  ) => void;
  onAddAllWeapons: (
    items: {
      project: Partial<WeaponProject> & { replaceProject: true };
      scope: PxlActiveScope;
    }[],
    libName: string,
  ) => void;
  onClose: () => void;
}

const CHUNK_SIZE = 50;
const FOLDER_WARN_FILES = 40;
const FOLDER_WARN_BYTES = 48 * 1024 * 1024;

function formatBytes(len: number): string {
  if (len < 1024) return `${len} B`;
  if (len < 1024 * 1024) return `${(len / 1024).toFixed(1)} KB`;
  return `${(len / (1024 * 1024)).toFixed(2)} MB`;
}

function scopeForWeapon(
  weapon: PxlWeapon,
  lib: PxlLibrary,
  offeredSounds: string[],
): PxlActiveScope {
  const direct = [
    weapon.missileSprite,
    weapon.clustletSprite,
    weapon.homingSprite,
    weapon.planeSprite,
  ].filter((x): x is string => !!x);
  return {
    libraryKey: lib.key,
    weaponName: weapon.name,
    artNames: [...weapon.art, ...weapon.holdSlots, ...direct],
    soundNames: offeredSounds,
  };
}

const WeaponIconThumb: React.FC<{
  iconName?: string;
  libraries: readonly PxlLibrary[];
  preferredKey: string;
}> = ({ iconName, libraries, preferredKey }) => {
  const [url, setUrl] = useState('');
  const resolved = useMemo(
    () => (iconName && !/\.img$/i.test(iconName) ? resolvePxlArt(iconName, libraries, preferredKey) : undefined),
    [iconName, libraries, preferredKey],
  );

  useEffect(() => {
    if (!resolved || resolved.art.kind !== 'image') {
      setUrl('');
      return;
    }
    const bytes = resolved.art.bytesOf();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const next = URL.createObjectURL(new Blob([copy], { type: resolved.art.mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [resolved]);

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-800">
      {url ? (
        <img
          src={url}
          alt=""
          className="h-7 w-7 object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <ImageIcon className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
      )}
    </div>
  );
};

export const PxlLibraryModal: React.FC<PxlLibraryModalProps> = ({
  libraries,
  onAddFiles,
  onRemoveLibrary,
  onOpenWeapon,
  onAddWeaponToBundle,
  onAddAllWeapons,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [selectedKey, setSelectedKey] = useState<string>(libraries[0]?.key ?? '');
  const [viewTab, setViewTab] = useState<'weapons' | 'art'>('weapons');
  const [selectedWeapon, setSelectedWeapon] = useState<PxlWeapon | null>(null);
  const [query, setQuery] = useState('');
  const [artFilter, setArtFilter] = useState<'all' | 'image' | 'sound'>('all');
  const [artSort, setArtSort] = useState<'name' | 'size' | 'frames'>('name');
  const [allLibsArt, setAllLibsArt] = useState(false);
  const [artLimit, setArtLimit] = useState(CHUNK_SIZE);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingFolder, setPendingFolder] = useState<File[] | null>(null);

  const activeLib = useMemo(
    () => libraries.find((l) => l.key === selectedKey) ?? libraries[0],
    [libraries, selectedKey],
  );
  const missingRequires = useMemo(
    () => (activeLib ? missingLibraryRequires(activeLib, libraries) : []),
    [activeLib, libraries],
  );

  useEffect(() => {
    if (activeLib && activeLib.key !== selectedKey) {
      setSelectedKey(activeLib.key);
    }
  }, [activeLib, selectedKey]);

  // Switch default tab when a library has only art (e.g. `cweps_gfx`) vs weapons.
  useEffect(() => {
    if (!activeLib) return;
    const realCount = activeLib.weapons.filter((w) => !w.isSectionHeading).length;
    if (realCount === 0 && viewTab === 'weapons' && activeLib.art.length > 0) {
      setViewTab('art');
    }
  }, [activeLib, viewTab]);

  const ingestFiles = async (rawFiles: File[]) => {
    const pxls = rawFiles.filter((f) => /\.pxl$/i.test(f.name));
    if (pxls.length === 0) {
      setErrors(['No `.pxl` files found in what was chosen.']);
      return;
    }
    setErrors([]);
    const res = await onAddFiles(pxls);
    if (res.errors.length > 0) setErrors(res.errors);
    if (res.added.length > 0) {
      const first = res.added[0];
      setSelectedKey(first.key);
      setSelectedWeapon(null);
      const hasWeapons = first.weapons.some((w) => !w.isSectionHeading);
      setViewTab(hasWeapons ? 'weapons' : 'art');
    }
  };

  const handleFileInput = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    await ingestFiles(Array.from(list));
  };

  const handleFolderInput = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const pxls = Array.from(list).filter((f) => /\.pxl$/i.test(f.name));
    const totalBytes = pxls.reduce((sum, f) => sum + f.size, 0);
    if (pxls.length > FOLDER_WARN_FILES || totalBytes > FOLDER_WARN_BYTES) {
      setPendingFolder(pxls);
      return;
    }
    await ingestFiles(pxls);
  };

  const realWeapons = useMemo(
    () => (activeLib ? activeLib.weapons.filter((w) => !w.isSectionHeading) : []),
    [activeLib],
  );
  const headingCount = activeLib ? activeLib.weapons.length - realWeapons.length : 0;

  const filteredWeapons = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return realWeapons;
    return realWeapons.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        w.id.toLowerCase().includes(needle) ||
        w.itemName.toLowerCase().includes(needle),
    );
  }, [realWeapons, query]);

  const selectedWeaponMeta = useMemo(() => {
    if (!selectedWeapon || !activeLib) return null;
    const bytes = selectedWeapon.bytesOf();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const parsed = parseWepBinary(copy.buffer, `${selectedWeapon.itemName}.wep`);
    const previewImport = importPxlWeapon(selectedWeapon, activeLib, libraries);
    return { parsed, previewImport };
  }, [selectedWeapon, activeLib, libraries]);

  const artEntries = useMemo(() => {
    const sourceLibs = allLibsArt ? libraries : activeLib ? [activeLib] : [];
    const list: { lib: PxlLibrary; art: PxlArt }[] = [];
    for (const lib of sourceLibs) {
      for (const art of lib.art) {
        if (artFilter === 'image' && art.kind !== 'image') continue;
        if (artFilter === 'sound' && art.kind !== 'sound') continue;
        list.push({ lib, art });
      }
    }
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? list.filter(
          ({ art, lib }) =>
            art.name.toLowerCase().includes(needle) ||
            lib.fileName.toLowerCase().includes(needle),
        )
      : list;

    return filtered.sort((a, b) => {
      if (artSort === 'size') return b.art.length - a.art.length;
      if (artSort === 'frames') return (b.art.frames ?? 0) - (a.art.frames ?? 0);
      return basenameOfAsset(a.art.name).localeCompare(basenameOfAsset(b.art.name));
    });
  }, [allLibsArt, libraries, activeLib, artFilter, query, artSort]);

  const visibleArt = artEntries.slice(0, artLimit);

  const importSelected = (mode: 'open' | 'append') => {
    if (!selectedWeapon || !activeLib) return;
    const res = importPxlWeapon(selectedWeapon, activeLib, libraries);
    if (!res.success || !res.project) {
      setErrors([res.error || `Could not decode ${selectedWeapon.name}`]);
      return;
    }
    const scope = scopeForWeapon(selectedWeapon, activeLib, res.offeredSounds);
    if (mode === 'open') {
      onOpenWeapon(res.project, scope, res.summary);
    } else {
      onAddWeaponToBundle(res.project, scope, res.summary);
    }
    onClose();
  };

  const addAllFromLibrary = () => {
    if (!activeLib || realWeapons.length === 0) return;
    const items: {
      project: Partial<WeaponProject> & { replaceProject: true };
      scope: PxlActiveScope;
    }[] = [];
    const errs: string[] = [];
    for (const w of realWeapons) {
      const res = importPxlWeapon(w, activeLib, libraries);
      if (res.success && res.project) {
        items.push({
          project: res.project,
          scope: scopeForWeapon(w, activeLib, res.offeredSounds),
        });
      } else {
        errs.push(`${w.name}: ${res.error || 'decode failed'}`);
      }
    }
    if (errs.length > 0) setErrors(errs);
    if (items.length > 0) {
      onAddAllWeapons(items, activeLib.fileName);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-3.5 dark:border-stone-800">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wide text-stone-900 dark:text-white">
              <Library className="h-4 w-4 text-amber-500" />
              Sprite libraries (.pxl)
            </h2>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
              Open Project X `.pxl` libraries from `Libs/` to inspect `.wep` records, browse PNGs
              and WAVs, read `LoadSprite` frame counts, and pick art in any upload control.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-5 py-2.5 dark:border-stone-800">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pxl"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFileInput(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFolderInput(e.target.files);
              e.target.value = '';
            }}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:border-forge-500 dark:border-stone-700 dark:text-stone-200"
          >
            <Upload className="h-3.5 w-3.5" />
            Open .pxl file(s)
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:border-forge-500 dark:border-stone-700 dark:text-stone-200"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose Libs folder
          </button>
          <span className="ml-auto text-[11px] font-mono text-stone-500 dark:text-stone-400">
            {libraries.length === 0
              ? 'No libraries open'
              : `${libraries.length} librar${libraries.length === 1 ? 'y' : 'ies'} · ${libraries.reduce((s, l) => s + l.art.length, 0)} assets`}
          </span>
        </div>

        {/* Folder size confirmation warning */}
        {pendingFolder && (
          <div className="mx-5 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This folder holds <strong>{pendingFolder.length}</strong> `.pxl` files (
                {formatBytes(pendingFolder.reduce((s, f) => s + f.size, 0))}). Loading all of them
                keeps their buffers in memory.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const subset = pendingFolder.slice(0, FOLDER_WARN_FILES);
                  setPendingFolder(null);
                  void ingestFiles(subset);
                }}
                className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-stone-900 dark:text-amber-200"
              >
                Load first {FOLDER_WARN_FILES}
              </button>
              <button
                type="button"
                onClick={() => {
                  const all = pendingFolder;
                  setPendingFolder(null);
                  void ingestFiles(all);
                }}
                className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
              >
                Load all ({pendingFolder.length})
              </button>
              <button
                type="button"
                onClick={() => setPendingFolder(null)}
                className="text-[11px] font-semibold underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Parse errors */}
        {errors.length > 0 && (
          <div
            role="alert"
            className="mx-5 mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200"
          >
            <div className="flex items-center justify-between gap-2 font-semibold">
              <span>Could not open `.pxl` library</span>
              <button type="button" onClick={() => setErrors([])} className="text-[11px] underline">
                Dismiss
              </button>
            </div>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Empty state drop zone */}
        {libraries.length === 0 ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void ingestFiles(Array.from(e.dataTransfer.files));
            }}
            className={`m-5 grid min-h-[240px] flex-1 place-items-center rounded-xl border-2 border-dashed px-6 text-center transition-colors ${
              dragging
                ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/20'
                : 'border-stone-300 dark:border-stone-700'
            }`}
          >
            <div className="space-y-1.5">
              <Library className="mx-auto h-8 w-8 text-stone-400" />
              <div className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                Drop one or more `.pxl` files here
              </div>
              <p className="max-w-md text-[11px] text-stone-500 dark:text-stone-400">
                Each library stays local in memory and is never copied into the repository. Open
                paired libraries such as `cweps.pxl` + `cweps_gfx.pxl` together so icons and hold
                sheets resolve across them.
              </p>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void ingestFiles(Array.from(e.dataTransfer.files));
            }}
            className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-stone-200 dark:divide-stone-800 md:grid-cols-[15rem_1fr] md:divide-x md:divide-y-0"
          >
            {/* Left column: open libraries */}
            <div className="max-h-[24vh] overflow-y-auto md:max-h-none">
              {libraries.map((lib) => {
                const wCount = lib.weapons.filter((w) => !w.isSectionHeading).length;
                const active = activeLib?.key === lib.key;
                return (
                  <div
                    key={lib.key}
                    className={`flex items-center gap-1 border-b border-stone-100 px-3 py-2 dark:border-stone-800/60 ${
                      active
                        ? 'bg-forge-50 dark:bg-forge-950/30'
                        : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKey(lib.key);
                        setSelectedWeapon(null);
                        setArtLimit(CHUNK_SIZE);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate font-mono text-xs font-semibold text-stone-800 dark:text-stone-200">
                        {lib.fileName}
                      </div>
                      <div className="text-[10px] text-stone-400">
                        {wCount > 0 ? `${wCount} wep · ` : ''}
                        {lib.art.length} art · {lib.scripts.length} scripts ·{' '}
                        {formatBytes(lib.buffer.byteLength)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onRemoveLibrary(lib.key);
                        if (selectedKey === lib.key) setSelectedWeapon(null);
                      }}
                      aria-label={`Close ${lib.fileName}`}
                      title="Unload library from memory"
                      className="rounded p-1 text-stone-400 hover:bg-stone-200/70 hover:text-rose-600 dark:hover:bg-stone-800"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Right column: tabs + content */}
            <div className="flex min-h-0 flex-col">
              {missingRequires.length > 0 && (
                <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  <span className="truncate">
                    Unloaded <code className="font-mono">require</code> libs:{' '}
                    <span className="font-mono font-semibold">{missingRequires.join(', ')}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 rounded border border-amber-400/70 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-stone-900 dark:text-amber-200"
                  >
                    Open .pxl
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800">
                <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 dark:border-stone-700 dark:bg-stone-800">
                  <button
                    type="button"
                    onClick={() => {
                      setViewTab('weapons');
                      setQuery('');
                    }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                      viewTab === 'weapons'
                        ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-900 dark:text-white'
                        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400'
                    }`}
                  >
                    Weapons ({realWeapons.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewTab('art');
                      setQuery('');
                      setArtLimit(CHUNK_SIZE);
                    }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                      viewTab === 'art'
                        ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-900 dark:text-white'
                        : 'text-stone-500 hover:text-stone-800 dark:text-stone-400'
                    }`}
                  >
                    Art & Sounds ({activeLib?.art.length ?? 0})
                  </button>
                </div>

                <div className="relative min-w-[160px] flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-stone-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setArtLimit(CHUNK_SIZE);
                    }}
                    placeholder={
                      viewTab === 'weapons' ? 'Filter weapons...' : 'Filter sprites or WAVs...'
                    }
                    aria-label="Filter library contents"
                    className="w-full rounded-md border border-stone-200 bg-stone-50 py-1 pl-7 pr-2 text-xs text-stone-800 focus:outline-hidden dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                  />
                </div>

                {viewTab === 'art' && (
                  <>
                    <select
                      aria-label="Asset type filter"
                      value={artFilter}
                      onChange={(e) => {
                        setArtFilter(e.target.value as 'all' | 'image' | 'sound');
                        setArtLimit(CHUNK_SIZE);
                      }}
                      className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                    >
                      <option value="all">All types</option>
                      <option value="image">Images</option>
                      <option value="sound">WAVs</option>
                    </select>
                    <select
                      aria-label="Sort assets"
                      value={artSort}
                      onChange={(e) =>
                        setArtSort(e.target.value as 'name' | 'size' | 'frames')
                      }
                      className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                    >
                      <option value="name">Sort: Name</option>
                      <option value="size">Sort: Size</option>
                      <option value="frames">Sort: Frames</option>
                    </select>
                    {libraries.length > 1 && (
                      <label className="flex cursor-pointer items-center gap-1 text-[11px] text-stone-600 dark:text-stone-300">
                        <input
                          type="checkbox"
                          checked={allLibsArt}
                          onChange={(e) => {
                            setAllLibsArt(e.target.checked);
                            setArtLimit(CHUNK_SIZE);
                          }}
                          className="rounded text-forge-600"
                        />
                        All open
                      </label>
                    )}
                  </>
                )}
              </div>

              {viewTab === 'weapons' ? (
                <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-stone-200 dark:divide-stone-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                  <div className="max-h-[30vh] overflow-y-auto sm:max-h-none">
                    {realWeapons.length > 1 && (
                      <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/70 px-3 py-1.5 dark:border-stone-800/60 dark:bg-stone-950/40">
                        <span className="text-[10px] text-stone-500">
                          {headingCount > 0
                            ? `${headingCount} menu heading(s) skipped`
                            : `${realWeapons.length} weapons`}
                        </span>
                        <button
                          type="button"
                          onClick={addAllFromLibrary}
                          className="inline-flex items-center gap-1 rounded bg-forge-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-forge-700"
                        >
                          <Boxes className="h-3 w-3" />
                          Add all ({realWeapons.length})
                        </button>
                      </div>
                    )}
                    {filteredWeapons.length === 0 ? (
                      <p className="p-4 text-[11px] text-stone-500">
                        No weapon records in this library. Switch to Art & Sounds to browse its
                        sprites and WAVs.
                      </p>
                    ) : (
                      filteredWeapons.map((weapon) => {
                        const selected =
                          selectedWeapon?.offset === weapon.offset &&
                          selectedWeapon?.itemName === weapon.itemName;
                        return (
                          <button
                            key={`${weapon.offset}:${weapon.itemName}`}
                            type="button"
                            onClick={() => setSelectedWeapon(weapon)}
                            className={`flex w-full items-center gap-2.5 border-b border-stone-100 px-3 py-2 text-left dark:border-stone-800/60 ${
                              selected
                                ? 'bg-forge-50 dark:bg-forge-950/30'
                                : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'
                            }`}
                          >
                            <WeaponIconThumb
                              iconName={weapon.icon}
                              libraries={libraries}
                              preferredKey={activeLib?.key ?? ''}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-semibold text-stone-800 dark:text-stone-200">
                                {weapon.name}
                              </div>
                              <div className="truncate font-mono text-[10px] text-stone-400">
                                {weapon.id || weapon.itemName} · {weapon.art.length} art
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Selected weapon detail */}
                  <div className="space-y-3 overflow-y-auto p-3.5">
                    {!selectedWeapon || !selectedWeaponMeta ? (
                      <p className="text-[11px] text-stone-500">
                        Select a weapon to inspect its decoded `.wep` record, hold art, and
                        script-builder values.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-start gap-2.5">
                          <WeaponIconThumb
                            iconName={selectedWeapon.icon}
                            libraries={libraries}
                            preferredKey={activeLib?.key ?? ''}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
                              {selectedWeapon.name}
                            </div>
                            <div className="font-mono text-[10px] text-stone-500">
                              {selectedWeapon.id || selectedWeapon.itemName} ·{' '}
                              {selectedWeaponMeta.parsed.success
                                ? `${selectedWeaponMeta.parsed.fireType} (${selectedWeaponMeta.parsed.inferredDonor})`
                                : 'unsupported .wep header'}
                            </div>
                          </div>
                        </div>

                        {selectedWeaponMeta.parsed.success ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => importSelected('open')}
                              className="inline-flex items-center gap-1 rounded-md bg-forge-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-forge-700"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Open as weapon
                            </button>
                            <button
                              type="button"
                              onClick={() => importSelected('append')}
                              className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:border-forge-500 dark:border-stone-700 dark:text-stone-200"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add to bundle
                            </button>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                            {selectedWeaponMeta.parsed.error}
                          </div>
                        )}

                        {selectedWeaponMeta.previewImport.summary.length > 0 && (
                          <div className="rounded-lg border border-stone-200 bg-stone-50 p-2.5 dark:border-stone-800 dark:bg-stone-950/40">
                            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                              <FileCode2 className="h-3 w-3" />
                              What this import attaches
                            </div>
                            <ul className="space-y-0.5 font-mono text-[10px] text-stone-700 dark:text-stone-300">
                              {selectedWeaponMeta.previewImport.summary.map((line, idx) => (
                                <li key={`${idx}:${line}`}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {selectedWeapon.holdSlots.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                              Manifest art slots ({selectedWeapon.holdSlots.length})
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {selectedWeapon.holdSlots.map((slot, i) => {
                                const hit = resolvePxlArt(slot, libraries, activeLib?.key);
                                return (
                                  <span
                                    key={`${i}:${slot}`}
                                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                                      hit
                                        ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-300'
                                        : 'border-stone-200 bg-stone-100 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
                                    }`}
                                    title={hit ? `Resolved in ${hit.lib.fileName}` : 'Not in open libraries'}
                                  >
                                    {slot}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
                  {artEntries.length === 0 ? (
                    <p className="py-12 text-center text-xs text-stone-500">
                      No matching assets in this view.
                    </p>
                  ) : (
                    <>
                      <div className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">
                        Showing {visibleArt.length} of {artEntries.length} items
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
                        {visibleArt.map(({ lib, art }) => (
                          <PxlArtTile
                            key={`${lib.key}:${art.offset}:${art.name}`}
                            art={art}
                            libraryName={allLibsArt ? lib.fileName : undefined}
                          />
                        ))}
                      </div>
                      {visibleArt.length < artEntries.length && (
                        <div className="mt-4 flex justify-center">
                          <button
                            type="button"
                            onClick={() => setArtLimit((prev) => prev + CHUNK_SIZE)}
                            className="rounded-lg border border-stone-300 px-4 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                          >
                            Show {Math.min(CHUNK_SIZE, artEntries.length - visibleArt.length)} more
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
