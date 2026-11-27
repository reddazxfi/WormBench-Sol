import React, { useMemo, useState } from 'react';
import { PackProject, WeaponProject } from '../types/weapon';
import {
  availableRequiresForCheck,
  generateLuaCode,
  generateModToml,
  generatePackProfile,
  generatePackToml,
  generateProfileToml,
  sanitizeModFolder,
  weaponManifestPart,
} from '../utils/luaGenerator';
import { Copy, Check, FileCode2, Settings, UserCheck, X } from 'lucide-react';
import { checkLua } from '../utils/luaCheck';
import { LuaFindings } from './LuaFindings';
import { WeaponSwitcher } from './PackRail';

interface LuaPreviewModalProps {
  project: WeaponProject;
  /**
   * The whole bundle. A pack of more than one weapon has **one** `mod.toml` and
   * **one** profile, so those two tabs come from the pack generators while the Lua
   * tab shows one weapon at a time (the selector above the tabs).
   */
  pack?: PackProject;
  activeWeaponIndex?: number;
  onSelectWeapon?: (index: number) => void;
  isOpen?: boolean;
  onClose?: () => void;
  inline?: boolean;
}

export const LuaPreviewModal: React.FC<LuaPreviewModalProps> = ({
  project,
  pack,
  activeWeaponIndex = 0,
  onSelectWeapon,
  isOpen = true,
  onClose,
  inline = false,
}) => {
  const [activeFile, setActiveFile] = useState<'lua' | 'mod_toml' | 'profile_toml'>('lua');
  const [copied, setCopied] = useState(false);

  if (!inline && !isOpen) return null;

  const many = !!pack && pack.weapons.length > 1;
  const shown = many ? (pack!.weapons[activeWeaponIndex] ?? project) : project;
  const luaCode = generateLuaCode(shown);
  // One manifest and one profile per bundle: for a pack of one the pack
  // generators write the same file the single-weapon ones do (checked by
  // `tools/check_pack_roundtrip.ts`), so both paths are the same text.
  const modToml = many ? generatePackToml(pack!) : generateModToml(shown);
  const profileToml = many ? generatePackProfile(pack!) : generateProfileToml(shown);
  const profileName = many
    ? (pack!.profileName || pack!.name || 'Profile').replace(/[\/:*?"<>|]/g, '_')
    : (shown.name || 'Profile');

  // The generated Lua is a complete file, so the editor can say whether it
  // would run: custom code (or a hook an imported bundle carried in) that reads a
  // name nothing declares, which is the Pulsar's `aura` and the Vortex's
  // `start_vortex`, a `math.sin` that is not lockstep safe, a block left open.
  // The report is on the file, not on the text box, and a finding inside the
  // marked custom block is tagged as such by `LuaFindings`.
  const luaFindings = useMemo(() => {
    const deps = many
      ? [...new Set(pack!.weapons.flatMap((weapon) => weaponManifestPart(weapon).dependencies))]
      : weaponManifestPart(shown).dependencies;
    const availableRequires = availableRequiresForCheck(luaCode, deps);
    return checkLua(luaCode, { mode: 'module', availableRequires });
  }, [luaCode, many, pack, shown]);

  const getActiveContent = () => {
    if (activeFile === 'lua') return luaCode;
    if (activeFile === 'mod_toml') return modToml;
    return profileToml;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getActiveContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const containerContent = (
    <div className={`flex flex-col ${inline ? 'h-full' : 'max-h-[85vh]'} bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden shadow-xs transition-colors`}>
      {/* File Selector Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/60">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-stone-200/60 dark:bg-stone-700/60 rounded-lg">
          {many && onSelectWeapon && (
            <span className="pl-1 pr-0.5">
              <WeaponSwitcher pack={pack!} activeIndex={activeWeaponIndex} onSelect={onSelectWeapon} />
            </span>
          )}
          <button
            type="button"
            onClick={() => setActiveFile('lua')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
              activeFile === 'lua'
                ? 'bg-white dark:bg-stone-900 text-forge-600 dark:text-forge-400 font-bold shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            weapons/{sanitizeModFolder(shown.id)}.lua
          </button>

          <button
            type="button"
            onClick={() => setActiveFile('mod_toml')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
              activeFile === 'mod_toml'
                ? 'bg-white dark:bg-stone-900 text-forge-600 dark:text-forge-400 font-bold shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            mod.toml
          </button>

          <button
            type="button"
            onClick={() => setActiveFile('profile_toml')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors ${
              activeFile === 'profile_toml'
                ? 'bg-white dark:bg-stone-900 text-forge-600 dark:text-forge-400 font-bold shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            profiles/{profileName}.toml
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-300 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 border border-stone-300 dark:border-stone-700 rounded-md transition-colors shadow-2xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-forge-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>

          {!inline && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {activeFile === 'lua' && luaFindings.length > 0 && (
        <div className="border-b border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900">
          <LuaFindings findings={luaFindings} limit={4} />
        </div>
      )}

      {/* Code Editor Viewport */}
      <div className="flex-1 overflow-auto bg-stone-950 p-4 font-mono text-xs leading-relaxed text-forge-400">
        <pre className="whitespace-pre-wrap select-text">{getActiveContent()}</pre>
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2.5 bg-stone-100/80 dark:bg-stone-800/80 border-t border-stone-200 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400 flex items-center justify-between">
        <span>
          {activeFile === 'lua' && 'Component definition file executed when match loads.'}
          {activeFile === 'mod_toml' && 'Mod manifest declaring components, API version 4 & sprite animations.'}
          {activeFile === 'profile_toml' && 'Profile scheme placing the weapon alongside stock weapons for testing.'}
        </span>
        <span className="font-mono text-forge-600 dark:text-forge-400 font-semibold">
          WormBench bundle
        </span>
      </div>
    </div>
  );

  if (inline) {
    return containerContent;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-4xl">{containerContent}</div>
    </div>
  );
};
