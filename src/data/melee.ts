import type { MeleeConfig, MeleeHit } from '../types/weapon';

/**
 * The melee strike's numbers and geometry.
 *
 * One formula, three readers: the panel's red hit box, `sb.hold`'s simulation
 * (which emits the same arithmetic in Lua) and the test pack. The box is the
 * engine's own hold geometry, not a frame of reference of its own: the weapon is
 * placed at `rot_w = rot + PI * weap_radial_rotation` from the worm, so "along
 * the weapon" is that same vector, and the swing's angle rotates it about the
 * worm.
 */

export const DEFAULT_MELEE: MeleeConfig = {
  enabled: false,
  radius: 34,
  width: 16,
  // A strike starts along the worm's own aim, not the art's swing: a level
  // swing at a worm straight ahead is the baseline every weapon must land.
  followSwing: false,
  hitFrame: 8,
  damage: 20,
  kind: 'normal',
  poisonPower: 0,
  // The default throw is literal, not the aim vector: the classic 12/8 shove.
  pushMode: 'fixed',
  pushPower: 3,
  pushVx: 12,
  pushVy: 8,
  // No extra lift on the literal throw, so the default hit really is 12/8.
  // A positive lift is opt-in and is subtracted from the y the callback gets.
  lift: 0,
  // WA plays 96 when a grenade is thrown and when the bat comes off nothing: the
  // swing's own whoosh. On by default, because a strike that reaches nobody is
  // otherwise silent (the claim eats WA's fire, so the record's sound never runs).
  // Either can be an uploaded WAV instead of an id.
  hitSound: { id: 0, priority: 10 },
  missSound: { id: 96, priority: 8 },
  oncePerTarget: true,
  spareShooter: true,
  log: false,
};

/** How far inside the near edge the box reaches, so a worm at the feet is hit. */
export const MELEE_SLACK = 3;

/**
 * The strikes a swing lands, sorted by frame.
 *
 * One list, three readers (the panel's table, the generator and the preview), so
 * "how many hits and when" is answered in one place. An empty `hits` is the
 * single hit the panel wrote before combos existed, built from the top-level
 * numbers: that is what keeps an untouched weapon's export byte for byte the
 * same, and what an older bundle's `hit_frame` / `damage` import becomes.
 */
export function meleeStrikes(melee: MeleeConfig): MeleeHit[] {
  const listed = (melee.hits ?? []).filter((hit) => hit && Number.isFinite(hit.frame));
  const hits =
    listed.length > 0
      ? listed.map((hit) => ({
          frame: Math.max(0, Math.round(hit.frame)),
          damage: Math.max(0, Number(hit.damage) || 0),
          power: Number(hit.power) || 0,
          lift: Number(hit.lift) || 0,
          ...(hit.vx === undefined ? {} : { vx: Number(hit.vx) || 0 }),
          ...(hit.vy === undefined ? {} : { vy: Number(hit.vy) || 0 }),
          // A strike's own sample is carried through: dropping it here is what
          // made every strike of a combo play the weapon's one hit sound.
          ...(hit.sound ? { sound: hit.sound } : {}),
        }))
      : [
          {
            frame: Math.max(0, Math.round(melee.hitFrame) || 0),
            damage: Math.max(0, Number(melee.damage) || 0),
            power: Number(melee.pushPower) || 0,
            lift: Number(melee.lift) || 0,
            // Keep the single strike's throw explicit, so the preview, the
            // panel and the export all read the same 12/8 default even when
            // the author never opened a per-strike row.
            ...(melee.pushMode === 'fixed'
              ? {
                  vx: Number(melee.pushVx) || 0,
                  vy: Number(melee.pushVy) || 0,
                }
              : {}),
          },
        ];
  return hits.sort((a, b) => a.frame - b.frame);
}

/** Total damage a full swing deals to one worm standing in the box. */
export function meleeTotalDamage(melee: MeleeConfig): number {
  return meleeStrikes(melee).reduce((sum, hit) => sum + hit.damage, 0);
}

/** The engine's aim angle in radians: `rot = (1 - aim) * PI`. */
export function meleeRot(aim: number): number {
  return (1 - Math.min(1, Math.max(0, aim))) * Math.PI;
}

/**
 * The unit vector the strike reaches along: the worm's own aim, turned by the
 * swing. Nothing about the art is in it.
 *
 * `worm.aim` is WA's 180 degree sweep, `0` straight down, `0.5` level, `1`
 * straight up, and `facing` says which side, so the aim direction is
 * `(facing * sin(aim*PI), cos(aim*PI))` (world y is down). The held art's
 * `weap_rotation` and `weap_radius` are drawing controls only: rotating a sheet
 * or moving its pivot does not change where the worm points, and folding either
 * into the box is what pointed it backwards before.
 *
 * The swing's angle is applied before the side mirror, so a cut turns the box the
 * same way on both sides (`swing * facing`, exactly as the drawn angle is).
 */
export function meleeScan(
  aim: number,
  facing: 1 | -1,
  swingDeg: number,
): { vx: number; vy: number; angle: number } {
  const phi = Math.min(1, Math.max(0, aim)) * Math.PI;
  const x = facing * Math.sin(phi);
  const y = Math.cos(phi);
  const s = ((swingDeg * Math.PI) / 180) * facing;
  const cos = Math.cos(s);
  const sin = Math.sin(s);
  const vx = x * cos - y * sin;
  const vy = x * sin + y * cos;
  return { vx, vy, angle: Math.atan2(vy, vx) };
}

/**
 * Whether a point is inside the box: `along` runs outward from the worm, `across`
 * is the arc's half-width. This is the exact test `sb.hold` runs in Lua, once per
 * strike (`meleeStrikes`), and it does not care which strike it is.
 */
export function meleeHits(
  target: { x: number; y: number },
  origin: { x: number; y: number },
  scan: { vx: number; vy: number },
  radius: number,
  width: number,
  slack = MELEE_SLACK,
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const along = dx * scan.vx + dy * scan.vy;
  const across = -dx * scan.vy + dy * scan.vx;
  return along >= -slack && along <= radius && Math.abs(across) <= width;
}

/** The pose angle the box follows at the hit frame, in degrees. */
export function meleeSwingDeg(clipAngle: number, followSwing: boolean): number {
  return followSwing ? clipAngle : 0;
}
