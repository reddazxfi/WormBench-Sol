import type {
  CustomSoundsConfig,
  FireSequenceConfig,
  FireSequenceEngine,
  FireSequenceFuseMode,
  FireSequenceHoming,
  WeaponProject,
} from '../types/weapon';
import { DEFAULT_CUSTOM_SOUNDS, SOUND_PRIORITIES } from '../data/soundPresets';
import {
  DEFAULT_FIRE_SEQUENCE,
  DEFAULT_FIRE_SEQUENCE_HOMING,
  FIRE_SEQUENCE_PRESETS,
  fireSequenceUsesNestedProjectile,
  mergeFireSequenceConfig,
  parseCustomIntervalsMs,
  supportsFireSequence,
} from '../data/fireSequence';
import { STOCK_WEAPONS } from '../data/stockWeapons';
import { recordField } from '../utils/recordField';
import { SoundUpload } from './EffectsCards';
import {
  SectionHeader,
  SubSectionTitle,
  TooltipLabel,
  UnitNumberInput,
} from './RecordEditor';
import { NumberInput } from './NumberInput';
import { Clock, Crosshair, ListOrdered, Sparkles, Target } from 'lucide-react';

interface Props {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

const MISSILE_DONORS = STOCK_WEAPONS.filter((w) => w.family === 'missile');

export const FireSequenceCard: React.FC<Props> = ({ project, onChange }) => {
  const seq = mergeFireSequenceConfig(project.fireSequence);
  const sounds: CustomSoundsConfig = project.customSounds ?? DEFAULT_CUSTOM_SOUNDS;

  const update = (patch: Partial<FireSequenceConfig>) =>
    onChange({
      fireSequence: {
        ...DEFAULT_FIRE_SEQUENCE,
        ...(project.fireSequence ?? {}),
        ...seq,
        ...patch,
      },
    });

  const updateHoming = (patch: Partial<FireSequenceHoming>) =>
    update({
      homing: {
        ...DEFAULT_FIRE_SEQUENCE_HOMING,
        ...seq.homing,
        ...patch,
      },
    });

  const updateSounds = (patch: Partial<CustomSoundsConfig>) =>
    onChange({ customSounds: { ...sounds, ...patch } });

  const supported = supportsFireSequence(project);
  const usesNestedProjectile = fireSequenceUsesNestedProjectile({
    ...project,
    fireSequence: { ...seq, enabled: true },
  });
  const parsedSchedule = parseCustomIntervalsMs(seq.customIntervalsMs);
  const recordFuse = Math.max(
    0,
    Math.round(Number(recordField(project, 'missile.fuse', project.body.fuse_time_ms ?? 0)) || 0),
  );
  const autoAimFuse =
    seq.enabled &&
    seq.mode !== 'actors' &&
    seq.fuseMode === 'record' &&
    recordFuse === 0 &&
    (project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse));

  const customOnFire =
    !!project.enableCustomLua && /(?:^|\n)[ \t]*on_fire\s*=/.test(project.customLuaSnippet || '');

  const seqNum = (
    id: string,
    label: string,
    code: string,
    hint: string,
    key: keyof FireSequenceConfig,
    opts: { min?: number; max?: number; step?: number; unit?: string } = {},
  ) => (
    <div>
      <TooltipLabel label={label} code={code} desc={hint} htmlFor={id} />
      <UnitNumberInput
        id={id}
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 1}
        value={seq[key] as number}
        onChange={(e) => {
          const v = Number(e.target.value);
          const extra: Partial<FireSequenceConfig> =
            key === 'intervalMs' ? { delay: Math.max(1, Math.round(v / 20)) } : {};
          update({ [key]: v, ...extra } as Partial<FireSequenceConfig>);
        }}
        unit={opts.unit}
      />
    </div>
  );

  const selectEngine = (engine: FireSequenceEngine) => update({ engine });

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Firing Engine & Burst"
        code="wf-lib/wfws_firing (wfws.sdk)"
        icon={<ListOrdered className="h-4 w-4 text-forge-500" aria-hidden="true" />}
        desc="First-party lockstep firing engine in wfws.sdk. Run WA's native gun timing with a custom projectile payload, or use the custom sequencer for animation buffers, spin-up ramps, and per-shot cooldowns."
        right={
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${
              seq.enabled
                ? 'border-forge-400/70 bg-forge-50/70 dark:border-forge-600/60 dark:bg-forge-950/35'
                : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-700 dark:bg-stone-800/80 dark:hover:border-stone-600'
            }`}
          >
            <input
              id="seq-enabled"
              type="checkbox"
              checked={seq.enabled}
              disabled={!supported}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
              Enable Burst
            </span>
          </label>
        }
      />

      {!supported ? (
        <p className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-xs text-stone-500 dark:bg-stone-950/40 dark:text-stone-400">
          {project.fireType === 'melee' || project.melee?.enabled
            ? 'Melee strikes own on_fire for their swing. Disable melee or switch weapon type to use sequential firing.'
            : 'Air strikes drop bombs from the aircraft rather than firing from a worm slot. Use the Airstrike Takeover tab to control strike release cadence.'}
        </p>
      ) : customOnFire ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
          Your custom Lua defines <code className="font-mono">on_fire</code>, which already owns the
          trigger. Remove it to emit <code className="font-mono">wf-lib/wfws_firing</code>.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Quick Presets */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              <Sparkles className="h-3 w-3 text-forge-500" aria-hidden="true" />
              <span>Quick Presets</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {FIRE_SEQUENCE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    update({
                      enabled: true,
                      homing: { ...DEFAULT_FIRE_SEQUENCE_HOMING, ...(preset.patch.homing ?? {}) },
                      ...preset.patch,
                    })
                  }
                  className="group rounded-lg border border-stone-200/90 bg-stone-50/60 px-3 py-2 text-left transition-colors hover:border-forge-400 hover:bg-forge-50/50 dark:border-stone-800 dark:bg-stone-950/40 dark:hover:border-forge-600/70 dark:hover:bg-forge-950/25 cursor-pointer"
                >
                  <div className="text-xs font-semibold text-stone-900 group-hover:text-forge-700 dark:text-stone-100 dark:group-hover:text-forge-300">
                    {preset.name}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                    {preset.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Engine Selector */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => selectEngine('native')}
              className={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                seq.engine === 'native'
                  ? 'border-forge-500 bg-forge-50/60 ring-1 ring-forge-500/30 dark:border-forge-500/80 dark:bg-forge-950/30'
                  : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-stone-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-900 dark:text-stone-100">
                  <Crosshair className="h-3.5 w-3.5 text-forge-600 dark:text-forge-400" aria-hidden="true" />
                  Native Gun + Payload
                </span>
                <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                  firing.launch
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-stone-600 dark:text-stone-400">
                WA owns cadence, spread cone, pellets, live aim, and turn interruption natively via{' '}
                <code className="font-mono">gun.bullets</code> + nested{' '}
                <code className="font-mono">projectile</code>. Zero hidden ticker actor.
              </p>
            </button>

            <button
              type="button"
              onClick={() => selectEngine('timed')}
              className={`rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                seq.engine === 'timed'
                  ? 'border-forge-500 bg-forge-50/60 ring-1 ring-forge-500/30 dark:border-forge-500/80 dark:bg-forge-950/30'
                  : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-stone-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-900 dark:text-stone-100">
                  <Clock className="h-3.5 w-3.5 text-forge-600 dark:text-forge-400" aria-hidden="true" />
                  Custom Sequencer
                </span>
                <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                  firing.sequence
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-stone-600 dark:text-stone-400">
                Full lockstep timeline: initial animation buffer before shot 1 (e.g. 300 ms → 20 ms),
                custom per-shot cooldown ramps, and power-bar velocity scaling.
              </p>
            </button>
          </div>

          {/* Cadence & Ballistics */}
          <div className="space-y-3.5 border-t border-stone-200/80 pt-4 dark:border-stone-800">
            <SubSectionTitle
              title="Cadence & Ballistics"
              code={seq.engine === 'native' ? 'gun + PAYLOAD' : 'SEQ'}
              desc={
                seq.engine === 'native'
                  ? 'Native WA gun timing drives on_fire per shot; PAYLOAD launches each projectile or Lua actor.'
                  : 'Lockstep 50 Hz scheduler (20 ms per frame) supporting an opening buffer or a custom per-shot delay list.'
              }
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <TooltipLabel
                  label="Round Type"
                  code={seq.engine === 'native' ? 'launch / actor' : 'mode'}
                  desc="WA Projectiles spawns native projectiles using this weapon's payload record. Custom Lua Actors spawns script-driven sprites."
                  htmlFor="seq-mode"
                />
                <select
                  id="seq-mode"
                  value={seq.mode}
                  onChange={(e) => update({ mode: e.target.value as FireSequenceConfig['mode'] })}
                  className={selectClass}
                >
                  <option value="missiles">WA Projectiles</option>
                  <option value="actors">Custom Lua Actors</option>
                </select>
              </div>

              {seqNum(
                'seq-count',
                'Total Shots',
                seq.engine === 'native' ? 'gun.bullets' : 'count',
                'Number of trigger shots in the volley.',
                'count',
                { min: 1, max: 200 },
              )}

              {seqNum(
                'seq-burst-size',
                'Pellets / Shot',
                seq.engine === 'native' ? 'gun.burst_size' : 'burst_size',
                'Rounds launched simultaneously on each shot (e.g. 5 for a shotgun spread).',
                'burstSize',
                { min: 1, max: 32 },
              )}

              {seqNum(
                'seq-spread-deg',
                'Spread Cone',
                seq.engine === 'native' ? 'gun.spread_deg' : 'spread_deg',
                'Full angular spread cone in degrees around the worm aim angle.',
                'spreadDeg',
                { min: 0, max: 180, step: 0.5, unit: '°' },
              )}

              {seq.engine === 'timed' &&
                seqNum(
                  'seq-first-delay',
                  'Initial Buffer',
                  'first_delay_ms',
                  'Animation / charge windup delay before shot 1 fires (e.g. 300 ms = 15 frames at 50 Hz).',
                  'firstDelayMs',
                  { min: 0, max: 5000, step: 20, unit: 'ms' },
                )}

              {seqNum(
                'seq-interval-ms',
                seq.engine === 'timed' ? 'Subsequent Interval' : 'Shot Interval',
                seq.engine === 'native' ? 'gun.shot_interval_ms' : 'interval_ms',
                seq.engine === 'timed'
                  ? 'Time between shot 1 and shot 2, shot 2 and shot 3, etc. (20 ms = 1 frame at 50 Hz).'
                  : 'Milliseconds between native WA gun shots (min 20 ms = 1 frame).',
                'intervalMs',
                { min: seq.engine === 'native' ? 20 : 0, max: 5000, step: 20, unit: 'ms' },
              )}

              {seqNum(
                'seq-speed',
                'Launch Velocity',
                'speed',
                'Launch speed along the aim vector in pixels/frame.',
                'speed',
                { min: 0, max: 100, step: 0.5, unit: 'px/f' },
              )}

              {seqNum(
                'seq-standoff',
                'Muzzle Standoff',
                'standoff',
                'Forward spawn push in pixels so rounds do not clip the firing worm.',
                'standoff',
                { min: 0, max: 200, unit: 'px' },
              )}

              {seqNum(
                'seq-offset-x',
                'Muzzle Offset X',
                'offset_x',
                'Horizontal origin offset from worm center before standoff.',
                'offsetX',
                { min: -100, max: 100, unit: 'px' },
              )}

              {seqNum(
                'seq-offset-y',
                'Muzzle Offset Y',
                'offset_y',
                'Vertical origin offset from worm center (-3 is roughly weapon height).',
                'offsetY',
                { min: -100, max: 100, unit: 'px' },
              )}

              {seq.engine === 'timed' && (
                <>
                  {seqNum(
                    'seq-spread-x',
                    'Velocity Jitter X',
                    'spread.x',
                    'Optional Cartesian horizontal velocity jitter (+/-) per round.',
                    'spreadX',
                    { min: 0, max: 20, step: 0.1, unit: 'px/f' },
                  )}
                  {seqNum(
                    'seq-spread-y',
                    'Velocity Jitter Y',
                    'spread.y',
                    'Optional Cartesian vertical velocity jitter (+/-) per round.',
                    'spreadY',
                    { min: 0, max: 20, step: 0.1, unit: 'px/f' },
                  )}
                </>
              )}
            </div>

            {/* Custom Per-Shot Cooldown Schedule (Timed Engine) */}
            {seq.engine === 'timed' && (
              <div className="rounded-xl border border-stone-200/80 bg-stone-50/70 p-3.5 dark:border-stone-800 dark:bg-stone-950/40 space-y-2.5">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
                  <div className="lg:col-span-2">
                    <TooltipLabel
                      label="Manual Per-Shot Cooldowns (Optional Override)"
                      code="intervals_ms"
                      desc="Comma-separated millisecond gaps before each shot: entry 1 waits before shot 1, entry 2 waits between shot 1 & 2, etc. The last value repeats for remaining shots. Leave blank to use Initial Buffer + Subsequent Interval."
                      htmlFor="seq-custom-intervals"
                    />
                    <input
                      id="seq-custom-intervals"
                      type="text"
                      value={seq.customIntervalsMs}
                      placeholder="e.g. 300, 20, 20, 20  or  240, 160, 100, 60, 20"
                      onChange={(e) => update({ customIntervalsMs: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div className="text-[11px] text-stone-500 dark:text-stone-400 lg:pt-5">
                    {parsedSchedule.length > 0 ? (
                      <div className="rounded-lg border border-forge-200/80 bg-forge-50/60 px-2.5 py-1.5 font-mono text-[11px] text-forge-800 dark:border-forge-800/60 dark:bg-forge-950/40 dark:text-forge-300">
                        50 Hz:{' '}
                        {parsedSchedule
                          .slice(0, 6)
                          .map((ms) => `${Math.max(0, Math.round(ms / 20))}f`)
                          .join(' → ')}
                        {parsedSchedule.length > 6 ? ' → …' : ' (last repeats)'}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-stone-200/80 bg-white px-2.5 py-1.5 font-mono text-[11px] text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
                        Active: {Math.round(seq.firstDelayMs / 20)}f buffer →{' '}
                        {Math.max(1, Math.round(seq.intervalMs / 20))}f/shot
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-2 pt-0.5">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                    <input
                      id="seq-live-aim"
                      type="checkbox"
                      checked={seq.liveAim}
                      onChange={(e) => update({ liveAim: e.target.checked })}
                      className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                    />
                    <span title="Reads the worm aim angle on every shot so you can sweep your aim mid-burst.">
                      Track Live Aim
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                    <input
                      id="seq-cancel"
                      type="checkbox"
                      checked={seq.cancelOnWeaponChange}
                      onChange={(e) => update({ cancelOnWeaponChange: e.target.checked })}
                      className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                    />
                    <span title="Stops the remaining burst immediately if the worm swaps weapons or takes knockback.">
                      Stop if Weapon Switched
                    </span>
                  </label>

                  {project.fireType === 'power' && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                      <input
                        id="seq-scale-power"
                        type="checkbox"
                        checked={seq.scaleByPower}
                        onChange={(e) => update({ scaleByPower: e.target.checked })}
                        className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                      />
                      <span title="Multiplies Launch Velocity by the player's charged power bar (0.25..1.0) on power weapons.">
                        Scale Speed by Power Bar
                      </span>
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Payload & Controls (Missiles) */}
          {seq.mode === 'missiles' && (
            <div className="space-y-3.5 border-t border-stone-200/80 pt-4 dark:border-stone-800">
              <SubSectionTitle
                title="Payload & Fuse Controls"
                code={usesNestedProjectile ? 'projectile + fuse' : 'fuse / explode_on_space'}
                desc="Configure the launched projectile donor, fuse handling, and mid-air manual detonation."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {usesNestedProjectile && (
                  <div>
                    <TooltipLabel
                      label="Payload Donor"
                      code="projectile.copy_from"
                      desc="Stock missile template copied into the nested projectile table. Your Physics, Action, Cluster, and Sprite tabs edit this payload."
                      htmlFor="seq-payload-donor"
                    />
                    <select
                      id="seq-payload-donor"
                      value={seq.payloadDonor}
                      onChange={(e) => update({ payloadDonor: e.target.value })}
                      className={selectClass}
                    >
                      {MISSILE_DONORS.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} (stock.{w.id})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <TooltipLabel
                    label="Fuse Handling"
                    code="fuse"
                    desc="Record keeps the projectile record's own fuse. Player Aim Keys (1-5) reads the player's digit key while aiming. Fixed Timer sets an explicit millisecond fuse."
                    htmlFor="seq-fuse-mode"
                  />
                  <select
                    id="seq-fuse-mode"
                    value={seq.fuseMode}
                    onChange={(e) =>
                      update({ fuseMode: e.target.value as FireSequenceFuseMode })
                    }
                    className={selectClass}
                  >
                    <option value="record">Use Record Fuse</option>
                    <option value="aim">Player Aim Keys (1–5s)</option>
                    <option value="fixed">Fixed Milliseconds</option>
                  </select>
                </div>

                {seq.fuseMode === 'fixed' &&
                  seqNum(
                    'seq-fuse-fixed',
                    'Fixed Fuse Timer',
                    'fuse',
                    'Detonation timer in milliseconds applied to every launched round.',
                    'fuseFixedMs',
                    { min: 0, max: 30000, step: 100, unit: 'ms' },
                  )}
              </div>

              {autoAimFuse && (
                <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  <span className="font-semibold">Auto Aim-Key Fuse</span>: this record&apos;s fuse
                  is 0 ms (grenade-style), so <code className="font-mono">wfws_firing</code>{' '}
                  automatically passes the player&apos;s 1–5 key timer (default 3000 ms) so rounds
                  do not detonate on frame 1.
                </p>
              )}

              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    id="seq-explode-space"
                    type="checkbox"
                    checked={seq.explodeOnSpace}
                    onChange={(e) => update({ explodeOnSpace: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span title="Binds WA's Spacebar early detonation (Chilli Bomb style) to every round launched by this burst.">
                    Detonate Mid-Air on Spacebar (explode_on_space)
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Lockstep Click-to-Mark Homing */}
          {seq.mode === 'missiles' && (
            <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SubSectionTitle
                  title="Lockstep Click-to-Mark Homing"
                  code='click = "homing" + firing.homing'
                  desc="Adds a cursor target picker before firing and steers every launched round toward the marked point using PX's two-phase deterministic turn law."
                />
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    id="seq-homing-enabled"
                    type="checkbox"
                    checked={seq.homing.enabled}
                    onChange={(e) => updateHoming({ enabled: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span className="flex items-center gap-1 text-xs font-semibold text-stone-700 dark:text-stone-300">
                    <Target className="h-3.5 w-3.5 text-forge-500" aria-hidden="true" />
                    Enable Homing
                  </span>
                </label>
              </div>

              {seq.homing.enabled && (
                <div className="space-y-3 rounded-xl border border-stone-200/80 bg-stone-50/70 p-3.5 dark:border-stone-800 dark:bg-stone-950/40">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                      <TooltipLabel
                        label="Homing Speed"
                        code="homing.speed"
                        desc="Target cruise velocity in pixels/frame once homing engages."
                        htmlFor="seq-homing-speed"
                      />
                      <UnitNumberInput
                        id="seq-homing-speed"
                        min={1}
                        max={60}
                        step={0.5}
                        unit="px/f"
                        value={seq.homing.speed}
                        onChange={(e) => updateHoming({ speed: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Turn Rate"
                        code="homing.turn"
                        desc="Angular turn gain per 50 Hz frame (0.20 is standard PX homing)."
                        htmlFor="seq-homing-turn"
                      />
                      <UnitNumberInput
                        id="seq-homing-turn"
                        min={0.01}
                        max={2}
                        step={0.02}
                        unit="rad"
                        value={seq.homing.turn}
                        onChange={(e) => updateHoming({ turn: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Duration"
                        code="homing.frames"
                        desc="Active homing ticks at 50 Hz (180 = 3.6 seconds)."
                        htmlFor="seq-homing-frames"
                      />
                      <UnitNumberInput
                        id="seq-homing-frames"
                        min={1}
                        max={1000}
                        unit="f"
                        value={seq.homing.frames}
                        onChange={(e) => updateHoming({ frames: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Arm Delay"
                        code="homing.delay"
                        desc="Ballistic flight ticks before guidance locks on (10 = 0.2 seconds)."
                        htmlFor="seq-homing-delay"
                      />
                      <UnitNumberInput
                        id="seq-homing-delay"
                        min={0}
                        max={250}
                        unit="f"
                        value={seq.homing.delay}
                        onChange={(e) => updateHoming({ delay: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <TooltipLabel
                        label="Lock Sound ID"
                        code="homing.sound"
                        desc="Optional WA sound bank ID played when guidance engages (0 = silent)."
                        htmlFor="seq-homing-sound"
                      />
                      <NumberInput
                        id="seq-homing-sound"
                        min={0}
                        max={255}
                        value={seq.homing.sound}
                        onChange={(e) => updateHoming({ sound: Number(e.target.value) })}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                    <input
                      id="seq-homing-pershot"
                      type="checkbox"
                      checked={seq.homing.perShotTarget}
                      onChange={(e) => updateHoming({ perShotTarget: e.target.checked })}
                      className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                    />
                    <span title="Reads wa.world.target() freshly on each shot instead of locking the target once at burst start.">
                      Re-read Cursor Target Every Shot
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Actor Settings */}
          {seq.mode === 'actors' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-stone-50/70 p-3.5 dark:bg-stone-950/40">
              <div>
                <TooltipLabel
                  label="Actor Sprite Path"
                  code="actor.sprite"
                  desc="Bundle-relative path (e.g. sprites/<mod>/bullet.png) for Lua-driven actors."
                  htmlFor="seq-actor-sprite"
                />
                <input
                  id="seq-actor-sprite"
                  type="text"
                  value={seq.actorSprite}
                  placeholder="sprites/<mod>/bullet.png"
                  onChange={(e) => update({ actorSprite: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-wrap items-end gap-5 pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    id="seq-actor-gravity"
                    type="checkbox"
                    checked={seq.actorGravity}
                    onChange={(e) => update({ actorGravity: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span>Gravity</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    id="seq-actor-collide"
                    type="checkbox"
                    checked={seq.actorCollide}
                    onChange={(e) => update({ actorCollide: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span>Collide Terrain</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <input
                    id="seq-actor-persist"
                    type="checkbox"
                    checked={seq.actorPersist}
                    onChange={(e) => update({ actorPersist: e.target.checked })}
                    className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span>Persist Past Blasts</span>
                </label>
              </div>
            </div>
          )}

          {/* Per-Shot WAV Audio */}
          <div className="space-y-3 border-t border-stone-200/80 pt-4 dark:border-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SubSectionTitle
                title="Per-Shot Audio"
                code="sound = { path, every, priority }"
                desc="Optional custom WAV triggered by wfws_firing on every shot or every N shots in the burst."
              />
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={sounds.shotEnabled}
                  onChange={(e) => updateSounds({ shotEnabled: e.target.checked })}
                  className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                />
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Enable
                </span>
              </label>
            </div>

            {sounds.shotEnabled && (
              <div className="space-y-3 rounded-xl bg-stone-50/70 p-3.5 dark:bg-stone-950/40">
                <SoundUpload
                  id="sound-shot"
                  asset={sounds.shot}
                  onPick={(asset) => updateSounds({ shot: asset, shotEnabled: true })}
                  onRemove={() => updateSounds({ shot: undefined, shotEnabled: false })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <TooltipLabel
                      label="Play Every N Shots"
                      code="sound.every"
                      desc="Play the WAV on every Nth shot (1 = every shot; 3 plays once per 3-round burst)."
                      htmlFor="sound-shot-every"
                    />
                    <NumberInput
                      id="sound-shot-every"
                      min={1}
                      max={50}
                      value={sounds.shotEvery}
                      onChange={(e) => updateSounds({ shotEvery: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <TooltipLabel
                      label="Voice Priority"
                      code="sound.priority"
                      desc="Higher priorities override lower-priority sounds when voices are busy."
                      htmlFor="sound-shot-priority"
                    />
                    <select
                      id="sound-shot-priority"
                      value={sounds.shotPriority}
                      onChange={(e) => updateSounds({ shotPriority: Number(e.target.value) })}
                      className={selectClass}
                    >
                      {SOUND_PRIORITIES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
