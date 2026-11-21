-- wfws_firing.lua: WFWS Firing Engine (0.1.0)
--
-- Unified, lockstep-deterministic firing library for WormForge weapons:
--   * Native gun + payload launching (`firing.launch`, `firing.actor`)
--   * Flexible custom-cadence sequencer (`firing.sequence`) with initial
--     animation/charge buffer (`first_delay_ms`), uniform or per-shot manual
--     cooldown schedules (`interval_ms` / `intervals_ms`), multi-pellet bursts,
--     angular/axis spread, live aim, and custom `fire_fn` (for beams & tools)
--   * Synchronised digit-key fuse sampler (`firing.fuse`)
--   * Lockstep two-phase homing (`firing.homing.lock` / `step` / `near`)
--   * Firing animation chain (`firing.chain` / `anim` / `anim_frame` / `anim_sheet`)
--
-- Determinism rules:
--   * Uses only `wa.random`, `wa.math.sin/cos/atan`, and `wa.world.frame()`.
--   * Never stores worm userdata handles as table keys; always keys by `worm.id`
--     and `m.id`.
--   * Never mutates simulation state from `wa.on.draw`.

local M = {}

local PI = math.pi
local DEG2RAD = PI / 180
local FRAME_MS = 20 -- 50 Hz simulation tick
local DRAIN_DEFAULT = 10

-- Public per-worm state tables (keyed by integer worm.id)
M.shot = {}       -- rounds fired in the current burst
M.shot_at = {}    -- wa.world.frame() of the last shot
M.fire_frame = M.shot_at -- alias for sb.hold / beam_hitscan_plan
M.is_aiming = {}  -- true while a tracked weapon is out and aiming

local burst_last_frame = {} -- worm_id -> last frame on_fire ran (detects new burst)
local burst_target = {}     -- worm_id -> { x, y } cached target for current burst
local launch_failed_once = {} -- weapon_id -> true (log launch errors once)

-- Active sequences keyed by worm.id
local seq_running = {}
local seq_settled = {}
local seq_cancelled = {}

-- Non-firing WA worm state ids that should interrupt a timed sequence
local NOT_FIRING = {
  [0x65] = true, -- standing
  [0x66] = true, -- walking
  [0x6C] = true, -- punching
  [0x6E] = true, -- drilling
  [0x6F] = true, -- teleporting
  [0x70] = true, -- rope_firing
  [0x71] = true, -- torching
  [0x73] = true, -- rope_rolling
  [0x76] = true, -- getting_up
  [0x77] = true, -- jump_prepare
  [0x78] = true, -- jetpacking
  [0x79] = true, -- jumping
  [0x7A] = true, -- jump_falling
  [0x7B] = true, -- roping
  [0x7C] = true, -- bungee
  [0x7D] = true, -- parachuting
  [0x7E] = true, -- falling / sliding
  [0x7F] = true, -- tumbling
  [0x80] = true, -- hit
  [0x81] = true, -- blasted
  [0x82] = true, -- dying
  [0x85] = true, -- drowning
  [0x86] = true, -- frozen
  [0x87] = true, -- dead
}

-- ---------------------------------------------------------------------------
-- Deterministic math & utility helpers
-- ---------------------------------------------------------------------------

local function now_frame()
  return (wa.world and wa.world.frame and wa.world.frame()) or 0
end

local function ms_to_frames(ms, min_frames)
  local n = tonumber(ms) or 0
  if n <= 0 then return min_frames or 0 end
  local f = math.floor(n / FRAME_MS + 0.5)
  if min_frames and f < min_frames then f = min_frames end
  return f
end

local function rand_signed(amount)
  if not amount or amount <= 0 then return 0 end
  local n = math.floor(amount * 1000 + 0.5)
  if n < 1 then return 0 end
  return wa.random(-n, n) / 1000
end

local function rotate_vec(dx, dy, rad)
  if rad == 0 then return dx, dy end
  local c = wa.math.cos(rad)
  local s = wa.math.sin(rad)
  return dx * c - dy * s, dx * s + dy * c
end

local function aim_dir(worm, aim_clamp)
  local aim = (worm and worm.aim) or 0.5
  if aim_clamp then
    if aim_clamp.lo and aim < aim_clamp.lo then aim = aim_clamp.lo end
    if aim_clamp.hi and aim > aim_clamp.hi then aim = aim_clamp.hi end
  end
  local ang = (1 - aim) * PI
  if worm and (worm.facing or 1) < 0 then
    ang = 2 * PI - ang
  end
  return wa.math.sin(ang), -wa.math.cos(ang)
end

local function unit_dir_from_ev(ev, aim_clamp)
  if ev and ev.vx ~= nil and ev.vy ~= nil then
    local vx, vy = ev.vx, ev.vy
    local len = math.sqrt(vx * vx + vy * vy)
    if len > 0.0001 then
      return vx / len, vy / len
    end
  end
  return aim_dir(ev and ev.worm, aim_clamp)
end

local function clone_table(t)
  if type(t) ~= "table" then return nil end
  local out = {}
  for k, v in next, t do
    if type(v) == "table" then
      out[k] = clone_table(v)
    else
      out[k] = v
    end
  end
  return out
end

local function worm_alive(w)
  return w ~= nil and (w.hp == nil or w.hp > 0)
end

-- ---------------------------------------------------------------------------
-- Synchronised digit-key fuse sampler (1..5 seconds)
-- ---------------------------------------------------------------------------

local fuse_by_worm = {}
local fuse_sampler_installed = false
local fuse_last_frame = -1
local fuse_default_ms = 3000

local FUSE_AIM_STATES = {
  [0x65] = true, -- standing
  [0x66] = true, -- walking
  [0x67] = true, -- aiming
  [0x68] = true, -- power charging
}

function M.install_fuse(default_ms)
  if default_ms and default_ms > 0 then
    fuse_default_ms = math.floor(default_ms)
  end
  if fuse_sampler_installed then return end
  fuse_sampler_installed = true
  wa.on.worm_message(function()
    local f = now_frame()
    if f == fuse_last_frame then return end
    fuse_last_frame = f
    local keys = wa.world and wa.world.keys and wa.world.keys() or nil
    local digit = keys and keys.digit or nil
    if digit == nil or digit < 1 or digit > 5 then return end
    local worms = wa.worms and wa.worms.all and wa.worms.all() or nil
    if not worms then return end
    for i = 1, #worms do
      local w = worms[i]
      if w.turn and (w.aiming or FUSE_AIM_STATES[w.state_id]) then
        fuse_by_worm[w.id] = digit * 1000
      end
    end
  end, { msgs = { wa.msg.FRAME_FINISH } })
end

function M.fuse(record_ms, worm)
  if record_ms and record_ms > 0 then return record_ms end
  local id = worm and worm.id
  if id ~= nil and fuse_by_worm[id] then
    return fuse_by_worm[id]
  end
  return fuse_default_ms
end

-- ---------------------------------------------------------------------------
-- Lockstep two-phase homing (`firing.homing`)
-- Ported from PX's `px_homing.lua` math:
--   * `phase == "post"` (step): eases vx/vy toward target every other frame
--   * `phase == "pre"`  (near): within 50 px, pins speed so it never overshoots
-- ---------------------------------------------------------------------------

local homing_active = {} -- missile_id -> state
local homing_hook_installed = false

local function ensure_homing_hook()
  if homing_hook_installed then return end
  homing_hook_installed = true
  wa.on.missile_frame(function(m)
    local h = homing_active[m.id]
    if not h then return end
    if m.phase == "pre" then
      M.homing.near(m, h)
    else
      if not M.homing.step(m, h) then
        homing_active[m.id] = nil
      end
    end
  end)
end

M.homing = {}

function M.homing.lock(id, target, opts)
  if id == nil or type(target) ~= "table" or target.x == nil or target.y == nil then
    return nil
  end
  ensure_homing_hook()
  opts = opts or {}
  local state = {
    tx = target.x,
    ty = target.y,
    speed = tonumber(opts.speed) or 14,
    turn = tonumber(opts.turn) or 0.2,
    frames = math.max(1, math.floor(tonumber(opts.frames) or 180)),
    wait = math.max(0, math.floor(tonumber(opts.delay) or 0)),
    sound = tonumber(opts.sound) or 0,
    tick = 0,
  }
  homing_active[id] = state
  return state
end

function M.homing.unlock(id)
  if id ~= nil then homing_active[id] = nil end
end

function M.homing.near(m, h)
  if not h or h.wait > 0 or h.frames <= 0 then return end
  local dx = h.tx - m.x
  local dy = h.ty - m.y
  local dist2 = dx * dx + dy * dy
  if dist2 > 2500 or dist2 < 0.0001 then return end -- > 50 px
  local cur = math.sqrt(m.vx * m.vx + m.vy * m.vy)
  if cur < h.speed then
    local dist = math.sqrt(dist2)
    m.vx = (dx / dist) * h.speed
    m.vy = (dy / dist) * h.speed
  end
end

function M.homing.step(m, h)
  if not h then return false end
  if h.wait > 0 then
    if h.wait == 3 and h.sound and h.sound > 0 then
      pcall(wa.sound.play, m, h.sound, 6)
    end
    h.wait = h.wait - 1
    return true
  end
  if h.frames <= 0 then return false end
  h.frames = h.frames - 1
  h.tick = h.tick + 1
  if h.tick % 2 == 1 then
    local dx = h.tx - m.x
    local dy = h.ty - m.y
    local dist = math.sqrt(dx * dx + dy * dy)
    if dist > 0.0001 then
      local nx, ny = dx / dist, dy / dist
      m.vx = m.vx + (nx * h.speed - m.vx) * h.turn
      m.vy = m.vy + (ny * h.speed - m.vy) * h.turn
    end
  end
  return h.frames > 0
end

-- ---------------------------------------------------------------------------
-- Firing animation chain (`buffer` -> `fire` -> `after`)
-- Compatible with `sb.hold` (`from` / `sheet_for`) and `beam_hitscan_plan`.
-- ---------------------------------------------------------------------------

local chains = {} -- worm_id -> { start, buffer, fire, after, weapon, route }

local function clear_chain(id)
  if id ~= nil then chains[id] = nil end
end

function M.chain(worm, spec)
  local id = worm and worm.id
  if id == nil or type(spec) ~= "table" then return nil end
  local buf = spec.buffer or {}
  local fir = spec.fire or {}
  local aft = spec.after or {}
  local b_ticks = math.max(0, math.floor(tonumber(buf.ticks) or 0))
  local f_ticks = math.max(0, math.floor(tonumber(fir.ticks) or 0))
  local a_ticks = math.max(0, math.floor(tonumber(aft.ticks) or 0))
  local st = {
    start = now_frame(),
    weapon = spec.weapon or (worm and worm.weapon),
    route = spec.route or "pose",
    buffer = { ticks = b_ticks, frames = math.max(1, math.floor(buf.frames or 1)), fps = tonumber(buf.fps) or 15, sheet = buf.sheet },
    fire   = { ticks = f_ticks, frames = math.max(1, math.floor(fir.frames or 1)), fps = tonumber(fir.fps) or 15, sheet = fir.sheet },
    after  = { ticks = a_ticks, frames = math.max(1, math.floor(aft.frames or 1)), fps = tonumber(aft.fps) or 15, sheet = aft.sheet },
  }
  chains[id] = st
  return st
end

local function chain_phase(worm)
  local id = worm and worm.id
  if id == nil then return nil end
  local st = chains[id]
  if not st then return nil end
  if not worm_alive(worm) or not worm.turn or (st.weapon and worm.weapon ~= st.weapon) then
    chains[id] = nil
    return nil
  end
  local dt = now_frame() - st.start
  if dt < 0 then dt = 0 end
  local b = st.buffer.ticks
  local f = st.fire.ticks
  local a = st.after.ticks
  if dt < b then
    return "buffer", st.buffer, dt, b - dt
  elseif dt < b + f then
    return "fire", st.fire, dt - b, (b + f) - dt
  elseif dt < b + f + a then
    return "after", st.after, dt - b - f, (b + f + a) - dt
  end
  chains[id] = nil
  return nil
end

function M.anim(worm)
  local phase = chain_phase(worm)
  if phase then return phase end
  local id = worm and worm.id
  if id ~= nil and M.is_aiming[id] then return "aim" end
  return nil
end

function M.anim_frame(worm)
  local _, p, local_dt = chain_phase(worm)
  if not p then return nil end
  local idx = math.floor(local_dt * (p.fps or 15) / 50)
  if idx < 0 then idx = 0 end
  if idx >= p.frames then idx = p.frames - 1 end
  return idx
end

function M.anim_sheet(worm)
  local _, p = chain_phase(worm)
  if not p then return nil end
  return p.sheet
end

function M.anim_left(worm)
  local _, _, _, left = chain_phase(worm)
  return left or 0
end

-- ---------------------------------------------------------------------------
-- Shared per-round sound & shot counter helpers
-- ---------------------------------------------------------------------------

local function play_shot_sound(worm, sound_spec, shot_idx)
  if not sound_spec or not worm then return end
  local path = type(sound_spec) == "table" and sound_spec.path or sound_spec
  if not path or path == "" then return end
  local every = (type(sound_spec) == "table" and sound_spec.every) or 1
  if every > 1 and (shot_idx % every) ~= 0 then return end
  local prio = (type(sound_spec) == "table" and sound_spec.priority) or 8
  pcall(wa.sound.play, worm, path, prio)
end

local function bump_shot_counter(worm, reset_gap)
  local id = worm and worm.id
  local f = now_frame()
  if id == nil then return 1 end
  local last = burst_last_frame[id]
  -- If more than `reset_gap` frames elapsed since the last round, treat as a new burst
  local gap = reset_gap or 45
  if not last or (f - last) > gap then
    M.shot[id] = 0
    burst_target[id] = nil
  end
  M.shot[id] = (M.shot[id] or 0) + 1
  M.shot_at[id] = f
  burst_last_frame[id] = f
  return M.shot[id]
end

local function resolve_target(ev, spec, shot_idx)
  local worm = ev and ev.worm
  local id = worm and worm.id
  local live_t = (ev and ev.target) or (worm and worm.target)
  local per_shot = spec and spec.homing and spec.homing.per_shot_target
  if per_shot then
    return live_t or (id ~= nil and burst_target[id]) or nil
  end
  if shot_idx == 1 and id ~= nil then
    burst_target[id] = live_t
  end
  return (id ~= nil and burst_target[id]) or live_t
end

-- ---------------------------------------------------------------------------
-- Native single-round launcher: `firing.launch(ev, spec)` & `firing.actor(ev, spec)`
-- Used directly from `on_fire` on a native gun record (`gun.bullets` + `projectile`)
-- and also called internally per pellet by `firing.sequence`.
-- ---------------------------------------------------------------------------

local function emit_one_missile(ev, spec, dx, dy, shot_idx)
  local worm = ev and ev.worm
  local weapon = (spec and spec.weapon) or (ev and ev.weapon)
  if not weapon then
    wa.log("wfws_firing: launch requires weapon id")
    return nil
  end

  local speed = tonumber(spec and spec.speed) or 14
  if spec and spec.scale_by_power and ev and ev.power ~= nil then
    speed = speed * ev.power
  end

  -- Optional angular spread (used by timed sequencer or extra pellet spread)
  local spread_deg = tonumber(spec and spec.spread_deg) or 0
  if spread_deg > 0 then
    local jitter_deg = rand_signed(spread_deg * 0.5)
    dx, dy = rotate_vec(dx, dy, jitter_deg * DEG2RAD)
  end

  local vx = dx * speed
  local vy = dy * speed

  -- Optional Cartesian velocity jitter
  local sp = spec and spec.spread
  if sp then
    vx = vx + rand_signed(sp.x)
    vy = vy + rand_signed(sp.y)
  end

  local base_x = (ev and ev.x) or (worm and worm.x) or 0
  local base_y = (ev and ev.y) or (worm and worm.y) or 0
  local off = spec and spec.offset
  if off then
    base_x = base_x + (tonumber(off.x) or 0)
    base_y = base_y + (tonumber(off.y) or 0)
  end
  local standoff = tonumber(spec and spec.standoff) or 0
  if standoff > 0 then
    local vlen = math.sqrt(vx * vx + vy * vy)
    if vlen > 0.0001 then
      base_x = base_x + (vx / vlen) * standoff
      base_y = base_y + (vy / vlen) * standoff
    else
      base_x = base_x + dx * standoff
      base_y = base_y + dy * standoff
    end
  end

  local missile_ov = clone_table(spec and spec.missile) or {}
  if spec and spec.fuse == "aim" then
    missile_ov.fuse = M.fuse(0, worm)
  elseif type(spec and spec.fuse) == "number" and spec.fuse > 0 then
    missile_ov.fuse = math.floor(spec.fuse)
  end
  if spec and spec.explode_on_space then
    missile_ov.explode_on_space = true
  end

  local args = {
    weapon = weapon,
    owner = worm,
    x = base_x,
    y = base_y,
    vx = vx,
    vy = vy,
  }
  if next(missile_ov) ~= nil then
    args.missile = missile_ov
  end
  if spec and spec.clusters then
    args.clusters = clone_table(spec.clusters)
  end

  local ok, res = pcall(wa.weapons.launch, args)
  if not ok then
    if not launch_failed_once[weapon] then
      launch_failed_once[weapon] = true
      wa.log("wfws_firing: launch failed for " .. tostring(weapon) .. ": " .. tostring(res))
    end
    return nil
  end

  local mid = type(res) == "table" and res.id or res
  if mid and spec and spec.homing and spec.homing.enabled ~= false then
    local target = resolve_target(ev, spec, shot_idx)
    if target then
      M.homing.lock(mid, target, spec.homing)
    end
  end
  return mid
end

local function emit_one_actor(ev, spec, dx, dy)
  local worm = ev and ev.worm
  local speed = tonumber(spec and spec.speed) or 14
  if spec and spec.scale_by_power and ev and ev.power ~= nil then
    speed = speed * ev.power
  end

  local spread_deg = tonumber(spec and spec.spread_deg) or 0
  if spread_deg > 0 then
    local jitter_deg = rand_signed(spread_deg * 0.5)
    dx, dy = rotate_vec(dx, dy, jitter_deg * DEG2RAD)
  end

  local vx = dx * speed
  local vy = dy * speed
  local sp = spec and spec.spread
  if sp then
    vx = vx + rand_signed(sp.x)
    vy = vy + rand_signed(sp.y)
  end

  local base_x = (ev and ev.x) or (worm and worm.x) or 0
  local base_y = (ev and ev.y) or (worm and worm.y) or 0
  local off = spec and spec.offset
  if off then
    base_x = base_x + (tonumber(off.x) or 0)
    base_y = base_y + (tonumber(off.y) or 0)
  end
  local standoff = tonumber(spec and spec.standoff) or 0
  if standoff > 0 then
    local vlen = math.sqrt(vx * vx + vy * vy)
    if vlen > 0.0001 then
      base_x = base_x + (vx / vlen) * standoff
      base_y = base_y + (vy / vlen) * standoff
    else
      base_x = base_x + dx * standoff
      base_y = base_y + dy * standoff
    end
  end

  local actor_cfg = (spec and spec.actor) or {}
  local args = clone_table(actor_cfg) or {}
  args.x = base_x
  args.y = base_y
  args.vx = vx
  args.vy = vy
  if args.owner == nil then args.owner = worm end
  if args.sprite == nil or args.sprite == "" then args.sprite = false end
  return wa.actors.spawn(args)
end

function M.launch(ev, spec, _internal_shot_idx)
  spec = spec or {}
  local worm = ev and ev.worm
  local shot_idx = _internal_shot_idx or bump_shot_counter(worm, spec.burst_reset_frames)
  if spec.on_shot then spec.on_shot(shot_idx, worm, ev) end
  play_shot_sound(worm, spec.sound, shot_idx)
  local dx, dy = unit_dir_from_ev(ev, spec.aim_clamp)
  local pellets = math.max(1, math.floor(tonumber(spec.pellets) or 1))
  if pellets == 1 then
    return emit_one_missile(ev, spec, dx, dy, shot_idx)
  end
  local ids = {}
  for p = 1, pellets do
    local id = emit_one_missile(ev, spec, dx, dy, shot_idx)
    if id then ids[#ids + 1] = id end
  end
  return ids[1], ids
end

function M.actor(ev, spec, _internal_shot_idx)
  spec = spec or {}
  local worm = ev and ev.worm
  local shot_idx = _internal_shot_idx or bump_shot_counter(worm, spec.burst_reset_frames)
  if spec.on_shot then spec.on_shot(shot_idx, worm, ev) end
  play_shot_sound(worm, spec.sound, shot_idx)
  local dx, dy = unit_dir_from_ev(ev, spec.aim_clamp)
  local pellets = math.max(1, math.floor(tonumber(spec.pellets) or 1))
  if pellets == 1 then
    return emit_one_actor(ev, spec, dx, dy)
  end
  local actors = {}
  for p = 1, pellets do
    local a = emit_one_actor(ev, spec, dx, dy)
    if a then actors[#actors + 1] = a end
  end
  return actors[1], actors
end

-- ---------------------------------------------------------------------------
-- Flexible Custom-Cadence Sequencer: `firing.sequence(ev, spec)`
--
-- Absorbs and upgrades `px.fire_seq`:
--   * `first_delay_ms` : optional pre-shot buffer before shot 1 fires
--                        (e.g. 300 ms = 15 frames while holding firing pose)
--   * `interval_ms`    : default gap between subsequent shots (e.g. 20 ms = 1 f)
--   * `intervals_ms`   : optional array of manual per-shot delays in ms:
--                        e.g. { 300, 20, 20, 20 } or { 200, 120, 60, 20 }.
--                        Entry [i] is the wait before shot i; the last entry
--                        repeats for any remaining shots.
--   * `count`          : total shots to fire
--   * `burst_size`     : pellets per shot (1 = single round)
--   * `spread_deg`     : angular spread cone in degrees (lockstep `wa.math`)
--   * `live_aim`       : true = re-read worm aim each shot; false = lock aim
--   * `mode`           : "missiles" (default) | "actors"
--   * `fire_fn`        : optional custom `function(shot_ev, shot_idx)` for beams
--                        or custom tools riding the same cadence & buffer engine
-- ---------------------------------------------------------------------------

function M.cancel(owner)
  local id = owner and owner.id
  if id == nil or not seq_running[id] then return false end
  seq_cancelled[id] = true
  if owner.shots_to_fire then owner.shots_fired = owner.shots_to_fire end
  return seq_settled[id] ~= true
end

function M.reset(worm_id)
  if worm_id == nil then return end
  M.shot[worm_id] = nil
  burst_last_frame[worm_id] = nil
  burst_target[worm_id] = nil
  seq_running[worm_id] = nil
  seq_settled[worm_id] = nil
  seq_cancelled[worm_id] = nil
  clear_chain(worm_id)
end

local function schedule_frames_for(spec, shot_index)
  local custom = spec.intervals_ms
  if type(custom) == "table" and #custom > 0 then
    local ms = custom[shot_index] or custom[#custom]
    -- Shot 1 may wait 0 frames (immediate); subsequent shots wait at least 1 frame
    return ms_to_frames(ms, shot_index == 1 and 0 or 1)
  end
  if shot_index == 1 then
    return ms_to_frames(spec.first_delay_ms or 0, 0)
  end
  if spec.interval_ms ~= nil then
    return ms_to_frames(spec.interval_ms, 1)
  end
  if spec.delay ~= nil then
    return math.max(1, math.floor(tonumber(spec.delay) or 1))
  end
  return 1
end

function M.sequence(ev, spec)
  spec = spec or {}
  local worm = (ev and ev.worm) or spec.owner
  if not worm or not worm_alive(worm) then return nil end

  local id = worm.id
  -- Re-fire guard: swallows WA repeat-fire frames while a sequence or buffer is active
  if id ~= nil and seq_running[id] then return nil end

  local count = math.max(1, math.floor(tonumber(spec.count) or 1))
  local weapon = spec.weapon or (ev and ev.weapon)
  local cancel_weapon = spec.cancel_weapon
  if cancel_weapon == true then cancel_weapon = weapon end

  local first_wait = schedule_frames_for(spec, 1)
  local live_aim = spec.live_aim ~= false
  local locked_dx, locked_dy = unit_dir_from_ev(ev, spec.aim_clamp)
  local initial_target = (ev and ev.target) or worm.target
  local initial_power = ev and ev.power

  -- Prepare single-round spec passed to launch/actor/fire_fn
  local round_spec = clone_table(spec) or {}
  round_spec.weapon = weapon
  round_spec.pellets = math.max(1, math.floor(tonumber(spec.burst_size) or tonumber(spec.pellets) or 1))

  if id ~= nil then
    M.shot[id] = 0
    burst_target[id] = initial_target
    burst_last_frame[id] = now_frame()
  end

  local function build_shot_ev(shot_idx)
    local dx, dy = locked_dx, locked_dy
    if live_aim then
      dx, dy = aim_dir(worm, spec.aim_clamp)
    end
    local sx = worm.x
    local sy = worm.y
    if shot_idx == 1 and first_wait == 0 and ev and ev.x ~= nil and ev.y ~= nil and not live_aim then
      sx, sy = ev.x, ev.y
    end
    return {
      x = sx,
      y = sy,
      vx = dx,
      vy = dy,
      weapon = weapon,
      worm = worm,
      power = initial_power,
      target = (spec.homing and spec.homing.per_shot_target and worm.target) or initial_target,
    }
  end

  local function fire_one(shot_idx)
    local f = now_frame()
    if id ~= nil then
      M.shot[id] = shot_idx
      M.shot_at[id] = f
      burst_last_frame[id] = f
    end
    local shot_ev = build_shot_ev(shot_idx)
    if type(spec.fire_fn) == "function" then
      if spec.on_shot then spec.on_shot(shot_idx, worm, shot_ev) end
      play_shot_sound(worm, spec.sound, shot_idx)
      spec.fire_fn(shot_ev, shot_idx)
    elseif spec.mode == "actors" then
      M.actor(shot_ev, round_spec, shot_idx)
    else
      M.launch(shot_ev, round_spec, shot_idx)
    end
  end

  -- Fast path: single immediate shot with no buffer and no chain
  if count == 1 and first_wait == 0 and not spec.chain then
    fire_one(1)
    if spec.on_done then spec.on_done(worm, 1) end
    return nil
  end

  if spec.chain then
    M.chain(worm, spec.chain)
  end

  local function end_fire()
    if worm.shots_to_fire then worm.shots_fired = worm.shots_to_fire end
  end
  local function hold_pose()
    worm.shots_fired, worm.shots_to_fire = 0, 1
  end
  local function release()
    if id ~= nil then
      seq_running[id] = nil
      seq_settled[id] = nil
      seq_cancelled[id] = nil
    end
  end
  local function interrupted()
    if id ~= nil and seq_cancelled[id] == true then return true end
    if not worm_alive(worm) or not worm.turn then return true end
    if cancel_weapon and worm.weapon ~= cancel_weapon then return true end
    if NOT_FIRING[worm.state_id] == true then return true end
    return false
  end

  if id ~= nil then seq_running[id] = true end

  local fired = 0
  local next_wait = first_wait
  if first_wait == 0 then
    fired = 1
    fire_one(1)
    if fired < count then
      next_wait = schedule_frames_for(spec, 2)
    end
  end

  local drain_frames = math.max(0, math.floor(tonumber(spec.drain) or DRAIN_DEFAULT))
  local drain = (fired >= count) and drain_frames or 0
  if drain > 0 then
    if id ~= nil then seq_settled[id] = true end
    end_fire()
    if spec.on_done then spec.on_done(worm, fired) end
  else
    hold_pose()
  end

  -- Safety backstop so a stuck state can never freeze a turn forever
  local max_ticks = first_wait + drain_frames + 60
  for i = 2, count do
    max_ticks = max_ticks + schedule_frames_for(spec, i)
  end
  local elapsed = 0

  local ticker = wa.actors.spawn({
    sprite = false,
    x = worm.x,
    y = worm.y,
    gravity = false,
    collide = false,
    persist = true,
    drown = false,
    owner = worm,
    on = function(a)
      a.vx, a.vy = 0, 0
      elapsed = elapsed + 1
      if elapsed > max_ticks then
        if id ~= nil and not seq_settled[id] then
          seq_settled[id] = true
          end_fire()
          if spec.on_done then spec.on_done(worm, fired) end
        end
        release()
        a:despawn()
        return
      end

      if drain > 0 then
        drain = drain - 1
        if drain <= 0 then
          release()
          a:despawn()
        end
        return
      end

      if interrupted() then
        if id ~= nil then seq_settled[id] = true end
        end_fire()
        if spec.on_done then spec.on_done(worm, fired) end
        release()
        a:despawn()
        return
      end

      next_wait = next_wait - 1
      if next_wait > 0 then
        hold_pose()
        return
      end

      fired = fired + 1
      fire_one(fired)

      if id ~= nil and seq_cancelled[id] then
        seq_settled[id] = true
        end_fire()
        if spec.on_done then spec.on_done(worm, fired) end
        release()
        a:despawn()
        return
      end

      if fired < count then
        next_wait = schedule_frames_for(spec, fired + 1)
        hold_pose()
      else
        if id ~= nil then seq_settled[id] = true end
        end_fire()
        if spec.on_done then spec.on_done(worm, fired) end
        if drain_frames > 0 then
          drain = drain_frames
        else
          release()
          a:despawn()
        end
      end
    end,
  })
  return ticker
end

return M
