import type { ClipPose } from '../data/aimClip';
import type { HoldConfig } from '../types/weapon';
import { assetUrl } from './assetUrl';

export const WORM_AIM_SRC = assetUrl('assets/worm/aim.png');
export const HAND_MID_SRC = assetUrl('assets/worm/hand_rad.png');
export const HAND_LOWER_SRC = assetUrl('assets/worm/hand_rad_lower.png');
export const HAND_UPPER_SRC = assetUrl('assets/worm/hand_rad_upper.png');

export type HoldPoseRole = 'aim' | 'buffer' | 'firing';

export interface DrawHoldLayerOptions {
  hold: HoldConfig;
  cx: number;
  cy: number;
  aimT: number;
  putAwayShrink?: number;
  /** Legacy boolean flag; superseded when `poseRole` is provided. */
  firingView: boolean;
  /** Active Sprite Builder pose role: aiming, buffering/wind-up, or firing. */
  poseRole?: HoldPoseRole;
  currentFrame: number;
  firePreviewFrame: number;
  fireStripFrames: number;
  bufferPreviewFrame?: number;
  bufferStripFrames?: number;
  swingPose?: ClipPose | null;
  echoPoses?: { pose: ClipPose; alpha: number; additive: boolean }[];
  weaponImg?: HTMLImageElement | null;
  defaultHoldImg?: HTMLImageElement | null;
  flashImg?: HTMLImageElement | null;
  bufferImg?: HTMLImageElement | null;
  handMidImg?: HTMLImageElement | null;
  handLowerImg?: HTMLImageElement | null;
  handUpperImg?: HTMLImageElement | null;
  extraHandImg?: HTMLImageElement | null;
}

/**
 * Draw the Sprite Builder held art overlay (held weapon, swing ghosts, buffer
 * wind-up strip, firing flash strip, primary hand, and optional second hand)
 * onto a right-facing offscreen worm cell centered at `(cx, cy)`. Returns the
 * clamped aim phase.
 */
export function drawHoldOverlay(
  offCtx: CanvasRenderingContext2D,
  opts: DrawHoldLayerOptions,
): number {
  const {
    hold,
    cx,
    cy,
    aimT,
    putAwayShrink = 1.0,
    firingView,
    poseRole,
    currentFrame,
    firePreviewFrame,
    fireStripFrames,
    bufferPreviewFrame = 0,
    bufferStripFrames = 1,
    swingPose = null,
    echoPoses = [],
    weaponImg,
    defaultHoldImg,
    flashImg,
    bufferImg,
    handMidImg,
    handLowerImg,
    handUpperImg,
    extraHandImg,
  } = opts;

  const role: HoldPoseRole = poseRole ?? (firingView ? 'firing' : 'aim');
  const isFiring = role === 'firing';
  const isBuffer = role === 'buffer';
  const isAltRole = isFiring || isBuffer;

  const clamp = hold.aimClamp;
  const aimDrawn = clamp?.enabled
    ? Math.min(
        0.5 + Math.max(0, Math.min(90, Number(clamp.up) || 0)) / 180,
        Math.max(0.5 - Math.max(0, Math.min(90, Number(clamp.down) || 0)) / 180, aimT),
      )
    : aimT;

  const rot = (1 - aimDrawn) * Math.PI;
  const aimWeapRotation = Number(hold.weapRotation) || 0;
  const aimWeapRadius = Number(hold.weapRadius ?? 6);
  const aimScale = Number(hold.scale) || 1;
  const aimRotRad = (aimWeapRotation * Math.PI) / 180;

  const roleWeapRotation = isFiring
    ? Number(hold.fireWeapRotation ?? aimWeapRotation) || 0
    : isBuffer
      ? Number(hold.bufferWeapRotation ?? aimWeapRotation) || 0
      : aimWeapRotation;
  const roleRotRad = (roleWeapRotation * Math.PI) / 180;
  const roleWeapRadius = Number(
    isFiring
      ? (hold.fireWeapRadius ?? aimWeapRadius)
      : isBuffer
        ? (hold.bufferWeapRadius ?? aimWeapRadius)
        : aimWeapRadius,
  );
  const roleScale = isFiring
    ? Number(hold.fireScale ?? aimScale) || 1
    : isBuffer
      ? Number(hold.bufferScale ?? aimScale) || 1
      : aimScale;

  const rotW = rot + Math.PI * Number(hold.weapRadialRotation ?? 1);
  const aimWeapX = cx + Math.sin(rotW) * aimWeapRadius;
  const aimWeapY = cy - Math.cos(rotW) * aimWeapRadius;
  const roleWeapX = cx + Math.sin(rotW) * roleWeapRadius;
  const roleWeapY = cy - Math.cos(rotW) * roleWeapRadius;

  const poseScale = swingPose?.scale ?? 1;
  const roleDrawScale = roleScale * putAwayShrink * poseScale;
  const roleAngle = rot + roleRotRad + ((swingPose?.angle ?? 0) * Math.PI) / 180;

  const hideMain =
    (isFiring && !!hold.fireHideMain && !!flashImg && flashImg.complete && flashImg.naturalWidth > 0) ||
    (isBuffer && !!hold.bufferHideMain && !!bufferImg && bufferImg.complete && bufferImg.naturalWidth > 0);

  const drawHeldArt = (pose: ClipPose | null, alphaMul = 1, additive = false) => {
    if (hideMain) return;
    const poseScaleLocal = pose?.scale ?? 1;
    const localScale = aimScale * putAwayShrink * poseScaleLocal;
    const localAngle = rot + aimRotRad + ((pose?.angle ?? 0) * Math.PI) / 180;
    offCtx.save();
    offCtx.imageSmoothingEnabled = false;
    offCtx.globalAlpha = (pose?.alpha ?? 1) * alphaMul;
    if (additive) offCtx.globalCompositeOperation = 'lighter';
    offCtx.translate(aimWeapX, aimWeapY);
    offCtx.rotate(localAngle);
    offCtx.scale(localScale, localScale);
    const holdOffsetX = Number(hold.offsetX ?? 0) + (pose?.dx ?? 0);
    const holdOffsetY = Number(hold.offsetY ?? 0) + (pose?.dy ?? 0);
    if (holdOffsetX || holdOffsetY) offCtx.translate(holdOffsetX, holdOffsetY);

    if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) {
      const cells = Math.max(1, Math.round(hold.sheetFrames ?? hold.frames ?? 1));
      const totalFrames = Math.max(1, hold.frames || 1);
      const frameHeight = weaponImg.naturalHeight / cells;
      const frameWidth = weaponImg.naturalWidth;
      const shownFrame =
        pose?.frame !== undefined
          ? Math.min(totalFrames - 1, Math.max(0, Math.round(pose.frame)))
          : currentFrame;
      const sy = (Math.min(shownFrame, cells - 1) % cells) * frameHeight;
      offCtx.drawImage(
        weaponImg,
        0,
        sy,
        frameWidth,
        frameHeight,
        -frameWidth / 2,
        -frameHeight / 2,
        frameWidth,
        frameHeight,
      );
    } else if (
      defaultHoldImg &&
      defaultHoldImg.complete &&
      defaultHoldImg.naturalWidth > 0
    ) {
      offCtx.drawImage(
        defaultHoldImg,
        -defaultHoldImg.naturalWidth / 2,
        -defaultHoldImg.naturalHeight / 2,
      );
    } else {
      offCtx.fillStyle = '#d65443';
      offCtx.strokeStyle = '#85271e';
      offCtx.lineWidth = 1;
      offCtx.fillRect(-3, -10, 6, 20);
      offCtx.strokeRect(-3, -10, 6, 20);

      offCtx.fillStyle = '#f0a99e';
      offCtx.beginPath();
      offCtx.moveTo(-3, -10);
      offCtx.lineTo(0, -15);
      offCtx.lineTo(3, -10);
      offCtx.closePath();
      offCtx.fill();
    }
    offCtx.restore();
  };

  for (const ghost of echoPoses) {
    drawHeldArt(ghost.pose, ghost.alpha, ghost.additive);
  }
  drawHeldArt(swingPose);

  // Buffering wind-up strip
  if (isBuffer && bufferImg && bufferImg.complete && bufferImg.naturalWidth > 0) {
    const frames = Math.max(1, bufferStripFrames);
    const cellH = bufferImg.naturalHeight / frames;
    const cellW = bufferImg.naturalWidth;
    const bufFrame = frames > 1 ? bufferPreviewFrame % frames : 0;
    offCtx.save();
    offCtx.imageSmoothingEnabled = false;
    offCtx.translate(roleWeapX, roleWeapY);
    offCtx.rotate(roleAngle);
    offCtx.scale(roleDrawScale, roleDrawScale);
    const bufOffX = Number(hold.bufferOffsetX ?? 0);
    const bufOffY = Number(hold.bufferOffsetY ?? 0);
    if (bufOffX || bufOffY) offCtx.translate(bufOffX, bufOffY);
    offCtx.drawImage(
      bufferImg,
      0,
      bufFrame * cellH,
      cellW,
      cellH,
      -cellW / 2,
      -cellH / 2,
      cellW,
      cellH,
    );
    offCtx.restore();
  }

  // Firing flash strip
  if (isFiring && flashImg && flashImg.complete && flashImg.naturalWidth > 0) {
    const frames = Math.max(1, fireStripFrames);
    const cellH = flashImg.naturalHeight / frames;
    const cellW = flashImg.naturalWidth;
    const flashFrame = frames > 1 ? firePreviewFrame % frames : 0;
    offCtx.save();
    offCtx.imageSmoothingEnabled = false;
    offCtx.translate(roleWeapX, roleWeapY);
    offCtx.rotate(roleAngle);
    offCtx.scale(roleDrawScale, roleDrawScale);
    const fireOffX = Number(hold.fireOffsetX ?? 0);
    const fireOffY = Number(hold.fireOffsetY ?? 0);
    if (fireOffX || fireOffY) offCtx.translate(fireOffX, fireOffY);
    offCtx.drawImage(
      flashImg,
      0,
      flashFrame * cellH,
      cellW,
      cellH,
      -cellW / 2,
      -cellH / 2,
      cellW,
      cellH,
    );
    offCtx.restore();
  }

  // Primary hand
  const drawPrimaryHand = isFiring
    ? (hold.fireDrawHand ?? hold.drawHand) !== false
    : isBuffer
      ? (hold.bufferDrawHand ?? hold.drawHand) !== false
      : hold.drawHand !== false;

  if (drawPrimaryHand) {
    const handRadius = Number(
      isFiring
        ? (hold.fireHandRadius ?? hold.handRadius ?? 10)
        : isBuffer
          ? (hold.bufferHandRadius ?? hold.handRadius ?? 10)
          : (hold.handRadius ?? 10),
    );
    const roleHandRotation = Number(
      (isFiring
        ? (hold.fireHandRotation ?? hold.handRotation)
        : isBuffer
          ? (hold.bufferHandRotation ?? hold.handRotation)
          : hold.handRotation) || 0,
    );
    const roleHandScale = Number(
      (isFiring
        ? (hold.fireHandScale ?? hold.handScale)
        : isBuffer
          ? (hold.bufferHandScale ?? hold.handScale)
          : hold.handScale) || 1,
    );
    const rotH = rot - Math.PI * Number(hold.handRadialRotation ?? 1);
    let handX = cx + Math.sin(rotH) * handRadius;
    let handY = cy - Math.cos(rotH) * handRadius;
    const handAngle = rot + Math.PI * (1 + roleHandRotation / 180);
    const handCarry = roleHandScale * putAwayShrink;
    const handNudgeX = isFiring
      ? Number(hold.fireHandOffsetX ?? 0)
      : isBuffer
        ? Number(hold.bufferHandOffsetX ?? 0)
        : Number(hold.handOffsetX ?? 0) + (swingPose?.dx ?? 0);
    const handNudgeY = isFiring
      ? Number(hold.fireHandOffsetY ?? 0)
      : isBuffer
        ? Number(hold.bufferHandOffsetY ?? 0)
        : Number(hold.handOffsetY ?? 0) + (swingPose?.dy ?? 0);
    const hox = handNudgeX * handCarry;
    const hoy = handNudgeY * handCarry;
    if (hox || hoy) {
      handX += hox * Math.cos(handAngle) - hoy * Math.sin(handAngle);
      handY += hox * Math.sin(handAngle) + hoy * Math.cos(handAngle);
    }

    let handImg = handMidImg ?? null;
    if (hold.handType === 'lower') handImg = handLowerImg ?? null;
    else if (hold.handType === 'upper') handImg = handUpperImg ?? null;

    if (handImg && handImg.complete && handImg.naturalWidth > 0) {
      const handScale = roleHandScale * putAwayShrink;
      offCtx.save();
      offCtx.imageSmoothingEnabled = false;
      offCtx.globalAlpha = swingPose?.alpha ?? 1;
      offCtx.translate(handX, handY);
      offCtx.rotate(handAngle);
      offCtx.scale(handScale, handScale);
      offCtx.drawImage(handImg, -handImg.naturalWidth / 2, -handImg.naturalHeight / 2);
      offCtx.restore();
    } else {
      offCtx.fillStyle = '#f472b6';
      offCtx.beginPath();
      offCtx.arc(handX, handY, 2.5, 0, Math.PI * 2);
      offCtx.fill();
    }
  }

  // Optional second hand
  const extra =
    hold.extraHand?.enabled && !(isAltRole && hold.extraHand.fireDraw === false)
      ? hold.extraHand
      : null;
  if (extra) {
    const xRadius = (isAltRole ? extra.fireRadius : undefined) ?? extra.radius ?? 0;
    const xRotation = (isAltRole ? extra.fireRotation : undefined) ?? extra.rotation ?? 0;
    const xScale = (isAltRole ? extra.fireScale : undefined) ?? extra.scale ?? 1;
    const xOffX = (isAltRole ? extra.fireOffsetX : undefined) ?? extra.offsetX ?? 0;
    const xOffY = (isAltRole ? extra.fireOffsetY : undefined) ?? extra.offsetY ?? 0;
    const rotX = rot - Math.PI;
    let xX = cx + Math.sin(rotX) * xRadius;
    let xY = cy - Math.cos(rotX) * xRadius;
    const xAngle = rot + Math.PI * (1 + xRotation / 180);
    const xSize = Number(xScale) * (isAltRole ? 1 : putAwayShrink);
    const xNudgeX = Number(xOffX) + (isAltRole ? 0 : swingPose?.dx ?? 0);
    const xNudgeY = Number(xOffY) + (isAltRole ? 0 : swingPose?.dy ?? 0);
    if (xNudgeX || xNudgeY) {
      const ox = xNudgeX * xSize;
      const oy = xNudgeY * xSize;
      xX += ox * Math.cos(xAngle) - oy * Math.sin(xAngle);
      xY += ox * Math.sin(xAngle) + oy * Math.cos(xAngle);
    }
    let xImg = extraHandImg ?? null;
    if (!xImg) {
      xImg = handMidImg ?? null;
      if (hold.handType === 'lower') xImg = handLowerImg ?? null;
      else if (hold.handType === 'upper') xImg = handUpperImg ?? null;
    }
    if (xImg && xImg.complete && xImg.naturalWidth > 0) {
      offCtx.save();
      offCtx.imageSmoothingEnabled = false;
      offCtx.globalAlpha = swingPose?.alpha ?? 1;
      offCtx.translate(xX, xY);
      offCtx.rotate(xAngle);
      offCtx.scale(xSize, xSize);
      offCtx.drawImage(xImg, -30, -30, 60, 60);
      offCtx.restore();
    }
  }

  return aimDrawn;
}
