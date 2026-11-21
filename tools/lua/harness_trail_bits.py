"""Run the generated WF 51 weapon (trail target "bit") against the real SDK.

The bug this pins: `sb.flight` and the ribbon trail both register
`wa.on.missile_frame`, and the engine runs a mod's handlers in registration
order. The generated trail hook used to be written before `sb.flight`, so on a
missile's first frame `sb.role` was nil, the fallback read that as "not a bit",
and every cluster bit flew bare. A burst listed on the round's last frame is
also deliberately undecided for one frame, so the hook has to wait instead of
guessing.

    bun run tools/gen_test_pack.ts
    python tools/lua/harness_trail_bits.py     # exits 1 on a failure

It is a development aid, not part of `bun run lint` / `build`: `lupa` is not a
project dependency.
"""
import os
import sys

try:
    import lupa
except ImportError:
    print('lupa is not installed: python -m pip install lupa')
    sys.exit(0)

from lupa import LuaRuntime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEAPON = os.path.join(ROOT, 'test_pack', 'wftest_pack', 'weapons', '51_trail_bits_only.lua')
WEAPON_ID = 'wftest.51_trail_bits_only'
SDK = os.path.join(ROOT, 'spec', 'lua_sdk')
TRAIL = os.path.join(SDK, 'effects_sdk', 'libs', 'trail.lua')
EFFECTS = os.path.join(SDK, 'effects_sdk', 'libs', 'px_effects.lua')
BUILDER = os.path.join(SDK, 'wfws_sdk', 'lib', 'wfws_sprite_builder.lua')

CHECKS = []


def check(name, ok, detail=''):
    CHECKS.append((name, bool(ok), detail))
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else '  (' + str(detail) + ')'))


if not os.path.exists(WEAPON):
    print('missing ' + WEAPON)
    print('run `bun run tools/gen_test_pack.ts` first')
    sys.exit(1)

lua = LuaRuntime(unpack_returned_tuples=True)

# The fake engine. Handler lists, not one slot each: the whole point is that
# `missile_frame` runs in registration order, and a single slot would hide the
# bug the harness exists to catch.
WA = '''
local state = {
  frame = 0, draws = 0, ribbons = 0, spawned = 0,
  missiles = {}, brains = {}, hooks = { missile_frame = {}, draw = {} },
}
local worm = { id = 17, turn = true, weapon = "%s", x = 480.0, y = 400.0,
  vx = 0.0, vy = 0.0, facing = 1, aim = 0.5, hp = 100,
  aiming = true, state = "ready" }
state.worm = worm

wa = {}
wa.log = function(...) end
wa.depth = { FRONT = 1, OBJECTS = 2, EFFECTS = 3 }
wa.msg = { FIRE_WEAPON = 1, FRAME_FINISH = 2 }
wa.random = function(a, b) return a end
wa.math = {
  sin = math.sin, cos = math.cos,
  atan = function(y, x) return math.atan(y, x) end,
}
wa.world = {
  frame = function() return state.frame end,
  keys = function() return { space = false, digit = false } end,
}
wa.worms = { all = function() return { worm } end }
wa.missiles = { all = function() return state.missiles end }
wa.land = {
  solid = function() return false end,
  trace = function() return nil end,
}
wa.sound = { play = function() end }
wa.sprites = { exists = function() return true end }
wa.draw = {
  ribbon = function(rib)
    state.draws = state.draws + 1
    state.ribbons = state.ribbons + #rib.points
    return true
  end,
  quad = function(q) state.draws = state.draws + 1; return true end,
  random = function(a, b) return a end,
}
wa.weapons = {
  replace = function(t) wa.claim = t end,
  hold_sheet = function() end,
}
wa.actors = { spawn = function(spec)
  assert(spec.collide == nil and spec.as_object == nil, "API 5 rejects collide/as_object")
  assert(spec.gravity == nil or type(spec.gravity) == "number", "API 5 requires numeric gravity")
  state.spawned = state.spawned + 1
  table.insert(state.brains, spec.on)
  return {
    remove = function() end,
    frame = function() end,
    gfx = function() end,
    x = 0.0, y = 0.0, vx = 0.0, vy = 0.0,
  }
end }
wa.on = {
  missile_frame = function(fn) table.insert(state.hooks.missile_frame, fn) end,
  draw = function(fn) table.insert(state.hooks.draw, fn) end,
  worm_message = function(fn, opts) state.worm_hook = fn end,
  body_move = function(fn, opts) end,
  hud = function() end,
}

function dispatch_missile(m)
  for _, fn in ipairs(state.hooks.missile_frame) do fn(m) end
end
function step()
  for _, brain in ipairs(state.brains) do brain({ remove = function() end }) end
end
function draw()
  for _, fn in ipairs(state.hooks.draw) do fn() end
end
function setmissiles(list) state.missiles = list end
function getframe() return state.frame end
function advance() state.frame = state.frame + 1 end
function stats() return state.draws, state.ribbons, state.spawned end
return wa
''' % WEAPON_ID

wa = lua.execute(WA)

PACKAGE = '''
local cache = {}
local function stub()
  -- wf-lib/holds is the aim layer library; the builder only re-exports two
  -- tables from it, so a permissive stub is enough here.
  return setmetatable({}, { __index = function() return { 1, 2 } end })
end
function require(name)
  if cache[name] then return cache[name] end
  if name == "wf-lib/holds" then cache[name] = stub(); return cache[name] end
  local files = {
    ["wf-lib/effects/trail"] = "%s",
    ["wf-lib/effects/px_effects"] = "%s",
    ["wf-lib/wfws_sprite_builder"] = "%s",
  }
  local file = assert(files[name], "no file for " .. tostring(name))
  local fh = assert(io.open(file, "r"))
  local src = fh:read("*a")
  fh:close()
  local chunk = assert(load(src, "libs/" .. name))
  cache[name] = chunk()
  return cache[name]
end
''' % (
    TRAIL.replace('\\', '\\\\'),
    EFFECTS.replace('\\', '\\\\'),
    BUILDER.replace('\\', '\\\\'),
)
lua.execute(PACKAGE)

source = open(WEAPON, encoding='utf-8').read()
weapon = lua.execute('return (function()\n' + source + '\nend)()')
ctx = lua.table(id=WEAPON_ID)
weapon['install'](ctx)
check('the weapon installs without raising', True)

# The trail module the weapon loaded, for `trail.has(id)`.
lua.execute('trail = require("wf-lib/effects/trail")')
lua.execute('sb = require("wf-lib/wfws_sprite_builder")')


def missile(mid, x, y, phase='pre', vx=2.0, vy=0.0):
    lua.execute(
        'm = { id = %d, weapon = "%s", x = %f, y = %f, vx = %f, vy = %f, '
        'phase = "%s", sprite = 0 }' % (mid, WEAPON_ID, x, y, vx, vy, phase)
    )
    lua.eval('dispatch_missile(m)')


def has(mid):
    return lua.eval('trail.has(%d)' % mid)


# A round flies for a few frames. The builder classifies it on its first frame
# because `sb.flight` registered before the trail hook; the trail target is
# "bit", so it must stay bare.
lua.eval('advance()')
missile(101, 500.0, 400.0)
missile(101, 502.0, 400.0, phase='post')
lua.eval('step()')
lua.eval('draw()')
check(
    'the round itself gets no ribbon',
    not has(101),
    'target "bit" trailed the round: the trail hook asked before the builder had decided',
)
check(
    'the builder knows the round',
    lua.eval('sb.role(101)') == 'main',
    lua.eval('sb.role(101)'),
)

# The burst: WA can list the round one last time and its bits on that same frame,
# at the round's position. Both the builder and the hook have to leave the bits
# undecided until the next frame.
lua.eval('advance()')
missile(101, 518.0, 400.0)
for i in range(2, 7):
    missile(100 + i, 520.0, 396.0 + i, vx=1.0, vy=0.5)
lua.eval('step()')
check(
    'the ambiguous burst frame attaches nothing yet',
    all(not has(100 + i) for i in range(2, 7)),
    'a bit was decided on the frame the round was still listed',
)

# Next frame the round is gone: the bits are at its last position, inside the
# bit window, so the builder calls them bits and the hook trails each one.
lua.eval('advance()')
lua.execute('setmissiles({})')
for i in range(2, 7):
    missile(100 + i, 521.0 + i, 396.0 + i, vx=1.0, vy=0.5)
lua.eval('step()')
check(
    'every cluster bit gets its ribbon once the builder has decided',
    all(has(100 + i) for i in range(2, 7)),
    [has(100 + i) for i in range(2, 7)],
)
check(
    'and they are classified as bits',
    all(lua.eval('sb.role(%d)' % (100 + i)) == 'bit' for i in range(2, 7)),
    [lua.eval('sb.role(%d)' % (100 + i)) for i in range(2, 7)],
)
check('the round still has none', not has(101))

# The ribbon really draws: the library samples it on the post phase, one point
# per frame, and needs two before the draw callback paints anything.
for frame in range(2):
    if frame:
        lua.eval('advance()')
    for i in range(2, 7):
        missile(100 + i, 523.0 + i + frame, 397.0 + i + frame, vx=1.0, vy=0.5)
        missile(100 + i, 525.0 + i + frame, 398.0 + i + frame, phase='post', vx=1.0, vy=0.5)
    lua.eval('step()')
before = lua.eval('stats()')[1]
lua.eval('draw()')
after = lua.eval('stats()')[1]
check('the ribbons reach the draw callback', after > before, after - before)

failed = [c for c in CHECKS if not c[1]]
print()
if failed:
    print('%d check(s) failed' % len(failed))
    sys.exit(1)
print('all checks passed')
