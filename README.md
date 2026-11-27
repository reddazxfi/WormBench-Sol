# WormBench Weapon Studio

> Modern TypeScript & React Weapon Studio and Record Architect for **WormBench**.  
> Import legacy Project X `.wep` files, configure weapon records, preview PX hold art and 50 Hz missile flight sprites, and export ready-to-play mod packages.

Maintenance and hand-off notes live in [AGENTS.md](AGENTS.md).

---

## Features

- **Current WormBench bundle format**:
  - Automatically exports modern `wa.weapons.replace{ ... }` component specifications.
  - Generates complete bundle layout with `mod.toml`, `weapons/<mod_name>.lua`, and `profiles/<Profile Name>.toml`.
  - Automatically declares `dependencies = ["wf.sdk"]` for holds and `["wfws.sdk"]` for the flight sprite builder.
- **Read installed mods**:
  - Opens a `Mods/` folder or `.zip`, lists every bundle and weapon, and reads records kept in Lua (including `copy_from`, bundled `.wep` files and the native record groups).
  - Imports the WFWS features this editor writes: hold art, sprite-builder roles and `size`/`angle`, ribbon trail, explosion burst, sequential fire, terrain stamp, custom WAVs and pack sheets, with the bundle's own PNG/GIF/WAV files attached for re-export.
  - A whole bundle can be read as one pack, and the import says up front what an export cannot write as it stands (a carried `require` only the source bundle ships, a Lua error, an option the component does not declare), because one bad component takes the whole bundle down at load.
- **Project X `.wep` Binary Importer**:
  - Parses binary header `[0x06, 0xDD, 0xBB, 0x5A]`, Latin-1 name strings at `0x1E4`, and 0x1D0 bytes weapon record slabs.
  - Computes minimal diffs against stock templates (`stock.<slot>`) to prevent boilerplate noise.
  - Reads an air strike's munition body from the strike slab (`record.rs` `STRIKE_SHIFT = 0x14`): `strike.*` (plane, count, spacing, speed, sound, munition) plus the full `missile.*` body and the `clusters.*` / `clusters.bit.*` child body, exactly like a thrown missile's clustlets.
- **Hold & Sprite Builder Preview**:
  - Uses the PX posture strip (`aim.png`, 32 frames of 60×60) and hand radius textures (`hand_rad_lower.png`, `hand_rad.png`, `hand_rad_upper.png`) from `wf.sdk`.
  - Before a PNG is uploaded, the preview and the exported bundle use one hand-drawn fallback sprite (`spec/holyhandgrenade.png`, 64x64), so a bundle never points at a missing sprite and never carries anyone else's art.
  - Hold geometry is the engine's `worm_hold.rs` math verbatim: aim 0 is down, 31 is up, `weap_radius`/`weap_rotation`/`weap_radial_rotation` and the hand offsets, plus the put-away swing and shrink.
  - Two roles, each a complete editor tab: **Aim & Swing** (held sheet, strip, hand and weapon placement, offsets, put-away, the Space swing clip) and **Firing Frames** (the sheet WA draws on its two firing frames, with its own strip, window, hand and placement, and the option to replace the held weapon). Both are drawn by `sb.hold`, which also keeps the gun on a burst's repeat-fire frames, so a hold needs no external helper.
  - **Melee strikes**: `fireType = 'melee'` makes the aiming phase the attack. The claim eats WA's fire, the Space swing plays, and on its hit frame a scan box is tested against the living worms, whose reach, arc, hit tick, throw and damage are set in the record page's **Melee Strike** card. The card draws the same box in red over the aim preview, and reports whether the strike is live (`Melee hitscan: true`).
  - The `spec/pre_weapon_preview.png` landscape is the preview backdrop, with 1x–5x pixelated zoom and a true left/right facing flip.
- **50 Hz Missile Flight Sprite Preview**:
  - Reimplements the WFWS builder's `sb.flight` animation at a fixed 50 Hz game frame: `track`, `rotation`, `slow`/`medium`/`fast`, `none`, `cyclical` frames, `anim_speed`, `spin`, `mirror` and `scale`.
  - **WFWS role art**: the primary round, the cluster bits and each behaviour role (homing, homing bit, dig, the Sheep slot's own flown sheet) can keep WA's sprite, draw an uploaded sheet, or inherit the parent art. The Sheep slot only owns art when it is set to **Own sheet**; `anim = "roam"` rests the walk flat and tracks the heading in the air. Timed and walk art is signalled by the record's own fields (`homing.sprite`, `dig.dive_sprite`/`sprite_1..3`, `sheep.flight_1/2`, `roam.gas.animal_sprite`), with the Space takeoff for a roaming animal.
  - No terrain or collision simulation: the old Launch Simulator tab was retired because its collision loop could lock the renderer.
- **Modern Asset Workflow**:
  - 32×32 PNG icon importer and exporter (saved to `sprites/<mod_name>/icon.png`).
  - Single-sheet PNG hold artwork with `holds.PX_POSTURE` (no legacy GIF conversions).
  - Pack art for the record sprite fields the engine accepts an image in: the primary trail (`missile.trail.sprite`), the cluster bit sheet (`cluster.sprite`), the homing bit sheet (`cluster.homing_sprite`), the cluster bit trail (`clusters.bit.trail.sprite`) and the weapon's own body sheet (`sprite`), the last one is the only way to give an **air strike** its munition art, since the sprite builder has no primary missile to follow. Uploaded PNG/GIF files are written into `sprites/<mod_name>/` and declared in `mod.toml`.
  - Rotation sheets: bake a single projectile frame into a full 360° direction strip (16/32/64 frames, frame 0 pointing up and turning clockwise, WA's airmisl order) with the record's native animation set to follow the flight direction.
  - Effects-SDK ribbon trail for the main projectile: colour, core/glow width, length, sample rate and fade, emitted as `wf-lib/effects/trail` (`dependencies = ["effects.sdk"]`), with the choice of trailing only the main round or a whole cluster burst.
  - Effects-SDK explosion burst: Project X's electric-style ring + squashed lens (`wf-lib/effects/px_effects`), either drawn on top of WA's blast or replacing it with the SDK's damage/push/crater/sound (`custom_explosion`), with a 50 Hz preview.
  - **Effects emitter** (`effects.sdk`): sparks, glow, configurable reach bolts, ring and emitter ribbon follow the muzzle or the fired round. Set bolt direction and spread in screen coordinates, and preview the effect at 50 Hz. Any export that uses the effects library carries it at `wf-lib/effects_sdk/`, so players get the version the weapon was built against instead of a separate download.
  - **Terrain Stamp** (`wa.land.stamp`, no library needed): an up-pointing upload is baked into 32 clockwise cells and burned into the land where the round bursts, at the impact heading or a fixed angle, with `buried.soften`/`blend` and optional true colours, and no stamp where a live worm stands (it would be sealed into the land). **Damage On Impact** turns it into PX's javelin: the round damages every worm, mine, crate and oil drum at the impact point (its own kind, knockback and search radius), sticks in the land only when it hit nothing, and zeroes the record's own blast so nothing explodes twice. A built-in verb, so it adds no dependency; a native blast's crater erases it, so the card warns until the custom blast replacement is on.
  - Bundle Code page lists the `mod.toml` dependencies the features add automatically and lets you add extra SDK/mod ids (`effects.sdk`, `wf.sdk`, or your own).
- **Desktop Application (Tauri v2)**:
  - Native Windows desktop application with system menus, file dialogs, and native performance.

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (recommended) or [Node.js](https://nodejs.org/) v20+
- [Rust toolchain](https://www.rust-lang.org/) (for Tauri desktop builds)

### Web Development
```bash
# 1. Install dependencies
bun install

# 2. Run local development server
bun run dev

# 3. Build for production (web / dist)
bun run build

# 4. Dev only: generate the in-game behaviour test pack (60 weapons + profile)
bun run tools/gen_test_pack.ts
```

### Windows quick start
Double-click **`start-weapon-editor.bat`** in this folder. It opens a visible
console, installs dependencies if needed, starts the Express + Vite dev server
on <http://localhost:3000>, and opens your browser when the port is ready.
Keep the console window open; press `Ctrl+C` to stop it.

If the Express server cannot start, use **`start-weapon-editor-vite-only.bat`**
instead. It serves the UI alone on <http://localhost:5175>.

---

## Desktop App (Tauri v2)

The application is fully configured for **Tauri v2** desktop builds:

```bash
# Run desktop app in development mode
bun run tauri dev

# Build standalone Windows installer / executable (.msi / .exe)
bun run tauri build
```

The desktop binary will be output to `src-tauri/target/release/`.

---

## GitHub Deployment

### GitHub Pages
The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds the app and publishes `dist/` to GitHub Pages on every push to `main` (and from **Actions** > **Deploy Weapon Studio to GitHub Pages** > **Run workflow**).

1. Push this repository to GitHub.
2. Go to **Settings** > **Pages** and set **Source** to **GitHub Actions**. This must be done once by hand: the workflow does not create the Pages site for you.
3. If the repository is private, GitHub Pages requires a paid plan (Pro/Team/Enterprise); otherwise make the repository public.
4. Push to `main` again, or re-run the workflow from the **Actions** tab.

The site is served at `https://<user>.github.io/<repo>/`.

`vite.config.ts` uses `base: './'`, so the build works from any repository subpath, and `assetUrl()` resolves the logo and default sprites the same way in the dev server, Pages and the Tauri webview.

`wf-lib/effects_sdk/` is the SDK the weapon was generated against, written only when the weapon requires it. `wf-lib/wfws_sdk/` is the builder every export names.

### Tauri Desktop Builds
The `src-tauri/` project is included, so desktop installers can be built locally with `bun run tauri build`. There is no desktop release workflow in this repository yet.

---

## Hotkeys

| Key | Action |
|---|---|
| `1` | Switch to **Weapon Record** |
| `2` | Switch to **Hold & Sprite Builder** |
| `3` | Switch to **Bundle Code Preview** |

---

## Mod Layout Output
When clicking **Export Mod (.zip)**, the archive contains:
```text
<mod_name>/
  mod.toml
  weapons/<mod_name>.lua
  profiles/<Weapon Name>.toml
  weps/<file>.wep (only when "Use .wep weapon file" is enabled)
  sprites/<mod_name>/
    icon.png (if custom)
    hold.png (when hold art is enabled; the hand-drawn fallback is written until you upload a sheet)
    missile.png (when custom flight art is enabled; the hand-drawn fallback is written until you upload a sheet)
    trail.png / bit.png / bit_homing.png / bit_trail.png / body.png (only for the pack-art slots you uploaded)
wf-lib/wfws_sdk/ (the flight and aiming builder, so the weapon does not need a separate install)
wf-lib/effects_sdk/ (the ribbon, burst and emitter library, written only when the weapon uses it)
```
Drop the extracted folder into `WormBench/Mods/` next to `wf-lib/` and launch Worms Armageddon! If `Mods/wf-lib/effects_sdk` already exists, extracting updates it in place; keep one copy, because the engine refuses a mod installed twice.

---

## Credits and disclaimer

**This is an unofficial fan tool, not affiliated with Team17.**

**Worms Armageddon and its artwork belong to Team17.** The stock art this editor displays is Team17's, used only to preview a mod: the sprite-builder tab icons (Main, Home, Bits, HomeBit, Sheep, Dig), the frozen worm preview, and the terrain preview backdrop. The fallback sprite that fills an untouched export is hand-drawn for this project, not taken from the game. WormBench, the engine these bundles run on, is a separate community project, and this editor is a separate fan tool again.

**What an export contains:** the art you upload and, when you leave it in place, this project's own hand-drawn fallback sprite. No game art is copied into your mod, and nothing is uploaded anywhere: the editor runs entirely on your machine.

**You own what you make here, and you are responsible for it.** Weapons, bundles and anything else you build with this page are yours to publish or keep, and it is your call whether they are legal, appropriate and safe to share.

**Provided as is, no warranty.** Test an export in game before you rely on it; the editor's job is to write a valid bundle, not to make a weapon that plays well or fairly.
