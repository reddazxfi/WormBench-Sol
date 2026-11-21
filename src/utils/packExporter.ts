// The bundle emitter: what one weapon contributes, and what a whole pack is.
//
// Nothing here imports Vite's `?raw` data, so the emitter can be exercised from a
// plain script (`tools/check_pack_roundtrip.ts`). The two library bundles an
// export ships are passed in as text (`PackLibraries`); `modExporter.ts` is the
// app-side wrapper that supplies the versions from `spec/` and the `fetch` an
// export needs for the effects SDK's sheets.
import { PackProject, WeaponProject } from '../types/weapon';
import {
  airstrikeCasingSheetPath,
  airstrikePartSheetPath,
  airstrikePlaneSheetPath,
  airstrikeSoundPath,
  airstrikeStrafeSheetPath,
  roamSheetPath,
  roamSheetsOwnFlight,
  generateLuaCode,
  generatePackProfile,
  generatePackToml,
  singleWeaponPack,
  availableRequiresForCheck,
  bitFlightSheetPath,
  behaviorStateSheetPath,
  customSoundPath,
  meleeSoundPath,
  extraHandSheetPath,
  flashSheetPath,
  holdNeedsAimLayer,
  holdSheetPath,
  missileFlightSheetPath,
  packArtPath,
  packIconBundlePath,
  silentHoldSheetPath,
  wfwsRoleFlags,
  PACK_ART_SLOTS,
  sanitizeModFolder,
  terrainStampPath,
  wepBundlePath,
  wormSpriteEntries,
} from './luaGenerator';
import { supportsTerrainStamp } from '../data/terrainStamp';
import { meleeStrikes } from '../data/melee';
import { airstrikeActive, mergeAirstrikeConfig } from '../data/airstrike';
import {
  bitBuilderMode,
  primaryBuilderOn,
  resolveBehaviorStates,
} from '../data/spriteBuilder';
import {
  applySheetAliases,
  collapseSpriteSections,
  compactSpriteLists,
  dedupeSheets,
} from './sheetDedupe';
import { checkLua } from './luaCheck';
import { ID_MAX, isUnderNamespace } from './weaponId';
import {
  createDefaultHoldSheet,
  createDefaultMissileSheet,
  createSilentSheet,
} from './defaultArt';

/**
 * A bundle-relative path with every `.`/`..`/empty segment dropped and `/` as the
 * separator. A path that reaches the ZIP is data (an import, `customSprites`), so
 * `../../x.png` must not become an entry pointing outside the mod folder; the
 * engine refuses `..` at load too (`inside_pack`), so normalising here can only
 * agree with it. Returns null when nothing usable is left.
 */
export function safeBundlePath(path: string): string | null {
  const segments = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  return segments.length > 0 ? segments.join('/') : null;
}

/** Bytes or text the ZIP can take. */
export type BundleFileContent = string | Uint8Array | File | Blob;

/**
 * One weapon's contribution to a bundle: its Lua module, the files written as
 * they are (the `.wep`, the icon, the WAVs), and the sheets that go through
 * `dedupeSheets`. Paths are bundle-relative **without** the bundle folder: the
 * emitter prefixes it, so a weapon's paths do not have to know where the bundle
 * sits.
 */
export interface WeaponBundlePart {
  lua: string;
  plain: { path: string; source: BundleFileContent }[];
  sheets: { path: string; source: File | Blob }[];
}

/**
 * What one weapon puts in a bundle. Every path is derived from the weapon's own
 * id (`sanitizeModFolder` takes the segment after the last dot), so two weapons in
 * one pack never collide and neither needs to know the pack's folder.
 */
export async function weaponBundlePart(project: WeaponProject): Promise<WeaponBundlePart> {
  const modFolder = sanitizeModFolder(project.id);
  const plain: WeaponBundlePart['plain'] = [];
  const sheets: WeaponBundlePart['sheets'] = [];
  const addSheet = (path: string, source: File | Blob | null | undefined) => {
    if (source) sheets.push({ path, source });
  };

  // The original Project X record, when the weapon is declared with `wep`
  // instead of `copy_from`. The engine reads it relative to the bundle root.
  const wepPath = wepBundlePath(project);
  if (wepPath && project.wepFile) {
    plain.push({ path: wepPath, source: project.wepFile });
  }

  // Custom Icon
  if (project.customIconFile) {
    plain.push({ path: `sprites/${modFolder}/icon.png`, source: project.customIconFile });
  }

  // Hold Art Sheet. The generated Lua always declares hold.sheet, so an
  // enabled hold without an upload ships the default Bazooka/Grenade art
  // instead of a path to a missing file (which fails at load).
  if (project.hold && project.hold.enabled) {
    const holdBlob = project.hold.sheetFile
      ? project.hold.sheetFile
      : await createDefaultHoldSheet(project, project.hold.frames);
    addSheet(holdSheetPath(project), holdBlob);
    // The optional firing-state sprite. Only declared in the Lua when a file
    // exists, so nothing dangles when it is off.
    if (project.hold.flashFile) {
      addSheet(flashSheetPath(project), project.hold.flashFile);
    }
    // The second hand's own art. Without an upload the layer draws the first
    // hand's sheet, so there is nothing to write.
    const hand2 = extraHandSheetPath(project);
    if (hand2 && project.hold.extraHand?.file) {
      addSheet(hand2, project.hold.extraHand.file);
    }
    // The aiming manager's mute: a 1x1 transparent sheet the claim loads as
    // `hold.sheets[1]`, which the quad layer switches to while it draws the aim
    // poses itself. The generated Lua names it, so it always has to exist.
    if (holdNeedsAimLayer(project)) {
      addSheet(silentHoldSheetPath(project), await createSilentSheet());
    }
  }

  // Direct worm pose sheets (`worm_sprites = { weaponlnk = ... }`)
  const seenWormPaths = new Set<string>();
  for (const entry of wormSpriteEntries(project)) {
    if (seenWormPaths.has(entry.path) || !entry.asset.file) continue;
    seenWormPaths.add(entry.path);
    addSheet(entry.path, entry.asset.file);
  }

  // Missile/Projectile Sprite Sheet (custom mode always declares the sheet).
  if (primaryBuilderOn(project)) {
    const missileBlob = project.missileSprite.sheetFile
      ? project.missileSprite.sheetFile
      : await createDefaultMissileSheet(
          project,
          project.missileSprite.anim || 'rotation',
          project.missileSprite.frames
        );
    addSheet(missileFlightSheetPath(project), missileBlob);
  }

  // WFWS builder roles. A builder row without an upload ships the same default
  // art as the primary, so a declared path never points at a missing file.
  if (primaryBuilderOn(project)) {
    if (bitBuilderMode(project) === 'builder') {
      const bitBlob = project.bitFlight.sheetFile
        ? project.bitFlight.sheetFile
        : await createDefaultMissileSheet(
            project,
            project.bitFlight.anim || 'rotation',
            project.bitFlight.frames
          );
      addSheet(bitFlightSheetPath(project), bitBlob);
    }
    // Timed homing art (the builder's `homing` / `bits.homing` sheets).
    const flags = wfwsRoleFlags(project);
    for (const [owned, key] of [
      [flags.homing, 'homing'] as const,
      [flags.bitHoming, 'homing_bit'] as const,
      [flags.roam, 'roam'] as const,
    ]) {
      if (!owned) continue;
      const role = project.behaviorArt?.[key];
      const blob = role?.sheetFile
        ? role.sheetFile
        : await createDefaultMissileSheet(project, role?.anim || 'rotation', role?.frames ?? 1);
      addSheet(behaviorStateSheetPath(project, key), blob);
    }
    for (const state of resolveBehaviorStates(project)) {
      if (state.art.mode !== 'builder') continue;
      const stateBlob = state.art.sheetFile
        ? state.art.sheetFile
        : await createDefaultMissileSheet(
            project,
            state.art.anim || 'rotation',
            state.art.frames
          );
      addSheet(behaviorStateSheetPath(project, state.def.key), stateBlob);
    }
  }

  // A roaming animal's two flying sheets (`sheep_sprites`). The engine installs
  // exactly two, so nothing is written unless both are uploaded. A builder
  // sheet owns the flying state instead, and then neither is referenced.
  if (roamSheetsOwnFlight(project)) {
    const roam = [
      ['flight1', project.roamSheets?.flight1?.file],
      ['flight2', project.roamSheets?.flight2?.file],
    ] as const;
    for (const [which, file] of roam) {
      if (file) addSheet(roamSheetPath(project, which), file);
    }
  }

  // Uploaded record art (trails, cluster bit sheets). The Lua and mod.toml
  // point at this exact path, so the file is always written when it is declared.
  for (const slot of PACK_ART_SLOTS) {
    const asset = project.packArt?.[slot];
    const path = packArtPath(project, slot);
    if (asset?.file && path) {
      addSheet(path, asset.file);
    }
  }

  // The terrain stamp's baked 32-frame strip. `terrainStampPath` returns null
  // unless the card is on with a sheet, so the declaration and the file are
  // written from the same test and a declared path always exists.
  const stampPath = supportsTerrainStamp(project) ? terrainStampPath(project) : null;
  if (stampPath && project.terrainStamp?.sheet?.file) {
    addSheet(stampPath, project.terrainStamp.sheet.file);
  }

  // Custom WAVs the claim plays by path. The Lua's `sounds` list and the file
  // written here are one contract: a declared path must exist at load.
  for (const role of ['launch', 'explosion', 'interval', 'shot'] as const) {
    const path = customSoundPath(project, role);
    const asset =
      role === 'launch'
        ? project.customSounds?.launch
        : role === 'explosion'
          ? project.customSounds?.explosion
          : role === 'interval'
            ? project.customSounds?.interval
            : project.customSounds?.shot;
    if (path && asset?.file) {
      plain.push({ path, source: asset.file });
    }
  }

  // The melee strike's own WAVs, played by the swing (`hit_wav` / `miss_wav`).
  for (const role of ['hit', 'miss'] as const) {
    const path = meleeSoundPath(project, role);
    const sound = role === 'hit' ? project.melee?.hitSound?.file : project.melee?.missSound?.file;
    if (path && sound?.file) {
      plain.push({ path, source: sound.file });
    }
  }
  // A combo strike that names its own sample: one file per strike, sorted by frame
  // so paths match `meleeStrikes` order in `luaGenerator.ts`.
  if (project.melee?.enabled) {
    const sortedStrikes = meleeStrikes(project.melee);
    if (sortedStrikes.length > 1) {
      for (const [index, strike] of sortedStrikes.entries()) {
        const path = meleeSoundPath(project, 'hit', index);
        if (path && strike.sound?.file?.file) plain.push({ path, source: strike.sound.file.file });
      }
    }
  }

  // Airstrike takeover custom sheets and WAVs.
  if (airstrikeActive(project)) {
    const air = mergeAirstrikeConfig(project.airstrike);
    const planePath = airstrikePlaneSheetPath(project);
    if (planePath && air.plane.sheet?.file) addSheet(planePath, air.plane.sheet.file);
    air.plane.parts.forEach((part, idx) => {
      const partPath = airstrikePartSheetPath(project, part, idx);
      if (partPath && part.sheet?.file) addSheet(partPath, part.sheet.file);
    });
    const strafePath = airstrikeStrafeSheetPath(project);
    if (strafePath && air.strafe.artSheet?.file) addSheet(strafePath, air.strafe.artSheet.file);
    const casingPath = airstrikeCasingSheetPath(project);
    if (casingPath && air.strafe.casingSheet?.file) {
      addSheet(casingPath, air.strafe.casingSheet.file);
    }
    for (const role of ['enter', 'loop', 'exit', 'release', 'boom'] as const) {
      const wavPath = airstrikeSoundPath(project, role);
      const spec =
        role === 'enter'
          ? air.plane.soundEnter
          : role === 'loop'
            ? air.plane.soundLoop
            : role === 'exit'
              ? air.plane.soundExit
              : role === 'boom'
                ? air.plane.boomSound
                : air.release.sound;
      if (wavPath && spec?.file?.file) plain.push({ path: wavPath, source: spec.file.file });
    }
  }

  // WAVs a carried block plays by path (M6). The four roles above are the
  // editor's own; a bundle's sample that is neither is written where its code
  // names it, because the claim's `sounds` list and this file are one contract.
  for (const carriedSound of project.carriedLua?.art?.soundFiles ?? []) {
    const safe = safeBundlePath(carriedSound.path);
    if (safe && carriedSound.file) plain.push({ path: safe, source: carriedSound.file });
  }

  // Any other custom sprite assets
  for (const cs of Object.values(project.customSprites ?? {})) {
    // `customSprites` is free-form data, so its path is the one place a `..`
    // could reach a ZIP entry. Normalise it, and skip an entry that had nothing
    // usable left rather than writing a file nothing can name.
    const safe = safeBundlePath(cs.path);
    if (cs.file && safe) addSheet(safe, cs.file);
  }

  return { lua: generateLuaCode(project), plain, sheets };
}

/** Text stays text; a `File`/`Blob` is read once. */
async function fileBytes(content: BundleFileContent): Promise<string | Uint8Array> {
  if (typeof content === 'string' || content instanceof Uint8Array) return content;
  return new Uint8Array(await content.arrayBuffer());
}


/** The library bundle every export ships (`wf-lib/wfws_sdk/`). */
export interface WfwsLibraries {
  modToml: string;
  spriteBuilderLua: string;
  airstrikeLua?: string;
  firingLua?: string;
}

/** A library bundle an export ships when a weapon requires its modules. */
export interface PackLibrary {
  modToml: string;
  files: { path: string; text: string }[];
  /** The sheets its manifest declares, fetched as bytes at export time. */
  sheets: { path: string; url: string }[];
}

/** Whatever an export needs from outside: the libraries, and a way to fetch. */
export interface PackLibraries {
  wfws: WfwsLibraries;
  effects?: PackLibrary;
}

/** Does the generated weapon require a module from the effects library? */
function needsEffectsSdk(luaCode: string): boolean {
  return luaCode.includes('wf-lib/effects/');
}

/**
 * Every file a bundle is made of, keyed by the path inside the ZIP.
 *
 * **This is the one emitter.** A single-weapon export is `emitPackFiles` of a pack
 * of one (`singleWeaponPack`), so the pack path cannot drift from what an export
 * writes: the manifest and the profile are the same functions either way, and
 * `tools/check_pack_roundtrip.ts` compares them file for file.
 *
 * The libraries are arguments rather than imports so this module stays free of
 * Vite's `?raw`; `modExporter.ts` supplies the versions from `spec/` and the
 * `fetch` the effects SDK's sheets need.
 *
 * The order is the layout the engine expects: the bundle folder, one module per
 * component under `weapons/`, the shared `mod.toml` and one profile, then the
 * library bundles beside it under `wf-lib/`.
 */
export async function emitPackFiles(
  pack: PackProject,
  libraries: PackLibraries,
  fetchBytes: (url: string) => Promise<Uint8Array | null> = async () => null,
): Promise<Map<string, string | Uint8Array>> {
  const packFolder = sanitizeModFolder(pack.id);
  const profileName = (pack.profileName || pack.name || packFolder).replace(/[\\/:*?"<>|]/g, '_');
  const files = new Map<string, string | Uint8Array>();
  const put = async (path: string, content: BundleFileContent) => {
    const safe = safeBundlePath(path);
    if (!safe) return;
    files.set(safe, await fileBytes(content));
  };

  // A pack of more than one weapon names each weapon's `weps/` folder: one
  // bundle has one `weps/`, and two records both called `weapon.wep` would
  // collapse to a single file. Everything else is already per weapon, because the
  // art paths carry the weapon's own slug (`sprites/<slug>/`), so a pack of one
  // is written exactly as it was before packs existed.
  const weapons =
    pack.weapons.length > 1
      ? pack.weapons.map((project) => ({ ...project, packSlug: sanitizeModFolder(project.id) }))
      : pack.weapons;
  const emitted: PackProject = { ...pack, weapons };

  const parts: WeaponBundlePart[] = [];
  for (const project of emitted.weapons) parts.push(await weaponBundlePart(project));

  const modToml = generatePackToml(emitted);
  const profileToml = generatePackProfile(emitted);

  // One file per picture, over the **whole pack**: four weapons left on the
  // fallback art are one sheet, not four, and the bytes have to match before the
  // alias may rewrite a path. `modToml` is the combined manifest, so the frame
  // count a declaration asks for is the one compared.
  const sheets = parts.flatMap((part) => part.sheets);
  const loaded = await Promise.all(
    sheets.map(async (sheet) => ({
      path: sheet.path,
      bytes: new Uint8Array(await sheet.source.arrayBuffer()),
    })),
  );
  const deduped = dedupeSheets(loaded, modToml);
  const alias = deduped.alias;
  const withAliases = (lua: string) =>
    alias.size > 0 ? compactSpriteLists(applySheetAliases(lua, alias)) : lua;

  // The bundle's own icon, one per bundle: `mod_icon` names a single file, so it
  // lives in the bundle's folder rather than in any weapon's. Written before the
  // manifest is validated, so a declared `mod_icon` always has its file.
  const bundleIconPath = packIconBundlePath(pack);
  if (pack.iconFile && bundleIconPath) {
    await put(`${packFolder}/${bundleIconPath}`, pack.iconFile);
  }

  for (const part of parts) {
    for (const entry of part.plain) await put(`${packFolder}/${entry.path}`, entry.source);
  }
  for (const file of deduped.files) await put(`${packFolder}/${file.path}`, file.bytes);

  await put(
    `${packFolder}/mod.toml`,
    alias.size > 0 ? collapseSpriteSections(applySheetAliases(modToml, alias)) : modToml,
  );
  for (let index = 0; index < emitted.weapons.length; index += 1) {
    const project = emitted.weapons[index];
    await put(
      `${packFolder}/weapons/${sanitizeModFolder(project.id)}.lua`,
      withAliases(parts[index].lua),
    );
  }
  await put(`${packFolder}/profiles/${profileName}.toml`, profileToml);

  // The wfws.sdk library travels with every export, so the weapon's
  // `dependencies = ["wfws.sdk"]` resolves locally without an online install.
  // Library bundles live under `Mods/wf-lib/` next to `wf.sdk` and `effects.sdk`,
  // so the folder goes there and the ZIP unpacks straight into `Mods/`.
  await put('wf-lib/wfws_sdk/mod.toml', libraries.wfws.modToml);
  await put('wf-lib/wfws_sdk/lib/wfws_sprite_builder.lua', libraries.wfws.spriteBuilderLua);
  if (libraries.wfws.airstrikeLua) {
    await put('wf-lib/wfws_sdk/lib/wfws_airstrike.lua', libraries.wfws.airstrikeLua);
  }
  if (libraries.wfws.firingLua) {
    await put('wf-lib/wfws_sdk/lib/wfws_firing.lua', libraries.wfws.firingLua);
  }

  // The effects SDK travels the same way when **any** weapon of the pack requires
  // it. A weapon whose ribbon trail, burst or emitter needs
  // `wf-lib/effects/...` used to depend on whatever copy the player happened to
  // have: the emitter needs 0.4.3, and an older library either threw on a boolean
  // override, silently dropped the ring, the reach direction and the shared
  // colour, or painted nothing at all for a bundle's second weapon (an effect's
  // draw callback is keyed by the component that installed the library). The
  // folder is the catalogue's own, so unpacking updates an installed
  // copy in place instead of leaving a second bundle with the same id.
  const effects = libraries.effects;
  if (effects && parts.some((part) => needsEffectsSdk(withAliases(part.lua)))) {
    await put('wf-lib/effects_sdk/mod.toml', effects.modToml);
    for (const file of effects.files) await put(file.path, file.text);
    for (const sheet of effects.sheets) {
      // A declared sprite without its file fails the install, so the sheets go
      // with the manifest that names them. They are the SDK's own art, fetched
      // from `spec/` rather than copied into `public/`.
      const bytes = await fetchBytes(sheet.url);
      if (bytes) await put(sheet.path, bytes);
    }
  }

  // Last: the invariants that decide whether the bundle loads, so a broken pack
  // is refused here with the path named rather than in the loader.
  validateBundle(files, emitted, String(files.get(`${packFolder}/mod.toml`) ?? modToml), packFolder);
  return files;
}

/**
 * The invariants that decide whether the bundle loads at all, checked before a
 * byte leaves the editor (`P3` of `reqs/pack_export_plan.md`). The engine refuses
 * the **whole** bundle for one bad component, so a named error here is the
 * difference between "this export is broken" and "one of these N weapons broke it,
 * and it is this one".
 *
 * Two halves:
 *
 *  - **Structure**: ids unique and namespaced under the bundle's own id (which is
 *    what keeps them off an installed bundle: that bundle's id is unique, so its
 *    namespace is taken), every `entry` a file in the bundle, every declared
 *    `[sprites."…"]` a file too, and
 *    no path declared twice (a repeated table is not a merge, it is a TOML error,
 *    and the engine then loses the declaration and `wa.on.draw` fails).
 *  - **Code**: every weapon's generated Lua through `checkLua`. Only `error`
 *    findings refuse the export, because only those mean the file raises at load:
 *    `lockstep-rng` (the sandbox nils `math.random`), `undeclared-require`,
 *    `module-wa`, `lua-ast`, `lua-nul`, `lua-size`. A warning or an advisory is
 *    the author's call and stays a toast, the way it always was.
 */
export function validateBundle(
  files: Map<string, string | Uint8Array>,
  pack: PackProject,
  modToml: string,
  folder: string,
): void {
  const problems: string[] = [];
  const present = (path: string) => files.has(`${folder}/${safeBundlePath(path) ?? path}`);
  const seen = new Set<string>();
  const seenFolders = new Map<string, string>();
  for (const project of pack.weapons) {
    if (seen.has(project.id)) problems.push(`${project.id} is declared twice`);
    seen.add(project.id);
    if (project.id.length > ID_MAX) {
      problems.push(`${project.id} exceeds ${ID_MAX} characters`);
    }
    const weaponDir = sanitizeModFolder(project.id).toLowerCase();
    const existingOwner = seenFolders.get(weaponDir);
    if (existingOwner && existingOwner !== project.id) {
      problems.push(
        `${project.id} shares output folder \`${weaponDir}\` with ${existingOwner}`,
      );
    } else {
      seenFolders.set(weaponDir, project.id);
    }
    // The bundle id is the namespace: an id under it cannot collide with an
    // installed bundle, because that bundle's own id is unique and this one is
    // different. Nothing here tests for a fixed prefix, because a prefix is not
    // what the engine checks; `isUnderNamespace` is what keeps `px.rocket` out of
    // a bundle called `lucia.arsenal`.
    if (!isUnderNamespace(project.id, pack.id)) {
      problems.push(
        `${project.id || '(no id)'} is not under the bundle's id (${pack.id}), so an installed bundle could already claim it`,
      );
    }
  }
  for (const match of modToml.matchAll(/entry = "([^"]+)"/g)) {
    const path = match[1];
    if (!present(path)) problems.push(`\`${path}\` is not in the bundle`);
  }
  const modIconMatch = /^mod_icon = "([^"]+)"/m.exec(modToml);
  if (modIconMatch && !present(modIconMatch[1])) {
    problems.push(`declared mod_icon \`${modIconMatch[1]}\` is not in the bundle`);
  }
  for (const match of modToml.matchAll(/^icon = "([^"]+)"/gm)) {
    const path = match[1];
    if (path.includes('/') && !present(path)) {
      problems.push(`declared icon \`${path}\` is not in the bundle`);
    }
  }
  const declared = new Map<string, number>();
  for (const match of modToml.matchAll(/\[sprites\."([^"]+)"\]/g)) {
    const path = match[1];
    if (!present(path)) problems.push(`declared sheet \`${path}\` is not in the bundle`);
    declared.set(path, (declared.get(path) ?? 0) + 1);
  }
  for (const [path, count] of declared) {
    if (count > 1) problems.push(`\`${path}\` is declared ${count} times`);
  }

  const depsMatch = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(modToml);
  const manifestDeps = depsMatch
    ? [...depsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [];
  const prefix = `${folder}/`;
  const localLuaModules: string[] = [];
  for (const filePath of files.keys()) {
    if (filePath.startsWith(prefix) && filePath.endsWith('.lua')) {
      localLuaModules.push(filePath.slice(prefix.length, -4));
    }
  }

  // The code half: read each weapon's module out of the bundle it is about to be
  // written into, so what is checked is what the engine will run.
  for (const project of pack.weapons) {
    const path = `${folder}/weapons/${sanitizeModFolder(project.id)}.lua`;
    const source = files.get(path);
    if (typeof source !== 'string') {
      problems.push(`\`${path}\` was not generated`);
      continue;
    }
    const wepMatch = /\bwep\s*=\s*"([^"]+\.wep)"/i.exec(source);
    if (wepMatch && !present(wepMatch[1])) {
      problems.push(`${project.name || project.id}: \`${wepMatch[1]}\` is not in the bundle`);
    }
    const soundsMatch = /\bsounds\s*=\s*\{([^}]*)\}/.exec(source);
    if (soundsMatch) {
      for (const s of soundsMatch[1].matchAll(/"([^"]+)"/g)) {
        const wav = s[1];
        if (wav.startsWith('soundbank/')) continue;
        if (!present(wav)) {
          problems.push(`${project.name || project.id}: declared sound \`${wav}\` is not in the bundle`);
        }
      }
    }
    const spritesMatch = /\bsprites\s*=\s*\{([^}]*)\}/.exec(source);
    if (spritesMatch) {
      for (const s of spritesMatch[1].matchAll(/(["'])([^"']+)\1/g)) {
        const spritePath = s[2];
        if (!spritePath.includes('/') || spritePath.startsWith('wf-lib/')) continue;
        if (!present(spritePath)) {
          problems.push(`${project.name || project.id}: declared sprite \`${spritePath}\` is not in the bundle`);
        }
      }
    }
    if (source.includes('air.strike(') && !source.includes('wf-lib/wfws_airstrike')) {
      problems.push(
        `${project.name || project.id}: calls \`air.strike\` without requiring \`wf-lib/wfws_airstrike\``,
      );
    }
    if (
      /\bfiring\.(?:launch|actor|sequence|homing|fuse)\b/.test(source) &&
      !source.includes('wf-lib/wfws_firing')
    ) {
      problems.push(
        `${project.name || project.id}: calls \`firing.*\` without requiring \`wf-lib/wfws_firing\``,
      );
    }
    const availableRequires = availableRequiresForCheck(source, manifestDeps, localLuaModules);
    const blocking = checkLua(source, { mode: 'module', availableRequires }).filter(
      (finding) => finding.severity === 'error',
    );
    if (blocking.length > 0) {
      const lines = [...new Set(blocking.map((finding) => finding.line))].join(', ');
      const rules = [...new Set(blocking.map((finding) => finding.rule))].join(', ');
      problems.push(
        `${project.name || project.id}: ${blocking.length} blocking finding(s) at line ${lines} (${rules})`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`this bundle would not load: ${problems.join('; ')}`);
  }
}
