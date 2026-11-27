import type {
  FlightRoleArt,
  FlightTrailConfig,
  FlightTrailDepth,
  FlightTrailRoleKey,
  WeaponProject,
} from '../types/weapon';
import { bitActionOf, bitBuilderMode, primaryBuilderOn } from './spriteBuilder';

/**
 * The one trail every role starts from. `enabled` stays false so a bundle
 * written before trails existed never grows a particle pool by accident.
 */
export const DEFAULT_FLIGHT_TRAIL: FlightTrailConfig = {
  enabled: false,
  hideNativeTrail: true,
  cellW: 16,
  cellH: 16,
  frames: 1,
  startFrame: 0,
  playMode: 'lifetime',
  fps: 15,
  power: 25,
  speed: 120,
  bubblesPerSecond: 0,
  lifeFrames: 24,
  lifeJitter: 0.2,
  scaleStart: 1.0,
  scaleEnd: 0.15,
  alphaStart: 0.9,
  alphaEnd: 0,
  rotateMode: 'random',
  spinMin: -4,
  spinMax: 4,
  gravity: -0.04,
  drag: 0.94,
  spreadDeg: 28,
  jitterPx: 2,
  inheritVel: 0.15,
  offsetX: 0,
  offsetY: 0,
  color: '#ffffff',
  colorEnd: '',
  rainbow: false,
  blend: 'alpha',
  depth: 'EFFECTS',
  maxParticles: 160,
};

/**
 * Fill every missing knob without turning a real 0 or false into a default.
 * Numeric values are clamped where the Lua side expects a range, so a hand
 * edited bundle cannot ask for a pool of 100000 particles.
 */
export function mergeFlightTrailConfig(
  raw?: Partial<FlightTrailConfig> | null,
): FlightTrailConfig {
  const d = DEFAULT_FLIGHT_TRAIL;
  const n = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? (value as number) : fallback;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const frames = Math.round(clamp(n(raw?.frames, d.frames), 1, 64));
  const startFrame = Math.round(clamp(n(raw?.startFrame, d.startFrame ?? 0), 0, Math.max(0, frames - 1)));
  return {
    ...d,
    ...raw,
    enabled: raw?.enabled ?? d.enabled,
    hideNativeTrail: raw?.hideNativeTrail ?? d.hideNativeTrail,
    cellW: Math.round(clamp(n(raw?.cellW, d.cellW), 1, 512)),
    cellH: Math.round(clamp(n(raw?.cellH, d.cellH), 1, 512)),
    frames,
    startFrame,
    playMode: raw?.playMode ?? d.playMode,
    fps: clamp(n(raw?.fps, d.fps), 1, 60),
    power: clamp(n(raw?.power, d.power), 0, 100),
    speed: clamp(n(raw?.speed, d.speed), 0, 500),
    bubblesPerSecond: clamp(n(raw?.bubblesPerSecond, d.bubblesPerSecond), 0, 16),
    lifeFrames: Math.round(clamp(n(raw?.lifeFrames, d.lifeFrames), 4, 180)),
    lifeJitter: clamp(n(raw?.lifeJitter, d.lifeJitter), 0, 0.8),
    scaleStart: clamp(n(raw?.scaleStart, d.scaleStart), 0.1, 6),
    scaleEnd: clamp(n(raw?.scaleEnd, d.scaleEnd), 0, 6),
    alphaStart: clamp(n(raw?.alphaStart, d.alphaStart), 0, 1),
    alphaEnd: clamp(n(raw?.alphaEnd, d.alphaEnd), 0, 1),
    rotateMode: raw?.rotateMode ?? d.rotateMode,
    spinMin: clamp(n(raw?.spinMin, d.spinMin), -30, 30),
    spinMax: clamp(n(raw?.spinMax, d.spinMax), -30, 30),
    gravity: clamp(n(raw?.gravity, d.gravity), -2, 2),
    drag: clamp(n(raw?.drag, d.drag), 0.75, 1),
    spreadDeg: clamp(n(raw?.spreadDeg, d.spreadDeg), 0, 360),
    jitterPx: clamp(n(raw?.jitterPx, d.jitterPx), 0, 24),
    inheritVel: clamp(n(raw?.inheritVel, d.inheritVel), -0.5, 1),
    offsetX: clamp(n(raw?.offsetX, d.offsetX), -128, 128),
    offsetY: clamp(n(raw?.offsetY, d.offsetY), -128, 128),
    color: raw?.color ?? d.color,
    colorEnd: raw?.colorEnd ?? d.colorEnd,
    rainbow: raw?.rainbow ?? d.rainbow,
    blend: raw?.blend ?? d.blend,
    depth: raw?.depth ?? d.depth,
    maxParticles: Math.round(clamp(n(raw?.maxParticles, d.maxParticles), 16, 512)),
  };
}

export interface FlightTrailPreset {
  id: string;
  name: string;
  hint: string;
  patch: Partial<FlightTrailConfig>;
}

/** Six starting points, chosen to cover puff, spark, jet and bubble art. */
export const FLIGHT_TRAIL_PRESETS: FlightTrailPreset[] = [
  {
    id: 'wa_smoke',
    name: 'WA Smoke Puff',
    hint: 'Expanding grey smoke, rises slowly',
    patch: {
      scaleStart: 0.7,
      scaleEnd: 1.6,
      gravity: -0.06,
      drag: 0.92,
      alphaStart: 0.85,
      alphaEnd: 0,
      blend: 'alpha',
      color: '#d6d3d1',
      colorEnd: '',
      spreadDeg: 28,
    },
  },
  {
    id: 'embers',
    name: 'Shrinking Embers',
    hint: 'Additive sparks that cool red',
    patch: {
      scaleStart: 0.9,
      scaleEnd: 0.05,
      gravity: 0.08,
      color: '#ffae33',
      colorEnd: '#ef4444',
      blend: 'add',
      spreadDeg: 45,
      rotateMode: 'random',
    },
  },
  {
    id: 'rocket',
    name: 'Rocket Exhaust',
    hint: 'Dense backward jet from the nozzle',
    patch: {
      power: 55,
      speed: 260,
      scaleStart: 0.6,
      scaleEnd: 1.4,
      color: '#ffe082',
      colorEnd: '#6b7280',
      lifeFrames: 18,
      spreadDeg: 14,
      inheritVel: 0.35,
    },
  },
  {
    id: 'plasma',
    name: 'Plasma Sparks',
    hint: 'Spinning additive sparks, blue to violet',
    patch: {
      blend: 'add',
      color: '#38bdf8',
      colorEnd: '#a855f7',
      spinMin: -12,
      spinMax: 12,
      scaleStart: 1.0,
      scaleEnd: 0.1,
      drag: 0.9,
    },
  },
  {
    id: 'magic_dust',
    name: 'Magic Dust',
    hint: 'Rainbow glitter drifting in every direction',
    patch: {
      rainbow: true,
      blend: 'add',
      gravity: -0.02,
      jitterPx: 6,
      spreadDeg: 180,
      lifeFrames: 34,
      scaleStart: 0.5,
      scaleEnd: 0.9,
    },
  },
  {
    id: 'bubbles',
    name: 'Bubble Stream',
    hint: 'Buoyant bubbles, good underwater',
    patch: {
      gravity: -0.08,
      drag: 0.9,
      scaleStart: 0.5,
      scaleEnd: 1.1,
      alphaStart: 0.75,
      alphaEnd: 0,
      bubblesPerSecond: 8,
      color: '#bae6fd',
      colorEnd: '',
    },
  },
];

/** #rrggbb (or #rgb) to 0..255 channels, white when the text is not a colour. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const text = (hex || '').trim().replace(/^#/, '');
  const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** 0..255 channels back to the #rrggbb text the colour input expects. */
export function rgbToHex(r: number, g: number, b: number): string {
  const byte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function flightTrailDepthValue(depth: FlightTrailDepth): 'BEHIND' | 'EFFECTS' | 'FRONT' {
  return depth === 'BEHIND' || depth === 'FRONT' ? depth : 'EFFECTS';
}

/** True when this role config owns a trail that should be emitted. */
export function roleTrail(art?: { trail?: FlightTrailConfig } | null): FlightTrailConfig | null {
  return art?.trail?.enabled ? mergeFlightTrailConfig(art.trail) : null;
}

/**
 * Every trail the generated bundle can attach on its own. A behaviour role
 * that inherits its parent art does not appear here: the SDK gives it the
 * parent's pool, so emitting a second config would double the smoke.
 */
export function activeFlightTrails(
  project: WeaponProject,
): { role: FlightTrailRoleKey; trail: FlightTrailConfig }[] {
  if (!primaryBuilderOn(project)) return [];
  const out: { role: FlightTrailRoleKey; trail: FlightTrailConfig }[] = [];
  const bitMode = bitBuilderMode(project);
  const clusters = project.burst === 'clusters';
  const bitAction = bitActionOf(project);
  const art = (key: 'homing' | 'homing_bit' | 'roam' | 'dig') => project.behaviorArt?.[key];

  const main = roleTrail(project.missileSprite);
  if (main) out.push({ role: 'main', trail: main });

  if (bitMode !== null) {
    const bit = roleTrail(project.bitFlight);
    if (bit) out.push({ role: 'bit', trail: bit });
  }

  if (project.action === 'homing' && art('homing')?.mode === 'builder') {
    const trail = roleTrail(art('homing'));
    if (trail) out.push({ role: 'homing', trail });
  }
  if (
    bitMode !== null &&
    clusters &&
    bitAction === 'homing' &&
    art('homing_bit')?.mode === 'builder'
  ) {
    const trail = roleTrail(art('homing_bit'));
    if (trail) out.push({ role: 'homing_bit', trail });
  }
  if (project.action === 'roam' && art('roam')?.mode === 'builder') {
    const trail = roleTrail(art('roam'));
    if (trail) out.push({ role: 'roam', trail });
  }
  const digUsesBuilder = (art('dig')?.mode ?? 'builder') !== 'native';
  const digMain = digUsesBuilder && project.action === 'dig';
  const digBit =
    digUsesBuilder && bitMode !== null && clusters && bitAction === 'dig';
  if (digMain || digBit) {
    const trail = roleTrail(art('dig'));
    if (trail) out.push({ role: 'dig', trail });
  }
  return out;
}
