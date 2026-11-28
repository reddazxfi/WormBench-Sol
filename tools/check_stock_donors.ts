/**
 * Donor fixture check: every committed stock donor is the record the engine
 * actually plays.
 *
 * `src/data/stockDonors.json` is generated from the weapon records embedded in
 * a Project X scheme (`spec/PX/default.pxs` ships PX's default one), so a donor
 * is a decoded `.wep`, not a hand-written guess. This check re-decodes those
 * records and fails when a donor's fire type, subtype, action, body or record
 * overrides no longer match, which is how a parser change quietly invalidates
 * the panels and the export diffs.
 *
 * `body.sprite` is not compared: the parser mirrors the projectile art into it
 * for the hold preview, and it is not a record field. `body.clustlet` is not
 * compared either: a donor that does not burst keeps an editable cluster
 * template in slots its action owns.
 *
 * Run: `bun run tools/check_stock_donors.ts` (exits 1 on a failure).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWepBinary } from '../src/utils/wepParser';
import { STOCK_WEAPONS } from '../src/data/stockWeapons';
import donors from '../src/data/stockDonors.json';
import { readPxScheme } from './pxScheme';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = `${HERE}spec/PX/default.pxs`;

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
};

const pages = readPxScheme(new Uint8Array(readFileSync(FIXTURE)));
check('the PX fixture has one weapon page', pages.length === 1, String(pages.length));
const records = new Map(pages[0]!.map((record) => [record.slot, record.data]));

const donorIds = Object.keys(donors);
check('the fixture decodes every stock slot', records.size === 71, String(records.size));
check('there are 70 stock donors', donorIds.length === 70, String(donorIds.length));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

for (const id of donorIds) {
  const donor = (donors as Record<string, any>)[id];
  check(`${id}: names a stock weapon`, STOCK_WEAPONS.some((weapon) => weapon.id === id));
  const bytes = records.get(id);
  check(`${id}: has a record in the fixture`, !!bytes);
  if (!bytes) continue;
  const decoded = parseWepBinary(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    `${id}.wep`,
  );
  check(`${id}: the record decodes`, decoded.success, decoded.error);
  if (!decoded.success) continue;
  const state = decoded.projectState as Record<string, any>;
  for (const key of ['fireType', 'specialSubtype', 'action', 'burst'] as const) {
    check(`${id}: ${key} matches the record`, same(donor[key], state[key]), `${JSON.stringify(donor[key])} vs ${JSON.stringify(state[key])}`);
  }
  for (const [key, value] of Object.entries(donor.body ?? {})) {
    if (key === 'sprite' || key === 'clustlet') continue;
    check(
      `${id}: body.${key} matches the record`,
      same(value, state.body?.[key]),
      `${JSON.stringify(value)} vs ${JSON.stringify(state.body?.[key])}`,
    );
  }
  for (const [key, value] of Object.entries(donor.recordOverrides ?? {})) {
    check(
      `${id}: ${key} matches the record`,
      same(value, state.recordOverrides?.[key]),
      `${JSON.stringify(value)} vs ${JSON.stringify(state.recordOverrides?.[key])}`,
    );
  }
}

const armageddon = (donors as Record<string, any>).armageddon;
check('the Armageddon donor is special subtype 24', armageddon?.specialSubtype === 24, String(armageddon?.specialSubtype));
check(
  'and carries the meteor body under its own prefix',
  Object.keys(armageddon?.recordOverrides ?? {}).some((key) => key.startsWith('armageddon.meteor.')),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} donor check(s) failed`);
  process.exit(1);
}
console.log('\nstock donors: all checks passed');
