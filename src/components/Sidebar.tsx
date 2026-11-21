import React from 'react';
import {
  Download,
  Upload,
  Moon,
  Sun,
  FileCode2,
  Layers,
  Sparkles,
  Wand2,
  FolderSearch,
  ChevronRight,
  Library,
} from 'lucide-react';
import { WeaponProject } from '../types/weapon';
import { hasProjectileBody, type RecordTabId } from '../data/recordTabs';
import { assetUrl } from '../utils/assetUrl';

type WorkspaceTab = 'editor' | 'hold' | 'effects' | 'code';

interface SidebarProps {
  project: WeaponProject;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  activeSubTab?: RecordTabId;
  setActiveSubTab?: (tab: RecordTabId) => void;
  onImportWep: () => void;
  onBrowseMods: () => void;
  onBrowsePxl: () => void;
  pxlLibraryCount: number;
  onExportZip: () => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  onCopyId: () => void;
  /** The bundle's weapon list, rendered under the project card. */
  rail?: React.ReactNode;
}

const WORKSPACE: { id: WorkspaceTab; label: string; hint: string; icon: React.ElementType; key: string }[] = [
  { id: 'editor', label: 'Weapon Record', hint: 'Identity, physics & payload', icon: Layers, key: '1' },
  { id: 'hold', label: 'Hold & Sprites', hint: 'Worm aiming & projectile animation', icon: Sparkles, key: '2' },
  { id: 'effects', label: 'Lua Libraries', hint: 'Ribbon trail, blast & WAVs', icon: Wand2, key: '3' },
  { id: 'code', label: 'Bundle & Export', hint: 'Lua, mod.toml & profile', icon: FileCode2, key: '4' },
];

const ARCHETYPE_BADGE: Record<string, string> = {
  power: 'Projectile',
  hitscan: 'Firearm',
  drop: 'Dropped',
  cursor: 'Cursor',
  arrow: 'Arrow',
  spray: 'Flame',
  special: 'Special',
  melee: 'Melee',
};

const ProjectCard: React.FC<{ project: WeaponProject; onCopyId: () => void }> = ({ project, onCopyId }) => {
  const showMissileMeta = hasProjectileBody(project.fireType, project.teleport, project.body?.fuse);
  const typeText =
    project.fireType === 'cursor'
      ? project.teleport
        ? 'Teleport'
        : 'Air Strike'
      : project.fireType === 'drop'
        ? project.body?.fuse
          ? 'Dynamite'
          : 'Mine'
        : ARCHETYPE_BADGE[project.fireType] ?? project.fireType;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 p-3">
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
          {project.customIconPreview ? (
            <img
              src={project.customIconPreview}
              alt=""
              width={36}
              height={36}
              className="h-full w-full object-contain"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <span className="font-heading text-[11px] font-bold uppercase text-stone-500 dark:text-stone-300">
              {project.slot.slice(0, 3)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100" title={project.name}>
            {project.name}
          </div>
          <button
            type="button"
            onClick={onCopyId}
            className="mt-0.5 max-w-full truncate rounded font-mono text-[10px] text-forge-700 hover:underline dark:text-forge-300"
            title="Copy unique weapon ID"
          >
            {project.id}
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-stone-200/70 pt-2 text-[11px] text-stone-500 dark:border-stone-800 dark:text-stone-400">
        <span className="font-medium text-stone-700 dark:text-stone-200">{typeText}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">
          {project.useWepFile && project.wepFile ? '.wep base' : project.based_on}
        </span>
        {showMissileMeta && (
          <>
            <span aria-hidden="true">·</span>
            <span className="capitalize">
              {project.action && project.action !== 'none' ? project.action : 'direct'}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  project,
  activeTab,
  setActiveTab,
  onImportWep,
  onBrowseMods,
  onBrowsePxl,
  pxlLibraryCount,
  onExportZip,
  isDark,
  setIsDark,
  onCopyId,
  rail,
}) => (
  <aside className="fixed inset-y-0 left-0 z-40 hidden w-68 flex-col border-r border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 lg:flex">
    <div className="shrink-0 border-b border-stone-100 px-4 py-3 dark:border-stone-800">
      <img
        src={assetUrl('assets/wormforge-logo.png')}
        alt="WormForge"
        width={327}
        height={57}
        className="h-7 w-auto"
      />
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500">
        Weapon Studio
      </div>
    </div>

    {/* Workspace tabs stay pinned near the top so they never get pushed off-screen
        on shorter monitors regardless of how many weapons a bundle contains. */}
    <nav className="shrink-0 border-b border-stone-100 px-3 py-2.5 dark:border-stone-800" aria-label="Workspace">
      <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
        Studio
      </div>
      <div className="space-y-0.5">
        {WORKSPACE.map(({ id, label, hint, icon: Icon, key }) => {
          const active = activeTab === id;
          const iconTint =
            id === 'editor'
              ? 'text-forge-500'
              : id === 'hold'
                ? 'text-amber-500'
                : id === 'effects'
                  ? 'text-sky-500'
                  : 'text-orange-500';
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-forge-50 text-forge-800 dark:bg-forge-950/40 dark:text-forge-200'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${active ? 'text-forge-600 dark:text-forge-400' : iconTint}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{label}</span>
                <span className="block truncate text-[10px] font-normal text-stone-400 dark:text-stone-500">{hint}</span>
              </span>
              <kbd
                className={`rounded border px-1 py-0.5 font-mono text-[9px] tabular-nums ${
                  active
                    ? 'border-forge-200 bg-white/70 text-forge-600 dark:border-forge-800 dark:bg-forge-950/40 dark:text-forge-300'
                    : 'border-stone-200 bg-stone-50 text-stone-400 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-500'
                }`}
              >
                {key}
              </kbd>
            </button>
          );
        })}
      </div>
    </nav>

    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
      <ProjectCard project={project} onCopyId={onCopyId} />
      {rail}
      <button
        type="button"
        onClick={onBrowsePxl}
        className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/80 px-2.5 py-1.5 text-xs font-semibold text-stone-700 transition-colors hover:border-amber-400 hover:bg-amber-50/70 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-200 dark:hover:border-amber-700 dark:hover:bg-amber-950/30 cursor-pointer"
      >
        <Library className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span className="flex-1 text-left">Sprite libraries</span>
        {pxlLibraryCount > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {pxlLibraryCount}
          </span>
        )}
        <ChevronRight className="h-3 w-3 opacity-50" aria-hidden="true" />
      </button>
    </div>

    <div className="shrink-0 border-t border-stone-200 p-2.5 dark:border-stone-800">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onImportWep}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-300/80 bg-amber-50/75 px-2 py-1.5 text-[11px] font-semibold text-amber-900 transition-colors hover:border-amber-400 hover:bg-amber-100/80 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-900/40 cursor-pointer"
          title="Import a Project X .wep weapon file"
        >
          <Upload className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="truncate">Import .wep</span>
        </button>
        <button
          type="button"
          onClick={onBrowseMods}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-sky-300/80 bg-sky-50/75 px-2 py-1.5 text-[11px] font-semibold text-sky-900 transition-colors hover:border-sky-400 hover:bg-sky-100/80 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40 cursor-pointer"
          title="Read installed WormForge mods"
        >
          <FolderSearch className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <span className="truncate">Read mods</span>
        </button>
      </div>
      <button
        type="button"
        onClick={onExportZip}
        className="mt-1.5 flex w-full items-center gap-2 rounded-lg bg-forge-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-forge-700 dark:bg-forge-500 dark:hover:bg-forge-400 cursor-pointer"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="flex-1 text-left">Export Mod (.zip)</span>
      </button>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-stone-400 dark:text-stone-500">Worms Armageddon 3.8+</span>
        <button
          type="button"
          onClick={() => setIsDark(!isDark)}
          className="rounded-md border border-stone-200 p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {isDark ? <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>
    </div>
  </aside>
);

interface MobileBarProps {
  project: WeaponProject;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  activeSubTab?: RecordTabId;
  setActiveSubTab?: (tab: RecordTabId) => void;
  onImportWep: () => void;
  onBrowseMods: () => void;
  onBrowsePxl: () => void;
  pxlLibraryCount: number;
  onExportZip: () => void;
  isDark: boolean;
  setIsDark: (dark: boolean) => void;
  /** Only rendered when the bundle holds more than one weapon. */
  weaponSwitcher?: React.ReactNode;
}

export const MobileBar: React.FC<MobileBarProps> = ({
  project,
  activeTab,
  setActiveTab,
  onImportWep,
  onBrowseMods,
  onBrowsePxl,
  pxlLibraryCount,
  onExportZip,
  isDark,
  setIsDark,
  weaponSwitcher,
}) => (
  <div className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95 lg:hidden">
    <div className="flex items-center gap-2.5 px-4 py-2">
      <img src={assetUrl('assets/wormforge-logo.png')} alt="WormForge" width={327} height={57} className="h-5 w-auto shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-stone-900 dark:text-stone-100">{project.name}</div>
        <div className="truncate font-mono text-[10px] text-stone-400">{project.id}</div>
      </div>
      {weaponSwitcher}
      <button
        type="button"
        onClick={onImportWep}
        className="rounded-md border border-amber-300/80 bg-amber-50/75 p-1.5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300"
        aria-label="Import .wep"
        title="Import .wep"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onBrowsePxl}
        className="relative rounded-md border border-amber-300/80 bg-amber-50/75 p-1.5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300"
        aria-label="Sprite libraries"
        title="Sprite libraries (.pxl)"
      >
        <Library className="h-4 w-4" aria-hidden="true" />
        {pxlLibraryCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-amber-600 px-1 font-mono text-[8px] font-bold leading-tight text-white">
            {pxlLibraryCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onBrowseMods}
        className="rounded-md border border-sky-300/80 bg-sky-50/75 p-1.5 text-sky-700 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-300"
        aria-label="Read installed mods"
        title="Read installed mods"
      >
        <FolderSearch className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onExportZip}
        className="rounded-md bg-forge-600 p-1.5 text-white dark:bg-forge-500"
        aria-label="Export mod zip"
        title="Export mod zip"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setIsDark(!isDark)}
        className="rounded-md border border-stone-300 p-1.5 text-stone-600 dark:border-stone-700 dark:text-stone-300"
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
    <div className="grid grid-cols-4 gap-1 px-3 pb-2">
      {WORKSPACE.map(({ id, icon: Icon }) => {
        const short =
          id === 'editor'
            ? 'Record'
            : id === 'hold'
              ? 'Hold'
              : id === 'effects'
                ? 'Effects'
                : 'Bundle';
        return (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium ${
              activeTab === id
                ? 'bg-forge-50 text-forge-800 dark:bg-forge-950/40 dark:text-forge-200'
                : 'text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/60'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{short}</span>
          </button>
        );
      })}
    </div>
  </div>
);
