# AGENTS.md, WormBench Sol Weapon Studio

Canonical repository: `C:\Users\lucia\Documents\GitHub\WormForge Weapon Editor` (the folder name predates the WormBench-Sol rename).
Do not edit the old duplicate at `...\Worm-Forge-Lua-Editor\WormForgeWeaponEditor` or the companion code editor (**WormBench-Luna**, local folder `...\Worm-Forge-Lua-Editor` / `...\WormBench-Luna`).
The engine ground truth is the `WormBench-engine` checkout (a local copy may still be named `WormForgeNew`).
Detailed bug postmortems, changelogs, and design history live in `wf_weapon_editor_notes.md`; keep this file focused, factual, and under 21 KB.

---

## 0. Read this first: the engine is turn based and lockstep

Worms Armageddon is turn-based, and WormBench runs it as a deterministic lockstep simulation:

- **One worm acts at a time.** `wa.world.keys()` is that player's synchronised keyboard state (`space`, `digit`, arrows), identical on every peer. There is no concurrent turn worm: never build multi-worm turn maps for what cannot happen.
- **Simulate only from synchronised state**: `wa.world.frame()`, `wa.world.keys()`, `wa.random`, `wa.math.sin/cos/atan`, and world state. Never use `math.random`, `math.sin/cos/atan`, wall time, render FPS, or `pairs()` in simulation code (`ipairs`, numeric loops, or `next`). Never mutate simulation state in `wa.on.draw`.
- **Decide durations in 50 Hz ticks** from a stored start frame (`wa.world.frame()`). Custom animations (`wfws_swing`, `wfws_firing`) take/hold the worm and run their own clock instead of watching WA's state machine.
- **Handle real interruptions**: turn end, worm death, weapon swap/drop, or panel change must cleanly release/settle before the next turn.

---

## 1. Scope & Repository Layout

React 19 + TypeScript + Tailwind v4 editor for **WormBench 1.0 RC3 / Lua API 5** weapons (`.wep` import, `.pxl` library browsing, installed bundle import/round-trip, full Lua/TOML/asset bundle export, web / local server / Tauri v2 desktop):

```text
src/
├─ App.tsx                         # PackProject state, activeIndex, theme, hotkeys, page shell
├─ components/
│  ├─ Sidebar.tsx / PackRail.tsx   # desktop nav + mobile bar + multi-weapon bundle rail
│  ├─ WeaponSettings.tsx           # loadout card, donor/slot/icon, defaults, WeaponOptionsPanel
│  ├─ PackSettingsCard.tsx         # multi-weapon bundle identity, mod_icon, replaces, profile
│  ├─ RecordEditor.tsx             # workbench tabs + section cards
│  ├─ BeamCard.tsx / BeamPreBufferCard.tsx / BeamPreview.tsx
│  ├─ AirstrikeCard.tsx / AirstrikePreview.tsx
│  ├─ FireSequenceCard.tsx / MeleeCard.tsx
│  ├─ HoldPreview.tsx              # hold builder (3-col) + 6-slot flight art builder
│  ├─ EffectsWorkspace.tsx / EffectsCards.tsx / ExplosionPreview.tsx
│  ├─ EmitterCard.tsx / EmitterPreview.tsx / RibbonTrailPreview.tsx
│  ├─ TerrainStampCard.tsx / PoisonDoseField.tsx / StockSpriteInput.tsx
│  ├─ PackSpriteUpload.tsx / SheetFrameWarning.tsx / BundleDependencies.tsx
│  ├─ WepImportModal.tsx / ModBrowserModal.tsx / PxlLibraryModal.tsx / PxlPickerModal.tsx
│  └─ CarriedLuaPanel.tsx / LuaPreviewModal.tsx / TooltipTap.tsx (ProjectileSimulation unused)
├─ data/
│  ├─ recordTabs.tsx / recordSchema.ts / stockWeapons.ts / stockDonors.json
│  ├─ spriteBuilder.ts / aimClip.ts / melee.ts / beam.ts / beamAssets.ts / airstrike.ts
│  ├─ fireSequence.ts / explosionPresets.ts / emitter.ts / poison.ts / soundPresets.ts
│  ├─ terrainStamp.ts / luaHooks.ts / sdkModules.ts / wfwsSdk.ts / effectsSdk.ts
├─ types/weapon.ts / pxl.ts
└─ utils/
   ├─ wepParser.ts / luaGenerator.ts / luaCheck.ts / luaText.ts / api4Migration.ts
   ├─ modExporter.ts / packExporter.ts / pack.ts / weaponId.ts / sheetDedupe.ts
   ├─ defaultArt.ts / placeholderSprites.ts / assetUrl.ts / sheetTint.ts / sheetFrames.ts
   ├─ modLib/{scan,loadFiles,modToml,luaTable,luaStrings,mapRecord,importFeatures,importWeapon,importPack,splitModule,ownOutput,carryClosure}.ts
   └─ pxl/{readPxl,readWepManifest,readSpriteScripts,loadPxl,importPxlWeapon}.ts
spec/lua_sdk/
├─ wfws_sdk/                       # wfws.sdk 1.1.5: wfws_sprite_builder, wfws_trail, wfws_swing, wfws_airstrike, wfws_firing
└─ effects_sdk/                    # effects.sdk 1.0.1: trail, px_effects, custom_explosion
src-tauri/                         # Tauri v2 desktop app (native Save As for exports)
tools/                             # check_*.ts, audit_*.ts, gen_test_pack.ts, lua/harness_*.py
```

---

## 2. Commands & Build Rules

```powershell
bun install            # install dependencies (bun.lock committed)
bun run dev            # Express + Vite at http://localhost:3000
bun run lint           # tsc --noEmit (0 errors required)
bun run build          # vite build -> dist/
bun run preview        # preview dist/
bun run tauri:dev      # desktop dev
bun run tauri:build    # desktop installer
```

- Visible Windows launchers: `start-weapon-editor.bat` (full server) and `start-weapon-editor-vite-only.bat` (UI on 5175).
- Always run TypeScript check scripts via `bun run tools/<script>.ts` (not `npx tsx`, because scripts import Vite `import.meta.env`).
- Vite uses `base: './'` (GitHub Pages, Tauri, subpath roots). Resolve every `public/` asset through `assetUrl()`.

---

## 3. App Architecture, UI & Copy Rules

- **Bundle state (`App.tsx`)**: Owns one `PackProject`, `activeIndex`, and derived active `WeaponProject`. `updateProject(patch)` merges and rebases on donor changes (`rebaseToDonor`), then persists via `withWeapon` (preserving a sole weapon's equality via `syncPackToSoleWeapon`, or folding multi-weapon entries into `<packId>.<leaf>` via `foldWeaponIntoBundle` + `retargetWeaponArt`).
- **Workspace navigation**: `activeTab: 'editor' | 'hold' | 'effects' | 'code'` (hotkeys `1`–`4`, ignored inside inputs/selects/contentEditable).
- **Record workbench (`visibleRecordTabs`)**: Owned by `RecordEditor` tab bar:
  - Projectiles / air strikes: `missile`, `action`, `burst`, `sprite`, `callbacks` (Explodes Into holds Ejection, Bit Targets, Bit Action; `bitActionOf()` resolves bit action).
  - Beams (`fireType === 'beam'`): `beam` (Beam & Cone), `beam_prebuffer` (Pre-Buffer Beam), `beam_explosion` (Impact Explosion), `callbacks` (Lua Script).
  - Melee (`fireType === 'melee'`): `melee`, `callbacks`. Mines, tools, sprays, teleports: their own setup page + `callbacks`.
- **Effects & Libraries (`EffectsWorkspace.tsx`)**: Hosts Ribbon Trail (`RibbonTrailPreview`), Explosion Burst (`ExplosionPreview`, enabled for missiles/mines/airstrike missiles/sequenced missiles/beams), Effect Emitter (`EmitterCard` + `EmitterPreview`), Custom WAVs, Firing Sequence (`FireSequenceCard`), and Terrain Stamp (`TerrainStampCard`). New library integrations go here, not in record tabs.
- **UI & Style**:
  - Tailwind v4 + `stone` neutrals; light mode default (`localStorage['wf_theme_v2']`); `index.css` holds `@theme` tokens (`forge` primary/blast, `amber` actions/alerts, `sky` art/setup, `rose`/`red` destructive/warnings only; never reintroduce `emerald-*` or `green-*` utility classes).
  - **Zero em dashes** anywhere in UI, Lua comments, tools, or docs; use commas/colons instead. No `"API 4.0"` UI wording (say `"WormBench format"` / `"WormBench bundle"`).
  - Mount `TooltipTap` once in `App` so `title` help icons work cleanly on touch devices.
  - Validate strip heights with `SheetFrameWarning` (`height % frames === 0`); use `StockSpriteInput` for record sprite fields (auto-resolving names/IDs and flagging `0x10000` masks).
  - All 50 Hz previews (`HoldPreview`, `RibbonTrailPreview`, `ExplosionPreview`, `EmitterPreview`, `BeamPreview`, `AirstrikePreview`) use SDK math + nearest-neighbour sampling where appropriate (`imageSmoothingEnabled = false` on `BeamPreview`). Default unuploaded sprite is hand-drawn `spec/holyhandgrenade.png` (`public/assets/defaults/default_hand_grenade.png`). Keep footer credits in `App.tsx` aligned with `README.md`.

---

## 4. Domain Model & Importers (`.wep`, `.pxl`, `modLib`)

- **WormBench bundle layout**: `mod.toml` (`api_version = 5`, `format_version = 2`), `weapons/<mod>.lua`, `profiles/<Name>.toml`, optional `weps/<file>.wep`, `sprites/<mod>/*`, `sounds/<mod>/*`, plus `wf-lib/wfws_sdk/` (always) and `wf-lib/effects_sdk/` (when effects are used). `copy_from = "stock.<slot>"` and `wep = "..."` are mutually exclusive.
- **Weapon options (`[[components.options]]`)**: Declared on the component; only non-default values are written to `profiles/<Name>.toml` under `[options."<id>"]`. `data = true` binds an integer weapon data field.
- **API 5 compatibility**: Importer dual-reads API 4 (`cluster = { ... }`, `:hurt`, `on_bump`) and API 5 (`cluster_sprite`, `cluster_homing_sprite`, `:hit`, `on_contact`) and auto-runs `migrateApi4Lua` (`src/utils/api4Migration.ts`) on `api_version < 5` bundles. Pending engine keys missing from older `wbcheck` builds live in `PENDING_ENGINE_KEYS` in `tools/check_pack_fixture.ts`.
- **`.wep` parser (`wepParser.ts`)**: Magic `[0x06, 0xDD, 0xBB, 0x5A]`, Latin-1 name at `0x1E4`, `0x1D0` record slab at byte 4. Air strikes apply `STRIKE_SHIFT = 0x14` to body fields (not `strike.*`). Use `decodeRecordId()` to strip `0x10000` flags and `??` everywhere for numbers so `0` survives. Stores decoded `wepBaseline` for diffing; never trust filenames over decoded fields.
- **`.pxl` reader (`src/utils/pxl/`)**: Zero-copy slice parser `readPxl`, `0x1E4` trailer `readWepManifest`, C-script scanner `readSpriteScripts` (`GetAttachment`/`LoadSprite`, `CWormAnimParams`, `WeapSpriteParams`, `CSoundFile`), and `importPxlWeapon` (`scriptHold` vs `project.wormSprites` poses + `SpritePickButton` picker).
- **Mod reader (`src/utils/modLib/`)**:
  - `modToml.ts` / `scan.ts`: Engine-exact component entry and `require` resolution (`wf-lib/` resolved per calling bundle `[exports]`), inline `default_position`, component-scoped options, folder sprite strips composed via canvas (`frameFolderFiles`).
  - `luaTable.ts` / `luaStrings.ts`: Extracts literal tables + `readCallTable` call arguments + `local CONST = "..."` string concatenations without executing Lua.
  - `mapRecord.ts` / `importFeatures.ts`: Full inverse of `luaGenerator.ts` (record groups, `recordExtra`, hold, flight roles, trail, explosion burst/blast, emitter, `fireSequence`, `airstrike`, `beam` + `pre_buffer` + `explosionEffect`, `terrainStamp` + `STAMP_HIT`, custom WAVs, `melee`). Balanced block scanner `extractBalancedLuaBody` + `maskLuaCode` avoids comment/nested-`end` misparses. Legacy beam `fx.burst` without `thickness`/`duration` stays in `beam.impactBurst`; full bursts/blasts import into `project.explosionEffect`.
  - `splitModule.ts` / `ownOutput.ts` / `carryClosure.ts`: Splits modules into preamble, install statements, `wa.on.*` registrations (filtering `worm_message` -> `msgs`, `body_move` -> `kinds`), and claim hooks; traces lexical block closures transitively, strips/re-emits `NOT_GENERATED_OPEN/CLOSE` markers around unmodelled code for idempotent round-trips, rewrites lockstep RNG/trig (`fixLockstepRng`), moves art paths cleanly, and wires `CarriedLuaPanel`.
  - `stockDonors.json` & `recordField.ts`: 70 decoded donors; panels read override -> donor/wep baseline -> fallback (`tools/gen_stock_donors.ts` regenerates). `checkLua` (`luaCheck.ts`) mirrors `wbcheck` rule IDs/severities (`error` findings block export).

---

## 5. Generator & SDK Contracts (`luaGenerator.ts`, `wfws.sdk`, `effects.sdk`)

- **Diff-based emission**: Diff against `wepBaseline` (`useWepFile`) or `donorBaseline` (stock donors). Refuse unknown `copy_from` templates cleanly with a comment (checked by `check_copyfrom.ts` and `gen_test_pack.ts`). Always emit `effectiveSlot(project)` (`slot || based_on || 'grenade'`) for both manifest `default_position` and profile `stock.<slot>`.
- **Record invariants**: Actions (`none`/`bounce`/`homing`/`roam`/`dig`) and bursts (`nothing`/`clusters`/`fire`) are mutually exclusive. Never combine `worms` (`0x3C`) with individual worm collision flags (expand `worms` instead). Switching actions/clustlet actions emits the destination group in full (`+0xA8..+0xD0` slab aliasing); drop empty tables so re-exports never drift.
- **Flight sprite builder (`sb.flight`, `wfws_sprite_builder.lua`)**:
  - Forces `sprite = 0` on primary missiles (except stock walk poses) and emits `hold_as = "stock.<weapon>"` (`holdAsFor`) on thrown/placed donors unless hold art or melee owns the hands.
  - `classify` detects cluster bits by time/radius burst spawn window (`bit_window`/`bit_radius`, or `is_bit` / future `m.bit`), returning `sb.role(id)`.
  - `anim = "roam"` mirrors horizontally (`facing = -1`, negated angle) with `roamTilt`; `sheep_sprites = { a, b }` uses two 32-frame strips and writes the `699` sentinel to `sheep.flight_1/2` while flying; a grounded animal (`roamConfig.grounded`) writes `0` and drops `roam` instead. Digging zeroes native `dig.*` sprites and probes terrain. Homing swaps timing via `a:look(sheet)`. Per-missile state expiry uses `wa.world.frame()`.
- **Aim layer & Melee (`sb.hold` / `wfws_swing.lua`)**:
  - `holdNeedsAimLayer` switches to `wa.draw.quad` rendering, muting WA's engine hand via `silent.png` and claiming every sheet path (`params = { gpu_prefix = "sprites/" }`).
  - `anim_speed = fps / (1.5 * frames)`. `hold.sheetFrames` controls `[sprites] frames`; `hold.frames` indexes cells. `draw_hand = false` emits `hand_radius = 0.01`, and `sb.hold` parks the engine hand at that radius but scales it to `0.001`; a parked hand at full scale still draws in the middle of the worm because the engine has no `draw_hand` key.
  - `ws.counter` caps at `21` so aim draw-out reaches `hold_grow(20) = 1.0` matching `buffer`/`fire` role scale. Supports `sb.hold_trigger(w, "buffer" | "fire" | "stop")`, 60 px `extra_hand`, and `aim_clamp` (`worm:input{ aim = deg }` in `body_move` + `hand_radius = 0.01` parking plus `hand_scale = 0.001`).
  - Swings take the worm (`worm:take{ turn = "freeze", fire = true }`) and run deterministically from `wa.world.frame()`. **Melee** fires an invisible ghost shot (`fuse == max(retreat, 500)`) and never zeroes the turn clock; strike scan follows raw worm aim unless `follow_swing = true`, uses >= hit_frame latch, handles per-strike `lift` and WAVs via `meleeStrikes()`, and compares `worm.id`.
- **Beams & Sequenced Firing (`wfws_firing.lua`)**:
  - Supports `firing.beam`, `firing.beam_buffer`, `firing.sequence`, `firing.launch`, `firing.actor`, and `firing.install_fuse` (digit-key 1..5s sampler).
  - Sustained beams use `beam_guard` / `beam_release_guard` + `M.reset` to hold `shots_fired = 0; shots_to_fire = 1` across `buffer + grow + hold`, track live aim (`beam_update_live_aim`, re-trace, periodic `beam_apply_cut`), drain repeat `on_fire` (`DRAIN_DEFAULT`), and set `gun.shot_interval_ms = 0` + `SEQ.tail_frames`.
  - Cut shapes: `cut_shape = "circle"` (with `cut = radius`), `"drill"`, `"torch"` (facing + clamped aim angle).
  - Visual painter matches `BeamPreview.tsx` (`imageSmoothingEnabled = false`, 3x kink table `beam_kinks`, >= 45% end taper width, inward-shifted `end_sprite` caps, `look = "trail"` normalized to ribbon).
  - **Pre-Buffer Beam (`pre_buffer`)**: Supported in both `M.beam` and `M.beam_buffer`, with terrain trace (`beam_resolve_buffer_len`), `grow` / `full` / twin-rail `converge` reach, `straight` / `arc` / `jagged` paths, custom orb scale/motes, tint/rainbow, alpha ramp, pulse, flicker, texture style, and depth. Claim extra `preBuffer.artStyle` sheets in `sprites`.
- **Airstrike takeover (`wfws_airstrike.lua`)**: `air.install` + `air.strike` with flyover curves, 7 release patterns, articulated parts, nested `projectile = { ... }` + `is_bit = air.is_bit`, and strafe/crash FX. Native air strikes cannot run `on_explode` or `cluster_homing_sprite`.
- **Effects (`effects.sdk` 1.0.1)**:
  - **Ribbon trail**: Registered after `sb.flight`, waits one frame when `sb.role` is undecided (`nil`).
  - **Explosion burst & blast (`emitExplosionEffectLines`)**: Shared helper for native `on_explode` and beam `on_impact`. Distinguishes `silencesBlast` (zeros native missile/mine blast in record) from `needsCustomExplosionLib` (requires `custom_explosion` for `mode === 'blast'`, including beams). Sets `fx.install{ depth = { burst = wa.depth.FRONT } }` and always requires `trail` alongside `fx`. `effects.sdk` adopts orphaned component effects by longest ID prefix.
  - **Emitter (`fx.emitter`)**: Never writes `on_fire`. Muzzle tracks via deduplicated `FRAME_FINISH`; rounds (and placed mines via `on_place` + `wa.mines`) track per ID via `EMITTER_ROUNDS`. Defaults `followFireAngle` on.
  - **Electric & Poison**: `px.electric` arms hits via `local zap` (declared at module top, required inside `install`) + optional `taze_mine`; never require `wa`-reading modules at top level. Poison uses `worm:poison(n)` status doses (`PoisonDoseField`), never `kind = "poison"`.
  - **Terrain stamp & pierce**: Bakes 32-frame strips (`frames = 32`, `stampAngleForFrame` returns degrees), clears worms via `STAMP_CLEAR`, or replaces blast with `STAMP_HIT` (`silencesBlast`).

---

## 6. Export Contract (`packExporter.ts`, `modExporter.ts`)

- One emitter `weaponBundlePart` + `emitPackFiles(pack, libraries, fetchBytes)` for both 1-weapon (`syncPackToSoleWeapon`) and N-weapon packs (`PackLibraries` args keep it runnable in Bun without Vite `?raw`).
- Bundles `wf-lib/wfws_sdk/` in every export, and `wf-lib/effects_sdk/` (with sheets copied as bytes) whenever `wf-lib/effects/` appears in generated/carried Lua.
- `sheetDedupe.ts` deduplicates identical sheet bytes whose `[sprites."..."]` declarations (`frames`, `fps`, `play`) match, rewriting Lua quotes and manifest entries once per pack; `weps/<slug>/<file>.wep` isolates `.wep` files in multi-weapon packs.
- `validateBundle` runs before ZIP output and refuses duplicate/unnamespaced IDs, missing files, duplicate TOML sprite tables, and blocking `checkLua` errors. Tauri exports use the native Save As dialog and write the chosen path; browser builds download normally.

---

## 7. Validation Recipes

Run core checks before finishing any change (add Playwright UI checks for UI work, and `wbcheck.exe` on exported bundles when verifying manifest/Lua compliance):

```powershell
bun run lint                               # tsc --noEmit (0 errors)
bun run build                              # vite build -> dist/
bun run tools/gen_test_pack.ts             # builds test_pack/wftest_pack + README.md
bun run tools/check_copyfrom.ts            # donor baselines, diffs, hold_as
bun run tools/check_sheet_dedupe.ts        # sheet dedupe & TOML declarations
bun run tools/check_pack_roundtrip.ts      # pack emitter, namespacing, validation
bun run tools/check_pack_fixture.ts        # byte-identical disk round-trip + wbcheck
bun run tools/check_generator_edges.ts     # edge cases (beams, preBuffer, poison, cutShape, etc.)
bun run tools/check_mod_import.ts          # full feature import round-trip
bun run tools/check_lua_hooks.ts           # module splitting & hook registry
bun run tools/check_carried_lua.ts         # closure carry, lockstep rewrites, art relocation
bun run tools/check_lua_rules.ts           # luaCheck severity/rule parity
bun run tools/check_module_scan.ts         # modLib module/require/option discovery
bun run tools/check_pxl.ts                 # PXL parser parity & imports
bun run tools/audit_records.ts             # record schema & mask invariants
bun run tools/audit_bundles.ts             # full installed Mods/ round-trip audit
```

Python `lupa` SDK harnesses (`python tools/lua/<name>`):
- `harness_firing.py` (beams, pre_buffer, cut_shape, sustained live_aim, sequence, fuse, homing)
- `harness_hold_states.py` (draw-out scale `1.0`, role switching, passive suppression)
- `harness_melee.py` (swing clip, box geometry, aim clamp, combo audio, taze_mine)
- `harness_flight.py`, `harness_flight_trail.py`, `harness_effects.py`, `harness_emitter_weapon.py`, `harness_trail_bits.py`, `check_roles.py`

Compiler & smoke checks:
- `& 'C:\Users\lucia\Documents\GitHub\Worm-Forge-Lua-Editor\compiler-cli\target\release\wbcheck.exe' --format pretty '<bundle>'` (WormBench-Luna CLI)
- Playwright headless Edge smoke (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`), plus serve `dist/` under a fake `/repo/` subpath to verify relative `assetUrl()` paths.

---

## 8. Critical Gotchas, Scope & Maintenance

- **Two worm handles are never `==`**: Always compare `worm.id` (`team * 16 + index`), not userdata equality.
- **No module-level `wa.*` calls**: Component files return data definitions only; declare upvalue `local zap` / helpers at top and require/use `wa` inside `install` or callbacks.
- **`wa._mod` is the component ID, not bundle ID**: Keep per-component registries aware of sibling components.
- **One handler, one `onChange`**: Spreading stale `project` twice drops the first edit; batch via `updateOverrides(patch)` or single `onChange`.
- **Keep `0` and `false`**: Always use `??` (never `||`) for record numbers and booleans; remember `stampAngleForFrame` returns degrees.
- **Out of scope**: Companion Lua editor (**WormBench-Luna** / `Worm-Forge-Lua-Editor`), silencing `wbcheck` upstream positives inside this repo, AI Studio leftovers (`metadata.json`), "API 4.0" strings.
- **Maintenance**: Keep generator diff-based, parser zero-safe, `AGENTS.md` concise (**<= 21 KB**), and append detailed engineering write-ups to `wf_weapon_editor_notes.md`.
