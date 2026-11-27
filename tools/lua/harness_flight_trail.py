"""Exercise the custom brush trail module against a fake `wa`.

`wfws_trail.lua` only runs inside WA, where a wrong brush shape or a pool that
never advances is a round trip. This harness loads the real module, drives its
50 Hz stepping and draw callbacks, and inspects the flat particle arrays and
the exact seven values `brush:boxes` receives.

    python -m pip install lupa
    python tools/lua/harness_flight_trail.py  # exits 1 on a failure

It is a development aid, not part of `bun run lint` / `build`: `lupa` is not a
project dependency.
"""
import math
import os
import sys

from lupa import LuaRuntime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRAIL = os.path.join(ROOT, "spec", "lua_sdk", "wfws_sdk", "lib", "wfws_trail.lua")

CHECKS = []


def check(name, ok, detail=""):
    CHECKS.append((name, bool(ok), detail))
    print(("ok    " if ok else "FAIL  ") + name + ("" if ok else "  (" + str(detail) + ")"))


lua = LuaRuntime(unpack_returned_tuples=True)

# Loading the module must not touch `wa`: component files return data only.
lua.execute("TRAILMOD = assert(loadfile(%r))()" % TRAIL.replace("\\", "/"))
trail = lua.globals().TRAILMOD
check("the module loads without wa", lua.eval("type(TRAILMOD)") == "table")

# ---------------------------------------------------------------- the fake wa ---
WORLD = {"frame": 0}
RNG = {"state": 12345}
STEP_HOOKS = []
DRAW_HOOKS = []
BRUSHES = []
BOXES = []


def next_random(lo=None, hi=None):
    # A small LCG is enough: the harness only needs the same sequence twice.
    RNG["state"] = (RNG["state"] * 1664525 + 1013904223) & 0xFFFFFFFF
    value = RNG["state"]
    if lo is not None and hi is not None:
        return int(lo) + value % (int(hi) - int(lo) + 1)
    return value


def make_brush(spec):
    class Brush:
        pass

    brush = Brush()
    brush.spec = dict(spec)

    def boxes(self, buf, count):
        values = [buf[i] for i in range(1, count * 7 + 1)]
        BOXES.append({"count": count, "values": values, "brush": brush})

    brush.boxes = boxes
    BRUSHES.append(brush)
    return brush


wa = lua.table()
wa.log = lambda *_: None
wa.msg = lua.table()
wa.msg.FRAME_FINISH = 40
wa.depth = lua.table()
wa.depth.BEHIND = 7
wa.depth.EFFECTS = 8
wa.depth.FRONT = 9
wa.world = lua.table()
wa.world.frame = lambda: WORLD["frame"]
wa.random = next_random
wa.math = lua.table()
wa.math.sin = math.sin
wa.math.cos = math.cos
wa.math.atan = lambda y, x: math.atan2(y, x)
wa.draw = lua.table()
wa.draw.fraction = lambda: 0.0
wa.draw.brush = make_brush
wa.on = lua.table()
wa.on.worm_message = lambda fn, opts=None: STEP_HOOKS.append((fn, opts))
wa.on.draw = lambda fn: DRAW_HOOKS.append(fn)
lua.globals()["wa"] = wa


def reset():
    trail.reset()
    WORLD["frame"] = 0
    RNG["state"] = 12345
    del BRUSHES[:]
    del BOXES[:]


def create(**overrides):
    spec = {
        "sheet": "sprites/test/trail.png",
        "cell_w": 16,
        "cell_h": 16,
        "frames": 1,
        "play_mode": "lifetime",
        "fps": 15,
        "power": 50,
        "speed": 100,
        "life": 10,
        "life_jitter": 0,
        "scale_start": 1,
        "scale_end": 0.5,
        "alpha_start": 1,
        "alpha_end": 0,
        "rotate": "missile",
        "spin_min": 0,
        "spin_max": 0,
        "gravity": 0,
        "drag": 1,
        "spread": 0,
        "jitter": 0,
        "inherit_vel": 0,
        "offset_x": 0,
        "offset_y": 0,
        "r": 255,
        "g": 128,
        "b": 0,
        "blend": "add",
        "depth": "FRONT",
        "max_particles": 64,
    }
    spec.update(overrides)
    return trail.create(lua.table_from(spec))


def emit(pool, mid=7, x=100.0, y=200.0, vx=10.0, vy=0.0, drawn=0.0, facing=1.0):
    trail.emit(pool, mid, x, y, vx, vy, drawn, facing, WORLD["frame"])


def draw(fraction=0.0):
    wa.draw.fraction = lambda: fraction
    BOXES.clear()
    for fn in DRAW_HOOKS:
        fn()
    return BOXES[-1] if BOXES else None


# ------------------------------------------------------------- creation & hook ---
reset()
check("no sheet means no pool", trail.create(lua.table()) is None)
pool = create()
check("one brush per pool", len(BRUSHES) == 1, len(BRUSHES))
check("the brush got the sheet", BRUSHES[0].spec.get("sprite") == "sprites/test/trail.png")
check("the brush got add blend", BRUSHES[0].spec.get("blend") == "add")
check("FRONT resolves through wa.depth", BRUSHES[0].spec.get("depth") == 9)
check("one FRAME_FINISH handler", len(STEP_HOOKS) == 1, len(STEP_HOOKS))
check("one draw handler", len(DRAW_HOOKS) == 1, len(DRAW_HOOKS))
check("the FRAME_FINISH filter names the frame message",
      STEP_HOOKS[0][1] is not None and STEP_HOOKS[0][1]["msgs"][1] == 40)
check("the pool cap is clamped", pool["cap"] == 64, pool["cap"])

# --------------------------------------------------------------- emission rate ---
reset()
pool = create()
WORLD["frame"] = 10
emit(pool)
check("power 50 emits two particles", pool["n"] == 2, pool["n"])
check("particles start at age zero", pool["page"][1] == 0 and pool["page"][2] == 0)
check("the nozzle is the missile position", pool["px"][1] == 100.0 and pool["py"][1] == 200.0)
check("the nozzle ejects opposite the missile velocity", pool["pvx"][1] < -0.5, pool["pvx"][1])
check("no spread keeps the ejection on that axis", abs(pool["pvy"][1]) < 1e-9, pool["pvy"][1])
check("life is exact without jitter", pool["plife"][1] == 10)

box = draw(0.0)
check("the draw callback sends both particles", box is not None and box["count"] == 2, box and box["count"])
values = box["values"]
check("seven values per particle", len(values) == 14, len(values))
check("x, y, w, h use the cell size", abs(values[0] - 100.0) < 1e-6 and abs(values[1] - 200.0) < 1e-6
      and values[2] == 16 and values[3] == 16, values[:4])
check("rotate = missile uses the drawn heading", values[4] == 0.0)
check("lifetime mode starts on frame zero", values[5] == 0)
check("start colour is packed opaque ARGB", values[6] == (255 << 24) | (255 << 16) | (128 << 8),
      hex(values[6] & 0xFFFFFFFF))

# ---------------------------------------------------------------- stepping ---
WORLD["frame"] = 11
emit(pool)
check("the next emission advances and adds", pool["n"] == 4, pool["n"])
check("the first particle aged one frame", pool["page"][1] == 1)
check("the first particle moved by its velocity", pool["px"][1] < 100.0, pool["px"][1])
box = draw(0.5)
values = box["values"]
check("fraction lerps between frames", abs(values[0] - (pool["px"][1] + pool["pvx"][1] * 0.5)) < 1e-6, values[0])
check("fraction fades alpha", (values[6] >> 24) < 255, values[6] >> 24)

# ----------------------------------------------------------- frame animation ---
reset()
pool = create(frames=4, play_mode="loop", fps=50, life=40)
WORLD["frame"] = 1
emit(pool)
WORLD["frame"] = 2
emit(pool)
box = draw(0.0)
# The first particle was born on frame 1 and is drawn on frame 2, so it is one
# frame old at 50 fps; the particle emitted this frame is still on frame zero.
check("loop mode advances at fps / 50", box["values"][5] == 1, box["values"][5])
check("a fresh particle is still on frame zero", box["values"][19] == 0, box["values"][19])
reset()
pool = create(frames=4, play_mode="random", life=40)
WORLD["frame"] = 1
emit(pool)
frame0 = pool["pframe0"][1]
check("random mode picks a starting frame", 0 <= frame0 <= 3, frame0)
box = draw(0.0)
check("random mode keeps that frame", box["values"][5] == frame0, box["values"][5])

# ---------------------------------------------------------------- colour ramp ---
reset()
pool = create(r_end=0, g_end=0, b_end=255, life=10)
WORLD["frame"] = 1
emit(pool)
for frame in range(2, 10):
    WORLD["frame"] = frame
    trail.step(frame)
box = draw(0.0)
values = box["values"]
check("the end tint is interpolated", values[6] & 0xFFFFFF == (51 << 16) | (26 << 8) | 204,
      hex(values[6] & 0xFFFFFF))
check("scale interpolates", abs(values[2] - 9.6) < 1e-6, values[2])
check("alpha interpolates", values[6] >> 24 == 51, values[6] >> 24)

# -------------------------------------------------------------------- expiry ---
reset()
pool = create(max_particles=16, power=100, life=4, life_jitter=0)
for frame in range(1, 30):
    WORLD["frame"] = frame
    emit(pool)
    for fn, _opts in STEP_HOOKS:
        fn(lua.table_from({"kind": 40}))
check("the pool caps instead of growing", pool["n"] <= 16, pool["n"])
for frame in range(30, 45):
    WORLD["frame"] = frame
    trail.step(frame)
check("expired particles leave the pool", pool["n"] == 0, pool["n"])
check("the pool keeps its capacity", pool["cap"] == 16)

# ------------------------------------------------------------------- nozzle ---
reset()
pool = create(offset_x=10, offset_y=0, rotate="none")
WORLD["frame"] = 1
emit(pool, drawn=90.0, facing=1.0)
check("the nozzle offset rotates with the missile",
      abs(pool["px"][1] - 100.0) < 1e-6 and abs(pool["py"][1] - 210.0) < 1e-6,
      (pool["px"][1], pool["py"][1]))
reset()
pool = create(offset_x=10, offset_y=0, rotate="none")
WORLD["frame"] = 1
emit(pool, drawn=90.0, facing=-1.0)
check("facing mirrors the nozzle x", abs(pool["py"][1] - 190.0) < 1e-6, pool["py"][1])

# ------------------------------------------------------------- depth and blend ---
reset()
pool = create(depth="BEHIND", blend="junk")
check("BEHIND resolves through wa.depth", BRUSHES[0].spec.get("depth") == 7)
check("an unknown blend falls back to alpha", BRUSHES[0].spec.get("blend") == "alpha")
reset()
pool = create(depth=3)
check("numeric depth passes through", BRUSHES[0].spec.get("depth") == 3)

# ---------------------------------------------------------------- accumulator ---
reset()
pool = create(power=10)
WORLD["frame"] = 1
emit(pool)
check("power 10 starts a fractional particle", pool["n"] == 0 and abs(pool["acc"][7] - 0.4) < 1e-6,
      pool["acc"][7])
emit(pool)
emit(pool)
check("three fractional frames make one particle", pool["n"] == 1, pool["n"])
trail.forget(pool, 7)
check("forget drops the accumulator", pool["acc"][7] is None)
check("forget leaves live particles", pool["n"] == 1)

reset()
pool = create(rotate="none")
WORLD["frame"] = 1
emit(pool, drawn=45.0)
check("rotate none leaves rotation at zero", pool["prot"][1] == 0.0)

# ------------------------------------------------------- start_frame skip ---
for mode in ("lifetime", "loop", "pingpong", "random"):
    reset()
    pool = create(frames=8, start_frame=1, play_mode=mode, fps=50, life=24)
    seen_frames = set()
    for frame in range(1, 20):
        WORLD["frame"] = frame
        emit(pool, x=100.0 + frame * 10.0)
        box = draw(0.0)
        if box is not None:
            vals = box["values"]
            for idx in range(box["count"]):
                seen_frames.add(int(vals[idx * 7 + 5]))
    check(
        f"start_frame=1 ({mode}) never renders frame 0 and uses frames 1..7",
        0 not in seen_frames and len(seen_frames) > 0 and min(seen_frames) >= 1 and max(seen_frames) <= 7,
        sorted(seen_frames),
    )

reset()
pool = create(frames=8, start_frame=1, play_mode="lifetime", life=24)
WORLD["frame"] = 1
emit(pool, x=100.0)
box = draw(0.0)
check("start_frame=1 starts immediately at frame 1 on birth", box is not None and box["values"][5] == 1, box and box["values"][5])

# ------------------------------------------------- segment interpolation ---
reset()
pool = create(power=50, speed=0, inherit_vel=0, jitter=0, gravity=0, drag=1)
WORLD["frame"] = 1
emit(pool, mid=9, x=100.0, y=200.0, vx=20.0, vy=0.0)
WORLD["frame"] = 2
emit(pool, mid=9, x=120.0, y=200.0, vx=20.0, vy=0.0)
check(
    "multi-particle emission interpolates along missile segment instead of stacking",
    abs(pool["px"][3] - 110.0) < 1e-6 and abs(pool["px"][4] - 120.0) < 1e-6,
    (pool["px"][3], pool["px"][4]),
)

# ---------------------------------------------------- ring buffer cursor ---
reset()
pool = create(max_particles=16, power=25, life=100, life_jitter=0, speed=0, inherit_vel=0, jitter=0)
for frame in range(1, 21):
    WORLD["frame"] = frame
    emit(pool, mid=3, x=float(frame * 10), y=200.0, vx=10.0, vy=0.0)
# First 16 landed at x = 10..160; frames 17..20 overwrote slots 1..4 with 170..200.
check(
    "pool overwrite cycles through cursor 1..4 instead of repeating slot 1",
    pool["n"] == 16
    and abs(pool["px"][1] - 170.0) < 1e-6
    and abs(pool["px"][2] - 180.0) < 1e-6
    and abs(pool["px"][3] - 190.0) < 1e-6
    and abs(pool["px"][4] - 200.0) < 1e-6
    and abs(pool["px"][5] - 50.0) < 1e-6,
    [pool["px"][i] for i in range(1, 6)],
)

failed = [name for name, ok, _ in CHECKS if not ok]
if failed:
    print("\n%d check(s) failed: %s" % (len(failed), ", ".join(failed)))
    sys.exit(1)
print("\nall checks passed")