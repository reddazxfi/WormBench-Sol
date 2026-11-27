// The app-side exporter: the library bundles an export ships, the ZIP, and the
// download. The emitter itself lives in `packExporter.ts`, which takes the
// libraries as arguments and so can be exercised without Vite's `?raw` imports.
import JSZip from 'jszip';
import { isTauri } from '@tauri-apps/api/core';
import { downloadDir, join } from '@tauri-apps/api/path';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { PackProject, WeaponProject } from '../types/weapon';
import {
  WFWS_AIRSTRIKE_LUA,
  WFWS_FIRING_LUA,
  WFWS_SDK_MOD_TOML,
  WFWS_SDK_SHEETS,
  WFWS_SPRITE_BUILDER_LUA,
  WFWS_SWING_LUA,
  WFWS_TRAIL_LUA,
} from '../data/wfwsSdk';
import {
  EFFECTS_SDK_FILES,
  EFFECTS_SDK_MOD_TOML,
  EFFECTS_SDK_SHEETS,
} from '../data/effectsSdk';
import { singleWeaponPack } from './luaGenerator';
import { emitPackFiles, type PackLibraries } from './packExporter';

export {
  emitPackFiles,
  safeBundlePath,
  weaponBundlePart,
  type BundleFileContent,
  type PackLibraries,
  type PackLibrary,
  type WeaponBundlePart,
  type WfwsLibraries,
} from './packExporter';

/** The library bundles this build ships: the wfws SDK always, effects on demand. */
const LIBRARIES: PackLibraries = {
  wfws: {
    modToml: WFWS_SDK_MOD_TOML,
    spriteBuilderLua: WFWS_SPRITE_BUILDER_LUA,
    swingLua: WFWS_SWING_LUA,
    airstrikeLua: WFWS_AIRSTRIKE_LUA,
    firingLua: WFWS_FIRING_LUA,
    trailLua: WFWS_TRAIL_LUA,
    sheets: WFWS_SDK_SHEETS,
  },
  effects: {
    modToml: EFFECTS_SDK_MOD_TOML,
    files: EFFECTS_SDK_FILES,
    sheets: EFFECTS_SDK_SHEETS,
  },
};

/** The effects SDK's own sheets, fetched from `spec/` at export time. */
async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Every file a bundle is made of, keyed by the path inside the ZIP. */
export async function emitPack(pack: PackProject): Promise<Map<string, string | Uint8Array>> {
  return emitPackFiles(pack, LIBRARIES, fetchBytes);
}

/** The ZIP for one project: the same emitter a pack uses, with one weapon in it. */
export async function exportModZip(project: WeaponProject): Promise<Blob> {
  return exportZip(singleWeaponPack(project));
}

/** The ZIP for a whole pack: one bundle, N weapons, one profile. */
export async function exportPackZip(pack: PackProject): Promise<Blob> {
  return exportZip(pack);
}

async function exportZip(pack: PackProject): Promise<Blob> {
  const files = await emitPack(pack);
  const zip = new JSZip();
  for (const [path, content] of files) zip.file(path, content);
  return await zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ExportSaveResult = {
  /** The exact path the desktop save dialog wrote. Null for a browser download. */
  path: string | null;
  /** True when the user dismissed the desktop save dialog. */
  cancelled: boolean;
};

/**
 * Save an exported ZIP. The desktop build asks for a destination with the native
 * Save As dialog and writes there once, so a repeated export never replaces an
 * earlier ZIP and the notice can name the exact file. A browser (the GitHub Pages
 * build) keeps its normal download.
 */
export async function saveExportBlob(blob: Blob, fileName: string): Promise<ExportSaveResult> {
  if (typeof window !== 'undefined' && isTauri()) {
    let defaultPath = fileName;
    try {
      defaultPath = await join(await downloadDir(), fileName);
    } catch {
      // A missing Downloads handle only changes where the dialog opens.
    }
    const selected = await save({
      defaultPath,
      filters: [{ name: 'WormBench bundle', extensions: ['zip'] }],
    });
    if (!selected) return { path: null, cancelled: true };
    const path = /\.zip$/i.test(selected) ? selected : `${selected}.zip`;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return { path, cancelled: false };
  }
  downloadBlob(blob, fileName);
  return { path: null, cancelled: false };
}
