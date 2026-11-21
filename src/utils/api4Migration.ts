import { maskLuaCode } from './luaText';

export interface Api4MigrationResult {
  text: string;
  rewrites: string[];
  warnings: string[];
}

interface TextEdit {
  start: number;
  end: number;
  to: string;
  label: string;
}

interface TableEntry {
  key?: string;
  keyStart?: number;
  keyEnd?: number;
  valueStart: number;
  valueEnd: number;
  entryStart: number;
  commaBefore?: number;
  commaAfter?: number;
}

const SPAWN_REMOVED_KEYS = new Set([
  'collide_land',
  'collide_worms',
  'collide_objects',
  'as_object',
  'mask',
  'mask_land',
  'mask_worms',
  'mask_objects',
  'shape',
  'solid',
  'on_explode',
  'kind',
  'from',
  'screen',
  'cluster',
]);

function matchingBraceMasked(masked: string, openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelEntries(masked: string, openBrace: number, closeBrace: number): TableEntry[] {
  const entries: TableEntry[] = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let segStart = openBrace + 1;
  let commaBefore: number | undefined;

  const pushSegment = (segEnd: number, commaAfter?: number) => {
    const raw = masked.slice(segStart, segEnd);
    const trimmed = raw.trim();
    if (!trimmed) {
      segStart = commaAfter !== undefined ? commaAfter + 1 : segEnd;
      commaBefore = commaAfter;
      return;
    }
    const leadingWs = raw.length - raw.trimStart().length;
    const entryStart = segStart + leadingWs;
    const tail = masked.slice(entryStart, segEnd);
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(tail);
    if (kv) {
      const key = kv[1];
      const keyStart = entryStart;
      const keyEnd = entryStart + key.length;
      let valStart = entryStart + kv[0].length;
      while (valStart < segEnd && /\s/.test(masked[valStart])) valStart += 1;
      let valEnd = segEnd;
      while (valEnd > valStart && /\s/.test(masked[valEnd - 1])) valEnd -= 1;
      entries.push({
        key,
        keyStart,
        keyEnd,
        valueStart: valStart,
        valueEnd: valEnd,
        entryStart,
        commaBefore,
        commaAfter,
      });
    } else {
      let valStart = entryStart;
      let valEnd = segEnd;
      while (valEnd > valStart && /\s/.test(masked[valEnd - 1])) valEnd -= 1;
      entries.push({
        valueStart: valStart,
        valueEnd: valEnd,
        entryStart,
        commaBefore,
        commaAfter,
      });
    }
    segStart = commaAfter !== undefined ? commaAfter + 1 : segEnd;
    commaBefore = commaAfter;
  };

  for (let i = openBrace + 1; i < closeBrace; i += 1) {
    const ch = masked[i];
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (
      (ch === ',' || ch === ';') &&
      braceDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0
    ) {
      pushSegment(i, i);
    }
  }
  pushSegment(closeBrace, undefined);
  return entries;
}

function buildCollideRemovalEdit(code: string, entry: TableEntry): TextEdit {
  const start = entry.keyStart ?? entry.entryStart;
  if (entry.commaAfter !== undefined) {
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    const onlyWsBefore = /^[ \t]*$/.test(code.slice(lineStart, start));
    const afterComma = code.slice(entry.commaAfter + 1);
    const eolMatch = /^[ \t]*(\r?\n)/.exec(afterComma);
    if (onlyWsBefore && eolMatch) {
      return {
        start: lineStart,
        end: entry.commaAfter + 1 + eolMatch[0].length,
        to: '',
        label: 'spawn collide = false removed',
      };
    }
    const wsAfter = /^[ \t]*/.exec(afterComma)?.[0].length ?? 0;
    return {
      start,
      end: entry.commaAfter + 1 + wsAfter,
      to: '',
      label: 'spawn collide = false removed',
    };
  }
  if (entry.commaBefore !== undefined) {
    return {
      start: entry.commaBefore,
      end: entry.valueEnd,
      to: '',
      label: 'spawn collide = false removed',
    };
  }
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  const onlyWsBefore = /^[ \t]*$/.test(code.slice(lineStart, start));
  const eolMatch = /^[ \t]*(\r?\n)/.exec(code.slice(entry.valueEnd));
  if (onlyWsBefore && eolMatch) {
    return {
      start: lineStart,
      end: entry.valueEnd + eolMatch[0].length,
      to: '',
      label: 'spawn collide = false removed',
    };
  }
  return {
    start,
    end: entry.valueEnd,
    to: '',
    label: 'spawn collide = false removed',
  };
}

/**
 * Rewrites mechanical Lua API 4 constructs to API 5 and flags breaking ones
 * that need manual attention. Comments and string literals are masked out via
 * `maskLuaCode` so prose and string payloads stay untouched.
 */
export function migrateApi4Lua(code: string): Api4MigrationResult {
  if (!code) return { text: code, rewrites: [], warnings: [] };
  const masked = maskLuaCode(code);
  const edits: TextEdit[] = [];
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };

  let m: RegExpExecArray | null;

  // 1. :despawn() -> :remove()
  const despawnRe = /:\s*despawn\s*\(\s*\)/g;
  while ((m = despawnRe.exec(masked)) !== null) {
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      to: ':remove()',
      label: ':despawn() -> :remove()',
    });
  }

  // 2. :hurt{...} / :hurt(...) -> :hit{...} / :hit(...)
  const hurtRe = /(:\s*)hurt(?=\s*[({])/g;
  while ((m = hurtRe.exec(masked)) !== null) {
    const start = m.index + m[1].length;
    edits.push({
      start,
      end: m.index + m[0].length,
      to: 'hit',
      label: ':hurt -> :hit',
    });
  }

  // 3. :drop() -> :release(0, 0)
  const dropRe = /:\s*drop\s*\(\s*\)/g;
  while ((m = dropRe.exec(masked)) !== null) {
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      to: ':release(0, 0)',
      label: ':drop() -> :release(0, 0)',
    });
  }

  // 4. :allow_death() -> :die{ settled = true }
  const allowDeathRe = /:\s*allow_death\s*\(\s*\)/g;
  while ((m = allowDeathRe.exec(masked)) !== null) {
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      to: ':die{ settled = true }',
      label: ':allow_death() -> :die{ settled = true }',
    });
  }

  // 5. .blast_damage -> .power
  const blastDamageRe = /(\.\s*)blast_damage\b/g;
  while ((m = blastDamageRe.exec(masked)) !== null) {
    const start = m.index + m[1].length;
    edits.push({
      start,
      end: m.index + m[0].length,
      to: 'power',
      label: '.blast_damage -> .power',
    });
  }

  // 6. .uid -> .id
  const uidRe = /(\.\s*)uid\b/g;
  while ((m = uidRe.exec(masked)) !== null) {
    const start = m.index + m[1].length;
    edits.push({
      start,
      end: m.index + m[0].length,
      to: 'id',
      label: '.uid -> .id',
    });
  }

  // 7. wa.world.keys().sprint -> wa.world.keys().shift
  const sprintRe = /(?<![A-Za-z0-9_.])(wa\s*\.\s*world\s*\.\s*keys\s*\(\s*\)\s*\.)sprint\b/g;
  while ((m = sprintRe.exec(masked)) !== null) {
    const start = m.index + m[1].length;
    edits.push({
      start,
      end: m.index + m[0].length,
      to: 'shift',
      label: 'keys().sprint -> keys().shift',
    });
  }

  // 8. bare wa.world.sky -> wa.world.sky()
  const skyRe = /(?<![A-Za-z0-9_.])wa\s*\.\s*world\s*\.\s*sky\b(?!\s*\()/g;
  while ((m = skyRe.exec(masked)) !== null) {
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      to: 'wa.world.sky()',
      label: 'wa.world.sky -> wa.world.sky()',
    });
  }

  // 9. :set_state("sliding"|"sinking") and .state == / ~= "sliding"|"sinking"
  const stateStrRe = /(?::\s*set_state\s*\(\s*|\.\s*state\s*[~=]=\s*)(["'])/g;
  while ((m = stateStrRe.exec(masked)) !== null) {
    const quote = m[1];
    const litStart = m.index + m[0].length - 1;
    const closeAt = masked.indexOf(quote, litStart + 1);
    if (closeAt < 0 || code.slice(litStart + 1, closeAt).includes('\n')) continue;
    const rawVal = code.slice(litStart + 1, closeAt);
    if (rawVal === 'sliding') {
      edits.push({
        start: litStart + 1,
        end: closeAt,
        to: 'falling',
        label: 'state "sliding" -> "falling"',
      });
    } else if (rawVal === 'sinking') {
      edits.push({
        start: litStart + 1,
        end: closeAt,
        to: 'tumbling',
        label: 'state "sinking" -> "tumbling"',
      });
    }
  }

  // 9b. decay_mode = "resting"|"on_hit" -> "instant"|"at_turn_start"
  const decayRe = /(?<![A-Za-z0-9_.])decay_mode\s*=\s*(["'])/g;
  while ((m = decayRe.exec(masked)) !== null) {
    const quote = m[1];
    const litStart = m.index + m[0].length - 1;
    const closeAt = masked.indexOf(quote, litStart + 1);
    if (closeAt < 0 || code.slice(litStart + 1, closeAt).includes('\n')) continue;
    const rawVal = code.slice(litStart + 1, closeAt);
    if (rawVal === 'resting') {
      edits.push({
        start: litStart + 1,
        end: closeAt,
        to: 'instant',
        label: 'decay_mode "resting" -> "instant"',
      });
    } else if (rawVal === 'on_hit') {
      edits.push({
        start: litStart + 1,
        end: closeAt,
        to: 'at_turn_start',
        label: 'decay_mode "on_hit" -> "at_turn_start"',
      });
    }
  }

  // 10. Claim-level on_bump = -> on_contact =
  const onBumpRe = /(?<![A-Za-z0-9_.])on_bump(?=\s*=)/g;
  while ((m = onBumpRe.exec(masked)) !== null) {
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      to: 'on_contact',
      label: 'on_bump -> on_contact',
    });
  }

  // 11. Scoped wa.actors.spawn({ ... }) scan (depth-1 keys + on = { ... } depth-1 keys)
  const spawnRe = /(?<![A-Za-z0-9_.])wa\s*\.\s*actors\s*\.\s*spawn\s*(?:\(\s*\{|\{)/g;
  while ((m = spawnRe.exec(masked)) !== null) {
    const openAt = m.index + m[0].length - 1;
    const closeAt = matchingBraceMasked(masked, openAt);
    if (closeAt < 0) continue;
    const entries = splitTopLevelEntries(masked, openAt, closeAt);
    for (const entry of entries) {
      if (!entry.key || entry.keyStart === undefined || entry.keyEnd === undefined) continue;
      const key = entry.key;
      const rawVal = code.slice(entry.valueStart, entry.valueEnd).trim();
      if (key === 'gravity') {
        if (rawVal === 'false') {
          edits.push({
            start: entry.valueStart,
            end: entry.valueEnd,
            to: '0',
            label: 'spawn gravity = false -> 0',
          });
        } else if (rawVal === 'true') {
          edits.push({
            start: entry.valueStart,
            end: entry.valueEnd,
            to: '1',
            label: 'spawn gravity = true -> 1',
          });
        }
      } else if (key === 'collide') {
        if (rawVal === 'false') {
          edits.push(buildCollideRemovalEdit(code, entry));
        } else {
          warn('wa.actors.spawn field `collide` was removed in API 5: use `body = { ... }`');
        }
      } else if (key === 'on' && masked[entry.valueStart] === '{') {
        const onClose = matchingBraceMasked(masked, entry.valueStart);
        if (onClose > entry.valueStart) {
          const onEntries = splitTopLevelEntries(masked, entry.valueStart, onClose);
          for (const onEntry of onEntries) {
            if (
              !onEntry.key ||
              onEntry.keyStart === undefined ||
              onEntry.keyEnd === undefined
            ) {
              continue;
            }
            if (onEntry.key === 'contact') {
              edits.push({
                start: onEntry.keyStart,
                end: onEntry.keyEnd,
                to: 'touched',
                label: 'actor on.contact -> on.touched',
              });
            } else if (onEntry.key === 'bump') {
              edits.push({
                start: onEntry.keyStart,
                end: onEntry.keyEnd,
                to: 'contact',
                label: 'actor on.bump -> on.contact',
              });
            }
          }
        }
      } else if (SPAWN_REMOVED_KEYS.has(key)) {
        warn(`wa.actors.spawn field \`${key}\` changed or was removed in API 5`);
      }
    }
  }

  // ---- Tier-2 warnings (no rewrite) ----------------------------------------
  const gravEventRe = /(?<![A-Za-z0-9_.])wa\s*\.\s*on\s*\.\s*(gravity_before|gravity_after)\b/g;
  while ((m = gravEventRe.exec(masked)) !== null) {
    warn(`wa.on.${m[1]} was removed in API 5 (no direct replacement)`);
  }

  const takeRe = /:\s*take\s*(?:\(\s*\{|\{)/g;
  while ((m = takeRe.exec(masked)) !== null) {
    const openAt = m.index + m[0].length - 1;
    const closeAt = matchingBraceMasked(masked, openAt);
    if (closeAt < 0) continue;
    const entries = splitTopLevelEntries(masked, openAt, closeAt);
    if (entries.some((e) => e.key === 'hide')) {
      warn(
        'worm:take{ hide = ... } was removed in API 5: use worm.visible = false / worm.body_visible = false',
      );
    }
  }

  const stateIdRe = /\.\s*(state_id|state_label|state_address)\b/g;
  while ((m = stateIdRe.exec(masked)) !== null) {
    warn(
      `worm.${m[1]} is unavailable in API 5 release builds: use readable worm.state strings`,
    );
  }

  const advanceRe = /:\s*advance\s*\(/g;
  if (advanceRe.test(masked)) {
    warn('actor:advance() was removed in API 5');
  }

  const actorsKindRe = /(?<![A-Za-z0-9_.])wa\s*\.\s*actors\s*\.\s*kind\b/g;
  if (actorsKindRe.test(masked)) {
    warn('wa.actors.kind was removed in API 5');
  }

  if (edits.length === 0) {
    return { text: code, rewrites: [], warnings };
  }

  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const applied: TextEdit[] = [];
  let lastEnd = -1;
  for (const edit of edits) {
    if (edit.start < lastEnd) continue;
    applied.push(edit);
    lastEnd = edit.end;
  }

  let out = '';
  let cursor = 0;
  const rewrites: string[] = [];
  for (const edit of applied) {
    out += code.slice(cursor, edit.start) + edit.to;
    cursor = edit.end;
    if (!rewrites.includes(edit.label)) rewrites.push(edit.label);
  }
  out += code.slice(cursor);

  return { text: out, rewrites, warnings };
}
