/**
 * Carrying the declarations a bundle's hook closes over (M2 and M3 of
 * `reqs/custom_code_import_plan.md`).
 *
 * A hook body is never self-contained. Vortex's `on_explode` is one line,
 * `start_vortex(ev.x, ev.y, ev.worm)`, and `start_vortex` is an install-time
 * function that reads `vortices`, `tick`, `END_AT`, `fx`; `tick` reads `pull`,
 * `scatter`, `finish`, `BLAST_AT`; `pull` reads `REACH`, `CAPTURE`, `steer`; and
 * the constants are module-level. Pulsar's body reads `aura`, an install-time
 * table. Carrying the body without that chain is how an export ends up calling a
 * nil (today's vortex) or writing to one (today's pulsar).
 *
 * So the unit of carry is not the hook, it is the **closure**: the hook's free
 * names, resolved against the declarations the module actually has, transitively
 * and in source order.
 *
 * Three rules keep it honest:
 *
 * - **Scope is respected.** An install-level declaration is visible to a hook and
 *   to other install-level blocks; a module-level one is visible everywhere; a
 *   module-level block cannot see an install local (`ctx` included), so a
 *   preamble helper that reads `ctx` is reported rather than carried into a nil.
 * - **A name the emitted file already binds is not carried twice.** Same module
 *   (a bundle's `local fx = require("wf-lib/effects/px_effects")` against our
 *   own) means the block is dropped and the generated local serves both; a
 *   *different* module under the same name is renamed to `<name>_bundle` across
 *   all carried text, because a shadowed `fx` is a callback that silently does
 *   nothing (plan section 4). `reserved` is what the generator says it binds.
 * - **What cannot run is not carried.** A block with an unbalanced `end` is
 *   refused with a note (the plan's `lua-ast` rule), and a `require` of a module
 *   the export does not ship is carried but named, because the alternative is a
 *   load error with no explanation.
 *
 * Lockstep maths is rewritten, not blocked: `math.random` becomes `wa.random`
 * and `math.sin/cos/atan` become `wa.math.*` (WA's own sine table, identical bits
 * on every peer), through the same `fixLockstepRng` the custom Lua box uses, so
 * there is one mapping in the editor and not two. The one form with no
 * equivalent, `math.random()` with no arguments, is left alone and reported.
 */
import { fixLockstepRng, freeNames } from '../luaCheck';
import { checkLua } from '../luaCheck';
import { migrateApi4Lua } from '../api4Migration';
import { maskLuaCode, rewriteNames, scanBlockEnd } from '../luaText';
import { dependencyForModule } from '../../data/sdkModules';
import type { LuaBlock, SplitModule } from './splitModule';

export interface CarryBlock {
  /** `preamble` is module level, `prologue` is inside `install`. */
  origin: 'preamble' | 'prologue';
  /** The declaration, verbatim except for the renames and lockstep rewrites. */
  text: string;
  declares: string[];
  requires: string[];
  /** 1-based line in the source module. */
  line: number;
  /** The names that pulled this block into the closure. */
  neededBy: string[];
}

export interface CarryRename {
  from: string;
  to: string;
  /** What the emitted file binds `from` to instead. */
  kept: string;
}

export interface CarryResult {
  preamble: CarryBlock[];
  prologue: CarryBlock[];
  /** Names a carried block reads that nothing in the bundle declares. */
  unresolved: string[];
  /** Names renamed around a binding the generated file already has. */
  renames: CarryRename[];
  /** The lockstep calls rewritten, deduped (`math.sin`, `wa.random`, …). */
  rewrites: string[];
  /** `math.random()` with no arguments: no `wa.random` form means the same. */
  floatRandom: boolean;
  /** Blocks refused, and why. */
  refused: string[];
  /** The bundle dependencies a carried `require` needs (`effects.sdk`, …). */
  dependencies: string[];
  /**
   * Carried `require`s nothing in the export provides. These are not warnings:
   * the emitted module raises at load, so an export is refused and the author
   * has to add the bundle that provides them.
   */
  missingModules: string[];
  /** Warnings to show at import: a carried `wa` read at load, a rewritten name. */
  notes: string[];
  /** Bundle-relative paths rewritten onto the export's own folder. */
  pathRewrites: number;
  /** Each art path the carried text names, before and after the move. */
  paths: { source: string; target: string }[];
  /** Mechanical API 4 -> API 5 rewrites applied across carried blocks. */
  api4Rewrites: string[];
  /** Breaking API 4 constructs found in carried blocks that need manual attention. */
  api4Warnings: string[];
  /**
   * The same renames and rewrites, applied to another piece of carried text (the
   * hook body itself), so the hook and its declarations agree.
   */
  transform(text: string): {
    text: string;
    rewrites: string[];
    floatRandom: boolean;
    pathRewrites: number;
    paths: { source: string; target: string }[];
    api4Rewrites: string[];
    api4Warnings: string[];
  };
}

/**
 * The dependency a carried `require` needs, re-exported for callers that only
 * know about the carry. The table itself is `src/data/sdkModules.ts`, shared with
 * the export validator so the two can never disagree about which library
 * provides which module.
 */
export { dependencyForModule } from '../../data/sdkModules';

const cache = new WeakMap<LuaBlock, string[]>();

/**
 * The free names of a body, **including the function literals it builds**.
 *
 * `wa.on.worm_message(function(worm) swim_push(worm) end, { … })` is one
 * statement, and the checker reads a bare call as one expression, so it reports
 * nothing inside the callback: every registration seed carried no names at all,
 * and a bundle's state was only resolved through its claim hooks. The bundles
 * that declare their state in a `setup` helper register exactly this way.
 */
function bodyFreeNames(text: string, ambient: string[]): string[] {
  const names = new Set(freeNames(text, ambient));
  const masked = maskLuaCode(text);
  const word = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = word.exec(masked)) !== null) {
    if (m[0] !== 'function') continue;
    // `scanBlockEnd` answers the offset the closer starts at, so the body runs
    // to the end of that word: `function(w) points = 0` without its `end` is an
    // unbalanced fragment, and the checker reports nothing inside one.
    const end = scanBlockEnd(masked, m.index + m[0].length);
    if (end <= m.index) continue;
    const body = text.slice(m.index, end + 'end'.length);
    for (const name of freeNames(body, ambient)) names.add(name);
    word.lastIndex = end;
  }
  return [...names];
}

/** The free names of a block, given what is already in scope. */
function needs(block: LuaBlock, ambient: string[]): string[] {
  const cached = cache.get(block);
  if (cached) return cached;
  const names = bodyFreeNames(block.text, ambient);
  cache.set(block, names);
  return names;
}

/**
 * Which block declares `name`, searching `scopes` in order. The **last**
 * declaration in a scope wins, as it does in Lua, and the carried blocks are
 * emitted in source order so a forward call between two `local function`s still
 * resolves.
 */
function findDeclaration(
  name: string,
  scopes: LuaBlock[][],
  skip?: LuaBlock,
  beforeLine?: number,
): LuaBlock | null {
  for (const region of scopes) {
    let found: LuaBlock | null = null;
    for (const block of region) {
      if (block === skip) continue;
      if (beforeLine !== undefined && block.line >= beforeLine) continue;
      if (block.declares.includes(name)) found = block;
    }
    if (found) return found;
  }
  return null;
}

/** A name close to `name` that nothing has taken. */
function freeAlias(name: string, taken: Set<string>): string {
  const base = `${name}_bundle`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_x`;
}

/**
 * The declarations a set of carried bodies needs, transitively.
 *
 * `reserved` is what the emitted weapon file already binds: the generator's own
 * `require`s mapped to their module id, and its own locals mapped to `''`.
 */
export function carryClosure(
  seeds: { label: string; text: string; enclosing?: LuaBlock[][] }[],
  split: SplitModule,
  reserved: Map<string, string>,
  /** The export's sprite/sound folder (`sanitizeModFolder(id)`). */
  folder = '',
  /** What the generator will emit, so an identical declaration is not carried twice. */
  emitted = '',
  /** Whether the source bundle targets Lua API < 5 so carried code migrates to API 5. */
  migrateApi4 = false,
): CarryResult {
  const param = split.install?.param ?? 'ctx';
  /** The bundle dependencies a carried `require` needs, in the order they appear. */
  const dependencies: string[] = [];
  const installAmbient = [param];
  const preambleAll = split.preamble.filter((block) => block.declares.length > 0 || block.requires.length > 0);
  const preambleSet = new Set(preambleAll);
  const prologueAll = (split.install?.statements ?? []).filter(
    (block) => block.declares.length > 0 || block.requires.length > 0,
  );

  // ---- the closure ---------------------------------------------------------
  const carried = new Map<LuaBlock, { origin: 'preamble' | 'prologue'; neededBy: string[] }>();
  const unresolved: string[] = [];
  const refused: string[] = [];
  const notes: string[] = [];
  const missingModules: string[] = [];
  // A queue item carries the scopes of the point of use, innermost first, so a
  // name declared inside `function weapon.setup() … end` resolves where it was
  // written rather than at module level (`swim_suit`, `portal_gun`, `nuke_rocket`).
  const queue: {
    name: string;
    scopes: LuaBlock[][];
    from: string;
    skip?: LuaBlock;
    beforeLine?: number;
    readerText: string;
  }[] = [];
  /**
   * The scopes a block's own needs are resolved in: a preamble block sees only
   * module-level declarations, while an install block sees its own enclosing
   * blocks, then the install body, then the module level.
   */
  const scopesOf = (block: LuaBlock): LuaBlock[][] =>
    preambleSet.has(block)
      ? [preambleAll]
      : [
          block.scope ?? [],
          ...(block.enclosing ?? []),
          prologueAll,
          preambleAll,
        ];
  for (const seed of seeds) {
    const scopes = [...(seed.enclosing ?? []), prologueAll, preambleAll];
    for (const name of bodyFreeNames(seed.text, installAmbient)) {
      queue.push({ name, scopes, from: seed.label, readerText: seed.text });
    }
  }
  /**
   * The function whose parameter list binds `name`, if that is where it comes
   * from. A module shaped `function M.install(ctx, spec)` takes `spec` from
   * whoever calls it (`lib/cursor.lua` is installed that way), so the hook
   * closes over the *caller's* table: carrying the body without the call reads a
   * nil, and the summary has to say which line that is rather than "nothing
   * declares it".
   */
  const parameterOf = (name: string, scopes: LuaBlock[][], readerText: string) => {
    for (const region of scopes) {
      if (region === prologueAll || region === preambleAll) continue;
      for (const block of region) {
        if (block.start !== undefined && !block.text.includes(readerText)) continue;
        const head = /function\s*([A-Za-z0-9_.:]*)\s*\(([^)]*)\)/.exec(block.text);
        if (!head) continue;
        const params = head[2].split(',').map((param) => param.trim()).filter(Boolean);
        if (params.includes(name)) {
          return { header: head[1] || 'function', params: head[2].trim(), line: block.line };
        }
      }
    }
    return null;
  };
  const visited = new Set<string>();
  while (queue.length > 0) {
    const { name, scopes, from, skip, beforeLine, readerText } = queue.shift()!;
    // The skip is part of the identity: `x = …` asks for the `local x` while
    // excluding itself, and that is a different question from the earlier
    // lookup of `x` that found the assignment.
    const key = `${name}|${skip?.line ?? 0}|${beforeLine ?? 0}|${scopes.map((scope) => scope[0]?.line ?? 0).join(',')}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const block = findDeclaration(name, scopes, skip, beforeLine);
    if (!block) {
      const parameter = parameterOf(name, scopes, readerText);
      if (parameter) {
        // The block that reads it **is** carried when its other names resolve
        // (`utilities.cursor` installs `lib/cursor.lua`'s machinery with a spec
        // table, and its `on_click` hook arrives intact while `spec` stays a
        // nil), so the note must not claim the body was dropped.
        const note = `\`${name}\` is a parameter of \`${parameter.header}(${parameter.params})\` on line ${parameter.line}, which the caller supplies: the carried code reads it as a nil unless the call that passes it is carried too`;
        if (!notes.includes(note)) notes.push(note);
      }
      if (!unresolved.includes(name)) unresolved.push(name);
      continue;
    }
    // A block that cannot be carried is not carried whole, and its own needs are
    // not followed: a half-copied helper is a nil call with extra steps.
    const shape = checkLua(block.text, { mode: 'fragment', skipGlobals: true });
    const broken = shape.find(
      (finding) =>
        finding.severity === 'error' &&
        (finding.rule === 'lua-ast' || finding.rule === 'lua-nul' || finding.rule === 'lua-size'),
    );
    if (broken) {
      refused.push(`line ${block.line}: ${broken.message}`);
      if (!unresolved.includes(name)) unresolved.push(name);
      continue;
    }
    // The same declaration can be reached through more than one path, and the
    // scope walk builds its own block objects for a nested scope (a `setup`
    // helper is read once as a top-level statement and once from inside). One
    // line is one declaration, whatever object it arrived as.
    const sameBlock = (a: LuaBlock, b: LuaBlock) =>
      a.line === b.line && squash(a.text) === squash(b.text);
    const twin = [...carried.keys()].find((other) => sameBlock(other, block));
    const entry = twin ? carried.get(twin) : undefined;
    if (entry) {
      entry.neededBy.push(from);
      continue;
    }
    const origin = preambleAll.some((other) => sameBlock(other, block)) ? 'preamble' : 'prologue';
    // Two *locals* of one name would collide once both are hoisted into install;
    // a `local x` and the `x = …` that follows it are one binding (lesson 21's
    // shape), so only two `local` declarations clash.
    const declaresLocal = (text: string) => /^\s*local\b/.test(text);
    const clash = declaresLocal(block.text)
      ? [...carried.keys()].find(
          (other) =>
            other !== block &&
            declaresLocal(other.text) &&
            other.declares.some((declared) => block.declares.includes(declared)),
        )
      : undefined;
    if (clash) {
      // The same declaration written twice, once per helper that needs it: PX's
      // `weapon.definition` and `weapon.setup` both open with
      // `local shared = require("lib/shared")`, and that is one binding, not a
      // collision. The first copy serves both.
      if (squash(clash.text) === squash(block.text)) {
        carried.get(clash)?.neededBy.push(from);
        continue;
      }
      notes.push(
        `line ${block.line} declares ${block.declares.join(', ')} in a different scope from line ${clash.line}, so only the first was carried`,
      );
      if (!unresolved.includes(name)) unresolved.push(name);
      continue;
    }
    carried.set(block, { origin, neededBy: [from] });
    // A `wa` read at module level is a load-time nil (lesson 21).
    if (origin === 'preamble' && block.kind !== 'require') {
      const loadTime = checkLua(block.text, { mode: 'module', skipGlobals: true }).find(
        (finding) => finding.rule === 'module-wa' && finding.severity === 'error',
      );
      if (loadTime) {
        notes.push(`carried line ${block.line} reads \`wa\` while the module loads: ${loadTime.message}`);
      }
    }
    const nextScope: 'module' | 'install' = origin === 'preamble' ? 'module' : 'install';
    // A bare `x = …` binds an existing local, so the declaration of `x` has to
    // travel too or the assignment writes a global: pulsar declares `local zap`
    // at module level and assigns `zap = require("wf-lib/electric/damage")`
    // inside `install` (lesson 21's shape, because that module reads `wa` while
    // it loads).
    const own = scopesOf(block);
    if (!/^\s*local\b/.test(block.text)) {
      queue.push({ name, scopes: own, from: name, skip: block, beforeLine: block.line, readerText: block.text });
    }
    for (const need of needs(block, nextScope === 'install' ? installAmbient : [])) {
      queue.push({ name: need, scopes: own, from: name, readerText: block.text });
    }
  }

  // ---- what the emitted file already binds --------------------------------
  // One decision per name, not per block: a declaration (`local fx`) and the
  // assignment that follows it (`fx = require("…")`) are one binding, and
  // dropping half of a pair is how a bundle's `fx` ends up nil.
  const carriedModules = new Map<string, string>();
  for (const [block] of carried) {
    if (block.requires.length === 1 && block.declares.length === 1) {
      carriedModules.set(block.declares[0], block.requires[0]);
    }
  }
  const taken = new Set<string>([
    ...reserved.keys(),
    ...preambleAll.flatMap((block) => block.declares),
    ...prologueAll.flatMap((block) => block.declares),
  ]);
  // A declaration the export writes **itself, identically**, is not carried:
  // this is what makes a re-import of our own output stable (`stamp_hit`,
  // `STAMP_HIT`, the trail's own helpers). The comparison squashes whitespace,
  // because the export re-indents what it carries and a comment inside the block
  // is part of the text either way.
  const span = claimSpan(emitted);
  const headSquashed = emitted ? squash(span ? emitted.slice(0, span.start) : emitted) : '';
  const tailSquashed = emitted && span ? squash(emitted.slice(span.end)) : '';
  const dropBlocks = new Set<LuaBlock>();
  for (const [block, meta] of carried) {
    const squashedBlock = squash(block.text);
    const onlyRegistrations =
      meta.neededBy.length > 0 && meta.neededBy.every((from) => from.startsWith('wa.on.'));
    if (
      (headSquashed && headSquashed.includes(squashedBlock)) ||
      (onlyRegistrations && tailSquashed && tailSquashed.includes(squashedBlock))
    ) {
      dropBlocks.add(block);
      continue;
    }
    if (block.declares.length === 1) {
      const name = block.declares[0];
      const keptModule = reserved.get(name) ?? '';
      const mine = carriedModules.get(name);
      // Same module: the file's own binding is the same value, so the generated
      // declaration serves the hook too and nothing is carried.
      if (keptModule !== '' && mine !== undefined && mine === keptModule) dropBlocks.add(block);
    }
  }
  const droppedNames = new Set(
    [...dropBlocks].flatMap((block) => block.declares),
  );
  const renames: CarryRename[] = [];
  for (const name of new Set(
    [...carried.keys()].filter((block) => !dropBlocks.has(block)).flatMap((block) => block.declares),
  )) {
    if (!reserved.has(name) || droppedNames.has(name)) continue;
    const to = freeAlias(name, taken);
    taken.add(to);
    renames.push({ from: name, to, kept: reserved.get(name) || 'a local of its own' });
  }
  for (const block of dropBlocks) carried.delete(block);

  // ---- what a surviving require needs from `mod.toml` ----------------------
  // A carried `require("wf-lib/effects/…")` only resolves at load if the bundle
  // declares `effects.sdk`, and an import never saw a manifest line for it: the
  // editor's own feature dependencies cover its own output, not a bundle's code.
  // A module nothing here ships is named instead, because the export would fail
  // at load and the author needs to know which line to add.
  for (const [block] of carried) {
    for (const module of block.requires) {
      const dependency = dependencyForModule(module);
      if (dependency) {
        if (!dependencies.includes(dependency)) dependencies.push(dependency);
        continue;
      }
      notes.push(
        `carried \`require("${module}")\` is not shipped by the export: add the bundle that provides it to Dependencies, or the export fails at load`,
      );
      if (!missingModules.includes(module)) missingModules.push(module);
    }
  }

  // ---- rewrites, then the blocks ------------------------------------------
  const transform = (text: string) => {
    const renamed = rewriteNames(text, renames);
    const fixed = fixLockstepRng(renamed);
    // A bundle's own art moves with the export: the ZIP only ever ships
    // `sprites/<mod>/` and `sounds/<mod>/`, so a carried `sprite =
    // "sprites/vortex/hold.png"` has to name the folder the file is written to
    // or the call fails when it runs.
    const moved = rewriteBundlePaths(fixed, folder);
    const migrated = migrateApi4
      ? migrateApi4Lua(moved.text)
      : { text: moved.text, rewrites: [] as string[], warnings: [] as string[] };
    return {
      text: migrated.text,
      rewrites: rewrittenCalls(renamed, fixed),
      floatRandom: hasFloatRandom(fixed),
      pathRewrites: moved.moves.filter((move) => move.source !== move.target).length,
      paths: moved.moves,
      api4Rewrites: migrated.rewrites,
      api4Warnings: migrated.warnings,
    };
  };
  const rewrites = new Set<string>();
  let floatRandom = false;
  let pathRewrites = 0;
  const paths: { source: string; target: string }[] = [];
  const api4Rewrites = new Set<string>();
  const api4Warnings = new Set<string>();
  const output = (origin: 'preamble' | 'prologue'): CarryBlock[] =>
    [...carried.entries()]
      .filter(([, entry]) => entry.origin === origin)
      .map(([block, entry]) => ({ block, entry }))
      .sort((a, b) => a.block.line - b.block.line)
      .map(({ block, entry }) => {
        const transformed = transform(block.text);
        for (const call of transformed.rewrites) rewrites.add(call);
        floatRandom = floatRandom || transformed.floatRandom;
        pathRewrites += transformed.pathRewrites;
        paths.push(...transformed.paths);
        for (const item of transformed.api4Rewrites) api4Rewrites.add(item);
        for (const warning of transformed.api4Warnings) api4Warnings.add(warning);
        return {
          origin,
          text: transformed.text,
          declares: block.declares,
          requires: block.requires,
          line: block.line,
          neededBy: [...new Set(entry.neededBy)],
        };
      });

  return {
    preamble: output('preamble'),
    prologue: output('prologue'),
    unresolved,
    renames,
    rewrites: [...rewrites],
    floatRandom,
    pathRewrites,
    paths,
    api4Rewrites: [...api4Rewrites],
    api4Warnings: [...api4Warnings],
    refused,
    dependencies,
    missingModules,
    notes,
    transform,
  };
}

/** Whitespace-free text, for comparing two renderings of one declaration. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

/** Span of the `wa.weapons.replace` claim (including `local rec = { ... }` if indirect). */
function claimSpan(emitted: string): { start: number; end: number } | null {
  if (!emitted) return null;
  const masked = maskLuaCode(emitted);
  const call = /(?:^|[^A-Za-z0-9_.])(wa\s*\.\s*weapons\s*\.\s*replace)\b/.exec(masked);
  if (!call) return null;
  const callStart = call.index + call[0].indexOf(call[1]);
  let pos = call.index + call[0].length;
  while (pos < masked.length && /\s/.test(masked[pos])) pos += 1;
  const scanBalanced = (openAt: number, openCh: string, closeCh: string): number => {
    let depth = 0;
    for (let i = openAt; i < masked.length; i += 1) {
      if (masked[i] === openCh) depth += 1;
      else if (masked[i] === closeCh) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  };
  let start = callStart;
  let end = -1;
  if (masked[pos] === '{') {
    end = scanBalanced(pos, '{', '}');
  } else if (masked[pos] === '(') {
    end = scanBalanced(pos, '(', ')');
    if (end > pos) {
      const inner = masked.slice(pos + 1, end - 1).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) {
        const declRe = new RegExp(`(^|[^A-Za-z0-9_.])(local\\s+${inner}\\s*=\\s*\\{)`, 'g');
        let lastDeclAt = -1;
        let m: RegExpExecArray | null;
        while ((m = declRe.exec(masked)) !== null && m.index < callStart) {
          lastDeclAt = m.index + m[1].length;
        }
        if (lastDeclAt >= 0) start = lastDeclAt;
      }
    }
  }
  return end > start ? { start, end } : null;
}

function countUnprefixedMath(masked: string, fn: string): number {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_.])math\\s*\\.\\s*${fn}\\b`, 'g');
  return masked.match(re)?.length ?? 0;
}

/** The `math.*` forms a rewrite actually changed, so the note can name them. */
function rewrittenCalls(before: string, after: string): string[] {
  if (before === after) return [];
  const maskedBefore = maskLuaCode(before);
  const maskedAfter = maskLuaCode(after);
  const out: string[] = [];
  const mapping: [string, string][] = [
    ['random', 'math.random -> wa.random'],
    ['sin', 'math.sin -> wa.math.sin'],
    ['cos', 'math.cos -> wa.math.cos'],
    ['atan', 'math.atan -> wa.math.atan'],
  ];
  for (const [fn, label] of mapping) {
    if (countUnprefixedMath(maskedBefore, fn) > countUnprefixedMath(maskedAfter, fn)) {
      out.push(label);
    }
  }
  return out;
}

/** `math.random()` returns a float: there is no `wa.random` form that matches. */
function hasFloatRandom(code: string): boolean {
  return /(^|[^A-Za-z0-9_.])math\s*\.\s*random\s*\(\s*\)/.test(maskLuaCode(code));
}

/**
 * Moves a carried reference to the bundle's own art onto the export's folder.
 *
 * A ZIP ships `sprites/<mod>/…` and `sounds/<mod>/…` and nothing else: the
 * engine resolves a pack path inside the bundle that names it (`inside_pack`),
 * so a carried `sprite = "sprites/vortex/hold.png"` would name a folder the
 * export does not have. Only the folder segment changes; the file name is the
 * author's, and a file the export does not write is a missing-art error with the
 * path in it rather than a silent one.
 *
 * The match is on a quoted string, because a path in a comment is prose.
 */
export function rewriteBundlePaths(
  text: string,
  folder: string,
): { text: string; moves: { source: string; target: string }[] } {
  if (!folder) return { text, moves: [] };
  const moves: { source: string; target: string }[] = [];
  // The whole quoted path is captured so the caller can load the same file from
  // the bundle it came from, not only name the folder it moves to. A path that is
  // already the export's own (`sprites/<mod>/hold.png`, which is what a re-import
  // sees) is recorded too: that is how a carried sheet stays declared and
  // written on the second pass instead of quietly leaving the zip.
  const seen = new Set<string>();
  const masked1 = maskLuaCode(text);
  const pass1 = text.replace(
    /(["'])((?:sprites|sounds)\/[^/"']+\/[^"']+)\1/g,
    (whole, quote: string, path: string, offset: number) => {
      if (masked1[offset] !== quote) return whole;
      const slash = path.indexOf('/');
      const kind = path.slice(0, slash);
      const file = path.slice(path.indexOf('/', slash + 1) + 1);
      const target = `${kind}/${folder}/${file}`;
      // A path can contain neither a comma nor a newline, so the pair is a key.
      const key = `${path},${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        moves.push({ source: path, target });
      }
      return target === path ? whole : `${quote}${target}${quote}`;
    },
  );
  const masked2 = maskLuaCode(pass1);
  const out = pass1.replace(
    /(["'])((?:sprites|sounds)\/[^/"']+\/)\1/g,
    (whole, quote: string, prefix: string, offset: number) => {
      if (masked2[offset] !== quote) return whole;
      const kind = prefix.slice(0, prefix.indexOf('/'));
      const target = `${kind}/${folder}/`;
      // A folder prefix is how a bundle names a whole set of files
      // (`local SND = "sounds/buffalo/"`, then `SND .. "start.wav"`). The move
      // keeps the trailing slash so the caller can expand it into the folder's
      // files: without that the path was rewritten but no file was attached or
      // declared, and the export named a folder it never wrote.
      const key = `${prefix},${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        moves.push({ source: prefix, target });
      }
      if (target === prefix) return whole;
      return `${quote}${target}${quote}`;
    },
  );
  return { text: out, moves };
}
