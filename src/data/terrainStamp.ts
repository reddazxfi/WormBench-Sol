import type { StampHitKind, TerrainStampConfig, WeaponProject } from '../types/weapon';

/**
 * `wa.land.stamp` writes one frame of a picture into the terrain (WA's girder
 * routine). The frame is chosen by index, so a round that must stick in at its
 * impact angle needs the picture pre-rotated: 32 cells, frame 0 pointing up,
 * turning clockwise. That is the same strip `buildRotationSheet` bakes and the
 * same order PX's ninja star / javelin / girder ports assume.
 *
 * 32 is fixed on purpose: PX's `orientation(vx, vy)` is the 32-octant helper,
 * and a 16/64 strip would need a second mapping rule for no visible gain.
 */
export const STAMP_FRAMES = 32;
/** One cell of the strip, in degrees: 11.25. */
export const STAMP_STEP_DEG = 360 / STAMP_FRAMES;
/**
 * The engine only keeps stampable frames whose width and height are 1..256 px
 * (`crates/engine/src/sprite.rs::terrain_frames`); a bigger cell is dropped and
 * `land.stamp` reports "frame out of range or sheet exceeds 256x256". The baked
 * cell is the source's diagonal, so the upload is what has to stay small.
 */
export const STAMP_MAX_CELL = 256;

/**
 * Which weapons can stamp. A missile (`power`) is a round WA flies and blasts,
 * so `on_explode` runs and the frame can follow its impact heading. A mine
 * also reaches the hook but has no flight velocity to orient with; stamping
 * mines is out of scope for now. A strike's bombs are built from the strike's
 * own record copy and never reach this claim's hook at all.
 *
 * The gate is the fire type, not the slot: PX's girder launcher is an ordinary
 * missile that stamps instead of blasting, and its utility behaviour lives in
 * the stamped picture, not in a `utility` record group.
 */
export function supportsTerrainStamp(project: WeaponProject): boolean {
  return (
    project.fireType === 'power' ||
    (project.fireType === 'cursor' &&
      !project.teleport &&
      !!project.airstrike?.enabled &&
      (project.airstrike.payload?.kind ?? 'missile') === 'missile')
  );
}

export const DEFAULT_TERRAIN_STAMP: TerrainStampConfig = {
  enabled: false,
  onImpact: true,
  fixedAngle: 0,
  soften: 3,
  blend: 'mix',
  trueColour: false,
  wormClearance: 12,
  // PX's javelin: 20 damage inside a 20 px square, throwing the target along
  // half the spear's speed, reported as a bullet, sparing the worm holding it.
  impact: {
    // On by default, and inert until the card's own `enabled` (Enable Stamp) is
    // ticked: the pierce is part of the same `on_explode` claim as the stamp.
    enabled: true,
    damage: 20,
    radius: 20,
    impulse: 0.5,
    kind: 'bullet',
    spareShooter: true,
  },
};

/**
 * The hit kinds the card offers. This list is the engine's, not ours:
 * `object:hit` and `worm:hurt` reject anything else (`hit_kind_arg`), and
 * `blast` is not among them.
 */
export const STAMP_HIT_KINDS: { id: StampHitKind; label: string; hint: string }[] = [
  { id: 'bullet', label: 'Bullet', hint: 'Handgun, Uzi, Shotgun, Minigun: what PX’s javelin sends.' },
  { id: 'drill', label: 'Drill', hint: 'The Pneumatic Drill’s kind.' },
  { id: 'fire', label: 'Fire', hint: 'Flames: oil drums and crates react as they do to a flame weapon.' },
  { id: 'arrow', label: 'Arrow', hint: 'The Longbow’s kind.' },
  { id: 'prod', label: 'Prod', hint: 'WA’s plain poke: what a scripted hit is before names.' },
  { id: 'percent', label: 'Percent', hint: 'The Battle Axe’s kind: damage is that percentage of the worm’s health.' },
  {
    id: 'taze',
    label: 'Taze',
    hint: 'Electrical: the pierce arms the hit, and px.electric holds the worm in the sparking pose and throws it. WA still takes it as a Prod, so a wa.on.hit handler sees "taze".',
  },
];

/**
 * Largest worm clearance the card allows, in px. The engine's own worm body is
 * about 9x16 px (`worm` collision shape), so anything past the stamp's own cell
 * would refuse most impacts; 64 is far more than a worm needs and still on the
 * scale of the art.
 */
export const STAMP_CLEARANCE_MAX = 64;

/** Degrees (0 = up, clockwise) -> strip frame. 90 lands on frame 8 (right). */
export function stampFrameForAngle(deg: number): number {
  const step = Math.round((Number(deg) || 0) / STAMP_STEP_DEG);
  return ((step % STAMP_FRAMES) + STAMP_FRAMES) % STAMP_FRAMES;
}

/** Strip frame -> the angle it points, in degrees (0 = up, clockwise). */
export function stampAngleForFrame(frame: number): number {
  const index = ((Math.round(frame) % STAMP_FRAMES) + STAMP_FRAMES) % STAMP_FRAMES;
  // `frame * 11.25` is exact to 3 decimals for every index (8 -> 90, 16 -> 180).
  return Math.round(index * STAMP_STEP_DEG * 1000) / 1000;
}

/** Cardinal sample frames the preview shows in impact mode (up, right, down, left). */
export const STAMP_CARDINALS: { frame: number; label: string }[] = [
  { frame: 0, label: 'Up' },
  { frame: 8, label: 'Right' },
  { frame: 16, label: 'Down' },
  { frame: 24, label: 'Left' },
];
