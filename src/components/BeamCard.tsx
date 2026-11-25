import React, { useRef, useState } from 'react';
import type {
  AirstrikeSoundSpec,
  BeamArtStyle,
  BeamConfig,
  BeamCutShape,
  BeamDepthBand,
  BeamFadeMode,
  BeamFireConfig,
  BeamGrowEase,
  BeamHitKind,
  BeamHurtMode,
  BeamLookKind,
  BeamPathKind,
  ExplosionEffectConfig,
  FireSequenceConfig,
  WeaponProject,
} from '../types/weapon';
import {
  BEAM_ART_STYLES,
  BEAM_HIT_KINDS,
  BEAM_PRESETS,
  DEFAULT_BEAM,
  DEFAULT_BEAM_FIRE,
  mergeBeamConfig,
} from '../data/beam';
import { DEFAULT_EXPLOSION_EFFECT } from '../data/explosionPresets';
import type { RecordTabId } from '../data/recordTabs';
import {
  computeBeamSequenceSchedule,
  DEFAULT_FIRE_SEQUENCE,
  mergeFireSequenceConfig,
} from '../data/fireSequence';
import { FIRE_SUBTYPES, fireSubtypeLabel } from '../data/fireSubtypes';
import { recordField } from '../utils/recordField';
import { BeamPreview } from './BeamPreview';
import {
  SectionHeader,
  SubSectionTitle,
  TooltipLabel,
  UnitNumberInput,
} from './RecordEditor';
import { NumberInput } from './NumberInput';
import { PoisonDoseField } from './PoisonDoseField';
import { SpritePickButton } from './SpritePickButton';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Crosshair,
  Flame,
  Layers,
  ListOrdered,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Zap,
} from 'lucide-react';

interface BeamCardProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
  onOpenHoldBuilder?: () => void;
  onOpenTab?: (tab: RecordTabId) => void;
}

const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

const fieldInput =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

const cardBox =
  'rounded-xl border border-stone-200/90 bg-white p-4 space-y-3.5 dark:border-stone-800 dark:bg-stone-900/70';

const CollapsibleCard: React.FC<{
  title: string;
  code?: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, code, badge, icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer hover:bg-stone-50/70 dark:hover:bg-stone-800/30 rounded-xl"
      >
        <div className="min-w-0 flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-bold text-stone-900 dark:text-stone-100">{title}</div>
            {code && (
              <div className="truncate font-mono text-[10px] text-stone-500 dark:text-stone-400">
                {code}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          {icon}
        </div>
      </button>
      {open && (
        <div className="space-y-3.5 border-t border-stone-200/70 px-4 pb-4 pt-3.5 dark:border-stone-800">
          {children}
        </div>
      )}
    </div>
  );
};

const SoundSlotRow: React.FC<{
  label: string;
  code: string;
  desc: string;
  spec: AirstrikeSoundSpec;
  onUpdate: (next: AirstrikeSoundSpec) => void;
}> = ({ label, code, desc, spec, onUpdate }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const applyFile = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    onUpdate({
      id: spec.id,
      file: { file, fileName: file.name, previewUrl, size: file.size },
    });
  };
  return (
    <div className="min-w-0 rounded-lg border border-stone-200/80 bg-stone-50/70 p-2.5 space-y-2 dark:border-stone-800 dark:bg-stone-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <TooltipLabel label={label} code={code} desc={desc} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept=".wav,audio/wav"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) applyFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700 cursor-pointer whitespace-nowrap"
          >
            <Upload className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{spec.file ? 'Replace' : 'WAV'}</span>
          </button>
          <SpritePickButton accept="sound" label={`Pick ${label}`} onPick={applyFile} />
          {spec.file && (
            <button
              type="button"
              onClick={() => onUpdate({ id: spec.id, file: undefined })}
              title="Remove uploaded WAV"
              className="rounded-md p-1 text-stone-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/40 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {spec.file ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-forge-700 dark:text-forge-300">
          <span className="min-w-0 flex-1 truncate">
            {spec.file.fileName || spec.file.file?.name}
          </span>
          {spec.file.previewUrl && (
            <audio src={spec.file.previewUrl} controls className="h-7 w-full max-w-[200px]" />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">
            Stock sample ID <span className="text-stone-400">(0 = silent)</span>
          </span>
          <NumberInput
            min={0}
            max={512}
            value={spec.id}
            onChange={(e) => onUpdate({ ...spec, id: Math.max(0, Number(e.target.value) || 0) })}
            className={`${fieldInput} w-20 text-right`}
          />
        </div>
      )}
    </div>
  );
};

export const BeamCard: React.FC<BeamCardProps> = ({
  project,
  onChange,
  onOpenHoldBuilder,
  onOpenTab,
}) => {
  const [showAdvancedVisuals, setShowAdvancedVisuals] = useState(false);

  const beam = mergeBeamConfig(project.beam);
  const seq = mergeFireSequenceConfig(project.fireSequence);
  const seqActive = !!project.fireSequence?.enabled;

  const update = (patch: Partial<BeamConfig>, seqPatch?: Partial<FireSequenceConfig>) => {
    const nextBeam: BeamConfig = {
      ...DEFAULT_BEAM,
      ...beam,
      enabled: true,
      ...patch,
    };
    const nextPayload: Partial<WeaponProject> = { beam: nextBeam };
    if (seqPatch) {
      nextPayload.fireSequence = {
        ...DEFAULT_FIRE_SEQUENCE,
        ...(project.fireSequence ?? {}),
        ...seq,
        engine: 'timed',
        ...seqPatch,
      };
    }
    onChange(nextPayload);
  };

  const updateSeq = (patch: Partial<FireSequenceConfig>, beamPatch?: Partial<BeamConfig>) => {
    const nextSeq: FireSequenceConfig = {
      ...DEFAULT_FIRE_SEQUENCE,
      ...(project.fireSequence ?? {}),
      ...seq,
      engine: 'timed',
      ...patch,
    };
    const nextPayload: Partial<WeaponProject> = { fireSequence: nextSeq };
    if (beamPatch) {
      nextPayload.beam = {
        ...DEFAULT_BEAM,
        ...beam,
        enabled: true,
        ...beamPatch,
      };
    }
    onChange(nextPayload);
  };

  const firesSubtype = Number(recordField(project, 'fires.subtype', 8));
  const setFiresSubtype = (val: number) => {
    onChange({
      recordOverrides: {
        ...project.recordOverrides,
        'fires.subtype': val,
      },
    });
  };

  const activeDurationFrames = beam.growFrames + beam.holdFrames;
  const maxHitsPerTarget =
    beam.hurtMode === 'none'
      ? 0
      : beam.hitCooldownFrames <= 0
        ? 1
        : Math.max(1, Math.floor((activeDurationFrames - 1) / beam.hitCooldownFrames) + 1);
  const hitRateText =
    beam.hitCooldownFrames <= 0
      ? '1× per beam'
      : `Every ${beam.hitCooldownFrames * 20}ms · up to ${maxHitsPerTarget}×`;

  const targetsMode: 'worms' | 'all' =
    !beam.targets.mines && !beam.targets.crates && !beam.targets.objects && !beam.targets.graves
      ? 'worms'
      : 'all';

  const setTargetsMode = (mode: 'worms' | 'all') => {
    update({
      targets:
        mode === 'worms'
          ? { worms: true, mines: false, crates: false, objects: false, graves: false }
          : { worms: true, mines: true, crates: true, objects: true, graves: true },
    });
  };

  const seqSchedule = seqActive ? computeBeamSequenceSchedule(beam, seq) : null;

  const applyPreset = (patch: Partial<BeamConfig>) => {
    const nextBuf = patch.bufferFrames ?? beam.bufferFrames;
    update(
      { ...patch, enabled: true },
      seqActive && !seq.customIntervalsMs.trim() ? { firstDelayMs: nextBuf * 20 } : undefined,
    );
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Beam & Cone Weapon"
        code="firing.beam(ev, BEAM)"
        icon={<Zap className="h-4 w-4 text-forge-500" aria-hidden="true" />}
        desc="Backed by a zeroed hitscan shot with a custom ray/cone hurt layer, advancing reach, hit cooldowns, and self-contained ribbon textures."
        right={
          onOpenHoldBuilder && (
            <button
              type="button"
              onClick={onOpenHoldBuilder}
              className="inline-flex items-center gap-1.5 rounded-lg border border-forge-300 bg-forge-50 px-3 py-1.5 text-xs font-semibold text-forge-800 transition-colors hover:bg-forge-100 dark:border-forge-700/70 dark:bg-forge-950/50 dark:text-forge-200 dark:hover:bg-forge-900/60 cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5 text-forge-600 dark:text-forge-400" aria-hidden="true" />
              <span>Open Sprite Builder</span>
            </button>
          )
        }
      />

      {/*
        Ergonomic workbench layout:
        - Desktop (lg+): Controls on the left, live 50 Hz preview + Muzzle/Audio stacked cleanly on the right
          (eliminating blank space underneath the preview and keeping alignment + audio beside the stage).
        - Narrow (< lg): Core combat controls -> Preview -> Visuals & Timing -> Muzzle & Audio.
      */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,460px)] lg:items-start lg:gap-5">
        {/* LEFT COLUMN */}
        <div className="order-1 space-y-4 lg:col-start-1">
          {/* 1. Quick Archetype Presets */}
          <div className={cardBox}>
            <SubSectionTitle
              title="Beam Archetypes"
              desc="Starting points for instant laser corridors, expanding cones, Tesla forks, advancing cannons, and sniper rails."
            />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {BEAM_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.patch)}
                  title={preset.tagline}
                  className="rounded-lg border border-stone-200 bg-stone-50/80 px-2.5 py-2 text-left transition-colors hover:border-forge-400 hover:bg-forge-50/60 dark:border-stone-700/80 dark:bg-stone-950/40 dark:hover:border-forge-500/60 dark:hover:bg-forge-950/30 cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: preset.patch.color || '#5ad7ff' }}
                    />
                    <span className="truncate text-[11px] font-semibold text-stone-900 dark:text-stone-100">
                      {preset.name}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[10px] text-stone-500 dark:text-stone-400">
                    {preset.tagline}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Hurt Layer, Cone & Damage */}
          <CollapsibleCard
            title="Hurt Layer & Damage"
            code="hits / width / cone_deg / hit_cooldown"
            badge={
              <span className="font-mono text-[10px] font-semibold text-forge-700 dark:text-forge-300 tabular-nums">
                {hitRateText}
              </span>
            }
          >

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'corridor', label: 'Corridor', hint: 'Constant-width beam' },
                  { id: 'cone', label: 'Cone', hint: 'Widens with distance' },
                  { id: 'first', label: 'First Hit', hint: 'Stops on 1st target' },
                  { id: 'none', label: 'Visual Only', hint: 'No hurt pass' },
                ] as { id: BeamHurtMode; label: string; hint: string }[]
              ).map((m) => {
                const active = beam.hurtMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => update({ hurtMode: m.id })}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-forge-500 bg-forge-50/80 text-forge-900 dark:border-forge-500/80 dark:bg-forge-950/40 dark:text-forge-100'
                        : 'border-stone-200 bg-stone-50/50 text-stone-700 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-950/30 dark:text-stone-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">{m.label}</div>
                    <div className="text-[10px] text-stone-500 dark:text-stone-400">{m.hint}</div>
                  </button>
                );
              })}
            </div>

            {beam.hurtMode !== 'none' && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {beam.hurtMode === 'cone' ? (
                    <>
                      <div>
                        <TooltipLabel
                          label="Muzzle Half-Width"
                          code="width0"
                          desc="Half-width of the cone at distance 0 (the muzzle)."
                        />
                        <UnitNumberInput
                          min={2}
                          max={80}
                          value={beam.muzzleWidth}
                          onChange={(e) => update({ muzzleWidth: Number(e.target.value) })}
                          unit="px"
                        />
                      </div>
                      <div>
                        <TooltipLabel
                          label="Cone Half-Angle"
                          code="cone_deg"
                          desc="Half-angle of expansion in degrees (full cone is 2× this value)."
                        />
                        <UnitNumberInput
                          min={1}
                          max={70}
                          step={0.5}
                          value={beam.coneAngleDeg}
                          onChange={(e) => update({ coneAngleDeg: Number(e.target.value) })}
                          unit="°"
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <TooltipLabel
                        label={beam.hurtMode === 'first' ? 'Ray Radius' : 'Corridor Half-Width'}
                        code="width"
                        desc="Half-width of the hurt capsule around the beam centerline."
                      />
                      <UnitNumberInput
                        min={2}
                        max={beam.hurtMode === 'first' ? 64 : 140}
                        value={beam.width}
                        onChange={(e) => update({ width: Number(e.target.value) })}
                        unit="px"
                      />
                    </div>
                  )}

                  <div>
                    <TooltipLabel
                      label="Hit Cooldown"
                      code="hit_cooldown"
                      desc="0 = hit each target once per beam. > 0 = re-hit every N frames (50 Hz) to avoid 50 hits/sec."
                    />
                    <UnitNumberInput
                      min={0}
                      max={120}
                      value={beam.hitCooldownFrames}
                      onChange={(e) => update({ hitCooldownFrames: Number(e.target.value) })}
                      unit="f"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div>
                    <TooltipLabel label="Min Damage" code="damage[1]" desc="Minimum HP lost per hit." />
                    <UnitNumberInput
                      min={0}
                      max={250}
                      value={beam.damageMin}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        update({ damageMin: v, damageMax: Math.max(v, beam.damageMax) });
                      }}
                      unit="HP"
                    />
                  </div>
                  <div>
                    <TooltipLabel label="Max Damage" code="damage[2]" desc="Maximum HP lost per hit." />
                    <UnitNumberInput
                      min={0}
                      max={250}
                      value={beam.damageMax}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        update({ damageMax: v, damageMin: Math.min(beam.damageMin, v) });
                      }}
                      unit="HP"
                    />
                  </div>
                  <div>
                    <TooltipLabel
                      label="Interaction"
                      code="interact"
                      desc="Hit uses o:hit (full knockback & flinch); Burn uses o:burn (damage without interrupting poses)."
                    />
                    <select
                      value={beam.interact ? 'hit' : 'burn'}
                      onChange={(e) => update({ interact: e.target.value === 'hit' })}
                      className={selectClass}
                    >
                      <option value="hit">Hit (Knockback)</option>
                      <option value="burn">Burn (DoT + Final Push)</option>
                    </select>
                  </div>
                  <div>
                    <TooltipLabel
                      label="Targets"
                      code="targets"
                      desc="Whether the hurt pass affects only worms or also mines, crates, barrels, and graves."
                    />
                    <select
                      value={targetsMode}
                      onChange={(e) => setTargetsMode(e.target.value as 'worms' | 'all')}
                      className={selectClass}
                    >
                      <option value="all">All Objects</option>
                      <option value="worms">Worms Only</option>
                    </select>
                  </div>
                </div>

                {beam.interact ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <TooltipLabel
                        label="Push Impulse"
                        code="push"
                        desc="Knockback impulse applied along the beam direction."
                      />
                      <UnitNumberInput
                        min={0}
                        max={25}
                        step={0.5}
                        value={beam.push}
                        onChange={(e) => update({ push: Number(e.target.value) })}
                        unit="px/f"
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Hit Kind"
                        code="kind"
                        desc="WA damage classification passed to o:hit (controls hit reaction & sound)."
                      />
                      <select
                        value={beam.kind}
                        onChange={(e) => update({ kind: e.target.value as BeamHitKind })}
                        className={selectClass}
                      >
                        {BEAM_HIT_KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <TooltipLabel
                        label="DoT Push"
                        code="burn_push"
                        desc="Subtle knockback impulse nudging worms on each burn tick (0 keeps worms in place until final hit)."
                      />
                      <UnitNumberInput
                        min={0}
                        max={15}
                        step={0.1}
                        value={beam.burnPush ?? 0}
                        onChange={(e) => update({ burnPush: Number(e.target.value) || 0 })}
                        unit="px/f"
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Final Push"
                        code="push"
                        desc="Full knockback impulse applied via o:hit on the final active beam tick."
                      />
                      <UnitNumberInput
                        min={0}
                        max={25}
                        step={0.5}
                        value={beam.push}
                        onChange={(e) => update({ push: Number(e.target.value) || 0 })}
                        unit="px/f"
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Final Hit Kind"
                        code="kind"
                        desc="WA hit reaction applied with Final Push on the closing tick."
                      />
                      <select
                        value={beam.kind}
                        onChange={(e) => update({ kind: e.target.value as BeamHitKind })}
                        className={selectClass}
                      >
                        {BEAM_HIT_KINDS.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="max-w-[230px]">
                  <PoisonDoseField
                    id="beam-poison"
                    value={beam.poisonPower}
                    onChange={(poisonPower) => update({ poisonPower })}
                    hint="Each worm the beam actually damages gets `worm:poison(n)`; mines, crates and barrels never do. The dose is paid out as nonlethal health at turn boundaries."
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-stone-200/70 pt-2.5 dark:border-stone-800">
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={beam.spareShooter}
                      onChange={(e) => update({ spareShooter: e.target.checked })}
                      className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                    />
                    <span>Spare Shooter</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={beam.electricTaze}
                      onChange={(e) => update({ electricTaze: e.target.checked })}
                      className="rounded border-stone-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>Electric Taze Pose (px.electric)</span>
                  </label>
                  {beam.electricTaze && (
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!project.electricTazeMines}
                        onChange={(e) => onChange({ electricTazeMines: e.target.checked })}
                        className="rounded border-stone-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span>Taze Mines Instead of Detonating</span>
                    </label>
                  )}
                </div>
              </>
            )}
          </CollapsibleCard>

          {/* 3. Timing, Advancing Reach & Burst Sequencing Sync */}
          <CollapsibleCard
            title="Timing, Reach & Burst Sync"
            code="buffer / grow / hold / fade"
            icon={<Clock className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />}
          >

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <TooltipLabel
                  label="Charge Buffer"
                  code={seqActive ? 'first_delay_ms' : 'buffer'}
                  desc="Frames before the first beam releases. Plays Sprite Builder's 'While Buffering' art and Charge WAV. Synced directly with Firing & Burst."
                />
                <UnitNumberInput
                  min={0}
                  max={150}
                  value={beam.bufferFrames}
                  onChange={(e) => {
                    const f = Math.max(0, Math.round(Number(e.target.value) || 0));
                    update(
                      { bufferFrames: f },
                      seqActive && !seq.customIntervalsMs.trim()
                        ? { firstDelayMs: f * 20 }
                        : undefined,
                    );
                  }}
                  unit="f"
                />
                {onOpenTab && (
                  <button
                    type="button"
                    onClick={() => onOpenTab('beam_prebuffer')}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-forge-700 hover:underline dark:text-forge-300 cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    <span>
                      {beam.preBuffer?.enabled ? 'Pre-Buffer Beam (On) →' : 'Configure Pre-Buffer Beam →'}
                    </span>
                  </button>
                )}
              </div>
              <div>
                <TooltipLabel
                  label="Advance (Grow)"
                  code="grow"
                  desc="0 = instant hitscan beam. > 0 = beam tip & hurt pass advance from muzzle to target over N frames."
                />
                <UnitNumberInput
                  min={0}
                  max={120}
                  value={beam.growFrames}
                  onChange={(e) => update({ growFrames: Number(e.target.value) })}
                  unit="f"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Active Hold"
                  code="hold"
                  desc="Frames the full-length beam stays active and deals hurt ticks."
                />
                <UnitNumberInput
                  min={1}
                  max={200}
                  value={beam.holdFrames}
                  onChange={(e) => update({ holdFrames: Math.max(1, Number(e.target.value)) })}
                  unit="f"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Fade Out"
                  code="fade"
                  desc="Visual dissipation frames after the hurt pass ends."
                />
                <UnitNumberInput
                  min={0}
                  max={120}
                  value={beam.fadeFrames}
                  onChange={(e) => update({ fadeFrames: Number(e.target.value) })}
                  unit="f"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <TooltipLabel label="Max Range" code="range" desc="Maximum raycast distance in pixels." />
                <UnitNumberInput
                  min={40}
                  max={3000}
                  step={20}
                  value={beam.range}
                  onChange={(e) => update({ range: Number(e.target.value) })}
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Dissipate Style"
                  code="dissipate"
                  desc="How the beam leaves the screen during Fade Out."
                />
                <select
                  value={beam.fadeMode}
                  onChange={(e) => update({ fadeMode: e.target.value as BeamFadeMode })}
                  className={selectClass}
                >
                  <option value="fade">Fade Alpha</option>
                  <option value="retract">Retract Tail</option>
                  <option value="dissolve">Dissolve &amp; Jitter</option>
                </select>
              </div>
              {beam.growFrames > 0 && (
                <div>
                  <TooltipLabel label="Advance Easing" code="grow_ease" desc="Tip velocity curve while advancing." />
                  <select
                    value={beam.growEase}
                    onChange={(e) => update({ growEase: e.target.value as BeamGrowEase })}
                    className={selectClass}
                  >
                    <option value="linear">Linear</option>
                    <option value="out">Fast Start (Ease-Out)</option>
                    <option value="in">Accelerate (Ease-In)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-0.5">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={beam.stopOnTerrain}
                  onChange={(e) => update({ stopOnTerrain: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Stop on Terrain</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={beam.followAim}
                  onChange={(e) => update({ followAim: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Track Live Aim While Sweeping</span>
              </label>
            </div>

            {/* Inline Burst Sequencing Sync Box */}
            <div className="rounded-lg border border-stone-200/80 bg-stone-50/70 p-3 space-y-2.5 dark:border-stone-800 dark:bg-stone-950/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <ListOrdered className="h-3.5 w-3.5 text-forge-500" aria-hidden="true" />
                  <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                    Multi-Shot Burst &amp; Wind-Up Sequence
                  </span>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={seqActive}
                    onChange={(e) =>
                      updateSeq({
                        enabled: e.target.checked,
                        engine: 'timed',
                        firstDelayMs:
                          e.target.checked && seq.firstDelayMs === 0 && beam.bufferFrames > 0
                            ? beam.bufferFrames * 20
                            : seq.firstDelayMs,
                      })
                    }
                    className="h-3.5 w-3.5 rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                  />
                  <span>{seqActive ? 'Active' : 'Single Shot'}</span>
                </label>
              </div>

              {seqActive && (
                <div className="space-y-2.5 pt-1">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div>
                      <TooltipLabel label="Shots" code="count" desc="Total beam discharges in the burst." />
                      <UnitNumberInput
                        min={1}
                        max={60}
                        value={seq.count}
                        onChange={(e) => updateSeq({ count: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Interval"
                        code="interval_ms"
                        desc="Delay before the next shot (measured from the chosen timing anchor)."
                      />
                      <UnitNumberInput
                        min={20}
                        max={5000}
                        step={20}
                        value={seq.intervalMs}
                        onChange={(e) => {
                          const v = Math.max(20, Number(e.target.value) || 20);
                          updateSeq({ intervalMs: v, delay: Math.max(1, Math.round(v / 20)) });
                        }}
                        unit="ms"
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Beams / Shot"
                        code="burst_size"
                        desc="Multiple simultaneous rays fanned across Spread Cone."
                      />
                      <UnitNumberInput
                        min={1}
                        max={12}
                        value={seq.burstSize}
                        onChange={(e) => updateSeq({ burstSize: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Spread"
                        code="spread_deg"
                        desc="Angular fan across multiple beams, or per-shot jitter when Beams/Shot = 1."
                      />
                      <UnitNumberInput
                        min={0}
                        max={120}
                        step={1}
                        value={seq.spreadDeg}
                        onChange={(e) => updateSeq({ spreadDeg: Math.max(0, Number(e.target.value) || 0) })}
                        unit="°"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <TooltipLabel
                        label="Next-Shot Anchor"
                        desc="On Ray Dispatch starts the next delay immediately when the beam leaves (allows overlapping beams & fast re-animation). After Beam Hold waits until grow + hold finish."
                      />
                      <select
                        value={seq.beamSequenceAnchor ?? 'on_dispatch'}
                        onChange={(e) =>
                          updateSeq({
                            beamSequenceAnchor: e.target.value as 'on_dispatch' | 'after_hold',
                          })
                        }
                        className={selectClass}
                      >
                        <option value="on_dispatch">On Ray Dispatch (Allows Overlap)</option>
                        <option value="after_hold">After Beam Hold (Sequential)</option>
                      </select>
                    </div>
                    <div>
                      <TooltipLabel
                        label="Custom Wind-Up Ramp (ms)"
                        code="intervals_ms"
                        desc="Optional comma-separated delays per shot (like 300, 180, 100, 40). Last value repeats."
                      />
                      <input
                        type="text"
                        value={seq.customIntervalsMs}
                        placeholder="300, 180, 100, 40"
                        onChange={(e) => updateSeq({ customIntervalsMs: e.target.value })}
                        className={fieldInput}
                      />
                    </div>
                  </div>

                  {seqSchedule && (
                    <div className="text-[11px] font-mono text-stone-500 dark:text-stone-400">
                      Dispatch frames:{' '}
                      <span className="text-stone-700 dark:text-stone-200">
                        {seqSchedule.dispatchFrames
                          .slice(0, 8)
                          .map((f) => `${f}f`)
                          .join(' · ')}
                        {seqSchedule.dispatchFrames.length > 8 ? ' · …' : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CollapsibleCard>

          {/* 4. Beam Visuals */}
          <div className={cardBox}>
            <SubSectionTitle
              title="Beam Visuals"
              code="path / core / glow / style"
              right={<Sparkles className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />}
            />

            <div className="space-y-1.5">
              <TooltipLabel
                label="Beam Texture Set"
                code="sprite / glow / end / orb"
                desc="Shared wfws.sdk texture family for core, glow halo, end-caps, and tip/charge orbs (zero per-weapon atlas cost)."
              />
              <div className="grid grid-cols-3 gap-2">
                {BEAM_ART_STYLES.map((style) => {
                  const active = beam.artStyle === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => update({ artStyle: style.id as BeamArtStyle })}
                      title={style.desc}
                      className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-forge-500 bg-forge-50 text-forge-900 dark:border-forge-400 dark:bg-forge-950/60 dark:text-forge-100'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300 dark:hover:border-stone-600'
                      }`}
                    >
                      <div className="text-xs font-semibold leading-tight">{style.label}</div>
                      <div className="mt-0.5 text-[10px] leading-snug text-stone-500 dark:text-stone-400 line-clamp-2">
                        {style.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <TooltipLabel label="Path Shape" code="path" desc="Straight line, curved arc, or jagged lightning." />
                <select
                  value={beam.path}
                  onChange={(e) => update({ path: e.target.value as BeamPathKind })}
                  className={selectClass}
                >
                  <option value="straight">Straight</option>
                  <option value="arc">Curved Arc</option>
                  <option value="jagged">Jagged Lightning</option>
                </select>
              </div>
              {beam.path === 'arc' && (
                <div>
                  <TooltipLabel
                    label="Arc Bulge"
                    code="bulge"
                    desc="Midpoint curve height in pixels (+ arches upward regardless of worm facing, - dips down)."
                  />
                  <UnitNumberInput
                    min={-160}
                    max={160}
                    value={beam.bulge}
                    onChange={(e) => update({ bulge: Number(e.target.value) })}
                    unit="px"
                  />
                </div>
              )}
              {beam.path === 'jagged' && (
                <div>
                  <TooltipLabel label="Bolt Jitter" code="noise" desc="Random lateral deflection amplitude in pixels." />
                  <UnitNumberInput
                    min={2}
                    max={64}
                    value={beam.noise}
                    onChange={(e) => update({ noise: Number(e.target.value) })}
                    unit="px"
                  />
                </div>
              )}
              <div>
                <TooltipLabel label="Beam Color" code="r / g / b" desc="Additive tint applied to core and glow." />
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={beam.color}
                    onChange={(e) => update({ color: e.target.value })}
                    className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-stone-200 bg-transparent p-0.5 dark:border-stone-700"
                  />
                  <input
                    type="text"
                    value={beam.color}
                    onChange={(e) => update({ color: e.target.value })}
                    className={fieldInput}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <TooltipLabel label="Core Width" code="core0" desc="Inner hot beam thickness at the muzzle." />
                <UnitNumberInput
                  min={4}
                  max={160}
                  value={beam.coreWidth}
                  onChange={(e) => update({ coreWidth: Number(e.target.value) })}
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Tip Width"
                  code="core1"
                  desc="0 = uniform thickness. > 0 tapers or flares the beam toward its tip."
                />
                <UnitNumberInput
                  min={0}
                  max={240}
                  value={beam.tipWidth}
                  onChange={(e) => update({ tipWidth: Number(e.target.value) })}
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel label="Glow Width" code="glow0" desc="Outer additive halo thickness." />
                <UnitNumberInput
                  min={0}
                  max={240}
                  value={beam.glowWidth}
                  onChange={(e) => update({ glowWidth: Number(e.target.value) })}
                  unit="px"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={beam.flicker}
                  onChange={(e) => update({ flicker: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Flicker Pulse</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={beam.rainbow}
                  onChange={(e) => update({ rainbow: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Rainbow Cycle</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={beam.impactSparks}
                  onChange={(e) => update({ impactSparks: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Impact Sparks</span>
              </label>
            </div>

            {/* Collapsible Advanced Visuals */}
            <div className="border-t border-stone-200/70 pt-2.5 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setShowAdvancedVisuals((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 cursor-pointer"
              >
                {showAdvancedVisuals ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Advanced Visuals (Look, Segments, Forks, Depth)</span>
              </button>

              {showAdvancedVisuals && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <TooltipLabel
                      label="Draw Style"
                      code="look"
                      desc="Both are the additive ribbon painter, the one the preview draws. A beam is a ray: the projectile trail widens as a point ages and sheds its tail, so it can't grow or retract. 'trail' is kept only so an older bundle still loads."
                    />
                    <select
                      value={beam.look}
                      onChange={(e) => update({ look: e.target.value as BeamLookKind })}
                      className={selectClass}
                    >
                      <option value="ribbon">Ribbon (Additive)</option>
                      <option value="trail">Trail (drawn as ribbon)</option>
                    </select>
                  </div>
                  <div>
                    <TooltipLabel label="Segments" code="points" desc="Subdivision count along the beam." />
                    <NumberInput
                      min={2}
                      max={40}
                      value={beam.points}
                      onChange={(e) => update({ points: Math.max(2, Number(e.target.value)) })}
                      className={fieldInput}
                    />
                  </div>
                  <div>
                    <TooltipLabel
                      label="Lightning Forks"
                      code="branches"
                      desc="Secondary side arcs off the main ribbon."
                    />
                    <NumberInput
                      min={0}
                      max={6}
                      value={beam.branches}
                      onChange={(e) => update({ branches: Math.max(0, Number(e.target.value)) })}
                      className={fieldInput}
                    />
                  </div>
                  <div>
                    <TooltipLabel label="Render Depth" code="depth" desc="WA layer band for drawing the beam." />
                    <select
                      value={beam.depth}
                      onChange={(e) => update({ depth: e.target.value as BeamDepthBand })}
                      className={selectClass}
                    >
                      <option value="FRONT">FRONT (Over All)</option>
                      <option value="EFFECTS">EFFECTS (Standard)</option>
                      <option value="OBJECTS">OBJECTS (Behind FX)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 5. Impact Cut, Burst & Fire */}
          <CollapsibleCard
            title="Impact Cut, Burst & Fire"
            code="cut / impact_burst / wa.fire.spawn"
            icon={<Flame className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />}
          >
            {/* Terrain Cut Row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={beam.terrainCut}
                  onChange={(e) => update({ terrainCut: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <Flame className="h-3.5 w-3.5 text-forge-500" aria-hidden="true" />
                <span>Carve Terrain at Impact</span>
              </label>
              {beam.terrainCut && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-stone-500 dark:text-stone-400">Cut Shape</span>
                    <select
                      value={beam.cutShape ?? 'circle'}
                      onChange={(e) => update({ cutShape: e.target.value as BeamCutShape })}
                      className={selectClass}
                    >
                      <option value="circle">Circle (Custom Radius)</option>
                      <option value="torch">Blow Torch (Tunnel)</option>
                      <option value="drill">Pneumatic Drill (Shaft)</option>
                    </select>
                  </div>
                  {(beam.cutShape ?? 'circle') === 'circle' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">Cut Radius</span>
                      <div className="w-24">
                        <UnitNumberInput
                          min={2}
                          max={80}
                          value={beam.cutRadius}
                          onChange={(e) => update({ cutRadius: Number(e.target.value) })}
                          unit="px"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Impact Explosion Spawner (`effects.sdk` / `custom_explosion`) */}
            {(() => {
              const expFx: ExplosionEffectConfig =
                project.explosionEffect ?? DEFAULT_EXPLOSION_EFFECT;
              const legacyIb = beam.impactBurst;
              const hasLegacyIb = !!legacyIb?.enabled && !expFx.enabled;
              const upgradeLegacyToEffectManager = () => {
                if (!legacyIb) return;
                onChange({
                  explosionEffect: {
                    ...DEFAULT_EXPLOSION_EFFECT,
                    ...expFx,
                    enabled: true,
                    mode: 'effect',
                    preset: 'custom',
                    style: legacyIb.style,
                    shape: legacyIb.shape,
                    radius: legacyIb.radius,
                    color: legacyIb.color?.trim() ? legacyIb.color : beam.color,
                    rebuffer: legacyIb.rebufferMode !== 'none',
                    rebufferMode: legacyIb.rebufferMode,
                    rebufferAt: legacyIb.rebufferAt,
                    starPoints: legacyIb.starPoints,
                    spin: legacyIb.spin,
                    ...(legacyIb.centerGlow ? { centerGlow: { ...legacyIb.centerGlow } } : {}),
                  },
                  beam: {
                    ...DEFAULT_BEAM,
                    ...beam,
                    impactBurst: { ...legacyIb, enabled: false },
                  },
                });
                onOpenTab?.('beam_explosion');
              };
              return (
                <div className="space-y-2.5 border-t border-stone-200/70 pt-3 dark:border-stone-800">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-stone-200/80 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/40">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-forge-500" aria-hidden="true" />
                        <span className="text-xs font-bold text-stone-900 dark:text-stone-100">
                          Impact Explosion (Effect Manager)
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            expFx.enabled
                              ? 'bg-forge-100 text-forge-800 dark:bg-forge-900/50 dark:text-forge-200'
                              : 'bg-stone-200/80 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
                          }`}
                        >
                          {expFx.enabled
                            ? expFx.mode === 'blast'
                              ? 'Full Blast'
                              : 'Visual Burst'
                            : 'Off'}
                        </span>
                      </div>
                      <p className="text-[11px] text-stone-500 dark:text-stone-400">
                        {expFx.enabled ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full border border-white/40"
                              style={{ backgroundColor: expFx.color }}
                            />
                            <span>
                              Radius {expFx.radius}px · {expFx.shape} · {expFx.style}
                              {expFx.mode === 'blast'
                                ? ` · ${expFx.damage} dmg / ${expFx.hole}px hole`
                                : ''}
                            </span>
                          </span>
                        ) : (
                          'Spawn a full px_effects ring/star burst or custom_explosion blast at beam impact.'
                        )}
                      </p>
                    </div>
                    {onOpenTab && (
                      <button
                        type="button"
                        onClick={() => onOpenTab('beam_explosion')}
                        className="shrink-0 cursor-pointer rounded-lg border border-forge-300 bg-white px-3 py-1.5 text-xs font-semibold text-forge-700 transition-colors hover:bg-forge-50 dark:border-forge-700 dark:bg-stone-900 dark:text-forge-300 dark:hover:bg-forge-950/40"
                      >
                        {expFx.enabled ? 'Edit Impact Explosion' : 'Configure Impact Explosion'}
                      </button>
                    )}
                  </div>
                  {hasLegacyIb && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50/75 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-200">
                      <span>
                        Legacy <code className="font-mono">impactBurst</code> is active (still exported until replaced).
                      </span>
                      <button
                        type="button"
                        onClick={upgradeLegacyToEffectManager}
                        className="shrink-0 cursor-pointer rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:bg-stone-900 dark:text-amber-200"
                      >
                        Upgrade to Effect Manager Explosion
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Spawn Fire (`wa.fire.spawn`) */}
            {(() => {
              const fire: BeamFireConfig = beam.fire ?? DEFAULT_BEAM_FIRE;
              const updateFire = (patch: Partial<BeamFireConfig>) =>
                update({ fire: { ...fire, ...patch } });
              return (
                <div className="space-y-2.5 border-t border-stone-200/70 pt-3 dark:border-stone-800">
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fire.enabled}
                      onChange={(e) => updateFire({ enabled: e.target.checked })}
                      className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                    />
                    <Flame className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                    <span>Spawn Fire Along Beam / Impact (wa.fire.spawn)</span>
                  </label>
                  {fire.enabled && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 rounded-lg border border-stone-200/80 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/40">
                      <div>
                        <TooltipLabel label="Placement" code="fire.mode" desc="Spawn fire at terrain/target impact, along the beam path, or both." />
                        <select
                          value={fire.mode}
                          onChange={(e) => updateFire({ mode: e.target.value as BeamFireConfig['mode'] })}
                          className={selectClass}
                        >
                          <option value="impact">Impact Tip</option>
                          <option value="trajectory">Along Trajectory</option>
                          <option value="both">Trajectory &amp; Impact</option>
                        </select>
                      </div>
                      <div>
                        <TooltipLabel label="Count" code="fire.count" desc="Flames spawned per impact or sample step." />
                        <UnitNumberInput
                          min={1}
                          max={20}
                          value={fire.count}
                          onChange={(e) => updateFire({ count: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </div>
                      <div>
                        <TooltipLabel label="Lifetime" code="fire.durationMs" desc="Flame burn duration in milliseconds." />
                        <UnitNumberInput
                          min={200}
                          max={15000}
                          step={100}
                          value={fire.durationMs}
                          onChange={(e) => updateFire({ durationMs: Math.max(200, Number(e.target.value) || 2000) })}
                          unit="ms"
                        />
                      </div>
                      <div>
                        <TooltipLabel label="Damage" code="fire.damage" desc="Damage dealt by spawned flames." />
                        <UnitNumberInput
                          min={0}
                          max={25}
                          value={fire.damage}
                          onChange={(e) => updateFire({ damage: Math.max(0, Number(e.target.value) || 0) })}
                        />
                      </div>
                      {fire.mode !== 'impact' && (
                        <div>
                          <TooltipLabel label="Step" code="fire.step" desc="Advance distance in px between trajectory flame drops." />
                          <UnitNumberInput
                            min={16}
                            max={160}
                            step={4}
                            value={fire.step}
                            onChange={(e) => updateFire({ step: Math.max(16, Number(e.target.value) || 40) })}
                            unit="px"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </CollapsibleCard>
        </div>

        {/* RIGHT COLUMN: Live 50 Hz Preview + Muzzle Alignment, Firing Pose & Audio directly underneath */}
        <div className="order-2 space-y-4 lg:col-start-2 lg:sticky lg:top-4">
          <BeamPreview
            project={project}
            beam={beam}
          />

          {/* Muzzle Alignment & Firing Pose (directly below the preview!) */}
          <div className={cardBox}>
            <SubSectionTitle
              title="Muzzle Alignment & Firing Pose"
              code="standoff / offset / fire_subtype"
              right={<Crosshair className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />}
            />

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <TooltipLabel label="Standoff" code="standoff" desc="Forward pixels along aim from worm centre." />
                <UnitNumberInput
                  min={0}
                  max={96}
                  value={beam.standoff}
                  onChange={(e) => update({ standoff: Number(e.target.value) })}
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel label="Offset X" code="offset.x" desc="Horizontal world nudge (mirrored by facing)." />
                <UnitNumberInput
                  min={-80}
                  max={80}
                  value={beam.offsetX}
                  onChange={(e) => update({ offsetX: Number(e.target.value) })}
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel label="Offset Y" code="offset.y" desc="Vertical world nudge (negative = up)." />
                <UnitNumberInput
                  min={-80}
                  max={80}
                  value={beam.offsetY}
                  onChange={(e) => update({ offsetY: Number(e.target.value) })}
                  unit="px"
                />
              </div>
            </div>

            <div>
              <TooltipLabel
                label="WA Firing Pose"
                code="fires.subtype"
                desc="8 (Sheep Launcher) gives a clean silent pose so your beam WAV is the only voice."
              />
              <select
                value={firesSubtype}
                onChange={(e) => setFiresSubtype(Number(e.target.value))}
                className={selectClass}
              >
                {!FIRE_SUBTYPES.some((s) => s.value === firesSubtype) && (
                  <option value={firesSubtype}>{fireSubtypeLabel(firesSubtype)}</option>
                )}
                {FIRE_SUBTYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.value === 8 ? '8: Silent Pose (Recommended)' : `${s.value}: ${s.label}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <CollapsibleCard
            title="Beam Audio"
            code="charge_sound / sound / impact_sound"
            icon={<Volume2 className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />}
            badge={
              <span className="font-mono text-[10px] font-semibold text-stone-500 dark:text-stone-400">
                {[beam.chargeSound, beam.launchSound, beam.impactSound].filter((s) => s.file || s.id > 0).length}/3 active
              </span>
            }
            defaultOpen={false}
          >
            <SoundSlotRow
              label="Charge Sound"
              code="charge_sound"
              desc="Played when Charge Buffer starts (buffer > 0)."
              spec={beam.chargeSound}
              onUpdate={(chargeSound) => update({ chargeSound })}
            />
            <SoundSlotRow
              label="Fire Sound"
              code="sound"
              desc="Played when each beam releases."
              spec={beam.launchSound}
              onUpdate={(launchSound) => update({ launchSound })}
            />
            <SoundSlotRow
              label="Impact Sound"
              code="impact_sound"
              desc="Played when the beam strikes terrain."
              spec={beam.impactSound}
              onUpdate={(impactSound) => update({ impactSound })}
            />
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
};
