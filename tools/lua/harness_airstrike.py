"""Run `wfws_airstrike.lua` against a deterministic fake `wa` in Lua 5.5 (`lupa`).

Verifies entry modes, cursor-side direction, 7 drop/strafe patterns, 5-phase
speed ramps (additive, multiplicative, hover recovery, dive altitude), discrete
ballistic lead,
multi-part hull + `on.hit` destruction, `strafe` missile steering/fuse/trail/
casings/quad draw, object-pool-full resilience, `release.phases` mixed drop +
strafe, `0`/`false` preservation, bounded lifetimes, and replay determinism.

    python -m pip install lupa
    python tools/lua/harness_airstrike.py        # exits 1 on a failure
"""
import math
import os
import sys

from lupa import LuaRuntime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SDK = os.path.join(
    ROOT, "spec", "lua_sdk", "wfws_sdk", "lib", "wfws_airstrike.lua"
).replace("\\", "/")

lua = LuaRuntime(unpack_returned_tuples=True)

# ---------------------------------------------------------------- fake wa ----
STATE = {
    "frame": 0,
    "map_w": 1920,
    "map_h": 696,
    "gravity": 0.24,
    "wind": 0.0,
    "water": 650,
    "draw_fraction": 0.25,
    "rng_seed": 424242,
    "next_actor_id": 1,
    "next_missile_id": 0xF0000000,
    "pool_fail_calls": set(),   # 1-based launch attempt indices that fail
    "pool_always_full": False,
    "crate_weapon_fail": False,
    "los_blocked_ids": set(),
    "colliding_circles": [],   # list of (x, y, radius) solid terrain blobs
    "blast_reentry_aid": None, # actor id synchronously hit when wa.world.blast runs
    "blasts": [],
    "launch_attempt": 0,
}

EVENTS = []
LAUNCHES = []
MINES = []
CRATES = []
FIRES = []
BULLETS = []
SOUNDS = []
QUADS = []
TRAIL_ADDS = []
TRAIL_DROPS = []
EXPLODES = []
ACTORS = {}      # actor_id -> dict
MISSILES = {}    # missile_id -> dict
WORMS = []       # list of dict

HOOKS = {
    "missile_frame": [],
    "draw": [],
    "turn_end": [],
}


def rng_next():
    STATE["rng_seed"] = (1664525 * STATE["rng_seed"] + 1013904223) % 0x100000000
    return STATE["rng_seed"]


def wa_random(lo=None, hi=None):
    v = rng_next() / 4294967296.0
    if lo is None:
        return v
    if hi is None:
        n = int(lo)
        return int(v * n) + 1
    a = int(lo)
    b = int(hi)
    if b < a:
        a, b = b, a
    return a + int(v * (b - a + 1))


def py_reset(seed=424242, map_w=1920, water=650, gravity=0.24):
    STATE["frame"] = 0
    STATE["map_w"] = map_w
    STATE["map_h"] = 696
    STATE["gravity"] = gravity
    STATE["wind"] = 0.0
    STATE["water"] = water
    STATE["draw_fraction"] = 0.25
    STATE["rng_seed"] = seed
    STATE["next_actor_id"] = 1
    STATE["next_missile_id"] = 0xF0000000
    STATE["pool_fail_calls"] = set()
    STATE["pool_always_full"] = False
    STATE["crate_weapon_fail"] = False
    STATE["los_blocked_ids"] = set()
    STATE["colliding_circles"] = []
    STATE["blast_reentry_aid"] = None
    STATE["blasts"] = []
    STATE["launch_attempt"] = 0
    EVENTS.clear()
    LAUNCHES.clear()
    MINES.clear()
    CRATES.clear()
    FIRES.clear()
    BULLETS.clear()
    SOUNDS.clear()
    QUADS.clear()
    TRAIL_ADDS.clear()
    TRAIL_DROPS.clear()
    EXPLODES.clear()
    ACTORS.clear()
    MISSILES.clear()
    WORMS.clear()


def py_sorted(t):
    keys = [k for k in t.keys()]

    def key_fn(k):
        if isinstance(k, (int, float)) and not isinstance(k, bool):
            return (0, float(k), "")
        return (1, 0.0, str(k))

    keys.sort(key=key_fn)
    out = lua.table()
    for idx, k in enumerate(keys, start=1):
        out[idx] = k
    return out


def py_copy_tbl(t):
    if t is None:
        return None
    out = {}
    for k in t.keys():
        v = t[k]
        if hasattr(v, "keys"):
            out[k] = py_copy_tbl(v)
        else:
            out[k] = v
    return out


def py_land_trace(x0, y0, x1, y1):
    # Return hit table if any blocked target sits near endpoint (x1, y1)
    for w in WORMS:
        if w["id"] in STATE["los_blocked_ids"]:
            if abs(x1 - w["x"]) < 3 and abs(y1 - w["y"]) < 3:
                return lua.table_from({"x": (x0 + x1) / 2, "y": (y0 + y1) / 2})
    return None


def py_world_collides(spec):
    cx = float(spec["x"])
    cy = float(spec["y"])
    cr = float(spec["radius"] if spec["radius"] is not None else 0)
    for sx, sy, sr in STATE["colliding_circles"]:
        if math.hypot(cx - sx, cy - sy) <= cr + sr:
            return True
    return False


def py_land_solid(px, py):
    for sx, sy, sr in STATE["colliding_circles"]:
        if math.hypot(float(px) - sx, float(py) - sy) <= sr:
            return True
    return False


def py_world_blast(spec):
    rec = {
        "frame": STATE["frame"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "damage": int(spec["damage"] or 0),
        "radius": float(spec["radius"] or 0),
        "kind": spec["kind"],
    }
    STATE["blasts"].append(rec)
    EVENTS.append(("blast", STATE["frame"], rec["damage"]))
    aid = STATE["blast_reentry_aid"]
    if aid and aid in ACTORS and not ACTORS[aid]["dead"]:
        h = ACTORS[aid]["handle"]
        fn = h["_on_hit"]
        if fn is not None:
            fn(h, lua.table_from({"kind": "blast", "damage": rec["damage"], "x": rec["x"], "y": rec["y"]}))


def py_worms_all():
    res = lua.table()
    for idx, w in enumerate(WORMS, start=1):
        res[idx] = lua.table_from({
            "id": w["id"],
            "kind": "worm",
            "x": w["x"],
            "y": w["y"],
            "hp": w["hp"],
            "facing": w["facing"],
        })
    return res


def py_register_missile_frame(fn):
    HOOKS["missile_frame"].append(fn)


def py_register_draw(fn):
    HOOKS["draw"].append(fn)


def py_register_turn_end(fn):
    HOOKS["turn_end"].append(fn)


def py_launch(spec):
    STATE["launch_attempt"] += 1
    attempt = STATE["launch_attempt"]
    if STATE["pool_always_full"] or attempt in STATE["pool_fail_calls"]:
        raise RuntimeError("weapons.launch: WA's object pool is full")

    mid = STATE["next_missile_id"]
    STATE["next_missile_id"] += 1
    m_spec = py_copy_tbl(spec["missile"])
    c_spec = py_copy_tbl(spec["clusters"])
    entry = {
        "attempt": attempt,
        "id": mid,
        "frame": STATE["frame"],
        "weapon": spec["weapon"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "vx": float(spec["vx"] if spec["vx"] is not None else 0),
        "vy": float(spec["vy"] if spec["vy"] is not None else 0),
        "missile": m_spec,
        "clusters": c_spec,
    }
    LAUNCHES.append(entry)
    EVENTS.append(("launch", STATE["frame"], mid, round(entry["x"], 4), round(entry["y"], 4)))
    MISSILES[mid] = {
        "id": mid,
        "weapon": spec["weapon"],
        "x": entry["x"],
        "y": entry["y"],
        "vx": entry["vx"],
        "vy": entry["vy"],
        "sprite": 48,
        "dead": False,
        "fuse": m_spec.get("fuse") if m_spec else None,
        "born": STATE["frame"],
    }
    return mid


def py_mines_spawn(spec):
    rec = {
        "frame": STATE["frame"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "vx": float(spec["vx"]),
        "vy": float(spec["vy"]),
        "fuse": int(spec["fuse"]),
        "damage": int(spec["damage"]),
        "radius": int(spec["radius"]),
        "dud_proof": bool(spec["dud_proof"]),
    }
    MINES.append(rec)
    EVENTS.append(("mine", STATE["frame"], round(rec["x"], 4), round(rec["y"], 4)))
    return lua.table_from(rec)


def py_crates_spawn(spec):
    kind = spec["kind"]
    if STATE["crate_weapon_fail"] and kind != "health":
        raise RuntimeError("crates.spawn: weapon deck empty")
    rec = {
        "frame": STATE["frame"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "kind": kind,
        "health": int(spec["health"]),
        "drop": spec["drop"],
        "contents": spec["contents"],
    }
    CRATES.append(rec)
    EVENTS.append(("crate", STATE["frame"], kind, round(rec["x"], 4), round(rec["y"], 4)))
    return lua.table_from(rec)


def py_fire_spawn(spec):
    rec = {
        "frame": STATE["frame"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "vx": float(spec["vx"]),
        "vy": float(spec["vy"]),
        "count": int(spec["count"]),
        "duration": int(spec["duration"]),
        "damage": int(spec["damage"]),
    }
    FIRES.append(rec)
    EVENTS.append(("fire", STATE["frame"], round(rec["x"], 4), round(rec["y"], 4)))
    return len(FIRES)


def py_fire_bullet(spec):
    rec = {
        "frame": STATE["frame"],
        "weapon": spec["weapon"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "dx": float(spec["dx"]),
        "dy": float(spec["dy"]),
        "damage": spec["damage"],
        "push_pct": spec["push_pct"],
    }
    BULLETS.append(rec)
    EVENTS.append(("bullet", STATE["frame"], round(rec["x"], 4), round(rec["dx"], 4)))


def py_sound_play(target, snd):
    rec = (STATE["frame"], str(snd))
    SOUNDS.append(rec)
    EVENTS.append(("sound", STATE["frame"], str(snd)))


def py_draw_quad(spec):
    pts = [(float(spec["points"][i][1]), float(spec["points"][i][2])) for i in range(1, 5)]
    rec = {
        "frame": STATE["frame"],
        "sprite": spec["sprite"],
        "cell": spec["frame"],
        "depth": spec["depth"],
        "color": spec["color"],
        "points": pts,
    }
    QUADS.append(rec)


def py_trail_add(mid, owner, opts):
    TRAIL_ADDS.append((STATE["frame"], mid))


def py_trail_drop(mid):
    TRAIL_DROPS.append((STATE["frame"], mid))


def py_record_actor_spawn(aid, spec_tbl, handle_tbl):
    if spec_tbl["collide"] is not None:
        raise ValueError(f"API 5 actors.spawn rejects legacy collide={spec_tbl['collide']!r}")
    if spec_tbl["as_object"] is not None:
        raise ValueError(f"API 5 actors.spawn rejects legacy as_object={spec_tbl['as_object']!r}")
    grav_raw = spec_tbl["gravity"]
    if isinstance(grav_raw, bool):
        raise ValueError(f"API 5 actors.spawn requires numeric gravity factor, got bool {grav_raw!r}")
    body_tbl = spec_tbl["body"]
    layer = body_tbl["layer"] if body_tbl is not None else None
    ACTORS[aid] = {
        "id": aid,
        "handle": handle_tbl,
        "sprite": spec_tbl["sprite"],
        "gravity": float(grav_raw) if grav_raw is not None else 0.0,
        "collide": body_tbl is not None,
        "as_object": layer == "object",
        "dead": False,
        "frames_set": [],
        "gfx_set": [],
    }
    EVENTS.append(("spawn_actor", STATE["frame"], aid, str(spec_tbl["sprite"])))


def py_record_actor_despawn(aid):
    if aid in ACTORS:
        ACTORS[aid]["dead"] = True
    EVENTS.append(("despawn_actor", STATE["frame"], aid))


def py_record_actor_explode(aid, spec):
    EXPLODES.append((STATE["frame"], aid, spec["damage"] if spec else 0))
    EVENTS.append(("explode_actor", STATE["frame"], aid))


def py_record_actor_frame(aid, idx):
    if aid in ACTORS:
        ACTORS[aid]["frames_set"].append(idx)


def py_record_actor_gfx(aid, spec):
    if aid in ACTORS:
        ACTORS[aid]["gfx_set"].append((spec["angle"], spec["scale"], spec["depth"]))


def py_alloc_actor_id():
    aid = STATE["next_actor_id"]
    STATE["next_actor_id"] += 1
    return aid


_PY = {
    "frame": lambda: STATE["frame"],
    "size": lambda: lua.table_from({"w": STATE["map_w"], "h": STATE["map_h"]}),
    "gravity": lambda: STATE["gravity"],
    "wind": lambda: STATE["wind"],
    "water": lambda: STATE["water"],
    "draw_fraction": lambda: STATE["draw_fraction"],
    "random": wa_random,
    "sorted": py_sorted,
    "sin": math.sin,
    "cos": math.cos,
    "atan": math.atan2,
    "land_trace": py_land_trace,
    "world_collides": py_world_collides,
    "land_solid": py_land_solid,
    "world_blast": py_world_blast,
    "worms_all": py_worms_all,
    "reg_missile_frame": py_register_missile_frame,
    "reg_draw": py_register_draw,
    "reg_turn_end": py_register_turn_end,
    "launch": py_launch,
    "mines_spawn": py_mines_spawn,
    "crates_spawn": py_crates_spawn,
    "fire_spawn": py_fire_spawn,
    "fire_bullet": py_fire_bullet,
    "sound_play": py_sound_play,
    "draw_quad": py_draw_quad,
    "trail_add": py_trail_add,
    "trail_drop": py_trail_drop,
    "alloc_actor_id": py_alloc_actor_id,
    "on_actor_spawn": py_record_actor_spawn,
    "on_actor_despawn": py_record_actor_despawn,
    "on_actor_explode": py_record_actor_explode,
    "on_actor_frame": py_record_actor_frame,
    "on_actor_gfx": py_record_actor_gfx,
}
lua.globals()._py = lua.table_from(_PY)

# Build the ergonomic `wa` table + package.loaded["wf-lib/effects/trail"] shim in Lua.
lua.execute("""
local TRAIL_SHIM = {
  add = function(id, owner, opts) _py.trail_add(id, owner, opts) end,
  drop = function(id) _py.trail_drop(id) end,
}

local function make_actor(spec)
  local aid = _py.alloc_actor_id()
  local on_spec = spec.on
  local frame_fn = nil
  local hit_fn = nil
  if type(on_spec) == "function" then
    frame_fn = on_spec
  elseif type(on_spec) == "table" then
    frame_fn = on_spec.frame
    hit_fn = on_spec.hit
  end
  local a = {
    id = aid,
    x = spec.x or 0,
    y = spec.y or 0,
    vx = spec.vx or 0,
    vy = spec.vy or 0,
    facing = 1,
    dead = false,
    _on_frame = frame_fn,
    _on_hit = hit_fn,
  }
  function a:frame(idx)
    _py.on_actor_frame(self.id, idx)
  end
  function a:gfx(g)
    _py.on_actor_gfx(self.id, g)
  end
  function a:explode(e)
    _py.on_actor_explode(self.id, e)
  end
  function a:remove()
    if not self.dead then
      self.dead = true
      _py.on_actor_despawn(self.id)
    end
  end
  _py.on_actor_spawn(aid, spec, a)
  return a
end

wa = {
  world = {
    frame = function() return _py.frame() end,
    size = function() return _py.size() end,
    gravity = function() return _py.gravity() end,
    wind = function() return _py.wind() end,
    water = function() return _py.water() end,
    collides = function(s) return _py.world_collides(s) end,
    blast = function(s) _py.world_blast(s) end,
  },
  math = {
    sin = function(v) return _py.sin(v) end,
    cos = function(v) return _py.cos(v) end,
    atan = function(y, x)
      if x == nil then return _py.atan(y, 1) end
      return _py.atan(y, x)
    end,
  },
  random = function(a, b) return _py.random(a, b) end,
  sorted = function(t) return _py.sorted(t) end,
  depth = { BEHIND_TERRAIN = 0x10000, OBJECTS = 0x20000 },
  sprites = { key = function(s) return s end },
  land = {
    trace = function(x0, y0, x1, y1) return _py.land_trace(x0, y0, x1, y1) end,
    solid = function(x, y) return _py.land_solid(x, y) end,
  },
  worms = { all = function() return _py.worms_all() end },
  mines = { spawn = function(s) return _py.mines_spawn(s) end },
  crates = { spawn = function(s) return _py.crates_spawn(s) end },
  fire = { spawn = function(s) return _py.fire_spawn(s) end },
  actors = { spawn = make_actor },
  weapons = {
    launch = function(s) return _py.launch(s) end,
    fire_bullet = function(s) return _py.fire_bullet(s) end,
  },
  sound = { play = function(t, s) _py.sound_play(t, s) end },
  draw = {
    quad = function(s) _py.draw_quad(s) end,
    fraction = function() return _py.draw_fraction() end,
  },
  on = {
    missile_frame = function(fn) _py.reg_missile_frame(fn) end,
    draw = function(fn) _py.reg_draw(fn) end,
    turn_end = function(fn) _py.reg_turn_end(fn) end,
  },
}

function _step_actors_and_missiles(missile_table, max_missile_age)
  -- Step alive missiles (pre -> integrate -> post), pruning dead ones when past max_missile_age
  -- Actors are stepped by their frame callbacks
end

function _call_draw()
  -- helper driven from Python
end

function _make_trail_lib() return TRAIL_SHIM end
function _make_worm(id, x, y, facing)
  local w = { id = id, kind = "worm", x = x, y = y, hp = 100, facing = facing, _ammo = {} }
  function w:ammo(weapon, n)
    if n == nil then
      return self._ammo[weapon]
    end
    local cur = self._ammo[weapon] or 0
    if type(n) == "table" and n.set ~= nil then
      self._ammo[weapon] = n.set
    elseif type(n) == "number" then
      self._ammo[weapon] = cur + n
    end
    return self._ammo[weapon]
  end
  return w
end
""")

air = lua.execute(f'return dofile("{SDK}")')


def step_tick(max_missile_age=None):
    STATE["frame"] += 1
    now = STATE["frame"]

    # Step active actors in ascending id order
    for aid in sorted(list(ACTORS.keys())):
        a = ACTORS.get(aid)
        if not a or a["dead"]:
            continue
        h = a["handle"]
        fn = h["_on_frame"]
        if fn is not None:
            fn(h)

    # Step active missiles (`pre` -> simple integration -> `post`)
    for mid in sorted(list(MISSILES.keys())):
        m = MISSILES.get(mid)
        if not m or m["dead"]:
            continue
        if max_missile_age is not None and (now - m["born"]) >= max_missile_age:
            m["dead"] = True
            continue
        m_tbl = lua.table_from({
            "id": mid,
            "weapon": m["weapon"],
            "x": m["x"],
            "y": m["y"],
            "vx": m["vx"],
            "vy": m["vy"],
            "sprite": m["sprite"],
            "phase": "pre",
        })
        for fn in HOOKS["missile_frame"]:
            fn(m_tbl)
        m["sprite"] = m_tbl["sprite"]
        m["vx"] = float(m_tbl["vx"])
        m["vy"] = float(m_tbl["vy"])
        m["x"] += m["vx"]
        m["y"] += m["vy"]
        m_tbl["x"] = m["x"]
        m_tbl["y"] = m["y"]
        m_tbl["phase"] = "post"
        for fn in HOOKS["missile_frame"]:
            fn(m_tbl)


def run_draw():
    for fn in HOOKS["draw"]:
        fn()


def fire_turn_end():
    for fn in HOOKS["turn_end"]:
        fn()


def step_until_done(handle, max_ticks=600, max_missile_age=None):
    trace = []
    for _ in range(max_ticks):
        inst = handle.active()
        if inst is None or inst["done"]:
            break
        trace.append((STATE["frame"], inst["phase"], float(inst["x"]), float(inst["vx"]), int(inst["released"])))
        step_tick(max_missile_age=max_missile_age)
    return trace


# ---------------------------------------------------------------- assertions --
failures = []


def check(name, cond, detail=""):
    tag = "ok  " if cond else "FAIL"
    print(f"{tag}  {name}" + ("" if cond or not detail else f"  ({detail})"))
    if not cond:
        failures.append(f"{name}: {detail}" if detail else name)


def simulate_ballistic_x(x0, y0, vx0, vy0, target_y, gravity, gravity_pct=100):
    g = gravity * gravity_pct / 100.0
    x, y, vy = x0, y0, vy0
    for _ in range(3000):
        if y >= target_y:
            break
        vy = vy + g
        x += vx0
        y += vy
    return x


def to_lua(v):
    if isinstance(v, dict):
        return lua.table_from({k: to_lua(val) for k, val in v.items()})
    if isinstance(v, (list, tuple)):
        return lua.table_from({idx + 1: to_lua(val) for idx, val in enumerate(v)})
    return v


# ---- Case 1: Sequential Air Strike (+vx & -vx), Ballistic Lead, is_main / is_bit ----
for dir_sign, ev_vx in [(1, 1), (-1, -1)]:
    py_reset(map_w=1920, gravity=0.24)
    w_id = "test.air.seq_" + ("r" if dir_sign > 0 else "l")
    ctx = to_lua({"id": w_id})
    h = air.install(ctx, to_lua({
        "entry": {"mode": "offmap", "y": -208, "side": 16},
        "plane": {"sprite": "airjetg", "facing_flip": True, "exit_margin": 32, "sound_enter": 52, "sound_loop": None},
        "speed": {"cruise": 16},
        "release": {"mode": "drop", "pattern": "sequential", "count": 5, "cadence_unit": "distance", "spacing": 32, "lead": True},
        "payload": {"kind": "missile", "inherit_vx": 1, "vx": 1, "vy": 0},
    }))
    worm = lua.eval(f"_make_worm(1, 500, 400, {dir_sign})")
    inst = h.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": ev_vx, "vy": 0, "weapon": w_id}))
    trace = step_until_done(h, max_ticks=300)
    hull = ACTORS[1]
    expected_facing = -dir_sign
    expected_start = -16 if dir_sign > 0 else 1936
    landings = [simulate_ballistic_x(l["x"], l["y"], l["vx"], l["vy"], 400, 0.24) for l in LAUNCHES]
    center_landing = landings[2] if len(landings) == 5 else None
    all_dead = all(a["dead"] for a in ACTORS.values())

    label = "+vx" if dir_sign > 0 else "-vx"
    check(f"case 1 ({label}): spawns at off-map edge with facing -dir",
          abs(trace[0][2] - expected_start) < 1e-6 and hull["handle"]["facing"] == expected_facing,
          f"start={trace[0][2]} vs {expected_start}, facing={hull['handle']['facing']}")
    check(f"case 1 ({label}): launches 5 bombs with 32px spacing and accurate lead on click x=960",
          len(LAUNCHES) == 5 and center_landing is not None and abs(center_landing - 960.0) < 0.01 and
          all(abs((LAUNCHES[i + 1]["x"] - LAUNCHES[i]["x"]) - 32 * dir_sign) < 0.01 for i in range(4)),
          f"xs={[round(l['x'], 2) for l in LAUNCHES]}, center_land={center_landing}")
    check(f"case 1 ({label}): plays plane sound_enter=52 once and despawns cleanly",
          len(SOUNDS) == 1 and SOUNDS[0][1] == "52" and all_dead and h.active() is None,
          f"sounds={SOUNDS}, dead={all_dead}")

    if dir_sign > 0:
        first_mid = LAUNCHES[0]["id"]
        fake_bit = lua.table_from({"id": 0xF0009999})
        check("case 1: air.is_main / air.is_bit distinguish launched rounds vs cluster bits",
              bool(air.is_main(first_mid)) and not bool(air.is_bit(lua.table_from({"id": first_mid}))) and bool(air.is_bit(fake_bit)),
              f"is_main={air.is_main(first_mid)}, is_bit(main)={air.is_bit(lua.table_from({'id': first_mid}))}")


# ---- Case 1b: cursor_side uses the click's half, not vx/default ----
for label, click_x, default_dir, expected_dir in [
    ("left half", 400, -1, 1),
    ("right half", 1500, 1, -1),
]:
    py_reset(map_w=1920)
    w_id = "test.air.cursor_" + label.replace(" ", "_")
    ctx = to_lua({"id": w_id})
    h = air.install(ctx, to_lua({
        "direction": "cursor_side",
        "default_dir": default_dir,
        "entry": {"mode": "offmap", "y": -208, "side": 16},
        "plane": {"sprite": "airjetg", "facing_flip": True, "exit_margin": 32},
        "speed": {"cruise": 16},
        "release": {"mode": "drop", "pattern": "sequential", "count": 2, "cadence_unit": "distance", "spacing": 32, "lead": False},
        "payload": {"kind": "missile", "inherit_vx": 0, "vx": 0, "vy": 0},
    }))
    worm = lua.eval("_make_worm(1, 500, 400, 1)")
    h.strike(to_lua({"worm": worm, "x": click_x, "y": 400, "sky": -208, "vx": 1, "vy": 0, "weapon": w_id}))
    trace = step_until_done(h, max_ticks=200)
    hull = ACTORS[1]
    expected_start = -16 if expected_dir > 0 else 1936
    expected_facing = -expected_dir
    check(f"case 1b ({label}): click side picks dir={expected_dir} over vx=1/default={default_dir}",
          abs(trace[0][2] - expected_start) < 1e-6 and hull["handle"]["facing"] == expected_facing,
          f"start={trace[0][2]}, facing={hull['handle']['facing']}")

# ---- Case 2: All 7 Release Patterns ----
pattern_specs = [
    ("sequential", {"pattern": "sequential", "count": 4, "cadence_unit": "distance", "spacing": 32}),
    ("burst", {"pattern": "burst", "count": 5, "burst_size": 5}),
    ("ripple", {"pattern": "ripple", "count": 5, "per_tick": 2, "frames_between": 3}),
    ("pairs", {"pattern": "pairs", "count": 4, "spacing": 32, "frames_between": 2}),
    ("carpet", {"pattern": "carpet", "count": 5, "cadence_unit": "distance", "window": 200}),
    ("random_window", {"pattern": "random_window", "count": 4, "cadence_unit": "distance", "window": 120}),
    ("offsets", {"pattern": "offsets", "count": 3, "cadence_unit": "distance", "offsets": [-64, 0, 96]}),
]
for pat_name, rel_patch in pattern_specs:
    py_reset(seed=7777, map_w=1920)
    w_id = f"test.pat.{pat_name}"
    h = air.install(to_lua({"id": w_id}), to_lua({
        "entry": {"mode": "offmap", "y": -200, "side": 16},
        "speed": {"cruise": 20},
        "release": {"mode": "drop", "lead": False, **rel_patch},
        "payload": {"kind": "missile", "inherit_vx": 0, "vx": 0, "vy": 0, "spread_vx": 0.5},
    }))
    worm = lua.eval("_make_worm(1, 300, 400, 1)")
    h.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -200, "vx": 1, "weapon": w_id}))
    step_until_done(h, max_ticks=300)
    frames = [l["frame"] for l in LAUNCHES]
    xs = [round(l["x"], 3) for l in LAUNCHES]
    ok_pat = False
    if pat_name == "sequential":
        ok_pat = len(LAUNCHES) == 4 and [round(xs[i+1] - xs[i], 3) for i in range(3)] == [32.0, 32.0, 32.0]
    elif pat_name == "burst":
        ok_pat = len(LAUNCHES) == 5 and len(set(frames)) == 1 and all(x == 960.0 for x in xs)
    elif pat_name == "ripple":
        ok_pat = len(LAUNCHES) == 5 and frames[0] == frames[1] and frames[2] == frames[3] and frames[2] - frames[0] == 4 and frames[4] - frames[2] == 4
    elif pat_name == "pairs":
        ok_pat = len(LAUNCHES) == 4 and frames[0] == frames[1] and frames[2] == frames[3] and frames[2] > frames[0] and xs[1] - xs[0] == 16.0
    elif pat_name == "carpet":
        ok_pat = xs == [860.0, 910.0, 960.0, 1010.0, 1060.0]
    elif pat_name == "random_window":
        ok_pat = len(LAUNCHES) == 4 and all(900.0 <= x <= 1020.0 for x in xs) and xs == sorted(xs)
    elif pat_name == "offsets":
        ok_pat = xs == [896.0, 960.0, 1056.0]
    check(f"case 2: pattern={pat_name}", ok_pat, f"frames={frames}, xs={xs}")


# ---- Case 3: 5-Phase Speed Machine (additive + multiplicative hover + dive altitude) ----
py_reset(map_w=1920)
w_spd = "test.speed.add"
h_add = air.install(to_lua({"id": w_spd}), to_lua({
    "entry": {"mode": "offmap", "y": -200, "side": 20},
    "speed": {
        "cruise": 20, "release": 6, "min": 4, "exit": 20,
        "decel": 3.5, "accel": 2.0, "recover_mode": "ramp",
        "recover_delay": 3, "slow_distance": 120,
        "altitude_mode": "dive", "dive_vy": 2, "max_y": -100,
    },
    "release": {"mode": "drop", "pattern": "sequential", "count": 4, "cadence_unit": "distance", "spacing": 24, "lead": False},
}))
worm = lua.eval("_make_worm(1, 200, 400, 1)")
h_add.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -200, "vx": 1, "weapon": w_spd}))
trace_add = step_until_done(h_add, max_ticks=300)
phases_seen = []
for row in trace_add:
    if not phases_seen or phases_seen[-1] != row[1]:
        phases_seen.append(row[1])
vxs_release = [r[3] for r in trace_add if r[1] == "release"]
dive_ys = [a["y"] for a in LAUNCHES]
check("case 3a: 5-phase additive ramp executes approach->slow->release->recover->exit and dive altitude",
      phases_seen == ["approach", "slow", "release", "recover", "exit"] and
      min(vxs_release) >= 6.0 and len(LAUNCHES) == 4 and max(dive_ys) > -200,
      f"phases={phases_seen}, release_vx={vxs_release[:4]}, launch_ys={dive_ys}")

# Multiplicative damping + min=0 hover recovery
py_reset(map_w=1920)
w_mul = "test.speed.mul"
h_mul = air.install(to_lua({"id": w_mul}), to_lua({
    "entry": {"mode": "offmap", "y": -200, "side": 20},
    "plane": {"timeout_frames": 300},
    "speed": {
        "cruise": 15, "min": 0, "exit": 15,
        "damping": 0.9, "release_damping": 0.5,
        "growth": 1.5, "recover_min": 0.5, "recover_mode": "ramp",
        "slow_distance": 60,
    },
    "release": {"mode": "drop", "pattern": "sequential", "count": 3, "cadence_unit": "frames", "frames_between": 3, "windup": 5, "lead": False},
}))
h_mul.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -200, "vx": 1, "weapon": w_mul}))
trace_mul = step_until_done(h_mul, max_ticks=350)
mul_phases = []
for row in trace_mul:
    if not mul_phases or mul_phases[-1] != row[1]:
        mul_phases.append(row[1])
rec_vxs = [r[3] for r in trace_mul if r[1] == "recover"]
check("case 3b: multiplicative damping/growth recovers from near-zero speed to exit cleanly",
      len(LAUNCHES) == 3 and "recover" in mul_phases and "exit" in mul_phases and
      len(rec_vxs) >= 2 and rec_vxs[-1] > rec_vxs[0] and ACTORS[1]["dead"],
      f"phases={mul_phases}, rec_vx={[round(v, 3) for v in rec_vxs[:5]]}")


# ---- Case 4: Strafe Gunship (Attack Helicopter shape + parts + fuse + trail + casings + draw + hit) ----
py_reset(map_w=1920, water=650)
WORMS.append({"id": 2, "x": 1000, "y": 420, "hp": 100, "facing": -1})
WORMS.append({"id": 3, "x": 950, "y": 410, "hp": 100, "facing": 1})
STATE["los_blocked_ids"].add(3)  # worm 3 behind terrain; LoS must prefer visible worm 2 or fallback cleanly
trail_shim = lua.eval("_make_trail_lib()")
w_heli = "test.air.heli"
h_heli = air.install(to_lua({"id": w_heli}), to_lua({
    "mode": "strafe",
    "trail_lib": trail_shim,
    "entry": {"mode": "offmap", "y": -288, "side": 500},
    "plane": {
        "sprite": "sprites/heli/empty.png",
        "frames": 2, "fps": 50,
        "collide": True, "as_object": True, "dead_damage": 25,
        "boom_damage": 80, "boom_kind": 100, "boom_fires": 3,
        "sound_loop": "sounds/heli/loop.wav", "sound_loop_ticks": 47,
        "parts": [
            {"name": "aim", "sprite": "sprites/heli/aim.png", "ox": 3, "oy": 6, "aim_sync": True, "frames": 32},
            {"name": "gun", "sprite": "sprites/heli/gun.png", "ox": 5, "oy": 12, "track_gun": True, "firing_frames": True, "frames": 2},
        ],
    },
    "speed": {
        "cruise": 15, "min": 0.05, "exit": 15,
        "engage_range": 450, "damping": 0.984, "release_damping": 0.984, "growth": 1.082, "recover_min": 0.15,
    },
    "release": {
        "mode": "strafe", "count": 6, "cadence_unit": "frames", "frames_between": 4, "windup": 40,
        "sound_variants": ["sounds/heli/hks1.wav", "sounds/heli/hks2.wav"],
        "sound_cooldown": 4,
    },
    "strafe": {
        "muzzle_x": 5, "muzzle_y": 12, "muzzle_length": 22,
        "aim_turn": 0.75, "target_seek": True, "target_box": {"rx": 130, "up": 70, "down": 80},
        "bullet_speed": 35, "steer_frames": 3, "max_fuse_ms": 3000, "exit_margin_frames": 3,
        "art_sheet": "sprites/bullet.png", "art_half": 16, "art_frames": 1,
        "trail": {"every": 1, "r": 255, "g": 30, "b": 10},
        "casing": {"sheet": "sprites/heli/casing.png", "frames": 16, "life": 10, "speed_min": 200, "speed_max": 300},
    },
}))
h_heli.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_heli}))

# Step until 4 shots have fired, running draw on active frames and expiring early shots to trigger trail.drop
for _ in range(140):
    step_tick(max_missile_age=5)
    run_draw()
    if len(LAUNCHES) >= 4:
        break

# Continue 5 more frames so missile age expires and FIFO casings prune, then simulate fatal hit on hull
for _ in range(10):
    step_tick(max_missile_age=5)
    run_draw()

hull_hit = ACTORS[1]["handle"]["_on_hit"]
hull_hit(ACTORS[1]["handle"], lua.table_from({"kind": "hit", "damage": 40}))

shot_frames = [l["frame"] for l in LAUNCHES]
fuses_valid = all(l["missile"]["fuse"] is not None and l["missile"]["fuse"] <= 3000 and l["missile"]["fuse"] % 20 == 0 for l in LAUNCHES)
hull_zero_init = all(l["vx"] == 0 and l["vy"] == 0 for l in LAUNCHES)
parts_despawned = all(ACTORS[i]["dead"] for i in (1, 2, 3))
shot_sounds = [s for s in SOUNDS if "hks" in s[1]]
loop_sounds = [s for s in SOUNDS if "loop.wav" in s[1]]

check("case 4a: strafe fires after windup=40 at frames_between=4 cadence with distance fuse & trail.add",
      len(LAUNCHES) >= 4 and len(TRAIL_ADDS) == len(LAUNCHES) and fuses_valid and hull_zero_init and
      all(shot_frames[i+1] - shot_frames[i] == 5 for i in range(len(shot_frames) - 1)),
      f"shot_frames={shot_frames}, trails={len(TRAIL_ADDS)}")
check("case 4b: missile_frame steered missiles, draw emitted quads & casings, and pruned stale shots with trail.drop",
      any(m["sprite"] == 0 for m in MISSILES.values()) and len(QUADS) > 0 and len(TRAIL_DROPS) > 0,
      f"quads={len(QUADS)}, drops={len(TRAIL_DROPS)}")
check("case 4c: throttled release/loop sounds and fatal hull hit spawns boom + fires + despawns hull+aim+gun",
      len(shot_sounds) >= 2 and len(loop_sounds) >= 2 and len(FIRES) == 3 and len(EXPLODES) == 1 and parts_despawned,
      f"sounds={len(SOUNDS)}, fires={len(FIRES)}, explodes={len(EXPLODES)}, parts_dead={parts_despawned}")


# ---- Case 5: Object-Pool-Full Resilience ----
py_reset(map_w=1920)
STATE["pool_fail_calls"] = {2, 3}
w_pool = "test.air.pool"
h_pool = air.install(to_lua({"id": w_pool}), to_lua({
    "trail_lib": trail_shim,
    "entry": {"mode": "above", "y": -200},
    "speed": {"cruise": 16},
    "release": {"mode": "strafe", "count": 5, "cadence_unit": "frames", "frames_between": 2, "windup": 0, "max_pool_retries": 10},
    "strafe": {"bullet_speed": 30, "steer_frames": 0, "trail": {"every": 1}},
}))
h_pool.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_pool}))
step_until_done(h_pool, max_ticks=300)
check("case 5a: temporary pool-full failures retry without losing launch count or leaking trail.add",
      len(LAUNCHES) == 5 and len(TRAIL_ADDS) == 5 and STATE["launch_attempt"] == 7 and ACTORS[1]["dead"],
      f"launches={len(LAUNCHES)}, attempts={STATE['launch_attempt']}, trails={len(TRAIL_ADDS)}")

# Permanent pool-full exits cleanly instead of stalling forever
py_reset(map_w=1920)
STATE["pool_always_full"] = True
h_pool.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_pool}))
step_until_done(h_pool, max_ticks=300)
check("case 5b: permanent pool-full respects max_pool_retries and exits cleanly",
      len(LAUNCHES) == 0 and len(TRAIL_ADDS) == 0 and ACTORS[1]["dead"] and h_pool.active() is None,
      f"dead={ACTORS[1]['dead']}, attempts={STATE['launch_attempt']}")


# ---- Case 6: Direct Click Modes (`above`, `payload`), All 6 Payload Kinds, and Mixed Phases ----
# 6a. Above-click immediate release
py_reset(map_w=1920)
w_abv = "test.air.above"
h_abv = air.install(to_lua({"id": w_abv}), to_lua({
    "entry": {"mode": "above", "y": -128},
    "speed": {"cruise": 48},
    "release": {"mode": "drop", "pattern": "sequential", "count": 3, "cadence_unit": "frames", "frames_between": 0, "spacing": 48, "lead": False},
}))
h_abv.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_abv}))
step_until_done(h_abv, max_ticks=200)
check("case 6a: entry=above drops bomb 1 on first frame with zero off-map delay",
      len(LAUNCHES) == 3 and LAUNCHES[0]["frame"] == 1 and [l["x"] for l in LAUNCHES] == [912.0, 960.0, 1008.0],
      f"frames={[l['frame'] for l in LAUNCHES]}, xs={[l['x'] for l in LAUNCHES]}")

# 6b. Direct payload-only on cursor (instant, no actors) & sky (paced)
py_reset(map_w=1920)
w_dir = "test.air.direct_cursor"
h_dir = air.install(to_lua({"id": w_dir}), to_lua({
    "entry": {"mode": "payload", "spawn_at": "cursor"},
    "release": {"pattern": "offsets", "count": 3, "frames_between": 0, "offsets": [-50, 0, 50], "lead": False},
    "payload": {"kind": "crate", "crate": {"kind": "weapon", "health": 45, "drop": "chute"}},
}))
STATE["crate_weapon_fail"] = True
h_dir.strike(to_lua({"worm": worm, "x": 800, "y": 350, "sky": -208, "vx": 1, "weapon": w_dir}))
check("case 6b: payload-only spawns crates instantly at cursor Y with zero actors and health fallback on empty deck",
      len(ACTORS) == 0 and len(CRATES) == 3 and all(c["y"] == 350.0 and c["kind"] == "health" for c in CRATES) and
      [c["x"] for c in CRATES] == [750.0, 800.0, 850.0],
      f"actors={len(ACTORS)}, crates={CRATES}")

# 6c. Non-missile payloads: mine, actor, fire, bullet
for pkind, pconf in [
    ("mine", {"kind": "mine", "mine": {"fuse": 500, "damage": 65, "radius": 40, "dud_proof": True}}),
    ("actor", {"kind": "actor", "actor": {"sprite": False, "gravity": True}}),
    ("fire", {"kind": "fire", "fire": {"count": 5, "duration": 2000, "damage": 12}}),
    ("bullet", {"kind": "bullet", "bullet": {"weapon": "stock.shotgun", "damage": 33, "push_pct": 120}}),
]:
    py_reset(map_w=1920)
    wk = f"test.pay.{pkind}"
    hk = air.install(to_lua({"id": wk}), to_lua({
        "entry": {"mode": "payload", "spawn_at": "cursor"},
        "release": {"pattern": "burst", "count": 2, "frames_between": 0, "lead": False},
        "payload": pconf,
    }))
    hk.strike(to_lua({"worm": worm, "x": 700, "y": 300, "sky": -208, "vx": 1, "weapon": wk}))
    if pkind == "mine":
        ok_p = len(MINES) == 2 and MINES[0]["fuse"] == 500 and MINES[0]["dud_proof"] is True
    elif pkind == "actor":
        ok_p = len(ACTORS) == 2
    elif pkind == "fire":
        ok_p = len(FIRES) == 2 and FIRES[0]["damage"] == 12
    else:
        ok_p = len(BULLETS) == 2 and BULLETS[0]["damage"] == 33 and BULLETS[0]["weapon"] == "stock.shotgun"
    check(f"case 6c: payload.kind={pkind}", ok_p)

# 6d. Mixed release.phases: 2 drops then 3 strafe shots
py_reset(map_w=1920)
w_mix = "test.air.mixed"
h_mix = air.install(to_lua({"id": w_mix}), to_lua({
    "entry": {"mode": "above", "y": -200},
    "speed": {"cruise": 16},
    "release": {
        "lead": False,
        "phases": [
            {"mode": "drop", "pattern": "sequential", "count": 2, "cadence_unit": "distance", "spacing": 32},
            {"mode": "strafe", "count": 3, "frames_between": 2, "windup": 4},
        ],
    },
    "strafe": {"bullet_speed": 30, "steer_frames": 2, "max_fuse_ms": 2000},
}))
h_mix.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_mix}))
step_until_done(h_mix, max_ticks=300)
check("case 6d: release.phases executes 2 drops followed by windup + 3 strafe shots",
      len(LAUNCHES) == 5 and LAUNCHES[1]["vx"] != 0 and LAUNCHES[2]["vx"] == 0 and LAUNCHES[4]["frame"] > LAUNCHES[2]["frame"],
      f"frames={[l['frame'] for l in LAUNCHES]}, vxs={[l['vx'] for l in LAUNCHES]}")


# ---- Case 7: Timeout Despawn + turn_end Cleanup + Replay Determinism ----
py_reset(map_w=1920)
w_tmo = "test.air.timeout"
h_tmo = air.install(to_lua({"id": w_tmo}), to_lua({
    "entry": {"mode": "offmap", "y": -100, "side": 50},
    "plane": {"timeout_frames": 25},
    "speed": {"cruise": 0},
    "release": {"count": 1},
}))
h_tmo.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_tmo}))
step_until_done(h_tmo, max_ticks=100)
check("case 7a: stalled plane despawns cleanly at timeout_frames=25",
      STATE["frame"] == 25 and ACTORS[1]["dead"] and h_tmo.active() is None,
      f"frame={STATE['frame']}, dead={ACTORS[1]['dead']}")

# Cancel on turn_end
py_reset(map_w=1920)
w_te = "test.air.turnend"
h_te = air.install(to_lua({"id": w_te}), to_lua({
    "entry": {"mode": "offmap", "y": -200, "side": 100},
    "speed": {"cruise": 5},
    "release": {"count": 5},
}))
h_te.strike(to_lua({"worm": worm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_te}))
for _ in range(5):
    step_tick()
fire_turn_end()
check("case 7b: wa.on.turn_end cleanly cancels in-flight strike when stop_on_turn_end=true",
      ACTORS[1]["dead"] and h_te.active() is None)

# Replay determinism across twin runs
logs = []
for _ in range(2):
    py_reset(seed=999111, map_w=1920)
    w_det = "test.air.det"
    h_det = air.install(to_lua({"id": w_det}), to_lua({
        "entry": {"mode": "offmap", "y": -180, "side": 16},
        "speed": {"cruise": 14},
        "release": {"mode": "drop", "pattern": "random_window", "count": 5, "window": 140, "jitter_vx": 50, "lead": True},
    }))
    wrm = lua.eval("_make_worm(1, 300, 400, 1)")
    h_det.strike(to_lua({"worm": wrm, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_det}))
    step_until_done(h_det, max_ticks=300)
    logs.append(list(EVENTS))
check("case 7c: twin deterministic runs with same seed & world produce identical event logs",
      logs[0] == logs[1] and len(logs[0]) >= 7)


# ---- Case 8: Explicit `0` and `false` Preservation ----
py_reset(map_w=1920)
w_zero = "test.air.zeros"
h_zero = air.install(to_lua({"id": w_zero}), to_lua({
    "entry": {"mode": "above", "y": 0},
    "plane": {"facing_flip": False, "sound_loop": "sounds/hum.wav", "sound_loop_ticks": 0, "sound_enter": 0},
    "speed": {"cruise": 10, "min": 0},
    "release": {"pattern": "sequential", "count": 2, "cadence_unit": "frames", "frames_between": 0, "windup": 0, "lead": False},
    "payload": {"inherit_vx": 0, "vx": 0, "vy": 0},
}))
wrm0 = lua.eval("_make_worm(1, 300, 400, 1)")
h_zero.strike(to_lua({"worm": wrm0, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_zero}))
step_until_done(h_zero, max_ticks=200)
check("case 8: explicit 0 and false values are preserved without || fallback corruption",
      len(LAUNCHES) == 2 and LAUNCHES[0]["y"] == 0.0 and LAUNCHES[0]["vx"] == 0.0 and
      ACTORS[1]["handle"]["facing"] == 1 and
      SOUNDS == [(0, "0")] and all(s[1] != "sounds/hum.wav" for s in SOUNDS),
      f"launches={[(l['y'], l['vx']) for l in LAUNCHES]}, sounds={SOUNDS}, facing={ACTORS[1]['handle']['facing']}")


# ---- Case 9: Direct Drop Terrain Failsafe & Crash Dive Re-Entrancy Guard ----
# 9a. Direct cursor drop clicked inside solid terrain refuses, plays sound 120,
#     refunds finite ammo (+1) while leaving infinite ammo (-1) untouched.
py_reset(map_w=1920)
w_blk = "test.air.direct_blocked"
h_blk = air.install(to_lua({"id": w_blk}), to_lua({
    "entry": {"mode": "payload", "spawn_at": "cursor"},
    "release": {"mode": "drop", "pattern": "offsets", "count": 3, "frames_between": 0, "offsets": [-36, 0, 36], "lead": False},
    "payload": {"kind": "mine", "mine": {"fuse": 500, "arm": 0, "damage": 45, "radius": 52, "dud_proof": False}},
}))
STATE["colliding_circles"].append((400.0, 350.0, 12.0))
wrm_fin = lua.eval("_make_worm(1, 200, 400, 1)")
wrm_fin["ammo"](wrm_fin, w_blk, to_lua({"set": 2}))
res_blk = h_blk.strike(to_lua({"worm": wrm_fin, "x": 400, "y": 350, "sky": -208, "vx": 1, "weapon": w_blk}))
ammo_after_fin = wrm_fin["ammo"](wrm_fin, w_blk)

wrm_inf = lua.eval("_make_worm(2, 200, 400, 1)")
wrm_inf["ammo"](wrm_inf, w_blk, to_lua({"set": -1}))
h_blk.strike(to_lua({"worm": wrm_inf, "x": 400, "y": 350, "sky": -208, "vx": 1, "weapon": w_blk}))
ammo_after_inf = wrm_inf["ammo"](wrm_inf, w_blk)

check("case 9a: direct cursor drop inside solid terrain refuses spawn, plays sound 120, refunds finite ammo, keeps -1 infinite",
      res_blk is None and len(MINES) == 0 and len(ACTORS) == 0 and
      len(SOUNDS) == 2 and all(s[1] == "120" for s in SOUNDS) and
      ammo_after_fin == 3 and ammo_after_inf == -1,
      f"res={res_blk}, mines={len(MINES)}, sounds={SOUNDS}, ammo_fin={ammo_after_fin}, ammo_inf={ammo_after_inf}")

# 9b. Direct cursor drop with open center and one blocked side offset spawns open drops only
py_reset(map_w=1920)
w_part = "test.air.direct_partial"
h_part = air.install(to_lua({"id": w_part}), to_lua({
    "entry": {"mode": "payload", "spawn_at": "cursor"},
    "release": {"mode": "drop", "pattern": "offsets", "count": 3, "frames_between": 0, "offsets": [-36, 0, 36], "lead": False},
    "payload": {"kind": "mine", "mine": {"fuse": 500, "arm": 0, "damage": 45, "radius": 52, "dud_proof": False}},
}))
STATE["colliding_circles"].append((636.0, 350.0, 6.0))
wrm_open = lua.eval("_make_worm(1, 200, 400, 1)")
h_part.strike(to_lua({"worm": wrm_open, "x": 600, "y": 350, "sky": -208, "vx": 1, "weapon": w_part}))
check("case 9b: direct cursor drop skips blocked side offset cleanly and spawns open-air mines with 0 controller actors",
      len(ACTORS) == 0 and [m["x"] for m in MINES] == [564.0, 600.0] and h_part.active() is None,
      f"actors={len(ACTORS)}, mines={[m['x'] for m in MINES]}, active={h_part.active()}")

# 9c. Crash-dive boom_plane re-entrancy guard: synchronous blast -> hull on.hit executes once
py_reset(map_w=1920)
boom_fx_calls = []
done_calls = []
w_re = "test.air.boom_reentry"
h_re = air.install(to_lua({"id": w_re}), to_lua({
    "entry": {"mode": "offmap", "y": -200, "side": 50},
    "plane": {
        "enabled": True,
        "collide": True,
        "dead_damage": 25,
        "boom_mode": "custom",
        "boom_damage": 75,
        "boom_radius": 110,
        "boom_crater_radius": 55,
        "boom_fires": 2,
    },
    "speed": {"cruise": 10},
    "release": {"count": 1},
    "effects": {
        "on_plane_boom": lambda s: boom_fx_calls.append(1),
        "on_done": lambda s: done_calls.append(1),
    },
}))
wrm_re = lua.eval("_make_worm(1, 300, 400, 1)")
h_re.strike(to_lua({"worm": wrm_re, "x": 960, "y": 400, "sky": -208, "vx": 1, "weapon": w_re}))
STATE["blast_reentry_aid"] = 1
ACTORS[1]["handle"]["_on_hit"](ACTORS[1]["handle"], lua.table_from({"kind": "hit", "damage": 40}))
check("case 9c: boom_plane guards against synchronous blast -> hull on.hit recursion (all effects fire once)",
      len(STATE["blasts"]) == 1 and len(boom_fx_calls) == 1 and len(done_calls) == 1 and len(FIRES) == 2 and ACTORS[1]["dead"],
      f"blasts={len(STATE['blasts'])}, fx={len(boom_fx_calls)}, done={len(done_calls)}, fires={len(FIRES)}")

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("airstrike harness: all checks passed")
