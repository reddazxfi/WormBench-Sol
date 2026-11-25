"""Run `wfws_firing.lua` against a deterministic fake `wa` in Lua 5.5 (`lupa`).

Verifies `firing.launch`, `firing.actor`, `firing.sequence`, `firing.install_fuse`
/ `firing.fuse`, `firing.homing.lock` / `missile_frame`, and `firing.chain`
(`anim` / `anim_frame` / `anim_sheet` / `anim_left`), including `ev.power` (`0..1`)
scaling, `intervals_ms`, `live_aim`, `aim_clamp`, `NOT_FIRING` / `cancel_weapon`
interruption, and `M.cancel`.

    python -m pip install lupa
    python tools/lua/harness_firing.py        # exits 1 on a failure
"""
import math
import os
import sys

from lupa import LuaRuntime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SDK = os.path.join(
    ROOT, "spec", "lua_sdk", "wfws_sdk", "lib", "wfws_firing.lua"
).replace("\\", "/")

lua = LuaRuntime(unpack_returned_tuples=True)

STATE = {
    "frame": 0,
    "digit": None,
    "rng_seed": 13579,
    "next_actor_id": 1,
    "next_missile_id": 0xF0000000,
    "launch_always_fail": False,
}

LAUNCHES = []
ACTORS_SPAWNED = []
SOUNDS = []
LOGS = []
ACTORS = {}
MISSILES = {}
WORMS = []
BODIES = []
HITS = []
DOSES = []
CUTS = []
RIBBONS = []
QUADS = []
TRAILS = []
FIRES = []
TERRAIN_WALL_X = None

HOOKS = {
    "missile_frame": [],
    "worm_message": [],
    "draw": [],
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


def py_reset(seed=13579):
    global TERRAIN_WALL_X
    if "firing" in globals():
        seen_ids = set()
        for w in WORMS:
            if w["id"] is not None:
                seen_ids.add(int(w["id"]))
        for b in BODIES:
            if b["kind"] == "worm" and b["id"] is not None:
                seen_ids.add(int(b["id"]))
        for a in ACTORS_SPAWNED:
            if a.get("owner_id") is not None:
                seen_ids.add(a["owner_id"])
        for wid in seen_ids:
            firing.reset(wid)
    STATE["frame"] = 0
    STATE["digit"] = None
    STATE["rng_seed"] = seed
    STATE["next_actor_id"] = 1
    STATE["next_missile_id"] = 0xF0000000
    STATE["launch_always_fail"] = False
    TERRAIN_WALL_X = None
    LAUNCHES.clear()
    ACTORS_SPAWNED.clear()
    SOUNDS.clear()
    LOGS.clear()
    ACTORS.clear()
    MISSILES.clear()
    WORMS.clear()
    BODIES.clear()
    HITS.clear()
    DOSES.clear()
    CUTS.clear()
    RIBBONS.clear()
    QUADS.clear()
    TRAILS.clear()
    FIRES.clear()


def py_worms_all():
    src = WORMS if WORMS else [b for b in BODIES if b["kind"] == "worm"]
    return lua.table_from({i + 1: w for i, w in enumerate(src)})


def py_mines_all():
    src = [b for b in BODIES if b["kind"] == "mine"]
    return lua.table_from({i + 1: m for i, m in enumerate(src)})


def py_crates_all():
    src = [b for b in BODIES if b["kind"] == "crate"]
    return lua.table_from({i + 1: c for i, c in enumerate(src)})


def py_oil_all():
    src = [b for b in BODIES if b["kind"] == "oil"]
    return lua.table_from({i + 1: o for i, o in enumerate(src)})


def py_fire_spawn(spec):
    FIRES.append({
        "frame": STATE["frame"],
        "x": float(spec["x"] or 0),
        "y": float(spec["y"] or 0),
        "count": int(spec["count"] or 1),
        "damage": spec["damage"],
        "duration": spec["duration"],
        "up_power": spec["up_power"],
        "vy": spec["vy"],
    })


def py_launch(spec):
    if STATE["launch_always_fail"]:
        raise RuntimeError("weapons.launch: invalid record")
    mid = STATE["next_missile_id"]
    STATE["next_missile_id"] += 1
    missile_ov = spec["missile"]
    rec = {
        "id": mid,
        "frame": STATE["frame"],
        "weapon": spec["weapon"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "vx": float(spec["vx"]),
        "vy": float(spec["vy"]),
        "fuse": int(missile_ov["fuse"]) if missile_ov and missile_ov["fuse"] is not None else None,
        "explode_on_space": bool(missile_ov["explode_on_space"]) if missile_ov and missile_ov["explode_on_space"] is not None else False,
    }
    LAUNCHES.append(rec)
    MISSILES[mid] = dict(rec)
    return mid


def py_actor_spawn(spec, handle):
    if spec["collide"] is not None:
        raise ValueError(f"API 5 actors.spawn rejects legacy collide={spec['collide']!r}")
    if spec["as_object"] is not None:
        raise ValueError(f"API 5 actors.spawn rejects legacy as_object={spec['as_object']!r}")
    grav_raw = spec["gravity"]
    if isinstance(grav_raw, bool):
        raise ValueError(f"API 5 actors.spawn requires numeric gravity factor, got bool {grav_raw!r}")
    body_tbl = spec["body"]
    aid = STATE["next_actor_id"]
    STATE["next_actor_id"] += 1
    owner_tbl = spec["owner"]
    owner_id = int(owner_tbl["id"]) if owner_tbl is not None and owner_tbl["id"] is not None else None
    rec = {
        "id": aid,
        "handle": handle,
        "owner_id": owner_id,
        "frame": STATE["frame"],
        "x": float(spec["x"] or 0),
        "y": float(spec["y"] or 0),
        "vx": float(spec["vx"] or 0),
        "vy": float(spec["vy"] or 0),
        "sprite": spec["sprite"],
        "gravity": float(grav_raw) if grav_raw is not None else 0.0,
        "collide": body_tbl is not None,
        "persist": bool(spec["persist"]) if spec["persist"] is not None else False,
        "dead": False,
    }
    ACTORS[aid] = rec
    if spec["on"] is None or type(spec["on"]) != type(spec):
        # record non-ticker actors for actor-mode assertions
        pass
    ACTORS_SPAWNED.append(rec)
    return aid


def py_actor_despawn(aid):
    if aid in ACTORS:
        ACTORS[aid]["dead"] = True


def py_sound_play(target, sound, prio=None):
    SOUNDS.append((STATE["frame"], str(sound), int(prio) if prio is not None else 8))


def py_log(msg):
    LOGS.append(str(msg))


def py_reg_missile_frame(fn):
    HOOKS["missile_frame"].append(fn)


def py_reg_worm_message(fn, opts=None):
    HOOKS["worm_message"].append(fn)


def py_reg_draw(fn):
    HOOKS["draw"].append(fn)


def py_land_trace(x0, y0, x1, y1):
    if TERRAIN_WALL_X is None:
        return None
    dx = float(x1) - float(x0)
    dy = float(y1) - float(y0)
    if dx == 0:
        return None
    t = (TERRAIN_WALL_X - float(x0)) / dx
    if 0.0 <= t <= 1.0:
        return lua.table_from({
            "x": float(x0) + dx * t,
            "y": float(y0) + dy * t,
            "starts_solid": False,
        })
    return None


def py_land_cut(spec):
    CUTS.append({
        "frame": STATE["frame"],
        "x": float(spec["x"]),
        "y": float(spec["y"]),
        "shape": str(spec["shape"]),
        "radius": int(spec["radius"]) if spec["radius"] is not None else None,
        "facing": int(spec["facing"]) if spec["facing"] is not None else None,
        "angle": float(spec["angle"]) if spec["angle"] is not None else None,
    })


def py_world_trace(spec):
    x0 = float(spec["x0"])
    y0 = float(spec["y0"])
    x1 = float(spec["x1"])
    y1 = float(spec["y1"])
    rad = float(spec["radius"] or 0)
    dx = x1 - x0
    dy = y1 - y0
    seg_len = math.hypot(dx, dy)
    if seg_len <= 1e-6:
        return None
    ux, uy = dx / seg_len, dy / seg_len
    ignore_ids = set()
    ign = spec["ignore"]
    if ign is not None:
        for k in ign:
            item = ign[k]
            if item is not None and item["id"] is not None:
                ignore_ids.add(int(item["id"]))
    best_t = None
    best_obj = None
    best_xy = None
    if TERRAIN_WALL_X is not None and dx != 0:
        tt = (TERRAIN_WALL_X - x0) / dx
        if 0.0 <= tt <= 1.0:
            best_t = tt * seg_len
            best_obj = None
            best_xy = (x0 + dx * tt, y0 + dy * tt)
    for b in BODIES:
        if b["kind"] == "worm" and int(b["id"]) in ignore_ids:
            continue
        cx = float(b["x"]) - x0
        cy = float(b["y"]) - y0
        along = cx * ux + cy * uy
        if along < 0 or along > seg_len:
            continue
        perp = abs(cx * uy - cy * ux)
        br = 9.0 if b["kind"] == "worm" else 8.0
        if perp <= rad + br and (best_t is None or along < best_t):
            best_t = along
            best_obj = b
            best_xy = (x0 + ux * along, y0 + uy * along)
    if best_t is None:
        return lua.table_from({"hit": False})
    res = {"hit": True, "x": best_xy[0], "y": best_xy[1]}
    if best_obj is not None:
        res["obj"] = best_obj
    return lua.table_from(res)


def py_electrical_nearby(sx, sy, radius, _include_owner=False):
    out = []
    r = float(radius)
    for b in BODIES:
        if math.hypot(float(b["x"]) - float(sx), float(b["y"]) - float(sy)) <= r + 10.0:
            out.append(b)
    return lua.table_from({i + 1: item for i, item in enumerate(out)})


def py_record_hit(kind, bid, mode, amount, vx=None, vy=None, hit_kind=None, react=None):
    HITS.append({
        "frame": STATE["frame"],
        "body_kind": str(kind),
        "id": int(bid),
        "mode": str(mode),
        "amount": amount,
        "vx": vx,
        "vy": vy,
        "kind": hit_kind,
        "react": react,
    })


def py_record_poison(bid, dose):
    DOSES.append((int(bid), int(dose)))


def py_draw_ribbon(r):
    pts_tbl = r["points"]
    pts = []
    if pts_tbl is not None:
        idx = 1
        while True:
            p = pts_tbl[idx]
            if p is None:
                break
            pts.append({
                "x": float(p["x"] or 0),
                "y": float(p["y"] or 0),
                "width": float(p["width"] or 0),
                "u": float(p["u"] or 0),
            })
            idx += 1
    RIBBONS.append({
        "frame": STATE["frame"],
        "n": int(r["n"] or 0),
        "sprite": r["sprite"],
        "alpha": float(r["a"] or 0),
        "points": pts,
    })


def py_draw_quad(q):
    QUADS.append({
        "frame": STATE["frame"],
        "sprite": str(q["sprite"] or ""),
        "color": int(q["color"] or 0),
    })


def py_draw_trail(spec):
    rec = {"frame": STATE["frame"], "sprite": spec["sprite"], "pts": [], "dead": False}
    TRAILS.append(rec)
    idx = len(TRAILS) - 1
    return idx


def py_trail_push(idx, x, y):
    TRAILS[int(idx)]["pts"].append((float(x), float(y)))


def py_trail_remove(idx):
    TRAILS[int(idx)]["dead"] = True


def to_lua(v):
    if isinstance(v, dict):
        return lua.table_from({k: to_lua(val) for k, val in v.items()})
    if isinstance(v, (list, tuple)):
        return lua.table_from({idx + 1: to_lua(val) for idx, val in enumerate(v)})
    return v


_PY = {
    "frame": lambda: STATE["frame"],
    "keys": lambda: lua.table_from({"digit": STATE["digit"]}),
    "random": wa_random,
    "sin": math.sin,
    "cos": math.cos,
    "atan": math.atan2,
    "worms_all": py_worms_all,
    "record_poison": py_record_poison,
    "mines_all": py_mines_all,
    "crates_all": py_crates_all,
    "oil_all": py_oil_all,
    "fire_spawn": py_fire_spawn,
    "launch": py_launch,
    "actor_spawn": py_actor_spawn,
    "actor_despawn": py_actor_despawn,
    "sound_play": py_sound_play,
    "log": py_log,
    "reg_missile_frame": py_reg_missile_frame,
    "reg_worm_message": py_reg_worm_message,
    "reg_draw": py_reg_draw,
    "land_trace": py_land_trace,
    "land_cut": py_land_cut,
    "world_trace": py_world_trace,
    "electrical_nearby": py_electrical_nearby,
    "record_hit": py_record_hit,
    "draw_ribbon": py_draw_ribbon,
    "draw_quad": py_draw_quad,
    "draw_trail": py_draw_trail,
    "trail_push": py_trail_push,
    "trail_remove": py_trail_remove,
}
lua.globals()._py = lua.table_from(_PY)

lua.execute("""
local function make_actor(spec)
  local on_spec = spec.on
  local frame_fn = type(on_spec) == "function" and on_spec or (type(on_spec) == "table" and on_spec.frame or nil)
  local a = {
    x = spec.x or 0,
    y = spec.y or 0,
    vx = spec.vx or 0,
    vy = spec.vy or 0,
    dead = false,
    _on_frame = frame_fn,
  }
  a.id = _py.actor_spawn(spec, a)
  function a:remove()
    if not self.dead then
      self.dead = true
      _py.actor_despawn(self.id)
    end
  end
  return a
end

local function make_trail(spec)
  local idx = _py.draw_trail(spec)
  return {
    push = function(_, x, y) _py.trail_push(idx, x, y) end,
    remove = function(_) _py.trail_remove(idx) end,
  }
end

wa = {
  world = {
    frame = function() return _py.frame() end,
    keys = function() return _py.keys() end,
    trace = function(spec) return _py.world_trace(spec) end,
    electrical_nearby = function(sx, sy, r, inc) return _py.electrical_nearby(sx, sy, r, inc) end,
  },
  land = {
    trace = function(x0, y0, x1, y1) return _py.land_trace(x0, y0, x1, y1) end,
    cut = function(spec) _py.land_cut(spec) end,
  },
  depth = {
    behind_land = 0x2000,
    behind_worms = 0x4000,
    above_worms = 0x8000,
    top = 0x10000,
    FRONT = 0x10000,
  },
  draw = {
    ribbon = function(r) _py.draw_ribbon(r) end,
    quad = function(q) _py.draw_quad(q) end,
    trail = make_trail,
    random = function() return 0.5 end,
  },
  math = {
    sin = function(v) return _py.sin(v) end,
    cos = function(v) return _py.cos(v) end,
    atan = function(y, x) return x == nil and _py.atan(y, 1) or _py.atan(y, x) end,
  },
  random = function(a, b) return _py.random(a, b) end,
  worms = { all = function() return _py.worms_all() end },
  mines = { all = function() return _py.mines_all() end },
  crates = { all = function() return _py.crates_all() end },
  oil = { all = function() return _py.oil_all() end },
  fire = { spawn = function(s) _py.fire_spawn(s) end },
  actors = { spawn = make_actor },
  weapons = { launch = function(s) return _py.launch(s) end },
  sound = { play = function(t, s, p) _py.sound_play(t, s, p) end },
  log = function(m) _py.log(m) end,
  msg = { FRAME_FINISH = "FRAME_FINISH" },
  on = {
    missile_frame = function(fn) _py.reg_missile_frame(fn) end,
    worm_message = function(fn, opts) _py.reg_worm_message(fn, opts) end,
    draw = function(fn) _py.reg_draw(fn) end,
  },
}

function _make_worm(id, x, y, aim, facing, weapon)
  local w = {
    id = id,
    kind = "worm",
    x = x,
    y = y,
    aim = aim or 0.5,
    facing = facing or 1,
    hp = 100,
    turn = true,
    aiming = true,
    state = "ready",
    weapon = weapon or "test.wep",
    shots_fired = 0,
    shots_to_fire = 1,
    target = { x = x + 300, y = y },
  }
  function w:poison(dose)
    _py.record_poison(self.id, dose)
    return true
  end
  function w:hit(opts)
    assert(type(opts) == "table", "API 5 worm:hit requires table argument")
    if opts.react == false then
      assert(opts.kind == nil and opts.vx == nil and opts.vy == nil, "API 5 react=false refuses kind/vx/vy")
    end
    self.hp = math.max(0, self.hp - (opts.amount or 0))
    _py.record_hit("worm", self.id, "hit", opts.amount or 0, opts.vx, opts.vy, opts.kind, opts.react)
  end
  return w
end

function _make_body(kind, id, x, y)
  local b = { id = id, kind = kind, x = x, y = y }
  if kind == "mine" then
    function b:arm(ms)
      _py.record_hit("mine", self.id, "arm", ms, nil, nil, nil, nil)
    end
  else
    function b:hit(amount, vx, vy, hit_kind)
      _py.record_hit(self.kind, self.id, "obj_hit", amount, vx, vy, hit_kind, nil)
    end
  end
  return b
end
""")

firing = lua.execute(f'return dofile("{SDK}")')

failures = []


def check(name, cond, detail=""):
    if not cond:
        failures.append(f"{name}: {detail}" if detail else name)
    print(f"{'ok  ' if cond else 'FAIL'}  {name}{'' if cond or not detail else f'  ({detail})'}")


def step_tick():
    STATE["frame"] += 1
    for fn in HOOKS["worm_message"]:
        fn()
    for aid in sorted(list(ACTORS.keys())):
        a = ACTORS.get(aid)
        if not a or a["dead"]:
            continue
        fn = a["handle"]["_on_frame"]
        if fn is not None:
            fn(a["handle"])
    for mid in sorted(list(MISSILES.keys())):
        m = MISSILES[mid]
        m_tbl = lua.table_from({
            "id": mid,
            "x": m["x"],
            "y": m["y"],
            "vx": m["vx"],
            "vy": m["vy"],
            "phase": "pre",
        })
        for fn in HOOKS["missile_frame"]:
            fn(m_tbl)
        m["vx"] = float(m_tbl["vx"])
        m["vy"] = float(m_tbl["vy"])
        m["x"] += m["vx"]
        m["y"] += m["vy"]
        m_tbl["x"] = m["x"]
        m_tbl["y"] = m["y"]
        m_tbl["phase"] = "post"
        for fn in HOOKS["missile_frame"]:
            fn(m_tbl)
        m["vx"] = float(m_tbl["vx"])
        m["vy"] = float(m_tbl["vy"])


# ---- Case 1: firing.launch + ev.power (0..1) + multi-pellet + offset/standoff + sound ----
py_reset()
w = lua.eval('_make_worm(1, 100, 200, 0.5, 1, "test.gun")')
firing.launch(
    to_lua({"x": 100, "y": 200, "vx": 1, "vy": 0, "power": 0.5, "worm": w, "weapon": "test.gun"}),
    to_lua({
        "weapon": "test.gun",
        "speed": 20,
        "scale_by_power": True,
        "pellets": 3,
        "standoff": 10,
        "offset": {"x": 2, "y": -3},
        "sound": {"path": "sounds/shot.wav", "every": 1, "priority": 12},
    }),
)
firing.launch(
    to_lua({"x": 100, "y": 200, "vx": 1, "vy": 0, "power": 1.0, "worm": w, "weapon": "test.gun"}),
    to_lua({
        "weapon": "test.gun",
        "speed": 20,
        "scale_by_power": True,
        "pellets": 1,
        "sound": {"path": "sounds/shot.wav", "every": 2, "priority": 12},
    }),
)
firing.launch(
    to_lua({"x": 100, "y": 200, "vx": 1, "vy": 0, "power": 1.0, "worm": w, "weapon": "test.gun"}),
    to_lua({
        "weapon": "test.gun",
        "speed": 20,
        "scale_by_power": True,
        "pellets": 1,
        "sound": {"path": "sounds/shot.wav", "every": 2, "priority": 12},
    }),
)
check(
    "case 1a: scale_by_power multiplies speed by ev.power (0..1, not /100)",
    len(LAUNCHES) == 5 and abs(LAUNCHES[0]["vx"] - 10.0) < 1e-6 and abs(LAUNCHES[3]["vx"] - 20.0) < 1e-6,
    f"vxs={[round(l['vx'], 4) for l in LAUNCHES]}",
)
check(
    "case 1b: standoff + offset adjust launch coordinates and every-2 sound skips odd shot #3",
    abs(LAUNCHES[0]["x"] - 112.0) < 1e-6 and abs(LAUNCHES[0]["y"] - 197.0) < 1e-6 and len(SOUNDS) == 2 and SOUNDS[0][2] == 12,
    f"pos={(LAUNCHES[0]['x'], LAUNCHES[0]['y'])}, sounds={SOUNDS}",
)

# ---- Case 2: firing.actor with scale_by_power ----
py_reset()
w2 = lua.eval('_make_worm(2, 50, 80, 0.5, -1, "test.act")')
firing.actor(
    to_lua({"x": 50, "y": 80, "vx": 0, "vy": -1, "power": 0.25, "worm": w2}),
    to_lua({"speed": 16, "scale_by_power": True, "actor": {"sprite": "sprites/bolt.png", "gravity": True}}),
)
check(
    "case 2: firing.actor scales by ev.power and forwards actor table fields",
    len(ACTORS_SPAWNED) == 1 and abs(ACTORS_SPAWNED[0]["vy"] + 4.0) < 1e-6 and ACTORS_SPAWNED[0]["sprite"] == "sprites/bolt.png" and ACTORS_SPAWNED[0]["gravity"] == 1.0,
    f"spawned={ACTORS_SPAWNED[0] if ACTORS_SPAWNED else None}",
)

# ---- Case 3: firing.sequence (custom intervals_ms, live_aim false, drain, interruption, cancel) ----
py_reset()
w3 = lua.eval('_make_worm(3, 100, 100, 0.5, 1, "test.seq")')
WORMS.append(w3)
firing.sequence(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": w3, "weapon": "test.seq"}),
    to_lua({
        "weapon": "test.seq",
        "count": 3,
        "intervals_ms": [60, 40, 80],
        "speed": 12,
        "live_aim": False,
        "drain": 2,
    }),
)
# Aim changes after launch; live_aim = false must keep initial dx=1, dy=0
w3["aim"] = 1.0
for _ in range(15):
    step_tick()
check(
    "case 3a: sequence follows intervals_ms [60, 40, 80] (frames 3, 5, 9) with locked aim and clean ticker despawn",
    [l["frame"] for l in LAUNCHES] == [3, 5, 9] and all(abs(l["vx"] - 12.0) < 1e-6 and abs(l["vy"]) < 1e-6 for l in LAUNCHES) and all(a["dead"] for a in ACTORS.values()),
    f"frames={[l['frame'] for l in LAUNCHES]}, vy={[round(l['vy'], 3) for l in LAUNCHES]}",
)

# Interruption via weapon switch (`cancel_weapon`) & `M.cancel`
py_reset()
w3b = lua.eval('_make_worm(4, 100, 100, 0.5, 1, "test.seq2")')
firing.sequence(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": w3b, "weapon": "test.seq2"}),
    to_lua({"weapon": "test.seq2", "count": 5, "interval_ms": 40, "cancel_weapon": "test.seq2"}),
)
step_tick()
w3b["weapon"] = "stock.skip_go"
for _ in range(10):
    step_tick()
check(
    "case 3b: cancel_weapon stops remaining queued shots and settles worm",
    len(LAUNCHES) == 1 and w3b["shots_fired"] == w3b["shots_to_fire"],
    f"launches={len(LAUNCHES)}",
)

# ---- Case 4: firing.install_fuse & firing.fuse ----
py_reset()
w4 = lua.eval('_make_worm(5, 100, 100, 0.5, 1, "test.fuse")')
WORMS.append(w4)
firing.install_fuse(3000)
STATE["digit"] = 2
step_tick()
check(
    "case 4: install_fuse samples keys.digit into 2000 ms while record_ms > 0 takes precedence",
    firing.fuse(0, w4) == 2000 and firing.fuse(5000, w4) == 5000,
    f"sampled={firing.fuse(0, w4)}",
)

# ---- Case 5: firing.homing.lock + missile_frame ----
py_reset()
w5 = lua.eval('_make_worm(6, 0, 0, 0.5, 1, "test.hom")')
mid_h = firing.launch(
    to_lua({"x": 0, "y": 0, "vx": 1, "vy": 0, "worm": w5, "weapon": "test.hom"}),
    to_lua({
        "weapon": "test.hom",
        "speed": 4,
        "homing": {"enabled": True, "speed": 15, "turn": 0.5, "frames": 30, "delay": 0},
    }),
)
# Lock onto closer target within 50 px to trigger both pre (near) and post (step)
m_near = py_launch(to_lua({"weapon": "test.hom", "x": 10, "y": 0, "vx": 2, "vy": 0}))
firing.homing.lock(m_near, to_lua({"x": 40, "y": 0}), to_lua({"speed": 15, "turn": 0.5, "frames": 10, "delay": 0}))
step_tick()
check(
    "case 5: homing steers missile toward target and pre near-pin boosts speed to 15 within 50px",
    MISSILES[mid_h]["vx"] > 4.0 and abs(MISSILES[m_near]["vx"] - 15.0) < 1e-6,
    f"far_vx={MISSILES[mid_h]['vx']}, near_vx={MISSILES[m_near]['vx']}",
)

# ---- Case 6: firing.chain / anim / anim_frame / anim_sheet / anim_left ----
py_reset()
w6 = lua.eval('_make_worm(7, 0, 0, 0.5, 1, "test.anim")')
firing.chain(w6, to_lua({
    "weapon": "test.anim",
    "buffer": {"ticks": 2, "frames": 2, "fps": 50, "sheet": "buf.png"},
    "fire": {"ticks": 3, "frames": 3, "fps": 50, "sheet": "fir.png"},
    "after": {"ticks": 2, "frames": 2, "fps": 50, "sheet": "aft.png"},
}))
p0 = (firing.anim(w6), firing.anim_frame(w6), firing.anim_sheet(w6), firing.anim_left(w6))
step_tick()
step_tick()
p2 = (firing.anim(w6), firing.anim_frame(w6), firing.anim_sheet(w6))
for _ in range(3):
    step_tick()
p5 = (firing.anim(w6), firing.anim_sheet(w6))
for _ in range(2):
    step_tick()
p7 = (firing.anim(w6), firing.anim_left(w6))
check(
    "case 6: chain transitions cleanly across buffer -> fire -> after -> nil",
    p0 == ("buffer", 0, "buf.png", 2) and p2 == ("fire", 0, "fir.png") and p5 == ("after", "aft.png") and p7 == (None, 0),
    f"p0={p0}, p2={p2}, p5={p5}, p7={p7}",
)


def run_draw():
    for fn in HOOKS["draw"]:
        fn()


def expect_beam_err(name, ev_dict, spec_dict):
    try:
        firing.beam(to_lua(ev_dict), to_lua(spec_dict))
        check(name, False, "expected error but succeeded")
    except Exception as exc:
        check(name, True, str(exc))


# ---- Case 7: M.beam strict validation (unknown keys, burn constraints, trail constraints) ----
py_reset()
wb = lua.eval('_make_worm(10, 100, 100, 0.5, 1, "test.beam")')
ev_b = {"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": wb, "weapon": "test.beam"}
expect_beam_err("case 7a: unknown key rejected", ev_b, {"bogus_key": 123})
expect_beam_err("case 7b: invalid interact rejected", ev_b, {"interact": "explode"})
firing.beam(to_lua(ev_b), to_lua({"interact": "burn", "burn_push": 0.9, "push": 5, "kind": "fire"}))
check("case 7c: interact=burn accepts burn_push, final push, and kind", True)
# `look = "trail"` used to hand the beam to `wa.draw.trail`, a projectile trail
# whose width ramps with age and whose tail sheds points: a ray drawn that way
# looks like a round dragging a smear and cannot grow or retract, so it matched
# nothing the card's preview shows. It is the ribbon painter now, with the key
# still accepted, which is why branches and dissolve are allowed with it.
expect_beam_err("case 7d: look must still be 'ribbon' or 'trail'", ev_b, {"look": "arc"})
py_reset()
wb7 = lua.eval('_make_worm(11, 100, 100, 0.5, 1, "test.trail")')
ev_7 = to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": wb7, "weapon": "test.trail"})
rib_7 = {"reach": "instant", "hold": 4, "fade": 0, "path": "straight", "hits": "none",
         "core0": 20, "core1": 20, "glow0": 40, "glow1": 40, "range": 200}
firing.beam(ev_7, to_lua(dict(rib_7, look="ribbon",
                              sprite="sprites/trA/beam.png",
                              glow_sprite="sprites/trA/beam_glow.png")))
step_tick()
RIBBONS.clear()
run_draw()
as_ribbon = [r["sprite"] for r in RIBBONS if r["sprite"].startswith("sprites/trA/")]
py_reset()
wb7b = lua.eval('_make_worm(11, 100, 100, 0.5, 1, "test.trail2")')
firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": wb7b, "weapon": "test.trail2"}),
            to_lua(dict(rib_7, look="trail",
                        sprite="sprites/trB/beam.png",
                        glow_sprite="sprites/trB/beam_glow.png")))
step_tick()
RIBBONS.clear()
run_draw()
as_trail = [r["sprite"].replace("sprites/trB/", "sprites/trA/")
            for r in RIBBONS if r["sprite"].startswith("sprites/trB/")]
check(
    "case 7e: look='trail' draws the same ribbons as 'ribbon' (the preview's painter), not an engine trail",
    as_trail == as_ribbon and as_trail == ["sprites/trA/beam_glow.png", "sprites/trA/beam.png", "sprites/trA/beam.png"],
    f"ribbon={as_ribbon}, trail={as_trail}",
)

# ---- Case 8: Instant corridor hits worm + mine + crate, spares shooter, cuts terrain ----
py_reset()
TERRAIN_WALL_X = 320.0
shooter = lua.eval('_make_worm(11, 100, 100, 0.5, 1, "test.beam")')
target_w = lua.eval('_make_worm(12, 180, 104, 0.5, -1, "stock.bazooka")')
mine_m = lua.eval('_make_body("mine", 21, 240, 96)')
crate_c = lua.eval('_make_body("crate", 31, 280, 102)')
far_w = lua.eval('_make_worm(13, 380, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([shooter, target_w, mine_m, crate_c, far_w])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": shooter, "weapon": "test.beam"}),
    to_lua({
        "weapon": "test.beam",
        "reach": "instant",
        "hits": "corridor",
        "width": 14,
        "range": 500,
        "damage": 25,
        "push": 6,
        "poison": 7,
        "kind": "taze",
        "interact": "hit",
        "spare_shooter": True,
        "cut": 18,
        "hold": 4,
        "fade": 2,
        "sprite": "sprites/beam/beam.png",
        "glow_sprite": "sprites/beam/beam_glow.png",
    }),
)
step_tick()
run_draw()
hit_ids = [(h["body_kind"], h["id"], h["mode"], h["amount"]) for h in HITS]
check(
    "case 8a: corridor hits worm (hit), mine (arm 400), crate (obj_hit) and spares shooter + wall-occluded worm",
    ("worm", 12, "hit", 25) in hit_ids
    and ("mine", 21, "arm", 400) in hit_ids
    and ("crate", 31, "obj_hit", 25) in hit_ids
    and all(h["id"] not in (11, 13) for h in HITS),
    f"hits={hit_ids}",
)
check(
    "case 8c: beam poison doses the worm it hit, never a mine or crate",
    DOSES == [(12, 7)],
    f"doses={DOSES}",
)
check(
    "case 8b: terrain cut applied at wall x=320 and draw emitted ribbons",
    len(CUTS) == 1 and abs(CUTS[0]["x"] - 320.0) < 1e-3 and CUTS[0]["radius"] == 18 and len(RIBBONS) >= 1,
    f"cuts={CUTS}, ribbons={len(RIBBONS)}",
)

# ---- Case 9: Progressive cone beam advances head-gated hits & widens with distance ----
py_reset()
sh9 = lua.eval('_make_worm(40, 100, 100, 0.5, 1, "test.cone")')
near_w = lua.eval('_make_worm(41, 180, 105, 0.5, -1, "stock.bazooka")')
wide_far_w = lua.eval('_make_worm(42, 340, 150, 0.5, -1, "stock.bazooka")')   # perp=50 at along=240; half_w=4+240*tan(15deg)~68.3
outside_w = lua.eval('_make_worm(43, 180, 160, 0.5, -1, "stock.bazooka")')    # perp=60 at along=80; half_w=4+80*tan(15deg)~25.4
BODIES.extend([sh9, near_w, wide_far_w, outside_w])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh9, "weapon": "test.cone"}),
    to_lua({
        "weapon": "test.cone",
        "reach": "progressive",
        "grow": 10,
        "hold": 4,
        "fade": 2,
        "hits": "cone",
        "width0": 8,
        "cone_deg": 30,
        "range": 400,
        "stop_on_terrain": False,
        "damage": 15,
        "interact": "hit",
        "kind": "fire",
        "hit_cooldown": 0,
    }),
)
for _ in range(3):
    step_tick()
early_ids = {h["id"] for h in HITS}
for _ in range(10):
    step_tick()
final_ids = {h["id"] for h in HITS}
check(
    "case 9: progressive cone hits near target early, wide far target once head arrives, and misses out-of-cone target",
    41 in early_ids and 42 not in early_ids and 42 in final_ids and 43 not in final_ids,
    f"early={early_ids}, final={final_ids}",
)

# ---- Case 10: hit_cooldown throttles repeated hits (not 50 hits/sec) ----
py_reset()
sh10 = lua.eval('_make_worm(50, 100, 100, 0.5, 1, "test.cd")')
t10 = lua.eval('_make_worm(51, 200, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh10, t10])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh10, "weapon": "test.cd"}),
    to_lua({
        "weapon": "test.cd",
        "reach": "instant",
        "hold": 12,
        "fade": 2,
        "hits": "corridor",
        "width": 12,
        "range": 300,
        "stop_on_terrain": False,
        "damage": 5,
        "interact": "hit",
        "kind": "bullet",
        "hit_cooldown": 4,
    }),
)
for _ in range(12):
    step_tick()
hit_frames = [h["frame"] for h in HITS if h["id"] == 51]
gaps_ok = all(hit_frames[i] - hit_frames[i - 1] >= 4 for i in range(1, len(hit_frames)))
check(
    "case 10: hit_cooldown=4 throttles repeated hits to >=4-frame spacing over 12-frame hold",
    len(hit_frames) == 3 and gaps_ok,
    f"hit_frames={hit_frames}",
)

# ---- Case 11: buffer windup delays damage until buffer ticks elapse ----
py_reset()
sh11 = lua.eval('_make_worm(60, 100, 100, 0.5, 1, "test.buf")')
t11 = lua.eval('_make_worm(61, 200, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh11, t11])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh11, "weapon": "test.buf"}),
    to_lua({
        "weapon": "test.buf",
        "buffer": 5,
        "reach": "instant",
        "hold": 4,
        "fade": 2,
        "hits": "corridor",
        "width": 12,
        "range": 300,
        "stop_on_terrain": False,
        "damage": 20,
        "interact": "hit",
        "kind": "bullet",
        "charge_sound": {"path": "sounds/charge.wav", "priority": 10},
        "sound": {"path": "sounds/fire.wav", "priority": 10},
    }),
)
for _ in range(4):
    step_tick()
hits_during_buffer = len(HITS)
for _ in range(4):
    step_tick()
check(
    "case 11: buffer=5 plays charge_sound immediately and delays hit until after windup",
    hits_during_buffer == 0 and len(HITS) == 1 and any(s[1] == "sounds/charge.wav" for s in SOUNDS),
    f"during_buf={hits_during_buffer}, hits={len(HITS)}, sounds={SOUNDS}",
)

# ---- Case 12: first-hit swept trace + interact='burn' react=false ----
py_reset()
sh12 = lua.eval('_make_worm(70, 100, 100, 0.5, 1, "test.first")')
t12a = lua.eval('_make_worm(71, 200, 100, 0.5, -1, "stock.bazooka")')
t12b = lua.eval('_make_worm(72, 260, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh12, t12a, t12b])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh12, "weapon": "test.first"}),
    to_lua({
        "weapon": "test.first",
        "reach": "instant",
        "hold": 4,
        "fade": 2,
        "hits": "first",
        "width": 8,
        "range": 400,
        "damage": 30,
        "interact": "burn",
    }),
)
for _ in range(5):
    step_tick()
check(
    "case 12: hits='first' stops at first worm and interact='burn' calls worm:hit({amount, react=false})",
    len(HITS) == 1 and HITS[0]["id"] == 71 and HITS[0]["react"] is False and HITS[0]["kind"] is None,
    f"hits={HITS}",
)

# ---- Case 13: impact_sound (string + numeric ID) & on_before_hit runs BEFORE body:hit ----
py_reset()
order_log = []
sh13 = lua.eval('_make_worm(80, 100, 100, 0.5, 1, "test.imp")')
t13 = lua.eval('_make_worm(81, 180, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh13, t13])
orig_hit = t13["hit"]
def traced_hit(self_w, spec_tbl):
    order_log.append("hit")
    return orig_hit(self_w, spec_tbl)
t13["hit"] = traced_hit

lua.globals()["_log_before_13"] = lambda wid: order_log.append("before:" + str(wid))
on_before_13 = lua.eval("function(o) _log_before_13(o.id) end")
beam_spec_13 = to_lua({
    "weapon": "test.imp",
    "reach": "instant",
    "hold": 2,
    "fade": 1,
    "hits": "corridor",
    "width": 12,
    "range": 300,
    "stop_on_terrain": False,
    "damage": 20,
    "interact": "hit",
    "kind": "taze",
    "impact_sound": "sounds/test/beam_impact.wav",
})
beam_spec_13["on_before_hit"] = on_before_13

firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh13, "weapon": "test.imp"}),
    beam_spec_13,
)
step_tick()
check(
    "case 13a: string impact_sound plays on hit and on_before_hit fires strictly before body:hit",
    any(s[1] == "sounds/test/beam_impact.wav" for s in SOUNDS) and order_log == ["before:81", "hit"],
    f"sounds={SOUNDS}, order={order_log}",
)

py_reset()
sh13b = lua.eval('_make_worm(82, 100, 100, 0.5, 1, "test.imp_id")')
t13b = lua.eval('_make_worm(83, 180, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh13b, t13b])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh13b, "weapon": "test.imp_id"}),
    to_lua({
        "weapon": "test.imp_id",
        "reach": "instant",
        "hold": 2,
        "fade": 1,
        "hits": "corridor",
        "width": 12,
        "range": 300,
        "stop_on_terrain": False,
        "damage": 15,
        "impact_sound": 42,
    }),
)
step_tick()
check(
    "case 13b: numeric impact_sound id plays cleanly on hit",
    any(s[1] == "42" for s in SOUNDS),
    f"sounds={SOUNDS}",
)

# ---- Case 14: direct beam buffer re-fire guard + buffering orb + beam_buffer ----
py_reset()
buf_calls = 0
dis_calls = 0
lua.globals()["_buf_cb14"] = lambda *_: globals().__setitem__("buf_calls", buf_calls + 1)
lua.globals()["_dis_cb14"] = lambda *_: globals().__setitem__("dis_calls", dis_calls + 1)
sh14 = lua.eval('_make_worm(90, 100, 100, 0.5, 1, "test.buf")')
sh14["shots_fired"] = 0
sh14["shots_to_fire"] = 1
t14 = lua.eval('_make_worm(91, 200, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh14, t14])

spec14 = to_lua({
    "weapon": "test.buf",
    "reach": "instant",
    "buffer": 6,
    "hold": 3,
    "fade": 2,
    "look": "trail",
    "hits": "corridor",
    "width": 14,
    "range": 300,
    "damage": 25,
    "sprite": "sprites/test/beam.png",
    "glow_sprite": "sprites/test/beam_glow.png",
    "orb_sprite": "sprites/test/beam_orb.png",
})
spec14["on_buffer"] = lua.eval("function() _buf_cb14() end")
spec14["on_discharge"] = lua.eval("function() _dis_cb14() end")

# Frame 0: fire and simulate WA repeat-fire frames calling firing.beam again during buffer AND hold
firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14, "weapon": "test.buf"}), spec14)
QUADS.clear()
RIBBONS.clear()
held_during_buffer = True
held_during_hold = True
for i in range(9):
    if i in (1, 2, 3, 4, 6, 7):
        # Simulate WA re-triggering on_fire while shots_fired < shots_to_fire
        firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14, "weapon": "test.buf"}), spec14)
    if i == 2:
        run_draw()
    step_tick()
    # Ticks 1..5 (i=0..4) are buffer; ticks 6..8 (i=5..7) are hold; tick 9 (i=8) enters fade
    if i <= 4 and sh14["shots_fired"] != 0:
        held_during_buffer = False
    if 5 <= i <= 7 and sh14["shots_fired"] != 0:
        held_during_hold = False

check(
    "case 14a: buffered beam swallows repeat on_fire frames through buffer and hold, releasing shots_fired on fade",
    buf_calls == 1
    and dis_calls == 1
    and len(HITS) == 1
    and held_during_buffer
    and held_during_hold
    and sh14["shots_fired"] == 1,
    f"buf={buf_calls}, dis={dis_calls}, hits={HITS}, held_buf={held_during_buffer}, held_hold={held_during_hold}, shots_fired={sh14['shots_fired']}",
)
orb_quads_14b = [q for q in QUADS if q["sprite"] == "sprites/test/beam_orb.png"]
check(
    "case 14b: a look='trail' claim draws the ribbon painter's buffer halo, core and 6 spiraling mini-orb quads",
    len(orb_quads_14b) == 8,
    f"orb_quads={len(orb_quads_14b)}, quads={QUADS}",
)

py_reset()
sh14c = lua.eval('_make_worm(92, 100, 100, 0.5, 1, "test.seqbuf")')
firing.beam_buffer(sh14c, 5, to_lua({
    "weapon": "test.seqbuf",
    "range": 300,
    "core0": 24,
    "sprite": "sprites/test/beam.png",
    "glow_sprite": "sprites/test/beam_glow.png",
    "orb_sprite": "sprites/seqbuf/beam_orb.png",
}))
QUADS.clear()
step_tick()
run_draw()
orb_quads_14c = [q for q in QUADS if q["sprite"] == "sprites/seqbuf/beam_orb.png"]
check(
    "case 14c: firing.beam_buffer renders halo + core + 6 spiraling mini-orb quads for sequenced beams",
    len(orb_quads_14c) == 8,
    f"orb_quads={len(orb_quads_14c)}, quads={QUADS}",
)

# ---- Case 14d: cone/dissolve beam draws the preview's two passes, tip flare and impact rays ----
for _ in range(6):
    step_tick()
py_reset()
TERRAIN_WALL_X = 260
sh14d = lua.eval('_make_worm(93, 100, 100, 0.5, 1, "test.cone")')
t14d = lua.eval('_make_worm(94, 180, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh14d, t14d])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14d, "weapon": "test.cone"}),
    to_lua({
        "weapon": "test.cone",
        "reach": "instant",
        "hold": 4,
        "fade": 4,
        "dissipate": "dissolve",
        "look": "ribbon",
        "path": "straight",
        "hits": "cone",
        "core0": 12,
        "core1": 72,
        "glow0": 28,
        "glow1": 162,
        "range": 300,
        "damage": 20,
        "cut": 0,
        "sparks": True,
        "sprite": "sprites/cone/beam.png",
        "glow_sprite": "sprites/cone/beam_glow.png",
        "orb_sprite": "sprites/cone/beam_orb.png",
    }),
)
QUADS.clear()
RIBBONS.clear()
run_draw()
hold_ribbons_14d = list(RIBBONS)
hold_core_14d = [r for r in hold_ribbons_14d if r["sprite"] == "sprites/cone/beam.png" and len(r["points"]) > 2]
hold_sparks_14d = [r for r in hold_ribbons_14d if r["sprite"] == "sprites/cone/beam.png" and len(r["points"]) == 2]
hold_halo_14d = [r for r in hold_ribbons_14d if r["sprite"] == "sprites/cone/beam_glow.png"]
hold_quads_14d = [q for q in QUADS if q["sprite"] == "sprites/cone/beam_orb.png"]
hold_core_w = max((p.get("width", 0) for r in hold_core_14d for p in r["points"]), default=0)
hold_tip_w = max((r["points"] or [{}])[-1].get("width", 0) for r in hold_core_14d)
hold_tip_r = max((((r["points"] or [{}])[-1].get("color", 0) >> 16) & 0xFF) for r in hold_core_14d)
# Advance 6 ticks into dissolve wind-down (hold=4, fade=4 -> age=6 => end_k=0.5)
for _ in range(6):
    step_tick()
QUADS.clear()
RIBBONS.clear()
run_draw()
end_core_ribbons_14d = [r for r in RIBBONS if r["sprite"] == "sprites/cone/beam.png" and len(r["points"]) > 2]
end_tip_x = max((r["points"] or [{}])[-1].get("x", 0) for r in end_core_ribbons_14d) if end_core_ribbons_14d else 0
end_tip_w = max((r["points"] or [{}])[-1].get("width", 0) for r in end_core_ribbons_14d) if end_core_ribbons_14d else 0
check(
    "case 14d: ribbon beam draws 3-layer stack (tinted glow + colored core + white-hot filament) plus tip flare and 8 spark streaks, and narrows in place while dissolving",
    len(hold_core_14d) == 2  # colored core + white-hot inner filament
    and len(hold_halo_14d) == 1  # outer glow pass
    and len(hold_sparks_14d) == 8  # 8 crisp impact spark streaks
    and hold_core_w > 60  # the band still reaches nearly core1 before the ends taper
    and hold_tip_w <= 72 * 0.55  # the core narrows with its colour ramp at the ends
    and hold_tip_r < 24  # ... and fades to black there too, inside the band
    and len(hold_quads_14d) == 2  # tip flare: colour halo + white core
    and end_tip_x >= 250  # does not reverse back toward muzzle during dissolve
    and end_tip_w < hold_tip_w,  # narrows smoothly in-place
    f"core_ribbons={len(hold_core_14d)}, halo_ribbons={len(hold_halo_14d)}, sparks={len(hold_sparks_14d)}, tip_quads={len(hold_quads_14d)}, core_w={hold_core_w}, tip_w={hold_tip_w}, tip_r={hold_tip_r}, end_tip_x={end_tip_x}, end_tip_w={end_tip_w}",
)

# ---- Case 14e: impact rays also fire when the beam simply runs out of range ----
# A beam that stops in open air used to draw no spray at all (the old gate needed
# terrain or a body hit), which is the in-game half of "missing impact rays".
py_reset()
TERRAIN_WALL_X = None
sh14e = lua.eval('_make_worm(95, 100, 100, 0.5, 1, "test.openair")')
BODIES.append(sh14e)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14e, "weapon": "test.openair"}),
    to_lua({
        "weapon": "test.openair",
        "reach": "instant",
        "hold": 4,
        "fade": 2,
        "look": "ribbon",
        "path": "straight",
        "hits": "none",
        "core0": 20,
        "core1": 20,
        "glow0": 48,
        "glow1": 48,
        "range": 200,
        "sparks": True,
        "sprite": "sprites/open/beam.png",
        "glow_sprite": "sprites/open/beam_glow.png",
        "orb_sprite": "sprites/open/beam_orb.png",
    }),
)
QUADS.clear()
RIBBONS.clear()
step_tick()
run_draw()
rays_14e = [r for r in RIBBONS if r["sprite"] == "sprites/open/beam.png" and len(r["points"]) == 2]
orb_14e = [q for q in QUADS if q["sprite"] == "sprites/open/beam_orb.png"]
check(
    "case 14e: a beam that reaches its range in open air still draws its tip flare and 8 impact spark streaks",
    len(rays_14e) == 8 and len(orb_14e) == 2,
    f"spark_streaks={len(rays_14e)}, orb_quads={len(orb_14e)}",
)
py_reset()
TERRAIN_WALL_X = None
sh14f = lua.eval('_make_worm(96, 100, 100, 0.5, 1, "test.nospark")')
BODIES.append(sh14f)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14f, "weapon": "test.nospark"}),
    to_lua({
        "weapon": "test.nospark",
        "reach": "instant",
        "hold": 4,
        "fade": 2,
        "look": "ribbon",
        "path": "straight",
        "hits": "none",
        "core0": 20,
        "core1": 20,
        "glow0": 48,
        "glow1": 48,
        "range": 200,
        "sprite": "sprites/nospark/beam.png",
        "glow_sprite": "sprites/nospark/beam_glow.png",
        "orb_sprite": "sprites/nospark/beam_orb.png",
    }),
)
QUADS.clear()
RIBBONS.clear()
step_tick()
run_draw()
nospark_streaks_14f = [r for r in RIBBONS if r["sprite"] == "sprites/nospark/beam.png" and len(r["points"]) == 2]
nospark_quads_14f = [q for q in QUADS if q["sprite"] == "sprites/nospark/beam_orb.png"]
check(
    "case 14f: impact spark streaks are off without `sparks` (tip flare only)",
    len(nospark_streaks_14f) == 0 and len(nospark_quads_14f) == 2,
    f"spark_streaks={len(nospark_streaks_14f)}, orb_quads={len(nospark_quads_14f)}",
)


# ---- Case 14g: the endpoint sheet caps both ends of the glow band ----
py_reset()
TERRAIN_WALL_X = 260
sh14g = lua.eval('_make_worm(97, 100, 100, 0.5, 1, "test.caps")')
BODIES.append(sh14g)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14g, "weapon": "test.caps"}),
    to_lua({
        "weapon": "test.caps",
        "reach": "instant",
        "hold": 6,
        "fade": 0,
        "look": "ribbon",
        "path": "straight",
        "hits": "none",
        "core0": 20,
        "core1": 20,
        "glow0": 40,
        "glow1": 40,
        "range": 300,
        "points": 16,
        "sprite": "sprites/caps/beam.png",
        "glow_sprite": "sprites/caps/beam_glow.png",
        "end_sprite": "sprites/caps/beam_end.png",
        "orb_sprite": "sprites/caps/beam_orb.png",
    }),
)
QUADS.clear()
RIBBONS.clear()
step_tick()
run_draw()
caps_14g = [r for r in RIBBONS if r["sprite"] == "sprites/caps/beam_end.png"]
glow_14g = [r for r in RIBBONS if r["sprite"] == "sprites/caps/beam_glow.png"]
caps_ok = False
if len(caps_14g) == 2 and len(glow_14g) == 1:
    start_cap, end_cap = caps_14g[0]["points"], caps_14g[1]["points"]
    body = glow_14g[0]["points"]
    xs = [p["x"] for p in start_cap + end_cap]
    # The endpoint sheet is the band's own first and last piece, cap_len =
    # max(glow) * 0.6 = 24 px. The muzzle piece reads the sheet backwards (faded
    # side at the weapon's edge, bright side inward), the tip piece forwards, and
    # the glow body is shifted inward to make room. Nothing is drawn outside the
    # beam's own span, so nothing hangs over the worm or past the impact.
    caps_ok = (
        abs(start_cap[0]["x"] - 100.0) < 1.5
        and abs(start_cap[0]["u"] - 1.0) < 0.001
        and abs(start_cap[-1]["u"]) < 0.001
        and abs(start_cap[-1]["x"] - 124.0) < 4.0
        and abs(end_cap[0]["u"]) < 0.001
        and abs(end_cap[-1]["u"] - 1.0) < 0.001
        and abs(end_cap[0]["x"] - 236.0) < 4.0
        and abs(end_cap[-1]["x"] - 260.0) < 1.5
        and min(xs) >= 99.0
        and max(xs) <= 261.0
        and body[0]["x"] >= 99.0
        and body[-1]["x"] <= 261.0
        and abs(body[0]["x"] - 124.0) < 4.0
        and abs(body[-1]["x"] - 236.0) < 4.0
    )
check(
    "case 14g: the endpoint sheet is the band's first and last piece (faded side outward, bright side inward) with the glow body shifted inward for it, and nothing drawn outside the beam",
    caps_ok,
    f"caps={caps_14g}, body={body}",
)

py_reset()
TERRAIN_WALL_X = 260
sh14h = lua.eval('_make_worm(98, 100, 100, 0.5, 1, "test.nocaps")')
BODIES.append(sh14h)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14h, "weapon": "test.nocaps"}),
    to_lua({
        "weapon": "test.nocaps",
        "reach": "instant",
        "hold": 6,
        "fade": 0,
        "look": "ribbon",
        "path": "straight",
        "hits": "none",
        "core0": 20,
        "core1": 20,
        "glow0": 40,
        "glow1": 40,
        "range": 300,
        "points": 16,
        "sprite": "sprites/nocaps/beam.png",
        "glow_sprite": "sprites/nocaps/beam_glow.png",
    }),
)
QUADS.clear()
RIBBONS.clear()
step_tick()
run_draw()
nocaps_14h = [r["sprite"] for r in RIBBONS if r["sprite"].startswith("sprites/nocaps/")]
check(
    "case 14h: no end_sprite means the glow runs end to end (glow + colored core + white-hot core)",
    nocaps_14h == ["sprites/nocaps/beam_glow.png", "sprites/nocaps/beam.png", "sprites/nocaps/beam.png"],
    f"ribbons={nocaps_14h}",
)

# ---- Case 14i: a jagged bolt crackles deterministically at 25 Hz (every 2 ticks) ----
py_reset()
TERRAIN_WALL_X = None
sh14i = lua.eval('_make_worm(99, 100, 100, 0.5, 1, "test.jag")')
BODIES.append(sh14i)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14i, "weapon": "test.jag"}),
    to_lua({
        "weapon": "test.jag",
        "reach": "instant",
        "hold": 40,
        "fade": 0,
        "look": "ribbon",
        "path": "jagged",
        "noise": 12,
        "hits": "none",
        "core0": 20,
        "core1": 20,
        "glow0": 40,
        "glow1": 40,
        "range": 400,
        "points": 16,
        "sprite": "sprites/jag/beam.png",
        "glow_sprite": "sprites/jag/beam_glow.png",
    }),
)
QUADS.clear()
RIBBONS.clear()
step_tick()  # age=1 -> step 0
run_draw()
jag_core = [r for r in RIBBONS if r["sprite"] == "sprites/jag/beam.png"]
first_offsets = [round(p["y"] - 100.0, 4) for p in jag_core[0]["points"]] if jag_core else []
step_tick()  # age=2 -> step 1 (crackles to next deterministic shape)
RIBBONS.clear()
run_draw()
again = [r for r in RIBBONS if r["sprite"] == "sprites/jag/beam.png"]
second_offsets = [round(p["y"] - 100.0, 4) for p in again[0]["points"]] if again else []
step_tick()  # age=3 -> step 1 (holds same 25 Hz frame)
RIBBONS.clear()
run_draw()
third = [r for r in RIBBONS if r["sprite"] == "sprites/jag/beam.png"]
third_offsets = [round(p["y"] - 100.0, 4) for p in third[0]["points"]] if third else []
peak = max((abs(o) for o in first_offsets), default=0.0)
step_max = max(
    (abs(first_offsets[i + 1] - first_offsets[i]) for i in range(len(first_offsets) - 1)),
    default=0.0,
)
second = [
    abs(first_offsets[i + 1] - 2 * first_offsets[i] + first_offsets[i - 1])
    for i in range(1, len(first_offsets) - 1)
]
kink = max(second, default=0.0)
check(
    "case 14i: a jagged bolt crackles deterministically every 2 ticks (25 Hz) with organic bends pinned at both ends",
    len(first_offsets) == 48
    and first_offsets != second_offsets
    and second_offsets == third_offsets
    and abs(first_offsets[0]) < 1e-6
    and abs(first_offsets[-1]) < 1e-6
    and 4.0 < peak <= 12.0
    and step_max <= 12.0 * 0.6
    and kink >= 0.5,
    f"offsets={first_offsets}, again={second_offsets}, third={third_offsets}, peak={peak}, step_max={step_max}, kink={kink}",
)

# ---- Case 14j: the core's end taper is resolved, not a one-quad notch ----
# A 16-point ribbon is ~29 px between points on a long beam, so an end that
# faded over ~20 px used to go from a 4.5 px first point to full width at the
# second: a spike at the muzzle that read in game as the core zigzagging.
py_reset()
TERRAIN_WALL_X = None
sh14j = lua.eval('_make_worm(95, 100, 100, 0.5, 1, "test.taper")')
BODIES.append(sh14j)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14j, "weapon": "test.taper"}),
    to_lua({
        "weapon": "test.taper",
        "reach": "instant",
        "hold": 40,
        "fade": 0,
        "look": "ribbon",
        "path": "straight",
        "hits": "none",
        "core0": 28,
        "core1": 28,
        "glow0": 64,
        "glow1": 64,
        "range": 460,
        "points": 16,
        "sprite": "sprites/taper/beam.png",
        "glow_sprite": "sprites/taper/beam_glow.png",
    }),
)
QUADS.clear()
RIBBONS.clear()
step_tick()
run_draw()
taper_core = [r for r in RIBBONS if r["sprite"] == "sprites/taper/beam.png"]
taper_pts = taper_core[0]["points"] if taper_core else []
taper_w = [round(p["width"], 2) for p in taper_pts[:5]]
taper_steps = [taper_w[i + 1] - taper_w[i] for i in range(len(taper_w) - 1)]
check(
    "case 14j: the ribbon is drawn at 3x its path points and its ends taper over several of them, and the taper never goes sub-pixel (point sampling would draw a dotted line)",
    len(taper_pts) == 48
    and all(step > 0 for step in taper_steps)
    and max(taper_steps) <= 28 * 0.5
    and abs(taper_pts[0]["width"] - 28 * 0.45) < 0.5
    and min(p["width"] for p in taper_pts) >= 28 * 0.4,
    f"n={len(taper_pts)}, widths={taper_w}, steps={[round(x, 2) for x in taper_steps]}",
)

# ---- Case 14k: curved arc bends UP consistently for right & left facing and damages along the curve ----
py_reset()
TERRAIN_WALL_X = None
sh_r = lua.eval('_make_worm(101, 100, 200, 0.5, 1, "test.arc")')
sh_l = lua.eval('_make_worm(102, 500, 200, 0.5, -1, "test.arc")')
# Worm sitting UP inside the arc bend (midpoint x=220, y=200-40=160) vs worm on empty straight chord (x=220, y=200)
w_in_arc = lua.eval('_make_worm(103, 220, 160, 0.5, -1, "stock.bazooka")')
w_on_chord = lua.eval('_make_worm(104, 220, 200, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh_r, sh_l, w_in_arc, w_on_chord])
arc_spec = {
    "weapon": "test.arc",
    "reach": "instant",
    "hold": 4,
    "fade": 2,
    "look": "ribbon",
    "path": "arc",
    "bulge": 40,
    "hits": "corridor",
    "width": 12,
    "range": 240,
    "damage": 25,
    "core0": 2,
    "core1": 2,
    "glow0": 2,
    "glow1": 2,
    "sparks": True,
    "sprite": "sprites/arc/beam.png",
    "glow_sprite": "sprites/arc/beam_glow.png",
}
firing.beam(to_lua({"x": 100, "y": 200, "vx": 1, "vy": 0, "worm": sh_r, "weapon": "test.arc"}), to_lua(arc_spec))
RIBBONS.clear()
step_tick()
run_draw()
arc_r_core = [r for r in RIBBONS if r["sprite"] == "sprites/arc/beam.png" and len(r["points"]) > 2]
arc_r_sparks = [r for r in RIBBONS if r["sprite"] == "sprites/arc/beam.png" and len(r["points"]) == 2]
arc_r_min_y = min(p["y"] for p in arc_r_core[0]["points"]) if arc_r_core else 999
arc_r_min_w = min(p["width"] for r in arc_r_core for p in r["points"]) if arc_r_core else 0
spark_w = max(p["width"] for r in arc_r_sparks for p in r["points"]) if arc_r_sparks else 0
hit_ids_14k = {h["id"] for h in HITS}

# Now fire facing LEFT from x=500 -> should ALSO arch UP (min_y ~ 160, NOT 240!)
for _ in range(6):
    step_tick()
RIBBONS.clear()
firing.beam(to_lua({"x": 500, "y": 200, "vx": -1, "vy": 0, "worm": sh_l, "weapon": "test.arc"}), to_lua(arc_spec))
step_tick()
run_draw()
arc_l_core = [r for r in RIBBONS if r["sprite"] == "sprites/arc/beam.png" and len(r["points"]) > 2]
arc_l_min_y = min(p["y"] for p in arc_l_core[0]["points"]) if arc_l_core else 999
check(
    "case 14k: +bulge arches UP consistently when facing right or left, damages targets along the curved arc (not empty chord), enforces >=3px min width during hold, and draws thick sparks",
    abs(arc_r_min_y - 160.0) < 2.0
    and abs(arc_l_min_y - 160.0) < 2.0
    and 103 in hit_ids_14k
    and 104 not in hit_ids_14k
    and arc_r_min_w >= 3.0
    and spark_w >= 8.0,
    f"r_min_y={arc_r_min_y}, l_min_y={arc_l_min_y}, hit_ids={hit_ids_14k}, min_w={arc_r_min_w}, spark_w={spark_w}",
)

# ---- Case 14l: beam on_impact fires once on tip arrival with impact coords ----
py_reset()
TERRAIN_WALL_X = 280
impacts_14l = []
lua.globals()["_imp_cb14l"] = lambda ex, ey, *_: impacts_14l.append((float(ex), float(ey)))
sh14l = lua.eval('_make_worm(105, 100, 100, 0.5, 1, "test.impact")')
BODIES.append(sh14l)
spec14l = to_lua({
    "weapon": "test.impact",
    "reach": "progressive",
    "grow": 3,
    "hold": 4,
    "fade": 2,
    "look": "ribbon",
    "path": "straight",
    "hits": "none",
    "range": 400,
    "sprite": "sprites/imp/beam.png",
    "glow_sprite": "sprites/imp/beam_glow.png",
})
spec14l["on_impact"] = lua.eval("function(ex, ey) _imp_cb14l(ex, ey) end")
firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14l, "weapon": "test.impact"}), spec14l)
for _ in range(8):
    step_tick()
check(
    "case 14l: progressive beam invokes on_impact exactly once when head reaches impact wall",
    len(impacts_14l) == 1 and abs(impacts_14l[0][0] - 280.0) < 1.5,
    f"impacts={impacts_14l}",
)

# ---- Case 14m: burn DoT knockback (burn_push) + final active tick full push & kind ----
py_reset()
TERRAIN_WALL_X = None
sh14m = lua.eval('_make_worm(110, 100, 100, 0.5, 1, "test.burnpush")')
t14m = lua.eval('_make_worm(111, 180, 100, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh14m, t14m])
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14m, "weapon": "test.burnpush"}),
    to_lua({
        "weapon": "test.burnpush",
        "reach": "instant",
        "hold": 6,
        "fade": 2,
        "hit_cooldown": 2,
        "hits": "corridor",
        "width": 12,
        "range": 240,
        "damage": 10,
        "poison": 4,
        "interact": "burn",
        "burn_push": 0.9,
        "push": 5.0,
        "kind": "fire",
    }),
)
for _ in range(7):
    step_tick()
dot_hits_14m = [h for h in HITS if h["id"] == 111 and h["frame"] < 4]
final_hits_14m = [h for h in HITS if h["id"] == 111 and h["frame"] == 4]
check(
    "case 14m: burn applies burn_push during DoT ticks and full push + kind on final active tick",
    len(dot_hits_14m) >= 2
    and all((h["vx"] or 0) > 0 and (h["vx"] or 0) < 2.0 for h in dot_hits_14m)
    and len(final_hits_14m) == 1
    and (final_hits_14m[0]["vx"] or 0) >= 4.5
    and final_hits_14m[0]["kind"] == "fire",
    f"dot={dot_hits_14m}, final={final_hits_14m}",
)
check(
    "case 14m: a burning beam doses the worm once, not once per DoT tick",
    DOSES == [(111, 4)],
    f"doses={DOSES}",
)

# ---- Case 14n: curved arc hits target right at far tip / crater radius ----
py_reset()
TERRAIN_WALL_X = None
sh14n = lua.eval('_make_worm(112, 100, 200, 0.5, 1, "test.fararc")')
t14n = lua.eval('_make_worm(113, 444, 200, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh14n, t14n])
firing.beam(
    to_lua({"x": 100, "y": 200, "vx": 1, "vy": 0, "worm": sh14n, "weapon": "test.fararc"}),
    to_lua({
        "weapon": "test.fararc",
        "reach": "instant",
        "hold": 4,
        "fade": 1,
        "path": "arc",
        "bulge": 36,
        "hits": "corridor",
        "width": 10,
        "cut": 18,
        "range": 340,
        "damage": 22,
    }),
)
step_tick()
check(
    "case 14n: curved arc hits far worm right at impact tip / cut radius",
    any(h["id"] == 113 for h in HITS),
    f"hits={HITS}",
)

# ---- Case 14o: beam taze_mines + on_taze_mine electrifies mine instead of arm() ----
py_reset()
TERRAIN_WALL_X = None
sh14o = lua.eval('_make_worm(114, 100, 100, 0.5, 1, "test.tazemine")')
m14o = lua.eval('_make_body("mine", 501, 200, 100)')
BODIES.extend([sh14o, m14o])
tazed_14o = []
lua.globals()["_rec_tazemine_14o"] = lambda m: tazed_14o.append(int(m["id"]))
spec14o = to_lua({
    "weapon": "test.tazemine",
    "reach": "instant",
    "hold": 4,
    "fade": 1,
    "hits": "corridor",
    "width": 14,
    "range": 260,
    "damage": 20,
    "taze_mines": True,
})
spec14o["on_taze_mine"] = lua.eval("function(m) _rec_tazemine_14o(m) end")
firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14o, "weapon": "test.tazemine"}), spec14o)
for _ in range(4):
    step_tick()
check(
    "case 14o: beam taze_mines invokes on_taze_mine instead of mine:arm()",
    tazed_14o == [501] and not any(h["body_kind"] == "mine" and h["mode"] == "arm" for h in HITS),
    f"tazed={tazed_14o}, hits={HITS}",
)

# ---- Case 14p: beam fire mode='both' spawns flames along trajectory and on impact ----
py_reset()
TERRAIN_WALL_X = 280
sh14p = lua.eval('_make_worm(115, 100, 120, 0.5, 1, "test.beamfire")')
BODIES.append(sh14p)
firing.beam(
    to_lua({"x": 100, "y": 120, "vx": 1, "vy": 0, "worm": sh14p, "weapon": "test.beamfire"}),
    to_lua({
        "weapon": "test.beamfire",
        "reach": "progressive",
        "grow": 3,
        "hold": 4,
        "fade": 1,
        "hits": "none",
        "range": 360,
        "fire": {"mode": "both", "count": 3, "duration": 2000, "damage": 2, "step": 60},
    }),
)
for _ in range(8):
    step_tick()
traj_fires = [f for f in FIRES if f["x"] < 275.0]
imp_fires = [f for f in FIRES if f["x"] >= 275.0]
imp_count_14p = sum(f["count"] for f in imp_fires)
check(
    "case 14p: beam fire mode='both' calls wa.fire.spawn along trajectory and at impact wall",
    len(traj_fires) >= 2 and imp_count_14p >= 3,
    f"traj={len(traj_fires)}, imp_calls={len(imp_fires)}, imp_count={imp_count_14p}, total={len(FIRES)}",
)

# ---- Case 14q: sustained beam with live_aim follows worm aim, holds shots_fired, cuts periodically, and drains ----
py_reset()
TERRAIN_WALL_X = 320.0
dis_14q = 0
end_14q = []
lua.globals()["_dis_cb14q"] = lambda *_: globals().__setitem__("dis_14q", dis_14q + 1)
lua.globals()["_end_cb14q"] = lambda _w, _b, interrupted: end_14q.append(bool(interrupted))
sh14q = lua.eval('_make_worm(116, 100, 100, 0.5, 1, "test.livebeam")')
t14q_a = lua.eval('_make_worm(117, 200, 100, 0.5, -1, "stock.bazooka")')
# Worm positioned upward-right (~45 deg up from (100,100) -> aim = 0.75 -> dx=0.707, dy=-0.707)
t14q_b = lua.eval('_make_worm(118, 200, 0, 0.5, -1, "stock.bazooka")')
BODIES.extend([sh14q, t14q_a, t14q_b])
spec14q = to_lua({
    "weapon": "test.livebeam",
    "reach": "instant",
    "buffer": 0,
    "hold": 12,
    "fade": 3,
    "live_aim": True,
    "hits": "corridor",
    "width": 12,
    "range": 400,
    "damage": 15,
    "cut": 6,
    "hit_cooldown": 4,
    "sprite": "sprites/live/beam.png",
    "glow_sprite": "sprites/live/beam_glow.png",
})
spec14q["on_discharge"] = lua.eval("function() _dis_cb14q() end")
spec14q["on_end"] = lua.eval("function(w, b, inter) _end_cb14q(w, b, inter) end")

firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14q, "weapon": "test.livebeam"}), spec14q)
shots_held_14q = (sh14q["shots_fired"] == 0)
for t in range(1, 13):
    if t == 6:
        # Sweep aim upward 45 degrees while holding
        sh14q["aim"] = 0.75
    if t in (2, 7, 11):
        firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14q, "weapon": "test.livebeam"}), spec14q)
    step_tick()
    if t < 12 and sh14q["shots_fired"] != 0:
        shots_held_14q = False
    if t == 8:
        run_draw()

released_at_fade_14q = (sh14q["shots_fired"] == 1)
# Repeat on_fire during fade + post-release drain must still be swallowed
for t in range(13, 18):
    firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14q, "weapon": "test.livebeam"}), spec14q)
    step_tick()

swept_ribbons_14q = [r for r in RIBBONS if r["sprite"] == "sprites/live/beam.png" and len(r["points"]) > 2]
tip_y_14q = swept_ribbons_14q[0]["points"][-1]["y"] if swept_ribbons_14q else 100.0
cut_ys_14q = [c["y"] for c in CUTS]
hit_ids_14q = {h["id"] for h in HITS}
check(
    "case 14q: sustained beam holds shots_fired across hold, follows live aim, cuts along moving tip, hits swept target, and drains repeat on_fire",
    dis_14q == 1
    and shots_held_14q
    and released_at_fade_14q
    and end_14q == [False]
    and 117 in hit_ids_14q
    and 118 in hit_ids_14q
    and tip_y_14q < 0.0
    and len(CUTS) >= 2
    and min(cut_ys_14q) < 0.0,
    f"dis={dis_14q}, held={shots_held_14q}, rel={released_at_fade_14q}, end={end_14q}, hits={hit_ids_14q}, tip_y={tip_y_14q}, cuts={CUTS}",
)

# ---- Case 14r: mid-hold interruption immediately releases shots_fired and calls on_end(..., true) ----
py_reset()
TERRAIN_WALL_X = None
end_14r = []
lua.globals()["_end_cb14r"] = lambda _w, _b, interrupted: end_14r.append(bool(interrupted))
sh14r = lua.eval('_make_worm(119, 100, 100, 0.5, 1, "test.intbeam")')
BODIES.append(sh14r)
spec14r = to_lua({
    "weapon": "test.intbeam",
    "reach": "instant",
    "buffer": 0,
    "hold": 10,
    "fade": 3,
    "hits": "none",
    "range": 200,
    "sprite": "sprites/int/beam.png",
    "glow_sprite": "sprites/int/beam_glow.png",
})
spec14r["on_end"] = lua.eval("function(w, b, inter) _end_cb14r(w, b, inter) end")
firing.beam(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14r, "weapon": "test.intbeam"}), spec14r)
step_tick()
held_before_int_14r = (sh14r["shots_fired"] == 0)
sh14r["state"] = "hit"
step_tick()
RIBBONS.clear()
run_draw()
check(
    "case 14r: mid-hold interruption releases shots_fired, calls on_end(interrupted=true), and removes beam",
    held_before_int_14r and sh14r["shots_fired"] == 1 and end_14r == [True] and len(RIBBONS) == 0,
    f"held={held_before_int_14r}, shots_fired={sh14r['shots_fired']}, end={end_14r}, ribbons={len(RIBBONS)}",
)

# ---- Case 14s: firing.sequence tail_frames holds shots_fired across the final beam duration ----
py_reset()
TERRAIN_WALL_X = None
sh14s = lua.eval('_make_worm(120, 100, 100, 0.5, 1, "test.seqtail")')
BODIES.append(sh14s)
done_14s = []
lua.globals()["_done_14s"] = lambda _w, fired: done_14s.append(int(fired))
beam_14s = to_lua({
    "weapon": "test.seqtail",
    "reach": "instant",
    "hold": 5,
    "fade": 2,
    "hits": "none",
    "range": 200,
})
seq_14s = to_lua({
    "weapon": "test.seqtail",
    "count": 2,
    "interval_ms": 40,
    "tail_frames": 5,
})
lua.globals()["_firing_14s"] = firing
lua.globals()["_beam_14s"] = beam_14s
seq_14s["fire_fn"] = lua.eval("function(ev) _firing_14s.beam(ev, _beam_14s) end")
seq_14s["on_done"] = lua.eval("function(w, fired) _done_14s(w, fired) end")
firing.sequence(to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14s, "weapon": "test.seqtail"}), seq_14s)
# Shot 1 at f=0; interval_ms=40 -> 2 ticks -> Shot 2 at f=2; tail_frames=5 -> settles at f=7
held_frames_14s = []
for f in range(1, 9):
    step_tick()
    held_frames_14s.append(int(sh14s["shots_fired"]))
check(
    "case 14s: firing.sequence tail_frames holds shots_fired=0 through final shot's hold duration and releases after",
    held_frames_14s[:6] == [0, 0, 0, 0, 0, 0] and held_frames_14s[6:] == [1, 1] and done_14s == [2],
    f"held={held_frames_14s}, done={done_14s}",
)

# ---- Case 14t: cut_shape presets ("drill", "torch", validation) ----
py_reset()
TERRAIN_WALL_X = 280.0
sh14t_err = lua.eval('_make_worm(121, 100, 100, 0.5, 1, "test.cuterr")')
expect_beam_err(
    "case 14t-err: unknown cut_shape rejected",
    {"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14t_err, "weapon": "test.cuterr"},
    {"cut_shape": "square"},
)

py_reset()
TERRAIN_WALL_X = 280.0
sh14t_drill = lua.eval('_make_worm(122, 100, 100, 0.5, 1, "test.cutdrill")')
BODIES.append(sh14t_drill)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14t_drill, "weapon": "test.cutdrill"}),
    to_lua({
        "weapon": "test.cutdrill",
        "reach": "instant",
        "hold": 2,
        "fade": 1,
        "hits": "none",
        "range": 400,
        "cut_shape": "drill",
    }),
)
step_tick()
check(
    "case 14t-drill: cut_shape='drill' calls wa.land.cut with shape='drill' even without cut radius",
    len(CUTS) == 1 and CUTS[0]["shape"] == "drill" and CUTS[0]["radius"] is None,
    f"cuts={CUTS}",
)

py_reset()
TERRAIN_WALL_X = 280.0
sh14t_torch = lua.eval('_make_worm(123, 100, 100, 0.5, 1, "test.cuttorch")')
BODIES.append(sh14t_torch)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14t_torch, "weapon": "test.cuttorch"}),
    to_lua({
        "weapon": "test.cuttorch",
        "reach": "instant",
        "hold": 6,
        "fade": 1,
        "live_aim": True,
        "hits": "none",
        "range": 400,
        "cut_shape": "torch",
    }),
)
for t in range(1, 6):
    if t == 4:
        sh14t_torch["aim"] = 0.75
    step_tick()
torch_cuts = [c for c in CUTS if c["shape"] == "torch"]
check(
    "case 14t-torch: cut_shape='torch' passes facing and clamped live aim angle (-1..1)",
    len(torch_cuts) >= 2
    and all(c["facing"] == 1 and -1.0 <= c["angle"] <= 1.0 for c in torch_cuts)
    and abs(torch_cuts[0]["angle"]) < 0.01
    and torch_cuts[-1]["angle"] < -0.5,
    f"cuts={torch_cuts}",
)

# ---- Case 14u: custom pre_buffer on firing.beam (terrain trace, converge rails, show_orb=false, show_beam=false) ----
py_reset()
TERRAIN_WALL_X = 240.0
sh14u = lua.eval('_make_worm(124, 100, 100, 0.5, 1, "test.prebuf")')
BODIES.append(sh14u)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14u, "weapon": "test.prebuf"}),
    to_lua({
        "weapon": "test.prebuf",
        "reach": "instant",
        "buffer": 6,
        "hold": 2,
        "fade": 1,
        "hits": "none",
        "range": 500,
        "standoff": 10,
        "sprite": "sprites/main/beam.png",
        "glow_sprite": "sprites/main/beam_glow.png",
        "orb_sprite": "sprites/main/beam_orb.png",
        "pre_buffer": {
            "show_beam": True,
            "show_orb": False,
            "range": 500,
            "stop_on_terrain": True,
            "reach": "converge",
            "converge_spread": 32,
            "path": "straight",
            "points": 8,
            "core_width": 4,
            "tip_width": 2,
            "glow_width": 10,
            "end_width_scale": 1.2,
            "r": 255, "g": 64, "b": 32,
            "sprite": "sprites/pb/beam_soft.png",
            "glow_sprite": "sprites/pb/beam_glow_soft.png",
            "orb_sprite": "sprites/pb/beam_orb_soft.png",
        },
    }),
)
QUADS.clear()
RIBBONS.clear()
run_draw()
pb_core_14u = [r for r in RIBBONS if r["sprite"] == "sprites/pb/beam_soft.png"]
pb_glow_14u = [r for r in RIBBONS if r["sprite"] == "sprites/pb/beam_glow_soft.png"]
max_x_14u = max((p["x"] for r in pb_core_14u for p in r["points"]), default=0)
check(
    "case 14u-1: pre_buffer reach='converge' draws twin core + hot + glow strips clipped by terrain wall and suppresses orb when show_orb=false",
    len(pb_core_14u) == 4  # 2 converging rails * (core + hot)
    and len(pb_glow_14u) == 2  # 2 converging glow rails
    and 235.0 <= max_x_14u <= 245.0
    and len(QUADS) == 0,
    f"core={len(pb_core_14u)}, glow={len(pb_glow_14u)}, max_x={max_x_14u}, quads={len(QUADS)}",
)

# show_beam=false + custom orb_motes draws orb only
py_reset()
TERRAIN_WALL_X = 240.0
sh14u2 = lua.eval('_make_worm(125, 100, 100, 0.5, 1, "test.prebuforb")')
BODIES.append(sh14u2)
firing.beam(
    to_lua({"x": 100, "y": 100, "vx": 1, "vy": 0, "worm": sh14u2, "weapon": "test.prebuforb"}),
    to_lua({
        "weapon": "test.prebuforb",
        "reach": "instant",
        "buffer": 4,
        "hold": 2,
        "fade": 1,
        "hits": "none",
        "range": 300,
        "pre_buffer": {
            "show_beam": False,
            "show_orb": True,
            "orb_scale": 1.5,
            "orb_motes": 3,
            "orb_sprite": "sprites/pb/orb_only.png",
        },
    }),
)
QUADS.clear()
RIBBONS.clear()
run_draw()
pb_orbs_14u2 = [q for q in QUADS if q["sprite"] == "sprites/pb/orb_only.png"]
check(
    "case 14u-2: pre_buffer show_beam=false draws orb + 3 custom motes (5 quads) with 0 ribbons",
    len(RIBBONS) == 0 and len(pb_orbs_14u2) == 5,
    f"ribbons={len(RIBBONS)}, orbs={len(pb_orbs_14u2)}",
)

# ---- Case 14v: sequenced firing.beam_buffer uses spec.pre_buffer + jagged terrain trace ----
py_reset()
TERRAIN_WALL_X = 220.0
sh14v = lua.eval('_make_worm(126, 100, 100, 0.5, 1, "test.seqprebuf")')
BODIES.append(sh14v)
firing.beam_buffer(sh14v, 6, to_lua({
    "weapon": "test.seqprebuf",
    "range": 400,
    "standoff": 10,
    "core0": 20,
    "sprite": "sprites/main/beam.png",
    "glow_sprite": "sprites/main/beam_glow.png",
    "orb_sprite": "sprites/main/beam_orb.png",
    "pre_buffer": {
        "show_beam": True,
        "show_orb": True,
        "orb_motes": 2,
        "reach": "full",
        "stop_on_terrain": True,
        "path": "jagged",
        "noise": 12,
        "points": 10,
        "core_width": 5,
        "tip_width": 2,
        "glow_width": 14,
        "sprite": "sprites/pb/beam_plasma.png",
        "glow_sprite": "sprites/pb/beam_glow_plasma.png",
        "orb_sprite": "sprites/pb/beam_orb_plasma.png",
    },
}))
QUADS.clear()
RIBBONS.clear()
step_tick()
run_draw()
pb_core_14v = [r for r in RIBBONS if r["sprite"] == "sprites/pb/beam_plasma.png"]
pb_glow_14v = [r for r in RIBBONS if r["sprite"] == "sprites/pb/beam_glow_plasma.png"]
pb_orb_14v = [q for q in QUADS if q["sprite"] == "sprites/pb/beam_orb_plasma.png"]
max_x_14v = max((p["x"] for r in pb_core_14v for p in r["points"]), default=0)
check(
    "case 14v: firing.beam_buffer renders spec.pre_buffer ribbons + 2-mote orb clipped to wall",
    len(pb_core_14v) == 2
    and len(pb_glow_14v) == 1
    and len(pb_orb_14v) == 4  # halo + core + 2 motes
    and 215.0 <= max_x_14v <= 225.0,
    f"core={len(pb_core_14v)}, glow={len(pb_glow_14v)}, orb={len(pb_orb_14v)}, max_x={max_x_14v}",
)

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("firing harness: all checks passed")
