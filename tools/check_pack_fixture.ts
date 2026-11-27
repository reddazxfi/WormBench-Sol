/**
 * Dev-only: a **real** pack round-trips through the editor unchanged (P6 of
 * `reqs/pack_export_plan.md`, no server, exits 1 on a failure).
 *
 *   bun run tools/gen_test_pack.ts      # the 60-shape fixture
 *   bun run tools/check_pack_fixture.ts
 *
 * `check_pack_roundtrip.ts` builds its packs in memory, so it proves the rules
 * hold for the shapes it was told about. This one takes art and code off disk,
 * one instance of every shape the editor can emit (the test pack), plus whatever
 * real bundles are installed, and asserts the property that matters:
 *
 *   **import -> export -> import -> export writes the same bytes.**
 *
 * Every file of the second export is compared by digest with the first. A field
 * the importer could not recover shows up as one changed line, and it is caught
 * here rather than in game. That is how the three claim-`sprites` defects this
 * fixture found were found: a hold sheet shared with another weapon by the
 * export's dedupe was re-read by its *file name* (`body.png`) and became the
 * weapon's strike art, a cluster bit sheet became stock cluster art, and the
 * invented strike art then suppressed `params = { gpu_prefix = "sprites/" }`,
 * which is what makes the aim layer's `wa.draw.quad` resolve a pack path.
 *
 * A bundle whose fallback art has to be painted needs the browser's canvas, so
 * the Node fixture skips it **and says so**: silence would hide the day a bundle
 * that used to export starts needing one.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readBundles, readWeapons, type ModFile } from '../src/utils/modLib/scan';
import { importBundlePack } from '../src/utils/modLib/importPack';
import { emitPackFiles, type PackLibraries } from '../src/utils/packExporter';

const LIBRARIES: PackLibraries = {
  wfws: {
    modToml: readFileSync('spec/lua_sdk/wfws_sdk/mod.toml', 'utf8'),
    spriteBuilderLua: readFileSync('spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua', 'utf8'),
  },
};

const WFCHECK = 'C:/Users/lucia/Documents/GitHub/Worm-Forge-Lua-Editor/compiler-cli/wfcheck.exe';
const MODS = 'D:/Worms Armageddon/WormBench/Mods';
const TEST_PACK = 'test_pack/wftest_pack';
/** Real bundles with art on disk, so the fixture reads a foreign pack too. */
const REAL_BUNDLES = [
  'wf-lib/utilities',
  'px_pyroman_grenades',
  'wf-lib/marked_for_death',
  'wf-lib/px_fire_seq',
  'wf-lib/mole_shopper',
];

let failures = 0;
let checks = 0;
function ok(what: string, condition: boolean, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL ${what}${detail ? `: ${detail}` : ''}`);
  }
}

/** Every file under `root`, as the bundle reader takes it. */
function readTree(root: string): ModFile[] {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };
  return walk(root).map((full) => {
    const path = relative(root, full).split('\\').join('/');
    if (/\.(lua|toml)$/i.test(path)) return { path, text: readFileSync(full, 'utf8') };
    return { path, text: '', bytes: new Uint8Array(readFileSync(full)) };
  });
}

const toFiles = (map: Map<string, string | Uint8Array>): ModFile[] =>
  [...map.entries()].map(([path, content]) =>
    typeof content === 'string'
      ? { path, text: content }
      : { path, text: '', bytes: content },
  );

const digests = (map: Map<string, string | Uint8Array>): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [path, content] of map) {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    out.set(path, createHash('sha256').update(bytes).digest('hex'));
  }
  return out;
};

const blockCount = (project: {
  carriedLua?: { preamble: unknown[]; prologue: unknown[]; hooks?: unknown[]; registrations?: unknown[] };
}): number =>
  (project.carriedLua?.preamble.length ?? 0) +
  (project.carriedLua?.prologue.length ?? 0) +
  (project.carriedLua?.hooks?.length ?? 0) +
  (project.carriedLua?.registrations?.length ?? 0);

/** Import, export, re-import, export again, and compare the two file maps. */
async function roundTrip(label: string, files: ModFile[], ownOutput: boolean): Promise<void> {
  const bundles = readBundles(files);
  const weapons = readWeapons(bundles, files).filter((weapon) => weapon.record);
  ok(`${label}: the bundle has weapons with records`, weapons.length > 0, `${weapons.length}`);
  const first = await importBundlePack(bundles[0], weapons, files);
  ok(
    `${label}: every component with a record became a weapon`,
    first.pack.weapons.length === weapons.length,
    `${first.pack.weapons.length} of ${weapons.length}`,
  );

  let before: Map<string, string | Uint8Array>;
  try {
    before = await emitPackFiles(first.pack, LIBRARIES);
  } catch (error) {
    const message = (error as Error).message;
    if (/document is not defined/.test(message)) {
      // The fallback art is painted with a canvas, which Bun does not have.
      ok(`${label}: needs the browser canvas for fallback art, skipped`, true);
      console.log(`  note ${label}: skipped, its fallback art has to be painted (canvas)`);
      return;
    }
    // A bundle whose carried code requires a module only the source bundle ships
    // (`require("lib/pyro")`) cannot be exported standalone: the emitted file
    // would raise at load, so refusing is the correct answer, not a regression.
    // The import already said which module; a fixture that cannot add that
    // bundle to Dependencies skips it and says so.
    const unshipped = first.warnings.filter((warning) => /not shipped by the export/.test(warning));
    if (unshipped.length > 0) {
      ok(`${label}: exports only with the library its code requires, skipped`, true);
      for (const warning of unshipped) console.log(`  note ${label}: ${warning}`);
      return;
    }
    ok(`${label}: exports`, false, message);
    return;
  }
  ok(`${label}: exports`, before.size > 0, `${before.size} files`);

  // What the engine would refuse, refused here instead.
  if (existsSync(WFCHECK)) {
    const dir = mkdtempSync(join(tmpdir(), 'wfpack-'));
    const folder = `${dirname([...before.keys()][0])}`;
    const root = join(dir, folder.split('/')[0]);
    for (const [path, content] of before) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof content === 'string' ? content : Buffer.from(content));
    }
    const run = spawnSync(WFCHECK, ['--format', 'pretty', root], { encoding: 'utf8' });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    // A foreign bundle may carry warnings and advisories of its own; what must
    // never happen is an error, because an error is a file that raises at load
    // and takes the whole bundle with it. The test pack is the editor's own
    // output, so there the bar is nothing at all.
    const errors = (output.match(/error\[/g) ?? []).length;
    ok(
      ownOutput ? `${label}: wfcheck finds nothing` : `${label}: wfcheck finds no errors`,
      ownOutput ? /no findings/.test(output) : errors === 0,
      output.split(String.fromCharCode(10)).slice(0, 3).join(' | ') || 'no output',
    );
    rmSync(dir, { recursive: true, force: true });
  }

  const againFiles = toFiles(before);
  const againBundles = readBundles(againFiles);
  const again = await importBundlePack(
    againBundles.find((bundle) => bundle.id === first.pack.id) ?? againBundles[0],
    readWeapons(againBundles, againFiles).filter((weapon) => weapon.record),
    againFiles,
  );
  ok(
    `${label}: the exported pack reads back with the same weapons`,
    JSON.stringify(first.pack.weapons.map((weapon) => weapon.id)) ===
      JSON.stringify(again.pack.weapons.map((weapon) => weapon.id)),
    `${first.pack.weapons.length} vs ${again.pack.weapons.length}`,
  );
  const carriedBefore = first.pack.weapons.map(blockCount).reduce((a, b) => a + b, 0);
  const carriedAfter = again.pack.weapons.map(blockCount).reduce((a, b) => a + b, 0);
  ok(
    `${label}: carried code arrives once, not twice`,
    carriedAfter === carriedBefore,
    `${carriedBefore} before, ${carriedAfter} after`,
  );

  const after = await emitPackFiles(again.pack, LIBRARIES);
  const firstDigests = digests(before);
  const secondDigests = digests(after);
  const paths = [...new Set([...firstDigests.keys(), ...secondDigests.keys()])].sort();
  const changed = paths.filter((path) => firstDigests.get(path) !== secondDigests.get(path));
  ok(
    `${label}: export, re-import, export writes the same bytes`,
    changed.length === 0,
    `${paths.length - changed.length} of ${paths.length} identical, changed: ${changed
      .slice(0, 4)
      .join(', ')}`,
  );
  console.log(
    `  ${label}: ${first.pack.weapons.length} weapons, ${paths.length} files, ` +
      `${carriedBefore} carried block(s), ${changed.length === 0 ? 'byte identical' : `${changed.length} changed`}`,
  );
}

async function main(): Promise<void> {
  if (existsSync(TEST_PACK)) {
    await roundTrip('test pack', readTree(TEST_PACK), true);
  } else {
    console.log('  note test pack: skipped, run `bun run tools/gen_test_pack.ts` first');
  }

  let real = 0;
  for (const bundle of REAL_BUNDLES) {
    const root = `${MODS}/${bundle}`;
    if (!existsSync(`${root}/mod.toml`)) continue;
    real += 1;
    await roundTrip(bundle, readTree(root), false);
  }
  if (real === 0) {
    console.log(`  note installed bundles: none of ${REAL_BUNDLES.length} found under ${MODS}`);
  }

  if (failures > 0) {
    console.error(`\npack fixture: ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log(`\npack fixture: all checks passed (${checks} cases)`);
}

await main();
