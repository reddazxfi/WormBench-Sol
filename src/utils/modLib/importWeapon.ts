/**
 * Turning a bundle weapon into an editor project.
 *
 * The order is the engine's own: a bundled `.wep` is the base record (the same
 * thing the `.wep` importer decodes), and the tables the module declares are
 * edits on top of it. A module with no `.wep` starts from its `copy_from`
 * donor instead, and its declared tables are the whole record.
 *
 * The declared tables are carried as `recordExtra` and emitted verbatim, so the
 * export is faithful before the typed editor fields know about every key. Full
 * mapping into the panels is the next step; until then the panels show the
 * `.wep`/donor values and the export still writes what the bundle declared.
 */
import type { CarriedLua, CarriedLuaArt, WeaponProject } from '../../types/weapon';
import { checkLua } from '../luaCheck';
import { maskLuaCode, stripNotGeneratedMarkers } from '../luaText';
import { parseWepBinary } from '../wepParser';
import { copyNamespace, slugId } from '../weaponId';
import { mapRecord } from './mapRecord';
import { splitModule } from './splitModule';
import { ownOutputOf } from './ownOutput';
import { carryClosure, dependencyForModule } from './carryClosure';
import {
  customSoundPath,
  declaredNames,
  generateLuaCode,
  hookBodyOf,
  sanitizeModFolder,
} from '../luaGenerator';
import { readAsset, readBundleFeatures, unmodelledClaimKeys } from './importFeatures';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../../data/defaults';
import { CLAIM_FLAG_KEYS } from '../../data/luaHooks';
import { stockDonor, stockDonorBaseline } from '../../data/stockDonors';
import { stockSlotForPosition } from '../../data/stockWeapons';
import { isTable, type LuaTable } from './luaTable';
import type { ModFile, ModWeapon } from './scan';

export interface BundleImport {
  project: Partial<WeaponProject>;
  /** What the import did, for the toast and the panel. */
  notes: string[];
  /**
   * What the export cannot write as it stands, one sentence each: a carried
   * `require` nothing ships, a Lua error, an option the component does not
   * declare. These are not opinions about style; the emitted module raises at
   * load, and `validateBundle` refuses it by weapon and rule. A single-weapon
   * import shows them in its toast; a whole-bundle import has no room for that,
   * so `importBundlePack` collects them into `warnings`.
   */
  blocking: string[];
  /**
   * Replace the whole project instead of merging into the open one: an import
   * starts a new weapon, so the previous one's art, effects and builder
   * settings must not leak into it.
   */
  replaceProject: boolean;
  /**
   * The bundle's own icon (`mod_icon`), when the manifest declared one. A pack
   * has one icon for the whole bundle, so a single-weapon import carries it to
   * the pack it creates instead of dropping the picture the mod loader shows.
   */
  modIcon?: { file: File; preview?: string };
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** `defaults = { ammo = { round_start = -1 }, delay = 0, … }` -> our fields. */
function defaultsFrom(table: LuaTable | undefined): Partial<WeaponProject['defaults']> {
  if (!table) return {};
  const out: Partial<WeaponProject['defaults']> = {};
  const ammo = table.ammo as LuaTable | undefined;
  const roundStart = num(ammo?.round_start);
  if (roundStart !== undefined) out.ammo = roundStart;
  const delay = num(table.delay);
  if (delay !== undefined) out.delay = delay;
  const crate = table.crate as LuaTable | undefined;
  const chance = num(crate?.chance_pct);
  if (chance !== undefined) out.crateChance = chance;
  const crateType = str(crate?.type);
  if (crateType === 'weapon' || crateType === 'utility' || crateType === 'super') {
    out.crateType = crateType;
  }
  const afterUse = str(table.after_use);
  if (afterUse === 'end' || afterUse === 'retreat' || afterUse === 'continue') {
    out.afterUse = afterUse;
  }
  return out;
}

const MODELLED_DEFAULTS = new Set(['ammo', 'delay', 'crate', 'after_use']);
const AMMO_UNMODELLED = ['turn_start', 'crate_collect', 'stockpiling'] as const;

/** Keys on `weapon.defaults` (or nested `ammo`) that the editor does not model. */
function unmodelledDefaultKeys(table: LuaTable | undefined): string[] {
  if (!table) return [];
  const out: string[] = [];
  for (const key of Object.keys(table)) {
    if (!MODELLED_DEFAULTS.has(key)) out.push(key);
  }
  if (isTable(table.ammo)) {
    for (const sub of AMMO_UNMODELLED) {
      if (table.ammo[sub] !== undefined) out.push(`ammo.${sub}`);
    }
  }
  return out;
}

/**
 * Which fire family a record's own tables describe. `missile` is checked before
 * `strike`: PX's records often keep a `strike` group beside the missile body
 * (the same weapon fired from a plane), and the missile is the weapon itself.
 */
function fireTypeOf(record: LuaTable | undefined): WeaponProject['fireType'] | undefined {
  if (!record) return undefined;
  if (record.gun) return 'hitscan';
  if (record.mine) return 'drop';
  if (record.missile) return 'power';
  if (record.strike) return 'cursor';
  if (record.arrow) return 'arrow';
  if (
    record.baseball_bat ||
    record.fire_punch ||
    record.drill ||
    record.jet_pack ||
    record.parachute ||
    record.utility
  ) {
    return 'special';
  }
  if (isTable(record.on_select) && record.on_select.cursor === true) return 'cursor';
  return undefined;
}

export async function importBundleWeapon(
  weapon: ModWeapon,
  files: ModFile[],
): Promise<BundleImport> {
  const notes: string[] = [];
  const blocking: string[] = [];
  const name = weapon.name || weapon.componentId;
  // The id is derived from the bundle the weapon came out of, never from a fixed
  // namespace: the copy takes the source's own id with `.import` after it, so a
  // Project X bundle stays recognisable and cannot claim an installed one's ids
  // (`px.ports.import.pyro_grenade`). A bundle of one weapon is that weapon, so
  // the export's bundle id is this same id, and the author edits it whole.
  const id = `${copyNamespace(weapon.bundleId)}.${slugId(name)}`;
  // A module whose `copy_from` is not a literal (PX builds its claim table at
  // load: `require("lib/weapon").merge(record, {...})`) leaves the reader with no
  // donor, and the record then starts from the editor's Grenade values. Saying
  // so is the difference between a weapon the author can correct and a weapon
  // that silently claims a donor it never had.
  const donorReadable = !!weapon.copyFrom;
  const donor = weapon.copyFrom?.replace(/^stock\./, '') ?? 'grenade';

  const wepFile = weapon.wepPath ? files.find((file) => file.path === weapon.wepPath) : undefined;
  let project: Partial<WeaponProject> = {};
  /** The decoded `.wep` before the module's edits, so the export writes only them. */
  let baseline: WeaponProject['wepBaseline'];

  if (wepFile?.bytes) {
    const fileName = weapon.wepPath!.split('/').pop() || 'weapon.wep';
    const bytes = wepFile.bytes;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = parseWepBinary(buffer as ArrayBuffer, fileName);
    if (decoded.success) {
      project = { ...decoded.projectState };
      project.useWepFile = true;
      project.wepFileName = fileName;
      project.wepFile = new File([bytes as BlobPart], fileName, { type: 'application/octet-stream' });
      // Snapshot the decoded record: the module's tables are edits on top, and
      // the generator diffs against this so only those edits are written.
      baseline = {
        body: { ...(project.body as WeaponProject['body']) },
        action: project.action as WeaponProject['action'],
        burst: project.burst as WeaponProject['burst'],
        recordOverrides: { ...(project.recordOverrides ?? {}) },
        missileSprite: { ...(project.missileSprite as WeaponProject['missileSprite']) },
        roamConfig: { ...(project.roamConfig as WeaponProject['roamConfig']) },
        digConfig: { ...(project.digConfig as WeaponProject['digConfig']) },
        fireConfig: { ...(project.fireConfig as WeaponProject['fireConfig']) },
        specialSubtype: project.specialSubtype ?? 1,
      };
      notes.push(`record from ${fileName}`);
    } else {
      notes.push(`could not decode ${fileName}: ${decoded.error ?? 'unknown error'}`);
    }
  }

  let donorBaseline: WeaponProject['donorBaseline'];
  const manifestSlot = stockSlotForPosition(weapon.row, weapon.column);
  if (project.useWepFile && manifestSlot) {
    project.slot = manifestSlot;
  }
  if (!project.useWepFile) {
    // `copy_from` asks the engine for the donor's own record, so the donor's
    // decoded values are the starting point *and* the diff baseline. A record
    // that declares a handful of fields therefore exports those fields only.
    const donorRecord = stockDonor(donor) ?? {};
    donorBaseline = stockDonorBaseline(donor);
    project = {
      ...donorRecord,
      slot: manifestSlot ?? donor,
      based_on: donor,
      fireType:
        donorReadable && donorRecord.fireType === 'cursor'
          ? 'cursor'
          : (fireTypeOf(weapon.record) ?? donorRecord.fireType ?? 'power'),
      useWepFile: false,
      wepFile: undefined,
      wepFileName: undefined,
      wepBaseline: undefined,
      donorBaseline,
    };
    notes.push(
      !donorReadable
        ? `no copy_from readable: this module builds its claim table at load, so the record starts from stock.${donor} and the export will name it. Pick the real base in Weapon Loadout.`
        : donorRecord.body
          ? `base record: stock.${donor}`
          : `base record: stock.${donor} (no decoded donor, editor defaults)`,
    );
  }

  // The module's tables become the typed fields, so the panels show the real
  // weapon. Whatever the mapper does not model stays in `recordExtra` and is
  // still emitted verbatim.
  const mapped = mapRecord(weapon.record, {
    // A `.wep` supplies the base record; without one the editor's defaults do,
    // so a record that declares only some fields still exports complete values.
    body: (project.body ?? { ...DEFAULT_BODY, clustlet: { ...DEFAULT_BODY.clustlet } }) as WeaponProject['body'],
    action: (project.action ?? 'none') as WeaponProject['action'],
    burst: (project.burst ?? 'nothing') as WeaponProject['burst'],
    roamConfig: (project.roamConfig ?? { ...DEFAULT_ROAM }) as WeaponProject['roamConfig'],
    digConfig: (project.digConfig ?? { ...DEFAULT_DIG }) as WeaponProject['digConfig'],
    fireConfig: (project.fireConfig ?? { ...DEFAULT_FIRE }) as WeaponProject['fireConfig'],
    recordOverrides: { ...(project.recordOverrides ?? {}) },
  });
  if (weapon.record) {
    const mappedKeys = Object.keys(mapped.recordOverrides).length;
    notes.push(`${mappedKeys} record fields mapped`);
  }

  // Features live outside the record: the held art table, the `sb.flight`
  // roles, the ribbon trail, the explosion burst and hooks, the `fire_seq`
  // burst, custom WAVs and the claim's own sheets. The reader attaches the
  // bundle's files, so a re-export writes the same art and samples.
  const moduleText = files.find((file) => file.path === weapon.modulePath)?.text ?? '';
  const bitAction =
    mapped.body.clustlet.bit_action ??
    (mapped.body.clustlet.homing !== 'off'
      ? 'homing'
      : mapped.body.clustlet.contact === 'bounce'
        ? 'bounce'
        : 'none');
  const features = await readBundleFeatures({
    weapon,
    files,
    moduleText,
    mappedPackArt: mapped.packArt,
    digging:
      mapped.action === 'dig' || (mapped.burst === 'clusters' && bitAction === 'dig'),
  });
  notes.push(...features.notes);
  // A sound role is a *place* as well as a file. `shot` rides the sequential-fire
  // burst's `on_shot` and a launch WAV rides `on_fire`, so a bundle whose WAV has
  // nowhere to play (a single-shot handgun with a `shot` sample, the Conductor)
  // was being dropped without a word.
  const importedSounds = features.project.customSounds;
  if (importedSounds?.shotEnabled && importedSounds.shot && !features.project.fireSequence?.enabled) {
    notes.push(
      'shot WAV has nowhere to play: the shot role is the sequential-fire burst\'s on_shot, and this weapon has no burst (the launch role plays from on_fire)',
    );
  }
  // A melee weapon is a custom claim, not a WA fire type: its record is an
  // ordinary power one (the Sheep Launcher), so nothing in the record tables says
  // "melee" and `fireTypeOf` answers `power`. The claim's own `melee` table is the
  // signal, and without this an imported swing came back as a projectile.
  const isMelee = !!features.project.melee?.enabled;
  // Which of the module's claim hooks are carried (M5/M6), decided before the
  // "not carried" note so that note stays honest: a key we carry is absorbed,
  // one we cannot place is reported.
  const split = splitModule(moduleText);
  // A hook written inside another hook belongs to that hook's text: PX's
  // `fire_seq` burst passes `on_done = function(ww) … end` in the options table
  // of the call `on_fire` makes, and that closure reads `on_fire`'s locals. As a
  // claim key of its own it would be hoisted out of the scope it was written in
  // and read them as nils.
  const nested = new Set<string>(split.nestedHooks ?? []);
  const carriedHookList = features.carriedHooks.filter((hook) => !nested.has(hook.key));
  if (nested.size > 0) {
    notes.push(
      `carried inside their parent hook, not as claim keys: ${[...nested].join(', ')} (${[...nested]
        .map((key) => split.hookLines?.[key as keyof typeof split.hookLines] ?? 0)
        .join(', ')} inside ${split.hooks.on_fire ? 'on_fire' : 'another hook'})`,
    );
  }
  const claimAbsorbed = ['on_explode', 'on_fire'];
  if (split.hooks.on_fire && !nested.has('on_fire') && features.project.fireSequence?.enabled) {
    const body = hookBodyOf(split.hooks.on_fire).body;
    // Detect custom logic inside `on_fire` besides the sequential-fire call
    // and optional `wa.sound.play(...)` calls so extra behavior is flagged.
    let remainder = body;
    const seqCallMatch = /seq\.(?:fire_seq_mis|fire_sequential_actor)\s*([({])/.exec(remainder);
    if (seqCallMatch) {
      const openIdx = seqCallMatch.index + seqCallMatch[0].length - 1;
      const openCh = seqCallMatch[1];
      const closeCh = openCh === '(' ? ')' : '}';
      let depth = 0;
      let endIdx = -1;
      for (let i = openIdx; i < remainder.length; i += 1) {
        if (remainder[i] === openCh) depth += 1;
        else if (remainder[i] === closeCh) {
          depth -= 1;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      if (endIdx > openIdx) {
        remainder = remainder.slice(0, seqCallMatch.index) + remainder.slice(endIdx);
      }
    }
    const stripped = remainder
      .replace(/--[^\n]*/g, '')
      .replace(/\blocal\s+dx\s*,\s*dy\s*=\s*seq_dir\([^)]*\)/g, '')
      .replace(/wa\.sound\.play\([^)]*\)/g, '')
      .trim();
    if (stripped.length > 0) {
      notes.push(
        'on_fire has custom code beyond the sequential-fire burst, which is replaced by sequential fire on export',
      );
    }
  }
  if (split.hooks.on_fire && !nested.has('on_fire') && !features.project.fireSequence?.enabled) {
    const body = hookBodyOf(split.hooks.on_fire);
    // Our own legacy launch-WAV `on_fire` is one `wa.sound.play` of the launch
    // sample plus trailing comments: stripping comments prevents duplicating it.
    const normalizedFireBody = body.body.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
    const ourLaunchPlay =
      !!features.project.customSounds?.launch?.file &&
      /^wa\.sound\.play\([^)]*\)$/.test(normalizedFireBody) &&
      normalizedFireBody.includes('/launch.wav');
    // The emitter's hand-off is the same kind of thing: `emitter_start` /
    // `EMITTER.follow = emitter_round` is what the emitter card writes again.
    const ourEmitterHandOff =
      !!features.project.emitter?.enabled &&
      (body.body.includes('emitter_start(') || body.body.includes('EMITTER.follow ='));
    if (ourLaunchPlay) {
      notes.push('on_fire is the launch WAV this editor emits: rebuilt from the card');
    } else if (ourEmitterHandOff) {
      notes.push('on_fire is the emitter hand-off this editor emits: rebuilt from the card');
    } else {
      carriedHookList.push({
        key: 'on_fire',
        text: split.hooks.on_fire,
        line: split.hookLines?.on_fire ?? 0,
      });
    }
  }
  if (
    split.hooks.on_explode &&
    !nested.has('on_explode') &&
    split.namedHooks?.includes('on_explode') &&
    !carriedHookList.some((hook) => hook.key === 'on_explode')
  ) {
    carriedHookList.push({
      key: 'on_explode',
      text: split.hooks.on_explode,
      line: split.hookLines?.on_explode ?? 0,
    });
  }
  for (const [key, text] of Object.entries(split.hooks) as [string, string | undefined][]) {
    if (key === 'on_explode' || key === 'on_fire' || !text) continue;
    if (nested.has(key)) continue;
    if (key === 'on_shot' && features.project.fireSequence?.enabled) {
      // `fire_seq` writes its own `on_shot` inside the burst; a second one would
      // replace it in the claim table.
      notes.push('not carried: on_shot (the sequential-fire burst owns that key)');
      continue;
    }
    carriedHookList.push({ key, text, line: split.hookLines?.[key as keyof typeof split.hookLines] ?? 0 });
  }
  // `wa.on.*` registrations (M6): additive, so they are carried verbatim and in
  // the bundle's own order, except the ones this editor wrote (M1.5). A
  // registration is also a *scope*: vortex's `wa.on.draw` reads `cell`, `HOLE`
  // and `vortices`, so its handler is a seed for the closure like a hook body.
  const ownCode = ownOutputOf(split);
  const carriedRegistrations = ownCode.foreign.map((registration) => ({
    event: registration.event,
    text: registration.text,
    line: registration.line,
  }));
  // Read the module itself before anything is carried out of it: a bundle whose
  // own code would desync a match or fail at load is worth saying out loud at
  // import, not discovering in game. The rules are `wfcheck`'s.
  const luaFindings = checkLua(moduleText, { mode: 'module' });
  if (luaFindings.length > 0) {
    const errors = luaFindings.filter((finding) => finding.severity === 'error');
    const kinds = [...new Set(luaFindings.map((finding) => finding.rule))].join(', ');
    // `error` only: `pairs()` is an advisory and trig in a draw callback is a
    // warning, the compiler's own levels. Calling an advisory "blocking" made a
    // paint-only draw file read as broken at import.
    notes.push(
      `lua: ${luaFindings.length} finding${luaFindings.length === 1 ? '' : 's'}, ${
        errors.length > 0 ? `${errors.length} blocking` : 'nothing blocking'
      } (${kinds})`,
    );
    if (errors.length > 0) {
      blocking.push(
        `${errors.length} Lua error${errors.length === 1 ? '' : 's'} (${[...new Set(errors.map((finding) => finding.rule))].join(', ')}): the export refuses the module`,
      );
    }
  }
  // `ctx.option("k")` on a key the component does not declare raises
  // `"<id> has no option <k>"` and the whole bundle fails to load, so it is worth
  // naming at import rather than discovering in game.
  const declaredOptions = new Set((weapon.options ?? []).map((option) => option.key));
  const undeclaredReads = (weapon.optionReads ?? []).filter((key) => !declaredOptions.has(key));
  if (undeclaredReads.length > 0) {
    notes.push(
      `ctx.option reads ${undeclaredReads.join(', ')}, which ${weapon.componentId} does not declare: the engine raises "has no option" and the weapon fails to load`,
    );
    blocking.push(
      `ctx.option reads ${undeclaredReads.join(', ')}, which ${weapon.componentId} does not declare`,
    );
  }
  if (weapon.weaponOptions && weapon.weaponOptions.length > 0) {
    notes.push(
      `weapon_options (${weapon.weaponOptions.map((option) => option.key).join(', ')}): per-placed-weapon feature settings are not authored here`,
    );
  }
  const unmodelled = unmodelledClaimKeys(weapon.source, [
    // The sequential-fire reader reconstructs the burst inside `on_fire`, and
    // M5/M6 carry the hooks themselves: a key either travels with the weapon or
    // is named here.
    ...(features.project.fireSequence?.enabled ? ['on_fire'] : []),
    ...claimAbsorbed,
    ...carriedHookList.map((hook) => hook.key),
  ]);
  if (unmodelled.length > 0) {
    notes.push(`not carried: ${unmodelled.join(', ')}`);
  }
  const claimFlags = CLAIM_FLAG_KEYS.filter(
    (flag) => weapon.source && weapon.source[flag] !== undefined,
  );
  if (claimFlags.length > 0) {
    notes.push(`claim flags not re-emitted: ${claimFlags.join(', ')}`);
  }
  const extraDefaults = unmodelledDefaultKeys(weapon.defaults);
  if (extraDefaults.length > 0) {
    notes.push(`unmodelled defaults: ${extraDefaults.join(', ')}`);
  }
  const maskedModule = maskLuaCode(moduleText);
  if (/\bfunction\s+[A-Za-z_][A-Za-z0-9_.]*\.configure\b|\bconfigure\s*=\s*function\b/.test(maskedModule)) {
    notes.push(
      /\bspec\s*[.\[]/.test(maskedModule)
        ? 'uses weapon.configure(ctx, spec) to mutate record spec at load'
        : 'uses weapon.configure(ctx) to apply option settings at load',
    );
  }
  const ctxStateReads = (['ctx.placed', 'ctx.weapons', 'ctx.data'] as const).filter((expr) =>
    new RegExp(`\\b${expr.replace('.', '\\s*\\.\\s*')}\\b`).test(maskedModule),
  );
  if (ctxStateReads.length > 0) {
    notes.push(`reads pack/match state (${ctxStateReads.join(', ')})`);
  }
  // What the module is made of, so "the record came across, the code did not"
  // has a size instead of being a suspicion, and so the part that is *not* lost
  // is named: the ribbon trail, interval sound and fuse sampler below are this
  // editor's own emission, and a panel writes them again on export (M1.5 of the
  // plan). Carrying them as foreign code would ship two of each.
  const moduleParts = [
    split.preamble.length > 0 ? `${split.preamble.length} module-level declaration(s)` : '',
    split.install ? `${split.install.statements.length} install statement(s)` : '',
  ].filter(Boolean);
  const hookCount = Object.keys(split.hooks).length;
  if (moduleParts.length > 0 || hookCount > 0) {
    notes.push(
      `module code: ${moduleParts.join(', ')}${hookCount > 0 ? `${moduleParts.length > 0 ? ', ' : ''}${hookCount} claim hook(s)` : ''}`,
    );
  }
  const own = ownOutputOf(split);
  if (split.registrations.length > 0) {
    const panels = [...new Set(own.own.map(({ emission }) => emission.panel))];
    const parts: string[] = [];
    if (own.own.length > 0) {
      parts.push(`${own.own.length} rebuilt from the panels (${panels.join(', ')})`);
    }
    if (own.foreign.length > 0) {
      const events = [...new Set(own.foreign.map((registration) => registration.event))];
      parts.push(`${own.foreign.length} not modelled (${events.join(', ')})`);
    }
    notes.push(`wa.on handlers: ${parts.join('; ')}`);
  }

  const nextProject: Partial<WeaponProject> = {
    ...project,
    ...features.project,
    // Carried art lands here (`customSprites` is what the exporter writes and
    // `mod.toml` declares), so the map has to exist even when the project this
    // import started from did not carry one.
    customSprites: { ...(project.customSprites ?? {}) },
      fireType: isMelee ? 'melee' : (project.fireType ?? 'power'),
      id,
      name,
      description:
        weapon.description ?? `${name}, read from ${weapon.bundleName} (${weapon.bundleId}).`,
      author: weapon.author ?? 'WormBench Author',
      panel_icon: features.project.panel_icon ?? project.panel_icon ?? donor,
      // A bundle import starts a new weapon, so only the module's own defaults
      // apply; the open/project baseline must not supply crate or retreat
      // settings the bundle never declared.
      defaults: {
        ammo: 1,
        delay: 0,
        crateChance: 0,
        crateType: 'weapon',
        afterUse: '',
        ...defaultsFrom(weapon.defaults),
      },
      body: mapped.body,
      action: mapped.action,
      burst: mapped.burst,
      roamConfig: mapped.roamConfig,
      digConfig: mapped.digConfig,
      fireConfig: mapped.fireConfig,
      recordOverrides: mapped.recordOverrides,
      recordExtra: mapped.recordExtra,
      specialSubtype: mapped.specialSubtype ?? project.specialSubtype,
      teleport: mapped.teleport ?? project.teleport,
      // The decoded `.wep` is the diff base; without one the donor is.
      wepBaseline: baseline,
      donorBaseline,
      // The component's `ctx.option` settings. `ctx.option` is an error for a
      // key the manifest does not declare, so the declarations are kept in
      // declaration order and written back unchanged; the values themselves
      // belong to the player's profile, so an import starts from the defaults.
      options: (weapon.options ?? []).map((option) => ({
        key: option.key,
        kind: option.kind || 'bool',
        label: option.label,
        description: option.description,
        default: option.default,
        choices: option.choices,
        min: option.min,
        max: option.max,
        fromBool: option.fromBool,
        data: option.data,
      })),
      ...(weapon.suggests && Object.keys(weapon.suggests).length > 0
        ? { suggests: weapon.suggests }
        : {}),
      // The module's own callbacks are not carried (`features.project` only
      // extracts the custom part of `on_explode`); anything else would need
      // that bundle's libraries to run.
    enableCustomLua: features.project.enableCustomLua ?? false,
    customLuaSnippet: features.project.customLuaSnippet ?? '',
  };

  // ---- the code the carried hooks close over (M2 and M3) -------------------
  // Carrying the hook body alone was the plan's first defect: pulsar's
  // `on_explode` writes `aura[ev.missile] = nil` and vector's calls
  // `start_vortex`, and neither name existed in the export. The closure is
  // resolved against the module, the names the emitted file already binds come
  // from the generator itself, and each hook body is rewritten the same way its
  // declarations are, so the two always agree.
  //
  // The hooks themselves are M5's: they are the bundle's, not the author's
  // snippet, so they travel in `carriedLua` and the custom Lua box stays what
  // the user typed into it.
  // Art paths the carried text names, each with the path it came from, so the
  // file can be read out of the bundle it was in.
  const carriedPaths: { source: string; target: string }[] = [];
  let carriedSummary = '';
  // A registration is code too: a bundle whose only foreign code is a
  // `wa.on.hurt` (WF 57) has no claim hook to seed the carry, and gating on the
  // hook list alone dropped its handler without a word.
  if (carriedHookList.length > 0 || carriedRegistrations.length > 0) {
    // A hook or a registration is a point of use, so its own enclosing scopes go
    // with it: PX declares its state inside `function weapon.setup() do … end`,
    // and a callback registered there closes over those locals (L2).
    // The chain comes from the module's own hook when it has one: an `on_explode`
    // the feature reader rebuilt keeps only the author's lines, so its line
    // number is not the module's, but the scope it sits in is still the module's.
    const hookScope = (key: string, line: number) => {
      const at = split.hookLines?.[key as keyof typeof split.hookLines];
      if (at !== undefined && line !== 0 && at !== line) return undefined;
      return split.hookScopes?.[key as keyof typeof split.hookScopes];
    };
    const seeds = [
      ...carriedHookList.map((hook) => ({
        label: hook.key,
        text: hook.text,
        enclosing: hookScope(hook.key, hook.line),
      })),
      ...carriedRegistrations.map((registration) => ({
        label: `wa.on.${registration.event}`,
        text: registration.text,
        enclosing: split.registrations.find(
          (entry) => entry.event === registration.event && entry.line === registration.line,
        )?.enclosing,
      })),
    ];
    let reserved = new Map<string, string>();
    let emitted = '';
    try {
      // The generator on the project *without* its carried blocks: the names it
      // binds do not depend on them, so this is what the export will declare.
      emitted = generateLuaCode(nextProject as WeaponProject);
      reserved = declaredNames(emitted);
    } catch {
      // A project too incomplete to generate is already reported elsewhere; the
      // carry then keeps every block, which `checkLua` on the export will show.
      reserved = new Map();
    }
    const carried = carryClosure(
      seeds,
      split,
      reserved,
      sanitizeModFolder(id),
      emitted,
    );
    carriedPaths.push(...carried.paths);
    // A hook or a registration is transformed on its own (it is not one of the
    // carried blocks), so the art **it** names comes back from that call and not
    // from `carried.paths`. Without this, the Conductor's
    // `wa.sound.play(worm, "sounds/conductor/shot.wav", 8)` was rewritten to the
    // new folder but never attached or declared, and the export wrote the WAV
    // while the claim's `sounds` list stayed empty (the play is a nil sample).
    const transformedHooks = carriedHookList.map((hook) => {
      const moved = carried.transform(stripNotGeneratedMarkers(hook.text));
      carriedPaths.push(...moved.paths);
      return { ...hook, text: moved.text };
    });
    const transformedRegistrations = carriedRegistrations.map((registration) => {
      const moved = carried.transform(stripNotGeneratedMarkers(registration.text));
      carriedPaths.push(...moved.paths);
      return { ...registration, text: moved.text };
    });
    nextProject.carriedLua = {
      preamble: carried.preamble,
      prologue: carried.prologue,
      hooks: transformedHooks,
      registrations: transformedRegistrations,
      unresolved: carried.unresolved,
      origin: weapon.bundleId,
    };
    // The import summary in the shape the plan asks for: the hooks, the handlers,
    // then the declarations and requires the hidden one closes over. The art
    // counts are added once the files have been read, below, so one line says
    // everything that arrived. `check_carried_lua.ts` pins the shape.
    const requires = carried.preamble.reduce((sum, block) => sum + block.requires.length, 0);
    const helpers = carried.preamble.length + carried.prologue.length - requires;
    const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
    carriedSummary = [
      carriedHookList.length > 0
        ? `${count(carriedHookList.length, 'hook')} (${carriedHookList.map((hook) => hook.key).join(', ')})`
        : '',
      carriedRegistrations.length > 0
        ? `${count(carriedRegistrations.length, 'registration')} (${carriedRegistrations.map((registration) => `wa.on.${registration.event}`).join(', ')})`
        : '',
      helpers > 0 ? count(helpers, 'declaration') : '',
      requires > 0 ? count(requires, 'require') : '',
      carried.refused.length > 0 ? `${count(carried.refused.length, 'refusal')}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    if (carried.renames.length > 0) {
      notes.push(
        `renamed in carried code: ${carried.renames
          .map((rename) => `${rename.from} -> ${rename.to} (the file binds ${rename.from} to ${rename.kept})`)
          .join(', ')}`,
      );
    }
    if (carried.rewrites.length > 0) {
      notes.push(`lockstep: ${[...new Set(carried.rewrites)].join(', ')} in carried code`);
    }
    if (carried.pathRewrites > 0) {
      notes.push(
        `carried code names the bundle's own art: ${carried.pathRewrites} path(s) moved to sprites/${sanitizeModFolder(id)}/ and sounds/${sanitizeModFolder(id)}/`,
      );
    }
    if (carried.floatRandom) {
      notes.push(
        'lockstep: `math.random()` with no arguments has no `wa.random` equivalent (that form is the raw draw), so it is left as it is',
      );
    }
    if (carried.unresolved.length > 0) {
      notes.push(
        `carried code reads ${carried.unresolved.join(', ')}, which the bundle does not declare: those are nils when the hook runs`,
      );
    }
    for (const refused of carried.refused) notes.push(`not carried: ${refused}`);
    notes.push(...carried.notes);
    if (carried.missingModules.length > 0) {
      blocking.push(
        `${carried.missingModules.map((module) => `require("${module}")`).join(', ')} ${carried.missingModules.length === 1 ? 'is' : 'are'} not shipped by the export`,
      );
    }
    // A carried `require` needs its own dependency in `mod.toml`: the export
    // ships our SDK folders, but the engine resolves `wf-lib/effects/*` through
    // `effects.sdk` and `wf-lib/electric/*` through `px.electric`.
    if (carried.dependencies.length > 0) {
      const existing = new Set(nextProject.extraDependencies ?? []);
      const added = carried.dependencies.filter((dependency) => !existing.has(dependency));
      if (added.length > 0) {
        nextProject.extraDependencies = [...(nextProject.extraDependencies ?? []), ...added];
        notes.push(`dependencies: ${added.join(', ')} (a carried require needs it)`);
      }
    }
  }

  // ---- the art the carried code names ------------------------------------
  // A carried `sprite = "sprites/<mod>/blackhole.png"` is only half the story:
  // `wa.draw.quad{ sprite = path }` resolves a pack path through the claim's
  // `sprites` list, the engine slices a declared strip by `frames`, and the zip
  // has to carry the file. All three come from the bundle's own
  // `[sprites."…"]` declaration, so nothing here invents a frame count.
  // A folder reference (`"sounds/buffalo/"`, concatentated with a file name at
  // the point of use) becomes the files it holds: the export writes
  // `sounds/<mod>/…`, so every file of that folder is attached and declared
  // under the export's folder, or the carried play names a sample the zip lacks.
  const expandFolder = (path: { source: string; target: string }): { source: string; target: string }[] => {
    if (!path.source.endsWith('/')) return [path];
    const under = weapon.bundleDir ? `${weapon.bundleDir}/${path.source}` : path.source;
    const found: { source: string; target: string }[] = [];
    for (const file of files) {
      const full = file.path.split(String.fromCharCode(92)).join('/');
      if (!full.startsWith(under)) continue;
      const name = full.slice(under.length);
      if (!name || name.includes('/') || !/\.(png|gif|wav)$/i.test(name)) continue;
      found.push({ source: `${path.source}${name}`, target: `${path.target}${name}` });
    }
    return found;
  };
  const artPaths = [
    ...new Map(
      carriedPaths
        .flatMap(expandFolder)
        .map((path) => [path.target, path] as const),
    ).values(),
  ];
  if (artPaths.length > 0) {
    const art: CarriedLuaArt = { sprites: [], sounds: [] };
    const soundFiles: { path: string; file: File }[] = [];
    for (const { source, target } of artPaths) {
      const isSprite = target.startsWith('sprites/');
      const asset = await readAsset(files, weapon.bundleDir, source);
      if (isSprite) {
        art.sprites.push(target);
        if (!asset) {
          notes.push(`carried code names ${target}, which is not in the bundle: the sprite will not load`);
          continue;
        }
        if (nextProject.customSprites![target]) continue;
        // The declaration is the source bundle's `[sprites."…"]` table, matched
        // by file name: the carried text has already been moved to the export's
        // folder, so the key it came from is the old one.
        const base = target.split('/').pop() ?? target;
        const decl =
          weapon.spriteDecls[source] ??
          Object.entries(weapon.spriteDecls).find(([key]) => key.split('/').pop() === base)?.[1] ??
          {};
        const frames = typeof decl.frames === 'number' ? decl.frames : 1;
        const fps = typeof decl.fps === 'number' ? decl.fps : 15;
        const play = decl.play === 'pingpong' ? 'pingpong' : 'loop';
        nextProject.customSprites![target] = {
          purpose: 'trail',
          name: target.split('/').pop() ?? target,
          path: target,
          file: asset.file,
          previewUrl: asset.preview,
          frames,
          fps,
          play,
        };
        continue;
      }
      art.sounds.push(target);
      // A sound the export already writes under one of the four roles needs no
      // second copy: `customSoundPath` names exactly that file.
      const rolePaths = (['launch', 'explosion', 'interval', 'shot'] as const)
        .map((role) => customSoundPath(nextProject as WeaponProject, role))
        .filter((path): path is string => !!path);
      if (rolePaths.includes(target)) continue;
      if (asset) soundFiles.push({ path: target, file: asset.file });
      else notes.push(`carried code plays ${target}, which is not in the bundle: the sample will not load`);
    }
    if (soundFiles.length > 0) art.soundFiles = soundFiles;
    nextProject.carriedLua = { ...nextProject.carriedLua!, art };
    const artParts = [
      art.sprites.length > 0
        ? `${art.sprites.length} sheet${art.sprites.length === 1 ? '' : 's'}`
        : '',
      art.sounds.length > 0 ? `${art.sounds.length} sound${art.sounds.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    if (artParts.length > 0) {
      carriedSummary = carriedSummary
        ? `${carriedSummary}, ${artParts.join(', ')}`
        : artParts.join(', ');
    }
  }
  if (carriedSummary) notes.push(`carried: ${carriedSummary}`);

  // The bundle's one icon. `mod_icon` names it and it belongs to the bundle, not
  // to a weapon, so a single-weapon import hands it to the pack it creates.
  // A `mod_icon` naming this component's own icon is the fallback, not a bundle
  // icon: the weapon's art already carries it.
  const ownIcon = (weapon.icon || '').trim() === (weapon.bundleModIcon || '').trim();
  const bundleIcon =
    weapon.bundleModIcon && !ownIcon
      ? await readAsset(files, weapon.bundleDir, weapon.bundleModIcon)
      : undefined;
  if (weapon.bundleModIcon && !ownIcon && !bundleIcon) {
    notes.push(`mod_icon ${weapon.bundleModIcon} is declared but not in the bundle`);
  }

  return {
    replaceProject: true,
    project: nextProject,
    notes,
    blocking,
    ...(bundleIcon ? { modIcon: { file: bundleIcon.file, preview: bundleIcon.preview } } : {}),
  };
}

