"""Check the builder's published identity: `sb.role(id)`.

`sb.role` is what the trail's attach and an explosion hook read to tell the round
from its cluster bits, so it has to answer the same thing the classifier decided,
for a missile it has seen, and `nil` for one it has not.

Runs the real `spec/lua_sdk/wfws_sdk/lib/wfws_sprite_builder.lua` under lupa with
a faked `wa`. Only the `pre` phase is walked (the identity is decided on first
sight, before any follower actor exists), so no actor needs faking.

    python tools/lua/check_roles.py
"""

import sys
from pathlib import Path

from lupa import LuaRuntime

ROOT = Path(__file__).resolve().parents[2]
SDK = ROOT / "spec" / "lua_sdk" / "wfws_sdk" / "lib" / "wfws_sprite_builder.lua"
SWING = ROOT / "spec" / "lua_sdk" / "wfws_sdk" / "lib" / "wfws_swing.lua"

lua = LuaRuntime(unpack_returned_tuples=True)

lua.execute(
    r"""
hook = nil
wa = {
  log = function() end,
  msg = { FRAME_FINISH = 2 },
  math = { sin = math.sin, cos = math.cos, atan = function(x, y) return math.atan(x, y) end },
  world = {
    keys = function() return { space = false } end,
    frame = function() return 1 end,
  },
  worms = { all = function() return {} end },
  on = {
    missile_frame = function(fn) hook = fn end,
    worm_message = function() end,
    draw = function() end,
  },
  draw = { quad = function() end },
  weapons = { hold_sheet = function() end },
  land = { solid = function() return false end },
  actors = { spawn = function() error("no actor expected in a pre frame") end },
}
package.preload["wf-lib/holds"] = function() return { PX_POSTURE = {}, PX_HANDS = {} } end
package.preload["wf-lib/wfws_swing"] = function() return assert(loadfile(%r))() end
""" % str(SWING).replace("\\", "/")
)

sb = lua.execute(
    'package.path = %r .. "/?.lua;" .. package.path; return assert(loadfile(%r))()'
    % (str(ROOT / "spec" / "lua_sdk" / "wfws_sdk"), str(SDK).replace("\\", "/"))
)

ctx = lua.table()
ctx.id = "test.roles"
spec = lua.table_from(
    {
        "weapon": "test.roles",
        "sheet": "sprites/test.roles/missile.png",
        "anim": "track",
        # The bit role: any nonzero sprite at first sight is a bit while a bits
        # table exists, which is the classifier this check exercises.
        "bits": lua.table_from({"sheet": "sprites/test.roles/bit.png", "anim": "track"}),
        "log": False,
    }
)
sb.flight(ctx, spec)
hook = lua.globals().hook

failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  " + detail) if detail else ""))
    if not ok:
        failures.append(name)


def pre(mid, sprite, weapon="test.roles"):
    m = lua.table_from(
        {
            "id": mid,
            "weapon": weapon,
            "phase": "pre",
            "sprite": sprite,
            "x": 100.0,
            "y": 100.0,
            "vx": 1.0,
            "vy": 0.0,
        }
    )
    hook(m)


# The fired round: the builder zeroes the record sprite, so it is seen as 0.
pre(11, 0)
# A cluster bit: born with the record's cluster sprite, nonzero.
pre(12, 245)
# Once classified, the answer survives the sprite being zeroed afterwards.
pre(11, 0)

check("the round answers main", sb.role(11) == "main", repr(sb.role(11)))
check("a bit answers bit", sb.role(12) == "bit", repr(sb.role(12)))
check("a missile never seen answers nil", sb.role(99) is None, repr(sb.role(99)))
check("no id answers nil", sb.role(None) is None, repr(sb.role(None)))

# It is the same table `sb.heading` keeps, so a despawn does not lose the answer:
# `gone` clears `kind`, not the role memory. A second sighting after the sprite
# is zeroed must not reclassify the bit as the round.
pre(12, 0)
check("a bit stays a bit", sb.role(12) == "bit", repr(sb.role(12)))

# Another weapon's missiles are not this builder's business.
pre(13, 245, weapon="stock.grenade")
check("another weapon is not classified", sb.role(13) is None, repr(sb.role(13)))

# Bounded memory: 300 distinct missiles must not grow the table for ever.
for mid in range(1000, 1300):
    pre(mid, 245)
check("the role memory is bounded", sb.role(1001) is None, repr(sb.role(1001)))
check("recent ids are still known", sb.role(1299) == "bit", repr(sb.role(1299)))

if failures:
    print("\n%d check(s) failed: %s" % (len(failures), ", ".join(failures)))
    sys.exit(1)
print("\nall checks passed")
