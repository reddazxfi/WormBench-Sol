import type {
  PxlParsedScripts,
  PxlScriptFlightParams,
  PxlScriptHoldParams,
  PxlScriptSoundRef,
} from '../../types/pxl';

/**
 * Strip `//` line comments and `/* ... *\/` block comments from PX C-script
 * while preserving `"..."` string literals verbatim.
 */
function stripCScriptComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const ch = source[i];
        out += ch;
        i++;
        if (ch === '\\' && i < n) {
          out += source[i];
          i++;
        } else if (ch === '"') {
          break;
        }
      }
    } else if (c === '/' && i + 1 < n && source[i + 1] === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
    } else if (c === '/' && i + 1 < n && source[i + 1] === '*') {
      i += 2;
      while (i + 1 < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function unescapeStringLiteral(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

function parseBool(raw: string): boolean | undefined {
  const t = raw.trim();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  return undefined;
}

function parseNum(raw: string): number | undefined {
  const t = raw.trim().replace(/f$/i, '');
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(t)) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

function parseHandType(raw: string): 'lower' | 'mid' | 'upper' | undefined {
  const n = parseNum(raw);
  if (n === 1) return 'lower';
  if (n === 2) return 'mid';
  if (n === 3) return 'upper';
  return undefined;
}

export function basenameOfAsset(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return slash >= 0 ? name.slice(slash + 1) : name;
}

export function isBuiltinPxRequire(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    !lower ||
    lower === 'utils' ||
    lower.startsWith('utils_') ||
    lower === 'p_sprite_builder' ||
    lower.startsWith('p_sprite_builder_') ||
    lower === 'red_sprite_builder' ||
    lower === 'pxparticles' ||
    lower === 'custom_particles' ||
    lower === 'vectors' ||
    lower === 'math'
  );
}

/**
 * Scan PX C-script items for:
 * - `GetAttachment("x")` + `LoadSprite(var, frames, ...)` pairs (`frameCounts`),
 * - `CWormAnimParams` blocks (`holdParams`),
 * - `WeapSpriteParams` / `SetCustomAnim` / `SetSpriteMultiplex` (`flightParams`),
 * - `GetAttachment("x.wav")` + `CSoundFile(var)` (`sounds`),
 * - `require ...;` library dependencies (`requires`),
 * - `SetSpriteOverride(id, var)` mappings (`spriteOverrides`).
 *
 * Best-effort line/statement scanner; never executes or evaluates scripts.
 */
export function readSpriteScripts(scripts: readonly string[]): PxlParsedScripts {
  const frameCounts = new Map<string, number>();
  const frameCountsRaw = new Map<string, number>();
  const holdParams: PxlScriptHoldParams[] = [];
  const flightParams: PxlScriptFlightParams[] = [];
  const sounds: PxlScriptSoundRef[] = [];
  const requires: string[] = [];
  const seenRequires = new Set<string>();
  const spriteOverrides = new Map<number, string>();

  const recordFrames = (assetName: string, frames: number) => {
    if (!Number.isFinite(frames) || frames < 1 || frames > 512) return;
    const count = Math.round(frames);
    const lower = assetName.toLowerCase();
    const baseLower = basenameOfAsset(assetName).toLowerCase();
    if (!frameCounts.has(lower)) frameCounts.set(lower, count);
    if (!frameCounts.has(baseLower)) frameCounts.set(baseLower, count);
    if (!frameCountsRaw.has(assetName)) frameCountsRaw.set(assetName, count);
  };

  // Share file/sprite declarations across scripts in the same library so split
  // InitGraphic + Message scripts still resolve sprite variables cleanly.
  const fileVars = new Map<string, string>();
  const spriteVars = new Map<string, string>();

  for (const rawScript of scripts) {
    const clean = stripCScriptComments(rawScript);
    let currentWeapon: string | undefined;

    const holdVars = new Map<string, PxlScriptHoldParams>();
    const emittedHoldVars = new Set<string>();
    let lastHoldVar: string | null = null;

    const flightVars = new Map<string, PxlScriptFlightParams>();
    const emittedFlightVars = new Set<string>();
    let lastFlightVar: string | null = null;
    const stringVars = new Map<string, string>();

    const hasHoldFields = (p: PxlScriptHoldParams): boolean =>
      Object.entries(p).some(([k, v]) => k !== 'weaponName' && v !== undefined);
    const hasFlightFields = (p: PxlScriptFlightParams): boolean =>
      Object.entries(p).some(([k, v]) => k !== 'weaponName' && v !== undefined);

    const resolveWeaponArg = (weapArg?: string, fallback?: string): string | undefined => {
      if (weapArg) {
        const lit = weapArg.match(/^"((?:[^"\\]|\\.)*)"$/);
        if (lit) return unescapeStringLiteral(lit[1]);
        const fromVar = stringVars.get(weapArg);
        if (fromVar !== undefined) return fromVar;
      }
      return fallback ?? currentWeapon;
    };

    const resolveSpriteArg = (spriteRef?: string, fallback?: string): string | undefined => {
      if (spriteRef) {
        const key = spriteRef.replace(/->Index$/i, '').trim();
        const found = spriteVars.get(key) ?? spriteVars.get(spriteRef);
        if (found) return found;
      }
      return fallback;
    };

    const emitHold = (varName: string, spriteRef?: string, weapArg?: string) => {
      const target = holdVars.get(varName);
      if (!target) return;
      const out: PxlScriptHoldParams = { ...target };
      out.weaponName = resolveWeaponArg(weapArg, out.weaponName);
      out.sheetName = resolveSpriteArg(spriteRef, out.sheetName);
      holdParams.push(out);
      emittedHoldVars.add(varName);
    };

    const emitFlight = (varName: string, spriteRef?: string) => {
      const target = flightVars.get(varName);
      if (!target) return;
      const out: PxlScriptFlightParams = { ...target };
      out.weaponName = currentWeapon ?? out.weaponName;
      out.sheetName = resolveSpriteArg(spriteRef, out.sheetName);
      flightParams.push(out);
      emittedFlightVars.add(varName);
    };

    // Extract `require a, b, c;` before statement splitting so multi-line `require` lists stay intact.
    for (const reqMatch of clean.matchAll(/\brequire\s+([^;]+);/g)) {
      for (const part of reqMatch[1].split(',')) {
        const dep = part.trim();
        if (!dep || isBuiltinPxRequire(dep)) continue;
        const lower = dep.toLowerCase();
        if (!seenRequires.has(lower)) {
          seenRequires.add(lower);
          requires.push(dep);
        }
      }
    }

    // Split on newlines and `;` so one-liners like `f = GetAttachment(...); x = LoadSprite(f, 12, 0);`
    // and multi-line blocks are handled uniformly.
    const statements = clean.split(/[\r\n;]+/);

    for (const rawStmt of statements) {
      const stmt = rawStmt.trim();
      if (!stmt) continue;

      // Weapon context clues: `CheckName("Javelin")` or `weapName = "Javelin"`
      const checkNameMatch = stmt.match(/CheckName\s*\(\s*"((?:[^"\\]|\\.)+)"\s*\)/);
      if (checkNameMatch) {
        currentWeapon = unescapeStringLiteral(checkNameMatch[1]);
      }

      const weapVarAssign = stmt.match(/^\s*(?:(?:local|string)\s+)?(\w+)\s*=\s*"((?:[^"\\]|\\.)+)"\s*$/);
      if (weapVarAssign) {
        const varName = weapVarAssign[1];
        const val = unescapeStringLiteral(weapVarAssign[2]);
        stringVars.set(varName, val);
        if (/weap/i.test(varName)) currentWeapon = val;
      }

      // Direct `LoadSprite(GetAttachment("..."), frames, ...)`
      const directLoad = stmt.match(
        /(?:(?:local|CSprite\s*\*?)\s+)?(\w+)?\s*=?\s*LoadSprite\s*\(\s*GetAttachment\s*\(\s*"((?:[^"\\]|\\.)+)"\s*\)\s*,\s*(\d+)/,
      );
      if (directLoad) {
        const fileName = unescapeStringLiteral(directLoad[2]);
        const frames = Number(directLoad[3]);
        recordFrames(fileName, frames);
        if (directLoad[1]) spriteVars.set(directLoad[1], fileName);
      } else {
        // `var = GetAttachment("...")`
        const attachMatch = stmt.match(
          /(?:(?:local|CFile\s*\*?)\s+)?(\w+)\s*=\s*GetAttachment\s*\(\s*"((?:[^"\\]|\\.)+)"\s*\)/,
        );
        if (attachMatch) {
          fileVars.set(attachMatch[1], unescapeStringLiteral(attachMatch[2]));
        }

        // `sprVar = LoadSprite(fileVar, frames, ...)`
        const loadMatch = stmt.match(
          /(?:(?:(?:local|CSprite\s*\*?)\s+)?(\w+)\s*=\s*)?LoadSprite\s*\(\s*(\w+)\s*,\s*(\d+)/,
        );
        if (loadMatch) {
          const sprVar = loadMatch[1];
          const fVar = loadMatch[2];
          const frames = Number(loadMatch[3]);
          const attached = fileVars.get(fVar);
          if (attached) {
            recordFrames(attached, frames);
            if (sprVar) spriteVars.set(sprVar, attached);
          }
        }
      }

      // `sprite = javelin_aiming->Index`
      const indexAlias = stmt.match(/^\s*(?:local\s+)?(\w+)\s*=\s*(\w+)->Index\s*$/);
      if (indexAlias) {
        const target = spriteVars.get(indexAlias[2]);
        if (target) spriteVars.set(indexAlias[1], target);
      }

      // Sound attachment: `sndVar = new CSoundFile(fileVar)` or `new CSoundFile(GetAttachment("..."))`
      const directSound = stmt.match(
        /(?:(?:local|CSoundFile\s*\*?)\s+)?(\w+)\s*=\s*(?:new\s+)?CSoundFile\s*\(\s*GetAttachment\s*\(\s*"((?:[^"\\]|\\.)+)"\s*\)\s*\)/,
      );
      if (directSound) {
        sounds.push({
          varName: directSound[1],
          fileName: unescapeStringLiteral(directSound[2]),
          weaponName: currentWeapon,
        });
      } else {
        const soundMatch = stmt.match(
          /(?:(?:local|CSoundFile\s*\*?)\s+)?(\w+)\s*=\s*(?:new\s+)?CSoundFile\s*\(\s*(\w+)\s*\)/,
        );
        if (soundMatch) {
          const attached = fileVars.get(soundMatch[2]);
          if (attached) {
            sounds.push({
              varName: soundMatch[1],
              fileName: attached,
              weaponName: currentWeapon,
            });
          }
        }
      }

      // `CWormAnimParams* Params = new CWormAnimParams`
      const cwInit = stmt.match(/CWormAnimParams\s*\*?\s*(\w+)\s*=\s*new\s+CWormAnimParams/);
      if (cwInit) {
        const varName = cwInit[1];
        const prev = holdVars.get(varName);
        if (prev && !emittedHoldVars.has(varName) && hasHoldFields(prev)) {
          emitHold(varName);
        }
        holdVars.set(varName, { weaponName: currentWeapon });
        emittedHoldVars.delete(varName);
        lastHoldVar = varName;
        continue;
      }

      // `WeapSpriteParams* Params = new WeapSpriteParams`
      const wsInit = stmt.match(/WeapSpriteParams\s*\*?\s*(\w+)\s*=\s*new\s+WeapSpriteParams/);
      if (wsInit) {
        const varName = wsInit[1];
        const prev = flightVars.get(varName);
        if (prev && !emittedFlightVars.has(varName) && hasFlightFields(prev)) {
          emitFlight(varName);
        }
        flightVars.set(varName, { weaponName: currentWeapon });
        emittedFlightVars.delete(varName);
        lastFlightVar = varName;
        continue;
      }

      // `Params->field = value`
      const paramAssign = stmt.match(/^\s*(\w+)->(\w+)\s*=\s*(.+?)\s*$/);
      if (paramAssign) {
        const [, varName, field, rawVal] = paramAssign;
        const holdTarget = holdVars.get(varName);
        if (holdTarget) {
          switch (field) {
            case 'hand_radius': holdTarget.handRadius = parseNum(rawVal); break;
            case 'hand_rotation': holdTarget.handRotation = parseNum(rawVal); break;
            case 'hand_radial_rotation': holdTarget.handRadialRotation = parseNum(rawVal); break;
            case 'hand_scale': holdTarget.handScale = parseNum(rawVal); break;
            case 'hand_type': holdTarget.handType = parseHandType(rawVal); break;
            case 'scale': holdTarget.scale = parseNum(rawVal); break;
            case 'weap_rotation': holdTarget.weapRotation = parseNum(rawVal); break;
            case 'weap_radial_rotation': holdTarget.weapRadialRotation = parseNum(rawVal); break;
            case 'weap_radius': holdTarget.weapRadius = parseNum(rawVal); break;
            case 'draw_hand': holdTarget.drawHand = parseBool(rawVal); break;
            case 'animate': holdTarget.animate = parseBool(rawVal); break;
            case 'anim_speed': holdTarget.animSpeed = parseNum(rawVal); break;
            case 'zplane': holdTarget.zplane = parseNum(rawVal); break;
            case 'useSpriteSystem': holdTarget.useSpriteSystem = parseBool(rawVal); break;
            case 'subSpriteNumber': holdTarget.subSpriteNumber = parseNum(rawVal); break;
            case 'subSpriteFiring': holdTarget.subSpriteFiring = parseNum(rawVal); break;
            case 'numSpritesInSheet': holdTarget.numSpritesInSheet = parseNum(rawVal); break;
            case 'FSprite': {
              const key = rawVal.replace(/->Index$/i, '').trim();
              const sheet = spriteVars.get(key) ?? spriteVars.get(rawVal.trim());
              if (sheet) holdTarget.firingSheetName = sheet;
              break;
            }
          }
        }
        const flightTarget = flightVars.get(varName);
        if (flightTarget) {
          switch (field) {
            case 'animate': flightTarget.animate = parseBool(rawVal); break;
            case 'anim_speed': flightTarget.animSpeed = parseNum(rawVal); break;
            case 'ZPlane': flightTarget.zplane = parseNum(rawVal); break;
            case 'scale': flightTarget.scale = parseNum(rawVal); break;
            case 'hideWorm': flightTarget.hideWorm = parseBool(rawVal); break;
            case 'rotation': flightTarget.rotation = parseNum(rawVal); break;
            case 'dont_rotate_by_speed': flightTarget.dontRotateBySpeed = parseBool(rawVal); break;
            case 'animate_by_speed': flightTarget.animateBySpeed = parseBool(rawVal); break;
            case 'play_backwards': flightTarget.playBackwards = parseBool(rawVal); break;
            case 'ang_if_dont_rotate': flightTarget.angIfDontRotate = parseNum(rawVal); break;
            case 'useSpriteSystem': flightTarget.useSpriteSystem = parseBool(rawVal); break;
            case 'subSpriteNumber': flightTarget.subSpriteNumber = parseNum(rawVal); break;
            case 'numSpritesInSheet': flightTarget.numSpritesInSheet = parseNum(rawVal); break;
          }
        }
      }

      // `new WormSprite(weapName, sprite, Params)`
      const wormSpriteCall = stmt.match(
        /new\s+WormSprite\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*(\w+)\s*\)/,
      );
      if (wormSpriteCall) {
        const paramVar = wormSpriteCall[3];
        if (holdVars.has(paramVar)) {
          emitHold(paramVar, wormSpriteCall[2].trim(), wormSpriteCall[1].trim());
        } else if (lastHoldVar) {
          emitHold(lastHoldVar, wormSpriteCall[2].trim(), wormSpriteCall[1].trim());
        }
      }

      // `new WeapSprite(this, sprite, Params)` or `ApplyWeapSpriteParams(sprite, Params)`
      const weapSpriteCall = stmt.match(
        /new\s+WeapSprite\s*\(\s*[^,]+?\s*,\s*([^,]+?)\s*,\s*(\w+)\s*\)/,
      );
      if (weapSpriteCall) {
        const paramVar = weapSpriteCall[2];
        if (flightVars.has(paramVar)) {
          emitFlight(paramVar, weapSpriteCall[1].trim());
        } else if (lastFlightVar) {
          emitFlight(lastFlightVar, weapSpriteCall[1].trim());
        }
      }
      const applyWsCall = stmt.match(
        /ApplyWeapSpriteParams\s*\(\s*([^,]+?)\s*,\s*(\w+)\s*\)/,
      );
      if (applyWsCall) {
        const paramVar = applyWsCall[2];
        if (flightVars.has(paramVar)) {
          emitFlight(paramVar, applyWsCall[1].trim());
        } else if (lastFlightVar) {
          emitFlight(lastFlightVar, applyWsCall[1].trim());
        }
      }

      // `SetCustomAnim(speed)` / `SetSpriteMultiplex(num, sub)` from `red_sprite_builder`
      const customAnimCall = stmt.match(/SetCustomAnim\s*\(\s*([^)]+?)\s*\)/);
      if (customAnimCall) {
        const speed = parseNum(customAnimCall[1]);
        if (speed !== undefined) {
          flightParams.push({
            weaponName: currentWeapon,
            animate: true,
            animSpeed: speed,
          });
        }
      }
      const multiplexCall = stmt.match(/SetSpriteMultiplex\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (multiplexCall) {
        flightParams.push({
          weaponName: currentWeapon,
          useSpriteSystem: true,
          numSpritesInSheet: Number(multiplexCall[1]),
          subSpriteNumber: Number(multiplexCall[2]),
        });
      }

      // `SetSpriteOverride(259, explosivea_tr)`
      const overrideCall = stmt.match(/SetSpriteOverride\s*\(\s*(\d+)\s*,\s*([^)]+?)\s*\)/);
      if (overrideCall) {
        const spriteId = Number(overrideCall[1]);
        const varKey = overrideCall[2].replace(/->Index$/i, '').trim();
        const fileName = spriteVars.get(varKey);
        if (Number.isFinite(spriteId) && fileName && !spriteOverrides.has(spriteId)) {
          spriteOverrides.set(spriteId, fileName);
        }
      }
    }

    for (const [varName, p] of holdVars) {
      if (!emittedHoldVars.has(varName) && hasHoldFields(p)) emitHold(varName);
    }
    for (const [varName, p] of flightVars) {
      if (!emittedFlightVars.has(varName) && hasFlightFields(p)) emitFlight(varName);
    }
  }

  return { frameCounts, frameCountsRaw, holdParams, flightParams, sounds, requires, spriteOverrides };
}
