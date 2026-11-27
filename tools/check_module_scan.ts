/**
 * Dev-only: the bundle reader's module discovery, in the engine's own terms
 * (L1 of `reqs/wflib_weapon_import_plan.md`) and the manifest's component
 * options (the `ctx` configuration L4 will model).
 *
 *   bun run tools/check_module_scan.ts
 *
 * Exits 1 on a failure. The shapes are built inline: a shared loader entry with
 * an index (`px.ports`), two components over one real module
 * (`px.bunker_buster`), a record handed to a library (`lib/px_bunker.lua`), a
 * module under `lib/`, a `wf-lib/` name resolved through a dependency's
 * `[exports]`, the legacy `wf-lib/` name satisfied by the bundle's own `lib/`,
 * and a module in another bundle requiring a plain name in *its* bundle.
 * Then the real `Mods/` folder, when it is mounted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import JSZip from 'jszip';
import { readBundles, readWeapons, type ModFile } from '../src/utils/modLib/scan';
import { importBundleWeapon } from '../src/utils/modLib/importWeapon';
import { parseToml } from '../src/utils/modLib/modToml';
import { resolveTableStrings, stringConstants } from '../src/utils/modLib/luaStrings';
import { readCallTable, scanLua } from '../src/utils/modLib/luaTable';
import { generateModToml } from '../src/utils/luaGenerator';
import { stockDonor } from '../src/data/stockDonors';
import type { WeaponProject } from '../src/types/weapon';

let failures = 0;
let checks = 0;
function ok(condition: boolean, what: string, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL ${what}${detail ? `: ${detail}` : ''}`);
  }
}

const files = (entries: Record<string, string>): ModFile[] =>
  Object.entries(entries).map(([path, text]) => ({ path, text }));

const query = (entries: Record<string, string>, componentId: string) => {
  const all = files(entries);
  const weapons = readWeapons(readBundles(all), all);
  const weapon = weapons.find((entry) => entry.componentId === componentId);
  return { weapons, weapon, all };
};

// ---------------------------------------------------------------------------
// 0. The manifest this editor writes reads back as the options it was given.
{
  // `ctx.option` is a load contract, so the two halves have to agree: the writer
  // emits `[[components.options]]` after the component and the reader must see
  // the same keys, kinds and defaults. A round trip is the cheap proof.
  const project = {
    ...(stockDonor('grenade') as any),
    id: 'wfws.roundtrip.options',
    name: 'Round Trip',
    slot: 'grenade',
    customSprites: {},
    options: [
      {
        key: 'direction',
        kind: 'choice',
        label: 'After a collision',
        choices: ['straight', 'opposite', 'random'],
        default: 'straight',
      },
      { key: 'charges', kind: 'int', min: 1, max: 5, default: 3, data: true },
      { key: 'trail', kind: 'bool', default: true },
    ],
  };
  const manifest = generateModToml(project as any);
  const parsed = readBundles(files({ 'mod.toml': manifest, 'weapons/roundtrip_options.lua': 'return {}' }));
  const component = parsed[0]?.components?.[0];
  ok(!!component, 'the written manifest declares a component');
  const options = component?.options ?? [];
  ok(options.length === 3, 'and its three options come back', String(options.length));
  ok(options[0]?.key === 'direction' && options[0]?.kind === 'choice', 'a choice keeps its key and type');
  ok(
    JSON.stringify(options[0]?.choices) === JSON.stringify(['straight', 'opposite', 'random']) &&
      options[0]?.default === 'straight',
    'and its list and default',
  );
  ok(options[1]?.kind === 'int' && options[1]?.min === 1 && options[1]?.max === 5, 'an int keeps its range');
  ok(options[1]?.data === true, 'and `data = true` survives');
  ok(options[2]?.kind === 'bool' && options[2]?.default === true, 'a bool keeps its default');
  ok(
    parsed[0]?.components?.length === 1,
    'and no option block became a phantom component',
    String(parsed[0]?.components?.length),
  );
  // `default_position = { row = "F2", column = 1 }` is an inline table, and the
  // panel slot it names is how a pack keeps its weapons where the author put
  // them: read as one string, every imported weapon landed on its donor's slot.
  ok(
    component?.row === 'F2' && component?.column === 1,
    'and the component keeps its panel position',
    `${component?.row}/${component?.column}`,
  );
  const weaponEntry = readWeapons(parsed, files({ 'mod.toml': manifest, 'weapons/roundtrip_options.lua': 'return {}' }))[0];
  ok(
    weaponEntry?.row === 'F2' && weaponEntry?.column === 1,
    'which the weapon carries too',
    `${weaponEntry?.row}/${weaponEntry?.column}`,
  );
}

// ---------------------------------------------------------------------------
// 0b. Inline tables and nested commas.
{
  const parsed = parseToml(
    [
      'id = "t.inline"',
      'nothing = { }',
      'pair = { a = "x,y", b = 2, nested = { deep = true } }',
      'list = ["a,b", "c"]',
      '',
    ].join(String.fromCharCode(10)),
  );
  const pair = parsed.values.pair as Record<string, unknown>;
  ok(pair?.a === 'x,y' && pair?.b === 2, 'a comma inside a string is not a separator', JSON.stringify(pair));
  ok((pair?.nested as Record<string, unknown>)?.deep === true, 'and a nested table reads');
  ok(
    JSON.stringify(parsed.values.list) === JSON.stringify(['a,b', 'c']),
    'an array keeps a comma inside its items',
    JSON.stringify(parsed.values.list),
  );
}

// ---------------------------------------------------------------------------
// 1. One weapon, its own entry.
{
  const { weapon } = query(
    {
      'mod.toml': `id = "t.one"
[[components]]
id = "t.one.a"
type = "weapon"
entry = "weapons/a.lua"
`,
      'weapons/a.lua': `wa.weapons.replace{ id = "t.one.a", copy_from = "stock.grenade",
  missile = { sprite = 100 } }`,
    },
    't.one.a',
  );
  ok(!!weapon?.record, 'a unique entry is the weapon module');
  ok(weapon?.resolvedVia === 'entry', 'route is entry', weapon?.resolvedVia);
  ok(!!weapon?.record?.missile, 'the record groups are kept');
  ok(weapon?.modulePath === 'weapons/a.lua', 'module path', weapon?.modulePath);
}

// ---------------------------------------------------------------------------
// 2. A shared loader entry, with the index naming the real module.
{
  const { weapons } = query(
    {
      'mod.toml': `id = "t.shared"
[[components]]
id = "t.shared.a"
type = "weapon"
entry = "components/weapon.lua"
[[components]]
id = "t.shared.b"
type = "weapon"
entry = "components/weapon.lua"
`,
      'components/weapon.lua': `return { install = function(ctx) require("components/loader").install(ctx) end }`,
      'weapons/index.lua': `return {
  ["t.shared.a"] = "weapons/a",
  ["t.shared.b"] = "weapons/b",
}`,
      'weapons/a.lua': `local M = {}
M.definition = { missile = { sprite = 11 } }
return M`,
      'weapons/b.lua': `local M = {}
M.definition = { missile = { sprite = 12 } }
return M`,
    },
    't.shared.a',
  );
  ok(weapons.length === 2, 'both components read');
  ok(
    weapons.every((weapon) => weapon.resolvedVia === 'index'),
    'both resolve through the index',
    weapons.map((weapon) => weapon.resolvedVia).join(','),
  );
  ok(
    weapons.every((weapon) => weapon.record !== undefined),
    'the index module is where the record is',
  );
}

// ---------------------------------------------------------------------------
// 3. Two components over one real module (`px.bunker_buster`). The shared entry
//    is still the module the engine runs, and it is read for both.
{
  const { weapons } = query(
    {
      'mod.toml': `id = "t.two"
[[components]]
id = "t.two.plain"
type = "weapon"
entry = "weapons/bonk.lua"
[[components]]
id = "t.two.super"
type = "weapon"
entry = "weapons/bonk.lua"
`,
      'weapons/bonk.lua': `wa.weapons.replace{ id = "t.two.plain", missile = { sprite = 7 } }`,
    },
    't.two.plain',
  );
  ok(weapons.length === 2, 'both components read');
  ok(
    weapons.every((weapon) => weapon.resolvedVia === 'entry'),
    'a shared real module is still found by its entry',
    weapons.map((weapon) => weapon.resolvedVia).join(','),
  );
}

// ---------------------------------------------------------------------------
// 3b. The record is data (`local weapon = { definition = { … } }`), which is what
//     L3 is: the claim is one field of a table literal, so there is no path to
//     read and the table has to be found by hand. A `definition = function()`
//     stays code and is not read as data.
{
  const { weapon } = query(
    {
      'demo/mod.toml': `id = "t.def"
[[components]]
id = "t.def.uzi"
type = "weapon"
entry = "weapons/uzi.lua"
`,
      'demo/weapons/uzi.lua': `local SHEET = "sprites/uzi/hold.png"

local weapon = {
  defaults = { ammo = { round_start = -1 } },
  definition = {
    copy_from = "stock.grenade",
    hold = { sheet = SHEET, frames = 1 },
    missile = { explosion = { power = 60 } },
  },
}

return {
  defaults = weapon.defaults,
  install = function(ctx) wa.weapons.replace(weapon.definition) end,
}
`,
    },
    't.def.uzi',
  );
  ok(
    ((weapon?.record as Record<string, any> | undefined)?.missile as any)?.explosion?.power === 60,
    'a definition table is read as the record',
    JSON.stringify(weapon?.record),
  );
  ok(
    (weapon as unknown as { copyFrom?: string } | undefined)?.copyFrom === 'stock.grenade',
    'and its copy_from with it',
    String((weapon as unknown as { copyFrom?: string } | undefined)?.copyFrom),
  );
  ok(
    (weapon as unknown as { source?: { hold?: { sheet?: string } } } | undefined)?.source?.hold?.sheet ===
      'sprites/uzi/hold.png',
    'and a name in it resolves to the sheet',
    JSON.stringify((weapon as unknown as { source?: unknown } | undefined)?.source),
  );
}

// ---------------------------------------------------------------------------
// 4. The record is handed to a library (`lib/px_bunker.lua`).
{
  const { weapon } = query(
    {
      'mod.toml': `id = "t.lib"
[[components]]
id = "t.lib.a"
type = "weapon"
entry = "weapons/a.lua"
`,
      'weapons/a.lua': `local bunker = require("lib/px_bunker")
return function(ctx) bunker.install(ctx) end`,
      'lib/px_bunker.lua': `wa.weapons.replace{ missile = { sprite = 44 } }`,
    },
    't.lib.a',
  );
  ok(weapon?.resolvedVia === 'require', 'route is require', weapon?.resolvedVia);
  ok(weapon?.modulePath === 'lib/px_bunker.lua', 'module path is the library', weapon?.modulePath);
  ok((weapon?.requires ?? []).includes('lib/px_bunker.lua'), 'the library is in requires');
  ok((weapon?.unresolvedRequires ?? []).length === 0, 'nothing unresolved');
}

// ---------------------------------------------------------------------------
// 5. A weapon module under `lib/`, with no entry and no index to name it.
{
  const { weapon } = query(
    {
      'mod.toml': `id = "t.libloc"
[[components]]
id = "t.libloc.worm"
type = "weapon"
entry = "components/weapon.lua"
`,
      'components/weapon.lua': `return { install = function() end }`,
      'lib/worm.lua': `wa.weapons.replace{ missile = { sprite = 9 } }`,
    },
    't.libloc.worm',
  );
  ok(weapon?.resolvedVia === 'lib', 'route is lib', weapon?.resolvedVia);
}

// ---------------------------------------------------------------------------
// 6. `wf-lib/<name>` resolves through a declared dependency's `[exports]`, in
//    the exporting bundle's folder.
{
  const { weapon } = query(
    {
      'lib_sdk/mod.toml': `id = "wf.sdk"
api_version = 4
format_version = 2
[exports]
"wf-lib/px_sprite_builder" = "px_sprite_builder.lua"
`,
      'lib_sdk/px_sprite_builder.lua': `return { flight = function() end }`,
      'bundle/mod.toml': `id = "t.user"
dependencies = ["wf.sdk"]
[[components]]
id = "t.user.a"
type = "weapon"
entry = "weapons/a.lua"
`,
      'bundle/weapons/a.lua': `local sb = require("wf-lib/px_sprite_builder")
wa.weapons.replace{ missile = { sprite = 3 } }`,
    },
    't.user.a',
  );
  ok(weapon?.resolvedVia === 'entry', 'the weapon module is its entry');
  ok(
    (weapon?.requires ?? []).includes('lib_sdk/px_sprite_builder.lua'),
    'wf-lib resolves into the exporting bundle',
    (weapon?.requires ?? []).join(','),
  );
  ok((weapon?.unresolvedRequires ?? []).length === 0, 'nothing unresolved');
  ok((weapon?.localLibraryRequires ?? []).length === 0, 'not reported as a legacy local');
}

// ---------------------------------------------------------------------------
// 7. The legacy shape: a `wf-lib/` name the bundle satisfies from its own
//    `lib/`. Followed so the code can be read, and reported (`px_buffalo`).
{
  const { weapon } = query(
    {
      'mod.toml': `id = "t.legacy"
dependencies = ["wf.sdk"]
[[components]]
id = "t.legacy.a"
type = "weapon"
entry = "weapons/a.lua"
`,
      'weapons/a.lua': `local sb = require("wf-lib/px_sprite_builder")
wa.weapons.replace{ missile = { sprite = 3 } }`,
      'lib/px_sprite_builder.lua': `return {}`,
    },
    't.legacy.a',
  );
  ok(
    (weapon?.localLibraryRequires ?? []).includes('wf-lib/px_sprite_builder'),
    'the legacy local is reported',
    JSON.stringify(weapon?.localLibraryRequires),
  );
  ok((weapon?.requires ?? []).includes('lib/px_sprite_builder.lua'), 'and it is followed');
  ok((weapon?.unresolvedRequires ?? []).length === 0, 'so it is not counted as missing');
}

// ---------------------------------------------------------------------------
// 8. A module in another bundle resolves its plain requires in *its* bundle
//    (`wf-lib/sdk/parkour.lua` requiring `own_time`, reached from `px.parkour`).
{
  const { weapon } = query(
    {
      'sdk/mod.toml': `id = "wf.sdk"
api_version = 4
format_version = 2
[exports]
"wf-lib/px_sprite_builder" = "px_sprite_builder.lua"
"wf-lib/parkour" = "parkour.lua"
`,
      'sdk/parkour.lua': `local own_time = require("own_time")
return { frames = own_time.frames }`,
      'sdk/own_time.lua': `return { frames = function() return 1 end }`,
      'bundle/mod.toml': `id = "t.cross"
dependencies = ["wf.sdk"]
[[components]]
id = "t.cross.parkour"
type = "weapon"
entry = "weapons/parkour.lua"
`,
      'bundle/weapons/parkour.lua': `local parkour = require("wf-lib/parkour")
wa.weapons.replace{ missile = { sprite = 3 } }`,
    },
    't.cross.parkour',
  );
  ok((weapon?.unresolvedRequires ?? []).length === 0, '`own_time` resolves in the sdk bundle');
  ok(
    (weapon?.requires ?? []).includes('sdk/own_time.lua'),
    'and comes from the sdk folder',
    (weapon?.requires ?? []).join(','),
  );
}

// ---------------------------------------------------------------------------
// 9. `[[components.options]]` belongs to the component above it.
{
  const doc = parseToml(`id = "t.opts"
[[components]]
id = "t.opts.a"
type = "weapon"
entry = "a.lua"
[[components.options]]
key = "placement_range"
type = "int"
default = 0
min = 0
max = 65535
label = "Placement range (px)"
data = true
[[components.options]]
key = "direction"
type = "choice"
choices = ["straight", "opposite", "random"]
default = "straight"
label = "Direction"
[components.suggests."hl.rules"]
pool = "movement"
[[components]]
id = "t.opts.b"
type = "weapon"
entry = "b.lua"
`);
  ok(doc.components.length === 2, 'no phantom component', String(doc.components.length));
  const options = doc.components[0].options as unknown as Record<string, unknown>[];
  ok(Array.isArray(options) && options.length === 2, 'both options attached', String(options?.length));
  ok(options?.[0]?.key === 'placement_range', 'first option key');
  ok(options?.[0]?.data === true, 'data = true is kept');
  ok(options?.[1]?.choices instanceof Array, 'choices are kept', JSON.stringify(options?.[1]?.choices));
  const suggests = doc.components[0].suggests as Record<string, Record<string, unknown>> | undefined;
  ok(suggests?.['hl.rules']?.pool === 'movement', 'suggests attaches to the component');
  ok(doc.components[1].options === undefined, 'the second component has no options');
}

// ---------------------------------------------------------------------------
// 10. `[exports]` is read, and stays out of the scalars.
{
  const doc = parseToml(`id = "t.exp"
[exports]
"wf-lib/a" = "a.lua"
'wf-lib/b' = "b.lua"
`);
  ok(doc.exports['wf-lib/a'] === 'a.lua', 'quoted export name', JSON.stringify(doc.exports));
  ok(doc.exports['wf-lib/b'] === 'b.lua', 'single quoted export name');
  ok(doc.values.id === 't.exp', 'the manifest id is still a scalar');
}

// ---------------------------------------------------------------------------
// 11. Option reads, and the shape of a miss.
{
  const { weapon } = query(
    {
      'mod.toml': `id = "t.read"
[[components]]
id = "t.read.a"
type = "weapon"
entry = "weapons/a.lua"
`,
      'weapons/a.lua': `local mode = ctx.option("direction") or "straight"
local bullets = ctx.option('bullets')
wa.weapons.replace{ missile = { sprite = 3 } }`,
    },
    't.read.a',
  );
  ok(
    JSON.stringify(weapon?.optionReads) === JSON.stringify(['direction', 'bullets']),
    'option reads are collected',
    JSON.stringify(weapon?.optionReads),
  );

  const miss = query(
    {
      'mod.toml': `id = "t.miss"
[[components]]
id = "t.miss.a"
type = "weapon"
name = "A Weapon"
entry = "components/weapon.lua"
`,
      'components/weapon.lua': `return { install = function() end }`,
    },
    't.miss.a',
  );
  ok(!!miss.weapon?.error, 'a miss is an error');
  ok(
    (miss.weapon?.error ?? '').includes('looked in'),
    'the error names what was looked in',
    miss.weapon?.error,
  );
}

// ---------------------------------------------------------------------------
// 12. An index key has to be dotted, so an ordinary `["name"] = "value"` table
//     is not mistaken for one.
{
  const { weapon } = query(
    {
      'mod.toml': `id = "t.sound"
[[components]]
id = "t.sound.a"
type = "weapon"
entry = "weapons/a.lua"
`,
      'weapons/a.lua': `local SOUNDS = { ["hit"] = "sounds/hit.wav" }
wa.weapons.replace{ missile = { sprite = 3 } }`,
    },
    't.sound.a',
  );
  ok(weapon?.resolvedVia === 'entry', 'a plain map is not an index', weapon?.resolvedVia);
}

// ---------------------------------------------------------------------------
// F13: the string resolver and the table reader on the text a hand-written port
// actually has (comments, `;` separators, a literal that starts an expression).
{
  // A commented-out declaration above the real one used to win, because the
  // scan read the raw text and kept the first `local DIR` it saw.
  const shadowed = stringConstants('-- local DIR = "sprites/fake/"\nlocal DIR = "sprites/real/"');
  ok(shadowed.get('DIR') === 'sprites/real/', 'a commented-out local does not shadow the real one', shadowed.get('DIR'));

  // `--` inside a string is not a comment, and a trailing comment is.
  const dashed = stringConstants('local S = "a--b" -- trailing\nlocal T = S .. "c"');
  ok(dashed.get('S') === 'a--b' && dashed.get('T') === 'a--bc', '"a--b" keeps its dashes', JSON.stringify([...dashed]));

  // `;` separates table fields as well as `,`.
  const semi = [
    'local SHEET = "sprites/w/h.png"',
    'local SND = "sounds/w/"',
    'wa.weapons.replace{ hold = { sheet = SHEET; frames = 2 }; sounds = { SND .. "a.wav"; SND .. "b.wav" } }',
  ].join('\n');
  const call = readCallTable(semi, 'wa.weapons.replace');
  const resolved = call ? resolveTableStrings(call.table, call.text, stringConstants(semi)) : undefined;
  const hold = resolved?.hold as Record<string, unknown> | undefined;
  const sounds = resolved?.sounds as Record<string, unknown> | undefined;
  ok(
    hold?.sheet === 'sprites/w/h.png' && sounds?.['1'] === 'sounds/w/a.wav' && sounds?.['2'] === 'sounds/w/b.wav',
    ';-separated fields resolve their strings',
    JSON.stringify(resolved),
  );

  // A literal that starts an expression is not the whole value: keeping the
  // prefix also stopped the resolver from filling the real path in.
  const infix = scanLua('local NAME = "bar.png"\nwa.weapons.replace{ hold = { sheet = "sprites/a/" .. NAME, frames = 2 * 4 } }');
  const infixHold = (infix.calls['wa.weapons.replace'] as any)?.hold;
  ok(
    infixHold !== undefined && infixHold.sheet === null && infixHold.frames === null,
    '"sprites/a/" .. NAME is not read as "sprites/a/"',
    JSON.stringify(infixHold),
  );

  // `repeat ... until` inside a skipped function opens a block like `do` does,
  // or `until` closes the function early and its locals leak into the claim.
  const repeated = scanLua(
    'wa.weapons.replace{\n  on_fire = function(ev)\n    repeat step() until done()\n    local a, b = 1, 2\n  end,\n  missile = { damage = 50 },\n}',
  );
  const claim = repeated.calls['wa.weapons.replace'] as Record<string, unknown> | undefined;
  ok(
    claim !== undefined &&
      Object.keys(claim).sort().join(',') === 'missile,on_fire' &&
      (claim.missile as any)?.damage === 50,
    'repeat ... until inside a hook stays inside the hook',
    JSON.stringify(claim),
  );

  // A bare reference is not a call with a table argument: the reader must stop
  // at the statement, not steal the next `{ ... }` in the file.
  ok(
    readCallTable('if sb.hold then wa.log("ok") end\nsb.flight(ctx, { sheet = "sprites/w/missile.png" })', 'sb.hold') === undefined,
    'readCallTable stops at `then` instead of reading a later table',
  );
  ok(
    readCallTable('wa.weapons.replace(rec); local other = { hold = { sheet = "x" } }', 'wa.weapons.replace') === undefined,
    'readCallTable stops at `)` instead of reading a later table',
  );
  // The same two stops with nothing else to catch them: no `;`/`local` after the
  // `)`, and no call between `then` and the table.
  ok(
    readCallTable('wa.weapons.replace(rec)\nsetup{ hold = { sheet = "x" } }', 'wa.weapons.replace') === undefined,
    'readCallTable stops at `)` with a call table after it',
  );
  ok(
    readCallTable('if sb.hold then cfg = { hold = 1 } end', 'sb.hold') === undefined,
    'readCallTable stops at `then` with a table after it',
  );
}

// ---------------------------------------------------------------------------
// The real corpus, when it is mounted.
const MODS = 'D:/Worms Armageddon/WormBench/Mods';
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(lua|toml)$/i.test(entry.name)) out.push(full);
  }
  return out;
}
async function corpus(): Promise<ModFile[] | null> {
  try {
    statSync(MODS);
  } catch {
    return null;
  }
  const all: ModFile[] = [];
  for (const full of walk(MODS)) {
    const path = relative(MODS, full).split(sep).join('/');
    all.push({ path, text: readFileSync(full, 'utf8') });
  }
  for (const entry of readdirSync(MODS, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.zip$/i.test(entry.name)) continue;
    const zip = await JSZip.loadAsync(readFileSync(join(MODS, entry.name)));
    for (const [name, file] of Object.entries(zip.files)) {
      if (file.dir || !/\.(lua|toml)$/i.test(name)) continue;
      all.push({ path: `${entry.name}/${name}`, text: await file.async('string') });
    }
  }
  return all;
}

const all = await corpus();
if (!all) {
  console.log('  (Mods folder not mounted, corpus checks skipped)');
} else {
  const bundles = readBundles(all);
  const weapons = readWeapons(bundles, all);
  // The same bundle can be installed twice (a development copy and the
  // catalogue's), and the engine refuses that; the reader reports both roots, so
  // these counts are per folder.
  const pxAll = weapons.filter((weapon) => weapon.bundleId === 'px.ports');
  const pxDir = pxAll[0]?.bundleDir ?? '';
  const px = pxAll.filter((weapon) => weapon.bundleDir === pxDir);
  // The installed copy and the dev tree do not hold the same number of weapon
  // components (101 components, 97 weapons here), so the corpus check pins the
  // shape rather than an exact count.
  ok(px.length >= 90, 'px.ports holds its weapon components', `${px.length} in ${pxDir}`);
  ok(
    px.filter((weapon) => weapon.record).length >= 85,
    'most of px.ports resolves a record',
    String(px.filter((weapon) => weapon.record).length),
  );
  ok(
    px.some((weapon) => weapon.resolvedVia === 'index'),
    'px.ports uses its index',
  );
  ok(
    px.some((weapon) => weapon.resolvedVia === 'require'),
    'px.ports hands some records to a library',
  );
  ok(
    weapons.every((weapon) => (weapon.unresolvedRequires ?? []).length === 0),
    'no require in the whole corpus is unresolved',
    weapons
      .flatMap((weapon) => weapon.unresolvedRequires ?? [])
      .slice(0, 5)
      .join(','),
  );
  ok(
    weapons.every((weapon) => (weapon.localLibraryRequires ?? []).length === 0),
    'and none relies on the legacy `wf-lib/` local',
    weapons
      .flatMap((weapon) => weapon.localLibraryRequires ?? [])
      .slice(0, 5)
      .join(','),
  );
  // `px.bunker_buster` and `px.super_bunker_buster` are two components over one
  // module: both must be read.
  ok(
    ['px.bunker_buster', 'px.super_bunker_buster'].every(
      (id) => weapons.find((weapon) => weapon.componentId === id)?.record,
    ),
    'two components over one module are both read',
  );
  const buffalo = weapons.find((weapon) => weapon.componentId === 'px.buffalo_of_lies');
  ok(!!buffalo?.record, 'the buffalo benchmark reads its record');
  ok(
    (buffalo?.optionReads ?? []).includes('direction'),
    'and its `ctx.option("direction")` is seen',
    JSON.stringify(buffalo?.optionReads),
  );
  const misses = weapons.filter((weapon) => !weapon.record && !weapon.wepPath);
  ok(
    misses.every((weapon) => !!weapon.error),
    'every miss says why',
    misses.filter((weapon) => !weapon.error).map((weapon) => weapon.componentId).join(','),
  );
}

// ---------------------------------------------------------------------------
// 14. suggests pass-through and non-missile donor fireType fallback.
{
  const modFiles: ModFile[] = [
    {
      path: 'spray/mod.toml',
      text: `id = "t.spray"
name = "Spray Test"
version = "1.0.0"
[[components]]
id = "t.spray.torch"
type = "weapon"
name = "Torch"
entry = "weapons/torch.lua"
[components.suggests."hl.rules"]
pool = "movement"
`,
    },
    {
      path: 'spray/weapons/torch.lua',
      text: `wa.weapons.replace{
  copy_from = "stock.flame_thrower",
  handling = { shots = 2 },
}`,
    },
  ];
  const bundles = readBundles(modFiles);
  const weapons = readWeapons(bundles, modFiles);
  const w = weapons[0];
  ok(w?.suggests?.['hl.rules']?.pool === 'movement', 'ModWeapon carries suggests');
  if (w) {
    const imported = await importBundleWeapon(w, modFiles);
    const project = imported.project as WeaponProject;
    ok(
      project.fireType === 'spray',
      'Lua-only weapon without missile table keeps non-missile donor fireType',
      String(project.fireType),
    );
    const toml = generateModToml(project);
    ok(
      toml.includes('[components.suggests."hl.rules"]') && toml.includes('pool = "movement"'),
      'exported mod.toml re-emits suggests table',
    );
  }
}

// ---------------------------------------------------------------------------
// 15. PX .merge(), nested weapon.definition, utility/on_select, requires, missile_sprite.
{
  const pxFiles: ModFile[] = [
    {
      path: 'px/mod.toml',
      text: `id = "px.ports"
name = "Project X"
version = "1.0.0"
[[components]]
id = "px.merge_bomb"
type = "weapon"
name = "Merge Bomb"
entry = "weapons/merge_bomb.lua"
[[components]]
id = "px.nest_util"
type = "weapon"
name = "Nested Utility"
entry = "weapons/nest_util.lua"
`,
    },
    {
      path: 'px/lib/weapon.lua',
      text: `return { merge = function(a, b) return b end }`,
    },
    {
      path: 'px/lib/shared.lua',
      text: `return {}`,
    },
    {
      path: 'px/weapons/merge_bomb.lua',
      text: `local ART = "sprites/merge_bomb/"
local weapon = {}
weapon.requires = { "lib/shared" }
weapon.record = { missile = { countdown = 4000 } }
weapon.defaults = { auto_use = true, donor_card = true }
weapon.missile_sprite = {
  { sheet = ART .. "bomb.png", frames = 4, spin = true, spin_speed = 0.75, hide = true, first_sprite = 50 },
  { sheet = ART .. "bit.png", frames = 1, upright = true, hide = true, first_sprite = 51 },
}
function weapon.definition()
  return require("lib/weapon").merge(weapon.record, {
    copy_from = "stock.mb_bomb",
    name = "Merge Bomb",
    airborne = true,
  })
end
function weapon.configure(ctx, spec)
  local _ = ctx.placed
  spec.missile.fuse = 1000
end
return weapon`,
    },
    {
      path: 'px/weapons/nest_util.lua',
      text: `local weapon = {
  definition = {
    copy_from = "stock.double_turn_time",
    utility = { effect = "scripted" },
    on_select = { cursor = true },
  },
}
return weapon`,
    },
  ];
  const bundles = readBundles(pxFiles);
  const weapons = readWeapons(bundles, pxFiles);
  const mergeBomb = weapons.find((w) => w.componentId === 'px.merge_bomb');
  const nestUtil = weapons.find((w) => w.componentId === 'px.nest_util');
  ok(!!mergeBomb?.record && mergeBomb.copyFrom === 'stock.mb_bomb', 'merge() resolves record and copy_from');
  ok(
    (mergeBomb?.requires ?? []).includes('px/lib/shared.lua'),
    'weapon.requires array is collected in module requires',
    JSON.stringify(mergeBomb?.requires),
  );
  ok(
    !!nestUtil?.record?.utility && !!nestUtil?.record?.on_select,
    'nested weapon.definition resolves utility group and on_select table',
  );
  if (mergeBomb) {
    const imported = await importBundleWeapon(mergeBomb, pxFiles);
    ok(imported.project.slot === 'mb_bomb', 'mergeBomb keeps mb_bomb donor slot');
    ok(
      imported.project.missileSprite?.enabled === true &&
        imported.project.missileSprite.sheet === 'sprites/merge_bomb/bomb.png' &&
        imported.project.missileSprite.anim === 'rotation' &&
        imported.project.missileSprite.spinRate === 0.75 &&
        imported.project.missileSprite.frames === 4,
      'PX missile_sprite resolves ART concat and spin settings',
      JSON.stringify(imported.project.missileSprite),
    );
    ok(
      imported.project.bitFlight?.mode === 'builder' &&
        imported.project.bitFlight.anim === 'none',
      'PX two-entry missile_sprite populates cluster bitFlight',
    );
    ok(
      imported.notes.some((n) => n.includes('unmodelled defaults:') && n.includes('auto_use')),
      'unmodelled weapon.defaults keys are reported',
    );
    ok(
      imported.notes.some((n) => n.includes('claim flags not re-emitted:') && n.includes('airborne')),
      'unmodelled Claim flags are reported',
    );
    ok(
      imported.notes.some((n) => n.includes('weapon.configure(ctx, spec)')),
      'weapon.configure(ctx, spec) override is reported',
    );
    ok(
      imported.notes.some((n) => n.includes('ctx.placed')),
      'ctx.placed match-state read is reported',
    );
  }
  if (nestUtil) {
    const imported = await importBundleWeapon(nestUtil, pxFiles);
    ok(imported.project.fireType === 'special' && imported.project.teleport === true, 'utility + on_select cursor maps to special + teleport');
  }
}

console.log(
  failures === 0
    ? `module scan: all checks passed (${checks} cases)`
    : `module scan: ${failures} failure(s) of ${checks} cases`,
);
process.exit(failures === 0 ? 0 : 1);
