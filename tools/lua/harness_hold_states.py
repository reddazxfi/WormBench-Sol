"""Verify `wfws_sprite_builder.lua` hold / buffer / fire / aim sprite state transitions.

Exercises every combination of `ready`, `firing`, `buffer` role, `fire` role,
`keep_firing`, `hide_main`, `aim_clamp`, and `sb.hold_trigger(w, "stop")` so
sustained beams and multi-shot weapons never flicker, double-draw, or freeze
on the wrong sheet.

    python tools/lua/harness_hold_states.py
"""
import math
import os
import sys

from lupa import LuaRuntime

SDK_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "spec",
    "lua_sdk",
    "wfws_sdk",
    "lib",
)
SDK = os.path.join(SDK_DIR, "wfws_sprite_builder.lua")
SWING = os.path.join(SDK_DIR, "wfws_swing.lua")
TRAIL = os.path.join(SDK_DIR, "wfws_trail.lua")

lua = LuaRuntime(unpack_returned_tuples=True)

WORLD = {"frame": 0, "keys": {"space": False}}
WORMS = []
RECORDS = {}
LOG = []
QUADS = []
EVENTS = []
DRAW = []
MSG = []
BODY = []


def make_worm_data(wid, weapon, aim=0.5, state="ready"):
    return {
        "id": wid,
        "hp": 100,
        "turn": True,
        "visible": True,
        "body_visible": True,
        "weapon": weapon,
        "x": 1000.0,
        "y": 1000.0,
        "vx": 0.0,
        "vy": 0.0,
        "facing": 1,
        "aim": aim,
        "aim_target": 0.0,
        "state": state,
    }


def make_record(w):
    t = lua.table()

    def input_(_self, spec=None):
        aim = spec["aim"] if spec is not None else None
        if aim is not None:
            _self["aim_target"] = float(aim)
            w["aim_target"] = float(aim)
        return True

    t.input = input_
    for k, v in w.items():
        t[k] = v
    return t


MUTE_STATE = {}


lua.execute(
    """
local records = {}
function _set_records(tbl) records = tbl end
function fresh_worm(id)
  local rec = records[id]
  return setmetatable({}, {
    __index = function(_, k) return rec[k] end,
    __newindex = function(_, k, v) rec[k] = v end,
  })
end
"""
)
FRESH = lua.globals()["fresh_worm"]
SET_RECORDS = lua.globals()["_set_records"]


def register_worm(w):
    WORMS.append(w)
    rec = make_record(w)
    RECORDS[w["id"]] = rec
    SET_RECORDS(lua.table_from(RECORDS))
    return rec


def all_worms():
    out = lua.table()
    for i, w in enumerate(WORMS, 1):
        out[i] = FRESH(w["id"])
    return out


wa = lua.table()
wa.log = lambda msg: LOG.append(str(msg))
wa.msg = lua.table()
wa.msg.FRAME_FINISH = 40
wa.world = lua.table()
wa.world.frame = lambda: WORLD["frame"]
wa.world.keys = lambda: lua.table_from(WORLD["keys"])
wa.worms = lua.table()
wa.worms.all = all_worms
wa.math = lua.table()
wa.math.sin = math.sin
wa.math.cos = math.cos
wa.draw = lua.table()


def quad(*args):
    t = args[0]
    pts = t["points"]
    p1 = pts[1] if pts is not None else None
    p2 = pts[2] if pts is not None else None
    QUADS.append(
        {
            "sprite": t["sprite"],
            "frame": int(t["frame"] or 0),
            "blend": t["blend"],
            "color": int(t["color"] or 0),
            "x1": float(p1["x"]) if p1 is not None else 0.0,
            "y1": float(p1["y"]) if p1 is not None else 0.0,
            "x2": float(p2["x"]) if p2 is not None else 0.0,
            "y2": float(p2["y"]) if p2 is not None else 0.0,
        }
    )


wa.draw.quad = quad
wa.on = lua.table()
wa.on.draw = lambda fn: DRAW.append(fn)
wa.on.worm_message = lambda fn, opts=None: MSG.append(fn)
wa.on.body_move = lambda fn, opts=None: BODY.append(fn)
wa.weapons = lua.table()
def hold_sheet(weapon, n):
    MUTE_STATE[weapon] = int(n)
    EVENTS.append(("mute", weapon, int(n)))


wa.weapons.hold_sheet = hold_sheet
wa.sound = lua.table()
wa.sound.play = lambda *_: True

lua.globals()["wa"] = wa
lua.execute(
    """
package.preload["wf-lib/holds"] = function()
  return { PX_HANDS = { [1] = "hand.png", [2] = "hand.png", [3] = "hand.png" } }
end
package.preload["wf-lib/wfws_swing"] = function()
  return assert(loadfile(%r))()
end
package.preload["wf-lib/wfws_trail"] = function()
  return assert(loadfile(%r))()
end
"""
    % (SWING.replace("\\", "/"), TRAIL.replace("\\", "/"))
)

sb = lua.execute(f'return assert(loadfile({SDK!r}))()')


def step(n=1):
    for _ in range(n):
        WORLD["frame"] += 1
        QUADS.clear()
        EVENTS.clear()
        for fn in BODY:
            for w in WORMS:
                fn(FRESH(w["id"]))
        for fn in MSG:
            for w in WORMS:
                fn(FRESH(w["id"]))
        for fn in DRAW:
            fn()


def last_mute(weapon):
    return MUTE_STATE.get(weapon, 0)


def sprites():
    return [q["sprite"] for q in QUADS]


def build_ctx(wid):
    ctx = lua.table()
    ctx.id = wid
    return ctx


# Register several distinct weapon specs
# 1) Full weapon: hold + buffer(hide_main=false) + fire(hide_main=false, frames=4) + keep_firing + aim_clamp
sb.hold(
    build_ctx("w.full"),
    lua.table_from(
        {
            "weapon": "w.full",
            "sheet": "hold_full.png",
            "silent_sheet": "silent.png",
            "cell_w": 90,
            "cell_h": 90,
            "frames": 4,
            "anim_speed": 1.0,
            "weap_radius": 12,
            "weap_rotation": 1.0,
            "weap_radial_rotation": 1.0,
            "hand": "hand.png",
            "hand_radius": 0,
            "keep_firing": True,
            "aim_clamp": lua.table_from({"up": 45, "down": 45}),
            "buffer": lua.table_from(
                {
                    "sheet": "buf_full.png",
                    "cell_w": 90,
                    "cell_h": 90,
                    "frames": 2,
                    "anim_speed": 1.0,
                    "hide_main": False,
                    "weap_radius": 12,
                    "weap_rotation": 1.0,
                    "weap_radial_rotation": 1.0,
                    "hand": "hand.png",
                    "hand_radius": 0,
                }
            ),
            "fire": lua.table_from(
                {
                    "sheet": "fire_full.png",
                    "cell_w": 90,
                    "cell_h": 90,
                    "frames": 4,
                    "anim_speed": 2.0,
                    "ticks": 6,
                    "hide_main": False,
                    "weap_radius": 12,
                    "weap_rotation": 1.0,
                    "weap_radial_rotation": 1.0,
                    "hand": "hand.png",
                    "hand_radius": 0,
                }
            ),
        }
    ),
)

# 2) Hide-main weapon: hold + buffer(hide_main=true) + fire(hide_main=true)
sb.hold(
    build_ctx("w.hide"),
    lua.table_from(
        {
            "weapon": "w.hide",
            "sheet": "hold_hide.png",
            "silent_sheet": "silent.png",
            "cell_w": 90,
            "cell_h": 90,
            "frames": 1,
            "weap_radius": 12,
            "weap_rotation": 1.0,
            "weap_radial_rotation": 1.0,
            "hand": "hand.png",
            "hand_radius": 0,
            "keep_firing": False,
            "buffer": lua.table_from(
                {
                    "sheet": "buf_hide.png",
                    "cell_w": 90,
                    "cell_h": 90,
                    "frames": 1,
                    "hide_main": True,
                    "weap_radius": 12,
                    "weap_rotation": 1.0,
                    "weap_radial_rotation": 1.0,
                    "hand": "hand.png",
                    "hand_radius": 0,
                }
            ),
            "fire": lua.table_from(
                {
                    "sheet": "fire_hide.png",
                    "cell_w": 90,
                    "cell_h": 90,
                    "frames": 2,
                    "anim_speed": 2.0,
                    "ticks": 6,
                    "hide_main": True,
                    "weap_radius": 12,
                    "weap_rotation": 1.0,
                    "weap_radial_rotation": 1.0,
                    "hand": "hand.png",
                    "hand_radius": 0,
                }
            ),
        }
    ),
)

# 3) Fire-only weapon (no buffer sheet, has fire sheet + keep_firing)
sb.hold(
    build_ctx("w.fireonly"),
    lua.table_from(
        {
            "weapon": "w.fireonly",
            "sheet": "hold_fo.png",
            "silent_sheet": "silent.png",
            "cell_w": 90,
            "cell_h": 90,
            "frames": 2,
            "anim_speed": 1.0,
            "weap_radius": 12,
            "weap_rotation": 1.0,
            "weap_radial_rotation": 1.0,
            "hand": "hand.png",
            "hand_radius": 0,
            "keep_firing": True,
            "fire": lua.table_from(
                {
                    "sheet": "fire_fo.png",
                    "cell_w": 90,
                    "cell_h": 90,
                    "frames": 2,
                    "anim_speed": 2.0,
                    "ticks": 6,
                    "hide_main": False,
                    "weap_radius": 12,
                    "weap_rotation": 1.0,
                    "weap_radial_rotation": 1.0,
                    "hand": "hand.png",
                    "hand_radius": 0,
                }
            ),
        }
    ),
)

# 4) Keep-firing only weapon (no buffer, no fire sheet)
sb.hold(
    build_ctx("w.keep"),
    lua.table_from(
        {
            "weapon": "w.keep",
            "sheet": "hold_keep.png",
            "silent_sheet": "silent.png",
            "cell_w": 90,
            "cell_h": 90,
            "frames": 4,
            "anim_speed": 4.0,
            "weap_radius": 12,
            "weap_rotation": 1.0,
            "weap_radial_rotation": 1.0,
            "hand": "hand.png",
            "hand_radius": 0,
            "keep_firing": True,
        }
    ),
)

# 5) Bows: a plain hold with draw_hand=false. The engine has no such key, so
# sb.hold still has to park and shrink its own hand.
bow_hold = sb.hold(
    build_ctx("w.bow"),
    lua.table_from(
        {
            "weapon": "w.bow",
            "sheet": "hold_bow.png",
            "frames": 8,
            "hand": "hand.png",
            "hand_radius": 0.01,
            "hand_scale": 1.0,
            "draw_hand": False,
        }
    ),
)

# 6) Crowbar-style aim clamp: the engine's hand is parked, but must shrink too.
clamp_hold = sb.hold(
    build_ctx("w.clamp"),
    lua.table_from(
        {
            "weapon": "w.clamp",
            "sheet": "hold_clamp.png",
            "silent_sheet": "silent.png",
            "frames": 1,
            "hand": "hand.png",
            "hand_radius": 9,
            "hand_scale": 1.0,
            "aim_clamp": lua.table_from({"up": 40, "down": 40}),
        }
    ),
)

failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  " + detail) if detail else ""))
    if not ok:
        failures.append(name)


w_full = register_worm(make_worm_data(1, "w.full", aim=0.5, state="ready"))
w_hide = register_worm(make_worm_data(2, "w.hide", aim=0.5, state="standing"))
w_fo = register_worm(make_worm_data(3, "w.fireonly", aim=0.5, state="standing"))
w_keep = register_worm(make_worm_data(4, "w.keep", aim=0.5, state="standing"))

# 1. ready (aiming) draws entry.sheet and mutes engine sheet
step(2)
check(
    "1: ready aiming draws hold_full.png once and mutes engine sheet",
    sprites() == ["hold_full.png"] and last_mute("w.full") == 1,
    f"sprites={sprites()}, mute={last_mute('w.full')}",
)

# 2. firing + buffer (hide_main=false, keep_firing=true) draws entry.sheet once + entry.buffer
w_full["state"] = "firing"
sb.hold_trigger(w_full, "buffer", 5)
step(1)
check(
    "2: firing + buffer(hide_main=false) draws hold_full.png once + buf_full.png",
    sprites() == ["hold_full.png", "buf_full.png"] and last_mute("w.full") == 1,
    f"sprites={sprites()}, mute={last_mute('w.full')}",
)

# 3. firing + buffer (hide_main=true) draws entry.buffer only
sb.hold_trigger(w_full, "stop")
w_full["state"] = "standing"
w_hide["state"] = "firing"
sb.hold_trigger(w_hide, "buffer", 5)
step(1)
check(
    "3: firing + buffer(hide_main=true) draws buf_hide.png only",
    sprites() == ["buf_hide.png"] and last_mute("w.hide") == 1,
    f"sprites={sprites()}, mute={last_mute('w.hide')}",
)

# 4. firing + buffer with NO entry.buffer + entry.fire present: must NOT flash entry.fire
sb.hold_trigger(w_hide, "stop")
w_hide["state"] = "standing"
w_fo["state"] = "firing"
sb.hold_trigger(w_fo, "buffer", 5)
step(2)
check(
    "4: buffer without buffer sheet suppresses fire_fo.png and keeps hold_fo.png",
    sprites() == ["hold_fo.png"] and "fire_fo.png" not in sprites() and last_mute("w.fireonly") == 1,
    f"sprites={sprites()}, mute={last_mute('w.fireonly')}",
)

# 5. firing + on_discharge(fire, 30) with hide_main=false: persists 30 ticks & follows clamped live aim
sb.hold_trigger(w_fo, "stop")
w_fo["state"] = "standing"
w_full["state"] = "firing"
w_full["aim"] = 0.5
sb.hold_trigger(w_full, "fire", 30)
step(1)
q_level = [q for q in QUADS if q["sprite"] == "fire_full.png"][0]
# Aim straight up (1.0) -> clamped to 45 deg (0.75) by aim_clamp
w_full["aim"] = 1.0
persisted_all_30 = True
for t in range(2, 30):
    step(1)
    sp = sprites()
    if sp != ["hold_full.png", "fire_full.png"]:
        persisted_all_30 = False
q_up_clamped = [q for q in QUADS if q["sprite"] == "fire_full.png"][0]
# Now compare against unclamped 0.75 aim vs clamped 1.0 -> should produce identical clamped angle/pos
w_full["aim"] = 0.75
step(1)
# Re-trigger briefly to verify clamped 1.0 == 0.75 on fire_full.png
sb.hold_trigger(w_full, "fire", 4)
w_full["aim"] = 0.75
step(1)
q_exact_45 = [q for q in QUADS if q["sprite"] == "fire_full.png"][0]
check(
    "5: fire(hide_main=false) persists for full window and follows clamped live aim",
    persisted_all_30
    and abs(q_up_clamped["y1"] - q_exact_45["y1"]) < 1e-4
    and abs(q_up_clamped["y1"] - q_level["y1"]) > 2.0,
    f"persisted={persisted_all_30}, y_clamped={q_up_clamped['y1']:.2f}, y_45={q_exact_45['y1']:.2f}, y_level={q_level['y1']:.2f}",
)

# 6. firing + on_discharge(fire, 30) with hide_main=true: draws entry.fire only for all ticks
sb.hold_trigger(w_full, "stop")
w_full["state"] = "standing"
w_hide["state"] = "firing"
sb.hold_trigger(w_hide, "fire", 30)
hide_ok = True
for _ in range(29):
    step(1)
    if sprites() != ["fire_hide.png"] or last_mute("w.hide") != 1:
        hide_ok = False
check(
    "6: fire(hide_main=true) draws fire_hide.png only for full window",
    hide_ok,
    f"last_sprites={sprites()}",
)

# 7. firing with NO entry.fire + keep_firing=true: draws entry.sheet and advances animation
w_hide["state"] = "standing"
w_keep["state"] = "firing"
keep_frames = set()
keep_ok = True
for _ in range(10):
    step(1)
    if sprites() != ["hold_keep.png"] or last_mute("w.keep") != 1:
        keep_ok = False
    for q in QUADS:
        keep_frames.add(q["frame"])
check(
    "7: keep_firing without fire sheet holds hold_keep.png and advances strip frames",
    keep_ok and len(keep_frames) > 1,
    f"keep_ok={keep_ok}, frames={sorted(keep_frames)}",
)

# 8. hold_trigger(w, "stop") clears active fire/buffer immediately and unmutes when leaving firing/aiming; returning to ready works cleanly
w_keep["state"] = "standing"
w_full["state"] = "firing"
sb.hold_trigger(w_full, "fire", 30)
step(1)
had_fire = ("fire_full.png" in sprites())
sb.hold_trigger(w_full, "stop")
w_full["state"] = "standing"
step(1)
cleared_sprites = sprites()
cleared_mute = last_mute("w.full")
w_full["state"] = "ready"
step(2)
ready_again = sprites()
check(
    "8: hold_trigger('stop') clears active roles, unmutes on standing, and resumes cleanly in ready",
    had_fire and cleared_sprites == [] and cleared_mute == 0 and ready_again == ["hold_full.png"],
    f"had_fire={had_fire}, cleared={cleared_sprites}, mute={cleared_mute}, ready={ready_again}",
)

# 9. short firing flash overlapping ready state with keep_firing=true & hide_main=false draws entry.sheet ONCE + entry.fire
w_full["state"] = "ready"
sb.hold_trigger(w_full, "fire", 4)
step(1)
check(
    "9: firing flash overlapping ready draws hold_full.png ONCE + fire_full.png",
    sprites() == ["hold_full.png", "fire_full.png"],
    f"sprites={sprites()}",
)

# 10. after 21 aim frames, hold_full.png reaches full 1.0 scale (90 px), matching buf_full.png and fire_full.png
sb.hold_trigger(w_full, "stop")
w_full["state"] = "standing"
w_full["aim"] = 0.5
step(1)
w_full["state"] = "ready"
step(21)
q_aim_full = [q for q in QUADS if q["sprite"] == "hold_full.png"][0]
aim_w = math.hypot(q_aim_full["x2"] - q_aim_full["x1"], q_aim_full["y2"] - q_aim_full["y1"])

w_full["state"] = "firing"
sb.hold_trigger(w_full, "buffer", 4)
step(1)
q_buf_full = [q for q in QUADS if q["sprite"] == "buf_full.png"][0]
buf_w = math.hypot(q_buf_full["x2"] - q_buf_full["x1"], q_buf_full["y2"] - q_buf_full["y1"])

sb.hold_trigger(w_full, "fire", 4)
step(1)
q_fire_full = [q for q in QUADS if q["sprite"] == "fire_full.png"][0]
fire_w = math.hypot(q_fire_full["x2"] - q_fire_full["x1"], q_fire_full["y2"] - q_fire_full["y1"])

check(
    "10: aim hold reaches full 1.0 scale (90px) after 21 ticks, matching buffer and fire role widths with zero size jump",
    abs(aim_w - 90.0) < 1e-4 and abs(aim_w - buf_w) < 1e-4 and abs(aim_w - fire_w) < 1e-4,
    f"aim_w={aim_w:.4f}, buf_w={buf_w:.4f}, fire_w={fire_w:.4f}",
)

check(
    "11: draw_hand=false parks the engine hand on the worm and shrinks it away",
    abs(float(bow_hold["hand_radius"]) - 0.01) < 1e-6
    and abs(float(bow_hold["hand_scale"]) - 0.001) < 1e-9,
    f"radius={bow_hold['hand_radius']}, scale={bow_hold['hand_scale']}",
)

check(
    "12: an aim clamp parks and shrinks the engine hand too",
    abs(float(clamp_hold["hand_radius"]) - 0.01) < 1e-6
    and abs(float(clamp_hold["hand_scale"]) - 0.001) < 1e-9,
    f"radius={clamp_hold['hand_radius']}, scale={clamp_hold['hand_scale']}",
)

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("hold states harness: all checks passed")
