import type {
  FireSequenceConfig,
  FireSequenceEngine,
  FireSequenceHoming,
  WeaponProject,
} from '../types/weapon';

/**
 * `wf-lib/wfws_firing` fires a burst from one `on_fire`. It needs a weapon whose
 * `on_fire` the engine runs: a missile, a thrown weapon, a gun or a special.
 * Air strikes drop bombs from the aircraft rather than firing from a worm slot,
 * and melee claims already own `on_fire` for their ghost shot.
 */
export function supportsFireSequence(project: WeaponProject): boolean {
  if (project.fireType === 'cursor' && !project.teleport) return false;
  if (project.fireType === 'melee' || project.melee?.enabled) return false;
  return true;
}

export const DEFAULT_FIRE_SEQUENCE_HOMING: FireSequenceHoming = {
  enabled: false,
  speed: 14,
  turn: 0.2,
  frames: 180,
  delay: 10,
  sound: 0,
  perShotTarget: false,
};

export const DEFAULT_FIRE_SEQUENCE: FireSequenceConfig = {
  enabled: false,
  engine: 'native',
  mode: 'missiles',
  count: 8,
  intervalMs: 60,
  firstDelayMs: 0,
  customIntervalsMs: '',
  burstSize: 1,
  spreadDeg: 0,
  payloadDonor: 'bazooka',
  fuseMode: 'record',
  fuseFixedMs: 3000,
  explodeOnSpace: false,
  scaleByPower: false,
  homing: { ...DEFAULT_FIRE_SEQUENCE_HOMING },
  delay: 3,
  speed: 14,
  standoff: 24,
  spreadX: 0,
  spreadY: 0,
  offsetX: 0,
  offsetY: -3,
  liveAim: true,
  cancelOnWeaponChange: true,
  beamSequenceAnchor: 'on_dispatch',
  actorSprite: '',
  actorGravity: false,
  actorCollide: false,
  actorPersist: false,
};

/** Parse a comma/space-separated list of millisecond delays (e.g. "300, 20, 20"). */
export function parseCustomIntervalsMs(raw?: string): number[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[\s,;]+/)
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => Math.round(n));
}

/** Merge saved or partial FireSequenceConfig with current defaults cleanly. */
export function mergeFireSequenceConfig(
  raw?: Partial<FireSequenceConfig> | null,
): Required<
  Pick<
    FireSequenceConfig,
    | 'enabled'
    | 'engine'
    | 'mode'
    | 'count'
    | 'intervalMs'
    | 'firstDelayMs'
    | 'customIntervalsMs'
    | 'burstSize'
    | 'spreadDeg'
    | 'payloadDonor'
    | 'fuseMode'
    | 'fuseFixedMs'
    | 'explodeOnSpace'
    | 'scaleByPower'
    | 'delay'
    | 'speed'
    | 'standoff'
    | 'spreadX'
    | 'spreadY'
    | 'offsetX'
    | 'offsetY'
    | 'liveAim'
    | 'cancelOnWeaponChange'
    | 'beamSequenceAnchor'
    | 'actorSprite'
    | 'actorGravity'
    | 'actorCollide'
    | 'actorPersist'
  >
> & { homing: FireSequenceHoming } {
  const src = raw ?? {};
  // Legacy projects saved before `engine` existed used `delay` in frames.
  const hasLegacyOnly =
    src.engine === undefined &&
    src.enabled === true &&
    (src.intervalMs === undefined ||
      (src.spreadX ?? 0) > 0 ||
      (src.spreadY ?? 0) > 0 ||
      src.liveAim === false);
  const engine: FireSequenceEngine =
    src.engine === 'timed' || src.engine === 'native'
      ? src.engine
      : hasLegacyOnly
        ? 'timed'
        : DEFAULT_FIRE_SEQUENCE.engine!;
  const delay = Math.max(1, Math.round(src.delay ?? DEFAULT_FIRE_SEQUENCE.delay));
  const intervalMs = Math.max(
    0,
    Math.round(src.intervalMs ?? (src.delay !== undefined ? delay * 20 : DEFAULT_FIRE_SEQUENCE.intervalMs!)),
  );
  return {
    enabled: !!src.enabled,
    engine,
    mode: src.mode === 'actors' ? 'actors' : 'missiles',
    count: Math.max(1, Math.round(src.count ?? DEFAULT_FIRE_SEQUENCE.count)),
    intervalMs,
    firstDelayMs: Math.max(0, Math.round(src.firstDelayMs ?? 0)),
    customIntervalsMs: src.customIntervalsMs ?? '',
    burstSize: Math.max(1, Math.round(src.burstSize ?? 1)),
    spreadDeg: Math.max(0, Number(src.spreadDeg ?? 0)),
    payloadDonor: (src.payloadDonor || DEFAULT_FIRE_SEQUENCE.payloadDonor!).replace(/^stock\./, ''),
    fuseMode:
      src.fuseMode === 'aim' || src.fuseMode === 'fixed' || src.fuseMode === 'record'
        ? src.fuseMode
        : 'record',
    fuseFixedMs: Math.max(0, Math.round(src.fuseFixedMs ?? 3000)),
    explodeOnSpace: !!src.explodeOnSpace,
    scaleByPower: !!src.scaleByPower,
    homing: {
      ...DEFAULT_FIRE_SEQUENCE_HOMING,
      ...(src.homing ?? {}),
    },
    delay,
    speed: Number(src.speed ?? DEFAULT_FIRE_SEQUENCE.speed),
    standoff: Math.max(0, Number(src.standoff ?? DEFAULT_FIRE_SEQUENCE.standoff)),
    spreadX: Math.max(0, Number(src.spreadX ?? 0)),
    spreadY: Math.max(0, Number(src.spreadY ?? 0)),
    offsetX: Number(src.offsetX ?? 0),
    offsetY: Number(src.offsetY ?? -3),
    liveAim: src.liveAim !== false,
    cancelOnWeaponChange: src.cancelOnWeaponChange !== false,
    beamSequenceAnchor: src.beamSequenceAnchor === 'after_hold' ? 'after_hold' : 'on_dispatch',
    actorSprite: src.actorSprite ?? '',
    actorGravity: !!src.actorGravity,
    actorCollide: !!src.actorCollide,
    actorPersist: !!src.actorPersist,
  };
}

export interface BeamShotSchedule {
  /** 50 Hz frame index (relative to trigger pull = 0) when each shot dispatches its ray. */
  dispatchFrames: number[];
  /** Millisecond waits array emitted into `SEQ.intervals_ms` when custom or anchored after hold. */
  emittedIntervalsMs: number[] | null;
  /** Opening wait before shot 1 in frames. */
  firstWaitFrames: number;
  /** Extra spacing added per shot when anchored after hold (in frames). */
  anchorPadFrames: number;
}

/**
 * Single source of truth for beam + sequence timing, shared by `luaGenerator`,
 * `BeamPreview`, `BeamCard`, and `FireSequenceCard`.
 *
 * - `on_dispatch`: next shot's delay begins the moment the current beam dispatches
 *   (the worm is not held until the beam fades, allowing overlapping pulses or
 *   re-animating immediately).
 * - `after_hold`: waits for the current beam's active `grow + hold` duration before
 *   counting the inter-shot cooldown.
 */
export function computeBeamSequenceSchedule(
  beam: { bufferFrames: number; growFrames: number; holdFrames: number },
  seq: Pick<
    FireSequenceConfig,
    'count' | 'firstDelayMs' | 'intervalMs' | 'customIntervalsMs' | 'beamSequenceAnchor'
  >,
): BeamShotSchedule {
  const count = Math.max(1, Math.round(seq.count ?? 1));
  const anchorPadFrames =
    seq.beamSequenceAnchor === 'after_hold'
      ? Math.max(0, Math.round(beam.growFrames) + Math.round(beam.holdFrames))
      : 0;
  const anchorPadMs = anchorPadFrames * 20;
  const custom = parseCustomIntervalsMs(seq.customIntervalsMs);
  const effectiveFirstMs =
    custom.length > 0
      ? custom[0]
      : Math.max(0, Math.round(seq.firstDelayMs ?? beam.bufferFrames * 20));
  const baseIntervalMs = Math.max(20, Math.round(seq.intervalMs ?? 100));

  const dispatchFrames: number[] = [];
  let cursor = Math.max(0, Math.round(effectiveFirstMs / 20));
  dispatchFrames.push(cursor);
  for (let i = 1; i < count; i += 1) {
    const rawMs =
      custom.length > 0
        ? custom[Math.min(i, custom.length - 1)]
        : baseIntervalMs;
    const waitFrames = Math.max(1, Math.round((rawMs + anchorPadMs) / 20));
    cursor += waitFrames;
    dispatchFrames.push(cursor);
  }

  let emittedIntervalsMs: number[] | null = null;
  if (custom.length > 0) {
    emittedIntervalsMs = custom.map((ms, idx) => (idx === 0 ? ms : ms + anchorPadMs));
  }

  return {
    dispatchFrames,
    emittedIntervalsMs,
    firstWaitFrames: dispatchFrames[0] ?? 0,
    anchorPadFrames,
  };
}

/** True when sequential fire is enabled and launching missile rounds. */
export function fireSequenceMissileActive(project: WeaponProject): boolean {
  if (!project.fireSequence?.enabled) return false;
  if (!supportsFireSequence(project)) return false;
  if (project.fireType === 'beam') return false;
  return project.fireSequence.mode !== 'actors';
}

/**
 * True when the weapon's missile/cluster tables must be emitted inside a nested
 * `projectile = { copy_from = "stock.<donor>", ... }` sub-table for sequential fire:
 *  - Always in `native` engine (main record is a gun with `gun.bullets` + `shot_interval_ms`)
 *  - Also in `timed` engine whenever the main weapon record itself cannot build a missile
 *    (gun / arrow / spray / special / mine).
 */
export function fireSequenceUsesNestedProjectile(project: WeaponProject): boolean {
  if (!fireSequenceMissileActive(project)) return false;
  const cfg = mergeFireSequenceConfig(project.fireSequence);
  if (cfg.engine === 'native') return true;
  const mainIsMissile =
    project.fireType === 'power' || (project.fireType === 'drop' && !!project.body.fuse);
  return !mainIsMissile;
}

export interface FireSequencePreset {
  id: string;
  name: string;
  desc: string;
  patch: Partial<FireSequenceConfig>;
}

export const FIRE_SEQUENCE_PRESETS: FireSequencePreset[] = [
  {
    id: 'native_rapid',
    name: 'Native Gun Burst',
    desc: 'WA native gun timing (12 rounds, 60 ms, 4° spread) with nested missile payload.',
    patch: {
      engine: 'native',
      mode: 'missiles',
      count: 12,
      intervalMs: 60,
      firstDelayMs: 0,
      customIntervalsMs: '',
      burstSize: 1,
      spreadDeg: 4,
      speed: 14,
      standoff: 24,
    },
  },
  {
    id: 'buffered_stream',
    name: '300ms Buffer → 20ms Stream',
    desc: 'Holds 300 ms animation buffer before shot 1, then fires 10 rapid rounds every 20 ms.',
    patch: {
      engine: 'timed',
      mode: 'missiles',
      count: 10,
      firstDelayMs: 300,
      intervalMs: 20,
      customIntervalsMs: '',
      burstSize: 1,
      spreadDeg: 3,
      speed: 16,
      standoff: 24,
      liveAim: true,
    },
  },
  {
    id: 'spinup_ramp',
    name: 'Spin-Up Ramp',
    desc: 'Custom per-shot cooldowns (240 → 160 → 100 → 60 → 40 → 20 ms) like a revving minigun.',
    patch: {
      engine: 'timed',
      mode: 'missiles',
      count: 14,
      firstDelayMs: 0,
      intervalMs: 20,
      customIntervalsMs: '240, 160, 100, 60, 40, 20',
      burstSize: 1,
      spreadDeg: 5,
      speed: 15,
      standoff: 24,
      liveAim: true,
    },
  },
  {
    id: 'homing_salvo',
    name: 'Homing Salvo',
    desc: 'Native click-to-mark homing burst of 6 missiles with Space early detonation.',
    patch: {
      engine: 'native',
      mode: 'missiles',
      count: 6,
      intervalMs: 120,
      firstDelayMs: 0,
      customIntervalsMs: '',
      burstSize: 1,
      spreadDeg: 8,
      speed: 12,
      standoff: 24,
      explodeOnSpace: true,
      homing: {
        enabled: true,
        speed: 14,
        turn: 0.22,
        frames: 200,
        delay: 12,
        sound: 0,
        perShotTarget: false,
      },
    },
  },
];

export const BEAM_SEQUENCE_PRESETS: FireSequencePreset[] = [
  {
    id: 'beam_windup_gatling',
    name: 'Wind-Up Laser Gatling',
    desc: 'Slow opening charge & ramp (280 → 180 → 120 → 80 → 40 ms) into rapid overlapping pulses.',
    patch: {
      engine: 'timed',
      count: 8,
      firstDelayMs: 280,
      intervalMs: 40,
      customIntervalsMs: '280, 180, 120, 80, 40',
      burstSize: 1,
      spreadDeg: 6,
      beamSequenceAnchor: 'on_dispatch',
      liveAim: true,
    },
  },
  {
    id: 'beam_3round_pulse',
    name: '3-Round Pulse',
    desc: 'Brief 160 ms charge then 3 crisp pulses spaced 120 ms apart.',
    patch: {
      engine: 'timed',
      count: 3,
      firstDelayMs: 160,
      intervalMs: 120,
      customIntervalsMs: '',
      burstSize: 1,
      spreadDeg: 2,
      beamSequenceAnchor: 'on_dispatch',
      liveAim: true,
    },
  },
  {
    id: 'beam_scatter_fan',
    name: 'Prism Scatter Fan',
    desc: 'Fires 5 simultaneous rays in a 28° spread fan per trigger pull.',
    patch: {
      engine: 'timed',
      count: 2,
      firstDelayMs: 120,
      intervalMs: 240,
      customIntervalsMs: '',
      burstSize: 5,
      spreadDeg: 28,
      beamSequenceAnchor: 'after_hold',
      liveAim: true,
    },
  },
  {
    id: 'beam_charge_rapid',
    name: '300ms Charge → Rapid',
    desc: '300 ms animation wind-up before shot 1, then 6 beams firing every 60 ms.',
    patch: {
      engine: 'timed',
      count: 6,
      firstDelayMs: 300,
      intervalMs: 60,
      customIntervalsMs: '',
      burstSize: 1,
      spreadDeg: 4,
      beamSequenceAnchor: 'on_dispatch',
      liveAim: true,
    },
  },
];
