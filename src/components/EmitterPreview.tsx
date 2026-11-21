import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { EmitterConfig } from '../types/weapon';
import { EMITTER_PRESETS } from '../data/emitter';
import { assetUrl } from '../utils/assetUrl';
import { hexOf, parseHexColour, tintedSheet } from '../utils/sheetTint';
import { emitterReachWidths, emitterTrailWidths } from '../utils/previewSettings';

/**
 * 50 Hz preview of `fx.emitter` (`wf-lib/effects/px_effects`), PX's
 * `CEffectManager` as a live actor.
 *
 * The numbers come from the SDK, not from this file: a bolt grows by
 * `progress += speed` with `t = (i-1)/segments * progress`, its width and
 * brightness by PX's `dome * t * (1 - t) + 0.15`; the ring is three ribbon
 * passes (0.85 radius in a dimmed colour, the core, then the halo), spins by
 * `speed` a frame, re-jitters its noise every other frame and bends by the
 * `ellipse` multipliers; the spark is a ten-frame 60 px quad and the glow is
 * three additive passes of the 128 px blob. The ribbon is `trail.lua`'s own
 * sampling: one point every `every` frames while the anchor moves, up to
 * `max`, with `f = i / (n + 1)` driving both width and brightness.
 *
 * The scene is the situation the card describes. A muzzle emitter sits on the
 * fire angle of a worm that sweeps its aim (`worm.aim` is WA's 0..1 sweep, so
 * `aim * PI` is the angle), and with `carry` on it hands itself to the round
 * the trigger fires: a ballistic arc that lands, which is where the emitter
 * ends too. A round emitter skips the aiming phase and starts at the muzzle.
 *
 * Everything is in game pixels, so the ring and the bolts are the size they
 * will be in game. `Fit` is the default because a 30 px ring is a dot on a
 * desktop canvas; `1x` is one canvas pixel per game pixel.
 */
const TICK_MS = 20; // WA's game frame

const SHEETS = {
  beam: assetUrl('assets/effects/beam.png'),
  glow: assetUrl('assets/effects/beam_glow.png'),
  blob: assetUrl('assets/effects/glow.png'),
};

/**
 * WA's own worm posture strip: 32 frames of 60x60, frame 0 aiming down and
 * frame 31 straight up, the same art the hold preview draws (mirrored, because
 * this scene's worm faces right).
 */
const WORM_AIM_SRC = assetUrl('assets/worm/aim.png');

/** The spark is ten 60x60 sheets in the SDK (`cell = 60, frames = 10`). */
const SPARK_URLS: string[] = Object.entries(
  import.meta.glob('../../spec/lua_sdk/effects_sdk/sprites/px_effects/spark/frame*.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>,
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

const AIM_FRAMES = 45; // the aim sweep before the trigger
const AIM_START = 0.52; // just above level (WA's sweep: 0.5 is level)
const AIM_SWEEP = 0.3; // up to about 58 degrees
const LAUNCH_SPEED = 4.2; // px per frame, a grenade's order of magnitude
const GRAVITY = 0.16; // px per frame squared
/** The worm's centre is the origin; its feet, and the ground, are 12 px below. */
const GROUND_Y = 12;
const VIEW = { x0: -80, x1: 176, y0: -96, y1: 26 };

function rand01(seed: number, index: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x / 0x100000000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** PX's `HueToRGBLocal`, centred at 180 so a hue never passes through black. */
function rainbowRgb(hue: number): { r: number; g: number; b: number } {
  const rad = (((hue % 1) + 1) % 1) * Math.PI * 2;
  return {
    r: 180 + 75 * Math.sin(rad),
    g: 180 + 75 * Math.sin(rad + 2.0943951),
    b: 180 + 75 * Math.sin(rad + 4.1887902),
  };
}

/** `trail.lua`'s fixed 257-entry table: same wobble on every frame, no random. */
function trailNoise(index: number): number {
  const h = ((index % 257) * 1103515245 + 12345) % 2147483648;
  return h / 1073741824 - 1;
}

interface Bolt {
  ray: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  curve: EmitterConfig['reachCurve'];
  bulge: number;
  speed: number;
  progress: number;
  noise: number;
  noiseValues: number[];
  segments: number;
  coreW: number;
  glowW: number;
  holdLeft: number;
  fadeLeft: number;
  fade: number;
  alpha: number;
  done: boolean;
  // `setup_arc`: the circle a curved bolt is a segment of.
  degenerate: boolean;
  mx: number;
  my: number;
  ctrlX: number;
  ctrlY: number;
  cx: number;
  cy: number;
  rad: number;
  a0: number;
  da: number;
}

interface Sim {
  t: number;
  clock: number;
  aim: number;
  launchFireDeg: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flying: boolean;
  dead: boolean;
  shed: number;
  sparkPhase: number;
  bolts: Bolt[];
  cooldowns: number[];
  trail: { x: number; y: number }[];
  ringNoise: number[];
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** `setup_arc`: a circular segment through the chord with `bulge` as sagitta. */
function setupBolt(bolt: Bolt): void {
  const dx = bolt.toX - bolt.fromX;
  const dy = bolt.toY - bolt.fromY;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.0001) {
    bolt.degenerate = true;
    return;
  }
  const px = -dy / dist;
  const py = dx / dist;
  bolt.mx = (bolt.fromX + bolt.toX) / 2;
  bolt.my = (bolt.fromY + bolt.toY) / 2;
  if (bolt.curve === 'line') return;
  if (bolt.curve === 'bezier') {
    bolt.ctrlX = bolt.mx + px * bolt.bulge;
    bolt.ctrlY = bolt.my + py * bolt.bulge;
    return;
  }
  const chord = dist * 0.5;
  let s = bolt.bulge;
  let ux = px;
  let uy = py;
  if (bolt.curve === 'arc' && s < 0) {
    s = -s;
    ux = -px;
    uy = -py;
  }
  if (Math.abs(s) < 0.001) s = s < 0 ? -0.001 : 0.001;
  const rad = (chord * chord + s * s) / (2 * s);
  bolt.cx = bolt.mx - ux * (rad - s);
  bolt.cy = bolt.my - uy * (rad - s);
  bolt.rad = rad;
  bolt.a0 = Math.atan2(bolt.fromY - bolt.cy, bolt.fromX - bolt.cx);
  const a1 = Math.atan2(bolt.toY - bolt.cy, bolt.toX - bolt.cx);
  bolt.da = wrapAngle(a1 - bolt.a0);
}

function boltPoint(bolt: Bolt, t: number): { x: number; y: number } {
  if (bolt.degenerate) return { x: bolt.fromX, y: bolt.fromY };
  if (bolt.curve === 'line') {
    return {
      x: bolt.fromX + (bolt.toX - bolt.fromX) * t,
      y: bolt.fromY + (bolt.toY - bolt.fromY) * t,
    };
  }
  if (bolt.curve === 'bezier') {
    const u = 1 - t;
    return {
      x: u * u * bolt.fromX + 2 * u * t * bolt.ctrlX + t * t * bolt.toX,
      y: u * u * bolt.fromY + 2 * u * t * bolt.ctrlY + t * t * bolt.toY,
    };
  }
  const a = bolt.a0 + bolt.da * t;
  return { x: bolt.cx + bolt.rad * Math.cos(a), y: bolt.cy + bolt.rad * Math.sin(a) };
}

/** WA's fire vector for an aim in 0..1 (0 down, 0.5 level, 1 up), facing right. */
function fireVector(aim: number, radialAngleDeg = 0): { dx: number; dy: number; sinA: number; cosA: number } {
  const a = aim * Math.PI + (radialAngleDeg * Math.PI) / 180;
  const sinA = Math.sin(a);
  const cosA = Math.cos(a);
  return { dx: sinA, dy: cosA, sinA, cosA };
}

/** The generator's own radial muzzle + pure positional placement, so the preview and the Lua agree. */
function muzzleOf(cfg: EmitterConfig, aim: number): { x: number; y: number } {
  const fire = fireVector(aim, cfg.radialAngle ?? 0);
  return {
    x: fire.dx * cfg.offsetX + fire.cosA * cfg.offsetY + (cfg.posX ?? 0),
    y: fire.dy * cfg.offsetX - fire.sinA * cfg.offsetY + (cfg.posY ?? 0),
  };
}

function cosmetics(cfg: EmitterConfig) {
  const base = (EMITTER_PRESETS[cfg.preset] ?? EMITTER_PRESETS.electric).fx;
  const preset = {
    ...base,
    bolts: { ...base.bolts, direction: cfg.reachDirection ?? base.bolts.direction, spread: cfg.reachSpread ?? base.bolts.spread },
  };
  return {
    preset,
    count: cfg.reach ? Math.max(0, Math.min(8, Math.round(cfg.reachCount))) : 0,
    distance: Math.max(0, cfg.reachDistance),
    speed: Math.max(0.001, Math.min(1, cfg.reachSpeed / 100)),
    bulge: cfg.reachBulge,
    noise: Math.max(0, cfg.reachNoise),
    segments: Math.max(1, Math.min(255, Math.round(cfg.reachSegments))),
    ...emitterReachWidths(cfg),
  };
}

function ringWidths(cfg: EmitterConfig): { coreW: number; glowW: number } {
  // `fx.ring`: PX's `sizeValue = radius / 100`, core `radius / 10` clamped to
  // 2.3..5.5 and floored at 3.2, then doubled into a full ribbon width; the
  // halo is three times the *unclamped* core, so a wide ring still blooms.
  let pxCore = cfg.ring.radius / 10;
  if (pxCore < 2.3) pxCore = 2.3;
  const pxGlow = pxCore * 3;
  if (pxCore > 5.5) pxCore = 5.5;
  const core = Math.max(3.2, pxCore);
  return {
    coreW: cfg.ring.coreWidth > 0 ? cfg.ring.coreWidth : core * 2,
    glowW: cfg.ring.glowWidth > 0 ? cfg.ring.glowWidth : pxGlow * 2,
  };
}

function createSim(cfg: EmitterConfig, flies: boolean, seed: number, noAim: boolean): Sim {
  const cos = cosmetics(cfg);
  const initialFire = fireVector(AIM_START);
  const sim: Sim = {
    t: 0,
    clock: 0,
    aim: AIM_START,
    launchFireDeg: (Math.atan2(initialFire.dy, initialFire.dx) * 180) / Math.PI,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    flying: false,
    dead: false,
    shed: 0,
    sparkPhase: 0,
    bolts: [],
    cooldowns: [],
    trail: [],
    ringNoise: [],
  };
  for (let i = 1; i <= Math.max(1, cos.count); i += 1) {
    const [lo, hi] = cos.preset.bolts.first;
    sim.cooldowns[i] =
      Math.round(lo + (hi - lo) * rand01(seed, i)) + (i - 1) * cos.preset.bolts.stagger;
  }
  const ringSegments = Math.max(8, Math.round(cfg.ring.segments));
  for (let i = 0; i <= ringSegments; i += 1) sim.ringNoise[i] = rand01(seed, i + 500) * 2 - 1;
  // A projectile-exclusive / round emitter never aims: it starts on the round the trigger fired.
  if (flies && noAim) {
    sim.aim = AIM_START + AIM_SWEEP;
    const fire = fireVector(sim.aim);
    sim.launchFireDeg = (Math.atan2(fire.dy, fire.dx) * 180) / Math.PI;
    sim.x = cfg.posX ?? 0;
    sim.y = cfg.posY ?? 0;
    sim.vx = fire.dx * LAUNCH_SPEED;
    sim.vy = fire.dy * LAUNCH_SPEED;
    sim.flying = true;
  } else {
    const muzzle = muzzleOf(cfg, sim.aim);
    sim.x = muzzle.x;
    sim.y = muzzle.y;
  }
  return sim;
}

function cooldownFor(cos: ReturnType<typeof cosmetics>, seed: number, ray: number): number {
  const [lo, hi] = cos.preset.bolts.cooldown;
  return Math.round(lo + (hi - lo) * rand01(seed, ray));
}

/** One 50 Hz step of the emitter and everything it owns. */
function stepSim(sim: Sim, cfg: EmitterConfig, seed: number, flies: boolean, noAim: boolean): void {
  sim.t += 1;
  sim.clock += 1;
  const cos = cosmetics(cfg);
  const aiming = !noAim && !sim.flying && !sim.dead;

  if (aiming) {
    sim.aim = AIM_START + AIM_SWEEP * Math.min(1, sim.t / AIM_FRAMES);
    const muzzle = muzzleOf(cfg, sim.aim);
    sim.x = muzzle.x;
    sim.y = muzzle.y;
    if (flies && sim.t >= AIM_FRAMES) {
      const fire = fireVector(sim.aim);
      sim.launchFireDeg = (Math.atan2(fire.dy, fire.dx) * 180) / Math.PI;
      sim.x = cfg.posX ?? 0;
      sim.y = cfg.posY ?? 0;
      sim.flying = true;
      sim.vx = fire.dx * LAUNCH_SPEED;
      sim.vy = fire.dy * LAUNCH_SPEED;
    }
  } else if (sim.flying) {
    sim.vy += GRAVITY;
    sim.x += sim.vx;
    sim.y += sim.vy;
    if (sim.y >= GROUND_Y) {
      // The round is on the ground: the emitter ends with it.
      sim.y = GROUND_Y;
      sim.flying = false;
      sim.dead = true;
    }
  } else if (sim.dead) {
    sim.shed += 1;
  }

  const spark = cos.preset.spark;
  sim.sparkPhase += spark.rate;
  if (sim.sparkPhase > 1 + spark.pause) sim.sparkPhase = 0;

  // Bolts: grown, then held and faded, then a fresh one once its cooldown runs out.
  for (let i = sim.bolts.length - 1; i >= 0; i -= 1) {
    const bolt = sim.bolts[i];
    if (!bolt.done) {
      bolt.progress = Math.min(1, bolt.progress + bolt.speed);
      if (bolt.progress >= 1) bolt.done = true;
      // `fill_arc_noise` every other frame.
      if ((sim.t + bolt.ray) % 2 === 0) {
        bolt.noiseValues = bolt.noiseValues.map(
          (_, k) => rand01(seed + sim.t, k + bolt.ray * 31) * 2 - 1,
        );
      }
    } else if (bolt.holdLeft > 0) {
      bolt.holdLeft -= 1;
    } else if (bolt.fade > 0 && bolt.fadeLeft > 1) {
      bolt.fadeLeft -= 1;
      bolt.alpha = bolt.fadeLeft / bolt.fade;
    } else {
      sim.bolts.splice(i, 1);
      if (bolt.ray > 0) sim.cooldowns[bolt.ray] = cooldownFor(cos, seed + sim.t, bolt.ray);
    }
  }
  if (!sim.dead) {
    for (let i = 1; i <= cos.count; i += 1) {
      if (sim.bolts.some((b) => b.ray === i)) continue;
      sim.cooldowns[i] = (sim.cooldowns[i] ?? 0) - 1;
      if (sim.cooldowns[i] > 0) continue;
      const from = { x: sim.x, y: sim.y };
      let to: { x: number; y: number };
      const { direction, spread, down } = cos.preset.bolts;
      if (down && direction === 90 && spread === 0) {
        // The thunder preset's native `from = "below"` case stays vertical.
        const [lo, hi] = down;
        const depth = Math.round(lo + (hi - lo) * rand01(seed + sim.t, i * 7));
        const side = Math.round(
          (rand01(seed + sim.t, i * 13) * 2 - 1) * (cos.preset.bolts.downSide ?? 0),
        );
        to = { x: from.x + side, y: from.y + depth };
      } else {
        const angle = ((direction + (rand01(seed + sim.t, i * 17) - 0.5) * spread) * Math.PI) / 180;
        const distance = down
          ? down[0] + (down[1] - down[0]) * rand01(seed + sim.t, i * 7)
          : Math.sqrt(rand01(seed + sim.t, i * 17 + 1)) * cos.distance;
        to = { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance };
      }
      const bolt: Bolt = {
        ray: i,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        curve: cfg.reachCurve,
        bulge: cos.bulge,
        speed: cos.speed,
        progress: 0,
        noise: cos.noise,
        noiseValues: Array.from({ length: cos.segments + 1 }, (_, k) => rand01(seed + sim.t, k + i) * 2 - 1),
        segments: cos.segments,
        coreW: cos.coreW,
        glowW: cos.glowW,
        // A finished bolt only stays lit when the preset says so (thunder).
        holdLeft: cos.preset.bolts.hold ?? 0,
        fadeLeft: cos.preset.bolts.fade ?? 0,
        fade: cos.preset.bolts.fade ?? 0,
        alpha: 1,
        done: false,
        degenerate: false,
        mx: 0,
        my: 0,
        ctrlX: 0,
        ctrlY: 0,
        cx: 0,
        cy: 0,
        rad: 0,
        a0: 0,
        da: 0,
      };
      setupBolt(bolt);
      sim.bolts.push(bolt);
    }
  }

  // The emitter's own ribbon: `trail.sample` while it moves, one point per
  // `vanish` frames once the anchor is gone.
  if (cfg.trail.enabled) {
    const every = Math.max(1, Math.round(cfg.trail.every));
    const max = Math.max(2, Math.round(cfg.trail.max));
    const vanish = 2;
    if (!sim.dead) {
      const moving = Math.abs(sim.vx) >= 0.15 || Math.abs(sim.vy) >= 0.15;
      if (moving && sim.t % every === 0) {
        const last = sim.trail[sim.trail.length - 1];
        const same = last && (last.x - sim.x) ** 2 + (last.y - sim.y) ** 2 <= 0.01;
        if (!same) sim.trail.push({ x: sim.x, y: sim.y });
        while (sim.trail.length > max) sim.trail.shift();
      }
    } else if (sim.shed > 0 && sim.shed % vanish === 0 && sim.trail.length > 0) {
      sim.trail.shift();
    }
  }
}

/**
 * How many ticks the whole scene lasts: the aim sweep, the arc (found by
 * stepping the same physics the sim does), the shed, and a breath.
 */
function loopLength(cfg: EmitterConfig, flies: boolean, noAim: boolean): number {
  if (!flies) return AIM_FRAMES + 120;
  const aim = AIM_START + AIM_SWEEP;
  const fire = fireVector(aim);
  let x = cfg.posX ?? 0;
  let y = cfg.posY ?? 0;
  let vy = fire.dy * LAUNCH_SPEED;
  const vx = fire.dx * LAUNCH_SPEED;
  let flight = 0;
  while (y < GROUND_Y && flight < 400) {
    vy += GRAVITY;
    x += vx;
    y += vy;
    flight += 1;
  }
  return (noAim ? 0 : AIM_FRAMES) + flight + Math.max(2, Math.round(cfg.trail.max)) * 2 + 18;
}

interface RibbonPoint {
  x: number;
  y: number;
  width: number;
  alpha: number;
  colour: string;
}

interface EmitterPreviewProps {
  config: EmitterConfig;
  /** The family has a missile WA builds from the record (`supportsEmitterRound`). */
  roundOk: boolean;
}

export function EmitterPreview({ config, roundOk }: EmitterPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tintCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const simRef = useRef<Sim | null>(null);
  const [playing, setPlaying] = useState(true);
  const [zoom, setZoom] = useState<'fit' | '1x'>('fit');
  const [showWormRef, setShowWormRef] = useState(true);
  const [replay, setReplay] = useState(0);
  const [frame, setFrame] = useState(0);
  const [sheets, setSheets] = useState<Record<string, HTMLImageElement>>({});
  const [sparks, setSparks] = useState<HTMLImageElement[]>([]);
  const [wormAimImg, setWormAimImg] = useState<HTMLImageElement | null>(null);

  const configKey = JSON.stringify(config);
  const seed = 1337 + replay * 7919;
  const isPlaneAnchor = config.anchor === 'plane';
  const noAim = isPlaneAnchor || (roundOk && (config.anchor === 'round' || !!config.projectileExclusive));
  // A muzzle emitter only hands itself to a round the record can fire.
  const flies = isPlaneAnchor || (roundOk && (noAim || config.carry !== false));
  const total = loopLength(config, flies, noAim);

  // The SDK's own art, loaded once.
  useEffect(() => {
    let cancelled = false;
    const loaded: Record<string, HTMLImageElement> = {};
    let pending = Object.keys(SHEETS).length;
    const done = () => {
      pending -= 1;
      if (pending === 0 && !cancelled) setSheets({ ...loaded });
    };
    for (const [key, url] of Object.entries(SHEETS)) {
      const image = new Image();
      image.onload = () => {
        loaded[key] = image;
        done();
      };
      image.onerror = done;
      image.src = url;
    }
    const wormImage = new Image();
    wormImage.onload = () => {
      if (!cancelled) setWormAimImg(wormImage);
    };
    wormImage.src = WORM_AIM_SRC;
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loaded: HTMLImageElement[] = new Array(SPARK_URLS.length);
    let pending = Math.max(1, SPARK_URLS.length);
    const done = () => {
      pending -= 1;
      if (pending === 0 && !cancelled) setSparks(loaded.filter(Boolean));
    };
    SPARK_URLS.forEach((url, index) => {
      const image = new Image();
      image.onload = () => {
        loaded[index] = image;
        done();
      };
      image.onerror = done;
      image.src = url;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A settings change (or a replay) starts a fresh scene.
  useEffect(() => {
    simRef.current = createSim(config, flies, seed, noAim);
    tintCache.current.clear();
    setFrame(0);
    // `configKey` and `seed` cover every field and the replay counter.
  }, [configKey, seed, flies, noAim]);

  const currentSim = (): Sim => {
    if (!simRef.current) simRef.current = createSim(config, flies, seed, noAim);
    return simRef.current;
  };

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const sim = currentSim();
      const next = sim.t + 1;
      if (next > total) {
        simRef.current = createSim(config, flies, seed, noAim);
        setFrame(0);
      } else {
        stepSim(sim, config, seed, flies, noAim);
        setFrame(next);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
    // `currentSim` is stable over these dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total, configKey, seed, flies, noAim]);

  const tint = useMemo(() => {
    const cache = tintCache.current;
    return (key: string, image: HTMLImageElement | undefined, colour: string) => {
      if (!image) return undefined;
      const id = `${key}:${colour}`;
      const hit = cache.get(id);
      if (hit) return hit;
      const canvas = tintedSheet(image, colour);
      if (cache.size > 320) cache.clear();
      cache.set(id, canvas);
      return canvas;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state = currentSim();
    const cfg = config;

    const width = canvas.clientWidth || 520;
    const height = canvas.clientHeight || 260;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, width * 0.65);
    bg.addColorStop(0, '#1b2230');
    bg.addColorStop(1, '#0a0d12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
    ctx.lineWidth = 1;
    for (let x = 24; x < width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 24; y < height; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }

    const viewW = VIEW.x1 - VIEW.x0;
    const viewH = VIEW.y1 - VIEW.y0;
    const fit = Math.min(width / viewW, height / viewH);
    const scale = zoom === '1x' ? 1 : fit;
    const originX = width / 2 - (VIEW.x0 + viewW / 2) * scale;
    const originY = height / 2 - (VIEW.y0 + viewH / 2) * scale;
    const sx = (gx: number) => originX + gx * scale;
    const sy = (gy: number) => originY + gy * scale;

    // The ground the round lands on.
    const groundY = sy(GROUND_Y);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.fillRect(0, groundY, width, Math.max(0, height - groundY));
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, groundY + 0.5);
    ctx.lineTo(width, groundY + 0.5);
    ctx.stroke();

    const clock = state.clock;
    const rainbow = cfg.rainbow;
    const clockColour = (): string => {
      if (!rainbow) return cfg.color;
      const { r, g, b } = rainbowRgb(clock * 0.012);
      return hexOf(r, g, b);
    };
    /** A part's own colour, or the hue clock when either switch asks for it. */
    const partColour = (part: { rainbow: boolean; color?: string }): {
      r: number;
      g: number;
      b: number;
    } => (rainbow || part.rainbow ? rainbowRgb(clock * 0.012) : parseHexColour(part.color ?? cfg.color));

    /** One ribbon pass: a textured quad per segment, additive, per-segment alpha. */
    const ribbon = (points: RibbonPoint[], sheetKey: 'beam' | 'glow', closed: boolean): void => {
      const image = sheets[sheetKey];
      if (!image || points.length < 2) return;
      ctx.globalCompositeOperation = 'lighter';
      const count = closed ? points.length : points.length - 1;
      for (let i = 0; i < count; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.05) continue;
        const quad = tint(`ribbon-${sheetKey}`, image, a.colour);
        if (!quad) continue;
        const lineWidth = Math.max(0.4, ((a.width + b.width) / 2) * scale);
        ctx.globalAlpha = clamp01((a.alpha + b.alpha) / 2);
        ctx.save();
        ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
        ctx.rotate(Math.atan2(dy, dx));
        // A hair of overlap keeps a curved pass from showing a seam.
        ctx.drawImage(quad, -(length + 0.6) / 2, -lineWidth / 2, length + 0.6, lineWidth);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const worm = wormAimImg;
    if (showWormRef && worm && worm.complete && worm.naturalWidth > 0) {
      // The posture strip is indexed by WA's own sweep: frame 0 is straight
      // down, frame 31 straight up, so the worm's arms follow the emitter.
      const frame = Math.min(31, Math.max(0, Math.round(state.aim * 31)));
      const cell = 60 * scale;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      ctx.translate(sx(0), sy(0));
      ctx.scale(-1, 1); // the strip faces left; this scene's worm faces right.
      ctx.drawImage(worm, 0, frame * 60, 60, 60, -cell / 2, -cell / 2, cell, cell);
      ctx.restore();
    }

    // The fire angle and radial arm the muzzle offset is measured along.
    if (!noAim && !state.flying && !state.dead) {
      const fire = fireVector(state.aim);
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx(0), sy(0));
      ctx.lineTo(sx(fire.dx * 95), sy(fire.dy * 95));
      ctx.stroke();
      if ((cfg.radialAngle ?? 0) !== 0 || cfg.offsetY !== 0 || (cfg.posX ?? 0) !== 0 || (cfg.posY ?? 0) !== 0) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.beginPath();
        ctx.moveTo(sx(0), sy(0));
        ctx.lineTo(sx(state.x), sy(state.y));
        ctx.stroke();
      }
      ctx.restore();
    }

    // The emitter's ribbon goes under everything else, as trail.lua draws it.
    if (cfg.trail.enabled && state.trail.length >= 2) {
      const n = state.trail.length;
      const noise = Math.max(0, cfg.trail.noise);
      const { coreW, glowW } = emitterTrailWidths(cfg.trail);
      const points = state.trail.map((point, index) => {
        let x = point.x;
        let y = point.y;
        if (noise > 0) {
          const before = state.trail[index - 1] ?? point;
          const after = state.trail[index + 1] ?? point;
          const dx = after.x - before.x;
          const dy = after.y - before.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.0001) {
            const j = trailNoise(index) * noise;
            x -= (dy / len) * j;
            y += (dx / len) * j;
          }
        }
        const f = Math.max(0.1, (index + 1) / (n + 1));
        const { r, g, b } = rainbowRgb(clock * 0.012 + f * 0.35);
        const colour = rainbow || cfg.trail.rainbow ? hexOf(r, g, b) : cfg.trail.color;
        return { x: sx(x), y: sy(y), width: f * coreW, alpha: f, colour };
      });
      if (coreW > 0) ribbon(points, 'beam', false);
      if (glowW > 0) {
        // `f * glow_w`, as trail.lua sizes it: scaling the core width instead
        // divided by a zero core.
        ribbon(
          points.map((p) => ({ ...p, width: p.alpha * glowW })),
          'glow',
          false,
        );
      }
    }

    if (!state.dead) {
      const colour = clockColour();

      // The soft halo: PX's three passes of the 128 px blob.
      if (cfg.glow) {
        const blob = sheets.blob;
        const quad = blob ? tint('blob', blob, colour) : undefined;
        const glow = cosmetics(cfg).preset.glow;
        if (quad) {
          const size = Math.max(6, glow.cell * glow.size * scale);
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < glow.passes; i += 1) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(quad, sx(state.x) - size / 2, sy(state.y) - size / 2, size, size);
          }
          ctx.globalAlpha = 1;
        }
      }

      // The spark: a 60 px cell, `phase` choosing the frame.
      if (cfg.spark && sparks.length > 0 && state.sparkPhase <= 1) {
        const preset = cosmetics(cfg).preset.spark;
        const index = Math.min(
          sparks.length - 1,
          Math.max(0, Math.floor(state.sparkPhase * Math.min(sparks.length, preset.frames))),
        );
        const image = sparks[index];
        const quad = image ? tint(`spark-${index}`, image, colour) : undefined;
        if (quad) {
          const size = preset.cell * preset.size * scale;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1;
          ctx.drawImage(quad, sx(state.x) - size / 2, sy(state.y) - size / 2, size, size);
        }
      }

      // The bolts, each a beam pass and a halo pass.
      for (const bolt of state.bolts) {
        const build = (width: number): RibbonPoint[] => {
          const points: RibbonPoint[] = [];
          const n = bolt.segments;
          const dome = width * 0.5;
          for (let i = 1; i <= n; i += 1) {
            const t = ((i - 1) / n) * bolt.progress;
            const p = boltPoint(bolt, t);
            const ahead = boltPoint(bolt, t + 0.02);
            const tx = ahead.x - p.x;
            const ty = ahead.y - p.y;
            const len = Math.hypot(tx, ty);
            const jx = len > 0 ? -ty / len : 0;
            const jy = len > 0 ? tx / len : 0;
            const j = (bolt.noiseValues[(i - 1) % Math.max(1, bolt.noiseValues.length)] ?? 0) * bolt.noise;
            // PX's dome: the bolt is pinched at both ends and brightest between.
            const f = clamp01(dome * t * (1 - t) + 0.15);
            points.push({
              x: sx(p.x + jx * j),
              y: sy(p.y + jy * j),
              width: f * width,
              alpha: f * bolt.alpha,
              colour,
            });
          }
          return points;
        };
        if (bolt.coreW > 0) ribbon(build(bolt.coreW), 'beam', false);
        if (bolt.glowW > 0) ribbon(build(bolt.glowW), 'glow', false);
      }
    }

    // The ring rides the emitter and draws last, as `fx` draws it after bursts.
    // It is its own effect in the SDK, so it dies one frame after its anchor.
    if (cfg.ring.enabled && cfg.ring.radius > 0 && !state.dead) {
      const ring = cfg.ring;
      const widths = ringWidths(cfg);
      const segments = Math.max(8, Math.min(255, Math.round(ring.segments)));
      const ex = Math.max(0.05, ring.ellipseX);
      const ey = Math.max(0.05, ring.ellipseY);
      const followFireAngle = cfg.followFireAngle !== false;
      const moving = state.vx !== 0 || state.vy !== 0;
      const ownerFire = fireVector(state.aim);
      const ownerFireDeg = state.flying
        ? state.launchFireDeg
        : (Math.atan2(ownerFire.dy, ownerFire.dx) * 180) / Math.PI;
      const degrees =
        ring.track && moving
          ? (Math.atan2(state.vy, state.vx) * 180) / Math.PI + ring.angle
          : followFireAngle
            ? ownerFireDeg + ring.angle + (ring.track ? 0 : ring.speed * state.t)
            : ring.angle + ring.speed * state.t;
      const angle = (degrees * Math.PI) / 180;
      const cosRot = Math.cos(angle);
      const sinRot = Math.sin(angle);
      const ringRgb = partColour(ring);
      const colour = hexOf(ringRgb.r, ringRgb.g, ringRgb.b);
      const build = (radiusScale: number, styleWidth: (w: number) => number, tintColour: string) => {
        const points: RibbonPoint[] = [];
        for (let i = 0; i <= segments; i += 1) {
          const j = (state.ringNoise[i % Math.max(1, state.ringNoise.length)] ?? 0) * ring.noise;
          const a = i * ((Math.PI * 2) / segments);
          const ux = Math.cos(a) * ex;
          const uy = Math.sin(a) * ey;
          const rx = ux * cosRot - uy * sinRot;
          const ry = ux * sinRot + uy * cosRot;
          const r = (Math.max(1, ring.radius) + j) * radiusScale;
          const t = i / segments;
          // `thin` tapers to a point at both ends and dims with the width.
          const f = ring.thin ? clamp01(4 * t * (1 - t) + 0.15) : 1;
          points.push({
            x: sx(state.x + rx * r),
            y: sy(state.y + ry * r),
            width: styleWidth(f),
            alpha: f,
            colour: tintColour,
          });
        }
        return points;
      };
      if (!ring.thin) {
        // PX's flare under the core: 0.85 of the radius in the dimmed colour.
        const flare = hexOf(ringRgb.r * 0.72, ringRgb.g * 0.72, ringRgb.b * 0.72);
        ribbon(build(0.85, (f) => f * widths.coreW, flare), 'beam', true);
      }
      ribbon(build(1, (f) => f * widths.coreW, colour), 'beam', true);
      if (widths.glowW > 0 && !ring.thin) {
        ribbon(build(1, (f) => f * widths.glowW, colour), 'glow', true);
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.6)';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    const label = state.dead
      ? 'round gone, ribbon shedding'
      : state.flying
        ? 'round in flight'
        : !noAim
          ? 'aiming'
          : 'waiting for the round';
    ctx.fillText(label, 10, height - 10);
    ctx.textAlign = 'right';
    const sizeLabel = cfg.ring.enabled
      ? `ring ${Math.round(cfg.ring.radius)} px`
      : cfg.reach
        ? `reach ${Math.round(cfg.reachDistance)} px`
        : 'no reach';
    ctx.fillText(`${sizeLabel} · ${zoom === '1x' ? '1x' : `${scale.toFixed(2)}x`}`, width - 10, height - 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, configKey, config, replay, sheets, sparks, wormAimImg, zoom, showWormRef, tint]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        aria-label="Live preview of the effect emitter on the muzzle and on the fired round"
        className="h-[260px] w-full rounded-xl border border-stone-300 bg-stone-950 dark:border-stone-700"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md border border-sky-300/80 bg-sky-50/80 px-2.5 py-1 text-[11px] font-semibold text-sky-800 transition-colors hover:bg-sky-100 dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {playing ? <Pause className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
            <span>{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setReplay((value) => value + 1);
              setPlaying(true);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300/80 bg-amber-50/80 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Replay</span>
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => (value === 'fit' ? '1x' : 'fit'))}
            aria-pressed={zoom === '1x'}
            title="Fit fills the canvas; 1x is one canvas pixel per game pixel, which is how big it really is."
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              zoom === '1x'
                ? 'border-forge-600 bg-forge-600 text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'
            }`}
          >
            {zoom === '1x' ? '1x' : 'Fit'}
          </button>
          <button
            type="button"
            onClick={() => setShowWormRef((value) => !value)}
            aria-pressed={showWormRef}
            title="Toggle the worm the muzzle is measured from, at the same pixel scale."
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showWormRef
                ? 'border-forge-600 bg-forge-600 text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'
            }`}
          >
            Worm
          </button>
        </div>
        <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">
          {flies ? 'aim, fire, flight' : 'aiming loop'} · {frame} / {total} ticks · 50 Hz
        </span>
      </div>
    </div>
  );
}

