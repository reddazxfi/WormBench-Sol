import React, { useRef, useState } from 'react';
import { Boxes, Image as ImageIcon, Trash2 } from 'lucide-react';
import type { PackProject } from '../types/weapon';
import { sanitizeModFolder } from '../utils/luaGenerator';
import { renamespaceWeapons } from '../utils/pack';
import { slugId } from '../utils/weaponId';

interface PackSettingsCardProps {
  pack: PackProject;
  onChange: (patch: Partial<PackProject>) => void;
  /** Remove the active weapon. The rail has the same action on a desktop. */
  onRemoveWeapon?: () => void;
}

const inputClass =
  'w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-forge-500 disabled:opacity-60 disabled:cursor-not-allowed';

/**
 * The bundle's own identity, which exists once it holds more than one weapon.
 *
 * `mod.toml` is one file per bundle: its `id` names the folder under
 * `WormBench/Mods/`, its `name` is what the mod loader lists, and `replaces` takes
 * other bundles over. A bundle of one weapon **is** that weapon
 * (`syncPackToSoleWeapon`), so its id, name, author and version are the ones on
 * the Weapon Loadout card above: this card says so instead of showing four more
 * boxes for the same four values.
 */
export const PackSettingsCard: React.FC<PackSettingsCardProps> = ({
  pack,
  onChange,
  onRemoveWeapon,
}) => {
  const many = pack.weapons.length > 1;
  const folder = sanitizeModFolder(pack.id);
  const replaces = (pack.replaces ?? []).join(', ');
  // The text as typed: re-rendering the parsed list on each keystroke swallowed
  // the `,` that starts the next id. The draft shows only while it still parses
  // to the pack's list, so a change from elsewhere replaces it.
  const [replacesDraft, setReplacesDraft] = useState<string | null>(null);
  const parseReplaces = (text: string) =>
    text
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  const replacesText =
    replacesDraft !== null && parseReplaces(replacesDraft).join(',') === (pack.replaces ?? []).join(',')
      ? replacesDraft
      : replaces;
  const packIconRef = useRef<HTMLInputElement>(null);
  // One icon per bundle. The manifest names a single `mod_icon`, so this file is
  // written once into the bundle's own folder, and a bundle that has none is
  // fine: the mod loader draws the name's initials. With no upload the first
  // weapon's icon stands in, which is why the hint says whose icon it is.
  const mainWeapon = pack.weapons[0];
  const fallbackIcon = pack.weapons.find((weapon) => weapon.customIconPreview);
  const iconPreview = pack.iconPreview ?? fallbackIcon?.customIconPreview;
  const iconSource = pack.iconFile
    ? 'Uploaded for this bundle'
    : fallbackIcon
      ? `${fallbackIcon.name || 'A weapon'}'s panel icon`
      : 'None: the mod loader shows initials';
  const uploadPackIcon = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      onChange({ iconFile: file, iconPreview: reader.result as string });
    reader.readAsDataURL(file);
    event.target.value = '';
  };
  const clearPackIcon = () => onChange({ iconFile: undefined, iconPreview: undefined, modIcon: undefined });
  // The bundle id is the author's, and it is the **namespace** its weapons live
  // under, so renaming it renames them with it (`renamespaceWeapons`). It is
  // edited whole: no part of it is fixed.
  const renameBundle = (raw: string) => {
    // A box with nothing nameable in it is not an id: writing the fallback would
    // rename the bundle to "bundle" mid-typing.
    if (!raw.replace(/[^a-zA-Z0-9_.-]/g, '').replace(/[._-]/g, '')) return;
    const next = slugId(raw, 'bundle');
    if (next === pack.id) return;
    const renamed = renamespaceWeapons(pack, pack.id, next);
    onChange({ ...renamed, id: next } as Partial<PackProject>);
  };

  return (
    <section
      aria-label="Bundle Settings"
      className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 bg-stone-50/80 px-4 py-2.5 dark:border-stone-800 dark:bg-stone-950/60">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <h2 className="font-heading text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-100">
            Bundle Settings
          </h2>
          <span className="text-stone-300 dark:text-stone-700" aria-hidden="true">
            ·
          </span>
          <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
            {pack.weapons.length} weapon{pack.weapons.length === 1 ? '' : 's'} · one mod.toml, one profile
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2 py-1 font-mono text-[10px] text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
          <Boxes className="h-3 w-3" aria-hidden="true" />
          WormBench/Mods/{folder}/
        </span>
      </div>

      <div className="space-y-3 p-4">

        {/* The bundle's one icon. */}
        <div className="flex items-end gap-2.5">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-950"
            title={`Bundle icon (mod_icon): ${iconSource}`}
          >
            {iconPreview ? (
              <img
                src={iconPreview}
                alt="Bundle icon"
                className="h-8 w-8 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <span className="font-mono text-[10px] font-semibold uppercase text-stone-400">
                {(pack.name || pack.id || 'wf').slice(0, 4)}
              </span>
            )}
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-stone-600 dark:text-stone-400">
              Bundle icon
            </div>
            <div className="flex items-center gap-1">
              <input
                ref={packIconRef}
                type="file"
                accept="image/png,.png"
                onChange={uploadPackIcon}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => packIconRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border border-sky-300/80 bg-sky-50/75 px-2 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-900/40 whitespace-nowrap shrink-0 cursor-pointer"
                title="A pack has one icon: it is written once, as sprites/<bundle>/icon.png, and named by mod_icon."
              >
                <ImageIcon className="h-3 w-3 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>{pack.iconFile ? 'Replace' : 'Upload PNG'}</span>
              </button>
              {pack.iconFile && (
                <button
                  type="button"
                  onClick={clearPackIcon}
                  className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-forge-600 dark:hover:bg-stone-800 dark:hover:text-forge-400 cursor-pointer"
                  title="Remove the bundle icon: the first weapon's icon is used, or none"
                  aria-label="Remove the bundle icon"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-stone-500 dark:text-stone-400">{iconSource}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Four boxes for the same four values the Weapon Loadout card edits,
              when the bundle holds only that weapon, would be a second way to
              type one thing. The one-weapon rule makes them the weapon's. */}
          {many ? (
            <>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Bundle id
                </span>
                <input
                  className={inputClass}
                  value={pack.id}
                  title="Unique across every installed bundle, and the namespace its weapons live under; it names the folder under WormBench/Mods/."
                  onChange={(event) => renameBundle(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Bundle name
                </span>
                <input
                  className={inputClass}
                  value={pack.name}
                  title="What the mod loader lists, and the default profile file name."
                  onChange={(event) => onChange({ name: event.target.value })}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Author
                </span>
                <input
                  className={inputClass}
                  value={pack.author}
                  onChange={(event) => onChange({ author: event.target.value })}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  Version
                </span>
                <input
                  className={inputClass}
                  value={pack.version}
                  onChange={(event) => onChange({ version: event.target.value })}
                />
              </label>
            </>
          ) : (
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 sm:col-span-2 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-400">
              The bundle id, name, author and version are the weapon&apos;s own while it is
              alone, so they are edited in <strong>Weapon Loadout</strong> above
              {mainWeapon ? ` (${mainWeapon.name}, ${mainWeapon.id})` : ''}. Add a second weapon
              and this bundle gets an identity of its own.
            </p>
          )}

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Profile name
            </span>
            <input
              className={inputClass}
              value={pack.profileName ?? ''}
              placeholder={pack.name}
              title="The one profile file every weapon of this bundle is placed in. Empty uses the bundle name."
              onChange={(event) => onChange({ profileName: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Replaces bundles
            </span>
            <input
              className={inputClass}
              value={replacesText}
              placeholder="px.ports, other.bundle"
              title="Bundle ids this pack takes over, comma separated. Each id is written into `replaces`."
              onChange={(event) => {
                setReplacesDraft(event.target.value);
                onChange({ replaces: parseReplaces(event.target.value) });
              }}
              onBlur={() => setReplacesDraft(null)}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Profile description
            </span>
            <input
              className={inputClass}
              value={pack.description ?? ''}
              placeholder={`${pack.name} test profile.`}
              title="The profile's own description, written to profiles/<name>.toml: it is what the mod loader shows for the profile that places these weapons, not a manifest field."
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </label>
        </div>

        <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
          Every weapon keeps its own component block, its own Lua module and its own art folder, so
          editing one weapon never moves another&apos;s files. Renaming the bundle re-namespaces
          matching weapon ids underneath it while keeping each weapon&apos;s art folder intact. The
          dependencies are the union of what the weapons need, and one profile places all of them.
        </p>

        {onRemoveWeapon && many && (
          <button
            type="button"
            onClick={onRemoveWeapon}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
            title="Remove the selected weapon from this bundle"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Remove selected weapon
          </button>
        )}
      </div>
    </section>
  );
};
