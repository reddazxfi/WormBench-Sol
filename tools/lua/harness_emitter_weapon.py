"""Run the generated WF 56 weapon against the real SDK with a fake `wa`.

This is the case the in-game log caught: `fx.emitter{ spark = true }` indexed a
boolean and threw, which took `on_fire` down and drew nothing. The dev harness
covers the SDK functions directly; this one loads a real generated weapon file
and drives `install`, the `body_move` hook and `on_fire` through it.

    python tools/lua/harness_emitter_weapon.py
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
WEAPON = os.path.join(ROOT, 'test_pack', 'wftest_pack', 'weapons', '56_emitter_ring.lua')
SDK = os.path.join(ROOT, 'spec', 'lua_sdk', 'effects_sdk', 'libs')
TRAIL = os.path.join(SDK, 'trail.lua')
EFFECTS = os.path.join(SDK, 'px_effects.lua')

CHECKS = []


def check(name, ok, detail=''):
    CHECKS.append((name, bool(ok), detail))
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else '  (' + str(detail) + ')'))


lua = LuaRuntime(unpack_returned_tuples=True)

WA = '''
local state = { spawned = 0, drawn = 0, ribbons = 0, worms = {}, a = 0 }
local worm = { id = 17, turn = true, weapon = "wftest.56_emitter_ring",
  x = 480.0, y = 400.0, vx = 0.0, vy = 0.0, facing = 1, aim = 0.5, hp = 100,
  aiming = true, state = "ready" }
state.worm = worm

wa = {}
wa.log = function(...) end
wa.depth = { FRONT = 1, OBJECTS = 2, EFFECTS = 3 }
wa.msg = { FIRE_WEAPON = 1, FRAME_FINISH = 2 }
wa.random = function(a, b) state.a = state.a + 1; return a end
wa.math = { sin = math.sin, cos = math.cos, atan = function(y, x) return math.atan(y, x) end }
wa.world = { frame = function() return state.a end }
wa.worms = { all = function() return { worm } end }
wa.missiles = { all = function() return state.missiles or {} end }
wa.land = { solid = function() return false end, trace = function() return nil end }
wa.sound = { play = function() end }
wa.weapons = { replace = function(t) wa.hooks.claim = t end, hold_sheet = function() end }wa.hooks = { worm_message = nil, missile_frame = nil, draw = nil, fire = nil }
wa.on = {
  draw = function(fn) wa.hooks.draw = fn end,
  body_move = function(fn, opts) wa.hooks.body_move = fn; wa.hooks.body_move_opts = opts end,
  worm_message = function(fn, opts) wa.hooks.worm_message = fn; wa.hooks.worm_opts = opts end,
  missile_frame = function(fn) wa.hooks.missile_frame = fn end,
  hud = function() end,
}
wa.actors = { spawn = function(spec)
  assert(spec.collide == nil and spec.as_object == nil, "API 5 rejects collide/as_object")
  assert(spec.gravity == nil or type(spec.gravity) == "number", "API 5 requires numeric gravity")
  state.spawned = state.spawned + 1
  state.brains = state.brains or {}
  table.insert(state.brains, spec.on)
  return { remove = function() end }
end }
wa.draw = {
  ribbon = function(rib)
    state.drawn = state.drawn + 1
    state.ribbons = state.ribbons + #rib.points
    -- The ring is the only closed pass this big (segments + 1 points); the
    -- reach bolts are 15 and the emitter ribbon at most 14.
    if #rib.points >= 20 then state.ring_passes = (state.ring_passes or 0) + 1 end
    return true
  end,
  quad = function(q) state.drawn = state.drawn + 1; return true end,
  random = function(a, b) return a end,
}
wa.sprites = { exists = function() return true end }

function step()
  local body = { remove = function() end }
  for _, brain in ipairs(state.brains or {}) do brain(body) end
end
function fire()
  if wa.hooks.claim and wa.hooks.claim.on_fire then
    wa.hooks.claim.on_fire({ worm = worm })
  end
end
function has_fire()
  return wa.hooks.claim ~= nil and wa.hooks.claim.on_fire ~= nil
end
function set_turn(on)
  worm.turn = on and true or false
end
function set_aim(on)
  worm.aiming = on and true or false
  worm.state = on and "ready" or "standing"
end
function set_weapon(name) worm.weapon = name end
function draw() if wa.hooks.draw then wa.hooks.draw() end end
function move()
  state.a = state.a + 1
  if wa.hooks.worm_message then wa.hooks.worm_message({ msg = wa.msg.FRAME_FINISH }) end
end
function missile(m)
  if wa.hooks.missile_frame then wa.hooks.missile_frame(m) end
end
function stats() return state.spawned, state.drawn, state.ribbons end
function rings() return state.ring_passes or 0 end
function setmissiles(list) state.missiles = list end
return wa
'''

wa = lua.execute(WA)

# The SDK modules load through `require`, exactly as a bundle does.
PACKAGE = '''
local cache = {}
local function stub()
  -- wf-lib/holds is the aim layer library. Its constants are only copied into the
  -- claim table here, so a permissive stub is enough.
  return setmetatable({}, { __index = function() return { 1, 2 } end })
end
function require(name)
  if cache[name] then return cache[name] end
  if name == "wf-lib/holds" then cache[name] = stub(); return cache[name] end
  local file = name == "wf-lib/effects/trail" and "%s" or "%s"
  local fh = assert(io.open(file, "r"))
  local src = fh:read("*a")
  fh:close()
  local chunk = assert(load(src, "libs/" .. name))
  cache[name] = chunk()
  return cache[name]
end
''' % (TRAIL.replace('\\', '\\\\'), EFFECTS.replace('\\', '\\\\'))
lua.execute(PACKAGE)

source = open(WEAPON, encoding='utf-8').read()
weapon = lua.execute('return (function()\n' + source + '\nend)()')

ctx = lua.table(id='wftest.56_emitter_ring')
install = weapon['install']
install(ctx)

check('the weapon installs without raising', True)

# Aiming: FRAME_FINISH runs every tick even while standing still and reads the
# active turn worm from wa.worms.all().
for _ in range(4):
    lua.eval('move()')
    lua.eval('step()')

# The drivers are spawned lazily, on the first `fx.emitter` of the match.
spawned, drawn, ribbons = lua.eval('stats()')
check('it installed a driver', spawned >= 1, spawned)
drawn_before = lua.eval('stats()')[2]
lua.eval('draw()')
drawn_after = lua.eval('stats()')[2]
check('aiming draws the emitter', drawn_after > drawn_before, drawn_after - drawn_before)
check('and the ring is among what it draws', lua.eval('rings()') > 0, lua.eval('rings()'))

# The regression: an emitter used to hand itself to the round from the claim's
# `on_fire`, and a claim `on_fire` replaces WA's shot entirely, so the grenade
# never left the worm. It must claim no fire handler at all.
check('the claim writes no on_fire', lua.eval('has_fire()') is False, lua.eval('has_fire()'))

# A missile of this weapon appears (WA built it): the missile_frame latch adopts
# it and points the emitter at it.
lua.execute('''
m = { id = 501, weapon = "wftest.56_emitter_ring", x = 500.0, y = 380.0,
  vx = 3.0, vy = -2.0, phase = "pre" }
setmissiles({ m })
''')
lua.eval('missile(m)')
for _ in range(6):
    lua.eval('move()')
    lua.eval('step()')
lua.eval('draw()')
check('it keeps drawing on the round', lua.eval('stats()')[2] > drawn_after, lua.eval('stats()')[2])

# The round is gone: the cached position goes stale and the follower returns
# nothing, so the emitter and its ring end with the round instead of staying on
# the map. The turn also ends here, so the aiming effect may not respawn.
lua.eval('setmissiles({})')
lua.eval('set_turn(false)')
for _ in range(120):
    lua.eval('move()')
    lua.eval('step()')
still = lua.eval('stats()')[2]
lua.eval('draw()')
check('the emitter ends with the round', lua.eval('stats()')[2] == still, lua.eval('stats()')[2] - still)

# A different weapon selected removes the aiming effect too.
lua.eval('set_turn(true)')
lua.eval('set_weapon("stock.grenade")')
for _ in range(120):
    lua.eval('move()')
    lua.eval('step()')
still = lua.eval('stats()')[2]
lua.eval('draw()')
check('leaving the weapon ends the aim emitter', lua.eval('stats()')[2] == still, lua.eval('stats()')[2] - still)

failed = [c for c in CHECKS if not c[1]]
print()
if failed:
    print('%d check(s) failed' % len(failed))
    sys.exit(1)
print('all checks passed')
