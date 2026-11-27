// Reading a whole bundle as a pack: every weapon component in it, through the
// same importer a single weapon uses.
//
// This is P5 of `reqs/pack_export_plan.md`, and it is the other direction of the
// emitter: a bundle the editor writes has to come back as the bundle it was, and
// a bundle someone else wrote has to arrive as a pack the editor can edit and
// export without the original losing its weapons to one another.
//
// Three rules, and the reason for each:
//
//  - **A bundle whose weapons already live under its own id is kept verbatim**, so
//    exporting and re-importing an editor bundle is idempotent
//    (`wfws.swim_suit.javelin` stays that), and so the art folders it declares do
//    not move.
//  - **A bundle that does not is namespaced under a copy of its own id**
//    (`copyNamespace`). Components of `px.ports` are `px.port`,
//    `px.banana_express`, … and those ids are taken by the installed bundle:
//    exporting a second bundle that claims one of them is refused by the engine.
//    `px.ports.import.port` is the same weapon under a namespace the export owns,
//    and it keeps the source author's id instead of pushing it into one of ours.
//  - **The folder is what a bump protects** (`adoptWeaponId`), and a weapon whose
//    id had to change has its declared art moved with it, exactly as a duplicate
//    does.
import type { PackProject, WeaponProject } from '../../types/weapon';
import type { ModBundle, ModFile, ModWeapon } from './scan';
import { importBundleWeapon } from './importWeapon';
import {
  adoptWeaponId,
  retargetWeaponArt,
  syncPackToSoleWeapon,
  weaponFolder,
} from '../pack';
import { stockSlotForPosition } from '../../data/stockWeapons';
import { copyNamespace, isUnderNamespace, slugId } from '../weaponId';
import { readAsset } from './importFeatures';

export interface PackImport {
  pack: PackProject;
  /** One line per weapon, plus anything that changed its id. */
  notes: string[];
  /**
   * What the imported pack cannot export as it stands, each sentence naming the
   * weapon: a carried `require` no bundle ships, a Lua error, an undeclared
   * option. The caller has to show these, because the export refuses them by
   * name and the per-weapon notes are too many to read as a toast.
   */
  warnings: string[];
}

const lastSegment = (id: string): string => {
  const at = (id || '').lastIndexOf('.');
  return at < 0 ? id || '' : id.slice(at + 1);
};

/**
 * The bundle id an imported pack exports as. A bundle whose own weapons live
 * under its id is kept (a re-import of an editor bundle must not rename it); any
 * other bundle gets a copy of its own id, because the original is installed and
 * the engine refuses two bundles that claim one id.
 */
export function packIdFromBundle(bundleId: string, componentIds: string[] = []): string {
  const raw = (bundleId || '').trim() || 'bundle';
  const ours = componentIds.length > 0 && componentIds.every((id) => isUnderNamespace(id, raw));
  return ours ? raw : copyNamespace(raw);
}

/**
 * `mod_icon` often names the **first weapon's** icon, because that is what the
 * manifest falls back to when a bundle declares no icon of its own. Such a path
 * is the weapon's art, already carried by its own import, so taking it as a
 * bundle icon would copy it into the bundle folder and change the very line that
 * named it (a re-export stopped being byte-identical).
 */
export function isWeaponIcon(path: string, weapons: ModWeapon[]): boolean {
  const icon = path.trim();
  if (!icon) return false;
  return weapons.some((weapon) => (weapon.icon || '').trim() === icon);
}

/** The id a component's weapon gets in the imported pack. */
export function weaponIdFromComponent(packId: string, componentId: string): string {
  const raw = (componentId || '').trim();
  if (isUnderNamespace(raw, packId)) return raw;
  return `${packId}.${slugId(lastSegment(raw) || raw)}`;
}

/**
 * Import every weapon of a bundle into one `PackProject`.
 *
 * A component whose record could not be read is left out rather than imported as
 * a blank weapon (the caller passes the ones with a record), because a pack of
 * silently wrong weapons is worse than a pack that says which one it skipped.
 */
export async function importBundlePack(
  bundle: ModBundle,
  weapons: ModWeapon[],
  files: ModFile[],
): Promise<PackImport> {
  const notes: string[] = [];
  const warnings: string[] = [];
  const packId = packIdFromBundle(
    bundle.id,
    weapons.map((weapon) => weapon.componentId),
  );
  const base: PackProject = {
    id: packId,
    name: bundle.name || packId,
    author: bundle.author || 'WormBench Author',
    version: bundle.version || '0.1.0',
    weapons: [],
    // What the source retires. Dropping it would change what installing this
    // bundle does, and keeping it silently is worth one line: an import is a copy
    // of the manifest, and `replaces` is part of it.
    ...(bundle.replaces && bundle.replaces.length > 0 ? { replaces: bundle.replaces } : {}),
  };
  if (packId !== bundle.id) {
    notes.push(`${bundle.id}: imported as ${packId}, so the export does not claim the installed bundle's id`);
  }
  if (bundle.replaces && bundle.replaces.length > 0) {
    notes.push(`replaces ${bundle.replaces.join(', ')}: installing this bundle retires them`);
  }

  // The weapons are collected and the one-weapon rule applied **once** at the
  // end: applied per weapon it would rename the bundle to the first weapon's id
  // and the pack would lose the id the manifest declared.
  const entries: WeaponProject[] = [];
  for (const weapon of weapons) {
    const result = await importBundleWeapon(weapon, files);
    const project = result.project as WeaponProject;
    const wanted = weaponIdFromComponent(packId, weapon.componentId || project.id || project.name);
    const id = adoptWeaponId({ ...base, weapons: entries }, wanted);
    // The panel slot the component replaces, when the position names one: that is
    // what `default_position` is, and it is how a pack keeps its weapons where the
    // author put them instead of all landing on the donor's slot.
    const slot = stockSlotForPosition(weapon.row, weapon.column);
    let entry: WeaponProject = {
      ...project,
      id,
      slot: slot ?? project.slot,
      // A stock icon name round-trips; a path is art, which the single-weapon
      // importer already carries.
      panel_icon: weapon.icon && !weapon.icon.includes('/') ? weapon.icon : project.panel_icon,
    };
    if (id !== wanted) {
      notes.push(
        `${weapon.componentId}: imported as ${id}, because ${weaponFolder({ id: wanted } as WeaponProject)} is already used in this bundle`,
      );
    }
    // The weapon's id changed, so the folder every art path it declares lives in
    // changed with it. The paths currently point at the **import's own** folder
    // (`project.id`), not at `wanted`'s: a bundle that names its component with
    // its own id (`wfws.vortex` on the bundle `wfws.vortex`) has `wanted =
    // wfws.vortex` while the single-weapon import chose
    // `wfws.vortex.vortex_grenade`, and moving from `wanted` wrote carried art
    // for a folder nothing ever occupied (the vortex's `explosion.wav` and
    // hole sheet came out at `sounds/vortex_grenade/` while the WAV role wrote
    // `sounds/vortex/`).
    if (id !== project.id) {
      entry = retargetWeaponArt(
        entry,
        weaponFolder({ id: project.id } as WeaponProject),
        weaponFolder(entry),
      );
    }
    entries.push(entry);
    // What the export will refuse goes in its own list, because the per-weapon
    // line below is a count and a bare count cannot be acted on.
    for (const blocker of result.blocking) {
      warnings.push(`${weapon.name || weapon.componentId}: ${blocker}`);
    }
    // One line per weapon: an import summary is a list of what arrived, not a
    // transcript of every note the single-weapon importer made.
    notes.push(
      `${weapon.name || weapon.componentId}: ${result.notes.length > 0 ? `${result.notes.length} note(s)` : 'read clean'}`,
    );
  }
  const pack = syncPackToSoleWeapon({ ...base, weapons: entries });

  // The bundle's own icon, one per bundle. `mod_icon` names it in the manifest
  // and it lives in that bundle's folder, so it belongs to the pack and not to
  // any one weapon: importing without it lost the picture the mod loader shows.
  const modIconAsset =
    bundle.modIcon && !isWeaponIcon(bundle.modIcon, weapons)
      ? await readAsset(files, bundle.dir, bundle.modIcon)
      : undefined;
  if (!modIconAsset && bundle.modIcon && !isWeaponIcon(bundle.modIcon, weapons)) {
    notes.push(`mod_icon ${bundle.modIcon} is declared but not in the bundle`);
  }

  // The bundle's own profile file name, when it has exactly one: a re-export
  // should not rename the profile the author ships.
  const profileFiles = (bundle.files ?? []).filter((path) =>
    /(^|\/)profiles\/[^/]+\.toml$/i.test(path),
  );
  const profileName =
    profileFiles.length === 1
      ? (profileFiles[0].split('/').pop() || '').replace(/\.toml$/i, '')
      : undefined;

  return {
    pack: {
      ...pack,
      profileName,
      ...(modIconAsset
        ? { iconFile: modIconAsset.file, iconPreview: modIconAsset.preview }
        : {}),
    },
    notes,
    warnings,
  };
}
