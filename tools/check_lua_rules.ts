/**
 * The carried-code rules (`src/utils/luaCheck.ts`). No server, exits 1 on a
 * failure.
 *
 *   bun run tools/check_lua_rules.ts
 *
 * The rule ids are `wbcheck`'s, so a finding here means the same thing in the
 * compiler. Every case is a fragment of the shape an import or a custom body
 * really has, including the two regressions this milestone exists for:
 *
 *  - an imported Pulsar exported `aura[ev.missile] = nil` with no `aura`
 *    anywhere, so `on_explode` threw on every blast;
 *  - `math.sin`/`math.random` in a simulation callback desync a match, which is
 *    why the engine offers `wa.math.*` and `wa.random` at all.
 */
import { checkLua, fixLockstepRng, freeNames } from '../src/utils/luaCheck';
import { availableRequiresForCheck } from '../src/utils/luaGenerator';
import { NOT_GENERATED_CLOSE, NOT_GENERATED_OPEN, notGeneratedLineRanges, scanBlockEnd, maskLuaCode } from '../src/utils/luaText';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};
const rules = (code: string, opts?: Parameters<typeof checkLua>[1]) =>
  checkLua(code, opts)
    .map((f) => `${f.severity === 'error' ? 'E' : f.severity === 'warning' ? 'W' : 'I'}:${f.rule}`)
    .join(', ');
const has = (code: string, rule: string, opts?: Parameters<typeof checkLua>[1]) =>
  checkLua(code, opts).some((f) => f.rule === rule);

// ---- lockstep-rng --------------------------------------------------------
{
  const code = ['local a = math.sin(1)', 'local b = math.cos(2)', 'wa.log(math.random(1, 3))'].join(
    String.fromCharCode(10),
  );
  const findings = checkLua(code);
  check(
    'math.random is an error, the trig calls are warnings',
    findings.filter((f) => f.rule === 'lockstep-rng').length === 3 &&
      findings.filter((f) => f.rule === 'lockstep-rng' && f.severity === 'error').length === 1 &&
      findings.filter((f) => f.rule === 'lockstep-rng' && f.severity === 'warning').length === 2,
    rules(code),
  );
  check(
    'each carries the rewrite to wa.*',
    findings.some((f) => f.fix?.to === 'wa.math.sin') &&
      findings.some((f) => f.fix?.to === 'wa.random'),
  );
  const fixed = fixLockstepRng(code);
  check(
    'the fix rewrites exactly those calls',
    fixed.includes('wa.math.sin(1)') &&
      fixed.includes('wa.math.cos(2)') &&
      fixed.includes('wa.random(1, 3)') &&
      !has(fixed, 'lockstep-rng'),
    fixed,
  );
  // Fixed point: applying it twice changes nothing.
  check('the fix is idempotent', fixLockstepRng(fixed) === fixed);

  // `math.random()` returns a float; `wa.random()` returns the raw 32-bit draw,
  // so the rewrite would change the meaning and is not offered.
  const floatForm = 'local f = math.random()';
  check(
    'the float form is reported but not rewritten',
    has(floatForm, 'lockstep-rng') && fixLockstepRng(floatForm) === floatForm,
  );

  // Exact operations are IEEE-defined and stay allowed.
  check(
    'math.floor, sqrt, abs, min, max and pi are not findings',
    rules('local a = math.floor(1.5) + math.sqrt(4) + math.abs(-1) + math.min(1, 2) + math.max(1, 2) + math.pi') === '',
  );
  check(
    'a comment or a string is not a finding',
    rules('-- math.sin(x)\nlocal s = "math.random(1)"') === '',
  );
}

// ---- lockstep-pairs ------------------------------------------------------
{
  const code = 'for k in pairs(t) do wa.log(k) end';
  check(
    'pairs is an advisory, as the compiler words it',
    rules(code).includes('I:lockstep-pairs'),
    rules(code),
  );
  check(
    'ipairs is not',
    rules('local t = {}\nfor i, v in ipairs(t) do wa.log(i, v) end') === '',
  );
  // `next(t)` walks the same hash order, but neither `wbcheck` nor the app's
  // baseline reports it, and a finding that only this editor raises would make
  // the same file disagree between the two tools.
  check('next is not reported', rules('local t = {}\nlocal k = next(t)') === '');
}

// ---- the draw band -------------------------------------------------------
{
  const draw = (...lines: string[]) => ['wa.on.draw(function()', ...lines, 'end)'].join(String.fromCharCode(10));
  const trigInDraw = draw('  local skip = math.sin(1)');
  check(
    'trig inside wa.on.draw is presentation, so it is silent',
    rules(trigInDraw) === '',
    rules(trigInDraw),
  );
  check(
    'and the Fix button leaves it alone',
    fixLockstepRng(trigInDraw) === trigInDraw,
  );
  // The sandbox nils the generator outright, so `math.random` raises even from a
  // render callback: it is the one call the draw band does not cover.
  const randomInDraw = draw('  local n = math.random()');
  check(
    'but math.random is an error even inside it',
    rules(randomInDraw).includes('E:lockstep-rng'),
    rules(randomInDraw),
  );
  // Iteration order decides what is drawn, so it is still an advisory, not a
  // silent pass.
  const pairsInDraw = draw('  for k in pairs(t) do wa.log(k) end');
  check(
    'and pairs is still reported there',
    rules(pairsInDraw).includes('I:lockstep-pairs'),
    rules(pairsInDraw),
  );
  check(
    'a name the body still does not declare is reported',
    has(draw('  wa.log(undefined_name)'), 'undefined-global'),
  );

  // A draw callback nearly always delegates, and the engine's checker passes
  // those files: a local helper called from the body is render context too.
  const delegated = [
    'local function sheet(angle)',
    '  return math.cos(angle), math.sin(angle)',
    'end',
    'wa.on.draw(function() sheet(1) end)',
  ].join(String.fromCharCode(10));
  check('a helper called from a draw body is render context', rules(delegated) === '', rules(delegated));

  // Roots are function LITERALS. A named argument's body is invisible at the
  // call site, so its trig stays reported, and the function that merely follows
  // the call is not swallowed either.
  const namedArg = [
    'local function handler()',
    '  local x = math.sin(1)',
    'end',
    'wa.on.draw(handler)',
  ].join(String.fromCharCode(10));
  check('a named draw handler is not a literal root', has(namedArg, 'lockstep-rng'), rules(namedArg));
  const below = [
    'wa.on.draw(handler)',
    'local function other()',
    '  local x = math.sin(1)',
    'end',
  ].join(String.fromCharCode(10));
  check(
    'a function defined below the registration is not muted',
    has(below, 'lockstep-rng'),
    rules(below),
  );
}

// ---- names read but never declared ---------------------------------------
{
  // The Pulsar regression: the body survives, its table does not.
  const pulsar = 'on_explode = { on = function(ev) if ev.missile then aura[ev.missile] = nil end end }';
  check('a dangling table is an error', has(pulsar, 'undefined-global'));
  check(
    'and it is named once, not per use',
    checkLua(pulsar).filter((f) => f.rule === 'undefined-global').length === 1,
  );
  check(
    'declaring it anywhere clears the finding',
    rules('local aura = {}\n' + pulsar) === '',
    rules('local aura = {}\n' + pulsar),
  );

  // The shapes a declaration really takes.
  const declared = [
    'local a, b = 1, 2',
    'local function helper(x) return x end',
    'local t = {}',
    'for i = 1, 3 do t[i] = helper(a + b) end',
    'for k, v in ipairs(t) do wa.log(k, v) end',
    'wa.on.worm_message(function(worm) wa.log(worm, i) end)',
    'local f = function(p, q) return p + q end',
    'wa.log(f(1, 2), math.floor(1.5), 0xFF000000)',
  ].join(String.fromCharCode(10));
  check(
    'locals, parameters, for variables and hex numbers are all declared',
    rules(declared) === '',
    rules(declared),
  );

  check(
    'a member access is not a global read',
    rules('local t = { x = 1 }\nwa.log(t.x, t.y.z)') === '',
  );
  check(
    'the generated helpers count as declared',
    rules('local h = hold\nsb.flight(ctx, { weapon = ctx.id })\nseq.fire_seq_mis{ owner = ev.worm }') === '',
  );
  check(
    'an extra ambient name can be supplied',
    has('wa.log(MY_OWN)', 'undefined-global') &&
      !has('wa.log(MY_OWN)', 'undefined-global', { ambient: ['MY_OWN'] }),
  );
}

// ---- the shapes the first pass got wrong (all of them run) ---------------
{
  // `function M:heal(v)` binds `self` implicitly. Flagging it once turned every
  // method of a real engine test harness into a red banner.
  const method = 'local M = {}\nfunction M:heal(v) self.hp = self.hp + v end\nreturn M';
  check('self is bound by a colon method', rules(method) === '', rules(method));

  // Labels are names of their own kind, and `goto` is their only read.
  const label = [
    'for i = 1, 3 do',
    '  if i == 2 then goto continue end',
    '  ::continue::',
    'end',
  ].join(String.fromCharCode(10));
  check('a goto label is not an undefined name', rules(label) === '', rules(label));

  // `for ... do` owns one block. A bare `do ... end` inside it owns another, and
  // reading it as the loop's `do` reported valid Lua as uncompilable.
  const nestedDo = ['for i = 1, 3 do', '  do', '    local x = 1', '  end', 'end'].join(
    String.fromCharCode(10),
  );
  check('a bare do block inside a loop counts as its own block', rules(nestedDo) === '', rules(nestedDo));
  check(
    'and so does a bare do inside a function',
    rules('local function f()\n  do\n    local x = 1\n  end\nend') === '',
  );

  // The compiler's levels: a name nothing declares is a warning, and one an `or`
  // fallback already covers is an advisory.
  check('an undefined name is a warning, not an error', rules('wa.log(nope)').includes('W:undefined-global'));
  check(
    'a nil an `or` covers is an advisory',
    rules('local v = missing or 1').includes('I:undefined-global'),
    rules('local v = missing or 1'),
  );

  // The host list: `arg` is real (a harness reads it), `bit32` was dropped in 5.4.
  check('arg counts as ambient', rules('local root = arg[0]') === '', rules('local root = arg[0]'));
  check('bit32 is not a Lua 5.4 name', has('bit32.band(1, 2)', 'undefined-global'));

  // Nil'd by the sandbox, so there is no seed to set.
  check('math.randomseed is reported', has('math.randomseed(1)', 'lockstep-rng'));
}

// ---- module level --------------------------------------------------------
{
  const moduleText = [
    'local BOLT = {}',
    'BOLT.depth = wa.depth.FRONT',
    'return { install = function(ctx) wa.log(1) end }',
  ].join(String.fromCharCode(10));
  check(
    'a wa read at module level is a load-time nil',
    has(moduleText, 'module-wa', { mode: 'module' }),
  );
  check(
    'inside install it is fine',
    !has(
      ['local BOLT = {}', 'return { install = function(ctx) BOLT.depth = wa.depth.FRONT end }'].join(
        String.fromCharCode(10),
      ),
      'module-wa',
      { mode: 'module' },
    ),
  );
  check(
    'a wa read inside a module-level helper is not load time',
    !has(
      ['local function pick() return wa.depth.FRONT end', 'return { install = pick }'].join(
        String.fromCharCode(10),
      ),
      'module-wa',
      { mode: 'module' },
    ),
  );
  check(
    'fragment mode says nothing about module level',
    !has('BOLT.depth = wa.depth.FRONT', 'module-wa'),
  );
}

// ---- requires ------------------------------------------------------------
{
  const code = 'local fx = require("wf-lib/effects/px_effects")';
  check(
    'an undeclared require is an error',
    has(code, 'undeclared-require', { availableRequires: ['wf.sdk'] }),
  );
  check(
    'a declared one is not',
    !has(code, 'undeclared-require', {
      availableRequires: ['wf.sdk', 'wf-lib/effects/px_effects'],
    }),
  );
  check(
    'without a dependency list the check is skipped',
    !has(code, 'undeclared-require'),
  );
}

// ---- shape ---------------------------------------------------------------
{
  check('an unclosed brace is reported', has('local t = { 1, 2', 'lua-ast'));
  check('an unclosed block is reported', has('if x then wa.log(1)', 'lua-ast'));
  check('a stray end is reported', has('wa.log(1) end', 'lua-ast'));
  check(
    'a for loop opens exactly one block',
    rules('for i = 1, 2 do wa.log(i) end') === '',
    rules('for i = 1, 2 do wa.log(i) end'),
  );
  check(
    'repeat and until count',
    rules('local i = 0\nrepeat i = i + 1 until i > 3') === '',
    rules('local i = 0\nrepeat i = i + 1 until i > 3'),
  );
  check(
    'endless is a name, not an end',
    !has('local endless = 1\nwa.log(endless)', 'lua-ast'),
  );
  check('a NUL is reported', has('wa.log(1)\u0000', 'lua-nul'));
  check('a huge body is reported', has('x'.repeat(200_001), 'lua-size'));
  check('empty input is not a finding', rules('') === '');
}

// ---- custom code: did the editor generate this line? ----------------------
{
  // The generator wraps the custom body in the markers `luaText.ts` defines, and
  // `checkLua` has to answer "the editor did not generate this". The severity
  // stays the compiler's; only the tag changes.
  const nl = String.fromCharCode(10);
  const marked = [
    'return {',
    '  install = function(ctx)',
    '    wa.weapons.replace{',
    '      on_explode = { on = function(ev)',
    `        ${NOT_GENERATED_OPEN}`,
    '        start_vortex(ev.x, ev.y, ev.worm)',
    `        ${NOT_GENERATED_CLOSE}`,
    '        math.sin(1)',
    '      end },',
    '    }',
    '  end,',
    '}',
  ].join(nl);
  const findings = checkLua(marked);
  const dangling = findings.find((f) => f.rule === 'undefined-global');
  check('a name read in custom code is reported', !!dangling);
  check('and the row is marked as not generated', dangling?.notGenerated === true);
  check(
    'a finding after the close marker is generated',
    findings.find((f) => f.rule === 'lockstep-rng')?.notGenerated !== true,
  );
  check(
    'a file without markers has no custom rows',
    checkLua('wa.log(aura)').every((f) => !f.notGenerated),
  );
  const spans = (code: string) =>
    notGeneratedLineRanges(code)
      .map(([from, to]) => `${from}-${to}`)
      .join('|');
  check(
    'an unclosed custom region runs to the end of the file',
    spans(`${NOT_GENERATED_OPEN}${nl}wa.log(1)${nl}wa.log(2)`) === '2-3',
    spans(`${NOT_GENERATED_OPEN}${nl}wa.log(1)${nl}wa.log(2)`),
  );
  check(
    'a closed region stops at its close marker',
    spans(['a', NOT_GENERATED_OPEN, 'b', 'c', NOT_GENERATED_CLOSE, 'd'].join(nl)) === '3-4',
    spans(['a', NOT_GENERATED_OPEN, 'b', 'c', NOT_GENERATED_CLOSE, 'd'].join(nl)),
  );
}

// ---- the real thing ------------------------------------------------------
{
  // A generated weapon file: self-contained, so a clean pass is the whole point.
  const generated = [
    'return {',
    '  install = function(ctx)',
    '    local hold = sb.hold(ctx, { weapon = ctx.id })',
    '    wa.weapons.replace{',
    '      name = "X",',
    '      hold = hold,',
    '      on_explode = { on = function(ev)',
    '        if ev.worm then wa.sound.play(ev.worm, "sounds/x/explosion.wav", 10) end',
    '      end },',
    '    }',
    '  end,',
    '}',
  ].join(String.fromCharCode(10));
  check('a clean generated file has no findings', rules(generated) === '', rules(generated));
}

// ---- F12: luaCheck / scanBlockEnd / freeNames / fixLockstepRng edge fixes --
{
  // 1. math.random() floatForm does not emit invalid `math.random` -> `wa.random` fix
  const rndFinding = checkLua('wa.log(math.random())').find((f) => f.rule === 'lockstep-rng');
  check(
    'math.random() float form reports no wa.random rewrite (even without spaces)',
    !!rndFinding && !rndFinding.fix && rndFinding.message.includes('math.random()'),
    JSON.stringify(rndFinding),
  );

  // 2. Paren-less require "mod" is caught by undeclared-require and allowed by availableRequiresForCheck
  check(
    'paren-less require "wf-lib/effects/px_effects" is caught when undeclared',
    has('local fx = require "wf-lib/effects/px_effects"', 'undeclared-require', {
      availableRequires: ['wf.sdk'],
    }),
  );
  check(
    'availableRequiresForCheck recognises paren-less require from external dependency',
    availableRequiresForCheck('local x = require "lib/custom"', ['thirdparty.lib']).includes(
      'lib/custom',
    ),
  );

  // 3. Immediately-invoked module-scope functions are NOT exempt from module-wa
  check(
    'module-wa flags IIFE (function() wa.log(1) end)() at module scope',
    has('(function() wa.log(1) end)()\nreturn { install = function(ctx) end }', 'module-wa', {
      mode: 'module',
    }),
  );
  check(
    'module-wa flags pcall(function() wa.log(1) end) at module scope',
    has('pcall(function() wa.log(1) end)\nreturn { install = function(ctx) end }', 'module-wa', {
      mode: 'module',
    }),
  );

  // 4. Function literal inside for/while header does not consume loop header `do`
  const loopWithFnHeader = 'for i = 1, (function() return 3 end)() do wa.log(i) end';
  check(
    'function()...end inside for header balances in checkLua without lua-ast',
    rules(loopWithFnHeader) === '',
    rules(loopWithFnHeader),
  );
  const maskedHeader = maskLuaCode(`function(ev) ${loopWithFnHeader} end`);
  const endIdx = scanBlockEnd(maskedHeader, 'function'.length);
  check(
    'scanBlockEnd finds outer function end past for-header closure',
    endIdx === maskedHeader.length - 3,
    `${endIdx} vs ${maskedHeader.length - 3}`,
  );

  // 5a. local function on one line does not treat body arguments as locals
  check(
    'local function on one line still reports undeclared global undef',
    has('local function f() wa.log(1, undef) end', 'undefined-global'),
  );
  // 5b. freeNames detects bare global assignment inside a hook
  const actives = freeNames('function(ev)\n  active = true\nend', ['ctx']);
  check(
    'freeNames includes bare global assignment "active" (not mistaking it for table key)',
    actives.includes('active'),
    JSON.stringify(actives),
  );
  // 5c. Function parameter in later helper does not mask earlier undefined read
  check(
    'function parameter scope does not silence read outside that function',
    has('wa.log(late_param)\nlocal function helper(late_param) return late_param end', 'undefined-global'),
  );

  // 6. fixLockstepRng handles spaced `math . sin(1)` cleanly without trailing `in`
  const spacedFixed = fixLockstepRng('local a = math . sin(1)');
  check(
    'fixLockstepRng replaces spaced math . sin(1) cleanly',
    spacedFixed === 'local a = wa.math.sin(1)',
    spacedFixed,
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nlua rules: all checks passed');
