import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  FolderPlus,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { PackProject } from '../types/weapon';

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

/** The one-line family label the rail and the mobile switcher share. */
export function weaponKindLabel(project: PackProject['weapons'][number]): string {
  if (project.fireType === 'cursor') return project.teleport ? 'Teleport' : 'Air Strike';
  if (project.fireType === 'drop') return project.body?.fuse ? 'Dynamite' : 'Mine';
  return ARCHETYPE_BADGE[project.fireType] ?? project.fireType;
}

interface PackRailProps {
  pack: PackProject;
  activeIndex: number;
  onSelect: (index: number) => void;
  /** A fresh weapon from the default donor. */
  onAddWeapon: () => void;
  /** Read an installed bundle and append the weapon it produces. */
  onImportWeapon: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
}

/**
 * The weapons a bundle holds, in the order the manifest and the profile see them.
 *
 * One weapon is the ordinary case and the rail says nothing extra: that bundle is
 * that weapon (see `syncPackToSoleWeapon`). The list only becomes a list when a
 * second weapon is added, which is also when the bundle gets its own identity.
 */
export const PackRail: React.FC<PackRailProps> = ({
  pack,
  activeIndex,
  onSelect,
  onAddWeapon,
  onImportWeapon,
  onDuplicate,
  onRemove,
  onMove,
}) => {
  const many = pack.weapons.length > 1;
  return (
    <div className="border-t border-stone-200/80 pt-3 dark:border-stone-800">
      <div className="flex items-center justify-between gap-1 px-1 pb-2">
        <span className="text-[11px] font-medium text-stone-500 tabular-nums dark:text-stone-400">
          {many ? `Bundle · ${activeIndex + 1} / ${pack.weapons.length}` : 'Bundle · 1 weapon'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onImportWeapon}
            className="rounded-md border border-stone-200 bg-white p-1 text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:bg-stone-800 cursor-pointer"
            title="Read an installed mod and add its weapon to this bundle"
            aria-label="Add a weapon from installed mods"
          >
            <Upload className="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onAddWeapon}
            className="rounded-md border border-stone-200 bg-white p-1 text-stone-700 transition-colors hover:border-forge-400 hover:bg-forge-50/60 hover:text-forge-700 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-200 dark:hover:border-forge-500/60 dark:hover:text-forge-300 cursor-pointer"
            title="Add a blank weapon (the stock Grenade record) to this bundle"
            aria-label="Add a blank weapon"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      {many ? (
        <div className="space-y-1.5">
          <label className="block">
            <span className="sr-only">Active weapon in bundle</span>
            <select
              value={activeIndex}
              onChange={(event) => onSelect(Number(event.target.value))}
              className="w-full truncate rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 focus:outline-hidden focus:ring-2 focus:ring-forge-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            >
              {pack.weapons.map((weapon, index) => (
                <option key={`${weapon.id}-${index}`} value={index}>
                  {`${index + 1}. ${weapon.name || weapon.id} (${weaponKindLabel(weapon)})`}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onDuplicate(activeIndex)}
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300 dark:hover:bg-stone-800 cursor-pointer whitespace-nowrap"
              title="Add a copy of this weapon to the bundle"
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
              <span>Copy</span>
            </button>
            <button
              type="button"
              onClick={() => onMove(activeIndex, -1)}
              disabled={activeIndex === 0}
              className="rounded-md border border-stone-200 bg-white p-1 text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300 dark:hover:bg-stone-800 cursor-pointer disabled:cursor-not-allowed"
              title="Move up in the bundle"
              aria-label="Move this weapon up"
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onMove(activeIndex, 1)}
              disabled={activeIndex === pack.weapons.length - 1}
              className="rounded-md border border-stone-200 bg-white p-1 text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300 dark:hover:bg-stone-800 cursor-pointer disabled:cursor-not-allowed"
              title="Move down in the bundle"
              aria-label="Move this weapon down"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(activeIndex)}
              className="ml-auto rounded-md border border-stone-200 bg-white p-1 text-stone-500 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-400 dark:hover:border-rose-900/60 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer"
              title="Remove this weapon from the bundle"
              aria-label="Remove this weapon from the bundle"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-1 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
          <span className="flex items-center gap-1.5 min-w-0">
            <FolderPlus className="h-3.5 w-3.5 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true" />
            <span className="truncate">Add a weapon for a pack</span>
          </span>
          <button
            type="button"
            onClick={() => onDuplicate(0)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300 dark:hover:bg-stone-800 cursor-pointer whitespace-nowrap"
            title="Duplicate this weapon into a multi-weapon bundle"
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            <span>Copy</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface WeaponSwitcherProps {
  pack: PackProject;
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Adds a blank weapon. The sidebar rail has the rest of the actions. */
  onAdd?: () => void;
}

/**
 * The mobile stand-in for the rail: the bundle's weapons as a select, and the one
 * action a phone needs to start a bundle (the card on the record page has the
 * rest). The select only exists once there is more than one weapon.
 */
export const WeaponSwitcher: React.FC<WeaponSwitcherProps> = ({
  pack,
  activeIndex,
  onSelect,
  onAdd,
}) => {
  const many = pack.weapons.length > 1;
  if (!many && !onAdd) return null;
  return (
    <span className="flex items-center gap-1">
      {many && (
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Weapon in this bundle</span>
          <select
            value={activeIndex}
            onChange={(event) => onSelect(Number(event.target.value))}
            className="max-w-28 truncate rounded-md border border-stone-300 bg-white px-1.5 py-1 text-[11px] font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          >
            {pack.weapons.map((weapon, index) => (
              <option key={`${weapon.id}-${index}`} value={index}>
                {weapon.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-forge-300/80 bg-forge-50/75 p-1 text-forge-700 dark:border-forge-700/60 dark:bg-forge-950/30 dark:text-forge-300"
          aria-label="Add a weapon to this bundle"
          title="Add a blank weapon to this bundle"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </span>
  );
};
