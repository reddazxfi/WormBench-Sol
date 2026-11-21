import React, { useRef, useState } from 'react';
import { AlertTriangle, Image as ImageIcon, Loader2, Stamp, Trash2, Upload } from 'lucide-react';
import type {
  TerrainStampConfig,
  TerrainStampImpactConfig,
  WeaponProject,
} from '../types/weapon';
import {
  DEFAULT_TERRAIN_STAMP,
  STAMP_CARDINALS,
  STAMP_CLEARANCE_MAX,
  STAMP_FRAMES,
  STAMP_HIT_KINDS,
  STAMP_MAX_CELL,
  STAMP_STEP_DEG,
  stampFrameForAngle,
  supportsTerrainStamp,
} from '../data/terrainStamp';
import { buildRotationSheet } from '../utils/rotateSheet';
import { NumberInput } from './NumberInput';
import { SpritePickButton } from './SpritePickButton';
import {
  SectionHeader,
  SubSectionTitle,
  TooltipLabel,
  UnitNumberInput,
  buildTooltip,
} from './RecordEditor';

interface Props {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

const COMPASS = ['Up', 'Up-Right', 'Right', 'Down-Right', 'Down', 'Down-Left', 'Left', 'Up-Left'];

/** The direction a fixed angle points, in words, from the 32-frame strip. */
function angleLabel(deg: number): string {
  const octant = Math.round(stampFrameForAngle(deg) / 4) % 8;
  return COMPASS[octant];
}

/**
 * One cell of a baked rotation strip as a fixed-size thumbnail.
 *
 * The strip is a single PNG (`cell` wide, `cell × frames` tall), so a frame is
 * cropped by scaling the whole image to the box width and shifting it up. This
 * is what `PackSpriteUpload` does with its own rotation sheets, and it needs no
 * canvas: the browser has already decoded the file.
 */
const StripFrame: React.FC<{
  url: string;
  frame: number;
  frames: number;
  size: number;
  label?: string;
}> = ({ url, frame, frames, size, label }) => (
  <figure className="flex flex-col items-center gap-1">
    <div
      className="relative overflow-hidden rounded-lg border border-stone-700 bg-[#0b0f14]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute left-0 top-0 block"
        style={{ width: size, height: size * frames, marginTop: -size * frame }}
      />
    </div>
    {label && (
      <figcaption className="font-mono text-[10px] text-stone-400">
        {label} <span className="text-stone-500">#{frame}</span>
      </figcaption>
    )}
  </figure>
);

/**
 * `wa.land.stamp`, the round's picture is burned into the terrain where it
 * bursts (PX's ninja star / javelin / girder launcher). The engine stamps one
 * frame of a vertical strip, so the upload is baked into 32 cells: frame 0 up,
 * clockwise, and the frame is picked from the impact heading.
 */
/**
 * One half of the damage-timing pair: what the round does when it lands.
 *
 * Two mutually exclusive choices shown as two checkboxes, because the pair is
 * the only way a reader can tell that turning the pierce off is not "no damage"
 * but "the blast does it". The unselected one is never hidden, so the
 * alternative is always visible; it just cannot be unchecked by clicking.
 */
const ModeChip: React.FC<{
  label: string;
  on: boolean;
  accent: 'amber' | 'forge';
  title?: string;
  onClick: () => void;
}> = ({ label, on, accent, title, onClick }) => (
  <label
    title={title}
    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 ${
      on
        ? accent === 'amber'
          ? 'border-amber-300 bg-amber-50/80 dark:border-amber-800/70 dark:bg-amber-950/30'
          : 'border-forge-300 bg-forge-50/80 dark:border-forge-800/70 dark:bg-forge-950/30'
        : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900'
    }`}
  >
    <input
      type="checkbox"
      checked={on}
      // A pair, not two switches: ticking the other one is the only way to
      // change it, so clicking the active box keeps it active.
      onChange={() => onClick()}
      className={`h-3.5 w-3.5 cursor-pointer rounded focus:ring-forge-500 ${
        accent === 'amber' ? 'text-amber-600' : 'text-forge-600'
      }`}
    />
    <span
      className={`whitespace-nowrap text-[11px] font-semibold ${
        on
          ? accent === 'amber'
            ? 'text-amber-900 dark:text-amber-100'
            : 'text-forge-900 dark:text-forge-100'
          : 'text-stone-700 dark:text-stone-200'
      }`}
    >
      {label}
    </span>
  </label>
);

export const TerrainStampCard: React.FC<Props> = ({ project, onChange }) => {
  if (!supportsTerrainStamp(project)) return null;
  const stamp: TerrainStampConfig = project.terrainStamp ?? DEFAULT_TERRAIN_STAMP;
  const sheet = stamp.sheet;
  const update = (patch: Partial<TerrainStampConfig>) => {
    onChange({ terrainStamp: { ...stamp, ...patch } });
  };
  const updateImpact = (patch: Partial<TerrainStampImpactConfig>) => {
    update({ impact: { ...impact, ...patch } });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [baking, setBaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fx = project.explosionEffect;
  const impact = stamp.impact ?? DEFAULT_TERRAIN_STAMP.impact;
  // The stamp is written by `on_explode`, which WA runs *before* its own blast:
  // a native crater is carved afterwards and erases it. Only a custom blast in
  // `blast` mode carves the crater inside the callback, and impact damage zeroes
  // the blast outright, so either one leaves the stamp in place.
  const blastRelies = !(fx?.enabled && fx.mode === 'blast') && !impact.enabled;

  const pickFile = async (file: File) => {
    setBaking(true);
    setError(null);
    try {
      const baked = await buildRotationSheet(file, STAMP_FRAMES, {
        // Frames over 256 px are dropped by the engine (`terrain_frames`), and
        // the padded cell is the source's diagonal, so a 200x200 upload would
        // not stamp at all. Scaling to fit keeps a big sprite usable.
        maxCell: STAMP_MAX_CELL,
        // A half-alpha edge writes no terrain; smoothing would thin the tips.
        smooth: false,
      });
      if (sheet?.previewUrl) URL.revokeObjectURL(sheet.previewUrl);
      update({
        enabled: true,
        sheet: {
          file: baked.file,
          fileName: baked.file.name,
          previewUrl: baked.previewUrl,
          // The strip's own cell count. `mod.toml` declares it, because the
          // engine slices by frame count, not by image size.
          frames: baked.frames,
          fps: 15,
          play: 'loop',
          sourceFile: file,
          sourceName: file.name,
          rotationFrames: baked.frames,
        },
      });
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBaking(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const pick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await pickFile(file);
  };

  const remove = () => {
    if (sheet?.previewUrl) URL.revokeObjectURL(sheet.previewUrl);
    update({ sheet: undefined, enabled: false });
    setError(null);
  };

  const frames = sheet?.frames || STAMP_FRAMES;
  const fixedFrame = stampFrameForAngle(stamp.fixedAngle);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Terrain Stamp"
        code="wa.land.stamp"
        icon={<Stamp className="h-4 w-4 text-sky-500" aria-hidden="true" />}
        desc="Burns the round's picture into the terrain where it bursts: frame 0 points up, the 32-frame strip turns clockwise, and the round's own rotation picks the frame (velocity for a native sheet). A built-in engine verb, so no library dependency."
        right={
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 ${
              stamp.enabled
                ? 'border-sky-200 bg-sky-50/80 dark:border-sky-800/70 dark:bg-sky-950/30'
                : 'border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900'
            }`}
            title={
              stamp.enabled
                ? sheet
                  ? 'Write the stamp into on_explode.'
                  : 'On without a picture: the pierce runs, nothing is stamped.'
                : sheet
                  ? 'Turn the card on: the stamp and the pierce both live in on_explode.'
                  : 'Upload a sprite to stamp, or tick Pierce Targets below to use the card for damage alone.'
            }
          >
            <input
              type="checkbox"
              checked={stamp.enabled}
              // The card is the switch for the pierce too, so it can be turned on
              // with no picture when that is all the author wants from it.
              disabled={!sheet && !impact.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500 disabled:cursor-not-allowed"
            />
            <span
              className={`text-xs font-semibold ${
                stamp.enabled
                  ? 'text-sky-900 dark:text-sky-200'
                  : 'text-stone-500 dark:text-stone-400'
              }`}
            >
              Enable Stamp
            </span>
          </label>
        }
      />

      {stamp.enabled && sheet && blastRelies && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            WA's own blast runs <em>after</em> this callback, so its crater wipes the stamp. Turn on{' '}
            <strong>Explosion Burst → Replace Game Blast</strong> (this page, one tab over) to carve
            the crater first and keep the destroy-then-build effect. With the native blast the
            stamp is only carved away.
          </p>
        </div>
      )}

      {stamp.enabled && !sheet && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>No stamp sprite yet, so nothing is written to the bundle.</p>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        {/* Controls */}
        <div className="space-y-4">
          <div>
            <TooltipLabel
              label="Stamp Sprite"
              code="sprites/<mod>/stamp.png"
              desc="One PNG of the object pointing up. It is baked into 32 cells immediately (frame 0 is the untouched upload). The stamped frame is 256 px at most, so a large picture is scaled down to fit."
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => pick(e.target.files)}
            />
            {sheet ? (
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-2 dark:border-stone-700 dark:bg-stone-900">
                <ImageIcon className="h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-stone-800 dark:text-stone-200">
                    {sheet.sourceName || sheet.fileName || 'stamp.png'}
                  </div>
                  <div className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                    {frames} frames · pointing up
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={baking}
                  title="Replace the stamp sprite (re-bakes the 32 frames)."
                  className="rounded-lg border border-stone-200 px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  Replace
                </button>
                <SpritePickButton
                  accept="image"
                  label="Pick Stamp Sprite"
                  disabled={baking}
                  onPick={(file) => void pickFile(file)}
                />
                <button
                  type="button"
                  onClick={remove}
                  title="Remove the stamp sprite."
                  aria-label="Remove the stamp sprite"
                  className="rounded-lg border border-rose-200 p-1 text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={baking}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-xs font-semibold text-stone-600 transition-colors hover:border-sky-400 hover:text-sky-700 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300 dark:hover:border-sky-600 dark:hover:text-sky-300"
                >
                  {baking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Baking 32 frames…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Upload a sprite <span className="font-normal">(it must point up)</span>
                    </>
                  )}
                </button>
                <div className="flex justify-end">
                  <SpritePickButton
                    accept="image"
                    label="Pick Stamp Sprite"
                    disabled={baking}
                    onPick={(file) => void pickFile(file)}
                  />
                </div>
              </div>
            )}
            {error && (
              <p className="mt-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
          </div>

          <div>
            <TooltipLabel
              label="Stamp Angle"
              code="frame"
              desc="Impact angle stamps the way the round lies when it bursts. A sprite-builder round uses the rotation the builder drew it at (a spin, a slow cycle, a dig pose); a native round only has its velocity, so the heading comes from that. Fixed angle always stamps the same frame, which is what a picture that should stay upright needs."
            />
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
              {(
                [
                  { id: true, label: 'Impact Angle' },
                  { id: false, label: 'Fixed Angle' },
                ] as const
              ).map((option) => (
                <button
                  key={option.label}
                  type="button"
                  title={buildTooltip(
                    option.id
                      ? 'Frame from the round’s heading as it bursts.'
                      : 'The same frame on every impact.',
                    'frame',
                  )}
                  onClick={() => update({ onImpact: option.id })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    stamp.onImpact === option.id
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {!stamp.onImpact && (
            <div>
              <TooltipLabel
                label="Fixed Angle"
                code="frame = 0..31"
                desc="Degrees clock-wise from up. Frame 0 is the untouched upload, 90° is one quarter turn (frame 8, pointing right), 180° is frame 16."
                htmlFor="stamp-fixed-angle"
              />
              <div className="flex items-center gap-2">
                <input
                  id="stamp-fixed-angle-range"
                  aria-label="Fixed stamp angle slider"
                  type="range"
                  min={0}
                  max={360 - STAMP_STEP_DEG}
                  step={STAMP_STEP_DEG}
                  value={stamp.fixedAngle}
                  onChange={(e) => update({ fixedAngle: Number(e.target.value) })}
                  className="h-1.5 w-full cursor-pointer accent-sky-600"
                />
                <div className="w-28 shrink-0">
                  <UnitNumberInput
                    id="stamp-fixed-angle"
                    min={0}
                    max={360 - STAMP_STEP_DEG}
                    step={STAMP_STEP_DEG}
                    value={stamp.fixedAngle}
                    onChange={(e) => update({ fixedAngle: Number(e.target.value) })}
                    unit="°"
                  />
                </div>
              </div>
              <p className="mt-1 font-mono text-[10px] text-stone-500 dark:text-stone-400">
                frame {fixedFrame} · {angleLabel(stamp.fixedAngle)}
              </p>
            </div>
          )}

          {/* Damage on impact: PX's javelin. The round pierces whatever it is
              standing in and only sticks in the land when it hit nothing. */}
          <div className="space-y-3 border-t border-stone-200/80 pt-3.5 dark:border-stone-800">
            <SubSectionTitle
              title="Damage On Impact"
              code="stamp_hit"
              desc="When the round's damage happens. Pierce Targets is PX's javelin: it damages whatever is at the impact point (worms, mines, crates, oil drums) instead of exploding, and sticks in the land only when it hit nothing. On Explosion leaves the record's own blast to do the work. The two are exclusive because the pierce zeroes the blast, so nothing can blast twice."
              right={
                <div className="flex items-center gap-1.5">
                  <ModeChip
                    label="Pierce Targets"
                    accent="amber"
                    on={impact.enabled}
                    title={buildTooltip(
                      'The round damages whatever is at the impact point instead of exploding, and sticks in the land only when it hit nothing. Zeroes missile.explosion.power / push_pct. One of this pair, never both.',
                      'STAMP_HIT',
                    )}
                    onClick={() => updateImpact({ enabled: true })}
                  />
                  <ModeChip
                    label="On Explosion"
                    accent="forge"
                    on={!impact.enabled}
                    title={buildTooltip(
                      'The round bursts and its own blast does the damage, as a stock weapon does. One of this pair, never both: ticking Pierce Targets is what stops the blast.',
                      'STAMP_HIT',
                    )}
                    onClick={() => updateImpact({ enabled: false })}
                  />
                </div>
              }
            />
            {impact.enabled && !stamp.enabled && (
              <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                <strong>Pierce Targets is on, but nothing will pierce yet:</strong> the pierce
                rides <strong>Enable Stamp</strong> above, so it needs that ticked too. A stamp
                sprite is optional when the card is only used for damage.
              </p>
            )}
            {impact.enabled ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <TooltipLabel
                      label="Damage"
                      code="STAMP_HIT.damage"
                      desc="Damage dealt to whatever is inside the search square. With the Percent kind it is a percentage of the worm's health instead."
                      htmlFor="stamp-hit-damage"
                    />
                    <UnitNumberInput
                      id="stamp-hit-damage"
                      min={0}
                      max={200}
                      step={1}
                      value={impact.damage}
                      onChange={(e) => updateImpact({ damage: Number(e.target.value) })}
                      unit="dmg"
                    />
                  </div>
                  <div>
                    <TooltipLabel
                      label="Search Radius"
                      code="STAMP_HIT.radius"
                      desc="Half-extent of the square around the impact point, in pixels: anything whose centre is inside it is hit. PX's javelin uses 20."
                      htmlFor="stamp-hit-radius"
                    />
                    <UnitNumberInput
                      id="stamp-hit-radius"
                      min={1}
                      max={64}
                      step={1}
                      value={impact.radius}
                      onChange={(e) => updateImpact({ radius: Number(e.target.value) })}
                      unit="px"
                    />
                  </div>
                  <div>
                    <TooltipLabel
                      label="Knockback"
                      code="STAMP_HIT.impulse"
                      desc="How much of the round's speed the target is thrown with. PX's javelin uses half (50%)."
                      htmlFor="stamp-hit-impulse"
                    />
                    <UnitNumberInput
                      id="stamp-hit-impulse"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(impact.impulse * 100)}
                      onChange={(e) =>
                        updateImpact({ impulse: Math.max(0, Number(e.target.value)) / 100 })
                      }
                      unit="%"
                    />
                  </div>
                  <div>
                    <TooltipLabel
                      label="Hit Kind"
                      code="kind"
                      desc="The kind the hit is reported as: WA's own names plus the scripted taze. Taze is the electrical one: the pierce arms the hurt first, so px.electric holds the worm in the sparking pose and throws it when the hold releases, the same way the burst card's electrical type works."
                      htmlFor="stamp-hit-kind"
                    />
                    <select
                      id="stamp-hit-kind"
                      title={STAMP_HIT_KINDS.find((option) => option.id === impact.kind)?.hint}
                      value={impact.kind}
                      onChange={(e) =>
                        updateImpact({ kind: e.target.value as TerrainStampImpactConfig['kind'] })
                      }
                      className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                    >
                      {STAMP_HIT_KINDS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label
                    title={buildTooltip(
                      'The worm that fired is not hit. PX’s javelin does this, so a spear that bursts in your hands stabs nothing.',
                      'STAMP_HIT.spare_shooter',
                    )}
                    className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300"
                  >
                    <input
                      type="checkbox"
                      checked={impact.spareShooter}
                      onChange={(e) => updateImpact({ spareShooter: e.target.checked })}
                      className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                    />
                    <span>Spare the worm that fired</span>
                  </label>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Every damageable thing inside the square is hit: worms, mines, crates and oil
                    drums. The round only stamps the ground when it hit nothing, and a worm that
                    survives the hit is still not buried (Worm Clearance).
                  </p>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                The round bursts and its own blast does the damage, so nothing here applies. Tick{' '}
                <strong>Pierce Targets</strong> to hit what it lands on instead: that zeroes the
                blast, which is why only one of the two can be on. To change the burst itself, use
                the Explosion Burst tab.
              </p>
            )}
          </div>

          <div className="space-y-3 border-t border-stone-200/80 pt-3.5 dark:border-stone-800">
            <SubSectionTitle
              title="How it sits in the land"
              code="buried"
              desc="The stamp is cut into the terrain like a girder: `soften` decides how far its edges are worn back, `blend` how its pixels meet the ground."
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <TooltipLabel
                  label="Soften Edge"
                  code="buried.soften"
                  desc="Pixels worn off the picture's outline, 1 to 32. PX's ninja star and javelin use 3."
                  htmlFor="stamp-soften"
                />
                <UnitNumberInput
                  id="stamp-soften"
                  min={1}
                  max={32}
                  step={1}
                  value={stamp.soften}
                  onChange={(e) => update({ soften: Number(e.target.value) })}
                  unit="px"
                />
              </div>
              <div>
                <TooltipLabel
                  label="Edge Blend"
                  code="buried.blend"
                  desc="Mix blends the stamped pixels into the land's colours; Dither keeps a hard edge between picture and ground."
                />
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 dark:border-stone-800 dark:bg-stone-950/60">
                  {(
                    [
                      { id: 'mix', label: 'Mix' },
                      { id: 'dither', label: 'Dither' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => update({ blend: option.id })}
                      className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        stamp.blend === option.id
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <TooltipLabel
                  label="Worm Clearance"
                  code="stamp_clear"
                  desc="The stamp is skipped when a live worm is this close to the impact point: a worm sealed under the picture is trapped in the land. 0 stamps over worms."
                  htmlFor="stamp-clearance"
                />
                <UnitNumberInput
                  id="stamp-clearance"
                  min={0}
                  max={STAMP_CLEARANCE_MAX}
                  step={1}
                  value={stamp.wormClearance}
                  onChange={(e) => update({ wormClearance: Number(e.target.value) })}
                  unit="px"
                />
              </div>
            </div>
            <label
              title={buildTooltip(
                'Burn the sprite’s own colours in. Off maps them to the terrain palette, which is what makes a stamp read as carved land (PX does this).',
                'true_colour',
              )}
              className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300"
            >
              <input
                type="checkbox"
                checked={stamp.trueColour}
                onChange={(e) => update({ trueColour: e.target.checked })}
                className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
              />
              <span>Keep the sprite's own colours</span>
            </label>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              {stamp.wormClearance > 0
                ? `The stamp is skipped while a live worm is within ${stamp.wormClearance} px of the impact point.`
                : 'Worm clearance is off: a worm standing at the impact point is sealed under the stamp.'}
            </p>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              WA's blast runs after <code className="font-mono">on_explode</code>, so a stamp only
              survives a crater carved inside the callback, or no blast at all:{' '}
              <strong>Damage On Impact</strong> zeroes the record's own explosion.{' '}
              Custom <code className="font-mono">on_explode</code> code (Record page) runs before the
              stamp and before the pierce: a <code className="font-mono">return</code> in it skips
              both, which is how PX's ninja star avoids sticking into a worm.
            </p>
          </div>
        </div>

        {/* Strip preview */}
        <div className="space-y-2">
          <SubSectionTitle
            title="Baked Strip"
            code="frames = 32"
            desc="Every frame is stamped from the impact heading: 32 cells, frame 0 up, clockwise. The engine keeps the source pixels of a stampable sheet so it can write them into the terrain."
          />
          <div className="rounded-xl border border-stone-300 bg-stone-950 p-3 dark:border-stone-700">
            {sheet?.previewUrl ? (
              stamp.onImpact ? (
                <div className="grid grid-cols-4 gap-2">
                  {STAMP_CARDINALS.map((cardinal) => (
                    <StripFrame
                      key={cardinal.frame}
                      url={sheet.previewUrl!}
                      frame={cardinal.frame}
                      frames={frames}
                      size={56}
                      label={cardinal.label}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-2">
                  <StripFrame
                    url={sheet.previewUrl}
                    frame={fixedFrame}
                    frames={frames}
                    size={128}
                    label={`${Math.round(stamp.fixedAngle)}°`}
                  />
                </div>
              )
            ) : (
              <div className="flex h-[120px] flex-col items-center justify-center gap-1 text-center">
                <Stamp className="h-6 w-6 text-stone-600" aria-hidden="true" />
                <p className="text-[11px] text-stone-500">
                  Upload a sprite pointing up to bake the strip.
                </p>
              </div>
            )}
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400">
            {stamp.onImpact
              ? 'Impact angle: a round flying right stamps frame 8, falling frame 16, climbing frame 0.'
              : `Fixed angle: every impact stamps frame ${fixedFrame}.`}{' '}
            Stamping needs a round WA blasts, mines and airstrike munitions are not offered.
          </p>
        </div>
      </div>
    </div>
  );
};
