import React, { useEffect, useRef, useState } from 'react';
import { Gauge, Layers, Sparkles, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import type { FlightTrailConfig, FlightTrailDepth, FlightTrailPlayMode, FlightTrailRotateMode } from '../types/weapon';
import { FLIGHT_TRAIL_PRESETS, mergeFlightTrailConfig } from '../data/flightTrail';
import { imagePixelSize } from '../utils/imagePixelSize';
import { SheetFrameWarning } from './SheetFrameWarning';
import { SpritePickButton } from './SpritePickButton';

interface FlightTrailModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  sheetPath: string;
  trail: FlightTrailConfig;
  onChange: (patch: Partial<FlightTrailConfig>) => void;
}

const RangeField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, suffix = '', onChange }) => (
  <label className="block space-y-1">
    <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-stone-600 dark:text-stone-300">
      <span>{label}</span>
      <span className="font-mono tabular-nums text-forge-600 dark:text-forge-400">
        {value}
        {suffix}
      </span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-1.5 w-full cursor-pointer accent-forge-600"
    />
  </label>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="block space-y-1">
    <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full cursor-pointer rounded-lg border border-stone-300 bg-white px-2 text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
    >
      {children}
    </select>
  </label>
);

/**
 * Count leading transparent frames on a vertical sprite strip so multi-frame
 * WA/PX trail strips whose frame 0 is blank start immediately behind the round.
 */
async function detectLeadingBlankFrames(previewUrl: string, frames: number): Promise<number> {
  if (frames <= 1 || typeof document === 'undefined') return 0;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('load failed'));
      el.src = previewUrl;
    });
    const w = img.naturalWidth;
    const cellH = Math.floor(img.naturalHeight / frames);
    if (w <= 0 || cellH <= 0) return 0;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = cellH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    let leading = 0;
    for (let f = 0; f < frames; f += 1) {
      ctx.clearRect(0, 0, w, cellH);
      ctx.drawImage(img, 0, f * cellH, w, cellH, 0, 0, w, cellH);
      const data = ctx.getImageData(0, 0, w, cellH).data;
      let visible = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 8) {
          visible = true;
          break;
        }
      }
      if (visible) break;
      leading += 1;
    }
    return leading >= frames ? 0 : leading;
  } catch {
    return 0;
  }
}

/**
 * One brush trail, edited away from the flight workbench. The modal writes
 * every knob through `onChange`, so the parent owns the role and the preview
 * stays live while the panel is open.
 */
export const FlightTrailModal: React.FC<FlightTrailModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  sheetPath,
  trail,
  onChange,
}) => {
  const [tab, setTab] = useState<'shape' | 'motion'>('shape');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = mergeFlightTrailConfig(trail);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const applyFile = async (file: File, framesHint?: number) => {
    const preview = URL.createObjectURL(file);
    const frames = Math.max(1, Math.round(framesHint ?? t.frames));
    try {
      const px = await imagePixelSize(preview);
      const startFrame = frames > 1 ? await detectLeadingBlankFrames(preview, frames) : 0;
      if (t.sheetPreview?.startsWith('blob:')) URL.revokeObjectURL(t.sheetPreview);
      onChange({
        enabled: true,
        sheetFile: file,
        sheetPreview: preview,
        frames,
        startFrame,
        cellW: px.width,
        cellH: Math.max(1, Math.round(px.height / frames)),
      });
    } catch {
      URL.revokeObjectURL(preview);
    }
  };

  const applyFrames = async (raw: number) => {
    const frames = Math.max(1, Math.min(64, Math.round(raw) || 1));
    let cellH = t.cellH;
    let startFrame = 0;
    if (t.sheetPreview) {
      try {
        const px = await imagePixelSize(t.sheetPreview);
        cellH = Math.max(1, Math.round(px.height / frames));
        if (frames > 1) {
          startFrame = await detectLeadingBlankFrames(t.sheetPreview, frames);
        }
      } catch {
        cellH = Math.max(1, Math.round(t.cellH));
      }
    }
    onChange({ frames, startFrame, cellH });
  };

  const clearSheet = () => {
    if (t.sheetPreview?.startsWith('blob:')) URL.revokeObjectURL(t.sheetPreview);
    onChange({ sheetFile: undefined, sheetPreview: undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs sm:p-5">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/80 px-5 py-3 dark:border-stone-800 dark:bg-stone-950/60">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
              <span className="rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-[10px] text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
                wa.draw.brush
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
              <input
                type="checkbox"
                checked={t.enabled}
                onChange={(event) => onChange({ enabled: event.target.checked })}
                className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
              />
              Enable Custom Trail
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close trail editor"
              className="cursor-pointer rounded-lg p-1.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              <Sparkles className="h-3.5 w-3.5" />
              Quick Presets
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {FLIGHT_TRAIL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.hint}
                  onClick={() => onChange({ ...preset.patch, enabled: true })}
                  className="cursor-pointer rounded-lg border border-stone-200 bg-stone-50/70 px-2.5 py-2 text-left transition-colors hover:border-forge-400 hover:bg-forge-50/60 dark:border-stone-700 dark:bg-stone-950/40 dark:hover:border-forge-600 dark:hover:bg-forge-950/30"
                >
                  <div className="text-xs font-semibold text-stone-800 dark:text-stone-100">
                    {preset.name}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[10px] text-stone-500 dark:text-stone-400">
                    {preset.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 p-3.5 dark:border-stone-700">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              <Upload className="h-3.5 w-3.5" />
              Sprite Sheet
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void applyFile(file);
                }}
                onClick={() => fileRef.current?.click()}
                className={`flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors ${
                  dragging
                    ? 'border-forge-500 bg-forge-50/70 dark:bg-forge-950/40'
                    : 'border-stone-300 bg-stone-100/70 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-950/50'
                }`}
              >
                {t.sheetPreview ? (
                  <img
                    src={t.sheetPreview}
                    alt="Trail sprite sheet"
                    className="h-full w-full object-contain p-1"
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <span className="px-1 text-center text-[10px] leading-tight text-stone-500 dark:text-stone-400">
                    Drop PNG
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/gif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void applyFile(file);
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="cursor-pointer rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                  >
                    Upload PNG
                  </button>
                  <SpritePickButton accept="image" label="Pick Trail Sprite" onPick={applyFile} />
                  {t.sheetPreview && (
                    <button
                      type="button"
                      onClick={clearSheet}
                      className="flex cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  )}
                </div>
                <p className="truncate font-mono text-[10px] text-stone-500 dark:text-stone-400" title={sheetPath}>
                  {sheetPath}
                </p>
                <p className="text-[10px] leading-snug text-stone-500 dark:text-stone-400">
                  A single PNG needs no frame count. A vertical strip slices into {t.frames} cells of{' '}
                  {t.cellW}x{t.cellH}.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Frames</span>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={t.frames}
                  onChange={(event) => void applyFrames(Number(event.target.value))}
                  className="h-8 w-full rounded-lg border border-stone-300 bg-white px-2 font-mono text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                />
              </label>
              <SelectField label="Play Mode" value={t.playMode} onChange={(value) => onChange({ playMode: value as FlightTrailPlayMode })}>
                <option value="lifetime">Match Lifetime</option>
                <option value="loop">Loop</option>
                <option value="pingpong">Ping-Pong</option>
                <option value="random">Random Frame</option>
              </SelectField>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">FPS</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={t.fps}
                  onChange={(event) => onChange({ fps: Number(event.target.value) })}
                  className="h-8 w-full rounded-lg border border-stone-300 bg-white px-2 font-mono text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Cell W x H</span>
                <div className="flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2 font-mono text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300">
                  <input
                    type="number"
                    min={1}
                    max={512}
                    value={t.cellW}
                    onChange={(event) => onChange({ cellW: Number(event.target.value) })}
                    className="w-full bg-transparent text-right outline-none"
                  />
                  <span className="text-stone-400">x</span>
                  <input
                    type="number"
                    min={1}
                    max={512}
                    value={t.cellH}
                    onChange={(event) => onChange({ cellH: Number(event.target.value) })}
                    className="w-full bg-transparent outline-none"
                  />
                </div>
              </label>
            </div>
            <SheetFrameWarning preview={t.sheetPreview} frames={t.frames} className="mt-2" />
            {t.frames > 1 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50/70 px-2.5 py-1.5 dark:border-stone-700 dark:bg-stone-950/40">
                <label className="flex items-center gap-2 text-[11px] font-medium text-stone-600 dark:text-stone-300">
                  <span>Start Frame</span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, t.frames - 1)}
                    value={t.startFrame ?? 0}
                    onChange={(event) => onChange({ startFrame: Number(event.target.value) })}
                    className="h-7 w-16 rounded-md border border-stone-300 bg-white px-2 font-mono text-xs text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                  />
                </label>
                <span className="text-[10px] text-stone-500 dark:text-stone-400">
                  {(t.startFrame ?? 0) > 0
                    ? `Skipping ${t.startFrame} leading blank frame(s) so puffs appear immediately behind the round.`
                    : 'Set to 1 if frame 0 is blank (common on WA/PX trail strips).'}
                </span>
              </div>
            )}
            {t.frames === 1 && (
              <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 text-[10px] leading-snug text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                A single frame still animates: fade-out, scale-out, tint gradient and spin all move it.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-stone-200 p-3.5 dark:border-stone-700">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              <Gauge className="h-3.5 w-3.5" />
              Original Game Trail Controls
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <RangeField label="Density" value={t.power} min={0} max={100} step={1} onChange={(power) => onChange({ power })} />
              <RangeField label="Ejection Speed" value={t.speed} min={0} max={500} step={5} onChange={(speed) => onChange({ speed })} />
              <RangeField label="Bubbles / sec" value={t.bubblesPerSecond} min={0} max={16} step={0.25} onChange={(bubblesPerSecond) => onChange({ bubblesPerSecond })} />
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-stone-600 dark:text-stone-300">
              <input
                type="checkbox"
                checked={t.hideNativeTrail}
                onChange={(event) => onChange({ hideNativeTrail: event.target.checked })}
                className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
              />
              Hide the native WA trail while this brush is on
            </label>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-100/70 p-0.5 dark:border-stone-700 dark:bg-stone-950/50">
            <button
              type="button"
              onClick={() => setTab('shape')}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'shape'
                  ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-800 dark:text-white'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Shape and Fade
            </button>
            <button
              type="button"
              onClick={() => setTab('motion')}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'motion'
                  ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-800 dark:text-white'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Physics and Nozzle
            </button>
          </div>

          {tab === 'shape' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <RangeField label="Lifetime" value={t.lifeFrames} min={4} max={180} step={1} suffix=" ticks" onChange={(lifeFrames) => onChange({ lifeFrames })} />
                <RangeField label="Lifetime Jitter" value={t.lifeJitter} min={0} max={0.8} step={0.05} onChange={(lifeJitter) => onChange({ lifeJitter })} />
                <RangeField label="Start Scale" value={t.scaleStart} min={0.1} max={6} step={0.05} suffix="x" onChange={(scaleStart) => onChange({ scaleStart })} />
                <RangeField label="End Scale" value={t.scaleEnd} min={0} max={6} step={0.05} suffix="x" onChange={(scaleEnd) => onChange({ scaleEnd })} />
                <RangeField label="Start Alpha" value={t.alphaStart} min={0} max={1} step={0.01} onChange={(alphaStart) => onChange({ alphaStart })} />
                <RangeField label="End Alpha" value={t.alphaEnd} min={0} max={1} step={0.01} onChange={(alphaEnd) => onChange({ alphaEnd })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectField label="Rotation" value={t.rotateMode} onChange={(value) => onChange({ rotateMode: value as FlightTrailRotateMode })}>
                  <option value="none">None</option>
                  <option value="random">Random</option>
                  <option value="align">Align Velocity</option>
                  <option value="missile">Match Missile</option>
                </SelectField>
                <div className="grid grid-cols-2 gap-2">
                  <RangeField label="Spin Min" value={t.spinMin} min={-30} max={30} step={0.5} onChange={(spinMin) => onChange({ spinMin })} />
                  <RangeField label="Spin Max" value={t.spinMax} min={-30} max={30} step={0.5} onChange={(spinMax) => onChange({ spinMax })} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-end gap-2">
                  <label className="flex-1 space-y-1">
                    <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Start Tint</span>
                    <input
                      type="color"
                      value={t.color}
                      onChange={(event) => onChange({ color: event.target.value })}
                      className="h-8 w-full cursor-pointer rounded-lg border border-stone-300 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-900"
                    />
                  </label>
                  <label className="flex flex-1 items-center gap-1.5 pb-1.5 text-[11px] text-stone-600 dark:text-stone-300">
                    <input
                      type="checkbox"
                      checked={!!t.colorEnd}
                      onChange={(event) => onChange({ colorEnd: event.target.checked ? t.color : '' })}
                      className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                    />
                    Fade to a second tint
                  </label>
                </div>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">End Tint</span>
                  <input
                    type="color"
                    disabled={!t.colorEnd || t.rainbow}
                    value={t.colorEnd || t.color}
                    onChange={(event) => onChange({ colorEnd: event.target.value })}
                    className="h-8 w-full cursor-pointer rounded-lg border border-stone-300 bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SelectField label="Blend" value={t.blend} onChange={(value) => onChange({ blend: value as 'alpha' | 'add' })}>
                  <option value="add">Additive</option>
                  <option value="alpha">Alpha</option>
                </SelectField>
                <SelectField label="Depth" value={t.depth} onChange={(value) => onChange({ depth: value as FlightTrailDepth })}>
                  <option value="BEHIND">Behind</option>
                  <option value="EFFECTS">Effects</option>
                  <option value="FRONT">Front</option>
                </SelectField>
                <label className="flex items-center gap-1.5 pt-5 text-[11px] text-stone-600 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={t.rainbow}
                    onChange={(event) => onChange({ rainbow: event.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer rounded text-forge-600 focus:ring-forge-500"
                  />
                  Rainbow hue
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <RangeField label="Gravity" value={t.gravity} min={-2} max={2} step={0.01} onChange={(gravity) => onChange({ gravity })} />
                <RangeField label="Drag" value={t.drag} min={0.75} max={1} step={0.005} onChange={(drag) => onChange({ drag })} />
                <RangeField label="Cone Spread" value={t.spreadDeg} min={0} max={360} step={1} suffix=" deg" onChange={(spreadDeg) => onChange({ spreadDeg })} />
                <RangeField label="Spawn Jitter" value={t.jitterPx} min={0} max={24} step={0.5} suffix=" px" onChange={(jitterPx) => onChange({ jitterPx })} />
                <RangeField label="Inherit Velocity" value={t.inheritVel} min={-0.5} max={1} step={0.01} onChange={(inheritVel) => onChange({ inheritVel })} />
                <RangeField label="Max Particles" value={t.maxParticles} min={16} max={512} step={1} onChange={(maxParticles) => onChange({ maxParticles })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <RangeField label="Nozzle Offset X" value={t.offsetX} min={-128} max={128} step={1} suffix=" px" onChange={(offsetX) => onChange({ offsetX })} />
                <RangeField label="Nozzle Offset Y" value={t.offsetY} min={-128} max={128} step={1} suffix=" px" onChange={(offsetY) => onChange({ offsetY })} />
              </div>
              <p className="rounded-lg border border-stone-200 bg-stone-50/70 px-2.5 py-1.5 text-[10px] leading-snug text-stone-500 dark:border-stone-700 dark:bg-stone-950/40 dark:text-stone-400">
                Offset is in sheet pixels, rotated with the missile heading. A positive Y pushes the
                exhaust toward the tail on art that points up.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-stone-200/80 bg-stone-50/80 px-5 py-2.5 dark:border-stone-800 dark:bg-stone-950/60">
          <span className="text-[10px] text-stone-500 dark:text-stone-400">
            Deterministic 50 Hz brush particles, capped at {t.maxParticles}.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-forge-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-forge-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
