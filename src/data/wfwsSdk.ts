// The exported ZIPs ship the wfws.sdk library, so the editor needs its files as
// strings. They are imported straight from `spec/` with Vite's `?raw`: one
// source of truth, so editing the SDK under `spec/lua_sdk/wfws_sdk/` reaches
// every export with no copy to keep in sync (the old hand copy drifted).
import wfwsSdkToml from '../../spec/lua_sdk/wfws_sdk/mod.toml?raw';
import wfwsSpriteBuilderLua from '../../spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua?raw';
import wfwsSwingLua from '../../spec/lua_sdk/wfws_sdk/lib/wfws_swing.lua?raw';
import wfwsAirstrikeLua from '../../spec/lua_sdk/wfws_sdk/lib/wfws_airstrike.lua?raw';
import wfwsFiringLua from '../../spec/lua_sdk/wfws_sdk/lib/wfws_firing.lua?raw';

/** mod.toml for the wfws.sdk library bundle. */
export const WFWS_SDK_MOD_TOML = wfwsSdkToml;

/** `wf-lib/wfws_sprite_builder`, the module the generated weapon requires. */
export const WFWS_SPRITE_BUILDER_LUA = wfwsSpriteBuilderLua;

/** `wf-lib/wfws_swing`, the melee & swing simulation module. */
export const WFWS_SWING_LUA = wfwsSwingLua;

/** `wf-lib/wfws_airstrike`, the lockstep airstrike takeover module. */
export const WFWS_AIRSTRIKE_LUA = wfwsAirstrikeLua;

/** `wf-lib/wfws_firing`, the lockstep firing & burst sequencer module. */
export const WFWS_FIRING_LUA = wfwsFiringLua;

/**
 * Sheets declared in `spec/lua_sdk/wfws_sdk/mod.toml` (e.g. `sprites/beam_orb.png`),
 * resolved as Vite asset URLs so exports always match the manifest.
 */
export const WFWS_SDK_SHEETS: { path: string; url: string }[] = Object.entries(
  import.meta.glob('../../spec/lua_sdk/wfws_sdk/sprites/**/*.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>,
)
  .map(([source, url]) => {
    const at = source.indexOf('sprites/');
    const relative = at >= 0 ? source.slice(at) : source.split('/').pop();
    return { path: `wf-lib/wfws_sdk/${relative}`, url };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
