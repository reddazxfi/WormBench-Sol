/**
 * The aiming clip: what a held weapon does when the player presses Space.
 *
 * This is a *data* clip, not Lua. The same keyframe list is emitted into the
 * claim (`swing = { keys = { ... } }`), evaluated by `wfws_sprite_builder` on
 * the 50 Hz clock and drawn by its aiming layer, so the preview and the game
 * read the same numbers through the same easing set. Nothing here runs inside
 * the draw callback: the clip is a pure function of the ticks since the press.
 *
 * Every channel is relative to the engine's own aim pose, which is the whole
 * point: `angle` is degrees added to the drawn angle, `dx`/`dy` are sheet
 * pixels (the same frame as the hold `offset`), `scale` multiplies the art,
 * `frame` overrides the strip frame and `alpha` fades it. A key with zeroes is
 * the engine's pose exactly.
 */

export type ClipEase =
  | 'linear'
  | 'in_quad'
  | 'out_quad'
  | 'inout_quad'
  | 'in_cubic'
  | 'out_cubic'
  | 'inout_cubic'
  | 'out_back'
  | 'out_elastic'
  | 'hold';

export interface AimClipKey {
  /** 50 Hz ticks from the press. */
  t: number;
  /** Degrees added to the drawn angle (positive swings the art one way). */
  angle: number;
  /** Sheet pixels along/across the drawn frame, like the hold `offset`. */
  dx: number;
  dy: number;
  /** Multiplies the drawn size. */
  scale: number;
  /** Strip frame override, or undefined to keep the engine's own frame. */
  frame?: number;
  /** 0..1 opacity, default 1. */
  alpha?: number;
  /**
   * Whether the opacity eases into this key, default true. `false` holds the
   * previous key's alpha for the whole segment and steps to this key's value at
   * the key itself, which is what a snap-back needs: the art must not fade out
   * on its way to the next pose (a weapon returning to the worm after a swing),
   * it just arrives.
   */
  fade?: boolean;
  ease: ClipEase;
}

/**
 * The trail behind a swing: the same clip at earlier ticks, each ghost fainter
 * than the one in front of it. The pose is a pure function of the tick, so the
 * draw evaluates the clip again instead of recording a history, and the ghosts
 * are identical on every peer for free.
 */
export interface AimEchoConfig {
  enabled: boolean;
  /** Ghosts behind the live art, 1 to 8. */
  count: number;
  /** 50 Hz ticks between two ghosts. */
  every: number;
  /** Alpha multiplier per ghost, so ghost k is `fade ^ k` opaque. */
  fade: number;
  /** `add` glows (the usual choice for a blade), `alpha` is a plain fade. */
  blend: 'alpha' | 'add';
}

export interface AimClipConfig {
  enabled: boolean;
  /** Length of the swing in 50 Hz ticks (20 ms each). */
  ticks: number;
  keys: AimClipKey[];
  /** The ghost trail drawn behind the swing. */
  echo: AimEchoConfig;
  /**
   * What happens when the clip runs out. `endTurn` hands the turn back
   * (`wa.world.set_turn_clock(0)`) because the claim eats WA's fire, so
   * without it the worm would sit in its aim pose with no way out.
   */
  finish: 'none' | 'endTurn';
}

/** The easing names, in the order the select shows them. */
export const CLIP_EASES: { id: ClipEase; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'in_quad', label: 'Ease in' },
  { id: 'out_quad', label: 'Ease out' },
  { id: 'inout_quad', label: 'Ease in-out' },
  { id: 'in_cubic', label: 'In cubic' },
  { id: 'out_cubic', label: 'Out cubic' },
  { id: 'inout_cubic', label: 'In-out cubic' },
  { id: 'out_back', label: 'Overshoot' },
  { id: 'out_elastic', label: 'Elastic' },
  { id: 'hold', label: 'Hold (step)' },
];

/** One timing function, the same arithmetic the Lua uses. */
export function easeClip(ease: ClipEase, f: number): number {
  const t = Math.min(1, Math.max(0, f));
  switch (ease) {
    case 'linear':
      return t;
    case 'in_quad':
      return t * t;
    case 'out_quad':
      return 1 - (1 - t) * (1 - t);
    case 'inout_quad':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case 'in_cubic':
      return t * t * t;
    case 'out_cubic':
      return 1 - Math.pow(1 - t, 3);
    case 'inout_cubic':
      return t < 0.5 ? 4 * t * t * t : 1 - 4 * Math.pow(1 - t, 3);
    case 'out_back': {
      // A little past the destination, then back: the weight of a swing.
      const c = 1.70158;
      const u = t - 1;
      return 1 + (c + 1) * u * u * u + c * u * u;
    }
    case 'out_elastic': {
      if (t === 0 || t === 1) return t;
      const u = t - 1;
      return Math.pow(2, -10 * t) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    }
    case 'hold':
      return t >= 1 ? 1 : 0;
    default:
      return t;
  }
}

export interface ClipPose {
  angle: number;
  dx: number;
  dy: number;
  scale: number;
  frame?: number;
  alpha: number;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/**
 * The pose at `t` ticks, or null when the clip has no keys. Keys are sorted by
 * time; before the first and after the last the pose is that key's, so a clip
 * that ends on a zero key returns to the aim pose by itself.
 */
export function evalClip(clip: AimClipConfig, t: number): ClipPose | null {
  const keys = [...clip.keys].sort((a, b) => a.t - b.t);
  if (keys.length === 0) return null;
  const at = (k: AimClipKey): ClipPose => ({
    angle: k.angle,
    dx: k.dx,
    dy: k.dy,
    scale: k.scale ?? 1,
    frame: k.frame,
    alpha: k.alpha ?? 1,
  });
  if (t <= keys[0].t) return at(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.t) return at(last);
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const raw = span > 0 ? (t - a.t) / span : 1;
  const f = easeClip(b.ease, raw);
  return {
    angle: lerp(a.angle, b.angle, f),
    dx: lerp(a.dx, b.dx, f),
    dy: lerp(a.dy, b.dy, f),
    scale: lerp(a.scale ?? 1, b.scale ?? 1, f),
    // A frame is an index, not a number to blend: it steps at the segment end.
    frame: raw >= 1 ? b.frame : a.frame,
    // `fade = false` is the same rule for the opacity: hold the previous value
    // for the segment, then step. A snap-back pose stays opaque until it lands.
    alpha: b.fade === false ? (a.alpha ?? 1) : lerp(a.alpha ?? 1, b.alpha ?? 1, f),
  };
}

export const DEFAULT_AIM_ECHO: AimEchoConfig = {
  enabled: false,
  count: 4,
  every: 2,
  fade: 0.55,
  blend: 'add',
};

/**
 * A readable two-way swing: wind up away from the target, cut through it,
 * come back to the aim pose. Numbers are small on purpose (a 90 degree cut on
 * a 60 px cell already leaves the canvas), and the last key returns to zero so
 * the art is the engine's own pose again when the clip ends.
 */
export const DEFAULT_AIM_CLIP: AimClipConfig = {
  enabled: false,
  ticks: 16,
  finish: 'none',
  echo: { ...DEFAULT_AIM_ECHO },
  keys: [
    { t: 0, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 1, ease: 'out_quad' },
    { t: 4, angle: -22, dx: -2, dy: 2, scale: 1, alpha: 1, ease: 'in_quad' },
    { t: 8, angle: 58, dx: 3, dy: -3, scale: 1.15, alpha: 1, ease: 'out_cubic' },
    { t: 16, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 1, ease: 'out_quad' },
  ],
};
