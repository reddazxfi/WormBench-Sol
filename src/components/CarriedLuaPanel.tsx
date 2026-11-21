import React, { useMemo } from 'react';
import type { CarriedLua, WeaponProject } from '../types/weapon';
import { FileCode2, Power } from 'lucide-react';
import { availableRequiresForCheck, generateLuaCode, weaponManifestPart } from '../utils/luaGenerator';
import { checkLua } from '../utils/luaCheck';
import { LuaFindings } from './LuaFindings';

interface CarriedLuaPanelProps {
  project: WeaponProject;
  onChange: (patch: Partial<WeaponProject>) => void;
}

type RowKind = 'preamble' | 'prologue' | 'hook' | 'registration';

interface Row {
  kind: RowKind;
  index: number;
  title: string;
  /** Why it is here: the names that pulled it in, or the event and its filter. */
  detail: string;
  requires: string[];
  text: string;
  disabled: boolean;
  key: string;
}

const KIND_STYLE: Record<RowKind, string> = {
  preamble: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700',
  prologue: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700',
  hook: 'bg-forge-50/70 text-forge-800 border-forge-200/80 dark:bg-forge-950/35 dark:text-forge-300 dark:border-forge-900/60',
  registration:
    'bg-forge-50/70 text-forge-800 border-forge-200/80 dark:bg-forge-950/35 dark:text-forge-300 dark:border-forge-900/60',
};

const KIND_LABEL: Record<RowKind, string> = {
  preamble: 'preamble',
  prologue: 'install local',
  hook: 'claim hook',
  registration: 'wa.on',
};

const lineCount = (text: string) => text.split('\n').length;

/**
 * The Carried Lua panel: what an import brought out of the bundle it read, one
 * row per block, each with its own switch.
 *
 * An import carries a bundle's code, not only its tables (`on_explode`,
 * `on_fire`, every other claim hook, every `wa.on.*` registration, the
 * declarations each one closes over, and the sheets and WAVs they name). None of
 * that is modelled by a panel, so the honest UI is a list of what arrived and a
 * way to drop a piece: an author who does not want the bundle's blur (or finds a
 * block the engine refuses) switches it off, and the export stops writing it.
 *
 * A switched-off block can leave the ones below it reading a nil, so the
 * validator's report sits at the top of the list rather than only on the code
 * view: `LuaFindings` tags every finding inside a carried region as `custom`, and
 * the summary says how many blocks are on.
 */
export const CarriedLuaPanel: React.FC<CarriedLuaPanelProps> = ({ project, onChange }) => {
  const carried = project.carriedLua;
  const luaCode = useMemo(() => (carried ? generateLuaCode(project) : ''), [carried, project]);
  const carriedFindings = useMemo(() => {
    if (!carried) return [];
    const deps = weaponManifestPart(project).dependencies;
    const availableRequires = availableRequiresForCheck(luaCode, deps);
    return checkLua(luaCode, { mode: 'module', availableRequires }).filter(
      (finding) => finding.notGenerated,
    );
  }, [carried, luaCode, project]);

  if (!carried) return null;

  const rows: Row[] = [];
  const pushBlock = (kind: 'preamble' | 'prologue') => {
    carried[kind].forEach((block, index) => {
      rows.push({
        kind,
        index,
        title: block.declares.join(', ') || `${kind} block`,
        detail:
          block.neededBy.length > 0
            ? `read by ${block.neededBy.join(', ')}`
            : kind === 'prologue'
              ? 'install-time'
              : 'module-level',
        requires: block.requires,
        text: block.text,
        disabled: !!block.disabled,
        key: `${kind}-${index}`,
      });
    });
  };
  pushBlock('preamble');
  pushBlock('prologue');
  (carried.hooks ?? []).forEach((hook, index) => {
    rows.push({
      kind: 'hook',
      index,
      title: hook.key,
      detail:
        hook.key === 'on_explode' || hook.key === 'on_fire'
          ? `merged into the editor's own ${hook.key}`
          : 'written as the claim key itself',
      requires: [],
      text: hook.text,
      disabled: !!hook.disabled,
      key: `hook-${index}`,
    });
  });
  (carried.registrations ?? []).forEach((registration, index) => {
    const filter = /,\s*\{([\s\S]*)\}\s*\)\s*$/.exec(registration.text);
    rows.push({
      kind: 'registration',
      index,
      title: `wa.on.${registration.event}`,
      detail: filter ? `filtered: ${filter[1].replace(/\s+/g, ' ').trim()}` : 'runs on every call of the event',
      requires: [],
      text: registration.text,
      disabled: !!registration.disabled,
      key: `registration-${index}`,
    });
  });

  const setDisabled = (row: Row, disabled: boolean) => {
    const next: CarriedLua = { ...carried };
    if (row.kind === 'preamble' || row.kind === 'prologue') {
      next[row.kind] = carried[row.kind].map((block, index) =>
        index === row.index ? { ...block, disabled } : block,
      );
    } else if (row.kind === 'hook') {
      next.hooks = (carried.hooks ?? []).map((hook, index) =>
        index === row.index ? { ...hook, disabled } : hook,
      );
    } else {
      next.registrations = (carried.registrations ?? []).map((registration, index) =>
        index === row.index ? { ...registration, disabled } : registration,
      );
    }
    onChange({ carriedLua: next });
  };

  const on = rows.filter((row) => !row.disabled).length;
  const off = rows.length - on;
  const sheets = carried.art?.sprites.length ?? 0;
  const sounds = carried.art?.sounds.length ?? 0;

  const summaryParts = [
    `${on} on${off > 0 ? ` · ${off} off` : ''}`,
    ...(
      [
        ['hook', carried.hooks?.length ?? 0],
        ['registration', carried.registrations?.length ?? 0],
        ['declaration', carried.preamble.length + carried.prologue.length],
        ['sheet', sheets],
        ['sound', sounds],
      ] as [string, number][]
    )
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`),
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200/80 bg-stone-50/70 px-4 py-2.5 dark:border-stone-800 dark:bg-stone-950/50">
        <span className="font-heading text-xs font-semibold tracking-tight text-stone-900 dark:text-stone-100 flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-forge-500" />
          Carried Lua
        </span>
        <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
          {carried.origin ? `from ${carried.origin}` : 'from the imported bundle'}
        </span>
      </div>

      <div className="p-4 space-y-3.5">
        <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
          This weapon came from a bundle with code the editor does not model, so it was carried and
          its own declarations came with it. Switch a block off to drop it from the export; the text
          stays here, so switching it back on restores it. Sheets and WAVs the code names travel with
          the bundle either way, because a declared path has to exist at load.
        </p>
        <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          Carrying is best effort, not a promise. The block is written from the editor's own file, so
          its indentation, where its helpers sit and anything the reader could not resolve can differ
          from the bundle you imported, and a block listed as unresolved below is nil when it runs.
          Check the exported Lua before shipping the weapon.
        </p>

        <div className="text-[11px] font-mono tabular-nums text-stone-600 dark:text-stone-400">
          {summaryParts.join(' · ')}
        </div>

        {carried.unresolved.length > 0 && (
          <p className="text-[11px] leading-snug text-rose-700 dark:text-rose-300">
            The bundle does not declare {carried.unresolved.map((name) => (
              <span key={name} className="font-mono">{name} </span>
            ))}
            so it is nil when the hook runs. Supply it in the custom Lua, or switch the block that
            reads it off.
          </p>
        )}

        {carriedFindings.length > 0 && <LuaFindings findings={carriedFindings} limit={4} />}

        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className={`rounded-lg border p-2.5 ${
                row.disabled
                  ? 'border-stone-200/80 bg-stone-50/60 opacity-60 dark:border-stone-800 dark:bg-stone-950/40'
                  : 'border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-950/30'
              }`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-mono font-medium ${KIND_STYLE[row.kind]}`}
                >
                  {KIND_LABEL[row.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] font-semibold text-stone-900 dark:text-stone-100">
                    {row.title}
                  </span>
                  <span className="block truncate text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">
                    {row.detail} · {lineCount(row.text)} line{lineCount(row.text) === 1 ? '' : 's'}
                    {row.requires.length > 0 ? ` · requires ${row.requires.join(', ')}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!row.disabled}
                  aria-label={`${row.disabled ? 'Enable' : 'Disable'} ${row.title}`}
                  title={row.disabled ? 'Write this block again' : 'Leave this block out of the export'}
                  onClick={() => setDisabled(row, !row.disabled)}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
                    row.disabled
                      ? 'border-stone-200 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'
                      : 'border-forge-600 bg-forge-600 text-white hover:bg-forge-700'
                  }`}
                >
                  <Power className="w-3 h-3" aria-hidden="true" />
                  {row.disabled ? 'Off' : 'On'}
                </button>
              </div>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[10px] font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100">
                  Show the code
                </summary>
                <pre className="mt-1.5 max-h-64 overflow-auto rounded-md bg-stone-950 p-2.5 font-mono text-[11px] leading-relaxed text-stone-100 select-text border border-stone-800">
                  {row.text}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
