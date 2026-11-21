import type { EmitterConfig, EmitterRingConfig, EmitterTrailConfig, WeaponProject } from '../types/weapon';

/**
 * PX's effect manager as a live emitter. The numbers below are its own:
 * `CEffectManager`'s constructor (`utils_red/px_effects.c:51`) takes
 * (type, segments, radius, noise, r, g, b) and derives the beam widths from the
 * radius (`sizeValue = radius / 100`, core `sizeValue * 10` clamped to 2.3..5.5,
 * glow three times that), and the reach/down/sky numbers are the calls the PX
 * ports make: `createElectricImpact` (effects_methods.c:2) and the mine's
 * thunder in `px_electric/lib/taze_mine.lua`.
 *
 * The two presets mirror `fx.PRESETS` in `effects_sdk/libs/px_effects.lua`, so a
 * card set to a preset emits the same table the library would have built.
 */
/**
 * The `fx.PRESETS` numbers the card does not edit: the spark's cycle, the glow's
 * three passes, and the bolt cooldowns. The preview plays them, so they live
 * here rather than being copied into `EmitterPreview`.
 */
export interface EmitterPresetFx {
  spark: { cell: number; frames: number; size: number; rate: number; pause: number };
  glow: { cell: number; size: number; passes: number };
  bolts: {
    /** Degrees in screen coordinates: 0 right, 90 down, -90 up. */
    direction: number;
    /** Total spread in degrees around direction. */
    spread: number;
    first: readonly [number, number];
    stagger: number;
    cooldown: readonly [number, number];
    /** `from = "below"`: the bolt runs down out of the emitter. */
    down?: readonly [number, number];
    downSide?: number;
    /** Frames a finished bolt stays lit, and frames it fades over. */
    hold?: number;
    fade?: number;
  };
}

export const EMITTER_PRESETS: Record<
  EmitterConfig['preset'],
  { label: string; hint: string; patch: Partial<EmitterConfig>; fx: EmitterPresetFx }
> = {
  electric: {
    label: 'Electric',
    hint: 'PX createElectricImpact: two short crackling bolts and a spark, 35 px reach',
    patch: {
      spark: true,
      glow: true,
      reach: true,
      reachCount: 2,
      reachDistance: 35,
      reachDirection: 0,
      reachSpread: 360,
      reachSpeed: 12,
      reachCurve: 'arc',
      reachBulge: 130,
      reachNoise: 4,
      reachSegments: 16,
      reachCoreWidth: 8,
      reachGlowWidth: 13,
      color: '#82b4ff',
    },
    fx: {
      spark: { cell: 60, frames: 10, size: 0.4, rate: 0.02, pause: 0.1 },
      glow: { cell: 128, size: 0.18, passes: 3 },
      bolts: { direction: 0, spread: 360, first: [6, 22], stagger: 12, cooldown: [13, 51] },
    },
  },
  thunder: {
    label: 'Thunder',
    hint: 'marked_for_death: one long bolt from below, no spark or glow, 9 px jitter',
    patch: {
      spark: false,
      glow: false,
      reach: true,
      reachCount: 1,
      reachDistance: 0,
      reachDirection: 90,
      reachSpread: 0,
      reachSpeed: 50,
      reachCurve: 'line',
      reachBulge: 0,
      reachNoise: 9,
      reachSegments: 14,
      reachCoreWidth: 5,
      reachGlowWidth: 12,
      color: '#d7beff',
    },
    fx: {
      spark: { cell: 60, frames: 10, size: 0.4, rate: 0.02, pause: 0.1 },
      glow: { cell: 128, size: 0.18, passes: 3 },
      bolts: {
        first: [20, 80],
        stagger: 0,
        cooldown: [30, 110],
        down: [40, 80],
        downSide: 16,
        direction: 90,
        spread: 0,
        hold: 3,
        fade: 20,
      },
    },
  },
};

export const DEFAULT_EMITTER_RING: EmitterRingConfig = {
  enabled: false,
  radius: 30,
  segments: 20,
  noise: 1,
  speed: 0,
  angle: 0,
  coreWidth: 0,
  glowWidth: 0,
  thin: false,
  ellipseX: 1,
  ellipseY: 1,
  track: false,
  color: '#82b4ff',
  rainbow: false,
};

export const DEFAULT_EMITTER_TRAIL: EmitterTrailConfig = {
  enabled: false,
  max: 12,
  every: 2,
  noise: 0,
  coreWidth: 8,
  glowWidth: 13,
  color: '#82b4ff',
  rainbow: false,
};

export const DEFAULT_EMITTER: EmitterConfig = {
  enabled: false,
  anchor: 'muzzle',
  carry: true,
  projectileExclusive: false,
  followFireAngle: true,
  // PX's `curDist = 25` along the fire angle (`railgun_test.txt`), the point a
  // railgun's ring sits at so it looks like it leaves the barrel.
  offsetX: 25,
  offsetY: 0,
  radialAngle: 0,
  posX: 0,
  posY: 0,
  preset: 'electric',
  ...EMITTER_PRESETS.electric.patch,
  spark: true,
  glow: true,
  reach: true,
  reachCount: 2,
  reachDistance: 35,
  reachDirection: 0,
  reachSpread: 360,
  reachSpeed: 12,
  reachCurve: 'arc',
  reachBulge: 130,
  reachNoise: 4,
  reachSegments: 16,
  reachCoreWidth: 8,
  reachGlowWidth: 13,
  color: '#82b4ff',
  ring: { ...DEFAULT_EMITTER_RING },
  trail: { ...DEFAULT_EMITTER_TRAIL },
  rainbow: false,
};

/**
 * An emitter needs something to ride. A melee claim eats WA's fire and draws a
 * swing instead, so it has no muzzle to sit at and no round to follow.
 */
export function supportsEmitter(project: WeaponProject): boolean {
  return project.fireType !== 'melee';
}

/**
 * `anchor = 'round'` follows a missile WA builds from this record, so the
 * family has to have one: a placed mine is a mine entity, not a missile, and a
 * strike's bombs carry no `m.weapon` to recognise them by.
 */
export function supportsEmitterRound(project: WeaponProject): boolean {
  return (
    project.fireType === 'power' ||
    (project.fireType === 'drop' && !!project.body.fuse) ||
    (project.fireType === 'cursor' &&
      !project.teleport &&
      !!project.airstrike?.enabled &&
      (project.airstrike.payload?.kind ?? 'missile') === 'missile')
  );
}
