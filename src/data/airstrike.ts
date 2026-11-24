import type { AirstrikeConfig, WeaponProject } from '../types/weapon';

/**
 * Stock WA plane / carrier sprite names accepted directly by `wa.actors.spawn`.
 * Authors can pick one of these or upload a custom PNG strip instead.
 */
export const STOCK_PLANE_SPRITES: { id: string; label: string; hint: string }[] = [
  { id: 'airjetg', label: 'Green Air Jet (airjetg)', hint: 'Stock Air Strike jet.' },
  { id: 'airjetb', label: 'Blue Air Jet (airjetb)', hint: 'Stock Napalm Strike jet.' },
  { id: 'airjeto', label: 'Orange Air Jet (airjeto)', hint: 'Stock Mine Strike jet.' },
  { id: 'postbox', label: 'Mail Strike Postbox (postbox)', hint: 'Stock Mail Strike carrier.' },
  { id: 'shptruck', label: 'Sheep Truck (shptruck)', hint: 'Stock French Sheep Strike carrier.' },
  { id: 'cpttruck', label: 'Carpet Truck (cpttruck)', hint: 'Stock Carpet Bomb carrier.' },
];

/**
 * Clean stock-like Air Strike defaults matching `wfws_airstrike.lua`'s
 * `normalize_spec`. Starts `enabled: false` so untouched strikes keep emitting
 * the native record path byte-for-byte.
 */
export const DEFAULT_AIRSTRIKE: AirstrikeConfig = {
  enabled: false,
  direction: 'arrows',
  defaultDir: 1,
  zeroVxUsesFacing: false,
  stopOnTurnEnd: true,

  entry: {
    mode: 'offmap',
    y: null,
    side: 16,
    spawnAt: 'sky',
    dropOffsetX: 0,
  },

  plane: {
    spriteMode: 'stock',
    stockSprite: 'airjetg',
    frames: 1,
    fps: 15,
    play: 'loop',
    scale: 1,
    facingFlip: true,
    bankAngleApproach: 0,
    bankAngleRelease: 0,
    bankRate: 0.6,
    collide: false,
    asObject: false,
    hp: 0,
    deadDamage: 25,
    crashOnTerrain: false,
    crashOnWater: true,
    boomMode: 'native',
    boomDamage: 80,
    boomKind: 100,
    boomBelow: false,
    boomRadius: 120,
    boomPushPct: 100,
    boomCraterRadius: 60,
    boomHitKind: 'blast',
    boomVisual: 'native',
    boomSound: { id: 0 },
    boomFires: 0,
    boomFxBurst: {
      enabled: false,
      color: '#ff7a2f',
      radius: 64,
      smoke: true,
    },
    exitMargin: 64,
    timeoutFrames: 900,
    fadeOutFrames: 0,
    soundEnter: { id: 0 },
    soundLoop: { id: 0 },
    soundLoopTicks: 47,
    soundExit: { id: 0 },
    parts: [],
  },

  speed: {
    cruise: 16,
    release: null,
    min: 0,
    exit: null,
    decel: 0,
    damping: 1,
    releaseDamping: 1,
    accel: 0,
    growth: 1,
    recoverMode: 'ramp',
    recoverDelay: 0,
    recoverMin: 0.15,
    slowDistance: 0,
    engageRange: 0,
    altitudeMode: 'level',
    diveVy: 0,
  },

  release: {
    mode: 'drop',
    pattern: 'sequential',
    count: 5,
    cadenceUnit: 'distance',
    spacing: 32,
    framesBetween: 3,
    minFrames: 0,
    burstSize: 5,
    perTick: 1,
    window: 160,
    offsets: [-60, -30, 0, 30, 60],
    windup: 0,
    lead: true,
    leadMaxBack: 0,
    leadInertiaY: 0,
    jitterX: 0,
    jitterY: 0,
    jitterVx: 0,
    jitterVy: 0,
    sound: { id: 0 },
    soundCooldown: 0,
  },

  strafe: {
    muzzleX: 5,
    muzzleY: 12,
    muzzleLength: 0,
    aimMode: 'target',
    aimTurn: 1,
    fixedAngleDeg: 45,
    targetSeek: false,
    targetBoxRx: 130,
    targetBoxUp: 70,
    targetBoxDown: 80,
    bulletSpeed: 35,
    steerFrames: 3,
    maxFuseMs: 3000,
    exitMarginFrames: 3,
    artEnabled: false,
    artHalf: 16,
    artFrames: 1,
    trailEnabled: false,
    trailMax: 8,
    trailEvery: 1,
    trailCoreWidth: 5,
    trailGlowWidth: 10,
    trailColor: '#ffaa44',
    casingEnabled: false,
    casingFrames: 16,
    casingHalf: 14,
    casingLife: 80,
    casingSpeedMin: 200,
    casingSpeedMax: 300,
    casingJitterDeg: 17,
  },

  payload: {
    kind: 'missile',
    projectileDonor: 'bazooka',
    inheritVx: 0.25,
    vx: 1,
    vy: 0,
    spreadVx: 0,
    spreadVy: 0,
    mine: {
      fuse: 400,
      arm: 0,
      damage: 50,
      radius: 48,
      dudProof: false,
    },
    crate: {
      kind: 'weapon',
      health: 25,
      drop: 'chute',
      contents: '',
      amount: 1,
    },
    fire: {
      count: 8,
      duration: 4000,
      upPower: 100,
      damage: 20,
    },
    bullet: {
      weapon: 'stock.handgun',
      damage: null,
      pushPct: null,
    },
  },
};

export function mergeAirstrikeConfig(raw?: Partial<AirstrikeConfig>): AirstrikeConfig {
  if (!raw) return cloneAirstrikeConfig(DEFAULT_AIRSTRIKE);
  return {
    ...DEFAULT_AIRSTRIKE,
    ...raw,
    entry: { ...DEFAULT_AIRSTRIKE.entry, ...(raw.entry ?? {}) },
    plane: {
      ...DEFAULT_AIRSTRIKE.plane,
      ...(raw.plane ?? {}),
      boomSound: { ...DEFAULT_AIRSTRIKE.plane.boomSound, ...(raw.plane?.boomSound ?? {}) },
      boomFxBurst: { ...DEFAULT_AIRSTRIKE.plane.boomFxBurst, ...(raw.plane?.boomFxBurst ?? {}) },
      soundEnter: { ...DEFAULT_AIRSTRIKE.plane.soundEnter, ...(raw.plane?.soundEnter ?? {}) },
      soundLoop: { ...DEFAULT_AIRSTRIKE.plane.soundLoop, ...(raw.plane?.soundLoop ?? {}) },
      soundExit: { ...DEFAULT_AIRSTRIKE.plane.soundExit, ...(raw.plane?.soundExit ?? {}) },
      parts: (raw.plane?.parts ?? []).map((p) => ({ ...p })),
    },
    speed: { ...DEFAULT_AIRSTRIKE.speed, ...(raw.speed ?? {}) },
    release: {
      ...DEFAULT_AIRSTRIKE.release,
      ...(raw.release ?? {}),
      offsets: [...(raw.release?.offsets ?? DEFAULT_AIRSTRIKE.release.offsets)],
      sound: { ...DEFAULT_AIRSTRIKE.release.sound, ...(raw.release?.sound ?? {}) },
    },
    strafe: { ...DEFAULT_AIRSTRIKE.strafe, ...(raw.strafe ?? {}) },
    payload: {
      ...DEFAULT_AIRSTRIKE.payload,
      ...(raw.payload ?? {}),
      mine: { ...DEFAULT_AIRSTRIKE.payload.mine, ...(raw.payload?.mine ?? {}) },
      crate: { ...DEFAULT_AIRSTRIKE.payload.crate, ...(raw.payload?.crate ?? {}) },
      fire: { ...DEFAULT_AIRSTRIKE.payload.fire, ...(raw.payload?.fire ?? {}) },
      bullet: { ...DEFAULT_AIRSTRIKE.payload.bullet, ...(raw.payload?.bullet ?? {}) },
    },
  };
}

export function cloneAirstrikeConfig(cfg: AirstrikeConfig): AirstrikeConfig {
  return mergeAirstrikeConfig(cfg);
}

/** True when the weapon family is a cursor air strike (not teleport). */
export function supportsAirstrike(project: WeaponProject): boolean {
  return project.fireType === 'cursor' && !project.teleport;
}

/** True when Lua airstrike takeover is enabled on an eligible air strike. */
export function airstrikeActive(project: WeaponProject): boolean {
  return supportsAirstrike(project) && !!project.airstrike?.enabled;
}

/**
 * True when airstrike takeover is active AND launches `kind = 'missile'` rounds.
 * Those rounds come from `wa.weapons.launch{ weapon = self }` using the claim's
 * `projectile = { ... }` sub-table, so they get full `sb.flight`, ribbon trail,
 * explosion burst, emitter round, terrain stamp, and interval sound support!
 */
export function takeoverMissileActive(project: WeaponProject): boolean {
  return airstrikeActive(project) && (project.airstrike?.payload?.kind ?? 'missile') === 'missile';
}

/** True when airstrike takeover is active with a flying aircraft (`entry.mode !== 'payload'`). */
export function supportsAirstrikePlane(project: WeaponProject): boolean {
  return airstrikeActive(project) && (project.airstrike?.entry?.mode ?? 'offmap') !== 'payload';
}

export interface AirstrikePreset {
  id: string;
  label: string;
  summary: string;
  apply: (current: AirstrikeConfig) => AirstrikeConfig;
}

export const AIRSTRIKE_PRESETS: AirstrikePreset[] = [
  {
    id: 'standard',
    label: 'Standard Air Strike',
    summary: 'Classic 5-bomb jet flyover with ballistic lead',
    apply: (cur) => ({
      ...cloneAirstrikeConfig(DEFAULT_AIRSTRIKE),
      enabled: cur.enabled,
      plane: {
        ...cloneAirstrikeConfig(DEFAULT_AIRSTRIKE).plane,
        spriteMode: cur.plane.spriteMode,
        stockSprite: cur.plane.stockSprite,
        sheet: cur.plane.sheet,
        frames: cur.plane.frames,
        fps: cur.plane.fps,
        play: cur.plane.play,
        scale: cur.plane.scale,
      },
    }),
  },
  {
    id: 'carpet',
    label: 'Carpet Run',
    summary: 'Wide 10-bomb saturation pass that slows slightly while dropping',
    apply: (cur) => {
      const base = cloneAirstrikeConfig(DEFAULT_AIRSTRIKE);
      return {
        ...base,
        enabled: cur.enabled,
        plane: { ...base.plane, stockSprite: 'cpttruck', bankAngleRelease: 6, bankRate: 0.8 },
        speed: {
          ...base.speed,
          cruise: 15,
          release: 9,
          exit: 18,
          slowDistance: 220,
          decel: 0.45,
          accel: 0.45,
          recoverMode: 'ramp',
        },
        release: {
          ...base.release,
          mode: 'drop',
          pattern: 'carpet',
          count: 10,
          cadenceUnit: 'distance',
          window: 280,
          lead: true,
        },
        payload: { ...base.payload, kind: 'missile', inheritVx: 0.35, vx: 0.5, vy: 1 },
      };
    },
  },
  {
    id: 'heli_strafe',
    label: 'Helicopter Strafe',
    summary: 'Slows into hover range, aims & strafes target, then accelerates out',
    apply: (cur) => {
      const base = cloneAirstrikeConfig(DEFAULT_AIRSTRIKE);
      return {
        ...base,
        enabled: cur.enabled,
        plane: {
          ...base.plane,
          stockSprite: 'airjetb',
          bankAngleApproach: 14,
          bankAngleRelease: 4,
          bankRate: 1.0,
        },
        speed: {
          ...base.speed,
          cruise: 14,
          release: 2,
          min: 1.5,
          exit: 16,
          engageRange: 260,
          damping: 0.92,
          releaseDamping: 0.96,
          growth: 1.08,
          accel: 0.25,
          recoverMode: 'ramp',
          recoverDelay: 12,
        },
        release: {
          ...base.release,
          mode: 'strafe',
          pattern: 'sequential',
          count: 16,
          cadenceUnit: 'frames',
          framesBetween: 4,
          windup: 10,
          lead: false,
          jitterX: 12,
          jitterY: 12,
        },
        strafe: {
          ...base.strafe,
          muzzleX: 10,
          muzzleY: 12,
          aimMode: 'target',
          aimTurn: 0.35,
          bulletSpeed: 28,
          steerFrames: 2,
          trailEnabled: true,
        },
        payload: { ...base.payload, kind: 'missile', projectileDonor: 'bazooka' },
      };
    },
  },
  {
    id: 'dive_bomber',
    label: 'Dive Bomber',
    summary: 'Dives during release, drops tight pair salvos, then climbs away',
    apply: (cur) => {
      const base = cloneAirstrikeConfig(DEFAULT_AIRSTRIKE);
      return {
        ...base,
        enabled: cur.enabled,
        plane: {
          ...base.plane,
          stockSprite: 'airjeto',
          bankAngleApproach: 5,
          bankAngleRelease: 20,
          bankRate: 1.2,
        },
        speed: {
          ...base.speed,
          cruise: 18,
          release: 11,
          exit: 20,
          slowDistance: 200,
          decel: 0.55,
          accel: 0.6,
          altitudeMode: 'dive',
          diveVy: 2.2,
        },
        release: {
          ...base.release,
          mode: 'drop',
          pattern: 'pairs',
          count: 6,
          cadenceUnit: 'frames',
          framesBetween: 8,
          spacing: 40,
          lead: true,
        },
        payload: { ...base.payload, kind: 'missile', inheritVx: 0.4, vx: 1.5, vy: 2.5 },
      };
    },
  },
  {
    id: 'kamikaze_dive',
    label: 'Kamikaze Dive',
    summary: 'Dives straight into the clicked target and detonates the aircraft on terrain impact',
    apply: (cur) => {
      const base = cloneAirstrikeConfig(DEFAULT_AIRSTRIKE);
      return {
        ...base,
        enabled: cur.enabled,
        plane: {
          ...base.plane,
          stockSprite: 'airjeto',
          bankAngleApproach: 6,
          bankAngleRelease: 32,
          bankRate: 1.6,
          crashOnTerrain: true,
          crashOnWater: true,
          boomMode: 'custom',
          boomDamage: 90,
          boomRadius: 130,
          boomPushPct: 140,
          boomCraterRadius: 68,
          boomHitKind: 'blast',
          boomVisual: 'both',
          boomFires: 2,
          boomFxBurst: {
            enabled: true,
            color: '#ff7a2f',
            radius: 72,
            smoke: true,
          },
        },
        speed: {
          ...base.speed,
          cruise: 16,
          release: 15,
          exit: 18,
          slowDistance: 280,
          altitudeMode: 'crash_dive',
          diveVy: 0,
        },
        release: {
          ...base.release,
          mode: 'drop',
          pattern: 'sequential',
          count: 0,
          lead: false,
        },
      };
    },
  },
  {
    id: 'direct_sky',
    label: 'Direct Sky Barrage',
    summary: 'No plane: spawns a ripple salvo from the sky on click',
    apply: (cur) => {
      const base = cloneAirstrikeConfig(DEFAULT_AIRSTRIKE);
      return {
        ...base,
        enabled: cur.enabled,
        direction: 'none',
        entry: {
          ...base.entry,
          mode: 'payload',
          spawnAt: 'sky',
          y: null,
        },
        release: {
          ...base.release,
          mode: 'drop',
          pattern: 'carpet',
          count: 6,
          cadenceUnit: 'frames',
          framesBetween: 6,
          window: 220,
          lead: false,
        },
        payload: { ...base.payload, kind: 'missile', inheritVx: 0, vx: 0, vy: 4, spreadVx: 0.5 },
      };
    },
  },
  {
    id: 'cursor_crate',
    label: 'On-Click Crate / Mine Drop',
    summary: 'Spawns payload right at the clicked cursor position',
    apply: (cur) => {
      const base = cloneAirstrikeConfig(DEFAULT_AIRSTRIKE);
      return {
        ...base,
        enabled: cur.enabled,
        direction: 'none',
        entry: {
          ...base.entry,
          mode: 'payload',
          spawnAt: 'cursor',
        },
        release: {
          ...base.release,
          mode: 'drop',
          pattern: 'burst',
          count: 1,
          cadenceUnit: 'frames',
          framesBetween: 0,
          windup: 0,
          lead: false,
        },
        payload: {
          ...base.payload,
          kind: 'crate',
          inheritVx: 0,
          vx: 0,
          vy: 0,
        },
      };
    },
  },
];
