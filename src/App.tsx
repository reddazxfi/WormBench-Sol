import React, { useState, useEffect } from 'react';
import { PackProject, WeaponProject } from './types/weapon';
import { Sidebar, MobileBar } from './components/Sidebar';
import { TooltipTap } from './components/TooltipTap';
import { WeaponSettings } from './components/WeaponSettings';
import { RecordEditor } from './components/RecordEditor';
import { HoldPreview } from './components/HoldPreview';
import { EffectsWorkspace } from './components/EffectsWorkspace';
import { WepImportModal } from './components/WepImportModal';
import { ModBrowserModal } from './components/ModBrowserModal';
import { LuaPreviewModal } from './components/LuaPreviewModal';
import { BundleDependencies } from './components/BundleDependencies';
import { CarriedLuaPanel } from './components/CarriedLuaPanel';
import { exportPackZip, downloadBlob } from './utils/modExporter';
import { DEFAULT_ID_NAMESPACE } from './utils/weaponId';
import { generateLuaCode, sanitizeModFolder } from './utils/luaGenerator';
import {
  addWeaponToPack,
  duplicateWeaponInPack,
  moveWeaponInPack,
  removeWeaponFromPack,
  syncPackToSoleWeapon,
  withWeapon,
} from './utils/pack';
import { PackRail, WeaponSwitcher } from './components/PackRail';
import { PackSettingsCard } from './components/PackSettingsCard';
import { checkLua } from './utils/luaCheck';
import { rebaseToDonor } from './utils/donorRebase';
import { DEFAULT_EXPLOSION_EFFECT } from './data/explosionPresets';
import { DEFAULT_AIM_CLIP } from './data/aimClip';
import { DEFAULT_MELEE } from './data/melee';
import { stockDonor, stockDonorBaseline } from './data/stockDonors';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from './data/defaults';
import { DEFAULT_CUSTOM_SOUNDS } from './data/soundPresets';
import { DEFAULT_TERRAIN_STAMP } from './data/terrainStamp';
import { DEFAULT_ROLE_ART } from './data/spriteBuilder';
import { bitActionOf, visibleRecordTabs, type RecordTabId } from './data/recordTabs';
import { CheckCircle2 } from 'lucide-react';

/**
 * A fresh project is WA's own Grenade.
 *
 * The record is the decoded stock donor (`stockDonors.json`), and the donor is
 * also the diff baseline: the panels show the values the engine really uses,
 * and an untouched export writes `copy_from = "stock.grenade"` plus nothing
 * else. Everything outside the record (hold art, the sprite builder, effects)
 * starts switched off.
 */
const INITIAL_PROJECT: WeaponProject = {
  ...(stockDonor('grenade') as Partial<WeaponProject>),
  donorBaseline: stockDonorBaseline('grenade'),
  // `parseWepBinary` always fills these for a missile; the cast above keeps
  // TypeScript from narrowing them to `undefined`.
  body: { ...DEFAULT_BODY, ...(stockDonor('grenade')?.body ?? {}) },
  action: stockDonor('grenade')?.action ?? 'bounce',
  burst: stockDonor('grenade')?.burst ?? 'nothing',
  recordOverrides: { ...(stockDonor('grenade')?.recordOverrides ?? {}) },
  fireType: 'power',
  // The donor's own subtype: the Grenade's throw. It is the worm fire
  // animation + sound, and the Fire Subtype control edits it.
  specialSubtype: stockDonor('grenade')?.specialSubtype ?? 0,
  teleport: false,
  // The default value, not a rule: both id fields edit the whole id.
  id: `${DEFAULT_ID_NAMESPACE}.grenade`,
  name: 'Grenade',
  description: "WormBench's stock Grenade record, ready to be changed.",
  version: '0.1.0',
  author: 'WormBench Author',
  slot: 'grenade',
  based_on: 'grenade',
  panel_icon: 'grenade',
  defaults: {
    ammo: 3,
    delay: 0,
    crateChance: 15,
    crateType: 'weapon',
    afterUse: 'retreat',
  },
  roamConfig: { ...DEFAULT_ROAM },
  digConfig: { ...DEFAULT_DIG },
  fireConfig: { ...DEFAULT_FIRE },
  missileSprite: {
    enabled: false,
    mode: 'stock',
    stockSprite: 'grenade',
    sheet: '',
    anim: 'rotation',
    frames: 1,
    fps: 15,
    animSpeed: 1.0,
    spinRate: 1.0,
    scale: 1.0,
    mirror: true,
    z: 5.0,
    animate: false,
    spin: true,
    hideStock: true,
  },
  bitFlight: { ...DEFAULT_ROLE_ART },
  behaviorArt: {},
  roamSheets: { flight1: {}, flight2: {} },
  ribbonTrail: {
    enabled: false,
    max: 12,
    every: 2,
    vanish: 2,
    coreWidth: 8,
    glowWidth: 13,
    noise: 0,
    rainbow: false,
    color: '#ffffff',
    target: 'main',
  },
  explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT },
  aimClip: { ...DEFAULT_AIM_CLIP, keys: DEFAULT_AIM_CLIP.keys.map((k) => ({ ...k })) },
  melee: { ...DEFAULT_MELEE },
  terrainStamp: { ...DEFAULT_TERRAIN_STAMP },
  customSounds: { ...DEFAULT_CUSTOM_SOUNDS },
  extraDependencies: [],
  hold: {
    enabled: false,
    sheet: '',
    handType: 'mid',
    handRadius: 10,
    weapRadius: -8,
    weapRotation: 0,
    scale: 1,
    handScale: 1,
    frames: 1,
    fps: 15,
    animate: false,
    drawHand: true,
    keepWhileFiring: false,
    thrown: true,
    putAway: false,
    handRad: 10,
    handRadLower: 0,
    handRadUpper: 0,
    // Off by default: a weapon that never swings does not need an aim limit.
    aimClamp: { enabled: false, up: 60, down: 60 },
  },
  packArt: {},
  customSprites: {},
  enableCustomLua: false,
  customLuaSnippet: '',
  useWepFile: false,
};

/**
 * The bundle is one `PackProject` and one active index; every panel still takes
 * the active weapon, so nothing below this file knows how many weapons there are.
 *
 * **A bundle of one is that weapon.** `syncPackToSoleWeapon` keeps the pack's id,
 * name, author and version equal to the weapon's while it is alone, which is what
 * keeps a single-weapon export identical to what it was before packs existed. From
 * the second weapon on the bundle has its own identity, edited in the Bundle
 * Settings card, and `mod.toml` carries one `[[components]]` block per weapon.
 */
export default function App() {
  const [pack, setPack] = useState<PackProject>(() => ({
    id: INITIAL_PROJECT.id,
    name: INITIAL_PROJECT.name,
    author: INITIAL_PROJECT.author,
    version: INITIAL_PROJECT.version,
    weapons: [INITIAL_PROJECT],
  }));
  const [activeIndex, setActiveIndex] = useState(0);
  const project = pack.weapons[activeIndex] ?? pack.weapons[0];
  const [activeTab, setActiveTab] = useState<'editor' | 'hold' | 'effects' | 'code'>('editor');
  const [activeSubTab, setActiveSubTab] = useState<RecordTabId>('missile');
  const [isWepModalOpen, setIsWepModalOpen] = useState(false);
  const [isModBrowserOpen, setIsModBrowserOpen] = useState(false);
  // The mod browser either replaces the active weapon (the old behaviour, and
  // what "import this weapon" means) or appends one to the bundle, which is how a
  // pack is built out of weapons that already exist.
  const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /**
   * What a whole-bundle import says the export will refuse. A pack of 89 weapons
   * cannot put that in a toast, and the per-weapon notes behind the count are
   * where an author finds the reason, so it stays on screen until dismissed.
   */
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // Light is the default: it reads like the game's own 1998 UI and keeps the
  // pixel-art previews on a neutral, uncoloured backdrop.
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('wf_theme_v2');
      if (stored) return stored === 'dark';
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('wf_theme_v2', 'dark');
      themeColor?.setAttribute('content', '#0c0a09');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('wf_theme_v2', 'light');
      themeColor?.setAttribute('content', '#f5f5f4');
    }
  }, [isDark]);

  // Keyboard navigation hotkeys (1: Record, 2: Hold, 3: Effects, 4: Code)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd/Alt + digit is the browser's (tab switching), and a
      // contenteditable is a text field like the three tags are.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      if (e.key === '1') setActiveTab('editor');
      else if (e.key === '2') setActiveTab('hold');
      else if (e.key === '3') setActiveTab('effects');
      else if (e.key === '4') setActiveTab('code');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const allowed = visibleRecordTabs(
      project.burst,
      bitActionOf(project.body.clustlet),
      project.fireType,
      project.teleport,
      project.body.fuse
    );
    if (!allowed.some((tab) => tab.id === activeSubTab)) {
      setActiveSubTab(allowed[0]?.id ?? 'missile');
    }
  }, [
    project.burst,
    project.body.clustlet.bit_action,
    project.body.clustlet.homing,
    project.body.clustlet.contact,
    project.fireType,
    project.teleport,
    project.body.fuse,
    activeSubTab,
  ]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const updateProject = (patch: Partial<WeaponProject>) => {
    setPack((prev) => {
      const current = prev.weapons[activeIndex] ?? prev.weapons[0];
      // A donor change re-bases the record: the panels must show the donor the
      // claim actually copies, and the generator diffs against that donor.
      const donor =
        patch.based_on !== undefined && patch.based_on !== current.based_on
          ? patch.based_on
          : undefined;
      const next = { ...current, ...patch };
      const rebased = donor && !next.useWepFile ? rebaseToDonor(next, donor) : next;
      return withWeapon(prev, activeIndex, rebased);
    });
  };

  /** Bundle-level edits: identity, `replaces`, the profile name. */
  const updatePack = (patch: Partial<PackProject>) => {
    setPack((prev) => syncPackToSoleWeapon({ ...prev, ...patch }));
  };

  const selectWeapon = (index: number) => {
    const next = Math.max(0, Math.min(pack.weapons.length - 1, index));
    setActiveIndex(next);
  };

  const addBlankWeapon = () => {
    // A fresh weapon starts from the default donor, exactly as the app does, and
    // never inherits the open weapon's record, art or builder settings.
    const result = addWeaponToPack(pack, {
      ...INITIAL_PROJECT,
      id: '',
      name: 'New Weapon',
      customIconFile: undefined,
      customIconPreview: undefined,
    });
    setPack(result.pack);
    setActiveIndex(result.index);
  };

  const duplicateWeapon = (index: number) => {
    const result = duplicateWeaponInPack(pack, index);
    setPack(result.pack);
    setActiveIndex(result.index);
  };

  const removeWeapon = (index: number) => {
    const result = removeWeaponFromPack(pack, index);
    setPack(result.pack);
    setActiveIndex(result.index);
  };

  const moveWeapon = (index: number, delta: -1 | 1) => {
    const result = moveWeaponInPack(pack, index, delta);
    setPack(result.pack);
    setActiveIndex(result.index);
  };

  const rail = (
    <PackRail
      pack={pack}
      activeIndex={activeIndex}
      onSelect={selectWeapon}
      onAddWeapon={addBlankWeapon}
      onImportWeapon={() => {
        setImportMode('append');
        setIsModBrowserOpen(true);
      }}
      onDuplicate={duplicateWeapon}
      onRemove={removeWeapon}
      onMove={moveWeapon}
    />
  );

  const handleApplyWepImport = (
    parsed: Partial<WeaponProject> & {
      replaceProject?: boolean;
      modIcon?: { file: File; preview?: string };
    },
  ) => {
    // A bundle import is a new weapon (`replaceProject`): it starts from the
    // default project, so the open weapon's record, art and builder settings
    // cannot leak into it. A `.wep` import still merges into what is open.
    const replace = !!parsed.replaceProject;
    // The bundle's own icon comes with the bundle, not with the weapon: a pack
    // has one, so it is applied to the pack the import replaces. Adding a weapon
    // to an existing bundle leaves that bundle's icon alone.
    const importedIcon = replace && importMode === 'replace' ? parsed.modIcon : undefined;
    // "Add to this bundle": the imported weapon joins the pack instead of
    // replacing the open one, with a free id and its art moved to its own folder.
    if (replace && importMode === 'append') {
      const incoming = { ...INITIAL_PROJECT, ...parsed } as WeaponProject;
      const result = addWeaponToPack(pack, incoming);
      setPack(result.pack);
      setActiveIndex(result.index);
      setImportMode('replace');
      showToast(`Added ${parsed.name || 'weapon'} to the bundle.`);
      return;
    }
    setImportMode('replace');
    setPack((prevPack) => {
      const open = prevPack.weapons[activeIndex] ?? prevPack.weapons[0];
      const prev = replace ? INITIAL_PROJECT : open;
      const body: WeaponProject['body'] = {
        ...prev.body,
        ...(parsed.body || {}),
        clustlet: {
          ...prev.body.clustlet,
          ...(parsed.body?.clustlet || {}),
        },
      };
      const defaults: WeaponProject['defaults'] = {
        ...prev.defaults,
        ...(parsed.defaults || {}),
      };
      // Importing a different weapon must not keep the previous weapon's
      // record edits or callbacks. Those stale fields were a large part of why
      // importing a .wep could "break" the weapon: old overrides were merged
      // on top of the new record. Presets supply their own overrides.
      const recordOverrides = { ...(parsed.recordOverrides || {}) };
      const action = parsed.action ?? prev.action;
      const burst = parsed.burst ?? prev.burst;
      const missileSprite = parsed.missileSprite ?? prev.missileSprite;
      const roamConfig = parsed.roamConfig ?? prev.roamConfig;
      const digConfig = parsed.digConfig ?? prev.digConfig;
      const fireConfig = parsed.fireConfig ?? prev.fireConfig;
      const specialSubtype = parsed.specialSubtype ?? prev.specialSubtype;
      const useWepFile = !!parsed.useWepFile && !!parsed.wepFile;

      const merged: WeaponProject = {
        ...prev,
        ...parsed,
        body,
        defaults,
        recordOverrides,
        action,
        burst,
        missileSprite,
        roamConfig,
        digConfig,
        fireConfig,
        specialSubtype,
        enableCustomLua: parsed.enableCustomLua ?? false,
        customLuaSnippet: parsed.customLuaSnippet ?? '',
        useWepFile,
        // Keep the file even when the user applies the decoded record, so the
        // settings toggle can switch back to `wep` without re-importing.
        wepFile: parsed.wepFile,
        wepFileName: parsed.wepFileName,
        // The decoded model at import time. Fields that still match it are
        // inherited from the .wep; only edits become named overrides. A bundle
        // import supplies its own baseline (the decoded `.wep` *before* the
        // module's declared tables), so those edits are what gets written.
        // Snapshotted whenever a file came with the import, not only when it is
        // used: the settings toggle can switch to the file later, and a baseline
        // taken then would be the *edited* project, so every edit made in
        // between would match it and silently drop from the export.
        wepBaseline: parsed.wepBaseline ?? (parsed.wepFile
          ? {
              body: { ...body, clustlet: { ...body.clustlet } },
              action,
              burst,
              recordOverrides: { ...recordOverrides },
              missileSprite: { ...missileSprite },
              roamConfig: { ...roamConfig },
              digConfig: { ...digConfig },
              fireConfig: { ...fireConfig },
              specialSubtype,
            }
          : undefined),
        // A preset (or any import without its own baseline) copies a donor, so
        // its diff base has to be *that* donor's record -- not whatever donor
        // the open project happened to be using.
        donorBaseline:
          parsed.donorBaseline ??
          (useWepFile
            ? prev.donorBaseline
            : stockDonorBaseline(parsed.based_on ?? prev.based_on) ?? prev.donorBaseline),
      };
      const next = withWeapon(prevPack, activeIndex, merged);
      return importedIcon
        ? { ...next, iconFile: importedIcon.file, iconPreview: importedIcon.preview }
        : next;
    });
    showToast(
      parsed.useWepFile && parsed.wepFile
        ? `Imported ${parsed.wepFileName || parsed.wepFile.name}; the bundle will use that .wep record.`
        : `Imported ${parsed.name || 'weapon'} record into project.`
    );
  };

  /**
   * A whole bundle read as a pack (P5 of `reqs/pack_export_plan.md`): every weapon
   * it holds replaces the open bundle, with the ids the source declares (or a
   * namespaced id when the source is another author's).
   */
  const handleImportPack = (imported: PackProject, warnings: string[] = []) => {
    setPack(imported);
    setActiveIndex(0);
    setImportMode('replace');
    setImportWarnings(warnings);
    showToast(
      warnings.length > 0
        ? `Read ${imported.weapons.length} weapon${imported.weapons.length === 1 ? '' : 's'} into ${imported.id}, with ${warnings.length} export blocker${warnings.length === 1 ? '' : 's'}.`
        : `Read ${imported.weapons.length} weapon${imported.weapons.length === 1 ? '' : 's'} into ${imported.id}.`,
    );
  };

  const handleExportZip = async () => {
    setIsExporting(true);
    try {
      // A bundle import fills the custom Lua box with a callback body the editor
      // did not write, and that body can read a name nothing declares (a vortex's
      // `start_vortex`): the file then fails the moment the hook runs. The export
      // is not blocked, because the author may know better, but the toast says so
      // instead of letting it be discovered in game.
      // Per weapon, because with a pack of eighty-nine the bare line numbers say
      // nothing about which weapon's carried code will fail.
      const unresolved = pack.weapons
        .map((weapon) => ({
          label: weapon.name || weapon.id,
          names: [
            ...new Set(
              checkLua(generateLuaCode(weapon))
                .filter((finding) => finding.notGenerated)
                .map((finding) => finding.name ?? `${finding.rule} at line ${finding.line}`),
            ),
          ],
        }))
        .filter((entry) => entry.names.length > 0);
      const named = unresolved
        .slice(0, 3)
        .map((entry) => `${entry.label} (${entry.names.join(', ')})`)
        .join('; ');
      const namedMore =
        unresolved.length > 3 ? ` and ${unresolved.length - 3} more weapon(s)` : '';
      const blob = await exportPackZip(pack);
      const modFolder = sanitizeModFolder(pack.id);
      downloadBlob(blob, `${modFolder}.zip`);
      const contents =
        pack.weapons.length > 1
          ? `${pack.weapons.length} weapons, one mod.toml & profile`
          : 'mod.toml & profile';
      showToast(
        unresolved.length > 0
          ? `Exported ${modFolder}.zip, but carried code in ${named}${namedMore} reads names nothing declares: those hooks fail at load (Bundle & Export).`
          : `Exported ${modFolder}.zip with ${contents}.`,
      );
    } catch (err: any) {
      const message = err?.message || String(err);
      // A `validateBundle` refusal already reads as a sentence and names the
      // weapon, the line and the rule, so it is shown as it is.
      alert(/^this bundle would not load/.test(message) ? message : `Export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(project.id);
    showToast(`Copied ${project.id} to clipboard.`);
  };

  const pageMeta = {
    editor: {
      eyebrow: 'Weapon Record',
      title: 'Shape the weapon',
      description: 'Type, donor slot, flight physics, payload and collision behaviour.',
    },
    hold: {
      eyebrow: 'Hold & Sprite Builder',
      title: 'Aim and flight art',
      description: 'Check the worm hold at every aim angle and the 50 Hz missile animation.',
    },
    effects: {
      eyebrow: 'Effects & Libraries',
      title: 'Advanced libraries',
      description: 'Ribbon trail, explosion burst, emitter, custom sounds and sequential fire.',
    },
    code: {
      eyebrow: 'Bundle Code',
      title: 'Review the bundle',
      description: 'Generated Lua, mod.toml and profile, ready to drop into WormBench/Mods.',
    },
  }[activeTab];

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-forge-600 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <Sidebar
        project={project}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeSubTab={activeSubTab}
        setActiveSubTab={setActiveSubTab}
        onImportWep={() => setIsWepModalOpen(true)}
        onBrowseMods={() => setIsModBrowserOpen(true)}
        onExportZip={handleExportZip}
        isDark={isDark}
        setIsDark={setIsDark}
        onCopyId={copyId}
        rail={rail}
      />

      <div className="flex min-h-screen flex-col lg:pl-68">
        <MobileBar
          project={project}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeSubTab={activeSubTab}
          setActiveSubTab={setActiveSubTab}
          onImportWep={() => setIsWepModalOpen(true)}
          onBrowseMods={() => setIsModBrowserOpen(true)}
          onExportZip={handleExportZip}
          isDark={isDark}
          setIsDark={setIsDark}
          weaponSwitcher={
            <WeaponSwitcher
              pack={pack}
              activeIndex={activeIndex}
              onSelect={selectWeapon}
              onAdd={addBlankWeapon}
            />
          }
        />

        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6"
        >
          {importWarnings.length > 0 && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-100"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">
                  {importWarnings.length} thing{importWarnings.length === 1 ? '' : 's'} in this bundle
                  would stop the export. Each line names the weapon and the reason; the export
                  refuses them by weapon and rule until they are fixed.
                </p>
                <button
                  type="button"
                  onClick={() => setImportWarnings([])}
                  aria-label="Dismiss import blockers"
                  className="shrink-0 rounded-md px-1.5 text-sm leading-5 text-rose-700 hover:bg-rose-100 dark:text-rose-200 dark:hover:bg-rose-900"
                >
                  ✕
                </button>
              </div>
              <ul className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed">
                {importWarnings.slice(0, 8).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              {importWarnings.length > 8 && (
                <p className="mt-1 text-[11px] font-semibold">
                  and {importWarnings.length - 8} more
                </p>
              )}
            </div>
          )}

          <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-forge-600 dark:text-forge-400">
                {pageMeta.eyebrow}
              </div>
              <h1 className="mt-0.5 font-heading text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                {pageMeta.title}
              </h1>
              <p className="mt-0.5 max-w-2xl text-xs text-stone-500 dark:text-stone-400">
                {pageMeta.description}
              </p>
            </div>
          </header>

          {activeTab === 'editor' && (
            <div className="space-y-4">
              {/* Always mounted: the bundle icon is a bundle-level field even
                  for a pack of one, which is the same card the mod loader shows
                  when it has none (initials). */}
              <PackSettingsCard
                pack={pack}
                onChange={updatePack}
                onRemoveWeapon={pack.weapons.length > 1 ? () => removeWeapon(activeIndex) : undefined}
              />
              <WeaponSettings project={project} bundleId={pack.id} onChange={updateProject} />
              <RecordEditor
                project={project}
                onChange={updateProject}
                activeSubTab={activeSubTab}
                onSelectSubTab={setActiveSubTab}
              />
            </div>
          )}

          {activeTab === 'hold' && (
            <div className="space-y-6">
              <HoldPreview project={project} onChange={updateProject} />
            </div>
          )}

          {activeTab === 'effects' && (
            <EffectsWorkspace project={project} onChange={updateProject} />
          )}

          {activeTab === 'code' && (
            <div className="space-y-6">
              <CarriedLuaPanel project={project} onChange={updateProject} />
              <BundleDependencies project={project} onChange={updateProject} />
              <div className="h-[750px]">
                <LuaPreviewModal
                  project={project}
                  pack={pack}
                  activeWeaponIndex={activeIndex}
                  onSelectWeapon={selectWeapon}
                  inline
                />
              </div>
            </div>
          )}
        </main>

        <footer className="border-t border-stone-200/80 bg-white/60 py-4 dark:border-stone-800 dark:bg-stone-900/40">
          <div className="mx-auto w-full max-w-6xl space-y-2 px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span>WormBench Weapon Studio</span>
              <span className="font-mono">
                WormBench/Mods/{sanitizeModFolder(pack.id)}/
                {pack.weapons.length > 1 ? ` · ${pack.weapons.length} weapons` : ''}
              </span>
            </div>

            {/* Legal note. The stock art this editor shows is Team17's, and the
                tools it drives are unofficial, so both facts are stated where a
                reader of the page will actually see them. */}
            <details className="text-[11px] leading-relaxed text-stone-400 dark:text-stone-500">
              <summary className="cursor-pointer font-semibold text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200">
                Unofficial fan tool, credits and disclaimer
              </summary>
              <div className="mt-2 max-w-4xl space-y-1.5">
                <p>
                  Worms Armageddon and its artwork belong to Team17. The stock art this page
                  displays is Team17&apos;s, borrowed only to preview a mod: the sprite-builder tab
                  icons (Main, Home, Bits, HomeBit, Sheep, Dig), the frozen worm preview, and the
                  terrain preview backdrop. The fallback sprite that fills an untouched export is
                  hand-drawn for this project instead, not taken from the game. WormBench itself is
                  a separate community project, and this editor is a separate fan tool again.
                </p>
                <p>
                  This is unofficial and unaffiliated: not made by, endorsed by, sponsored by or
                  supported by Team17. A bundle carries the art you upload, and this project's own
                  hand-drawn fallback sprite when you leave it as it is; no game art is copied into
                  your mod, and nothing is uploaded anywhere.
                </p>
                <p>
                  Weapons, bundles and any other content you build here are yours, and you are
                  responsible for them and for how you use them. The page is provided as is, with no
                  warranty: check an export in game before you rely on it.
                </p>
              </div>
            </details>
          </div>
        </footer>
      </div>

      {isModBrowserOpen && (
        <ModBrowserModal
          onClose={() => {
            setIsModBrowserOpen(false);
            setImportMode('replace');
          }}
          showToast={showToast}
          onImport={handleApplyWepImport}
          onImportPack={handleImportPack}
          appendToPack={importMode === 'append'}
        />
      )}

      <WepImportModal
        isOpen={isWepModalOpen}
        onClose={() => setIsWepModalOpen(false)}
        onApply={handleApplyWepImport}
      />

      {/* Tap-to-read tooltips: most field explanations are `title` attributes,
          which a phone can never hover, so one global listener turns a tap on
          any of them into the same bubble. */}
      <TooltipTap />

      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200 dark:bg-stone-100 dark:text-stone-900"
        >
          <CheckCircle2 className="h-4 w-4 text-forge-400 dark:text-forge-600" aria-hidden="true" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
