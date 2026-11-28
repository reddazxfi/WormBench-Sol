import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  WeaponProject,
  HoldConfig,
  HandType,
  MissileAnimType,
  BehaviorArtKey,
  FlightRoleArt,
  RoamSheetAsset,
  ExtraHandConfig,
  WormSpritePoseKey,
  FlightTrailRoleKey,
  FlightTrailConfig,
} from '../types/weapon';
import {
  bitFlightSheetPath,
  behaviorStateSheetPath,
  digArtOverrideRows,
  roamSheetPath,
  missileFlightSheetPath,
  flightTrailSheetPath,
  flightTrailRows,
  ROAM_FLY_SENTINEL,
  roamGrounded,
  roamWalkPoseId,
} from '../utils/luaGenerator';
import { StockSpriteInput } from './StockSpriteInput';
import { NumberInput, UnitNumberInput } from './NumberInput';
import { SheetFrameWarning } from './SheetFrameWarning';
import { SpritePickButton } from './SpritePickButton';
import { FlightTrailModal } from './FlightTrailModal';
import { WormSpritesPanel } from './WormSpritesPanel';
import {
  HAND_LOWER_SRC,
  HAND_MID_SRC,
  HAND_UPPER_SRC,
  WORM_AIM_SRC,
  drawHoldOverlay,
} from '../utils/drawHoldLayer';
import { imagePixelSize } from '../utils/imagePixelSize';
import { stockSpriteName } from '../data/stockSprites';
import { assetUrl } from '../utils/assetUrl';
import { recordField } from '../utils/recordField';
import { defaultArtFor } from '../utils/defaultArt';
import { hexToRgb, mergeFlightTrailConfig, rgbToHex } from '../data/flightTrail';
import { buildRotationSheet } from '../utils/rotateSheet';
import {
  DEFAULT_DIG_ROLE_ART,
  DEFAULT_ROAM_ROLE_ART,
  DEFAULT_ROAM_TILT,
  DEFAULT_ROLE_ART,
  bitActionOf,
  bitBuilderMode,
  primaryBuilderOn,
} from '../data/spriteBuilder';
import {
  CLIP_EASES,
  DEFAULT_AIM_CLIP,
  DEFAULT_AIM_ECHO,
  evalClip,
  type AimClipConfig,
  type AimClipKey,
  type ClipPose,
} from '../data/aimClip';
import { MELEE_SLACK, meleeScan, meleeStrikes } from '../data/melee';
import { takeoverMissileActive } from '../data/airstrike';
import { KeyTickInput } from './KeyTickInput';
import mapBackgroundSrc from '../../spec/pre_weapon_preview.png';
import normalIconSrc from '../../spec/normal.png';
import homingIconSrc from '../../spec/hmissil1.png';
import clustersIconSrc from '../../spec/clusters.png';
import homingClustletsIconSrc from '../../spec/homing_clustlets.png';
import roamIconSrc from '../../spec/sspsheep1.png';
import digIconSrc from '../../spec/dig.png';
import oildrumSrc from '../../spec/oildrum1.png';
import {
  Upload,
  Play,
  Pause,
  Minus,
  Plus,
  ArrowLeftRight,
  Compass,
  Rocket,
  CheckCircle2,
  Loader2,
  RotateCw,
  Copy,
  Check,
  AlertTriangle,
  Flame,
  Palette,
} from 'lucide-react';

interface HoldPreviewProps {
  project: WeaponProject;
  onChange: (updated: Partial<WeaponProject>) => void;
}

interface PreviewTrailPool {
  n: number;
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
  age: number[];
  life: number[];
  rot: number[];
  spin: number[];
  frame0: number[];
  acc: number;
  now: number;
  lastStep: number;
  seed: number;
}

/**
 * One of a roaming animal's two flying sheets (`sheep_sprites`). WA installs
 * each as a WA sprite and rotates the flying animal itself, so the art has to
 * carry the rotation: a vertical strip of up to 32 direction frames (frame 0
 * pointing up, turning clockwise), exactly like PX's `ghstshp1/2.png`
 * (60x1920). Upload a single frame and bake the strip, or upload a strip and
 * set its frame count.
 */
const RoamSheetField: React.FC<{
  id: string;
  label: string;
  asset?: RoamSheetAsset;
  path: string;
  onChange: (asset: RoamSheetAsset) => void;
}> = ({ id, label, asset, path, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateFrames, setRotateFrames] = useState(32);
  const frames = asset?.frames ?? 1;
  const isGif = /\.gif$/i.test(asset?.fileName || asset?.file?.name || '');

  const handleUpload = (file: File, framesHint?: number) => {
    if (asset?.preview) URL.revokeObjectURL(asset.preview);
    onChange({
      file,
      fileName: file.name,
      preview: URL.createObjectURL(file),
      frames: framesHint && framesHint > 0 ? framesHint : 1,
      rotationFrames: undefined,
      sourceFile: undefined,
      sourceName: undefined,
    });
    setRotateError(null);
  };

  const makeRotationSheet = async () => {
    if (!asset?.file) return;
    setRotating(true);
    setRotateError(null);
    try {
      const sheet = await buildRotationSheet(asset.file, rotateFrames);
      if (asset.preview) URL.revokeObjectURL(asset.preview);
      onChange({
        file: sheet.file,
        fileName: sheet.file.name,
        preview: sheet.previewUrl,
        frames: sheet.frames,
        rotationFrames: sheet.frames,
        sourceFile: asset.sourceFile ?? asset.file,
        sourceName: asset.sourceName ?? asset.fileName ?? asset.file.name,
      });
    } catch (err) {
      setRotateError((err as Error)?.message || String(err));
    } finally {
      setRotating(false);
    }
  };

  const restoreOriginal = () => {
    const source = asset?.sourceFile;
    if (!source) return;
    if (asset?.preview) URL.revokeObjectURL(asset.preview);
    onChange({
      file: source,
      fileName: asset?.sourceName || source.name,
      preview: URL.createObjectURL(source),
      frames: 1,
      rotationFrames: undefined,
      sourceFile: undefined,
      sourceName: undefined,
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900">
          {asset?.preview ? (
            <img
              src={asset.preview}
              alt=""
              className={`h-8 w-8 ${frames > 1 ? 'object-cover object-top' : 'object-contain'}`}
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <span className="text-[10px] text-stone-400">none</span>
          )}
        </div>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/png,image/gif"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-2.5 py-1.5 text-[11px] font-semibold bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700"
        >
          {asset?.file ? 'Change' : 'Upload'}
        </button>
        <SpritePickButton
          accept="image"
          label={`Pick ${label}`}
          onPick={(file, framesHint) => handleUpload(file, framesHint)}
        />
        {asset?.file && (
          <button
            type="button"
            onClick={() => {
              if (asset.preview) URL.revokeObjectURL(asset.preview);
              onChange({});
              setRotateError(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
            className="text-[11px] text-rose-500 hover:text-rose-600 font-medium"
          >
            Remove
          </button>
        )}
      </div>

      {asset?.file && !isGif && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`${label} rotation frame count`}
            value={rotateFrames}
            onChange={(e) => setRotateFrames(Number(e.target.value))}
            className="text-[11px] px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
          >
            <option value={16}>16 frames</option>
            <option value={32}>32 frames</option>
            <option value={64}>64 frames</option>
          </select>
          <button
            type="button"
            onClick={makeRotationSheet}
            disabled={rotating || frames > 1}
            className="px-2.5 py-1.5 text-[11px] font-semibold bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-300 dark:border-stone-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            title={
              frames > 1
                ? 'Already a strip: remove it and upload the single frame again to rebuild.'
                : 'Bake a full 360° strip, frame 0 pointing up, clockwise.'
            }
          >
            {rotating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RotateCw className="w-3 h-3 text-forge-600 dark:text-forge-400" />
            )}
            <span>{frames > 1 ? `Strip (${frames} frames)` : 'Rotate into strip'}</span>
          </button>
          {asset.rotationFrames && (
            <button
              type="button"
              onClick={restoreOriginal}
              className="text-[11px] text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 font-medium underline"
            >
              Use original frame
            </button>
          )}
        </div>
      )}

      {asset?.file && (
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-frames`} className="text-[10px] text-stone-500 dark:text-stone-400">
            Frames
          </label>
          <NumberInput
            id={`${id}-frames`}
            min={1}
            max={64}
            value={frames}
            disabled={isGif || !!asset.rotationFrames}
            title={
              asset.rotationFrames
                ? 'Baked strip: remove the sheet and upload the single frame again to change its frame count.'
                : undefined
            }
            onChange={(e) => {
              const next = Math.max(1, Math.min(64, Number(e.target.value) || 1));
              // The whole asset: the parent replaces the slot with what it gets,
              // so a patch of only the counts dropped the uploaded sheet.
              onChange({ ...asset, frames: next, rotationFrames: next > 1 ? asset.rotationFrames : undefined });
            }}
            className="w-16 text-[11px] font-mono px-2 py-1 rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white disabled:opacity-50"
          />
          <span className="text-[10px] text-stone-400">
            {asset.rotationFrames
              ? 'Baked strip: one cell per direction.'
              : 'WA picks the frame from the flight direction; 32 = a full turn.'}
          </span>
        </div>
      )}

      {asset?.file && !isGif && (
        <SheetFrameWarning preview={asset.preview} frames={frames} />
      )}

      {rotateError && <p className="text-[10px] text-rose-500">{rotateError}</p>}
      <p className="font-mono text-[10px] text-stone-400 truncate" title={path}>
        {path}
      </p>
    </div>
  );
};

/**
 * Flight preview zoom. The canvas draws the sheet at `missileZoom / 4`, so 4 is
 * WA's own pixel size (the oil-drum reference says the same thing) and the
 * readout is a percentage of it. Whole steps keep the readout on round numbers
 * (25%, 50%, ... 300%) instead of 112.5%.
 */
const MISSILE_ZOOM_1X = 4;
const MISSILE_ZOOM_STEP = 1;
const MISSILE_ZOOM_MIN = 1;
const MISSILE_ZOOM_MAX = 12;

/**
 * Aiming preview zoom, a multiplier on the scene's own 2x scale, so 1 is the
 * framing the reference art was laid out for and 200% is a close look at the
 * hand and the held sprite.
 */
const AIM_ZOOM_STEP = 0.25;
const AIM_ZOOM_MIN = 0.5;
/**
 * One aim dial: a label, an exact number box (the slider is for the hand, the
 * box for the value the export actually gets) and the slider under it. The
 * offset pairs put two of these side by side, because X and Y are one thought.
 */
/**
 * A keyframe's tick, committed on blur or Enter instead of on every keystroke.
 *
 * The clip's keys are sorted by `t`, so writing `1` and then `6` to type "16"
 * re-sorts the table (and remounts the row the author is typing in) between the
 * two keystrokes: the box they are in jumps to another key and the rest of the
 * row moves with it. Typing the whole number first and committing once makes the
 * table move once, on purpose.
 */
const HoldDial: React.FC<{
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  title?: string;
}> = ({ id, label, value, onChange, min, max, step, unit, title }) => (
  <div className="space-y-1" title={title}>
    <div className="flex items-center justify-between gap-2">
      <label
        htmlFor={id}
        className="min-w-0 truncate text-xs font-semibold text-stone-700 dark:text-stone-300"
      >
        {label}
      </label>
      {/* 92px, not 74: the unit cell takes ~30px and the input's own padding
          24px, and an `input` clips its text to the content box, so a two-digit
          value ("15", "-8") painted nothing at all in a narrower box. */}
      <div className="w-[92px] shrink-0">
        <UnitNumberInput
          id={`${id}-value`}
          aria-label={`${label} exact value`}
          value={value}
          step={step}
          unit={unit}
          onChange={(event) => {
            const raw = Number(event.target.value);
            if (event.target.value.trim() === '' || Number.isNaN(raw)) return;
            onChange(Math.min(max, Math.max(min, raw)));
          }}
          className="py-0.5 !px-2 text-[11px]"
        />
      </div>
    </div>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full cursor-pointer accent-forge-500"
    />
  </div>
);

const AIM_ZOOM_MAX = 4;

export const HoldPreview: React.FC<HoldPreviewProps> = ({ project, onChange }) => {
  // ---------------------------------------------------------------------------
  // 1. WORM HOLD REFS & STATE
  // ---------------------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [aimAngleIndex, setAimAngleIndex] = useState(16); // 0 (down) to 31 (up), 16 = forward horizontal
  const [facingRight, setFacingRight] = useState(true);

  const aimImgRef = useRef<HTMLImageElement | null>(null);
  const handMidImgRef = useRef<HTMLImageElement | null>(null);
  const handLowerImgRef = useRef<HTMLImageElement | null>(null);
  const handUpperImgRef = useRef<HTMLImageElement | null>(null);
  const weaponImgRef = useRef<HTMLImageElement | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const [weaponLoadedImg, setWeaponLoadedImg] = useState<HTMLImageElement | null>(null);
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  // Default stock-style art shown while no custom sheet has been uploaded.
  const defaultHoldImgRef = useRef<HTMLImageElement | null>(null);
  const defaultMissileImgRef = useRef<HTMLImageElement | null>(null);
  const [defaultHoldLoaded, setDefaultHoldLoaded] = useState<HTMLImageElement | null>(null);
  const [defaultMissileLoaded, setDefaultMissileLoaded] = useState<HTMLImageElement | null>(null);

  // Put-away animation simulation (worm_hold.rs put_pose)
  const [putAwayCounter, setPutAwayCounter] = useState<number | null>(null);

  // Firing-state sprite (`hold.flash`): the engine lights it for `frames` + 1
  // ticks after the fire message. The preview "Test" button does the same at
  // 20 ms a tick.
  const flashFileInputRef = useRef<HTMLInputElement>(null);
  const bufferFileInputRef = useRef<HTMLInputElement>(null);
  const extraHandFileInputRef = useRef<HTMLInputElement>(null);
  const flashImgRef = useRef<HTMLImageElement | null>(null);
  const [flashLoadedImg, setFlashLoadedImg] = useState<HTMLImageElement | null>(null);
  const bufferImgRef = useRef<HTMLImageElement | null>(null);
  const [bufferLoadedImg, setBufferLoadedImg] = useState<HTMLImageElement | null>(null);
  const extraHandImgRef = useRef<HTMLImageElement | null>(null);
  const [extraHandLoadedImg, setExtraHandLoadedImg] = useState<HTMLImageElement | null>(null);
  // 50 Hz ticks on the firing & buffering tabs so strips animate at their true FPS.
  const [fireTick, setFireTick] = useState(0);
  const [bufferTick, setBufferTick] = useState(0);

  // Three faces of one builder: the held art, optional wind-up/buffer art
  // (for beams & sequential fire), and the firing sheet.
  const [aimTab, setAimTab] = useState<'aim' | 'buffer' | 'firing'>('aim');
  const [postureTab, setPostureTab] = useState<'hold' | 'wormSprites'>(() =>
    !project.hold?.enabled && !!project.wormSprites?.enabled ? 'wormSprites' : 'hold',
  );
  const prevPostureProjectIdRef = useRef(project.id);
  const prevWormOnlyRef = useRef(!project.hold?.enabled && !!project.wormSprites?.enabled);
  const [swingStart, setSwingStart] = useState<number | null>(null);
  const [swingTick, setSwingTick] = useState(0);
  const [fireDemoTick, setFireDemoTick] = useState<number | null>(null);
  const [wormAnimTick, setWormAnimTick] = useState(0);
  const wormPoseImgsRef = useRef<Partial<Record<WormSpritePoseKey, HTMLImageElement>>>({});
  const [wormPoseSeq, setWormPoseSeq] = useState(0);

  useEffect(() => {
    const wormOnly = !project.hold?.enabled && !!project.wormSprites?.enabled;
    if (
      project.id !== prevPostureProjectIdRef.current ||
      (wormOnly && !prevWormOnlyRef.current)
    ) {
      prevPostureProjectIdRef.current = project.id;
      setPostureTab(wormOnly ? 'wormSprites' : 'hold');
    }
    prevWormOnlyRef.current = wormOnly;
  }, [project.id, project.hold?.enabled, project.wormSprites?.enabled]);

  // Preload enabled custom worm pose sheets so combined preview shows them too.
  useEffect(() => {
    if (!project.wormSprites?.enabled) {
      wormPoseImgsRef.current = {};
      return;
    }
    const poses = project.wormSprites.poses ?? {};
    const keys: WormSpritePoseKey[] = ['weaponlnk', 'wthrow', 'weaponfire'];
    let alive = true;
    for (const k of keys) {
      const url = poses[k]?.preview;
      if (!url) {
        delete wormPoseImgsRef.current[k];
        continue;
      }
      const existing = wormPoseImgsRef.current[k];
      if (existing && existing.dataset.src === url && existing.complete) continue;
      const img = new Image();
      img.dataset.src = url;
      img.onload = () => {
        if (!alive) return;
        wormPoseImgsRef.current[k] = img;
        setWormPoseSeq((n) => n + 1);
      };
      img.src = url;
    }
    return () => {
      alive = false;
    };
  }, [
    project.wormSprites?.enabled,
    project.wormSprites?.poses?.weaponlnk?.preview,
    project.wormSprites?.poses?.wthrow?.preview,
    project.wormSprites?.poses?.weaponfire?.preview,
  ]);

  const triggerPutAwayDemo = () => {
    setPutAwayCounter(20);
  };

  // Play the clip while `swingStart` is set, one 50 Hz step at a time.
  useEffect(() => {
    if (swingStart === null) return;
    const ticks = Math.max(1, Math.round(playerClip?.ticks ?? DEFAULT_AIM_CLIP.ticks));
    if (swingTick >= ticks) {
      const done = setTimeout(() => setSwingStart(null), 0);
      return () => clearTimeout(done);
    }
    const timer = setTimeout(() => {
      setSwingTick(Math.floor((performance.now() - swingStart) / 20));
    }, 20);
    return () => clearTimeout(timer);
    // `playerClip` is read for its length only; the tick drives the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swingStart, swingTick]);

  // The firing & buffering role clocks: 50 Hz ticks while the tab is open.
  useEffect(() => {
    if (aimTab === 'firing') {
      const timer = setInterval(() => setFireTick((tick) => tick + 1), 20);
      return () => clearInterval(timer);
    }
    if (aimTab === 'buffer') {
      const timer = setInterval(() => setBufferTick((tick) => tick + 1), 20);
      return () => clearInterval(timer);
    }
  }, [aimTab]);

  useEffect(() => {
    if (putAwayCounter === null) return;
    if (putAwayCounter <= 0) {
      const timeout = setTimeout(() => setPutAwayCounter(null), 500);
      return () => clearTimeout(timeout);
    }
    const timer = setTimeout(() => {
      setPutAwayCounter((prev) => (prev !== null ? prev - 1 : null));
      // One put-away frame is one 50 Hz tick, like the engine's counter
      // (`worm_hold.rs` starts it at 20 and `put_pose` divides by 20), so the
      // demo runs at the speed the game does.
    }, 20);
    return () => clearTimeout(timer);
  }, [putAwayCounter]);

  const EMPTY_HOLD: HoldConfig = {
    enabled: false,
    sheet: '',
    handType: 'mid',
    handRadius: 10,
    weapRadius: 6,
    weapRotation: 0,
    scale: 1,
    handScale: 1,
    frames: 1,
    fps: 15,
    animate: false,
    drawHand: true,
    keepWhileFiring: false,
    thrown: false,
    putAway: true,
    handRad: 10,
    handRadLower: 0,
    handRadUpper: 0,
  };
  const hold = project.hold ?? EMPTY_HOLD;
  const defaultArt = defaultArtFor(project);
  // The clip the preview plays: the project's own, or the default shape while
  // the card is on and no keys exist yet (so pressing Space always shows
  // something rather than nothing).
  const playerClip: AimClipConfig = project.aimClip ?? DEFAULT_AIM_CLIP;
  // The same test the generator and the exporter run (`holdNeedsAimLayer`),
  // mirrored here so the aim page says which draw is in use.
  const hasFireGeometry =
    hold.fireWeapRadius !== undefined ||
    hold.fireWeapRotation !== undefined ||
    hold.fireScale !== undefined ||
    hold.fireOffsetX !== undefined ||
    hold.fireOffsetY !== undefined ||
    hold.fireHandOffsetX !== undefined ||
    hold.fireHandOffsetY !== undefined ||
    hold.fireHandRadius !== undefined ||
    hold.fireHandRotation !== undefined ||
    hold.fireHandScale !== undefined;
  const aimLayerOn =
    hold.enabled &&
    ((hold.offsetX ?? 0) !== 0 ||
      (hold.offsetY ?? 0) !== 0 ||
      (hold.handOffsetX ?? 0) !== 0 ||
      (hold.handOffsetY ?? 0) !== 0 ||
      !!project.aimClip?.enabled);
  const showBufferTab =
    project.fireType === 'beam' || !!project.fireSequence?.enabled || !!hold.bufferFile;
  useEffect(() => {
    if (!showBufferTab && aimTab === 'buffer') setAimTab('aim');
  }, [showBufferTab, aimTab]);
  const hasBufferGeometry =
    hold.bufferWeapRadius !== undefined ||
    hold.bufferWeapRotation !== undefined ||
    hold.bufferScale !== undefined ||
    hold.bufferOffsetX !== undefined ||
    hold.bufferOffsetY !== undefined ||
    hold.bufferHandOffsetX !== undefined ||
    hold.bufferHandOffsetY !== undefined ||
    hold.bufferHandRadius !== undefined ||
    hold.bufferHandRotation !== undefined ||
    hold.bufferHandScale !== undefined;
  const bufferStripFrames = Math.max(1, Math.round(hold.bufferFrames ?? 1));
  const bufferFps = Math.max(1, Math.round(Number(hold.bufferFps) || 15));
  const bufferCellWidth = Math.max(1, Math.round(hold.bufferWidth ?? 0));
  const bufferCellHeight = Math.max(1, Math.round((hold.bufferHeight ?? 0) / bufferStripFrames));
  const bufferPreviewFrame =
    bufferStripFrames > 1 ? Math.floor((bufferTick * bufferFps) / 50) % bufferStripFrames : 0;

  // The firing role's resolved numbers, the way the generator resolves them:
  // unset means "the aim art", which is PX's FAMAS case.
  const fireStripFrames = Math.max(1, Math.round(hold.fireFrames ?? 1));
  const fireFps = Math.max(1, Math.round(Number(hold.fireFps) || 15));
  const fireCellWidth = Math.max(1, Math.round(hold.flashWidth ?? 0));
  const fireCellHeight = Math.max(1, Math.round((hold.flashHeight ?? 0) / fireStripFrames));
  const firePreviewFrame =
    fireStripFrames > 1 ? Math.floor((fireTick * fireFps) / 50) % fireStripFrames : 0;
  // One whole strip cycle is the default window, the same number the generator
  // falls back to: WA's own two firing frames are too short to see a strip.
  const fireTickDefault = Math.max(2, Math.ceil((fireStripFrames * 50) / fireFps));
  const fireDemoDuration =
    hold.enabled && (hold.fireTicks || hold.flashFile)
      ? Math.max(4, Math.min(120, Math.round(hold.fireTicks || fireTickDefault)))
      : 4;

  // 50 Hz Preview Fire burst (~4 WA frames for weaponfire*, plus Sprite Builder fire ticks).
  useEffect(() => {
    if (fireDemoTick === null) return;
    if (fireDemoTick >= fireDemoDuration) {
      const done = setTimeout(() => setFireDemoTick(null), 0);
      return () => clearTimeout(done);
    }
    const timer = setTimeout(() => {
      setFireDemoTick((t) => (t !== null ? t + 1 : null));
    }, 20);
    return () => clearTimeout(timer);
  }, [fireDemoTick, fireDemoDuration]);

  // 50 Hz clock for animated `worm_sprites_animate` base worm sheets.
  useEffect(() => {
    if (!project.wormSprites?.enabled || !project.wormSprites?.animate) return;
    const timer = setInterval(() => setWormAnimTick((t) => t + 1), 20);
    return () => clearInterval(timer);
  }, [project.wormSprites?.enabled, project.wormSprites?.animate]);
  const updateClip = (patch: Partial<AimClipConfig>) => {
    onChange({ aimClip: { ...playerClip, ...patch } });
  };
  // Memoised on the tick, so an unrelated render does not rebuild the aim
  // canvas (the pose is an effect dependency).
  const swingPose: ClipPose | null = useMemo(
    () =>
      playerClip.enabled && swingStart !== null
        ? evalClip(playerClip, Math.min(swingTick, playerClip.ticks))
        : null,
    [playerClip, swingStart, swingTick],
  );
  // The ghost trail, the way `sb.hold` draws it: the clip at earlier ticks, each
  // ghost `fade ^ k` opaque, farthest first. Nothing is recorded, the pose is a
  // function of the tick.
  const clipEcho = playerClip.echo ?? DEFAULT_AIM_ECHO;
  const echoPoses: { pose: ClipPose; alpha: number; additive: boolean }[] = useMemo(() => {
    if (!playerClip.enabled || !clipEcho.enabled || swingStart === null) return [];
    const tick = Math.min(swingTick, playerClip.ticks);
    const out: { pose: ClipPose; alpha: number; additive: boolean }[] = [];
    for (let k = Math.max(1, Math.round(clipEcho.count)); k >= 1; k -= 1) {
      const ghostTick = tick - k * Math.max(1, Math.round(clipEcho.every));
      if (ghostTick < 0) continue;
      const pose = evalClip(playerClip, ghostTick);
      if (!pose) continue;
      out.push({ pose, alpha: Math.pow(clipEcho.fade, k), additive: clipEcho.blend === 'add' });
    }
    return out;
  }, [playerClip, clipEcho, swingStart, swingTick]);

  const triggerSwing = () => {
    if (!playerClip.enabled) return;
    setSwingTick(0);
    setSwingStart(performance.now());
  };

  // The keyboard is the game's own trigger, so the preview listens to the same
  // key. Typing keeps its Space, and so does anything a Space press activates:
  // a focused button, link, summary or role=button uses it as its activation
  // key, and taking it would break keyboard use of every control on the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      // Space belongs to a control that would consume it: buttons, links,
      // summaries, anything focusable that is not the page itself.
      if (target?.closest('button, a[href], summary, [role="button"], [role="link"], [tabindex]')) {
        return;
      }
      if (!playerClip.enabled) return;
      event.preventDefault();
      setSwingTick(0);
      setSwingStart(performance.now());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playerClip.enabled]);
  const updateHold = (patch: Partial<typeof hold>) => {
    onChange({ hold: { ...hold, ...patch } });
  };

  // The second hand. Its defaults copy the aim hand's radius, so switching it
  // on puts it on the grip instead of at the worm's feet.
  const extraHand = hold.extraHand;
  const updateExtraHand = (patch: Partial<ExtraHandConfig>) => {
    updateHold({
      // A second hand is held art: with custom held art off there is no hold
      // spec to hang it on, so ticking Draw turns it on rather than doing
      // nothing quietly.
      ...(patch.enabled === true ? { enabled: true } : {}),
      extraHand: {
        enabled: true,
        radius: hold.handRadius ?? 10,
        rotation: hold.handRotation ?? 0,
        scale: hold.handScale ?? 1,
        offsetX: 0,
        offsetY: 0,
        ...extraHand,
        ...patch,
      },
    });
  };

  const currentHandType = hold.handType || 'mid';
  const currentHandTypeLabel =
    currentHandType === 'lower' ? 'Lower' : currentHandType === 'upper' ? 'Upper' : 'Mid';

  const cycleHandType = () => {
    const order: HandType[] = ['lower', 'mid', 'upper'];
    const idx = order.indexOf(currentHandType);
    const next = order[(idx + 1) % order.length];
    updateHold({ handType: next });
  };

  // worm_hold.rs advances `phase` by anim_speed * 0.03 every 50 Hz game frame,
  // so the sheet plays 1.5 * frames * anim_speed frames per second. The field
  // asks for the real FPS and the generator converts it to the multiplier.
  const holdAnimFps = Math.max(1, Number(hold.fps) || 15);
  const holdAnimSpeed =
    hold.frames > 1 ? holdAnimFps / (1.5 * hold.frames) : 1;
  const holdAnimSpeedLabel = holdAnimSpeed
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');

  // ---------------------------------------------------------------------------
  // 2. MISSILE SPRITE REFS & STATE
  // ---------------------------------------------------------------------------
  const missileCanvasRef = useRef<HTMLCanvasElement>(null);
  const missileFileInputRef = useRef<HTMLInputElement>(null);
  const missileImgRef = useRef<HTMLImageElement | null>(null);

  const missile = project.missileSprite || {
    enabled: true,
    mode: 'custom',
    stockSprite: 'bazooka',
    sheet: '',
    anim: 'rotation' as MissileAnimType,
    frames: 1,
    fps: 15,
    animSpeed: 1.0,
    spinRate: 1.0,
    scale: 1.0,
    mirror: true,
    z: 5.0,
    animate: false,
    spin: true,
    hideStock: true,
  };

  const updateMissile = (patch: Partial<typeof missile>) => {
    onChange({
      missileSprite: {
        ...missile,
        ...patch,
      },
    });
  };

  // WFWS roles: cluster bits and per-behaviour states share the same call.
  const bitFlight = project.bitFlight ?? DEFAULT_ROLE_ART;
  const updateBitFlight = (patch: Partial<typeof bitFlight>) => {
    onChange({ bitFlight: { ...bitFlight, ...patch } });
  };
  const behaviorArt = project.behaviorArt ?? {};
  // A behaviour row with no stored entry is inactive (inherit): the identity
  // art already covers the missile, so nothing is emitted. Native is an
  // explicit choice that hands the state back to WA.
  const defaultBehaviorRole: FlightRoleArt = { ...DEFAULT_ROLE_ART, mode: 'inherit' };
  const updateBehaviorArt = (
    key: BehaviorArtKey,
    patch: Partial<FlightRoleArt>
  ) => {
    const base =
      key === 'dig'
        ? DEFAULT_DIG_ROLE_ART
        : key === 'roam'
          ? DEFAULT_ROAM_ROLE_ART
          : DEFAULT_ROLE_ART;
    onChange({
      behaviorArt: {
        ...behaviorArt,
        [key]: { ...(behaviorArt[key] ?? base), ...patch },
      },
    });
  };
  const builderOn = primaryBuilderOn(project);
  const isTakeoverMissile = takeoverMissileActive(project);
  const isAirStrike = project.fireType === 'cursor' && !project.teleport && !isTakeoverMissile;
  const hasPrimaryHoming = project.action === 'homing';
  const hasBitHoming = project.burst === 'clusters' && bitActionOf(project) === 'homing';
  const clustersEnabled = project.burst === 'clusters';
  const roamEnabled = project.action === 'roam';
  const digMainEnabled = project.action === 'dig';
  const digBitEnabled = project.burst === 'clusters' && bitActionOf(project) === 'dig';
  const digEnabled = digMainEnabled || digBitEnabled;

  type FlightSlotRole = 'primary' | 'homing' | 'clusters' | 'homing_bit' | 'roam' | 'dig';
  const [activeFlightRole, setActiveFlightRole] = useState<FlightSlotRole>('primary');
  const [trailModalOpen, setTrailModalOpen] = useState(false);
  const [copiedSbLua, setCopiedSbLua] = useState(false);

  // Auto-fallback to primary if the weapon configuration disables the active slot
  useEffect(() => {
    if (activeFlightRole === 'homing' && !hasPrimaryHoming) setActiveFlightRole('primary');
    else if (activeFlightRole === 'clusters' && !clustersEnabled) setActiveFlightRole('primary');
    else if (activeFlightRole === 'homing_bit' && !hasBitHoming) setActiveFlightRole('primary');
    else if (activeFlightRole === 'roam' && !roamEnabled) setActiveFlightRole('primary');
    else if (activeFlightRole === 'dig' && !digEnabled) setActiveFlightRole('primary');
  }, [activeFlightRole, hasPrimaryHoming, clustersEnabled, hasBitHoming, roamEnabled, digEnabled]);

  const homingRole = behaviorArt.homing ?? defaultBehaviorRole;
  const homingBitRole = behaviorArt.homing_bit ?? defaultBehaviorRole;
  const digRole = behaviorArt.dig ?? DEFAULT_DIG_ROLE_ART;
  const digRoleMode = digRole.mode;
  // A roaming animal's flown art: `inherit` (no row) keeps the round's own
  // sheet, which is what every bundle written before the role existed does;
  // `builder` gives the animal a sheet and animation of its own.
  const roamRole: FlightRoleArt =
    behaviorArt.roam ?? { ...DEFAULT_ROAM_ROLE_ART, mode: 'inherit' };
  const roamRoleMode = roamRole.mode;

  // Missile interactive simulation state
  const [isMissilePlaying, setIsMissilePlaying] = useState(true);
  // `missileZoom / 4` is drawn at WA's own pixel size, so 4 is 1:1 and the
  // readout below is a percentage of that. The step is 0.5 (12.5%).
  const [missileZoom, setMissileZoom] = useState<number>(MISSILE_ZOOM_1X);
  const [aimZoom, setAimZoom] = useState<number>(1);
  const [flightAngleDeg, setFlightAngleDeg] = useState<number>(25); // trajectory launch angle
  const [flightSpeed, setFlightSpeed] = useState<number>(14); // velocity magnitude
  const [flightMode, setFlightMode] = useState<'orbit' | 'arc' | 'static' | 'walk'>('arc');
  const [backdropTheme, setBackdropTheme] = useState<'grid' | 'sky' | 'cavern'>('grid');
  const [showDrumRef, setShowDrumRef] = useState(true);
  const [oildrumLoadedImg, setOildrumLoadedImg] = useState<HTMLImageElement | null>(null);

  // Internal animation state refs (continuous physics & phase)
  const animStateRef = useRef<{
    phase: number;
    rotation: number;
    arcT: number;
    frame: number;
    drumTime: number;
    /** The last side the roaming walk faced; kept through a straight drop. */
    roamLeft: boolean;
  }>({
    phase: 0,
    rotation: 0,
    arcT: 0,
    frame: 0,
    drumTime: 0,
    roamLeft: false,
  });

  const [activeFrameDisplay, setActiveFrameDisplay] = useState(0);
  const roleImgRef = useRef<HTMLImageElement | null>(null);
  const [roleLoadedImg, setRoleLoadedImg] = useState<HTMLImageElement | null>(null);
  const [trailLoadedImg, setTrailLoadedImg] = useState<HTMLImageElement | null>(null);
  const trailPoolRef = useRef<PreviewTrailPool>({
    n: 0,
    x: [],
    y: [],
    vx: [],
    vy: [],
    age: [],
    life: [],
    rot: [],
    spin: [],
    frame0: [],
    acc: 0,
    now: 0,
    lastStep: -1,
    seed: 0x9e3779b9,
  });
  const roleFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setOildrumLoadedImg(img);
    };
    img.src = oildrumSrc;
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // PRELOAD WORM ASSETS
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let loadedCount = 0;
    const totalAssets = 5;
    const checkAllLoaded = () => {
      loadedCount++;
      if (loadedCount >= totalAssets) {
        setAssetsLoaded(true);
      }
    };

    const aimImg = new Image();
    aimImg.onload = checkAllLoaded;
    aimImg.src = WORM_AIM_SRC;
    aimImgRef.current = aimImg;

    const handMid = new Image();
    handMid.onload = checkAllLoaded;
    handMid.src = HAND_MID_SRC;
    handMidImgRef.current = handMid;

    const handLower = new Image();
    handLower.onload = checkAllLoaded;
    handLower.src = HAND_LOWER_SRC;
    handLowerImgRef.current = handLower;

    const handUpper = new Image();
    handUpper.onload = checkAllLoaded;
    handUpper.src = HAND_UPPER_SRC;
    handUpperImgRef.current = handUpper;

    // The landscape the user supplied in spec/: grass, flowers and the hill.
    const mapImg = new Image();
    mapImg.onload = checkAllLoaded;
    mapImg.src = mapBackgroundSrc;
    mapImgRef.current = mapImg;
  }, []);

  // Preload user weapon sheet image and immediately trigger canvas re-render on load
  useEffect(() => {
    if (hold.sheetPreview) {
      const img = new Image();
      img.onload = () => {
        weaponImgRef.current = img;
        setWeaponLoadedImg(img);
      };
      img.src = hold.sheetPreview;
    } else {
      weaponImgRef.current = null;
      setWeaponLoadedImg(null);
    }
  }, [hold.sheetPreview]);

  // Preload the firing-state sprite, so the muzzle flash can be drawn at once.
  useEffect(() => {
    if (hold.flashPreview) {
      const img = new Image();
      img.onload = () => {
        flashImgRef.current = img;
        setFlashLoadedImg(img);
      };
      img.src = hold.flashPreview;
    } else {
      flashImgRef.current = null;
      setFlashLoadedImg(null);
    }
  }, [hold.flashPreview]);

  useEffect(() => {
    if (hold.bufferPreview) {
      const img = new Image();
      img.onload = () => {
        bufferImgRef.current = img;
        setBufferLoadedImg(img);
      };
      img.src = hold.bufferPreview;
    } else {
      bufferImgRef.current = null;
      setBufferLoadedImg(null);
    }
  }, [hold.bufferPreview]);

  // The second hand's own art, when it has one. Without it the preview draws
  // the first hand's sheet, exactly as the layer does.
  const extraHandPreview = hold.extraHand?.enabled ? hold.extraHand.preview : undefined;
  useEffect(() => {
    if (extraHandPreview) {
      const img = new Image();
      img.onload = () => {
        extraHandImgRef.current = img;
        setExtraHandLoadedImg(img);
      };
      img.src = extraHandPreview;
    } else {
      extraHandImgRef.current = null;
      setExtraHandLoadedImg(null);
    }
  }, [extraHandPreview]);

  // Preload missile sprite image
  useEffect(() => {
    if (missile.sheetPreview) {
      const img = new Image();
      img.onload = () => {
        missileImgRef.current = img;
      };
      img.src = missile.sheetPreview;
    } else {
      missileImgRef.current = null;
    }
  }, [missile.sheetPreview]);

  // Preload the active secondary role's preview sheet when switching hotbar slots
  const secondarySheetPreview =
    activeFlightRole === 'clusters'
      ? bitFlight.mode === 'builder'
        ? bitFlight.sheetPreview
        : bitFlight.mode === 'inherit'
          ? missile.sheetPreview
          : undefined
      : activeFlightRole === 'homing'
        ? homingRole.mode === 'builder'
          ? homingRole.sheetPreview
          : homingRole.mode === 'inherit'
            ? missile.sheetPreview
            : undefined
        : activeFlightRole === 'homing_bit'
          ? homingBitRole.mode === 'builder'
            ? homingBitRole.sheetPreview
            : homingBitRole.mode === 'inherit'
              ? bitFlight.mode === 'builder'
                ? bitFlight.sheetPreview
                : missile.sheetPreview
              : undefined
          : activeFlightRole === 'roam'
            ? roamRoleMode === 'builder'
              ? roamRole.sheetPreview
              : builderOn
                ? missile.sheetPreview
                : project.roamSheets?.flight1?.preview
            : activeFlightRole === 'dig'
              ? digRoleMode !== 'native'
                ? digBitEnabled && !digMainEnabled && bitFlight.mode === 'builder'
                  ? bitFlight.sheetPreview
                  : missile.sheetPreview
                : undefined
              : missile.sheetPreview;

  useEffect(() => {
    if (secondarySheetPreview) {
      let cancelled = false;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        roleImgRef.current = img;
        setRoleLoadedImg(img);
      };
      img.src = secondarySheetPreview;
      return () => {
        cancelled = true;
      };
    } else {
      roleImgRef.current = null;
      setRoleLoadedImg(null);
    }
  }, [secondarySheetPreview]);

  // The supplied stock-style defaults stand in until a PNG is uploaded. They
  // are the same files the exporter writes, so the preview is honest.
  useEffect(() => {
    if (hold.sheetPreview) {
      defaultHoldImgRef.current = null;
      setDefaultHoldLoaded(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      defaultHoldImgRef.current = img;
      setDefaultHoldLoaded(img);
    };
    img.src = defaultArt.url;
    return () => {
      cancelled = true;
    };
  }, [defaultArt.url, hold.sheetPreview]);

  useEffect(() => {
    if (missile.sheetPreview) {
      defaultMissileImgRef.current = null;
      setDefaultMissileLoaded(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      defaultMissileImgRef.current = img;
      setDefaultMissileLoaded(img);
    };
    img.src = defaultArt.url;
    return () => {
      cancelled = true;
    };
  }, [defaultArt.url, missile.sheetPreview]);

  // Worm Hold frame animation timer (always plays when hold.frames > 1)
  useEffect(() => {
    if (hold.frames <= 1) {
      setCurrentFrame(0);
      return;
    }
    const intervalMs = 1000 / (hold.fps || 15);
    const timer = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % hold.frames);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [hold.frames, hold.fps]);

  // ---------------------------------------------------------------------------
  // WORM HOLD CANVAS RENDER LOOP
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The offscreen scratch cell is 2x the 60x60 worm cell (120x120), with the
    // worm cell centred in it, so a weapon/hand at a large radius or a scaled-up
    // sprite is no longer clipped by the square.
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

    // Put-away pose calculation (worm_hold.rs `put_pose`)
    let aimT = aimAngleIndex / 31;
    let putAwayShrink = 1.0;
    if (putAwayCounter !== null) {
      const tPut = 1.0 - (putAwayCounter / 20.0);
      if (tPut < 0.5) {
        aimT = aimT + (0.5 - aimT) * (tPut * 2.0);
        putAwayShrink = 1.0;
      } else {
        aimT = 0.5 + (0.2 - 0.5) * ((tPut - 0.5) * 2.0);
        putAwayShrink = Math.max(0, 1.0 - (tPut - 0.5) * 2.0);
      }
    }

    // The layer's aim clamp (`aim_clamp`): the pose stops that many degrees
    // short of straight up/down, the same numbers the Lua clamps with. The
    // worm's own posture strip still follows the real aim, exactly as in game.
    const firingView = aimTab === 'firing' || fireDemoTick !== null;
    const bufferView = !firingView && aimTab === 'buffer';
    const poseRole = firingView ? 'firing' : bufferView ? 'buffer' : 'aim';
    const useWeaponFirePose =
      aimTab === 'firing' || (fireDemoTick !== null && fireDemoTick < 4);

    // 1. Base Worm aiming/firing/draw posture.
    // When `worm_sprites` is enabled, composite the author's custom full-worm
    // sheet underneath the Sprite Builder hold/hand overlay; otherwise draw `aim.png`.
    const wormPoses = project.wormSprites?.poses;
    const requestedPoseKey: WormSpritePoseKey = useWeaponFirePose
      ? 'weaponfire'
      : putAwayCounter !== null
        ? 'wthrow'
        : 'weaponlnk';
    const customPoseKey: WormSpritePoseKey =
      wormPoses?.[requestedPoseKey]?.preview
        ? requestedPoseKey
        : 'weaponlnk';
    const customWormAsset = project.wormSprites?.enabled
      ? wormPoses?.[customPoseKey]
      : undefined;
    const customWormImg =
      customWormAsset?.preview ? wormPoseImgsRef.current[customPoseKey] : undefined;

    if (customWormImg && customWormImg.complete && customWormImg.naturalWidth > 0 && customWormAsset) {
      const wf = Math.max(1, Math.round(customWormAsset.frames ?? 32));
      const cellW = customWormImg.naturalWidth;
      const cellH = Math.max(1, Math.floor(customWormImg.naturalHeight / wf));
      let frameIdx: number;
      if (customPoseKey === 'wthrow') {
        const tPut = putAwayCounter !== null ? 1.0 - putAwayCounter / 20.0 : 0;
        frameIdx = Math.min(wf - 1, Math.max(0, Math.round((1 - tPut) * (wf - 1))));
      } else if (customPoseKey === 'weaponlnk' && project.wormSprites?.animate) {
        frameIdx = Math.floor(wormAnimTick / 2) % wf;
      } else {
        frameIdx = wf <= 1 ? 0 : Math.min(wf - 1, Math.max(0, Math.round((aimAngleIndex / 31) * (wf - 1))));
      }
      const sy = frameIdx * cellH;
      const drawY = CELL_OFF + (CELL - cellH) / 2;
      offCtx.save();
      offCtx.translate(cx, 0);
      offCtx.scale(-1, 1);
      offCtx.drawImage(customWormImg, 0, sy, cellW, cellH, -cellW / 2, drawY, cellW, cellH);
      offCtx.restore();
    } else {
      const aimImg = aimImgRef.current;
      if (aimImg && aimImg.complete && aimImg.naturalHeight >= 60) {
        const sy = Math.min(31, Math.max(0, aimAngleIndex)) * 60;
        offCtx.save();
        offCtx.translate(CELL_OFF + CELL, CELL_OFF);
        offCtx.scale(-1, 1);
        offCtx.drawImage(aimImg, 0, sy, 60, 60, 0, 0, 60, 60);
        offCtx.restore();
      } else {
        offCtx.fillStyle = '#f472b6';
        offCtx.beginPath();
        offCtx.arc(cx, cy, 12, 0, Math.PI * 2);
        offCtx.fill();
      }
    }

    // 2. Shared Sprite Builder hold/buffer/firing/hands overlay
    const activeFireFrame =
      fireDemoTick !== null
        ? fireStripFrames > 1
          ? Math.floor((fireDemoTick * fireFps) / 50) % fireStripFrames
          : 0
        : firePreviewFrame;
    const aimDrawn = drawHoldOverlay(offCtx, {
      hold,
      cx,
      cy,
      aimT,
      putAwayShrink,
      firingView,
      poseRole,
      currentFrame,
      firePreviewFrame: activeFireFrame,
      fireStripFrames,
      bufferPreviewFrame,
      bufferStripFrames,
      swingPose,
      echoPoses,
      weaponImg: weaponLoadedImg || weaponImgRef.current,
      defaultHoldImg: defaultHoldLoaded,
      flashImg: flashLoadedImg || flashImgRef.current,
      bufferImg: bufferLoadedImg || bufferImgRef.current,
      handMidImg: handMidImgRef.current,
      handLowerImg: handLowerImgRef.current,
      handUpperImg: handUpperImgRef.current,
      extraHandImg: extraHandLoadedImg || extraHandImgRef.current,
    });

    // Compose the same 300x300 scene the retired physics preview used, then
    // draw it at 2x: the simulator's default `Scale: 2x`.  The worm cell and
    // the hold art are drawn together at native size before that one scene
    // scale, so the hold stays pixel-aligned with the worm instead of being
    // zoomed on its own.
    const MAP_SIZE = 300;
    const VIEW_SCALE = 2;
    const WORM_X = 184; // `WORM_SITE_X` in the old simulator
    const WORM_Y = 176; // feet, `WORM_SITE_Y`
    const CELL_FEET_Y = 43; // feet row inside the 60x60 aim cell
    const cellX = WORM_X - SIZE / 2;
    const cellY = WORM_Y - CELL_FEET_Y - CELL_OFF;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // Zoom keeps the worm where it sits at 100%: the scene is scaled about the
    // worm's own map point, so a close look frames the hand and the held sprite
    // instead of pushing them off the canvas.
    ctx.translate(
      WORM_X * VIEW_SCALE * (1 - aimZoom),
      WORM_Y * VIEW_SCALE * (1 - aimZoom),
    );
    ctx.scale(VIEW_SCALE * aimZoom, VIEW_SCALE * aimZoom);
    ctx.imageSmoothingEnabled = false;

    // Deep blue to black sky gradient, matching Worms Armageddon's dark backdrop in both themes.
    const sky = ctx.createLinearGradient(0, 0, 0, MAP_SIZE);
    sky.addColorStop(0, '#0c2344');
    sky.addColorStop(0.55, '#061124');
    sky.addColorStop(1, '#000000');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    const mapImg = mapImgRef.current;
    if (mapImg && mapImg.complete && mapImg.naturalWidth > 0) {
      ctx.drawImage(mapImg, 0, 0, MAP_SIZE, MAP_SIZE);
    }

    if (!facingRight) {
      // The whole cell is right-facing; mirror it for the left-facing pose. The
      // mirror is this draw's alone: the melee box below sets its own flip from
      // the worm's pivot, and a leaked one moved it off the worm and back again.
      ctx.save();
      ctx.translate(cellX + SIZE, cellY);
      ctx.scale(-1, 1);
      ctx.drawImage(offscreen, 0, 0, SIZE, SIZE, 0, 0, SIZE, SIZE);
      ctx.restore();
    } else {
      ctx.drawImage(offscreen, 0, 0, SIZE, SIZE, cellX, cellY, SIZE, SIZE);
    }

    // The melee strike's scan box, in red: the exact test `sb.hold` runs on the
    // hit frame. It is drawn on the map, from the worm's own pivot, at 1:1 (the
    // numbers are game pixels), and in the offscreen's right-facing convention:
    // the side is one horizontal flip, which is the engine's `facing`.
    const meleeCfg = project.melee;
    if (meleeCfg?.enabled && !firingView) {
      // Which strike the box belongs to. A swing can land several, so the box is
      // the one being tested now: the last strike whose frame the clip has
      // reached, and the first one before any of them. That is the box the game
      // would be testing at this tick, not a box the panel invented.
      const strikes = meleeStrikes(meleeCfg);
      const clipTick = swingStart === null ? null : Math.min(swingTick, playerClip.ticks);
      const current =
        clipTick === null
          ? strikes[0]
          : [...strikes].reverse().find((hit) => hit.frame <= clipTick) ?? strikes[0];
      const hitPose =
        project.aimClip && project.aimClip.keys.length > 0
          ? evalClip(project.aimClip, Math.max(0, Math.round(current.frame)))
          : null;
      // The worm's own aim, not the art's: `weapRotation` turns the sheet, it
      // does not turn where the worm points.
      const scan = meleeScan(
        // The strike is thrown with the clamped aim, the same value the Lua
        // latches at the press.
        aimDrawn,
        1,
        meleeCfg.followSwing === false ? 0 : hitPose?.angle ?? 0,
      );
      const reach = Math.max(1, meleeCfg.radius);
      const halfWidth = Math.max(0, meleeCfg.width);
      ctx.save();
      ctx.translate(cellX + cx, cellY + cy);
      ctx.scale(facingRight ? 1 : -1, 1);
      ctx.rotate(scan.angle);
      // The slack is the near edge's forgiveness, drawn so the panel shows the
      // same reach the simulation tests.
      ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
      ctx.fillRect(-MELEE_SLACK, -halfWidth, reach + MELEE_SLACK, halfWidth * 2);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-MELEE_SLACK, -halfWidth, reach + MELEE_SLACK, halfWidth * 2);
      ctx.restore();
    }
    ctx.restore();
  }, [hold, project.wormSprites?.enabled, project.wormSprites?.animate, project.melee, project.aimClip, aimAngleIndex, currentFrame, facingRight, assetsLoaded, weaponLoadedImg, defaultHoldLoaded, putAwayCounter, flashLoadedImg, bufferLoadedImg, extraHandLoadedImg, firePreviewFrame, fireStripFrames, bufferPreviewFrame, bufferStripFrames, fireDemoTick, wormAnimTick, wormPoseSeq, aimZoom, swingPose, swingStart, swingTick, echoPoses, aimTab, postureTab]);

  // Derive active preview role settings for the 50 Hz simulation canvas
  const activeRolePreviewCfg = (() => {
    if (activeFlightRole === 'clusters') {
      if (bitFlight.mode === 'builder') return bitFlight;
      if (bitFlight.mode === 'inherit') return missile;
      return { ...bitFlight, anim: 'rotation' as MissileAnimType, frames: 1 };
    }
    if (activeFlightRole === 'homing') {
      if (homingRole.mode === 'builder') return homingRole;
      if (homingRole.mode === 'inherit') return missile;
      return { ...homingRole, anim: 'track' as MissileAnimType, frames: 1 };
    }
    if (activeFlightRole === 'homing_bit') {
      if (homingBitRole.mode === 'builder') return homingBitRole;
      if (homingBitRole.mode === 'inherit') {
        return bitFlight.mode === 'builder' ? bitFlight : missile;
      }
      return { ...homingBitRole, anim: 'track' as MissileAnimType, frames: 1 };
    }
    if (activeFlightRole === 'roam') {
      // Own sheet: the role's own art and animation. Round's sheet: the primary
      // row is what flies (and what the export keeps), so preview that.
      if (roamRoleMode === 'builder') return roamRole;
      if (!builderOn && project.roamSheets?.flight1?.preview) {
        return {
          ...missile,
          anim: 'none' as MissileAnimType,
          frames: project.roamSheets?.flight1?.frames || 1,
        };
      }
      return missile;
    }
    if (activeFlightRole === 'dig') {
      if (digRoleMode === 'native') {
        return { ...DEFAULT_ROLE_ART, anim: 'track' as MissileAnimType, frames: 1 };
      }
      const ownerCfg =
        digBitEnabled && !digMainEnabled && bitFlight.mode === 'builder' ? bitFlight : missile;
      return {
        ...digRole,
        frames: digRole.frames > 1 ? digRole.frames : ownerCfg.frames || 1,
      };
    }
    return missile;
  })();

  // A role's own enabled trail wins. Otherwise a dig preview inherits whichever
  // round owns the dig: the bit when the bit sheet drives the dig, else the
  // main round. That mirrors the SDK's `(digging and dig.trail) or cfg.trail`.
  const previewTrailRaw = (() => {
    const own = (art: { trail?: FlightTrailConfig } | null | undefined) =>
      art?.trail?.enabled ? art.trail : null;
    if (activeFlightRole === 'primary') return own(missile);
    if (activeFlightRole === 'clusters') {
      if (!builderOn || bitFlight.mode === 'native') return null;
      // `bits = "inherit"` can still carry its own explicit trail table, and
      // the generator emits it; only fall back to the round when it does not.
      return own(bitFlight) ?? (bitFlight.mode === 'inherit' ? own(missile) : null);
    }
    if (activeFlightRole === 'homing') {
      if (!builderOn) return null;
      if (homingRole.mode === 'builder') return own(homingRole);
      return homingRole.mode === 'inherit' ? own(missile) : null;
    }
    if (activeFlightRole === 'homing_bit') {
      if (!builderOn) return null;
      if (homingBitRole.mode === 'builder') return own(homingBitRole);
      if (homingBitRole.mode === 'inherit') {
        return bitFlight.mode === 'builder' ? own(bitFlight) : own(missile);
      }
      return null;
    }
    if (activeFlightRole === 'roam') {
      if (!builderOn) return null;
      if (roamRoleMode === 'builder') return own(roamRole);
      return roamRoleMode === 'inherit' ? own(missile) : null;
    }
    if (digRoleMode === 'native') return null;
    if (digRole.trail?.enabled) return digRole.trail;
    const owner =
      digBitEnabled && !digMainEnabled && bitFlight.mode === 'builder' ? bitFlight : missile;
    return own(owner);
  })();
  const previewTrail = previewTrailRaw ? mergeFlightTrailConfig(previewTrailRaw) : null;
  const previewTrailKey = JSON.stringify(previewTrail ?? null);
  const previewTrailSheet = previewTrail?.sheetPreview;

  useEffect(() => {
    if (previewTrailSheet) {
      let cancelled = false;
      const img = new Image();
      img.onload = () => {
        if (!cancelled) setTrailLoadedImg(img);
      };
      img.src = previewTrailSheet;
      return () => {
        cancelled = true;
      };
    }
    setTrailLoadedImg(null);
  }, [previewTrailSheet]);

  // Switching hotbar role starts a fresh trail pool, exactly as the game drops
  // the old role's accumulator when the handle changes.
  useEffect(() => {
    const pool = trailPoolRef.current;
    pool.n = 0;
    pool.acc = 0;
    pool.now = 0;
    pool.lastStep = -1;
    pool.seed = 0x9e3779b9;
  }, [activeFlightRole]);

  // ---------------------------------------------------------------------------
  // 3. MISSILE FLIGHT SPRITE RENDER & ANIMATION LOOP (px_sprite_builder.lua exact)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    let accumulator = 0;
    const STEP = 1 / 50; // `wa.on.missile_frame` runs at 50 Hz

    const ANIM_SPEED_TABLE: Record<string, number> = {
      slow: 0.5,
      medium: 0.8,
      fast: 1.35,
    };

    const canvas = missileCanvasRef.current;
    const width = canvas?.width ?? 300;
    const height = canvas?.height ?? 260;

    // Per-flight state, advanced only in fixed 50 Hz steps so the rotation
    // and cyclical frame match `px_sprite_builder.lua` frame for frame.
    let posX = width / 2;
    let posY = height / 2;
    let vx = 0;
    let vy = 0;
    let rot = animStateRef.current.rotation || 0;
    let roamLeft = animStateRef.current.roamLeft;
    let phase = animStateRef.current.phase || 0;
    let frame = animStateRef.current.frame || 0;
    let started = false;
    let lastFrameDisplay = -1;

    // The brush trail preview mirrors `wfws_trail.lua` in screen units. Game
    // velocities arrive at 1:1 and are scaled by the missile zoom, so the
    // nozzle, spread, gravity and particle size all use the same factor.
    const trail = previewTrail;
    const trailPool = trailPoolRef.current;
    const trailZoom = missileZoom / 4;
    const trailSource = trailLoadedImg;
    const tintCache = new Map<string, HTMLCanvasElement>();
    let puffCanvas: HTMLCanvasElement | null = null;
    const trailRng = () => {
      trailPool.seed = (Math.imul(trailPool.seed, 1664525) + 1013904223) >>> 0;
      return trailPool.seed / 4294967296;
    };
    const puffSource = () => {
      if (puffCanvas) return puffCanvas;
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const pctx = c.getContext('2d');
      if (pctx) {
        const grad = pctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        pctx.fillStyle = grad;
        pctx.fillRect(0, 0, 16, 16);
      }
      puffCanvas = c;
      return c;
    };
    const tintSprite = (source: CanvasImageSource, sw: number, sh: number, color: string) => {
      const cached = tintCache.get(color);
      if (cached) return cached;
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const cctx = c.getContext('2d');
      if (!cctx) return c;
      cctx.drawImage(source, 0, 0, sw, sh);
      cctx.globalCompositeOperation = 'multiply';
      cctx.fillStyle = color;
      cctx.fillRect(0, 0, sw, sh);
      tintCache.set(color, c);
      return c;
    };
    const hueHex = (h: number) => {
      const x = (h - Math.floor(h)) * 6;
      const sector = Math.floor(x);
      const f = x - sector;
      if (sector < 1) return rgbToHex(255, Math.floor(f * 255), 0);
      if (sector < 2) return rgbToHex(Math.floor((1 - f) * 255), 255, 0);
      if (sector < 3) return rgbToHex(0, 255, Math.floor(f * 255));
      if (sector < 4) return rgbToHex(0, Math.floor((1 - f) * 255), 255);
      if (sector < 5) return rgbToHex(Math.floor(f * 255), 0, 255);
      return rgbToHex(255, 0, Math.floor((1 - f) * 255));
    };

    const spawnTrail = (
      x: number,
      y: number,
      headingDeg: number,
      facing: number
    ) => {
      if (!trail) return;
      const r = trailRng();
      const r2 = trailRng();
      const r3 = trailRng();
      let ox = trail.offsetX;
      const oy = trail.offsetY;
      if (facing < 0) ox = -ox;
      const heading = (headingDeg * Math.PI) / 180;
      const hc = Math.cos(heading);
      const hs = Math.sin(heading);
      let sx = x + (ox * hc - oy * hs) * trailZoom;
      let sy = y + (ox * hs + oy * hc) * trailZoom;
      if (trail.jitterPx > 0) {
        const ja = r2 * Math.PI * 2;
        const jr = r3 * trail.jitterPx * trailZoom;
        sx += Math.cos(ja) * jr;
        sy += Math.sin(ja) * jr;
      }
      const speed2 = vx * vx + vy * vy;
      const baseAng =
        speed2 > 0.000001 ? Math.atan2(-vy, -vx) : heading + Math.PI;
      const spread = (trail.spreadDeg * Math.PI) / 180;
      const ang = baseAng + (r - 0.5) * spread;
      const mag = (trail.speed / 100) * (0.7 + 0.6 * r2) * trailZoom;
      const pvx = vx * trail.inheritVel * trailZoom + Math.cos(ang) * mag;
      const pvy = vy * trail.inheritVel * trailZoom + Math.sin(ang) * mag;
      let prot = 0;
      if (trail.rotateMode === 'random') prot = r * Math.PI * 2;
      else if (trail.rotateMode === 'align') prot = ang;
      else if (trail.rotateMode === 'missile') prot = heading;
      const spin = (trail.spinMin + (trail.spinMax - trail.spinMin) * r3) * (Math.PI / 180);
      let life = Math.round(trail.lifeFrames * (1 + (r2 * 2 - 1) * trail.lifeJitter));
      if (life < 2) life = 2;
      if (life > 180) life = 180;
      const i = trailPool.n < trail.maxParticles ? trailPool.n++ : 0;
      trailPool.x[i] = sx;
      trailPool.y[i] = sy;
      trailPool.vx[i] = pvx;
      trailPool.vy[i] = pvy;
      trailPool.age[i] = 0;
      trailPool.life[i] = life;
      trailPool.rot[i] = prot;
      trailPool.spin[i] = spin;
      const startFrame = Math.max(0, Math.min(trail.frames - 1, Math.round(trail.startFrame ?? 0)));
      const usableFrames = Math.max(1, trail.frames - startFrame);
      trailPool.frame0[i] =
        usableFrames > 1 ? Math.floor(trailRng() * usableFrames) : 0;
    };

    const stepTrail = (x: number, y: number, headingDeg: number, facing: number) => {
      if (!trail) {
        trailPool.n = 0;
        trailPool.acc = 0;
        return;
      }
      trailPool.now += 1;
      let i = 0;
      while (i < trailPool.n) {
        const age = trailPool.age[i] + 1;
        if (age >= trailPool.life[i]) {
          const last = trailPool.n - 1;
          if (i !== last) {
            trailPool.x[i] = trailPool.x[last];
            trailPool.y[i] = trailPool.y[last];
            trailPool.vx[i] = trailPool.vx[last];
            trailPool.vy[i] = trailPool.vy[last];
            trailPool.age[i] = trailPool.age[last];
            trailPool.life[i] = trailPool.life[last];
            trailPool.rot[i] = trailPool.rot[last];
            trailPool.spin[i] = trailPool.spin[last];
            trailPool.frame0[i] = trailPool.frame0[last];
          }
          trailPool.n = last;
        } else {
          trailPool.age[i] = age;
          trailPool.vx[i] *= trail.drag;
          trailPool.vy[i] = trailPool.vy[i] * trail.drag + trail.gravity * trailZoom;
          trailPool.x[i] += trailPool.vx[i];
          trailPool.y[i] += trailPool.vy[i];
          trailPool.rot[i] += trailPool.spin[i];
          i += 1;
        }
      }
      const rate = trail.power / 25;
      if (rate <= 0) return;
      const acc = trailPool.acc + rate;
      const count = Math.floor(acc);
      trailPool.acc = acc - count;
      for (let k = 0; k < count && k < 32; k += 1) {
        spawnTrail(x, y, headingDeg, facing);
      }
    };

    const drawTrail = (ctx: CanvasRenderingContext2D) => {
      if (!trail || trailPool.n === 0) return;
      const source = trailSource || puffSource();
      const srcW =
        trailSource && trailSource.naturalWidth > 0
          ? trailSource.naturalWidth
          : trailSource
            ? trailSource.width
            : 16;
      const srcH =
        trailSource && trailSource.naturalHeight > 0
          ? trailSource.naturalHeight
          : trailSource
            ? trailSource.height
            : 16;
      const cellW = Math.max(1, Math.min(trail.cellW, srcW));
      const cellH = Math.max(1, Math.min(trail.cellH, Math.floor(srcH / trail.frames) || 1));
      const frames = Math.max(1, Math.min(trail.frames, Math.floor(srcH / cellH) || 1));
      const startFrame = Math.max(0, Math.min(frames - 1, Math.round(trail.startFrame ?? 0)));
      const usableFrames = Math.max(1, frames - startFrame);
      const c0 = hexToRgb(trail.color);
      const c1 = trail.colorEnd ? hexToRgb(trail.colorEnd) : c0;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = trail.blend === 'add' ? 'lighter' : 'source-over';
      for (let i = 0; i < trailPool.n; i += 1) {
        const age = trailPool.age[i];
        const t = Math.max(0, Math.min(1, age / trailPool.life[i]));
        const scale = trail.scaleStart + (trail.scaleEnd - trail.scaleStart) * t;
        const w = cellW * scale * trailZoom;
        const h = cellH * scale * trailZoom;
        const alpha = Math.max(0, Math.min(1, trail.alphaStart + (trail.alphaEnd - trail.alphaStart) * t));
        if (alpha <= 0 || w < 0.5 || h < 0.5) continue;
        const q = Math.round(t * 8) / 8;
        const color = trail.rainbow
          ? hueHex((Math.floor((trailPool.now * 0.04 + i * 0.02) * 24) / 24) % 1)
          : rgbToHex(
              c0.r + (c1.r - c0.r) * q,
              c0.g + (c1.g - c0.g) * q,
              c0.b + (c1.b - c0.b) * q
            );
        let frameIndex = startFrame;
        if (usableFrames > 1) {
          if (trail.playMode === 'loop') {
            frameIndex = startFrame + (Math.floor((age / 50) * trail.fps) % usableFrames);
          } else if (trail.playMode === 'pingpong') {
            const span = 2 * usableFrames - 2;
            const k = Math.floor(t * span) % span;
            frameIndex = startFrame + (k < usableFrames ? k : span - k);
          } else if (trail.playMode === 'random') {
            frameIndex = Math.min(frames - 1, startFrame + (trailPool.frame0[i] % usableFrames));
          } else {
            frameIndex = startFrame + Math.min(usableFrames - 1, Math.floor(t * usableFrames));
          }
        }
        const sprite = color === '#ffffff' ? source : tintSprite(source, srcW, srcH, color);
        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(trailPool.x[i], trailPool.y[i]);
        ctx.rotate(trailPool.rot[i]);
        ctx.drawImage(
          sprite,
          0,
          frameIndex * cellH,
          cellW,
          cellH,
          -w / 2,
          -h / 2,
          w,
          h
        );
        ctx.restore();
      }
      ctx.restore();
    };

    const stepMissile = () => {
      const anim = activeRolePreviewCfg.anim || 'rotation';
      const numFrames = Math.max(1, activeRolePreviewCfg.frames || 1);
      const userAnimSpeed = activeRolePreviewCfg.animSpeed || 1.0;
      const spinMult = activeRolePreviewCfg.spinRate || 1.0;

      const rad = (flightAngleDeg * Math.PI) / 180;
      const baseVx = Math.cos(rad) * flightSpeed;
      const baseVy = -Math.sin(rad) * flightSpeed;

      if (flightMode === 'arc') {
        animStateRef.current.arcT = (animStateRef.current.arcT + STEP * 0.45) % 1.0;
        const t = animStateRef.current.arcT;
        const padX = 40;
        const peakHeight = 70;
        const normX = (t - 0.5) * 2;
        posX = padX + t * (width - padX * 2);
        posY = height / 2 + 35 - (1 - normX * normX) * peakHeight;
        // Position derivative per 50 Hz frame.
        const dtT = STEP * 0.45;
        vx = (width - padX * 2) * dtT;
        vy = 4 * normX * peakHeight * dtT;
      } else if (flightMode === 'orbit') {
        animStateRef.current.arcT = (animStateRef.current.arcT + STEP * 0.8) % (Math.PI * 2);
        const angle = animStateRef.current.arcT;
        const radius = 55;
        const dAngle = STEP * 0.8;
        posX = width / 2 + Math.cos(angle) * radius;
        posY = height / 2 + Math.sin(angle) * radius;
        vx = -Math.sin(angle) * radius * dAngle;
        vy = Math.cos(angle) * radius * dAngle;
      } else if (flightMode === 'walk') {
        // The roaming animal's own two states, on one loop: it ambles in place
        // (no velocity, WA walks it, so the art has to rest), then hops (up
        // leaning back, down leaning forward). This is what makes `roam` tilt
        // readable in the editor.
        animStateRef.current.arcT = (animStateRef.current.arcT + STEP) % 1.0;
        const u = animStateRef.current.arcT;
        const baseY = height * 0.78;
        const hopStart = 0.55;
        const riding = u >= hopStart ? Math.sin(((u - hopStart) / (1 - hopStart)) * Math.PI) : 0;
        posX = width / 2;
        posY = baseY - riding * (height * 0.46) - (u < hopStart ? Math.abs(Math.sin(u * 14)) * 2 : 0);
        // A hair of vx keeps the facing stable; the hop's own slope is the tilt.
        vx = 0.02;
        vy =
          u < hopStart
            ? 0
            : -Math.cos(((u - hopStart) / (1 - hopStart)) * Math.PI) *
              (height * 0.46) *
              ((Math.PI / (1 - hopStart)) * STEP);
      } else {
        posX = width / 2;
        posY = height / 2;
        vx = baseVx;
        vy = baseVy;
      }

      // Rotation calculation. In static preview mode, smoothly rotate without
      // freezing at 90/270 degrees or strobing at 3000 deg/s.
      if (anim === 'roam') {
        // `M.roam_angle`: on the ground (Walk mode) the art holds `rest` and
        // leans at most `up`/`down` from it while the animal steps; in the air
        // it tracks the velocity exactly like `track`. Everything here is the
        // right-facing pose; the left side is a true mirror at draw time (the
        // sheet's `facing = -1` plus a negated drawn angle, as the builder
        // does). A bare mirror without the negation is a top-to-bottom flip
        // once the walking pose lies flat.
        const tilt = {
          up: Math.abs(missile.roamTilt?.up ?? DEFAULT_ROAM_TILT.up),
          down: Math.abs(missile.roamTilt?.down ?? DEFAULT_ROAM_TILT.down),
          rest: missile.roamTilt?.rest ?? DEFAULT_ROAM_TILT.rest,
        };
        const restRad = (tilt.rest * Math.PI) / 180;
        const up = (tilt.up * Math.PI) / 180;
        const down = (tilt.down * Math.PI) / 180;
        const speed = Math.hypot(vx, vy);
        const grounded = flightMode === 'walk';
        // Keep the side through a straight drop, as `roam_side` does in the
        // builder, instead of snapping back to the right. The builder only
        // mirrors when the role's Mirror toggle is on, so match that too.
        const roamMirrorOn = activeRolePreviewCfg.mirror !== false;
        if (roamMirrorOn) {
          if (vx < 0) roamLeft = true;
          else if (vx > 0) roamLeft = false;
        }
        const hx = roamMirrorOn ? Math.abs(vx) : vx;
        if (!grounded) {
          if (speed >= 0.05) rot = Math.atan2(vy, hx) + Math.PI / 2;
        } else if (speed < 0.05) {
          rot = restRad;
        } else {
          const want = Math.atan2(vy, hx) + Math.PI / 2;
          let delta = want - restRad;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          rot = restRad + Math.min(down, Math.max(-up, delta));
        }
      } else if (anim === 'track') {
        rot = Math.atan2(vy, vx) + Math.PI / 2;
      } else if (flightMode === 'static') {
        const dir = baseVx < 0 ? -1 : 1;
        if (anim === 'rotation') {
          rot += dir * spinMult * 0.08 * Math.max(0.3, flightSpeed / 14);
        } else if (anim === 'slow' || anim === 'medium' || anim === 'fast') {
          rot += dir * (ANIM_SPEED_TABLE[anim] || 0.5) * spinMult * 0.1;
        } else {
          rot = 0;
        }
      } else {
        const signVx = vx > 0 ? 1 : vx < 0 ? -1 : 0;
        const effSignVx = signVx || (activeFlightRole === 'dig' ? 1 : 0);
        const effVx = activeFlightRole === 'dig' && vx === 0 && vy !== 0 ? 0.001 : vx;
        if (anim === 'rotation') {
          rot += spinMult * 0.5 * (effVx * 0.15 + Math.abs(vy) * 0.01 * effSignVx);
        } else if (anim === 'slow' || anim === 'medium' || anim === 'fast') {
          rot += (ANIM_SPEED_TABLE[anim] || 0.5) * spinMult * 0.5 * effSignVx;
        } else {
          rot = 0;
        }
      }

      // `cyclical_frame`: phase += anim_speed * 30 / 1000, wraps at 0.99.
      // PingPong plays 0..n-1 and back over a `2n-2` span, so one pass takes the
      // same time as one loop and the endpoints are not held twice.
      if (numFrames > 1) {
        phase += userAnimSpeed * 30 / 1000;
        if (phase > 0.99) phase = 0;
        if (activeRolePreviewCfg.pingpong) {
          const span = 2 * numFrames - 2;
          const i = Math.floor(phase * span) % span;
          frame = i < numFrames ? i : span - i;
        } else {
          frame = Math.floor(phase * numFrames) % numFrames;
        }
      } else {
        phase = 0;
        frame = 0;
      }

      // Trail emission uses the builder's post-draw anchor: the art offset
      // turns with `drawn`, while the trail nozzle turns with the unmodified
      // world heading. A mirrored roam pose negates both at draw time.
      const mirrorOn = activeRolePreviewCfg.mirror !== false;
      const roamMirror = anim === 'roam' && mirrorOn && roamLeft;
      const facing = anim === 'roam' ? (roamMirror ? -1 : 1) : mirrorOn && vx < 0 ? -1 : 1;
      const angleOffset =
        (((missile.angle ?? 0) * Math.PI) / 180) * (roamMirror || facing < 0 ? -1 : 1);
      const drawRot = roamMirror ? -rot : rot;
      const drawn = drawRot + angleOffset;
      const previewScale = (activeRolePreviewCfg.scale || 1.0) * (missile.size ?? 1);
      let artOx = (missile.offsetX ?? 0) * previewScale;
      const artOy = (missile.offsetY ?? 0) * previewScale;
      if (facing < 0) artOx = -artOx;
      const trailZf = missileZoom / 4;
      const baseX = posX + (artOx * Math.cos(drawn) - artOy * Math.sin(drawn)) * trailZf;
      const baseY = posY + (artOx * Math.sin(drawn) + artOy * Math.cos(drawn)) * trailZf;
      const worldDeg = ((roamMirror ? -rot : rot) * 180) / Math.PI;
      stepTrail(baseX, baseY, worldDeg, facing);

      animStateRef.current.rotation = rot;
      animStateRef.current.phase = phase;
      animStateRef.current.frame = frame;
      animStateRef.current.roamLeft = roamLeft;
      animStateRef.current.drumTime = (animStateRef.current.drumTime + STEP) % 1.0;
    };

    const renderMissile = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const liveCanvas = missileCanvasRef.current;
      if (!liveCanvas) {
        animationFrameId = requestAnimationFrame(renderMissile);
        return;
      }
      const ctx = liveCanvas.getContext('2d');
      if (!ctx) {
        animationFrameId = requestAnimationFrame(renderMissile);
        return;
      }

      if (!started) {
        started = true;
        stepMissile();
      } else if (isMissilePlaying) {
        accumulator += dt;
        // A stalled tab can accumulate seconds; cap the catch-up so the
        // preview does not spin through hundreds of frames at once.
        let steps = 0;
        while (accumulator >= STEP && steps < 8) {
          stepMissile();
          accumulator -= STEP;
          steps++;
        }
        if (steps === 8) accumulator = 0;
      }

      if (frame !== lastFrameDisplay) {
        lastFrameDisplay = frame;
        setActiveFrameDisplay(frame);
      }

      const anim = activeRolePreviewCfg.anim || 'rotation';
      const numFrames = Math.max(1, activeRolePreviewCfg.frames || 1);
      const scaleMult = (activeRolePreviewCfg.scale || 1.0) * (missile.size ?? 1);
      const mirror = activeRolePreviewCfg.mirror !== false;
      // `anim = roam` walks left as a true horizontal mirror: the sheet is
      // mirrored (`facing = -1`) and the whole drawn angle is negated. A bare
      // mirror, or a bare angle turn, is a top-to-bottom flip once the walk
      // lies flat. This is exactly the builder's `roam_side` pose.
      const roamAnim = anim === 'roam';
      const roamMirror = roamAnim && mirror && roamLeft;
      const facing = roamAnim ? (roamMirror ? -1 : 1) : mirror && vx < 0 ? -1 : 1;
      // `angle` is added to the drawn rotation, negated on a mirrored sheet (or
      // on a left-mirrored roam pose), as the builder does it.
      const angleOffset =
        (((missile.angle ?? 0) * Math.PI) / 180) * (roamMirror || facing < 0 ? -1 : 1);
      const drawRot = roamMirror ? -rot : rot;

      // DRAW CANVAS
      ctx.clearRect(0, 0, width, height);

      // Background theme
      if (backdropTheme === 'sky') {
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#0284c7');
        grad.addColorStop(1, '#38bdf8');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      } else if (backdropTheme === 'cavern') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, width, height);
      } else {
        // Checkerboard
        const tileSize = 10;
        for (let x = 0; x < width; x += tileSize) {
          for (let y = 0; y < height; y += tileSize) {
            ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? '#1e293b' : '#0f172a';
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
      }

      // Draw faint trajectory guide in arc mode
      if (flightMode === 'arc') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const padX = 40;
        for (let step = 0; step <= 30; step++) {
          const st = step / 30;
          const sx = padX + st * (width - padX * 2);
          const sNormX = (st - 0.5) * 2;
          const sy = height / 2 + 35 - (1 - sNormX * sNormX) * 70;
          if (step === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw simulated velocity vector arrow when in static mode
      if (flightMode === 'static') {
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(posX, posY);
        ctx.lineTo(posX + vx * 2.5, posY + vy * 2.5);
        ctx.stroke();
        ctx.restore();
      }

      // Animated oil drum scale reference (`spec/oildrum1.png`, 20 frames @ 20 fps,
      // 90x90 cells with visible body at x=33..56, y=24..59) drawn at 1:1 WA scale
      // (`zoom / 4`) in the bottom-right corner so projectile size/scale is clear.
      if (
        showDrumRef &&
        oildrumLoadedImg &&
        oildrumLoadedImg.complete &&
        oildrumLoadedImg.naturalWidth > 0
      ) {
        const drumFrames = 20;
        const cellW = oildrumLoadedImg.naturalWidth;
        const cellH = oildrumLoadedImg.naturalHeight / drumFrames;
        const drumFrame = Math.floor(animStateRef.current.drumTime * 20) % drumFrames;
        const drumScale = missileZoom / 4;
        const dx = Math.round(width - 10 - 57 * drumScale);
        const dy = Math.round(height - 16 - 60 * drumScale);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          oildrumLoadedImg,
          0,
          drumFrame * cellH,
          cellW,
          cellH,
          dx,
          dy,
          cellW * drumScale,
          cellH * drumScale
        );
        ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
        ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('oildrum 1×', width - 8, height - 5);
        ctx.restore();
      }

      // BEHIND and EFFECTS both sit under the missile body; only FRONT paints
      // its brush over the art, matching the brush depth the exporter writes.
      if (trail && trail.depth !== 'FRONT') drawTrail(ctx);

      // Draw Missile Sprite
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(posX, posY);
      ctx.rotate(drawRot + angleOffset);

      // `b.facing = mirror and (m.vx < 0 and -1 or 1) or 1`; a roam pose uses
      // its remembered side instead (`roamMirror`).
      const zoom = missileZoom;
      ctx.scale(facing * scaleMult * (zoom / 4), scaleMult * (zoom / 4));
      // `offset` is in sheet pixels and already scaled by the builder, so a
      // translate inside the scaled frame is the same nudge, and `facing`
      // mirrors it exactly as the game does.
      const offsetX = missile.offsetX ?? 0;
      const offsetY = missile.offsetY ?? 0;
      if (offsetX || offsetY) ctx.translate(offsetX, offsetY);

      const activeImg =
        activeFlightRole === 'primary'
          ? missileImgRef.current
          : roleLoadedImg || roleImgRef.current;

      if (activeImg && activeImg.complete && activeImg.naturalWidth > 0) {
        // PX sheets are vertical strips of frames.
        const frameHeight = activeImg.naturalHeight / numFrames;
        const frameWidth = activeImg.naturalWidth;
        const sy = frame * frameHeight;

        ctx.drawImage(
          activeImg,
          0,
          sy,
          frameWidth,
          frameHeight,
          -frameWidth / 2,
          -frameHeight / 2,
          frameWidth,
          frameHeight
        );
      } else if (
        (activeFlightRole === 'primary' ||
          (activeFlightRole === 'clusters' && bitFlight.mode === 'inherit') ||
          (activeFlightRole === 'homing' && homingRole.mode === 'inherit') ||
          (activeFlightRole === 'homing_bit' &&
            homingBitRole.mode === 'inherit' &&
            bitFlight.mode === 'inherit') ||
          (activeFlightRole === 'roam' && roamRoleMode === 'builder') ||
          (activeFlightRole === 'dig' &&
            digRoleMode !== 'native' &&
            (!digBitEnabled || digMainEnabled || bitFlight.mode === 'inherit'))) &&
        defaultMissileLoaded &&
        defaultMissileLoaded.complete &&
        defaultMissileLoaded.naturalWidth > 0
      ) {
        ctx.drawImage(
          defaultMissileLoaded,
          -defaultMissileLoaded.naturalWidth / 2,
          -defaultMissileLoaded.naturalHeight / 2
        );
      } else {
        // Fallback stylized procedural missile art tailored per role
        renderProceduralMissile(ctx, anim, frame, activeFlightRole);
      }

      ctx.restore();

      if (trail && trail.depth === 'FRONT') drawTrail(ctx);

      animationFrameId = requestAnimationFrame(renderMissile);
    };

    animationFrameId = requestAnimationFrame(renderMissile);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    missile,
    bitFlight,
    homingRole,
    homingBitRole,
    digRole,
    digRoleMode,
    digMainEnabled,
    digBitEnabled,
    activeFlightRole,
    builderOn,
    roamRoleMode,
    roamRole.sheetPreview,
    roamRole.anim,
    roamRole.frames,
    roamRole.animSpeed,
    roamRole.spinRate,
    roamRole.scale,
    roamRole.mirror,
    roamRole.z,
    project.roamSheets?.flight1?.frames,
    project.roamSheets?.flight1?.preview,
    roleLoadedImg,
    trailLoadedImg,
    previewTrailKey,
    isMissilePlaying,
    missileZoom,
    flightAngleDeg,
    flightSpeed,
    flightMode,
    backdropTheme,
    defaultMissileLoaded,
    showDrumRef,
    oildrumLoadedImg,
  ]);

  // Fallback high-contrast pixelated missile graphic per role
  const renderProceduralMissile = (
    ctx: CanvasRenderingContext2D,
    animType: MissileAnimType,
    frame: number,
    role: FlightSlotRole
  ) => {
    if (role === 'homing') {
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = frame % 2 === 0 ? '#60a5fa' : '#93c5fd';
      ctx.beginPath();
      ctx.arc(0, 8, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'homing_bit') {
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(4.5, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(-4.5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#312e81';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = frame % 2 === 0 ? '#a5b4fc' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(0, 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'clusters') {
      ctx.fillStyle = '#9333ea';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 7.5, Math.PI / 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6b21a8';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(-1.5, -2, 2.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'roam') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(-3, -2);
      ctx.lineTo(-11, 9);
      ctx.lineTo(-1, 6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#f5f5f4';
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.arc(5, -3, 3.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (role === 'dig') {
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(6.5, 0);
      ctx.lineTo(4.5, 10);
      ctx.lineTo(-4.5, 10);
      ctx.lineTo(-6.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#9a3412';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.strokeStyle = frame % 2 === 0 ? '#fde047' : '#fed7aa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(4, -7);
      ctx.moveTo(-5, 2);
      ctx.lineTo(5, -1);
      ctx.stroke();
      return;
    }

    // PX sheets point up natively; the fallback art does too so the preview
    // shows the same rotation the engine will apply.
    if (animType === 'rotation') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 11, Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#eab308';
      ctx.fillRect(-2, -14, 4, 4);

      ctx.fillStyle = '#fca5a5';
      ctx.fillRect(-2, -6, 3, 6);
    } else if (animType === 'track') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 4);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = frame % 2 === 0 ? '#38bdf8' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-4, -12, 8, 24);
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 1;
      ctx.strokeRect(-4, -12, 8, 24);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(-2, -9, 4, 4);
      ctx.fillRect(-2, 5, 4, 4);
    }
  };

  // ---------------------------------------------------------------------------
  // HANDLERS FOR UPLOADING CUSTOM ASSETS
  // ---------------------------------------------------------------------------
  const applyHoldSheetFile = async (file: File, framesHint?: number) => {
    const previewUrl = URL.createObjectURL(file);
    // The aim layer draws a quad of the sheet's pixel cell,
    // so keep the natural size beside the file.
    let sheetWidth: number | undefined;
    let sheetHeight: number | undefined;
    try {
      const px = await imagePixelSize(previewUrl);
      sheetWidth = px.width;
      sheetHeight = px.height;
    } catch {
      // The preview will show whatever the browser can draw; the size falls
      // back to the stock art's, like an imported project.
    }
    updateHold({
      enabled: true,
      sheetFile: file,
      sheetPreview: previewUrl,
      sheetWidth,
      sheetHeight,
      ...(framesHint && framesHint > 0
        ? { frames: framesHint, animate: framesHint > 1, sheetFrames: undefined }
        : {}),
      // The path is worked out when the pack is exported, from the id the
      // weapon has THEN. Baking it in here kept an old id (moon_grenade)
      // after a rename.
      sheet: '',
    });
  };

  const handleUploadSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so the same file picked again (another tab, after a remove)
    // still fires `change`.
    e.target.value = '';
    if (!file) return;
    await applyHoldSheetFile(file);
  };

  const removeCustomSheet = () => {
    if (hold.sheetPreview) URL.revokeObjectURL(hold.sheetPreview);
    setWeaponLoadedImg(null);
    updateHold({
      sheetFile: undefined,
      sheetPreview: undefined,
      sheetWidth: undefined,
      sheetHeight: undefined,
      sheet: '',
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const applyFlashFile = async (file: File, framesHint?: number) => {
    const previewUrl = URL.createObjectURL(file);
    let flashWidth: number | undefined;
    let flashHeight: number | undefined;
    try {
      const px = await imagePixelSize(previewUrl);
      flashWidth = px.width;
      flashHeight = px.height;
    } catch {
      // The browser still draws it; the cell just falls back to square.
    }
    // The engine's own strip rule (`gfx::load_strip_bytes`): a vertical PNG
    // whose height divides by its width is that many square cells, which is how
    // a 36x72 upload becomes two 36x36 firing frames. Reading it here means the
    // panel shows the frames the game will actually play.
    const autoFrames =
      framesHint && framesHint > 0
        ? framesHint
        : flashWidth && flashHeight && flashHeight > flashWidth && flashHeight % flashWidth === 0
          ? flashHeight / flashWidth
          : 1;
    updateHold({
      enabled: true,
      flashFile: file,
      flashPreview: previewUrl,
      flashWidth,
      flashHeight,
      // A new firing sheet starts with its own copy of the aim placement, so
      // the role is independent from the moment it exists.
      fireWeapRadius: hold.fireWeapRadius ?? hold.weapRadius ?? 6,
      fireWeapRotation: hold.fireWeapRotation ?? hold.weapRotation ?? 0,
      fireScale: hold.fireScale ?? hold.scale ?? 1,
      fireOffsetX: hold.fireOffsetX ?? hold.offsetX ?? 0,
      fireOffsetY: hold.fireOffsetY ?? hold.offsetY ?? 0,
      fireHandRadius: hold.fireHandRadius ?? hold.handRadius ?? 10,
      fireHandRotation: hold.fireHandRotation ?? hold.handRotation ?? 0,
      fireHandScale: hold.fireHandScale ?? hold.handScale ?? 1,
      fireHandOffsetX: hold.fireHandOffsetX ?? hold.handOffsetX ?? 0,
      fireHandOffsetY: hold.fireHandOffsetY ?? hold.handOffsetY ?? 0,
      fireFrames: autoFrames,
      fireFps: hold.fireFps ?? 15,
      // One whole strip cycle, in 50 Hz ticks, so the animation is visible from
      // the first shot (WA's own firing frames are only two).
      fireTicks: Math.max(
        2,
        Math.ceil((autoFrames * 50) / (hold.fireFps ?? 15)),
      ),
      // A firing sheet is a pose of the gun, not a decal on top of it: the held
      // art is hidden while it plays unless the author says otherwise.
      fireHideMain: hold.fireHideMain ?? true,
    });
  };

  const handleUploadFlash = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so the same file picked again (another tab, after a remove)
    // still fires `change`.
    e.target.value = '';
    if (!file) return;
    await applyFlashFile(file);
  };

  const removeFlash = () => {
    if (hold.flashPreview) URL.revokeObjectURL(hold.flashPreview);
    setFlashLoadedImg(null);
    updateHold({
      flashFile: undefined,
      flashPreview: undefined,
      flashWidth: undefined,
      flashHeight: undefined,
    });
    if (flashFileInputRef.current) flashFileInputRef.current.value = '';
  };

  const applyBufferFile = async (file: File, framesHint?: number) => {
    const previewUrl = URL.createObjectURL(file);
    let bufferWidth: number | undefined;
    let bufferHeight: number | undefined;
    try {
      const px = await imagePixelSize(previewUrl);
      bufferWidth = px.width;
      bufferHeight = px.height;
    } catch {
      // Browser still draws it; cell falls back to square.
    }
    const autoFrames =
      framesHint && framesHint > 0
        ? framesHint
        : bufferWidth && bufferHeight && bufferHeight > bufferWidth && bufferHeight % bufferWidth === 0
          ? bufferHeight / bufferWidth
          : 1;
    updateHold({
      enabled: true,
      bufferFile: file,
      bufferPreview: previewUrl,
      bufferWidth,
      bufferHeight,
      bufferWeapRadius: hold.bufferWeapRadius ?? hold.weapRadius ?? 6,
      bufferWeapRotation: hold.bufferWeapRotation ?? hold.weapRotation ?? 0,
      bufferScale: hold.bufferScale ?? hold.scale ?? 1,
      bufferOffsetX: hold.bufferOffsetX ?? hold.offsetX ?? 0,
      bufferOffsetY: hold.bufferOffsetY ?? hold.offsetY ?? 0,
      bufferHandRadius: hold.bufferHandRadius ?? hold.handRadius ?? 10,
      bufferHandRotation: hold.bufferHandRotation ?? hold.handRotation ?? 0,
      bufferHandScale: hold.bufferHandScale ?? hold.handScale ?? 1,
      bufferHandOffsetX: hold.bufferHandOffsetX ?? hold.handOffsetX ?? 0,
      bufferHandOffsetY: hold.bufferHandOffsetY ?? hold.handOffsetY ?? 0,
      bufferFrames: autoFrames,
      bufferFps: hold.bufferFps ?? 15,
      bufferHideMain: hold.bufferHideMain ?? true,
    });
  };

  const handleUploadBuffer = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await applyBufferFile(file);
  };

  const removeBuffer = () => {
    if (hold.bufferPreview) URL.revokeObjectURL(hold.bufferPreview);
    setBufferLoadedImg(null);
    updateHold({
      bufferFile: undefined,
      bufferPreview: undefined,
      bufferWidth: undefined,
      bufferHeight: undefined,
    });
    if (bufferFileInputRef.current) bufferFileInputRef.current.value = '';
  };

  const applyExtraHandFile = async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    let sheetWidth: number | undefined;
    let sheetHeight: number | undefined;
    try {
      const px = await imagePixelSize(previewUrl);
      sheetWidth = px.width;
      sheetHeight = px.height;
    } catch {
      // The browser still draws it; the quad layer falls back to 60 px.
    }
    updateExtraHand({ enabled: true, file, preview: previewUrl, sheetWidth, sheetHeight });
  };

  const handleUploadExtraHand = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await applyExtraHandFile(file);
  };

  const removeExtraHandSheet = () => {
    if (extraHand?.preview) URL.revokeObjectURL(extraHand.preview);
    updateExtraHand({ file: undefined, preview: undefined, sheetWidth: undefined, sheetHeight: undefined });
    if (extraHandFileInputRef.current) extraHandFileInputRef.current.value = '';
  };

  const applyMissileSheetFile = (file: File, framesHint?: number) => {
    const previewUrl = URL.createObjectURL(file);
    updateMissile({
      enabled: true,
      mode: 'custom',
      sheetFile: file,
      sheetPreview: previewUrl,
      ...(framesHint && framesHint > 0 ? { frames: framesHint, animate: framesHint > 1 } : {}),
      sheet: '',   // worked out at export, as for the hold sheet
    });
  };

  const handleUploadMissileSheet = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so the same file picked again (another tab, after a remove)
    // still fires `change`.
    e.target.value = '';
    if (!file) return;
    applyMissileSheetFile(file);
  };

  const removeCustomMissileSheet = () => {
    if (missile.sheetPreview) URL.revokeObjectURL(missile.sheetPreview);
    updateMissile({
      sheetFile: undefined,
      sheetPreview: undefined,
      sheet: '',
    });
    if (missileFileInputRef.current) missileFileInputRef.current.value = '';
  };

  const applyRoleSheetFile = (file: File, framesHint?: number) => {
    const previewUrl = URL.createObjectURL(file);
    const framePatch = framesHint && framesHint > 0 ? { frames: framesHint } : {};
    if (activeFlightRole === 'clusters') {
      if (bitFlight.sheetPreview) URL.revokeObjectURL(bitFlight.sheetPreview);
      updateBitFlight({ sheetFile: file, sheetPreview: previewUrl, mode: 'builder', ...framePatch });
    } else if (activeFlightRole === 'homing') {
      if (homingRole.sheetPreview) URL.revokeObjectURL(homingRole.sheetPreview);
      updateBehaviorArt('homing', { sheetFile: file, sheetPreview: previewUrl, mode: 'builder', ...framePatch });
    } else if (activeFlightRole === 'homing_bit') {
      if (homingBitRole.sheetPreview) URL.revokeObjectURL(homingBitRole.sheetPreview);
      updateBehaviorArt('homing_bit', { sheetFile: file, sheetPreview: previewUrl, mode: 'builder', ...framePatch });
    } else if (activeFlightRole === 'roam') {
      if (roamRole.sheetPreview) URL.revokeObjectURL(roamRole.sheetPreview);
      updateBehaviorArt('roam', { sheetFile: file, sheetPreview: previewUrl, mode: 'builder', ...framePatch });
    }
  };

  const handleUploadRoleSheet = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so the same file picked again (another tab, after a remove)
    // still fires `change`.
    e.target.value = '';
    if (!file) return;
    applyRoleSheetFile(file);
  };

  const removeCustomRoleSheet = () => {
    if (activeFlightRole === 'clusters') {
      if (bitFlight.sheetPreview) URL.revokeObjectURL(bitFlight.sheetPreview);
      updateBitFlight({ sheetFile: undefined, sheetPreview: undefined, mode: 'native' });
    } else if (activeFlightRole === 'homing') {
      if (homingRole.sheetPreview) URL.revokeObjectURL(homingRole.sheetPreview);
      updateBehaviorArt('homing', { sheetFile: undefined, sheetPreview: undefined, mode: 'native' });
    } else if (activeFlightRole === 'homing_bit') {
      if (homingBitRole.sheetPreview) URL.revokeObjectURL(homingBitRole.sheetPreview);
      updateBehaviorArt('homing_bit', { sheetFile: undefined, sheetPreview: undefined, mode: 'native' });
    } else if (activeFlightRole === 'roam') {
      if (roamRole.sheetPreview) URL.revokeObjectURL(roamRole.sheetPreview);
      // Back to the round's own sheet: the roam role only exists when it owns art.
      updateBehaviorArt('roam', { sheetFile: undefined, sheetPreview: undefined, mode: 'inherit' });
    }
    if (roleFileInputRef.current) roleFileInputRef.current.value = '';
  };

  // Accurate `sb.flight` Lua preview matching `luaGenerator.ts`
  const roleRowsForPreview = (r: FlightRoleArt, indent: string) => {
    const out: string[] = [`${indent}anim = "${r.anim || 'rotation'}",`];
    if ((r.frames || 1) > 1) out.push(`${indent}cyclical = ${r.frames},`);
    if (r.pingpong && (r.frames || 1) > 1) out.push(`${indent}pingpong = true,`);
    if (r.animSpeed && r.animSpeed !== 1) out.push(`${indent}anim_speed = ${r.animSpeed},`);
    if (r.spinRate && r.spinRate !== 1) out.push(`${indent}spin = ${r.spinRate},`);
    if (r.scale && r.scale !== 1) out.push(`${indent}scale = ${r.scale},`);
    if (r.mirror === false) out.push(`${indent}mirror = false,`);
    if (r.z !== undefined && r.z !== 5) out.push(`${indent}z = ${r.z},`);
    return out;
  };

  const homingBuilderOn =
    builderOn && hasPrimaryHoming && (behaviorArt.homing?.mode ?? 'native') === 'builder';
  const bitHomingBuilderOn =
    builderOn &&
    bitBuilderMode(project) === 'builder' &&
    hasBitHoming &&
    (behaviorArt.homing_bit?.mode ?? 'native') === 'builder';
  const digActiveInBuilder =
    builderOn &&
    digRoleMode !== 'native' &&
    (digMainEnabled || (digBitEnabled && bitBuilderMode(project) !== null));

  const sbFlightLuaPreview = (() => {
    if (isAirStrike) {
      return `-- Air strikes use native strike munitions (no sb.flight path).\n-- Configure the body sprite in Pack Art / Record Editor.`;
    }
    const modLines: string[] = [
      `-- inside install, after wa.weapons.replace{ ... }`,
      `sb.flight(ctx, {`,
      `  weapon = ctx.id,`,
      `  sheet = "${missileFlightSheetPath(project)}",`,
      `  anim = "${missile.anim || 'rotation'}",`,
    ];
    if ((missile.frames || 1) > 1) modLines.push(`  cyclical = ${missile.frames},`);
    if (missile.pingpong && (missile.frames || 1) > 1) modLines.push(`  pingpong = true,`);
    if (missile.animSpeed && missile.animSpeed !== 1) modLines.push(`  anim_speed = ${missile.animSpeed},`);
    if (missile.spinRate && missile.spinRate !== 1) modLines.push(`  spin = ${missile.spinRate},`);
    if (missile.scale && missile.scale !== 1) modLines.push(`  scale = ${missile.scale},`);
    if (missile.mirror === false) modLines.push(`  mirror = false,`);
    if (missile.z !== undefined && missile.z !== 5) modLines.push(`  z = ${missile.z},`);
    if (missile.size !== undefined && missile.size !== 1) modLines.push(`  size = ${missile.size},`);
    if (missile.angle) modLines.push(`  angle = ${missile.angle},`);
    if (missile.offsetX || missile.offsetY) {
      modLines.push(`  offset = { x = ${missile.offsetX ?? 0}, y = ${missile.offsetY ?? 0} },`);
    }
    if (missile.trail?.enabled) {
      modLines.push(
        ...flightTrailRows(missile.trail, flightTrailSheetPath(project, 'main'), '  '),
      );
    }

    if (clustersEnabled && bitFlight.mode === 'builder') {
      modLines.push(`  bits = {`);
      modLines.push(`    sheet = "${bitFlightSheetPath(project)}",`);
      modLines.push(...roleRowsForPreview(bitFlight, '    '));
      if (bitFlight.trail?.enabled) {
        modLines.push(...flightTrailRows(bitFlight.trail, flightTrailSheetPath(project, 'bit'), '    '));
      }
      if (bitHomingBuilderOn && behaviorArt.homing_bit) {
        modLines.push(`    homing = {`);
        modLines.push(`      sheet = "${behaviorStateSheetPath(project, 'homing_bit')}",`);
        modLines.push(
          `      arm = ${project.body.clustlet.homing_arm_ms ?? 0}, time = ${project.body.clustlet.homing_time_ms ?? 0},`,
        );
        modLines.push(...roleRowsForPreview(behaviorArt.homing_bit, '      '));
        if (behaviorArt.homing_bit.trail?.enabled) {
          modLines.push(
            ...flightTrailRows(
              behaviorArt.homing_bit.trail,
              flightTrailSheetPath(project, 'homing_bit'),
              '      ',
            ),
          );
        }
        modLines.push(`    },`);
      }
      modLines.push(`  },`);
    } else if (clustersEnabled && bitFlight.mode === 'inherit') {
      if (bitHomingBuilderOn || bitFlight.trail?.enabled) {
        modLines.push(`  bits = {`);
        modLines.push(`    sheet = "${missileFlightSheetPath(project)}",`);
        modLines.push(...roleRowsForPreview(missile as unknown as FlightRoleArt, '    '));
        if (bitFlight.trail?.enabled) {
          modLines.push(
            ...flightTrailRows(bitFlight.trail, flightTrailSheetPath(project, 'bit'), '    '),
          );
        }
        if (bitHomingBuilderOn && behaviorArt.homing_bit) {
          modLines.push(`    homing = {`);
          modLines.push(`      sheet = "${behaviorStateSheetPath(project, 'homing_bit')}",`);
          modLines.push(
            `      arm = ${project.body.clustlet.homing_arm_ms ?? 0}, time = ${project.body.clustlet.homing_time_ms ?? 0},`,
          );
          modLines.push(...roleRowsForPreview(behaviorArt.homing_bit, '      '));
          if (behaviorArt.homing_bit.trail?.enabled) {
            modLines.push(
              ...flightTrailRows(
                behaviorArt.homing_bit.trail,
                flightTrailSheetPath(project, 'homing_bit'),
                '      ',
              ),
            );
          }
          modLines.push(`    },`);
        }
        modLines.push(`  },`);
      } else {
        modLines.push(`  bits = "inherit",`);
      }
    }

    if (homingBuilderOn && behaviorArt.homing) {
      modLines.push(`  homing = {`);
      modLines.push(`    sheet = "${behaviorStateSheetPath(project, 'homing')}",`);
      modLines.push(
        `    arm = ${project.body.homing_arm_ms ?? 0}, time = ${project.body.homing_time_ms ?? 0},`,
      );
      modLines.push(...roleRowsForPreview(behaviorArt.homing, '    '));
      if (behaviorArt.homing.trail?.enabled) {
        modLines.push(
          ...flightTrailRows(
            behaviorArt.homing.trail,
            flightTrailSheetPath(project, 'homing'),
            '    ',
          ),
        );
      }
      modLines.push(`  },`);
    }

    if (digActiveInBuilder) {
      const digRows = digArtOverrideRows(project.behaviorArt?.dig, '    ');
      if (project.behaviorArt?.dig?.trail?.enabled) {
        digRows.push(
          ...flightTrailRows(
            project.behaviorArt.dig.trail,
            flightTrailSheetPath(project, 'dig'),
            '    ',
          ),
        );
      }
      if (digRows.length > 0) {
        modLines.push(`  dig = {`);
        modLines.push(...digRows);
        modLines.push(`  },`);
      } else {
        modLines.push(`  dig = true,`);
      }
    }
    if (roamEnabled) {
      // The pose the generator writes: the override, else the baseline's sprite.
      const roamWalkPose = roamWalkPoseId(
        recordField(project, 'missile.sprite', project.body.sprite),
      );
      if (roamRoleMode === 'builder') {
        modLines.push(`  roam = {`);
        modLines.push(`    sheet = "${behaviorStateSheetPath(project, 'roam')}",`);
        modLines.push(...roleRowsForPreview(roamRole, '    '));
        if (roamRole.trail?.enabled) {
          modLines.push(
            ...flightTrailRows(roamRole.trail, flightTrailSheetPath(project, 'roam'), '    '),
          );
        }
        modLines.push(
          roamWalkPose !== 0
            ? `    walk = ${roamWalkPose}, fly = ${ROAM_FLY_SENTINEL},`
            : `    fly = ${ROAM_FLY_SENTINEL},`,
        );
        modLines.push(`  },`);
      } else {
        modLines.push(
          roamWalkPose !== 0
            ? `  roam = { walk = ${roamWalkPose}, fly = ${ROAM_FLY_SENTINEL} },`
            : `  roam = true,`,
        );
      }
    }
    if (isTakeoverMissile) modLines.push(`  is_bit = air.is_bit,`);
    if (project.missileSprite?.logIdentity) modLines.push(`  log = true,`);
    modLines.push(`})`);
    return modLines.join('\n');
  })();

  const handleCopySbLua = async () => {
    try {
      await navigator.clipboard.writeText(sbFlightLuaPreview);
      setCopiedSbLua(true);
      setTimeout(() => setCopiedSbLua(false), 1800);
    } catch {
      // Fallback if clipboard API is unavailable
    }
  };

  return (
    <div className="space-y-8">
      {/* ======================================================================= */}
      {/* 1. WORM HOLD & AIM POSTURE SECTION                                       */}
      {/* ======================================================================= */}
      {(() => {
        const wormEnabled = !!project.wormSprites?.enabled;
        const activeLayerLabel =
          hold.enabled && wormEnabled
            ? 'Sprite Builder + worm_sprites Combined'
            : wormEnabled
              ? 'Full Worm Sheets (worm_sprites)'
              : 'Native aim.png & hand_rad Assets';
        const showWormPanel = postureTab === 'wormSprites';
        return (
          <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900 transition-colors">
            {/* Header + Independent Layer Toggles + View Tabs */}
            <div className="border-b border-stone-200/80 bg-stone-50/70 px-5 py-3.5 dark:border-stone-800 dark:bg-stone-950/50 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h2 className="font-heading text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                    Worm Aim &amp; Hold Art Builder
                  </h2>
                  <span className="text-[11px] font-mono text-forge-600 dark:text-forge-400">
                    · {activeLayerLabel}
                  </span>
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  Combine Sprite Builder held overlays and direct <code className="font-mono">worm_sprites</code> pose sheets together or use either layer on its own.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex rounded-lg border border-stone-200 bg-stone-100/90 p-0.5 dark:border-stone-700 dark:bg-stone-900"
                  role="tablist"
                  aria-label="Worm posture editor tabs"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!showWormPanel}
                    onClick={() => setPostureTab('hold')}
                    className={`cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      !showWormPanel
                        ? 'bg-white text-stone-900 font-semibold shadow-xs ring-1 ring-forge-500/35 dark:bg-stone-800 dark:text-white'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200'
                    }`}
                  >
                    Sprite Builder (Overlay)
                    {hold.enabled && (
                      <span className="ml-1 font-mono text-[10px] text-forge-600 dark:text-forge-400">
                        · on
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={showWormPanel}
                    onClick={() => setPostureTab('wormSprites')}
                    className={`cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      showWormPanel
                        ? 'bg-white text-stone-900 font-semibold shadow-xs ring-1 ring-forge-500/35 dark:bg-stone-800 dark:text-white'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200'
                    }`}
                  >
                    Worm Pose Sheets (<span className="font-mono">worm_sprites</span>)
                    {wormEnabled && (
                      <span className="ml-1 font-mono text-[10px] text-forge-600 dark:text-forge-400">
                        · on
                      </span>
                    )}
                  </button>
                </div>

                <label
                  htmlFor="hold-enable-custom-art"
                  className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${
                    hold.enabled
                      ? 'border-forge-400/70 bg-forge-50/70 dark:border-forge-600/60 dark:bg-forge-950/35'
                      : 'border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800'
                  }`}
                >
                  <input
                    id="hold-enable-custom-art"
                    type="checkbox"
                    checked={hold.enabled}
                    onChange={(e) => updateHold({ enabled: e.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span className="whitespace-nowrap text-xs font-medium text-stone-800 dark:text-stone-100">
                    Enable Sprite Builder
                  </span>
                </label>

                <label
                  htmlFor="worm-sprites-enable"
                  className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${
                    wormEnabled
                      ? 'border-forge-400/70 bg-forge-50/70 dark:border-forge-600/60 dark:bg-forge-950/35'
                      : 'border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800'
                  }`}
                >
                  <input
                    id="worm-sprites-enable"
                    type="checkbox"
                    checked={wormEnabled}
                    onChange={(e) =>
                      onChange({
                        wormSprites: {
                          ...(project.wormSprites ?? { poses: {} }),
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                  />
                  <span className="whitespace-nowrap text-xs font-medium text-stone-800 dark:text-stone-100">
                    Enable Worm Pose Sheets
                  </span>
                </label>
              </div>
            </div>

            <div className="p-5">
            {showWormPanel ? (
              <WormSpritesPanel project={project} onChange={onChange} />
            ) : (
              <>

        {/* Aim / Firing builder tabs. The canvas below is shared: it shows the
            held art while aiming and the firing sheet on Test fire. */}
        <div
          className="mb-4 inline-flex flex-wrap rounded-lg border border-stone-200 bg-stone-100/90 p-0.5 dark:border-stone-700 dark:bg-stone-950/60"
          role="tablist"
          aria-label="Held art builder"
        >
          {(
            [
              { id: 'aim' as const, label: 'Aim & Swing', hint: 'The held weapon, its offset, the hand and the Space clip' },
              ...(showBufferTab
                ? [
                    {
                      id: 'buffer' as const,
                      label: 'While Buffering',
                      hint: 'Charge / wind-up sprite played during initial buffer before beam or sequenced shot release',
                    },
                  ]
                : []),
              { id: 'firing' as const, label: 'Firing Frames', hint: "WA's 0x6A/0x6B frames & beam/burst firing strip" },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={aimTab === tab.id}
              aria-controls={`hold-tab-${tab.id}`}
              id={`hold-tab-${tab.id}-button`}
              title={tab.hint}
              onClick={() => setAimTab(tab.id)}
              className={`cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                aimTab === tab.id
                  ? 'bg-white text-stone-900 font-semibold shadow-xs ring-1 ring-forge-500/35 dark:bg-stone-800 dark:text-white'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              {tab.label}
              {tab.id === 'buffer' && hold.bufferFile ? (
                <span className="ml-1 font-mono text-[10px] text-amber-600 dark:text-amber-400">
                  · {bufferStripFrames}f
                </span>
              ) : null}
              {tab.id === 'firing' && hold.flashFile ? (
                <span className="ml-1 font-mono text-[10px] text-forge-600 dark:text-forge-400">
                  · {fireStripFrames}f
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* The role grid. Each tab is a complete role of its own, the way
            the flight builder gives every sprite role the same full control
            set: its sheet, its animation, its hand and its own placement. The
            canvas in the middle is shared, the columns swap with the tab. */}
        <div
          role="tabpanel"
          id={`hold-tab-${aimTab}`}
          aria-labelledby={`hold-tab-${aimTab}-button`}
        >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr_1.9fr] gap-4 items-start">
          {/* LEFT COLUMN: this role's hand (order-3 on mobile, order-1 on lg) */}
          <div className="order-3 lg:order-1 flex flex-col gap-4">
            {/* Draw Hand and Hand Type. The hand is one art, so the type is
                shared; each role decides whether its own sheet shows a hand. */}
            <div className="grid grid-cols-2 gap-3 items-end">
              {aimTab === 'aim' ? (
                <label
                  htmlFor="hold-draw-hand"
                  title="WA draws the hand in its aiming states only, so the held art needs it."
                  className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
                >
                  <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                    Draw Hand
                  </span>
                  <input
                    id="hold-draw-hand"
                    type="checkbox"
                    checked={hold.drawHand !== false}
                    onChange={(e) => updateHold({ drawHand: e.target.checked })}
                    className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                  />
                </label>
              ) : aimTab === 'buffer' ? (
                <label
                  htmlFor="hold-buffer-draw-hand"
                  title="Show the hand while buffering/charging, or hide it for this sheet only. Unset follows the aiming hand."
                  className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
                >
                  <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                    Draw Hand
                  </span>
                  <input
                    id="hold-buffer-draw-hand"
                    type="checkbox"
                    checked={(hold.bufferDrawHand ?? hold.drawHand) !== false}
                    onChange={(e) => updateHold({ bufferDrawHand: e.target.checked })}
                    className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                  />
                </label>
              ) : (
                <label
                  htmlFor="hold-fire-draw-hand"
                  title="Show the hand on the firing frames, or hide it for this sheet only. Unset follows the aiming hand."
                  className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
                >
                  <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                    Draw Hand
                  </span>
                  <input
                    id="hold-fire-draw-hand"
                    type="checkbox"
                    checked={(hold.fireDrawHand ?? hold.drawHand) !== false}
                    onChange={(e) => updateHold({ fireDrawHand: e.target.checked })}
                    className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                  />
                </label>
              )}

              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                  Hand Type
                </span>
                <button
                  type="button"
                  onClick={cycleHandType}
                  aria-label={`Hand type: ${currentHandTypeLabel}. Click to change`}
                  title={`Hand type: ${currentHandTypeLabel}. Click to change`}
                  className="h-10 px-3 flex items-center justify-center text-xs font-semibold rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors shadow-2xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-500"
                >
                  {currentHandTypeLabel}
                </button>
              </div>
            </div>

            {aimTab === 'aim' ? (
              <>
            <HoldDial
              id="hold-hand-scale"
              label="Hand Scale"
              value={hold.handScale ?? 1}
              onChange={(value) => updateHold({ handScale: value })}
              min={0.5}
              max={2}
              step={0.05}
              unit="x"
              title="Multiplies the hand's own cell, independently of the weapon."
            />

            <HoldDial
              id="hold-hand-radius"
              label="Hand Radius"
              value={hold.handRadius ?? 10}
              onChange={(value) => updateHold({ handRadius: value })}
              min={-35}
              max={35}
              step={1}
              unit="px"
              title="Distance of the hand from the worm's centre, along its own radial (rot_h). Negative puts it on the other side."
            />

            <HoldDial
              id="hold-hand-rotation"
              label="Hand Rotation"
              value={hold.handRotation ?? 0}
              onChange={(value) => updateHold({ handRotation: value })}
              min={-180}
              max={180}
              step={5}
              unit="°"
              title="Extra hand rotation, on top of the engine's half turn (hand_rotation = 1 + degrees/180). The hand turns about its own centre, so a hand piece drawn at an angle can be squared up."
            />

            {/* Hand offset: one thought, two knobs, so they share a line. */}
            <div
              className="space-y-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 p-3"
              title="Moves the hand art inside its own cell, in sheet pixels: positive Y is down the sheet, positive X to the sheet's right. Scaled with hand scale and mirrored with the side. The engine's hold has no hand offset, so a non-zero one hands the aim poses to the WFWS quad layer."
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-stone-700 dark:text-stone-300">Hand Offset</span>
                <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                  {(hold.handOffsetX ?? 0)}, {hold.handOffsetY ?? 0} px
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <HoldDial
                  id="hold-hand-offset-x"
                  label="X"
                  value={hold.handOffsetX ?? 0}
                  onChange={(value) => updateHold({ handOffsetX: value })}
                  min={-32}
                  max={32}
                  step={1}
                />
                <HoldDial
                  id="hold-hand-offset-y"
                  label="Y"
                  value={hold.handOffsetY ?? 0}
                  onChange={(value) => updateHold({ handOffsetY: value })}
                  min={-32}
                  max={32}
                  step={1}
                />
              </div>
            </div>

            {/* The aim clamp. WA's own bat pipes its aim for the same reason:
                straight up and straight down are where a held weapon looks
                worst, and a pack can't pipe the WA sweep, only its own draw. */}
            <div className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                  title="Keep the aim inside this many degrees either side of level. Straight up and straight down are where a held weapon looks worst: the art leaves its cell and a cut aimed vertically reads as noise, which is why WA pipes its own bat's aim. worm.aim_target is read-only, but worm:input{ aim } writes the same target WA's aim control writes, so the crosshair, the drawn pose, a swing, a melee strike and WA's own fire vector all stop at the limit (WA adds at most one of its own aim steps, 1.4 degrees, after the write)."
                >
                  Aim Clamp
                </span>
                <label
                  htmlFor="hold-aim-clamp"
                  className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-300"
                >
                  <input
                    id="hold-aim-clamp"
                    type="checkbox"
                    checked={!!hold.aimClamp?.enabled}
                    onChange={(event) =>
                      updateHold({
                        aimClamp: {
                          up: hold.aimClamp?.up ?? 60,
                          down: hold.aimClamp?.down ?? 60,
                          enabled: event.target.checked,
                        },
                      })
                    }
                    className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                  />
                  Limit
                </label>
              </div>
              {hold.aimClamp?.enabled && (
                <>
                  <p className="text-[10px] text-stone-500 dark:text-stone-400">
                    aim{' '}
                    <span className="font-mono">
                      {Math.round((0.5 - hold.aimClamp.down / 180) * 31)}..{Math.round((0.5 + hold.aimClamp.up / 180) * 31)}
                    </span>{' '}
                    of 31, level is 16
                  </p>
                  {/* Stacked, not side by side: a `HoldDial`'s number cell is
                      92px, so two of them in one row leave nothing for the
                      labels and "Up"/"Down" truncate away. */}
                  <div className="space-y-2">
                    <HoldDial
                      id="hold-aim-clamp-up"
                      label="Up"
                      value={hold.aimClamp.up}
                      onChange={(value) => updateHold({ aimClamp: { ...hold.aimClamp!, up: value } })}
                      min={0}
                      max={90}
                      step={5}
                      unit="°"
                      title="How far above level the pose may go, in degrees (90 is straight up, 0 holds it at level)."
                    />
                    <HoldDial
                      id="hold-aim-clamp-down"
                      label="Down"
                      value={hold.aimClamp.down}
                      onChange={(value) => updateHold({ aimClamp: { ...hold.aimClamp!, down: value } })}
                      min={0}
                      max={90}
                      step={5}
                      unit="°"
                      title="How far below level the pose may go, in degrees (90 is straight down, 0 holds it at level)."
                    />
                  </div>
                </>
              )}
            </div>

            {/* The second hand. `HoldSpec` has one hand slot, so the aim layer
                draws it with the engine's own hand maths. */}
            <div className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                  title="A support hand on the grip. The engine has one hand slot, so the aim layer draws this one with the same maths; with no art of its own it reuses the hand above. Drawing it turns on custom held art."
                >
                  Second Hand
                </span>
                <label
                  htmlFor="hold-extra-hand-enable"
                  className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-300"
                >
                  <input
                    id="hold-extra-hand-enable"
                    type="checkbox"
                    checked={!!extraHand?.enabled}
                    onChange={(event) => updateExtraHand({ enabled: event.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                  />
                  Draw
                </label>
              </div>
              {extraHand?.enabled && (
                <>
                  <HoldDial
                    id="hold-extra-hand-radius"
                    label="Second Hand Radius"
                    value={extraHand.radius}
                    onChange={(value) => updateExtraHand({ radius: value })}
                    min={-35}
                    max={35}
                    step={1}
                    unit="px"
                    title="How far from the worm the hand sits along the aim, the same slider the first hand has. Negative puts it on the other side."
                  />
                  <HoldDial
                    id="hold-extra-hand-rotation"
                    label="Second Hand Rotation"
                    value={extraHand.rotation}
                    onChange={(value) => updateExtraHand({ rotation: value })}
                    min={-180}
                    max={180}
                    step={1}
                    unit="deg"
                    title="Extra turn on top of the hand's own half turn, so a mirrored or upside-down hand sheet can be lined up."
                  />
                  <HoldDial
                    id="hold-extra-hand-scale"
                    label="Second Hand Scale"
                    value={extraHand.scale}
                    onChange={(value) => updateExtraHand({ scale: value })}
                    min={0.5}
                    max={2}
                    step={0.05}
                    unit="x"
                    title="The second hand's own cell size, the same rule the first hand uses, so two hands at 1x are the same size."
                  />
                  <div
                    className="space-y-1.5 border-t border-stone-200 pt-2 dark:border-stone-700"
                    title="Moves the second hand inside its own cell, in sheet pixels: positive Y is down the sheet, positive X to the sheet's right. Scaled with the second hand scale and mirrored with the side."
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-stone-700 dark:text-stone-300">
                        Second Hand Offset
                      </span>
                      <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                        {extraHand.offsetX}, {extraHand.offsetY} px
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <HoldDial
                        id="hold-extra-hand-offset-x"
                        label="X"
                        value={extraHand.offsetX}
                        onChange={(value) => updateExtraHand({ offsetX: value })}
                        min={-32}
                        max={32}
                        step={1}
                      />
                      <HoldDial
                        id="hold-extra-hand-offset-y"
                        label="Y"
                        value={extraHand.offsetY}
                        onChange={(value) => updateExtraHand({ offsetY: value })}
                        min={-32}
                        max={32}
                        step={1}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <input
                      ref={extraHandFileInputRef}
                      type="file"
                      accept="image/png,image/gif"
                      onChange={handleUploadExtraHand}
                      className="hidden"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => extraHandFileInputRef.current?.click()}
                        className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-800 shadow-2xs transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                      >
                        <Upload className="h-3 w-3 text-forge-600 dark:text-forge-400" />
                        {extraHand.file ? 'Change PNG' : 'Upload Hand PNG'}
                      </button>
                      <SpritePickButton
                        accept="image"
                        label="Pick Support Hand Sprite"
                        onPick={(file) => void applyExtraHandFile(file)}
                      />
                    </div>
                    {extraHand.preview && (
                      <button
                        type="button"
                        onClick={removeExtraHandSheet}
                        className="text-[11px] font-medium text-rose-500 hover:text-rose-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
              </>
            ) : aimTab === 'buffer' ? (
              <>
                <HoldDial
                  id="hold-buffer-hand-scale"
                  label="Buffer Hand Scale"
                  value={hold.bufferHandScale ?? hold.handScale ?? 1}
                  onChange={(value) => updateHold({ bufferHandScale: value })}
                  min={0.5}
                  max={2}
                  step={0.05}
                  unit="x"
                  title="Multiplies the hand's cell while buffering."
                />
                <HoldDial
                  id="hold-buffer-hand-radius"
                  label="Buffer Hand Radius"
                  value={hold.bufferHandRadius ?? hold.handRadius ?? 10}
                  onChange={(value) => updateHold({ bufferHandRadius: value })}
                  min={-35}
                  max={35}
                  step={1}
                  unit="px"
                  title="The hand's distance from the worm's centre while buffering."
                />
                <HoldDial
                  id="hold-buffer-hand-rotation"
                  label="Buffer Hand Rotation"
                  value={hold.bufferHandRotation ?? hold.handRotation ?? 0}
                  onChange={(value) => updateHold({ bufferHandRotation: value })}
                  min={-180}
                  max={180}
                  step={5}
                  unit="°"
                  title="Extra hand rotation while buffering."
                />

                <div
                  className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
                  title="Moves the hand art inside its own cell while buffering."
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700 dark:text-stone-300">
                      Hand Offset
                    </span>
                    <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                      {(hold.bufferHandOffsetX ?? 0)}, {hold.bufferHandOffsetY ?? 0} px
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <HoldDial
                      id="hold-buffer-hand-offset-x"
                      label="X"
                      value={hold.bufferHandOffsetX ?? 0}
                      onChange={(value) => updateHold({ bufferHandOffsetX: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                    <HoldDial
                      id="hold-buffer-hand-offset-y"
                      label="Y"
                      value={hold.bufferHandOffsetY ?? 0}
                      onChange={(value) => updateHold({ bufferHandOffsetY: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                  </div>
                  <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                    Unset values follow the aiming hand so charge animations align cleanly.
                  </p>
                </div>
              </>
            ) : (
              <>
                <HoldDial
                  id="hold-fire-hand-scale"
                  label="Firing Hand Scale"
                  value={hold.fireHandScale ?? hold.handScale ?? 1}
                  onChange={(value) => updateHold({ fireHandScale: value })}
                  min={0.5}
                  max={2}
                  step={0.05}
                  unit="x"
                  title="Multiplies the hand's own cell on the firing frames."
                />
                <HoldDial
                  id="hold-fire-hand-radius"
                  label="Firing Hand Radius"
                  value={hold.fireHandRadius ?? hold.handRadius ?? 10}
                  onChange={(value) => updateHold({ fireHandRadius: value })}
                  min={-35}
                  max={35}
                  step={1}
                  unit="px"
                  title="The hand's distance from the worm's centre on the firing frames, along its own radial. The firing role draws it exactly as the engine does."
                />
                <HoldDial
                  id="hold-fire-hand-rotation"
                  label="Firing Hand Rotation"
                  value={hold.fireHandRotation ?? hold.handRotation ?? 0}
                  onChange={(value) => updateHold({ fireHandRotation: value })}
                  min={-180}
                  max={180}
                  step={5}
                  unit="°"
                  title="Extra hand rotation on the firing frames, on top of the engine's half turn."
                />

                {/* The same two knobs the held hand has, in the same place. */}
                <div
                  className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
                  title="Moves the hand art inside its own cell on the firing frames, in sheet pixels: positive Y is down the sheet, positive X to the sheet's right. Scaled with the firing hand scale and mirrored with the side."
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700 dark:text-stone-300">
                      Hand Offset
                    </span>
                    <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                      {(hold.fireHandOffsetX ?? 0)}, {hold.fireHandOffsetY ?? 0} px
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <HoldDial
                      id="hold-fire-hand-offset-x"
                      label="X"
                      value={hold.fireHandOffsetX ?? 0}
                      onChange={(value) => updateHold({ fireHandOffsetX: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                    <HoldDial
                      id="hold-fire-hand-offset-y"
                      label="Y"
                      value={hold.fireHandOffsetY ?? 0}
                      onChange={(value) => updateHold({ fireHandOffsetY: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                  </div>
                  <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                    Unset values follow the aiming hand, so a sheet whose grip sits differently
                    lines up without moving the aiming pose.
                  </p>
                </div>

                {/* The second hand on the firing frames: its own grip, the way
                    the firing hand has one. Unset numbers inherit the aim grip. */}
                <div className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                      Second Hand
                    </span>
                    <label
                      htmlFor="hold-fire-extra-hand-draw"
                      title="Draw the support hand on the firing frames. It travels with the firing pose, using the grip below."
                      className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-300"
                    >
                      <input
                        id="hold-fire-extra-hand-draw"
                        type="checkbox"
                        checked={hold.extraHand?.fireDraw !== false}
                        disabled={!hold.extraHand?.enabled}
                        onChange={(event) => updateExtraHand({ fireDraw: event.target.checked })}
                        className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500 disabled:opacity-40"
                      />
                      Show
                    </label>
                  </div>
                  {hold.extraHand?.enabled ? (
                    <>
                      <HoldDial
                        id="hold-fire-extra-hand-radius"
                        label="Second Hand Radius"
                        value={hold.extraHand.fireRadius ?? hold.extraHand.radius ?? 10}
                        onChange={(value) => updateExtraHand({ fireRadius: value })}
                        min={-35}
                        max={35}
                        step={1}
                        unit="px"
                        title="The support hand's distance from the worm on the firing frames. Touching this pins a firing value; it starts as the aiming radius."
                      />
                      <HoldDial
                        id="hold-fire-extra-hand-rotation"
                        label="Second Hand Rotation"
                        value={hold.extraHand.fireRotation ?? hold.extraHand.rotation ?? 0}
                        onChange={(value) => updateExtraHand({ fireRotation: value })}
                        min={-180}
                        max={180}
                        step={1}
                        unit="deg"
                      />
                      <HoldDial
                        id="hold-fire-extra-hand-scale"
                        label="Second Hand Scale"
                        value={hold.extraHand.fireScale ?? hold.extraHand.scale ?? 1}
                        onChange={(value) => updateExtraHand({ fireScale: value })}
                        min={0.5}
                        max={2}
                        step={0.05}
                        unit="x"
                      />
                      <div
                        className="space-y-1.5 border-t border-stone-200 pt-2 dark:border-stone-700"
                        title="Moves the support hand inside its own cell on the firing frames, in sheet pixels."
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-stone-700 dark:text-stone-300">
                            Second Hand Offset
                          </span>
                          <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                            {hold.extraHand.fireOffsetX ?? hold.extraHand.offsetX ?? 0},{' '}
                            {hold.extraHand.fireOffsetY ?? hold.extraHand.offsetY ?? 0} px
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <HoldDial
                            id="hold-fire-extra-hand-offset-x"
                            label="X"
                            value={hold.extraHand.fireOffsetX ?? hold.extraHand.offsetX ?? 0}
                            onChange={(value) => updateExtraHand({ fireOffsetX: value })}
                            min={-32}
                            max={32}
                            step={1}
                          />
                          <HoldDial
                            id="hold-fire-extra-hand-offset-y"
                            label="Y"
                            value={hold.extraHand.fireOffsetY ?? hold.extraHand.offsetY ?? 0}
                            onChange={(value) => updateExtraHand({ fireOffsetY: value })}
                            min={-32}
                            max={32}
                            step={1}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateExtraHand({
                            fireRadius: undefined,
                            fireRotation: undefined,
                            fireScale: undefined,
                            fireOffsetX: undefined,
                            fireOffsetY: undefined,
                          })
                        }
                        title="Clear the firing grip so the support hand follows the aiming numbers again"
                        className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                      >
                        Follow the aiming grip
                      </button>
                    </>
                  ) : (
                    <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                      Turn on the second hand on the Aim &amp; Swing tab first. Its art is shared
                      between the two roles; only the grip differs.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          {/* CENTER COLUMN: Canvas + Posture + Flip (order-1 on mobile, order-2 on lg) */}
          <div className="order-1 lg:order-2 flex flex-col items-center gap-3 w-full">
            {/* 600x600 Pixel-Perfect Canvas Viewport */}
            <div className="relative w-full max-w-[600px] aspect-square border-2 border-stone-800 rounded-xl overflow-hidden shadow-lg bg-stone-950">
              <canvas
                ref={canvasRef}
                width={600}
                height={600}
                className="block w-full h-full cursor-crosshair"
                style={{ imageRendering: 'pixelated' }}
              />

              <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/70 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                <span>Aim Angle: {aimAngleIndex}/31</span>
                <span>·</span>
                <span>{aimAngleIndex === 16 ? 'Horizontal' : aimAngleIndex < 16 ? 'Down' : 'Up'}</span>
              </div>

              {/* The Space press, next to the thing it moves. The real key
                  works too; this is the button for a touch screen. The firing
                  role has no clip, so the pill belongs to the aim tab only. */}
              <button
                type="button"
                hidden={aimTab !== 'aim'}
                onClick={triggerSwing}
                disabled={!playerClip.enabled}
                aria-label="Press Space: play the swing clip in the preview"
                title={
                  playerClip.enabled
                    ? 'Play the swing clip (the same thing Space does in game)'
                    : 'Turn on Swing on Space below to play a clip'
                }
                className="absolute bottom-2 left-2 flex cursor-pointer items-center gap-1.5 rounded border border-white/15 bg-black/70 px-2 py-1 font-mono text-[10px] font-semibold text-stone-200 backdrop-blur-xs hover:bg-black/85 disabled:opacity-40"
              >
                <RotateCw className={`h-3 w-3 ${swingStart !== null ? 'animate-spin' : ''}`} />
                SPACE
              </button>

              {/* Zoom: the scene is laid out at 2x, so 100% is the framing below
                  and the percentages are relative to it. */}
              <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded border border-white/10 bg-black/70 p-0.5 backdrop-blur-xs">
                <button
                  type="button"
                  aria-label="Zoom aiming preview out"
                  title="Zoom out (25% steps)"
                  disabled={aimZoom <= AIM_ZOOM_MIN}
                  onClick={() =>
                    setAimZoom((z) => Math.max(AIM_ZOOM_MIN, Math.round((z - AIM_ZOOM_STEP) * 100) / 100))
                  }
                  className="cursor-pointer rounded p-1 text-stone-300 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Reset aiming preview zoom"
                  title="Reset to the default framing"
                  onClick={() => setAimZoom(1)}
                  className="min-w-[44px] cursor-pointer rounded px-1 py-0.5 font-mono text-[10px] font-semibold text-stone-200 hover:bg-white/10 hover:text-white"
                >
                  {Math.round(aimZoom * 100)}%
                </button>
                <button
                  type="button"
                  aria-label="Zoom aiming preview in"
                  title="Zoom in (25% steps)"
                  disabled={aimZoom >= AIM_ZOOM_MAX}
                  onClick={() =>
                    setAimZoom((z) => Math.min(AIM_ZOOM_MAX, Math.round((z + AIM_ZOOM_STEP) * 100) / 100))
                  }
                  className="cursor-pointer rounded p-1 text-stone-300 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Worm Posture Card (0 to 31) */}
            <div className="w-full max-w-[600px] space-y-1.5 bg-stone-50 dark:bg-stone-800/50 p-3 rounded-lg border border-stone-200 dark:border-stone-800">
              <div className="flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-300">
                <label htmlFor="hold-aim-angle" className="font-semibold">
                  Worm Posture (0–31)
                </label>
                <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">{aimAngleIndex}</span>
              </div>
              <input
                id="hold-aim-angle"
                type="range"
                min={0}
                max={31}
                step={1}
                value={aimAngleIndex}
                onChange={(e) => setAimAngleIndex(Number(e.target.value))}
                className="w-full accent-forge-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-stone-400 font-mono">
                <span>0 (Down)</span>
                <span>16 (Level)</span>
                <span>31 (Up)</span>
              </div>
            </div>

            {/* Preview Fire & Flip Buttons */}
            <div className="w-full max-w-[600px] flex gap-2">
              <button
                type="button"
                onClick={() => setFireDemoTick(0)}
                title={`Play both Sprite Builder firing animation and WA weaponfire* (~4 frames on WA, ${fireDemoDuration} ticks total)`}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border shadow-2xs transition-colors cursor-pointer ${
                  fireDemoTick !== null
                    ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    : 'border-amber-300 bg-amber-50/70 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/60'
                }`}
              >
                <Flame className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Preview Fire</span>
              </button>
              <button
                type="button"
                onClick={() => setFacingRight(!facingRight)}
                aria-label={`Flip worm facing direction. Currently facing ${facingRight ? 'Right' : 'Left'}`}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 shadow-2xs transition-colors cursor-pointer"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Flip ({facingRight ? 'Right' : 'Left'})</span>
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN: this role's art and placement (order-2 on mobile,
              order-3 on lg) */}
          <div className="order-2 lg:order-3 flex flex-col gap-4">
          {/* RIGHT COLUMN: this role's sheet, animation and placement
              (order-2 on mobile, order-3 on lg). Both tabs run the same four
              blocks in the same order, the way the flight builder gives every
              sprite role one complete control set. */}
          <div className="order-2 lg:order-3 flex flex-col gap-4">
            {/* 1. The role's own sheet. One upload row, swapped with the tab. */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-stone-200 bg-stone-50/70 px-3.5 py-2 dark:border-stone-800 dark:bg-stone-800/40">
              <div className="flex min-w-0 items-center gap-2">
                <Upload className="h-4 w-4 shrink-0 text-forge-600 dark:text-forge-400" />
                <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-stone-900 dark:text-stone-100">
                  {aimTab === 'firing'
                    ? 'Firing Sprite Sheet'
                    : aimTab === 'buffer'
                      ? 'Buffering Sprite Sheet'
                      : 'Held Sprite Sheet'}
                </span>
                {aimTab === 'firing' ? (
                  hold.flashFile ? (
                    <span
                      className="truncate font-mono text-xs font-medium text-forge-600 dark:text-forge-400"
                      title={`${hold.flashFile.name} (${(hold.flashFile.size / 1024).toFixed(1)} KB)`}
                    >
                      {hold.flashFile.name}
                    </span>
                  ) : (
                    <span className="truncate text-xs text-stone-500 dark:text-stone-400">
                      None: the held art keeps drawing on those frames
                    </span>
                  )
                ) : aimTab === 'buffer' ? (
                  hold.bufferFile ? (
                    <span
                      className="truncate font-mono text-xs font-medium text-amber-600 dark:text-amber-400"
                      title={`${hold.bufferFile.name} (${(hold.bufferFile.size / 1024).toFixed(1)} KB)`}
                    >
                      {hold.bufferFile.name}
                    </span>
                  ) : (
                    <span className="truncate text-xs text-stone-500 dark:text-stone-400">
                      None: the aiming art stays up during charge/buffer
                    </span>
                  )
                ) : hold.sheetFile ? (
                  <span
                    className="truncate font-mono text-xs font-medium text-forge-600 dark:text-forge-400"
                    title={`${hold.sheetFile.name} (${(hold.sheetFile.size / 1024).toFixed(1)} KB)`}
                  >
                    {hold.sheetFile.name}
                  </span>
                ) : (
                  <span
                    className="truncate text-xs text-stone-500 dark:text-stone-400"
                    title={`Using default ${defaultArt.label} art`}
                  >
                    Using default {defaultArt.label} art
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {aimTab === 'firing' && (
                  <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                    {fireStripFrames > 1
                      ? `${fireStripFrames} x ${fireCellWidth}x${fireCellHeight} px`
                      : 'one frame'}
                  </span>
                )}
                {aimTab === 'buffer' && (
                  <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                    {bufferStripFrames > 1
                      ? `${bufferStripFrames} x ${bufferCellWidth}x${bufferCellHeight} px`
                      : 'one frame'}
                  </span>
                )}
                <input
                  key={aimTab === 'firing' ? 'flash-file' : aimTab === 'buffer' ? 'buffer-file' : 'sheet-file'}
                  ref={
                    aimTab === 'firing'
                      ? flashFileInputRef
                      : aimTab === 'buffer'
                        ? bufferFileInputRef
                        : fileInputRef
                  }
                  type="file"
                  accept="image/png,image/gif"
                  onChange={
                    aimTab === 'firing'
                      ? handleUploadFlash
                      : aimTab === 'buffer'
                        ? handleUploadBuffer
                        : handleUploadSheet
                  }
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() =>
                    (aimTab === 'firing'
                      ? flashFileInputRef
                      : aimTab === 'buffer'
                        ? bufferFileInputRef
                        : fileInputRef
                    ).current?.click()
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 shadow-2xs transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                >
                  <Upload className="h-3.5 w-3.5 text-forge-600 dark:text-forge-400" />
                  {aimTab === 'firing'
                    ? hold.flashFile
                      ? 'Change PNG'
                      : 'Upload PNG'
                    : aimTab === 'buffer'
                      ? hold.bufferFile
                        ? 'Change PNG'
                        : 'Upload PNG'
                      : hold.sheetFile
                        ? 'Change PNG Sheet'
                        : 'Upload PNG'}
                </button>
                <SpritePickButton
                  accept="image"
                  label={
                    aimTab === 'firing'
                      ? 'Pick Firing Sheet'
                      : aimTab === 'buffer'
                        ? 'Pick Buffer Sheet'
                        : 'Pick Hold Sheet'
                  }
                  onPick={(file, framesHint) =>
                    aimTab === 'firing'
                      ? void applyFlashFile(file, framesHint)
                      : aimTab === 'buffer'
                        ? void applyBufferFile(file, framesHint)
                        : void applyHoldSheetFile(file, framesHint)
                  }
                />
                {aimTab === 'firing' && hold.flashPreview && (
                  <button
                    type="button"
                    onClick={removeFlash}
                    className="text-xs font-medium text-rose-500 hover:text-rose-600"
                  >
                    Remove
                  </button>
                )}
                {aimTab === 'buffer' && hold.bufferPreview && (
                  <button
                    type="button"
                    onClick={removeBuffer}
                    className="text-xs font-medium text-rose-500 hover:text-rose-600"
                  >
                    Remove
                  </button>
                )}
                {aimTab === 'aim' && hold.sheetPreview && (
                  <button
                    type="button"
                    onClick={removeCustomSheet}
                    className="text-xs font-medium text-rose-500 hover:text-rose-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* 2. Its strip and rate. */}
            <div className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/30">
              <div className="text-center">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
                  {aimTab === 'firing'
                    ? 'Firing Animation'
                    : aimTab === 'buffer'
                      ? 'Buffering Animation'
                      : 'Hold Animation'}
                </span>
              </div>
              {aimTab === 'firing' ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1 text-center">
                    <label
                      htmlFor="hold-fire-frames"
                      className="block text-xs font-medium text-stone-600 dark:text-stone-400"
                    >
                      Total Frames
                    </label>
                    <NumberInput
                      id="hold-fire-frames"
                      min={1}
                      max={32}
                      value={fireStripFrames}
                      title="Frames in the firing sheet. The height is sliced by this number, exactly as the engine does at load: a 36x72 upload is two 36x36 frames."
                      onChange={(e) =>
                        updateHold({
                          fireFrames: Math.min(32, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                      className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1 text-center">
                    <label
                      htmlFor="hold-fire-fps"
                      className="block text-xs font-medium text-stone-600 dark:text-stone-400"
                      title="Frames per second for the firing strip. The export converts it to anim_speed = fps / (1.5 x frames)."
                    >
                      FPS
                    </label>
                    <NumberInput
                      id="hold-fire-fps"
                      min={1}
                      max={30}
                      value={fireFps}
                      title="Frames per second for the firing strip. The export converts it to anim_speed = fps / (1.5 x frames)."
                      onChange={(e) =>
                        updateHold({
                          fireFps: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                      className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1 text-center">
                    <span className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                      Current
                    </span>
                    <div className="w-full rounded-lg border border-stone-200 bg-stone-100 px-2 py-1.5 text-center font-mono text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                      {firePreviewFrame + 1} / {fireStripFrames}
                    </div>
                  </div>
                </div>
              ) : aimTab === 'buffer' ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1 text-center">
                    <label
                      htmlFor="hold-buffer-frames"
                      className="block text-xs font-medium text-stone-600 dark:text-stone-400"
                    >
                      Total Frames
                    </label>
                    <NumberInput
                      id="hold-buffer-frames"
                      min={1}
                      max={32}
                      value={bufferStripFrames}
                      title="Frames in the buffering/wind-up sheet."
                      onChange={(e) =>
                        updateHold({
                          bufferFrames: Math.min(32, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                      className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1 text-center">
                    <label
                      htmlFor="hold-buffer-fps"
                      className="block text-xs font-medium text-stone-600 dark:text-stone-400"
                      title="Frames per second for the buffering strip."
                    >
                      FPS
                    </label>
                    <NumberInput
                      id="hold-buffer-fps"
                      min={1}
                      max={30}
                      value={bufferFps}
                      title="Frames per second for the buffering strip."
                      onChange={(e) =>
                        updateHold({
                          bufferFps: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                      className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1 text-center">
                    <span className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                      Current
                    </span>
                    <div className="w-full rounded-lg border border-stone-200 bg-stone-100 px-2 py-1.5 text-center font-mono text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                      {bufferPreviewFrame + 1} / {bufferStripFrames}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1 text-center">
                    <label
                      htmlFor="hold-total-frames"
                      className="block text-xs font-medium text-stone-600 dark:text-stone-400"
                    >
                      Total Frames
                    </label>
                    <NumberInput
                      id="hold-total-frames"
                      min={1}
                      max={64}
                      value={hold.frames}
                      onChange={(e) => updateHold({ frames: Math.max(1, Number(e.target.value)) })}
                      className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1 text-center">
                    <label
                      htmlFor="hold-fps"
                      className="block text-xs font-medium text-stone-600 dark:text-stone-400"
                      title="In-game FPS: the engine advances 1.5 × frames × anim_speed frames per second"
                    >
                      FPS
                    </label>
                    <NumberInput
                      id="hold-fps"
                      min={1}
                      max={60}
                      value={hold.fps}
                      title="In-game FPS: the engine advances 1.5 × frames × anim_speed frames per second"
                      onChange={(e) => updateHold({ fps: Math.max(1, Number(e.target.value)) })}
                      className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                    />
                  </div>
                  <div className="space-y-1 text-center">
                    <span className="block text-xs font-medium text-stone-600 dark:text-stone-400">
                      Current
                    </span>
                    <div className="w-full rounded-lg border border-stone-200 bg-stone-100 px-2 py-1.5 text-center font-mono text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                      {currentFrame + 1} / {Math.max(1, hold.frames)}
                    </div>
                  </div>
                </div>
              )}
              {aimTab === 'firing' ? (
                <SheetFrameWarning
                  preview={hold.flashPreview}
                  width={hold.flashWidth}
                  height={hold.flashHeight}
                  frames={fireStripFrames}
                />
              ) : aimTab === 'buffer' ? (
                <SheetFrameWarning
                  preview={hold.bufferPreview}
                  width={hold.bufferWidth}
                  height={hold.bufferHeight}
                  frames={bufferStripFrames}
                />
              ) : (
                <SheetFrameWarning
                  preview={hold.sheetPreview}
                  width={hold.sheetWidth}
                  height={hold.sheetHeight}
                  frames={hold.sheetFrames ?? hold.frames}
                />
              )}
              {aimTab === 'aim' && (hold.sheetFrames ?? 1) > (hold.frames ?? 1) && (
                <p className="text-[10px] leading-relaxed text-stone-500 dark:text-stone-400">
                  The picture holds {hold.sheetFrames} cells and this hold plays{' '}
                  {hold.frames === 1 ? 'frame 0 of them' : `the first ${hold.frames}`}: the engine
                  slices the strip by the manifest&apos;s {hold.sheetFrames} and only indexes it
                  with the frame count here.
                </p>
              )}
            </div>

            {/* 3. Its placement: radius, rotation, scale. */}
            {aimTab === 'firing' ? (
              <>
                <HoldDial
                  id="hold-fire-radius"
                  label="Firing Radius"
                  value={hold.fireWeapRadius ?? hold.weapRadius ?? 6}
                  onChange={(value) => updateHold({ fireWeapRadius: value })}
                  min={-35}
                  max={35}
                  step={1}
                  unit="px"
                  title="Distance of the firing sheet from the worm's centre on WA's firing frames, along the aiming radial."
                />
                <HoldDial
                  id="hold-fire-rotation"
                  label="Firing Rotation"
                  value={hold.fireWeapRotation ?? hold.weapRotation ?? 0}
                  onChange={(value) => updateHold({ fireWeapRotation: value })}
                  min={-180}
                  max={180}
                  step={5}
                  unit="°"
                  title="Rotation of the firing sheet about its own centre, measured like the aiming rotation."
                />
                <HoldDial
                  id="hold-fire-scale"
                  label="Firing Scale"
                  value={hold.fireScale ?? hold.scale ?? 1}
                  onChange={(value) => updateHold({ fireScale: value })}
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  unit="x"
                  title="Scales the firing sheet, the role's own multiplier on top of the sheet's cell."
                />
              </>
            ) : aimTab === 'buffer' ? (
              <>
                <HoldDial
                  id="hold-buffer-radius"
                  label="Buffer Radius"
                  value={hold.bufferWeapRadius ?? hold.weapRadius ?? 6}
                  onChange={(value) => updateHold({ bufferWeapRadius: value })}
                  min={-35}
                  max={35}
                  step={1}
                  unit="px"
                  title="Distance of the buffering sheet from the worm's centre during charge/wind-up."
                />
                <HoldDial
                  id="hold-buffer-rotation"
                  label="Buffer Rotation"
                  value={hold.bufferWeapRotation ?? hold.weapRotation ?? 0}
                  onChange={(value) => updateHold({ bufferWeapRotation: value })}
                  min={-180}
                  max={180}
                  step={5}
                  unit="°"
                  title="Rotation of the buffering sheet about its own centre."
                />
                <HoldDial
                  id="hold-buffer-scale"
                  label="Buffer Scale"
                  value={hold.bufferScale ?? hold.scale ?? 1}
                  onChange={(value) => updateHold({ bufferScale: value })}
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  unit="x"
                  title="Scales the buffering sheet."
                />
              </>
            ) : (
              <>
                <HoldDial
                  id="hold-weap-radius"
                  label="Weapon Radius"
                  value={hold.weapRadius ?? 6}
                  onChange={(value) => updateHold({ weapRadius: value })}
                  min={-35}
                  max={35}
                  step={1}
                  unit="px"
                  title="Distance of the held art from the worm's centre, along the aim radial (rot_w). This is the number the engine's HoldSpec measures."
                />
                <HoldDial
                  id="hold-weap-rotation"
                  label="Weapon Rotation"
                  value={hold.weapRotation ?? 0}
                  onChange={(value) => updateHold({ weapRotation: value })}
                  min={-180}
                  max={180}
                  step={5}
                  unit="°"
                  title="Rotation of the held art about its own centre, on top of the aim angle. Art drawn pointing up is level at 0."
                />
                <HoldDial
                  id="hold-weap-radial"
                  label="Radial Offset"
                  value={hold.weapRadialRotation ?? 1}
                  onChange={(value) => updateHold({ weapRadialRotation: value })}
                  min={-1}
                  max={1}
                  step={0.01}
                  unit="π"
                  title="Where around the worm the art hangs, in turns of PI: the engine places it at rot + PI*weap_radial_rotation. 1 is the usual shoulder position, 0 the opposite side, so a port that ships 0 with a negative Weapon Radius keeps the art on the same side. Written as weap_radial_rotation."
                />
                <HoldDial
                  id="hold-hand-radial"
                  label="Hand Radial"
                  value={hold.handRadialRotation ?? 1}
                  onChange={(value) => updateHold({ handRadialRotation: value })}
                  min={-1}
                  max={1}
                  step={0.01}
                  unit="π"
                  title="The hand's own radial position: rot - PI*hand_radial_rotation. 1 is the engine's default, 0 puts the hand on the other side. Written as hand_radial_rotation."
                />
                <HoldDial
                  id="hold-scale"
                  label="Scale Multiplier"
                  value={hold.scale ?? 1}
                  onChange={(value) => updateHold({ scale: value })}
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  unit="x"
                  title="Scales the held art. The export writes it as weap_scale."
                />
              </>
            )}

            {/* 4. Its offset: the same channel in all roles, so art whose
                centre isn't its grip lines up at every aim. */}
            <div
              className="space-y-1.5 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800"
              title="Moves the art inside its own cell, in sheet pixels: positive Y is down the sheet, positive X to the sheet's right. Scaled with the role's own scale and mirrored with the side, so art whose grip isn't its centre lines up with the hand at every aim."
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-stone-700 dark:text-stone-300">Offset</span>
                <span
                  className={`font-mono font-bold ${
                    aimTab === 'firing' || aimTab === 'buffer'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-forge-600 dark:text-forge-400'
                  }`}
                >
                  {aimTab === 'firing'
                    ? `${hold.fireOffsetX ?? 0}, ${hold.fireOffsetY ?? 0} px`
                    : aimTab === 'buffer'
                      ? `${hold.bufferOffsetX ?? 0}, ${hold.bufferOffsetY ?? 0} px`
                      : `${hold.offsetX ?? 0}, ${hold.offsetY ?? 0} px`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {aimTab === 'firing' ? (
                  <>
                    <HoldDial
                      id="hold-fire-offset-x"
                      label="X"
                      value={hold.fireOffsetX ?? 0}
                      onChange={(value) => updateHold({ fireOffsetX: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                    <HoldDial
                      id="hold-fire-offset-y"
                      label="Y"
                      value={hold.fireOffsetY ?? 0}
                      onChange={(value) => updateHold({ fireOffsetY: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                  </>
                ) : aimTab === 'buffer' ? (
                  <>
                    <HoldDial
                      id="hold-buffer-offset-x"
                      label="X"
                      value={hold.bufferOffsetX ?? 0}
                      onChange={(value) => updateHold({ bufferOffsetX: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                    <HoldDial
                      id="hold-buffer-offset-y"
                      label="Y"
                      value={hold.bufferOffsetY ?? 0}
                      onChange={(value) => updateHold({ bufferOffsetY: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                  </>
                ) : (
                  <>
                    <HoldDial
                      id="hold-offset-x"
                      label="X"
                      value={hold.offsetX ?? 0}
                      onChange={(value) => updateHold({ offsetX: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                    <HoldDial
                      id="hold-offset-y"
                      label="Y"
                      value={hold.offsetY ?? 0}
                      onChange={(value) => updateHold({ offsetY: value })}
                      min={-32}
                      max={32}
                      step={1}
                    />
                  </>
                )}
              </div>
              <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                {aimTab === 'firing' ? (
                  <>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      WFWS fire role
                    </span>
                    : the firing sheet is a quad, so its offset needs no extra layer. Positive Y is
                    toward the grip, and the hand keeps its own placement.
                  </>
                ) : aimTab === 'buffer' ? (
                  <>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      WFWS buffer role
                    </span>
                    : played automatically during Beam charge buffers and Timed Sequencer opening
                    wind-ups via <code className="font-mono">sb.hold_trigger</code>.
                  </>
                ) : aimLayerOn ? (
                  <>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      WFWS quad layer
                    </span>
                    : the aim poses are drawn from the sheet, the engine&apos;s silent sheet keeps it
                    from drawing a second copy. Walking, put-away and the firing pose stay the
                    engine&apos;s.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-forge-600 dark:text-forge-400">
                      Rust native
                    </span>
                    : the engine draws the held art itself, no extra atlas slot. An offset, a hand
                    offset or a Space swing turns the quad layer on.
                  </>
                )}
              </p>
            </div>

            {/* 5. Role behaviour. */}
            {aimTab === 'firing' ? (
              <>
                <HoldDial
                  id="hold-fire-ticks"
                  label="Show For"
                  value={Math.max(0, Math.round(hold.fireTicks ?? fireTickDefault))}
                  onChange={(value) => updateHold({ fireTicks: Math.max(0, Math.round(value)) })}
                  min={0}
                  max={40}
                  step={1}
                  unit="t"
                  title="How long the firing sheet stays up, in 50 Hz ticks (20 ms each), from the first of WA's two firing frames. WA's own states are two frames, which is why a firing animation flashed for a single frame; 0 keeps only WA's frames. Each new shot restarts the strip."
                />

                <div className="grid grid-cols-1 gap-3">
                  <label
                    htmlFor="hold-fire-hide-main"
                    title="Hide the held weapon while the firing sheet shows. Otherwise the held art is drawn under the firing sheet, the way PX overlays a muzzle flash on the gun."
                    className="flex h-10 cursor-pointer items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-800"
                  >
                    <span className="min-w-0 text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Hide Main Weapon While Firing
                    </span>
                    <input
                      id="hold-fire-hide-main"
                      type="checkbox"
                      checked={!!hold.fireHideMain}
                      onChange={(e) => updateHold({ fireHideMain: e.target.checked })}
                      className="h-4 w-4 shrink-0 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                    />
                  </label>
                </div>

                <div className="space-y-2 rounded-lg border border-stone-200 bg-white/70 px-2.5 py-2 text-[11px] text-stone-600 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-400">
                  <p>
                    {hasFireGeometry
                      ? 'These numbers belong to the firing sheet; the aiming pose keeps the ones on the other tab.'
                      : "Following the aiming parameters, which is PX's FAMAS case: the sheet sits exactly where the gun does."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!hold.flashFile}
                      onClick={() =>
                        updateHold({
                          fireWeapRadius: hold.weapRadius ?? 6,
                          fireWeapRotation: hold.weapRotation ?? 0,
                          fireScale: hold.scale ?? 1,
                          fireOffsetX: hold.offsetX ?? 0,
                          fireOffsetY: hold.offsetY ?? 0,
                          fireHandRadius: hold.handRadius ?? 10,
                          fireHandRotation: hold.handRotation ?? 0,
                          fireHandScale: hold.handScale ?? 1,
                          fireHandOffsetX: hold.handOffsetX ?? 0,
                          fireHandOffsetY: hold.handOffsetY ?? 0,
                        })
                      }
                      title="Copy the aiming radius, rotation, scale and offsets into the firing sheet, so they can be changed without moving the gun"
                      className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-800 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                    >
                      <Copy className="h-3 w-3" />
                      Copy aiming parameters
                    </button>
                    {hasFireGeometry && (
                      <button
                        type="button"
                        onClick={() =>
                          updateHold({
                            fireWeapRadius: undefined,
                            fireWeapRotation: undefined,
                            fireScale: undefined,
                            fireOffsetX: undefined,
                            fireOffsetY: undefined,
                            fireHandRadius: undefined,
                            fireHandRotation: undefined,
                            fireHandScale: undefined,
                            fireHandOffsetX: undefined,
                            fireHandOffsetY: undefined,
                          })
                        }
                        title="Go back to following the aiming parameters"
                        className="font-medium text-forge-600 hover:text-forge-700 dark:text-forge-400"
                      >
                        Follow the aim
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : aimTab === 'buffer' ? (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <label
                    htmlFor="hold-buffer-hide-main"
                    title="Hide the held weapon while the buffering/charge strip plays. Uncheck to layer a glowing charge effect directly over the aiming weapon."
                    className="flex h-10 cursor-pointer items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 dark:border-stone-700 dark:bg-stone-800"
                  >
                    <span className="min-w-0 text-xs font-semibold text-stone-800 dark:text-stone-200">
                      Hide Main Weapon While Buffering
                    </span>
                    <input
                      id="hold-buffer-hide-main"
                      type="checkbox"
                      checked={!!hold.bufferHideMain}
                      onChange={(e) => updateHold({ bufferHideMain: e.target.checked })}
                      className="h-4 w-4 shrink-0 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                    />
                  </label>
                </div>

                <div className="space-y-2 rounded-lg border border-stone-200 bg-white/70 px-2.5 py-2 text-[11px] text-stone-600 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-400">
                  <p>
                    Duration follows your Beam Charge Buffer or Timed Sequencer Initial Buffer
                    automatically, then switches cleanly to Firing Frames on shot release.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!hold.bufferFile}
                      onClick={() =>
                        updateHold({
                          bufferWeapRadius: hold.weapRadius ?? 6,
                          bufferWeapRotation: hold.weapRotation ?? 0,
                          bufferScale: hold.scale ?? 1,
                          bufferOffsetX: hold.offsetX ?? 0,
                          bufferOffsetY: hold.offsetY ?? 0,
                          bufferHandRadius: hold.handRadius ?? 10,
                          bufferHandRotation: hold.handRotation ?? 0,
                          bufferHandScale: hold.handScale ?? 1,
                          bufferHandOffsetX: hold.handOffsetX ?? 0,
                          bufferHandOffsetY: hold.handOffsetY ?? 0,
                        })
                      }
                      title="Copy aiming geometry into the buffering sheet"
                      className="inline-flex items-center gap-1.5 rounded border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-800 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                    >
                      <Copy className="h-3 w-3" />
                      Copy aiming parameters
                    </button>
                    {hasBufferGeometry && (
                      <button
                        type="button"
                        onClick={() =>
                          updateHold({
                            bufferWeapRadius: undefined,
                            bufferWeapRotation: undefined,
                            bufferScale: undefined,
                            bufferOffsetX: undefined,
                            bufferOffsetY: undefined,
                            bufferHandRadius: undefined,
                            bufferHandRotation: undefined,
                            bufferHandScale: undefined,
                            bufferHandOffsetX: undefined,
                            bufferHandOffsetY: undefined,
                          })
                        }
                        title="Go back to following the aiming parameters"
                        className="font-medium text-forge-600 hover:text-forge-700 dark:text-forge-400"
                      >
                        Follow the aim
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Row: Launchable / Throwable */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => updateHold({ thrown: false, putAway: true })}
                    title="Guns & bazookas (thrown = false). Held in hands; weapon can swing down into backpack on retreat."
                    aria-label="Launchable: Guns and bazookas (thrown = false). Held in hands; weapon can swing down into backpack on retreat."
                    className={`h-10 px-3 flex items-center justify-center text-xs rounded-lg border transition-all cursor-pointer ${
                      !hold.thrown
                        ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/40 ring-1 ring-forge-500 text-stone-900 dark:text-white font-bold shadow-xs'
                        : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-medium hover:bg-stone-50 dark:hover:bg-stone-750'
                    }`}
                  >
                    Launchable
                  </button>
                  <button
                    type="button"
                    onClick={() => updateHold({ thrown: true, putAway: false })}
                    title="Grenades & bananas (thrown = true). Leaves worm hand instantly on release; skips gun put-away."
                    aria-label="Throwable: Grenades and bananas (thrown = true). Leaves worm hand instantly on release; skips gun put-away."
                    className={`h-10 px-3 flex items-center justify-center text-xs rounded-lg border transition-all cursor-pointer ${
                      hold.thrown
                        ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/40 ring-1 ring-forge-500 text-stone-900 dark:text-white font-bold shadow-xs'
                        : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-medium hover:bg-stone-50 dark:hover:bg-stone-750'
                    }`}
                  >
                    Throwable
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div
                    title="Gun swings down and smoothly shrinks into backpack during retreat/walking (survives WA state 0x65 & 0x66) (put_away = true)"
                    className={`h-10 flex items-center justify-between px-3 rounded-lg border transition-colors ${
                      hold.thrown
                        ? 'opacity-50 cursor-not-allowed border-stone-200 dark:border-stone-800 bg-stone-100/50 dark:bg-stone-900/50'
                        : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <label
                        htmlFor="hold-put-away"
                        className={`text-xs font-semibold text-stone-800 dark:text-stone-200 select-none ${
                          hold.thrown ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        Animate Put-Away
                      </label>
                    </div>
                    <input
                      id="hold-put-away"
                      type="checkbox"
                      checked={hold.putAway !== false}
                      disabled={hold.thrown}
                      onChange={(e) => updateHold({ putAway: e.target.checked })}
                      className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer shrink-0 ml-2 disabled:cursor-not-allowed"
                    />
                  </div>

                  <label
                    htmlFor="hold-keep-firing"
                    title="The held art stays on WA's firing poses 0x6A & 0x6B (like Crossbows and Miniguns) (keep_while_firing = true). A burst keeps it there anyway because the engine drops it from the second shot, and a firing sheet replaces the art it would show while it plays."
                    className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
                  >
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                      Keep While Firing
                    </span>
                    <input
                      id="hold-keep-firing"
                      type="checkbox"
                      checked={hold.keepWhileFiring}
                      onChange={(e) => updateHold({ keepWhileFiring: e.target.checked })}
                      className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer shrink-0 ml-2"
                    />
                  </label>
                </div>
              </>
            )}
          </div>
          </div>
        </div>
        {/* The Space swing: a keyframed clip on the held art. It is data, not
            Lua, so the preview and the game run the same numbers. */}
        {aimTab === 'aim' && (
          <div className="mt-4 space-y-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/30">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <span
                className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100"
                title="What the held weapon does when the player presses Space. Each key is a pose on top of the engine's aim: an angle, a nudge in sheet pixels, a size, an optional strip frame and opacity, reached with its own easing. It needs the quad layer, so it also turns the aim poses over to sb.hold."
              >
                Space Swing (`swing`)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="hold-swing-enable"
                className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
              >
                <input
                  id="hold-swing-enable"
                  type="checkbox"
                  checked={!!playerClip.enabled}
                  onChange={(event) => updateClip({ enabled: event.target.checked })}
                  className="h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                />
                Swing on Space
              </label>
              <button
                type="button"
                onClick={triggerSwing}
                disabled={!playerClip.enabled}
                title="Play the clip in the preview, the way Space plays it in game"
                className="inline-flex items-center gap-1.5 rounded-lg border border-forge-300 bg-forge-50 px-2.5 py-1.5 text-xs font-semibold text-forge-700 hover:bg-forge-100 disabled:opacity-50 dark:border-forge-700 dark:bg-forge-950/50 dark:text-forge-300 dark:hover:bg-forge-900/50"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Press Space
              </button>
            </div>
          </div>

          {playerClip.enabled && (
            <>
              <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-300">
                {project.melee?.enabled ? (
                  <>
                    Space <span className="font-semibold">fires</span> this weapon, and the shot the
                    record builds is a <span className="font-semibold">ghost</span>: no art, no
                    trail, no blast, no damage, no sound. That is what takes the ammo and lets the
                    scheme and its options handle retreat and turn ending.
                  </>
                ) : (
                  <>
                    Space plays this clip and <span className="font-semibold">doesn't fire</span>:
                    the claim carries <span className="font-mono">eat_fire = true</span>, so nothing
                    leaves the worm while the game scheme owns turn ending.
                  </>
                )}
              </p>

              <div className="max-w-xs">
                <HoldDial
                  id="hold-swing-ticks"
                  label="Length"
                  value={playerClip.ticks}
                  onChange={(value) => updateClip({ ticks: value })}
                  min={2}
                  max={80}
                  step={1}
                  unit="t"
                  title="Length in 50 Hz ticks (20 ms each), so 16 ticks is 320 ms."
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
                      <th className="px-1 text-left font-semibold">Tick</th>
                      <th className="px-1 text-left font-semibold">Angle</th>
                      <th className="px-1 text-left font-semibold">dx</th>
                      <th className="px-1 text-left font-semibold">dy</th>
                      <th className="px-1 text-left font-semibold">Scale</th>
                      <th className="px-1 text-left font-semibold">Frame</th>
                      <th className="px-1 text-left font-semibold">Alpha</th>
                      <th
                        className="px-1 text-left font-semibold"
                        title="Whether the opacity eases into this key. Off holds the previous key's alpha and steps at the key, so a pose that returns the weapon to the worm doesn't fade out on its way."
                      >
                        Fade
                      </th>
                      <th className="px-1 text-left font-semibold">Ease</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...playerClip.keys]
                      .sort((a, b) => a.t - b.t)
                      .map((key, index) => {
                        const patchKey = (patch: Partial<AimClipKey>) => {
                          const keys = playerClip.keys.map((k) =>
                            k === key ? { ...k, ...patch } : k,
                          );
                          updateClip({ keys });
                        };
                        const cell =
                          'w-[62px] rounded border border-stone-300 bg-white px-1 py-0.5 text-right font-mono text-[11px] text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white';
                        return (
                          <tr key={index}>
                            <td className="px-1">
                              <KeyTickInput
                                aria-label={`Key ${index + 1} tick`}
                                label={`Key ${index + 1} tick`}
                                value={key.t}
                                onCommit={(value) => patchKey({ t: value })}
                                className={cell}
                              />
                            </td>
                            <td className="px-1">
                              <NumberInput
                                aria-label={`Key ${index + 1} angle`}
                                value={key.angle}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                                  patchKey({ angle: value });
                                }}
                                className={cell}
                              />
                            </td>
                            <td className="px-1">
                              <NumberInput
                                aria-label={`Key ${index + 1} dx`}
                                value={key.dx}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                                  patchKey({ dx: value });
                                }}
                                className={cell}
                              />
                            </td>
                            <td className="px-1">
                              <NumberInput
                                aria-label={`Key ${index + 1} dy`}
                                value={key.dy}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                                  patchKey({ dy: value });
                                }}
                                className={cell}
                              />
                            </td>
                            <td className="px-1">
                              <NumberInput
                                aria-label={`Key ${index + 1} scale`}
                                value={key.scale ?? 1}
                                step={0.05}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                                  patchKey({ scale: value });
                                }}
                                className={cell}
                              />
                            </td>
                            <td className="px-1">
                              <NumberInput
                                aria-label={`Key ${index + 1} frame`}
                                allowEmpty
                                value={key.frame ?? ''}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  patchKey({
                                    frame:
                                      event.target.value.trim() === '' || Number.isNaN(value)
                                        ? undefined
                                        : Math.max(0, value),
                                  });
                                }}
                                className={cell}
                              />
                            </td>
                            <td className="px-1">
                              <NumberInput
                                aria-label={`Key ${index + 1} alpha`}
                                value={key.alpha ?? 1}
                                step={0.05}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (event.target.value.trim() === '' || Number.isNaN(value)) return;
                                  patchKey({ alpha: Math.min(1, Math.max(0, value)) });
                                }}
                                className={cell}
                              />
                            </td>
                            <td className="px-1">
                              <input
                                id={`clip-key-fade-${index}`}
                                type="checkbox"
                                aria-label={`Key ${index + 1} fades its opacity`}
                                title="Fade into this key. Off keeps the previous alpha for the whole segment and steps at the key."
                                checked={key.fade !== false}
                                onChange={(event) => patchKey({ fade: event.target.checked })}
                                className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                              />
                            </td>
                            <td className="px-1">
                              <select
                                aria-label={`Key ${index + 1} easing`}
                                value={key.ease}
                                onChange={(event) =>
                                  patchKey({ ease: event.target.value as AimClipKey['ease'] })
                                }
                                className="w-[104px] cursor-pointer rounded border border-stone-300 bg-white px-1 py-0.5 text-[11px] text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                              >
                                {CLIP_EASES.map((ease) => (
                                  <option key={ease.id} value={ease.id}>
                                    {ease.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1">
                              <button
                                type="button"
                                aria-label={`Remove key ${index + 1}`}
                                title="Remove this key"
                                disabled={playerClip.keys.length <= 1}
                                onClick={() =>
                                  updateClip({ keys: playerClip.keys.filter((k) => k !== key) })
                                }
                                className="rounded p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-950/40"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // A new key lands at the end, at the aim pose, so the table
                    // stays sorted and the clip keeps returning to zero.
                    const last = Math.max(playerClip.ticks, ...playerClip.keys.map((key) => key.t));
                    updateClip({
                      keys: [
                        ...playerClip.keys,
                        { t: last, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 1, ease: 'out_quad' },
                      ],
                    });
                  }}
                  className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                >
                  Add key
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // The one key a swing almost always needs: back to the aim
                    // pose at the clip's end, so the art is the engine's again.
                    const last = Math.max(0, ...playerClip.keys.map((key) => key.t));
                    const at = Math.max(playerClip.ticks, last + 4);
                    updateClip({
                      ticks: at,
                      keys: [
                        ...playerClip.keys,
                        { t: at, angle: 0, dx: 0, dy: 0, scale: 1, alpha: 1, ease: 'out_quad' },
                      ],
                    });
                  }}
                  className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                >
                  Add return key
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateClip({
                      keys: DEFAULT_AIM_CLIP.keys.map((key) => ({ ...key })),
                      ticks: DEFAULT_AIM_CLIP.ticks,
                    })
                  }
                  className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                >
                  Reset shape
                </button>
                <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
                  {playerClip.ticks} ticks = {Math.round(playerClip.ticks * 20)} ms
                </span>
              </div>

              {/* Ghost trail: the swing at earlier ticks, faint behind it. */}
              <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
                      Ghost Trail
                    </span>
                    <p className="mt-0.5 max-w-2xl text-[11px] text-stone-500 dark:text-stone-400">
                      The blade a few ticks behind itself, each ghost fainter, drawn under the live
                      art. Nothing is recorded: the layer evaluates the same clip at an earlier tick,
                      so every peer draws the same smear. One quad per ghost.
                    </p>
                  </div>
                  <label
                    htmlFor="hold-echo-enable"
                    className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                  >
                    <input
                      id="hold-echo-enable"
                      type="checkbox"
                      checked={!!clipEcho.enabled}
                      onChange={(event) =>
                        updateClip({ echo: { ...clipEcho, enabled: event.target.checked } })
                      }
                      className="h-4 w-4 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                    />
                    Enable
                  </label>
                </div>

                {clipEcho.enabled && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <HoldDial
                        id="hold-echo-count"
                        label="Ghosts"
                        value={clipEcho.count}
                        onChange={(value) =>
                          updateClip({
                            echo: { ...clipEcho, count: Math.min(8, Math.max(1, Math.round(value))) },
                          })
                        }
                        min={1}
                        max={8}
                        step={1}
                        unit="q"
                        title="How many copies trail the swing. Above four or five they stop reading as motion and start reading as a smear."
                      />
                      <HoldDial
                        id="hold-echo-every"
                        label="Spacing"
                        value={clipEcho.every}
                        onChange={(value) =>
                          updateClip({
                            echo: { ...clipEcho, every: Math.min(8, Math.max(1, Math.round(value))) },
                          })
                        }
                        min={1}
                        max={8}
                        step={1}
                        unit="t"
                        title="Ticks between two ghosts (20 ms each). One tick is a tight smear, four or more separate afterimages."
                      />
                      <HoldDial
                        id="hold-echo-fade"
                        label="Fade"
                        value={clipEcho.fade}
                        onChange={(value) =>
                          updateClip({
                            echo: {
                              ...clipEcho,
                              fade: Math.min(0.95, Math.max(0.2, Math.round(value * 100) / 100)),
                            },
                          })
                        }
                        min={0.2}
                        max={0.95}
                        step={0.05}
                        unit="x"
                        title="Each ghost is this times the one in front of it, so 0.55 makes a long fade and 0.2 a short one."
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="hold-echo-blend"
                        className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                      >
                        Blend
                      </label>
                      <select
                        id="hold-echo-blend"
                        value={clipEcho.blend}
                        onChange={(event) =>
                          updateClip({
                            echo: { ...clipEcho, blend: event.target.value as 'alpha' | 'add' },
                          })
                        }
                        className="h-8 w-full cursor-pointer rounded-lg border border-stone-300 bg-white px-2 text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                      >
                        <option value="add">Add (glows, the usual choice for a blade)</option>
                        <option value="alpha">Alpha (a plain fade, for dark art)</option>
                      </select>
                      <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                        Additive art vanishes on black, which is why a smoke or shadow sheet wants
                        alpha instead.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          </div>
        )}
        </div>
              </>
            )}
            </div>
          </div>
        );
      })()}

      {/* ======================================================================= */}
      {/* 2. MISSILE / PROJECTILE FLIGHT SPRITE BUILDER (wfws_sprite_builder.lua) */}
      {/* ======================================================================= */}
      {(() => {
        const hotbarSlots: {
          id: FlightSlotRole;
          slotNum: number;
          label: string;
          icon: string;
          badge: string;
          title: string;
          desc: string;
          enabled: boolean;
          disabledHint: string;
        }[] = [
          {
            id: 'primary',
            slotNum: 1,
            label: 'Main',
            icon: normalIconSrc,
            badge: 'Primary Round (normal.png)',
            title: 'Editing Role: Primary Missile',
            desc: 'Initial flight round fired from the launcher. All secondary phases (homing, cluster bits, dig state) build on top of this.',
            enabled: true,
            disabledHint: '',
          },
          {
            id: 'homing',
            slotNum: 2,
            label: 'Home',
            icon: homingIconSrc,
            badge: 'Primary Homing (hmissil1.png)',
            title: 'Editing Role: Primary Homing Guidance',
            desc: 'Timed guidance art swapped into the main round between homing arm delay and expiry, zeroing WA’s missile.homing.sprite.',
            enabled: hasPrimaryHoming,
            disabledHint: 'Requires Missile Action = Homing in Record Editor',
          },
          {
            id: 'clusters',
            slotNum: 3,
            label: 'Bits',
            icon: clustersIconSrc,
            badge: 'Cluster Bits (clusters.png)',
            title: 'Editing Role: Cluster Bits Payload',
            desc: 'Child bomblets spawned when the primary round bursts. Can use their own sheet, inherit primary art, or stay native.',
            enabled: clustersEnabled,
            disabledHint: 'Requires Burst Payload = Clusters in Record Editor',
          },
          {
            id: 'homing_bit',
            slotNum: 4,
            label: 'HomeBit',
            icon: homingClustletsIconSrc,
            badge: 'Homing Clustlets (homing_clustlets.png)',
            title: 'Editing Role: Homing Cluster Bits',
            desc: 'Timed guidance art for cluster bomblets after bit arming, emitted as bits.homing while Cluster Bits is in Builder mode.',
            enabled: hasBitHoming,
            disabledHint: 'Requires Burst = Clusters and Bit Action = Homing in Record Editor',
          },
          {
            id: 'roam',
            slotNum: 5,
            label: 'Sheep',
            icon: roamIconSrc,
            badge: 'Roaming Action (sspsheep1.png)',
            title: 'Editing Role: Super Sheep / Roaming Animal',
            desc: 'Steerable flying animal. Own sheet makes the flown state its own role (its own animation, frames, spin, scale); the round’s sheet keeps Slot 1’s art. WA walks the animal until Space either way, and the two native rotation strips only apply with the flight builder off.',
            enabled: roamEnabled,
            disabledHint: 'Requires Missile Action = Roam in Record Editor',
          },
          {
            id: 'dig',
            slotNum: 6,
            label: 'Dig',
            icon: digIconSrc,
            badge: 'Digging Probe (dig.png)',
            title: 'Editing Role: Digging Terrain Probes',
            desc: 'Sheetless state: zeroes WA dig sprites and cycles the owning flight sheet while 4 terrain probes detect solid land (dig = true).',
            enabled: digEnabled,
            disabledHint: 'Requires Missile Action = Dig or Bit Action = Dig in Record Editor',
          },
        ];

        const activeSlotMeta =
          hotbarSlots.find((s) => s.id === activeFlightRole) ?? hotbarSlots[0];

        const isSecondaryRole =
          activeFlightRole === 'clusters' ||
          activeFlightRole === 'homing' ||
          activeFlightRole === 'homing_bit' ||
          activeFlightRole === 'roam';
        const isDigRole = activeFlightRole === 'dig';
        const secondaryRoleObj =
          activeFlightRole === 'clusters'
            ? bitFlight
            : activeFlightRole === 'homing'
              ? homingRole
              : activeFlightRole === 'homing_bit'
                ? homingBitRole
              : activeFlightRole === 'roam'
                ? roamRole
                : null;
        const updateSecondaryRole = (patch: Partial<FlightRoleArt>) => {
          if (activeFlightRole === 'clusters') updateBitFlight(patch);
          else if (activeFlightRole === 'homing') updateBehaviorArt('homing', patch);
          else if (activeFlightRole === 'homing_bit') updateBehaviorArt('homing_bit', patch);
          else if (activeFlightRole === 'roam') updateBehaviorArt('roam', patch);
        };

        // The roam slot in `inherit` mode shows the round's own flight row: the
        // animal keeps the primary sheet, so every parameter here belongs to
        // Slot 1 and editing it there is the only thing that changes the export.
        const roamInheritsPrimary = activeFlightRole === 'roam' && roamRoleMode !== 'builder';
        const activeSheetLocked =
          (isDigRole && digRoleMode === 'native') ||
          (isSecondaryRole && secondaryRoleObj?.mode !== 'builder') ||
          roamInheritsPrimary;

        const trailRoleKey: FlightTrailRoleKey =
          activeFlightRole === 'primary'
            ? 'main'
            : activeFlightRole === 'clusters'
              ? 'bit'
              : activeFlightRole === 'homing_bit'
                ? 'homing_bit'
                : activeFlightRole === 'homing'
                  ? 'homing'
                  : activeFlightRole === 'dig'
                    ? 'dig'
                    : 'roam';
        const trailRoleArt =
          activeFlightRole === 'primary'
            ? missile
            : activeFlightRole === 'clusters'
              ? bitFlight
              : activeFlightRole === 'homing'
                ? homingRole
                : activeFlightRole === 'homing_bit'
                  ? homingBitRole
                  : activeFlightRole === 'roam'
                    ? roamRole
                    : digRole;
        // A role with its own enabled brush shows that brush. Otherwise the
        // row mirrors the trail the SDK will actually use: the main round for
        // inherited homing and roam, the owning bit when a bit drives the dig,
        // and the main trail for a bit that inherits its sheet.
        const trailOwn = trailRoleArt?.trail;
        const trailOwnerForInherit =
          activeFlightRole === 'homing_bit'
            ? bitFlight.mode === 'builder'
              ? bitFlight
              : missile
            : activeFlightRole === 'dig' &&
                digBitEnabled &&
                !digMainEnabled &&
                bitFlight.mode === 'builder'
              ? bitFlight
              : missile;
        const trailOwnerLabel = trailOwnerForInherit === bitFlight ? 'Cluster Bit' : 'Main';
        const trailInherits =
          (activeFlightRole === 'homing' && homingRole.mode === 'inherit') ||
          (activeFlightRole === 'homing_bit' && homingBitRole.mode === 'inherit') ||
          (activeFlightRole === 'roam' && roamRoleMode === 'inherit') ||
          (activeFlightRole === 'clusters' &&
            bitFlight.mode === 'inherit' &&
            !trailOwn?.enabled) ||
          (activeFlightRole === 'dig' && digRoleMode !== 'native' && !trailOwn?.enabled);
        const trailConfig = mergeFlightTrailConfig(
          trailInherits ? trailOwnerForInherit?.trail : trailOwn,
        );
        const trailBlocked =
          !builderOn ||
          (activeFlightRole === 'clusters' && bitFlight.mode === 'native') ||
          (activeFlightRole === 'homing' && homingRole.mode !== 'builder') ||
          (activeFlightRole === 'homing_bit' && homingBitRole.mode !== 'builder') ||
          (activeFlightRole === 'roam' && roamRoleMode !== 'builder') ||
          (activeFlightRole === 'dig' && digRoleMode === 'native');
        const trailBlockedHint = !builderOn
          ? 'Enable Missile Flight Sprite above to use a custom trail.'
          : trailInherits
            ? 'Inherits the ' + trailOwnerLabel + ' trail. Switch this role to Builder to customize.'
            : 'Switch this role to Builder to customize.';
        const trailActive = trailConfig.enabled && !trailBlocked;
        const trailStatus = trailActive
          ? 'On, ' + trailConfig.frames + 'f, ' + trailConfig.blend
          : 'Off';
        const updateActiveTrail = (patch: Partial<typeof trailConfig>) => {
          const next = mergeFlightTrailConfig({ ...trailConfig, ...patch });
          if (activeFlightRole === 'primary') updateMissile({ trail: next });
          else if (activeFlightRole === 'dig') updateBehaviorArt('dig', { trail: next });
          else updateSecondaryRole({ trail: next });
        };

        const digOwningSheetIsBit =
          digBitEnabled && !digMainEnabled && bitFlight.mode === 'builder';
        const digOwningFrames = (digOwningSheetIsBit ? bitFlight.frames : missile.frames) || 1;
        const activeAnim: MissileAnimType = isDigRole
          ? digRole.anim || 'track'
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.anim || 'rotation'
            : missile.anim || 'rotation';
        const activeFrames = isDigRole
          ? digRole.frames > 1
            ? digRole.frames
            : digOwningFrames
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.frames || 1
            : missile.frames || 1;
        const activeAnimSpeed = isDigRole
          ? digRole.animSpeed || 1.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.animSpeed || 1.0
            : missile.animSpeed || 1.0;
        const activePingpong = isDigRole
          ? digRole.pingpong === true
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.pingpong === true
            : missile.pingpong === true;
        const activeSpinRate = isDigRole
          ? digRole.spinRate || 1.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.spinRate || 1.0
            : missile.spinRate || 1.0;
        const activeScale = isDigRole
          ? digRole.scale || 1.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.scale || 1.0
            : missile.scale || 1.0;
        const activeMirror = isDigRole
          ? digRole.mirror !== false
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.mirror !== false
            : missile.mirror !== false;
        const activeZ = isDigRole
          ? digRole.z ?? 5.0
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj!.z ?? 5.0
            : missile.z ?? 5.0;

        const updateActiveRoleParams = (
          patch: Partial<
            Pick<
              FlightRoleArt,
              'anim' | 'frames' | 'pingpong' | 'animSpeed' | 'spinRate' | 'scale' | 'mirror' | 'z'
            >
          >
        ) => {
          if (isDigRole) {
            updateBehaviorArt('dig', patch);
            return;
          }
          // A secondary role always edits its own row. The roam slot in
          // "Round's sheet" mode is read-only (the controls are locked) because
          // its values are Slot 1's; routing it here anyway means a stray edit
          // can never overwrite the primary weapon's flight parameters.
          if (isSecondaryRole) {
            updateSecondaryRole(patch);
          } else {
            updateMissile(patch);
          }
        };

        const animCodeMap: Record<MissileAnimType, string> = {
          track: 'track = 2',
          rotation: 'rotation = 3',
          slow: 'slow = 1',
          medium: 'medium = 1',
          fast: 'fast = 1',
          roam: 'roam = 4',
          none: 'none = 5',
        };

        const assetLabel =
          activeFlightRole === 'clusters'
            ? 'Cluster Bit Sprite Sheet'
            : activeFlightRole === 'homing'
              ? 'Primary Homing Sheet'
              : activeFlightRole === 'homing_bit'
                ? 'Homing Bit Sheet'
                : activeFlightRole === 'roam'
                  ? 'Roaming Flight Sheet'
                  : activeFlightRole === 'dig'
                    ? 'Digging Animation'
                    : 'Projectile Sprite Sheet';

        const assetPathHint =
          activeFlightRole === 'clusters'
            ? bitFlightSheetPath(project)
            : activeFlightRole === 'homing'
              ? behaviorStateSheetPath(project, 'homing')
              : activeFlightRole === 'homing_bit'
                ? behaviorStateSheetPath(project, 'homing_bit')
                : activeFlightRole === 'roam'
                  ? behaviorStateSheetPath(project, 'roam')
                  : activeFlightRole === 'dig'
                    ? digOwningSheetIsBit
                      ? bitFlightSheetPath(project)
                      : missileFlightSheetPath(project)
                    : missileFlightSheetPath(project);

        const activeSheetFile = isDigRole
          ? undefined
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj?.sheetFile
            : missile.sheetFile;
        const activeSheetPreview = isDigRole
          ? undefined
          : isSecondaryRole && !roamInheritsPrimary
            ? secondaryRoleObj?.sheetPreview
            : missile.sheetPreview;

        return (
          <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900 transition-colors">
            {/* Header + 6-Icon Hotbar */}
            <div className="border-b border-stone-200/80 bg-stone-50/70 px-5 py-3.5 dark:border-stone-800 dark:bg-stone-950/50 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Rocket className="w-4 h-4 text-forge-500 shrink-0" />
                  <h2 className="font-heading text-sm font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                    Missile &amp; Projectile Flight Sprite Builder
                  </h2>
                  <span className="text-[11px] font-mono text-stone-500 dark:text-stone-400">
                    · {activeSlotMeta.badge}
                  </span>
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                  Switch projectile roles using the hotbar to configure sprite sheets, rotation modes, trajectories, and <code className="font-mono text-stone-600 dark:text-stone-300">sb.flight</code> parameters.
                </p>
              </div>

              {/* 6-Slot Pixel Icon Hotbar */}
              <div
                role="tablist"
                aria-label="Projectile flight roles"
                className="flex flex-wrap items-center gap-1.5 rounded-xl border border-stone-200/90 bg-stone-100/80 p-1.5 dark:border-stone-800 dark:bg-stone-900/90 shrink-0 self-start xl:self-auto"
              >
                {hotbarSlots.map((slot) => {
                  const isActive = activeFlightRole === slot.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      disabled={!slot.enabled}
                      onClick={() => slot.enabled && setActiveFlightRole(slot.id)}
                      title={
                        slot.enabled
                          ? `Slot ${slot.slotNum}: ${slot.badge}`
                          : `${slot.badge}, ${slot.disabledHint}`
                      }
                      className={`relative w-14 h-14 rounded-lg border-2 transition-all overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-500 ${
                        !slot.enabled
                          ? 'opacity-35 grayscale cursor-not-allowed border-stone-200 dark:border-stone-800 bg-stone-200/60 dark:bg-stone-900/60'
                          : isActive
                            ? 'border-forge-500 bg-forge-50/70 ring-1 ring-forge-500/50 dark:border-forge-500 dark:bg-forge-950/40 cursor-pointer'
                            : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-950 hover:border-stone-400 dark:hover:border-stone-500 cursor-pointer'
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 font-mono font-semibold text-[9px] tabular-nums leading-none px-1 py-0.5 rounded border z-10 ${
                          !slot.enabled
                            ? 'bg-stone-200 dark:bg-stone-800 text-stone-400 border-stone-300 dark:border-stone-700'
                            : isActive
                              ? 'bg-forge-600 text-white border-forge-600'
                              : 'bg-white/90 dark:bg-stone-900/90 text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-700'
                        }`}
                      >
                        {slot.slotNum}
                      </span>
                      <img
                        src={slot.icon}
                        alt={slot.label}
                        className={`w-full h-full object-contain p-1.5 transition-transform ${
                          slot.enabled ? 'group-hover:scale-110' : ''
                        }`}
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <span
                        className={`absolute bottom-0.5 right-0.5 text-[9px] font-semibold font-mono leading-none px-1 py-0.5 rounded ${
                          !slot.enabled
                            ? 'bg-stone-200/90 dark:bg-stone-800/90 text-stone-500'
                            : 'bg-white/90 dark:bg-stone-900/90 text-stone-800 dark:text-stone-100'
                        }`}
                      >
                        {slot.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-5">
            {/* Active Role Strip */}
            <div className="mb-4 px-3.5 py-2.5 rounded-lg border border-stone-200/80 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-950/40 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={activeSlotMeta.icon}
                  alt=""
                  className="w-7 h-7 object-contain shrink-0"
                  style={{ imageRendering: 'pixelated' }}
                />
                <div className="min-w-0">
                  <div className="font-semibold text-stone-900 dark:text-stone-100 leading-snug">
                    {activeSlotMeta.title}
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-snug">
                    {activeSlotMeta.desc}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-stone-500 dark:text-stone-400 shrink-0">
                Slot {activeSlotMeta.slotNum} / {hotbarSlots.length}
              </span>
            </div>

            {isAirStrike && (
              <div className="mb-4 px-3.5 py-2 rounded-lg border border-amber-300/80 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Native WA air strikes spawn munitions from their own record copy and don't run{' '}
                  <code className="font-mono">sb.flight</code>. Enable{' '}
                  <strong>Airstrike Takeover</strong> with a <strong>Missile</strong> payload to use
                  the flight sprite builder, or use the Record / Pack Art strike body sprite.
                </span>
              </div>
            )}

            {/* Row 2: Projectile Asset Bar + Enable Missile Flight Sprite Toggle */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-5">
              <div className="flex-1 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 px-3.5 py-2 rounded-lg border border-stone-200/80 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-950/40 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0 truncate">
                  <Upload className="w-4 h-4 text-stone-500 dark:text-stone-400 shrink-0" />
                  <span className="text-xs font-semibold text-stone-900 dark:text-stone-100 shrink-0">
                    {assetLabel}
                  </span>
                  {isDigRole ? (
                    <span
                      className="text-xs text-stone-500 dark:text-stone-400 truncate"
                      title={assetPathHint}
                    >
                      Sheetless, cycles {digOwningSheetIsBit ? 'Cluster Bits' : 'Primary Round'} sheet on terrain contact
                    </span>
                  ) : activeSheetFile ? (
                    <span
                      className="font-mono text-xs text-forge-600 dark:text-forge-400 font-medium truncate"
                      title={`${activeSheetFile.name} (${(activeSheetFile.size / 1024).toFixed(1)} KB) → ${assetPathHint}`}
                    >
                      {activeSheetFile.name} ({(activeSheetFile.size / 1024).toFixed(1)} KB)
                    </span>
                  ) : isSecondaryRole && secondaryRoleObj?.mode !== 'builder' ? (
                    <span className="text-xs text-stone-500 dark:text-stone-400 truncate">
                      {secondaryRoleObj?.mode === 'inherit'
                        ? activeFlightRole === 'homing_bit' && bitFlight.mode === 'builder'
                          ? 'Inheriting Cluster Bits art, upload a PNG to switch to Builder'
                          : 'Inheriting Primary Round art, upload a PNG to switch to Builder'
                        : 'Using Native WA sprite, upload a PNG to switch to Builder'}
                    </span>
                  ) : (
                    <span
                      className="text-xs text-stone-500 dark:text-stone-400 truncate"
                      title={assetPathHint}
                    >
                      {isSecondaryRole
                        ? `Default fallback art → ${assetPathHint}`
                        : `Using default ${defaultArt.label} art, upload a PNG to replace it`}
                    </span>
                  )}
                  {activeSheetPreview && (
                    <button
                      type="button"
                      onClick={isSecondaryRole ? removeCustomRoleSheet : removeCustomMissileSheet}
                      className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-medium shrink-0 ml-1 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="shrink-0">
                  {isDigRole ? (
                    <button
                      type="button"
                      onClick={() => setActiveFlightRole(digOwningSheetIsBit ? 'clusters' : 'primary')}
                      className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors cursor-pointer"
                    >
                      Edit {digOwningSheetIsBit ? 'Bits' : 'Main'} Sheet
                    </button>
                  ) : (
                    <>
                      <input
                        key={isSecondaryRole ? `role-file-${activeFlightRole}` : 'missile-file'}
                        ref={isSecondaryRole ? roleFileInputRef : missileFileInputRef}
                        type="file"
                        accept="image/png,image/gif"
                        onChange={isSecondaryRole ? handleUploadRoleSheet : handleUploadMissileSheet}
                        className="hidden"
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            (isSecondaryRole ? roleFileInputRef : missileFileInputRef).current?.click()
                          }
                          className="px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
                          <span>{activeSheetFile ? 'Change PNG Sheet' : 'Upload PNG'}</span>
                        </button>
                        <SpritePickButton
                          accept="image"
                          label="Pick Flight Sheet"
                          onPick={(file, framesHint) =>
                            isSecondaryRole
                              ? applyRoleSheetFile(file, framesHint)
                              : applyMissileSheetFile(file, framesHint)
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <label
                htmlFor="flight-enable-builder"
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors shrink-0 self-start sm:self-auto ${
                  isAirStrike
                    ? 'opacity-50 cursor-not-allowed border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900'
                    : missile.enabled
                      ? 'cursor-pointer border-forge-400/70 bg-forge-50/70 dark:border-forge-600/60 dark:bg-forge-950/35'
                      : 'cursor-pointer border-stone-200 bg-white hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800'
                }`}
              >
                <input
                  id="flight-enable-builder"
                  type="checkbox"
                  disabled={isAirStrike}
                  checked={missile.enabled}
                  onChange={(e) =>
                    updateMissile({
                      enabled: e.target.checked,
                      ...(e.target.checked ? { mode: 'custom' } : {}),
                    })
                  }
                  className="rounded text-forge-600 focus:ring-forge-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-xs font-medium text-stone-800 dark:text-stone-100 whitespace-nowrap">
                  Enable Missile Flight Sprite
                </span>
              </label>
            </div>

            {/* One compact entry point for the brush trail: every knob lives
                in the modal, so the workbench stays about flight art. */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200/80 bg-stone-50/70 px-3 py-2 dark:border-stone-800 dark:bg-stone-950/40">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  disabled={trailBlocked}
                  onClick={() => setTrailModalOpen(true)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    trailBlocked
                      ? 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-500'
                      : 'cursor-pointer border-forge-300 bg-white text-forge-700 hover:bg-forge-50 dark:border-forge-700 dark:bg-stone-900 dark:text-forge-300 dark:hover:bg-forge-950/40'
                  }`}
                >
                  <Palette className="h-3.5 w-3.5" />
                  Custom Brush Trail
                </button>
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    trailActive
                      ? 'border-forge-300 bg-forge-50 text-forge-700 dark:border-forge-700 dark:bg-forge-950/40 dark:text-forge-300'
                      : 'border-stone-300 bg-stone-100 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400'
                  }`}
                >
                  {trailStatus}
                </span>
                <span className="flex items-center gap-1" aria-hidden="true">
                  {trailConfig.sheetPreview ? (
                    <img
                      src={trailConfig.sheetPreview}
                      alt=""
                      className="h-5 w-5 rounded border border-stone-300 object-contain dark:border-stone-700"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  ) : (
                    <span
                      className="h-5 w-5 rounded border border-stone-300 dark:border-stone-700"
                      style={{ background: trailConfig.color }}
                    />
                  )}
                  {trailConfig.colorEnd && (
                    <span
                      className="h-3 w-3 rounded-full border border-stone-300 dark:border-stone-700"
                      style={{ background: trailConfig.colorEnd }}
                    />
                  )}
                </span>
                <span className="truncate text-[10px] text-stone-500 dark:text-stone-400">
                  {trailBlocked
                    ? trailBlockedHint
                    : trailInherits
                      ? 'Inherits the ' + trailOwnerLabel + ' trail. Enable this role\'s own brush for a separate pool.'
                      : 'Spawned behind the round and stepped at 50 Hz.'}
                </span>
              </div>
              <span className="font-mono text-[10px] text-stone-400 dark:text-stone-500">
                {trailConfig.power} power / {trailConfig.lifeFrames} tick life
              </span>
            </div>

            {/* 3-Column Workbench Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.35fr_1.85fr] gap-4 items-start">
              {/* LEFT COLUMN: Modifiers, Role Scale, Global Size, Angle Offset */}
              <div className="order-3 lg:order-1 flex flex-col gap-3.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <label
                    htmlFor="flight-mirror-left"
                    title="Flips sprite horizontally when moving left (vx < 0)"
                    className={`h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-2xs transition-colors ${
                      activeSheetLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-750'
                    }`}
                  >
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                      Mirror Left
                    </span>
                    <input
                      id="flight-mirror-left"
                      type="checkbox"
                      disabled={activeSheetLocked}
                      checked={activeMirror}
                      onChange={(e) => updateActiveRoleParams({ mirror: e.target.checked })}
                      className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <label
                    htmlFor="flight-log-identity"
                    title="Logs one line per missile's first frames with id, m.sprite, and classified role (log = true)."
                    className="h-10 flex items-center justify-between px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 cursor-pointer shadow-2xs hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
                  >
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 select-none">
                      Log Debug
                    </span>
                    <input
                      id="flight-log-identity"
                      type="checkbox"
                      checked={!!project.missileSprite?.logIdentity}
                      onChange={(e) =>
                        onChange({
                          missileSprite: {
                            ...project.missileSprite,
                            logIdentity: e.target.checked,
                          },
                        })
                      }
                      className="rounded text-forge-600 focus:ring-forge-500 w-4 h-4 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Role Scale Slider */}
                <div
                  className={`space-y-1 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 ${
                    activeSheetLocked ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <label
                      htmlFor="flight-role-scale"
                      className="font-semibold text-stone-700 dark:text-stone-300"
                    >
                      {isSecondaryRole ? 'Role Scale' : 'Primary Scale'}
                    </label>
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {activeScale.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    id="flight-role-scale"
                    type="range"
                    min={0.2}
                    max={3.0}
                    step={0.05}
                    disabled={activeSheetLocked}
                    value={activeScale}
                    onChange={(e) => updateActiveRoleParams({ scale: Number(e.target.value) })}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                {/* Global Size (All Roles) Slider */}
                <div
                  className="space-y-1 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40"
                  title="Multiplies every role's own scale, primary, cluster bits, and behaviour sheets."
                >
                  <div className="flex justify-between items-center text-xs">
                    <label
                      htmlFor="flight-global-size"
                      className="font-semibold text-stone-700 dark:text-stone-300"
                    >
                      Global Size (All Roles)
                    </label>
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {(missile.size ?? 1).toFixed(2)}x
                    </span>
                  </div>
                  <input
                    id="flight-global-size"
                    type="range"
                    min={0.25}
                    max={3.0}
                    step={0.05}
                    value={missile.size ?? 1}
                    onChange={(e) => updateMissile({ size: Number(e.target.value) })}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                {/* Angle Offset Slider */}
                <div
                  className="space-y-1 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40"
                  title="Added to whatever rotation the animation asks for. Sheets drawn pointing right need -90°; mirrored automatically when vx < 0."
                >
                  <div className="flex justify-between items-center text-xs">
                    <label
                      htmlFor="flight-angle-offset"
                      className="font-semibold text-stone-700 dark:text-stone-300"
                    >
                      Angle Offset
                    </label>
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {missile.angle ?? 0}°
                    </span>
                  </div>
                  <input
                    id="flight-angle-offset"
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={missile.angle ?? 0}
                    onChange={(e) => updateMissile({ angle: Number(e.target.value) })}
                    className="w-full accent-forge-500 cursor-pointer"
                  />
                </div>

                {/* Pivot nudge: the art moved inside its own cell, in sheet
                    pixels. Scaled with the art and turned with the drawn angle,
                    so an off-centre pivot stays put at every heading. */}
                <div
                  className="space-y-1.5 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40"
                  title="Moves the art inside its own cell, in sheet pixels: positive Y is down the sheet, positive X to the sheet's right. Scaled with the art, turned with the drawn angle and mirrored with the side, so art whose pivot isn't its centre lines up with the flight path both ways round."
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700 dark:text-stone-300">
                      Offset
                    </span>
                    <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                      {(missile.offsetX ?? 0).toFixed(0)}, {(missile.offsetY ?? 0).toFixed(0)} px
                    </span>
                  </div>
                  {(
                    [
                      { axis: 'X' as const, key: 'offsetX' as const },
                      { axis: 'Y' as const, key: 'offsetY' as const },
                    ]
                  ).map(({ axis, key }) => (
                    <div key={key} className="flex items-center gap-2">
                      <label
                        htmlFor={`flight-offset-${axis.toLowerCase()}`}
                        className="w-3 shrink-0 text-[10px] font-semibold uppercase text-stone-500"
                      >
                        {axis}
                      </label>
                      <input
                        id={`flight-offset-${axis.toLowerCase()}`}
                        type="range"
                        min={-32}
                        max={32}
                        step={1}
                        value={missile[key] ?? 0}
                        onChange={(e) => updateMissile({ [key]: Number(e.target.value) })}
                        className="w-full accent-forge-500 cursor-pointer"
                      />
                    </div>
                  ))}
                </div>

                {/* Roam tilt preset: `anim = "roam"` only. The ground pose is
                    side-on, so the art rests at `rest` and may lean a little as
                    the animal steps; in the air it tracks the heading. */}
                <div
                  className="space-y-1.5 p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40"
                  title="Preset for the Roam Tilt animation (anim = roam): the angle the walking art holds while WA walks the animal, and how far it may lean up or down as it steps. In the air the art tracks its heading instead."
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700 dark:text-stone-300">
                      Roam Tilt
                    </span>
                    <code className="text-[10px] font-mono text-forge-600 dark:text-forge-400">
                      anim = roam
                    </code>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { key: 'up', label: 'Max up', min: 0, max: 180 },
                        { key: 'down', label: 'Max down', min: 0, max: 180 },
                        { key: 'rest', label: 'Rest', min: -180, max: 180 },
                      ] as const
                    ).map((field) => {
                      const tilt = missile.roamTilt ?? DEFAULT_ROAM_TILT;
                      return (
                        <div key={field.key} className="space-y-0.5">
                          <label
                            htmlFor={`flight-tilt-${field.key}`}
                            className="block text-[10px] font-medium text-stone-600 dark:text-stone-400"
                          >
                            {field.label}
                          </label>
                          <NumberInput
                            id={`flight-tilt-${field.key}`}
                            min={field.min}
                            max={field.max}
                            step={5}
                            value={tilt[field.key]}
                            onChange={(e) =>
                              updateMissile({
                                roamTilt: { ...tilt, [field.key]: Number(e.target.value) },
                              })
                            }
                            className="w-full rounded-lg border border-stone-200 bg-white px-1.5 py-1 text-center font-mono text-[11px] text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Native Sprite Hidden Badge */}
                <div
                  className="p-3 rounded-xl border border-forge-200 dark:border-forge-900/60 bg-forge-50/50 dark:bg-forge-950/20 flex items-center justify-between gap-2"
                  title="Written while the builder is on: hides WA's native round (m.sprite = 0). A grounded roaming animal also writes 0 to sheep.flight_1/2. Cluster bits retain a marker id and are classified as bits."
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-forge-600 dark:text-forge-400 shrink-0" />
                    <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                      {activeFlightRole === 'roam'
                        ? roamGrounded(project)
                          ? 'Grounds the animal'
                          : 'Hides native flight art'
                        : activeFlightRole === 'dig'
                          ? digRoleMode === 'native'
                            ? 'Keeps WA dig sprites'
                            : 'Zeroes dig sprites'
                          : activeFlightRole === 'homing'
                            ? 'Zeroes homing.sprite'
                            : activeFlightRole === 'homing_bit'
                              ? 'Zeroes bit.homing.sprite'
                              : 'Native Sprite Hidden'}
                    </span>
                  </div>
                  <code className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white dark:bg-stone-900 border border-forge-200 dark:border-forge-800 text-forge-700 dark:text-forge-300 shrink-0">
                    {activeFlightRole === 'roam'
                      ? roamGrounded(project)
                        ? 'flight = 0'
                        : 'flight = 699'
                      : activeFlightRole === 'dig'
                        ? digRoleMode === 'native'
                          ? 'native'
                          : 'dig = true'
                        : 'sprite = 0'}
                  </code>
                </div>
              </div>

              {/* CENTER COLUMN: Interactive 50 Hz Pixel Viewport & Trajectory */}
              <div className="order-1 lg:order-2 flex flex-col items-center gap-3 w-full">
                <div className="relative w-full max-w-[360px] aspect-[300/260] border-2 border-stone-800 rounded-xl overflow-hidden shadow-lg bg-stone-950">
                  <canvas
                    ref={missileCanvasRef}
                    width={300}
                    height={260}
                    className="block w-full h-full cursor-pointer"
                    style={{ imageRendering: 'pixelated' }}
                    onClick={() => setIsMissilePlaying(!isMissilePlaying)}
                    title="Click canvas to toggle Play / Pause"
                  />

                  <div className="absolute top-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/75 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                    <span className="uppercase text-forge-400 font-bold">{activeAnim}</span>
                    <span>·</span>
                    <span>
                      Frame {activeFrameDisplay + 1}/{Math.max(1, activeFrames)}
                    </span>
                  </div>

                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] font-mono bg-black/75 backdrop-blur-xs text-stone-300 px-2 py-0.5 rounded border border-white/10">
                    <span>{isMissilePlaying ? 'Simulating Flight' : 'Paused'}</span>
                    <span>·</span>
                    <span className="text-stone-400 capitalize">{flightMode}</span>
                  </div>

                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-xs p-0.5 rounded border border-white/10 text-[10px]">
                    {(['grid', 'sky', 'cavern'] as const).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        onClick={() => setBackdropTheme(theme)}
                        className={`px-1.5 py-0.5 rounded capitalize cursor-pointer ${
                          backdropTheme === theme
                            ? 'bg-forge-600 text-white font-bold'
                            : 'text-stone-400 hover:text-white'
                        }`}
                      >
                        {theme}
                      </button>
                    ))}
                    <span className="w-px h-3 bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setShowDrumRef((v) => !v)}
                      aria-pressed={showDrumRef}
                      title="Toggle animated oil drum scale reference (20 frames, 20 fps)"
                      className={`px-1.5 py-0.5 rounded cursor-pointer ${
                        showDrumRef
                          ? 'bg-forge-600 text-white font-bold'
                          : 'text-stone-400 hover:text-white'
                      }`}
                    >
                      Drum
                    </button>
                  </div>
                </div>

                {/* Flight Path Selector + Inline Static Vector Sliders */}
                <div className="w-full max-w-[360px] space-y-2 bg-stone-50 dark:bg-stone-800/50 p-2 rounded-xl border border-stone-200 dark:border-stone-800">
                  <div className="grid grid-cols-4 gap-1 p-1 bg-stone-100 dark:bg-stone-900 rounded-lg text-xs font-medium">
                    {(
                      [
                        { id: 'arc', label: 'Arc', title: 'A thrown arc: heading and speed change along it.' },
                        { id: 'orbit', label: 'Orbit', title: 'A circle: every heading in turn.' },
                        { id: 'static', label: 'Static', title: 'One fixed vector, for reading the art.' },
                        {
                          id: 'walk',
                          label: 'Walk',
                          title:
                            'A roaming animal: ambling with no velocity (the art rests), then a hop up and down (the tilt clamps).',
                        },
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        title={mode.title}
                        onClick={() => setFlightMode(mode.id)}
                        className={`py-1 rounded text-[11px] text-center transition-colors cursor-pointer ${
                          flightMode === mode.id
                            ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white font-bold shadow-2xs'
                            : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  {flightMode === 'static' && (
                    <div className="grid grid-cols-2 gap-3 pt-1 px-1">
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px] font-medium text-stone-700 dark:text-stone-300">
                          <span>Angle</span>
                          <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                            {flightAngleDeg}°
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label="Static flight vector angle"
                          min={-90}
                          max={90}
                          step={5}
                          value={flightAngleDeg}
                          onChange={(e) => setFlightAngleDeg(Number(e.target.value))}
                          className="w-full accent-forge-500 cursor-pointer"
                        />
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px] font-medium text-stone-700 dark:text-stone-300">
                          <span>Speed</span>
                          <span className="font-mono text-forge-600 dark:text-forge-400 font-bold">
                            {flightSpeed} px/f
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label="Static flight vector speed"
                          min={2}
                          max={30}
                          step={1}
                          value={flightSpeed}
                          onChange={(e) => setFlightSpeed(Number(e.target.value))}
                          className="w-full accent-forge-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Playback & Zoom Bar */}
                <div className="flex items-center justify-between w-full max-w-[360px] gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMissilePlaying(!isMissilePlaying)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors cursor-pointer ${
                      isMissilePlaying
                        ? 'bg-amber-600 hover:bg-amber-700'
                        : 'bg-forge-600 hover:bg-forge-700'
                    }`}
                  >
                    {isMissilePlaying ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>{isMissilePlaying ? 'Pause Flight' : 'Resume Flight'}</span>
                  </button>

                  <div className="flex items-center gap-0.5 bg-stone-100 dark:bg-stone-800 p-1 rounded-lg border border-stone-200 dark:border-stone-700">
                    <button
                      type="button"
                      aria-label="Zoom out"
                      title="Zoom out (25% steps)"
                      disabled={missileZoom <= MISSILE_ZOOM_MIN}
                      onClick={() =>
                        setMissileZoom((z) => Math.max(MISSILE_ZOOM_MIN, z - MISSILE_ZOOM_STEP))
                      }
                      className="p-1 rounded text-stone-600 dark:text-stone-400 hover:bg-white hover:text-stone-900 dark:hover:bg-stone-700 dark:hover:text-white disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Reset zoom to 1:1"
                      title="Game pixels: 100% is WA's own sprite size. Click to reset."
                      onClick={() => setMissileZoom(MISSILE_ZOOM_1X)}
                      className="min-w-[46px] px-1 py-0.5 rounded text-[11px] font-mono font-semibold text-stone-700 dark:text-stone-300 hover:bg-white dark:hover:bg-stone-700 hover:text-stone-900 dark:hover:text-white cursor-pointer"
                    >
                      {Math.round((missileZoom / MISSILE_ZOOM_1X) * 100)}%
                    </button>
                    <button
                      type="button"
                      aria-label="Zoom in"
                      title="Zoom in (25% steps)"
                      disabled={missileZoom >= MISSILE_ZOOM_MAX}
                      onClick={() =>
                        setMissileZoom((z) => Math.min(MISSILE_ZOOM_MAX, z + MISSILE_ZOOM_STEP))
                      }
                      className="p-1 rounded text-stone-600 dark:text-stone-400 hover:bg-white hover:text-stone-900 dark:hover:bg-stone-700 dark:hover:text-white disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Role Config, Anim Mode Grid, Sheet Animation & Lua Call */}
              <div className="order-2 lg:order-3 flex flex-col gap-3.5">
                {/* 1. Role Overrides & Behavior */}
                <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-200/70 dark:border-stone-700/70">
                    <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
                      Role Overrides & Behavior
                    </span>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300">
                      wf-lib/wfws_sprite_builder
                    </span>
                  </div>

                  {!builderOn && !isAirStrike && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
                      Enable <strong>Missile Flight Sprite</strong> above to emit <code className="font-mono">sb.flight</code> in the Lua bundle.
                    </p>
                  )}

                  {activeFlightRole === 'primary' && (
                    <div className="space-y-2.5 text-xs">
                      {digMainEnabled && (
                        <div className="p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-stone-600 dark:text-stone-300">
                            Digging probe is{' '}
                            <strong className="font-mono">
                              {digRoleMode === 'native' ? 'native' : 'enabled (dig = true)'}
                            </strong>
                            .
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveFlightRole('dig')}
                            className="px-2 py-1 rounded text-[11px] font-semibold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50 cursor-pointer shrink-0"
                          >
                            Open Dig Tab
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activeFlightRole === 'homing' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Primary Homing Art Mode
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(['native', 'builder', 'inherit'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={!builderOn}
                              onClick={() => updateBehaviorArt('homing', { mode: m })}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize cursor-pointer disabled:opacity-50 ${
                                homingRole.mode === m
                                  ? 'bg-forge-600 text-white shadow-2xs'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(() => {
                        const armMs = project.body.homing_arm_ms ?? 0;
                        const timeMs = project.body.homing_time_ms ?? 0;
                        return (
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            Timed window from Record Editor: <strong className="font-mono">{armMs} ms</strong>{' '}
                            to{' '}
                            <strong className="font-mono">
                              {timeMs > 0 ? `${armMs + timeMs} ms` : 'impact'}
                            </strong>
                            . In <span className="font-semibold">Builder</span> mode, WA’s{' '}
                            <code className="font-mono">missile.homing.sprite</code> is zeroed and this sheet swaps in during guidance.
                          </p>
                        );
                      })()}
                    </div>
                  )}

                  {activeFlightRole === 'homing_bit' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Homing Clustlet Art Mode
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(['native', 'builder', 'inherit'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={!builderOn}
                              onClick={() => updateBehaviorArt('homing_bit', { mode: m })}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize cursor-pointer disabled:opacity-50 ${
                                homingBitRole.mode === m
                                  ? 'bg-forge-600 text-white shadow-2xs'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(() => {
                        const armMs = project.body.clustlet.homing_arm_ms ?? 0;
                        const timeMs = project.body.clustlet.homing_time_ms ?? 0;
                        return (
                          <p className="text-[11px] text-stone-500 dark:text-stone-400">
                            Cluster bit homing window: <strong className="font-mono">{armMs} ms</strong>{' '}
                            to{' '}
                            <strong className="font-mono">
                              {timeMs > 0 ? `${armMs + timeMs} ms` : 'impact'}
                            </strong>
                            . Emits <code className="font-mono">bits.homing = &#123; ... &#125;</code> and zeroes{' '}
                            <code className="font-mono">clusters.bit.homing.sprite</code>.
                          </p>
                        );
                      })()}

                      {homingBitRole.mode === 'builder' && bitFlight.mode !== 'builder' && (
                        <div className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px]">
                            <code className="font-mono">bits.homing</code> requires{' '}
                            <strong>Cluster Bits (Slot 3)</strong> in <strong>Builder</strong> mode (currently{' '}
                            <code className="font-mono">{bitFlight.mode}</code>).
                          </span>
                          <button
                            type="button"
                            onClick={() => updateBitFlight({ mode: 'builder' })}
                            className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer shrink-0"
                          >
                            Enable Bit Builder
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activeFlightRole === 'clusters' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Cluster Bit Art Mode
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(['native', 'builder', 'inherit'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              disabled={!builderOn}
                              onClick={() => updateBitFlight({ mode: m })}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize cursor-pointer disabled:opacity-50 ${
                                bitFlight.mode === m
                                  ? 'bg-forge-600 text-white shadow-2xs'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      <p className="text-[11px] text-stone-500 dark:text-stone-400">
                        Child bomblets after burst: <strong>Native</strong> keeps WA’s clustlet sheet, <strong>Builder</strong> draws a dedicated sheet, <strong>Inherit</strong> reuses the primary sheet.
                      </p>

                      {digBitEnabled && (
                        <div className="p-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-stone-600 dark:text-stone-300">
                            Bit digging probe is{' '}
                            <strong className="font-mono">
                              {digRoleMode === 'native' ? 'native' : 'enabled (dig = true)'}
                            </strong>
                            .
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveFlightRole('dig')}
                            className="px-2 py-1 rounded text-[11px] font-semibold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50 cursor-pointer shrink-0"
                          >
                            Open Dig Tab
                          </button>
                        </div>
                      )}

                      {bitBuilderMode(project) === 'builder' && project.packArt?.cluster_sprite && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-2.5 py-1.5">
                          The native <code className="font-mono">cluster.sprite</code> upload in Burst Payload is skipped while the bit builder owns the bits.
                        </p>
                      )}
                    </div>
                  )}

                  {activeFlightRole === 'dig' && (
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-stone-700 dark:text-stone-300">
                          Digging Terrain Probe
                        </span>
                        <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 rounded-lg border border-stone-200 dark:border-stone-700">
                          <button
                            type="button"
                            disabled={!builderOn}
                            onClick={() => updateBehaviorArt('dig', { mode: 'native' })}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${
                              digRoleMode === 'native'
                                ? 'bg-forge-600 text-white shadow-2xs'
                                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                            }`}
                          >
                            Native
                          </button>
                          <button
                            type="button"
                            disabled={!builderOn}
                            onClick={() => updateBehaviorArt('dig', { mode: 'builder' })}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${
                              digRoleMode !== 'native'
                                ? 'bg-forge-600 text-white shadow-2xs'
                                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                            }`}
                          >
                            Probe
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-stone-500 dark:text-stone-400">
                        Active for{' '}
                        <strong>
                          {digMainEnabled && digBitEnabled
                            ? 'Primary Round & Cluster Bits'
                            : digMainEnabled
                              ? 'Primary Round'
                              : 'Cluster Bits'}
                        </strong>
                        .{' '}
                        {digRoleMode === 'native'
                          ? 'Native keeps WA’s record dig sprites (dig.dive_sprite / sprite_1..3).'
                          : 'Overrides the owning sheet’s rotation, spin rate, anim speed, and scale only while 4 terrain probes detect solid land; reverts seamlessly in open air.'}
                      </p>

                      {digRoleMode !== 'native' &&
                        digArtOverrideRows(behaviorArt.dig, '').length > 0 && (
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-[11px] text-orange-700 dark:text-orange-300 font-medium">
                              Custom underground animation overrides active
                            </span>
                            <button
                              type="button"
                              onClick={() => updateBehaviorArt('dig', { ...DEFAULT_DIG_ROLE_ART })}
                              className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white underline cursor-pointer"
                            >
                              Reset to defaults
                            </button>
                          </div>
                        )}

                      {digRoleMode !== 'native' &&
                        digBitEnabled &&
                        !digMainEnabled &&
                        bitFlight.mode === 'native' && (
                          <div className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px]">
                              Cluster Bits (Slot 3) is currently <strong>Native</strong>, so bit dig sprites are left to WA.
                            </span>
                            <button
                              type="button"
                              onClick={() => updateBitFlight({ mode: 'builder' })}
                              className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer shrink-0"
                            >
                              Enable Bit Builder
                            </button>
                          </div>
                        )}
                    </div>
                  )}

                  {activeFlightRole === 'roam' && (
                    <div className="space-y-3 text-xs">
                      {/* The flying animal's art: the round's own sheet, or a
                          role of its own. WA walks the animal until Space in
                          both cases (`roam = { walk, fly }`). */}
                      <div className="space-y-1">
                        <span className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                          Flying art
                        </span>
                        <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700">
                          {(
                            [
                              { id: 'inherit', label: 'Round’s sheet' },
                              { id: 'builder', label: 'Own sheet' },
                            ] as const
                          ).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                updateBehaviorArt('roam', { mode: option.id as FlightRoleArt['mode'] })
                              }
                              className={`py-1.5 font-medium rounded-md transition-colors ${
                                roamRoleMode === option.id
                                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-stone-500 dark:text-stone-400">
                          {roamRoleMode === 'builder'
                            ? 'After Space the animal draws this slot’s sheet, with the animation, frames, spin and scale below. WA still walks it on the ground.'
                            : 'After Space the animal keeps the round’s own sheet (Slot 1), so its animation, frames, spin and scale are Slot 1’s; the controls below are read-only here. Pick Own sheet to give the flown state separate art.'}
                        </p>
                      </div>
                      {builderOn && (
                        <div className="space-y-2">
                          <p className="text-[11px] rounded-lg border border-amber-300/70 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-amber-800 dark:text-amber-200">
                            {roamGrounded(project)
                              ? 'This animal stays on the ground: the export writes 0 to sheep.flight_1/2 and sends no roam table, so Space never takes off. The native strips below are not installed.'
                              : 'The flight builder owns the takeoff (roam): it waits for Space and writes the 699 sentinel to sheep.flight_1/2, so the two native strips below are not installed. Turn the builder off to export them instead.'}
                          </p>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 dark:border-stone-700 dark:bg-stone-900">
                            <input
                              type="checkbox"
                              checked={roamGrounded(project)}
                              onChange={(e) => {
                                const grounded = e.target.checked;
                                onChange({
                                  roamConfig: {
                                    ...project.roamConfig,
                                    grounded,
                                    ...(grounded
                                      ? { flight_1: 0, flight_2: 0 }
                                      : { flight_1: ROAM_FLY_SENTINEL, flight_2: ROAM_FLY_SENTINEL }),
                                  },
                                });
                              }}
                              className="h-3.5 w-3.5 rounded text-forge-600 focus:ring-forge-500"
                            />
                            <span className="text-xs font-medium text-stone-800 dark:text-stone-100">
                              Keep this animal on the ground (no Space takeoff)
                            </span>
                          </label>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <RoamSheetField
                          id="roam-sheet-1"
                          label="Flying sheet 1 (`flight_1`)"
                          asset={project.roamSheets?.flight1}
                          path={roamSheetPath(project, 'flight1')}
                          onChange={(asset) =>
                            onChange({
                              roamSheets: {
                                ...project.roamSheets,
                                flight1: asset,
                                flight2: project.roamSheets?.flight2 ?? {},
                              },
                            })
                          }
                        />
                        <RoamSheetField
                          id="roam-sheet-2"
                          label="Flying sheet 2 (`flight_2`)"
                          asset={project.roamSheets?.flight2}
                          path={roamSheetPath(project, 'flight2')}
                          onChange={(asset) =>
                            onChange({
                              roamSheets: {
                                ...project.roamSheets,
                                flight2: asset,
                                flight1: project.roamSheets?.flight1 ?? {},
                              },
                            })
                          }
                        />
                      </div>
                      {!!project.roamSheets?.flight1?.file !== !!project.roamSheets?.flight2?.file && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          Both sheets are required for <code className="font-mono">sheep_sprites</code>.
                        </p>
                      )}
                      <StockSpriteInput
                        id="roam-gas-pose"
                        label="Gas pose (`roam.gas.animal_sprite`)"
                        numeric
                        placeholder="0"
                        value={project.roamConfig?.gas_animal_sprite ?? 0}
                        onChange={(v) =>
                          // Only an id reaches here; the guard keeps a NaN out of the record regardless.
                          Number.isFinite(Number(v)) &&
                          onChange({
                            roamConfig: {
                              ...project.roamConfig,
                              gas_animal_sprite: v === '' ? 0 : Number(v),
                            },
                          })
                        }
                        desc={`Native ids: flight_1 ${project.roamConfig?.flight_1 ?? 0} (${stockSpriteName(project.roamConfig?.flight_1 ?? 0) ?? 'unused'}), flight_2 ${project.roamConfig?.flight_2 ?? 0} (${stockSpriteName(project.roamConfig?.flight_2 ?? 0) ?? 'unused'}).`}
                      />
                    </div>
                  )}
                </div>

                {/* 2. Animation Mode 3x2 Grid */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wide flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-forge-600 dark:text-forge-400" />
                      <span>Animation Mode (opts.anim)</span>
                    </span>
                    <span className="text-[10px] font-mono font-bold text-forge-700 dark:text-forge-300 bg-forge-50 dark:bg-forge-950/60 px-1.5 py-0.5 rounded border border-forge-200 dark:border-forge-800/60">
                      {animCodeMap[activeAnim]}
                    </span>
                  </div>

                  <div
                    className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${
                      activeSheetLocked ? 'opacity-50 pointer-events-none' : ''
                    }`}
                  >
                    {(
                      [
                        { id: 'track', name: 'Track Vector', sub: 'Points flight angle', code: 'track = 2' },
                        { id: 'rotation', name: 'Speed Tumble', sub: 'Velocity spin', code: 'rotation = 3' },
                        { id: 'slow', name: 'Slow Spin', sub: '0.5 rad/f spin', code: 'slow = 1' },
                        { id: 'medium', name: 'Medium Spin', sub: '0.8 rad/f spin', code: 'medium = 1' },
                        { id: 'fast', name: 'Fast Spin', sub: '1.35 rad/f spin', code: 'fast = 1' },
                        { id: 'roam', name: 'Roam Tilt', sub: 'Rests flat, tracks in flight', code: 'roam = 4' },
                        { id: 'none', name: 'Fixed Upright', sub: 'Locked 0° turn', code: 'none = 5' },
                      ] as const
                    ).map((item) => {
                      const isSelected = activeAnim === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={activeSheetLocked}
                          onClick={() => updateActiveRoleParams({ anim: item.id })}
                          className={`relative p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'border-forge-500 bg-forge-50/40 dark:bg-forge-950/30 ring-1 ring-forge-500'
                              : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-700'
                          }`}
                        >
                          {isSelected && (
                            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-xs bg-forge-600" />
                          )}
                          <div
                            className={`text-xs font-bold leading-tight pr-3 ${
                              isSelected
                                ? 'text-forge-700 dark:text-forge-300'
                                : 'text-stone-800 dark:text-stone-200'
                            }`}
                          >
                            {item.name}
                          </div>
                          <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight">
                            {item.sub}
                          </div>
                          <div className="text-[10px] font-mono text-stone-400 mt-1">
                            {item.code}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Flight Sheet Animation Card */}
                <div
                  className={`p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 space-y-2.5 ${
                    activeSheetLocked ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wider">
                      Flight Sheet Animation
                    </span>
                    <span className="text-[10px] font-mono text-stone-400">50 Hz loop</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-num-frames"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Total Frames
                      </label>
                      <NumberInput
                        id="flight-num-frames"
                        min={1}
                        max={64}
                        disabled={activeSheetLocked}
                        value={activeFrames}
                        onChange={(e) =>
                          updateActiveRoleParams({ frames: Math.max(1, Number(e.target.value)) })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>

                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-anim-speed"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Anim Speed
                      </label>
                      <NumberInput
                        id="flight-anim-speed"
                        step={0.1}
                        min={0.1}
                        max={10.0}
                        disabled={activeSheetLocked}
                        value={activeAnimSpeed}
                        onChange={(e) =>
                          updateActiveRoleParams({
                            animSpeed: Math.max(0.1, Number(e.target.value)),
                          })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>

                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-spin-rate"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Spin Rate
                      </label>
                      <NumberInput
                        id="flight-spin-rate"
                        step={0.1}
                        min={0.1}
                        max={10.0}
                        disabled={activeSheetLocked}
                        value={activeSpinRate}
                        onChange={(e) =>
                          updateActiveRoleParams({
                            spinRate: Math.max(0.1, Number(e.target.value)),
                          })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>

                    <div className="space-y-1 text-center">
                      <label
                        htmlFor="flight-z-depth"
                        className="block text-[11px] font-medium text-stone-600 dark:text-stone-400"
                      >
                        Depth (z)
                      </label>
                      <NumberInput
                        id="flight-z-depth"
                        step={0.5}
                        min={0}
                        max={20}
                        disabled={activeSheetLocked}
                        value={activeZ}
                        onChange={(e) =>
                          updateActiveRoleParams({ z: Math.max(0, Number(e.target.value)) })
                        }
                        className="w-full text-xs font-mono text-center px-2 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-white"
                      />
                    </div>
                  </div>

                  {/* `height % frames` must be 0 or the engine fails the load.
                      Only an uploaded sheet can be wrong: the default art is
                      stacked from the file, so it always divides. */}
                  <SheetFrameWarning preview={activeSheetPreview} frames={activeFrames} />

                  {/* PingPong: one checkbox, the explanation lives in the tooltip
                      so the card stays a compact row. */}
                  <label
                    title="Plays the strip forwards and then back (0, 1, 2, 1, 0, ...) instead of snapping to frame 0, so art authored to reverse itself animates smoothly. One pass forwards and back takes the same time as one loop, so Anim Speed keeps its meaning. Needs more than one frame; emitted as pingpong = true."
                    className={`flex items-center gap-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-2.5 py-1.5 ${
                      activeSheetLocked
                        ? 'opacity-50 pointer-events-none'
                        : 'cursor-pointer hover:border-stone-300 dark:hover:border-stone-600'
                    }`}
                  >
                    <input
                      id="flight-pingpong"
                      type="checkbox"
                      checked={activePingpong}
                      disabled={activeSheetLocked}
                      onChange={(e) => updateActiveRoleParams({ pingpong: e.target.checked })}
                      className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                    />
                    <span className="text-[11px] font-medium text-stone-700 dark:text-stone-200">
                      PingPong
                    </span>
                    <span className="font-mono text-[10px] text-stone-400">
                      {activePingpong && activeFrames > 1 ? 'pingpong = true' : 'off'}
                    </span>
                    {activeFrames <= 1 && (
                      <span className="ml-auto text-[10px] text-stone-400">
                        needs 2+ frames
                      </span>
                    )}
                  </label>
                </div>

                {/* 4. Generated Lua Code Box + Copy Button */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-medium text-stone-500 dark:text-stone-400">
                      Generated Lua <code className="text-stone-700 dark:text-stone-300">sb.flight</code> Call
                    </span>
                    <button
                      type="button"
                      onClick={handleCopySbLua}
                      className="text-[11px] font-medium text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 px-2.5 py-1 rounded-lg border border-stone-200 dark:border-stone-700 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      {copiedSbLua ? (
                        <Check className="w-3.5 h-3.5 text-forge-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
                      )}
                      <span>{copiedSbLua ? 'Copied' : 'Copy Lua'}</span>
                    </button>
                  </div>
                  <pre className="text-xs font-mono bg-stone-950 text-stone-100 p-3 rounded-lg overflow-x-auto border border-stone-800 leading-relaxed">
                    {sbFlightLuaPreview}
                  </pre>
                </div>
              </div>
            </div>
            </div>
            <FlightTrailModal
              open={trailModalOpen}
              onClose={() => setTrailModalOpen(false)}
              title={`${activeSlotMeta.label} Custom Trail`}
              subtitle={activeSlotMeta.title}
              sheetPath={flightTrailSheetPath(project, trailRoleKey)}
              // An overridable role that still inherits opens Off: turning
              // the brush on is what gives it its own pool, even though the
              // row above mirrors the inherited trail as active.
              trail={trailInherits ? { ...trailConfig, enabled: false } : trailConfig}
              onChange={updateActiveTrail}
            />
          </div>
        );
      })()}
    </div>
  );
};
