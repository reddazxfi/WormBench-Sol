// The modules a library bundle exports, and the dependency that provides each.
//
// One table, because three places need the same answer and had drifted apart:
// the carry adds a dependency for a carried `require`, the export validator
// decides whether a `require` resolves at all, and the import summary names the
// module nothing ships. The engine resolves `wf-lib/<name>` **only** through a
// declared dependency's own `[exports]` table (`lua-host/src/modules.rs`), so a
// name that is not in one of these lists is not a name the export can write.
//
// Measured against the installed bundles' manifests (`Mods/wf-lib/sdk`,
// `effects_sdk`, `px_electric`, `px_fire_seq`, `wfws_sdk`) and against every
// `require("wf-lib/…")` in the installed corpus. `px.electric` exports
// `taze_mine` (three bundles require it) and does not export `hold`; `wf.sdk`
// does not export `wf-lib/sdk`. Both were in this table the other way round,
// which made the export refuse the Conductor and the Pulsar for code that loads.

export const SDK_MODULE_EXPORTS: Record<string, string[]> = {
  'wf.sdk': [
    'wf-lib/holds',
    'wf-lib/own_time',
    'wf-lib/shared',
    'wf-lib/parkour',
    'wf-lib/tooltip',
    'wf-lib/lightning',
    'wf-lib/px_sprite_builder',
  ],
  'wfws.sdk': ['wf-lib/wfws_sprite_builder', 'wf-lib/wfws_airstrike', 'wf-lib/wfws_firing'],
  'effects.sdk': [
    'wf-lib/effects/trail',
    'wf-lib/effects/px_effects',
    'wf-lib/effects/custom_explosion',
  ],
  'px.fire_seq': ['wf-lib/fire_seq', 'wf-lib/px_hold_art', 'wf-lib/seq-spb'],
  'px.electric': ['wf-lib/electric/damage', 'wf-lib/electric/taze_mine'],
};

/**
 * Prefixes for the one question the exact lists cannot answer: a carried
 * `require` of a name belonging to a library the editor does not ship the list
 * of. Only consulted when the bundle declares a dependency the editor has no
 * export table for, and only to say which dependency the name most likely needs.
 */
export const SDK_MODULE_PREFIXES: { prefix: string; id: string }[] = [
  { prefix: 'wf-lib/wfws_sdk/', id: 'wfws.sdk' },
  { prefix: 'wf-lib/effects/', id: 'effects.sdk' },
  { prefix: 'wf-lib/electric/', id: 'px.electric' },
];

/**
 * The dependency a carried `require` needs, or null when the module is unknown.
 * An exported name answers its own dependency; a longer path under a known
 * library answers that library, so a name the library adds later still lands on
 * the right manifest line.
 */
export function dependencyForModule(module: string): string | null {
  for (const [id, modules] of Object.entries(SDK_MODULE_EXPORTS)) {
    if (modules.includes(module)) return id;
  }
  const hit = SDK_MODULE_PREFIXES.find((entry) => module.startsWith(entry.prefix));
  if (hit) return hit.id;
  // A plain `wf-lib/<name>` with no prefix above belongs to no library the
  // editor knows; the author has to add the bundle that provides it.
  return null;
}
