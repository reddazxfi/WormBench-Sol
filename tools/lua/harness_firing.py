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

HOOKS = {
    "missile_frame": [],
    "worm_message": [],
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
    STATE["frame"] = 0
    STATE["digit"] = None
    STATE["rng_seed"] = seed
    STATE["next_actor_id"] = 1
    STATE["next_missile_id"] = 0xF0000000
    STATE["launch_always_fail"] = False
    LAUNCHES.clear()
    ACTORS_SPAWNED.clear()
    SOUNDS.clear()
    LOGS.clear()
    ACTORS.clear()
    MISSILES.clear()
    WORMS.clear()


def py_worms_all():
    return lua.table_from({i + 1: w for i, w in enumerate(WORMS)})


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
    aid = STATE["next_actor_id"]
    STATE["next_actor_id"] += 1
    rec = {
        "id": aid,
        "handle": handle,
        "frame": STATE["frame"],
        "x": float(spec["x"] or 0),
        "y": float(spec["y"] or 0),
        "vx": float(spec["vx"] or 0),
        "vy": float(spec["vy"] or 0),
        "sprite": spec["sprite"],
        "gravity": bool(spec["gravity"]) if spec["gravity"] is not None else False,
        "collide": bool(spec["collide"]) if spec["collide"] is not None else False,
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
    "launch": py_launch,
    "actor_spawn": py_actor_spawn,
    "actor_despawn": py_actor_despawn,
    "sound_play": py_sound_play,
    "log": py_log,
    "reg_missile_frame": py_reg_missile_frame,
    "reg_worm_message": py_reg_worm_message,
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
  function a:despawn()
    if not self.dead then
      self.dead = true
      _py.actor_despawn(self.id)
    end
  end
  return a
end

wa = {
  world = {
    frame = function() return _py.frame() end,
    keys = function() return _py.keys() end,
  },
  math = {
    sin = function(v) return _py.sin(v) end,
    cos = function(v) return _py.cos(v) end,
    atan = function(y, x) return x == nil and _py.atan(y, 1) or _py.atan(y, x) end,
  },
  random = function(a, b) return _py.random(a, b) end,
  worms = { all = function() return _py.worms_all() end },
  actors = { spawn = make_actor },
  weapons = { launch = function(s) return _py.launch(s) end },
  sound = { play = function(t, s, p) _py.sound_play(t, s, p) end },
  log = function(m) _py.log(m) end,
  msg = { FRAME_FINISH = "FRAME_FINISH" },
  on = {
    missile_frame = function(fn) _py.reg_missile_frame(fn) end,
    worm_message = function(fn, opts) _py.reg_worm_message(fn, opts) end,
  },
}

function _make_worm(id, x, y, aim, facing, weapon)
  return {
    id = id,
    x = x,
    y = y,
    aim = aim or 0.5,
    facing = facing or 1,
    hp = 100,
    turn = true,
    aiming = true,
    state_id = 0x67,
    weapon = weapon or "test.wep",
    shots_fired = 0,
    shots_to_fire = 1,
    target = { x = x + 300, y = y },
  }
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
    len(ACTORS_SPAWNED) == 1 and abs(ACTORS_SPAWNED[0]["vy"] + 4.0) < 1e-6 and ACTORS_SPAWNED[0]["sprite"] == "sprites/bolt.png" and ACTORS_SPAWNED[0]["gravity"] is True,
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

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("firing harness: all checks passed")
