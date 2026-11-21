/**
 * `.pxl` container, `.wep` manifest, sprite-script scanner, and Python oracle
 * parity check.
 *
 * Run: `bun run tools/check_pxl.ts` (exits 1 on failure).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { missingLibraryRequires, parsePxlLibrary, resolvePxlArt } from '../src/utils/pxl/loadPxl';
import { PxlReadError, readPxl } from '../src/utils/pxl/readPxl';
import { importPxlWeapon } from '../src/utils/pxl/importPxlWeapon';
import { readSpriteScripts } from '../src/utils/pxl/readSpriteScripts';
import { emitPackFiles, type PackLibraries } from '../src/utils/packExporter';
import { generateLuaCode, singleWeaponPack } from '../src/utils/luaGenerator';
import { readBundles, readWeapons, type ModFile } from '../src/utils/modLib/scan';
import { importBundleWeapon } from '../src/utils/modLib/importWeapon';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../src/data/defaults';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';
import { DEFAULT_ROLE_ART } from '../src/data/spriteBuilder';
import { DEFAULT_TERRAIN_STAMP } from '../src/data/terrainStamp';
import { stockDonor, stockDonorBaseline } from '../src/data/stockDonors';
import type { WeaponProject } from '../src/types/weapon';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
};

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

function digestOf(buffer: ArrayBuffer, fileName: string): string {
  const raw = readPxl(buffer, fileName);
  return raw.items.map((it) => `${it.name}:${it.length}`).join('\n');
}

function pythonDigest(filePath: string): string {
  const out = execFileSync('python', [resolve('spec/PX/pxl_extract.py'), '--digest', filePath], {
    encoding: 'utf8',
  });
  return out.replace(/\r\n/g, '\n').trim();
}

// 1. Committed spec/PX/*.pxl script fixtures
{
  const psbPath = resolve('spec/PX/p_sprite_builder.pxl');
  const redPath = resolve('spec/PX/red_sprite_builder.pxl');
  const psbBuf = toArrayBuffer(readFileSync(psbPath));
  const redBuf = toArrayBuffer(readFileSync(redPath));

  const psb = parsePxlLibrary(psbBuf, 'p_sprite_builder.pxl');
  const red = parsePxlLibrary(redBuf, 'red_sprite_builder.pxl');

  check('p_sprite_builder item count', psb.items.length === 3, `got ${psb.items.length}`);
  check('p_sprite_builder scripts count', psb.scripts.length === 3, `got ${psb.scripts.length}`);
  check('red_sprite_builder item count', red.items.length === 1, `got ${red.items.length}`);
  check('red_sprite_builder scripts count', red.scripts.length === 1, `got ${red.scripts.length}`);

  check(
    'p_sprite_builder frameCounts hand_rad.png === 1',
    psb.parsedScripts.frameCounts.get('hand_rad.png') === 1,
    `got ${psb.parsedScripts.frameCounts.get('hand_rad.png')}`,
  );
  check(
    'p_sprite_builder frameCounts def_shot_aim_p.png === 32',
    psb.parsedScripts.frameCounts.get('def_shot_aim_p.png') === 32,
    `got ${psb.parsedScripts.frameCounts.get('def_shot_aim_p.png')}`,
  );
  check(
    'p_sprite_builder frameCounts fg_par.png === 3',
    psb.parsedScripts.frameCounts.get('fg_par.png') === 3,
    `got ${psb.parsedScripts.frameCounts.get('fg_par.png')}`,
  );

  check(
    'python oracle digest matches p_sprite_builder.pxl',
    digestOf(psbBuf, 'p_sprite_builder.pxl') === pythonDigest(psbPath),
  );
  check(
    'python oracle digest matches red_sprite_builder.pxl',
    digestOf(redBuf, 'red_sprite_builder.pxl') === pythonDigest(redPath),
  );
}

// 2. Comment stripping & script scanner edge cases
{
  const parsed = readSpriteScripts([
    `
    // f = GetAttachment("commented_out.png");
    // commented = LoadSprite(f, 99, 0);
    /*
       f = GetAttachment("block_comment.png");
       block_c = LoadSprite(f, 88, 0);
    */
    local s = LoadSprite(GetAttachment("direct.png"), 7, 0);
    f = GetAttachment("first.png"); a = LoadSprite(f, 4, 0);
    f = GetAttachment("first.png"); b = LoadSprite(f, 9, 0); // first wins
    `,
  ]);
  check('commented GetAttachment ignored', !parsed.frameCounts.has('commented_out.png'));
  check('block-comment GetAttachment ignored', !parsed.frameCounts.has('block_comment.png'));
  check('direct LoadSprite(GetAttachment) parsed', parsed.frameCounts.get('direct.png') === 7);
  check('duplicate attachment keeps first', parsed.frameCounts.get('first.png') === 4);
}

// 3. Error codes on malformed inputs
{
  let code = '';
  try {
    readPxl(new ArrayBuffer(4), 'tiny.pxl');
  } catch (err) {
    code = (err as PxlReadError).code;
  }
  check('truncated buffer raises pxl-truncated', code === 'pxl-truncated', code);

  code = '';
  try {
    readPxl(new Uint8Array(16).buffer, 'badmagic.pxl');
  } catch (err) {
    code = (err as PxlReadError).code;
  }
  check('bad magic raises pxl-magic', code === 'pxl-magic', code);

  code = '';
  try {
    const buf = new ArrayBuffer(16);
    const bytes = new Uint8Array(buf);
    bytes.set([0x02, 0x01, 0xcd, 0x1b, 0x00]);
    new DataView(buf).setUint32(5, 99999, true);
    readPxl(buf, 'toomany.pxl');
  } catch (err) {
    code = (err as PxlReadError).code;
  }
  check('excess item count raises pxl-count', code === 'pxl-count', code);

  code = '';
  try {
    const buf = new ArrayBuffer(20);
    const bytes = new Uint8Array(buf);
    bytes.set([0x02, 0x01, 0xcd, 0x1b, 0x00]);
    new DataView(buf).setUint32(5, 2, true);
    readPxl(buf, 'badresync.pxl');
  } catch (err) {
    code = (err as PxlReadError).code;
  }
  check('unparseable payload raises pxl-resync', code === 'pxl-resync', code);
}

// 4. Installed Project X Libs corpus (skipped explicitly if I: is unmounted)
const LIBS_DIR = 'I:\\Games\\WA 3.6.31.0 + Project X by 0rang3\\Libs';
if (!existsSync(LIBS_DIR)) {
  console.log(`SKIP  PX Libs corpus check: ${LIBS_DIR} is not mounted`);
} else {
  const cases: { file: string; expectedItems: number }[] = [
    { file: 'weapon_tazer.pxl', expectedItems: 9 },
    { file: 'weapon_javelin_sb.pxl', expectedItems: 7 },
    { file: 'cweps.pxl', expectedItems: 132 },
    { file: 'cweps_gfx.pxl', expectedItems: 271 },
  ];

  const libs: Record<string, ReturnType<typeof parsePxlLibrary>> = {};

  for (const c of cases) {
    const p = resolve(LIBS_DIR, c.file);
    const buf = toArrayBuffer(readFileSync(p));
    const lib = parsePxlLibrary(buf, c.file);
    libs[c.file] = lib;

    check(`${c.file}: item count === ${c.expectedItems}`, lib.items.length === c.expectedItems, `got ${lib.items.length}`);
    check(
      `${c.file}: every weapon block starts with 06 DD BB 5A`,
      lib.weapons.every((w) => {
        const b = w.bytesOf();
        return b[0] === 0x06 && b[1] === 0xdd && b[2] === 0xbb && b[3] === 0x5a;
      }),
    );
    check(`${c.file}: Python --digest matches`, digestOf(buf, c.file) === pythonDigest(p));
  }

  // Tazer manifest check
  const tazerLib = libs['weapon_tazer.pxl'];
  const tazerWep = tazerLib.weapons[0];
  check('Tazer manifest name === "Tazer"', tazerWep?.name === 'Tazer', tazerWep?.name);
  check('Tazer manifest icon === "ico_tazer.png"', tazerWep?.icon === 'ico_tazer.png', tazerWep?.icon);
  check(
    'Tazer manifest 6+ hold art names present',
    ['wtazer.png', 'wtazeru.png', 'wtazerd.png', 'wtazlnk.png', 'wtazlnku.png', 'wtazlnkd.png'].every(
      (n) => tazerWep?.art.includes(n),
    ),
    JSON.stringify(tazerWep?.art),
  );

  // Javelin script & import check
  const javLib = libs['weapon_javelin_sb.pxl'];
  check(
    'javelin_script: spb_javelin.png -> 12',
    javLib.parsedScripts.frameCounts.get('spb_javelin.png') === 12,
    `got ${javLib.parsedScripts.frameCounts.get('spb_javelin.png')}`,
  );
  check(
    'javelin_script: javelinspb.png -> 12',
    javLib.parsedScripts.frameCounts.get('javelinspb.png') === 12,
    `got ${javLib.parsedScripts.frameCounts.get('javelinspb.png')}`,
  );
  const javImport = importPxlWeapon(javLib.weapons[0], javLib, [javLib]);
  check('Javelin import succeeds', javImport.success, javImport.error);
  check('Javelin hold frames === 12', javImport.project?.hold?.frames === 12);
  check(
    'Javelin hold weapRadius === -11.8',
    javImport.project?.hold?.weapRadius === -11.8,
    `got ${javImport.project?.hold?.weapRadius}`,
  );
  check('Javelin hold drawHand === false', javImport.project?.hold?.drawHand === false);
  check(
    'Javelin flight sprite frames === 12',
    javImport.project?.missileSprite?.frames === 12,
    `got ${javImport.project?.missileSprite?.frames}`,
  );
  check(
    'Javelin offers longbow_impact.wav',
    javImport.offeredSounds.includes('longbow_impact.wav'),
    JSON.stringify(javImport.offeredSounds),
  );

  // Tazer import check (direct worm_sprites pose sheets, not Sprite Builder hold)
  const tazerImport = importPxlWeapon(tazerWep, tazerLib, [tazerLib]);
  check('Tazer import succeeds', tazerImport.success, tazerImport.error);
  check('Tazer icon attached', !!tazerImport.project?.customIconFile);
  check('Tazer leaves Sprite Builder hold disabled', !tazerImport.project?.hold?.enabled);
  check('Tazer enables wormSprites', tazerImport.project?.wormSprites?.enabled === true);
  check(
    'Tazer weaponlnk is 32 frames, wthrow is 10 frames, weaponfire is 32 frames',
    tazerImport.project?.wormSprites?.poses?.weaponlnk?.frames === 32 &&
      tazerImport.project?.wormSprites?.poses?.wthrow?.frames === 10 &&
      tazerImport.project?.wormSprites?.poses?.weaponfire?.frames === 32,
    JSON.stringify({
      weaponlnk: tazerImport.project?.wormSprites?.poses?.weaponlnk?.frames,
      wthrow: tazerImport.project?.wormSprites?.poses?.wthrow?.frames,
      weaponfire: tazerImport.project?.wormSprites?.poses?.weaponfire?.frames,
    }),
  );

  // Tazer worm_sprites Lua, deduplicated export & bundle round trip
  const tazerBaseDonor = stockDonor(tazerImport.project?.based_on || 'grenade') ?? stockDonor('grenade')!;
  const tazerProject: WeaponProject = {
    ...(tazerBaseDonor as WeaponProject),
    donorBaseline: stockDonorBaseline(tazerBaseDonor.based_on || 'grenade'),
    body: {
      ...DEFAULT_BODY,
      ...(tazerBaseDonor.body ?? {}),
      clustlet: { ...DEFAULT_BODY.clustlet, ...(tazerBaseDonor.body?.clustlet ?? {}) },
    },
    action: tazerBaseDonor.action ?? 'none',
    burst: tazerBaseDonor.burst ?? 'nothing',
    recordOverrides: { ...(tazerBaseDonor.recordOverrides ?? {}) },
    fireType: tazerImport.project?.fireType ?? 'power',
    specialSubtype: tazerImport.project?.specialSubtype ?? 0,
    teleport: !!tazerImport.project?.teleport,
    id: 'wfws.tazer',
    name: 'Tazer',
    description: '',
    version: '0.1.0',
    author: 'test',
    slot: 'grenade',
    based_on: tazerBaseDonor.based_on || 'grenade',
    panel_icon: 'grenade',
    defaults: { ammo: 3, delay: 0, crateChance: 15, crateType: 'weapon', afterUse: 'retreat' },
    roamConfig: { ...DEFAULT_ROAM },
    digConfig: { ...DEFAULT_DIG },
    fireConfig: { ...DEFAULT_FIRE },
    missileSprite: {
      enabled: false, mode: 'stock', stockSprite: 'grenade', sheet: '', anim: 'rotation',
      frames: 1, fps: 15, animSpeed: 1, spinRate: 1, scale: 1, mirror: true, z: 5,
      animate: false, spin: true, hideStock: true,
    },
    bitFlight: { ...DEFAULT_ROLE_ART },
    behaviorArt: {},
    roamSheets: { flight1: {}, flight2: {} },
    ribbonTrail: { enabled: false, max: 12, every: 2, vanish: 2, coreWidth: 8, glowWidth: 13, noise: 0, rainbow: false, color: '#ffffff', target: 'main' },
    explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT },
    terrainStamp: { ...DEFAULT_TERRAIN_STAMP },
    customSounds: { ...DEFAULT_CUSTOM_SOUNDS },
    extraDependencies: [],
    hold: {
      enabled: false, sheet: '', handType: 'mid', handRadius: 10, weapRadius: -8,
      weapRotation: 0, scale: 1, handScale: 1, frames: 1, fps: 15, animate: false,
      drawHand: true, keepWhileFiring: false, thrown: true, putAway: false,
      handRad: 10, handRadLower: 0, handRadUpper: 0,
    },
    packArt: {},
    customSprites: {},
    enableCustomLua: false,
    customLuaSnippet: '',
    useWepFile: false,
    ...(tazerImport.project ?? {}),
  } as WeaponProject;

  const tazerLua = generateLuaCode(tazerProject);
  check(
    'Tazer Lua emits worm_sprites = { ... } and not PX_POSTURE',
    tazerLua.includes('worm_sprites = {') && !tazerLua.includes('PX_POSTURE'),
  );
  const tazerLibs: PackLibraries = {
    wfws: {
      modToml: readFileSync(resolve('spec/lua_sdk/wfws_sdk/mod.toml'), 'utf8'),
      spriteBuilderLua: readFileSync(resolve('spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua'), 'utf8'),
    },
  };
  const tazerEmitted = await emitPackFiles(singleWeaponPack(tazerProject), tazerLibs, async () => null);
  const tazerPaths = [...tazerEmitted.keys()];
  check(
    'Tazer export writes deduplicated worm_weaponlnk.png and worm_wthrow.png',
    tazerPaths.some((p) => p.endsWith('/worm_weaponlnk.png')) &&
      tazerPaths.some((p) => p.endsWith('/worm_wthrow.png')) &&
      !tazerPaths.some((p) => p.endsWith('/worm_weaponfire.png')),
    JSON.stringify(tazerPaths.filter((p) => p.includes('worm_'))),
  );
  const tazerModFiles: ModFile[] = [...tazerEmitted.entries()].map(([path, content]) => ({
    path,
    text: typeof content === 'string' ? content : '',
    bytes: content instanceof Uint8Array ? content : undefined,
  }));
  const tazerBundles = readBundles(tazerModFiles);
  const tazerModWeapons = readWeapons(tazerBundles, tazerModFiles);
  const tazerReimported = tazerModWeapons[0]
    ? await importBundleWeapon(tazerModWeapons[0], tazerModFiles)
    : undefined;
  check(
    'Tazer bundle round-trips wormSprites back cleanly',
    tazerReimported?.project.wormSprites?.enabled === true &&
      !tazerReimported?.project.hold?.enabled &&
      tazerReimported?.project.wormSprites?.poses?.weaponlnk?.frames === 32 &&
      tazerReimported?.project.wormSprites?.poses?.wthrow?.frames === 10 &&
      tazerReimported?.project.wormSprites?.poses?.weaponfire?.frames === 32,
    JSON.stringify({
      enabled: tazerReimported?.project.wormSprites?.enabled,
      holdEnabled: tazerReimported?.project.hold?.enabled,
      lnk: tazerReimported?.project.wormSprites?.poses?.weaponlnk?.frames,
      wthrow: tazerReimported?.project.wormSprites?.poses?.wthrow?.frames,
      fire: tazerReimported?.project.wormSprites?.poses?.weaponfire?.frames,
    }),
  );

  // Cross-library resolution: cweps -> cweps_gfx
  const cwepsLib = libs['cweps.pxl'];
  const cwepsGfxLib = libs['cweps_gfx.pxl'];
  const headings = cwepsLib.weapons.filter((w) => w.isSectionHeading);
  check('cweps section headings flagged (9)', headings.length === 9, `got ${headings.length}`);
  const gravler = cwepsLib.weapons.find((w) => w.name === 'Gravler');
  const gravlerIcon = resolvePxlArt(gravler?.icon, [cwepsLib, cwepsGfxLib], cwepsLib.key);
  check(
    'cweps Gravler icon resolves from cweps_gfx',
    gravlerIcon?.lib.fileName === 'cweps_gfx.pxl' && gravlerIcon.art.name === 'ico_grvlr.png',
    gravlerIcon ? `${gravlerIcon.lib.fileName}:${gravlerIcon.art.name}` : 'missing',
  );

  // Non-SPB native projectile sprite check (Ion Bomb has no scriptFlight -> packArt.strike_sprite, not Sprite Builder)
  const ionBomb = cwepsLib.weapons.find((w) => w.name === 'Ion Bomb');
  const ionImport = ionBomb ? importPxlWeapon(ionBomb, cwepsLib, [cwepsLib, cwepsGfxLib]) : undefined;
  check(
    'Ion Bomb (non-SPB) attaches ionba.png to packArt.strike_sprite instead of Sprite Builder',
    ionImport?.project?.packArt?.strike_sprite?.fileName === 'ionba.png' &&
      !ionImport?.project?.missileSprite?.enabled,
    JSON.stringify({
      strikeSprite: ionImport?.project?.packArt?.strike_sprite?.fileName,
      frames: ionImport?.project?.packArt?.strike_sprite?.frames,
      builderEnabled: ionImport?.project?.missileSprite?.enabled,
    }),
  );

  // Javelin bundle export + re-import round trip
  const donor = stockDonor('grenade')!;
  const javProject: WeaponProject = {
    ...(donor as WeaponProject),
    donorBaseline: stockDonorBaseline('grenade'),
    body: { ...DEFAULT_BODY, ...(donor.body ?? {}), clustlet: { ...DEFAULT_BODY.clustlet, ...(donor.body?.clustlet ?? {}) } },
    action: donor.action ?? 'none',
    burst: donor.burst ?? 'nothing',
    recordOverrides: { ...(donor.recordOverrides ?? {}) },
    fireType: 'power',
    specialSubtype: donor.specialSubtype ?? 0,
    teleport: false,
    id: 'wfws.grenade',
    name: 'Grenade',
    description: '',
    version: '0.1.0',
    author: 'test',
    slot: 'grenade',
    based_on: 'grenade',
    panel_icon: 'grenade',
    defaults: { ammo: 3, delay: 0, crateChance: 15, crateType: 'weapon', afterUse: 'retreat' },
    roamConfig: { ...DEFAULT_ROAM },
    digConfig: { ...DEFAULT_DIG },
    fireConfig: { ...DEFAULT_FIRE },
    missileSprite: {
      enabled: false, mode: 'stock', stockSprite: 'grenade', sheet: '', anim: 'rotation',
      frames: 1, fps: 15, animSpeed: 1, spinRate: 1, scale: 1, mirror: true, z: 5,
      animate: false, spin: true, hideStock: true,
    },
    bitFlight: { ...DEFAULT_ROLE_ART },
    behaviorArt: {},
    roamSheets: { flight1: {}, flight2: {} },
    ribbonTrail: { enabled: false, max: 12, every: 2, vanish: 2, coreWidth: 8, glowWidth: 13, noise: 0, rainbow: false, color: '#ffffff', target: 'main' },
    explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT },
    terrainStamp: { ...DEFAULT_TERRAIN_STAMP },
    customSounds: { ...DEFAULT_CUSTOM_SOUNDS },
    extraDependencies: [],
    hold: {
      enabled: false, sheet: '', handType: 'mid', handRadius: 10, weapRadius: -8,
      weapRotation: 0, scale: 1, handScale: 1, frames: 1, fps: 15, animate: false,
      drawHand: true, keepWhileFiring: false, thrown: true, putAway: false,
      handRad: 10, handRadLower: 0, handRadUpper: 0,
    },
    packArt: {},
    customSprites: {},
    enableCustomLua: false,
    customLuaSnippet: '',
    useWepFile: false,
    ...(javImport.project ?? {}),
  } as WeaponProject;

  const libsForExport: PackLibraries = {
    wfws: {
      modToml: readFileSync(resolve('spec/lua_sdk/wfws_sdk/mod.toml'), 'utf8'),
      spriteBuilderLua: readFileSync(resolve('spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua'), 'utf8'),
    },
  };
  const emitted = await emitPackFiles(singleWeaponPack(javProject), libsForExport, async () => null);
  const holdPngEntry = [...emitted.entries()].find(([k]) => k.endsWith('/hold.png'));
  const libHoldArt = javLib.art.find((a) => a.name === 'spb_javelin.png');
  const holdBytesMatch =
    !!holdPngEntry &&
    !!libHoldArt &&
    holdPngEntry[1] instanceof Uint8Array &&
    Buffer.from(holdPngEntry[1]).equals(Buffer.from(libHoldArt.bytesOf()));
  check('Javelin exported hold.png matches library spb_javelin.png bytes', holdBytesMatch);

  const modTomlEntry = [...emitted.entries()].find(
    ([k]) => k === 'javelin/mod.toml' || k.endsWith('/javelin/mod.toml'),
  );
  const modTomlText = typeof modTomlEntry?.[1] === 'string' ? modTomlEntry[1] : '';
  check('Javelin mod.toml declares frames = 12', /frames\s*=\s*12/.test(modTomlText));

  const modFiles: ModFile[] = [...emitted.entries()].map(([path, content]) => ({
    path,
    text: typeof content === 'string' ? content : '',
    bytes: content instanceof Uint8Array ? content : undefined,
  }));
  const bundles = readBundles(modFiles);
  const modWeapons = readWeapons(bundles, modFiles);
  const reimported = modWeapons[0] ? await importBundleWeapon(modWeapons[0], modFiles) : undefined;
  check(
    'Javelin bundle re-imports with hold.frames === 12 and weapRadius === -11.8',
    reimported?.project.hold?.frames === 12 && reimported?.project.hold?.weapRadius === -11.8,
  );

  // Combined Sprite Builder (`hold.enabled`) + `worm_sprites` round trip
  const combinedProject: WeaponProject = {
    ...javProject,
    id: 'wfws.combined_posture',
    name: 'Combined Posture',
    wormSprites: {
      enabled: true,
      poses: {
        weaponlnk: tazerImport.project?.wormSprites?.poses?.weaponlnk,
        weaponfire: tazerImport.project?.wormSprites?.poses?.weaponfire,
      },
    },
  };
  const combinedLua = generateLuaCode(combinedProject);
  check(
    'Combined Lua emits hold + merged worm_sprites (custom weaponlnk/weaponfire + holds.PX_POSTURE.wthrow)',
    combinedLua.includes('hold = {') &&
      combinedLua.includes('worm_sprites = {') &&
      combinedLua.includes('wthrow = holds.PX_POSTURE.wthrow') &&
      !combinedLua.includes('holds.PX_POSTURE.weaponlnku') &&
      combinedLua.includes('weaponfire = '),
  );
  const combinedEmitted = await emitPackFiles(singleWeaponPack(combinedProject), libsForExport, async () => null);
  const combinedPaths = [...combinedEmitted.keys()];
  check(
    'Combined export writes both hold.png and deduplicated worm_weaponlnk.png',
    combinedPaths.some((p) => p.endsWith('/hold.png')) &&
      combinedPaths.some((p) => p.endsWith('/worm_weaponlnk.png')),
  );
  const combinedModFiles: ModFile[] = [...combinedEmitted.entries()].map(([path, content]) => ({
    path,
    text: typeof content === 'string' ? content : '',
    bytes: content instanceof Uint8Array ? content : undefined,
  }));
  const combinedBundles = readBundles(combinedModFiles);
  const combinedWeapons = readWeapons(combinedBundles, combinedModFiles);
  const combinedReimported = combinedWeapons[0]
    ? await importBundleWeapon(combinedWeapons[0], combinedModFiles)
    : undefined;
  check(
    'Combined bundle round-trips both hold and wormSprites cleanly',
    combinedReimported?.project.hold?.enabled === true &&
      combinedReimported?.project.wormSprites?.enabled === true &&
      combinedReimported?.project.wormSprites?.poses?.weaponlnk?.frames === 32 &&
      combinedReimported?.project.wormSprites?.poses?.weaponfire?.frames === 32,
  );

  // Air strike direct trailer PNGs + SetSpriteOverride + require dependency resolution
  const bowsBuf = toArrayBuffer(readFileSync(resolve(LIBS_DIR, 'weapon_bows_curtis_sb.pxl')));
  const bowsLib = parsePxlLibrary(bowsBuf, 'weapon_bows_curtis_sb.pxl');
  const missingWithoutDeps = missingLibraryRequires(bowsLib, [bowsLib]);
  check(
    'weapon_bows_curtis_sb reports unloaded sprite_curtis_* requires',
    ['sprite_curtis_259', 'sprite_curtis_261', 'sprite_curtis_451'].every((r) =>
      missingWithoutDeps.includes(r),
    ),
    JSON.stringify(missingWithoutDeps),
  );

  const cur259 = parsePxlLibrary(
    toArrayBuffer(readFileSync(resolve(LIBS_DIR, 'sprite_curtis_259.pxl'))),
    'sprite_curtis_259.pxl',
  );
  const cur261 = parsePxlLibrary(
    toArrayBuffer(readFileSync(resolve(LIBS_DIR, 'sprite_curtis_261.pxl'))),
    'sprite_curtis_261.pxl',
  );
  const cur451 = parsePxlLibrary(
    toArrayBuffer(readFileSync(resolve(LIBS_DIR, 'sprite_curtis_451.pxl'))),
    'sprite_curtis_451.pxl',
  );
  const bowsGroup = [bowsLib, cur259, cur261, cur451];

  const expArrowStrike = bowsLib.weapons.find((w) => w.name.includes('Exp. Arrow Strike'));
  check('Exp. Arrow Strike manifest missileSprite === multibc.png', expArrowStrike?.missileSprite === 'multibc.png');
  const expStrikeImport = expArrowStrike
    ? importPxlWeapon(expArrowStrike, bowsLib, bowsGroup)
    : undefined;
  check('Exp. Arrow Strike attaches packArt.strike_sprite (32 frames)', expStrikeImport?.project?.packArt?.strike_sprite?.frames === 32 && expStrikeImport.project.packArt.strike_sprite.fileName === 'multibc.png');
  check(
    'Exp. Arrow Strike resolves trail override 259 -> explosiveat.png (8f)',
    expStrikeImport?.project?.packArt?.missile_trail?.fileName === 'explosiveat.png' &&
      expStrikeImport?.project?.packArt?.missile_trail?.frames === 8,
  );

  const multiBoltStrike = bowsLib.weapons.find((w) => w.name.includes('Multi-Bolt Strike'));
  const mbStrikeImport = multiBoltStrike
    ? importPxlWeapon(multiBoltStrike, bowsLib, bowsGroup)
    : undefined;
  check('Multi-Bolt Strike attaches strike_sprite + cluster_sprite (multibc.png)', mbStrikeImport?.project?.packArt?.strike_sprite?.fileName === 'multibc.png' && mbStrikeImport?.project?.packArt?.cluster_sprite?.fileName === 'multibc.png');
  check('Multi-Bolt Strike resolves trail 451 (multibt.png) and bit trail 261 (reboundert.png)', mbStrikeImport?.project?.packArt?.missile_trail?.fileName === 'multibt.png' && mbStrikeImport?.project?.packArt?.cluster_trail?.fileName === 'reboundert.png');

  const alienBuf = toArrayBuffer(readFileSync(resolve(LIBS_DIR, 'weapon_air_alien_invasion.pxl')));
  const alienLib = parsePxlLibrary(alienBuf, 'weapon_air_alien_invasion.pxl');
  const alienImport = importPxlWeapon(alienLib.weapons[0], alienLib, [alienLib]);
  check(
    'Alien Invasion resolves SetSpriteOverride 703 -> energy ball b.png on cluster_sprite',
    alienImport.project?.packArt?.cluster_sprite?.fileName === 'energy ball b.png',
    alienImport.project?.packArt?.cluster_sprite?.fileName,
  );
  check(
    'Alien Invasion resolves SetSpriteOverride 701 -> ufo.png on customSprites.plane',
    alienImport.project?.customSprites?.plane?.file?.name === 'ufo.png',
  );

  // PX SPB main-only rule: homing/roam/dig inherit main missile; clusters stay native unless explicit
  const homingArrow = bowsLib.weapons.find((w) => w.name.includes('Homing Arrow'));
  const homingImport = homingArrow ? importPxlWeapon(homingArrow, bowsLib, bowsGroup) : undefined;
  check(
    'Homing Arrow SPB sets behaviorArt.homing.mode === inherit',
    homingImport?.project?.missileSprite?.enabled === true &&
      homingImport?.project?.behaviorArt?.homing?.mode === 'inherit',
  );
  const explosiveArrow = bowsLib.weapons.find((w) => w.name.includes('Explosive Arrow'));
  const expArrowImport = explosiveArrow
    ? importPxlWeapon(explosiveArrow, bowsLib, bowsGroup)
    : undefined;
  check(
    'Explosive Arrow SPB leaves bitFlight unset/native (SPB is main-only)',
    expArrowImport?.project?.missileSprite?.enabled === true && !expArrowImport?.project?.bitFlight,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll PXL checks passed.');
