/**
 * Dev-only: read every bundle under a Mods folder (and the generated test pack)
 * with the editor's bundle reader, and report what it could and could not parse.
 *
 *   bun run tools/scan_mods.ts [modsFolder]
 *
 * Folders and `.zip` archives are both walked; `.7z` is not (no reader for it).
 * Output is a summary per bundle plus the weapons that failed, so a PX-style
 * bundle that hides its records behind `weapons/index.lua` shows up as a number
 * rather than a silent zero.
 *
 * This is L0 of `reqs/wflib_weapon_import_plan.md`: it reports how each weapon's
 * module was *found* (`resolvedVia`), which modules hand their record to a
 * library, which `require` names nothing in the selection provides, and which
 * weapons read a `ctx.option` their own component does not declare (`ctx.option`
 * raises on an unknown key, so that one is a load failure, not a warning).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import JSZip from 'jszip';
import { readBundles, readWeapons, type ModFile } from '../src/utils/modLib/scan';

const TEXT = /\.(lua|toml)$/i;
const WEP = /\.wep$/i;

async function readFolder(root: string): Promise<ModFile[]> {
  const files: ModFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (TEXT.test(entry.name)) {
        const path = relative(root, full).split(sep).join('/');
        files.push({ path, text: readFileSync(full, 'utf8') });
      } else if (WEP.test(entry.name)) {
        const path = relative(root, full).split(sep).join('/');
        files.push({ path, text: '', bytes: new Uint8Array(readFileSync(full)) });
      }
    }
  };
  walk(root);
  return files;
}

async function readZip(path: string): Promise<ModFile[]> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const files: ModFile[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (TEXT.test(name)) {
      files.push({ path: name, text: await entry.async('string') });
    } else if (WEP.test(name)) {
      files.push({ path: name, text: '', bytes: await entry.async('uint8array') });
    }
  }
  return files;
}

async function collect(root: string): Promise<ModFile[]> {
  const files: ModFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.toLowerCase().endsWith('.zip')) {
        // Zips nest their own bundle root; keep paths inside the archive.
        void readZip(full).then((inner) => {
          for (const file of inner) files.push({ ...file, path: `${entry.name}/${file.path}` });
        });
      }
    }
  };

  const stat = statSync(root);
  if (stat.isFile()) return readZip(root);
  walk(root);
  files.push(...(await readFolder(root)));
  // Zips are read asynchronously above; give them a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return files;
}

const root = process.argv[2] ?? 'D:/Worms Armageddon/WormBench/Mods';
const packRoot = 'test_pack/wftest_pack';

const all: ModFile[] = [];
for (const source of [root, packRoot]) {
  try {
    const files = await collect(source);
    for (const file of files) all.push({ ...file, path: `${source === packRoot ? 'test' : 'mods'}/${file.path}` });
  } catch (error) {
    console.log(`skip ${source}: ${(error as Error).message}`);
  }
}

const bundles = readBundles(all);
const weapons = readWeapons(bundles, all);

console.log(`files: ${all.length}, bundles: ${bundles.length}, weapons: ${weapons.length}\n`);

let withRecord = 0;
for (const bundle of bundles) {
  const own = weapons.filter((weapon) => weapon.bundleId === bundle.id);
  if (own.length === 0) continue;
  const ok = own.filter((weapon) => weapon.record).length;
  withRecord += ok;
  console.log(
    `${bundle.id.padEnd(24)} ${String(ok).padStart(3)}/${String(own.length).padStart(3)} records` +
      `  deps: ${bundle.dependencies.join(', ') || '-'}`,
  );
}

console.log(`\nweapons with a record: ${withRecord}/${weapons.length}`);
const routes = new Map<string, number>();
for (const weapon of weapons) {
  const route = weapon.resolvedVia ?? (weapon.record ? 'other' : 'miss');
  routes.set(route, (routes.get(route) ?? 0) + 1);
}
console.log(
  `\nmodule found by: ${[...routes]
    .sort((a, b) => b[1] - a[1])
    .map(([route, count]) => `${route} ${count}`)
    .join(', ')}`,
);
const viaRequire = weapons.filter((weapon) => weapon.resolvedVia === 'require');
if (viaRequire.length > 0) {
  console.log(`records handed to a library: ${viaRequire.length}`);
  for (const weapon of viaRequire.slice(0, 5)) {
    console.log(`  ${weapon.componentId} -> ${weapon.modulePath}`);
  }
}

// `ctx.option` reads. An option the component does not declare raises at
// install (`ctx.option` is an error for an unknown key), so an undeclared read
// is a load failure rather than a warning.
const optionWeapons = weapons.filter((weapon) => (weapon.optionReads ?? []).length > 0);
// `ctx.option` reads *this component's* options, so an option declared on
// another component of the same bundle (a feature's settings) is still a nil
// read here: both classes are reported.
const declaredOwn = new Set(
  weapons.flatMap((weapon) => weapon.options ?? []).map((option) => option.key),
);
const declaredAnywhere = new Set(
  bundles.flatMap((bundle) => bundle.components).flatMap((component) => component.options.map((option) => option.key)),
);
const undeclared = new Set(
  optionWeapons
    .flatMap((weapon) => weapon.optionReads ?? [])
    .filter((key) => !declaredAnywhere.has(key)),
);
const declaredElsewhere = new Set(
  optionWeapons
    .flatMap((weapon) => weapon.optionReads ?? [])
    .filter((key) => declaredAnywhere.has(key) && !declaredOwn.has(key)),
);
const dataOptions = weapons
  .flatMap((weapon) => weapon.options ?? [])
  .filter((option) => option.data);
console.log(`\nctx.option: ${optionWeapons.length} weapon(s) read a declared option`);
if (dataOptions.length > 0) {
  console.log(
    `  options that are weapon data fields: ${[...new Set(dataOptions.map((option) => option.key))].join(', ')}`,
  );
}
console.log(
  `  read but declared nowhere in the selection: ${undeclared.size > 0 ? [...undeclared].join(', ') : 'none'}`,
);
console.log(
  `  read but declared on another component (nil for this one): ${
    declaredElsewhere.size > 0 ? [...declaredElsewhere].join(', ') : 'none'
  }`,
);

// A `require` is only resolvable inside the selection: `wf-lib/<name>` goes
// through the exporting bundle's `[exports]`, so a dependency left out of the
// scan reads as missing.
const unresolved = new Map<string, number>();
const legacy = new Map<string, number>();
for (const weapon of weapons) {
  for (const name of weapon.unresolvedRequires ?? []) {
    unresolved.set(name, (unresolved.get(name) ?? 0) + 1);
  }
  for (const name of weapon.localLibraryRequires ?? []) {
    legacy.set(name, (legacy.get(name) ?? 0) + 1);
  }
}
console.log(`\nunresolved requires: ${unresolved.size}`);
for (const [name, count] of [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${name} (${count})`);
}
if (legacy.size > 0) {
  // Satisfied by the bundle's own `lib/` while the name says `wf-lib/`: the
  // current engine refuses that (`modules.rs` resolves the prefix through a
  // declared dependency's `[exports]` only), so the code loads nowhere as is.
  console.log(`\na wf-lib/ name the bundle satisfies from its own lib/: ${[...legacy.keys()].join(', ')}`);
}

const failed = weapons.filter((weapon) => !weapon.record);
for (const weapon of failed.slice(0, 15)) {
  console.log(`  MISS ${weapon.componentId}: ${weapon.error}${weapon.modulePath ? ` (${weapon.modulePath})` : ''}`);
}
if (failed.length > 15) console.log(`  … ${failed.length - 15} more`);

// One worked example, so the shapes are visible.
const sample =
  weapons.find((weapon) => weapon.componentId === 'px.banana_express') ??
  weapons.find((weapon) => weapon.record);
if (sample?.record) {
  const record = sample.record;
  console.log(`\nsample ${sample.componentId} from ${sample.modulePath}`);
  console.log(`  copy_from: ${sample.copyFrom ?? '-'}`);
  console.log(`  keys: ${Object.keys(record).join(', ')}`);
  const missile = record.missile as Record<string, unknown> | undefined;
  if (missile) console.log(`  missile keys: ${Object.keys(missile).join(', ')}`);
  console.log(`  sprite: ${JSON.stringify(missile?.sprite)} burst: ${JSON.stringify(missile?.burst)}`);
  if (sample.defaults) console.log(`  defaults: ${JSON.stringify(sample.defaults)}`);
}
