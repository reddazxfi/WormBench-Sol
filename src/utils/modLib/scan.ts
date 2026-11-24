/**
 * Reads installed bundles: `mod.toml` manifests, their weapon components, and
 * the Lua module each weapon keeps its record in.
 *
 * The input is a flat map of bundle-relative paths to text, so the same code
 * serves a folder the user picked, a ZIP, and the Tauri filesystem walk. PX's
 * ports are the reason this is defensive: one bundle can hold a hundred
 * weapons, every weapon can share one `components/weapon.lua` entry, and the
 * real module is found through `weapons/index.lua` rather than the manifest.
 */

import { maskLuaCode } from '../luaText';
import { parseToml, type TomlDocument } from './modToml';
import { scanLua, firstTable, isTable, type LuaTable } from './luaTable';
import { applyPathAssignments, readAssignmentTable, readCallTable } from './luaTable';
import { matchingBrace, resolveTableStrings, stringConstants } from './luaStrings';

/**
 * The source text of the table `source` was read from, when it can be known:
 * a call's first table argument, an assignment's, or the file's `return` table.
 */
function claimTextOf(
  text: string,
  path: string,
  kind: 'call' | 'assign' | 'return' | 'field',
): string | undefined {
  if (kind === 'call') return readCallTable(text, path)?.text;
  if (kind === 'assign') return readAssignmentTable(text, path)?.text;
  if (kind === 'field') {
    // `local weapon = { definition = { … } }`: the record is one field of a
    // table literal, so there is no path to read and the braces are found by
    // hand. A `definition = function()` is code, not data, and is not claim text.
    const masked = maskLuaCode(text);
    for (const match of masked.matchAll(/(^|[^A-Za-z0-9_.])definition\s*=\s*\{/g)) {
      const open = match.index! + match[0].length - 1;
      const end = matchingBrace(masked, open);
      if (end > open) return text.slice(open, end + 1);
    }
    return undefined;
  }
  // The `return { … }` table of a file that hands back a claim.
  const at = /(^|\n)\s*return\s*\{/.exec(text);
  if (!at) return undefined;
  const open = text.indexOf('{', at.index + at[0].length - 1);
  if (open < 0) return undefined;
  const masked = maskLuaCode(text);
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    else if (masked[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return undefined;
}

export interface ModFile {
  /** Bundle-relative, `/`-separated (`wf-lib/px/weapons/banana_express.lua`). */
  path: string;
  /** Source text for `.lua` / `.toml`; empty for a binary entry. */
  text: string;
  /** Raw bytes, for a bundled `.wep` the module points at. */
  bytes?: Uint8Array;
  /** The picked file, for an asset whose bytes have not been read yet. */
  file?: File;
  /** A ZIP entry's bytes, read on demand (`JSZip` keeps the archive open). */
  readBytes?: () => Promise<Uint8Array>;
}

/**
 * One `[[components.options]]` entry (`components.rs`, `OptionDecl`): the
 * settings `ctx.option(key)` reads, with the value the profile stores under
 * `[options."<component id>"]` overriding `default`.
 */
export interface ModOption {
  key: string;
  /** `bool`, `int` or `choice`; anything else is reported as declared. */
  kind: string;
  label?: string;
  description?: string;
  default?: string | number | boolean;
  choices?: string[];
  min?: number;
  max?: number;
  /** `from_bool`: a choice the profile may also write as `true`/`false`. */
  fromBool?: [string, string];
  /** `data = true`: the option *is* the weapon data field of the same key. */
  data?: boolean;
}

export interface ModComponent {
  id: string;
  name: string;
  type: string;
  entry: string;
  icon?: string;
  description?: string;
  row?: string;
  column?: number;
  /** `[[components.options]]` for this component, in declaration order. */
  options: ModOption[];
  /** `[[components.weapon_options]]`: a feature's per-placed-weapon settings. */
  weaponOptions: ModOption[];
  /** `[components.suggests."<feature id>"]` values, by feature id. */
  suggests: Record<string, Record<string, unknown>>;
}

export interface ModBundle {
  /** Folder the manifest sits in, `''` for the root of what was opened. */
  dir: string;
  manifestPath: string;
  id: string;
  name: string;
  version: string;
  author?: string;
  apiVersion?: number;
  dependencies: string[];
  components: ModComponent[];
  /** `[sprites."…"]` declarations, keyed by the bundle-relative path. */
  spriteDecls: Record<string, Record<string, unknown>>;
  /** `[exports]`: public `wf-lib/<name>` -> bundle-relative `.lua` entry. */
  exports: Record<string, string>;
  /** `asset_namespace`, e.g. `wf-lib/px`: the prefix this bundle's art carries. */
  assetNamespace?: string;
  /** The manifest's `mod_icon`: the one icon the mod loader shows for the bundle. */
  modIcon?: string;
  /**
   * The bundles this one retires (`replaces = ["core.fog", ...]`): installing it
   * switches them off, so a re-export that dropped the list would change what the
   * manifest means.
   */
  replaces?: string[];
  /** Files in this bundle, relative to `dir`. */
  files: string[];
}

export interface ModWeapon {
  bundleId: string;
  bundleName: string;
  /** Folder the bundle's `mod.toml` sits in, `''` at the root of what was opened. */
  bundleDir: string;
  /** Manifest `api_version` of the bundle this weapon came from. */
  bundleApiVersion?: number;
  /** The manifest's dependency list, for carrying a bundle's own libraries. */
  dependencies: string[];
  /** `[sprites."…"]` declarations, keyed by the bundle-relative path. */
  spriteDecls: Record<string, Record<string, unknown>>;
  /** The bundle's `author`, used as the imported project's credit. */
  author?: string;
  /** The bundle's `mod_icon`: one icon for the whole bundle, not per weapon. */
  bundleModIcon?: string;
  componentId: string;
  name: string;
  description?: string;
  icon?: string;
  /** The component's `default_position`: the panel slot it replaces. */
  row?: string;
  column?: number;
  /** Bundle-relative path of the Lua module the record was read from. */
  modulePath: string;
  /** How the module was found, so a miss can be told from a wrong guess. */
  resolvedVia?: ModuleRoute;
  /** The component's declared settings (`ctx.option` reads these). */
  options?: ModOption[];
  /** `[[components.weapon_options]]` entries parsed from the component. */
  weaponOptions?: ModOption[];
  /** `[components.suggests."<feature>"]` tables parsed from the component. */
  suggests?: Record<string, Record<string, unknown>>;
  /** `ctx.option("k")` / `ctx.options.k` keys the module reads, in file order. */
  optionReads?: string[];
  /** Modules the weapon's own module requires, bundle-relative where resolved. */
  requires?: string[];
  /** `require` names nothing in this bundle or its dependencies provides. */
  unresolvedRequires?: string[];
  /**
   * A `require("wf-lib/<name>")` the bundle satisfies from its *own* `lib/`
   * instead of a declared dependency's `[exports]`. The current engine refuses
   * that (`modules.rs`), so it is reported rather than followed silently.
   */
  localLibraryRequires?: string[];
  /** The record tables (`missile`, `clusters`, `handling`, …). */
  record?: LuaTable;
  /**
   * The module's whole spec table, before it was filtered to the record groups:
   * claim-level keys (`sprites`, `hold`, `sounds`, callbacks) included. Used by
   * the audit to see what a bundle declares that the editor does not model.
   */
  source?: LuaTable;
  /** `defaults` (ammo, delay, crate) when the module spells a table. */
  defaults?: LuaTable;
  /** `copy_from = "stock.grenade"`, when the module names a donor. */
  copyFrom?: string;
  /** Claim-level art paths, when the module declares them. */
  sprite?: string;
  clusterSprite?: string;
  /**
   * Bundle-relative `.wep` the module names (`wep = "X.wep"`). Its record is
   * the weapon's base, and the declared Lua tables are edits on top -- the same
   * relationship the editor's own `useWepFile` mode has.
   */
  wepPath?: string;
  /** Every `.wep` filename the module mentions, when none could be matched. */
  wepNames?: string[];
  /** Why the record could not be read, when it could not. */
  error?: string;
}

const dirOf = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
};

const joinPath = (dir: string, rel: string): string =>
  (dir ? `${dir}/` : '') + rel.replace(/^\.?\//, '');

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const MODULE_NAME = /^[A-Za-z0-9_./-]+$/;

/**
 * Every `["<component id>"] = "<module>"` pair in a module, whatever file it
 * sits in: `weapons/index.lua` is the common one (`["px.banana_express"] =
 * "weapons/banana_express"`), but a bundle is free to keep its index anywhere,
 * and a `wf-lib/`-hosted one names paths outside `weapons/`.
 *
 * The dotted key is the filter: component ids are namespaced (`px.buffalo`), so
 * an ordinary `["name"] = "value"` table (a sound map, a cast list) cannot be
 * mistaken for one. The target must look like a module path, with no other
 * file extension.
 */
function readIndexMap(text: string, into: Record<string, string>): void {
  const pattern = /\[\s*["']([A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+)["']\s*\]\s*=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const id = match[1];
    const target = match[2].replace(/^\.\//, '');
    if (!MODULE_NAME.test(target)) continue;
    if (/\.\w+$/.test(target) && !/\.lua$/.test(target)) continue;
    if (into[id] === undefined) into[id] = target;
  }
}

/** One `[[components.options]]` entry, decoded defensively. */
function optionsFrom(value: unknown): ModOption[] {
  if (!Array.isArray(value)) return [];
  const out: ModOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const key = typeof raw.key === 'string' ? raw.key : '';
    if (!key) continue;
    const fallback = raw.default;
    out.push({
      key,
      kind: typeof raw.type === 'string' ? raw.type : '',
      label: typeof raw.label === 'string' ? raw.label : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      default:
        typeof fallback === 'string' ||
        typeof fallback === 'number' ||
        typeof fallback === 'boolean'
          ? fallback
          : undefined,
      choices: Array.isArray(raw.choices)
        ? raw.choices.filter((choice): choice is string => typeof choice === 'string')
        : undefined,
      min: typeof raw.min === 'number' ? raw.min : undefined,
      max: typeof raw.max === 'number' ? raw.max : undefined,
      fromBool:
        Array.isArray(raw.from_bool) &&
        raw.from_bool.length === 2 &&
        raw.from_bool.every((choice) => typeof choice === 'string')
          ? ([raw.from_bool[0], raw.from_bool[1]] as [string, string])
          : undefined,
      data: raw.data === true ? true : undefined,
    });
  }
  return out;
}

function componentFrom(table: Record<string, unknown>): ModComponent | null {
  const id = typeof table.id === 'string' ? table.id : '';
  if (!id) return null;
  const position = table.default_position as Record<string, unknown> | undefined;
  const suggests = table.suggests;
  return {
    id,
    name: typeof table.name === 'string' ? table.name : id,
    type: typeof table.type === 'string' ? table.type : 'weapon',
    entry: typeof table.entry === 'string' ? table.entry : '',
    icon: typeof table.icon === 'string' ? table.icon : undefined,
    description: typeof table.description === 'string' ? table.description : undefined,
    row: typeof position?.row === 'string' ? position.row : undefined,
    column: typeof position?.column === 'number' ? position.column : undefined,
    options: optionsFrom(table.options),
    weaponOptions: optionsFrom(table.weapon_options),
    suggests:
      suggests && typeof suggests === 'object'
        ? (suggests as Record<string, Record<string, unknown>>)
        : {},
  };
}

/** Every `mod.toml` in the file map, as bundles. */
export function readBundles(files: ModFile[]): ModBundle[] {
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const bundles: ModBundle[] = [];

  for (const file of files) {
    if (!/(^|\/)mod\.toml$/.test(file.path)) continue;
    const doc: TomlDocument = parseToml(file.text);
    const id = typeof doc.values.id === 'string' ? doc.values.id : '';
    if (!id) continue;

    const dir = dirOf(file.path);
    const prefix = dir ? `${dir}/` : '';
    const components = doc.components
      .map(componentFrom)
      .filter((component): component is ModComponent => component !== null);

    bundles.push({
      dir,
      manifestPath: file.path,
      id,
      name: typeof doc.values.name === 'string' ? doc.values.name : id,
      version: typeof doc.values.version === 'string' ? doc.values.version : '',
      author: typeof doc.values.author === 'string' ? doc.values.author : undefined,
      apiVersion: typeof doc.values.api_version === 'number' ? doc.values.api_version : undefined,
      dependencies: Array.isArray(doc.values.dependencies)
        ? (doc.values.dependencies as string[])
        : [],
      components,
      spriteDecls: doc.spriteDecls,
      exports: doc.exports,
      assetNamespace:
        typeof doc.values.asset_namespace === 'string' ? doc.values.asset_namespace : undefined,
      modIcon: typeof doc.values.mod_icon === 'string' ? doc.values.mod_icon : undefined,
      replaces: Array.isArray(doc.values.replaces) ? (doc.values.replaces as string[]) : [],
      files: files
        .filter((entry) => entry.path.startsWith(prefix))
        .map((entry) => entry.path.slice(prefix.length)),
    });
    void byPath;
  }

  return bundles.sort((a, b) => a.id.localeCompare(b.id));
}

const RECORD_KEYS = ['missile', 'clusters', 'handling', 'gun', 'mine', 'strike'];
/**
 * The groups the engine reads as the native record, in spec order. The flat
 * family groups (`fires`, `arrow`, `fire_punch`, …) are record fields too, not
 * claim keys, so they are carried as well.
 */
const RECORD_GROUPS = [
  ...RECORD_KEYS,
  // `sheep.flight_1/2` are native record fields (not named by
  // `record::fields()`, but the engine reads them), so they are carried too.
  'sheep',
  'fires',
  'arrow',
  'baseball_bat',
  'fire_punch',
  'drill',
  'jet_pack',
  'parachute',
  'utility',
  'armageddon',
];

/** True when a table looks like a weapon record rather than a config blob. */
function looksLikeRecord(table: LuaTable | undefined): boolean {
  if (!table) return false;
  return RECORD_GROUPS.some((key) => isTable(table[key]));
}

/** `require("lib/weapon").merge(base, overrides)` in TS. */
function mergeLuaTables(base: LuaTable | undefined, overrides: LuaTable): LuaTable {
  const out: LuaTable = {};
  if (base) {
    for (const [k, v] of Object.entries(base)) {
      out[k] = isTable(v) ? mergeLuaTables(v, {}) : v;
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (isTable(v)) {
      const prev = out[k];
      out[k] = mergeLuaTables(isTable(prev) ? prev : undefined, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** The first table anywhere in the scan that has a record's shape. */
function findRecordLike(scan: ReturnType<typeof scanLua>): LuaTable | undefined {
  const nested: LuaTable[] = [];
  for (const table of Object.values(scan.assignments)) {
    // Nested `weapon = { definition = { ... } }` or `weapon = { record = { ... } }`:
    // check named subtables before generic nested tables so `defaults` or config
    // helpers inside `weapon` cannot shadow the definition table.
    if (isTable(table.definition)) nested.push(table.definition);
    if (isTable(table.record)) nested.push(table.record);
    for (const [k, v] of Object.entries(table)) {
      if (k !== 'definition' && k !== 'record' && isTable(v)) nested.push(v);
    }
  }
  const candidates: LuaTable[] = [
    ...Object.values(scan.assignments),
    ...Object.values(scan.calls),
    ...nested,
  ];
  const returned = scan.returned;
  if (returned) {
    if (looksLikeRecord(returned)) return returned;
    for (const value of Object.values(returned)) {
      if (isTable(value)) candidates.push(value);
    }
  }
  // A module that keeps the record in `weapon.definition` or a local is common
  // in PX's ports; the shape is the only reliable signal.
  return candidates.find(looksLikeRecord);
}

/** `require("lib/x")` targets plus `weapon.requires = { "lib/x" }` arrays, in file order. */
function requiresOf(text: string): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    if (name && !out.includes(name)) out.push(name);
  };
  const pattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) push(match[1]);
  const depArray = /(?:^|[^A-Za-z0-9_])(?:weapon\.)?requires\s*=\s*\{([^}]*)\}/g;
  while ((match = depArray.exec(text))) {
    for (const item of match[1].matchAll(/["']([^"']+)["']/g)) push(item[1]);
  }
  return out;
}

/** The record tables a weapon module spells, whichever style it uses. */
function readRecord(text: string): {
  record?: LuaTable;
  source?: LuaTable;
  defaults?: LuaTable;
  copyFrom?: string;
  sprite?: string;
  clusterSprite?: string;
  wepNames: string[];
} {
  const scan = scanLua(text);

  // `wa.weapons.replace{ … }` is the editor's own shape and PX's `record` is
  // the same nesting, so both land in one place.
  // `wa.weapons.replace{ … }`, `wa.weapons.replace({ … })`, or
  // `wa.weapons.replace(record)` with the table built in a local first.
  const ref = scan.callRefs['wa.weapons.replace'];
  const replace =
    scan.calls['wa.weapons.replace'] ?? (ref ? firstTable(scan, ref) : undefined);
  const assigned = firstTable(scan, 'record', 'weapon.record');
  const definition =
    firstTable(scan, 'definition', 'weapon.definition') ??
    (isTable(scan.assignments['weapon']?.definition)
      ? (scan.assignments['weapon']!.definition as LuaTable)
      : undefined);
  const returned = scan.returned;
  const returnedRecord = isTable(returned?.record) ? (returned!.record as LuaTable) : undefined;

  // `require("lib/weapon").merge(weapon.record, { copy_from = "...", ... })`:
  // combine the base record with the override table when present so claim keys
  // (`copy_from`, `wep`, `hold`, `worm_sprites`, callbacks) travel with it.
  let merged: LuaTable | undefined;
  for (const call of scan.merges) {
    const base =
      call.baseTable ??
      (call.baseRef ? (firstTable(scan, call.baseRef) ?? scan.assignments[call.baseRef]) : undefined);
    const candidate = mergeLuaTables(base, call.overrides);
    if (
      looksLikeRecord(candidate) ||
      typeof candidate.copy_from === 'string' ||
      typeof candidate.wep === 'string'
    ) {
      merged = candidate;
      break;
    }
  }

  const rawSource =
    replace ??
    merged ??
    definition ??
    assigned ??
    returnedRecord ??
    (looksLikeRecord(returned) ? returned : undefined) ??
    findRecordLike(scan);
  const pathTargets =
    rawSource === replace && ref
      ? [ref]
      : rawSource === assigned
        ? ['record', 'weapon.record']
        : rawSource === definition
          ? ['definition', 'weapon.definition']
          : [];
  const source =
    rawSource && pathTargets.length > 0
      ? applyPathAssignments(text, rawSource, pathTargets).table
      : rawSource;
  // A claim table written with names (`hold = { sheet = SHEET }`, `sounds = {
  // SND .. "start.wav" }`) reads back with those fields empty, because the table
  // reader keeps literals only. Resolve them against the text the table was
  // written as, and only when that text is the table we kept: a merged claim's
  // overrides live in the merge call, and reading them from another table would
  // put one weapon's path on another's art.
  if (source) {
    const claimText =
      (rawSource === replace ? claimTextOf(text, 'wa.weapons.replace', 'call') : undefined) ??
      (rawSource === assigned
        ? (claimTextOf(text, 'record', 'assign') ??
          claimTextOf(text, 'weapon.record', 'assign'))
        : undefined) ??
      // A record handed back as data: `definition = { … }`, either assigned
      // (`weapon.definition = { … }`) or a field of the module's own table.
      (rawSource === definition
        ? (claimTextOf(text, 'definition', 'assign') ??
          claimTextOf(text, 'weapon.definition', 'assign') ??
          claimTextOf(text, 'definition', 'field'))
        : undefined) ??
      (rawSource === returned ? claimTextOf(text, '', 'return') : undefined);
    if (claimText) resolveTableStrings(source, claimText, stringConstants(text));
  }
  const defaults = isTable(returned?.defaults)
    ? (returned!.defaults as LuaTable)
    : firstTable(scan, 'defaults', 'weapon.defaults') ??
      (isTable(scan.assignments['weapon']?.defaults)
        ? (scan.assignments['weapon']!.defaults as LuaTable)
        : undefined);

  // A `.wep` filename is a string literal ending in `.wep` anywhere in the
  // module; PyroMan builds the path by concatenation (`M.WEP .. o.wep`), so the
  // literal is the file name on its own and the folder is matched later.
  const wepNames = Array.from(text.matchAll(/["']([^"']+\.wep)["']/gi)).map((match) => match[1]);
  if (!source) return { defaults, wepNames };

  // Only the native record groups survive: a bundle's `wa.weapons.replace{ … }`
  // table also carries claim-level keys (`sprites`, `hold`, `params`,
  // `worm_sprites`, `sounds`, callbacks), and those name art that lives in that
  // bundle. Writing them into an exported weapon would point at files we do not
  // copy, and the install would fail.
  // The claim-level keys are read from the source first -- they are not record
  // fields but they say which donor the weapon builds on and what art it names.
  const copyFrom = typeof source.copy_from === 'string' ? source.copy_from : undefined;
  const sprite = typeof source.sprite === 'string' ? source.sprite : undefined;
  const cluster = isTable(source.cluster) ? (source.cluster as LuaTable) : undefined;
  const clusterSprite =
    typeof source.cluster_sprite === 'string'
      ? source.cluster_sprite
      : cluster && typeof cluster.sprite === 'string'
        ? cluster.sprite
        : undefined;

  const record: LuaTable = {};
  for (const group of RECORD_GROUPS) {
    if (source[group] !== undefined) record[group] = source[group];
  }
  // Cursor selection flag (`on_select = { cursor = true }`), consumed by `mapRecord`.
  if (isTable(source.on_select)) record.on_select = source.on_select;

  return { record, source, defaults, copyFrom, sprite, clusterSprite, wepNames };
}

/** How a weapon's module was found (L1 of `reqs/wflib_weapon_import_plan.md`). */
export type ModuleRoute =
  | 'index'
  | 'entry'
  | 'weapons-id'
  | 'weapons-name'
  | 'wf-lib'
  | 'lib'
  | 'require';

/** `ctx.option("k")` and `ctx.options.k`, the settings a component can read. */
function optionReadsOf(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/ctx\.option\(\s*["']([^"']+)["']/g)) out.add(match[1]);
  for (const match of text.matchAll(/ctx\.options\.([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(match[1]);
  return [...out];
}

/**
 * Every weapon component in the given bundles, with its record read.
 *
 * A component's `entry` is one shared file in a bundle with more than one weapon
 * (`components/weapon.lua`, a loader), so the module is resolved the way the
 * engine's loader does it: the bundle's own index first (`["<id>"] = "<module>"`,
 * wherever it lives), then a unique `entry`, then `weapons/<id after the dot>`,
 * then `weapons/<name>`, then the same names under `wf-lib/` and `lib/`. The
 * first candidate that yields a record wins and `resolvedVia` says which one, so
 * a miss is told apart from a wrong guess.
 *
 * A `require` is resolved by the engine's rules (`lua-host/src/modules.rs`,
 * `make_require`): a plain name is bundle-relative, `wf-lib/<name>` is a
 * declared dependency's `[exports]` entry. A bundle that keeps its own library
 * under `lib/` and still requires `wf-lib/<name>` (PX's standalone bundles) is
 * followed for reading and reported in `localLibraryRequires`, because the
 * current engine refuses that at load.
 */
export function readWeapons(bundles: ModBundle[], files: ModFile[]): ModWeapon[] {
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const weapons: ModWeapon[] = [];

  // `wf-lib/<name>` -> the bundle that exports it. First declaration wins; the
  // engine refuses an ambiguous one, which a bundle reader cannot see anyway.
  const libraryExports = new Map<string, { dir: string; path: string }>();
  for (const bundle of bundles) {
    for (const [name, entry] of Object.entries(bundle.exports)) {
      if (!libraryExports.has(name)) {
        libraryExports.set(name, { dir: bundle.dir, path: entry.replace(/^\.?\//, '') });
      }
    }
  }

  /**
   * Resolve one `require` name to a bundle-relative `.lua` path, in the bundle
   * that holds the *calling* module: a plain name is relative to that bundle
   * (`modules.rs` reads `<bundle>/<name>.lua`), and a module a library
   * exports resolves its own requires in the library's bundle, not the
   * weapon's. `wf-lib/<name>` is a declared dependency's `[exports]` entry, and
   * the bundle's own `lib/<name>.lua` is the legacy shape the engine refuses.
   */
  const resolvers = new Map<string, (name: string) => { path: string; legacy?: boolean } | null>();
  const resolverFor = (bundle: ModBundle) => {
    const key = bundle.dir;
    const cached = resolvers.get(key);
    if (cached) return cached;
    const asLua = (name: string) =>
      joinPath(
        bundle.dir,
        `${name.replace(/^\.?\//, '').replace(/\.lua$/, '')}.lua`,
      );
    const resolve = (name: string): { path: string; legacy?: boolean } | null => {
      const clean = name.replace(/^\.?\//, '');
      if (clean.startsWith('wf-lib/')) {
        const exported = libraryExports.get(clean);
        if (exported) {
          const path = joinPath(
            exported.dir,
            `${exported.path.replace(/^\.?\//, '').replace(/\.lua$/, '')}.lua`,
          );
          if (byPath.has(path)) return { path };
        }
        const local = asLua(`lib/${clean.slice('wf-lib/'.length)}`);
        if (byPath.has(local)) return { path: local, legacy: true };
        return null;
      }
      const path = asLua(clean);
      return byPath.has(path) ? { path } : null;
    };
    resolvers.set(key, resolve);
    return resolve;
  };
  /** The bundle a module path belongs to (the longest manifest prefix). */
  const bundleOf = (path: string): ModBundle | undefined => {
    let found: ModBundle | undefined;
    for (const bundle of bundles) {
      if (bundle.dir && !path.startsWith(`${bundle.dir}/`)) continue;
      if (!found || bundle.dir.length > found.dir.length) found = bundle;
    }
    return found;
  };

  for (const bundle of bundles) {
    const weaponComponents = bundle.components.filter((component) => component.type === 'weapon');
    const resolveName = resolverFor(bundle);

    // Every id -> module map in the bundle, whatever file holds it.
    const index: Record<string, string> = {};
    for (const rel of bundle.files) {
      if (!/\.lua$/i.test(rel)) continue;
      const text = byPath.get(joinPath(bundle.dir, rel));
      if (text) readIndexMap(text, index);
    }

    const namespace = bundle.assetNamespace?.replace(/^wf-lib\//, '');
    for (const component of weaponComponents) {
      const suffix = component.id.split('.').pop() ?? component.id;
      const candidates: { name: string; route: ModuleRoute }[] = [];
      const add = (name: string, route: ModuleRoute) => {
        const clean = name.replace(/^\.?\//, '').replace(/\.lua$/, '');
        if (clean && !candidates.some((candidate) => candidate.name === clean)) {
          candidates.push({ name: clean, route });
        }
      };
      const indexed = index[component.id];
      if (indexed) add(indexed, 'index');
      // The component's own `entry` is the module the engine runs, whether one
      // weapon uses it or twenty: `px.bunker_buster` and `px.super_bunker_buster`
      // are two components over one module that tells them apart by `ctx.id`. A
      // shared loader entry yields no record here and the search continues.
      if (component.entry) add(component.entry, 'entry');
      add(`weapons/${suffix}`, 'weapons-id');
      add(`weapons/${slug(component.name)}`, 'weapons-name');
      if (namespace) {
        add(`wf-lib/${namespace}/weapons/${suffix}`, 'wf-lib');
        add(`wf-lib/${namespace}/${suffix}`, 'wf-lib');
      }
      add(`lib/weapons/${suffix}`, 'lib');
      add(`lib/${suffix}`, 'lib');

      const base: ModWeapon = {
        bundleId: bundle.id,
        bundleName: bundle.name,
        bundleDir: bundle.dir,
        bundleApiVersion: bundle.apiVersion,
        dependencies: bundle.dependencies,
        spriteDecls: bundle.spriteDecls,
        author: bundle.author,
        bundleModIcon: bundle.modIcon,
        componentId: component.id,
        name: component.name,
        description: component.description,
        icon: component.icon,
        row: component.row,
        column: component.column,
        modulePath: '',
        options: component.options,
        weaponOptions: component.weaponOptions.length > 0 ? component.weaponOptions : undefined,
        suggests: Object.keys(component.suggests).length > 0 ? component.suggests : undefined,
      };

      // The weapon's own module is the first candidate that is a file; the
      // record comes from the first candidate that spells one.
      let modulePath = '';
      let moduleText = '';
      let parsed: ReturnType<typeof readRecord> | null = null;
      let recordPath = '';
      let resolvedVia: ModuleRoute | undefined;
      for (const candidate of candidates) {
        const resolved = resolveName(candidate.name);
        if (!resolved) continue;
        if (!modulePath) {
          modulePath = resolved.path;
          moduleText = byPath.get(resolved.path) ?? '';
        }
        const next = readRecord(byPath.get(resolved.path) ?? '');
        if (!parsed) parsed = next;
        else if (!parsed.record && (next.defaults || next.wepNames.length > 0)) {
          parsed = { ...next, wepNames: [...next.wepNames, ...parsed.wepNames] };
        }
        if (next.record) {
          parsed = next;
          recordPath = resolved.path;
          resolvedVia = candidate.route;
          break;
        }
      }

      if (!modulePath) {
        weapons.push({
          ...base,
          optionReads: [],
          requires: [],
          unresolvedRequires: [],
          localLibraryRequires: [],
          error: `no Lua module found for this component (tried ${candidates
            .map((candidate) => candidate.name)
            .join(', ')})`,
        });
        continue;
      }

      // A module can hand the record to a library (`lib/px_ninja_star.lua`).
      // Follow its requires two levels deep, resolved by the engine's own rules,
      // which is where PX's ports put the `wa.weapons.replace{ … }` call.
      const requires: string[] = [];
      const unresolvedRequires: string[] = [];
      const localLibraryRequires: string[] = [];
      /** `require` names in a module, resolved in the module's own bundle. */
      const noteRequires = (text: string, from: string) => {
        const resolve = resolverFor(bundleOf(from) ?? bundle);
        for (const name of requiresOf(text)) {
          const resolved = resolve(name);
          if (!resolved) {
            if (!unresolvedRequires.includes(name)) unresolvedRequires.push(name);
            continue;
          }
          if (resolved.legacy && !localLibraryRequires.includes(name)) {
            localLibraryRequires.push(name);
          }
          if (!requires.includes(resolved.path)) requires.push(resolved.path);
        }
      };
      noteRequires(moduleText, modulePath);

      if (!recordPath) {
        const seen = new Set<string>([modulePath]);
        const queue = requiresOf(moduleText).map((target) => ({ target, depth: 0 }));
        while (queue.length > 0 && !recordPath) {
          const { target, depth } = queue.shift()!;
          const resolved = resolveName(target);
          if (!resolved || seen.has(resolved.path)) continue;
          seen.add(resolved.path);
          const source = byPath.get(resolved.path) ?? '';
          noteRequires(source, resolved.path);
          const next = readRecord(source);
          if (next.record) {
            parsed = next;
            recordPath = resolved.path;
            resolvedVia = 'require';
            break;
          }
          if (depth < 1) {
            const nestedResolve = resolverFor(bundleOf(resolved.path) ?? bundle);
            for (const nested of requiresOf(source)) {
              if (nestedResolve(nested)) queue.push({ target: nested, depth: depth + 1 });
            }
          }
        }
      }

      const recordText = recordPath ? (byPath.get(recordPath) ?? '') : '';
      if (recordPath && recordPath !== modulePath) noteRequires(recordText, recordPath);

      // What the code will actually load: a module reached by `require` runs its
      // own requires too, in its own bundle, and `ctx.option`/`wf-lib/` failures
      // are reported from anywhere in that graph. Walk it two levels for the
      // report, whether or not the record came from the first module.
      const walked = new Set<string>([modulePath, recordPath].filter(Boolean));
      let frontier = [...walked];
      for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
        const next: string[] = [];
        for (const path of frontier) {
          for (const name of requiresOf(byPath.get(path) ?? '')) {
            const resolved = resolverFor(bundleOf(path) ?? bundle)(name);
            if (!resolved || walked.has(resolved.path)) continue;
            walked.add(resolved.path);
            noteRequires(byPath.get(resolved.path) ?? '', resolved.path);
            next.push(resolved.path);
          }
        }
        frontier = next;
      }

      // A `.wep` the module names: match it against the bundle's own files by
      // base name, because the path may be assembled by concatenation.
      const wepNames = [
        ...(parsed?.wepNames ?? []),
        ...(recordPath && recordPath !== modulePath
          ? Array.from(recordText.matchAll(/["']([^"']+\.wep)["']/gi)).map((match) => match[1])
          : []),
      ];
      let wepPath = '';
      for (const name of wepNames) {
        const wanted = name.split(/[\/]/).pop()!.toLowerCase();
        const found = bundle.files.find(
          (file) =>
            (file.toLowerCase().endsWith('.wep') &&
              file.toLowerCase().endsWith(`/${wanted}`)) ||
            file.toLowerCase() === wanted,
        );
        if (found) {
          wepPath = joinPath(bundle.dir, found);
          break;
        }
      }

      const optionReads = optionReadsOf(
        recordPath && recordPath !== modulePath ? `${moduleText}\n${recordText}` : moduleText,
      );

      weapons.push({
        ...base,
        ...(parsed ?? { wepNames: [] }),
        modulePath: recordPath || modulePath,
        resolvedVia: recordPath ? resolvedVia : undefined,
        optionReads,
        requires,
        unresolvedRequires,
        localLibraryRequires,
        wepPath: wepPath || undefined,
        wepNames: wepNames.length > 0 ? wepNames : undefined,
        error:
          recordPath || wepPath
            ? undefined
            : wepNames.length > 0
              ? "the record is in a .wep file that isn't in this bundle"
              : `no record table in ${modulePath} (looked in ${candidates
                  .map((candidate) => candidate.name)
                  .join(', ')})`,
      });
    }
  }

  return weapons;
}

/** `{ missile: { sprite: 51 } }` -> `{ 'missile.sprite': 51 }`, for previews. */
export function flattenRecord(table: LuaTable | undefined, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!table) return out;
  for (const [key, value] of Object.entries(table)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTable(value)) Object.assign(out, flattenRecord(value, path));
    else out[path] = value;
  }
  return out;
}
