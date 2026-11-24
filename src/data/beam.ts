import type {
  BeamArtStyle,
  BeamConfig,
  BeamDepthBand,
  BeamFadeMode,
  BeamFireConfig,
  BeamGrowEase,
  BeamHitKind,
  BeamHurtMode,
  BeamImpactBurstConfig,
  BeamLookKind,
  BeamPathKind,
  BeamSpriteRole,
  BeamTargetsConfig,
  BurstGlowConfig,
  BurstGlowShape,
  BurstShape,
  RebufferMode,
  WeaponProject,
} from '../types/weapon';

/** Shared `wfws.sdk` sprite paths for each built-in beam texture family. */
export const BEAM_ART_STYLE_PATHS: Record<BeamArtStyle, Record<BeamSpriteRole, string>> = {
  classic: {
    core: 'wf-lib/wfws/sprites/beam.png',
    glow: 'wf-lib/wfws/sprites/beam_glow.png',
    end: 'wf-lib/wfws/sprites/beam_glow_endpoint.png',
    orb: 'wf-lib/wfws/sprites/beam_orb.png',
  },
  soft: {
    core: 'wf-lib/wfws/sprites/beam_soft.png',
    glow: 'wf-lib/wfws/sprites/beam_glow_soft.png',
    end: 'wf-lib/wfws/sprites/beam_end_soft.png',
    orb: 'wf-lib/wfws/sprites/beam_orb_soft.png',
  },
  plasma: {
    core: 'wf-lib/wfws/sprites/beam_plasma.png',
    glow: 'wf-lib/wfws/sprites/beam_glow_plasma.png',
    end: 'wf-lib/wfws/sprites/beam_end_plasma.png',
    orb: 'wf-lib/wfws/sprites/beam_orb_plasma.png',
  },
};

export function beamArtStyleFromPath(path?: string | null): BeamArtStyle {
  if (!path) return 'classic';
  if (path.includes('beam_soft') || path.includes('_soft.png')) return 'soft';
  if (path.includes('beam_plasma') || path.includes('_plasma.png')) return 'plasma';
  return 'classic';
}

export const BEAM_ART_STYLES: { id: BeamArtStyle; label: string; desc: string }[] = [
  { id: 'classic', label: 'Classic', desc: 'Crisp PX beam, halo, end-cap, and radial orb.' },
  { id: 'soft', label: 'Soft (NN)', desc: 'Wide Gaussian falloff tuned for WormForge nearest-neighbor sampling.' },
  { id: 'plasma', label: 'Plasma', desc: 'Thick super-Gaussian core, dome end-cap, and star-flare orb.' },
];

export const DEFAULT_BURST_GLOW: BurstGlowConfig = {
  shape: 'none',
  scale: 2.1,
  expand: 1.0,
  spin: 0.16,
  inner: true,
};

export const DEFAULT_BEAM_FIRE: BeamFireConfig = {
  enabled: false,
  mode: 'impact',
  count: 8,
  durationMs: 3500,
  damage: 5,
  step: 48,
};

export const DEFAULT_BEAM_IMPACT_BURST: BeamImpactBurstConfig = {
  enabled: false,
  style: 'classic',
  shape: 'spin_star',
  radius: 28,
  color: '',
  rebufferMode: 'pulse',
  rebufferAt: 12,
  starPoints: 5,
  spin: 0.18,
};

export const DEFAULT_BEAM_TARGETS: BeamTargetsConfig = {
  worms: true,
  mines: true,
  crates: true,
  objects: true,
  graves: false,
};

export const DEFAULT_BEAM: BeamConfig = {
  enabled: false,
  range: 420,
  stopOnTerrain: true,
  bufferFrames: 0,
  growFrames: 0,
  growEase: 'out',
  holdFrames: 12,
  fadeFrames: 10,
  fadeMode: 'fade',
  followWorm: false,
  followAim: false,
  hurtMode: 'corridor',
  width: 18,
  muzzleWidth: 6,
  coneAngleDeg: 14,
  hitCooldownFrames: 0,
  damageMin: 30,
  damageMax: 30,
  push: 5,
  burnPush: 0,
  pushUp: 2.5,
  kind: 'bullet',
  interact: true,
  fire: { ...DEFAULT_BEAM_FIRE },
  spareShooter: true,
  targets: { ...DEFAULT_BEAM_TARGETS },
  electricTaze: false,
  terrainCut: true,
  cutRadius: 16,
  cutBorder: 4,
  impactSparks: true,
  sparkCount: 6,
  look: 'ribbon',
  artStyle: 'classic',
  path: 'straight',
  bulge: 26,
  noise: 8,
  points: 16,
  branches: 0,
  branchLen: 54,
  hitBranches: false,
  coreWidth: 28,
  tipWidth: 0,
  glowWidth: 64,
  glowAlpha: 0.7,
  color: '#5ad7ff',
  rainbow: false,
  flicker: true,
  depth: 'FRONT',
  standoff: 18,
  offsetX: 0,
  offsetY: -3,
  chargeSound: { id: 0 },
  launchSound: { id: 0 },
  impactSound: { id: 0 },
  impactBurst: { ...DEFAULT_BEAM_IMPACT_BURST },
};

export function cloneBeamConfig(src: BeamConfig): BeamConfig {
  return {
    ...src,
    targets: { ...src.targets },
    chargeSound: { ...src.chargeSound },
    launchSound: { ...src.launchSound },
    impactSound: { ...src.impactSound },
    fire: src.fire ? { ...src.fire } : { ...DEFAULT_BEAM_FIRE },
    impactBurst: src.impactBurst
      ? {
          ...src.impactBurst,
          ...(src.impactBurst.centerGlow ? { centerGlow: { ...src.impactBurst.centerGlow } } : {}),
        }
      : { ...DEFAULT_BEAM_IMPACT_BURST },
  };
}

export function mergeBeamConfig(raw?: Partial<BeamConfig> | null): BeamConfig {
  const s = raw ?? {};
  const hurtMode: BeamHurtMode =
    s.hurtMode === 'corridor' ||
    s.hurtMode === 'cone' ||
    s.hurtMode === 'first' ||
    s.hurtMode === 'none'
      ? s.hurtMode
      : DEFAULT_BEAM.hurtMode;
  const path: BeamPathKind =
    s.path === 'straight' || s.path === 'arc' || s.path === 'jagged'
      ? s.path
      : DEFAULT_BEAM.path;
  const look: BeamLookKind =
    s.look === 'ribbon' || s.look === 'trail' ? s.look : DEFAULT_BEAM.look;
  const artStyle: BeamArtStyle =
    s.artStyle === 'classic' || s.artStyle === 'soft' || s.artStyle === 'plasma'
      ? s.artStyle
      : DEFAULT_BEAM.artStyle;
  const fadeMode: BeamFadeMode =
    s.fadeMode === 'fade' || s.fadeMode === 'retract' || s.fadeMode === 'dissolve'
      ? s.fadeMode
      : DEFAULT_BEAM.fadeMode;
  const growEase: BeamGrowEase =
    s.growEase === 'linear' || s.growEase === 'out' || s.growEase === 'in'
      ? s.growEase
      : DEFAULT_BEAM.growEase;
  const rawDepth = s.depth as string | undefined;
  const depth: BeamDepthBand =
    rawDepth === 'FRONT' || rawDepth === 'EFFECTS' || rawDepth === 'OBJECTS'
      ? rawDepth
      : rawDepth === 'MIDGROUND'
        ? 'OBJECTS'
        : DEFAULT_BEAM.depth;
  const kind: BeamHitKind =
    s.kind === 'bullet' ||
    s.kind === 'fire' ||
    s.kind === 'drill' ||
    s.kind === 'arrow' ||
    s.kind === 'prod' ||
    s.kind === 'percent' ||
    s.kind === 'taze'
      ? s.kind
      : DEFAULT_BEAM.kind;

  return {
    enabled: s.enabled ?? DEFAULT_BEAM.enabled,
    range: Math.max(20, Math.min(4000, Number(s.range ?? DEFAULT_BEAM.range) || DEFAULT_BEAM.range)),
    stopOnTerrain: s.stopOnTerrain ?? DEFAULT_BEAM.stopOnTerrain,
    bufferFrames: Math.max(0, Math.min(150, Math.round(Number(s.bufferFrames ?? 0) || 0))),
    growFrames: Math.max(0, Math.min(200, Math.round(Number(s.growFrames ?? 0) || 0))),
    growEase,
    holdFrames: Math.max(1, Math.min(300, Math.round(Number(s.holdFrames ?? DEFAULT_BEAM.holdFrames) || 1))),
    fadeFrames: Math.max(0, Math.min(150, Math.round(Number(s.fadeFrames ?? DEFAULT_BEAM.fadeFrames) || 0))),
    fadeMode,
    followWorm: !!s.followWorm,
    followAim: !!s.followAim,
    hurtMode,
    width: Math.max(1, Math.min(160, Number(s.width ?? DEFAULT_BEAM.width) || DEFAULT_BEAM.width)),
    muzzleWidth: Math.max(0, Math.min(80, Number(s.muzzleWidth ?? DEFAULT_BEAM.muzzleWidth))),
    coneAngleDeg: Math.max(1, Math.min(60, Number(s.coneAngleDeg ?? DEFAULT_BEAM.coneAngleDeg) || DEFAULT_BEAM.coneAngleDeg)),
    hitCooldownFrames: Math.max(0, Math.min(120, Math.round(Number(s.hitCooldownFrames ?? 0) || 0))),
    damageMin: Math.max(0, Math.min(500, Math.round(Number(s.damageMin ?? DEFAULT_BEAM.damageMin)))),
    damageMax: Math.max(0, Math.min(500, Math.round(Number(s.damageMax ?? s.damageMin ?? DEFAULT_BEAM.damageMax)))),
    push: Math.max(0, Math.min(30, Number(s.push ?? DEFAULT_BEAM.push))),
    burnPush: Math.max(0, Math.min(10, Number(s.burnPush ?? 0))),
    pushUp: Math.max(-15, Math.min(25, Number(s.pushUp ?? DEFAULT_BEAM.pushUp))),
    kind,
    interact: s.interact ?? DEFAULT_BEAM.interact,
    fire: (() => {
      const f = s.fire;
      if (!f) return { ...DEFAULT_BEAM_FIRE };
      const mode: BeamFireConfig['mode'] =
        f.mode === 'impact' || f.mode === 'trajectory' || f.mode === 'both'
          ? f.mode
          : DEFAULT_BEAM_FIRE.mode;
      return {
        enabled: !!f.enabled,
        mode,
        count: Math.max(1, Math.min(60, Math.round(Number(f.count ?? DEFAULT_BEAM_FIRE.count) || DEFAULT_BEAM_FIRE.count))),
        durationMs: Math.max(200, Math.min(15000, Math.round(Number(f.durationMs ?? DEFAULT_BEAM_FIRE.durationMs) || DEFAULT_BEAM_FIRE.durationMs))),
        damage: Math.max(0, Math.min(50, Math.round(Number(f.damage ?? DEFAULT_BEAM_FIRE.damage)))),
        step: Math.max(12, Math.min(200, Math.round(Number(f.step ?? DEFAULT_BEAM_FIRE.step) || DEFAULT_BEAM_FIRE.step))),
      };
    })(),
    spareShooter: s.spareShooter ?? DEFAULT_BEAM.spareShooter,
    targets: {
      ...DEFAULT_BEAM_TARGETS,
      ...(s.targets ?? {}),
    },
    electricTaze: !!s.electricTaze,
    terrainCut: s.terrainCut ?? DEFAULT_BEAM.terrainCut,
    cutRadius: Math.max(0, Math.min(120, Math.round(Number(s.cutRadius ?? DEFAULT_BEAM.cutRadius)))),
    cutBorder: Math.max(0, Math.min(32, Math.round(Number(s.cutBorder ?? DEFAULT_BEAM.cutBorder)))),
    impactSparks: s.impactSparks ?? DEFAULT_BEAM.impactSparks,
    sparkCount: Math.max(1, Math.min(32, Math.round(Number(s.sparkCount ?? DEFAULT_BEAM.sparkCount)))),
    look,
    artStyle,
    path,
    bulge: Math.max(-160, Math.min(160, Number(s.bulge ?? DEFAULT_BEAM.bulge))),
    noise: Math.max(0, Math.min(60, Number(s.noise ?? DEFAULT_BEAM.noise))),
    points: Math.max(2, Math.min(48, Math.round(Number(s.points ?? DEFAULT_BEAM.points)))),
    branches: Math.max(0, Math.min(6, Math.round(Number(s.branches ?? DEFAULT_BEAM.branches)))),
    branchLen: Math.max(8, Math.min(200, Math.round(Number(s.branchLen ?? DEFAULT_BEAM.branchLen)))),
    hitBranches: !!s.hitBranches,
    coreWidth: Math.max(3, Math.min(160, Number(s.coreWidth ?? DEFAULT_BEAM.coreWidth))),
    tipWidth: Math.max(0, Math.min(240, Number(s.tipWidth ?? DEFAULT_BEAM.tipWidth))),
    glowWidth: (() => {
      const gw = Math.max(0, Math.min(240, Number(s.glowWidth ?? DEFAULT_BEAM.glowWidth)));
      return gw > 0 ? Math.max(3, gw) : 0;
    })(),
    glowAlpha: Math.max(0, Math.min(1, Number(s.glowAlpha ?? DEFAULT_BEAM.glowAlpha))),
    color: s.color || DEFAULT_BEAM.color,
    rainbow: !!s.rainbow,
    flicker: s.flicker ?? DEFAULT_BEAM.flicker,
    depth,
    standoff: Math.max(0, Math.min(96, Number(s.standoff ?? DEFAULT_BEAM.standoff))),
    offsetX: Math.max(-80, Math.min(80, Number(s.offsetX ?? DEFAULT_BEAM.offsetX))),
    offsetY: Math.max(-80, Math.min(80, Number(s.offsetY ?? DEFAULT_BEAM.offsetY))),
    chargeSound: { id: s.chargeSound?.id ?? 0, file: s.chargeSound?.file },
    launchSound: { id: s.launchSound?.id ?? 0, file: s.launchSound?.file },
    impactSound: { id: s.impactSound?.id ?? 0, file: s.impactSound?.file },
    impactBurst: (() => {
      const ib = s.impactBurst;
      if (!ib) return { ...DEFAULT_BEAM_IMPACT_BURST };
      const style: BeamArtStyle =
        ib.style === 'classic' || ib.style === 'soft' || ib.style === 'plasma'
          ? ib.style
          : DEFAULT_BEAM_IMPACT_BURST.style;
      const shape: BurstShape =
        ib.shape === 'ring' || ib.shape === 'star' || ib.shape === 'spin_star' || ib.shape === 'none'
          ? ib.shape
          : DEFAULT_BEAM_IMPACT_BURST.shape;
      const rebufferMode: RebufferMode =
        ib.rebufferMode === 'px' ||
        ib.rebufferMode === 'pulse' ||
        ib.rebufferMode === 'flash' ||
        ib.rebufferMode === 'none'
          ? ib.rebufferMode
          : DEFAULT_BEAM_IMPACT_BURST.rebufferMode;
      const centerGlow = (() => {
        const g = ib.centerGlow;
        if (!g) return undefined;
        const gs: BurstGlowShape =
          g.shape === 'none' || g.shape === 'orb' || g.shape === 'star' || g.shape === 'spin_star'
            ? g.shape
            : 'spin_star';
        return {
          shape: gs,
          scale: Math.max(0.2, Math.min(8, Number(g.scale ?? DEFAULT_BURST_GLOW.scale) || DEFAULT_BURST_GLOW.scale)),
          expand: Math.max(0, Math.min(5, Number(g.expand ?? DEFAULT_BURST_GLOW.expand))),
          spin: Math.max(-1, Math.min(1, Number(g.spin ?? DEFAULT_BURST_GLOW.spin))),
          inner: g.inner ?? true,
          ...(g.color ? { color: g.color } : {}),
        };
      })();
      return {
        enabled: !!ib.enabled,
        style,
        shape,
        radius: Math.max(6, Math.min(180, Math.round(Number(ib.radius ?? DEFAULT_BEAM_IMPACT_BURST.radius) || 28))),
        color: ib.color ?? '',
        rebufferMode,
        rebufferAt: Math.max(2, Math.min(60, Math.round(Number(ib.rebufferAt ?? DEFAULT_BEAM_IMPACT_BURST.rebufferAt) || 12))),
        starPoints: Math.max(3, Math.min(12, Math.round(Number(ib.starPoints ?? DEFAULT_BEAM_IMPACT_BURST.starPoints) || 5))),
        spin: Math.max(-1, Math.min(1, Number(ib.spin ?? DEFAULT_BEAM_IMPACT_BURST.spin) || 0)),
        ...(centerGlow ? { centerGlow } : {}),
      };
    })(),
  };
}

export function beamUsesImpactBurst(project: WeaponProject): boolean {
  return beamActive(project) && !!project.beam?.impactBurst?.enabled;
}

export function supportsBeam(project: WeaponProject): boolean {
  return project.fireType === 'beam';
}

export function beamActive(project: WeaponProject): boolean {
  return project.fireType === 'beam' && project.beam?.enabled !== false;
}

export function beamUsesElectricTaze(project: WeaponProject): boolean {
  if (!beamActive(project)) return false;
  const b = mergeBeamConfig(project.beam);
  return b.electricTaze && b.hurtMode !== 'none' && b.targets.worms;
}

export const BEAM_HIT_KINDS: { id: BeamHitKind; label: string; desc: string }[] = [
  { id: 'bullet', label: 'Bullet', desc: 'Crisp firearm knockback and hit reaction.' },
  { id: 'taze', label: 'Electric / Taze', desc: 'Scripted electric hit kind (pair with Electric Taze Hold for stun).' },
  { id: 'fire', label: 'Fire / Burn', desc: 'Thermal burn hit kind.' },
  { id: 'drill', label: 'Drill / Piercing', desc: 'Boring damage feel.' },
  { id: 'arrow', label: 'Arrow', desc: 'Pinning hit kind.' },
  { id: 'prod', label: 'Prod / Shove', desc: 'Light nudge without heavy blast flash.' },
  { id: 'percent', label: 'Percent HP', desc: 'Damage value acts as a percentage of target worm health.' },
];

export interface BeamPreset {
  id: string;
  name: string;
  tagline: string;
  patch: Partial<BeamConfig>;
}

export const BEAM_PRESETS: BeamPreset[] = [
  {
    id: 'laser_lance',
    name: 'Laser Lance',
    tagline: 'Instant high-energy piercing corridor with crisp fade',
    patch: {
      enabled: true,
      range: 520,
      stopOnTerrain: true,
      bufferFrames: 8,
      growFrames: 0,
      growEase: 'out',
      holdFrames: 12,
      fadeFrames: 10,
      fadeMode: 'fade',
      followWorm: false,
      followAim: false,
      hurtMode: 'corridor',
      width: 14,
      hitCooldownFrames: 0,
      damageMin: 35,
      damageMax: 35,
      push: 5,
      pushUp: 2,
      kind: 'bullet',
      interact: true,
      electricTaze: false,
      terrainCut: true,
      cutRadius: 16,
      cutBorder: 4,
      impactSparks: true,
      sparkCount: 8,
      look: 'ribbon',
      path: 'straight',
      noise: 0,
      points: 12,
      branches: 0,
      hitBranches: false,
      coreWidth: 28,
      tipWidth: 0,
      glowWidth: 64,
      glowAlpha: 0.75,
      color: '#ff4d6d',
      rainbow: false,
      flicker: true,
    },
  },
  {
    id: 'plasma_cone',
    name: 'Plasma Cone',
    tagline: 'Slow advancing fan cone with throttled multi-tick burns',
    patch: {
      enabled: true,
      range: 260,
      stopOnTerrain: true,
      bufferFrames: 10,
      growFrames: 18,
      growEase: 'out',
      holdFrames: 26,
      fadeFrames: 14,
      fadeMode: 'dissolve',
      followWorm: true,
      followAim: true,
      hurtMode: 'cone',
      muzzleWidth: 6,
      coneAngleDeg: 15,
      hitCooldownFrames: 10,
      damageMin: 6,
      damageMax: 9,
      push: 5,
      burnPush: 0.9,
      pushUp: 1.5,
      kind: 'fire',
      interact: false,
      electricTaze: false,
      terrainCut: true,
      cutRadius: 12,
      cutBorder: 5,
      impactSparks: true,
      sparkCount: 6,
      look: 'ribbon',
      path: 'straight',
      noise: 3,
      points: 18,
      branches: 0,
      hitBranches: false,
      coreWidth: 30,
      tipWidth: 120,
      glowWidth: 88,
      glowAlpha: 0.65,
      color: '#ff8a2a',
      rainbow: false,
      flicker: true,
    },
  },
  {
    id: 'tesla_arc',
    name: 'Tesla Arc',
    tagline: 'Crackling forked lightning with branches and electric taze',
    patch: {
      enabled: true,
      range: 360,
      stopOnTerrain: true,
      bufferFrames: 6,
      growFrames: 6,
      growEase: 'out',
      holdFrames: 18,
      fadeFrames: 10,
      fadeMode: 'dissolve',
      followWorm: true,
      followAim: false,
      hurtMode: 'corridor',
      width: 22,
      hitCooldownFrames: 0,
      damageMin: 24,
      damageMax: 32,
      push: 3.5,
      pushUp: 3,
      kind: 'taze',
      interact: true,
      electricTaze: true,
      terrainCut: false,
      cutRadius: 0,
      cutBorder: 0,
      impactSparks: true,
      sparkCount: 10,
      look: 'ribbon',
      path: 'jagged',
      noise: 14,
      points: 20,
      branches: 3,
      branchLen: 64,
      hitBranches: true,
      coreWidth: 26,
      tipWidth: 0,
      glowWidth: 68,
      glowAlpha: 0.8,
      color: '#6ec4ff',
      rainbow: false,
      flicker: true,
    },
  },
  {
    id: 'hyper_cannon',
    name: 'Hyper Cannon',
    tagline: 'Charged slow-advancing mega beam that bores straight through',
    patch: {
      enabled: true,
      range: 640,
      stopOnTerrain: false,
      bufferFrames: 18,
      growFrames: 22,
      growEase: 'in',
      holdFrames: 30,
      fadeFrames: 16,
      fadeMode: 'retract',
      followWorm: true,
      followAim: false,
      hurtMode: 'corridor',
      width: 26,
      hitCooldownFrames: 12,
      damageMin: 12,
      damageMax: 15,
      push: 6.5,
      pushUp: 3,
      kind: 'bullet',
      interact: true,
      electricTaze: false,
      terrainCut: true,
      cutRadius: 24,
      cutBorder: 6,
      impactSparks: true,
      sparkCount: 12,
      look: 'ribbon',
      path: 'straight',
      noise: 0,
      points: 24,
      branches: 0,
      hitBranches: false,
      coreWidth: 52,
      tipWidth: 84,
      glowWidth: 124,
      glowAlpha: 0.85,
      color: '#c084fc',
      rainbow: false,
      flicker: true,
    },
  },
  {
    id: 'sniper_rail',
    name: 'Rail First-Hit',
    tagline: 'Swept-circle beam stopping cleanly at the first worm or wall',
    patch: {
      enabled: true,
      range: 700,
      stopOnTerrain: true,
      bufferFrames: 12,
      growFrames: 0,
      growEase: 'linear',
      holdFrames: 8,
      fadeFrames: 14,
      fadeMode: 'fade',
      followWorm: false,
      followAim: false,
      hurtMode: 'first',
      width: 12,
      hitCooldownFrames: 0,
      damageMin: 45,
      damageMax: 45,
      push: 9,
      pushUp: 2.5,
      kind: 'bullet',
      interact: true,
      electricTaze: false,
      terrainCut: true,
      cutRadius: 18,
      cutBorder: 4,
      impactSparks: true,
      sparkCount: 10,
      look: 'ribbon',
      path: 'straight',
      noise: 0,
      points: 10,
      branches: 0,
      hitBranches: false,
      coreWidth: 22,
      tipWidth: 0,
      glowWidth: 54,
      glowAlpha: 0.75,
      color: '#34d399',
      rainbow: false,
      flicker: false,
    },
  },
];
