import React, { useMemo, useRef, useState } from 'react';
import { WeaponOptionsPanel } from './WeaponOptionsPanel';
import { WeaponProject, FireType } from '../types/weapon';
import { STOCK_BY_ID, STOCK_WEAPONS, StockWeaponInfo } from '../data/stockWeapons';
import { ID_MAX, isUnderNamespace, slugId, weaponIdSuffix } from '../utils/weaponId';
import { TooltipLabel, UnitNumberInput, buildTooltip } from './RecordEditor';
import { NumberInput } from './NumberInput';
import { recordField } from '../utils/recordField';
import { DEFAULT_MELEE } from '../data/melee';
import { SpritePickButton } from './SpritePickButton';
import {
  AlertTriangle,
  Image as ImageIcon,
  Trash2,
  SlidersHorizontal,
  ChevronDown,
  Plane,
  Navigation,
} from 'lucide-react';

interface WeaponSettingsProps {
  project: WeaponProject;
  /** The bundle this weapon is in. Its id is the namespace a weapon id lives under. */
  bundleId?: string;
  /**
   * True when the bundle holds more than one weapon: the bundle id is then the
   * namespace and only the weapon's own last segment is the author's to type
   * (`wfws.gravnade.windnade`). A bundle of one **is** its weapon, so there the
   * whole id stays editable and the bundle follows it.
   */
  lockIdNamespace?: boolean;
  onChange: (updated: Partial<WeaponProject>) => void;
}

function sanitizeWepFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const FIRE_TYPE_OPTIONS: { id: FireType; label: string; defaultDonor: string; desc: string }[] = [
  {
    id: 'power',
    label: 'Projectile (Rocket / Grenade / Animal)',
    defaultDonor: 'bazooka',
    desc: 'Launched or thrown ballistic projectile with physics, actions, and payloads.',
  },
  {
    id: 'hitscan',
    label: 'Firearm (Hitscan Bullet Spread)',
    defaultDonor: 'uzi',
    desc: 'Instant raycast firearm with bullets, spread cones, and multi-pellet bursts.',
  },
  {
    id: 'drop',
    label: 'Dropped (Mine / Timed Dynamite)',
    defaultDonor: 'mine',
    desc: 'Placed at the worm’s feet as a proximity sensor mine or timed explosive.',
  },
  {
    id: 'cursor',
    label: 'Cursor (Air Strike / Teleport)',
    defaultDonor: 'air_strike',
    desc: 'Target a map coordinate for an aircraft bomb run or cursor teleport.',
  },
  {
    id: 'arrow',
    label: 'Bow & Arrow',
    defaultDonor: 'longbow',
    desc: 'Direct-hit pinning arrow projectile.',
  },
  {
    id: 'spray',
    label: 'Flame / Spray Stream',
    defaultDonor: 'flame_thrower',
    desc: 'Continuous short-range stream (shares the 0x3c–0x64 gun slab for inspection).',
  },
  {
    id: 'melee',
    label: 'Melee (Swing / Strike)',
    // Not WA's bat: its special subtype resolves the whole hit inside one
    // native frame, so the worm never stays in a state long enough to animate
    // anything. The Sheep Launcher is a plain power record, so the worm gets a
    // real aim phase and a firing pipeline; the claim eats the fire, and the
    // swing takes the worm from there.
    defaultDonor: 'sheep_launcher',
    desc: 'The aiming phase is the attack: Space swings the held art and a scan box hits what it reaches. No projectile, no ammo.',
  },
  {
    id: 'special',
    label: 'Special / Utility Tool',
    defaultDonor: 'fire_punch',
    desc: 'Drills, traversal tools, and turn utilities that use a native behaviour.',
  },
];

/**
 * Melee is not one of WA's fire types. The record stays an ordinary power one (a
 * melee weapon is based on the Sheep Launcher) and the claim does the rest, so it
 * is offered as its own switch rather than as a kind of projectile: the select
 * above lists what `fires.type` / `method` can actually be.
 */
const MELEE_OPTION = FIRE_TYPE_OPTIONS.find((option) => option.id === 'melee')!;
const WA_FIRE_TYPES = FIRE_TYPE_OPTIONS.filter((option) => option.id !== 'melee');
const FAMILY_GROUPS: { label: string; families: StockWeaponInfo['family'][] }[] = [
  { label: 'Missiles, Bombs & Animals', families: ['missile'] },
  { label: 'Firearms', families: ['gun'] },
  { label: 'Mines', families: ['mine'] },
  { label: 'Air Strikes', families: ['strike'] },
  { label: 'Arrows & Spray', families: ['arrow', 'spray'] },
  { label: 'Specials & Utilities', families: ['special'] },
];

export const WeaponSettings: React.FC<WeaponSettingsProps> = ({
  project,
  bundleId,
  lockIdNamespace = false,
  onChange,
}) => {
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [showHandling, setShowHandling] = useState(false);
  // The id box keeps the typed text (spaces and capitals included) while it is
  // being edited, and shows the slugged id again on blur.
  const [idDraft, setIdDraft] = useState<string | null>(null);
  // The leaf box of a bundle weapon, same rule for the part after the bundle id.
  const [idLeafDraft, setIdLeafDraft] = useState<string | null>(null);
  // A weapon of a bundle of more than one can only name its own last segment:
  // the bundle id (`wfws.gravnade`) is the namespace every component id has to
  // live under, and `validateBundle` refuses the whole export for a weapon
  // outside it, so the first segments are the Bundle Settings card's to edit.
  const idPrefix = bundleId ? `${bundleId}.` : '';
  const idLocked = lockIdNamespace && !!bundleId;
  // A weapon whose id is the bundle id itself (a bundle of one grown by adding
  // weapons) has no leaf yet: the box asks for one instead of repeating the id.
  const idLeaf = project.id.trim() === (bundleId ?? '').trim() ? '' : weaponIdSuffix(project.id);

  const selectedSlot = STOCK_BY_ID.get(project.slot);
  const selectedDonor = STOCK_BY_ID.get(project.based_on);
  const activeFireOption = FIRE_TYPE_OPTIONS.find((f) => f.id === project.fireType);
  // Turning the melee claim off returns to the family the weapon last was. It is
  // UI memory on purpose: the project has one `fireType`, and the type a melee
  // weapon came from is not part of the record.
  const lastWaFireType = useRef<FireType>('power');
  if (project.fireType !== 'melee') lastWaFireType.current = project.fireType;

  const groupedDonors = useMemo(
    () =>
      FAMILY_GROUPS.map((group) => ({
        label: group.label,
        items: STOCK_WEAPONS.filter((w) => group.families.includes(w.family)),
      })),
    []
  );

  const applyIconFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        customIconFile: file,
        customIconPreview: reader.result as string,
        panel_icon: 'custom',
      });
    };
    reader.readAsDataURL(file);
  };

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    applyIconFile(file);
  };

  const removeCustomIcon = () => {
    onChange({
      customIconFile: undefined,
      customIconPreview: undefined,
      panel_icon: project.slot,
    });
  };

  const fieldInput =
    'w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500';
  const selectInput =
    'w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 disabled:cursor-not-allowed';

  // The inherited value when the author has not set one: a Shotgun takes two
  // shots and a Mine retreats for 5 s, which the fixed fallbacks hid.
  const handlingShots = recordField(project, 'handling.shots', 1);
  const handlingRetreat = recordField(project, 'handling.retreat', 3000);
  const handlingEndsTurn = recordField(project, 'handling.ends_turn', true);
  const handlingCaves = recordField(project, 'handling.available_in_caves', true);
  const handlingRemember = recordField(project, 'handling.remember_selection', true);

  const setOverride = (path: string, value: unknown) => {
    onChange({
      recordOverrides: {
        ...project.recordOverrides,
        [path]: value,
      },
    });
  };

  return (
    <section
      aria-label="Weapon Loadout"
      className="overflow-hidden rounded-xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900"
    >
      {/* Top Armory Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/70 px-4 py-2.5 dark:border-stone-800 dark:bg-stone-950/50">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h2 className="font-heading text-xs font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Weapon Loadout
          </h2>
          <span className="text-stone-300 dark:text-stone-700" aria-hidden="true">
            ·
          </span>
          <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
            Slot {selectedSlot?.row || 'F1'} · Col {selectedSlot?.column || 1}
          </span>
          {project.wepFile && (
            <>
              <span className="text-stone-300 dark:text-stone-700" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-[11px] text-forge-600 dark:text-forge-400 truncate max-w-[200px]">
                {project.wepFileName || project.wepFile.name}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowHandling((open) => !open)}
          aria-expanded={showHandling}
          title={buildTooltip(
            'Shots per use, retreat timer, cave availability, and turn-ending overrides.',
            'handling'
          )}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            showHandling
              ? 'border-forge-500/60 bg-forge-50 text-forge-800 dark:border-forge-500/50 dark:bg-forge-950/40 dark:text-forge-200'
              : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800'
          }`}
        >
          <SlidersHorizontal
            className={`h-3 w-3 ${showHandling ? 'text-forge-600 dark:text-forge-400' : 'text-stone-500 dark:text-stone-400'}`}
            aria-hidden="true"
          />
          <span>Turn Handling</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showHandling ? 'rotate-180 text-forge-600 dark:text-forge-400' : 'text-stone-400'}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="p-4 space-y-3.5">
        {/* Row 1: Armory Icon Slot + Identity */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3.5">
          {/* 32x32 Panel Icon */}
          <div className="flex items-end gap-2.5 shrink-0">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-950"
              title={
                project.customIconFile
                  ? 'Custom 32x32 panel icon (exports to icon.png)'
                  : `Stock icon: ${project.panel_icon}`
              }
            >
              {project.customIconPreview ? (
                <img
                  src={project.customIconPreview}
                  alt="Custom weapon icon"
                  className="h-8 w-8 object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <span className="font-mono text-[10px] font-semibold uppercase text-stone-400">
                  {project.panel_icon?.slice(0, 4) || 'ico'}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">
                Panel Icon
              </div>
              <div className="flex items-center gap-1">
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,.png"
                  onChange={handleIconUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => iconInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ImageIcon className="h-3 w-3 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                  <span>{project.customIconFile ? 'Replace' : 'Upload PNG'}</span>
                </button>
                <SpritePickButton
                  accept="image"
                  label="Pick Panel Icon"
                  onPick={(file) => applyIconFile(file)}
                />
                {project.customIconFile && (
                  <button
                    type="button"
                    onClick={removeCustomIcon}
                    className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-rose-600 dark:hover:bg-stone-800 dark:hover:text-rose-400 cursor-pointer"
                    title="Revert to stock slot icon"
                    aria-label="Revert to stock slot icon"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Identity Fields */}
          <div className="grid flex-1 grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <TooltipLabel
                label="Display Name"
                desc="Weapon name shown in the inventory panel and game HUD."
                htmlFor="ws-display-name"
              />
              <input
                id="ws-display-name"
                type="text"
                value={project.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="e.g. Moon Grenade"
                maxLength={40}
                className={fieldInput}
              />
            </div>

            <div>
              <TooltipLabel
                label="Weapon ID"
                code="id"
                desc={
                  idLocked
                    ? `The part of this weapon's component id after \`${idPrefix}\`. The bundle id is the namespace every weapon of a bundle lives under, so it is edited in Bundle Settings and this box only names the weapon.`
                    : 'The component id this weapon ships under. The bundle id is its namespace, so a weapon in a bundle is <bundle id>.<weapon>; the engine refuses two bundles that claim the same id.'
                }
                htmlFor="ws-component-id"
              />
              {idLocked ? (
                <div
                  className="flex items-stretch overflow-hidden rounded-lg border border-stone-200 bg-white focus-within:ring-2 focus-within:ring-forge-500 dark:border-stone-700 dark:bg-stone-900"
                  title={`Every weapon of this bundle lives under its id, so ${idPrefix} is fixed and set in Bundle Settings.`}
                >
                  <span className="flex max-w-[62%] items-center truncate border-r border-stone-200 bg-stone-50 px-2 font-mono text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-950/50 dark:text-stone-400">
                    {idPrefix}
                  </span>
                  <input
                    id="ws-component-id"
                    type="text"
                    aria-label="Weapon id, the part after the bundle id"
                    value={idLeafDraft ?? idLeaf}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setIdLeafDraft(raw);
                      // An empty leaf is not an id: the box falls back to the
                      // current one rather than renaming mid-typing.
                      if (!raw.replace(/[^a-zA-Z0-9_.-]/g, '').replace(/[._-]/g, '')) return;
                      onChange({ id: `${idPrefix}${slugId(raw)}` });
                    }}
                    onBlur={() => setIdLeafDraft(null)}
                    placeholder={weaponIdSuffix(bundleId) || 'weapon'}
                    maxLength={Math.max(8, ID_MAX - idPrefix.length)}
                    className="w-full min-w-0 bg-transparent px-2 py-1.5 font-mono text-xs text-stone-900 focus:outline-hidden dark:text-white"
                  />
                </div>
              ) : (
                <input
                  id="ws-component-id"
                  type="text"
                  value={idDraft ?? project.id}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setIdDraft(raw);
                    // Clearing the box keeps the last id: an empty id is not one,
                    // and a silent fallback would rename the weapon mid-typing.
                    if (!raw.replace(/[^a-zA-Z0-9_.-]/g, '').replace(/[._-]/g, '')) return;
                    onChange({ id: slugId(raw) });
                  }}
                  onBlur={() => setIdDraft(null)}
                  placeholder="my_mod.moon_grenade"
                  maxLength={ID_MAX}
                  className={fieldInput}
                />
              )}
              {bundleId && !isUnderNamespace(project.id, bundleId) && (
                <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>
                    This id is outside the bundle id (<code className="font-mono">{bundleId}</code>),
                    so nothing keeps it from colliding with an installed mod. A weapon of this
                    bundle normally lives under <code className="font-mono">{bundleId}.</code>
                  </span>
                </p>
              )}
            </div>

            <div>
              <TooltipLabel
                label="Author"
                desc="Creator or team name written into mod.toml."
                htmlFor="ws-author"
              />
              <input
                id="ws-author"
                type="text"
                value={project.author}
                onChange={(e) => onChange({ author: e.target.value })}
                placeholder="Your name"
                maxLength={40}
                className={fieldInput}
              />
            </div>
          </div>
        </div>

        {/* Description (1 clean line) */}
        <div>
          <TooltipLabel
            label="Description"
            desc="Short weapon summary shown in the WormForge mod loader."
            htmlFor="ws-description"
          />
          <input
            id="ws-description"
            type="text"
            value={project.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Short description shown in the mod loader..."
            maxLength={160}
            className={fieldInput}
          />
        </div>

        {/* Row 2: Compact 3-Dropdown Firing Core */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-stone-200/80 pt-3.5 dark:border-stone-800">
          {/* Fire Archetype Dropdown */}
          <div>
            <TooltipLabel
              label="Weapon Type"
              code="fires.type / method"
              desc={
                activeFireOption?.desc ??
                'Controls which parameter group and weapon mechanics this record uses.'
              }
              htmlFor="ws-fire-type"
            />
            <select
              id="ws-fire-type"
              value={project.fireType}
              onChange={(e) => {
                const nextType = e.target.value as FireType;
                const opt = FIRE_TYPE_OPTIONS.find((f) => f.id === nextType);
                const defaultDonor = opt?.defaultDonor ?? 'bazooka';
                onChange({
                  fireType: nextType,
                  teleport: false,
                  slot: defaultDonor,
                  based_on: defaultDonor,
                  panel_icon: project.customIconFile ? project.panel_icon : defaultDonor,
                  // Leaving melee through the select is leaving the claim: a
                  // melee table left enabled on a projectile would still eat WA's
                  // fire, so the two never disagree.
                  ...(nextType === 'melee'
                    ? {}
                    : { melee: { ...(project.melee ?? DEFAULT_MELEE), enabled: false } }),
                });
              }}
              className={selectInput}
            >
              {WA_FIRE_TYPES.map((ft) => (
                <option key={ft.id} value={ft.id}>
                  {ft.label}
                </option>
              ))}
              {/* The current type has to be shown, not dropped: an imported melee
                  weapon is on this value and the select must not read blank. */}
              {project.fireType === 'melee' && (
                <option value="melee">{MELEE_OPTION.label}</option>
              )}
            </select>
          </div>

          {/* Based On Donor Dropdown */}
          <div>
            <TooltipLabel
              label="Base Template"
              code="copy_from"
              desc={
                project.useWepFile
                  ? 'Disabled while an imported .wep supplies the base record.'
                  : `Inherits physics, native behaviour, and sounds from ${selectedDonor?.name || project.based_on}. Switching keeps your edited fields.`
              }
              htmlFor="ws-based-on"
            />
            <select
              id="ws-based-on"
              value={project.based_on}
              onChange={(e) => onChange({ based_on: e.target.value })}
              disabled={!!project.useWepFile}
              className={selectInput}
            >
              {groupedDonors.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.id})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Inventory Slot Dropdown */}
          <div>
            <TooltipLabel
              label="Inventory Slot"
              code="slot"
              desc="Stock weapon slot replaced in the game's weapon panel (does not copy physics)."
              htmlFor="ws-slot"
            />
            <select
              id="ws-slot"
              value={project.slot}
              onChange={(e) => {
                const newSlot = e.target.value;
                onChange({
                  slot: newSlot,
                  panel_icon: project.customIconFile ? project.panel_icon : newSlot,
                });
              }}
              className={selectInput}
            >
              {STOCK_WEAPONS.map((w) => (
                <option key={w.id} value={w.id}>
                  [{w.row}] {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mode Strip: Melee Claim Toggle + Cursor Sub-mode */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-50/80 px-3 py-2 dark:bg-stone-950/40">
          <label
            className="flex cursor-pointer items-center gap-2"
            title={`${MELEE_OPTION.desc} The record stays an ordinary power one, so the physics tabs come back the moment the claim is off.`}
          >
            <input
              type="checkbox"
              id="ws-melee-toggle"
              checked={project.fireType === 'melee'}
              onChange={(e) => {
                if (e.target.checked) {
                  const melee = project.melee ?? DEFAULT_MELEE;
                  onChange({
                    fireType: 'melee',
                    teleport: false,
                    // A melee weapon wants a power record WA still fires, so the
                    // worm gets an aim phase for the swing to take over.
                    slot: MELEE_OPTION.defaultDonor,
                    based_on: MELEE_OPTION.defaultDonor,
                    panel_icon: project.customIconFile
                      ? project.panel_icon
                      : MELEE_OPTION.defaultDonor,
                    melee: { ...melee, enabled: true },
                  });
                } else {
                  // Off means off: the record keeps its donor (a melee weapon's
                  // Sheep Launcher is a valid projectile record) and only the
                  // claim goes.
                  onChange({
                    fireType: lastWaFireType.current,
                    melee: { ...(project.melee ?? DEFAULT_MELEE), enabled: false },
                  });
                }
              }}
              className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs leading-snug">
              <span className="font-semibold text-stone-800 dark:text-stone-100">
                Melee strike
              </span>
              <span className="mx-1.5 text-stone-300 dark:text-stone-700" aria-hidden="true">
                ·
              </span>
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                Custom swing claim (replaces fire with hold animation &amp; scan box)
              </span>
            </span>
          </label>

          {project.fireType === 'cursor' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
                Cursor Mode
              </span>
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-stone-200 bg-stone-100 p-0.5 dark:border-stone-700 dark:bg-stone-900">
                <button
                  type="button"
                  onClick={() => onChange({ teleport: false })}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    !project.teleport
                      ? 'bg-white text-stone-900 shadow-xs ring-1 ring-forge-500/35 dark:bg-stone-800 dark:text-white'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                  }`}
                >
                  <Plane className={`h-3 w-3 ${!project.teleport ? 'text-forge-600 dark:text-forge-400' : ''}`} aria-hidden="true" />
                  <span>Air Strike</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ teleport: true })}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    project.teleport
                      ? 'bg-white text-stone-900 shadow-xs ring-1 ring-forge-500/35 dark:bg-stone-800 dark:text-white'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                  }`}
                >
                  <Navigation className={`h-3 w-3 ${project.teleport ? 'text-forge-600 dark:text-forge-400' : ''}`} aria-hidden="true" />
                  <span>Teleport</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Imported .wep Override Strip */}
        {project.wepFile && (
          <label className="flex items-center gap-2.5 rounded-lg border border-forge-200 bg-forge-50/50 px-3 py-2 cursor-pointer dark:border-forge-900/60 dark:bg-forge-950/20">
            <input
              type="checkbox"
              checked={!!project.useWepFile}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked && !project.wepBaseline) {
                  onChange({
                    useWepFile: true,
                    wepBaseline: {
                      body: { ...project.body, clustlet: { ...project.body.clustlet } },
                      action: project.action,
                      burst: project.burst,
                      recordOverrides: { ...project.recordOverrides },
                      missileSprite: { ...project.missileSprite },
                      roamConfig: { ...project.roamConfig },
                      digConfig: { ...project.digConfig },
                      fireConfig: { ...project.fireConfig },
                      specialSubtype: project.specialSubtype,
                    },
                  });
                } else {
                  onChange({ useWepFile: checked });
                }
              }}
              className="rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs text-stone-700 dark:text-stone-300">
              Use imported{' '}
              <code className="font-mono font-semibold text-forge-700 dark:text-forge-300">
                weps/{sanitizeWepFileName(project.wepFileName || project.wepFile.name)}
              </code>{' '}
              as base record (unchanged fields stay in the .wep)
            </span>
          </label>
        )}

        {/* Row 3: Match Rules Bar */}
        <div className="space-y-2.5 border-t border-stone-200/80 pt-3.5 dark:border-stone-800">
          <div className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">
            Match Defaults
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <TooltipLabel
                label="Start Ammo"
                code="defaults.ammo"
                desc="Starting round ammunition (-1 = infinite)."
              />
              <NumberInput
                value={project.defaults.ammo}
                onChange={(e) =>
                  onChange({
                    defaults: { ...project.defaults, ammo: parseInt(e.target.value, 10) || 0 },
                  })
                }
                className={`${fieldInput} font-mono tabular-nums`}
              />
            </div>

            <div>
              <TooltipLabel
                label="Turn Delay"
                code="defaults.delay"
                desc="Turns elapsed before this weapon unlocks."
              />
              <NumberInput
                min={0}
                value={project.defaults.delay}
                onChange={(e) =>
                  onChange({
                    defaults: {
                      ...project.defaults,
                      delay: Math.max(0, parseInt(e.target.value, 10) || 0),
                    },
                  })
                }
                className={`${fieldInput} font-mono tabular-nums`}
              />
            </div>

            <div>
              <TooltipLabel
                label="Crate Chance"
                code="defaults.crate.chance_pct"
                desc="Chance this weapon appears in a weapon crate (0–100%)."
              />
              <UnitNumberInput
                min={0}
                max={100}
                value={project.defaults.crateChance}
                onChange={(e) =>
                  onChange({
                    defaults: {
                      ...project.defaults,
                      crateChance: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)),
                    },
                  })
                }
                unit="%"
              />
            </div>

            <div>
              <TooltipLabel
                label="Crate Pool"
                code="defaults.crate.type"
                desc="Which crate category can drop this weapon."
              />
              <select
                value={project.defaults.crateType}
                onChange={(e) =>
                  onChange({
                    defaults: { ...project.defaults, crateType: e.target.value as any },
                  })
                }
                className={selectInput}
              >
                <option value="weapon">Weapon Crate</option>
                <option value="utility">Utility Crate</option>
                <option value="super">Super Weapon</option>
              </select>
            </div>

            <div>
              <TooltipLabel
                label="After Firing"
                code="defaults.after_use"
                desc="Turn action taken after firing completes."
              />
              <select
                value={project.defaults.afterUse}
                onChange={(e) =>
                  onChange({
                    defaults: { ...project.defaults, afterUse: e.target.value as any },
                  })
                }
                className={selectInput}
              >
                <option value="">Inherit Base</option>
                <option value="end">End Turn</option>
                <option value="retreat">Retreat Timer</option>
                <option value="continue">Continue Turn</option>
              </select>
            </div>
          </div>
        </div>

        {/* The component's ctx.option settings, when the weapon declares any. */}
        <WeaponOptionsPanel project={project} onChange={onChange} />

        {/* Row 4: Collapsible Native Turn Handling Drawer */}
        {showHandling && (
          <div className="border-t border-stone-200/80 pt-3.5 dark:border-stone-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-heading text-xs font-semibold tracking-tight text-stone-800 dark:text-stone-200">
                Native Turn Handling Overrides
              </span>
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                Written into <code className="font-mono">handling</code> when changed
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <TooltipLabel
                  label="Shots per Turn"
                  code="handling.shots"
                  desc="How many times the weapon fires before ending use (e.g. Shotgun = 2)."
                />
                <NumberInput
                  min={1}
                  max={50}
                  value={handlingShots}
                  onChange={(e) => setOverride('handling.shots', Number(e.target.value))}
                  className={`${fieldInput} font-mono tabular-nums`}
                />
              </div>

              <div>
                <TooltipLabel
                  label="Retreat Time"
                  code="handling.retreat"
                  desc="Retreat countdown in milliseconds after firing."
                />
                <UnitNumberInput
                  min={0}
                  step={500}
                  value={handlingRetreat}
                  onChange={(e) => setOverride('handling.retreat', Number(e.target.value))}
                  unit="ms"
                />
              </div>

              <label
                title={buildTooltip('Whether using the weapon ends weapon use for this turn.', 'handling.ends_turn')}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-1.5 text-xs font-medium text-stone-700 cursor-pointer dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
              >
                <input
                  type="checkbox"
                  checked={!!handlingEndsTurn}
                  onChange={(e) => setOverride('handling.ends_turn', e.target.checked)}
                  className="rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="truncate">Ends Turn</span>
              </label>

              <label
                title={buildTooltip('Allow selecting this weapon on cavern maps and cavern crates.', 'handling.available_in_caves')}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-1.5 text-xs font-medium text-stone-700 cursor-pointer dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
              >
                <input
                  type="checkbox"
                  checked={!!handlingCaves}
                  onChange={(e) => setOverride('handling.available_in_caves', e.target.checked)}
                  className="rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="truncate">Usable in Caves</span>
              </label>

              <label
                title={buildTooltip('Re-select this weapon automatically on your next turn.', 'handling.remember_selection')}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-1.5 text-xs font-medium text-stone-700 cursor-pointer dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-200"
              >
                <input
                  type="checkbox"
                  checked={!!handlingRemember}
                  onChange={(e) => setOverride('handling.remember_selection', e.target.checked)}
                  className="rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="truncate">Keep Selected</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
