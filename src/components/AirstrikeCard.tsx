import React, { useRef } from 'react';
import {
  ChevronDown,
  Crosshair,
  Flame,
  Gauge,
  ImagePlus,
  Orbit,
  Package,
  Plane,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AirstrikeAltitudeMode,
  AirstrikeBoomHitKind,
  AirstrikeBoomMode,
  AirstrikeBoomVisual,
  AirstrikeCadenceUnit,
  AirstrikeConfig,
  AirstrikeDirectionMode,
  AirstrikeEntryMode,
  AirstrikePattern,
  AirstrikePayloadKind,
  AirstrikePlanePartConfig,
  AirstrikePlayMode,
  AirstrikeRecoverMode,
  AirstrikeReleaseMode,
  AirstrikeSheetAsset,
  AirstrikeSoundSpec,
  WeaponProject,
} from '../types/weapon';
import {
  AIRSTRIKE_PRESETS,
  STOCK_PLANE_SPRITES,
  mergeAirstrikeConfig,
} from '../data/airstrike';
import { DEFAULT_EMITTER } from '../data/emitter';
import { STOCK_WEAPONS } from '../data/stockWeapons';
import { AirstrikePreview } from './AirstrikePreview';
import { NumberInput } from './NumberInput';
import { SoundUpload } from './EffectsCards';
import { SpritePickButton } from './SpritePickButton';
import { recordField } from '../utils/recordField';

interface AirstrikeCardProps {
  project: WeaponProject;
  onChange: (patch: Partial<WeaponProject>) => void;
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
const labelClass = 'mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300';

/** Stock projectile donors eligible for `projectile = { copy_from = "stock.<donor>" }`. */
const PROJECTILE_DONORS = STOCK_WEAPONS.filter((w) => w.family === 'missile');

const SheetUploadRow: React.FC<{
  id: string;
  label: string;
  asset?: AirstrikeSheetAsset;
  onPick: (asset: AirstrikeSheetAsset) => void;
  onRemove: () => void;
}> = ({ id, label, asset, onPick, onRemove }) => {
  const ref = useRef<HTMLInputElement>(null);
  const acceptFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      onPick({
        file,
        fileName: file.name,
        previewUrl: url,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    img.onerror = () =>
      onPick({
        file,
        fileName: file.name,
        previewUrl: url,
      });
    img.src = url;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-2.5 py-2 dark:border-stone-700 dark:bg-stone-950/40">
      <input
        ref={ref}
        id={id}
        type="file"
        accept="image/png,image/gif"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) acceptFile(f);
        }}
      />
      {asset?.previewUrl ? (
        <img
          src={asset.previewUrl}
          alt={label}
          className="h-9 w-9 shrink-0 rounded border border-stone-300 bg-stone-900 object-contain p-0.5 dark:border-stone-600"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-stone-300 text-stone-400 dark:border-stone-700">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-stone-800 dark:text-stone-200">
          {asset?.fileName || `Upload ${label}`}
        </div>
        <div className="text-[10px] text-stone-500 dark:text-stone-400">
          {asset?.width && asset?.height
            ? `${asset.width}×${asset.height} px`
            : 'Vertical PNG strip (or single frame)'}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="rounded-md border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
        >
          {asset?.file ? 'Replace' : 'Browse'}
        </button>
        <SpritePickButton
          accept="image"
          compact
          label={`Pick ${label} from .pxl`}
          onPick={acceptFile}
        />
        {asset?.file && (
          <button
            type="button"
            onClick={onRemove}
            title={`Remove ${label}`}
            className="rounded-md p-1 text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

const SoundRow: React.FC<{
  id: string;
  label: string;
  hint: string;
  sound: AirstrikeSoundSpec;
  onChange: (next: AirstrikeSoundSpec) => void;
}> = ({ id, label, hint, sound, onChange }) => (
  <div className="space-y-1.5 rounded-lg border border-stone-200/80 bg-stone-50/50 p-2.5 dark:border-stone-700/80 dark:bg-stone-950/30">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-stone-700 dark:text-stone-300" title={hint}>
        {label}
      </span>
      <span className="text-[10px] text-stone-400 dark:text-stone-500">
        {sound.file ? 'custom WAV' : sound.id > 0 ? `WA #${sound.id}` : 'silent'}
      </span>
    </div>
    <SoundUpload
      id={id}
      asset={sound.file}
      onPick={(asset) => onChange({ ...sound, file: asset })}
      onRemove={() => onChange({ ...sound, file: undefined })}
    />
    <div className="flex items-center gap-2">
      <label
        htmlFor={`${id}-wa`}
        className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500"
      >
        WA Sample ID
      </label>
      <NumberInput
        id={`${id}-wa`}
        min={0}
        max={2000}
        value={sound.id}
        disabled={!!sound.file}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value.trim() === '' || Number.isNaN(v)) return;
          onChange({ ...sound, id: Math.max(0, Math.round(v)) });
        }}
        className="w-24 rounded-md border border-stone-200 bg-white px-2 py-1 font-mono text-[11px] tabular-nums text-stone-900 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
      />
    </div>
  </div>
);

/** Optional nullable numeric field (blank = null / inherit default, 0 = explicit zero). */
const NullableNumberField: React.FC<{
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: number | null;
  step?: number;
  min?: number;
  max?: number;
  onChange: (value: number | null) => void;
}> = ({ id, label, hint, placeholder, value, step = 1, min, max, onChange }) => (
  <div>
    <label htmlFor={id} className={labelClass} title={hint}>
      {label}
    </label>
    <input
      id={id}
      type="number"
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      value={value === null || value === undefined ? '' : value}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === '') {
          onChange(null);
          return;
        }
        const n = Number(raw);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className={inputClass}
    />
  </div>
);

export const AirstrikeCard: React.FC<AirstrikeCardProps> = ({ project, onChange }) => {
  const air = mergeAirstrikeConfig(project.airstrike);
  const gravityPct = Number(recordField(project, 'missile.gravity_pct', 100)) || 100;

  const update = (patch: Partial<AirstrikeConfig>) =>
    onChange({ airstrike: { ...air, ...patch } });
  const updateEntry = (patch: Partial<AirstrikeConfig['entry']>) =>
    update({ entry: { ...air.entry, ...patch } });
  const updatePlane = (patch: Partial<AirstrikeConfig['plane']>) =>
    update({ plane: { ...air.plane, ...patch } });
  const updateSpeed = (patch: Partial<AirstrikeConfig['speed']>) =>
    update({ speed: { ...air.speed, ...patch } });
  const updateRelease = (patch: Partial<AirstrikeConfig['release']>) =>
    update({ release: { ...air.release, ...patch } });
  const updateStrafe = (patch: Partial<AirstrikeConfig['strafe']>) =>
    update({ strafe: { ...air.strafe, ...patch } });
  const updatePayload = (patch: Partial<AirstrikeConfig['payload']>) =>
    update({ payload: { ...air.payload, ...patch } });

  const numChange =
    (apply: (v: number) => void, opts: { round?: boolean; min?: number; max?: number } = {}) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.value.trim() === '') return;
      let v = Number(e.target.value);
      if (Number.isNaN(v)) return;
      if (opts.round) v = Math.round(v);
      if (opts.min !== undefined) v = Math.max(opts.min, v);
      if (opts.max !== undefined) v = Math.min(opts.max, v);
      apply(v);
    };

  const hasPlane = air.entry.mode !== 'payload';
  const isStrafe = air.release.mode === 'strafe';
  const isMissilePayload = air.payload.kind === 'missile';

  const addPlanePart = () => {
    const idx = air.plane.parts.length + 1;
    const nextPart: AirstrikePlanePartConfig = {
      id: `part_${idx}`,
      label: `Part ${idx}`,
      spriteMode: 'custom',
      stockSprite: 'airjetg',
      ox: 0,
      oy: 0,
      frames: 1,
      fps: 15,
      play: 'loop',
      scale: 1,
      depthOffset: -1,
      facingFlip: false,
      trackGun: false,
      aimSync: false,
      firingFrames: false,
      bankScale: 1,
      angleOffset: 0,
    };
    updatePlane({ parts: [...air.plane.parts, nextPart] });
  };

  const patchPart = (index: number, patch: Partial<AirstrikePlanePartConfig>) =>
    updatePlane({
      parts: air.plane.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });

  const removePart = (index: number) =>
    updatePlane({ parts: air.plane.parts.filter((_, i) => i !== index) });

  return (
    <div className="space-y-4">
      {/* Header + Master Toggle (mirrors MeleeCard) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
            <Plane className="h-4 w-4 text-forge-600 dark:text-forge-400" aria-hidden="true" />
            Airstrike Takeover
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-stone-500 dark:text-stone-400">
            Hands cursor clicks to <span className="font-mono">wf-lib/wfws_airstrike</span> so you
            control aircraft speed curves, ease-in/slow/recover, multi-part vehicles, strafing runs,
            direct sky or cursor spawns, and arbitrary payloads — while unlocking custom flight art,
            ribbon trails, explosion bursts, emitters, and terrain stamps for missile payloads.
          </p>
        </div>

        <label
          htmlFor="airstrike-enabled"
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-xs font-bold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
        >
          <input
            id="airstrike-enabled"
            type="checkbox"
            checked={air.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
          />
          Enable Airstrike Takeover
        </label>
      </div>

      {/* Status Banner */}
      <div
        className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          air.enabled
            ? 'border-forge-200 bg-forge-50/70 text-forge-800 dark:border-forge-800/60 dark:bg-forge-950/25 dark:text-forge-300'
            : 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-300'
        }`}
      >
        <Plane className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Lua takeover:{' '}
          <span className="font-mono font-bold">{air.enabled ? 'active' : 'off'}</span>
          {air.enabled
            ? ` (${air.entry.mode === 'payload' ? `direct ${air.entry.spawnAt} spawn` : `${air.entry.mode} flyover`} · ${air.release.mode} · ${air.release.count}× ${air.payload.kind}${
                isMissilePayload
                  ? ' · unlocks flight builder, trails, bursts, emitters & terrain stamp'
                  : ''
              })`
            : ' (using WA’s native strike record; configure native flyover in Strike & Bombs)'}
        </span>
      </div>

      {air.enabled && (
        <>
          {/* Quick Presets */}
          <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-700 dark:bg-stone-950/30">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-600 dark:text-stone-300">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                Quick Presets
              </span>
              <span className="text-[10px] text-stone-400 dark:text-stone-500">
                Starting points — tweak any parameter below
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AIRSTRIKE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.summary}
                  onClick={() => update(preset.apply(air))}
                  className="cursor-pointer rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 transition-colors hover:border-forge-400 hover:bg-forge-50 hover:text-forge-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-forge-600 dark:hover:bg-forge-950/40 dark:hover:text-forge-300"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* 50 Hz Live Preview (max 4 demo projectiles, no collisions) */}
          <AirstrikePreview config={air} gravityPct={gravityPct} />

          {/* SECTION 1: Entry & Direction */}
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-3.5 dark:border-stone-700 dark:bg-stone-800/70">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                Entry &amp; Direction
              </span>
              <span className="font-mono text-[10px] text-stone-400">entry · direction</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="air-entry-mode" className={labelClass}>
                  Entry Mode
                </label>
                <select
                  id="air-entry-mode"
                  value={air.entry.mode}
                  onChange={(e) => updateEntry({ mode: e.target.value as AirstrikeEntryMode })}
                  className={selectClass}
                >
                  <option value="offmap">Fly In From Map Side (offmap)</option>
                  <option value="above">Spawn Above Drop Window (above)</option>
                  <option value="payload">Direct Payload — No Plane (payload)</option>
                </select>
              </div>

              <div>
                <label htmlFor="air-direction" className={labelClass}>
                  Direction Source
                </label>
                <select
                  id="air-direction"
                  value={air.direction}
                  onChange={(e) =>
                    update({ direction: e.target.value as AirstrikeDirectionMode })
                  }
                  className={selectClass}
                >
                  <option value="arrows">Player Arrow Keys (L / R)</option>
                  <option value="cursor_side">Cursor Side of Map</option>
                  <option value="right">Always Left → Right</option>
                  <option value="left">Always Right → Left</option>
                  <option value="none">No Direction (cursor only)</option>
                </select>
              </div>

              {hasPlane ? (
                <>
                  <NullableNumberField
                    id="air-entry-y"
                    label="Sky Altitude Y (px)"
                    hint="Explicit Y coordinate in WA world pixels (negative is above top of map). Leave blank to use the map's sky height (ev.sky)."
                    placeholder="ev.sky"
                    value={air.entry.y}
                    onChange={(v) => updateEntry({ y: v })}
                  />
                  <div>
                    <label htmlFor="air-entry-side" className={labelClass}>
                      Off-Map Entry Margin (px)
                    </label>
                    <NumberInput
                      id="air-entry-side"
                      min={0}
                      max={600}
                      value={air.entry.side}
                      onChange={numChange((side) => updateEntry({ side }), { min: 0, round: true })}
                      className={inputClass}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="air-spawn-at" className={labelClass}>
                      Spawn Origin
                    </label>
                    <select
                      id="air-spawn-at"
                      value={air.entry.spawnAt}
                      onChange={(e) =>
                        updateEntry({ spawnAt: e.target.value as 'sky' | 'cursor' })
                      }
                      className={selectClass}
                    >
                      <option value="sky">Sky Above Target (sky)</option>
                      <option value="cursor">At Clicked Cursor (cursor)</option>
                    </select>
                  </div>
                  <NullableNumberField
                    id="air-entry-y"
                    label="Sky Y Override (px)"
                    hint="Used when Spawn Origin is Sky. Leave blank for WA's ev.sky."
                    placeholder="ev.sky"
                    value={air.entry.y}
                    onChange={(v) => updateEntry({ y: v })}
                  />
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="air-drop-offset-x" className={labelClass}>
                  Drop Center Offset X (px)
                </label>
                <NumberInput
                  id="air-drop-offset-x"
                  min={-600}
                  max={600}
                  value={air.entry.dropOffsetX}
                  onChange={numChange((dropOffsetX) => updateEntry({ dropOffsetX }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="air-default-dir" className={labelClass}>
                  Fallback Direction
                </label>
                <select
                  id="air-default-dir"
                  value={String(air.defaultDir)}
                  onChange={(e) => update({ defaultDir: Number(e.target.value) < 0 ? -1 : 1 })}
                  className={selectClass}
                >
                  <option value="1">Right (+1)</option>
                  <option value="-1">Left (-1)</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
                <input
                  type="checkbox"
                  checked={air.stopOnTurnEnd}
                  onChange={(e) => update({ stopOnTurnEnd: e.target.checked })}
                  className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                />
                Cancel if turn ends early
              </label>
            </div>
          </div>

          {/* SECTION 2: Release Pattern & Cadence */}
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-3.5 dark:border-stone-700 dark:bg-stone-800/70">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                Release Pattern &amp; Cadence
              </span>
              <span className="font-mono text-[10px] text-stone-400">release</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="air-rel-mode" className={labelClass}>
                  Delivery Mode
                </label>
                <select
                  id="air-rel-mode"
                  value={air.release.mode}
                  onChange={(e) => {
                    const mode = e.target.value as AirstrikeReleaseMode;
                    updateRelease({
                      mode,
                      cadenceUnit: mode === 'strafe' ? 'frames' : air.release.cadenceUnit,
                      lead: mode === 'strafe' ? false : air.release.lead,
                    });
                  }}
                  className={selectClass}
                >
                  <option value="drop">Ballistic Drop (drop)</option>
                  <option value="strafe">Aimed Strafe Fire (strafe)</option>
                </select>
              </div>

              <div>
                <label htmlFor="air-rel-pattern" className={labelClass}>
                  Pattern
                </label>
                <select
                  id="air-rel-pattern"
                  value={air.release.pattern}
                  onChange={(e) =>
                    updateRelease({ pattern: e.target.value as AirstrikePattern })
                  }
                  className={selectClass}
                >
                  <option value="sequential">Sequential Line</option>
                  <option value="carpet">Carpet Window</option>
                  <option value="burst">Simultaneous Burst</option>
                  <option value="pairs">Tight Pairs</option>
                  <option value="ripple">Ripple Groups</option>
                  <option value="random_window">Random Window</option>
                  <option value="offsets">Custom X Offsets</option>
                </select>
              </div>

              <div>
                <label htmlFor="air-rel-count" className={labelClass}>
                  Total Count
                </label>
                <NumberInput
                  id="air-rel-count"
                  min={0}
                  max={60}
                  value={air.release.count}
                  onChange={numChange((count) => updateRelease({ count }), {
                    min: 0,
                    max: 60,
                    round: true,
                  })}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="air-rel-cadence" className={labelClass}>
                  Cadence Driver
                </label>
                <select
                  id="air-rel-cadence"
                  value={air.release.cadenceUnit}
                  onChange={(e) =>
                    updateRelease({ cadenceUnit: e.target.value as AirstrikeCadenceUnit })
                  }
                  className={selectClass}
                >
                  <option value="distance">Plane X Distance (distance)</option>
                  <option value="frames">50 Hz Tick Timer (frames)</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(air.release.pattern === 'sequential' ||
                air.release.pattern === 'pairs' ||
                air.release.pattern === 'ripple') && (
                <div>
                  <label htmlFor="air-rel-spacing" className={labelClass}>
                    Drop Spacing (px)
                  </label>
                  <NumberInput
                    id="air-rel-spacing"
                    min={0}
                    max={400}
                    value={air.release.spacing}
                    onChange={numChange((spacing) => updateRelease({ spacing }), { min: 0 })}
                    className={inputClass}
                  />
                </div>
              )}

              {(air.release.pattern === 'carpet' || air.release.pattern === 'random_window') && (
                <div>
                  <label htmlFor="air-rel-window" className={labelClass}>
                    Window Width (px)
                  </label>
                  <NumberInput
                    id="air-rel-window"
                    min={0}
                    max={1200}
                    value={air.release.window}
                    onChange={numChange((window) => updateRelease({ window }), { min: 0 })}
                    className={inputClass}
                  />
                </div>
              )}

              {air.release.pattern === 'burst' && (
                <div>
                  <label htmlFor="air-rel-burst" className={labelClass}>
                    Burst Size
                  </label>
                  <NumberInput
                    id="air-rel-burst"
                    min={1}
                    max={60}
                    value={air.release.burstSize}
                    onChange={numChange((burstSize) => updateRelease({ burstSize }), {
                      min: 1,
                      round: true,
                    })}
                    className={inputClass}
                  />
                </div>
              )}

              {(air.release.pattern === 'ripple' || air.release.pattern === 'carpet') && (
                <div>
                  <label htmlFor="air-rel-pertick" className={labelClass}>
                    Rounds Per Tick
                  </label>
                  <NumberInput
                    id="air-rel-pertick"
                    min={1}
                    max={12}
                    value={air.release.perTick}
                    onChange={numChange((perTick) => updateRelease({ perTick }), {
                      min: 1,
                      round: true,
                    })}
                    className={inputClass}
                  />
                </div>
              )}

              <div>
                <label htmlFor="air-rel-frames" className={labelClass}>
                  Frames Between (50 Hz)
                </label>
                <NumberInput
                  id="air-rel-frames"
                  min={0}
                  max={100}
                  value={air.release.framesBetween}
                  onChange={numChange((framesBetween) => updateRelease({ framesBetween }), {
                    min: 0,
                    round: true,
                  })}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="air-rel-windup" className={labelClass}>
                  Windup Delay (frames)
                </label>
                <NumberInput
                  id="air-rel-windup"
                  min={0}
                  max={250}
                  value={air.release.windup}
                  onChange={numChange((windup) => updateRelease({ windup }), {
                    min: 0,
                    round: true,
                  })}
                  className={inputClass}
                />
              </div>

              {air.release.cadenceUnit === 'distance' && (
                <div>
                  <label htmlFor="air-rel-minframes" className={labelClass}>
                    Min Frames Gap
                  </label>
                  <NumberInput
                    id="air-rel-minframes"
                    min={0}
                    max={100}
                    value={air.release.minFrames}
                    onChange={numChange((minFrames) => updateRelease({ minFrames }), {
                      min: 0,
                      round: true,
                    })}
                    className={inputClass}
                  />
                </div>
              )}
            </div>

            {air.release.pattern === 'offsets' && (
              <div>
                <label htmlFor="air-rel-offsets" className={labelClass}>
                  Custom X Offsets (comma-separated px)
                </label>
                <input
                  id="air-rel-offsets"
                  type="text"
                  value={air.release.offsets.join(', ')}
                  onChange={(e) => {
                    const nums = e.target.value
                      .split(',')
                      .map((s) => Number(s.trim()))
                      .filter((n) => Number.isFinite(n));
                    updateRelease({ offsets: nums });
                  }}
                  placeholder="-60, -30, 0, 30, 60"
                  className={inputClass}
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {!isStrafe && (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={air.release.lead}
                    onChange={(e) => updateRelease({ lead: e.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                  />
                  Ballistic Lead Solver
                </label>
              )}
              <div>
                <label htmlFor="air-jit-x" className={labelClass}>
                  Jitter X (px)
                </label>
                <NumberInput
                  id="air-jit-x"
                  min={0}
                  max={200}
                  value={air.release.jitterX}
                  onChange={numChange((jitterX) => updateRelease({ jitterX }), { min: 0 })}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="air-jit-vx" className={labelClass}>
                  Jitter Vx (×0.01)
                </label>
                <NumberInput
                  id="air-jit-vx"
                  min={0}
                  max={500}
                  value={air.release.jitterVx}
                  onChange={numChange((jitterVx) => updateRelease({ jitterVx }), { min: 0 })}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="air-jit-vy" className={labelClass}>
                  Jitter Vy (×0.01)
                </label>
                <NumberInput
                  id="air-jit-vy"
                  min={0}
                  max={500}
                  value={air.release.jitterVy}
                  onChange={numChange((jitterVy) => updateRelease({ jitterVy }), { min: 0 })}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SoundRow
                id="air-rel-sound"
                label="Release Sound"
                hint="Played on each drop/shot (optional WAV or WA sample id)."
                sound={air.release.sound}
                onChange={(sound) => updateRelease({ sound })}
              />
              <div>
                <label htmlFor="air-rel-snd-cd" className={labelClass}>
                  Release Sound Cooldown (frames)
                </label>
                <NumberInput
                  id="air-rel-snd-cd"
                  min={0}
                  max={100}
                  value={air.release.soundCooldown}
                  onChange={numChange((soundCooldown) => updateRelease({ soundCooldown }), {
                    min: 0,
                    round: true,
                  })}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: Speed & Flight Curve (only when plane flies) */}
          {hasPlane && (
            <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-3.5 dark:border-stone-700 dark:bg-stone-800/70">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                  <Gauge className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                  Speed &amp; Flight Curve
                </span>
                <span className="font-mono text-[10px] text-stone-400">
                  approach → slow → release → recover → exit
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="air-spd-cruise" className={labelClass}>
                    Cruise Speed (px/f)
                  </label>
                  <NumberInput
                    id="air-spd-cruise"
                    min={0.5}
                    max={60}
                    step={0.5}
                    value={air.speed.cruise}
                    onChange={numChange((cruise) => updateSpeed({ cruise }), { min: 0 })}
                    className={inputClass}
                  />
                </div>
                <NullableNumberField
                  id="air-spd-release"
                  label="Release Speed (px/f)"
                  hint="Target horizontal speed during slow/release. Leave blank to stay at cruise speed."
                  placeholder="cruise"
                  step={0.5}
                  min={0}
                  max={60}
                  value={air.speed.release}
                  onChange={(release) => updateSpeed({ release })}
                />
                <div>
                  <label htmlFor="air-spd-min" className={labelClass}>
                    Min Speed Floor (px/f)
                  </label>
                  <NumberInput
                    id="air-spd-min"
                    min={0}
                    max={60}
                    step={0.5}
                    value={air.speed.min}
                    onChange={numChange((min) => updateSpeed({ min }), { min: 0 })}
                    className={inputClass}
                  />
                </div>
                <NullableNumberField
                  id="air-spd-exit"
                  label="Exit Speed (px/f)"
                  hint="Target speed after recovery. Leave blank to return to cruise speed."
                  placeholder="cruise"
                  step={0.5}
                  min={0}
                  max={80}
                  value={air.speed.exit}
                  onChange={(exit) => updateSpeed({ exit })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="air-spd-slowdist" className={labelClass}>
                    Slow-In Distance (px)
                  </label>
                  <NumberInput
                    id="air-spd-slowdist"
                    min={0}
                    max={1200}
                    value={air.speed.slowDistance}
                    onChange={numChange((slowDistance) => updateSpeed({ slowDistance }), {
                      min: 0,
                    })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="air-spd-engage" className={labelClass}>
                    Engage Range (px)
                  </label>
                  <NumberInput
                    id="air-spd-engage"
                    min={0}
                    max={1200}
                    value={air.speed.engageRange}
                    onChange={numChange((engageRange) => updateSpeed({ engageRange }), { min: 0 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="air-spd-decel" className={labelClass}>
                    Linear Decel (px/f²)
                  </label>
                  <NumberInput
                    id="air-spd-decel"
                    min={0}
                    max={10}
                    step={0.05}
                    value={air.speed.decel}
                    onChange={numChange((decel) => updateSpeed({ decel }), { min: 0 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="air-spd-damp" className={labelClass}>
                    Slow Damping (×/f)
                  </label>
                  <NumberInput
                    id="air-spd-damp"
                    min={0.5}
                    max={1}
                    step={0.01}
                    value={air.speed.damping}
                    onChange={numChange((damping) => updateSpeed({ damping }), { min: 0.1, max: 1 })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="air-spd-rec-mode" className={labelClass}>
                    Recover Mode
                  </label>
                  <select
                    id="air-spd-rec-mode"
                    value={air.speed.recoverMode}
                    onChange={(e) =>
                      updateSpeed({ recoverMode: e.target.value as AirstrikeRecoverMode })
                    }
                    className={selectClass}
                  >
                    <option value="ramp">Ramp Back Up (ramp)</option>
                    <option value="snap">Snap Immediately (snap)</option>
                    <option value="hold">Hold Release Speed (hold)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="air-spd-rec-delay" className={labelClass}>
                    Recover Delay (frames)
                  </label>
                  <NumberInput
                    id="air-spd-rec-delay"
                    min={0}
                    max={200}
                    value={air.speed.recoverDelay}
                    onChange={numChange((recoverDelay) => updateSpeed({ recoverDelay }), {
                      min: 0,
                      round: true,
                    })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="air-spd-accel" className={labelClass}>
                    Recover Accel (px/f²)
                  </label>
                  <NumberInput
                    id="air-spd-accel"
                    min={0}
                    max={10}
                    step={0.05}
                    value={air.speed.accel}
                    onChange={numChange((accel) => updateSpeed({ accel }), { min: 0 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="air-spd-growth" className={labelClass}>
                    Recover Growth (×/f)
                  </label>
                  <NumberInput
                    id="air-spd-growth"
                    min={1}
                    max={2}
                    step={0.02}
                    value={air.speed.growth}
                    onChange={numChange((growth) => updateSpeed({ growth }), { min: 1 })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="air-spd-reldamp" className={labelClass}>
                    Release Damping (×/f)
                  </label>
                  <NumberInput
                    id="air-spd-reldamp"
                    min={0.5}
                    max={1}
                    step={0.01}
                    value={air.speed.releaseDamping}
                    onChange={numChange((releaseDamping) => updateSpeed({ releaseDamping }), {
                      min: 0.1,
                      max: 1,
                    })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="air-spd-alt" className={labelClass}>
                    Altitude Profile
                  </label>
                  <select
                    id="air-spd-alt"
                    value={air.speed.altitudeMode}
                    onChange={(e) => {
                      const nextMode = e.target.value as AirstrikeAltitudeMode;
                      updateSpeed({ altitudeMode: nextMode });
                      if (nextMode === 'crash_dive' && !air.plane.crashOnTerrain) {
                        updatePlane({ crashOnTerrain: true });
                      }
                    }}
                    className={selectClass}
                  >
                    <option value="level">Level Flight</option>
                    <option value="dive">Dive During Release</option>
                    <option value="climb">Climb During Release</option>
                    <option value="crash_dive">Crash Dive into Terrain (crash_dive)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="air-spd-divevy" className={labelClass}>
                    {air.speed.altitudeMode === 'crash_dive'
                      ? 'Dive Rate (0 = auto-aim target)'
                      : 'Vertical Speed (px/f)'}
                  </label>
                  <NumberInput
                    id="air-spd-divevy"
                    min={0}
                    max={25}
                    step={0.2}
                    disabled={air.speed.altitudeMode === 'level'}
                    value={air.speed.diveVy}
                    onChange={numChange((diveVy) => updateSpeed({ diveVy }), { min: 0 })}
                    className={inputClass}
                  />
                  {air.speed.altitudeMode === 'crash_dive' && air.speed.diveVy === 0 && (
                    <p className="mt-1 text-[10px] text-stone-400">
                      Auto-computes vertical slope from entry height directly into clicked target.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: Payload & Launch Kinematics */}
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-3.5 dark:border-stone-700 dark:bg-stone-800/70">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                <Package className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                Payload &amp; Launch Velocity
              </span>
              <span className="font-mono text-[10px] text-stone-400">payload</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="air-pay-kind" className={labelClass}>
                  Payload Kind
                </label>
                <select
                  id="air-pay-kind"
                  value={air.payload.kind}
                  onChange={(e) =>
                    updatePayload({ kind: e.target.value as AirstrikePayloadKind })
                  }
                  className={selectClass}
                >
                  <option value="missile">Missile / Bomb (full record + effects)</option>
                  <option value="mine">Proximity Mine (wa.mines.spawn)</option>
                  <option value="crate">Crate Drop (wa.crates.spawn)</option>
                  <option value="fire">Napalm / Fire (wa.fire.spawn)</option>
                  <option value="bullet">Hitscan Bullet (wa.weapons.fire_bullet)</option>
                  <option value="actor">Custom Actor (wa.actors.spawn)</option>
                </select>
              </div>

              {isMissilePayload && (
                <div className="sm:col-span-2">
                  <label htmlFor="air-pay-donor" className={labelClass}>
                    Projectile Base Donor (projectile.copy_from)
                  </label>
                  <select
                    id="air-pay-donor"
                    value={air.payload.projectileDonor}
                    onChange={(e) => updatePayload({ projectileDonor: e.target.value })}
                    className={selectClass}
                  >
                    {PROJECTILE_DONORS.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} (stock.{w.id})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label htmlFor="air-pay-inherit" className={labelClass}>
                  Inherit Plane Vx
                </label>
                <NumberInput
                  id="air-pay-inherit"
                  min={-2}
                  max={3}
                  step={0.05}
                  value={air.payload.inheritVx}
                  onChange={numChange((inheritVx) => updatePayload({ inheritVx }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="air-pay-vx" className={labelClass}>
                  Added Vx (px/f)
                </label>
                <NumberInput
                  id="air-pay-vx"
                  min={-40}
                  max={40}
                  step={0.5}
                  value={air.payload.vx}
                  onChange={numChange((vx) => updatePayload({ vx }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="air-pay-vy" className={labelClass}>
                  Added Vy (px/f)
                </label>
                <NumberInput
                  id="air-pay-vy"
                  min={-40}
                  max={40}
                  step={0.5}
                  value={air.payload.vy}
                  onChange={numChange((vy) => updatePayload({ vy }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="air-pay-svx" className={labelClass}>
                  Fan Spread Vx
                </label>
                <NumberInput
                  id="air-pay-svx"
                  min={-10}
                  max={10}
                  step={0.1}
                  value={air.payload.spreadVx}
                  onChange={numChange((spreadVx) => updatePayload({ spreadVx }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="air-pay-svy" className={labelClass}>
                  Fan Spread Vy
                </label>
                <NumberInput
                  id="air-pay-svy"
                  min={-10}
                  max={10}
                  step={0.1}
                  value={air.payload.spreadVy}
                  onChange={numChange((spreadVy) => updatePayload({ spreadVy }))}
                  className={inputClass}
                />
              </div>
            </div>

            {isMissilePayload && (
              <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-600 dark:border-stone-700 dark:bg-stone-950/40 dark:text-stone-400">
                Missile payloads emit a <span className="font-mono">projectile = {'{ ... }'}</span>{' '}
                sub-table on the claim. Edit bomb physics, bounce/homing/roam/dig actions, cluster
                bursts, custom flight art, ribbon trails, and explosion bursts in the other tabs.
              </p>
            )}

            {air.payload.kind === 'mine' && (
              <div className="grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2 lg:grid-cols-5 dark:border-stone-700">
                <div>
                  <label className={labelClass}>Fuse (ms)</label>
                  <NumberInput
                    min={0}
                    max={10000}
                    step={100}
                    value={air.payload.mine.fuse}
                    onChange={numChange(
                      (fuse) => updatePayload({ mine: { ...air.payload.mine, fuse } }),
                      { min: 0, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Arm Delay (ms)</label>
                  <NumberInput
                    min={0}
                    max={10000}
                    step={100}
                    value={air.payload.mine.arm}
                    onChange={numChange(
                      (arm) => updatePayload({ mine: { ...air.payload.mine, arm } }),
                      { min: 0, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Damage</label>
                  <NumberInput
                    min={0}
                    max={300}
                    value={air.payload.mine.damage}
                    onChange={numChange(
                      (damage) => updatePayload({ mine: { ...air.payload.mine, damage } }),
                      { min: 0, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Blast Radius</label>
                  <NumberInput
                    min={0}
                    max={300}
                    value={air.payload.mine.radius}
                    onChange={numChange(
                      (radius) => updatePayload({ mine: { ...air.payload.mine, radius } }),
                      { min: 0, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={air.payload.mine.dudProof}
                    onChange={(e) =>
                      updatePayload({ mine: { ...air.payload.mine, dudProof: e.target.checked } })
                    }
                    className="h-3.5 w-3.5 rounded text-forge-600"
                  />
                  Dud-proof
                </label>
              </div>
            )}

            {air.payload.kind === 'crate' && (
              <div className="grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-stone-700">
                <div>
                  <label className={labelClass}>Crate Kind</label>
                  <select
                    value={air.payload.crate.kind}
                    onChange={(e) =>
                      updatePayload({
                        crate: {
                          ...air.payload.crate,
                          kind: e.target.value as 'weapon' | 'utility' | 'health',
                        },
                      })
                    }
                    className={selectClass}
                  >
                    <option value="weapon">Weapon Crate</option>
                    <option value="utility">Utility Crate</option>
                    <option value="health">Health Crate</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Descent</label>
                  <select
                    value={air.payload.crate.drop}
                    onChange={(e) =>
                      updatePayload({
                        crate: {
                          ...air.payload.crate,
                          drop: e.target.value as 'chute' | 'fall',
                        },
                      })
                    }
                    className={selectClass}
                  >
                    <option value="chute">Parachute (chute)</option>
                    <option value="fall">Free Fall (fall)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Health / Value</label>
                  <NumberInput
                    min={1}
                    max={250}
                    value={air.payload.crate.health}
                    onChange={numChange(
                      (health) => updatePayload({ crate: { ...air.payload.crate, health } }),
                      { min: 1, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Contents (optional)</label>
                  <input
                    type="text"
                    value={air.payload.crate.contents}
                    placeholder="e.g. stock.banana"
                    onChange={(e) =>
                      updatePayload({ crate: { ...air.payload.crate, contents: e.target.value } })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {air.payload.kind === 'fire' && (
              <div className="grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2 lg:grid-cols-4 dark:border-stone-700">
                <div>
                  <label className={labelClass}>Flamelets per Drop</label>
                  <NumberInput
                    min={1}
                    max={40}
                    value={air.payload.fire.count}
                    onChange={numChange(
                      (count) => updatePayload({ fire: { ...air.payload.fire, count } }),
                      { min: 1, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Burn Duration (ms)</label>
                  <NumberInput
                    min={100}
                    max={30000}
                    step={250}
                    value={air.payload.fire.duration}
                    onChange={numChange(
                      (duration) => updatePayload({ fire: { ...air.payload.fire, duration } }),
                      { min: 100, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Up Power</label>
                  <NumberInput
                    min={0}
                    max={300}
                    value={air.payload.fire.upPower}
                    onChange={numChange(
                      (upPower) => updatePayload({ fire: { ...air.payload.fire, upPower } }),
                      { min: 0, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Damage</label>
                  <NumberInput
                    min={0}
                    max={150}
                    value={air.payload.fire.damage}
                    onChange={numChange(
                      (damage) => updatePayload({ fire: { ...air.payload.fire, damage } }),
                      { min: 0, round: true },
                    )}
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {air.payload.kind === 'bullet' && (
              <div className="grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-3 dark:border-stone-700">
                <div>
                  <label className={labelClass}>Bullet Profile</label>
                  <select
                    value={air.payload.bullet.weapon}
                    onChange={(e) =>
                      updatePayload({ bullet: { ...air.payload.bullet, weapon: e.target.value } })
                    }
                    className={selectClass}
                  >
                    <option value="stock.handgun">Handgun (stock.handgun)</option>
                    <option value="stock.shotgun">Shotgun (stock.shotgun)</option>
                    <option value="stock.uzi">Uzi (stock.uzi)</option>
                    <option value="stock.minigun">Minigun (stock.minigun)</option>
                  </select>
                </div>
                <NullableNumberField
                  id="air-bul-dmg"
                  label="Damage Override"
                  hint="Leave blank to use stock bullet damage."
                  placeholder="stock"
                  min={0}
                  max={250}
                  value={air.payload.bullet.damage}
                  onChange={(damage) => updatePayload({ bullet: { ...air.payload.bullet, damage } })}
                />
                <NullableNumberField
                  id="air-bul-push"
                  label="Push % Override"
                  hint="Leave blank to use stock bullet knockback."
                  placeholder="stock"
                  min={0}
                  max={500}
                  value={air.payload.bullet.pushPct}
                  onChange={(pushPct) =>
                    updatePayload({ bullet: { ...air.payload.bullet, pushPct } })
                  }
                />
              </div>
            )}
          </div>

          {/* SECTION 5: Strafe Mode Settings (only when release.mode === 'strafe') */}
          {isStrafe && (
            <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-3.5 dark:border-stone-700 dark:bg-stone-800/70">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                  <Crosshair className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                  Strafe Aim, Trails &amp; Casings
                </span>
                <span className="font-mono text-[10px] text-stone-400">strafe</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelClass}>Aim Mode</label>
                  <select
                    value={air.strafe.aimMode}
                    onChange={(e) =>
                      updateStrafe({ aimMode: e.target.value as 'target' | 'fixed' })
                    }
                    className={selectClass}
                  >
                    <option value="target">Track Target (target)</option>
                    <option value="fixed">Fixed Angle (fixed)</option>
                  </select>
                </div>
                {air.strafe.aimMode === 'fixed' ? (
                  <div>
                    <label className={labelClass}>Fixed Angle (deg)</label>
                    <NumberInput
                      min={-90}
                      max={180}
                      value={air.strafe.fixedAngleDeg}
                      onChange={numChange((fixedAngleDeg) => updateStrafe({ fixedAngleDeg }))}
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <div>
                    <label className={labelClass}>Aim Turn Smoothing (0..1)</label>
                    <NumberInput
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={air.strafe.aimTurn}
                      onChange={numChange((aimTurn) => updateStrafe({ aimTurn }), {
                        min: 0.05,
                        max: 1,
                      })}
                      className={inputClass}
                    />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Round Speed (px/f)</label>
                  <NumberInput
                    min={1}
                    max={120}
                    value={air.strafe.bulletSpeed}
                    onChange={numChange((bulletSpeed) => updateStrafe({ bulletSpeed }), { min: 1 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Steer Frames</label>
                  <NumberInput
                    min={0}
                    max={20}
                    value={air.strafe.steerFrames}
                    onChange={numChange((steerFrames) => updateStrafe({ steerFrames }), {
                      min: 0,
                      round: true,
                    })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelClass}>Muzzle Offset X</label>
                  <NumberInput
                    min={-150}
                    max={150}
                    value={air.strafe.muzzleX}
                    onChange={numChange((muzzleX) => updateStrafe({ muzzleX }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Muzzle Offset Y</label>
                  <NumberInput
                    min={-150}
                    max={150}
                    value={air.strafe.muzzleY}
                    onChange={numChange((muzzleY) => updateStrafe({ muzzleY }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Barrel Length (px)</label>
                  <NumberInput
                    min={0}
                    max={150}
                    value={air.strafe.muzzleLength}
                    onChange={numChange((muzzleLength) => updateStrafe({ muzzleLength }), {
                      min: 0,
                    })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Max Fuse (ms)</label>
                  <NumberInput
                    min={0}
                    max={15000}
                    step={200}
                    value={air.strafe.maxFuseMs}
                    onChange={numChange((maxFuseMs) => updateStrafe({ maxFuseMs }), {
                      min: 0,
                      round: true,
                    })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={air.strafe.targetSeek}
                    onChange={(e) => updateStrafe({ targetSeek: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600"
                  />
                  Auto-seek worms in target box
                </label>

                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={air.strafe.trailEnabled}
                    onChange={(e) => updateStrafe({ trailEnabled: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600"
                  />
                  Tracer Ribbon Trail (effects.sdk)
                </label>

                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={air.strafe.casingEnabled}
                    onChange={(e) => updateStrafe({ casingEnabled: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600"
                  />
                  Eject Shell Casings
                </label>
              </div>

              {air.strafe.trailEnabled && (
                <div className="grid gap-3 rounded-lg border border-sky-200/70 bg-sky-50/40 p-2.5 sm:grid-cols-4 dark:border-sky-800/50 dark:bg-sky-950/20">
                  <div>
                    <label className={labelClass}>Tracer Color</label>
                    <input
                      type="color"
                      value={air.strafe.trailColor}
                      onChange={(e) => updateStrafe({ trailColor: e.target.value })}
                      className="h-8 w-full cursor-pointer rounded border border-stone-300 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Samples (max)</label>
                    <NumberInput
                      min={2}
                      max={32}
                      value={air.strafe.trailMax}
                      onChange={numChange((trailMax) => updateStrafe({ trailMax }), {
                        min: 2,
                        round: true,
                      })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Core Width</label>
                    <NumberInput
                      min={1}
                      max={30}
                      value={air.strafe.trailCoreWidth}
                      onChange={numChange((trailCoreWidth) => updateStrafe({ trailCoreWidth }), {
                        min: 1,
                      })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Glow Width</label>
                    <NumberInput
                      min={1}
                      max={40}
                      value={air.strafe.trailGlowWidth}
                      onChange={numChange((trailGlowWidth) => updateStrafe({ trailGlowWidth }), {
                        min: 1,
                      })}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {air.strafe.casingEnabled && (
                <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/50 p-2.5 dark:border-stone-700 dark:bg-stone-950/30">
                  <SheetUploadRow
                    id="air-casing-sheet"
                    label="Shell Casing Sheet"
                    asset={air.strafe.casingSheet}
                    onPick={(casingSheet) => updateStrafe({ casingSheet })}
                    onRemove={() => updateStrafe({ casingSheet: undefined })}
                  />
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <div>
                      <label className={labelClass}>Casing Frames</label>
                      <NumberInput
                        min={1}
                        max={64}
                        value={air.strafe.casingFrames}
                        onChange={numChange((casingFrames) => updateStrafe({ casingFrames }), {
                          min: 1,
                          round: true,
                        })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Draw Half-Size (px)</label>
                      <NumberInput
                        min={2}
                        max={64}
                        value={air.strafe.casingHalf}
                        onChange={numChange((casingHalf) => updateStrafe({ casingHalf }), {
                          min: 2,
                        })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Lifetime (frames)</label>
                      <NumberInput
                        min={10}
                        max={300}
                        value={air.strafe.casingLife}
                        onChange={numChange((casingLife) => updateStrafe({ casingLife }), {
                          min: 10,
                          round: true,
                        })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={air.strafe.artEnabled}
                    onChange={(e) => updateStrafe({ artEnabled: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600"
                  />
                  Draw custom GPU strafe bullet sheet
                </label>
                {air.strafe.artEnabled && (
                  <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/50 p-2.5 dark:border-stone-700 dark:bg-stone-950/30">
                    <SheetUploadRow
                      id="air-strafe-art"
                      label="Strafe Bullet Sheet"
                      asset={air.strafe.artSheet}
                      onPick={(artSheet) => updateStrafe({ artSheet })}
                      onRemove={() => updateStrafe({ artSheet: undefined })}
                    />
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Half-Size (px)</label>
                        <NumberInput
                          min={2}
                          max={64}
                          value={air.strafe.artHalf}
                          onChange={numChange((artHalf) => updateStrafe({ artHalf }), { min: 2 })}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Frames</label>
                        <NumberInput
                          min={1}
                          max={64}
                          value={air.strafe.artFrames}
                          onChange={numChange((artFrames) => updateStrafe({ artFrames }), {
                            min: 1,
                            round: true,
                          })}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 6: Aircraft Art, Banking, Crash & Audio (collapsible when plane flies) */}
          {hasPlane && (
            <details
              open
              className="group rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800/70"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-stone-800 dark:text-stone-200">
                <span className="flex items-center gap-1.5">
                  <Plane className="h-3.5 w-3.5 text-forge-500" aria-hidden="true" />
                  Aircraft Art, Banking, Crash &amp; Audio
                </span>
                <ChevronDown
                  className="h-4 w-4 text-stone-400 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>

              <div className="space-y-4 border-t border-stone-200 px-3.5 py-3.5 dark:border-stone-700">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className={labelClass}>Aircraft Sprite Source</label>
                    <select
                      value={air.plane.spriteMode}
                      onChange={(e) =>
                        updatePlane({ spriteMode: e.target.value as 'stock' | 'custom' })
                      }
                      className={selectClass}
                    >
                      <option value="stock">Stock WA Sprite</option>
                      <option value="custom">Custom PNG Sheet</option>
                    </select>
                  </div>

                  {air.plane.spriteMode === 'stock' ? (
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Stock Carrier</label>
                      <select
                        value={air.plane.stockSprite}
                        onChange={(e) => updatePlane({ stockSprite: e.target.value })}
                        className={selectClass}
                      >
                        {STOCK_PLANE_SPRITES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="sm:col-span-3">
                      <SheetUploadRow
                        id="air-plane-sheet"
                        label="Aircraft Sheet"
                        asset={air.plane.sheet}
                        onPick={(sheet) => updatePlane({ sheet })}
                        onRemove={() => updatePlane({ sheet: undefined })}
                      />
                    </div>
                  )}

                  {air.plane.spriteMode === 'stock' && (
                    <div>
                      <label className={labelClass}>Scale</label>
                      <NumberInput
                        min={0.25}
                        max={4}
                        step={0.1}
                        value={air.plane.scale}
                        onChange={numChange((scale) => updatePlane({ scale }), { min: 0.1 })}
                        className={inputClass}
                      />
                    </div>
                  )}
                </div>

                {air.plane.spriteMode === 'custom' && (
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <label className={labelClass}>Frames</label>
                      <NumberInput
                        min={1}
                        max={64}
                        value={air.plane.frames}
                        onChange={numChange((frames) => updatePlane({ frames }), {
                          min: 1,
                          round: true,
                        })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>FPS</label>
                      <NumberInput
                        min={0}
                        max={50}
                        value={air.plane.fps}
                        onChange={numChange((fps) => updatePlane({ fps }), { min: 0 })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Play Mode</label>
                      <select
                        value={air.plane.play}
                        onChange={(e) =>
                          updatePlane({ play: e.target.value as AirstrikePlayMode })
                        }
                        className={selectClass}
                      >
                        <option value="loop">Loop</option>
                        <option value="pingpong">Ping-Pong</option>
                        <option value="once">Play Once</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Scale</label>
                      <NumberInput
                        min={0.25}
                        max={4}
                        step={0.1}
                        value={air.plane.scale}
                        onChange={numChange((scale) => updatePlane({ scale }), { min: 0.1 })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className={labelClass}>Bank Angle — Approach (°)</label>
                    <NumberInput
                      min={-45}
                      max={45}
                      value={air.plane.bankAngleApproach}
                      onChange={numChange((bankAngleApproach) =>
                        updatePlane({ bankAngleApproach }),
                      )}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Bank Angle — Release (°)</label>
                    <NumberInput
                      min={-45}
                      max={45}
                      value={air.plane.bankAngleRelease}
                      onChange={numChange((bankAngleRelease) => updatePlane({ bankAngleRelease }))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Bank Rate (°/frame)</label>
                    <NumberInput
                      min={0}
                      max={20}
                      step={0.1}
                      value={air.plane.bankRate}
                      onChange={numChange((bankRate) => updatePlane({ bankRate }), { min: 0 })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Exit Fade-Out (frames)</label>
                    <NumberInput
                      min={0}
                      max={150}
                      value={air.plane.fadeOutFrames}
                      onChange={numChange((fadeOutFrames) => updatePlane({ fadeOutFrames }), {
                        min: 0,
                        round: true,
                      })}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelClass}>Exit Margin (px)</label>
                    <NumberInput
                      min={0}
                      max={600}
                      value={air.plane.exitMargin}
                      onChange={numChange((exitMargin) => updatePlane({ exitMargin }), {
                        min: 0,
                        round: true,
                      })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Hard Timeout (frames)</label>
                    <NumberInput
                      min={50}
                      max={3000}
                      value={air.plane.timeoutFrames}
                      onChange={numChange((timeoutFrames) => updatePlane({ timeoutFrames }), {
                        min: 50,
                        round: true,
                      })}
                      className={inputClass}
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
                    <input
                      type="checkbox"
                      checked={air.plane.facingFlip}
                      onChange={(e) => updatePlane({ facingFlip: e.target.checked })}
                      className="h-3.5 w-3.5 rounded text-forge-600"
                    />
                    Flip sprite horizontally (facing_flip)
                  </label>
                </div>

                {/* Hull, Terrain Crash & Explosion Parameters */}
                <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50/50 p-3 dark:border-stone-700 dark:bg-stone-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-200">
                      <Flame className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
                      Hull, Terrain Crash &amp; Explosion
                    </span>
                    <span className="font-mono text-[10px] text-stone-400">
                      crash_on_terrain / boom_*
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                      <input
                        type="checkbox"
                        checked={air.plane.crashOnTerrain}
                        onChange={(e) => updatePlane({ crashOnTerrain: e.target.checked })}
                        className="h-3.5 w-3.5 rounded text-forge-600"
                      />
                      Crash on Terrain (explodes on solid land contact)
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                      <input
                        type="checkbox"
                        checked={air.plane.crashOnWater}
                        onChange={(e) => updatePlane({ crashOnWater: e.target.checked })}
                        className="h-3.5 w-3.5 rounded text-forge-600"
                      />
                      Crash on Water
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                      <input
                        type="checkbox"
                        checked={air.plane.collide}
                        onChange={(e) =>
                          updatePlane({
                            collide: e.target.checked,
                            asObject: e.target.checked ? true : air.plane.asObject,
                          })
                        }
                        className="h-3.5 w-3.5 rounded text-forge-600"
                      />
                      Shootable Hull (can be shot down)
                    </label>
                  </div>

                  {air.plane.collide && (
                    <div className="grid gap-3 border-t border-stone-200/80 pt-2.5 sm:grid-cols-2 dark:border-stone-800">
                      <div>
                        <label className={labelClass}>Hull HP (0 = threshold)</label>
                        <NumberInput
                          min={0}
                          max={500}
                          value={air.plane.hp}
                          onChange={numChange((hp) => updatePlane({ hp }), { min: 0, round: true })}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>One-Hit Threshold (dead_damage)</label>
                        <NumberInput
                          min={0}
                          max={300}
                          value={air.plane.deadDamage}
                          onChange={numChange((deadDamage) => updatePlane({ deadDamage }), {
                            min: 0,
                            round: true,
                          })}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  )}

                  {(air.plane.collide || air.plane.crashOnTerrain) && (
                    <div className="space-y-3 border-t border-stone-200/80 pt-3 dark:border-stone-800">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label htmlFor="air-boom-mode" className={labelClass}>
                            Crash Explosion Mode
                          </label>
                          <select
                            id="air-boom-mode"
                            value={air.plane.boomMode}
                            onChange={(e) =>
                              updatePlane({ boomMode: e.target.value as AirstrikeBoomMode })
                            }
                            className={selectClass}
                          >
                            <option value="native">WA Native Explosion (hull:explode)</option>
                            <option value="custom">Custom Radial Blast (wa.world.blast)</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="air-boom-dmg" className={labelClass}>
                            Crash Damage
                          </label>
                          <NumberInput
                            id="air-boom-dmg"
                            min={0}
                            max={1000}
                            value={air.plane.boomDamage}
                            onChange={numChange((boomDamage) => updatePlane({ boomDamage }), {
                              min: 0,
                              max: 1000,
                              round: true,
                            })}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label htmlFor="air-boom-fires" className={labelClass}>
                            Crash Fires (0..3)
                          </label>
                          <NumberInput
                            id="air-boom-fires"
                            min={0}
                            max={3}
                            value={air.plane.boomFires}
                            onChange={numChange((boomFires) => updatePlane({ boomFires }), {
                              min: 0,
                              max: 3,
                              round: true,
                            })}
                            className={inputClass}
                          />
                        </div>
                      </div>

                      {air.plane.boomMode === 'custom' && (
                        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                          <div>
                            <label htmlFor="air-boom-rad" className={labelClass}>
                              Blast Radius (px)
                            </label>
                            <NumberInput
                              id="air-boom-rad"
                              min={1}
                              max={512}
                              value={air.plane.boomRadius}
                              onChange={numChange((boomRadius) => updatePlane({ boomRadius }), {
                                min: 1,
                                max: 512,
                                round: true,
                              })}
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <label htmlFor="air-boom-push" className={labelClass}>
                              Push / Knockback (%)
                            </label>
                            <NumberInput
                              id="air-boom-push"
                              min={0}
                              max={1000}
                              value={air.plane.boomPushPct}
                              onChange={numChange((boomPushPct) => updatePlane({ boomPushPct }), {
                                min: 0,
                                max: 1000,
                                round: true,
                              })}
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <label htmlFor="air-boom-crater" className={labelClass}>
                              Crater Radius (px)
                            </label>
                            <NumberInput
                              id="air-boom-crater"
                              min={0}
                              max={200}
                              value={air.plane.boomCraterRadius}
                              onChange={numChange(
                                (boomCraterRadius) => updatePlane({ boomCraterRadius }),
                                { min: 0, max: 200, round: true },
                              )}
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <label htmlFor="air-boom-hitkind" className={labelClass}>
                              Damage Kind
                            </label>
                            <select
                              id="air-boom-hitkind"
                              value={air.plane.boomHitKind}
                              onChange={(e) =>
                                updatePlane({
                                  boomHitKind: e.target.value as AirstrikeBoomHitKind,
                                })
                              }
                              className={selectClass}
                            >
                              <option value="blast">Standard Blast</option>
                              <option value="taze">Electric Taze (px.electric)</option>
                              <option value="fire">Fire Blast</option>
                              <option value="kamikaze">Kamikaze</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor="air-boom-visual" className={labelClass}>
                              Blast Visual
                            </label>
                            <select
                              id="air-boom-visual"
                              value={air.plane.boomVisual}
                              onChange={(e) =>
                                updatePlane({
                                  boomVisual: e.target.value as AirstrikeBoomVisual,
                                })
                              }
                              className={selectClass}
                            >
                              <option value="native">WA Native Explosion</option>
                              <option value="fx">PX Effects Burst</option>
                              <option value="both">Both (Native + FX)</option>
                              <option value="none">None (Blast Only)</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {air.plane.boomMode === 'custom' && air.plane.boomHitKind === 'taze' && (
                        <label
                          title="Electrify nearby mines into electric mines instead of detonating them when the aircraft strikes with taze damage (wf-lib/electric/taze_mine)."
                          className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300"
                        >
                          <input
                            type="checkbox"
                            checked={!!project.electricTazeMines}
                            onChange={(e) => onChange({ electricTazeMines: e.target.checked })}
                            className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                          />
                          <span>Taze Mines Instead of Detonating (px.electric)</span>
                        </label>
                      )}

                      {(air.plane.boomMode === 'native' ||
                        air.plane.boomVisual === 'native' ||
                        air.plane.boomVisual === 'both') && (
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <label htmlFor="air-boom-kind" className={labelClass}>
                              WA Explosion Style ID (0..5)
                            </label>
                            <NumberInput
                              id="air-boom-kind"
                              min={0}
                              max={5}
                              value={air.plane.boomKind}
                              onChange={numChange((boomKind) => updatePlane({ boomKind }), {
                                min: 0,
                                max: 5,
                                round: true,
                              })}
                              className={inputClass}
                            />
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                            <input
                              type="checkbox"
                              checked={air.plane.boomBelow}
                              onChange={(e) => updatePlane({ boomBelow: e.target.checked })}
                              className="h-3.5 w-3.5 rounded text-forge-600"
                            />
                            Draw Behind Terrain (below)
                          </label>
                          {air.plane.boomMode === 'native' && (
                            <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                              <input
                                type="checkbox"
                                checked={air.plane.boomFxBurst.enabled}
                                onChange={(e) =>
                                  updatePlane({
                                    boomFxBurst: {
                                      ...air.plane.boomFxBurst,
                                      enabled: e.target.checked,
                                    },
                                  })
                                }
                                className="h-3.5 w-3.5 rounded text-forge-600"
                              />
                              Add PX Effects Burst
                            </label>
                          )}
                        </div>
                      )}

                      {((air.plane.boomMode === 'custom' &&
                        (air.plane.boomVisual === 'fx' || air.plane.boomVisual === 'both')) ||
                        (air.plane.boomMode === 'native' && air.plane.boomFxBurst.enabled)) && (
                        <div className="grid gap-3 rounded-lg border border-orange-200/70 bg-orange-50/40 p-2.5 sm:grid-cols-3 dark:border-orange-900/50 dark:bg-orange-950/20">
                          <div>
                            <label htmlFor="air-boom-fx-color" className={labelClass}>
                              FX Burst Color
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                id="air-boom-fx-color"
                                type="color"
                                value={air.plane.boomFxBurst.color}
                                onChange={(e) =>
                                  updatePlane({
                                    boomFxBurst: {
                                      ...air.plane.boomFxBurst,
                                      color: e.target.value,
                                    },
                                  })
                                }
                                className="h-7 w-10 cursor-pointer rounded border border-stone-300 bg-transparent p-0.5 dark:border-stone-600"
                              />
                              <span className="font-mono text-xs text-stone-600 dark:text-stone-300">
                                {air.plane.boomFxBurst.color}
                              </span>
                            </div>
                          </div>
                          <div>
                            <label htmlFor="air-boom-fx-rad" className={labelClass}>
                              FX Burst Radius (px)
                            </label>
                            <NumberInput
                              id="air-boom-fx-rad"
                              min={8}
                              max={256}
                              value={air.plane.boomFxBurst.radius}
                              onChange={numChange(
                                (radius) =>
                                  updatePlane({
                                    boomFxBurst: { ...air.plane.boomFxBurst, radius },
                                  }),
                                { min: 8, max: 256, round: true },
                              )}
                              className={inputClass}
                            />
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                            <input
                              type="checkbox"
                              checked={air.plane.boomFxBurst.smoke}
                              onChange={(e) =>
                                updatePlane({
                                  boomFxBurst: {
                                    ...air.plane.boomFxBurst,
                                    smoke: e.target.checked,
                                  },
                                })
                              }
                              className="h-3.5 w-3.5 rounded text-forge-600"
                            />
                            Include Smoke Plume
                          </label>
                        </div>
                      )}

                      <SoundRow
                        id="air-snd-boom"
                        label="Crash Explosion Sound"
                        hint="Optional sound played on aircraft crash/destruction (leave None for WA default)."
                        sound={air.plane.boomSound}
                        onChange={(boomSound) => updatePlane({ boomSound })}
                      />
                    </div>
                  )}
                </div>

                {/* Plane Emitter (fx.emitter) quick toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200/80 bg-sky-50/40 px-3 py-2.5 dark:border-sky-900/50 dark:bg-sky-950/20">
                  <div className="space-y-0.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-800 dark:text-stone-200">
                      <input
                        type="checkbox"
                        checked={!!project.emitter?.enabled && project.emitter.anchor === 'plane'}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const prev = project.emitter ?? DEFAULT_EMITTER;
                          onChange({
                            emitter: {
                              ...DEFAULT_EMITTER,
                              ...prev,
                              enabled: checked,
                              anchor: checked
                                ? 'plane'
                                : prev.anchor === 'plane'
                                  ? 'muzzle'
                                  : prev.anchor,
                            },
                          });
                        }}
                        className="h-3.5 w-3.5 rounded text-forge-600"
                      />
                      <Orbit className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                      Attach FX Emitter to Flying Aircraft (fx.emitter)
                    </label>
                    <p className="pl-5 text-[11px] text-stone-500 dark:text-stone-400">
                      Rides the aircraft hull with facing-mirrored offsets and cleans up on exit or crash. Tune bolts, rings, ribbons, and offsets in{' '}
                      <span className="font-semibold text-stone-700 dark:text-stone-300">
                        Effects &amp; Libraries → Emitter
                      </span>
                      .
                    </p>
                  </div>
                  {project.emitter?.enabled && project.emitter.anchor === 'plane' && (
                    <span className="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                      {project.emitter.planeAlsoRound ? 'Plane + Payload' : 'Plane Only'}
                    </span>
                  )}
                </div>

                {/* Aircraft Sounds */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <SoundRow
                    id="air-snd-enter"
                    label="Enter Sound"
                    hint="Played once when the aircraft enters the map."
                    sound={air.plane.soundEnter}
                    onChange={(soundEnter) => updatePlane({ soundEnter })}
                  />
                  <div className="space-y-2">
                    <SoundRow
                      id="air-snd-loop"
                      label="Engine Loop Sound"
                      hint="Replayed every N ticks while flying."
                      sound={air.plane.soundLoop}
                      onChange={(soundLoop) => updatePlane({ soundLoop })}
                    />
                    <div className="flex items-center gap-2 px-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                        Loop Period (ticks)
                      </label>
                      <NumberInput
                        min={1}
                        max={300}
                        value={air.plane.soundLoopTicks}
                        onChange={numChange((soundLoopTicks) => updatePlane({ soundLoopTicks }), {
                          min: 1,
                          round: true,
                        })}
                        className="w-20 rounded border border-stone-200 bg-white px-2 py-0.5 font-mono text-[11px] dark:border-stone-700 dark:bg-stone-900"
                      />
                    </div>
                  </div>
                  <SoundRow
                    id="air-snd-exit"
                    label="Exit Sound"
                    hint="Played when the aircraft accelerates into exit."
                    sound={air.plane.soundExit}
                    onChange={(soundExit) => updatePlane({ soundExit })}
                  />
                </div>

                {/* Multi-Part Child Actors (rotors, turrets, engine glow) */}
                <div className="space-y-2 border-t border-stone-200 pt-3 dark:border-stone-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                      Attached Vehicle Parts (rotors, turrets, glow)
                    </span>
                    <button
                      type="button"
                      onClick={addPlanePart}
                      className="inline-flex items-center gap-1 rounded-lg border border-forge-300 bg-forge-50 px-2 py-1 text-[11px] font-semibold text-forge-700 hover:bg-forge-100 dark:border-forge-700 dark:bg-forge-950/50 dark:text-forge-300"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                      Add Part
                    </button>
                  </div>

                  {air.plane.parts.length > 0 && (
                    <div className="space-y-2">
                      {air.plane.parts.map((part, idx) => (
                        <div
                          key={part.id}
                          className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/70 p-2.5 dark:border-stone-700 dark:bg-stone-950/40"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <input
                              type="text"
                              value={part.label}
                              onChange={(e) => patchPart(idx, { label: e.target.value })}
                              className="w-40 rounded border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                            />
                            <button
                              type="button"
                              onClick={() => removePart(idx)}
                              aria-label={`Remove ${part.label}`}
                              className="rounded p-1 text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                          <SheetUploadRow
                            id={`air-part-${idx}`}
                            label={`${part.label} Sheet`}
                            asset={part.sheet}
                            onPick={(sheet) => patchPart(idx, { sheet, spriteMode: 'custom' })}
                            onRemove={() => patchPart(idx, { sheet: undefined })}
                          />
                          <div className="grid gap-2 sm:grid-cols-5">
                            <div>
                              <label className="block text-[10px] font-semibold text-stone-500">
                                Offset X
                              </label>
                              <NumberInput
                                value={part.ox}
                                onChange={numChange((ox) => patchPart(idx, { ox }))}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-stone-500">
                                Offset Y
                              </label>
                              <NumberInput
                                value={part.oy}
                                onChange={numChange((oy) => patchPart(idx, { oy }))}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-stone-500">
                                Frames
                              </label>
                              <NumberInput
                                min={1}
                                max={64}
                                value={part.frames}
                                onChange={numChange((frames) => patchPart(idx, { frames }), {
                                  min: 1,
                                  round: true,
                                })}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-stone-500">
                                FPS
                              </label>
                              <NumberInput
                                min={0}
                                max={50}
                                value={part.fps}
                                onChange={numChange((fps) => patchPart(idx, { fps }), { min: 0 })}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-stone-500">
                                Depth Off
                              </label>
                              <NumberInput
                                min={-10}
                                max={10}
                                value={part.depthOffset}
                                onChange={numChange((depthOffset) =>
                                  patchPart(idx, { depthOffset }),
                                { round: true })}
                                className={inputClass}
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-3 text-[11px] text-stone-600 dark:text-stone-400">
                            <label className="flex cursor-pointer items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={part.trackGun}
                                onChange={(e) => patchPart(idx, { trackGun: e.target.checked })}
                                className="rounded text-forge-600"
                              />
                              Track gun aim
                            </label>
                            <label className="flex cursor-pointer items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={part.aimSync}
                                onChange={(e) => patchPart(idx, { aimSync: e.target.checked })}
                                className="rounded text-forge-600"
                              />
                              Aim-synced frames
                            </label>
                            <label className="flex cursor-pointer items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={part.firingFrames}
                                onChange={(e) => patchPart(idx, { firingFrames: e.target.checked })}
                                className="rounded text-forge-600"
                              />
                              Muzzle flash frame
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
};

export default AirstrikeCard;
