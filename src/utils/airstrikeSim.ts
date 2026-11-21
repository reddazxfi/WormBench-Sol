import type { AirstrikeConfig } from '../types/weapon';

export type SimPhase = 'approach' | 'slow' | 'release' | 'recover' | 'exit' | 'done';

export interface SimProjectileSample {
  /** 1-based index in the full configured release count. */
  releaseIndex: number;
  /** Spawn frame (0-based tick). */
  spawnFrame: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  /** Gravity per 50 Hz tick in preview world px/frame^2 (0 for straight rays/chute). */
  gravity: number;
  /** Parachute descent mode for crates. */
  chute: boolean;
  /** Straight hitscan/strafe ray style. */
  isStrafe: boolean;
  /** Target point at release (for strafe visual aim line). */
  tx: number;
  ty: number;
}

export interface SimFrame {
  tick: number;
  phase: SimPhase;
  hasPlane: boolean;
  x: number;
  y: number;
  vx: number;
  bankDeg: number;
  gunAngleRad: number;
  fadeAlpha: number;
  releasedSoFar: number;
}

export interface AirstrikeSimResult {
  worldW: number;
  skyY: number;
  groundY: number;
  targetX: number;
  targetY: number;
  dir: 1 | -1;
  hasPlane: boolean;
  configuredCount: number;
  /** All drop-window X coordinates (used to show subtle drop-zone span ticks). */
  dropWindowStartX: number;
  dropWindowEndX: number;
  /** Ballistic lead drift applied (px). */
  driftX: number;
  /** Max 4 representative demo projectiles (no physics collisions). */
  demoProjectiles: SimProjectileSample[];
  frames: SimFrame[];
  /** Peak horizontal speed for normalizing the speed readout bar. */
  maxSpeed: number;
  /** Present when a diving aircraft impacts terrain with crashOnTerrain enabled. */
  crashPoint?: { tick: number; x: number; y: number };
}

export const SIM_WORLD_W = 1280;
export const SIM_DEFAULT_SKY_Y = 82;
export const SIM_GROUND_Y = 390;
export const SIM_GRAVITY = 0.24; // WA standard gravity in px/tick^2 (approx 0x3D70)
export const MAX_DEMO_PROJECTILES = 4;

/** Deterministic PRNG (Mulberry32) so `random_window` is repeatable while scrubbing. */
function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick up to 4 evenly distributed 1-based indices out of `total` (always includes first & last when > 1). */
export function selectDemoIndices(total: number, maxDemo = MAX_DEMO_PROJECTILES): Set<number> {
  const n = Math.max(0, Math.floor(total));
  const out = new Set<number>();
  if (n <= 0) return out;
  if (n <= maxDemo) {
    for (let i = 1; i <= n; i++) out.add(i);
    return out;
  }
  for (let slot = 0; slot < maxDemo; slot++) {
    const idx = Math.round(1 + (slot * (n - 1)) / (maxDemo - 1));
    out.add(Math.max(1, Math.min(n, idx)));
  }
  return out;
}

function solveBallisticDrift(
  y0: number,
  targetY: number,
  vx0: number,
  vy0: number,
  gravityPct: number,
  inertiaY: number,
): number {
  const g = (SIM_GRAVITY * gravityPct) / 100;
  if (g <= 0 || y0 >= targetY) return 0;
  let x = 0;
  let y = y0;
  let vy = vy0;
  let lvy = vy0;
  for (let i = 0; i < 600; i++) {
    if (y >= targetY) break;
    const vy2 = vy + g;
    x += vx0;
    y += vy2;
    vy = vy2 + inertiaY * (vy2 - lvy);
    lvy = vy;
  }
  return x;
}

function buildDropSchedule(
  centerX: number,
  dir: 1 | -1,
  cfg: AirstrikeConfig['release'],
): number[] {
  const count = Math.max(0, Math.floor(cfg.count));
  const xs: number[] = [];
  if (count <= 0) return xs;

  const pat = cfg.pattern;
  if (pat === 'burst') {
    for (let k = 1; k <= count; k++) xs.push(centerX);
  } else if (pat === 'ripple') {
    const per = Math.max(1, Math.floor(cfg.perTick || 1));
    const groups = Math.ceil(count / per);
    for (let k = 1; k <= count; k++) {
      const gIdx = Math.floor((k - 1) / per) + 1;
      xs.push(centerX + (gIdx - (groups + 1) / 2) * cfg.spacing * dir);
    }
  } else if (pat === 'pairs') {
    const pairsTotal = Math.ceil(count / 2);
    const quarter = cfg.spacing / 4;
    for (let k = 1; k <= count; k++) {
      const pIdx = Math.floor((k - 1) / 2) + 1;
      const base = centerX + (pIdx - (pairsTotal + 1) / 2) * cfg.spacing * dir;
      const twin = (k - 1) % 2 === 0 ? -quarter : quarter;
      xs.push(base + twin * dir);
    }
  } else if (pat === 'carpet') {
    const win = cfg.window;
    const step = count > 1 ? win / (count - 1) : 0;
    const startX = centerX - (win / 2) * dir;
    for (let k = 1; k <= count; k++) {
      xs.push(startX + (k - 1) * step * dir);
    }
  } else if (pat === 'random_window') {
    const rng = makeRng(1337 + count * 31 + Math.round(cfg.window));
    const halfW = Math.floor(cfg.window / 2);
    for (let k = 1; k <= count; k++) {
      const rx = halfW > 0 ? Math.round((rng() * 2 - 1) * halfW) : 0;
      xs.push(centerX + rx * dir);
    }
    xs.sort((a, b) => (dir > 0 ? a - b : b - a));
  } else if (pat === 'offsets') {
    for (let k = 1; k <= count; k++) {
      const off = cfg.offsets[k - 1] ?? 0;
      xs.push(centerX + off * dir);
    }
  } else {
    for (let k = 1; k <= count; k++) {
      xs.push(centerX + (k - (count + 1) / 2) * cfg.spacing * dir);
    }
  }
  return xs;
}

function crossedX(dir: 1 | -1, targetX: number, x: number): boolean {
  return dir > 0 ? x >= targetX : x <= targetX;
}

/**
 * Deterministic 50 Hz preview of the airstrike takeover (`wfws_airstrike.lua`).
 * Simulates the aircraft's exact 5-phase ease-in/slow/release/recover/exit curve
 * (or direct on-click payload spawn) and records up to 4 representative demo
 * projectiles with zero collision simulation.
 */
export function simulateAirstrikePreview(
  cfg: AirstrikeConfig,
  opts: {
    dir?: 1 | -1;
    targetX?: number;
    targetY?: number;
    gravityPct?: number;
  } = {},
): AirstrikeSimResult {
  const worldW = SIM_WORLD_W;
  const targetX = opts.targetX ?? worldW * 0.52;
  const targetY = opts.targetY ?? SIM_GROUND_Y - 12;
  const gravityPct = opts.gravityPct ?? 100;

  let dir: 1 | -1 = opts.dir ?? cfg.defaultDir;
  if (cfg.direction === 'left') dir = -1;
  else if (cfg.direction === 'right') dir = 1;
  else if (cfg.direction === 'cursor_side') dir = targetX < worldW / 2 ? 1 : -1;

  // Map entry.y into preview vertical space cleanly:
  // default/null sits at SIM_DEFAULT_SKY_Y (82 px). If author sets explicit y,
  // shift gently relative to WA's -208 sky baseline and clamp within visible sky band.
  const skyY =
    cfg.entry.y === null || cfg.entry.y === undefined
      ? SIM_DEFAULT_SKY_Y
      : Math.max(36, Math.min(SIM_GROUND_Y - 80, SIM_DEFAULT_SKY_Y + (cfg.entry.y + 208) * 0.35));

  const spd = cfg.speed;
  const rel = cfg.release;
  const pay = cfg.payload;
  const pc = cfg.plane;
  const st = cfg.strafe;

  const isPayloadOnly = cfg.entry.mode === 'payload';
  const isStrafe = rel.mode === 'strafe';
  const vRel = spd.release !== null && spd.release !== undefined ? Math.max(0, spd.release) : Math.max(0, spd.cruise);
  const vxDrop = pay.inheritVx * (dir * vRel) + pay.vx * dir;

  let driftX = 0;
  if (rel.lead && !isStrafe && (pay.kind === 'missile' || pay.kind === 'actor')) {
    driftX = solveBallisticDrift(
      skyY,
      targetY,
      vxDrop,
      pay.vy,
      pay.kind === 'missile' ? gravityPct : 100,
      rel.leadInertiaY,
    );
    if (rel.leadMaxBack > 0) {
      driftX = Math.max(-rel.leadMaxBack, Math.min(rel.leadMaxBack, driftX));
    }
  }

  const centerX = targetX + cfg.entry.dropOffsetX - driftX;
  const count = Math.max(0, Math.floor(rel.count));
  const drops = buildDropSchedule(centerX, dir, rel);
  const demoIndices = selectDemoIndices(count, MAX_DEMO_PROJECTILES);
  const demoProjectiles: SimProjectileSample[] = [];
  const frames: SimFrame[] = [];

  const dropWindowStartX = drops.length > 0 ? Math.min(...drops) : centerX;
  const dropWindowEndX = drops.length > 0 ? Math.max(...drops) : centerX;

  const recordSample = (
    tick: number,
    itemIdx: number,
    sx: number,
    sy: number,
    planeVx: number,
    planeX: number,
    planeY: number,
    gunAngle: number,
  ) => {
    if (!demoIndices.has(itemIdx)) return;
    if (demoProjectiles.length >= MAX_DEMO_PROJECTILES) return;

    const centerOffset = itemIdx - (count + 1) / 2;
    let vx = 0;
    let vy = 0;
    let spawnX = sx;
    let spawnY = sy;

    if (isStrafe) {
      const right = dir >= 0;
      const mx = planeX + (right ? st.muzzleX : -st.muzzleX);
      const my = planeY + st.muzzleY;
      if (st.muzzleLength !== 0) {
        const final = right ? gunAngle : Math.PI - gunAngle;
        const ang = -(Math.PI / 2 + final);
        const lx = right ? 1 : -1;
        const ly = -st.muzzleLength;
        spawnX = mx + Math.cos(ang) * lx - Math.sin(ang) * ly;
        spawnY = my + Math.sin(ang) * lx + Math.cos(ang) * ly;
      } else {
        spawnX = mx;
        spawnY = my;
      }
      let dx = targetX - spawnX;
      let dy = targetY - spawnY;
      if (st.aimMode === 'fixed') {
        const rad = (st.fixedAngleDeg * Math.PI) / 180;
        dx = Math.cos(rad) * dir;
        dy = Math.sin(rad);
      }
      const len = Math.hypot(dx, dy) || 1;
      // Scale ultra-fast bullet speeds slightly for legibility in preview while preserving direction
      const speedVis = Math.max(4, Math.min(26, st.bulletSpeed * 0.65));
      vx = (dx / len) * speedVis + centerOffset * pay.spreadVx * dir;
      vy = (dy / len) * speedVis + centerOffset * pay.spreadVy;
    } else {
      vx = pay.inheritVx * (planeVx * dir) + pay.vx * dir + centerOffset * pay.spreadVx * dir;
      vy = pay.vy + centerOffset * pay.spreadVy;
    }

    const isCrateChute = pay.kind === 'crate' && pay.crate.drop === 'chute';
    const isRay = isStrafe || pay.kind === 'bullet';
    const grav = isRay
      ? 0
      : isCrateChute
        ? 0
        : (SIM_GRAVITY * (pay.kind === 'missile' ? gravityPct : 100)) / 100;

    if (isCrateChute) {
      vx = vx * 0.15;
      vy = Math.max(1.8, Math.abs(vy) || 2.1);
    }

    demoProjectiles.push({
      releaseIndex: itemIdx,
      spawnFrame: tick,
      x0: spawnX,
      y0: spawnY,
      vx,
      vy,
      gravity: grav,
      chute: isCrateChute,
      isStrafe: isRay,
      tx: targetX,
      ty: targetY,
    });
  };

  let maxSpeed = Math.max(1, spd.cruise, spd.release ?? 0, spd.exit ?? 0);

  if (isPayloadOnly) {
    const startX = targetX + cfg.entry.dropOffsetX;
    const startY = cfg.entry.spawnAt === 'cursor' ? targetY : skyY;
    const instant =
      rel.windup <= 0 &&
      (rel.framesBetween <= 0 || count <= 1 || rel.pattern === 'burst' || rel.pattern === 'offsets');

    let released = 0;
    let cooldown = Math.max(0, Math.floor(rel.windup));
    let cadenceCd = 0;
    const totalPreviewFrames = Math.min(220, Math.max(95, cooldown + count * Math.max(1, rel.framesBetween) + 75));

    for (let tick = 0; tick < totalPreviewFrames; tick++) {
      let phase: SimPhase = 'release';
      if (instant && tick === 0) {
        for (let idx = 1; idx <= count; idx++) {
          const sx = drops[idx - 1] ?? startX;
          recordSample(tick, idx, sx, startY, 0, startX, startY, Math.PI / 2);
          released = idx;
        }
      } else if (!instant && released < count) {
        if (cooldown > 0) {
          phase = 'slow';
          cooldown -= 1;
        } else if (cadenceCd > 0) {
          cadenceCd -= 1;
        } else {
          let batch = 1;
          if (rel.pattern === 'burst') batch = Math.min(count - released, Math.max(1, rel.burstSize));
          else if (rel.pattern === 'ripple') batch = Math.min(count - released, Math.max(1, rel.perTick));
          else if (rel.pattern === 'pairs') batch = Math.min(count - released, 2);
          for (let b = 0; b < batch; b++) {
            const idx = released + 1;
            const sx = drops[idx - 1] ?? startX;
            recordSample(tick, idx, sx, startY, 0, startX, startY, Math.PI / 2);
            released = idx;
          }
          cadenceCd = Math.max(0, Math.floor(rel.framesBetween));
        }
      } else {
        phase = 'done';
      }

      frames.push({
        tick,
        phase,
        hasPlane: false,
        x: startX,
        y: startY,
        vx: 0,
        bankDeg: 0,
        gunAngleRad: Math.PI / 2,
        fadeAlpha: 0,
        releasedSoFar: released,
      });
    }

    return {
      worldW,
      skyY,
      groundY: SIM_GROUND_Y,
      targetX,
      targetY,
      dir,
      hasPlane: false,
      configuredCount: count,
      dropWindowStartX,
      dropWindowEndX,
      driftX,
      demoProjectiles,
      frames,
      maxSpeed,
    };
  }

  // Aircraft flyover simulation (`offmap` or `above`)
  const leadX = drops.length > 0 ? drops[0] : centerX;
  let x =
    cfg.entry.mode === 'above'
      ? leadX - spd.slowDistance * dir
      : dir > 0
        ? -cfg.entry.side
        : worldW + cfg.entry.side;
  let y = skyY;
  const initY = y;
  let vx = Math.max(0.5, spd.cruise);
  let phase: SimPhase =
    cfg.entry.mode === 'above'
      ? spd.slowDistance > 0 || rel.windup > 0
        ? 'slow'
        : 'release'
      : 'approach';
  let phaseStart = 0;
  let cooldown = Math.max(0, Math.floor(rel.windup));
  let cadenceCd = 0;
  let released = 0;
  let bankAngle = pc.bankAngleApproach;
  let gunAngle = -Math.PI;
  let fadeAlpha = 255;
  let diveRate: number | null = null;
  let crashPoint: { tick: number; x: number; y: number } | undefined;

  const resolveCrashDiveRate = (): number => {
    if (spd.diveVy !== 0) return Math.abs(spd.diveVy);
    if (diveRate === null) {
      const distX = Math.max(16, Math.abs(targetX - x));
      const ticks = Math.max(1, distX / Math.max(1, vx));
      diveRate = Math.max(1.2, Math.min(18, Math.max(16, targetY - y) / ticks));
    }
    return diveRate;
  };

  const updateAimAndBank = (instant: boolean) => {
    let targetAng: number;
    if (st.aimMode === 'fixed') {
      targetAng = (st.fixedAngleDeg * Math.PI) / 180;
    } else {
      targetAng = Math.atan2(targetY - y, Math.abs(targetX - x));
      targetAng = Math.max(-Math.PI, Math.min(Math.PI / 2, targetAng));
    }
    gunAngle = instant ? targetAng : gunAngle + (targetAng - gunAngle) * st.aimTurn;

    const wantBank =
      phase === 'slow' || phase === 'release' ? pc.bankAngleRelease : pc.bankAngleApproach;
    if (pc.bankRate <= 0) {
      bankAngle = wantBank;
    } else if (bankAngle < wantBank) {
      bankAngle = Math.min(wantBank, bankAngle + pc.bankRate);
    } else if (bankAngle > wantBank) {
      bankAngle = Math.max(wantBank, bankAngle - pc.bankRate);
    }
  };

  updateAimAndBank(true);

  const maxTicks = Math.min(360, Math.max(120, Math.floor(pc.timeoutFrames)));

  for (let tick = 0; tick < maxTicks; tick++) {
    if (phase === 'approach') {
      let enterSlow = false;
      if (spd.engageRange > 0) {
        enterSlow = Math.abs(x - targetX) <= spd.engageRange;
      } else if (count > 0) {
        const gateX = drops[0] - spd.slowDistance * dir;
        enterSlow = crossedX(dir, gateX, x);
      } else if (spd.slowDistance > 0) {
        const gateX = targetX - spd.slowDistance * dir;
        enterSlow = crossedX(dir, gateX, x);
      }
      if (enterSlow) {
        phase = 'slow';
        phaseStart = tick;
        cooldown = Math.max(0, Math.floor(rel.windup));
        updateAimAndBank(spd.engageRange > 0);
      } else if (count === 0 && spd.slowDistance <= 0 && spd.engageRange <= 0) {
        phase = 'recover';
        phaseStart = tick;
      }
    }

    if (phase === 'slow') {
      if (spd.damping !== 1) vx *= spd.damping;
      if (spd.decel > 0) vx -= spd.decel;
      if (spd.release !== null && spd.release !== undefined && spd.damping === 1 && spd.decel === 0) {
        vx = spd.release;
      }
      const floorV = Math.max(spd.min, spd.release !== null && spd.release !== undefined ? spd.release : spd.min);
      if (vx < floorV) vx = floorV;

      const readyGate = count > 0 && spd.engageRange <= 0 ? crossedX(dir, drops[0], x) : true;
      if (cooldown > 0) cooldown -= 1;
      if (spd.altitudeMode === 'crash_dive') {
        y = Math.min(SIM_GROUND_Y, y + resolveCrashDiveRate());
      }
      if (cooldown <= 0 && readyGate) {
        if (count === 0) {
          phase = 'recover';
          phaseStart = tick;
        } else {
          phase = 'release';
          phaseStart = tick;
          cadenceCd = 0;
        }
      }
    }

    if (phase === 'release') {
      const relFloor =
        spd.release !== null && spd.release !== undefined ? Math.max(spd.min, spd.release) : spd.min;
      if (spd.releaseDamping !== 1) vx = Math.max(spd.min, vx * spd.releaseDamping);
      if (spd.decel > 0 && vx > relFloor) vx = Math.max(relFloor, vx - spd.decel);
      if (spd.min >= 0 && vx < spd.min) vx = spd.min;

      if (spd.altitudeMode === 'crash_dive') {
        y = Math.min(SIM_GROUND_Y, y + resolveCrashDiveRate());
      } else if (spd.altitudeMode === 'dive' && spd.diveVy !== 0) {
        y = Math.min(pc.crashOnTerrain ? SIM_GROUND_Y : SIM_GROUND_Y - 70, y + Math.abs(spd.diveVy));
      } else if (spd.altitudeMode === 'climb' && spd.diveVy !== 0) {
        y = Math.max(24, y - Math.abs(spd.diveVy));
      }

      if (
        rel.cadenceUnit === 'frames' ||
        rel.pattern === 'burst' ||
        rel.pattern === 'ripple' ||
        rel.pattern === 'pairs'
      ) {
        if (cadenceCd > 0) {
          cadenceCd -= 1;
        } else {
          const firstGate =
            released === 0 &&
            !isStrafe &&
            count > 0 &&
            spd.engageRange <= 0 &&
            !crossedX(dir, drops[0], x);
          if (!firstGate) {
            let batch = 1;
            if (rel.pattern === 'burst') batch = Math.min(count - released, Math.max(1, rel.burstSize));
            else if (rel.pattern === 'ripple') batch = Math.min(count - released, Math.max(1, rel.perTick));
            else if (rel.pattern === 'pairs') batch = Math.min(count - released, 2);
            else if (rel.pattern === 'carpet' && rel.perTick > 1) {
              batch = Math.min(count - released, rel.perTick);
            }
            for (let b = 0; b < batch; b++) {
              const idx = released + 1;
              const dx = !isStrafe ? drops[idx - 1] ?? x : x;
              recordSample(tick, idx, dx, y, vx, x, y, gunAngle);
              released = idx;
            }
            cadenceCd = Math.max(0, Math.floor(rel.framesBetween));
          }
        }
      } else {
        if (cadenceCd > 0) cadenceCd -= 1;
        while (released < count && cadenceCd <= 0) {
          const idx = released + 1;
          const txDrop = drops[idx - 1] ?? x;
          if (!crossedX(dir, txDrop, x)) break;
          recordSample(tick, idx, txDrop, y, vx, x, y, gunAngle);
          released = idx;
          if (rel.minFrames > 0) {
            cadenceCd = Math.floor(rel.minFrames);
            break;
          }
        }
      }

      if (released >= count) {
        phase = 'recover';
        phaseStart = tick;
        if (spd.recoverDelay <= 0 && spd.recoverMode === 'snap') {
          vx = spd.exit !== null && spd.exit !== undefined ? spd.exit : spd.cruise;
          phase = 'exit';
        } else if (spd.growth > 1 && vx < spd.recoverMin) {
          vx = spd.recoverMin;
        }
      }
    }

    if (phase === 'recover') {
      if (spd.altitudeMode === 'crash_dive') {
        y = Math.min(SIM_GROUND_Y, y + resolveCrashDiveRate());
      }
      const pElapsed = tick - phaseStart;
      if (pElapsed >= spd.recoverDelay) {
        const exitV = spd.exit !== null && spd.exit !== undefined ? spd.exit : spd.cruise;
        if (spd.recoverMode === 'snap') {
          vx = exitV;
          phase = 'exit';
        } else if (spd.recoverMode === 'hold') {
          phase = 'exit';
        } else {
          if (vx < spd.recoverMin && (spd.growth > 1 || spd.accel > 0)) {
            vx = spd.recoverMin;
          }
          if (spd.growth !== 1) vx = Math.min(exitV, vx * spd.growth);
          if (spd.accel > 0) vx = Math.min(exitV, vx + spd.accel);
          if (vx >= exitV || (spd.growth === 1 && spd.accel === 0)) {
            vx = exitV;
            phase = 'exit';
          }
        }
      }
    }

    if (phase === 'exit') {
      if (spd.altitudeMode === 'crash_dive') {
        y = Math.min(SIM_GROUND_Y, y + resolveCrashDiveRate());
      } else if (spd.altitudeMode !== 'level' && spd.diveVy !== 0 && Math.abs(y - initY) > 0.5) {
        if (y > initY) y = Math.max(initY, y - Math.abs(spd.diveVy));
        else y = Math.min(initY, y + Math.abs(spd.diveVy));
      }
      if (pc.fadeOutFrames > 0) {
        fadeAlpha = Math.max(0, fadeAlpha - 255 / pc.fadeOutFrames);
      }
    }

    maxSpeed = Math.max(maxSpeed, vx);
    frames.push({
      tick,
      phase,
      hasPlane: true,
      x,
      y,
      vx,
      bankDeg: bankAngle,
      gunAngleRad: gunAngle,
      fadeAlpha,
      releasedSoFar: released,
    });

    if (pc.crashOnTerrain && x >= 0 && x <= worldW && y >= SIM_GROUND_Y - 1) {
      crashPoint = { tick, x, y: SIM_GROUND_Y };
      const tailEnd = Math.min(maxTicks, tick + 34);
      for (let t = tick + 1; t < tailEnd; t++) {
        frames.push({
          tick: t,
          phase: 'done',
          hasPlane: false,
          x,
          y: SIM_GROUND_Y,
          vx: 0,
          bankDeg: bankAngle,
          gunAngleRad: gunAngle,
          fadeAlpha: 0,
          releasedSoFar: released,
        });
      }
      break;
    }

    x += dir * vx;
    updateAimAndBank(false);

    const pastRight = dir > 0 && x > worldW + pc.exitMargin;
    const pastLeft = dir < 0 && x < -pc.exitMargin;
    if (pastRight || pastLeft) {
      // Pad a few tail frames so the last demo projectile can finish arcing downward
      const lastSpawn = demoProjectiles.reduce((acc, p) => Math.max(acc, p.spawnFrame), 0);
      const tailEnd = Math.min(maxTicks, Math.max(tick + 18, lastSpawn + 55));
      for (let t = tick + 1; t < tailEnd; t++) {
        frames.push({
          tick: t,
          phase: 'done',
          hasPlane: false,
          x,
          y,
          vx: 0,
          bankDeg: bankAngle,
          gunAngleRad: gunAngle,
          fadeAlpha: 0,
          releasedSoFar: released,
        });
      }
      break;
    }
  }

  return {
    worldW,
    skyY,
    groundY: SIM_GROUND_Y,
    targetX,
    targetY,
    dir,
    hasPlane: true,
    configuredCount: count,
    dropWindowStartX,
    dropWindowEndX,
    driftX,
    demoProjectiles,
    frames,
    maxSpeed,
    crashPoint,
  };
}
