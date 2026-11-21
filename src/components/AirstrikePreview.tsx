import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw } from 'lucide-react';
import type { AirstrikeConfig } from '../types/weapon';
import {
  MAX_DEMO_PROJECTILES,
  SIM_GROUND_Y,
  SIM_WORLD_W,
  simulateAirstrikePreview,
  type SimPhase,
} from '../utils/airstrikeSim';

interface AirstrikePreviewProps {
  config: AirstrikeConfig;
  gravityPct?: number;
}

const CANVAS_W = 640;
const CANVAS_H = 228;
const WORLD_H = 440;

const PHASE_META: Record<SimPhase, { label: string; color: string; badge: string }> = {
  approach: {
    label: 'Approach',
    color: '#38bdf8',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  },
  slow: {
    label: 'Ease-In / Slow',
    color: '#f59e0b',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  },
  release: {
    label: 'Release',
    color: '#f43f5e',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  },
  recover: {
    label: 'Recover',
    color: '#a855f7',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
  },
  exit: {
    label: 'Exit',
    color: '#22c55e',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
  done: {
    label: 'Complete',
    color: '#94a3b8',
    badge: 'bg-stone-500/15 text-stone-300 border-stone-500/40',
  },
};

function drawPlaneSilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: 1 | -1,
  bankDeg: number,
  scale: number,
  stockSprite: string,
  alpha: number,
  isStrafe: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.rotate(((bankDeg * dir) * Math.PI) / 180);
  if (dir < 0) ctx.scale(-1, 1);
  const s = Math.max(0.45, Math.min(2.2, scale));
  ctx.scale(s, s);

  const hullColor =
    stockSprite === 'airjetb'
      ? '#38bdf8'
      : stockSprite === 'airjeto'
        ? '#fb923c'
        : stockSprite === 'postbox'
          ? '#ef4444'
          : stockSprite === 'shptruck' || stockSprite === 'cpttruck'
            ? '#eab308'
            : '#4ade80';

  if (stockSprite === 'postbox' || stockSprite === 'shptruck' || stockSprite === 'cpttruck') {
    // Carrier / box silhouette
    ctx.fillStyle = hullColor;
    ctx.strokeStyle = '#0c0a09';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(-17, -9, 34, 17, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(5, -6, 8, 6);
  } else {
    // Sleek jet / helicopter silhouette
    ctx.fillStyle = hullColor;
    ctx.strokeStyle = '#0c0a09';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(21, 1);
    ctx.lineTo(7, -5);
    ctx.lineTo(-10, -5);
    ctx.lineTo(-18, -12);
    ctx.lineTo(-21, -12);
    ctx.lineTo(-17, -2);
    ctx.lineTo(-20, 4);
    ctx.lineTo(13, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Canopy
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.ellipse(6, -2.5, 5, 2.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Engine exhaust glow
    ctx.fillStyle = 'rgba(251,146,60,0.85)';
    ctx.beginPath();
    ctx.moveTo(-19, 0);
    ctx.lineTo(-27, -2.5);
    ctx.lineTo(-24, 1);
    ctx.lineTo(-27, 3.5);
    ctx.closePath();
    ctx.fill();
  }

  // Strafe turret indicator
  if (isStrafe) {
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(4, 7, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Interactive 50 Hz preview for Lua Airstrike Takeover.
 * Shows ease-in / slow / release / recover / exit (or direct on-click spawn)
 * and demonstrates up to 4 representative projectiles (velocity, angle, cadence)
 * without simulating physics collisions or the full payload count.
 */
export const AirstrikePreview: React.FC<AirstrikePreviewProps> = ({
  config,
  gravityPct = 100,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [frameIdx, setFrameIdx] = useState(0);
  const [previewDir, setPreviewDir] = useState<1 | -1>(config.defaultDir);
  const [targetNormX, setTargetNormX] = useState(0.54);
  const [planeImage, setPlaneImage] = useState<HTMLImageElement | null>(null);

  // Keep preview direction synced when fixed direction mode changes
  useEffect(() => {
    if (config.direction === 'left') setPreviewDir(-1);
    else if (config.direction === 'right') setPreviewDir(1);
    else if (config.direction === 'arrows') setPreviewDir(config.defaultDir);
  }, [config.direction, config.defaultDir]);

  // Load uploaded custom plane sheet preview image when active
  const customUrl =
    config.plane.spriteMode === 'custom' ? config.plane.sheet?.previewUrl : undefined;
  useEffect(() => {
    if (!customUrl) {
      setPlaneImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setPlaneImage(img);
    img.onerror = () => setPlaneImage(null);
    img.src = customUrl;
  }, [customUrl]);

  const sim = useMemo(
    () =>
      simulateAirstrikePreview(config, {
        dir: previewDir,
        targetX: Math.round(targetNormX * SIM_WORLD_W),
        targetY: SIM_GROUND_Y - 12,
        gravityPct,
      }),
    [config, previewDir, targetNormX, gravityPct],
  );

  const totalFrames = Math.max(1, sim.frames.length);

  // Reset cursor when config changes length significantly
  useEffect(() => {
    setFrameIdx((prev) => (prev >= totalFrames ? 0 : prev));
  }, [totalFrames]);

  // 50 Hz lockstep playback clock
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const stepMs = 20;
    const loop = (now: number) => {
      acc += Math.min(100, now - last);
      last = now;
      if (acc >= stepMs) {
        const steps = Math.floor(acc / stepMs);
        acc -= steps * stepMs;
        setFrameIdx((prev) => (prev + steps) % totalFrames);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, totalFrames]);

  const activeFrame = sim.frames[Math.min(frameIdx, totalFrames - 1)] ?? sim.frames[0];

  // Draw the 50 Hz preview canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeFrame) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== CANVAS_W * dpr || canvas.height !== CANVAS_H * dpr) {
      canvas.width = CANVAS_W * dpr;
      canvas.height = CANVAS_H * dpr;
    }
    ctx.save();
    ctx.scale(dpr, dpr);

    const sx = (wx: number) => (wx / SIM_WORLD_W) * CANVAS_W;
    const sy = (wy: number) => (wy / WORLD_H) * CANVAS_H;

    // Sky backdrop
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.75, '#1e293b');
    grad.addColorStop(1, '#1c1917');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Subtle map grid lines
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    ctx.lineWidth = 1;
    for (let x = 64; x < CANVAS_W; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }

    // Sky altitude reference line
    const skyScreenY = sy(sim.skyY);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(148,163,184,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, skyScreenY);
    ctx.lineTo(CANVAS_W, skyScreenY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Stylized non-colliding terrain horizon strip at bottom
    const groundScreenY = sy(sim.groundY);
    ctx.fillStyle = 'rgba(68,64,60,0.45)';
    ctx.fillRect(0, groundScreenY, CANVAS_W, CANVAS_H - groundScreenY);
    ctx.strokeStyle = 'rgba(168,162,158,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, groundScreenY);
    ctx.lineTo(CANVAS_W, groundScreenY);
    ctx.stroke();

    // Release window band
    if (sim.configuredCount > 0) {
      const wx0 = sx(sim.dropWindowStartX);
      const wx1 = sx(sim.dropWindowEndX);
      const bandW = Math.max(4, wx1 - wx0);
      ctx.fillStyle = 'rgba(244,63,94,0.08)';
      ctx.fillRect(wx0, skyScreenY - 12, bandW, groundScreenY - skyScreenY + 12);
      ctx.strokeStyle = 'rgba(244,63,94,0.3)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(wx0, skyScreenY - 8);
      ctx.lineTo(wx0, groundScreenY);
      if (bandW > 6) {
        ctx.moveTo(wx1, skyScreenY - 8);
        ctx.lineTo(wx1, groundScreenY);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Aircraft flight path ribbon colored by phase
    if (sim.hasPlane) {
      for (let i = 1; i < sim.frames.length; i++) {
        const a = sim.frames[i - 1];
        const b = sim.frames[i];
        if (!a.hasPlane || !b.hasPlane) continue;
        const meta = PHASE_META[b.phase] ?? PHASE_META.approach;
        ctx.strokeStyle =
          i <= activeFrame.tick ? meta.color : `${meta.color}44`;
        ctx.lineWidth = i <= activeFrame.tick ? 2.2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
        ctx.stroke();
      }
    }

    // Clicked target reticle
    const tx = sx(sim.targetX);
    const ty = sy(sim.targetY);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(tx, ty, 7, 0, Math.PI * 2);
    ctx.moveTo(tx - 11, ty);
    ctx.lineTo(tx + 11, ty);
    ctx.moveTo(tx, ty - 11);
    ctx.lineTo(tx, ty + 11);
    ctx.stroke();

    // Direct payload click pulse ring
    if (!sim.hasPlane) {
      const pulse = Math.min(1, activeFrame.tick / 18);
      const originX = sx(activeFrame.x);
      const originY = sy(activeFrame.y);
      ctx.strokeStyle = `rgba(249,115,22,${(1 - pulse) * 0.85})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(originX, originY, 6 + pulse * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(249,115,22,0.85)';
      ctx.beginPath();
      ctx.arc(originX, originY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Up to 4 demo projectiles (velocity, angle, cadence, NO collisions)
    const nowTick = activeFrame.tick;
    for (let pIdx = 0; pIdx < sim.demoProjectiles.length; pIdx++) {
      const p = sim.demoProjectiles[pIdx];
      if (nowTick < p.spawnFrame) continue;
      const age = nowTick - p.spawnFrame;
      const maxAge = p.isStrafe ? 24 : 90;
      if (age > maxAge) continue;

      // Trajectory preview dotted curve
      ctx.save();
      ctx.beginPath();
      let cx = p.x0;
      let cy = p.y0;
      let cvx = p.vx;
      let cvy = p.vy;
      ctx.moveTo(sx(cx), sy(cy));
      const steps = Math.min(age, maxAge);
      for (let s = 1; s <= steps; s++) {
        if (p.chute) {
          cx += cvx + Math.sin(s * 0.16 + pIdx) * 0.65;
          cy += cvy;
        } else {
          cvy += p.gravity;
          cx += cvx;
          cy += cvy;
        }
        ctx.lineTo(sx(cx), sy(cy));
      }
      const fade = Math.max(0, 1 - Math.max(0, age - (maxAge - 18)) / 18);
      const trailHex = p.isStrafe && config.strafe.trailEnabled ? config.strafe.trailColor : '#fbbf24';
      ctx.strokeStyle = p.isStrafe ? trailHex : `rgba(251,191,36,${0.65 * fade})`;
      ctx.globalAlpha = fade;
      ctx.lineWidth = p.isStrafe ? 2 : 1.5;
      ctx.stroke();

      // Current projectile marker & velocity arrow
      const px = sx(cx);
      const py = sy(cy);
      if (px >= -12 && px <= CANVAS_W + 12 && py >= -12 && py <= CANVAS_H + 12) {
        if (p.chute) {
          // Chute canopy + crate box
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(px, py - 9, 6, Math.PI, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(px - 5, py - 9);
          ctx.lineTo(px, py - 2);
          ctx.moveTo(px + 5, py - 9);
          ctx.lineTo(px, py - 2);
          ctx.stroke();
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(px - 3.5, py - 3.5, 7, 7);
        } else {
          const ang = Math.atan2(cvy, cvx);
          ctx.translate(px, py);
          ctx.rotate(ang);
          ctx.fillStyle = p.isStrafe ? '#fef08a' : '#f97316';
          ctx.beginPath();
          if (p.isStrafe) {
            ctx.roundRect(-6, -1.5, 11, 3, 1.5);
          } else {
            ctx.ellipse(0, 0, 5.5, 3, 0, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(3, 0, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Active aircraft
    if (activeFrame.hasPlane) {
      const px = sx(activeFrame.x);
      const py = sy(activeFrame.y);
      const alpha = activeFrame.fadeAlpha / 255;

      // Strafe aim line during slow/release
      if (config.release.mode === 'strafe' && (activeFrame.phase === 'slow' || activeFrame.phase === 'release')) {
        ctx.save();
        ctx.strokeStyle = 'rgba(250,204,21,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px, py + 4);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.restore();
      }

      if (planeImage && planeImage.naturalWidth > 0) {
        const framesCount = Math.max(1, config.plane.frames);
        const frameH = planeImage.naturalHeight / framesCount;
        const rawIdx = config.plane.fps > 0 ? Math.floor((activeFrame.tick * config.plane.fps) / 50) : 0;
        const idx =
          config.plane.play === 'once'
            ? Math.min(framesCount - 1, rawIdx)
            : config.plane.play === 'pingpong' && framesCount >= 3
              ? (() => {
                  const span = 2 * framesCount - 2;
                  const m = rawIdx % span;
                  return m >= framesCount ? span - m : m;
                })()
              : rawIdx % framesCount;

        const maxDim = 44 * Math.max(0.4, Math.min(2, config.plane.scale));
        const fit = Math.min(1, maxDim / Math.max(planeImage.naturalWidth, frameH));
        const drawW = planeImage.naturalWidth * fit;
        const drawH = frameH * fit;

        ctx.save();
        ctx.translate(px, py);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.rotate(((activeFrame.bankDeg * sim.dir) * Math.PI) / 180);
        const faceFlip = config.plane.facingFlip ? sim.dir > 0 : sim.dir < 0;
        if (faceFlip) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          planeImage,
          0,
          idx * frameH,
          planeImage.naturalWidth,
          frameH,
          -drawW / 2,
          -drawH / 2,
          drawW,
          drawH,
        );
        ctx.restore();
      } else {
        drawPlaneSilhouette(
          ctx,
          px,
          py,
          sim.dir,
          activeFrame.bankDeg,
          config.plane.scale,
          config.plane.stockSprite,
          alpha,
          config.release.mode === 'strafe',
        );
      }
    }

    // Terrain crash explosion ring when crashOnTerrain triggers on impact
    if (sim.crashPoint && activeFrame.tick >= sim.crashPoint.tick) {
      const age = activeFrame.tick - sim.crashPoint.tick;
      if (age < 32) {
        const t = age / 32;
        const cx = sx(sim.crashPoint.x);
        const cy = sy(sim.crashPoint.y);
        const maxR =
          config.plane.boomMode === 'custom'
            ? Math.max(18, Math.min(68, (config.plane.boomRadius / SIM_WORLD_W) * CANVAS_W))
            : Math.max(18, Math.min(56, (config.plane.boomDamage / 100) * 34));
        const r = 6 + t * maxR;
        const burstHex =
          (config.plane.boomMode === 'custom' &&
            (config.plane.boomVisual === 'fx' || config.plane.boomVisual === 'both')) ||
          config.plane.boomFxBurst?.enabled
            ? config.plane.boomFxBurst?.color || '#ff7a2f'
            : '#f97316';
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.fillStyle = burstHex;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 2.5 * (1 - t * 0.6);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Minimal corner caption
    ctx.fillStyle = 'rgba(226,232,240,0.72)';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(
      sim.hasPlane
        ? `click canvas to move target · ${sim.dir > 0 ? 'L→R' : 'R→L'}`
        : `click canvas to move target · ${config.entry.spawnAt === 'cursor' ? 'spawns at cursor' : 'spawns from sky'}`,
      10,
      CANVAS_H - 9,
    );

    ctx.restore();
  }, [activeFrame, sim, config, planeImage]);

  const phaseMeta = PHASE_META[activeFrame?.phase ?? 'approach'];
  const speedPct = activeFrame ? Math.min(100, Math.round((activeFrame.vx / sim.maxSpeed) * 100)) : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-950 dark:border-stone-700">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-800 bg-stone-900/90 px-3 py-2 text-[11px] text-stone-300">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold uppercase tracking-wider text-stone-200">
            50 Hz Flight &amp; Release Preview
          </span>
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${phaseMeta.badge}`}
          >
            {phaseMeta.label}
          </span>
          <span className="font-mono text-[10px] text-stone-400">
            {sim.configuredCount > MAX_DEMO_PROJECTILES
              ? `showing ${sim.demoProjectiles.length} of ${sim.configuredCount} demo rounds`
              : `${sim.demoProjectiles.length} demo round${sim.demoProjectiles.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {config.entry.mode !== 'payload' &&
            (config.direction === 'arrows' || config.direction === 'none') && (
              <button
                type="button"
                onClick={() => setPreviewDir((d) => (d > 0 ? -1 : 1))}
                title="Flip preview flyover direction"
                className="inline-flex items-center gap-1 rounded border border-stone-700 bg-stone-800 px-2 py-1 text-[10px] font-semibold text-stone-200 hover:bg-stone-700"
              >
                {previewDir > 0 ? (
                  <>
                    L <ArrowRight className="h-3 w-3" /> R
                  </>
                ) : (
                  <>
                    R <ArrowLeft className="h-3 w-3" /> L
                  </>
                )}
              </button>
            )}
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="inline-flex items-center gap-1 rounded border border-stone-700 bg-stone-800 px-2 py-1 text-[10px] font-semibold text-stone-200 hover:bg-stone-700"
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => setFrameIdx(0)}
            title="Restart flyover"
            className="inline-flex items-center gap-1 rounded border border-stone-700 bg-stone-800 px-2 py-1 text-[10px] font-semibold text-stone-200 hover:bg-stone-700"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const norm = Math.max(0.18, Math.min(0.82, (e.clientX - rect.left) / rect.width));
          setTargetNormX(norm);
        }}
        className="block h-[210px] w-full cursor-crosshair sm:h-[228px]"
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-stone-800 bg-stone-900/90 px-3 py-2 text-[10px] text-stone-400">
        <div className="flex min-w-[160px] flex-1 items-center gap-2">
          <span className="font-mono tabular-nums text-stone-300">
            t={String(activeFrame?.tick ?? 0).padStart(3, '0')}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, totalFrames - 1)}
            value={Math.min(frameIdx, Math.max(0, totalFrames - 1))}
            onChange={(e) => {
              setPlaying(false);
              setFrameIdx(Number(e.target.value));
            }}
            aria-label="Scrub airstrike preview frame"
            className="h-1.5 flex-1 cursor-pointer accent-forge-500"
          />
          <span className="font-mono tabular-nums">
            {((activeFrame?.tick ?? 0) * 0.02).toFixed(2)}s
          </span>
        </div>

        {sim.hasPlane && (
          <div className="flex items-center gap-2">
            <span>Speed</span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-800">
              <div
                className="h-full rounded-full transition-[width] duration-75"
                style={{ width: `${speedPct}%`, backgroundColor: phaseMeta.color }}
              />
            </div>
            <span className="w-16 text-right font-mono tabular-nums text-stone-200">
              {(activeFrame?.vx ?? 0).toFixed(1)} px/f
            </span>
          </div>
        )}

        {sim.driftX !== 0 && config.release.lead && config.release.mode === 'drop' && (
          <span className="font-mono text-stone-400">
            lead {sim.driftX > 0 ? '+' : ''}
            {Math.round(sim.driftX)} px
          </span>
        )}
      </div>
    </div>
  );
};
