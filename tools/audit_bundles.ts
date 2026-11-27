/**
 * Round-trip audit over the installed `Mods/` corpus (dev only).
 *
 * `check_pack_fixture.ts` pins a handful of bundles byte for byte. This is the
 * wider net: every installed bundle is read, exported headlessly, read back and
 * exported again, and the two file maps are compared by digest.
 *
 * Three outcomes are legitimate and named rather than counted as failures:
 *
 *  - **a carried `require` no bundle ships.** The emitted module would raise at
 *    load (`require("lib/pyro")` resolves only inside the bundle it came from),
 *    so the export refuses it, and the import warning says which module. Adding
 *    the library to Dependencies is the author's decision, not a fixture's.
 *  - **fallback art that needs the browser canvas.** Bun has no `document`.
 *  - **a source that builds its claims at load.** A module whose `copy_from` is
 *    not a literal leaves the reader with no donor, so the first export writes
 *    the whole record and the next one writes the diff against the donor it now
 *    names. The tool then compares the **second** export with a third: that is
 *    the fixed point the bundle actually has.
 *
 * Usage: `bun run tools/audit_bundles.ts [ModsFolder]`
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readBundles, readWeapons, type ModFile } from '../src/utils/modLib/scan';
import { importBundlePack, type PackImport } from '../src/utils/modLib/importPack';
import { emitPackFiles, type PackLibraries } from '../src/utils/packExporter';

const LIBRARIES: PackLibraries = {
  wfws: {
    modToml: readFileSync('spec/lua_sdk/wfws_sdk/mod.toml', 'utf8'),
    spriteBuilderLua: readFileSync('spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua', 'utf8'),
  },
};
const MODS = process.argv[2] ?? 'D:/Worms Armageddon/WormBench/Mods';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

/** Every nested folder with its own `mod.toml`, the way `scan.ts` finds them. */
const bundleRoots = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    try {
      if (statSync(join(full, 'mod.toml')).isFile()) out.push(full);
      else bundleRoots(full, out);
    } catch {
      // unreadable folder, reported by the bundle that owns it
    }
  }
  return out;
};

const readTree = (root: string): ModFile[] =>
  walk(root).map((full) => {
    const path = relative(root, full).split('\\').join('/');
    if (/\.(lua|toml)$/i.test(path)) return { path, text: readFileSync(full, 'utf8') };
    return { path, text: '', bytes: new Uint8Array(readFileSync(full)) };
  });

const asModFiles = (map: Map<string, string | Uint8Array>): ModFile[] =>
  [...map.entries()].map(([path, content]) =>
    typeof content === 'string' ? { path, text: content } : { path, text: '', bytes: content },
  );

/** Read an export back and export it again, as the editor would. */
const reexport = async (files: Map<string, string | Uint8Array>, bundleId: string) => {
  const back = asModFiles(files);
  const bundles = readBundles(back);
  const source = bundles.find((bundle) => bundle.id === bundleId) ?? bundles[0];
  if (!source) throw new Error(`the export does not read back as a bundle (${bundleId})`);
  const weapons = readWeapons([source], back).filter((weapon) => weapon.record);
  const imported = await importBundlePack(source, weapons, back);
  return { imported, files: await emitPackFiles(imported.pack, LIBRARIES) };
};

const digests = (files: Map<string, string | Uint8Array>): Map<string, string> =>
  new Map(
    [...files.entries()].map(([path, content]) => [
      path,
      createHash('sha256')
        .update(typeof content === 'string' ? content : content)
        .digest('hex'),
    ]),
  );

const differing = (
  left: Map<string, string | Uint8Array>,
  right: Map<string, string | Uint8Array>,
): string[] => {
  const a = digests(left);
  const b = digests(right);
  return [...new Set([...a.keys(), ...b.keys()])].filter((path) => a.get(path) !== b.get(path)).sort();
};

let bundles = 0;
let weaponsTotal = 0;
let exported = 0;
let librarySkipped = 0;
let canvasSkipped = 0;
let donorFixed = 0;
const failures: string[] = [];

for (const root of bundleRoots(MODS).sort()) {
  const label = relative(MODS, root).split('\\').join('/');
  const files = readTree(root);
  const read = readBundles(files);
  if (read.length === 0) continue;
  const bundle = read[0];
  const weapons = readWeapons(read, files).filter((weapon) => weapon.record);
  if (weapons.length === 0) continue;
  bundles += 1;
  weaponsTotal += weapons.length;

  let imported: PackImport;
  try {
    imported = await importBundlePack(bundle, weapons, files);
  } catch (error) {
    failures.push(`${label} (${bundle.id}): import failed: ${(error as Error).message}`);
    continue;
  }
  let first: Map<string, string | Uint8Array>;
  try {
    first = await emitPackFiles(imported.pack, LIBRARIES);
  } catch (error) {
    const message = (error as Error).message;
    if (/document is not defined/.test(message)) {
      canvasSkipped += 1;
      console.log(`CANVAS ${label} (${bundle.id}): fallback art needs a browser canvas`);
      continue;
    }
    if (imported.warnings.some((warning) => /not shipped by the export/.test(warning))) {
      librarySkipped += 1;
      console.log(`LIB    ${label} (${bundle.id}): carried code requires a library only the source ships`);
      for (const warning of imported.warnings.filter((entry) => /not shipped by the export/.test(entry))) {
        console.log(`         ${warning}`);
      }
      continue;
    }
    failures.push(`${label} (${bundle.id}): export failed: ${message}`);
    continue;
  }

  // The one unavoidable difference: the source named no donor, so the first
  // export is a whole record and the second is a diff against the donor it now
  // names. Read that as "a third export must equal the second".
  if (imported.pack.weapons.some((weapon) => !weapon.based_on)) {
    let second: Map<string, string | Uint8Array>;
    let third: Map<string, string | Uint8Array>;
    try {
      const again = await reexport(first, imported.pack.id);
      second = again.files;
      third = await emitPackFiles(
        (await reexport(second, again.imported.pack.id)).imported.pack,
        LIBRARIES,
      );
    } catch (error) {
      failures.push(`${label} (${bundle.id}): re-export failed: ${(error as Error).message}`);
      continue;
    }
    const still = differing(second, third);
    if (still.length > 0) {
      failures.push(`${label} (${bundle.id}): not stable after a named donor (${still.slice(0, 4).join(', ')})`);
      continue;
    }
    donorFixed += 1;
    console.log(`DONOR  ${label} (${bundle.id}): ${weapons.length} weapon(s), stable once the donor is named`);
    continue;
  }

  let second: Map<string, string | Uint8Array>;
  try {
    second = (await reexport(first, imported.pack.id)).files;
  } catch (error) {
    failures.push(`${label} (${bundle.id}): re-import failed: ${(error as Error).message}`);
    continue;
  }
  const changed = differing(first, second);
  if (changed.length > 0) {
    // A binary file can differ by a role writing a sample the claim never names,
    // which is worth showing; text differences get a line each.
    failures.push(
      `${label} (${bundle.id}): ${changed.length} file(s) differ on the second export: ${changed
        .slice(0, 4)
        .join(', ')}`,
    );
    continue;
  }
  exported += 1;
  console.log(`OK     ${label} (${bundle.id}): ${weapons.length} weapon(s), ${first.size} files, byte identical`);
}

console.log('');
for (const failure of failures) console.log(`FAIL   ${failure}`);
console.log(
  `${bundles} bundle(s), ${weaponsTotal} weapon(s): ${exported} byte-identical, ${donorFixed} stable after a named donor, ${librarySkipped} need a library, ${canvasSkipped} need a canvas, ${failures.length} failed`,
);
if (failures.length > 0) process.exit(1);
