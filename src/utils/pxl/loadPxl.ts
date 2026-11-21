import type { PxlArt, PxlArtKind, PxlLibrary, PxlWeapon } from '../../types/pxl';
import { readPxl } from './readPxl';
import { isSectionHeadingName, readWepManifest } from './readWepManifest';
import { basenameOfAsset, readSpriteScripts } from './readSpriteScripts';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};

export function mimeForPxlFile(name: string): { mime: string; kind: PxlArtKind } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  if (ext === 'png' || ext === 'gif' || ext === 'bmp') return { mime, kind: 'image' };
  if (ext === 'wav' || ext === 'ogg' || ext === 'mp3') return { mime, kind: 'sound' };
  return { mime, kind: 'other' };
}

export function imageSizeOfBytes(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width =
      ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const height =
      ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    if (width > 0 && height > 0) return { width, height };
  }
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (width > 0 && height > 0) return { width, height };
  }
  return undefined;
}

function decodeLatin1(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('latin1').decode(bytes);
    } catch {
      // Fallback below
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Parse a `.pxl` `ArrayBuffer` into a `PxlLibrary` without copying item bytes.
 * Scripts are scanned for `LoadSprite` frame counts, `CWormAnimParams` hold
 * geometry, `WeapSpriteParams` flight settings and `CSoundFile` WAVs; `.wep`
 * blocks are decoded for their manifest headers and hold-art slots.
 */
export function parsePxlLibrary(buffer: ArrayBuffer, fileName: string): PxlLibrary {
  const raw = readPxl(buffer, fileName);
  const scripts: { name: string; text: string }[] = [];

  for (const item of raw.items) {
    if (item.kind === 'script') {
      const slice = new Uint8Array(buffer, item.offset, item.length);
      scripts.push({ name: item.name, text: decodeLatin1(slice) });
    }
  }

  const parsedScripts = readSpriteScripts(scripts.map((s) => s.text));

  const art: PxlArt[] = [];
  const weapons: PxlWeapon[] = [];

  for (const item of raw.items) {
    if (item.kind === 'file') {
      const { mime, kind } = mimeForPxlFile(item.name);
      const view = new Uint8Array(buffer, item.offset, item.length);
      const size = kind === 'image' ? imageSizeOfBytes(view) : undefined;
      const frames =
        parsedScripts.frameCounts.get(item.name.toLowerCase()) ??
        parsedScripts.frameCounts.get(basenameOfAsset(item.name).toLowerCase());
      art.push({
        name: item.name,
        mime,
        kind,
        offset: item.offset,
        length: item.length,
        bytesOf: () => new Uint8Array(buffer, item.offset, item.length),
        ...(frames !== undefined ? { frames } : {}),
        ...(size ? { width: size.width, height: size.height } : {}),
      });
    } else if (item.kind === 'weapon') {
      const view = new Uint8Array(buffer, item.offset, item.length);
      const manifest = readWepManifest(view);
      const displayName = manifest.name || item.name;
      const isSectionHeading = isSectionHeadingName(displayName, manifest.id, manifest.art.length);
      weapons.push({
        itemName: item.name,
        name: displayName,
        id: manifest.id,
        icon: manifest.icon,
        artDir: manifest.artDir,
        missileSprite: manifest.missileSprite,
        clustletSprite: manifest.clustletSprite,
        homingSprite: manifest.homingSprite,
        planeSprite: manifest.planeSprite,
        holdSlots: manifest.holdSlots,
        poseSlots: manifest.poseSlots,
        art: manifest.art,
        isSectionHeading,
        offset: item.offset,
        length: item.length,
        bytesOf: () => new Uint8Array(buffer, item.offset, item.length),
      });
    }
  }

  return {
    key: `${fileName}:${buffer.byteLength}`,
    fileName,
    version: raw.version,
    items: raw.items,
    weapons,
    art,
    scripts,
    parsedScripts,
    buffer,
  };
}

/**
 * Resolve an art filename against loaded `.pxl` libraries: the preferred library
 * first, then every other loaded library (closing the `cweps` -> `cweps_gfx` gap).
 */
export function resolvePxlArt(
  rawName: string | undefined,
  libraries: readonly PxlLibrary[],
  preferredKey?: string,
): { lib: PxlLibrary; art: PxlArt } | undefined {
  if (!rawName) return undefined;
  const target = rawName.trim().toLowerCase();
  const base = basenameOfAsset(target);
  if (!base) return undefined;

  const ordered = preferredKey
    ? [
        ...libraries.filter((l) => l.key === preferredKey),
        ...libraries.filter((l) => l.key !== preferredKey),
      ]
    : libraries;

  for (const lib of ordered) {
    const exact = lib.art.find((a) => a.name.toLowerCase() === target);
    if (exact) return { lib, art: exact };
    const byBase = lib.art.find((a) => basenameOfAsset(a.name).toLowerCase() === base);
    if (byBase) return { lib, art: byBase };
  }
  return undefined;
}

/**
 * Resolve `LoadSprite` frame count for an asset name across loaded libraries,
 * checking the preferred library first.
 */
export function resolvePxlFrames(
  rawName: string | undefined,
  libraries: readonly PxlLibrary[],
  preferredKey?: string,
): number | undefined {
  if (!rawName) return undefined;
  const target = rawName.trim().toLowerCase();
  const base = basenameOfAsset(target);
  if (!base) return undefined;

  const ordered = preferredKey
    ? [
        ...libraries.filter((l) => l.key === preferredKey),
        ...libraries.filter((l) => l.key !== preferredKey),
      ]
    : libraries;

  for (const lib of ordered) {
    const n =
      lib.parsedScripts.frameCounts.get(target) ??
      lib.parsedScripts.frameCounts.get(base);
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * Resolve a numeric sprite ID overridden via `SetSpriteOverride(id, var)`
 * across open libraries (preferred library first).
 */
export function resolveSpriteOverride(
  spriteId: number | undefined,
  libraries: readonly PxlLibrary[],
  preferredKey?: string,
): { lib: PxlLibrary; art: PxlArt } | undefined {
  if (!spriteId || !Number.isFinite(spriteId)) return undefined;

  const ordered = preferredKey
    ? [
        ...libraries.filter((l) => l.key === preferredKey),
        ...libraries.filter((l) => l.key !== preferredKey),
      ]
    : libraries;

  for (const lib of ordered) {
    const fileName = lib.parsedScripts.spriteOverrides.get(spriteId);
    if (!fileName) continue;
    const hit = resolvePxlArt(fileName, ordered, lib.key);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Infer a sheet's vertical frame count from `LoadSprite` first, then from the
 * engine's square-cell vertical strip rule (`height / width`).
 */
export function inferStripFrames(
  art: PxlArt,
  libraries: readonly PxlLibrary[],
  preferredKey?: string,
): number {
  const fromScript =
    art.frames ?? resolvePxlFrames(art.name, libraries, preferredKey);
  if (fromScript && fromScript > 0) return fromScript;
  if (art.width && art.height && art.height > art.width && art.height % art.width === 0) {
    return art.height / art.width;
  }
  return 1;
}

/**
 * Names from a library's `require ...;` lines whose `.pxl` is not currently open.
 */
export function missingLibraryRequires(
  lib: PxlLibrary,
  allLibraries: readonly PxlLibrary[],
): string[] {
  const openStems = new Set(
    allLibraries.map((l) => l.fileName.replace(/\.pxl$/i, '').toLowerCase()),
  );
  return lib.parsedScripts.requires.filter(
    (req) => !openStems.has(req.replace(/\.pxl$/i, '').toLowerCase()),
  );
}

/** Synthesise a browser/DOM `File` from a `PxlArt` entry. */
export function pxlArtToFile(art: PxlArt): File {
  const bytes = art.bytesOf();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const baseName = basenameOfAsset(art.name) || 'asset';
  return new File([copy], baseName, { type: art.mime || 'application/octet-stream' });
}
