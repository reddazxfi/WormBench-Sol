import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Compass,
  Flame,
  Minus,
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  WeaponProject,
  WormSpritePoseAsset,
  WormSpritePoseKey,
  WormSpritesConfig,
} from '../types/weapon';
import { defaultArtFor } from '../utils/defaultArt';
import {
  HAND_LOWER_SRC,
  HAND_MID_SRC,
  HAND_UPPER_SRC,
  WORM_AIM_SRC,
  drawHoldOverlay,
} from '../utils/drawHoldLayer';
import { imagePixelSize } from '../utils/imagePixelSize';
import { NumberInput } from './NumberInput';
import { SheetFrameWarning } from './SheetFrameWarning';
import { SpritePickButton } from './SpritePickButton';
import mapBackgroundSrc from '../../spec/pre_weapon_preview.png';

const AIM_ZOOM_MIN = 0.5;
const AIM_ZOOM_MAX = 3;
const AIM_ZOOM_STEP = 0.25;
const WA_FIRE_POSE_TICKS = 4;

type PoseGroupId = 'aim' | 'pick' | 'fire';
type PreviewPoseMode = 'aim' | 'pick' | 'putaway' | 'fire';
type SlopeKind = 'level' | 'up' | 'down';

interface PoseSlotMeta {
  key: WormSpritePoseKey;
  slope: SlopeKind;
  slopeLabel: string;
  hint: string;
}

const POSE_GROUPS: {
  id: PoseGroupId;
  label: string;
  shortDesc: string;
  defaultFramesHint: string;
  slots: PoseSlotMeta[];
}[] = [
  {
    id: 'aim',
    label: 'Aim (weaponlnk*)',
    shortDesc:
      'Full-worm aiming strip (typically 60x1920, 32 angles from down to up, or an animated loop when worm_sprites_animate is enabled).',
    defaultFramesHint: '32 frames (aim sweep)',
    slots: [
      { key: 'weaponlnk', slope: 'level', slopeLabel: 'Level Ground', hint: 'Base aim sheet; also used for Up/Down slopes if empty' },
      { key: 'weaponlnku', slope: 'up', slopeLabel: 'Up Slope', hint: 'Optional override when standing on an upward slope' },
      { key: 'weaponlnkd', slope: 'down', slopeLabel: 'Down Slope', hint: 'Optional override when standing on a downward slope' },
    ],
  },
  {
    id: 'pick',
    label: 'Pick / Put Away (wthrow*)',
    shortDesc:
      'Full-worm equip and holster strip (typically 60x600, 10 frames played forward on draw and reversed when putting the weapon away).',
    defaultFramesHint: '10 frames (equip/holster)',
    slots: [
      { key: 'wthrow', slope: 'level', slopeLabel: 'Level Ground', hint: 'Optional equip/holster strip; expands to Up/Down if empty' },
      { key: 'wthrowu', slope: 'up', slopeLabel: 'Up Slope', hint: 'Optional upward-slope equip/holster strip' },
      { key: 'wthrowd', slope: 'down', slopeLabel: 'Down Slope', hint: 'Optional downward-slope equip/holster strip' },
    ],
  },
  {
    id: 'fire',
    label: 'Fire (weaponfire*)',
    shortDesc:
      'Full-worm firing pose strip (typically 60x1920, 32 angles matching weaponlnk*, played ~4 frames on WA when firing).',
    defaultFramesHint: '32 frames (firing angles)',
    slots: [
      { key: 'weaponfire', slope: 'level', slopeLabel: 'Level Ground', hint: 'Optional firing sheet; expands to Up/Down if empty' },
      { key: 'weaponfireu', slope: 'up', slopeLabel: 'Up Slope', hint: 'Optional upward-slope firing sheet' },
      { key: 'weaponfired', slope: 'down', slopeLabel: 'Down Slope', hint: 'Optional downward-slope firing sheet' },
    ],
  },
];

const inferFramesFromSize = (width?: number, height?: number): number => {
  if (width && height && height > width && height % width === 0) {
    return height / width;
  }
  return 1;
};

/** Small crisp thumbnail showing frame 0 of a vertical worm pose strip. */
const PoseFrameThumb: React.FC<{
  preview?: string;
  frames: number;
  emptyLabel: string;
}> = ({ preview, frames, emptyLabel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!preview) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
      const f = Math.max(1, Math.round(frames || 1));
      const cellW = img.naturalWidth;
      const cellH = Math.max(1, Math.floor(img.naturalHeight / f));
      const scale = Math.min(canvas.width / cellW, canvas.height / cellH);
      const dw = Math.max(1, Math.round(cellW * scale));
      const dh = Math.max(1, Math.round(cellH * scale));
      const dx = Math.floor((canvas.width - dw) / 2);
      const dy = Math.floor((canvas.height - dh) / 2);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, cellW, cellH, dx, dy, dw, dh);
    };
    img.src = preview;
    return () => {
      alive = false;
    };
  }, [preview, frames]);

  if (!preview) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-100/70 text-[10px] font-mono text-stone-400 dark:border-stone-700 dark:bg-stone-900/70 dark:text-stone-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={56}
      height={56}
      aria-label="Pose frame 0 thumbnail"
      className="h-14 w-14 shrink-0 rounded-lg border border-stone-200 bg-stone-900/90 dark:border-stone-700"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

interface WormSpritesPanelProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

export const WormSpritesPanel: React.FC<WormSpritesPanelProps> = ({
  project,
  onChange,
}) => {
  const wormSprites: WormSpritesConfig = project.wormSprites ?? {
    enabled: false,
    poses: {},
  };
  const poses = wormSprites.poses ?? {};
  const hold = project.hold;
  const defaultArt = defaultArtFor(project);

  const [poseGroup, setPoseGroup] = useState<PoseGroupId>('aim');
  const [previewPose, setPreviewPose] = useState<PreviewPoseMode>('aim');
  const [slope, setSlope] = useState<SlopeKind>('level');
  const [facingRight, setFacingRight] = useState(true);
  const [aimAngleIndex, setAimAngleIndex] = useState(16);
  const [aimZoom, setAimZoom] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [animTick, setAnimTick] = useState(0);
  const [holdFrame, setHoldFrame] = useState(0);
  const [fireDemoTick, setFireDemoTick] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const defaultAimImgRef = useRef<HTMLImageElement | null>(null);
  const handMidImgRef = useRef<HTMLImageElement | null>(null);
  const handLowerImgRef = useRef<HTMLImageElement | null>(null);
  const handUpperImgRef = useRef<HTMLImageElement | null>(null);
  const weaponImgRef = useRef<HTMLImageElement | null>(null);
  const defaultHoldImgRef = useRef<HTMLImageElement | null>(null);
  const flashImgRef = useRef<HTMLImageElement | null>(null);
  const extraHandImgRef = useRef<HTMLImageElement | null>(null);
  const loadedSheetRef = useRef<{ url: string; img: HTMLImageElement } | null>(null);
  const [assetSeq, setAssetSeq] = useState(0);

  const updateWormSprites = (patch: Partial<WormSpritesConfig>) => {
    onChange({
      wormSprites: {
        ...wormSprites,
        ...patch,
        poses: patch.poses ?? poses,
      },
    });
  };

  const setPoseAsset = (
    key: WormSpritePoseKey,
    asset: WormSpritePoseAsset | undefined,
  ) => {
    const nextPoses: Partial<Record<WormSpritePoseKey, WormSpritePoseAsset>> = {
      ...poses,
    };
    if (asset) {
      nextPoses[key] = asset;
    } else {
      delete nextPoses[key];
    }
    updateWormSprites({ poses: nextPoses, enabled: asset ? true : wormSprites.enabled });
  };

  const handleFileSelected = async (
    key: WormSpritePoseKey,
    file: File,
    framesHint?: number,
  ) => {
    const preview = URL.createObjectURL(file);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const size = await imagePixelSize(preview);
      width = size.width;
      height = size.height;
    } catch {
      // keep undefined if metadata fails to load
    }
    const inferred = inferFramesFromSize(width, height);
    const frames = framesHint && framesHint > 0 ? framesHint : inferred;
    setPoseAsset(key, {
      file,
      fileName: file.name,
      preview,
      frames,
      width,
      height,
    });
  };

  // Firing animation length in 50 Hz ticks: WA plays weaponfire* for ~4 frames;
  // an enabled Sprite Builder fire role can extend past those 4 frames.
  const fireStripFrames = Math.max(1, Math.round(hold.fireFrames ?? 1));
  const fireFps = Math.max(1, Math.round(Number(hold.fireFps) || 15));
  const fireTickDefault = Math.max(2, Math.ceil((fireStripFrames * 50) / fireFps));
  const totalFireTicks =
    hold.enabled && (hold.fireTicks || hold.flashFile)
      ? Math.max(WA_FIRE_POSE_TICKS, Math.min(120, Math.round(hold.fireTicks || fireTickDefault)))
      : WA_FIRE_POSE_TICKS;

  const isFireDemoActive = fireDemoTick !== null;
  const effectivePose: PreviewPoseMode =
    isFireDemoActive
      ? fireDemoTick < WA_FIRE_POSE_TICKS
        ? 'fire'
        : 'aim'
      : previewPose;

  // Resolve the active sheet for the 50 Hz preview canvas (with level & fire->aim fallbacks).
  const slopeKeyFor = (base: 'weaponlnk' | 'wthrow' | 'weaponfire'): WormSpritePoseKey => {
    if (base === 'weaponlnk') return slope === 'up' ? 'weaponlnku' : slope === 'down' ? 'weaponlnkd' : 'weaponlnk';
    if (base === 'weaponfire') return slope === 'up' ? 'weaponfireu' : slope === 'down' ? 'weaponfired' : 'weaponfire';
    return slope === 'up' ? 'wthrowu' : slope === 'down' ? 'wthrowd' : 'wthrow';
  };

  const baseGroup: 'weaponlnk' | 'wthrow' | 'weaponfire' =
    effectivePose === 'aim'
      ? 'weaponlnk'
      : effectivePose === 'fire'
        ? 'weaponfire'
        : 'wthrow';

  const activeKey: WormSpritePoseKey = slopeKeyFor(baseGroup);
  const fireAimFallbackKey: WormSpritePoseKey = slopeKeyFor('weaponlnk');
  const activeAsset = wormSprites.enabled
    ? poses[activeKey] ??
      (slope !== 'level' ? poses[baseGroup] : undefined) ??
      (baseGroup === 'weaponfire' ? poses[fireAimFallbackKey] ?? poses.weaponlnk : undefined)
    : undefined;
  const usingFallback =
    !!wormSprites.enabled &&
    !poses[activeKey] &&
    !!activeAsset;
  const activeFrames = Math.max(
    1,
    Math.round(
      activeAsset?.frames ??
        (effectivePose === 'pick' || effectivePose === 'putaway' ? 10 : 32),
    ),
  );
  const isAnimatedMode =
    !isFireDemoActive &&
    (effectivePose === 'pick' ||
      effectivePose === 'putaway' ||
      (effectivePose === 'aim' && !!wormSprites.animate));

  // Preload static terrain backdrop, fallback stock aim worm, and WA hand sheets.
  useEffect(() => {
    const loadStatic = (src: string, ref: React.MutableRefObject<HTMLImageElement | null>) => {
      const img = new Image();
      img.onload = () => setAssetSeq((n) => n + 1);
      img.src = src;
      ref.current = img;
    };
    loadStatic(mapBackgroundSrc, mapImgRef);
    loadStatic(WORM_AIM_SRC, defaultAimImgRef);
    loadStatic(HAND_MID_SRC, handMidImgRef);
    loadStatic(HAND_LOWER_SRC, handLowerImgRef);
    loadStatic(HAND_UPPER_SRC, handUpperImgRef);
  }, []);

  // Preload Sprite Builder overlay images when hold.enabled is active.
  useEffect(() => {
    const loadOpt = (
      src: string | undefined,
      ref: React.MutableRefObject<HTMLImageElement | null>,
    ) => {
      if (!src) {
        ref.current = null;
        return;
      }
      const img = new Image();
      img.onload = () => setAssetSeq((n) => n + 1);
      img.src = src;
      ref.current = img;
    };
    loadOpt(hold.sheetPreview, weaponImgRef);
    loadOpt(hold.flashPreview, flashImgRef);
    loadOpt(hold.extraHand?.preview, extraHandImgRef);
    loadOpt(defaultArt.url, defaultHoldImgRef);
  }, [hold.sheetPreview, hold.flashPreview, hold.extraHand?.preview, defaultArt.url]);

  // Load current preview pose sheet.
  useEffect(() => {
    const url = activeAsset?.preview;
    if (!url) {
      loadedSheetRef.current = null;
      return;
    }
    if (loadedSheetRef.current?.url === url && loadedSheetRef.current.img.complete) {
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      loadedSheetRef.current = { url, img };
      setAssetSeq((n) => n + 1);
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [activeAsset?.preview]);

  // 50 Hz playback tick for animated worm modes (`wthrow*` or `worm_sprites_animate`) or static `fire` strip.
  useEffect(() => {
    if (!isAnimatedMode && effectivePose !== 'fire') return;
    if (isAnimatedMode && !playing) return;
    const timer = window.setInterval(() => {
      setAnimTick((t) => t + 1);
    }, 20);
    return () => window.clearInterval(timer);
  }, [isAnimatedMode, effectivePose, playing]);

  // Held weapon animation clock when Sprite Builder `hold.enabled` is also active.
  useEffect(() => {
    if (!hold.enabled || hold.frames <= 1) {
      setHoldFrame(0);
      return;
    }
    const intervalMs = 1000 / (hold.fps || 15);
    const timer = window.setInterval(() => {
      setHoldFrame((prev) => (prev + 1) % hold.frames);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [hold.enabled, hold.frames, hold.fps]);

  // 50 Hz Preview Fire demo counter (~4 WA ticks for weaponfire*, or fireTicks if longer).
  useEffect(() => {
    if (fireDemoTick === null) return;
    if (fireDemoTick >= totalFireTicks) {
      const done = window.setTimeout(() => setFireDemoTick(null), 0);
      return () => window.clearTimeout(done);
    }
    const timer = window.setTimeout(() => {
      setFireDemoTick((t) => (t !== null ? t + 1 : null));
    }, 20);
    return () => window.clearTimeout(timer);
  }, [fireDemoTick, totalFireTicks]);

  const frameIndex = (() => {
    const f = activeAsset ? activeFrames : 32;
    if (effectivePose === 'pick') {
      return Math.floor(animTick / 2) % f;
    }
    if (effectivePose === 'putaway') {
      return f - 1 - (Math.floor(animTick / 2) % f);
    }
    if (effectivePose === 'aim' && wormSprites.enabled && wormSprites.animate) {
      return Math.floor(animTick / 2) % f;
    }
    if (f <= 1) return 0;
    return Math.min(f - 1, Math.max(0, Math.round((aimAngleIndex / 31) * (f - 1))));
  })();

  const firePreviewFrame =
    fireStripFrames > 1
      ? Math.floor(((fireDemoTick ?? animTick) * fireFps) / 50) % fireStripFrames
      : 0;

  // Draw the 600x600 scene (worm pose sheet + optional Sprite Builder hold overlay).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CELL = 60;
    const SIZE = CELL * 2;
    const CELL_OFF = (SIZE - CELL) / 2;
    const offscreen = document.createElement('canvas');
    offscreen.width = SIZE;
    offscreen.height = SIZE;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;
    offCtx.imageSmoothingEnabled = false;
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    // 1. Base worm posture rendered right-facing into `offscreen`
    const customImg =
      wormSprites.enabled &&
      activeAsset?.preview &&
      loadedSheetRef.current?.url === activeAsset.preview
        ? loadedSheetRef.current.img
        : null;

    if (customImg && customImg.complete && customImg.naturalWidth > 0) {
      const f = activeFrames;
      const cellW = customImg.naturalWidth;
      const cellH = Math.max(1, Math.floor(customImg.naturalHeight / f));
      const sy = Math.min(f - 1, Math.max(0, frameIndex)) * cellH;
      const drawY = CELL_OFF + (CELL - cellH) / 2;
      // WA/PX worm sheets are natively left-facing: flip inside right-facing offscreen cell.
      offCtx.save();
      offCtx.translate(cx, 0);
      offCtx.scale(-1, 1);
      offCtx.drawImage(customImg, 0, sy, cellW, cellH, -cellW / 2, drawY, cellW, cellH);
      offCtx.restore();
    } else if (
      defaultAimImgRef.current &&
      defaultAimImgRef.current.complete &&
      defaultAimImgRef.current.naturalHeight >= 60
    ) {
      const aimImg = defaultAimImgRef.current;
      const sy = Math.min(31, Math.max(0, aimAngleIndex)) * 60;
      offCtx.save();
      if (wormSprites.enabled) offCtx.globalAlpha = 0.6;
      offCtx.translate(CELL_OFF + CELL, CELL_OFF);
      offCtx.scale(-1, 1);
      offCtx.drawImage(aimImg, 0, sy, 60, 60, 0, 0, 60, 60);
      offCtx.restore();
    }

    // 2. Combined Sprite Builder overlay (held art, firing sheet, hands) when enabled
    if (hold.enabled) {
      drawHoldOverlay(offCtx, {
        hold,
        cx,
        cy,
        aimT: aimAngleIndex / 31,
        firingView: isFireDemoActive || previewPose === 'fire',
        currentFrame: holdFrame,
        firePreviewFrame,
        fireStripFrames,
        weaponImg: weaponImgRef.current,
        defaultHoldImg: defaultHoldImgRef.current,
        flashImg: flashImgRef.current,
        handMidImg: handMidImgRef.current,
        handLowerImg: handLowerImgRef.current,
        handUpperImg: handUpperImgRef.current,
        extraHandImg: extraHandImgRef.current,
      });
    }

    // 3. Blit onto the 300x300 terrain backdrop at 2x * aimZoom
    const MAP_SIZE = 300;
    const VIEW_SCALE = 2;
    const WORM_X = 184;
    const WORM_Y = 176;
    const CELL_FEET_Y = 43;
    const cellX = WORM_X - SIZE / 2;
    const cellY = WORM_Y - CELL_FEET_Y - CELL_OFF;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(
      WORM_X * VIEW_SCALE * (1 - aimZoom),
      WORM_Y * VIEW_SCALE * (1 - aimZoom),
    );
    ctx.scale(VIEW_SCALE * aimZoom, VIEW_SCALE * aimZoom);
    ctx.imageSmoothingEnabled = false;

    const sky = ctx.createLinearGradient(0, 0, 0, MAP_SIZE);
    sky.addColorStop(0, '#0c4a6e');
    sky.addColorStop(0.5, '#0284c7');
    sky.addColorStop(1, '#38bdf8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    const mapImg = mapImgRef.current;
    if (mapImg && mapImg.complete && mapImg.naturalWidth > 0) {
      ctx.drawImage(mapImg, 0, 0, MAP_SIZE, MAP_SIZE);
    }

    if (!facingRight) {
      ctx.save();
      ctx.translate(cellX + SIZE, cellY);
      ctx.scale(-1, 1);
      ctx.drawImage(offscreen, 0, 0, SIZE, SIZE, 0, 0, SIZE, SIZE);
      ctx.restore();
    } else {
      ctx.drawImage(offscreen, 0, 0, SIZE, SIZE, cellX, cellY, SIZE, SIZE);
    }

    ctx.restore();
  }, [
    activeAsset?.preview,
    activeFrames,
    aimAngleIndex,
    aimZoom,
    assetSeq,
    facingRight,
    firePreviewFrame,
    fireStripFrames,
    frameIndex,
    hold,
    holdFrame,
    isFireDemoActive,
    previewPose,
    wormSprites.enabled,
  ]);

  const activeGroupDef = POSE_GROUPS.find((g) => g.id === poseGroup) ?? POSE_GROUPS[0];
  const uploadedPoseCount = Object.values(poses).filter((p) => !!p?.file).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1.45fr] items-start">
        {/* LEFT COLUMN: 50 Hz Worm Pose Preview Canvas */}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-stone-200 bg-stone-50/70 p-3.5 dark:border-stone-800 dark:bg-stone-950/60">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900">
              {(
                [
                  { id: 'aim', label: 'Aim' },
                  { id: 'pick', label: 'Pick (in)' },
                  { id: 'putaway', label: 'Put Away' },
                  { id: 'fire', label: 'Fire' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setFireDemoTick(null);
                    setPreviewPose(mode.id);
                    setAnimTick(0);
                    setPoseGroup(mode.id === 'fire' ? 'fire' : mode.id === 'aim' ? 'aim' : 'pick');
                  }}
                  className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    !isFireDemoActive && previewPose === mode.id
                      ? 'bg-forge-600 text-white shadow-2xs'
                      : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900">
              {(
                [
                  { id: 'level', label: 'Level' },
                  { id: 'up', label: 'Up' },
                  { id: 'down', label: 'Down' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSlope(s.id)}
                  className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                    slope === s.id
                      ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                      : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative aspect-square w-full max-w-[520px] overflow-hidden rounded-xl border-2 border-stone-800 bg-stone-950 shadow-lg">
            <canvas
              ref={canvasRef}
              width={600}
              height={600}
              className="block h-full w-full"
              style={{ imageRendering: 'pixelated' }}
            />

            <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5 rounded border border-white/10 bg-black/70 px-2 py-0.5 font-mono text-[10px] text-stone-200 backdrop-blur-xs">
              <span>{activeKey}</span>
              <span>·</span>
              <span>
                Frame {frameIndex + 1}/{activeAsset ? activeFrames : 32}
              </span>
              {isFireDemoActive && (
                <>
                  <span>·</span>
                  <span className="text-amber-300">
                    FIRING {fireDemoTick + 1}/{totalFireTicks}t
                  </span>
                </>
              )}
              {usingFallback && !isFireDemoActive && (
                <>
                  <span>·</span>
                  <span className="text-amber-300">fallback</span>
                </>
              )}
              {hold.enabled && (
                <>
                  <span>·</span>
                  <span className="text-sky-300">+ Hold</span>
                </>
              )}
            </div>

            <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded border border-white/10 bg-black/70 p-0.5 backdrop-blur-xs">
              <button
                type="button"
                aria-label="Zoom preview out"
                disabled={aimZoom <= AIM_ZOOM_MIN}
                onClick={() =>
                  setAimZoom((z) => Math.max(AIM_ZOOM_MIN, Math.round((z - AIM_ZOOM_STEP) * 100) / 100))
                }
                className="cursor-pointer rounded p-1 text-stone-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                onClick={() => setAimZoom(1)}
                className="min-w-[38px] cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-stone-200 hover:bg-white/10"
              >
                {Math.round(aimZoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom preview in"
                disabled={aimZoom >= AIM_ZOOM_MAX}
                onClick={() =>
                  setAimZoom((z) => Math.min(AIM_ZOOM_MAX, Math.round((z + AIM_ZOOM_STEP) * 100) / 100))
                }
                className="cursor-pointer rounded p-1 text-stone-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {isAnimatedMode && (
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="absolute bottom-2 left-2 flex cursor-pointer items-center gap-1.5 rounded border border-white/15 bg-black/70 px-2.5 py-1 font-mono text-[10px] font-semibold text-stone-200 backdrop-blur-xs hover:bg-black/85"
              >
                {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {playing ? 'Pause 25 Hz' : 'Play 25 Hz'}
              </button>
            )}
          </div>

          <div className="flex w-full flex-wrap items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900">
            <button
              type="button"
              onClick={() => setFireDemoTick(0)}
              title={`Preview weaponfire* (~${WA_FIRE_POSE_TICKS} WA frames) together with Sprite Builder firing art (${totalFireTicks} ticks at 50 Hz)`}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                isFireDemoActive
                  ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'border-amber-300 bg-amber-50/70 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/60'
              }`}
            >
              <Flame className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Preview Fire
            </button>

            <button
              type="button"
              onClick={() => setFacingRight((v) => !v)}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-forge-600 dark:text-forge-400" />
              {facingRight ? 'Right' : 'Left'}
            </button>

            <div className="flex min-w-[160px] flex-1 flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-stone-600 dark:text-stone-400">
                <span className="flex items-center gap-1">
                  <Compass className="h-3.5 w-3.5 text-stone-400" />
                  Aim Angle
                </span>
                <span className="font-mono font-bold text-forge-600 dark:text-forge-400">
                  {aimAngleIndex}/31 ({aimAngleIndex === 16 ? 'Level' : aimAngleIndex < 16 ? 'Down' : 'Up'})
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={31}
                step={1}
                disabled={isAnimatedMode}
                value={aimAngleIndex}
                onChange={(e) => setAimAngleIndex(Number(e.target.value))}
                className="w-full cursor-pointer accent-forge-600 disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: 3-Group Pose Sheet Uploader */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/60">
            <label
              htmlFor="worm-sprites-animate"
              className="flex cursor-pointer items-start gap-2.5"
            >
              <input
                id="worm-sprites-animate"
                type="checkbox"
                checked={!!wormSprites.animate}
                onChange={(e) => updateWormSprites({ animate: e.target.checked || undefined })}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
              />
              <div>
                <div className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                  Animate Aim Strip (<span className="font-mono">worm_sprites_animate</span>)
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Play <span className="font-mono">weaponlnk*</span> as a 25 Hz loop instead of indexing frames by aim angle.
                </p>
              </div>
            </label>

            <span className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono text-[11px] font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
              {uploadedPoseCount}/9 poses
            </span>
          </div>

          {!wormSprites.enabled && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              Worm Pose Sheets are currently turned off. Toggle <strong>Enable Worm Pose Sheets</strong> above or upload any PNG below to include custom <code className="font-mono">worm_sprites</code> paths in the export.
            </div>
          )}

          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label="Worm pose replacement groups"
          >
            {POSE_GROUPS.map((group) => {
              const count = group.slots.filter((s) => !!poses[s.key]?.file).length;
              const isSelected = poseGroup === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setFireDemoTick(null);
                    setPoseGroup(group.id);
                    if (group.id === 'fire') {
                      setPreviewPose('fire');
                    } else if (group.id === 'aim') {
                      setPreviewPose('aim');
                    } else if (previewPose !== 'pick' && previewPose !== 'putaway') {
                      setPreviewPose('pick');
                      setAnimTick(0);
                    }
                  }}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'border-forge-500 bg-forge-50/70 text-forge-700 ring-1 ring-forge-500 dark:bg-forge-950/40 dark:text-forge-300'
                      : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'
                  }`}
                >
                  {group.label}
                  {count > 0 && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      {count}/3
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-xs leading-relaxed text-stone-600 dark:text-stone-400">
            {activeGroupDef.shortDesc}{' '}
            <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
              ({activeGroupDef.defaultFramesHint})
            </span>
          </p>

          <div className="space-y-3">
            {activeGroupDef.slots.map((slot) => {
              const asset = poses[slot.key];
              const frames = Math.max(1, Math.round(asset?.frames ?? 1));
              const inputId = `worm-pose-upload-${slot.key}`;
              return (
                <div
                  key={slot.key}
                  className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-2xs dark:border-stone-800 dark:bg-stone-900/90"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <PoseFrameThumb
                      preview={asset?.preview}
                      frames={frames}
                      emptyLabel={slot.slope}
                    />

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-stone-900 dark:text-stone-100">
                            {slot.slopeLabel}
                          </span>
                          <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                            {slot.key}
                          </code>
                          {slot.slope !== 'level' && !asset && (
                            <span className="text-[10px] text-stone-400 dark:text-stone-500">
                              inherits level sheet if empty
                            </span>
                          )}
                        </div>

                        {asset?.fileName && (
                          <span className="truncate font-mono text-[11px] text-stone-500 dark:text-stone-400">
                            {asset.fileName}
                            {asset.width && asset.height ? ` (${asset.width}x${asset.height})` : ''}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-stone-500 dark:text-stone-400">{slot.hint}</p>

                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={inputId}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 shadow-2xs hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                        >
                          <Upload className="h-3.5 w-3.5 text-forge-600 dark:text-forge-400" />
                          Upload PNG
                        </label>
                        <input
                          id={inputId}
                          type="file"
                          accept="image/png"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleFileSelected(slot.key, f);
                            e.target.value = '';
                          }}
                        />

                        <SpritePickButton
                          accept="image"
                          label={`Pick ${slot.key} sprite`}
                          onPick={(file, framesHint) => void handleFileSelected(slot.key, file, framesHint)}
                        />

                        {asset && (
                          <>
                            <div className="flex items-center gap-1.5">
                              <label
                                htmlFor={`worm-pose-frames-${slot.key}`}
                                className="text-[11px] font-semibold text-stone-600 dark:text-stone-400"
                              >
                                Frames
                              </label>
                              <NumberInput
                                id={`worm-pose-frames-${slot.key}`}
                                min={1}
                                max={256}
                                step={1}
                                value={frames}
                                onChange={(e) => {
                                  const next = Math.max(1, Math.round(Number(e.target.value) || 1));
                                  setPoseAsset(slot.key, { ...asset, frames: next });
                                }}
                                className="h-8 w-16 rounded-lg border border-stone-300 bg-white px-2 font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => setPoseAsset(slot.key, undefined)}
                              title={`Remove ${slot.key} sheet`}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/70 px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/60"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          </>
                        )}
                      </div>

                      {asset && (
                        <SheetFrameWarning
                          preview={asset.preview}
                          width={asset.width}
                          height={asset.height}
                          frames={frames}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
