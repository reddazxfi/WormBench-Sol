/**
 * Read the embedded weapon records out of a Project X scheme (`.pxs`).
 *
 * A version-10 PX scheme carries one page of 71 WA weapon records in slot
 * order, each a complete `.wep` blob: the scheme's weapons are the ones its
 * mod plays with, so they are the donor fixture for `stockDonors.json`
 * (`spec/PX/default.pxs` ships one).
 *
 * Layout, mirroring `WormBench-engine/tools/px_scheme_weps.py`:
 *
 *   "SCHM OF WAPX" | u32 version (10) | 15 bytes | u32 page count
 *   pages x 71 x record | u32 0 | files | scripts | libraries | wsc flag
 *
 * Each record is the `.wep` tag, `0x1E0` more bytes, nine strings, eight
 * metadata bytes, an optional script pair, nine more strings and four flags.
 * `data` is the record alone (what `weps/<slot>.wep` would be).
 */

/** `crates/weapons/src/stock.rs` STOCK_NAMES, the scheme's slot order. */
export const PX_STOCK_SLOTS = [
  'none', 'bazooka', 'homing_missile', 'mortar', 'homing_pigeon', 'sheep_launcher',
  'grenade', 'cluster_bomb', 'banana_bomb', 'battle_axe', 'earthquake', 'shotgun',
  'handgun', 'uzi', 'minigun', 'longbow', 'fire_punch', 'dragon_ball', 'kamikaze',
  'suicide_bomber', 'prod', 'dynamite', 'mine', 'sheep', 'super_sheep', 'aqua_sheep',
  'mole_bomb', 'air_strike', 'napalm_strike', 'mail_strike', 'mine_strike',
  'mole_squadron', 'blow_torch', 'pneumatic_drill', 'girder', 'baseball_bat',
  'girder_pack', 'ninja_rope', 'bungee', 'parachute', 'teleport', 'scales_of_justice',
  'super_banana', 'holy_grenade', 'flame_thrower', 'salvation_army', 'mb_bomb',
  'petrol_bomb', 'skunk', 'ming_vase', 'sheep_strike', 'carpet_bomb', 'mad_cow',
  'old_woman', 'donkey', 'nuclear_test', 'armageddon', 'skip_go', 'surrender',
  'select_worm', 'freeze', 'magic_bullet', 'jet_pack', 'low_gravity', 'fast_walk',
  'laser_sight', 'invisibility', 'damage_x2', 'crate_spy', 'double_turn_time',
  'crate_shower',
];

const TAG = [0x06, 0xdd, 0xbb, 0x5a];
const STRINGS_AT = 0x1e4;
const SCHEME_MAGIC = 'SCHM OF WAPX';

export type PxRecord = { slot: string; name: string; data: Uint8Array };

class Reader {
  private at = 0;
  constructor(private readonly data: Uint8Array) {}

  get offset(): number {
    return this.at;
  }

  take(size: number): Uint8Array {
    if (size < 0 || size > this.data.length - this.at) {
      throw new Error(`truncated PX scheme at byte ${this.at}: need ${size} bytes`);
    }
    const value = this.data.subarray(this.at, this.at + size);
    this.at += size;
    return value;
  }

  u32(): number {
    const bytes = this.take(4);
    return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  }

  boolean(): boolean {
    const value = this.take(1)[0];
    if (value !== 0 && value !== 1) {
      throw new Error(`invalid PX boolean ${value} at byte ${this.at - 1}`);
    }
    return value === 1;
  }

  string(): string {
    return Buffer.from(this.take(this.u32())).toString('latin1');
  }

  count(): number {
    const value = this.u32();
    if (value > (this.data.length - this.at) / 4) {
      throw new Error(`invalid PX item count ${value} at byte ${this.at - 4}`);
    }
    return value;
  }
}

function readRecord(reader: Reader): { start: number; end: number; name: string } {
  const start = reader.offset;
  const tag = Array.from(reader.take(4));
  if (tag.some((byte, index) => byte !== TAG[index])) {
    throw new Error(`missing PX weapon tag at byte ${start}`);
  }
  reader.take(STRINGS_AT - 4);
  const strings: string[] = [];
  for (let index = 0; index < 9; index += 1) strings.push(reader.string());
  reader.take(8);
  if (reader.boolean()) {
    reader.string();
    reader.string();
  }
  for (let index = 0; index < 9; index += 1) reader.string();
  reader.take(4);
  return { start, end: reader.offset, name: strings[0] };
}

export function readPxScheme(bytes: Uint8Array): PxRecord[][] {
  const reader = new Reader(bytes);
  const magic = Buffer.from(reader.take(SCHEME_MAGIC.length)).toString('latin1');
  if (magic !== SCHEME_MAGIC) throw new Error('not a Project X scheme');
  const version = reader.u32();
  if (version !== 10) throw new Error(`unsupported PX scheme version ${version}; expected 10`);
  reader.take(15);
  const pageCount = reader.u32();
  if (pageCount === 0 || pageCount > (bytes.length - reader.offset) / (PX_STOCK_SLOTS.length * STRINGS_AT)) {
    throw new Error(`invalid PX weapon page count ${pageCount}`);
  }
  const pages: PxRecord[][] = [];
  for (let page = 0; page < pageCount; page += 1) {
    const records: PxRecord[] = [];
    for (const slot of PX_STOCK_SLOTS) {
      const record = readRecord(reader);
      records.push({ slot, name: record.name, data: bytes.subarray(record.start, record.end) });
    }
    pages.push(records);
  }
  if (reader.u32() !== 0) throw new Error('unsupported nonzero PX post-record field');
  for (let index = reader.count(); index > 0; index -= 1) {
    reader.string();
    reader.take(reader.u32());
  }
  for (let index = reader.count(); index > 0; index -= 1) {
    reader.string();
    reader.take(reader.u32());
  }
  for (let index = reader.count(); index > 0; index -= 1) reader.string();
  if (reader.boolean()) {
    reader.take(reader.u32());
    reader.string();
  }
  if (reader.offset !== bytes.length) {
    throw new Error(`unexpected trailing bytes after PX scheme at byte ${reader.offset}`);
  }
  return pages;
}

export function readPxSchemeRecord(bytes: Uint8Array, slot: string): Uint8Array | undefined {
  return readPxScheme(bytes)[0]?.find((record) => record.slot === slot)?.data;
}
