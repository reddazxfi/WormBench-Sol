import type { PxlWepManifest } from '../../types/pxl';
import type { WormSpritePoseKey } from '../../types/weapon';

const WORM_POSE_SLOT_ORDER: WormSpritePoseKey[] = [
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

const MANIFEST_AT = 0x1e4;
const ART_EXT_RE = /\.(png|bmp|wav|gif|img)$/i;
const ASSET_EXT_RE = /\.(png|bmp|wav|gif)$/i;

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function isPrintableAscii(bytes: Uint8Array, start: number, len: number): boolean {
  for (let i = 0; i < len; i++) {
    const c = bytes[start + i];
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

function readLenPrefixedString(
  bytes: Uint8Array,
  offset: number,
  maxLen = 260,
): { value: string; next: number } | null {
  if (offset + 4 > bytes.length) return null;
  const len = readU32(bytes, offset);
  if (len > maxLen || offset + 4 + len > bytes.length) return null;
  if (!isPrintableAscii(bytes, offset + 4, len)) return null;
  let value = '';
  for (let i = 0; i < len; i++) {
    value += String.fromCharCode(bytes[offset + 4 + i]);
  }
  return { value, next: offset + 4 + len };
}

/**
 * True when a `.pxl` weapon block is a PX menu divider such as
 * `------------------------------- Zooks:`.
 */
export function isSectionHeadingName(name: string, id = '', artCount = 0): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^[-=_*]{3,}/.test(trimmed)) return true;
  if (!id && artCount === 0 && /^[-=_*:\s]+$/.test(trimmed)) return true;
  return false;
}

/**
 * Read the Project X art manifest trailer starting at `0x1E4` of a `.wep`
 * record (standalone or embedded inside a `.pxl` `0x08` item).
 *
 * The four header strings (`name`, `id`, `icon`, `artDir`) sit rigidly at
 * `0x1E4`. After 29 bytes of flags, up to 9 `u32`-length-prefixed sprite
 * slots follow (pick level/up/down, fire level/up/down, aim level/up/down);
 * if those slots do not align cleanly, the reader scans forward up to 256 bytes
 * for `u32`-length-prefixed asset names.
 */
export function readWepManifest(bytes: Uint8Array): PxlWepManifest {
  const empty: PxlWepManifest = { name: '', id: '', holdSlots: [], art: [] };
  if (bytes.length < MANIFEST_AT + 4) return empty;

  let pos = MANIFEST_AT;
  const sName = readLenPrefixedString(bytes, pos);
  if (!sName) return empty;
  pos = sName.next;

  const sId = readLenPrefixedString(bytes, pos);
  const id = sId ? sId.value : '';
  if (sId) pos = sId.next;

  const sIcon = readLenPrefixedString(bytes, pos);
  const icon = sIcon && sIcon.value ? sIcon.value : undefined;
  if (sIcon) pos = sIcon.next;

  const sDir = readLenPrefixedString(bytes, pos);
  const artDir = sDir && sDir.value ? sDir.value : undefined;
  if (sDir) pos = sDir.next;

  const holdSlots: string[] = [];
  const poseSlots: Partial<Record<WormSpritePoseKey, string>> = {};
  const art: string[] = [];
  const seenArt = new Set<string>();
  const pushArt = (entry: string) => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (!seenArt.has(trimmed.toLowerCase())) {
      seenArt.add(trimmed.toLowerCase());
      art.push(trimmed);
    }
  };

  if (icon && ASSET_EXT_RE.test(icon)) {
    pushArt(icon);
  }

  let missileSprite: string | undefined;
  let clustletSprite: string | undefined;
  let homingSprite: string | undefined;
  let planeSprite: string | undefined;

  // Primary structured parse after `artDir`:
  // 5 u32-length-prefixed strings (`missile`, `clustlet`, `homing`, `plane`, `reserved`),
  // 1 flag byte, 2 u32-length-prefixed strings, then up to 9 hold/aim/fire slots.
  let structuredOk = false;
  let cur = pos;
  const directSlots: string[] = [];
  let directOk = true;
  for (let i = 0; i < 5; i++) {
    const s = readLenPrefixedString(bytes, cur, 260);
    if (!s) {
      directOk = false;
      break;
    }
    directSlots.push(s.value);
    cur = s.next;
  }

  if (directOk) {
    if (directSlots[0] && ASSET_EXT_RE.test(directSlots[0])) {
      missileSprite = directSlots[0];
      pushArt(directSlots[0]);
    }
    if (directSlots[1] && ASSET_EXT_RE.test(directSlots[1])) {
      clustletSprite = directSlots[1];
      pushArt(directSlots[1]);
    }
    if (directSlots[2] && ASSET_EXT_RE.test(directSlots[2])) {
      homingSprite = directSlots[2];
      pushArt(directSlots[2]);
    }
    if (directSlots[3] && ASSET_EXT_RE.test(directSlots[3])) {
      planeSprite = directSlots[3];
      pushArt(directSlots[3]);
    }

    // Skip 1 flag byte + 2 empty strings, then read up to 9 hold slots.
    if (cur < bytes.length) {
      cur += 1;
      const a0 = readLenPrefixedString(bytes, cur, 255);
      const a1 = a0 ? readLenPrefixedString(bytes, a0.next, 255) : null;
      if (a1) {
        cur = a1.next;
        const rawSlots: string[] = [];
        for (let i = 0; i < 9; i++) {
          const slot = readLenPrefixedString(bytes, cur, 255);
          if (!slot) break;
          rawSlots.push(slot.value);
          cur = slot.next;
        }
        if (rawSlots.length >= 6) {
          structuredOk = true;
          rawSlots.forEach((s, idx) => {
            if (s && ART_EXT_RE.test(s)) {
              holdSlots.push(s);
              if (idx < WORM_POSE_SLOT_ORDER.length) {
                poseSlots[WORM_POSE_SLOT_ORDER[idx]] = s;
              }
              pushArt(s);
            }
          });
        }
      }
    }
  }

  // Fallback scan: bounded 256-byte window for u32-length-prefixed art filenames.
  if (!structuredOk) {
    const limit = Math.min(bytes.length, pos + 256);
    let scan = directOk ? cur : pos;
    while (scan + 4 < limit) {
      const candidate = readLenPrefixedString(bytes, scan, 128);
      if (candidate && candidate.value.length >= 5 && ASSET_EXT_RE.test(candidate.value)) {
        holdSlots.push(candidate.value);
        pushArt(candidate.value);
        scan = candidate.next;
      } else {
        scan += 1;
      }
    }
  }

  return {
    name: sName.value,
    id,
    icon,
    artDir,
    missileSprite,
    clustletSprite,
    homingSprite,
    planeSprite,
    holdSlots,
    poseSlots,
    art,
  };
}
