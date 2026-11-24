-- PX's do_custom_explosion, without the electric taze: falloff damage, push,
-- a crater and one px_effects burst. PX originals:
-- wklua_and_px/utils/custom_explosion.c:17-295. The caller silences the stock
-- blast (explosion.power = 0) and calls this from on_explode.
--
-- PX walks Env->Objs and sends M_GUNEXP to every object in range (:46-125).
-- wa.world.blast is that walk: worms, mines, crates, oil drums, missiles,
-- arrows, and Lua actors whose `body.hit_by` takes blasts. Objects receive an
-- ordinary hit, so a mine can be set off by the blast, as in PX.
-- `o.kind` names the hit the engine delivers ("taze", a bundle's own kind);
-- left out, it is a plain blast. `o.poison` is a dose (`worm:poison(n)`), not a
-- hit kind: it is a second call on every live worm in the blast's area, after
-- the blast. A damage-0 cloud has no blast area to speak of, so the dose covers
-- the burst's visual radius when that is larger, which is what lets a poison
-- preset with `damage = 0` reach the worms standing in its cloud.

local M = {}

local EFFECT_KEYS = { "radius", "r", "g", "b", "noise", "duration", "fade",
  "grow", "live", "segments", "thickness", "core", "ellipse", "rebuffer",
  "smoke", "depth", "preset", "owner", "seed", "random", "rainbow",
  "style", "shape", "points", "spin", "glow", "ring" }

local function numbers(o)
  local damage = math.floor(o.damage or o.power or 0)
  local push = o.push or o.push_pct or 0
  local radius = o.radius or (damage + 2) * 2
  local hole = o.hole or o.destroy_radius or damage
  local effect = o.effect_radius or math.floor((damage + 2) / 2)
  return damage, push, radius, hole, effect
end

-- The dose has to reach every worm the blast could have hurt, and a damage-0
-- cloud has to reach what it draws. Those are two different radii: `radius`
-- is the blast's (PX derives it from damage when the caller omits it) and the
-- burst's own `radius` is the cloud's. Cover the larger of the two.
local function poison_area(o, radius, effect_radius)
  if o.effect == false then return radius end
  local burst = effect_radius
  if type(o.effect) == "table" then
    burst = tonumber(o.effect.radius) or burst
  end
  return burst > radius and burst or radius
end

local function dead(w)
  return w.state == "dying" or w.state == "drowning" or w.state == "dead"
end

local function play_sound(o)
  local s = o.sound
  if s == nil then return end
  if s == true then s = wa.random(69, 71) end
  if s and s ~= false and o.owner then wa.sound.play(o.owner, s) end
end

-- o = { x, y, damage, push, radius, hole, destroy, owner, sound,
--       effect = false | px_effects burst fields, fx = module }
function M.explode(o)
  o = o or {}
  local x, y = o.x, o.y
  if not x or not y then return 0 end
  local damage, push, radius, hole, effect_radius = numbers(o)
  local fx = o.fx or require("wf-lib/effects/px_effects")
  local hits = 0

  play_sound(o)

  if damage > 0 and radius > 0 then
    if type(o.on_taze_mine) == "function" and wa.mines and wa.mines.all then
      local r2_mine = radius * radius
      for _, m in ipairs(wa.mines.all()) do
        local dx, dy = (m.x or 0) - x, (m.y or 0) - y
        if dx * dx + dy * dy <= r2_mine then
          pcall(o.on_taze_mine, m, o.owner)
        end
      end
    end
    -- The engine's blast leaves out a worm already at 0 HP that WA has not
    -- started killing; PX's object loop does not, and such a worm still
    -- launches. Remember those before the blast, or a worm the blast kills
    -- would be hit a second time here.
    local zero = {}
    for _, w in ipairs(wa.worms.all()) do
      if w.hp <= 0 and not dead(w) then zero[w.id] = true end
    end
    hits = wa.world.blast{ owner = o.owner, x = x, y = y, damage = damage,
      radius = math.ceil(radius), push_pct = push, kind = o.kind }
    local r2 = radius * radius
    for _, w in ipairs(wa.worms.all()) do
      if zero[w.id] and not dead(w) then
        local dx, dy = w.x - x, w.y - y
        local d2 = dx * dx + dy * dy
        if d2 < r2 then
          local dist = math.sqrt(d2)
          local dmg = math.floor(damage * (radius - dist) / radius)
          if dmg > 0 then
            local px, py = 0, 0
            if dist > 0.001 then
              local force = (dmg / 5) * (push / 100)
              px, py = dx / dist * force, dy / dist * force
            end
            w:hit{ amount = dmg, vx = px, vy = py }
            hits = hits + 1
          end
        end
      end
    end
  end

  local poison = math.floor(tonumber(o.poison) or 0)
  if poison > 0 then
    poison = math.max(1, math.min(1000, poison))
    local dose_radius = poison_area(o, radius, effect_radius)
    local r2 = dose_radius * dose_radius
    for _, w in ipairs(wa.worms.all()) do
      if w.hp > 0 and not dead(w) then
        local dx, dy = (w.x or 0) - x, (w.y or 0) - y
        if dx * dx + dy * dy <= r2 then
          pcall(w.poison, w, poison)
        end
      end
    end
  end

  if o.destroy ~= false and hole > 0 and fx.crater then
    fx.crater{ x = x, y = y, radius = hole }
  end

  if o.effect ~= false and fx.burst then
    local spec = {}
    local src = type(o.effect) == "table" and o.effect or {}
    for i = 1, #EFFECT_KEYS do
      local k = EFFECT_KEYS[i]
      if src[k] ~= nil then spec[k] = src[k] end
    end
    spec.x, spec.y = x, y
    spec.radius = spec.radius or effect_radius
    spec.owner = spec.owner or o.owner
    fx.burst(spec)
  end
  return hits
end

return M
