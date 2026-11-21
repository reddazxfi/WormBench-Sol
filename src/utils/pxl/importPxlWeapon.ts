import type {
  BehaviorArtKey,
  CustomSpriteAsset,
  FlightRoleArt,
  HoldConfig,
  MissileAnimType,
  MissileSpriteConfig,
  PackArtAsset,
  PackArtSlot,
  RoamSheetAsset,
  WeaponProject,
  WormSpritePoseAsset,
  WormSpritePoseKey,
} from '../../types/weapon';
import type {
  PxlLibrary,
  PxlScriptFlightParams,
  PxlScriptHoldParams,
  PxlWeapon,
} from '../../types/pxl';
import { DEFAULT_ID_NAMESPACE, slugId } from '../weaponId';
import { parseWepBinary } from '../wepParser';
import { sanitizeModFolder } from '../luaGenerator';
import {
  DEFAULT_DIG_ROLE_ART,
  DEFAULT_ROAM_ROLE_ART,
  DEFAULT_ROLE_ART,
} from '../../data/spriteBuilder';
import { basenameOfAsset } from './readSpriteScripts';
import {
  imageSizeOfBytes,
  inferStripFrames,
  missingLibraryRequires,
  pxlArtToFile,
  resolvePxlArt,
  resolvePxlFrames,
  resolveSpriteOverride,
} from './loadPxl';

export interface PxlImportResult {
  success: boolean;
  error?: string;
  project?: Partial<WeaponProject> & { replaceProject: true };
  summary: string[];
  offeredSounds: string[];
}

function objectUrl(file: File): string {
  try {
    return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(file)
      : '';
  } catch {
    return '';
  }
}

function matchesWeaponName(candidate: string | undefined, weapon: PxlWeapon): boolean {
  if (!candidate) return false;
  const c = candidate.trim().toLowerCase();
  return (
    c === weapon.name.trim().toLowerCase() ||
    (!!weapon.id && c === weapon.id.trim().toLowerCase()) ||
    c === weapon.itemName.trim().toLowerCase()
  );
}

function pickScriptHoldParams(lib: PxlLibrary, weapon: PxlWeapon): PxlScriptHoldParams | undefined {
  const exact = lib.parsedScripts.holdParams.find((p) => matchesWeaponName(p.weaponName, weapon));
  if (exact) return exact;
  const realWeapons = lib.weapons.filter((w) => !w.isSectionHeading);
  if (realWeapons.length === 1 && lib.parsedScripts.holdParams.length === 1) {
    return lib.parsedScripts.holdParams[0];
  }
  return undefined;
}

function pickScriptFlightParams(
  lib: PxlLibrary,
  weapon: PxlWeapon,
): PxlScriptFlightParams | undefined {
  const exact = lib.parsedScripts.flightParams.find((p) => matchesWeaponName(p.weaponName, weapon));
  if (exact) return exact;
  const realWeapons = lib.weapons.filter((w) => !w.isSectionHeading);
  if (realWeapons.length === 1 && lib.parsedScripts.flightParams.length >= 1) {
    // Merge multiple entries (e.g. SetCustomAnim + SetSpriteMultiplex)
    return Object.assign({}, ...lib.parsedScripts.flightParams);
  }
  return undefined;
}

function nativeAnimToBuilder(raw: unknown): MissileAnimType {
  switch (Number(raw)) {
    case 0: return 'none';
    case 1: return 'rotation';
    case 2:
    case 3: return 'track';
    case 4: return 'slow';
    case 5: return 'medium';
    case 6: return 'fast';
    default: return 'track';
  }
}

function isPxDefaultHoldName(name: string): boolean {
  const base = basenameOfAsset(name).toLowerCase();
  return (
    base.startsWith('def_shot_aim_') ||
    base.startsWith('default_pick_') ||
    base.startsWith('def_put_') ||
    base.startsWith('sbaim') ||
    base.startsWith('sbpic')
  );
}

function numericRecordId(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n === 34464) return undefined;
  return Math.round(n);
}

/**
 * Convert a `.pxl` weapon block into an editor `WeaponProject` patch using the
 * existing `.wep` pipeline (`parseWepBinary`), then attach icon, hold art,
 * script-derived hold/flight parameters, and extra aim-zone hold sheets.
 */
export function importPxlWeapon(
  weapon: PxlWeapon,
  library: PxlLibrary,
  allLibraries: readonly PxlLibrary[],
): PxlImportResult {
  const bytes = weapon.bytesOf();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const wepName = weapon.itemName.toLowerCase().endsWith('.wep')
    ? weapon.itemName
    : `${weapon.itemName}.wep`;

  const parsed = parseWepBinary(copy.buffer, wepName);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error || `Failed to decode ${weapon.name}`,
      summary: [],
      offeredSounds: [],
    };
  }

  const displayName = weapon.name || parsed.name || weapon.itemName;
  const idSlug = slugId(weapon.id || displayName, 'pxl_weapon');
  const fullId = `${DEFAULT_ID_NAMESPACE}.${idSlug}`;
  const modFolder = sanitizeModFolder(fullId);

  const summary: string[] = [...parsed.summary];
  const project: Partial<WeaponProject> & { replaceProject: true } = {
    ...parsed.projectState,
    replaceProject: true,
    id: fullId,
    name: displayName,
    wepFile: parsed.wepFile,
    wepFileName: parsed.wepFileName,
    useWepFile: true,
  };

  // 1. Panel icon
  if (weapon.icon) {
    if (/\.img$/i.test(weapon.icon)) {
      summary.push(`icon: ${weapon.icon} (.img, not decoded)`);
    } else {
      const resolved = resolvePxlArt(weapon.icon, allLibraries, library.key);
      if (resolved && resolved.art.kind === 'image') {
        const iconFile = pxlArtToFile(resolved.art);
        project.customIconFile = iconFile;
        project.customIconPreview = objectUrl(iconFile);
        project.panel_icon = 'custom';
        summary.push(`icon: ${resolved.art.name}`);
      } else {
        summary.push(`icon: ${weapon.icon} (not in loaded libraries)`);
      }
    }
  }

  // 2. Hold art + CWormAnimParams geometry (Sprite Builder) OR direct worm_sprites pose sheets.
  //
  // The 9 aim-zone slots at the end of a PX `.wep` are native full-worm
  // sprite replacements (`weaponlnk`/`u`/`d`, `wthrow`/`u`/`d`, `weaponfire`/`u`/`d`),
  // NOT Sprite Builder `hold` overlay sheets. Only attach Sprite Builder `hold`
  // when the library scripts declare `CWormAnimParams` (`scriptHold`); otherwise
  // non-default pose sheets populate `project.wormSprites`.
  const scriptHold = pickScriptHoldParams(library, weapon);
  const customSprites: Record<string, CustomSpriteAsset> = {};

  if (scriptHold) {
    const candidateHoldNames: string[] = [];
    if (scriptHold.sheetName) candidateHoldNames.push(scriptHold.sheetName);
    if (weapon.holdSlots[0] && !isPxDefaultHoldName(weapon.holdSlots[0])) {
      candidateHoldNames.push(weapon.holdSlots[0]);
    } else if (weapon.holdSlots[0] && candidateHoldNames.length === 0) {
      candidateHoldNames.push(weapon.holdSlots[0]);
    }

    let chosenHoldName: string | undefined;
    let chosenHoldResolved: ReturnType<typeof resolvePxlArt>;
    for (const cand of candidateHoldNames) {
      const hit = resolvePxlArt(cand, allLibraries, library.key);
      if (hit && hit.art.kind === 'image') {
        chosenHoldName = cand;
        chosenHoldResolved = hit;
        break;
      }
    }

    const holdPatch: Partial<HoldConfig> = {};
    if (chosenHoldResolved && chosenHoldName) {
      const sheetFile = pxlArtToFile(chosenHoldResolved.art);
      const sheetBytes = chosenHoldResolved.art.bytesOf();
      const size = imageSizeOfBytes(sheetBytes);
      const frames = inferStripFrames(chosenHoldResolved.art, allLibraries, library.key);
      const animSpeed = scriptHold.animSpeed ?? 1;
      const fps = frames > 1 ? Math.max(1, Math.round(animSpeed * 1.5 * frames)) : 15;

      holdPatch.enabled = true;
      holdPatch.sheet = '';
      holdPatch.sheetFile = sheetFile;
      holdPatch.sheetPreview = objectUrl(sheetFile);
      holdPatch.sheetWidth = size?.width;
      holdPatch.sheetHeight = size?.height;
      holdPatch.frames = frames;
      holdPatch.animate = scriptHold.animate ?? frames > 1;
      holdPatch.fps = fps;
      summary.push(
        `hold art: ${chosenHoldResolved.art.name} (${frames} frame${frames === 1 ? '' : 's'})`,
      );
    } else if (candidateHoldNames.length > 0 && !isPxDefaultHoldName(candidateHoldNames[0])) {
      summary.push(`hold art: ${candidateHoldNames[0]} (not in loaded libraries)`);
    }

    holdPatch.enabled = true;
    if (scriptHold.handType) holdPatch.handType = scriptHold.handType;
    if (scriptHold.handRadius !== undefined) holdPatch.handRadius = scriptHold.handRadius;
    if (scriptHold.handRotation !== undefined) {
      holdPatch.handRotation = Math.round((scriptHold.handRotation - 1) * 180 * 1000) / 1000;
    }
    if (scriptHold.handRadialRotation !== undefined) {
      holdPatch.handRadialRotation = scriptHold.handRadialRotation;
    }
    if (scriptHold.handScale !== undefined) holdPatch.handScale = scriptHold.handScale;
    if (scriptHold.weapRadius !== undefined) holdPatch.weapRadius = scriptHold.weapRadius;
    if (scriptHold.weapRotation !== undefined) {
      holdPatch.weapRotation = Math.round((scriptHold.weapRotation - 1) * 180 * 1000) / 1000;
    }
    if (scriptHold.weapRadialRotation !== undefined) {
      holdPatch.weapRadialRotation = scriptHold.weapRadialRotation;
    }
    if (scriptHold.scale !== undefined) holdPatch.scale = scriptHold.scale;
    if (scriptHold.drawHand !== undefined) holdPatch.drawHand = scriptHold.drawHand;
    summary.push('hold geometry: applied from CWormAnimParams script (check Hold tab)');

    // Firing hold sheet from script `FSprite` or manifest fire/level slot (`holdSlots[3]`)
    const fireCandidate =
      scriptHold.firingSheetName ??
      (weapon.holdSlots[3] && !isPxDefaultHoldName(weapon.holdSlots[3]) ? weapon.holdSlots[3] : undefined);
    if (
      fireCandidate &&
      fireCandidate.toLowerCase() !== (chosenHoldResolved?.art.name ?? '').toLowerCase()
    ) {
      const fireResolved = resolvePxlArt(fireCandidate, allLibraries, library.key);
      if (fireResolved && fireResolved.art.kind === 'image') {
        const flashFile = pxlArtToFile(fireResolved.art);
        const size = imageSizeOfBytes(fireResolved.art.bytesOf());
        const fireFrames = inferStripFrames(fireResolved.art, allLibraries, library.key);
        holdPatch.flashFile = flashFile;
        holdPatch.flashPreview = objectUrl(flashFile);
        holdPatch.flashWidth = size?.width;
        holdPatch.flashHeight = size?.height;
        holdPatch.fireFrames = fireFrames;
        holdPatch.fireHideMain = true;
        summary.push(
          `firing hold: ${fireResolved.art.name} (${fireFrames} frame${fireFrames === 1 ? '' : 's'})`,
        );
      }
    }

    project.hold = {
      enabled: false,
      sheet: '',
      handType: 'mid',
      handRadius: 10,
      weapRadius: -8,
      weapRotation: 0,
      scale: 1,
      handScale: 1,
      frames: 1,
      fps: 15,
      animate: false,
      drawHand: true,
      keepWhileFiring: false,
      thrown: true,
      putAway: false,
      handRad: 10,
      handRadLower: 0,
      handRadUpper: 0,
      ...holdPatch,
    };
  } else {
    // No CWormAnimParams script: check the 9 .wep aim-zone slots for direct worm_sprites sheets.
    const poseSlots = weapon.poseSlots ?? {};
    const poseOrder: WormSpritePoseKey[] = [
      'weaponlnk',
      'weaponlnku',
      'weaponlnkd',
      'wthrow',
      'wthrowu',
      'wthrowd',
      'weaponfire',
      'weaponfireu',
      'weaponfired',
    ];
    const hasNonDefaultPose = poseOrder.some((key) => {
      const name = poseSlots[key];
      return !!name && !isPxDefaultHoldName(name);
    });

    if (hasNonDefaultPose) {
      const poses: Partial<Record<WormSpritePoseKey, WormSpritePoseAsset>> = {};
      const dedupByAsset = new Map<string, WormSpritePoseAsset>();
      const missingPoses: string[] = [];
      let attachedCount = 0;

      for (const key of poseOrder) {
        const slotName = poseSlots[key];
        if (!slotName || isPxDefaultHoldName(slotName)) continue;
        const cacheKey = slotName.toLowerCase();
        const cached = dedupByAsset.get(cacheKey);
        if (cached) {
          poses[key] = cached;
          attachedCount++;
          continue;
        }
        const resolved = resolvePxlArt(slotName, allLibraries, library.key);
        if (resolved && resolved.art.kind === 'image') {
          const file = pxlArtToFile(resolved.art);
          const size = imageSizeOfBytes(resolved.art.bytesOf());
          const frames = inferStripFrames(resolved.art, allLibraries, library.key);
          const asset: WormSpritePoseAsset = {
            file,
            fileName: file.name,
            preview: objectUrl(file),
            frames,
            width: size?.width,
            height: size?.height,
          };
          dedupByAsset.set(cacheKey, asset);
          poses[key] = asset;
          attachedCount++;
        } else {
          missingPoses.push(`${key}:${slotName}`);
        }
      }

      if (attachedCount > 0) {
        project.wormSprites = {
          enabled: true,
          poses,
        };
        summary.push(
          `worm poses: ${attachedCount} sheet${attachedCount === 1 ? '' : 's'} attached (aim/pick/fire -> worm_sprites)`,
        );
      }
      if (missingPoses.length > 0) {
        summary.push(`worm poses not in loaded libraries: ${missingPoses.join(', ')}`);
      }
    }
  }

  // 4. Flight / strike / cluster / trail / override sprites
  const isAirStrike =
    parsed.fireType === 'cursor' && !parsed.projectState.teleport;
  const packArt: Partial<Record<PackArtSlot, PackArtAsset>> = {};
  const overrides = parsed.projectState.recordOverrides ?? {};
  const missileId = numericRecordId(overrides['missile.sprite']);
  const trailId = numericRecordId(overrides['missile.trail.sprite']);
  const bitSpriteId = numericRecordId(parsed.projectState.body?.clustlet?.sprite);
  const bitTrailId = numericRecordId(parsed.projectState.body?.clustlet?.trail);
  const homingId = numericRecordId(overrides['missile.homing.sprite']);
  const planeId = numericRecordId(overrides['strike.plane']);
  let unresolvedOverride = false;

  const makePackArt = (art: NonNullable<ReturnType<typeof resolvePxlArt>>['art'], libKey: string): PackArtAsset => {
    const file = pxlArtToFile(art);
    const frames = inferStripFrames(art, allLibraries, libKey);
    return {
      file,
      fileName: file.name,
      previewUrl: objectUrl(file),
      sourceFile: file,
      sourceName: file.name,
      frames,
      fps: 15,
      play: 'loop',
    };
  };

  if (isAirStrike) {
    const payloadHit =
      (weapon.missileSprite
        ? resolvePxlArt(weapon.missileSprite, allLibraries, library.key)
        : undefined) ?? resolveSpriteOverride(missileId, allLibraries, library.key);
    if (payloadHit && payloadHit.art.kind === 'image') {
      const asset = makePackArt(payloadHit.art, payloadHit.lib.key);
      packArt.strike_sprite = asset;
      summary.push(`strike payload: ${payloadHit.art.name} (${asset.frames} frame${asset.frames === 1 ? '' : 's'})`);
    } else if (weapon.missileSprite || (missileId && missileId > 690)) {
      unresolvedOverride = true;
      summary.push(
        `strike payload: ${weapon.missileSprite ?? `sprite #${missileId}`} (not in open libraries)`,
      );
    }

    const clusterHit =
      (weapon.clustletSprite
        ? resolvePxlArt(weapon.clustletSprite, allLibraries, library.key)
        : undefined) ?? resolveSpriteOverride(bitSpriteId, allLibraries, library.key);
    if (clusterHit && clusterHit.art.kind === 'image') {
      const asset = makePackArt(clusterHit.art, clusterHit.lib.key);
      packArt.cluster_sprite = asset;
      summary.push(`cluster art: ${clusterHit.art.name} (${asset.frames} frame${asset.frames === 1 ? '' : 's'})`);
    } else if (weapon.clustletSprite || (bitSpriteId && bitSpriteId > 690)) {
      unresolvedOverride = true;
      summary.push(
        `cluster art: ${weapon.clustletSprite ?? `sprite #${bitSpriteId}`} (not in open libraries)`,
      );
    }

    const planeHit =
      (weapon.planeSprite
        ? resolvePxlArt(weapon.planeSprite, allLibraries, library.key)
        : undefined) ?? resolveSpriteOverride(planeId, allLibraries, library.key);
    if (planeHit && planeHit.art.kind === 'image') {
      const planeFile = pxlArtToFile(planeHit.art);
      const frames = inferStripFrames(planeHit.art, allLibraries, planeHit.lib.key);
      customSprites.plane = {
        purpose: 'plane',
        name: 'plane',
        path: `sprites/${modFolder}/plane.png`,
        file: planeFile,
        previewUrl: objectUrl(planeFile),
        frames,
        fps: 15,
        play: 'loop',
      };
      project.customSprites = customSprites;
      summary.push(
        `strike plane: ${planeHit.art.name} (${frames} frames, attached in customSprites; top-level plane key not modelled)`,
      );
    } else if (weapon.planeSprite || (planeId && planeId > 690)) {
      unresolvedOverride = true;
      summary.push(
        `strike plane: ${weapon.planeSprite ?? `sprite #${planeId}`} (not in open libraries)`,
      );
    }
  } else {
    const scriptFlight = pickScriptFlightParams(library, weapon);
    const flightResolved =
      (scriptFlight?.sheetName
        ? resolvePxlArt(scriptFlight.sheetName, allLibraries, library.key)
        : undefined) ??
      (weapon.missileSprite
        ? resolvePxlArt(weapon.missileSprite, allLibraries, library.key)
        : undefined) ??
      resolveSpriteOverride(missileId, allLibraries, library.key);

    if (flightResolved && flightResolved.art.kind === 'image') {
      if (scriptFlight) {
        const sheetFile = pxlArtToFile(flightResolved.art);
        const frames = inferStripFrames(flightResolved.art, allLibraries, flightResolved.lib.key);
        const animSpeed = scriptFlight.animSpeed ?? 1;
        const fps = frames > 1 ? Math.max(1, Math.round(animSpeed * 1.5 * frames)) : 15;
        const anim = nativeAnimToBuilder(overrides['missile.animation']);
        const missileSprite: MissileSpriteConfig = {
          enabled: true,
          mode: 'custom',
          stockSprite: parsed.inferredDonor || 'grenade',
          sheet: '',
          sheetFile,
          sheetPreview: objectUrl(sheetFile),
          anim,
          frames,
          fps,
          animSpeed,
          spinRate: 1,
          scale: scriptFlight.scale ?? 1,
          mirror: true,
          z: scriptFlight.zplane ?? 5,
          animate: scriptFlight.animate ?? frames > 1,
          spin: true,
          hideStock: true,
        };
        project.missileSprite = missileSprite;
        summary.push(
          `flight art: ${flightResolved.art.name} (${frames} frame${frames === 1 ? '' : 's'}, from script -> builder)`,
        );
      } else {
        // Weapons using a native sprite ID (no Sprite Builder script) carry WA-style
        // multi-angle strips (e.g. 32 frames) that must install directly via claim
        // `sprite = "..."` (`packArt.strike_sprite`) rather than spinning in sb.flight.
        const asset = makePackArt(flightResolved.art, flightResolved.lib.key);
        packArt.strike_sprite = asset;
        summary.push(
          `weapon sprite: ${flightResolved.art.name} (${asset.frames} frame${asset.frames === 1 ? '' : 's'} -> sprite = ...)`,
        );
      }
    } else if (scriptFlight?.sheetName || weapon.missileSprite || (missileId && missileId > 690)) {
      unresolvedOverride = true;
      summary.push(
        `flight art: ${scriptFlight?.sheetName ?? weapon.missileSprite ?? `sprite #${missileId}`} (not in open libraries)`,
      );
    }

    const bitHit =
      (weapon.clustletSprite
        ? resolvePxlArt(weapon.clustletSprite, allLibraries, library.key)
        : undefined) ?? resolveSpriteOverride(bitSpriteId, allLibraries, library.key);
    if (bitHit && bitHit.art.kind === 'image') {
      if (project.missileSprite?.enabled) {
        const bitFile = pxlArtToFile(bitHit.art);
        const frames = inferStripFrames(bitHit.art, allLibraries, bitHit.lib.key);
        project.bitFlight = {
          ...DEFAULT_ROLE_ART,
          mode: 'builder',
          sheetFile: bitFile,
          sheetPreview: objectUrl(bitFile),
          anim: nativeAnimToBuilder(parsed.projectState.body?.clustlet?.animation),
          frames,
          fps: frames > 1 ? Math.max(1, Math.round(1.5 * frames)) : 15,
        };
        summary.push(`cluster bit art: ${bitHit.art.name} (${frames} frame${frames === 1 ? '' : 's'}, builder)`);
      } else {
        const asset = makePackArt(bitHit.art, bitHit.lib.key);
        packArt.cluster_sprite = asset;
        summary.push(`cluster bit art: ${bitHit.art.name} (${asset.frames} frame${asset.frames === 1 ? '' : 's'})`);
      }
    } else if (weapon.clustletSprite || (bitSpriteId && bitSpriteId > 690)) {
      unresolvedOverride = true;
      summary.push(
        `cluster bit art: ${weapon.clustletSprite ?? `sprite #${bitSpriteId}`} (not in open libraries)`,
      );
    }

    const homingHit =
      (weapon.homingSprite
        ? resolvePxlArt(weapon.homingSprite, allLibraries, library.key)
        : undefined) ?? resolveSpriteOverride(homingId, allLibraries, library.key);
    if (homingHit && homingHit.art.kind === 'image') {
      if (parsed.projectState.burst === 'clusters') {
        const asset = makePackArt(homingHit.art, homingHit.lib.key);
        packArt.cluster_homing_sprite = asset;
        summary.push(`cluster homing art: ${homingHit.art.name} (${asset.frames} frame${asset.frames === 1 ? '' : 's'})`);
      } else if (!scriptFlight && !project.missileSprite?.enabled && weapon.homingSprite) {
        const hFile = pxlArtToFile(homingHit.art);
        const frames = inferStripFrames(homingHit.art, allLibraries, homingHit.lib.key);
        project.behaviorArt = {
          ...(project.behaviorArt ?? {}),
          homing: {
            ...DEFAULT_ROLE_ART,
            mode: 'builder',
            sheetFile: hFile,
            sheetPreview: objectUrl(hFile),
            frames,
          },
        };
        summary.push(`homing art: ${homingHit.art.name} (${frames} frame${frames === 1 ? '' : 's'})`);
      }
    }
  }

  // Trails resolved via SetSpriteOverride (for both air strikes and projectiles)
  if (trailId) {
    const trailHit = resolveSpriteOverride(trailId, allLibraries, library.key);
    if (trailHit && trailHit.art.kind === 'image') {
      const asset = makePackArt(trailHit.art, trailHit.lib.key);
      packArt.missile_trail = asset;
      summary.push(`missile trail: ${trailHit.art.name} (override #${trailId}, ${asset.frames}f)`);
    } else if (trailId >= 240 && trailId <= 470 || trailId > 690) {
      unresolvedOverride = true;
    }
  }
  if (bitTrailId) {
    const bitTrailHit = resolveSpriteOverride(bitTrailId, allLibraries, library.key);
    if (bitTrailHit && bitTrailHit.art.kind === 'image') {
      const asset = makePackArt(bitTrailHit.art, bitTrailHit.lib.key);
      packArt.cluster_trail = asset;
      summary.push(`cluster trail: ${bitTrailHit.art.name} (override #${bitTrailId}, ${asset.frames}f)`);
    } else if (bitTrailId >= 240 && bitTrailId <= 470 || bitTrailId > 690) {
      unresolvedOverride = true;
    }
  }

  if (Object.keys(packArt).length > 0) {
    project.packArt = packArt;
  }

  // PX's sprite builder applies to the main weapon only; homing, roaming, and
  // digging inherit the main sheet (and clusters stay native unless a custom
  // clustlet PNG was declared on the manifest/override).
  if (project.missileSprite?.enabled) {
    const behaviorArt: Partial<Record<BehaviorArtKey, FlightRoleArt>> = {
      ...(project.behaviorArt ?? {}),
    };
    if (parsed.projectState.action === 'roam' && !behaviorArt.roam) {
      behaviorArt.roam = { ...DEFAULT_ROAM_ROLE_ART, mode: 'inherit' };
    }
    if (parsed.projectState.action === 'homing' && !behaviorArt.homing) {
      behaviorArt.homing = { ...DEFAULT_ROLE_ART, mode: 'inherit' };
    }
    if (parsed.projectState.action === 'dig' && !behaviorArt.dig) {
      behaviorArt.dig = { ...DEFAULT_DIG_ROLE_ART, mode: 'inherit' };
    }
    if (project.bitFlight?.mode === 'builder' && !behaviorArt.homing_bit) {
      behaviorArt.homing_bit = { ...DEFAULT_ROLE_ART, mode: 'inherit' };
    }
    if (Object.keys(behaviorArt).length > 0) {
      project.behaviorArt = behaviorArt;
    }
  } else if (parsed.projectState.action === 'roam') {
    // Native roaming sheep flight sheets (flight_1 / flight_2) via SetSpriteOverride
    const f1Id = numericRecordId(parsed.projectState.roamConfig?.flight_1);
    const f2Id = numericRecordId(parsed.projectState.roamConfig?.flight_2);
    const makeRoamSheet = (id: number | undefined): { asset?: RoamSheetAsset; name?: string } => {
      if (!id) return {};
      const hit = resolveSpriteOverride(id, allLibraries, library.key);
      if (!hit || hit.art.kind !== 'image') {
        if (id > 690 || (id >= 240 && id <= 470)) unresolvedOverride = true;
        return {};
      }
      const file = pxlArtToFile(hit.art);
      const frames = inferStripFrames(hit.art, allLibraries, hit.lib.key);
      return {
        name: hit.art.name,
        asset: {
          file,
          fileName: file.name,
          preview: objectUrl(file),
          frames,
          fps: 15,
          play: 'loop',
        },
      };
    };
    const r1 = makeRoamSheet(f1Id);
    const r2 = makeRoamSheet(f2Id);
    if (r1.asset || r2.asset) {
      project.roamSheets = {
        flight1: r1.asset ?? {},
        flight2: r2.asset ?? {},
      };
      const names = [r1.name, r2.name].filter(Boolean).join(', ');
      summary.push(`roam flight sheets: ${names}`);
    }
  }

  // Record sprite fields WormForge only takes as numeric IDs (gas/farting, dig
  // frames, homing trails, and their clustlet twins): resolve SetSpriteOverride
  // so missing/unmodelled overrides are surfaced honestly in the summary.
  const clustlet = parsed.projectState.body?.clustlet;
  const numericOnlyFields: [string, unknown][] = [
    ['missile.homing.trail.sprite', overrides['missile.homing.trail.sprite']],
    ['roam.gas.animal_sprite', parsed.projectState.roamConfig?.gas_animal_sprite],
    ['dig.dive_sprite', parsed.projectState.digConfig?.dive_sprite],
    ['dig.sprite_1', parsed.projectState.digConfig?.sprite_1],
    ['dig.sprite_2', parsed.projectState.digConfig?.sprite_2],
    ['dig.sprite_3', parsed.projectState.digConfig?.sprite_3],
    ['clusters.bit.homing_trail_sprite', clustlet?.homing_trail_sprite],
    ['clusters.bit.roam.gas_animal_sprite', clustlet?.roam?.gas_animal_sprite],
    ['clusters.bit.dig.dive_sprite', clustlet?.dig?.dive_sprite],
    ['clusters.bit.dig.sprite_1', clustlet?.dig?.sprite_1],
    ['clusters.bit.dig.sprite_2', clustlet?.dig?.sprite_2],
    ['clusters.bit.dig.sprite_3', clustlet?.dig?.sprite_3],
  ];
  for (const [field, rawVal] of numericOnlyFields) {
    const id = numericRecordId(rawVal);
    if (!id) continue;
    const hit = resolveSpriteOverride(id, allLibraries, library.key);
    if (hit && hit.art.kind === 'image') {
      summary.push(
        `override #${id} (${field}): ${hit.art.name} (WormForge ${field} uses numeric IDs only)`,
      );
    } else if (id > 690 || (id >= 240 && id <= 470)) {
      unresolvedOverride = true;
    }
  }

  const missingReqs = missingLibraryRequires(library, allLibraries);
  if (missingReqs.length > 0 && unresolvedOverride) {
    summary.push(
      `unloaded requires: ${missingReqs.join(', ')} (open from Libs/ to resolve overrides)`,
    );
  }

  // 5. Offered WAVs from CSoundFile attachments
  const realWeapons = library.weapons.filter((w) => !w.isSectionHeading);
  const matchingSounds = library.parsedScripts.sounds
    .filter(
      (s) =>
        matchesWeaponName(s.weaponName, weapon) ||
        (realWeapons.length === 1 && !s.weaponName),
    )
    .map((s) => s.fileName);
  const offeredSounds = [...new Set(matchingSounds)];
  if (offeredSounds.length > 0) {
    summary.push(`sounds offered: ${offeredSounds.join(', ')}`);
  }

  return {
    success: true,
    project,
    summary,
    offeredSounds,
  };
}
