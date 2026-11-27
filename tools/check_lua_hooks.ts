/**
 * The hook registry and the module splitter (`src/utils/modLib/splitModule.ts`).
 * No server, exits 1 on a failure.
 *
 *   bun run tools/check_lua_hooks.ts
 *
 * M1 is groundwork: it reads a module's preamble, install body, `wa.on.*`
 * registrations and claim hooks, and emits nothing. The cases here are the
 * shapes the carrying milestones will have to move, taken from the corpus the
 * plan is based on:
 *
 *  - the editor's own generated shape (requires, install, a multi-line claim);
 *  - the Conductor's filtered registration, which is the one a scan that takes
 *    only the function literal silently breaks (`msgs = { wa.msg.FIRE_WEAPON }`);
 *  - PX's module-table shape (`function M.install(ctx)`), which has no claim
 *    literal at all;
 *  - bodies built to look like closers: a comment saying `end`, a string saying
 *    "the end", a nested function and a table, and a `local x = function() … end`
 *    spanning lines.
 *
 * When the four real bundles are on disk they are checked too (D: drive, skipped
 * otherwise): their registrations, their filters, their hooks, and that every
 * event they register is one the engine binds.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAIM_HOOKS,
  CLAIM_HOOK_KEYS,
  WA_ON_EVENTS,
  WA_ON_EVENT_NAMES,
  WA_ON_EVENTS_WITH_OPTIONS,
} from '../src/data/luaHooks';
import { splitModule } from '../src/utils/modLib/splitModule';
import { ownOutputOf } from '../src/utils/modLib/ownOutput';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};
const nl = String.fromCharCode(10);
const lines = (...rows: string[]) => rows.join(nl);

// ---- the registry ---------------------------------------------------------
{
  const events = WA_ON_EVENTS.map((entry) => entry.event);
  check('every wa.on event is listed once', new Set(events).size === events.length);
  check(
    'only worm_message and body_move take options',
    [...WA_ON_EVENTS_WITH_OPTIONS].sort().join(',') === 'body_move,worm_message',
    [...WA_ON_EVENTS_WITH_OPTIONS].join(','),
  );
  check(
    'the filter is named msgs, the body_move option kinds',
    WA_ON_EVENTS.find((e) => e.event === 'worm_message')?.options?.key === 'msgs' &&
      WA_ON_EVENTS.find((e) => e.event === 'body_move')?.options?.key === 'kinds',
  );
  check(
    'every event says what it takes',
    WA_ON_EVENTS.every((entry) => entry.takes.length > 3),
  );
  check(
    'the claim hooks are unique and every one is named',
    new Set(CLAIM_HOOK_KEYS).size === CLAIM_HOOKS.length && CLAIM_HOOKS.every((h) => h.key.startsWith('on_')),
  );
}

// ---- the editor's own shape ----------------------------------------------
{
  const module = lines(
    'local holds = require("wf-lib/holds")',
    'local sb = require("wf-lib/wfws_sprite_builder")',
    'local fx = require("wf-lib/effects/px_effects")',
    '',
    'return {',
    '  defaults = { ammo = { round_start = 1 } },',
    '  install = function(ctx)',
    '    local hold = sb.hold(ctx, {',
    '      weapon = ctx.id,',
    '      sheet = "sprites/x/hold.png",',
    '    })',
    '    local TRAIL = { max = 6, every = 1, vanish = 2 }',
    '    local function trail_worm()',
    '      for _, w in ipairs(wa.worms.all()) do',
    '        if w.turn then return w end',
    '      end',
    '    end',
    '    wa.on.missile_frame(function(m)',
    '      if m.weapon ~= ctx.id then return end',
    '    end)',
    '    sb.flight(ctx, { weapon = ctx.id, sheet = "sprites/x/missile.png" })',
    '    wa.weapons.replace{',
    '      name = "X",',
    '      hold = hold,',
    '      on_explode = { on = function(ev)',
    '        fx.burst{ x = ev.x, y = ev.y, radius = 70 }',
    '      end },',
    '    }',
    '  end,',
    '}',
  );
  const split = splitModule(module);
  check('the install function is found', !!split.install && split.install.param === 'ctx');
  check(
    'the preamble is the module requires, and nothing of the claim table',
    split.preamble.length === 3 && split.preamble.every((block) => block.kind === 'require'),
    split.preamble.map((b) => `${b.kind}:${b.declares.join('+')}`).join(', '),
  );
  check(
    'the preamble names what it declares',
    split.preamble.map((block) => block.declares[0]).join(',') === 'holds,sb,fx',
    split.preamble.map((block) => block.declares[0]).join(','),
  );
  const kinds = split.install?.statements.map((block) => block.kind).join(',') ?? '';
  check(
    'the install body statements are classified',
    kinds === 'local,local,function,call,call,call',
    kinds,
  );
  check(
    'a multi-line table call stays one statement',
    (split.install?.statements[0].text.split(nl).length ?? 0) === 4,
    split.install?.statements[0].text,
  );
  check(
    'the install helper is found and named',
    split.install?.statements[2].declares[0] === 'trail_worm',
    split.install?.statements[2].declares.join(','),
  );
  check(
    'the registration is one missile_frame with no options',
    split.registrations.length === 1 &&
      split.registrations[0].event === 'missile_frame' &&
      split.registrations[0].options === null,
    JSON.stringify(split.registrations.map((r) => [r.event, r.options])),
  );
  check(
    'the registration keeps its whole call',
    split.registrations[0]?.text.startsWith('wa.on.missile_frame(') &&
      split.registrations[0]?.handler.startsWith('function(m)'),
    split.registrations[0]?.text,
  );
  check(
    'the claim hook body is the function literal',
    split.hooks.on_explode?.startsWith('function(ev)') === true &&
      split.hooks.on_explode.includes('fx.burst{'),
    split.hooks.on_explode ?? 'missing',
  );
  check(
    'every require in the file is listed once',
    split.requires.join(',') === 'wf-lib/holds,wf-lib/wfws_sprite_builder,wf-lib/effects/px_effects',
    split.requires.join(','),
  );
  check('nothing was reported unreadable', split.notes.length === 0, split.notes.join(' | '));
}

// ---- the Conductor's filtered registration -------------------------------
{
  const module = lines(
    'local BOLT = { points = 9, noise = 15 }',
    'local bolts = {}',
    '',
    'return {',
    '  install = function(ctx)',
    '    local function new_shape(b)',
    '      b.age = b.age + 1',
    '    end',
    '    wa.on.worm_message(function(worm)',
    '      if worm.weapon == ctx.id then',
    '        wa.sound.play(worm, "sounds/conductor/shot.wav", 8)',
    '      end',
    '    end, { msgs = { wa.msg.FIRE_WEAPON } })',
    '  end,',
    '}',
  );
  const split = splitModule(module);
  check('a filtered registration is one registration', split.registrations.length === 1);
  check(
    'its filter is carried as part of the call, not dropped',
    split.registrations[0]?.options?.includes('msgs = { wa.msg.FIRE_WEAPON }') === true,
    split.registrations[0]?.options ?? 'no options',
  );
  check(
    'the handler is the literal, without the filter',
    split.registrations[0]?.handler.startsWith('function(worm)') &&
      !split.registrations[0]?.handler.includes('msgs'),
    split.registrations[0]?.handler,
  );
  check(
    'and its event is one the engine binds',
    WA_ON_EVENT_NAMES.includes('worm_message' as (typeof WA_ON_EVENT_NAMES)[number]),
  );
}

// ---- PX's module-table shape --------------------------------------------
{
  const module = lines(
    'local shared = require("lib/shared")',
    'local weapon = {}',
    '',
    'weapon.record = {',
    '  missile = { explosion = { power = 20 } },',
    '}',
    '',
    'function M.install(ctx)',
    '  local pending = {}',
    '  wa.weapons.replace{',
    '    copy_from = "stock.bazooka",',
    '    on_click = function(ev)',
    '      pending[#pending + 1] = ev.x',
    '    end,',
    '  }',
    '  wa.on.body_move(function(body)',
    '    pending.body = body',
    '  end, { kinds = { "worm" } })',
    'end',
    '',
    'return M',
  );
  const split = splitModule(module);
  check('the M.install form is found', !!split.install && split.install.param === 'ctx');
  check(
    'the module table declaration is not mistaken for the install',
    split.preamble.some((block) => block.declares[0] === 'weapon'),
    split.preamble.map((b) => b.kind).join(','),
  );
  check(
    'body_move options are kept',
    split.registrations[0]?.options?.includes('kinds') === true,
    split.registrations[0]?.options ?? 'no options',
  );
  check(
    'a claim hook inside the install body is found',
    split.hooks.on_click?.includes('pending[#pending + 1]') === true,
    split.hooks.on_click ?? 'missing',
  );
}

// ---- a hook written inside another hook ---------------------------------
{
  // PX's `fire_seq` burst passes `on_done` (and `on_shot`) as a value in the
  // options table of the call `on_fire` makes, so those close over `on_fire`'s
  // locals. They are not claim keys of their own: carrying one as a separate key
  // would hoist it out of the scope it was written in.
  const module = lines(
    'local BURSTS = 4',
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_fire = function(ev)',
    '        local fired = 0',
    '        local last = fired == BURSTS - 1',
    '        seq.fire_seq_mis({',
    '          count = 3,',
    '          on_done = function(ww)',
    '            if last then wa.sound.play(ww, "sounds/famas-2.wav", 8) end',
    '          end,',
    '        })',
    '      end,',
    '    }',
    '  end,',
    '}',
  );
  const split = splitModule(module);
  check('both hooks are found', !!split.hooks.on_fire && !!split.hooks.on_done);
  check(
    'the one written inside the other is reported as nested',
    split.nestedHooks.includes('on_done' as (typeof split.nestedHooks)[number]),
    split.nestedHooks.join(', '),
  );
  check('and the parent is not', !split.nestedHooks.includes('on_fire' as (typeof split.nestedHooks)[number]));
  check(
    'the nested body is still part of the parent text',
    split.hooks.on_fire?.includes('on_done = function(ww)') === true,
  );
}

// ---- bodies that look like closers --------------------------------------
{
  const module = lines(
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_fire = function(fire)',
    '        -- the end of the barrel, not of the body',
    '        local label = "the end"',
    '        local function inner(n)',
    '          if n > 0 then',
    '            return { n = n, text = "end" }',
    '          end',
    '          return nil',
    '        end',
    '        inner(2)',
    '        local pick = function(a)',
    '          return a',
    '        end',
    '      end,',
    '    }',
    '    local after = 1 -- a stray statement after the table',
    '  end,',
    '}',
  );
  const split = splitModule(module);
  const body = split.hooks.on_fire ?? '';
  check(
    'a hook body survives a comment, a string and nested blocks',
    body.includes('local label = "the end"') &&
      body.includes('local function inner(n)') &&
      body.trimEnd().endsWith('end'),
    body.split(nl).slice(-3).join(' / '),
  );
  check(
    'and the statement scan is not confused by it',
    split.install?.statements.length === 2 &&
      /^local after/.test(split.install.statements[1].text),
    split.install?.statements.map((b) => b.kind).join(','),
  );
  check(
    'the claim table is one statement, the stray local another',
    split.install?.statements[0].kind === 'call',
    split.install?.statements[0].kind,
  );
}

// ---- recognising this editor's own output --------------------------------
{
  // M1.5: a registration the editor wrote must be rebuilt from its panel, not
  // carried as foreign code, or a re-import ships two ribbons. The signature has
  // to be specific enough that a hand-written handler does not match.
  const trail = lines(
    'return {',
    '  install = function(ctx)',
    '    local trail = require("wf-lib/effects/trail")',
    '    local TRAIL = { max = 6, every = 1, vanish = 2 }',
    '    local function trail_worm() return nil end',
    '    local trailed = {}',
    '    wa.on.missile_frame(function(m)',
    '      if m.weapon ~= ctx.id or m.phase ~= "pre" then return end',
    '      if trail.add(m.id, trail_worm(), TRAIL) then trailed[#trailed + 1] = m.id end',
    '    end)',
    '  end,',
    '}',
  );
  const trailOut = ownOutputOf(splitModule(trail));
  check(
    'the generated trail handler is recognised',
    trailOut.own.length === 1 && trailOut.own[0].emission.feature === 'ribbon-trail',
    trailOut.own.map((o) => o.emission.feature).join(',') || 'none',
  );

  // A hand-written handler that also follows missiles looks the same from far
  // away: it plays a WAV on a timer and calls no `trail.add` with a `TRAIL` table.
  const handWritten = lines(
    'return {',
    '  install = function(ctx)',
    '    local ticks = {}',
    '    wa.on.missile_frame(function(m)',
    '      if m.weapon ~= ctx.id then return end',
    '      ticks[m.id] = (ticks[m.id] or 0) + 1',
    '      if ticks[m.id] % 10 == 0 then wa.sound.play(m.worm, "sounds/x/hum.wav", 8) end',
    '    end)',
    '    wa.on.worm_message(function(worm)',
    '      if worm.weapon ~= ctx.id then return end',
    '    end, { msgs = { wa.msg.FRAME_FINISH } })',
    '  end,',
    '}',
  );
  const handOut = ownOutputOf(splitModule(handWritten));
  check(
    'a hand-written missile_frame is not claimed as ours',
    handOut.own.length === 0 && handOut.foreign.length === 2,
    `${handOut.own.length} own, ${handOut.foreign.length} foreign`,
  );
  check(
    'a FRAME_FINISH handler without the fuse table is not the sampler',
    handOut.foreign.some((registration) => registration.event === 'worm_message'),
  );

  // The sampler is the shape the generator writes, `FUSE_DEFAULT` above it.
  const sampler = lines(
    'local FUSE_DEFAULT = 3000',
    'local fuse_by_worm = {}',
    'return {',
    '  install = function(ctx)',
    '    wa.on.worm_message(function()',
    '      fuse_by_worm[w.id] = 5 * 1000',
    '    end, { msgs = { wa.msg.FRAME_FINISH } })',
    '  end,',
    '}',
  );
  const samplerOut = ownOutputOf(splitModule(sampler));
  check(
    'the generated fuse sampler is recognised',
    samplerOut.own.length === 1 && samplerOut.own[0].emission.feature === 'fuse-sampler',
    samplerOut.own.map((o) => o.emission.feature).join(',') || 'none',
  );
}

// ---- the four real bundles, when they are on disk ------------------------
{
  const MODS = 'D:/Worms Armageddon/WormBench/Mods';
  const wanted: [string, string][] = [
    ['conductor', 'conductor/weapons/conductor.lua'],
    ['pulsar', 'pulsar/weapons/pulsar.lua'],
    ['railgun', 'railgun/weapons/railgun.lua'],
    ['vortex', 'vortex/weapons/vortex.lua'],
  ];
  const present = wanted.filter(([, path]) => existsSync(join(MODS, path)));
  if (present.length === 0) {
    console.log('skip  the four real bundles are not on this machine');
  } else {
    for (const [name, path] of present) {
      const code = readFileSync(join(MODS, path), 'utf8');
      const split = splitModule(code);
      check(`${name}: the install function is found`, !!split.install && !!split.install.bodyText.trim());
      check(`${name}: it has registrations`, split.registrations.length > 0, String(split.registrations.length));
      check(
        `${name}: every event it registers is one the engine binds`,
        split.registrations.every((registration) => WA_ON_EVENT_NAMES.includes(registration.event)),
        split.registrations.map((r) => r.event).join(','),
      );
      check(
        `${name}: every option it passes is one the engine accepts`,
        split.registrations.every(
          (registration) =>
            registration.options === null ||
            (registration.event === 'worm_message' &&
              registration.options.includes('msgs =')),
        ),
        split.registrations
          .filter((r) => r.options !== null)
          .map((r) => `${r.event}:${r.options}`)
          .join(' | '),
      );
      // The counts M0's and the plan's evidence rest on.
      const expected: Record<string, { events: string; hooks: string }> = {
        conductor: { events: 'draw,worm_message', hooks: 'on_fire' },
        pulsar: { events: 'missile_frame,missile_frame,missile_frame', hooks: 'on_explode' },
        railgun: { events: 'missile_frame,missile_frame', hooks: 'on_explode' },
        vortex: { events: 'missile_frame,draw', hooks: 'on_explode' },
      };
      check(
        `${name}: its registrations are the ones the plan counted`,
        split.registrations.map((r) => r.event).join(',') === expected[name].events,
        split.registrations.map((r) => r.event).join(','),
      );
      check(
        `${name}: its claim hooks are the ones the plan counted`,
        Object.keys(split.hooks).join(',') === expected[name].hooks,
        Object.keys(split.hooks).join(','),
      );
      // M1.5: which of its registrations a panel already writes back.
      const own = ownOutputOf(split);
      const ownExpectations: Record<string, { own: string; foreign: string }> = {
        conductor: { own: '', foreign: 'draw,worm_message' },
        pulsar: {
          own: 'ribbon-trail,interval-sound',
          foreign: 'missile_frame',
        },
        railgun: { own: 'ribbon-trail,interval-sound', foreign: '' },
        vortex: { own: 'ribbon-trail', foreign: 'draw' },
      };
      check(
        `${name}: its own emissions are recognised`,
        own.own.map(({ emission }) => emission.feature).join(',') === ownExpectations[name].own,
        own.own.map(({ emission }) => emission.feature).join(',') || 'none',
      );
      check(
        `${name}: and only its own code is left as foreign`,
        own.foreign.map((registration) => registration.event).join(',') ===
          ownExpectations[name].foreign,
        own.foreign.map((registration) => registration.event).join(',') || 'none',
      );
    }
    const conductor = present.some(([name]) => name === 'conductor')
      ? splitModule(readFileSync(join(MODS, 'conductor/weapons/conductor.lua'), 'utf8'))
      : null;
    const filtered = conductor?.registrations.find((r) => r.event === 'worm_message');
    check(
      'conductor: its msgs filter is carried with the call',
      filtered?.options?.includes('wa.msg.FIRE_WEAPON') === true,
      filtered?.options ?? 'no worm_message registration',
    );
    check(
      'conductor: and only its own event gets one',
      conductor?.registrations.filter((r) => r.options !== null).length === 1,
      conductor?.registrations.map((r) => `${r.event}:${r.options}`).join(' | '),
    );
    check(
      'conductor: its own on_fire body is whole',
      (conductor?.hooks.on_fire?.length ?? 0) > 500,
      String(conductor?.hooks.on_fire?.length ?? 0),
    );
  }
}

// ---- the editor's own output, when the pack has been generated -----------
{
  const PACK = join(fileURLToPath(new URL('..', import.meta.url)), 'test_pack', 'wftest_pack', 'weapons');
  if (!existsSync(PACK)) {
    console.log('skip  the test pack has not been generated (bun run tools/gen_test_pack.ts)');
  } else {
    const files = readdirSync(PACK).filter((file) => file.endsWith('.lua'));
    const bad: string[] = [];
    let withCalls = 0;
    let withRegistrations = 0;
    let withCarried = 0;
    for (const file of files) {
      const code = readFileSync(join(PACK, file), 'utf8');
      const split = splitModule(code);
      const own = ownOutputOf(split);
      if (code.includes('wa.on.')) withCalls += 1;
      if (split.registrations.length > 0) withRegistrations += 1;
      // A carried registration is a bundle's, not ours: the pack has two weapons
      // written to prove the carry works (WF 57's `wa.on.hurt`, and the emitter's
      // own two which must stay ours). Everything the editor *generated* has to
      // be recognised, so the rule is per region: the carried ones are the calls
      // after the header the generator writes for them.
      const carriedAt = code.indexOf('-- Carried from the source bundle: its own');
      const lineOf = (offset: number) => code.slice(0, offset).split(String.fromCharCode(10)).length;
      const carriedFrom = carriedAt < 0 ? Number.POSITIVE_INFINITY : lineOf(carriedAt);
      const generatedOnly = own.foreign.filter((entry) => entry.line < carriedFrom);
      const carriedHere = own.foreign.filter((entry) => entry.line >= carriedFrom);
      if (carriedHere.length > 0) withCarried += 1;
      if (generatedOnly.length > 0) {
        bad.push(`${file}: not recognised ${generatedOnly.map((r) => r.event).join(',')}`);
      }
      const unknown = split.registrations.find(
        (registration) => !WA_ON_EVENT_NAMES.includes(registration.event),
      );
      if (!split.install || split.notes.length > 0 || unknown) {
        bad.push(`${file}: ${split.notes.join('; ') || unknown?.event || 'no install'}`);
      }
    }
    check(
      `all ${files.length} generated weapons split cleanly`,
      files.length > 0 && bad.length === 0,
      bad.slice(0, 3).join(' | '),
    );
    check(
      'every generated file that registers a hook is found',
      withCalls > 0 && withCalls === withRegistrations,
      `${withRegistrations} read, ${withCalls} contain wa.on.`,
    );
    check(
      'and the pack has a weapon carrying a handler of its own',
      withCarried > 0,
      `${withCarried} with a carried registration`,
    );
  }
}

// ---- named claim hook bindings (on_fire = place, on_explode = detonate) --
{
  const module = lines(
    'local function place(ev)',
    '  wa.sound.play(ev.worm, 112)',
    'end',
    'local function detonate(ev)',
    '  wa.world.blast{ x = ev.x, y = ev.y, power = 10 }',
    'end',
    'local weapon = {}',
    'weapon.definition = {',
    '  on_fire = place,',
    '  on_explode = { on = detonate },',
    '  on_click = false,',
    '}',
    'return weapon',
  );
  const split = splitModule(module);
  check(
    'named on_fire = place wraps into an event handler',
    split.hooks.on_fire === 'function(ev)\n  return place(ev)\nend' &&
      (split.namedHooks ?? []).includes('on_fire'),
    split.hooks.on_fire ?? 'missing',
  );
  check(
    'named on_explode = { on = detonate } wraps into an event handler',
    split.hooks.on_explode === 'function(ev)\n  return detonate(ev)\nend' &&
      (split.namedHooks ?? []).includes('on_explode'),
    split.hooks.on_explode ?? 'missing',
  );
  check(
    'boolean literal on_click = false is not treated as a named hook',
    split.hooks.on_click === undefined,
    split.hooks.on_click ?? 'none',
  );
}

// ---- F13: block depth, install lookup and the claim-hook scan -------------
{
  // `until` closes `repeat` without ending the statement: the condition after it
  // belongs to the same block, and the body region stops before `install`'s own
  // `end` (a split that walked onto it noted a phantom unclosed block).
  const split = splitModule(
    lines(
      'return {',
      '  install = function(ctx)',
      '    local x = 0',
      '    repeat',
      '      x = x + 1',
      '    until x > 3',
      '    local y = 1',
      '  end,',
      '}',
    ),
  );
  const texts = split.install?.statements.map((s) => s.text) ?? [];
  check(
    'repeat ... until <cond> inside install is one statement',
    texts.length === 3 && texts[1].endsWith('until x > 3') && texts[2] === 'local y = 1',
    JSON.stringify(texts),
  );
  check('and the split reports nothing unclosed', split.notes.length === 0, split.notes.join(' | '));
}
{
  // `uninstall` ends in `install`, and so used to match as the install function.
  const split = splitModule(
    lines(
      'local function uninstall(x)',
      '  return x',
      'end',
      'function M.install(ctx)',
      '  wa.on.draw(function() end)',
      'end',
    ),
  );
  check(
    'function uninstall(x) is not taken for install',
    !!split.install && !split.install.bodyText.includes('return x') && split.install.bodyText.includes('wa.on.draw'),
    JSON.stringify(split.install?.bodyText),
  );
  const plain = splitModule(lines('function install(ctx)', '  wa.on.draw(function() end)', 'end'));
  check('a plain function install(ctx) is found', !!plain.install?.bodyText.includes('wa.on.draw'));
}
{
  // A table hook with keys before `on =`: the teleport claim's own shape.
  const split = splitModule(
    lines(
      'return {',
      '  install = function(ctx)',
      '    wa.weapons.replace{',
      '      copy_from = "stock.teleport",',
      '      on_select = { cursor = true, on = function(sel) mark(sel) end },',
      '    }',
      '  end,',
      '}',
    ),
  );
  check(
    'on_select = { cursor = true, on = function ... } is captured',
    split.hooks.on_select === 'function(sel) mark(sel) end',
    split.hooks.on_select ?? 'none',
  );
}
{
  // A hook-named key in a table that is not the claim (a helper's options, an
  // unrelated table) is not a claim hook of this weapon.
  const split = splitModule(
    lines(
      'local function helper()',
      '  local t = { on_explode = function(ev) boom(ev) end }',
      '  return t',
      'end',
      'return {',
      '  install = function(ctx)',
      '    wa.weapons.replace{ copy_from = "stock.grenade" }',
      '  end,',
      '}',
    ),
  );
  check(
    'on_explode outside wa.weapons.replace is not a claim hook',
    split.hooks.on_explode === undefined,
    split.hooks.on_explode ?? 'none',
  );
}
{
  // A hand-written trail that happens to use the same names (`TRAIL`,
  // `trail.add`) through its own library is the author's code: claiming it as
  // ours dropped the handler on import.
  const foreignTrail = lines(
    'return {',
    '  install = function(ctx)',
    '    local trail = require("lib/my_trail")',
    '    local TRAIL = { max = 10 }',
    '    wa.on.missile_frame(function(m)',
    '      if m.weapon ~= ctx.id then return end',
    '      trail.add(m.id, nil, TRAIL)',
    '    end)',
    '  end,',
    '}',
  );
  const out = ownOutputOf(splitModule(foreignTrail));
  check(
    'a TRAIL handler without wf-lib/effects/trail is foreign',
    out.own.length === 0 && out.foreign.length === 1,
    `own ${out.own.map((o) => o.emission.feature).join(',') || 'none'}, foreign ${out.foreign.length}`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nlua hooks and module split: all checks passed');
