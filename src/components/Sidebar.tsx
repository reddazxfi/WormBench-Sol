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
  Library,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { WeaponProject } from '../types/weapon';
import { hasProjectileBody, type RecordTabId } from '../data/recordTabs';

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
  isExporting?: boolean;
  justExported?: boolean;
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
    <div className="space-y-2.5 px-1">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/80">
          {project.customIconPreview ? (
            <img
              src={project.customIconPreview}
              alt=""
              width={36}
              height={36}
              className="h-8 w-8 object-contain"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <span className="font-heading text-[11px] font-semibold uppercase text-stone-500 dark:text-stone-300">
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
            className="mt-0.5 block max-w-full truncate font-mono text-[11px] text-stone-500 transition-colors hover:text-forge-600 dark:text-stone-400 dark:hover:text-forge-400 cursor-pointer"
            title="Copy unique weapon ID"
          >
            {project.id}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-stone-500 dark:text-stone-400">
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
  isExporting = false,
  justExported = false,
  isDark,
  setIsDark,
  onCopyId,
  rail,
}) => (
  <aside className="fixed inset-y-0 left-0 z-40 hidden w-68 flex-col border-r border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900 lg:flex">
    <div className="flex shrink-0 items-center justify-between border-b border-stone-200/80 px-4 py-3.5 dark:border-stone-800">
      <div className="min-w-0">
        <div className="font-heading text-lg font-semibold leading-tight tracking-tight text-stone-900 dark:text-stone-100">
          WormBench Sol
        </div>
        <div className="mt-0.5 text-[11px] font-medium text-stone-400 dark:text-stone-500">
          Weapon Studio
        </div>
      </div>
      <button
        type="button"
        onClick={() => setIsDark(!isDark)}
        className="rounded-lg border border-stone-200 p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
        title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDark ? <Sun className="h-3.5 w-3.5" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </div>

    {/* Workspace tabs stay pinned near the top so they never get pushed off-screen
        on shorter monitors regardless of how many weapons a bundle contains. */}
    <nav className="shrink-0 border-b border-stone-200/80 px-3 py-3 dark:border-stone-800" aria-label="Workspace">
      <div className="space-y-1">
        {WORKSPACE.map(({ id, label, hint, icon: Icon, key }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-forge-50/90 text-stone-950 dark:bg-forge-950/50 dark:text-white'
                  : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 transition-colors ${
                  active
                    ? 'text-forge-600 dark:text-forge-400'
                    : 'text-stone-400 group-hover:text-stone-600 dark:text-stone-500 dark:group-hover:text-stone-300'
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-xs ${active ? 'font-semibold' : 'font-medium'}`}>
                  {label}
                </span>
                <span className="block truncate text-[10px] text-stone-400 dark:text-stone-500">
                  {hint}
                </span>
              </span>
              <kbd
                className={`font-mono text-[10px] tabular-nums ${
                  active
                    ? 'text-forge-600 dark:text-forge-400'
                    : 'text-stone-400 dark:text-stone-500'
                }`}
              >
                {key}
              </kbd>
            </button>
          );
        })}
      </div>
    </nav>

    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3.5">
      <ProjectCard project={project} onCopyId={onCopyId} />
      {rail}
    </div>

    <div className="shrink-0 space-y-2 border-t border-stone-200/90 p-3 dark:border-stone-800">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onImportWep}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-200 dark:hover:bg-stone-800 cursor-pointer whitespace-nowrap"
          title="Read a Project X .wep weapon file"
        >
          <Upload className="h-3.5 w-3.5 shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
          <span className="truncate">Read .wep</span>
        </button>
        <button
          type="button"
          onClick={onBrowsePxl}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-200 dark:hover:bg-stone-800 cursor-pointer whitespace-nowrap"
          title="Read Project X .pxl sprite libraries"
        >
          <Library className="h-3.5 w-3.5 shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
          <span className="truncate">Read .pxl</span>
          {pxlLibraryCount > 0 && (
            <span className="rounded bg-forge-500/15 px-1 font-mono text-[10px] font-semibold tabular-nums text-forge-600 dark:text-forge-400">
              {pxlLibraryCount}
            </span>
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={onBrowseMods}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-300/90 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-500/25 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-200 dark:hover:bg-sky-500/30 cursor-pointer whitespace-nowrap"
        title="Read installed WormBench mods"
      >
        <FolderSearch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Read mods</span>
      </button>
      <button
        type="button"
        onClick={onExportZip}
        disabled={isExporting}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap ${
          isExporting
            ? 'cursor-wait bg-forge-600/80 dark:bg-forge-500/80'
            : justExported
              ? 'cursor-pointer bg-emerald-600 hover:bg-emerald-600 dark:bg-emerald-500 dark:hover:bg-emerald-400'
              : 'cursor-pointer bg-forge-600 hover:bg-forge-700 dark:bg-forge-500 dark:hover:bg-forge-400'
        }`}
      >
        {isExporting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span>Exporting...</span>
          </>
        ) : justExported ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Exported!</span>
          </>
        ) : (
          <>
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Export Mod (.zip)</span>
          </>
        )}
      </button>
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
  isExporting?: boolean;
  justExported?: boolean;
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
  isExporting = false,
  justExported = false,
  isDark,
  setIsDark,
  weaponSwitcher,
}) => (
  <div className="sticky top-0 z-40 border-b border-stone-200/90 bg-white/95 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95 lg:hidden">
    <div className="flex items-center gap-2 px-4 py-2">
      <span className="font-heading shrink-0 text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        WormBench Sol
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-stone-900 dark:text-stone-100">{project.name}</div>
      </div>
      {weaponSwitcher}
      <button
        type="button"
        onClick={onImportWep}
        className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
        aria-label="Read .wep"
        title="Read .wep"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onBrowsePxl}
        className="relative rounded-lg border border-stone-200 bg-white p-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
        aria-label="Read .pxl"
        title="Read .pxl sprite libraries"
      >
        <Library className="h-4 w-4" aria-hidden="true" />
        {pxlLibraryCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-forge-600 px-1 font-mono text-[8px] font-bold leading-tight text-white tabular-nums">
            {pxlLibraryCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onBrowseMods}
        className="rounded-lg border border-sky-300/90 bg-sky-500/15 p-1.5 text-sky-700 hover:bg-sky-500/25 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-300 dark:hover:bg-sky-500/30"
        aria-label="Read mods"
        title="Read installed WormBench mods"
      >
        <FolderSearch className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onExportZip}
        disabled={isExporting}
        className={`rounded-lg p-1.5 text-white transition-colors ${
          isExporting
            ? 'cursor-wait bg-forge-600/80 dark:bg-forge-500/80'
            : justExported
              ? 'bg-emerald-600 dark:bg-emerald-500'
              : 'bg-forge-600 dark:bg-forge-500'
        }`}
        aria-label="Export mod zip"
        title="Export mod zip"
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : justExported ? (
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={() => setIsDark(!isDark)}
        className="rounded-lg border border-stone-200 p-1.5 text-stone-600 dark:border-stone-700 dark:text-stone-300"
        aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
    <div className="grid grid-cols-4 border-t border-stone-200/70 px-2 dark:border-stone-800">
      {WORKSPACE.map(({ id, icon: Icon }) => {
        const short =
          id === 'editor'
            ? 'Record'
            : id === 'hold'
              ? 'Hold'
              : id === 'effects'
                ? 'Libraries'
                : 'Bundle';
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`relative flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              active
                ? 'text-forge-600 dark:text-forge-400'
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{short}</span>
            {active && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-forge-600 dark:bg-forge-400" />
            )}
          </button>
        );
      })}
    </div>
  </div>
);
