import type { WormSpritePoseKey } from './weapon';

export type PxlItemKind = 'file' | 'script' | 'weapon';

export interface PxlItem {
  kind: PxlItemKind;
  name: string;
  /** Byte offset of the item payload inside the library's `ArrayBuffer`. */
  offset: number;
  /** Byte length of the item payload. */
  length: number;
}

export interface PxlRawFile {
  fileName: string;
  version: number;
  items: PxlItem[];
  buffer: ArrayBuffer;
}

export interface PxlWepManifest {
  name: string;
  id: string;
  icon?: string;
  artDir?: string;
  /** Direct PNG filenames declared on the PX `.wep` sprite fields (when index is 100000 / custom). */
  missileSprite?: string;
  clustletSprite?: string;
  homingSprite?: string;
  planeSprite?: string;
  /** Non-empty hold/aim/fire slots in manifest order (up to 9 slots). */
  holdSlots: string[];
  /** Exact 9-slot mapping (`weaponlnk`/`wthrow`/`weaponfire` level, up, down). */
  poseSlots?: Partial<Record<WormSpritePoseKey, string>>;
  /** All distinct art filenames named in the manifest trailer. */
  art: string[];
}

export interface PxlWeapon {
  /** Name of the 0x08 item inside the `.pxl` container. */
  itemName: string;
  /** Display name from `0x1E4` (or `itemName` when empty). */
  name: string;
  /** Internal PX id string from the trailer. */
  id: string;
  icon?: string;
  artDir?: string;
  missileSprite?: string;
  clustletSprite?: string;
  homingSprite?: string;
  planeSprite?: string;
  holdSlots: string[];
  poseSlots?: Partial<Record<WormSpritePoseKey, string>>;
  art: string[];
  /** True for PX menu dividers such as `------------------------------- Zooks:`. */
  isSectionHeading: boolean;
  offset: number;
  length: number;
  /** Zero-copy view of the `.wep` block bytes inside `library.buffer`. */
  bytesOf: () => Uint8Array;
}

export type PxlArtKind = 'image' | 'sound' | 'other';

export interface PxlArt {
  name: string;
  mime: string;
  kind: PxlArtKind;
  offset: number;
  length: number;
  bytesOf: () => Uint8Array;
  /** Frame count from a `LoadSprite(f, n, 0)` pair in a library script. */
  frames?: number;
  /** Natural image size read from PNG IHDR or GIF header, if available. */
  width?: number;
  height?: number;
}

export interface PxlScriptHoldParams {
  weaponName?: string;
  handRadius?: number;
  handRotation?: number;
  handRadialRotation?: number;
  handScale?: number;
  handType?: 'lower' | 'mid' | 'upper';
  scale?: number;
  weapRotation?: number;
  weapRadialRotation?: number;
  weapRadius?: number;
  drawHand?: boolean;
  animate?: boolean;
  animSpeed?: number;
  zplane?: number;
  useSpriteSystem?: boolean;
  subSpriteNumber?: number;
  subSpriteFiring?: number;
  numSpritesInSheet?: number;
  sheetName?: string;
  firingSheetName?: string;
}

export interface PxlScriptFlightParams {
  weaponName?: string;
  animate?: boolean;
  animSpeed?: number;
  zplane?: number;
  scale?: number;
  hideWorm?: boolean;
  rotation?: number;
  dontRotateBySpeed?: boolean;
  animateBySpeed?: boolean;
  playBackwards?: boolean;
  angIfDontRotate?: number;
  useSpriteSystem?: boolean;
  subSpriteNumber?: number;
  numSpritesInSheet?: number;
  sheetName?: string;
}

export interface PxlScriptSoundRef {
  fileName: string;
  varName: string;
  weaponName?: string;
}

export interface PxlParsedScripts {
  /** Lowercase asset name (and basename) -> `LoadSprite` frame count. */
  frameCounts: Map<string, number>;
  /** Exact-case asset name -> `LoadSprite` frame count. */
  frameCountsRaw: Map<string, number>;
  holdParams: PxlScriptHoldParams[];
  flightParams: PxlScriptFlightParams[];
  sounds: PxlScriptSoundRef[];
  /** Library dependencies named by `require ...;` (excluding PX built-in helpers). */
  requires: string[];
  /** `SetSpriteOverride(spriteId, spriteVar)` -> resolved asset filename. */
  spriteOverrides: Map<number, string>;
}

export interface PxlLibrary {
  /** `${fileName}:${buffer.byteLength}` for deduplication on re-import. */
  key: string;
  fileName: string;
  version: number;
  items: PxlItem[];
  weapons: PxlWeapon[];
  art: PxlArt[];
  scripts: { name: string; text: string }[];
  parsedScripts: PxlParsedScripts;
  buffer: ArrayBuffer;
}
