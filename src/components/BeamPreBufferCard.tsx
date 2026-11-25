import React from 'react';
import type {
  BeamArtStyle,
  BeamConfig,
  BeamDepthBand,
  BeamPathKind,
  BeamPreBufferConfig,
  BeamPreBufferReach,
  FireSequenceConfig,
  WeaponProject,
} from '../types/weapon';
import {
  BEAM_ART_STYLES,
  BEAM_PRE_BUFFER_PRESETS,
  DEFAULT_BEAM,
  mergeBeamConfig,
  mergeBeamPreBufferConfig,
} from '../data/beam';
import { DEFAULT_FIRE_SEQUENCE, mergeFireSequenceConfig } from '../data/fireSequence';
import { BeamPreview } from './BeamPreview';
import { SectionHeader, TooltipLabel, UnitNumberInput } from './RecordEditor';
import { AlertTriangle, Clock, Eye, Layers, Sparkles, Sliders } from 'lucide-react';

interface BeamPreBufferCardProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

const cardBox =
  'rounded-xl border border-stone-200/90 bg-white p-4 space-y-3.5 dark:border-stone-800 dark:bg-stone-900/70';

export const BeamPreBufferCard: React.FC<BeamPreBufferCardProps> = ({
  project,
  onChange,
}) => {
  const beam = mergeBeamConfig(project.beam);
  const pb = mergeBeamPreBufferConfig(beam.preBuffer);
  const seq = mergeFireSequenceConfig(project.fireSequence);
  const seqActive = !!seq.enabled;

  const updateBeam = (
    beamPatch: Partial<BeamConfig>,
    seqPatch?: Partial<FireSequenceConfig>,
  ) => {
    const nextBeam: BeamConfig = {
      ...DEFAULT_BEAM,
      ...beam,
      enabled: true,
      ...beamPatch,
    };
    const nextPayload: Partial<WeaponProject> = { beam: nextBeam };
    if (seqPatch && seqActive) {
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

  const updatePb = (patch: Partial<BeamPreBufferConfig>) => {
    updateBeam({ preBuffer: { ...pb, ...patch } });
  };

  const setBufferFrames = (frames: number) => {
    const f = Math.max(0, Math.min(150, Math.round(frames || 0)));
    updateBeam(
      { bufferFrames: f },
      seqActive && !seq.customIntervalsMs.trim() ? { firstDelayMs: f * 20 } : undefined,
    );
  };

  const applyPreset = (presetConfig: Partial<BeamPreBufferConfig>) => {
    const nextPb = mergeBeamPreBufferConfig({
      ...pb,
      ...presetConfig,
      enabled: true,
    });
    const nextBuf = beam.bufferFrames > 0 ? beam.bufferFrames : 25;
    updateBeam(
      {
        preBuffer: nextPb,
        bufferFrames: nextBuf,
      },
      seqActive && !seq.customIntervalsMs.trim() && beam.bufferFrames === 0
        ? { firstDelayMs: nextBuf * 20 }
        : undefined,
    );
  };

  const activeHex = pb.color.trim() ? pb.color : beam.color;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Pre-Buffer Beam"
        code="BEAM.pre_buffer = { ... } (wfws_firing)"
        icon={<Sparkles className="h-4 w-4 text-forge-500" aria-hidden="true" />}
        desc="Custom charge-up ribbon, converging rails, and muzzle orb drawn during the pre-fire buffer before the main shot discharges."
        right={
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${
              pb.enabled
                ? 'border-forge-400/70 bg-forge-50/70 dark:border-forge-600/60 dark:bg-forge-950/35'
                : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-700 dark:bg-stone-800/80 dark:hover:border-stone-600'
            }`}
          >
            <input
              type="checkbox"
              checked={pb.enabled}
              onChange={(e) => updatePb({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
              Enable Pre-Buffer Beam
            </span>
          </label>
        }
      />

      {/* Buffer Duration Link Bar */}
      <div className={cardBox}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Clock className="h-4 w-4 shrink-0 text-forge-500" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
                Charge Buffer Duration
              </div>
              <div className="text-[11px] text-stone-500 dark:text-stone-400">
                50 Hz frames before discharge ({(beam.bufferFrames * 20)} ms). Applies to both direct{' '}
                <code className="font-mono">firing.beam</code> and sequenced <code className="font-mono">firing.beam_buffer</code>.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-28">
              <UnitNumberInput
                min={0}
                max={150}
                value={beam.bufferFrames}
                onChange={(e) => setBufferFrames(Number(e.target.value) || 0)}
                unit="f"
              />
            </div>
            {[15, 25, 40].map((frames) => (
              <button
                key={frames}
                type="button"
                onClick={() => setBufferFrames(frames)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  beam.bufferFrames === frames
                    ? 'border-forge-500 bg-forge-50 text-forge-800 dark:border-forge-500/70 dark:bg-forge-950/40 dark:text-forge-200'
                    : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-300'
                }`}
              >
                {frames}f
              </button>
            ))}
          </div>
        </div>
        {beam.bufferFrames === 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>Charge Buffer is 0 frames.</strong> Increase above 0 to see the Pre-Buffer Beam charge before firing.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setBufferFrames(25)}
              className="shrink-0 cursor-pointer rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:bg-stone-900 dark:text-amber-200"
            >
              Set 25f (0.5s)
            </button>
          </div>
        )}
      </div>

      {/* Presets Strip */}
      <div className={cardBox}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
            Pre-Buffer Presets
          </div>
          <span className="font-mono text-[10px] text-stone-400 dark:text-stone-500">
            one click enables + configures
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {BEAM_PRE_BUFFER_PRESETS.map((preset) => {
            const swatch = preset.config.color || beam.color;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.config)}
                title={preset.desc}
                className="rounded-lg border border-stone-200 bg-stone-50/80 px-2.5 py-2 text-left transition-colors hover:border-forge-400 hover:bg-forge-50/60 dark:border-stone-700/80 dark:bg-stone-950/40 dark:hover:border-forge-500/60 dark:hover:bg-forge-950/30 cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: swatch }}
                  />
                  <span className="truncate text-[11px] font-semibold text-stone-900 dark:text-stone-100">
                    {preset.label}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[10px] text-stone-500 dark:text-stone-400">
                  {preset.desc}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main 2-column configuration + live 50 Hz preview */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_480px] gap-4 items-start">
        <div className="space-y-4">
          {/* 1. Visibility & Muzzle Orb */}
          <div className={cardBox}>
            <div className="flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
                Visibility &amp; Muzzle Orb
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pb.showBeam}
                  onChange={(e) => updatePb({ showBeam: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Draw Pre-Buffer Ribbon</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pb.showOrb}
                  onChange={(e) => updatePb({ showOrb: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Draw Muzzle Charge Orb</span>
              </label>
            </div>
            {pb.showOrb && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <TooltipLabel
                    label="Orb Scale"
                    code="orb_scale"
                    desc="Size multiplier applied to the charging muzzle orb and orbiting motes."
                  />
                  <UnitNumberInput
                    min={0.25}
                    max={3}
                    step={0.05}
                    value={pb.orbScale}
                    onChange={(e) =>
                      updatePb({
                        orbScale: Math.max(0.25, Math.min(3, Number(e.target.value) || 1)),
                      })
                    }
                    unit="×"
                  />
                </div>
                <div>
                  <TooltipLabel
                    label="Orbiting Motes"
                    code="orb_motes"
                    desc="Number of swirling mini-orbs pulled into the muzzle during charge (0..12)."
                  />
                  <UnitNumberInput
                    min={0}
                    max={12}
                    step={1}
                    value={pb.orbMotes}
                    onChange={(e) =>
                      updatePb({
                        orbMotes: Math.max(0, Math.min(12, Math.round(Number(e.target.value) || 0))),
                      })
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* 2. Reach & Geometry */}
          <div className={cardBox}>
            <div className="flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
                Reach &amp; Geometry
              </div>
            </div>

            <div>
              <TooltipLabel
                label="Charge Reach Mode"
                code="reach"
                desc="Extending grows outward with charge progress. Full-Length holds the whole laser sight immediately. Converging Twin Rails closes two outer rails inward onto the aim line."
              />
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
                {(
                  [
                    { id: 'grow', label: 'Extending' },
                    { id: 'full', label: 'Full-Length' },
                    { id: 'converge', label: 'Converging Rails' },
                  ] as { id: BeamPreBufferReach; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updatePb({ reach: opt.id })}
                    className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                      pb.reach === opt.id
                        ? 'bg-white text-stone-900 shadow-xs ring-1 ring-forge-500/35 dark:bg-stone-800 dark:text-white'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <TooltipLabel
                  label="Buffer Range"
                  code="range"
                  desc="Maximum length of the pre-buffer beam in px. Set 0 to inherit the main beam's range."
                />
                <UnitNumberInput
                  min={0}
                  max={4000}
                  step={10}
                  value={pb.range}
                  onChange={(e) =>
                    updatePb({
                      range: Math.max(0, Math.min(4000, Math.round(Number(e.target.value) || 0))),
                    })
                  }
                  unit={pb.range === 0 ? `auto (${beam.range})` : 'px'}
                />
              </div>
              {pb.reach === 'converge' && (
                <div>
                  <TooltipLabel
                    label="Rail Spread"
                    code="converge_spread"
                    desc="Starting lateral separation (px) between the twin converging rails before they lock together."
                  />
                  <UnitNumberInput
                    min={4}
                    max={120}
                    step={2}
                    value={pb.convergeSpread}
                    onChange={(e) =>
                      updatePb({
                        convergeSpread: Math.max(4, Math.min(120, Number(e.target.value) || 36)),
                      })
                    }
                    unit="px"
                  />
                </div>
              )}
              <div>
                <TooltipLabel
                  label="Path Shape"
                  code="path"
                  desc="Centerline shape of the pre-buffer beam: straight laser, bowed arc, or crackling lightning."
                />
                <select
                  value={pb.path}
                  onChange={(e) => updatePb({ path: e.target.value as BeamPathKind })}
                  className={selectClass}
                >
                  <option value="straight">Straight</option>
                  <option value="arc">Curved Arc</option>
                  <option value="jagged">Jagged Arc</option>
                </select>
              </div>
              {pb.path === 'arc' && (
                <div>
                  <TooltipLabel
                    label="Arc Bulge"
                    code="bulge"
                    desc="Peak perpendicular bow at midpoint (px). Positive arches up."
                  />
                  <UnitNumberInput
                    min={-160}
                    max={160}
                    value={pb.bulge}
                    onChange={(e) =>
                      updatePb({ bulge: Math.max(-160, Math.min(160, Number(e.target.value) || 0)) })
                    }
                    unit="px"
                  />
                </div>
              )}
              {pb.path === 'jagged' && (
                <div>
                  <TooltipLabel
                    label="Arc Noise"
                    code="noise"
                    desc="Lateral crackling amplitude for jagged pre-buffer arcs (px)."
                  />
                  <UnitNumberInput
                    min={0}
                    max={60}
                    value={pb.noise}
                    onChange={(e) =>
                      updatePb({ noise: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })
                    }
                    unit="px"
                  />
                </div>
              )}
              <div>
                <TooltipLabel
                  label="Vertices"
                  code="points"
                  desc="Number of sample points along the pre-buffer beam (2..32)."
                />
                <UnitNumberInput
                  min={2}
                  max={32}
                  value={pb.points}
                  onChange={(e) =>
                    updatePb({
                      points: Math.max(2, Math.min(32, Math.round(Number(e.target.value) || 12))),
                    })
                  }
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300 cursor-pointer">
              <input
                type="checkbox"
                checked={pb.stopOnTerrain}
                onChange={(e) => updatePb({ stopOnTerrain: e.target.checked })}
                className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
              />
              <span>Stop Pre-Buffer Beam at Solid Terrain (`wa.land.trace`)</span>
            </label>
          </div>

          {/* 3. Width & Charge Taper */}
          <div className={cardBox}>
            <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
              Width &amp; Charge Taper
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <TooltipLabel
                  label="Muzzle Width"
                  code="core_width"
                  desc="Core ribbon width at the muzzle (px)."
                />
                <UnitNumberInput
                  min={0.5}
                  max={60}
                  step={0.5}
                  value={pb.coreWidth}
                  onChange={(e) =>
                    updatePb({ coreWidth: Math.max(0.5, Math.min(60, Number(e.target.value) || 4)) })
                  }
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Tip Width"
                  code="tip_width"
                  desc="Core ribbon width at the far end (px)."
                />
                <UnitNumberInput
                  min={0.5}
                  max={60}
                  step={0.5}
                  value={pb.tipWidth}
                  onChange={(e) =>
                    updatePb({ tipWidth: Math.max(0.5, Math.min(60, Number(e.target.value) || 1.5)) })
                  }
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Glow Width"
                  code="glow_width"
                  desc="Outer additive halo width (0 disables halo pass)."
                />
                <UnitNumberInput
                  min={0}
                  max={120}
                  step={1}
                  value={pb.glowWidth}
                  onChange={(e) =>
                    updatePb({ glowWidth: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })
                  }
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Full-Charge Scale"
                  code="end_width_scale"
                  desc="Width multiplier reached at 100% buffer charge (e.g. 1.5 swells thicker right before discharge)."
                />
                <UnitNumberInput
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={pb.endWidthScale}
                  onChange={(e) =>
                    updatePb({
                      endWidthScale: Math.max(0.1, Math.min(4, Number(e.target.value) || 1)),
                    })
                  }
                  unit="×"
                />
              </div>
            </div>
          </div>

          {/* 4. Color, Dynamics & Art Style */}
          <div className={cardBox}>
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
              <div className="text-xs font-bold text-stone-900 dark:text-stone-100">
                Color, Dynamics &amp; Texture Set
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Tint:
                </span>
                <input
                  type="color"
                  value={activeHex}
                  onChange={(e) => updatePb({ color: e.target.value })}
                  className="h-7 w-9 cursor-pointer rounded border border-stone-300 bg-transparent p-0.5 dark:border-stone-700"
                />
                {pb.color.trim() ? (
                  <button
                    type="button"
                    onClick={() => updatePb({ color: '' })}
                    className="rounded-md border border-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:text-stone-300 cursor-pointer"
                  >
                    Inherit Main ({beam.color})
                  </button>
                ) : (
                  <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                    Inherits main beam ({beam.color})
                  </span>
                )}
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pb.rainbow}
                  onChange={(e) => updatePb({ rainbow: e.target.checked })}
                  className="rounded border-stone-300 text-forge-600 focus:ring-forge-500"
                />
                <span>Rainbow Hue Cycle</span>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <TooltipLabel
                  label="Start Alpha"
                  code="alpha_start"
                  desc="Ribbon opacity at the beginning of charge (0..1)."
                />
                <UnitNumberInput
                  min={0}
                  max={1}
                  step={0.05}
                  value={pb.alphaStart}
                  onChange={(e) =>
                    updatePb({ alphaStart: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })
                  }
                />
              </div>
              <div>
                <TooltipLabel
                  label="End Alpha"
                  code="alpha_end"
                  desc="Ribbon opacity at full charge right before release (0..1)."
                />
                <UnitNumberInput
                  min={0}
                  max={1}
                  step={0.05}
                  value={pb.alphaEnd}
                  onChange={(e) =>
                    updatePb({ alphaEnd: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })
                  }
                />
              </div>
              <div>
                <TooltipLabel
                  label="Pulse"
                  code="pulse"
                  desc="Smooth sinusoidal brightness ripple during charge (0..1)."
                />
                <UnitNumberInput
                  min={0}
                  max={1}
                  step={0.05}
                  value={pb.pulse}
                  onChange={(e) =>
                    updatePb({ pulse: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })
                  }
                />
              </div>
              <div>
                <TooltipLabel
                  label="Flicker"
                  code="flicker"
                  desc="Per-frame electric flicker intensity during buffer (0..1)."
                />
                <UnitNumberInput
                  min={0}
                  max={1}
                  step={0.05}
                  value={pb.flicker}
                  onChange={(e) =>
                    updatePb({ flicker: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <TooltipLabel
                  label="Texture Set"
                  code="sprite / glow_sprite / orb_sprite"
                  desc="Choose a different wfws.sdk texture family just for the pre-buffer charge, or inherit the main beam's sheets."
                />
                <select
                  value={pb.artStyle}
                  onChange={(e) =>
                    updatePb({ artStyle: e.target.value as 'inherit' | BeamArtStyle })
                  }
                  className={selectClass}
                >
                  <option value="inherit">Inherit Main Beam ({beam.artStyle})</option>
                  {BEAM_ART_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <TooltipLabel
                  label="Draw Layer"
                  code="depth"
                  desc="Override draw depth band during buffer or inherit main beam depth."
                />
                <select
                  value={pb.depth}
                  onChange={(e) =>
                    updatePb({ depth: e.target.value as 'inherit' | BeamDepthBand })
                  }
                  className={selectClass}
                >
                  <option value="inherit">Inherit Main Beam ({beam.depth})</option>
                  <option value="FRONT">Front (Above Worms &amp; Land)</option>
                  <option value="EFFECTS">Effects Layer</option>
                  <option value="OBJECTS">Objects / Midground Layer</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Live 50 Hz Preview */}
        <div className="xl:sticky xl:top-4">
          <BeamPreview project={project} beam={beam} />
        </div>
      </div>
    </div>
  );
};
