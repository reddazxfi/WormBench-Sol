-- wfws_trail.lua: custom brush particle trails for the flight sprite builder.
--
-- One pool per role. A pool owns a wa.draw.brush made at install time (the
-- brush remembers the component that created it), flat SoA arrays for every
-- particle, and one reused buffer for brush:boxes. Nothing here allocates a
-- table per particle or per drawn frame.
--
-- Simulation is driven from two places, both idempotent for a world frame:
-- M.emit advances first so a headless missile_frame harness sees the same
-- particles as the renderer, and FRAME_FINISH advances lingering smoke after
-- the missile itself is gone.
--
-- Pure data and functions at load: wa is touched only inside M.create and the
-- callbacks it registers.

local M = {}

local POOLS = {}
local POOL_COUNT = 0
local LAST_STEP = -1
local STEP_HOOKED = false
local DRAW_HOOKED = false
local U32 = 4294967296.0

local function frame_now()
  return (wa.world.frame and wa.world.frame()) or 0
end

-- 0 <= r < 1 from WA's only deterministic random source.
local function rand()
  return wa.random() / U32
end

local function clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

local function num(v, fallback)
  if type(v) == "number" then return v end
  return fallback
end

local function color_byte(v)
  local n = math.floor(num(v, 255) + 0.5)
  if n < 0 then return 0 end
  if n > 255 then return 255 end
  return n
end

-- Layered depth as a number. Generator emits wa.depth.*, but an imported or
-- hand written bundle may carry the band name.
local function depth_value(v)
  local d = wa.depth or {}
  if type(v) == "string" then
    if v == "BEHIND" then return d.BEHIND or 0x0 end
    if v == "FRONT" then return d.FRONT or 0x20000 end
    return d.EFFECTS or 0x10000
  end
  if type(v) == "number" then return v end
  return d.EFFECTS or 0x10000
end

-- Six sector hue wheel. No HSV table, no table allocation.
local function hue_rgb(h)
  local x = h * 6.0
  local sector = math.floor(x)
  local f = x - sector
  if sector < 1 then return 255, math.floor(f * 255), 0
  elseif sector < 2 then return math.floor((1 - f) * 255), 255, 0
  elseif sector < 3 then return 0, 255, math.floor(f * 255)
  elseif sector < 4 then return 0, math.floor((1 - f) * 255), 255
  elseif sector < 5 then return math.floor(f * 255), 0, 255
  else return 255, 0, math.floor((1 - f) * 255) end
end

local function step_all(now)
  if now == nil then now = frame_now() end
  if now <= LAST_STEP then return end
  LAST_STEP = now
  for p = 1, POOL_COUNT do
    local pool = POOLS[p]
    local n = pool.n
    local i = 1
    while i <= n do
      local age = pool.page[i] + 1
      if age >= pool.plife[i] then
        if i ~= n then
          pool.px[i] = pool.px[n]
          pool.py[i] = pool.py[n]
          pool.pvx[i] = pool.pvx[n]
          pool.pvy[i] = pool.pvy[n]
          pool.page[i] = pool.page[n]
          pool.plife[i] = pool.plife[n]
          pool.prot[i] = pool.prot[n]
          pool.pspin[i] = pool.pspin[n]
          pool.pframe0[i] = pool.pframe0[n]
        end
        n = n - 1
      else
        pool.page[i] = age
        local drag = pool.drag
        pool.pvx[i] = pool.pvx[i] * drag
        pool.pvy[i] = pool.pvy[i] * drag + pool.gravity
        pool.px[i] = pool.px[i] + pool.pvx[i]
        pool.py[i] = pool.py[i] + pool.pvy[i]
        pool.prot[i] = pool.prot[i] + pool.pspin[i]
        i = i + 1
      end
    end
    pool.n = n
  end
end

local function frame_for(pool, i, t)
  local frames = pool.frames
  if frames <= 1 then return 0 end
  local mode = pool.play_mode
  if mode == "loop" then
    return math.floor((pool.page[i] / 50) * pool.fps) % frames
  elseif mode == "pingpong" then
    local span = 2 * frames - 2
    local k = math.floor(t * span) % span
    if k < frames then return k end
    return span - k
  elseif mode == "random" then
    return pool.pframe0[i]
  end
  return math.min(frames - 1, math.floor(t * frames))
end

local function draw_all()
  local frac = 0
  if wa.draw.fraction then
    local ok, value = pcall(wa.draw.fraction)
    if ok and type(value) == "number" then frac = clamp(value, 0, 1) end
  end
  for p = 1, POOL_COUNT do
    local pool = POOLS[p]
    local n = pool.n
    if n > 0 and pool.brush then
      local out = 0
      local buf = pool.buf
      local r0, g0, b0 = pool.r0, pool.g0, pool.b0
      local r1, g1, b1 = pool.r1, pool.g1, pool.b1
      local has_end = pool.has_end
      local rainbow = pool.rainbow
      local now = LAST_STEP > 0 and LAST_STEP or 0
      for i = 1, n do
        local t = clamp((pool.page[i] + frac) / pool.plife[i], 0, 1)
        local scale = pool.scale_start + (pool.scale_end - pool.scale_start) * t
        local w = pool.cell_w * scale
        local h = pool.cell_h * scale
        local alpha = clamp(pool.alpha_start + (pool.alpha_end - pool.alpha_start) * t, 0, 1)
        local a = math.floor(alpha * 255 + 0.5)
        if a > 0 and w >= 0.5 and h >= 0.5 then
          local r, g, b
          if rainbow then
            local hue = (now * 0.04 + i * 0.02) % 1
            r, g, b = hue_rgb(hue)
          elseif has_end then
            r = math.floor(r0 + (r1 - r0) * t + 0.5)
            g = math.floor(g0 + (g1 - g0) * t + 0.5)
            b = math.floor(b0 + (b1 - b0) * t + 0.5)
          else
            r, g, b = r0, g0, b0
          end
          local o = out * 7
          buf[o + 1] = pool.px[i] + pool.pvx[i] * frac
          buf[o + 2] = pool.py[i] + pool.pvy[i] * frac
          buf[o + 3] = w
          buf[o + 4] = h
          buf[o + 5] = pool.prot[i] + pool.pspin[i] * frac
          buf[o + 6] = frame_for(pool, i, t)
          buf[o + 7] = (a << 24) | (color_byte(r) << 16) | (color_byte(g) << 8) | color_byte(b)
          out = out + 1
        end
      end
      if out > 0 then pool.brush:boxes(buf, out) end
    end
  end
end

local function ensure_hooks()
  if not STEP_HOOKED then
    STEP_HOOKED = true
    wa.on.worm_message(function()
      step_all(frame_now())
    end, { msgs = { wa.msg.FRAME_FINISH } })
  end
  if not DRAW_HOOKED and wa.draw and wa.draw.brush then
    DRAW_HOOKED = true
    wa.on.draw(function() draw_all() end)
  end
end

local function spawn(pool, id, x, y, vx, vy, drawn_deg, facing)
  local i = pool.n + 1
  if i > pool.cap then i = 1 end
  local r = rand()
  local r2 = rand()
  local r3 = rand()

  local ox, oy = pool.off_x, pool.off_y
  if facing < 0 then ox = -ox end
  local heading = math.rad(drawn_deg)
  local hc, hs = wa.math.cos(heading), wa.math.sin(heading)
  local sx = x + ox * hc - oy * hs
  local sy = y + ox * hs + oy * hc

  local jitter = pool.jitter
  if jitter > 0 then
    local ja = r2 * math.pi * 2
    local jr = r3 * jitter
    sx = sx + wa.math.cos(ja) * jr
    sy = sy + wa.math.sin(ja) * jr
  end

  local speed2 = vx * vx + vy * vy
  local base_ang
  if speed2 > 0.000001 then
    base_ang = wa.math.atan(-vy, -vx)
  else
    base_ang = heading + math.pi
  end
  local spread = math.rad(pool.spread)
  local ang = base_ang + (r - 0.5) * spread
  local mag = (pool.speed / 100.0) * (0.7 + 0.6 * r2)
  local pvx = vx * pool.inherit + wa.math.cos(ang) * mag
  local pvy = vy * pool.inherit + wa.math.sin(ang) * mag

  local rot = 0
  local rotate = pool.rotate
  if rotate == "random" then
    rot = rand() * math.pi * 2
  elseif rotate == "align" then
    rot = ang
  elseif rotate == "missile" then
    rot = heading
  end

  local spin = math.rad(pool.spin_min + (pool.spin_max - pool.spin_min) * r3)
  local life = math.floor(pool.life * (1 + ((r2 * 2) - 1) * pool.life_jitter) + 0.5)
  if life < 2 then life = 2 end
  if life > 180 then life = 180 end

  pool.px[i] = sx
  pool.py[i] = sy
  pool.pvx[i] = pvx
  pool.pvy[i] = pvy
  pool.page[i] = 0
  pool.plife[i] = life
  pool.prot[i] = rot
  pool.pspin[i] = spin
  pool.pframe0[i] = pool.frames > 1 and wa.random(0, pool.frames - 1) or 0
  if i > pool.n then pool.n = i end
end

--- Build one role's pool. Must run inside install(), where wa.draw.brush knows
--- the component that owns the sheet.
function M.create(spec)
  if type(spec) ~= "table" or type(spec.sheet) ~= "string" then return nil end
  ensure_hooks()
  local cap = math.floor(clamp(num(spec.max_particles, 160), 16, 512) + 0.5)
  local pool = {
    cap = cap,
    n = 0,
    cell_w = clamp(num(spec.cell_w, 16), 1, 512),
    cell_h = clamp(num(spec.cell_h, 16), 1, 512),
    frames = math.floor(clamp(num(spec.frames, 1), 1, 64) + 0.5),
    play_mode = spec.play_mode or "lifetime",
    fps = clamp(num(spec.fps, 15), 1, 60),
    power = clamp(num(spec.power, 25), 0, 100),
    speed = clamp(num(spec.speed, 120), 0, 500),
    bubbles = clamp(num(spec.bubbles, 0), 0, 16),
    life = math.floor(clamp(num(spec.life, 24), 4, 180) + 0.5),
    life_jitter = clamp(num(spec.life_jitter, 0.2), 0, 0.8),
    scale_start = clamp(num(spec.scale_start, 1), 0.1, 6),
    scale_end = clamp(num(spec.scale_end, 0.15), 0, 6),
    alpha_start = clamp(num(spec.alpha_start, 0.9), 0, 1),
    alpha_end = clamp(num(spec.alpha_end, 0), 0, 1),
    rotate = spec.rotate or "random",
    spin_min = clamp(num(spec.spin_min, -4), -30, 30),
    spin_max = clamp(num(spec.spin_max, 4), -30, 30),
    gravity = clamp(num(spec.gravity, -0.04), -2, 2),
    drag = clamp(num(spec.drag, 0.94), 0.75, 1),
    spread = clamp(num(spec.spread, 28), 0, 360),
    jitter = clamp(num(spec.jitter, 2), 0, 24),
    inherit = clamp(num(spec.inherit_vel, 0.15), -0.5, 1),
    off_x = clamp(num(spec.offset_x, 0), -128, 128),
    off_y = clamp(num(spec.offset_y, 0), -128, 128),
    r0 = color_byte(spec.r),
    g0 = color_byte(spec.g),
    b0 = color_byte(spec.b),
    r1 = color_byte(spec.r_end or spec.r),
    g1 = color_byte(spec.g_end or spec.g),
    b1 = color_byte(spec.b_end or spec.b),
    has_end = spec.r_end ~= nil,
    rainbow = spec.rainbow == true,
    blend = spec.blend == "add" and "add" or "alpha",
    depth = depth_value(spec.depth),
    acc = {},
    buf = {},
    -- Flat SoA arrays. The constructor below fills them; a nil array here
    -- would make the first spawn (and every draw) fail at run time.
    px = {},
    py = {},
    pvx = {},
    pvy = {},
    page = {},
    plife = {},
    prot = {},
    pspin = {},
    pframe0 = {},
    sheet = spec.sheet,
  }
  for i = 1, cap do
    pool.px[i] = 0
    pool.py[i] = 0
    pool.pvx[i] = 0
    pool.pvy[i] = 0
    pool.page[i] = 0
    pool.plife[i] = 1
    pool.prot[i] = 0
    pool.pspin[i] = 0
    pool.pframe0[i] = 0
  end
  for i = 1, cap * 7 do pool.buf[i] = 0 end
  if wa.draw and wa.draw.brush then
    local ok, brush = pcall(wa.draw.brush, {
      sprite = spec.sheet,
      blend = pool.blend,
      depth = pool.depth,
    })
    if ok then pool.brush = brush end
  end
  POOL_COUNT = POOL_COUNT + 1
  POOLS[POOL_COUNT] = pool
  return pool
end

--- Emit this frame's particles and advance every live pool exactly once.
function M.emit(pool, id, x, y, vx, vy, drawn_deg, facing, now)
  if not pool or type(pool.acc) ~= "table" then return end
  step_all(now or frame_now())
  local rate = pool.power / 25.0
  if rate <= 0 then return end
  local acc = (pool.acc[id] or 0) + rate
  local count = math.floor(acc)
  pool.acc[id] = acc - count
  if count <= 0 then return end
  for k = 1, count do
    spawn(pool, id, x, y, vx, vy, drawn_deg, facing)
  end
end

--- Drop a missile's fractional accumulator. The particles it already made
--- stay alive and keep fading.
function M.forget(pool, id)
  if pool and pool.acc then pool.acc[id] = nil end
end

function M.forget_all(id)
  for p = 1, POOL_COUNT do
    local pool = POOLS[p]
    if pool.acc then pool.acc[id] = nil end
  end
end

--- Clear every pool. Harnesses call this between cases.
function M.reset()
  POOLS = {}
  POOL_COUNT = 0
  LAST_STEP = -1
end

--- Advance from a harness that only calls missile_frame callbacks.
function M.step(now)
  step_all(now or frame_now())
end

return M
