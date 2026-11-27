import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BeamConfig, WeaponProject } from '../types/weapon';
import {
  BEAM_ART_STYLE_URLS,
  WORM_HURT_URL,
  WORM_IDLE_URL,
} from '../data/beamAssets';
import { mergeBeamPreBufferConfig } from '../data/beam';
import { DEFAULT_AIM_CLIP, evalClip } from '../data/aimClip';
import {
  computeBeamSequenceSchedule,
  mergeFireSequenceConfig,
} from '../data/fireSequence';
import {
  drawHoldOverlay,
  HAND_LOWER_SRC,
  HAND_MID_SRC,
  HAND_UPPER_SRC,
  type HoldPoseRole,
  WORM_AIM_SRC,
} from '../utils/drawHoldLayer';
import { defaultArtFor } from '../utils/defaultArt';
import { normalizeTintHex, tintedSheet } from '../utils/sheetTint';
import {
  Pause,
  Play,
  RotateCcw,
  Shield,
  SkipForward,
  Sparkles,
  Target,
} from 'lucide-react';

interface BeamPreviewProps {
  project: WeaponProject;
  beam: BeamConfig;
}

const CANVAS_W = 460;
const CANVAS_H = 264;
const READY_FRAMES = 14;
const COOLDOWN_TAIL_FRAMES = 18;
const OFF_SIZE = 128;
const OFF_CENTER = OFF_SIZE / 2;

// Deterministic hash for preview lightning jitter & pellet spread (matches lockstep feel without jittering while paused).
function hash01(seed: number): number {
  let x = (seed | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// `wfws_firing`'s bolt shape, ported whole: a table of kinks seeded once per
// shot and read by linear interpolation. Two sines were smooth (a sine has no
// corner, so the bolt stopped reading as an electric arc), and white noise per
// Same constants as `wfws_firing.lua`: 9 smooth-cornered kinks re-seeded every
// 2 ticks (25 Hz crackle, 50 Hz during dissolve wind-down).
const JAG_N = 9;

function beamHash01(x: number): number {
  let s = Math.floor(Math.abs(x) * 1000003) % 65521;
  s = (s * 48271) % 2147483647;
  s = (s * 48271) % 2147483647;
  return (s % 20001) / 10000 - 1;
}

function beamKinks(seed: number, n: number): number[] {
  const vals: number[] = [];
  let prev = 0;
  for (let i = 1; i <= n; i += 1) {
    const r = beamHash01(seed + i * 0.6180339887);
    let v = r * 0.58 + prev * 0.42;
    if (v > 1) v = 1;
    else if (v < -1) v = -1;
    vals.push(v);
    prev = v;
  }
  vals[0] = 0;
  vals[n - 1] = 0;
  return vals;
}

function beamKinkAt(vals: number[] | undefined, ta: number): number {
  if (!vals) return 0;
  const n = vals.length;
  if (n < 3) return 0;
  const x = ta * (n - 1);
  let i = Math.floor(x);
  if (i < 0) i = 0;
  if (i > n - 2) i = n - 2;
  const f = x - i;
  const a = vals[i] ?? 0;
  const c = vals[i + 1] ?? a;
  return a + (c - a) * f;
}

function easeGrow(t: number, mode: BeamConfig['growEase']): number {
  const c = Math.max(0, Math.min(1, t));
  if (mode === 'in') return c * c;
  if (mode === 'out') return 1 - (1 - c) * (1 - c);
  return c;
}

function hslToHex(hDeg: number, s = 0.9, l = 0.62): string {
  const h = ((hDeg % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round((v + m) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Attach onload BEFORE setting src so cached / blob URLs never miss the repaint trigger. */
function loadImg(src: string | undefined, onReady: () => void): HTMLImageElement | null {
  if (!src) return null;
  const img = new Image();
  img.onload = onReady;
  img.onerror = onReady;
  img.src = src;
  if (img.complete && img.naturalWidth > 0) {
    queueMicrotask(onReady);
  }
  return img;
}

interface DummyTarget {
  id: number;
  label: string;
  /** Offset from worm centre in game pixels (positive right, negative up). */
  dx: number;
  dy: number;
  radius: number;
}

const DUMMY_TARGETS: DummyTarget[] = [
  { id: 1, label: 'Near', dx: 112, dy: 4, radius: 11 },
  { id: 2, label: 'Mid', dx: 196, dy: -24, radius: 11 },
  { id: 3, label: 'Far', dx: 274, dy: 26, radius: 11 },
];

interface BeamInstanceSim {
  key: number;
  shotIdx: number;
  pelletIdx: number;
  startFrame: number; // relative to READY_FRAMES
  age: number; // frames since startFrame
  phase: 'grow' | 'hold' | 'fade';
  localFrame: number;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  hitWall: boolean;
  effectiveMaxDist: number;
  headNow: number;
  /**
   * The bolt's own shape, seeded once per shot the way `wfws_firing` does it:
   * a table of kinks read at the point's place along the whole bolt, so its
   * corners stay put for the shot's life and a growing bolt reveals more of the
   * same shape. The preview has to use the same table or it shows a bolt the
   * game never draws.
   */
  jag1: number;
  jag2: number;
  jagVals: number[];
  /** One kink table per fork, seeded from the fork's own phase at spawn. */
  forkKinks: number[][];
}

export const BeamPreview: React.FC<BeamPreviewProps> = ({
  project,
  beam,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const [ambientTick, setAmbientTick] = useState(0);
  const [aimDeg, setAimDeg] = useState(0); // -40 (down) .. +40 (up)
  const [showHurtZone, setShowHurtZone] = useState(true);
  const [showWall, setShowWall] = useState(true);

  const seqCfg = useMemo(
    () => (project.fireSequence?.enabled ? mergeFireSequenceConfig(project.fireSequence) : null),
    [project.fireSequence],
  );

  // Compute exact lockstep dispatch schedule (single shot or multi-shot sequence)
  const schedule = useMemo(() => {
    const beamLife = Math.max(1, beam.growFrames + beam.holdFrames + beam.fadeFrames);
    if (!seqCfg) {
      return {
        isSequenced: false,
        shotCount: 1,
        pellets: 1,
        spreadDeg: 0,
        firstWaitFrames: beam.bufferFrames,
        dispatchFrames: [beam.bufferFrames],
        totalSequenceFrames: beam.bufferFrames + beamLife,
        beamLife,
        anchor: 'on_dispatch' as const,
        hasCustomRamp: false,
      };
    }
    const s = computeBeamSequenceSchedule(beam, seqCfg);
    const lastDispatch = s.dispatchFrames[s.dispatchFrames.length - 1] ?? s.firstWaitFrames;
    return {
      isSequenced: true,
      shotCount: s.dispatchFrames.length,
      pellets: Math.max(1, Math.round(seqCfg.burstSize)),
      spreadDeg: Math.max(0, Number(seqCfg.spreadDeg) || 0),
      firstWaitFrames: s.firstWaitFrames,
      dispatchFrames: s.dispatchFrames,
      totalSequenceFrames: lastDispatch + beamLife,
      beamLife,
      anchor: seqCfg.beamSequenceAnchor ?? 'on_dispatch',
      hasCustomRamp: s.emittedIntervalsMs !== null,
    };
  }, [beam, seqCfg]);

  const cycleFrames = READY_FRAMES + Math.max(1, schedule.totalSequenceFrames) + COOLDOWN_TAIL_FRAMES;

  // Image assets (worm, idle/hurt dummies, hands, hold/buffer/flash sheets, custom worm poses, beam/glow sheets)
  const wormImgRef = useRef<HTMLImageElement | null>(null);
  const wormIdleRef = useRef<HTMLImageElement | null>(null);
  const wormHurtRef = useRef<HTMLImageElement | null>(null);
  const wormLinkRef = useRef<HTMLImageElement | null>(null);
  const wormFireRef = useRef<HTMLImageElement | null>(null);
  const handMidRef = useRef<HTMLImageElement | null>(null);
  const handLowerRef = useRef<HTMLImageElement | null>(null);
  const handUpperRef = useRef<HTMLImageElement | null>(null);
  const defaultHoldRef = useRef<HTMLImageElement | null>(null);
  const holdImgRef = useRef<HTMLImageElement | null>(null);
  const bufferImgRef = useRef<HTMLImageElement | null>(null);
  const flashImgRef = useRef<HTMLImageElement | null>(null);
  const extraHandRef = useRef<HTMLImageElement | null>(null);
  const beamCoreRef = useRef<HTMLImageElement | null>(null);
  const beamGlowRef = useRef<HTMLImageElement | null>(null);
  const beamEndRef = useRef<HTMLImageElement | null>(null);
  const beamOrbRef = useRef<HTMLImageElement | null>(null);
  const pbCoreRef = useRef<HTMLImageElement | null>(null);
  const pbGlowRef = useRef<HTMLImageElement | null>(null);
  const pbOrbRef = useRef<HTMLImageElement | null>(null);
  const tintCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [assetEpoch, setAssetEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    wormImgRef.current = loadImg(WORM_AIM_SRC, bump);
    wormIdleRef.current = loadImg(WORM_IDLE_URL, bump);
    wormHurtRef.current = loadImg(WORM_HURT_URL, bump);
    handMidRef.current = loadImg(HAND_MID_SRC, bump);
    handLowerRef.current = loadImg(HAND_LOWER_SRC, bump);
    handUpperRef.current = loadImg(HAND_UPPER_SRC, bump);
  }, []);

  const artStyle = beam.artStyle ?? 'classic';
  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    const urls = BEAM_ART_STYLE_URLS[artStyle] ?? BEAM_ART_STYLE_URLS.classic;
    beamCoreRef.current = loadImg(urls.core, bump);
    beamGlowRef.current = loadImg(urls.glow, bump);
    beamEndRef.current = loadImg(urls.end, bump);
    beamOrbRef.current = loadImg(urls.orb, bump);
  }, [artStyle]);

  const pbArtStyle = beam.preBuffer?.enabled ? beam.preBuffer.artStyle : 'inherit';
  useEffect(() => {
    if (pbArtStyle === 'inherit') {
      pbCoreRef.current = null;
      pbGlowRef.current = null;
      pbOrbRef.current = null;
      return;
    }
    const bump = () => setAssetEpoch((n) => n + 1);
    const urls = BEAM_ART_STYLE_URLS[pbArtStyle] ?? BEAM_ART_STYLE_URLS.classic;
    pbCoreRef.current = loadImg(urls.core, bump);
    pbGlowRef.current = loadImg(urls.glow, bump);
    pbOrbRef.current = loadImg(urls.orb, bump);
  }, [pbArtStyle]);

  const defaultHoldSrc = useMemo(() => defaultArtFor(project).url, [project]);
  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    defaultHoldRef.current = loadImg(defaultHoldSrc, bump);
  }, [defaultHoldSrc]);

  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    holdImgRef.current = loadImg(project.hold?.sheetPreview, bump);
  }, [project.hold?.sheetPreview]);

  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    bufferImgRef.current = loadImg(project.hold?.bufferPreview, bump);
  }, [project.hold?.bufferPreview]);

  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    flashImgRef.current = loadImg(project.hold?.flashPreview, bump);
  }, [project.hold?.flashPreview]);

  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    extraHandRef.current = loadImg(project.hold?.extraHand?.preview, bump);
  }, [project.hold?.extraHand?.preview]);

  const customWormLinkPreview = project.wormSprites?.enabled
    ? project.wormSprites.poses?.weaponlnk?.preview
    : undefined;
  const customWormFirePreview = project.wormSprites?.enabled
    ? project.wormSprites.poses?.weaponfire?.preview
    : undefined;
  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    wormLinkRef.current = loadImg(customWormLinkPreview, bump);
  }, [customWormLinkPreview]);
  useEffect(() => {
    const bump = () => setAssetEpoch((n) => n + 1);
    wormFireRef.current = loadImg(customWormFirePreview, bump);
  }, [customWormFirePreview]);

  // 50 Hz lockstep simulation clock
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setTick((prev) => (prev + 1) % cycleFrames);
      setAmbientTick((prev) => prev + 1);
    }, 20);
    return () => window.clearInterval(id);
  }, [playing, cycleFrames]);

  useEffect(() => {
    if (tick >= cycleFrames) setTick(0);
  }, [tick, cycleFrames]);

  // Compute current worm pose role, active beam instances, and exact cumulative hits across all shots.
  const simState = useMemo(() => {
    const wormX = 76;
    const wormY = 152;
    const wallX = 368;
    const baseRad = (-aimDeg * Math.PI) / 180;
    const baseDx = Math.cos(baseRad);
    const baseDy = Math.sin(baseRad);
    const baseOx = wormX + beam.offsetX + baseDx * beam.standoff;
    const baseOy = wormY + beam.offsetY + baseDy * beam.standoff;

    const targetsWorld = DUMMY_TARGETS.map((t) => ({
      ...t,
      x: wormX + t.dx,
      y: wormY + t.dy,
    }));

    const bf = tick - READY_FRAMES; // < 0 during ready aim, >= 0 after trigger
    const isReady = bf < 0;
    const isBuffering = !isReady && bf < schedule.firstWaitFrames;
    const isDone = bf >= schedule.totalSequenceFrames;

    const hold = project.hold;
    const holdFireFrames = Math.max(1, Math.round(hold?.fireFrames ?? 1));
    const holdFireFps = Math.max(1, Number(hold?.fireFps) || 15);
    const activeDur = beam.growFrames + beam.holdFrames;
    const fireTicks = Math.max(
      4,
      activeDur,
      Math.round(hold?.fireTicks ?? Math.ceil((holdFireFrames * 50) / holdFireFps)),
    );

    // Find most recent dispatched shot for firing animation & HUD counter
    let shotsDispatched = 0;
    let lastDispatchFrame = -1;
    for (let s = 0; s < schedule.dispatchFrames.length; s += 1) {
      if (bf >= schedule.dispatchFrames[s]) {
        shotsDispatched = s + 1;
        lastDispatchFrame = schedule.dispatchFrames[s];
      }
    }

    const framesSinceLastFire = lastDispatchFrame >= 0 ? bf - lastDispatchFrame : -1;
    const isFiringPose =
      !isReady &&
      !isBuffering &&
      !isDone &&
      framesSinceLastFire >= 0 &&
      framesSinceLastFire < fireTicks;

    const poseRole: HoldPoseRole = isBuffering ? 'buffer' : isFiringPose ? 'firing' : 'aim';

    const tanHalfCone = Math.tan((beam.coneAngleDeg * Math.PI) / 180);

    const computeRay = (shotIdx: number, pelletIdx: number) => {
      let angOffsetDeg = 0;
      if (schedule.spreadDeg > 0) {
        if (schedule.pellets > 1) {
          const frac = pelletIdx / (schedule.pellets - 1) - 0.5;
          angOffsetDeg = frac * schedule.spreadDeg;
        } else {
          angOffsetDeg = (hash01(shotIdx * 97 + 13) * 2 - 1) * (schedule.spreadDeg * 0.5);
        }
      }
      const rad = (-(aimDeg + angOffsetDeg) * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const ox = wormX + beam.offsetX + dx * beam.standoff;
      const oy = wormY + beam.offsetY + dy * beam.standoff;

      let terrainDist = beam.range;
      let hitWall = false;
      const groundY = wormY + 18;
      const wallTopY = 24;
      if (showWall && beam.stopOnTerrain) {
        if (dx > 0.001) {
          const distToWall = (wallX - ox) / dx;
          const wallHitY = oy + dy * distToWall;
          if (distToWall > 0 && wallHitY >= wallTopY && wallHitY <= groundY && distToWall < terrainDist) {
            terrainDist = distToWall;
            hitWall = true;
          }
        }
        if (dy > 0.001) {
          const distToFloor = (groundY - oy) / dy;
          if (distToFloor > 0 && distToFloor < terrainDist) {
            terrainDist = distToFloor;
            hitWall = true;
          }
        }
      }
      const visibleRange = Math.min(terrainDist, 360);

      let firstTargetId: number | null = null;
      let firstTargetDist = visibleRange;
      if (beam.hurtMode === 'first' && beam.targets.worms) {
        for (const t of targetsWorld) {
          const px = t.x - ox;
          const py = t.y - oy;
          const along = px * dx + py * dy;
          const perp = Math.abs(px * -dy + py * dx);
          const bodyR = Math.max(10, t.radius * 0.7);
          if (along >= 0 && along <= firstTargetDist && perp <= beam.width + bodyR) {
            firstTargetDist = along;
            firstTargetId = t.id;
          }
        }
      }

      const effectiveMaxDist =
        beam.hurtMode === 'first' && firstTargetId !== null ? firstTargetDist : visibleRange;

      return {
        ox,
        oy,
        dx,
        dy,
        hitWall: hitWall && (beam.hurtMode !== 'first' || firstTargetId === null),
        firstTargetId,
        effectiveMaxDist,
      };
    };

    const headAtAge = (age: number, maxDist: number) => {
      if (beam.growFrames <= 0) return maxDist;
      if (age >= beam.growFrames) return maxDist;
      const frac = easeGrow((age + 1) / beam.growFrames, beam.growEase);
      return maxDist * frac;
    };

    // Simulate all beams dispatched up to bf, accumulating target hits & collecting active beams now
    const hits = new Map<number, { count: number; lastHitBf: number; lastDmg: number }>();
    const activeBeams: BeamInstanceSim[] = [];
    const craters: { x: number; y: number; dy: number }[] = [];

    if (!isReady) {
      for (let s = 0; s < schedule.dispatchFrames.length; s += 1) {
        const startFrame = schedule.dispatchFrames[s];
        if (bf < startFrame) break;

        for (let p = 0; p < schedule.pellets; p += 1) {
          const ray = computeRay(s, p);
          const age = bf - startFrame;

          // Accumulate deterministic hits for this beam instance (per-beam cooldown matches wfws_firing.lua)
          if (beam.hurtMode !== 'none' && beam.targets.worms) {
            const perBeamLastHit = new Map<number, number>();
            const maxSimAge = Math.min(age, activeDur - 1);
            const isArc = beam.path === 'arc' && beam.bulge !== 0 && ray.effectiveMaxDist > 0;
            const arcNx = ray.dy;
            const arcNy = -ray.dx;
            const arcSamples = [0, -16, 16, -32, 32];
            for (let a = 0; a <= maxSimAge; a += 1) {
              const head = headAtAge(a, ray.effectiveMaxDist);
              const atTip = head >= ray.effectiveMaxDist - 4;
              const tipBa = isArc ? Math.min(1, Math.max(0, head / ray.effectiveMaxDist)) : 0;
              const tipBow = isArc ? beam.bulge * Math.sin(tipBa * Math.PI) : 0;
              const tipX = ray.ox + ray.dx * head + arcNx * tipBow;
              const tipY = ray.oy + ray.dy * head + arcNy * tipBow;
              for (const t of targetsWorld) {
                if (!isArc && beam.hurtMode === 'first' && t.id !== ray.firstTargetId) continue;
                const px = t.x - ray.ox;
                const py = t.y - ray.oy;
                const along = px * ray.dx + py * ray.dy;
                const cAlong = Math.min(head, Math.max(0, along));
                let perp: number;
                if (isArc) {
                  let bestD = Infinity;
                  for (let si = 0; si < arcSamples.length; si += 1) {
                    const sAlong = Math.min(head, Math.max(0, cAlong + arcSamples[si]));
                    const ba = Math.min(1, Math.max(0, sAlong / ray.effectiveMaxDist));
                    const bow = beam.bulge * Math.sin(ba * Math.PI);
                    const ax = ray.ox + ray.dx * sAlong + arcNx * bow;
                    const ay = ray.oy + ray.dy * sAlong + arcNy * bow;
                    const d = Math.hypot(t.x - ax, t.y - ay);
                    if (d < bestD) bestD = d;
                  }
                  perp = bestD;
                } else {
                  const sx = ray.ox + ray.dx * cAlong;
                  const sy = ray.oy + ray.dy * cAlong;
                  perp = Math.hypot(t.x - sx, t.y - sy);
                }
                const halfW =
                  beam.hurtMode === 'cone'
                    ? beam.muzzleWidth + cAlong * tanHalfCone
                    : beam.width;
                const bodyR = Math.max(10, t.radius * 0.65);
                let hit = perp <= halfW + bodyR;
                if (!hit && atTip) {
                  const tipReach = Math.max(
                    halfW,
                    beam.terrainCut ? beam.cutRadius : 0,
                    project.explosionEffect?.enabled
                      ? project.explosionEffect.radius * 0.5
                      : beam.impactBurst?.enabled
                        ? beam.impactBurst.radius * 0.5
                        : 0,
                  );
                  if (Math.hypot(t.x - tipX, t.y - tipY) <= tipReach + bodyR) {
                    hit = true;
                  }
                }
                if (!hit) continue;

                const prevAge = perBeamLastHit.get(t.id);
                const canHit =
                  prevAge === undefined ||
                  (beam.hitCooldownFrames > 0 && a - prevAge >= beam.hitCooldownFrames);
                if (canHit) {
                  perBeamLastHit.set(t.id, a);
                  const hitBf = startFrame + a;
                  const dmg =
                    beam.damageMax > beam.damageMin
                      ? Math.round(
                          beam.damageMin +
                            hash01((hitBf + s * 17 + p * 5) * 31 + t.id * 97) *
                              (beam.damageMax - beam.damageMin),
                        )
                      : beam.damageMin;
                  const prevGlobal = hits.get(t.id);
                  if (!prevGlobal) {
                    hits.set(t.id, { count: 1, lastHitBf: hitBf, lastDmg: dmg });
                  } else {
                    hits.set(t.id, {
                      count: prevGlobal.count + 1,
                      lastHitBf: Math.max(prevGlobal.lastHitBf, hitBf),
                      lastDmg: hitBf >= prevGlobal.lastHitBf ? dmg : prevGlobal.lastDmg,
                    });
                  }
                }
              }
            }
          }

          // Crater persists once beam reaches wall
          const cutShape = beam.cutShape ?? 'circle';
          if (
            beam.terrainCut &&
            (cutShape !== 'circle' || beam.cutRadius > 0) &&
            ray.hitWall &&
            headAtAge(Math.min(age, activeDur), ray.effectiveMaxDist) >= ray.effectiveMaxDist - 4
          ) {
            craters.push({
              x: ray.ox + ray.dx * ray.effectiveMaxDist,
              y: ray.oy + ray.dy * ray.effectiveMaxDist,
              dy: ray.dy,
            });
          }

          // Collect currently visible beam instances
          if (age < schedule.beamLife) {
            let phase: 'grow' | 'hold' | 'fade';
            let localFrame: number;
            if (age < beam.growFrames) {
              phase = 'grow';
              localFrame = age;
            } else if (age < beam.growFrames + beam.holdFrames) {
              phase = 'hold';
              localFrame = age - beam.growFrames;
            } else {
              phase = 'fade';
              localFrame = age - beam.growFrames - beam.holdFrames;
            }
            const headNow =
              phase === 'grow' ? headAtAge(age, ray.effectiveMaxDist) : ray.effectiveMaxDist;

            const animStep =
              phase === 'fade' && beam.fadeMode === 'dissolve' ? age : Math.floor(age / 2);
            const jag1 = hash01(s * 977 + p * 131) * Math.PI * 2;
            const jag2 = hash01(s * 613 + p * 419 + 7) * Math.PI * 2;
            activeBeams.push({
              key: s * 100 + p,
              shotIdx: s,
              pelletIdx: p,
              startFrame,
              age,
              phase,
              localFrame,
              ox: ray.ox,
              oy: ray.oy,
              dx: ray.dx,
              dy: ray.dy,
              hitWall: ray.hitWall,
              effectiveMaxDist: ray.effectiveMaxDist,
              headNow,
              jag1,
              jag2,
              jagVals: beamKinks(jag1 * 131 + jag2 * 977 + animStep * 37, JAG_N),
              forkKinks: Array.from({ length: Math.max(0, beam.branches) }, (_, b) =>
                beamKinks(
                  hash01(s * 37 + p * 19 + b * 53) * 2 * Math.PI * 613 + 17 + animStep * 37,
                  7,
                ),
              ),
            });
          }
        }
      }
    }

    // Baseline ray for aim laser / hurt-zone guide when idle or buffering
    const guideRay = computeRay(0, 0);

    const pbCfg = mergeBeamPreBufferConfig(beam.preBuffer);
    let preBufferDist = pbCfg.range > 0 ? pbCfg.range : beam.range;
    if (showWall && pbCfg.stopOnTerrain) {
      const groundY = wormY + 18;
      const wallTopY = 24;
      if (guideRay.dx > 0.001) {
        const distToWall = (wallX - guideRay.ox) / guideRay.dx;
        const wallHitY = guideRay.oy + guideRay.dy * distToWall;
        if (distToWall > 0 && wallHitY >= wallTopY && wallHitY <= groundY && distToWall < preBufferDist) {
          preBufferDist = distToWall;
        }
      }
      if (guideRay.dy > 0.001) {
        const distToFloor = (groundY - guideRay.oy) / guideRay.dy;
        if (distToFloor > 0 && distToFloor < preBufferDist) {
          preBufferDist = distToFloor;
        }
      }
    }
    preBufferDist = Math.min(preBufferDist, 360);

    return {
      wormX,
      wormY,
      baseOx,
      baseOy,
      baseDx,
      baseDy,
      wallX,
      bf,
      isReady,
      isBuffering,
      isDone,
      isFiringPose,
      poseRole,
      framesSinceLastFire,
      shotsDispatched,
      targetsWorld,
      hits,
      activeBeams,
      craters,
      guideRay,
      preBufferDist,
      tanHalfCone,
    };
  }, [aimDeg, beam, project.hold, project.explosionEffect, schedule, showWall, tick]);

  // Draw 50 Hz frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const getTinted = (img: HTMLImageElement | null, hex: string): HTMLCanvasElement | null => {
      if (!img || !img.complete || img.naturalWidth === 0) return null;
      const key = `${img.src}|${hex}`;
      const existing = tintCacheRef.current.get(key);
      if (existing) return existing;
      if (tintCacheRef.current.size > 48) tintCacheRef.current.clear();
      const created = tintedSheet(img, hex);
      tintCacheRef.current.set(key, created);
      return created;
    };

    // WormBench samples its quads point-wise (see `cell_uv`'s half-texel inset),
    // so the canvas has to as well: bilinear scaling softens every edge and
    // makes the same beam read dimmer here than in game.
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // 1. Tactical dark twilight stage backdrop (high contrast for additive beams & pixel sprites)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bgGrad.addColorStop(0, '#0f1420');
    bgGrad.addColorStop(0.72, '#141a28');
    bgGrad.addColorStop(1, '#1a1f2b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Subtle 20px calibration grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 20; x < CANVAS_W; x += 20) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CANVAS_H);
    }
    for (let y = 20; y < CANVAS_H; y += 20) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_W, y + 0.5);
    }
    ctx.stroke();

    // Ground shelf under worm + targets
    const groundY = simState.wormY + 18;
    ctx.fillStyle = '#252b3b';
    ctx.fillRect(0, groundY, CANVAS_W, CANVAS_H - groundY);
    ctx.fillStyle = '#3b455e';
    ctx.fillRect(0, groundY, CANVAS_W, 3);

    // Optional terrain wall on the right + scorched craters
    if (showWall) {
      const wx = simState.wallX;
      ctx.fillStyle = '#2c3345';
      ctx.fillRect(wx, 24, CANVAS_W - wx, groundY - 24);
      ctx.fillStyle = '#475569';
      ctx.fillRect(wx, 24, 3, groundY - 24);

      const cutShape = beam.cutShape ?? 'circle';
      if (simState.craters.length > 0 && (cutShape !== 'circle' || beam.cutRadius > 0)) {
        ctx.save();
        for (const c of simState.craters) {
          ctx.beginPath();
          if (cutShape === 'drill') {
            ctx.ellipse(c.x, c.y, 9, 17, 0, 0, Math.PI * 2);
          } else if (cutShape === 'torch') {
            const tilt = c.dy < -0.1 ? -0.35 : c.dy > 0.1 ? 0.35 : 0;
            ctx.ellipse(c.x + 4, c.y, 16, 10, tilt, 0, Math.PI * 2);
          } else {
            ctx.arc(c.x, c.y, beam.cutRadius, 0, Math.PI * 2);
          }
          ctx.fillStyle = '#141a28';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(251, 146, 60, 0.55)';
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 2. Translucent Hurt-Layer Geometry Overlay (Corridor / Cone / First-Hit)
    const drawHurtEnvelope = (
      ox: number,
      oy: number,
      dx: number,
      dy: number,
      dist: number,
      active: boolean,
    ) => {
      if (dist <= 4) return;
      const nx = -dy;
      const ny = dx;
      const ex = ox + dx * dist;
      const ey = oy + dy * dist;
      const w0 = beam.hurtMode === 'cone' ? beam.muzzleWidth : beam.width;
      const w1 =
        beam.hurtMode === 'cone'
          ? beam.muzzleWidth + dist * simState.tanHalfCone
          : beam.width;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ox + nx * w0, oy + ny * w0);
      ctx.lineTo(ex + nx * w1, ey + ny * w1);
      ctx.lineTo(ex - nx * w1, ey - ny * w1);
      ctx.lineTo(ox - nx * w0, oy - ny * w0);
      ctx.closePath();

      ctx.fillStyle = active
        ? 'rgba(249, 115, 22, 0.11)'
        : 'rgba(148, 163, 184, 0.07)';
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = active
        ? 'rgba(251, 146, 60, 0.48)'
        : 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    };

    if (showHurtZone && beam.hurtMode !== 'none') {
      if (simState.activeBeams.length > 0) {
        // Draw hurt envelope for the newest active beam(s) (cap at 5 so thick bursts stay crisp)
        const shown = simState.activeBeams.slice(-5);
        for (const inst of shown) {
          drawHurtEnvelope(inst.ox, inst.oy, inst.dx, inst.dy, inst.headNow, true);
        }
      } else {
        drawHurtEnvelope(
          simState.guideRay.ox,
          simState.guideRay.oy,
          simState.guideRay.dx,
          simState.guideRay.dy,
          simState.guideRay.effectiveMaxDist,
          false,
        );
      }
    }

    // 3. Draw Target Worms (idle.png 20f when idling, hurt.png 3f when hurting)
    const wormImg = wormImgRef.current;
    const wormIdleImg = wormIdleRef.current;
    const wormHurtImg = wormHurtRef.current;
    const HURT_ANIM_FRAMES = 14;

    for (const t of simState.targetsWorld) {
      const hitInfo = simState.hits.get(t.id);
      const framesSinceHit = hitInfo ? simState.bf - hitInfo.lastHitBf : 999;
      const flashing = hitInfo !== undefined && framesSinceHit >= 0 && framesSinceHit < 6;
      const hurting =
        hitInfo !== undefined &&
        framesSinceHit >= 0 &&
        framesSinceHit < HURT_ANIM_FRAMES &&
        !simState.isReady;

      if (t.dy < 0) {
        ctx.fillStyle = '#334155';
        ctx.fillRect(t.x - 14, t.y + 13, 28, 4);
      }

      let recoilX = 0;
      let recoilY = 0;
      if (hurting) {
        const pulse = Math.sin((framesSinceHit / HURT_ANIM_FRAMES) * Math.PI);
        if (beam.interact) {
          const mag = Math.min(6, 1.8 + beam.push * 0.35) * pulse;
          recoilX = simState.baseDx * mag;
          recoilY = simState.baseDy * mag * 0.5 - pulse * 1.5;
        } else {
          recoilX = (framesSinceHit % 2 === 0 ? 1 : -1) * 1.2 * pulse;
        }
      }

      // Target worms face LEFT natively, toward the shooter, so no horizontal flip is needed
      const activeSheet =
        hurting && wormHurtImg && wormHurtImg.complete && wormHurtImg.naturalWidth > 0
          ? wormHurtImg
          : wormIdleImg && wormIdleImg.complete && wormIdleImg.naturalWidth > 0
            ? wormIdleImg
            : null;

      if (activeSheet) {
        const cellW = activeSheet.naturalWidth;
        const totalFrames = Math.max(1, Math.round(activeSheet.naturalHeight / Math.max(1, cellW)));
        const cellH = activeSheet.naturalHeight / totalFrames;
        const frameIdx = hurting
          ? Math.min(totalFrames - 1, Math.floor((framesSinceHit / HURT_ANIM_FRAMES) * totalFrames))
          : Math.floor(ambientTick / 4 + t.id * 7) % totalFrames;

        ctx.save();
        ctx.translate(t.x + recoilX, t.y + recoilY);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          activeSheet,
          0,
          frameIdx * cellH,
          cellW,
          cellH,
          -cellW / 2,
          -cellH / 2,
          cellW,
          cellH,
        );
        ctx.restore();
      } else if (wormImg && wormImg.complete && wormImg.naturalWidth > 0) {
        const cellH = wormImg.naturalHeight / 32;
        const cellW = wormImg.naturalWidth;
        ctx.save();
        ctx.translate(t.x + recoilX, t.y + recoilY);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          wormImg,
          0,
          16 * cellH,
          cellW,
          cellH,
          -cellW / 2,
          -cellH / 2,
          cellW,
          cellH,
        );
        ctx.restore();
      } else {
        ctx.fillStyle = '#f4a7b9';
        ctx.beginPath();
        ctx.arc(t.x + recoilX, t.y + recoilY, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      if (flashing) {
        ctx.save();
        ctx.strokeStyle = beam.kind === 'taze' ? '#7dd3fc' : '#fb923c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 13 + framesSinceHit * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (hitInfo && !simState.isReady && framesSinceHit >= 0 && framesSinceHit < 36) {
        const lift = Math.min(18, framesSinceHit * 1.1);
        ctx.save();
        ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        const txt = `-${hitInfo.lastDmg}${hitInfo.count > 1 ? ` ×${hitInfo.count}` : ''}`;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(t.x - 24, t.y - 31 - lift * 0.4, 48, 14);
        ctx.fillStyle = beam.kind === 'taze' ? '#7dd3fc' : '#fda4af';
        ctx.fillText(txt, t.x, t.y - 21 - lift * 0.4);

        if (beam.hitCooldownFrames > 0 && framesSinceHit < beam.hitCooldownFrames) {
          const frac = 1 - framesSinceHit / beam.hitCooldownFrames;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.fillRect(t.x - 14, t.y + 18, 28, 3);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(t.x - 14, t.y + 18, 28 * frac, 3);
        }
        ctx.restore();
      }
    }

    // 4. Draw Firing Worm (facing RIGHT, matching HoldPreview) + Imported Sprite Builder Aim / Buffer / Firing Art
    const aimT = Math.max(0, Math.min(1, 0.5 + aimDeg / 180));
    const hold = project.hold;

    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
      offscreenRef.current.width = OFF_SIZE;
      offscreenRef.current.height = OFF_SIZE;
    }
    const offCanvas = offscreenRef.current;
    const offCtx = offCanvas.getContext('2d');
    if (offCtx) {
      offCtx.clearRect(0, 0, OFF_SIZE, OFF_SIZE);
      const cx = OFF_CENTER;
      const cy = OFF_CENTER;

      // Support custom worm_sprites (weaponlnk / weaponfire) if enabled, else standard aim worm
      const customPoseImg =
        simState.poseRole === 'firing' &&
        wormFireRef.current &&
        wormFireRef.current.complete &&
        wormFireRef.current.naturalWidth > 0
          ? wormFireRef.current
          : wormLinkRef.current &&
              wormLinkRef.current.complete &&
              wormLinkRef.current.naturalWidth > 0
            ? wormLinkRef.current
            : null;
      const customPoseFrames =
        simState.poseRole === 'firing' && customPoseImg === wormFireRef.current
          ? Math.max(1, project.wormSprites?.poses?.weaponfire?.frames ?? 32)
          : Math.max(1, project.wormSprites?.poses?.weaponlnk?.frames ?? 32);

      const activeWormBody = customPoseImg ?? wormImg;
      const bodyFrames = customPoseImg ? customPoseFrames : 32;
      if (activeWormBody && activeWormBody.complete && activeWormBody.naturalWidth > 0) {
        const cellH = activeWormBody.naturalHeight / bodyFrames;
        const cellW = activeWormBody.naturalWidth;
        const aimFrame = Math.min(bodyFrames - 1, Math.max(0, Math.round(aimT * (bodyFrames - 1))));
        offCtx.save();
        offCtx.translate(cx, cy);
        offCtx.scale(-1, 1);
        offCtx.imageSmoothingEnabled = false;
        offCtx.drawImage(
          activeWormBody,
          0,
          aimFrame * cellH,
          cellW,
          cellH,
          -cellW / 2,
          -cellH / 2,
          cellW,
          cellH,
        );
        offCtx.restore();
      }

      if (hold?.enabled) {
        const clip = project.aimClip ?? DEFAULT_AIM_CLIP;
        const swingPose =
          clip.enabled && (simState.isBuffering || simState.isFiringPose)
            ? evalClip(clip, Math.max(0, simState.bf))
            : null;

        // Always animate multi-frame aiming sprites at their configured FPS while aiming!
        const totalHoldFrames = Math.max(1, Math.round(hold.frames || 1));
        const holdFps = Math.max(1, Number(hold.fps) || 15);
        const currentHoldFrame =
          totalHoldFrames > 1
            ? Math.floor(((ambientTick / 50) * holdFps) % totalHoldFrames)
            : 0;

        // Buffering strip clock (restarts at trigger frame)
        const bufferStripFrames = Math.max(1, Math.round(hold.bufferFrames || 1));
        const bufferFps = Math.max(1, Number(hold.bufferFps) || 15);
        const bufferPreviewFrame =
          simState.isBuffering && bufferStripFrames > 1
            ? Math.floor(((Math.max(0, simState.bf) / 50) * bufferFps) % bufferStripFrames)
            : 0;

        // Firing strip clock (restarts cleanly on EVERY shot in a sequence)
        const fireStripFrames = Math.max(1, Math.round(hold.fireFrames || 1));
        const fireFps = Math.max(1, Number(hold.fireFps) || 15);
        const firePreviewFrame =
          simState.isFiringPose && fireStripFrames > 1
            ? Math.floor(
                ((Math.max(0, simState.framesSinceLastFire) / 50) * fireFps) % fireStripFrames,
              )
            : 0;

        drawHoldOverlay(offCtx, {
          hold,
          cx,
          cy,
          aimT,
          poseRole: simState.poseRole,
          firingView: simState.poseRole === 'firing',
          currentFrame: currentHoldFrame,
          bufferPreviewFrame,
          bufferStripFrames,
          firePreviewFrame,
          fireStripFrames,
          swingPose,
          weaponImg: holdImgRef.current,
          defaultHoldImg: defaultHoldRef.current,
          bufferImg: bufferImgRef.current,
          flashImg: flashImgRef.current,
          handMidImg: handMidRef.current,
          handLowerImg: handLowerRef.current,
          handUpperImg: handUpperRef.current,
          extraHandImg: extraHandRef.current,
        });
      }

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offCanvas, simState.wormX - OFF_CENTER, simState.wormY - OFF_CENTER);
      ctx.restore();
    }

    const activeColorHex = beam.rainbow
      ? hslToHex((tick * 14.4) % 360)
      : normalizeTintHex(beam.color);

    const smooth = (t: number) => t * t * (3 - 2 * t);
    const drawRibbonStrip = (
      points: { x: number; y: number; frac: number; d?: number }[],
      wStart: number,
      wEnd: number,
      widthScale: number,
      sheet: HTMLCanvasElement | null,
      strokeColor: string,
      passAlpha: number,
      fadePx = 0,
      _flip = false,
      headPx = 0,
      uFrom = 0,
      uTo = 1,
    ) => {
      if (points.length < 2 || passAlpha <= 0.01) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const sdx = b.x - a.x;
        const sdy = b.y - a.y;
        const len = Math.hypot(sdx, sdy);
        if (len < 0.2) continue;
        const ang = Math.atan2(sdy, sdx);
        const midFrac = (a.frac + b.frac) * 0.5;
        const midD = ((a.d ?? 0) + (b.d ?? 0)) * 0.5;
        const k =
          fadePx > 0
            ? smooth(Math.max(0, Math.min(1, Math.min(midD, headPx - midD) / fadePx)))
            : 1;
        let w = Math.max(0.5, (wStart + (wEnd - wStart) * midFrac) * widthScale);
        if (fadePx > 0) w *= 0.45 + 0.55 * k;
        ctx.globalAlpha = Math.max(0, Math.min(1, passAlpha * (fadePx > 0 ? k : 1)));

        if (sheet) {
          const span = Math.max(1, points.length - 1);
          const ua = uFrom + (uTo - uFrom) * (i / span);
          const ub = uFrom + (uTo - uFrom) * ((i + 1) / span);
          const sw = sheet.width;
          const lo = Math.min(ua, ub) * sw;
          const hi = Math.max(ua, ub) * sw;
          const sliceW = Math.max(0.5, hi - lo);
          ctx.save();
          ctx.translate((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
          ctx.rotate(ang);
          if (ua > ub) ctx.scale(-1, 1);
          ctx.drawImage(sheet, lo, 0, sliceW, sheet.height, -len * 0.5, -w * 0.5, len, w);
          ctx.restore();
        } else {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = Math.max(1, w * 0.28);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    // 5. Charge / Buffer Animation at Muzzle
    if (simState.isBuffering && schedule.firstWaitFrames > 0) {
      const p = (simState.bf + 1) / Math.max(1, schedule.firstWaitFrames);
      const { ox, oy, dx, dy, effectiveMaxDist } = simState.guideRay;
      const pbCfg = beam.preBuffer?.enabled ? mergeBeamPreBufferConfig(beam.preBuffer) : null;

      if (!pbCfg) {
        ctx.save();
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = `${activeColorHex}66`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + dx * effectiveMaxDist, oy + dy * effectiveMaxDist);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.globalCompositeOperation = 'lighter';
        const orbR = 4 + p * Math.min(20, beam.coreWidth * 0.35 + 6);
        const grad = ctx.createRadialGradient(ox, oy, 1, ox, oy, orbR * 1.8);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.45, activeColorHex);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ox, oy, orbR * 1.8, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 0; i < 6; i += 1) {
          const ang = (i / 6) * Math.PI * 2 + simState.bf * 0.28;
          const r = (1 - p) * 26 + 3;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(ox + Math.cos(ang) * r - 1, oy + Math.sin(ang) * r - 1, 2.5, 2.5);
        }
        ctx.restore();
      } else {
        const pbHex = pbCfg.rainbow
          ? hslToHex((tick * 14.4) % 360)
          : pbCfg.color.trim()
            ? normalizeTintHex(pbCfg.color)
            : activeColorHex;
        let pbAlpha = pbCfg.alphaStart + (pbCfg.alphaEnd - pbCfg.alphaStart) * p;
        if (pbCfg.pulse > 0) {
          pbAlpha *= 1 - pbCfg.pulse * 0.45 + pbCfg.pulse * 0.45 * Math.sin(simState.bf * 0.55);
        }
        if (pbCfg.flicker > 0) {
          pbAlpha *= 1 - pbCfg.flicker * 0.5 + hash01(tick * 29 + 7) * pbCfg.flicker;
        }
        pbAlpha = Math.max(0, Math.min(1, pbAlpha));

        const drawLen = pbCfg.reach === 'grow' ? simState.preBufferDist * p : simState.preBufferDist;
        const wScale = 1 + (pbCfg.endWidthScale - 1) * p;
        const rawCoreImg =
          pbCfg.artStyle !== 'inherit' && pbCoreRef.current ? pbCoreRef.current : beamCoreRef.current;
        const rawGlowImg =
          pbCfg.artStyle !== 'inherit' && pbGlowRef.current ? pbGlowRef.current : beamGlowRef.current;
        const rawOrbImg =
          pbCfg.artStyle !== 'inherit' && pbOrbRef.current ? pbOrbRef.current : beamOrbRef.current;

        if (pbCfg.showBeam && drawLen >= 2 && pbAlpha > 0.01) {
          const coreTint = getTinted(rawCoreImg, pbHex);
          const glowTint = getTinted(rawGlowImg, pbHex);
          const hotTint = getTinted(rawCoreImg, '#ffffff');
          const nx = -dy;
          const ny = dx;
          const segs = Math.min(64, Math.max(2, pbCfg.points * 2));
          const jagStep = Math.floor(simState.bf / 2);
          const jagVals = beamKinks(jagStep * 37 + 131, JAG_N);
          const glowEnd = pbCfg.tipWidth > 0 ? Math.max(pbCfg.glowWidth, pbCfg.tipWidth * 1.6) : pbCfg.glowWidth;

          const drawPbStrip = (lat0: number, lat1: number) => {
            const pts: { x: number; y: number; frac: number }[] = [];
            for (let i = 0; i <= segs; i += 1) {
              const t = i / segs;
              const d = drawLen * t;
              let lat = lat0 + (lat1 - lat0) * t;
              if (pbCfg.path === 'arc' && pbCfg.bulge !== 0) {
                lat -= Math.sin(t * Math.PI) * pbCfg.bulge;
              } else if (pbCfg.path === 'jagged' && pbCfg.noise > 0 && t > 0 && t < 1) {
                lat += beamKinkAt(jagVals, t) * Math.sin(t * Math.PI) * pbCfg.noise;
              }
              pts.push({
                x: ox + dx * d + nx * lat,
                y: oy + dy * d + ny * lat,
                frac: t,
              });
            }
            if (pbCfg.glowWidth > 0) {
              drawRibbonStrip(pts, pbCfg.glowWidth, glowEnd, wScale, glowTint, pbHex, pbAlpha * 0.55);
            }
            if (pbCfg.coreWidth > 0) {
              drawRibbonStrip(pts, pbCfg.coreWidth, pbCfg.tipWidth, wScale, coreTint, pbHex, pbAlpha);
              if (pbCfg.coreWidth * wScale >= 3) {
                drawRibbonStrip(
                  pts,
                  Math.max(0.5, pbCfg.coreWidth * 0.42),
                  Math.max(0.5, pbCfg.tipWidth * 0.42),
                  wScale,
                  hotTint,
                  '#ffffff',
                  pbAlpha * 0.78,
                );
              }
            }
          };

          if (pbCfg.reach === 'converge') {
            const spread = pbCfg.convergeSpread * (1 - p);
            drawPbStrip(spread * 0.25, spread);
            drawPbStrip(-spread * 0.25, -spread);
          } else {
            drawPbStrip(0, 0);
          }
        }

        if (pbCfg.showOrb) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const sc = Math.max(0.25, pbCfg.orbScale);
          const pulseScale = 0.85 + 0.15 * Math.sin(simState.bf * 0.65);
          const orbR = (4 + p * Math.min(20, Math.max(4, beam.coreWidth) * 0.35 + 6)) * pulseScale * sc;
          const orbHalo = getTinted(rawOrbImg, pbHex);
          const orbCore = getTinted(rawOrbImg, '#ffffff');
          if (orbHalo && orbCore) {
            ctx.globalAlpha = 0.55 + 0.35 * p;
            ctx.drawImage(orbHalo, ox - orbR * 1.8, oy - orbR * 1.8, orbR * 3.6, orbR * 3.6);
            ctx.globalAlpha = 0.75 + 0.25 * p;
            ctx.drawImage(orbCore, ox - orbR * 0.9, oy - orbR * 0.9, orbR * 1.8, orbR * 1.8);
          } else {
            const grad = ctx.createRadialGradient(ox, oy, 1, ox, oy, orbR * 1.8);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.45, pbHex);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(ox, oy, orbR * 1.8, 0, Math.PI * 2);
            ctx.fill();
          }

          const motes = Math.max(0, Math.min(12, Math.round(pbCfg.orbMotes)));
          for (let i = 0; i < motes; i += 1) {
            const ang = (i / Math.max(1, motes)) * Math.PI * 2 + simState.bf * 0.28;
            const r = (1 - p) * 26 * sc + 3 * sc;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(ox + Math.cos(ang) * r - 1, oy + Math.sin(ang) * r - 1, 2.5 * sc, 2.5 * sc);
          }
          ctx.restore();
        }
      }
    }

    // 6. Active Beam Render (supports simultaneous overlapping beams in a sequence!)

    const tipW = beam.tipWidth > 0 ? beam.tipWidth : beam.coreWidth;
    const glowEndW =
      beam.tipWidth > 0
        ? Math.max(beam.glowWidth, beam.tipWidth * 1.35)
        : beam.glowWidth;

    for (const inst of simState.activeBeams) {
      if (inst.headNow <= 1) continue;
      const instColorHex = beam.rainbow
        ? hslToHex(((tick + inst.shotIdx * 37 + inst.pelletIdx * 19) * 11) % 360)
        : activeColorHex;
      const coreTint = getTinted(beamCoreRef.current, instColorHex);
      const glowTint = getTinted(beamGlowRef.current, instColorHex);
      const endTint = getTinted(beamEndRef.current, instColorHex);

      const { ox, oy, dx, dy, headNow } = inst;
      const nx = -dy;
      const ny = dx;

      let alpha = 1;
      let tailFrac = 0;
      let widthScale = 1;
      let extraNoise = 0;

      if (inst.phase === 'fade' && beam.fadeFrames > 0) {
        const t = (inst.localFrame + 1) / beam.fadeFrames;
        if (beam.fadeMode === 'fade') {
          alpha = Math.max(0, 1 - t);
        } else if (beam.fadeMode === 'retract') {
          tailFrac = Math.min(0.98, t);
          alpha = Math.max(0.15, 1 - t * 0.5);
        } else if (beam.fadeMode === 'dissolve') {
          alpha = Math.max(0, 1 - t);
          widthScale = Math.max(0.15, 1 - t * 0.65);
          extraNoise = t * 14;
        }
      }

      if (beam.flicker) {
        // Brightness only: `wfws_firing` never flickers the width, and a beam
        // that pulses in thickness here would be a look the game does not have.
        const pulse = 0.88 + hash01((tick + inst.key) * 19 + 7) * 0.24;
        alpha *= Math.min(1, pulse);
      }

      const startDist = headNow * tailFrac;
      // Three times the path resolution, as `wfws_firing` draws it: `points` is
      // how many kinks the bolt has, which on a long beam is ~29 px apart, far
      // too coarse for an end that fades over ~20 px.
      const segs = Math.min(64, Math.max(2, beam.points * 3));
      const pts: { x: number; y: number; frac: number; d: number }[] = [];

      for (let i = 0; i <= segs; i += 1) {
        const u = i / segs;
        const d = startDist + (headNow - startDist) * u;
        let lat = 0;
        const pin = Math.sin(u * Math.PI);
        // `wfws_firing`'s `beam_jag`: the shot's kink table read at the point's
        // place along the whole bolt, pinned at both ends.
        const jagAt = (ta: number, amp: number) => {
          if (amp <= 0 || ta <= 0 || ta >= 1) return 0;
          return beamKinkAt(inst.jagVals, ta) * Math.sin(ta * Math.PI) * amp;
        };
        if (beam.path === 'arc') {
          // +bulge arches UP along (dy, -dx) = (-nx, -ny), matching `beam_arc_normal` in Lua
          const ta = inst.effectiveMaxDist > 0 ? Math.min(1, d / inst.effectiveMaxDist) : u;
          lat -= Math.sin(ta * Math.PI) * beam.bulge;
        } else if (beam.path === 'jagged') {
          lat += jagAt(u, beam.noise + extraNoise);
        } else if (extraNoise > 0) {
          lat += jagAt(u, extraNoise);
        }
        pts.push({
          x: ox + dx * d + nx * lat,
          y: oy + dy * d + ny * lat,
          frac: u,
          d,
        });
      }

      // Outer glow pass (matches wfws_firing.lua fixed additive glow strength)
      if (beam.glowWidth > 0) {
        // The endpoint sheet is the band's own first and last piece and the
        // glow body is shifted inward to make room for it, so nothing is drawn
        // outside the beam: no bloom over the worm at the muzzle, nothing
        // smeared past what the beam struck. Its bright side always faces the
        // interior, so the join is the same brightness on both sides.
        const capLen = Math.min(96, Math.max(12, Math.max(beam.glowWidth, glowEndW) * 0.6));
        let k0 = 0;
        let k1 = pts.length - 1;
        if (endTint && headNow > capLen * 2.5) {
          while (k0 < pts.length - 1 && pts[k0].d < capLen) k0 += 1;
          k1 = k0;
          while (k1 < pts.length - 1 && pts[k1].d <= headNow - capLen) k1 += 1;
          if (k1 - k0 < 1) {
            k0 = 0;
            k1 = pts.length - 1;
          }
        }
        const hasCaps = k0 > 0 || k1 < pts.length - 1;
        drawRibbonStrip(
          pts.slice(k0, k1 + 1),
          beam.glowWidth,
          glowEndW,
          widthScale,
          glowTint,
          instColorHex,
          alpha * 0.55,
        );
        if (hasCaps && endTint) {
          if (k0 > 0) {
            // Mirrored: the sheet's faded side is at its right, and the fade
            // has to sit at the muzzle.
            drawRibbonStrip(
              pts.slice(0, k0 + 1),
              beam.glowWidth,
              glowEndW,
              widthScale,
              endTint,
              instColorHex,
              alpha * 0.55,
              0,
              false,
              0,
              1,
              0,
            );
          }
          if (k1 < pts.length - 1) {
            drawRibbonStrip(
              pts.slice(k1),
              beam.glowWidth,
              glowEndW,
              widthScale,
              endTint,
              instColorHex,
              alpha * 0.55,
              0,
              false,
              0,
              0,
              1,
            );
          }
        }
      }

      const coreFadePx = Math.min(
        Math.min(96, Math.max(12, Math.max(beam.glowWidth, glowEndW) * 0.6)),
        Math.max(8, headNow * 0.1),
      );
      // Main colored core pass
      drawRibbonStrip(
        pts,
        beam.coreWidth,
        tipW,
        widthScale,
        coreTint,
        instColorHex,
        alpha,
        coreFadePx,
        false,
        headNow,
      );
      // Blazing white-hot inner filament pass (matches `RIBS.hot` in wfws_firing.lua)
      const hotTint = getTinted(beamCoreRef.current, '#ffffff');
      drawRibbonStrip(
        pts,
        Math.max(1.5, beam.coreWidth * 0.44),
        Math.max(1.5, tipW * 0.44),
        widthScale,
        hotTint,
        '#ffffff',
        alpha * 0.72,
        coreFadePx,
        false,
        headNow,
      );

      // Secondary lightning forks (the library draws them for any `look`)
      if (beam.branches > 0) {
        for (let b = 0; b < beam.branches; b += 1) {
          // A fork's anchor and bend are fixed when the beam is made
          // (`b.forks` in `wfws_firing`), not re-drawn every frame.
          const anchorIdx = Math.max(
            1,
            Math.min(
              pts.length - 2,
              Math.floor(hash01(inst.key * 17 + b * 53) * (pts.length - 2)) + 1,
            ),
          );
          const root = pts[anchorIdx];
          const rootFrac = root.frac;
          const side = b % 2 === 0 ? 1 : -1;
          // `wfws_firing` walks the fork from the bolt's own normal plus half
          // its direction, and its length is a fraction of the *exposed* head:
          // `(1 - t) * head * 0.3`. Scaling the reach with the head is why a
          // close-range shot has short side beams in game; a fixed 38 px reach
          // here drew them full length at any distance.
          const reach = (1 - rootFrac) * headNow * 0.3;
          const vx = nx * side + dx * 0.5;
          const vy = ny * side + dy * 0.5;
          const kinks = inst.forkKinks[b];
          const fPts: { x: number; y: number; frac: number }[] = [
            { x: root.x, y: root.y, frac: 0 },
          ];
          const steps = 5;
          for (let s = 1; s <= steps; s += 1) {
            const frac = s / steps;
            const j =
              beamKinkAt(kinks, frac) * Math.sin(frac * Math.PI) * Math.max(2, beam.noise * 0.4);
            fPts.push({
              x: root.x + vx * reach * frac - vy * j,
              y: root.y + vy * reach * frac + vx * j,
              frac,
            });
          }
          drawRibbonStrip(
            fPts,
            Math.max(3, Math.min(24, beam.coreWidth * 0.55)),
            Math.max(1, Math.min(24, beam.coreWidth * 0.55) * 0.2),
            widthScale,
            coreTint,
            instColorHex,
            alpha * 0.75,
          );
        }
      }

      // Tip / Impact flare & sparks (matches `draw_tip_flare` in wfws_firing.lua)
      const tipPt = pts[pts.length - 1];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const tipR = Math.max(8, tipW * 0.9);
      const orbTint = getTinted(beamOrbRef.current, instColorHex);
      const orbWhite = getTinted(beamOrbRef.current, '#ffffff');
      if (orbTint && orbWhite) {
        const outerR = tipR * 1.05;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.85));
        ctx.drawImage(orbTint, tipPt.x - outerR, tipPt.y - outerR, outerR * 2, outerR * 2);
        const innerR = tipR * 0.55;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.95));
        ctx.drawImage(orbWhite, tipPt.x - innerR, tipPt.y - innerR, innerR * 2, innerR * 2);
      } else {
        ctx.globalAlpha = alpha;
        const tipGrad = ctx.createRadialGradient(tipPt.x, tipPt.y, 1, tipPt.x, tipPt.y, tipR);
        tipGrad.addColorStop(0, '#ffffff');
        tipGrad.addColorStop(0.5, instColorHex);
        tipGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = tipGrad;
        ctx.beginPath();
        ctx.arc(tipPt.x, tipPt.y, tipR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Impact burst effect preview (full Effect Manager explosionEffect or legacy impactBurst at beam tip)
      const expFx = project.explosionEffect;
      const ib = expFx?.enabled
        ? {
            enabled: true,
            shape: expFx.shape,
            radius: Math.min(80, expFx.radius),
            color: expFx.rainbow ? hslToHex((tick * 14.4) % 360) : expFx.color,
            rebufferMode: expFx.rebuffer ? (expFx.rebufferMode ?? 'px') : 'none',
            rebufferAt: expFx.rebufferAt ?? 12,
            starPoints: expFx.starPoints ?? 5,
            spin: expFx.spin ?? 0.16,
            centerGlow: expFx.centerGlow,
          }
        : beam.impactBurst;
      if (ib?.enabled && headNow >= inst.effectiveMaxDist - 4) {
        const impactAge = Math.max(0, inst.age - beam.growFrames);
        const live = 24;
        if (impactAge <= live) {
          const dur = 18;
          const fadeRate = 0.55;
          const rbAt = Math.max(2, ib.rebufferAt ?? 12);
          const rebuffered = ib.rebufferMode !== 'none' && impactAge >= rbAt;
          let ibTimer = impactAge * fadeRate;
          let boost = 0;
          if (rebuffered) {
            if (ib.rebufferMode === 'pulse') {
              ibTimer = (impactAge - rbAt) * 0.65;
              boost = Math.max(0, 0.45 - (impactAge - rbAt) * 0.1);
            } else if (ib.rebufferMode === 'flash') {
              boost = Math.max(0, 0.65 - (impactAge - rbAt) * 0.1);
            } else {
              ibTimer = rbAt * fadeRate + (impactAge - rbAt) * -0.85;
            }
          }
          const p = Math.max(0, Math.min(1, ibTimer / dur));
          const env = Math.max(0, Math.min(1, 1 - p + boost));
          const rNow = ib.radius * (1 + 2.2 * p);
          const ibHex = ib.color?.trim() ? normalizeTintHex(ib.color) : instColorHex;
          const isStar = ib.shape === 'star' || ib.shape === 'spin_star';
          const ptsN = Math.max(3, Math.min(12, ib.starPoints ?? 5));
          const rot = ib.shape === 'spin_star' ? impactAge * (ib.spin ?? 0.18) : 0;
          const segN = Math.max(20, ptsN * 4);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          if (ib.shape !== 'none') {
            ctx.globalAlpha = env * 0.85;
            ctx.strokeStyle = ibHex;
            ctx.lineWidth = Math.max(1.5, 4 * (1 - p));
            ctx.beginPath();
            for (let i = 0; i <= segN; i += 1) {
              const a = (i / segN) * Math.PI * 2;
              const mul = isStar ? 1 + 0.38 * Math.cos(a * ptsN) : 1;
              const aa = a + rot;
              const bx = tipPt.x + Math.cos(aa) * rNow * mul;
              const by = tipPt.y + Math.sin(aa) * rNow * mul;
              if (i === 0) ctx.moveTo(bx, by);
              else ctx.lineTo(bx, by);
            }
            ctx.stroke();
          }

          const glowCfg = ib.centerGlow
            ? ib.centerGlow
            : isStar
              ? {
                  shape: ib.shape as 'star' | 'spin_star',
                  scale: 2.1,
                  expand: 1.0,
                  spin: ib.spin ?? 0.18,
                  inner: true,
                }
              : undefined;
          if (glowCfg && glowCfg.shape !== 'none') {
            const glowHex = glowCfg.color?.trim() ? normalizeTintHex(glowCfg.color) : ibHex;
            const glowR = ib.radius * (1 + 2.2 * p * glowCfg.expand) * glowCfg.scale * 0.45;
            const glowRot = glowCfg.shape === 'spin_star' ? impactAge * glowCfg.spin : 0;
            if (glowCfg.shape === 'orb') {
              const gOrb = getTinted(beamOrbRef.current, glowHex);
              const wOrb = getTinted(beamOrbRef.current, '#ffffff');
              if (gOrb && wOrb) {
                ctx.globalAlpha = env * 0.9;
                ctx.drawImage(gOrb, tipPt.x - glowR, tipPt.y - glowR, glowR * 2, glowR * 2);
                if (glowCfg.inner) {
                  const inR = glowR * 0.5;
                  ctx.globalAlpha = env * 0.8;
                  ctx.drawImage(wOrb, tipPt.x - inR, tipPt.y - inR, inR * 2, inR * 2);
                }
              } else {
                const grad = ctx.createRadialGradient(tipPt.x, tipPt.y, 0, tipPt.x, tipPt.y, glowR);
                grad.addColorStop(0, glowCfg.inner ? '#ffffff' : glowHex);
                grad.addColorStop(0.45, glowHex);
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.globalAlpha = env * 0.9;
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(tipPt.x, tipPt.y, glowR, 0, Math.PI * 2);
                ctx.fill();
              }
            } else {
              ctx.globalAlpha = env * 0.9;
              ctx.strokeStyle = glowHex;
              ctx.lineWidth = Math.max(1.5, glowR * 0.14);
              ctx.beginPath();
              for (let k = 0; k < 4; k += 1) {
                const aa = glowRot + (k * Math.PI) / 4;
                ctx.moveTo(tipPt.x - Math.cos(aa) * glowR, tipPt.y - Math.sin(aa) * glowR);
                ctx.lineTo(tipPt.x + Math.cos(aa) * glowR, tipPt.y + Math.sin(aa) * glowR);
              }
              ctx.stroke();
              if (glowCfg.inner) {
                ctx.globalAlpha = env * 0.8;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = Math.max(1, glowR * 0.08);
                ctx.beginPath();
                const inRot = -glowRot * 1.3;
                const inR = glowR * 0.5;
                for (let k = 0; k < 4; k += 1) {
                  const aa = inRot + (k * Math.PI) / 4;
                  ctx.moveTo(tipPt.x - Math.cos(aa) * inR, tipPt.y - Math.sin(aa) * inR);
                  ctx.lineTo(tipPt.x + Math.cos(aa) * inR, tipPt.y + Math.sin(aa) * inR);
                }
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }
      }

      // Flame tongue preview (`wa.fire.spawn` at impact tip and/or trajectory)
      if (beam.fire?.enabled && headNow > 4) {
        const fireAlpha = Math.max(0.25, alpha);
        const drawFlameTongue = (fx: number, fy: number, idx: number, sc = 1) => {
          const wob = (hash01(tick * 13 + idx * 37 + inst.key) - 0.5) * 4;
          const h = (8 + (tick * 3 + idx * 5) % 6) * sc;
          const w = 3.2 * sc;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(1, fireAlpha * 0.85);
          ctx.fillStyle = '#ff9e2c';
          ctx.beginPath();
          ctx.moveTo(fx - w, fy);
          ctx.quadraticCurveTo(fx + wob * 0.5, fy - h, fx + w, fy);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#fff3a1';
          ctx.beginPath();
          ctx.arc(fx, fy - h * 0.25, w * 0.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };
        if ((beam.fire.mode === 'impact' || beam.fire.mode === 'both') && headNow >= inst.effectiveMaxDist - 4) {
          const cnt = Math.min(5, Math.max(2, Math.round(beam.fire.count * 0.6)));
          for (let f = 0; f < cnt; f += 1) {
            const oxF = (f - (cnt - 1) / 2) * 5;
            drawFlameTongue(tipPt.x + oxF, tipPt.y + (hash01(f * 19 + tick) - 0.5) * 4, f + 1, 1.05);
          }
        }
        if (beam.fire.mode === 'trajectory' || beam.fire.mode === 'both') {
          const stepPx = Math.max(16, beam.fire.step);
          let acc = stepPx * 0.6;
          let idx = 100;
          for (let i = 1; i < pts.length; i += 1) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            acc += Math.hypot(p1.x - p0.x, p1.y - p0.y);
            if (acc >= stepPx) {
              acc -= stepPx;
              drawFlameTongue(p1.x, p1.y, idx, 0.85);
              idx += 1;
            }
          }
        }
      }

      // Impact spray: the tip is fully extended, whatever stopped it (terrain, a
      // body, or simply the end of the beam's range). `wfws_firing` draws the
      // same eight ticks, thrown back along the beam's own heading.
      if (beam.impactSparks && headNow >= inst.effectiveMaxDist - 4) {
        const backAng = Math.atan2(-dy, -dx);
        for (let s = 1; s <= 8; s += 1) {
          const ang = backAng + (hash01((tick + inst.key) * 7 + s * 43) - 0.5) * 2.1;
          const dist = 6 + (((tick + inst.key) * 3 + s * 7) % 24);
          const sx = tipPt.x + Math.cos(ang) * dist;
          const sy = tipPt.y + Math.sin(ang) * dist;
          ctx.strokeStyle = s % 2 === 1 ? '#ffffff' : instColorHex;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - Math.cos(ang) * 5, sy - Math.sin(ang) * 5);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 7. Minimal HUD Phase Badge inside top-left of canvas
    let hudLabel = 'AIM';
    let hudColor = '#94a3b8';
    if (simState.isReady) {
      hudLabel = 'AIM';
      hudColor = '#94a3b8';
    } else if (simState.isBuffering) {
      hudLabel = `BUFFER ${simState.bf + 1}/${schedule.firstWaitFrames}f`;
      hudColor = '#fbbf24';
    } else if (simState.isDone) {
      hudLabel = 'COOLDOWN';
      hudColor = '#64748b';
    } else if (schedule.isSequenced) {
      hudLabel = `SHOT ${Math.max(1, simState.shotsDispatched)}/${schedule.shotCount}${
        simState.activeBeams.length > 1 ? ` · ${simState.activeBeams.length} LIVE` : ''
      }`;
      hudColor = '#fb7185';
    } else if (simState.activeBeams.length > 0) {
      const b0 = simState.activeBeams[0];
      if (b0.phase === 'grow') {
        hudLabel = `ADVANCE ${b0.localFrame + 1}/${beam.growFrames}f`;
        hudColor = '#38bdf8';
      } else if (b0.phase === 'hold') {
        hudLabel = `ACTIVE ${b0.localFrame + 1}/${beam.holdFrames}f`;
        hudColor = '#fb7185';
      } else {
        hudLabel = `${beam.fadeMode.toUpperCase()} ${b0.localFrame + 1}/${beam.fadeFrames}f`;
        hudColor = '#c084fc';
      }
    }

    ctx.save();
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    const badgeW = Math.max(118, Math.ceil(ctx.measureText(hudLabel).width) + 34);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(10, 10, badgeW, 22);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.strokeRect(10.5, 10.5, badgeW - 1, 21);
    ctx.fillStyle = hudColor;
    ctx.beginPath();
    ctx.arc(21, 21, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(hudLabel, 30, 24.5);

    // Pose + Hurt mode corner readout
    ctx.textAlign = 'right';
    ctx.fillStyle = '#cbd5e1';
    const modeTag =
      beam.hurtMode === 'cone'
        ? `CONE ${beam.muzzleWidth}px + ${beam.coneAngleDeg}°`
        : beam.hurtMode === 'corridor'
          ? `CORRIDOR ±${beam.width}px`
          : beam.hurtMode === 'first'
            ? `FIRST-HIT r${beam.width}px`
            : 'VISUAL ONLY';
    ctx.fillText(modeTag, CANVAS_W - 12, 24);
    ctx.restore();
  }, [
    beam,
    project.hold,
    project.aimClip,
    project.wormSprites,
    project.explosionEffect,
    schedule,
    simState,
    tick,
    ambientTick,
    aimDeg,
    showHurtZone,
    showWall,
    assetEpoch,
  ]);

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-stone-50/80 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-forge-500" aria-hidden="true" />
          <span className="font-heading text-xs font-semibold text-stone-900 dark:text-stone-100">
            50 Hz Beam Preview
          </span>
          <span className="font-mono text-[10px] text-stone-400 tabular-nums">
            {schedule.totalSequenceFrames * 20}ms
            {schedule.isSequenced ? ` · ${schedule.shotCount}×` : ''}
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative bg-[#0f1420]">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block w-full h-auto aspect-[460/264]"
        />
      </div>

      {/* Compact Transport & Stage Toggles */}
      <div className="space-y-2.5 border-t border-stone-200/80 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700 cursor-pointer"
            >
              {playing ? (
                <>
                  <Pause className="h-3 w-3" aria-hidden="true" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" aria-hidden="true" />
                  <span>Play</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setTick((t) => (t + 1) % cycleFrames);
                setAmbientTick((a) => a + 1);
              }}
              title="Step forward 1 game frame (20 ms)"
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700 cursor-pointer"
            >
              <SkipForward className="h-3 w-3" aria-hidden="true" />
              <span>+1f</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTick(READY_FRAMES);
                setPlaying(true);
              }}
              title="Replay shot from trigger frame"
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Fire</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowHurtZone((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                showHurtZone
                  ? 'border-forge-400/70 bg-forge-50 text-forge-800 dark:border-forge-600/60 dark:bg-forge-950/40 dark:text-forge-200'
                  : 'border-stone-200 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
              }`}
            >
              <Target className="h-3 w-3" aria-hidden="true" />
              <span>Hurt Zone</span>
            </button>
            <button
              type="button"
              onClick={() => setShowWall((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                showWall
                  ? 'border-stone-400 bg-stone-200/80 text-stone-900 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-100'
                  : 'border-stone-200 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
              }`}
            >
              <Shield className="h-3 w-3" aria-hidden="true" />
              <span>Wall</span>
            </button>
          </div>
        </div>

        {/* Aim Angle Slider */}
        <div className="flex items-center gap-2.5">
          <label
            htmlFor="beam-preview-aim"
            className="text-[11px] font-semibold text-stone-600 dark:text-stone-400 whitespace-nowrap"
          >
            Aim Angle
          </label>
          <input
            id="beam-preview-aim"
            type="range"
            min={-40}
            max={40}
            step={1}
            value={aimDeg}
            onChange={(e) => setAimDeg(Number(e.target.value))}
            className="h-1.5 flex-1 accent-forge-600 cursor-pointer"
          />
          <span className="w-10 text-right font-mono text-[11px] font-semibold text-stone-700 tabular-nums dark:text-stone-300">
            {aimDeg > 0 ? `+${aimDeg}°` : `${aimDeg}°`}
          </span>
        </div>

        {/* Hold / Buffer / Firing Pose Status */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200/80 bg-white/80 px-2.5 py-1.5 text-[11px] text-stone-600 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-400">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
            {project.hold?.enabled ? (
              <>
                <span>
                  Aim:{' '}
                  <strong className="font-semibold text-stone-800 dark:text-stone-200">
                    {project.hold.sheetFile ? `${project.hold.frames ?? 1}f` : 'Default'}
                  </strong>
                </span>
                {project.hold.bufferFile && (
                  <span className="text-amber-700 dark:text-amber-400">
                    · Buffer ({project.hold.bufferFrames ?? 1}f)
                  </span>
                )}
                {project.hold.flashFile && (
                  <span className="text-forge-600 dark:text-forge-400">
                    · Firing ({project.hold.fireFrames ?? 1}f)
                  </span>
                )}
              </>
            ) : (
              <span>No custom hold art yet, using the worm aim pose.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
