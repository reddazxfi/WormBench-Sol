import { LUA_KEYWORDS, lineOf, maskLuaCode, notGeneratedLineRanges, scanBlockEnd } from './luaText';
import { CLAIM_HOOK_KEYS } from '../data/luaHooks';

const CLAIM_HOOK_SET = new Set<string>(CLAIM_HOOK_KEYS);

/**
 * The editor's own reading of a piece of Lua, checked against the rules the
 * engine (and `wfcheck`) enforce, before it is written into a bundle.
 *
 * Nothing here runs the code. Every check is a scan of the masked copy, so a
 * `math.sin` in a comment or a `pairs` inside a string is not a finding, and the
 * only cost is a linear pass. The shared rule ids and, more importantly, their
 * severities are the compiler's (`compiler-cli/src/checks.rs`, and the app's
 * `services/parser.ts` baseline), because a finding that lands in a different
 * console filter than the same finding in `wfcheck` is a new bug of its own:
 *
 * - `lockstep-rng`: `math.random`/`randomseed` are **errors** (the sandbox nils
 *   them, so the call raises wherever it runs), `math.cos`/`sin`/`atan` are
 *   **warnings** (they still run; the result may differ between machines).
 * - `lockstep-pairs`: **info**, on the bare `pairs()` call only. Neither `next`
 *   nor `wa.draw.random` is a finding.
 * - `undefined-global`: **warning**, and **info** when an `or` fallback covers
 *   the nil.
 *
 * Four rules are this editor's own, because they are about how a *bundle* loads
 * rather than about Lua: `module-wa` (lesson 21), `undeclared-require`,
 * `lua-nul` and `lua-size`.
 *
 * Two contexts are checked:
 *
 * - a bundle **module** (top-level `local`s and `return { ... }`): a `wa` read
 *   outside every function body is a load-time nil (lesson 21);
 * - a **fragment** that lands inside `install` (the custom Lua box, or a whole
 *   generated weapon file): nothing to say about module level, but a name it
 *   reads and nothing declares is a runtime error waiting for a blast.
 *
 * The render band is the compiler's rule, not a guess: a function is rendering
 * when it is handed to `wa.on.draw`/`wa.on.hud` **as a literal**, or is called
 * by name from something already rendering (closed transitively, so a `sheet()`
 * helper that does its own trig is presentation too). Only trig is muted there.
 */
export type LuaRule =
  | 'lua-size'
  | 'lua-nul'
  | 'lua-ast'
  | 'lockstep-rng'
  | 'lockstep-pairs'
  | 'module-wa'
  | 'undefined-global'
  | 'undeclared-require';

/** `wfcheck`'s own three levels. `info` is an advisory, never a blocker. */
export type LuaSeverity = 'error' | 'warning' | 'info';

export interface LuaFinding {
  rule: LuaRule;
  severity: LuaSeverity;
  /** 1-based. */
  line: number;
  message: string;
  /**
   * The name the finding is about, when it has one. The dedupe reads this
   * rather than the message: parsing our own prose broke the day a message
   * changed shape.
   */
  name?: string;
  /** A mechanical rewrite, when one is safe (`lockstep-rng` only). */
  fix?: { from: string; to: string };
  /**
   * The finding is inside a block the editor did not generate (the custom
   * `on_explode` body, which is where an imported bundle's hook lands and where
   * the author's own snippet goes). The severity is still `wfcheck`'s; this only
   * says that nothing in the emitted file declares what the block reads, so it
   * fails when the hook runs.
   */
  notGenerated?: boolean;
}

export interface LuaCheckOptions {
  /** `module` for a bundle's own file, `fragment` for code inside `install`. */
  mode?: 'module' | 'fragment';
  /**
   * Module ids the file may `require`. Left out, the requirement is not checked
   * (the custom Lua box can only use what its own bundle declares).
   */
  availableRequires?: string[];
  /** Extra names the host injects beyond `wa` and Lua's own library. */
  ambient?: string[];
  /** Skip the `undefined-global` pass (a snippet alone cannot know its file). */
  skipGlobals?: boolean;
  /**
   * Count the names the generator puts in scope (`sb`, `fx`, `zap`, `ctx`, …) as
   * declared. `false` is for reading a block out of a *bundle*, which has its own
   * `fx` and may have neither: the block's closure is then a fact about the
   * bundle, not a name the emitted file provides. Default true.
   */
  editorAmbient?: boolean;
}

/**
 * `wa` plus the Lua 5.4 library the host leaves in place, from the one list both
 * checkers share (`luaGlobals.ts` in the code-editor repo). Deliberately faithful:
 * `bit32` and `unpack` do not exist in 5.4 and listing them silenced real
 * findings, while `arg` (which a test harness reads) was missing and produced
 * one.
 */
const BASE_AMBIENT = [
  '_G', '_VERSION', '_ENV', 'assert', 'error', 'getmetatable', 'ipairs', 'next', 'pairs',
  'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select', 'setmetatable',
  'tonumber', 'tostring', 'type', 'warn', 'xpcall',
  'coroutine', 'debug', 'io', 'math', 'os', 'package', 'string', 'table', 'utf8', 'arg',
  // Load-time helpers the engine's sandbox nils out: reading one is not a typo,
  // using one is a separate problem.
  'dofile', 'loadfile', 'load', 'require', 'collectgarbage',
  // WormBench
  'wa',
];

/**
 * Names the generator itself puts in scope of an emitted weapon file: the
 * aiming manager, the sequencer, the fuse sampler, the stamp helpers and the
 * clamp bounds. A custom body passes for reading them because they are there.
 * `trail` is deliberately not here: its require is gated on the effects SDK,
 * so exempting it hid a burst-only weapon claiming `trail.BEAM` without the
 * module, and the whole weapon failed to load at install.
 */
const EDITOR_AMBIENT = [
  'sb', 'holds', 'fx', 'blast', 'seq', 'zap', 'ctx', 'hold', 'ev',
  'seq_dir', 'fuse_of', 'stamp_clear', 'stamp_hit', 'stamp_orientation',
  'AIM_LO', 'AIM_HI', 'aim_clamped', 'FUSE_DEFAULT', 'FUSE_AIM',
  'STAMP_CLEAR', 'STAMP_HIT',
];

/** The functions whose result can differ per machine, and what to use instead. */
const TRIG_CALLS: Record<string, string> = {
  sin: 'wa.math.sin',
  cos: 'wa.math.cos',
  atan: 'wa.math.atan',
};

/** Per-client and nil in the sandbox, so these raise wherever they run. */
const STRIPPED_CALLS = new Set(['random', 'randomseed']);

const MAX_BYTES = 200_000;

export function checkLua(code: string, options: LuaCheckOptions = {}): LuaFinding[] {
  const findings: LuaFinding[] = [];
  const push = (finding: LuaFinding) => findings.push(finding);
  if (!code) return findings;

  // ---- size and encoding ---------------------------------------------------
  if (code.length > MAX_BYTES) {
    push({
      rule: 'lua-size',
      severity: 'error',
      line: 1,
      message: `${code.length} characters: the editor carries at most ${MAX_BYTES}, so a body this large cannot be read or written reliably.`,
    });
  }
  const nul = code.indexOf('\u0000');
  if (nul !== -1) {
    push({
      rule: 'lua-nul',
      severity: 'error',
      line: lineOf(code, nul),
      message: 'A NUL byte in Lua source: the loader reads a C string and stops there.',
    });
  }

  const masked = maskLuaCode(code);
  const bodies = functionBodies(masked);

  // ---- shape: brackets and blocks -----------------------------------------
  findings.push(...checkBrackets(code, masked));
  findings.push(...checkBlocks(code, masked));

  // ---- the draw band: where trig is presentation, not simulation -----------
  const render = renderRegions(masked, bodies);
  const inRender = (index: number) => render.some(([a, b]) => index >= a && index < b);

  // ---- lockstep-rng --------------------------------------------------------
  const mathCall = /(^|[^A-Za-z0-9_.])math\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = mathCall.exec(masked)) !== null) {
    const name = m[2];
    const at = m.index + m[1].length;
    const afterName = m.index + m[0].length;
    if (STRIPPED_CALLS.has(name)) {
      // Not muted in the draw band: the sandbox nils the generator outright, so
      // the call raises even from a render callback. `math.random(a, b)` and
      // `wa.random(a, b)` mean the same range, so that form is fixable; the float
      // form is not (`wa.random()` is the raw 32-bit draw), and `randomseed` has
      // nothing to rewrite to.
      const floatForm = name === 'random' && /^\s*\(\s*\)/.test(masked.slice(afterName));
      push({
        rule: 'lockstep-rng',
        severity: 'error',
        line: lineOf(code, at),
        message:
          name === 'random'
            ? floatForm
              ? '`math.random()` returns a float from the machine\'s own generator: it differs per peer and the match desyncs, and the engine nils the call. `wa.random()` is the raw 32-bit draw, `wa.random(a, b)` a range.'
              : '`math.random` is not lockstep safe and the engine nils it: each peer draws a different number from its own generator, so a match desyncs and a call from the simulation raises. Use `wa.random(a, b)` for the shared draw.'
            : '`math.randomseed` is nil in the engine: the per-client generator is stripped, so this call raises. There is no seed to set, every draw comes from `wa.random`.',
        ...(name === 'random' && !floatForm
          ? { fix: { from: 'math.random', to: 'wa.random' } }
          : {}),
      });
      continue;
    }
    const fixTo = TRIG_CALLS[name];
    if (!fixTo) continue;
    if (inRender(at)) continue;
    push({
      rule: 'lockstep-rng',
      severity: 'warning',
      line: lineOf(code, at),
      message: `\`math.${name}\` is not lockstep safe: the C library result can differ between machines and desync the match. Use \`${fixTo}\`. It is silent inside \`wa.on.draw\`/\`wa.on.hud\`, where per-client drawing cannot desync anything.`,
      fix: { from: `math.${name}`, to: fixTo },
    });
  }

  // ---- lockstep-pairs ------------------------------------------------------
  // The bare `pairs()` call, and nothing else: `next(t)` and the draw band's
  // `wa.draw.random()` are not findings, as the compiler words it. A draw
  // callback is NOT exempt: its iteration order still decides what is drawn.
  const pairsCall = /(^|[^A-Za-z0-9_.])pairs\s*\(/g;
  while ((m = pairsCall.exec(masked)) !== null) {
    const at = m.index + m[1].length;
    push({
      rule: 'lockstep-pairs',
      severity: 'info',
      line: lineOf(code, at),
      message:
        '`pairs()` walks a table in hash order, which differs per peer. Use `ipairs` or a sorted key list when the result reaches the simulation.',
    });
  }

  // ---- requires ------------------------------------------------------------
  if (options.availableRequires) {
    const available = new Set(options.availableRequires);
    // The path is a string, so it is blank in the masked copy: find both
    // `require("x")` and paren-less `require "x"` against the original text.
    const requireCall = /(^|[^A-Za-z0-9_.])require(?:\s*\(|\s+)/g;
    while ((m = requireCall.exec(masked)) !== null) {
      const at = m.index + m[1].length;
      const afterCall = m.index + m[0].length;
      const arg = /^[ \t]*["']([^"']+)["']/.exec(code.slice(afterCall));
      if (!arg) continue;
      const id = arg[1];
      if (available.has(id)) continue;
      push({
        rule: 'undeclared-require',
        severity: 'error',
        line: lineOf(code, at),
        message: `\`require("${id}")\` is not in the bundle's dependencies: the module would not resolve at load.`,
      });
    }
  }

  // ---- a `wa` read at module level -----------------------------------------
  if (options.mode === 'module') {
    const isImmediate = (body: FnBody): boolean => {
      let k = body.start - 1;
      while (k >= 0 && /\s/.test(masked[k])) k -= 1;
      if (k < 0 || masked[k] !== '(') return false;
      const prefix = masked.slice(Math.max(0, k - 12), k).trimEnd();
      if (/(?:^|[^A-Za-z0-9_])x?pcall$/.test(prefix)) return true;
      return /^\s*\)\s*\(/.test(masked.slice(body.end, body.end + 40));
    };
    const waRead = /(^|[^A-Za-z0-9_.])wa\s*[.:]/g;
    while ((m = waRead.exec(masked)) !== null) {
      const at = m.index + m[1].length;
      const enclosing = bodies.filter((body) => at >= body.start && at < body.end);
      if (enclosing.length > 0 && !enclosing.every(isImmediate)) continue;
      push({
        rule: 'module-wa',
        severity: 'error',
        line: lineOf(code, at),
        message:
          '`wa` read outside `install`: a module is loaded before the engine hands it a world, so this is a nil index at load. Move it inside `install`.',
      });
    }
  }

  // ---- names read but never declared ---------------------------------------
  if (!options.skipGlobals) {
    findings.push(...checkGlobals(code, masked, options));
  }

  // Is this line generated? The generator marks the custom body (see
  // `NOT_GENERATED_OPEN`), so a finding inside one is a certain failure at load.
  const marked = notGeneratedLineRanges(code);
  if (marked.length > 0) {
    for (const finding of findings) {
      if (marked.some(([from, to]) => finding.line >= from && finding.line <= to)) {
        finding.notGenerated = true;
      }
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

/** Bracket balance over the masked text, with the line of the first mismatch. */
function checkBrackets(code: string, masked: string): LuaFinding[] {
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: { ch: string; at: number }[] = [];
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, at: i });
    else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (!top || top.ch !== closers[ch]) {
        return [
          {
            rule: 'lua-ast',
            severity: 'error',
            line: lineOf(code, i),
            message: `Unbalanced \`${ch}\`: it does not close the \`${top?.ch ?? 'nothing'}\`${
              top ? ` on line ${lineOf(code, top.at)}` : ''
            }.`,
          },
        ];
      }
    }
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return [
      {
        rule: 'lua-ast',
        severity: 'error',
        line: lineOf(code, top.at),
        message: `\`${top.ch}\` is never closed.`,
      },
    ];
  }
  return [];
}

/**
 * Block balance, with `do` owned by the `for`/`while` header it belongs to.
 *
 * The header's `do` is the one that would double-count a loop, so it is
 * consumed by a pending flag rather than pattern-matched against the text
 * before it: a bare `do ... end` inside a loop is its own block, and reading it
 * as the loop's `do` reported valid Lua as uncompilable.
 */
function checkBlocks(code: string, masked: string): LuaFinding[] {
  const word = /[A-Za-z_][A-Za-z0-9_]*/g;
  const stack: { kind: string; at: number; expectDo?: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = word.exec(masked)) !== null) {
    const name = m[0];
    if (name === 'for' || name === 'while') {
      stack.push({ kind: name, at: m.index, expectDo: true });
      continue;
    }
    if (name === 'function' || name === 'if' || name === 'repeat') {
      stack.push({ kind: name, at: m.index });
      continue;
    }
    if (name === 'do') {
      // The `do` of `for ... do` / `while ... do` owns only the top loop header
      // that has not seen its `do` yet: a nested `function() ... end` inside
      // the loop header pushes and pops its own block without clearing it.
      const top = stack[stack.length - 1];
      if (top?.expectDo) top.expectDo = false;
      else stack.push({ kind: 'do', at: m.index });
      continue;
    }
    if (name === 'end' || name === 'until') {
      const top = stack.pop();
      if (!top) {
        return [
          {
            rule: 'lua-ast',
            severity: 'error',
            line: lineOf(code, m.index),
            message: `\`${name}\` closes a block that was never opened.`,
          },
        ];
      }
      const wrongRepeat = name === 'until' && top.kind !== 'repeat';
      const wrongEnd = name === 'end' && top.kind === 'repeat';
      if (wrongRepeat || wrongEnd) {
        return [
          {
            rule: 'lua-ast',
            severity: 'error',
            line: lineOf(code, m.index),
            message: `\`${name}\` does not close the \`${top.kind}\` opened on line ${lineOf(code, top.at)}.`,
          },
        ];
      }
    }
  }
  if (stack.length > 0) {
    return [
      {
        rule: 'lua-ast',
        severity: 'error',
        line: lineOf(code, stack[0].at),
        message: `This block is never closed: ${stack.length} block(s) still open at the end of the file.`,
      },
    ];
  }
  return [];
}

/** One `function ... end` in the file, with the name it can be called by. */
interface FnBody {
  /** Last segment of its name (`helper`, `heal`), empty for an anonymous body. */
  name: string;
  start: number;
  /** One past the closing `end`. */
  end: number;
}

/**
 * Every function body, found once and shared: `module-wa` needs "is this inside
 * a function", and the render band needs "which body is this call in", and both
 * used to walk the text again from the top.
 */
function functionBodies(masked: string): FnBody[] {
  const bodies: FnBody[] = [];
  const word = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = word.exec(masked)) !== null) {
    if (m[0] !== 'function') continue;
    const fnClose = scanBlockEnd(masked, m.index + m[0].length);
    const fnEnd = fnClose === -1 ? masked.length : fnClose + 3;
    let name = '';
    // `function M:heal(...)` and `function helper(...)` name themselves.
    const named = /^\s*([A-Za-z_][A-Za-z0-9_.:]*)\s*\(/.exec(masked.slice(m.index + 8, m.index + 208));
    if (named) name = named[1].split(/[.:]/).pop() ?? '';
    else {
      // `local helper = function(...)` names itself from the left.
      const assigned = /([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*$/.exec(
        masked.slice(Math.max(0, m.index - 120), m.index),
      );
      if (assigned) name = assigned[1].split('.').pop() ?? '';
    }
    bodies.push({ name, start: m.index, end: fnEnd });
  }
  return bodies;
}

/**
 * Ranges of the bodies that run at render time.
 *
 * Roots are **function literals** handed to `wa.on.draw`/`wa.on.hud`. A named
 * argument (`wa.on.draw(handler)`) is deliberately not a root: its body is
 * invisible at the call site, and muting "whatever function comes next" in the
 * file silenced a real `math.sin` two lines below. From a root, a local helper
 * called by name is render context too, and that closes transitively, because
 * a draw callback nearly always delegates and the engine's own checker passes
 * those files.
 */
function renderRegions(masked: string, bodies: FnBody[]): [number, number][] {
  const regions: [number, number][] = [];
  const call = /wa\s*\.\s*on\s*\.\s*(?:draw|hud)\s*\(/g;
  let m: RegExpExecArray | null;
  const byStart = new Map(bodies.map((body) => [body.start, body]));
  while ((m = call.exec(masked)) !== null) {
    let at = m.index + m[0].length;
    while (at < masked.length && /\s/.test(masked[at])) at += 1;
    const body = byStart.get(at);
    if (body) regions.push([body.start, body.end]);
  }
  // Close over named helpers called from inside a region.
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, to] of [...regions]) {
      const text = masked.slice(from, to);
      for (const body of bodies) {
        if (!body.name) continue;
        if (regions.some(([a, b]) => body.start >= a && body.start < b)) continue;
        if (!new RegExp(`(^|[^A-Za-z0-9_.])${body.name}\\s*\\(`).test(text)) continue;
        regions.push([body.start, body.end]);
        grew = true;
      }
    }
  }
  return regions;
}

/**
 * Names a body reads that nothing declares. Lua has no declared-global syntax,
 * so a name that is not a local, a parameter, a `for` variable, a function's own
 * name, a label or a library the host injects is nil at run time. The pass is
 * deliberately coarse: it collects declarations anywhere in the text, so it
 * never reports a name used before its `local` (which Lua would also read as
 * nil, but a false alarm there is worse than the miss). `self` counts, because
 * `function M:heal()` binds it implicitly and flagging it once made a real
 * module's every method a red banner.
 */
function checkGlobals(code: string, masked: string, options: LuaCheckOptions): LuaFinding[] {
  const declared = new Set<string>([
    ...BASE_AMBIENT,
    ...(options.editorAmbient === false ? [] : EDITOR_AMBIENT),
    ...(options.ambient ?? []),
  ]);

  // `::label::` declares a label, and `goto label` is the only read of it.
  for (const label of masked.matchAll(/::\s*([A-Za-z_][A-Za-z0-9_]*)\s*::/g)) declared.add(label[1]);

  // Function parameters are scoped to the `[start, end)` span of the function
  // body that binds them so an unrelated read elsewhere in the module/fragment
  // is not hidden by a helper's parameter name.
  const scopedParams = new Map<string, [number, number][]>();
  const addParam = (param: string, start: number, end: number) => {
    const ranges = scopedParams.get(param) ?? [];
    ranges.push([start, end]);
    scopedParams.set(param, ranges);
  };

  // `local a, b = ...`, `local function f`, `for k, v in`, `function f(a, b)`,
  // `function a.b:c(...)`, plus `x, y = 1, 2` (an assignment to new globals is
  // still a global, so the left side is left alone on purpose).
  const declWord = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = declWord.exec(masked)) !== null) {
    const name = m[0];
    const after = masked.slice(m.index + name.length);
    if (name === 'local' && !/^\s*\./.test(after)) {
      if (/^[ \t]+function\b/.test(after)) continue;
      // Only comma-separated variable names (with optional `<const>`/`<close>`),
      // stopping before statements/calls (`;`, `(`, keywords, newline).
      const tail = after.match(
        /^[ \t]+([A-Za-z_][A-Za-z0-9_]*(?:[ \t]*<[A-Za-z_]+>)?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*(?:[ \t]*<[A-Za-z_]+>)?)*)/,
      );
      if (!tail) continue;
      for (const part of tail[1].split(',')) {
        const id = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (id && !LUA_KEYWORDS.has(id[1])) declared.add(id[1]);
      }
      continue;
    }
    if (name === 'for') {
      // `for k, v in pairs(t)` and `for i = 1, n`: the head ends at `in` or `=`.
      // A `(` ends it too, so a `for` inside an expression is not read as a
      // declaration of whatever follows.
      const head = after.match(/^[^(]*?(?:\bin\b|=)/);
      if (!head) continue;
      for (const part of head[0].replace(/\b(?:in|=)$/, '').split(',')) {
        const id = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (id) declared.add(id[1]);
      }
      continue;
    }
    if (name === 'function') {
      // An anonymous function (`function(a, b)`) has no name, and that is the
      // common shape for a callback: its parameters still declare their names.
      const head = after.match(/^\s*(?:([A-Za-z_][A-Za-z0-9_.:]*)\s*)?\(([^)]*)\)/);
      if (!head) continue;
      const dotted = (head[1] ?? '').split(/[.:]/).filter(Boolean);
      // `function M.f()` declares `M`'s value, not a new local; only the bare
      // form is a declaration here. The `:` form binds `self` implicitly.
      if (dotted.length === 1 && !head[1]?.includes(':')) declared.add(dotted[0]);
      const fnClose = scanBlockEnd(masked, m.index + name.length);
      const fnEnd = fnClose === -1 ? masked.length : fnClose + 3;
      if (head[1]?.includes(':')) addParam('self', m.index, fnEnd);
      for (const part of head[2].split(',')) {
        const id = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (id) addParam(id[1], m.index, fnEnd);
      }
      continue;
    }
  }

  const findings: LuaFinding[] = [];
  const read = /[A-Za-z_][A-Za-z0-9_]*/g;
  read.lastIndex = 0;
  let braceDepth = 0;
  let braceCursor = 0;
  while ((m = read.exec(masked)) !== null) {
    for (; braceCursor < m.index; braceCursor += 1) {
      if (masked[braceCursor] === '{') braceDepth += 1;
      else if (masked[braceCursor] === '}') braceDepth = Math.max(0, braceDepth - 1);
    }
    const name = m[0];
    if (LUA_KEYWORDS.has(name)) continue;
    // Part of a number literal: the `x68` of `0x68`, the `e5` of `1e5`.
    if (/[0-9.]$/.test(masked.slice(Math.max(0, m.index - 1), m.index))) continue;
    // A member access (`a.b`, `a:b`) is not a global read of `b`.
    const before = masked.slice(Math.max(0, m.index - 2), m.index);
    if (/[.:]$/.test(before)) continue;
    // A label is a name of its own kind, not a read.
    if (before.endsWith('::') || masked.slice(m.index + name.length, m.index + name.length + 2) === '::') {
      continue;
    }
    // A table key (`{ k = 1 }`, `{ a = 1, k = 1 }`) inside `{ ... }` is not a read.
    const isAssignLhs = /^\s*=(?!=)/.test(masked.slice(m.index + name.length));
    if (braceDepth > 0 && isAssignLhs) {
      let prev = m.index - 1;
      while (prev >= 0 && /\s/.test(masked[prev])) prev -= 1;
      const prevCh = prev >= 0 ? masked[prev] : '';
      if (prevCh === '{' || prevCh === ',' || prevCh === ';') continue;
    }
    // Custom Lua fragments can open with a claim key (`on_explode = ...`),
    // whereas module/free-name analysis must still flag undeclared globals.
    if (
      options.mode !== 'module' &&
      options.editorAmbient !== false &&
      braceDepth === 0 &&
      isAssignLhs &&
      CLAIM_HOOK_SET.has(name)
    ) {
      continue;
    }
    if (declared.has(name)) continue;
    if (scopedParams.get(name)?.some(([start, end]) => m!.index >= start && m!.index < end)) {
      continue;
    }
    // `x or fallback` reads nil deliberately: an advisory, not a warning.
    const guarded = /^\s*or\b/.test(masked.slice(m.index + name.length));
    findings.push({
      rule: 'undefined-global',
      severity: guarded ? 'info' : 'warning',
      line: lineOf(code, m.index),
      name,
      message: guarded
        ? `\`${name}\` is read but nothing declares it: the \`or\` fallback handles the nil, so this runs.`
        : `\`${name}\` is read but nothing declares it: the engine hands a pack only \`wa\` and Lua's own library, so this is a nil at run time.`,
    });
  }
  // One finding per name, on its first line: a dangling `aura` in a loop is one
  // problem, not twelve.
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.name ?? '')) return false;
    seen.add(finding.name ?? '');
    return true;
  });
}

/**
 * The names a fragment reads and nothing in it declares, given the names already
 * in scope. This is the closure question the carry asks (`carryClosure`): what
 * must travel with a hook body for it to run.
 *
 * The editor's own ambient names are **off** on purpose: a carried block's `fx`
 * is the bundle's `fx`, and counting it as provided would carry a body whose
 * `fx` the emitted file never binds.
 */
export function freeNames(code: string, ambient: string[] = []): string[] {
  return checkLua(code, { mode: 'fragment', ambient, editorAmbient: false, skipGlobals: false })
    .filter((finding) => finding.rule === 'undefined-global' && finding.name)
    .map((finding) => finding.name as string);
}

/**
 * Applies the `lockstep-rng` rewrites to code the editor can write back: the
 * custom Lua box. Comments and strings are untouched, the float form of
 * `math.random()` is left alone (`wa.random()` means something else), and trig
 * inside the render band is skipped because it is not a finding there.
 */
export function fixLockstepRng(code: string): string {
  const masked = maskLuaCode(code);
  const render = renderRegions(masked, functionBodies(masked));
  const inRender = (index: number) => render.some(([a, b]) => index >= a && index < b);
  const edits: { at: number; length: number; to: string }[] = [];
  const call = /(^|[^A-Za-z0-9_.])math\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(masked)) !== null) {
    const name = m[2];
    const start = m.index + m[1].length;
    const spanLen = m.index + m[0].length - start;
    if (STRIPPED_CALLS.has(name)) {
      if (name === 'randomseed') continue;
      // `math.random()` returns a float: no `wa.random` form means the same.
      if (/^\s*\(\s*\)/.test(masked.slice(start + spanLen))) continue;
      edits.push({ at: start, length: spanLen, to: 'wa.random' });
      continue;
    }
    const to = TRIG_CALLS[name];
    if (!to) continue;
    if (inRender(start)) continue;
    edits.push({ at: start, length: spanLen, to });
  }
  if (edits.length === 0) return code;
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += code.slice(cursor, edit.at) + edit.to;
    cursor = edit.at + edit.length;
  }
  return out + code.slice(cursor);
}
