// What a pack is, as data: the weapons in it, and the rules that keep them apart.
//
// The editor holds one `PackProject` and one active index, so every panel still
// takes a single `WeaponProject`. The helpers here are the ones that change the
// set (add, duplicate, remove, reorder) and the identity rules that go with it:
//
//  - **A bundle of one weapon is that weapon.** Its id, name, author and version
//    are the weapon's own, which is what keeps a single-weapon export identical to
//    what it was before packs existed (`exportPackZip` of one == `exportModZip`).
//  - **Ids are allocated once and never derived again.** A weapon that joins a
//    pack keeps the id it has, unless its art folder would collide with another
//    weapon's, in which case it is renamed and its declared art paths move with
//    it. Renaming a weapon in the editor does not move its files.
//  - **A folder is the last id segment** (`sanitizeModFolder`), and every art path
//    is `sprites/<folder>/…`, so two weapons of a pack must differ there even when
//    their ids differ (`wfws.pack.rocket` and `wfws.pack.laser` do).
import { PackProject, WeaponProject } from '../types/weapon';
import { sanitizeModFolder } from './luaGenerator';
import { isUnderNamespace, slugId, weaponIdSuffix } from './weaponId';

/** `Heavy Rocket!` -> `heavy_rocket`, the part an id and a folder take. */
export function slugFromName(name: string | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'weapon';
}

/** The folder a weapon's art lands in: the last segment of its id. */
export function weaponFolder(project: WeaponProject): string {
  return sanitizeModFolder(project.id);
}

/**
 * `desired` if its **folder** is free in this pack, else the same id with the bump
 * inside the folder segment (`rocket_2`, never `rocket.2`, which would be folder
 * `2` and could collide with another weapon's `2`).
 *
 * The folder, not the id, is what has to be unique: every art path is
 * `sprites/<folder>/…`, so two weapons may hold two different ids that still write
 * into one folder. An import reuses this to keep the ids a bundle already
 * declares.
 */
export function adoptWeaponId(pack: PackProject, desired: string): string {
  const base = (desired || '').trim() || `${pack.id}.weapon`;
  const taken = new Set(pack.weapons.map((weapon) => weaponFolder(weapon).toLowerCase()));
  let id = base;
  let attempt = 2;
  while (taken.has(weaponFolder({ id } as WeaponProject).toLowerCase())) {
    id = `${base}_${attempt}`;
    attempt += 1;
  }
  return id;
}

/**
 * Move every weapon that lived under a bundle's old id to its new one.
 *
 * The bundle id is the namespace, so renaming it has to rename the weapons with
 * it: an id like `old.rocket` would otherwise be refused by `validateBundle`
 * (`old.rocket` is not under `new`), and the export would stop working for a
 * reason the author cannot see. Only the prefix changes, so every art path, which
 * is `sprites/<last segment>/`, stays where it is.
 */
export function renamespaceWeapons(pack: PackProject, fromId: string, toId: string): PackProject {
  const from = (fromId || '').trim();
  const to = (toId || '').trim();
  if (!from || !to || from === to) return pack;
  return {
    ...pack,
    weapons: pack.weapons.map((weapon) =>
      weapon.id === from
        ? retargetWeaponArt(
            { ...weapon, id: to },
            sanitizeModFolder(from),
            sanitizeModFolder(to),
          )
        : weapon.id.startsWith(`${from}.`)
          ? { ...weapon, id: `${to}${weapon.id.slice(from.length)}` }
          : weapon,
    ),
  };
}

/** A free id for a weapon called `name` in this pack: `<packId>.<slug>`. */
export function newWeaponId(pack: PackProject, name: string): string {
  return adoptWeaponId(pack, `${pack.id}.${slugFromName(name)}`);
}

/** `Grenade` -> `Grenade 2` when another weapon already has that name. */
export function uniqueWeaponName(pack: PackProject, name: string): string {
  const base = (name || 'Weapon').trim() || 'Weapon';
  const taken = new Set(pack.weapons.map((weapon) => weapon.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const candidate = `${base} ${attempt}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

/**
 * Move the art a weapon **declares by path** from one folder to another.
 *
 * Only five places store a path as text: the hold sheet, the flight sheet, the
 * carried artefacts and the carried WAVs. Everything else is derived from the id
 * when it is written (`packArtPath`, `terrainStampPath`, the role sheets), so it
 * follows the new id by itself. Without this, a duplicate would keep writing its
 * sheets into the original's folder and the two weapons would draw each other's
 * art, because both modules would name the same path.
 */
export function retargetWeaponArt(
  project: WeaponProject,
  fromFolder: string,
  toFolder: string,
): WeaponProject {
  if (!fromFolder || fromFolder === toFolder) return project;
  const fromSprites = `sprites/${fromFolder}/`;
  const toSprites = `sprites/${toFolder}/`;
  const fromSounds = `sounds/${fromFolder}/`;
  const toSounds = `sounds/${toFolder}/`;
  const move = (path: string | undefined): string | undefined => {
    if (typeof path !== 'string') return path;
    if (path.startsWith(fromSprites)) return `${toSprites}${path.slice(fromSprites.length)}`;
    if (path.startsWith(fromSounds)) return `${toSounds}${path.slice(fromSounds.length)}`;
    return path;
  };
  const escapedFrom = fromFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literalPattern = new RegExp(`(["'])(sprites|sounds)/${escapedFrom}/([^"']*)\\1`, 'g');
  const rewriteLuaPaths = (text: string): string =>
    text.replace(literalPattern, (_whole, quote: string, kind: string, rest: string) => `${quote}${kind}/${toFolder}/${rest}${quote}`);

  const hold = project.hold ? { ...project.hold, sheet: move(project.hold.sheet) ?? project.hold.sheet } : project.hold;
  const missileSprite = project.missileSprite
    ? { ...project.missileSprite, sheet: move(project.missileSprite.sheet) ?? project.missileSprite.sheet }
    : project.missileSprite;

  const customSprites: WeaponProject['customSprites'] = {};
  for (const [key, asset] of Object.entries(project.customSprites ?? {})) {
    customSprites[key] = asset ? { ...asset, path: move(asset.path) ?? asset.path } : asset;
  }

  const carriedArt = project.carriedLua?.art;
  const carriedLua = project.carriedLua
    ? {
        ...project.carriedLua,
        preamble: project.carriedLua.preamble.map((block) => ({
          ...block,
          text: rewriteLuaPaths(block.text),
        })),
        prologue: project.carriedLua.prologue.map((block) => ({
          ...block,
          text: rewriteLuaPaths(block.text),
        })),
        hooks: project.carriedLua.hooks?.map((hook) => ({
          ...hook,
          text: rewriteLuaPaths(hook.text),
        })),
        registrations: project.carriedLua.registrations?.map((registration) => ({
          ...registration,
          text: rewriteLuaPaths(registration.text),
        })),
        art: carriedArt
          ? {
              sprites: (carriedArt.sprites ?? []).map((path) => move(path) ?? path),
              sounds: (carriedArt.sounds ?? []).map((path) => move(path) ?? path),
              soundFiles: carriedArt.soundFiles?.map((entry) => ({
                ...entry,
                path: move(entry.path) ?? entry.path,
              })),
            }
          : undefined,
      }
    : project.carriedLua;

  return { ...project, hold, missileSprite, customSprites, carriedLua };
}

/**
 * The one-weapon rule: a bundle with a single weapon takes that weapon's identity,
 * so its export stays `<weapon>.zip` with `<weapon>/mod.toml` in it. From the
 * second weapon on, the bundle has its own id, name, author and version and this
 * does nothing.
 */
export function syncPackToSoleWeapon(pack: PackProject): PackProject {
  if (pack.weapons.length !== 1) return pack;
  const [only] = pack.weapons;
  return {
    ...pack,
    id: only.id,
    name: only.name,
    author: only.author,
    version: only.version,
  };
}

/**
 * A weapon written into a bundle of more than one **lives under the bundle's id**.
 *
 * That is the namespace rule and the whole of it: `wfws.gravnade.windnade` is a
 * weapon of `wfws.gravnade`, `wfws.windnade` is not, and `validateBundle` refuses
 * the export for the second because the installed bundle it came from already
 * claims that id. An import and a hand-typed field both arrive with the source's
 * own id, so the id is folded back to `<bundle id>.<leaf>` on the way in, and the
 * art it declares moves with the folder (`retargetWeaponArt`), exactly as an
 * append's does.
 *
 * Anything **already** under the namespace is untouched, and so is a bundle of one
 * (that bundle *is* its weapon, `syncPackToSoleWeapon`, so the weapon's id is the
 * bundle's and the bundle follows it). The folder is chosen against the weapons
 * that stay, so re-importing over the same slot does not bump it to `_2`.
 */
function foldWeaponIntoBundle(
  pack: PackProject,
  index: number,
  project: WeaponProject,
): WeaponProject {
  if (pack.weapons.length <= 1) return project;
  if (isUnderNamespace(project.id, pack.id)) return project;
  const leaf = slugId(weaponIdSuffix(project.id) || project.name, 'weapon');
  const others: PackProject = {
    ...pack,
    weapons: pack.weapons.filter((_, at) => at !== index),
  };
  const id = adoptWeaponId(others, `${pack.id}.${leaf}`);
  return retargetWeaponArt(
    { ...project, id },
    sanitizeModFolder(project.id),
    sanitizeModFolder(id),
  );
}

/**
 * Write one weapon back, then re-apply the one-weapon rule. An index one past the
 * end **appends**, which is what an import does weapon by weapon (an `map` over the
 * existing rows would have silently dropped them). The id is folded under the
 * bundle's namespace on the way in (`foldWeaponIntoBundle`), so no panel and no
 * import can put a weapon outside it.
 */
export function withWeapon(
  pack: PackProject,
  index: number,
  project: WeaponProject,
): PackProject {
  const entry = foldWeaponIntoBundle(pack, index, project);
  const weapons =
    index >= pack.weapons.length
      ? [...pack.weapons, entry]
      : pack.weapons.map((current, at) => (at === index ? entry : current));
  return syncPackToSoleWeapon({ ...pack, weapons });
}

/** Where the active weapon lands after `index` is removed. */
function indexAfterRemove(length: number, index: number): number {
  return Math.max(0, Math.min(length - 2, index > 0 ? index - 1 : 0));
}

/**
 * Add a weapon to the pack. Its id is allocated here and its id, name and art
 * paths are made unique, so an append can never overwrite a weapon that is
 * already in the bundle.
 */
export function addWeaponToPack(
  pack: PackProject,
  project: WeaponProject,
): { pack: PackProject; index: number } {
  const from = weaponFolder(project);
  const id = newWeaponId(pack, project.name);
  const to = weaponFolder({ id } as WeaponProject);
  const entry: WeaponProject = {
    ...retargetWeaponArt(project, from, to),
    id,
    name: uniqueWeaponName(pack, project.name),
  };
  const weapons = [...pack.weapons, entry];
  return {
    pack: { ...pack, weapons },
    index: weapons.length - 1,
  };
}

/** A copy of one weapon, with its own id, name and art folder. */
export function duplicateWeaponInPack(
  pack: PackProject,
  index: number,
): { pack: PackProject; index: number } {
  const source = pack.weapons[index];
  if (!source) return { pack, index };
  return addWeaponToPack(pack, { ...source, name: `${source.name} copy` });
}

/** Remove one weapon. A pack always keeps at least one, so the last is refused. */
export function removeWeaponFromPack(
  pack: PackProject,
  index: number,
): { pack: PackProject; index: number } {
  if (pack.weapons.length <= 1) return { pack, index };
  const weapons = pack.weapons.filter((_, at) => at !== index);
  return {
    pack: syncPackToSoleWeapon({ ...pack, weapons }),
    index: indexAfterRemove(pack.weapons.length, index),
  };
}

/**
 * Move one weapon up or down the list, which is the order the manifest, the
 * profile and the panel see. The active weapon follows the row, not the index.
 */
export function moveWeaponInPack(
  pack: PackProject,
  index: number,
  delta: -1 | 1,
): { pack: PackProject; index: number } {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= pack.weapons.length) return { pack, index };
  const weapons = [...pack.weapons];
  const [moved] = weapons.splice(index, 1);
  weapons.splice(target, 0, moved);
  return { pack: { ...pack, weapons }, index: target };
}
