/**
 * Carried-Lua check (M2 and M3 of `reqs/custom_code_import_plan.md`).
 *
 * A bundle's hook body is never self-contained: vortex's `on_explode` is one
 * call to `start_vortex`, which reads install-time locals, which read
 * module-level constants, which require libraries. This checks that the closure
 * is carried whole: the declarations, their requires, their dependency ids, the
 * lockstep rewrites, the renames around names the emitted file already binds,
 * and the bundle's own art paths (an export only ships `sprites/<mod>/`).
 *
 * Three kinds of case:
 *
 * - shapes built inline, so a rule has a case even when no mod on this machine
 *   exercises it (a dangling name, an unshipped require, an unbalanced block);
 * - the four real bundles, read from `Mods/` when it is on disk, which is where
 *   the closure comes from in practice;
 * - the round trip: import, export, re-import, and the carried code must come
 *   back identical, because a carry that is not idempotent doubles a header on
 *   every pass.
 *
 * Run: `bun run tools/check_carried_lua.ts` (exits 1 on a failure).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WeaponProject } from '../src/types/weapon';
import type { ModFile } from '../src/utils/modLib/scan';
import { readBundles, readWeapons } from '../src/utils/modLib/scan';
import { importBundleWeapon } from '../src/utils/modLib/importWeapon';
import { ownOutputOf } from '../src/utils/modLib/ownOutput';
import { splitModule } from '../src/utils/modLib/splitModule';
import { carryClosure, dependencyForModule, rewriteBundlePaths } from '../src/utils/modLib/carryClosure';
import { declaredNames, generateLuaCode, generateModToml, sanitizeModFolder } from '../src/utils/luaGenerator';
import { checkLua } from '../src/utils/luaCheck';
import {
  DEFAULT_IMPORT_HOLD,
  DEFAULT_IMPORT_MISSILE,
} from '../src/utils/modLib/importFeatures';
import { DEFAULT_ROLE_ART } from '../src/data/spriteBuilder';
import { DEFAULT_EXPLOSION_EFFECT } from '../src/data/explosionPresets';
import { DEFAULT_FIRE_SEQUENCE } from '../src/data/fireSequence';
import { DEFAULT_CUSTOM_SOUNDS } from '../src/data/soundPresets';
import { DEFAULT_BODY, DEFAULT_DIG, DEFAULT_FIRE, DEFAULT_ROAM } from '../src/data/defaults';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODS = 'D:/Worms Armageddon/WormBench/Mods';
const BUNDLE = join(ROOT, 'test_pack', 'wftest_pack');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
};
const lines = (...parts: string[]) => parts.join('\n');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The project a bundle import starts from: the same defaults `App` hands
 * `importBundleWeapon`, so a round-trip export is a complete weapon.
 */
const RIBBON_OFF = {
  enabled: false,
  max: 12,
  every: 2,
  vanish: 2,
  coreWidth: 8,
  glowWidth: 13,
  noise: 0,
  rainbow: false,
  color: '#ffffff',
  target: 'main' as const,
};

function baseProject(patch: Partial<WeaponProject> = {}): WeaponProject {
  const p = patch;
  return {
    id: p.id ?? 'wfws.scratch',
    name: p.name ?? 'Scratch',
    description: '',
    version: '0.1.0',
    author: '',
    slot: p.slot ?? 'grenade',
    based_on: p.based_on ?? 'grenade',
    fireType: p.fireType ?? 'power',
    specialSubtype: p.specialSubtype ?? 0,
    teleport: false,
    panel_icon: p.panel_icon ?? 'grenade',
    defaults: { ammo: 3, delay: 0, crateChance: 0, crateType: 'weapon', afterUse: '' },
    body: {
      ...DEFAULT_BODY,
      ...(p.body ?? {}),
      clustlet: { ...DEFAULT_BODY.clustlet, ...(p.body?.clustlet ?? {}) },
    },
    action: p.action ?? 'bounce',
    burst: p.burst ?? 'nothing',
    missileSprite: p.missileSprite ?? DEFAULT_IMPORT_MISSILE,
    bitFlight: p.bitFlight ?? { ...DEFAULT_ROLE_ART },
    behaviorArt: p.behaviorArt ?? {},
    roamConfig: { ...DEFAULT_ROAM, ...(p.roamConfig ?? {}) },
    roamSheets: p.roamSheets ?? { flight1: {}, flight2: {} },
    digConfig: { ...DEFAULT_DIG, ...(p.digConfig ?? {}) },
    fireConfig: { ...DEFAULT_FIRE, ...(p.fireConfig ?? {}) },
    ribbonTrail: p.ribbonTrail ?? RIBBON_OFF,
    explosionEffect: p.explosionEffect ?? DEFAULT_EXPLOSION_EFFECT,
    terrainStamp: p.terrainStamp,
    fireSequence: p.fireSequence ?? DEFAULT_FIRE_SEQUENCE,
    customSounds: p.customSounds ?? DEFAULT_CUSTOM_SOUNDS,
    extraDependencies: p.extraDependencies ?? [],
    hold: p.hold ?? DEFAULT_IMPORT_HOLD,
    aimClip: p.aimClip,
    melee: p.melee,
    // The emitter writes two `wa.on` registrations of its own, so a base that
    // dropped it would test a weapon the pack does not have.
    emitter: p.emitter,
    packArt: p.packArt ?? {},
    customSprites: p.customSprites ?? {},
    recordOverrides: p.recordOverrides ?? {},
    recordExtra: p.recordExtra,
    enableCustomLua: p.enableCustomLua ?? false,
    customLuaSnippet: p.customLuaSnippet ?? '',
    useWepFile: false,
    ...('carriedLua' in p ? { carriedLua: p.carriedLua } : {}),
  } as WeaponProject;
}

/** What `importBundleWeapon` computes, without needing a bundle for it. */
function carryOf(moduleText: string, project: WeaponProject) {
  const split = splitModule(moduleText);
  const emitted = generateLuaCode(project);
  const reserved = declaredNames(emitted);
  const seeds = split.hooks.on_explode
    ? [{ label: 'on_explode', text: split.hooks.on_explode }]
    : [];
  const carried = carryClosure(seeds, split, reserved, sanitizeModFolder(project.id), emitted);
  const hook = split.hooks.on_explode ?? '';
  return { split, carried, hook: carried.transform(hook) };
}

// ---- shapes -------------------------------------------------------------
{
  // Vortex's shape in miniature: a module constant, an install helper that reads
  // it, and a hook that calls the helper. Nothing here is in the export unless
  // the closure carries it.
  const moduleText = lines(
    'local RIPPLE = 12',
    'local function ring(x, y)',
    '  return x + RIPPLE, y - RIPPLE',
    'end',
    'return {',
    '  install = function(ctx)',
    '    local holes = {}',
    '    local function open(x, y)',
    '      local cx, cy = ring(x, y)',
    '      holes[#holes + 1] = { x = cx, y = cy }',
    '    end',
    '    wa.weapons.replace{',
    '      name = "Ring",',
    '      on_explode = { on = function(ev)',
    '        open(ev.x, ev.y)',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const project = baseProject();
  const { carried } = carryOf(moduleText, project);
  const carriedText = [...carried.preamble, ...carried.prologue].map((block) => block.text).join('\n');
  check(
    'the install helper the hook calls is carried',
    carried.prologue.some((block) => block.text.includes('local function open(')),
    carried.prologue.map((block) => block.text.split('\n')[0]).join(' | '),
  );
  check('and so is the helper it calls', carriedText.includes('local function ring('));
  check(
    'and the module constant it reads',
    carried.preamble.some((block) => block.text.startsWith('local RIPPLE = 12')),
  );
  check('and the table it appends to', carried.prologue.some((block) => block.text.includes('local holes = {}')));
  check(
    'the carried text is the bundle\'s, in source order',
    carriedText.indexOf('RIPPLE') < carriedText.indexOf('local holes') &&
      carriedText.indexOf('local holes') < carriedText.indexOf('local function open'),
  );
  check('nothing is left dangling', carried.unresolved.length === 0, carried.unresolved.join(', '));
  check(
    'the export declares the helper before the hook uses it',
    (() => {
      const code = generateLuaCode(baseProject({
        enableCustomLua: true,
        customLuaSnippet: 'on_explode = { on = function(ev)\n  open(ev.x, ev.y)\nend }',
        carriedLua: { preamble: carried.preamble, prologue: carried.prologue, unresolved: [] },
      }));
      const declared = code.indexOf('local function open(');
      return declared !== -1 && declared < code.indexOf('open(ev.x, ev.y)');
    })(),
  );
}

// ---- lockstep maths is rewritten, not blocked ---------------------------
{
  const moduleText = lines(
    'local function jitter()',
    '  return math.random(-2, 2)',
    'end',
    'local function spin(a)',
    '  return math.cos(a) + math.sin(a) + math.atan(a)',
    'end',
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        wa.world.blast{ x = ev.x + jitter(), y = ev.y + spin(1) }',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const { carried } = carryOf(moduleText, baseProject());
  const text = [...carried.preamble, ...carried.prologue].map((block) => block.text).join('\n');
  check('math.random becomes wa.random', text.includes('wa.random(-2, 2)'), text);
  check(
    'math.sin/cos/atan become wa.math.*',
    text.includes('wa.math.cos(a)') && text.includes('wa.math.sin(a)') && text.includes('wa.math.atan(a)'),
  );
  check('and the note names the rewrites', carried.rewrites.length === 4, carried.rewrites.join(', '));
  check(
    'the carried code no longer trips the lockstep rule',
    checkLua(text, { mode: 'fragment', skipGlobals: true }).every((finding) => finding.rule !== 'lockstep-rng'),
  );

  // The float form has no equivalent (`wa.random()` is the raw 32-bit draw).
  const float = lines(
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        local odds = math.random()',
    '        if odds > ev.x then return end',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  check(
    'the float form is reported instead of rewritten',
    carryOf(float, baseProject()).hook.floatRandom,
  );
}

// ---- a name nothing declares is reported, not invented ------------------
{
  const moduleText = lines(
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        start_vortex(ev.x, ev.y)',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const { carried } = carryOf(moduleText, baseProject());
  check(
    'a hook calling an undeclared name is reported',
    carried.unresolved.includes('start_vortex'),
    carried.unresolved.join(', '),
  );
  check('and nothing is carried for it', carried.prologue.length === 0 && carried.preamble.length === 0);
}

// ---- a name that is a parameter of the enclosing function --------------
{
  // `lib/cursor.lua` is shaped `function M.install(ctx, spec)`: the hooks inside
  // it close over `spec`, which the *caller* supplies, so there is nothing to
  // carry and the summary has to say which line the binding comes from.
  const moduleText = lines(
    'local M = {}',
    'function M.install(ctx, spec)',
    '  wa.on.worm_message(function(worm)',
    '    if spec.frame then spec.frame(worm) end',
    '  end, { msgs = { wa.msg.FIRE_WEAPON } })',
    'end',
    'return M',
  );
  const split = splitModule(moduleText);
  const project = baseProject();
  const emitted = generateLuaCode(project);
  const seeds = split.registrations
    .filter((r) => r.event === 'worm_message')
    .map((r) => ({ label: 'wa.on.worm_message', text: r.text, enclosing: r.enclosing }));
  const carried = carryClosure(seeds, split, declaredNames(emitted), sanitizeModFolder(project.id), emitted);
  check('a parameter of the enclosing function is not carried', carried.unresolved.includes('spec'), carried.unresolved.join(', '));
  check(
    'and the note names the function and its line',
    carried.notes.some((note) => note.includes('parameter of') && note.includes('M.install(ctx, spec)') && note.includes('line 2')),
    carried.notes.join(' | '),
  );
  // The reading block is still carried when its other names resolve, so the note
  // may not claim the body was dropped: `utilities.cursor` ships `on_click` with
  // `spec` as a nil, and that is what the note has to describe.
  check(
    'and says the code reads it as a nil rather than that the body was dropped',
    carried.notes.some((note) => note.includes('reads it as a nil') && !note.includes('not carried')),
    carried.notes.join(' | '),
  );
}

// ---- a block the scanner cannot close is refused ------------------------
{
  const moduleText = lines(
    'return {',
    '  install = function(ctx)',
    '    local broken = function()',
    '      if true then',
    '    end',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        broken()',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const { carried } = carryOf(moduleText, baseProject());
  check(
    'a block with an unclosed `if` is refused with a reason',
    carried.refused.length > 0 || carried.unresolved.includes('broken'),
    `${carried.refused.join(' | ')} / ${carried.unresolved.join(',')}`,
  );
}

// ---- renames around what the file already binds -------------------------
{
  // A bundle's own `fx` under a name the export binds to a different module:
  // shadowing it would make the claim's own burst run the wrong library.
  const moduleText = lines(
    'local fx = require("lib/my_fx")',
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        fx.burst{ x = ev.x, y = ev.y }',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const project = baseProject({
    id: 'wfws.renamed',
    explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true },
  });
  const { carried, hook } = carryOf(moduleText, project);
  const declaration = carried.preamble.find((block) => block.text.includes('lib/my_fx'));
  check(
    'a bundle module under a name the file binds is renamed',
    !!declaration && declaration.text.includes('local fx_bundle = require("lib/my_fx")'),
    declaration?.text ?? 'not carried',
  );
  check('and the rename is reported', carried.renames.some((rename) => rename.from === 'fx'), carried.renames.map((r) => r.from).join(','));
  check(
    'the hook body is renamed with it',
    hook.text.includes('fx_bundle.burst{'),
    hook.text,
  );
  check(
    'a string that happens to say fx is left alone',
    carried.transform('local p = "fx"').text.includes('"fx"'),
  );
  check(
    'a require the export does not ship is named',
    carried.notes.some((note) => note.includes('lib/my_fx')),
    carried.notes.join(' | '),
  );
}

// ---- the same module is one declaration, not two ------------------------
{
  const moduleText = lines(
    'local fx = require("wf-lib/effects/px_effects")',
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        fx.burst{ x = ev.x, y = ev.y }',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  // The export binds `fx` itself as soon as the burst card is on.
  const project = baseProject({ explosionEffect: { ...DEFAULT_EXPLOSION_EFFECT, enabled: true } });
  const { carried } = carryOf(moduleText, project);
  check(
    'a bundle require of the same module is not carried twice',
    !carried.preamble.some((block) => block.text.includes('px_effects')) && carried.renames.length === 0,
    carried.preamble.map((block) => block.text).join(' | '),
  );
  check(
    'and the dependency the code needs is in the manifest',
    /effects\.sdk/.test(generateModToml(project)),
    generateModToml(project).split('\n').find((line) => line.includes('effects.sdk')) ?? 'no effects.sdk',
  );
}

// ---- a hook outside `install` closes over its own helper's scope --------
{
  // PX's swim suit, portal gun and nuke rocket all declare their state inside
  // `function weapon.setup() … do … end` and register their hooks from there,
  // so a carry that only read the module level and `install` saw 44 of 89
  // weapons with names nothing declares.
  const moduleText = lines(
    'local weapon = {}',
    'function weapon.setup()',
    '  local shared = require("lib/shared")',
    '  do',
    '    local SWIM_RING = 12',
    '    local swimmers = {}',
    '    local function swim_push(w)',
    '      swimmers[w.id] = SWIM_RING',
    '      shared.splash(w.id)',
    '    end',
    '    wa.on.worm_message(function(worm)',
    '      swim_push(worm)',
    '    end, { msgs = { wa.msg.FIRE_WEAPON } })',
    '  end',
    'end',
    'return weapon',
  );
  const split = splitModule(moduleText);
  const project = baseProject();
  const emitted = generateLuaCode(project);
  const seeds = split.registrations
    .filter((r) => r.event === 'worm_message')
    .map((r) => ({ label: 'wa.on.worm_message', text: r.text, enclosing: r.enclosing }));
  const carried = carryClosure(seeds, split, declaredNames(emitted), sanitizeModFolder(project.id), emitted);
  const text = carried.prologue.map((block) => block.text).join('\n');
  check(
    'a registration inside a setup helper carries the helper it calls',
    text.includes('local function swim_push('),
    carried.prologue.map((block) => block.text.split('\n')[0]).join(' | '),
  );
  check('and the state beside it in the same block', text.includes('local swimmers = {}'));
  check('and the constant beside that', text.includes('local SWIM_RING = 12'));
  check(
    'and what the helper closes over one block up',
    text.includes('local shared = require("lib/shared")'),
    text,
  );
  check('with nothing left unresolved', carried.unresolved.length === 0, carried.unresolved.join(', '));
}

// ---- one declaration written twice is one binding ----------------------
{
  // PX opens both `weapon.definition` and `weapon.setup` with the same require,
  // and a hook in each needs it. Two copies are one binding, not a collision.
  const moduleText = lines(
    'local weapon = {}',
    'function weapon.definition()',
    '  local shared = require("lib/shared")',
    '  return { on_explode = function(ev) shared.boom(ev.x, ev.y) end }',
    'end',
    'function weapon.setup()',
    '  local shared = require("lib/shared")',
    '  wa.on.worm_message(function(w) shared.settle(w) end, { msgs = { wa.msg.FIRE_WEAPON } })',
    'end',
    'return weapon',
  );
  const split = splitModule(moduleText);
  const project = baseProject();
  const emitted = generateLuaCode(project);
  const seeds = [
    { label: 'on_explode', text: split.hooks.on_explode ?? '', enclosing: split.hookScopes.on_explode },
    ...split.registrations
      .filter((r) => r.event === 'worm_message')
      .map((r) => ({ label: 'wa.on.worm_message', text: r.text, enclosing: r.enclosing })),
  ];
  const carried = carryClosure(seeds, split, declaredNames(emitted), sanitizeModFolder(project.id), emitted);
  const copies = carried.prologue.filter((block) => block.text.includes('require("lib/shared")'));
  check('the same require written in two helpers is carried once', copies.length === 1, String(copies.length));
  check('and it is not reported as a clash', carried.unresolved.length === 0, carried.unresolved.join(', '));
  check(
    'and no note claims a declaration was dropped',
    !carried.notes.some((note) => note.includes('different scope')),
    carried.notes.join(' | '),
  );
}
{
  // Two different values under one name really are two bindings: carrying both
  // would make one hook read the other's number.
  const moduleText = lines(
    'local weapon = {}',
    'function weapon.definition()',
    '  local points = 5',
    '  return { on_explode = function(ev) points = points + ev.power end }',
    'end',
    'function weapon.setup()',
    '  local points = 9',
    '  wa.on.worm_message(function(w) wa.world.set_hp(w, points) end, { msgs = { wa.msg.FIRE_WEAPON } })',
    'end',
    'return weapon',
  );
  const split = splitModule(moduleText);
  const project = baseProject();
  const emitted = generateLuaCode(project);
  const seeds = [
    { label: 'on_explode', text: split.hooks.on_explode ?? '', enclosing: split.hookScopes.on_explode },
    ...split.registrations
      .filter((r) => r.event === 'worm_message')
      .map((r) => ({ label: 'wa.on.worm_message', text: r.text, enclosing: r.enclosing })),
  ];
  const carried = carryClosure(seeds, split, declaredNames(emitted), sanitizeModFolder(project.id), emitted);
  check(
    'two different locals of one name are one carried and one reported',
    carried.notes.some((note) => note.includes('different scope')) && carried.unresolved.includes('points'),
    `${carried.notes.join(' | ')} / ${carried.unresolved.join(',')}`,
  );
}

// ---- the bundle's own art moves with the export -------------------------
{
  const moduleText = lines(
    'return {',
    '  install = function(ctx)',
    '    local function puff(x, y)',
    '      wa.sound.play(ctx.owner, "sounds/vortex/boom.wav", 8)',
    '      return "sprites/vortex/hole.png"',
    '    end',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    '        puff(ev.x, ev.y)',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const project = baseProject({ id: 'wfws.moved' });
  const { carried } = carryOf(moduleText, project);
  const text = [...carried.preamble, ...carried.prologue].map((block) => block.text).join('\n');
  check('a carried sprite path follows the export folder', text.includes('sprites/moved/hole.png'), text);
  check('and so does a sound path', text.includes('sounds/moved/boom.wav'));
  check('and the count is reported', carried.pathRewrites === 2, String(carried.pathRewrites));
}

// ---- the Carried Lua panel's switches (the plan's UI section) -----------
{
  // One row per block, one switch each: a block that is switched off stays in
  // the project (its text is not lost) and is not written to the export.
  const project = baseProject({
    carriedLua: {
      preamble: [
        {
          origin: 'preamble',
          text: 'local LIMIT = 12',
          declares: ['LIMIT'],
          requires: [],
          line: 1,
          neededBy: ['puff'],
        },
      ],
      prologue: [
        {
          origin: 'prologue',
          text: 'local function puff(x, y)\n  return x + LIMIT, y\nend',
          declares: ['puff'],
          requires: [],
          line: 2,
          neededBy: ['on_explode'],
        },
      ],
      hooks: [{ key: 'on_explode', text: 'function(ev) puff(ev.x, ev.y) end', line: 5 }],
      registrations: [
        { event: 'hurt', text: 'wa.on.hurt(function(w, dmg)\n  puff(w.x, w.y)\nend)', line: 9 },
      ],
      unresolved: [],
    },
  });
  const code = generateLuaCode(project);
  check('a carried preamble is written', code.includes('local LIMIT = 12'));
  check('a carried install local is written', code.includes('local function puff(x, y)'));
  check('a carried hook is merged into the handler', code.includes('puff(ev.x, ev.y)'));
  check('a carried registration is written', code.includes('wa.on.hurt('));
  // Order: the declarations first, the registration after the claim.
  check(
    'the order is preamble, claim, registration',
    code.indexOf('local LIMIT') < code.indexOf('wa.weapons.replace') &&
      code.indexOf('wa.weapons.replace') < code.indexOf('wa.on.hurt('),
    `${code.indexOf('local LIMIT')}, ${code.indexOf('wa.weapons.replace')}, ${code.indexOf('wa.on.hurt(')}`,
  );

  const disabled = (
    pick: 'preamble' | 'prologue' | 'hook' | 'registration',
  ): WeaponProject => {
    const carried = project.carriedLua!;
    return {
      ...project,
      carriedLua: {
        ...carried,
        preamble: carried.preamble.map((block) => ({ ...block, disabled: pick === 'preamble' })),
        prologue: carried.prologue.map((block) => ({ ...block, disabled: pick === 'prologue' })),
        hooks: carried.hooks!.map((hook) => ({ ...hook, disabled: pick === 'hook' })),
        registrations: carried.registrations!.map((registration) => ({
          ...registration,
          disabled: pick === 'registration',
        })),
      },
    };
  };
  const offPreamble = generateLuaCode(disabled('preamble'));
  check('switching the preamble off leaves it out', !offPreamble.includes('local LIMIT = 12'));
  check('and the rest of the carried code stays', offPreamble.includes('wa.on.hurt('));
  const offPrologue = generateLuaCode(disabled('prologue'));
  check('switching an install local off leaves it out', !offPrologue.includes('local function puff('));
  const offHook = generateLuaCode(disabled('hook'));
  check('switching the hook off drops its body', !offHook.includes('puff(ev.x, ev.y)'));
  // Nothing else owns the key on this project, so the handler is not written at
  // all: a `wa.weapons.replace{ on_explode = ... }` with an empty body would be
  // a claim key the author did not ask for.
  check(
    'and the key it owned is not written',
    offHook.split('on_explode = ').length - 1 === 0,
    String(offHook.split('on_explode = ').length - 1),
  );
  const offRegistration = generateLuaCode(disabled('registration'));
  check('switching a registration off leaves it out', !offRegistration.includes('wa.on.hurt('));
  // A hook switched off is a name the file no longer declares, and the panel
  // says so instead of hiding it.
  const broken = generateLuaCode({
    ...project,
    carriedLua: { ...project.carriedLua!, prologue: [] },
  });
  check(
    'a disabled declaration leaves a finding, not silence',
    checkLua(broken, { mode: 'fragment' }).some((finding) => finding.rule === 'undefined-global'),
    checkLua(broken, { mode: 'fragment' }).map((finding) => finding.rule).join(', '),
  );
}

// ---- the four real bundles ---------------------------------------------
const realMods = (() => {
  try {
    return statSync(MODS).isDirectory();
  } catch {
    return false;
  }
})();
if (!realMods) {
  console.log('skip  the four real bundles (D: is not mounted)');
} else {
  /**
   * Every file under `root` as a `ModFile`: `.lua`/`.toml` as text, art as
   * bytes. Read as text only, a WAV loses its bytes and the feature that plays
   * it is off on the next import, which is a difference the round trip would
   * blame on the carry.
   */
  const toFiles = (root: string): ModFile[] =>
    walk(root).map((full) => {
      const path = relative(root, full).split(sep).join('/');
      if (/\.(lua|toml)$/i.test(full)) return { path, text: readFileSync(full, 'utf8') };
      return { path, text: '', bytes: new Uint8Array(readFileSync(full)) };
    });
  const readBundle = (name: string) => {
    const files = toFiles(join(MODS, name));
    const bundle = readBundles(files)[0];
    return { files, weapons: readWeapons([bundle], files) };
  };
  const expectations: Record<string, { prologue: number; preamble: number; because: string }> = {
    // The hardest case: `start_vortex` and the seven helpers below it, plus the
    // chain behind its carried `wa.on.draw` (`cell` reads the strip constants).
    vortex: { prologue: 12, preamble: 21, because: 'start_vortex, its chain and the draw' },
    // `aura`, the fly-by zap state table and its handler's helpers.
    pulsar: { prologue: 7, preamble: 0, because: 'aura and its handlers' },
    // Nothing: its `on_explode` is ours.
    railgun: { prologue: 0, preamble: 0, because: 'no hook of its own' },
    // Its whole weapon is a hand-written `on_fire` (M6) and the chain under it.
    conductor: { prologue: 14, preamble: 12, because: 'its on_fire and its chain' },
  };
  for (const [name, expected] of Object.entries(expectations)) {
    const { files, weapons } = readBundle(name);
    const weapon = weapons.find((entry) => entry.record);
    if (!weapon) {
      check(`${name}: has a record`, false);
      continue;
    }
    const imported = await importBundleWeapon(weapon, files);
    const project = baseProject(imported.project);
    const carried = project.carriedLua;
    check(
      `${name}: carries ${expected.because}`,
      (carried?.prologue.length ?? 0) === expected.prologue &&
        (carried?.preamble.length ?? 0) === expected.preamble,
      `prologue ${carried?.prologue.length ?? 0}, preamble ${carried?.preamble.length ?? 0}`,
    );
    const code = generateLuaCode(project);
    const findings = checkLua(code, { mode: 'module' });
    check(
      `${name}: the export has no dangling name`,
      findings.every((finding) => finding.rule !== 'undefined-global'),
      findings.map((finding) => `${finding.rule} ${finding.name ?? ''} line ${finding.line}`).join(', '),
    );

    // M5: the bundle's `on_explode` is carried code, not the author's snippet,
    // and it lands inside the one handler the editor emits.
    const explodeKeys = code.split('on_explode = ').length - 1;
    check(`${name}: writes one on_explode key`, explodeKeys <= 1, String(explodeKeys));
    check(
      `${name}: the author's snippet stays the author's`,
      !project.enableCustomLua && !project.customLuaSnippet,
      String(project.customLuaSnippet ?? ''),
    );
    // M6: every registration nothing models is carried with its handler, filter
    // included, and written once. The editor's own three are rebuilt from their
    // panels, so a doubled one would be the carry claiming our output.
    const carriedRegistrations = project.carriedLua?.registrations ?? [];
    // Every handler in this corpus opens `wa.on.missile_frame(function(m)` and
    // guards on `m.weapon`, so the first line is not a fingerprint; the body is.
    const squashText = (text: string) => text.replace(/\s+/g, '');
    for (const registration of carriedRegistrations) {
      const needle = squashText(registration.text);
      check(
        `${name}: carries ${registration.event} once`,
        squashText(code).split(needle).length - 1 === 1,
        `${squashText(code).split(needle).length - 1} x ${needle.length}`,
      );
    }
    // The import summary names what arrived, not a bare count (the plan's UI
    // section): an import that dropped something says so, and one that carried a
    // hook names the key.
    const summary = imported.notes.find((note) => note.startsWith('carried:')) ?? '';
    check(
      `${name}: the summary names the hooks`,
      (project.carriedLua?.hooks ?? []).every((hook) => summary.includes(hook.key)),
      summary,
    );
    check(
      `${name}: and the registrations`,
      (project.carriedLua?.registrations ?? []).every((registration) =>
        summary.includes(`wa.on.${registration.event}`),
      ),
      summary,
    );
    const ours = ownOutputOf(splitModule(code)).own.length;
    check(
      `${name}: the export registers ours plus theirs`,
      splitModule(code).registrations.length === ours + carriedRegistrations.length,
      `${splitModule(code).registrations.length} vs ${ours} + ${carriedRegistrations.length}`,
    );

    // The round trip: the export must import back to the same carried code, or
    // each pass would copy it again.
    const folder = sanitizeModFolder(project.id);
    const dir = join(tmpdir(), `wf_carried_${name}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, folder, 'weapons'), { recursive: true });
    writeFileSync(join(dir, folder, 'mod.toml'), generateModToml(project));
    writeFileSync(join(dir, folder, 'weapons', `${folder}.lua`), code);
    // The exporter writes the bundle's sheets and samples under the export's own
    // folder; copying them by base name is the same contract without a canvas,
    // and without them a feature (a hold, an interval WAV) would be off on the
    // second import and the carried set would differ for the wrong reason.
    for (const file of files) {
      if (!/^(sprites|sounds)\//.test(file.path)) continue;
      const target = join(dir, folder, ...file.path.split('/').slice(0, 1), folder, file.path.split('/').pop()!);
      mkdirSync(join(target, '..'), { recursive: true });
      const bytes = file.bytes ?? (file.text ? new TextEncoder().encode(file.text) : undefined);
      if (bytes) writeFileSync(target, bytes);
    }
    const exportedFiles = toFiles(join(dir, folder));
    const exportedBundle = readBundles(exportedFiles)[0];
    const exportedWeapon = readWeapons([exportedBundle], exportedFiles).find((entry) => entry.record);
    if (!exportedWeapon) {
      check(`${name}: the export imports back`, false, 'no weapon in the export');
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    const again = await importBundleWeapon(exportedWeapon, exportedFiles);
    const againProject = baseProject(again.project);
    const againCode = generateLuaCode(againProject);
    check(
      `${name}: the carried code round-trips unchanged`,
      (againProject.carriedLua?.preamble ?? []).length === (carried?.preamble ?? []).length &&
        (againProject.carriedLua?.prologue ?? []).length === (carried?.prologue ?? []).length,
      `preamble ${againProject.carriedLua?.preamble.length ?? 0}/${carried?.preamble.length ?? 0}, prologue ${againProject.carriedLua?.prologue.length ?? 0}/${carried?.prologue.length ?? 0}`,
    );
    const carryHeaders = (code: string) =>
      code.split('-- Carried from the source bundle').length - 1;
    check(
      `${name}: and the re-export carries it once`,
      carryHeaders(againCode) === carryHeaders(code),
      `${carryHeaders(againCode)} headers against ${carryHeaders(code)}`,
    );
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- our own output carries nothing ------------------------------------
// Every weapon in the pack is generated by this editor, so a re-import must come
// back with exactly the carried code the file itself declares: nothing of ours
// (`local TINT = …`, the trail, the interval WAV, the fuse sampler, the emitter's
// two registrations) may be mistaken for a bundle's code, and the two weapons
// written to carry code (WF 57's `wa.on.hurt`, WF 58's merged `on_explode`) must
// carry theirs once, not twice.
if (statSync(BUNDLE, { throwIfNoEntry: false })) {
  const files: ModFile[] = walk(BUNDLE).map((full) => {
    const path = relative(BUNDLE, full).split(sep).join('/');
    if (/\.(lua|toml)$/i.test(full)) return { path, text: readFileSync(full, 'utf8') };
    return { path, text: '', bytes: new Uint8Array(readFileSync(full)) };
  });
  const bundle = readBundles(files)[0];
  const weapons = readWeapons([bundle], files);
  const doubled: string[] = [];
  let carriedWeapons = 0;
  let emitterClean = false;
  const shape = (project: WeaponProject) => ({
    preamble: project.carriedLua?.preamble.length ?? 0,
    prologue: project.carriedLua?.prologue.length ?? 0,
    hooks: project.carriedLua?.hooks?.length ?? 0,
    registrations: project.carriedLua?.registrations?.length ?? 0,
  });
  for (const weapon of weapons) {
    if (!weapon.record) continue;
    const imported = await importBundleWeapon(weapon, files);
    const project = baseProject(imported.project);
    const first = shape(project);
    const code = generateLuaCode(project);
    // A weapon the editor wrote must declare every name it reads: a carried
    // block that is wrongly recognised as ours shows up as a dangling name.
    const dangling = checkLua(code, { mode: 'module' }).filter(
      (finding) => finding.rule === 'undefined-global',
    );
    if (dangling.length > 0) doubled.push(`${weapon.name}: ${dangling.map((f) => f.name).join(',')}`);
    // Re-import the export: the carried set must not grow, which is what a
    // doubled emitter or a trail claimed as foreign code looks like.
    const exported = generateLuaCode(project);
    const againFiles: ModFile[] = [
      { path: 'mod.toml', text: generateModToml(project) },
      {
        path: `weapons/${sanitizeModFolder(project.id)}.lua`,
        text: exported,
      },
      ...files.filter((file) => /^(sprites|sounds|wf-lib)\//.test(file.path)),
    ];
    const againBundle = readBundles(againFiles)[0];
    const againWeapon = againBundle
      ? readWeapons([againBundle], againFiles).find((entry) => entry.record)
      : undefined;
    if (againWeapon) {
      const again = await importBundleWeapon(againWeapon, againFiles);
      const second = shape(baseProject(again.project));
      if (
        second.preamble !== first.preamble ||
        second.prologue !== first.prologue ||
        second.hooks !== first.hooks ||
        second.registrations !== first.registrations
      ) {
        doubled.push(
          `${weapon.name}: carried ${JSON.stringify(first)} came back ${JSON.stringify(second)}`,
        );
      }
    }
    const carried = shape(project);
    if (carried.hooks > 0 || carried.registrations > 0) carriedWeapons += 1;
    if (weapon.name.includes('Emitter')) {
      // The emitter writes two registrations of its own (`body_move`/`FRAME_FINISH`
      // and the `missile_frame` latch); both must be recognised, or a re-import
      // would ship a second emitter.
      const split = splitModule(generateLuaCode(project));
      emitterClean = ownOutputOf(split).foreign.length === 0 && split.registrations.length === 2;
    }
  }
  check(
    'a re-import of the generated pack carries nothing of its own',
    doubled.length === 0,
    doubled.slice(0, 3).join(' | '),
  );
  check(
    'and the pack weapons written to carry code carry it once',
    carriedWeapons === 2,
    `${carriedWeapons} carried a hook or a registration`,
  );
  check('the emitter weapon re-imports with nothing foreign', emitterClean, 'emitter not clean');
}

// ---- named hooks (on_fire = place, on_explode = detonate) ----------------
{
  const modFiles: ModFile[] = [
    {
      path: 'mod.toml',
      text: `id = "t.named"
name = "Named Hooks"
version = "1.0.0"
[[components]]
id = "t.named.bomb"
type = "weapon"
name = "Named Bomb"
entry = "weapons/bomb.lua"
`,
    },
    {
      path: 'weapons/bomb.lua',
      text: lines(
        'local ART = "sprites/orig_mod/"',
        'local function detonate(ev)',
        '  local _ = ART .. "smoke.png"',
        '  wa.world.blast{ x = ev.x, y = ev.y, power = 15 }',
        'end',
        'local function launch(ev)',
        '  wa.sound.play(ev.worm, 44)',
        'end',
        'local weapon = {',
        '  definition = {',
        '    copy_from = "stock.grenade",',
        '    on_fire = launch,',
        '    on_explode = detonate,',
        '  },',
        '}',
        'return weapon',
      ),
    },
  ];
  const bundle = readBundles(modFiles)[0];
  const weapon = readWeapons([bundle], modFiles)[0];
  const first = await importBundleWeapon(weapon, modFiles);
  const firstProj = baseProject(first.project);
  const carriedHookKeys = (firstProj.carriedLua?.hooks ?? []).map((h) => h.key).sort().join(',');
  check(
    'named on_explode and on_fire hooks are both carried with their closures',
    carriedHookKeys === 'on_explode,on_fire' &&
      (firstProj.carriedLua?.preamble ?? []).some((b) => b.text.includes('local function detonate(')) &&
      (firstProj.carriedLua?.preamble ?? []).some((b) => b.text.includes('local function launch(')),
    carriedHookKeys,
  );
  check(
    'folder-prefix literals in carried locals rewrite to the export folder',
    (firstProj.carriedLua?.preamble ?? []).some((b) => b.text.includes('sprites/named_bomb/')),
  );
  const code = generateLuaCode(firstProj);
  const secondFiles: ModFile[] = [
    { path: 'mod.toml', text: generateModToml(firstProj) },
    { path: `weapons/${sanitizeModFolder(firstProj.id)}.lua`, text: code },
  ];
  const secondWeapon = readWeapons([readBundles(secondFiles)[0]], secondFiles)[0];
  const second = await importBundleWeapon(secondWeapon, secondFiles);
  const secondProj = baseProject(second.project);
  check(
    'named hooks round-trip with identical preamble and hook counts',
    (secondProj.carriedLua?.hooks?.length ?? 0) === (firstProj.carriedLua?.hooks?.length ?? 0) &&
      (secondProj.carriedLua?.preamble?.length ?? 0) === (firstProj.carriedLua?.preamble?.length ?? 0),
    `hooks ${secondProj.carriedLua?.hooks?.length}/${firstProj.carriedLua?.hooks?.length}, preamble ${secondProj.carriedLua?.preamble?.length}/${firstProj.carriedLua?.preamble?.length}`,
  );
}

// ---- F13: the closure's scoping, the emitted-code drop and the art carry ---
{
  /** The closure exactly as `importBundleWeapon` asks for it: with the hook's scopes. */
  const carryOn = (moduleText: string, emitted = '') => {
    const split = splitModule(moduleText);
    const seeds = split.hooks.on_explode
      ? [{ label: 'on_explode', text: split.hooks.on_explode, enclosing: split.hookScopes.on_explode }]
      : [];
    return carryClosure(seeds, split, new Map(), 'w', emitted);
  };
  const claimWith = (preamble: string[], install: string[], hook: string) =>
    lines(
      ...preamble,
      'return {',
      '  install = function(ctx)',
      ...install,
      '    wa.weapons.replace{',
      '      on_explode = function(ev)',
      `        ${hook}`,
      '      end,',
      '    }',
      '  end,',
      '}',
    );
  const texts = (blocks: { text: string }[]) => blocks.map((block) => block.text);

  // Two bare assignments after the local: each one asks for the declaration
  // *before* it, so the walk reaches `local x = {}` instead of bouncing between
  // the two assignments.
  const chained = carryOn(claimWith([], ['    local x = {}', '    x = init_a(x)', '    x = init_b(x)'], 'use(x)'));
  check(
    'local x = {}; x = a(x); x = b(x) carries the local and both assignments',
    JSON.stringify(texts(chained.prologue)) === JSON.stringify(['local x = {}', 'x = init_a(x)', 'x = init_b(x)']),
    JSON.stringify(texts(chained.prologue)),
  );
  const moduleLevel = carryOn(claimWith(['local x', 'x = make()'], [], 'use(x)'));
  check(
    'a module-level local x; x = ... carries the local with the assignment',
    JSON.stringify(texts(moduleLevel.preamble)) === JSON.stringify(['local x', 'x = make()']),
    JSON.stringify(texts(moduleLevel.preamble)),
  );

  // A module-level helper cannot see an install local, so it must not be
  // satisfied by one: the name stays unresolved and nothing is hoisted for it.
  const helper = carryOn(claimWith(['local function helper() return state end'], ['    local state = 42'], 'helper()'));
  check(
    'a preamble helper reading an install local leaves it unresolved',
    helper.prologue.length === 0 && helper.unresolved.includes('state'),
    `prologue ${JSON.stringify(texts(helper.prologue))}, unresolved ${helper.unresolved.join(',')}`,
  );

  // A sibling function's parameter is not the hook's: only an enclosing
  // function's parameter list is a place a free name can come from.
  const sibling = carryOn(
    lines(
      'local function setup(a)',
      '  local function unrelated(mystery) return mystery end',
      '  wa.weapons.replace{',
      '    on_explode = function(ev) use(mystery) end,',
      '  }',
      'end',
      'return { install = function(ctx) setup(1) end }',
    ),
  );
  check(
    'a sibling function parameter is not blamed for a free name',
    sibling.unresolved.includes('mystery') && !sibling.notes.some((note) => note.includes('unrelated(')),
    sibling.notes.join(' | '),
  );
  const enclosing = carryOn(
    lines(
      'local M = {}',
      'function M.install(ctx, spec)',
      '  wa.weapons.replace{',
      '    on_explode = function(ev) use(spec) end,',
      '  }',
      'end',
      'return M',
    ),
  );
  check(
    'an enclosing install parameter is still named',
    enclosing.notes.some((note) => note.includes('`spec` is a parameter of `M.install(ctx, spec)`')),
    enclosing.notes.join(' | '),
  );

  // The export writes `local seen = {}` for its own trail *after* the claim, so
  // a carried hook (which runs inside the claim) still needs its own copy. A
  // copy before the claim is the same binding and is dropped.
  const seenModule = claimWith([], ['    local seen = {}'], 'seen[ev.id] = true');
  const after = carryOn(seenModule, 'wa.weapons.replace{\n  name = "x",\n}\nlocal seen = {}\n');
  check(
    'a claim hook keeps a local the export only declares after the claim',
    JSON.stringify(texts(after.prologue)) === JSON.stringify(['local seen = {}']),
    JSON.stringify(texts(after.prologue)),
  );
  const before = carryOn(seenModule, 'local seen = {}\nwa.weapons.replace{\n  name = "x",\n}\n');
  check('and drops one the export declares before it', before.prologue.length === 0, JSON.stringify(texts(before.prologue)));

  // The lockstep notes are about code, not about a comment or a string that
  // mentions `math.random()`.
  const prose = chained.transform('-- math.random() and math.sin(1)\nlocal s = "math.random() math.cos(2)"\nreturn s');
  check(
    'math.* in comments and strings is neither a float random nor a rewrite',
    !prose.floatRandom && prose.rewrites.length === 0,
    JSON.stringify({ floatRandom: prose.floatRandom, rewrites: prose.rewrites }),
  );
  const real = chained.transform('local a = math.random()\nlocal b = math.sin(1)');
  check(
    'while the same calls in code are reported',
    real.floatRandom && real.rewrites.includes('math.sin -> wa.math.sin'),
    JSON.stringify({ floatRandom: real.floatRandom, rewrites: real.rewrites }),
  );

  // Paths: a comment is prose, a mismatched quote is not a string, and a folder
  // that already has the export's name is still a folder the export must fill.
  const commented = rewriteBundlePaths('-- see "sprites/old/x.png"\nlocal a = "sprites/old/y.png"', 'w');
  check(
    'a path in a -- comment is not moved',
    commented.text.startsWith('-- see "sprites/old/x.png"') &&
      commented.moves.length === 1 &&
      commented.moves[0].source === 'sprites/old/y.png',
    JSON.stringify(commented),
  );
  const mismatched = rewriteBundlePaths('local a = "sprites/old/y.png\'\nlocal b = \'sounds/old/z.wav"', 'w');
  check('a path between mismatched quotes is not moved', mismatched.moves.length === 0, JSON.stringify(mismatched.moves));
  const sameFolder = rewriteBundlePaths('local SND = "sounds/buffalo/"\nwa.sound.play(w, SND .. "start.wav", 8)', 'buffalo');
  check(
    'a folder prefix already named for the export is still recorded',
    sameFolder.moves.length === 1 && sameFolder.moves[0].source === 'sounds/buffalo/',
    JSON.stringify(sameFolder.moves),
  );
}
{
  // The art carry, end to end: a nested sound folder keeps its subfolder, and a
  // sheet's `[sprites."…"]` is matched by its own path before a sibling weapon's
  // sheet that shares the file name.
  const png = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
    137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130,
  ]);
  const wav = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
  const weaponLua = (name: string, preamble: string[], hook: string[]) =>
    lines(
      ...preamble,
      'return {',
      '  install = function(ctx)',
      '    wa.weapons.replace{',
      `      name = "${name}",`,
      '      copy_from = "stock.grenade",',
      '      on_explode = function(ev)',
      ...hook.map((row) => `        ${row}`),
      '      end,',
      '    }',
      '  end,',
      '}',
    );
  const files: ModFile[] = [
    {
      path: 'mod.toml',
      text: lines(
        'id = "t.art"',
        'name = "Art"',
        'version = "0.1.0"',
        'api_version = 4',
        'format_version = 2',
        '',
        '[[components]]',
        'id = "t.art.w1"',
        'type = "weapon"',
        'name = "W1"',
        'entry = "weapons/w1.lua"',
        '',
        '[[components]]',
        'id = "t.art.w2"',
        'type = "weapon"',
        'name = "W2"',
        'entry = "weapons/w2.lua"',
        '',
        '[sprites."sprites/w1/trail.png"]',
        'frames = 4',
        'fps = 15',
        '',
        '[sprites."sprites/w2/trail.png"]',
        'frames = 16',
        'fps = 20',
      ),
    },
    { path: 'weapons/w1.lua', text: weaponLua('W1', [], ['wa.draw.quad{ sprite = "sprites/w1/trail.png", x = ev.x, y = ev.y }']) },
    {
      path: 'weapons/w2.lua',
      text: weaponLua('W2', ['local SND = "sounds/other/sub/"'], [
        'wa.draw.quad{ sprite = "sprites/w2/trail.png", x = ev.x, y = ev.y }',
        'wa.sound.play(ev.worm, SND .. "hit.wav", 8)',
      ]),
    },
    { path: 'sprites/w1/trail.png', text: '', bytes: png },
    { path: 'sprites/w2/trail.png', text: '', bytes: png },
    { path: 'sounds/other/sub/hit.wav', text: '', bytes: wav },
    { path: 'sounds/other/root.wav', text: '', bytes: wav },
  ];
  const w2 = readWeapons(readBundles(files), files).find((weapon) => weapon.componentId === 't.art.w2');
  if (!w2) {
    check('the two-weapon art bundle reads', false);
  } else {
    const imported = (await importBundleWeapon(w2, files)).project;
    const sounds = imported.carriedLua?.art?.sounds ?? [];
    check(
      'a nested sound folder carries its own files under its subfolder',
      JSON.stringify(sounds) === JSON.stringify(['sounds/w2/sub/hit.wav']),
      JSON.stringify(sounds),
    );
    const sheet = imported.customSprites?.['sprites/w2/trail.png'];
    check(
      'a carried sheet takes its own [sprites] frames, not a namesake',
      sheet?.frames === 16 && sheet?.fps === 20,
      JSON.stringify({ frames: sheet?.frames, fps: sheet?.fps }),
    );
  }
}
{
  // A teleport claim and a carried `on_select` are one key: written twice, Lua
  // keeps the second and the cursor (or the handler) silently goes.
  const project = {
    ...baseProject({
      fireType: 'cursor',
      carriedLua: {
        preamble: [],
        prologue: [],
        hooks: [{ key: 'on_select', text: 'function(sel) mark(sel) end', line: 5 }],
        unresolved: [],
      },
    }),
    teleport: true,
  } as WeaponProject;
  const code = generateLuaCode(project);
  const keys = code.match(/\bon_select\s*=/g) ?? [];
  check(
    'teleport + a carried on_select emit one merged on_select',
    keys.length === 1 && /on_select = \{ cursor = true, on = function\(sel\)/.test(code),
    `${keys.length} on_select key(s)`,
  );
}

// ---- dependencies ------------------------------------------------------
check(
  'every library module maps to the dependency that provides it',
  dependencyForModule('wf-lib/effects/px_effects') === 'effects.sdk' &&
    dependencyForModule('wf-lib/electric/damage') === 'px.electric' &&
    dependencyForModule('wf-lib/holds') === 'wf.sdk' &&
    dependencyForModule('wf-lib/fire_seq') === 'px.fire_seq' &&
    dependencyForModule('lib/whatever') === null,
);

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('carried lua: all checks passed');
