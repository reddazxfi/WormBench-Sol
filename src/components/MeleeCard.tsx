import React, { useRef } from 'react';
import { Plus, Swords, Target, Trash2, Undo2, Volume2 } from 'lucide-react';
import type { CustomSoundAsset, MeleeHit, MeleeSound, WeaponProject } from '../types/weapon';
import { DEFAULT_MELEE, meleeStrikes, meleeTotalDamage } from '../data/melee';
import { SOUND_PRIORITIES } from '../data/soundPresets';
import { KeyTickInput } from './KeyTickInput';
import { NumberInput } from './NumberInput';
import { SoundUpload } from './EffectsCards';

interface MeleeCardProps {
  project: WeaponProject;
  onChange: (patch: Partial<WeaponProject>) => void;
}

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-forge-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white';

/**
 * The melee strike: the box the swing scans, the tick it lands on, and how the
 * victim is thrown. Everything here is emitted as `melee = { ... }` inside the
 * `sb.hold` spec, and the aiming manager fires the hit from its own swing clock
 * (so the hit is the same frame on every peer, and the preview's red box is the
 * box the game tests).
 */
/**
 * One strike sound: an uploaded WAV, or one of WA's own sample ids when none is.
 * The file wins (`sound_wav` over `sound`), so the id box is parked while a WAV
 * is loaded, and the priority applies to whichever of the two plays.
 */
const MeleeSoundField: React.FC<{
  role: 'hit' | 'miss';
  label: string;
  hint: string;
  sound: MeleeSound;
  onChange: (sound: MeleeSound) => void;
}> = ({ role, label, hint, sound, onChange }) => {
  const patch = (next: Partial<MeleeSound>) => onChange({ ...sound, ...next });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs font-semibold text-stone-700 dark:text-stone-300"
          title={hint}
        >
          {label}
        </span>
        <span className="text-[10px] text-stone-400 dark:text-stone-500">
          {sound.file ? 'your WAV' : 'WA id'}
        </span>
      </div>
      <SoundUpload
        id={`melee-${role}-wav`}
        asset={sound.file}
        onPick={(asset) => patch({ file: asset })}
        onRemove={() => patch({ file: undefined })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={`melee-${role}-sound`}
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500"
            title="WA's own sample id, used while no WAV is loaded. 0 is silent."
          >
            Id
          </label>
          <NumberInput
            id={`melee-${role}-sound`}
            min={0}
            max={2000}
            value={sound.id}
            disabled={!!sound.file}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (event.target.value.trim() === '' || Number.isNaN(value)) return;
              patch({ id: Math.max(0, Math.round(value)) });
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor={`melee-${role}-priority`}
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500"
            title="Voice priority: a higher value may replace a lower one when the voice pool is full. The engine's own default is 8."
          >
            Priority
          </label>
          <select
            id={`melee-${role}-priority`}
            value={sound.priority}
            onChange={(event) => patch({ priority: Number(event.target.value) })}
            className={selectClass}
          >
            {SOUND_PRIORITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

/**
 * One strike's own sample, in the table rather than a card of its own: a combo
 * that opens with a light hit and closes with a heavy one needs a sound per
 * strike, and the weapon's own hit sound is what every row without one plays.
 * An id is enough for most combos; a WAV wins over it, as everywhere else.
 */
const StrikeSoundCell: React.FC<{
  index: number;
  sound: MeleeSound | undefined;
  fallbackPriority: number;
  onChange: (sound: MeleeSound | undefined) => void;
}> = ({ index, sound, fallbackPriority, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const cell =
    'w-[48px] rounded border border-stone-300 bg-white px-1 py-0.5 text-right font-mono text-[11px] text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
  if (!sound) {
    return (
      <button
        type="button"
        onClick={() => onChange({ id: 0, priority: fallbackPriority })}
        aria-label={`Strike ${index + 1} sound`}
        title="Give this strike a sound of its own. Without one it plays the weapon's hit sound."
        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-forge-600 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-forge-400"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        own
      </button>
    );
  }
  const patch = (next: Partial<MeleeSound>) => onChange({ ...sound, ...next });
  return (
    // `flex-wrap` with a bounded width: on a phone the two icon buttons drop
    // under the id box instead of pushing the whole table wider than the screen,
    // which is what hid the column this control lives in.
    <div className="flex max-w-[108px] flex-wrap items-center gap-0.5">
      <input
        ref={inputRef}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        className="sr-only"
        aria-label={`Strike ${index + 1} sound file`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || !/\.wav$/i.test(file.name)) return;
          const asset: CustomSoundAsset = {
            file,
            fileName: file.name,
            size: file.size,
            previewUrl: URL.createObjectURL(file),
          };
          patch({ file: asset });
        }}
      />
      <NumberInput
        min={0}
        max={2000}
        value={sound.id}
        disabled={!!sound.file}
        aria-label={`Strike ${index + 1} sound id`}
        title={
          sound.file
            ? `${sound.file.fileName} plays for this strike`
            : "WA's own sample id for this strike. 0 is silent."
        }
        onChange={(event) => {
          const value = Number(event.target.value);
          if (event.target.value.trim() === '' || Number.isNaN(value)) return;
          patch({ id: Math.max(0, Math.round(value)) });
        }}
        className={cell}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={`Upload a WAV for strike ${index + 1}`}
        title="Play a WAV of your own where this strike lands."
        className={`rounded p-0.5 hover:bg-sky-50 dark:hover:bg-sky-950/40 ${sound.file ? 'text-sky-600 dark:text-sky-400' : 'text-stone-400'}`}
      >
        <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {/* A revert, not a delete: the strike keeps playing the weapon's own sound,
          and one row of a table with a row-remove bin either side needs the
          difference to be visible. */}
      <button
        type="button"
        onClick={() => onChange(undefined)}
        aria-label={`Clear strike ${index + 1} sound`}
        title={`Use the weapon's hit sound for strike ${index + 1} again`}
        className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-forge-600 dark:hover:bg-stone-700 dark:hover:text-forge-400"
      >
        <Undo2 className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
};

export const MeleeCard: React.FC<MeleeCardProps> = ({ project, onChange }) => {
  const melee = { ...DEFAULT_MELEE, ...(project.melee ?? {}) };
  const clip = project.aimClip;
  const clipTicks = Math.max(1, Math.round(clip?.ticks ?? 16));
  // The strikes, sorted by frame. Editing any of them materialises `hits`, so the
  // list is the source from then on; a weapon nobody touches keeps the single
  // `hitFrame` / `damage` shape its file was written with.
  const strikes = meleeStrikes(melee);
  const setStrikes = (next: MeleeHit[]) => update({ hits: next });
  const patchStrike = (index: number, patch: Partial<MeleeHit>) =>
    setStrikes(strikes.map((hit, i) => (i === index ? { ...hit, ...patch } : hit)));
  const pastEnd = strikes.filter((hit) => hit.frame > clipTicks).length;
  // The swing the hit rides: enabling the strike turns the Space clip on, so the
  // panel never shows a hit frame with nothing to land on.
  const swingOn = !!clip?.enabled || melee.enabled;
  const hitscan = melee.enabled && !!project.hold?.enabled && swingOn;

  const update = (patch: Partial<typeof melee>) => onChange({ melee: { ...melee, ...patch } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
            <Swords className="h-4 w-4 text-forge-600 dark:text-forge-400" aria-hidden="true" />
            Melee Strike
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-stone-500 dark:text-stone-400">
            The aiming phase is the attack. Space takes the worm for a beat, plays the held
            art&apos;s swing and lands the scan box below on every hit frame the table lists, so
            the damage is the strike and not the record&apos;s shot, and the clip is its own
            clock. The red box in the Hold page&apos;s preview is this
            box, drawn at the aim you have set there, and it stops where the Hold page&apos;s
            <span className="font-semibold"> Limit Aim</span> does.
          </p>
        </div>
        <label
          htmlFor="melee-enabled"
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-xs font-bold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
        >
          <input
            id="melee-enabled"
            type="checkbox"
            checked={melee.enabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              // The strike lands on a tick of the swing, and the swing is a clip
              // on the held art, so switching the strike on switches both on.
              // One patch, because two `onChange` calls both read the same
              // `project` and the second would undo the first.
              const patch: Partial<WeaponProject> = { melee: { ...melee, enabled } };
              if (enabled) {
                if (project.aimClip && !project.aimClip.enabled) {
                  patch.aimClip = { ...project.aimClip, enabled: true };
                }
                if (project.hold && !project.hold.enabled) {
                  patch.hold = { ...project.hold, enabled: true };
                }
              }
              onChange(patch);
            }}
            className="h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
          />
          Enable Strike
        </label>
      </div>

      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          hitscan
            ? 'border-forge-200 bg-forge-50/70 text-forge-800 dark:border-forge-800/60 dark:bg-forge-950/25 dark:text-forge-300'
            : 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-300'
        }`}
      >
        <Target className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Melee hitscan:{' '}
          <span className="font-mono font-bold">{hitscan ? 'true' : 'false'}</span>
          {hitscan
            ? ` (${strikes.length === 1 ? 'a' : `${strikes.length}`} box test${
                strikes.length === 1 ? '' : 's'
              } ${
                strikes.length === 1
                  ? `${Math.round(strikes[0].frame * 20)} ms`
                  : `${strikes.map((hit) => Math.round(hit.frame * 20)).join(' / ')} ms`
              } after Space: the hit is the strike, and the shot it fires is an invisible ghost)`
            : !melee.enabled
              ? ' (the strike is off)'
              : !project.hold?.enabled
                ? ' (turn on custom held art: the swing is the attack)'
                : ' (turn on Swing on Space in the Hold page)'}
        </span>
      </div>

      {melee.enabled && (
        <>
          {/* What Space does now: the strike, plus a shot WA can see the ammo and
              the turn end for. It used to eat the trigger, which took the ammo
              out of the shot and left the clip to end the turn itself. */}
          <p
            className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-400"
            title="A melee weapon fires a ghost: no art, no trail, no blast, no damage and no sound, so nothing leaves the worm a player can see. WA still builds the shot, which is what takes the ammo, plays the launch step and ends the turn when its own rules say so."
          >
            Space fires this weapon for real. The record&apos;s shot is a{' '}
            <strong>ghost</strong>: no art, no trail, no blast, no damage, no sound, so nothing
            leaves the worm. WA takes the ammo, plays its own launch step and ends the turn by its
            own rules, and the <strong>retreat window</strong> (5 s unless Turn Handling says
            otherwise) is the control the player keeps until the ghost dies or Space is pressed.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="melee-radius"
                className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="How far the strike reaches along the weapon, in pixels. The near edge starts at the worm's body, so a short reach is a punch and a long one is a spear."
              >
                Scan Reach (px)
              </label>
              <NumberInput
                id="melee-radius"
                min={4}
                max={200}
                value={melee.radius}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                  update({ radius: value });
                }}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="melee-width"
                className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="Half the arc's width, in pixels: how far to either side of the weapon the strike catches. A bat wants a wide one, a spear a narrow one."
              >
                Scan Width (px, each side)
              </label>
              <NumberInput
                id="melee-width"
                min={2}
                max={120}
                value={melee.width}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                  update({ width: value });
                }}
                className={inputClass}
              />
            </div>
          </div>

          {/* The strikes. A swing can land several (a three-hit combo), each on
              its own tick with its own damage and throw, so this table is the
              clip's keyframe table's twin: frames commit on blur, and the rows are
              always in the order they land. */}
          <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="Every strike the swing lands, in the order it lands. Each row is a hit of its own: a frame of the clip (20 ms each), its damage and how it throws. A frame past the end of the clip never lands, and the line below says so."
              >
                Strike Frames
              </span>
              <button
                type="button"
                onClick={() => {
                  const last = strikes[strikes.length - 1];
                  setStrikes([
                    ...strikes,
                    {
                      // A new strike eight ticks after the last, and never past
                      // the end of the clip: a frame there could never land, and
                      // the card would have to say so on every add.
                      frame: Math.min(clipTicks, (last?.frame ?? 0) + 8),
                      damage: last?.damage ?? 20,
                      power: last?.power ?? melee.pushPower,
                      lift: last?.lift ?? melee.lift,
                    },
                  ]);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-forge-300 bg-forge-50 px-2 py-1 text-[11px] font-semibold text-forge-700 hover:bg-forge-100 dark:border-forge-700 dark:bg-forge-950/50 dark:text-forge-300 dark:hover:bg-forge-900/50"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add hit
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-stone-500 dark:text-stone-400">
                    <th
                      className="px-1 pb-1 text-left font-semibold"
                      title="The 50 Hz tick of the swing this strike lands on, 20 ms each. 0 lands on the press itself."
                    >
                      Frame
                    </th>
                    <th
                      className="px-1 pb-1 text-left font-semibold"
                      title="Damage handed to WA's own hit for this strike, so it goes through the normal health and knockback code."
                    >
                      Damage
                    </th>
                    {melee.pushMode === 'aim' ? (
                      <th
                        className="px-1 pb-1 text-left font-semibold"
                        title="This strike's shove along the aim, in WA's hurt speed (px per frame)."
                      >
                        Power
                      </th>
                    ) : (
                      <>
                        <th
                          className="px-1 pb-1 text-left font-semibold"
                          title="This strike's literal horizontal throw. Blank uses the weapon's own vx."
                        >
                          vx
                        </th>
                        <th
                          className="px-1 pb-1 text-left font-semibold"
                          title="This strike's literal vertical throw. Blank uses the weapon's own vy."
                        >
                          vy
                        </th>
                      </>
                    )}
                    <th
                      className="px-1 pb-1 text-left font-semibold"
                      title="Upward lift on this strike's throw, in px per frame (positive is up)."
                    >
                      Lift
                    </th>
                    <th
                      className="px-1 pb-1 text-left font-semibold"
                      title="This strike's own sound, played where it lands: a lighter jab before the heavy hit. A row with none plays the weapon's hit sound above."
                    >
                      Sound
                    </th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {strikes.map((hit, index) => {
                    // 52 px, not 62: six columns (frame, damage, power, lift, the
                    // strike's sound, remove) plus the card's padding is what a
                    // 390 px phone has room for, and the sound column is the one
                    // that used to fall off the end of the scroll.
                    const cell =
                      'w-[52px] rounded border border-stone-300 bg-white px-1 py-0.5 text-right font-mono text-[11px] text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
                    const field = (
                      ariaLabel: string,
                      value: number,
                      patch: (value: number) => Partial<MeleeHit>,
                      step = 1,
                      // Only damage and power are non-negative: a negative vy is an
                      // upward throw, and vx and lift take a sign too.
                      min?: number,
                    ) => (
                      <NumberInput
                        step={step}
                        min={min}
                        aria-label={ariaLabel}
                        value={value}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (event.target.value.trim() === '' || Number.isNaN(next)) return;
                          patchStrike(index, patch(next));
                        }}
                        className={cell}
                      />
                    );
                    return (
                      <tr key={index} className={hit.frame > clipTicks ? 'opacity-60' : ''}>
                        <td className="px-1 py-0.5">
                          <KeyTickInput
                            label={`Strike ${index + 1} frame`}
                            value={hit.frame}
                            onCommit={(value) => patchStrike(index, { frame: value })}
                            className={cell}
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          {field(
                            `Strike ${index + 1} damage`,
                            hit.damage,
                            (value) => ({ damage: value }),
                            1,
                            0,
                          )}
                        </td>
                        {melee.pushMode === 'aim' ? (
                          <td className="px-1 py-0.5">
                            {field(
                              `Strike ${index + 1} power`,
                              hit.power,
                              (value) => ({ power: value }),
                              0.5,
                              0,
                            )}
                          </td>
                        ) : (
                          <>
                            <td className="px-1 py-0.5">
                              {field(
                                `Strike ${index + 1} vx`,
                                hit.vx ?? melee.pushVx,
                                (value) => ({ vx: value }),
                                0.5,
                              )}
                            </td>
                            <td className="px-1 py-0.5">
                              {field(
                                `Strike ${index + 1} vy`,
                                hit.vy ?? melee.pushVy,
                                (value) => ({ vy: value }),
                                0.5,
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-1 py-0.5">
                          {field(
                            `Strike ${index + 1} lift`,
                            hit.lift,
                            (value) => ({ lift: value }),
                            0.5,
                          )}
                        </td>
                        <td className="px-1 py-0.5">
                          <StrikeSoundCell
                            index={index}
                            sound={hit.sound}
                            fallbackPriority={melee.hitSound?.priority ?? 8}
                            onChange={(sound) =>
                              patchStrike(index, { sound: sound as MeleeSound })
                            }
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          <button
                            type="button"
                            aria-label={`Remove strike ${index + 1}`}
                            title={
                              strikes.length === 1
                                ? 'A swing lands at least one strike.'
                                : 'Remove this strike.'
                            }
                            disabled={strikes.length === 1}
                            onClick={() => setStrikes(strikes.filter((_, i) => i !== index))}
                            className="rounded p-0.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone-400 dark:hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
              {strikes.length === 1
                ? `Lands ${Math.round(strikes[0].frame * 20)} ms into a ${clipTicks}-tick swing`
                : `${strikes.length} strikes, ${meleeTotalDamage(
                    melee,
                  )} damage on a worm that stands in the box for all of them`}
              {pastEnd > 0
                ? pastEnd === 1
                  ? ': one frame is past the end of the clip, so that strike never lands'
                  : `: ${pastEnd} frames are past the end of the clip, so they never land`
                : ''}
            </p>
          </div>

          <label
            htmlFor="melee-follow-swing"
            title="Scan along the drawn swing angle at the hit frame instead of the aim pose. A cut through an arc then sweeps the box with the art, which is how an overhead swing reaches an overhead worm."
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
          >
            <input
              id="melee-follow-swing"
              type="checkbox"
              checked={melee.followSwing}
              onChange={(event) => update({ followSwing: event.target.checked })}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Follow the swing direction</span>
              <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                On: the box turns with the blade&apos;s angle at the hit frame. Off: it stays
                straight along the aim, whatever the art is doing.
              </span>
            </span>
          </label>

          <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="melee-push-mode"
                  className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                  title="How the victim is thrown: away along the weapon (the aim), or a fixed vx/vy of your own."
                >
                  Hit Direction
                </label>
                <select
                  id="melee-push-mode"
                  value={melee.pushMode}
                  onChange={(event) =>
                    update({ pushMode: event.target.value as 'aim' | 'fixed' })
                  }
                  className={selectClass}
                >
                  <option value="aim">Along the aim (the weapon&apos;s direction)</option>
                  <option value="fixed">Fixed vx / vy</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="melee-kind"
                  className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                  title="The hit kind. Electrical needs the weapon to declare px.electric, which the strike adds itself."
                >
                  Damage Type
                </label>
                <select
                  id="melee-kind"
                  value={melee.kind}
                  onChange={(event) => update({ kind: event.target.value as 'normal' | 'taze' })}
                  className={selectClass}
                >
                  <option value="normal">Normal</option>
                  <option value="taze">Electrical (taze)</option>
                </select>
              </div>
            </div>

            {melee.pushMode === 'fixed' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="melee-push-vx"
                    className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                    title="The weapon's own literal horizontal throw, used by any strike whose vx column is left on it. In WA's hurt units (px per frame); positive is to the right on screen."
                  >
                    Default vx
                  </label>
                  <NumberInput
                    id="melee-push-vx"
                    step={0.5}
                    min={-20}
                    max={20}
                    value={melee.pushVx}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                      update({ pushVx: value });
                    }}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="melee-push-vy"
                    className="mb-1 block text-xs font-semibold text-stone-700 dark:text-stone-300"
                    title="The weapon's own literal vertical throw, used by any strike whose vy column is left on it, in WA's hurt units (px per frame). Negative is up."
                  >
                    Default vy
                  </label>
                  <NumberInput
                    id="melee-push-vy"
                    step={0.5}
                    min={-20}
                    max={20}
                    value={melee.pushVy}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                      update({ pushVy: value });
                    }}
                    className={inputClass}
                  />
                </div>
              </div>
            )}
            {melee.pushMode === 'aim' && (
              <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                Power is a column of the strike table above: each hit shoves along the aim at its
                own strength, so a combo can end with the heavy one.
              </p>
            )}
          </div>

          {/* The strike's own sounds. The claim eats WA's fire, so the record's
              sound never plays: a swing that comes off nothing is silent unless
              the layer says otherwise. Either role takes one of WA's ids or an
              uploaded WAV, and the file wins. */}
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                title="Played at the worm a strike lands on (the hit) or at the striker when a strike takes nobody (the whiff). Either can be one of WA's own sample ids or an uploaded PCM WAV; a WAV wins over the id and needs no stock sample slot. The default whiff is 96, the one WA plays for a grenade throw and for the baseball bat coming off nothing."
              >
                Strike Sounds
              </span>
              <span className="text-[10px] text-stone-400 dark:text-stone-500">
                WA id or your own WAV
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MeleeSoundField
                role="hit"
                label="Hit Sound"
                hint="Played where each strike lands, at the worm it took. Every strike plays it once, however many worms it takes, and a strike row in the table above can name a sample of its own instead: that is how a combo opens light and ends heavy."
                sound={melee.hitSound}
                onChange={(sound) => update({ hitSound: sound })}
              />
              <MeleeSoundField
                role="miss"
                label="Miss Sound"
                hint="Played at the striker when a strike lands on nothing, which is the only way a whiff is heard: the claim eats WA's fire, so the record's own sound never plays. 96 is WA's grenade throw and the baseball bat's miss."
                sound={melee.missSound}
                onChange={(sound) => update({ missSound: sound })}
              />
            </div>
            <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
              Each strike plays one of them: its own sound when the table above gives it one, else
              the hit sound, where it lands; the miss sound when it reaches nobody.{' '}
              {strikes.length === 1
                ? 'One strike, one play.'
                : `${strikes.length} strikes, up to ${strikes.length} plays.`}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label
              htmlFor="melee-once"
              title="Each strike hits a worm once. Off means a strike keeps hitting every frame its box overlaps, which drains health fast."
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
            >
              <input
                id="melee-once"
                type="checkbox"
                checked={melee.oncePerTarget}
                onChange={(event) => update({ oncePerTarget: event.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
              />
              <span className="text-xs text-stone-700 dark:text-stone-300">
                <span className="font-semibold">One hit per worm</span>
                <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                  Per strike, not per frame: a worm in the box for a three-hit combo takes all
                  three.
                </span>
              </span>
            </label>
            <label
              htmlFor="melee-spare-shooter"
              title="Leave the worm holding the weapon out of its own strike, so a long reach cannot hit the swinger."
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
            >
              <input
                id="melee-spare-shooter"
                type="checkbox"
                checked={melee.spareShooter}
                onChange={(event) => update({ spareShooter: event.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
              />
              <span className="text-xs text-stone-700 dark:text-stone-300">
                <span className="font-semibold">Spare the firing worm</span>
                <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                  Never hit the worm that swung.
                </span>
              </span>
            </label>
          </div>

          <label
            htmlFor="melee-log"
            title="Print the swing and the strike to WormBench's log: the hit tick, the scan vector and every worm the box took. It is the only way to tell a swing that never started from one that started and found nothing."
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
          >
            <input
              id="melee-log"
              type="checkbox"
              checked={melee.log}
              onChange={(event) => update({ log: event.target.checked })}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
            />
            <span className="text-xs text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Log the strike</span>
              <span className="block text-[11px] text-stone-500 dark:text-stone-400">
                Print the hit tick, the scan direction and every worm it took ({' '}
                <span className="font-mono">log = true</span>).
              </span>
            </span>
          </label>

          <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] leading-snug text-stone-600 dark:border-stone-700 dark:bg-stone-950/30 dark:text-stone-400">
            Tip: the Hold page&apos;s aim slider picks which posture the box is drawn at, and the
            swing card there sets the angle the box follows. The swing takes the worm
            (<span className="font-mono">worm:take</span>), so the clip is its own clock, and the
            weapon still fires: the record&apos;s shot is a ghost, which is what spends the ammo and
            lets WA end the turn by its own rules.
          </p>
        </>
      )}
    </div>
  );
};

export default MeleeCard;
