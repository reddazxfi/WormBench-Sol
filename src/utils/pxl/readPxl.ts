import type { PxlItem, PxlItemKind, PxlRawFile } from '../../types/pxl';

const PXL_MAGIC = [0x02, 0x01, 0xcd, 0x1b] as const;
const KIND_FILE = 0x02;
const KIND_SCRIPT = 0x04;
const KIND_WEAPON = 0x08;
const MAX_ITEMS = 4096;

export type PxlErrorCode = 'pxl-magic' | 'pxl-truncated' | 'pxl-count' | 'pxl-resync';

export class PxlReadError extends Error {
  readonly code: PxlErrorCode;
  readonly fileName: string;
  readonly offset: number;

  constructor(code: PxlErrorCode, fileName: string, offset: number, message: string) {
    super(message);
    this.name = 'PxlReadError';
    this.code = code;
    this.fileName = fileName;
    this.offset = offset;
  }
}

interface ItemHead {
  kind: PxlItemKind;
  name: string;
  payloadOffset: number;
}

function kindFromByte(byte: number): PxlItemKind | null {
  if (byte === KIND_FILE) return 'file';
  if (byte === KIND_SCRIPT) return 'script';
  if (byte === KIND_WEAPON) return 'weapon';
  return null;
}

function readItemHead(bytes: Uint8Array, view: DataView, offset: number): ItemHead | null {
  if (offset + 5 > bytes.length) return null;
  const kind = kindFromByte(bytes[offset]);
  if (!kind) return null;
  const nameLen = view.getUint32(offset + 1, true);
  if (nameLen < 1 || nameLen > 255 || offset + 5 + nameLen > bytes.length) return null;

  let name = '';
  for (let i = 0; i < nameLen; i++) {
    const c = bytes[offset + 5 + i];
    if (c < 0x20 || c > 0x7e) return null;
    name += String.fromCharCode(c);
  }
  return { kind, name, payloadOffset: offset + 5 + nameLen };
}

/**
 * Parse a Project X `.pxl` container buffer, matching `spec/PX/pxl_extract.py`
 * byte for byte.
 *
 * `file` (`0x02`) and `script` (`0x04`) items store a `u32` byte length, whereas
 * `weapon` (`0x08`) items store an opaque `.wep` + manifest block with no
 * length prefix. Weapon boundaries are recovered by scanning for the next valid
 * item head that lets all remaining items consume the buffer exactly to EOF,
 * memoising failed `(offset, remaining)` states so pathological inputs stay fast.
 */
export function readPxl(buffer: ArrayBuffer, fileName = 'library.pxl'): PxlRawFile {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 9) {
    throw new PxlReadError(
      'pxl-truncated',
      fileName,
      0,
      `${fileName}: truncated .pxl header (${bytes.length} bytes, need at least 9)`,
    );
  }
  for (let i = 0; i < PXL_MAGIC.length; i++) {
    if (bytes[i] !== PXL_MAGIC[i]) {
      throw new PxlReadError(
        'pxl-magic',
        fileName,
        0,
        `${fileName}: not a .pxl library (bad magic at offset 0x0)`,
      );
    }
  }

  const view = new DataView(buffer);
  const version = bytes[4];
  const itemCount = view.getUint32(5, true);
  if (itemCount > MAX_ITEMS) {
    throw new PxlReadError(
      'pxl-count',
      fileName,
      5,
      `${fileName}: item count ${itemCount} exceeds limit (${MAX_ITEMS})`,
    );
  }

  const failed = new Set<string>();
  let furthestOffset = 9;

  const parseFrom = (startOffset: number, startRemaining: number): PxlItem[] | null => {
    const prefix: PxlItem[] = [];
    let o = startOffset;
    let remaining = startRemaining;

    while (remaining > 0) {
      if (o > furthestOffset) furthestOffset = o;
      const key = `${o}:${remaining}`;
      if (failed.has(key)) return null;

      const head = readItemHead(bytes, view, o);
      if (!head) {
        failed.add(key);
        return null;
      }

      if (head.kind === 'file' || head.kind === 'script') {
        if (head.payloadOffset + 4 > bytes.length) {
          failed.add(key);
          return null;
        }
        const dataLen = view.getUint32(head.payloadOffset, true);
        const dataStart = head.payloadOffset + 4;
        if (dataStart + dataLen > bytes.length) {
          failed.add(key);
          return null;
        }
        prefix.push({
          kind: head.kind,
          name: head.name,
          offset: dataStart,
          length: dataLen,
        });
        o = dataStart + dataLen;
        remaining -= 1;
        continue;
      }

      // `weapon` (0x08): no length stored, resync against the next item head (or EOF).
      const payloadStart = head.payloadOffset;
      if (remaining === 1) {
        prefix.push({
          kind: 'weapon',
          name: head.name,
          offset: payloadStart,
          length: bytes.length - payloadStart,
        });
        return prefix;
      }

      for (let end = payloadStart; end <= bytes.length; end++) {
        if (!readItemHead(bytes, view, end)) continue;
        const rest = parseFrom(end, remaining - 1);
        if (rest !== null) {
          prefix.push({
            kind: 'weapon',
            name: head.name,
            offset: payloadStart,
            length: end - payloadStart,
          });
          for (const item of rest) prefix.push(item);
          return prefix;
        }
      }

      failed.add(key);
      return null;
    }

    return o === bytes.length ? prefix : null;
  };

  const items = parseFrom(9, itemCount);
  if (items === null) {
    throw new PxlReadError(
      'pxl-resync',
      fileName,
      furthestOffset,
      `${fileName}: failed to parse ${itemCount} items cleanly to EOF (stuck near offset 0x${furthestOffset.toString(16)})`,
    );
  }

  return { fileName, version, items, buffer };
}
