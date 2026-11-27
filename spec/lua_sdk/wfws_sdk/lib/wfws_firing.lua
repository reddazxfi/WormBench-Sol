-- wfws_firing.lua: WFWS Firing Engine (0.19.0)
--
-- Unified, lockstep-deterministic firing library for WormBench weapons (API 5):
--   * Native gun + payload launching (`firing.launch`, `firing.actor`)
--   * Flexible custom-cadence sequencer (`firing.sequence`) with initial
--     animation/charge buffer (`first_delay_ms`), uniform or per-shot manual
--     cooldown schedules (`interval_ms` / `intervals_ms`), multi-pellet bursts,
--     angular/axis spread, live aim, and custom `fire_fn` (for beams & tools)
--   * Hitscan / progressive beam discharge (`firing.beam`) with optional
--     pre-fire charge buffer, corridor / expanding cone / first-target hits,
--     hit cooldown throttling, terrain cutting, and ribbon or engine-trail draw
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
-- Active beam + drain re-fire guard keyed by worm.id -> beam.id (swallows WA repeat-fire frames)
local beam_guard = {}
local BEAMS = {}      -- [beam_id] = beam
local BEAM_ORDER = {} -- deterministic array of live beam_ids
local beam_release_guard
local beam_remove_entry

-- Non-firing WA worm states that should interrupt a timed sequence (`verbs.md` readable names)
local NOT_FIRING = {
  standing = true,
  walking = true,
  punching = true,
  drilling = true,
  teleporting = true,
  rope_firing = true,
  torching = true,
  after_rope = true,
  getting_up = true,
  jump_prepare = true,
  jetpacking = true,
  jumping = true,
  jump_falling = true,
  roping = true,
  bungee = true,
  parachuting = true,
  falling = true,
  tumbling = true,
  hit = true,
  blasted = true,
  dying = true,
  drowning = true,
  frozen = true,
  dead = true,
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
  standing = true,
  walking = true,
  ready = true,
  charging = true,
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
      if w.turn and (w.aiming or (w.state and FUSE_AIM_STATES[w.state])) then
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
  if args.gravity == nil then
    args.gravity = 0
  elseif type(args.gravity) == "boolean" then
    args.gravity = args.gravity and 1 or 0
  end
  if args.body == nil and (args.collide or args.as_object) then
    args.body = {
      layer = args.as_object and "object" or "missile",
      hits = { land = true, worms = true },
      hit_by = "all",
    }
  end
  args.collide = nil
  args.as_object = nil
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
--                        (300 ms is 15 frames while holding firing pose)
--   * `interval_ms`    : default gap between subsequent shots (20 ms is 1 f)
--   * `intervals_ms`   : optional array of manual per-shot delays in ms:
--                        { 300, 20, 20, 20 } or { 200, 120, 60, 20 }.
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
  beam_guard[worm_id] = nil
  for i = #BEAM_ORDER, 1, -1 do
    local b = BEAMS[BEAM_ORDER[i]]
    if b and b.owner_id == worm_id then
      beam_release_guard(b)
      beam_remove_entry(b)
    end
  end
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
      local pellets = round_spec.pellets or 1
      local spread_deg = tonumber(spec.spread_deg) or 0
      if pellets <= 1 and spread_deg <= 0 then
        spec.fire_fn(shot_ev, shot_idx, 1)
      else
        local base_dx, base_dy = shot_ev.vx, shot_ev.vy
        for p = 1, pellets do
          local angle_deg = 0
          if pellets > 1 and spread_deg > 0 then
            angle_deg = ((p - 1) / (pellets - 1) - 0.5) * spread_deg
          elseif spread_deg > 0 then
            angle_deg = rand_signed(spread_deg * 0.5)
          end
          local rdx, rdy = rotate_vec(base_dx, base_dy, angle_deg * DEG2RAD)
          local pev = {
            x = shot_ev.x,
            y = shot_ev.y,
            vx = rdx,
            vy = rdy,
            weapon = shot_ev.weapon,
            worm = shot_ev.worm,
            power = shot_ev.power,
            target = shot_ev.target,
          }
          spec.fire_fn(pev, shot_idx, p)
        end
      end
    elseif spec.mode == "actors" then
      M.actor(shot_ev, round_spec, shot_idx)
    else
      M.launch(shot_ev, round_spec, shot_idx)
    end
  end

  local tail_frames = math.max(0, math.floor(tonumber(spec.tail_frames) or 0))

  -- Fast path: single immediate shot with no buffer, no tail hold, and no chain
  if count == 1 and first_wait == 0 and tail_frames == 0 and not spec.chain then
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
    if worm.state and NOT_FIRING[worm.state] == true then return true end
    return false
  end

  if id ~= nil then seq_running[id] = true end

  local fired = 0
  local in_tail = false
  local next_wait = first_wait
  if first_wait == 0 then
    fired = 1
    fire_one(1)
    if fired < count then
      next_wait = schedule_frames_for(spec, 2)
    elseif tail_frames > 0 then
      in_tail = true
      next_wait = tail_frames
    end
  elseif type(spec.on_buffer) == "function" then
    spec.on_buffer(worm, first_wait)
  end

  local drain_frames = math.max(0, math.floor(tonumber(spec.drain) or DRAIN_DEFAULT))
  local drain = (fired >= count and not in_tail) and drain_frames or 0
  if drain > 0 then
    if id ~= nil then seq_settled[id] = true end
    end_fire()
    if spec.on_done then spec.on_done(worm, fired) end
  else
    hold_pose()
  end

  -- Safety backstop so a stuck state can never freeze a turn forever
  local max_ticks = first_wait + tail_frames + drain_frames + 60
  for i = 2, count do
    max_ticks = max_ticks + schedule_frames_for(spec, i)
  end
  local elapsed = 0

  local ticker = wa.actors.spawn({
    sprite = false,
    x = worm.x,
    y = worm.y,
    persist = true,
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
        a:remove()
        return
      end

      if drain > 0 then
        drain = drain - 1
        if drain <= 0 then
          release()
          a:remove()
        end
        return
      end

      if interrupted() then
        if id ~= nil then seq_settled[id] = true end
        end_fire()
        if spec.on_done then spec.on_done(worm, fired) end
        release()
        a:remove()
        return
      end

      next_wait = next_wait - 1
      if next_wait > 0 then
        hold_pose()
        return
      end

      if in_tail then
        if id ~= nil then seq_settled[id] = true end
        end_fire()
        if spec.on_done then spec.on_done(worm, fired) end
        if drain_frames > 0 then
          drain = drain_frames
        else
          release()
          a:remove()
        end
        return
      end

      fired = fired + 1
      fire_one(fired)

      if id ~= nil and seq_cancelled[id] then
        seq_settled[id] = true
        end_fire()
        if spec.on_done then spec.on_done(worm, fired) end
        release()
        a:remove()
        return
      end

      if fired < count then
        next_wait = schedule_frames_for(spec, fired + 1)
        hold_pose()
      elseif tail_frames > 0 then
        in_tail = true
        next_wait = tail_frames
        hold_pose()
      else
        if id ~= nil then seq_settled[id] = true end
        end_fire()
        if spec.on_done then spec.on_done(worm, fired) end
        if drain_frames > 0 then
          drain = drain_frames
        else
          release()
          a:remove()
        end
      end
    end,
  })
  return ticker
end

-- ---------------------------------------------------------------------------
-- Hitscan & progressive beam engine (`firing.beam`)
-- ---------------------------------------------------------------------------

local MAX_BEAMS = 64
local BEAM_SAMPLE_STEP = 20
local NEXT_BEAM = 0
local BEAM_DRAW_INSTALLED = false
local BEAM_DEAD_LOGGED = {}
local BEAM_ARC_LOGGED = {}
local BEAM_TRAIL_LOGGED = {}

local BEAM_KEYS = {
  owner = true,
  weapon = true,
  reach = true,
  buffer = true,
  pre_buffer = true,
  live_aim = true,
  grow = true,
  grow_ease = true,
  hold = true,
  fade = true,
  dissipate = true,
  path = true,
  bulge = true,
  noise = true,
  points = true,
  branches = true,
  core0 = true,
  core1 = true,
  glow0 = true,
  glow1 = true,
  color = true,
  r = true,
  g = true,
  b = true,
  rainbow = true,
  flicker = true,
  depth = true,
  hits = true,
  width = true,
  width0 = true,
  cone_deg = true,
  hit_cooldown = true,
  range = true,
  stop_on_terrain = true,
  damage = true,
  push = true,
  burn_push = true,
  poison = true,
  interact = true,
  kind = true,
  targets = true,
  spare_shooter = true,
  taze_mines = true,
  on_taze_mine = true,
  cut = true,
  cut_shape = true,
  impact_radius = true,
  fire = true,
  sparks = true,
  hit_branches = true,
  standoff = true,
  offset_x = true,
  offset_y = true,
  offset = true,
  aim_clamp = true,
  sprite = true,
  glow_sprite = true,
  sound = true,
  charge_sound = true,
  impact_sound = true,
  look = true,
  visibility = true,
  sprite = true,
  glow_sprite = true,
  end_sprite = true,
  orb_sprite = true,
  on_hit = true,
  on_before_hit = true,
  on_buffer = true,
  on_discharge = true,
  on_impact = true,
  on_end = true,
  log = true,
}

local function beam_log(msg)
  if wa and wa.log then
    pcall(wa.log, "[wfws_firing.beam] " .. tostring(msg))
  end
end

-- Additive blending ignores alpha, so fades scale R/G/B and hold alpha at 255.
local function beam_tint(f, r, g, b)
  if f < 0 then f = 0 elseif f > 1 then f = 1 end
  local rr = math.floor(r * f)
  local gg = math.floor(g * f)
  local bb = math.floor(b * f)
  if rr < 0 then rr = 0 elseif rr > 255 then rr = 255 end
  if gg < 0 then gg = 0 elseif gg > 255 then gg = 255 end
  if bb < 0 then bb = 0 elseif bb > 255 then bb = 255 end
  return (255 << 24) | (rr << 16) | (gg << 8) | bb
end

local function beam_rainbow_rgb(hue)
  local rad = ((hue % 1) + 1) % 1 * (2 * PI)
  return
    math.floor(180 + 75 * wa.math.sin(rad)),
    math.floor(180 + 75 * wa.math.sin(rad + 2.0943951)),
    math.floor(180 + 75 * wa.math.sin(rad + 4.1887902))
end

local function beam_ease(mode, t)
  if t <= 0 then return 0 end
  if t >= 1 then return 1 end
  if mode == "out" then
    local inv = 1 - t
    return 1 - inv * inv
  elseif mode == "in" then
    return t * t
  end
  return t
end

local function beam_body_radius(body)
  if body and body.radius ~= nil then return tonumber(body.radius) or 10 end
  local k = body and body.kind
  if k == "worm" then return 10 end
  if k == "mine" then return 6 end
  if k == "grave" then return 8 end
  return 10
end

local function beam_body_key(body)
  return tostring(body.kind or "obj") .. ":" .. tostring(body.id)
end

local function beam_target_allowed(body, targets_mode)
  if not body or body.id == nil then return false end
  local k = body.kind
  if k == "grave" then return false end
  if targets_mode == "worms" then
    return k == "worm" and (body.hp == nil or body.hp > 0)
  end
  if k == "worm" then
    return body.hp == nil or body.hp > 0
  end
  return k == "mine" or k == "crate" or k == "oil"
end

local function beam_roll_damage(dmg_spec)
  if type(dmg_spec) == "number" then
    return math.max(0, math.floor(dmg_spec + 0.5))
  end
  if type(dmg_spec) == "table" then
    local lo = tonumber(dmg_spec.min or dmg_spec[1]) or 20
    local hi = tonumber(dmg_spec.max or dmg_spec[2]) or lo
    lo = math.max(0, math.floor(lo + 0.5))
    hi = math.max(0, math.floor(hi + 0.5))
    if hi < lo then lo, hi = hi, lo end
    if lo == hi then return lo end
    return wa.random(lo, hi)
  end
  return wa.random(20, 30)
end

-- A jagged electric bolt uses 9 smooth-cornered kinks re-seeded every 2 ticks
-- (25 Hz crackle, or 50 Hz during dissolve wind-down) from the simulation's
-- own `wa.random` seed and `b.age`, so every lockstep peer and `BeamPreview`
-- animate the exact same crackling arc without a rigid static sawtooth.
local JAG_N = 9

-- Lehmer hash, in exact doubles: the same integer arithmetic everywhere, so the
-- bolt is identical on every peer and in the preview (which ports this).
local function beam_hash01(x)
  local s = math.floor(math.abs(x) * 1000003) % 65521
  s = (s * 48271) % 2147483647
  s = (s * 48271) % 2147483647
  return (s % 20001) / 10000 - 1
end

local function beam_kinks(seed, n, out)
  local vals = out or {}
  local prev = 0
  for i = 1, n do
    local r = beam_hash01(seed + i * 0.6180339887)
    -- One smoothing pass: organic arc bends survive without a 1-px sawtooth.
    local v = r * 0.58 + prev * 0.42
    if v > 1 then v = 1 elseif v < -1 then v = -1 end
    vals[i] = v
    prev = v
  end
  vals[1] = 0
  vals[n] = 0
  return vals
end

local function beam_kink_at(vals, ta)
  if not vals then return 0 end
  local n = #vals
  if n < 3 then return 0 end
  local x = ta * (n - 1)
  local i = math.floor(x)
  if i < 0 then i = 0 end
  if i > n - 2 then i = n - 2 end
  local f = x - i
  local a = vals[i + 1] or 0
  local c = vals[i + 2] or a
  return a + (c - a) * f
end

local function beam_ensure_shape(b, step_idx)
  local s = step_idx or 0
  if b.jag_step == s and b.jag_vals then return end
  b.jag_step = s
  b.jag_vals = beam_kinks(b.jag1 * 131 + b.jag2 * 977 + s * 37, JAG_N, b.jag_vals)
end

local function beam_seed_shape(b)
  b.jag_step = nil
  beam_ensure_shape(b, 0)
end

local function beam_jag(b, ta, amp)
  local a = amp or b.noise_px
  if not a or a <= 0 then return 0 end
  if ta <= 0 or ta >= 1 then return 0 end
  -- Pinned at both ends: a bolt has to meet its muzzle and its tip.
  return beam_kink_at(b.jag_vals, ta) * wa.math.sin(ta * PI) * a
end

-- Facing-consistent arc normal: +bulge always arches UP (and mirrors cleanly
-- when the worm turns left vs right); -bulge always dips DOWN.
local function beam_arc_normal(b)
  local sign = (b.dx < -1e-4 or (math.abs(b.dx) <= 1e-4 and (b.facing or 1) < 0)) and 1 or -1
  return -b.dy * sign, b.dx * sign
end

-- Compute the beam shape point (px, py) at parameter t in [0, 1] along current head.
local function beam_point_at(b, idx, t, head_len)
  local base_x = b.x0 + b.dx * (t * head_len)
  local base_y = b.y0 + b.dy * (t * head_len)
  if b.path == "straight" then
    return base_x, base_y
  end
  if b.path == "arc" then
    local ta = (b.len > 0) and (t * head_len / b.len) or t
    local anx, any = beam_arc_normal(b)
    local bow = b.bulge * wa.math.sin(ta * PI)
    return base_x + anx * bow, base_y + any * bow
  end
  local nx, ny = -b.dy, b.dx
  -- jagged, as a fraction of the whole bolt so the shape doesn't stretch
  -- while the head grows
  local ta = (b.len > 0) and (t * head_len / b.len) or t
  local j = beam_jag(b, ta)
  return base_x + nx * j, base_y + ny * j
end

local function beam_half_width_at(b, along)
  if b.hits == "cone" then
    if b.cone_tan > 0 then
      return b.width0 + along * b.cone_tan
    end
    local frac = b.range > 0 and math.min(1, math.max(0, along / b.range)) or 1
    return b.width0 + (b.width - b.width0) * frac
  end
  return b.width
end

beam_release_guard = function(b)
  if b and b._guard and b.owner_id ~= nil then
    if beam_guard[b.owner_id] == b.id then
      beam_guard[b.owner_id] = nil
    end
    b._guard = nil
  end
end

beam_remove_entry = function(b)
  if b.done then return end
  b.done = true
  BEAMS[b.id] = nil
  for i = #BEAM_ORDER, 1, -1 do
    if BEAM_ORDER[i] == b.id then
      table.remove(BEAM_ORDER, i)
      break
    end
  end
  if b.trail_core then
    pcall(function() b.trail_core:remove() end)
    b.trail_core = nil
  end
  if b.trail_glow then
    pcall(function() b.trail_glow:remove() end)
    b.trail_glow = nil
  end
  if b.spark_trails then
    for _, st in ipairs(b.spark_trails) do
      pcall(function() st:remove() end)
    end
    b.spark_trails = nil
  end
  if b.log then
    beam_log("cleanup id=" .. tostring(b.id) .. " weapon=" .. tostring(b.weapon or ""))
  end
end

local function beam_spawn_spark(b, x, y)
  if not b.sparks or not (wa.draw and wa.draw.trail) then return end
  local ok, tr = pcall(wa.draw.trail, {
    sprite = b.glow_sprite or b.sprite,
    width = 24,
    color = beam_tint(1, b.r, b.g, b.b),
    max = 3,
    shed = 1,
    floor = 0.2,
    blend = "add",
    depth = b.depth,
    visibility = b.visibility,
  })
  if ok and tr then
    pcall(function()
      tr:push(x - 6, y)
      tr:push(x + 6, y)
      tr:finish()
    end)
    b.spark_trails = b.spark_trails or {}
    b.spark_trails[#b.spark_trails + 1] = tr
  end
end

local function beam_spawn_fire_at(b, x, y, count, vy_val)
  if not (wa.fire and wa.fire.spawn) or not b.fire then return end
  local f = b.fire
  pcall(wa.fire.spawn, {
    owner = b.owner_handle,
    x = x,
    y = y,
    vx = 0,
    vy = vy_val or -3,
    count = math.max(1, math.floor(tonumber(count) or tonumber(f.count) or 6)),
    duration = math.max(200, math.floor(tonumber(f.duration) or 3500)),
    up_power = math.max(1, math.floor(tonumber(f.up_power) or 80)),
    damage = math.max(0, math.floor(tonumber(f.damage) or 5)),
  })
end

local function beam_step_trajectory_fire(b)
  if not b.fire then return end
  local mode = b.fire.mode
  if mode ~= "trajectory" and mode ~= "both" then return end
  if b.head <= 0 then return end
  local step = math.max(12, tonumber(b.fire.step) or 48)
  local per_point = math.max(1, math.floor((tonumber(b.fire.count) or 6) / 3))
  local s = math.max(step, b.fire_sampled_upto + step)
  while s <= b.head do
    local frac = b.head > 0 and (s / b.head) or 1
    local fx, fy = beam_point_at(b, 1, frac, b.head)
    beam_spawn_fire_at(b, fx, fy, per_point, -2)
    b.fire_sampled_upto = s
    s = s + step
  end
end

local function beam_damage_body(b, body, along)
  local amount = beam_roll_damage(b.damage_spec)
  local dx, dy = b.dx, b.dy
  if b.on_before_hit then
    pcall(b.on_before_hit, body, amount, dx, dy, b)
  end
  local hit_ok = false

  if b.interact == "burn" and body.kind == "worm" then
    local active_age = math.max(0, (b.age or 0) - b.buffer)
    local active_total = b.grow + b.hold
    local is_final = active_total <= 0 or b.hit_cooldown <= 0 or (active_age + b.hit_cooldown) >= active_total
    if is_final and b.push > 0 then
      local ok = pcall(function()
        body:hit({
          amount = amount,
          vx = dx * b.push,
          vy = dy * b.push - b.push * 0.5,
          kind = b.kind or "fire",
        })
      end)
      hit_ok = ok
    elseif b.burn_push > 0 then
      local ok = pcall(function()
        body:hit({
          amount = amount,
          vx = dx * b.burn_push * 0.35,
          vy = -b.burn_push,
          kind = b.kind or "fire",
        })
      end)
      hit_ok = ok
    else
      -- API 5: react = false is damage only on worms; refuses kind and vx/vy.
      local ok = pcall(function()
        body:hit({ amount = amount, react = false })
      end)
      hit_ok = ok
    end
  elseif b.interact == "burn" and body.kind == "mine" then
    if b.taze_mines and b.on_taze_mine then
      local ok = pcall(b.on_taze_mine, body, b.owner_handle, b)
      hit_ok = ok
    else
      local ok = pcall(function()
        body:arm(400)
      end)
      hit_ok = ok
    end
  elseif b.interact == "burn" then
    local ok = pcall(function()
      body:hit(amount, 0, 0, b.kind)
    end)
    hit_ok = ok
  else
    local vx = dx * b.push
    local vy = dy * b.push
    if body.kind == "worm" then
      local ok = pcall(function()
        body:hit({
          amount = amount,
          vx = vx,
          vy = vy - b.push * 0.5,
          kind = b.kind,
        })
      end)
      hit_ok = ok
    elseif body.kind == "mine" then
      if b.taze_mines and b.on_taze_mine then
        local ok = pcall(b.on_taze_mine, body, b.owner_handle, b)
        hit_ok = ok
      else
        local ok = pcall(function()
          body:arm(400)
        end)
        hit_ok = ok
      end
    else
      -- crate or oil drum: API 5 object:hit(damage, vx, vy, kind)
      local ok = pcall(function()
        body:hit(amount, vx, vy, b.kind)
      end)
      hit_ok = ok
    end
  end

  if hit_ok then
    -- Poison is a status dose, not a hit kind. It goes only on a worm the
    -- hurt pass actually took, so mines, crates and barrels never get it, and
    -- only once per beam: a burn tick calls this again for the same worm.
    if b.poison > 0 and body.kind == "worm" and not b.poisoned[body.id] then
      b.poisoned[body.id] = true
      pcall(function() body:poison(b.poison) end)
    end
    local t = b.len > 0 and (along / b.len) or 0
    if t < 0 then t = 0 elseif t > 1 then t = 1 end
    b.hits_list[#b.hits_list + 1] = { x = body.x, y = body.y, t = t }
    beam_spawn_spark(b, body.x, body.y)
    if b.impact_sound and not b.impact_played then
      local isnd = b.impact_sound
      local imp_target = (type(isnd) == "table" and isnd.path) or (type(isnd) == "string" and isnd ~= "" and isnd) or (type(isnd) == "number" and isnd > 0 and isnd) or nil
      if imp_target then
        b.impact_played = true
        local prio = (type(isnd) == "table" and tonumber(isnd.priority)) or 10
        if b.owner_handle then
          pcall(wa.sound.play, b.owner_handle, imp_target, prio)
        end
      end
    end
    if b.on_hit then
      pcall(b.on_hit, body, amount, dx, dy, b)
    end
    if b.log then
      beam_log(
        "hit id=" .. tostring(b.id) ..
        " body=" .. beam_body_key(body) ..
        " dmg=" .. tostring(amount) ..
        " along=" .. tostring(math.floor(along + 0.5))
      )
    end
  end
end

local function beam_can_hit(b, key, frame)
  local prev = b.hit[key]
  if prev == nil then return true end
  if b.hit_cooldown <= 0 then return false end
  return (frame - prev) >= b.hit_cooldown
end

local function beam_mark_hit(b, key, frame)
  b.hit[key] = (b.hit_cooldown > 0) and frame or true
end

local function beam_apply_cut(b, cur_frame)
  if not b.cut_enabled then return end
  if not (wa.land and wa.land.cut) then return end
  if not b.live_aim then
    if b.cut_done then return end
    b.cut_done = true
  else
    local cur = cur_frame or now_frame()
    local cut_interval = math.max(3, b.hit_cooldown > 0 and b.hit_cooldown or 4)
    if b.last_cut_frame ~= nil and (cur - b.last_cut_frame) < cut_interval then
      return
    end
    b.last_cut_frame = cur
    b.cut_done = true
  end
  if b.cut_shape == "drill" then
    pcall(wa.land.cut, {
      x = b.ex,
      y = b.ey,
      shape = "drill",
    })
  elseif b.cut_shape == "torch" then
    local cf = (b.dx < -1e-4 or (math.abs(b.dx) <= 1e-4 and (b.facing or 1) < 0)) and -1 or 1
    local ca = math.max(-1, math.min(1, tonumber(b.dy) or 0))
    pcall(wa.land.cut, {
      x = b.ex,
      y = b.ey,
      shape = "torch",
      facing = cf,
      angle = ca,
    })
  else
    local rad = math.max(1, math.min(200, math.floor(b.cut + 0.5)))
    pcall(wa.land.cut, {
      x = b.ex,
      y = b.ey,
      shape = "circle",
      radius = rad,
    })
  end
end

local function beam_update_live_aim(b, owner)
  if not b.live_aim or not worm_alive(owner) then return end
  if owner.facing ~= nil then
    b.facing = owner.facing
  end
  local ndx, ndy = aim_dir(owner, b.aim_clamp)
  b.dx, b.dy = ndx, ndy
  local so = b.base_standoff ~= nil and b.base_standoff or (b.standoff > 0 and b.standoff or 4)
  b.x0 = (owner.x or b.x0) + b.off_x + so * b.dx
  b.y0 = (owner.y or b.y0) + b.off_y + so * b.dy
end

local function beam_add_candidate(list, seen, body, targets_mode, spare_shooter, owner_id)
  if not beam_target_allowed(body, targets_mode) then return end
  if spare_shooter and body.kind == "worm" and body.id == owner_id then return end
  local key = beam_body_key(body)
  if seen[key] then return end
  seen[key] = true
  list[#list + 1] = body
end

local function beam_collect_candidates(b, head, is_arc, anx, any)
  local list, seen = {}, {}
  if wa.worms and wa.worms.all then
    local worms = wa.worms.all()
    if worms then
      for i = 1, #worms do
        beam_add_candidate(list, seen, worms[i], b.targets, b.spare_shooter, b.owner_id)
      end
    end
  end
  if b.targets ~= "worms" then
    if wa.mines and wa.mines.all then
      local mines = wa.mines.all()
      if mines then
        for i = 1, #mines do
          beam_add_candidate(list, seen, mines[i], b.targets, b.spare_shooter, b.owner_id)
        end
      end
    end
    if wa.crates and wa.crates.all then
      local crates = wa.crates.all()
      if crates then
        for i = 1, #crates do
          beam_add_candidate(list, seen, crates[i], b.targets, b.spare_shooter, b.owner_id)
        end
      end
    end
    if wa.oil and wa.oil.all then
      local oils = wa.oil.all()
      if oils then
        for i = 1, #oils do
          beam_add_candidate(list, seen, oils[i], b.targets, b.spare_shooter, b.owner_id)
        end
      end
    end
  end
  if wa.world and wa.world.electrical_nearby then
    local step = BEAM_SAMPLE_STEP
    local half_step = step * 0.5
    local s = 0
    while true do
      local sample_s = s > head and head or s
      local local_hw = beam_half_width_at(b, sample_s)
      local reach = math.floor(math.sqrt(local_hw * local_hw + half_step * half_step)) + 24
      if reach < 24 then reach = 24 elseif reach > 1000 then reach = 1000 end
      local sx = b.x0 + b.dx * sample_s
      local sy = b.y0 + b.dy * sample_s
      if is_arc then
        local bow = b.bulge * wa.math.sin(math.min(1, sample_s / b.len) * PI)
        sx = sx + anx * bow
        sy = sy + any * bow
      end
      local ok, bodies = pcall(wa.world.electrical_nearby, sx, sy, reach, false)
      if ok and bodies then
        for i = 1, #bodies do
          beam_add_candidate(list, seen, bodies[i], b.targets, b.spare_shooter, b.owner_id)
        end
      end
      if sample_s >= head then break end
      s = s + step
    end
  end
  return list
end

local function beam_curve_dist(b, body, head, is_arc, anx, any)
  local cx = body.x - b.x0
  local cy = body.y - b.y0
  local along = cx * b.dx + cy * b.dy
  local clamped = math.max(0, math.min(head, along))
  local br = beam_body_radius(body)

  if not is_arc then
    local px = b.x0 + b.dx * clamped
    local py = b.y0 + b.dy * clamped
    local ddx, ddy = body.x - px, body.y - py
    local perp = math.sqrt(ddx * ddx + ddy * ddy)
    local allowed_w = beam_half_width_at(b, clamped) + br
    if b.head + 2 >= b.len then
      local ex_d = math.sqrt((body.x - b.ex) ^ 2 + (body.y - b.ey) ^ 2)
      local tip_r = math.max(allowed_w, b.cut > 0 and (b.cut + br) or 0, (b.impact_radius or 0) > 0 and (b.impact_radius + br) or 0)
      if ex_d <= tip_r then
        return true, math.min(b.len, math.max(0, along))
      end
    end
    return perp <= allowed_w, clamped
  end

  -- Check clamped sample + neighboring curve samples so steep arcs never miss
  local best_d, best_s = nil, clamped
  local offsets = { 0, -16, 16, -32, 32 }
  for i = 1, 5 do
    local s = math.max(0, math.min(head, clamped + offsets[i]))
    local ba = math.min(1, math.max(0, s / b.len))
    local bbow = b.bulge * wa.math.sin(ba * PI)
    local ax = b.x0 + b.dx * s + anx * bbow
    local ay = b.y0 + b.dy * s + any * bbow
    local ddx, ddy = body.x - ax, body.y - ay
    local d = math.sqrt(ddx * ddx + ddy * ddy)
    if best_d == nil or d < best_d then
      best_d = d
      best_s = s
    end
  end
  local allowed_w = beam_half_width_at(b, best_s) + br
  if best_d <= allowed_w then
    return true, best_s
  end
  if b.head + 2 >= b.len then
    local ex_d = math.sqrt((body.x - b.ex) ^ 2 + (body.y - b.ey) ^ 2)
    local tip_r = math.max(allowed_w, b.cut > 0 and (b.cut + br) or 0, (b.impact_radius or 0) > 0 and (b.impact_radius + br) or 0)
    if ex_d <= tip_r then
      return true, b.len
    end
  end
  return false, best_s
end

local function beam_run_hits(b, frame)
  if b.hits == "none" then return end
  if b.len <= 0 then return end
  if b.phase == "end" then return end

  local is_arc = (b.path == "arc" and b.bulge ~= 0 and b.len > 0)
  local anx, any = 0, 0
  if is_arc then
    anx, any = beam_arc_normal(b)
  end

  if b.hits == "first" then
    if b.first_done then return end
    if is_arc then
      local head = b.head
      if head <= 0 then return end
      local candidates = beam_collect_candidates(b, head, true, anx, any)
      local best_body, best_along = nil, nil
      for i = 1, #candidates do
        local body = candidates[i]
        local hit, along = beam_curve_dist(b, body, head, true, anx, any)
        if hit then
          if best_along == nil or along < best_along then
            best_along = along
            best_body = body
          end
        end
      end
      if best_body then
        local key = beam_body_key(best_body)
        if beam_can_hit(b, key, frame) then
          beam_mark_hit(b, key, frame)
          beam_damage_body(b, best_body, best_along)
        end
        if b.hit_cooldown <= 0 then
          b.first_done = true
        end
      end
      return
    end
    if not b.first_target then return end
    if b.reach == "progressive" and b.head + 4 < b.first_dist then return end
    local obj = b.first_target
    if not beam_target_allowed(obj, b.targets) then
      b.first_done = true
      return
    end
    if b.spare_shooter and obj.kind == "worm" and obj.id == b.owner_id then
      b.first_done = true
      return
    end
    local key = beam_body_key(obj)
    if beam_can_hit(b, key, frame) then
      beam_mark_hit(b, key, frame)
      beam_damage_body(b, obj, b.first_dist)
    end
    if b.hit_cooldown <= 0 then
      b.first_done = true
    end
    return
  end

  -- corridor or cone: scan all deterministic candidates along exposed beam
  local head = b.head
  if head <= 0 then return end
  local candidates = beam_collect_candidates(b, head, is_arc, anx, any)
  for i = 1, #candidates do
    local body = candidates[i]
    local key = beam_body_key(body)
    if beam_can_hit(b, key, frame) then
      local hit, along = beam_curve_dist(b, body, head, is_arc, anx, any)
      if hit then
        beam_mark_hit(b, key, frame)
        beam_damage_body(b, body, along)
      end
    end
  end
  b.sampled_upto = head
end

local function beam_resolve_endpoint(b)
  local x0, y0, dx, dy = b.x0, b.y0, b.dx, b.dy
  local range = b.range
  local far_x = x0 + dx * range
  local far_y = y0 + dy * range
  local ex, ey = far_x, far_y
  local first_target = nil
  local hit_terrain = false

  if b.hits == "first" and wa.world and wa.world.trace then
    local with_list = b.stop_on_terrain
      and { "terrain", "worms", "mines", "crates", "oil" }
      or { "worms", "mines", "crates", "oil" }
    if b.targets == "worms" then
      with_list = b.stop_on_terrain and { "terrain", "worms" } or { "worms" }
    end
    local trace_r = math.max(0, math.min(64, b.width))
    local ignore_list = (b.spare_shooter and b.owner_handle) and { b.owner_handle } or nil
    local ok, t = pcall(wa.world.trace, {
      x0 = x0,
      y0 = y0,
      x1 = far_x,
      y1 = far_y,
      radius = trace_r,
      with = with_list,
      ignore = ignore_list,
    })
    if ok and t then
      if t.hit then
        ex = t.x ~= nil and t.x or x0
        ey = t.y ~= nil and t.y or y0
        first_target = t.obj
        hit_terrain = (t.obj == nil)
      elseif t.starts_solid then
        ex, ey = x0, y0
        hit_terrain = true
      end
    end
  elseif b.stop_on_terrain and wa.land and wa.land.trace then
    local ok, h = pcall(wa.land.trace, x0, y0, far_x, far_y)
    if ok and h then
      if h.starts_solid then
        ex, ey = x0, y0
        hit_terrain = true
      elseif h.x ~= nil and h.y ~= nil then
        ex, ey = h.x, h.y
        hit_terrain = true
      end
    end
  end

  local lx, ly = ex - x0, ey - y0
  local len = math.sqrt(lx * lx + ly * ly)
  b.ex, b.ey = ex, ey
  b.len = len
  b.hit_terrain = hit_terrain
  b.first_target = first_target
  b.first_dist = len
end

local function parse_pre_buffer(pb_spec, b_r, b_g, b_b, b_range, b_stop)
  if type(pb_spec) ~= "table" or pb_spec.enabled == false then
    return nil
  end
  local col_int = pb_spec.color ~= nil and tonumber(pb_spec.color) or nil
  local r_c = pb_spec.r ~= nil and tonumber(pb_spec.r) or (col_int and ((col_int >> 16) & 0xFF) or b_r)
  local g_c = pb_spec.g ~= nil and tonumber(pb_spec.g) or (col_int and ((col_int >> 8) & 0xFF) or b_g)
  local b_c = pb_spec.b ~= nil and tonumber(pb_spec.b) or (col_int and (col_int & 0xFF) or b_b)
  local raw_range = tonumber(pb_spec.range)
  local pb_range = (raw_range ~= nil and raw_range > 0) and math.max(1, raw_range) or b_range
  local stop_t = pb_spec.stop_on_terrain == nil and b_stop or (pb_spec.stop_on_terrain == true)
  local reach = "grow"
  if pb_spec.reach == "full" or pb_spec.reach == "converge" then
    reach = pb_spec.reach
  end
  local path = "straight"
  if pb_spec.path == "arc" or pb_spec.path == "jagged" then
    path = pb_spec.path
  end
  local bulge = tonumber(pb_spec.bulge) or 0
  if path == "arc" and bulge == 0 then
    path = "straight"
  end
  return {
    show_beam = pb_spec.show_beam ~= false,
    show_orb = pb_spec.show_orb ~= false,
    orb_scale = pb_spec.orb_scale ~= nil and math.max(0.1, tonumber(pb_spec.orb_scale) or 1) or 1,
    orb_motes = pb_spec.orb_motes ~= nil and math.max(0, math.min(12, math.floor((tonumber(pb_spec.orb_motes) or 0) + 0.5))) or 6,
    range = pb_range,
    stop_on_terrain = stop_t,
    reach = reach,
    converge_spread = pb_spec.converge_spread ~= nil and math.max(2, tonumber(pb_spec.converge_spread) or 36) or 36,
    path = path,
    bulge = bulge,
    noise_px = pb_spec.noise ~= nil and math.max(0, tonumber(pb_spec.noise) or 0) or 10,
    points = pb_spec.points ~= nil and math.max(2, math.min(32, math.floor((tonumber(pb_spec.points) or 12) + 0.5))) or 12,
    core0 = pb_spec.core_width ~= nil and math.max(0, tonumber(pb_spec.core_width) or 0) or 4,
    core1 = pb_spec.tip_width ~= nil and math.max(0, tonumber(pb_spec.tip_width) or 0) or 1.5,
    glow0 = pb_spec.glow_width ~= nil and math.max(0, tonumber(pb_spec.glow_width) or 0) or 12,
    end_width_scale = pb_spec.end_width_scale ~= nil and math.max(0.1, tonumber(pb_spec.end_width_scale) or 1.4) or 1.4,
    r = r_c,
    g = g_c,
    b = b_c,
    rainbow = pb_spec.rainbow == true,
    alpha0 = pb_spec.alpha_start ~= nil and math.max(0, math.min(1, tonumber(pb_spec.alpha_start) or 0.35)) or 0.35,
    alpha1 = pb_spec.alpha_end ~= nil and math.max(0, math.min(1, tonumber(pb_spec.alpha_end) or 0.9)) or 0.9,
    pulse = pb_spec.pulse ~= nil and math.max(0, math.min(1, tonumber(pb_spec.pulse) or 0.2)) or 0.2,
    flicker = pb_spec.flicker ~= nil and math.max(0, math.min(1, tonumber(pb_spec.flicker) or 0)) or 0,
    sprite = pb_spec.sprite,
    glow_sprite = pb_spec.glow_sprite,
    orb_sprite = pb_spec.orb_sprite,
    depth = pb_spec.depth,
    len = 0,
  }
end

local function beam_resolve_buffer_len(b)
  local pb = b.pre_buffer
  if not pb then return end
  if pb.stop_on_terrain and wa.land and wa.land.trace then
    local far_x = b.x0 + b.dx * pb.range
    local far_y = b.y0 + b.dy * pb.range
    local ok, h = pcall(wa.land.trace, b.x0, b.y0, far_x, far_y)
    if ok and h then
      if h.starts_solid then
        pb.len = 0
        return
      elseif h.x ~= nil and h.y ~= nil then
        local lx, ly = h.x - b.x0, h.y - b.y0
        pb.len = math.sqrt(lx * lx + ly * ly)
        return
      end
    end
  end
  pb.len = pb.range
end

-- Reusable ribbon buffers for `look = "ribbon"` (no per-frame table garbage)
local RIBS = nil

local function ensure_beam_renderer()
  if BEAM_DRAW_INSTALLED then return end
  BEAM_DRAW_INSTALLED = true
  if not (wa.on and wa.on.draw and wa.draw and wa.draw.ribbon) then return end

  local core_pts, halo_pts, hot_pts, branch_pts = {}, {}, {}, {}
  for i = 1, 64 do
    core_pts[i] = {}
    halo_pts[i] = {}
    hot_pts[i] = {}
  end
  for i = 1, 8 do
    branch_pts[i] = {}
  end
  RIBS = {
    spec = { blend = "add", points = {} },
    core = core_pts,
    halo = halo_pts,
    hot = hot_pts,
    branch = branch_pts,
  }
  local ORB_QUAD = { blend = "add", points = { {}, {}, {}, {} } }
  local ORB_BROKEN = {}
  local ORB_FALLBACKS = {
    "wf-lib/wfws/sprites/beam_orb.png",
    "wf-lib/effects/sprites/px_effects/glow.png",
  }

  local function draw_quad_orb(sprite, x, y, size, color, depth, visibility)
    if not (sprite and wa.draw and wa.draw.quad) then return false end
    local h = size * 0.5
    local p = ORB_QUAD.points
    p[1].x, p[1].y = x - h, y - h
    p[2].x, p[2].y = x + h, y - h
    p[3].x, p[3].y = x + h, y + h
    p[4].x, p[4].y = x - h, y + h
    ORB_QUAD.sprite = sprite
    ORB_QUAD.color = color
    ORB_QUAD.depth = depth
    ORB_QUAD.frame = 0
    ORB_QUAD.visibility = visibility
    local ok, res = pcall(wa.draw.quad, ORB_QUAD)
    return ok and res ~= false
  end

  local function draw_orb_quad_any(b, x, y, size, color, orb_spr_override, depth_override)
    local d = depth_override or b.depth
    local primary_orb = orb_spr_override or b.orb_sprite
    if primary_orb and not ORB_BROKEN[primary_orb] then
      if draw_quad_orb(primary_orb, x, y, size, color, d, b.visibility) then
        return primary_orb
      end
      ORB_BROKEN[primary_orb] = true
    end
    for i = 1, 2 do
      local spr = ORB_FALLBACKS[i]
      if spr and not ORB_BROKEN[spr] then
        if draw_quad_orb(spr, x, y, size, color, d, b.visibility) then
          return spr
        end
        ORB_BROKEN[spr] = true
      end
    end
    return nil
  end

  local function emit_ribbon(pool, count, sprite, depth, visibility)
    if count < 2 then return end
    local r = RIBS.spec
    r.sprite = sprite
    r.depth = depth
    r.visibility = visibility
    local rp = r.points
    for i = 1, count do rp[i] = pool[i] end
    for i = count + 1, #rp do rp[i] = nil end
    pcall(wa.draw.ribbon, r)
  end

  -- `pool[from..to]` as one ribbon, with `u` spread over `u0..u1` across that
  -- span. The band's own sheets are uniform along x, so rewriting a point's
  -- `u` here can't change a pass drawn before it.
  local function emit_ribbon_range(pool, from, to, sprite, depth, visibility, u0, u1)
    local count = to - from + 1
    if count < 2 then return end
    local r = RIBS.spec
    r.sprite = sprite
    r.depth = depth
    r.visibility = visibility
    local rp = r.points
    local span = count - 1
    for k = 1, count do
      local src = pool[from + k - 1]
      src.u = u0 + (u1 - u0) * ((k - 1) / span)
      rp[k] = src
    end
    for k = count + 1, #rp do rp[k] = nil end
    pcall(wa.draw.ribbon, r)
  end

  local function draw_buffer_orb(b, p_charge, r_c, g_c, b_c, orb_scale, orb_motes, orb_spr_override, depth_override)
    local sc = orb_scale ~= nil and math.max(0.1, orb_scale) or 1
    local motes = orb_motes ~= nil and math.max(0, math.min(12, math.floor(orb_motes + 0.5))) or 6
    local d = depth_override or b.depth
    local pulse = 0.85 + 0.15 * wa.math.sin((b.age or 0) * 0.65)
    local base_r = (4 + p_charge * math.min(20, math.max(4, b.core0) * 0.35 + 6)) * pulse * sc
    local halo_col = beam_tint(0.55 + 0.35 * p_charge, r_c, g_c, b_c)
    local core_col = beam_tint(0.75 + 0.25 * p_charge, 255, 255, 255)
    local mini_col = beam_tint(0.85, 255, 255, 255)
    local orb_spr = draw_orb_quad_any(b, b.x0, b.y0, base_r * 3.6, halo_col, orb_spr_override, d)
    if orb_spr then
      draw_quad_orb(orb_spr, b.x0, b.y0, base_r * 1.8, core_col, d, b.visibility)
      if motes > 0 then
        local orbit_r = (1 - p_charge) * 26 * sc + 3 * sc
        for oi = 0, motes - 1 do
          local ang = (oi / motes) * (2 * PI) + (b.age or 0) * 0.28
          local mx = b.x0 + wa.math.cos(ang) * orbit_r
          local my = b.y0 + wa.math.sin(ang) * orbit_r
          draw_quad_orb(orb_spr, mx, my, 9 * sc, mini_col, d, b.visibility)
        end
      end
      return
    end
    -- Fallback when no radial orb sprite is available: compact muzzle flare
    local fallback_spr = b.glow_sprite or b.sprite
    if fallback_spr then
      local p1, p2 = RIBS.core[1], RIBS.core[2]
      p1.x, p1.y, p1.width, p1.u, p1.color = b.x0 - b.dx * base_r, b.y0 - b.dy * base_r, base_r * 2.0, 0, halo_col
      p2.x, p2.y, p2.width, p2.u, p2.color = b.x0 + b.dx * base_r, b.y0 + b.dy * base_r, base_r * 2.0, 1, core_col
      emit_ribbon(RIBS.core, 2, fallback_spr, d, b.visibility)
    end
  end

  -- Tip flare: blazing white center inside a full-color radial bloom orb
  -- matching the original BeamPreview radial flare.
  local function draw_tip_flare(b, tip_x, tip_y, tip_w, alpha, r_c, g_c, b_c)
    local tip_r = math.max(8, tip_w * 0.9)
    local orb_spr = draw_orb_quad_any(b, tip_x, tip_y, tip_r * 2.1, beam_tint(alpha * 0.85, r_c, g_c, b_c))
    if orb_spr then
      draw_quad_orb(orb_spr, tip_x, tip_y, tip_r * 1.1, beam_tint(alpha * 0.95, 255, 255, 255), b.depth, b.visibility)
    end
  end

  -- Impact spark spray: eight crisp streaks thrown back along the beam's own
  -- heading (total spread 2.1 rad) at radii 6..30, alternating white and beam
  -- color, gated on full extension so open-air range ends spark too.
  local function draw_impact_sparks(b, tip_x, tip_y, alpha, r_c, g_c, b_c)
    if not b.sparks then return end
    if b.head + 2 < b.len then return end
    local sprite = b.sprite or b.glow_sprite
    if not sprite then return end
    local t = b.age or 0
    for s = 1, 8 do
      local spread = (wa.draw.random() * 2 - 1) * 1.05
      local ca, sa = wa.math.cos(spread), wa.math.sin(spread)
      local rx = -b.dx * ca + b.dy * sa
      local ry = -b.dx * sa - b.dy * ca
      local dist = 6 + ((t * 3 + s * 7) % 24)
      local sx = tip_x + rx * dist
      local sy = tip_y + ry * dist
      local is_white = (s % 2 == 1)
      local sr, sg, sb = r_c, g_c, b_c
      if is_white then sr, sg, sb = 255, 255, 255 end
      local p1, p2 = RIBS.branch[1], RIBS.branch[2]
      p1.x, p1.y, p1.width, p1.u, p1.color = sx, sy, 10, 0, beam_tint(alpha, sr, sg, sb)
      p2.x, p2.y, p2.width, p2.u, p2.color = sx - rx * 12, sy - ry * 12, 4, 1, beam_tint(alpha * 0.3, sr, sg, sb)
      emit_ribbon(RIBS.branch, 2, sprite, b.depth, b.visibility)
    end
  end

  local BRANCH_BUF = { 0, 0, 0, 0, 0, 0, 0 }
  local function draw_branch(b, x1, y1, x2, y2, w, alpha, r_c, g_c, b_c, phase, anim_step)
    local bdx, bdy = x2 - x1, y2 - y1
    local blen = math.sqrt(bdx * bdx + bdy * bdy)
    if blen < 1 then return end
    bdx, bdy = bdx / blen, bdy / blen
    local bnx, bny = -bdy, bdx
    local n = 6
    local jitter_scale = math.max(2, b.noise_px * 0.4)
    local kinks = beam_kinks((phase or 0) * 613 + 17 + (anim_step or 0) * 37, 7, BRANCH_BUF)
    local bmin_w = (b.phase == "end") and 0.5 or 3
    for i = 1, n do
      local t = (i - 1) / (n - 1)
      local j = beam_kink_at(kinks, t) * wa.math.sin(t * PI) * jitter_scale
      local p = RIBS.branch[i]
      p.x = x1 + (x2 - x1) * t + bnx * j
      p.y = y1 + (y2 - y1) * t + bny * j
      p.width = math.max(bmin_w, w * (1 - 0.8 * t))
      p.u = t
      p.color = beam_tint(alpha * 0.75 * (1 - t), r_c, g_c, b_c)
    end
    emit_ribbon(RIBS.branch, n, b.sprite, b.depth, b.visibility)
  end

  wa.on.draw(function()
    for idx = 1, #BEAM_ORDER do
      local b = BEAMS[BEAM_ORDER[idx]]
      if b and not b.done then
        local r_c, g_c, b_c = b.r, b.g, b.b
        if b.rainbow then
          r_c, g_c, b_c = beam_rainbow_rgb((b.age * 0.04) % 1)
        end

        if b.phase == "buffer" then
          local p_charge = b.buffer > 0 and math.min(1, b.age / b.buffer) or 1
          local pb = b.pre_buffer
          if pb == nil then
            -- Default charging muzzle orb + soft aim sight line during pre-fire buffer
            local sight_spr = b.glow_sprite or b.sprite
            local sight_len = math.min(b.len > 0 and b.len or b.range, 56 + 180 * p_charge)
            if sight_spr and sight_len >= 2 then
              local p1, p2 = RIBS.core[1], RIBS.core[2]
              local w = 1.5 + 3.0 * p_charge
              local c = beam_tint(0.30 + 0.45 * p_charge, r_c, g_c, b_c)
              p1.x, p1.y, p1.width, p1.u, p1.color = b.x0, b.y0, w * 1.4, 0, c
              p2.x, p2.y, p2.width, p2.u, p2.color = b.x0 + b.dx * sight_len, b.y0 + b.dy * sight_len, 1.0, 1, beam_tint(0.10 * p_charge, r_c, g_c, b_c)
              emit_ribbon(RIBS.core, 2, sight_spr, b.depth, b.visibility)
            end
            draw_buffer_orb(b, p_charge, r_c, g_c, b_c)
          else
            local pr, pg, pb_c = pb.r, pb.g, pb.b
            if pb.rainbow then
              pr, pg, pb_c = beam_rainbow_rgb((b.age * 0.04) % 1)
            end
            local p_alpha = pb.alpha0 + (pb.alpha1 - pb.alpha0) * p_charge
            if pb.pulse > 0 then
              p_alpha = p_alpha * (1 - pb.pulse * 0.45 + pb.pulse * 0.45 * wa.math.sin((b.age or 0) * 0.55))
            end
            if pb.flicker > 0 and wa.draw.random then
              p_alpha = p_alpha * (1 - pb.flicker * 0.5 + wa.draw.random() * pb.flicker)
            end
            if p_alpha < 0 then p_alpha = 0 elseif p_alpha > 1 then p_alpha = 1 end

            local max_len = (pb.len and pb.len > 0) and pb.len or pb.range
            local draw_len = (pb.reach == "grow") and (max_len * p_charge) or max_len
            local spr = pb.sprite or b.sprite
            local gspr = pb.glow_sprite or b.glow_sprite or spr
            local ospr = pb.orb_sprite or b.orb_sprite
            local pdepth = pb.depth or b.depth
            local w_scale = 1 + (pb.end_width_scale - 1) * p_charge

            if pb.show_beam and draw_len >= 2 and p_alpha > 0.005 then
              if pb.path == "jagged" then
                beam_ensure_shape(b, math.floor((b.age or 0) / 2))
              end
              local n = math.min(64, math.max(2, pb.points * 2))
              local denom = n - 1
              local nx, ny = -b.dy, b.dx
              local glow_w1 = pb.core1 > 0 and math.max(pb.glow0, pb.core1 * 1.6) or pb.glow0

              local function draw_prebuffer_strip(lat0, lat1)
                local draw_hot = (pb.core0 * w_scale >= 3) and (spr ~= nil)
                for i = 1, n do
                  local t = (i - 1) / denom
                  local d = draw_len * t
                  local lat = lat0 + (lat1 - lat0) * t
                  if pb.path == "arc" and pb.bulge ~= 0 then
                    lat = lat - pb.bulge * wa.math.sin(t * PI)
                  elseif pb.path == "jagged" and pb.noise_px > 0 and t > 0 and t < 1 then
                    lat = lat + beam_kink_at(b.jag_vals, t) * wa.math.sin(t * PI) * pb.noise_px
                  end
                  local px = b.x0 + b.dx * d + nx * lat
                  local py = b.y0 + b.dy * d + ny * lat
                  local cw = math.max(0.5, (pb.core0 + (pb.core1 - pb.core0) * t) * w_scale)
                  local gw = math.max(1, (pb.glow0 + (glow_w1 - pb.glow0) * t) * w_scale)

                  if pb.glow0 > 0 and gspr then
                    local gp = RIBS.halo[i]
                    gp.x, gp.y, gp.width, gp.u = px, py, gw, t
                    gp.color = beam_tint(p_alpha * 0.55 * (1 - 0.35 * t), pr, pg, pb_c)
                  end
                  if pb.core0 > 0 and spr then
                    local cp = RIBS.core[i]
                    cp.x, cp.y, cp.width, cp.u = px, py, cw, t
                    cp.color = beam_tint(p_alpha * (1 - 0.25 * t), pr, pg, pb_c)
                  end
                  if draw_hot then
                    local hp = RIBS.hot[i]
                    hp.x, hp.y, hp.width, hp.u = px, py, math.max(0.5, cw * 0.42), t
                    hp.color = beam_tint(p_alpha * 0.78 * (1 - 0.2 * t), 255, 255, 255)
                  end
                end
                if pb.glow0 > 0 and gspr then
                  emit_ribbon(RIBS.halo, n, gspr, pdepth, b.visibility)
                end
                if pb.core0 > 0 and spr then
                  emit_ribbon(RIBS.core, n, spr, pdepth, b.visibility)
                  if draw_hot then
                    emit_ribbon(RIBS.hot, n, spr, pdepth, b.visibility)
                  end
                end
              end

              if pb.reach == "converge" then
                local spread = pb.converge_spread * (1 - p_charge)
                draw_prebuffer_strip(spread * 0.25, spread)
                draw_prebuffer_strip(-spread * 0.25, -spread)
              else
                draw_prebuffer_strip(0, 0)
              end
            end

            if pb.show_orb then
              draw_buffer_orb(b, p_charge, pr, pg, pb_c, pb.orb_scale, pb.orb_motes, ospr, pdepth)
            end
          end
        elseif b.head > 1 then
          -- Three times the path resolution. `points` is how many kinks the
          -- bolt has, and on a long beam 16 of them are ~29 px apart: too
          -- coarse to resolve an end that fades over ~20 px, which is how the
          -- core ended up with a one-quad notch at the muzzle (a 4.5 px wide
          -- first point, full width at the second) instead of a taper. The
          -- path, the jag and the fades are analytic, so more samples only
          -- smooth them.
          local n = math.min(64, math.max(2, b.points * 3))
          local denom = n - 1
          local base_alpha = 1
          local width_scale = 1
          local dissolve_noise = 0
          local end_k = 0
          if b.phase == "end" and b.fade > 0 then
            end_k = math.min(1, math.max(0, (b.age - b.buffer - b.grow - b.hold) / b.fade))
            if b.dissipate == "fade" then
              base_alpha = 1 - end_k
            elseif b.dissipate == "dissolve" then
              -- Match BeamPreview: fade & narrow in-place with electric crackle
              -- instead of sweeping points off from tip to muzzle.
              base_alpha = 1 - end_k
              width_scale = math.max(0.15, 1 - end_k * 0.65)
              dissolve_noise = end_k * 14
            end
          end
          local cap_len = math.max(12, math.min(96, math.max(b.glow0, b.glow1) * 0.6))
          if b.flicker > 0 and wa.draw.random then
            base_alpha = base_alpha * (1 - b.flicker * 0.5 + wa.draw.random() * b.flicker)
          end
          if base_alpha > 0.001 then
            local anim_step = (b.phase == "end" and b.dissipate == "dissolve")
              and math.floor(b.age or 0)
              or math.floor((b.age or 0) / 2)
            beam_ensure_shape(b, anim_step)
            local nx, ny = -b.dy, b.dx
            local has_halo = (b.glow0 > 0) or (b.glow1 > 0)
            local tip_x, tip_y = b.x0, b.y0
            local tip_cw = math.max(0.5, math.max(b.core1, b.core0 * 0.5) * width_scale)
            for i = 1, n do
              local t = (i - 1) / denom
              local px, py = beam_point_at(b, i, t, b.head)
              if dissolve_noise > 0 and i > 1 and i < n then
                local j = beam_jag(b, t, dissolve_noise)
                px = px + nx * j
                py = py + ny * j
              end
              if i == n then
                tip_x, tip_y = px, py
              end
              -- The core converges into the ends instead of stopping on a
              -- flat cut, over the same span the endpoint sheet covers, so a
              -- bright filament never ends square inside a fading band.
              local fade_len = math.min(cap_len, math.max(8, b.head * 0.10))
              local k_edge = math.min(1, math.min(t, 1 - t) * b.head / fade_len)
              k_edge = k_edge * k_edge * (3 - 2 * k_edge)
              local min_w = (b.phase == "end") and 0.5 or 3
              local cw = math.max(min_w, (b.core0 + (b.core1 - b.core0) * t) * width_scale * (0.45 + 0.55 * k_edge))
              local pc = RIBS.core[i]
              pc.x = px
              pc.y = py
              pc.width = cw
              pc.u = t
              pc.color = beam_tint(base_alpha * k_edge, r_c, g_c, b_c)

              local phot = RIBS.hot[i]
              phot.x = px
              phot.y = py
              phot.width = math.max(min_w, cw * 0.44)
              phot.u = t
              phot.color = beam_tint(base_alpha * 0.72 * k_edge, 255, 255, 255)

              if has_halo then
                local ph = RIBS.halo[i]
                ph.x = px
                ph.y = py
                ph.width = math.max(min_w, (b.glow0 + (b.glow1 - b.glow0) * t) * width_scale)
                ph.u = t
                ph.color = beam_tint(base_alpha * 0.55, r_c, g_c, b_c)
              end
            end

            -- The endpoint sheet is the band's own first and last piece, and
            -- the glow body is shifted inward to make room for it: nothing is
            -- ever drawn outside the beam, so nothing hangs over the worm at
            -- the muzzle or smears past whatever the beam struck. Its bright
            -- side always faces the interior, so the join with the body is the
            -- same brightness on both sides of it.
            local k0, k1 = 1, n
            if b.end_sprite and has_halo and b.head > cap_len * 2.5 then
              for i = 2, n - 1 do
                if k0 == 1 and (i - 1) / denom * b.head >= cap_len then k0 = i end
                if (i - 1) / denom * b.head > b.head - cap_len then
                  k1 = i
                  break
                end
              end
              if k1 - k0 < 2 then k0, k1 = 1, n end
            end

            -- Original 3-layer energy stack: tinted outer glow + full colored
            -- core + blazing white-hot inner filament.
            if has_halo then
              emit_ribbon_range(RIBS.halo, k0, k1, b.glow_sprite or b.sprite, b.depth, b.visibility, 0, 1)
              if k0 > 1 then
                emit_ribbon_range(RIBS.halo, 1, k0, b.end_sprite, b.depth, b.visibility, 1, 0)
              end
              if k1 < n then
                emit_ribbon_range(RIBS.halo, k1, n, b.end_sprite, b.depth, b.visibility, 0, 1)
              end
            end
            emit_ribbon(RIBS.core, n, b.sprite, b.depth, b.visibility)
            emit_ribbon(RIBS.hot, n, b.sprite, b.depth, b.visibility)

            draw_tip_flare(b, tip_x, tip_y, tip_cw, base_alpha, r_c, g_c, b_c)
            draw_impact_sparks(b, tip_x, tip_y, base_alpha, r_c, g_c, b_c)

            -- Forks off the bolt
            for fi = 1, #b.forks do
              local f = b.forks[fi]
              local f_idx = math.min(n, math.max(1, math.floor(f.t * denom) + 1))
              local bx, by = beam_point_at(b, f_idx, f.t, b.head)
              local freach = (1 - f.t) * b.head * 0.3
              draw_branch(
                b,
                bx,
                by,
                bx + (nx * f.side + b.dx * 0.5) * freach,
                by + (ny * f.side + b.dy * 0.5) * freach,
                math.min(24, math.max(3, b.core0 * 0.55)),
                base_alpha,
                r_c,
                g_c,
                b_c,
                f.phase,
                anim_step
              )
            end

            -- Branches to struck bodies (`hit_branches`, off by default: the
            -- preview has no such pass, so a beam that damages a worm doesn't
            -- grow a limb the author never asked for)
            if b.hit_branches then
              for hi = 1, #b.hits_list do
                local h = b.hits_list[hi]
                if h.t * b.len <= b.head + 4 then
                  local h_idx = math.min(n, math.max(1, math.floor(h.t * denom) + 1))
                  local bx, by = beam_point_at(b, h_idx, h.t, b.head)
                  draw_branch(
                    b,
                    bx,
                    by,
                    h.x,
                    h.y,
                    math.min(20, math.max(4, b.core0 * 0.35)),
                    base_alpha,
                    r_c,
                    g_c,
                    b_c,
                    hi * 0.9,
                    anim_step
                  )
                end
              end
            end
          end
        end
      end
    end
  end)
end

-- Unified hitscan / progressive / cone beam discharge (`wf-lib/wfws_firing`).
function M.beam(ev, spec)
  ev = ev or {}
  spec = spec or {}
  if type(spec) ~= "table" then
    error("wfws_firing.beam: spec must be a table")
  end

  -- Strict spec key validation: typos must never silently do nothing. Walked
  -- with `next` and reported by the sorted-first offender, so the message is
  -- the same on every peer whatever order the table hands its keys back (it is
  -- a load-time guard, not a simulation decision, but a `pairs()` here is a
  -- `lockstep-pairs` note in every bundle that fires a beam).
  local bad_key = nil
  local k = next(spec)
  while k ~= nil do
    if not BEAM_KEYS[k] then
      if bad_key == nil or tostring(k) < tostring(bad_key) then
        bad_key = k
      end
    end
    k = next(spec, k)
  end
  if bad_key ~= nil then
    error("wfws_firing.beam: unknown spec key '" .. tostring(bad_key) .. "'")
  end

  local interact = spec.interact or "hit"
  if interact ~= "hit" and interact ~= "burn" then
    error("wfws_firing.beam: interact must be 'hit' or 'burn'")
  end

  local cut_shape = spec.cut_shape or "circle"
  if cut_shape ~= "circle" and cut_shape ~= "drill" and cut_shape ~= "torch" then
    error("wfws_firing.beam: cut_shape must be 'circle', 'drill', or 'torch'")
  end
  local cut_rad = math.max(0, tonumber(spec.cut) or 0)
  local cut_enabled =
    (cut_shape == "circle" and cut_rad > 0)
    or (cut_shape ~= "circle" and spec.cut ~= false and (cut_rad > 0 or spec.cut == true or spec.cut_shape ~= nil))

  local look = spec.look or "ribbon"
  if look ~= "ribbon" and look ~= "trail" then
    error("wfws_firing.beam: look must be 'ribbon' or 'trail'")
  end
  local branches = math.max(0, math.min(12, math.floor(tonumber(spec.branches) or 0)))
  local dissipate = spec.dissipate or "fade"

  local owner = spec.owner or ev.worm
  local weapon_id = spec.weapon or ev.weapon or ""
  if look == "trail" then
    -- `wa.draw.trail` is a projectile trail: its width ramps with a point's
    -- age along the trail and its tail sheds points, so a ray fed into it can
    -- only look like a round dragging a smear, and it can't grow or retract
    -- the way `BeamPreview` (and the author's card) shows. A beam is a ribbon;
    -- the key stays accepted so an older bundle keeps loading.
    if not BEAM_TRAIL_LOGGED[weapon_id] then
      BEAM_TRAIL_LOGGED[weapon_id] = true
      beam_log("look='trail' is drawn as a ribbon (a beam is a ray, not a projectile trail) for " .. tostring(weapon_id))
    end
    look = "ribbon"
  end
  if not worm_alive(owner) then
    if not BEAM_DEAD_LOGGED[weapon_id] then
      BEAM_DEAD_LOGGED[weapon_id] = true
      beam_log("skipped beam: owner missing or dead (" .. tostring(weapon_id) .. ")")
    end
    return nil
  end
  local owner_id = owner.id
  local owned_by_seq = owner_id ~= nil and seq_running[owner_id] == true
  -- Re-fire guard: swallows WA repeat-fire frames while a beam holds the worm or drains.
  if not owned_by_seq and owner_id ~= nil and beam_guard[owner_id] then
    return nil
  end

  -- Enforce MAX_BEAMS cap cleanly
  if #BEAM_ORDER >= MAX_BEAMS then
    local dropped = false
    for i = 1, #BEAM_ORDER do
      local old = BEAMS[BEAM_ORDER[i]]
      if old and (old.done or old.phase == "end") then
        beam_release_guard(old)
        beam_remove_entry(old)
        dropped = true
        break
      end
    end
    if not dropped then
      beam_log("skipped beam: MAX_BEAMS (" .. tostring(MAX_BEAMS) .. ") reached")
      return nil
    end
  end

  local reach = spec.reach == "progressive" and "progressive" or "instant"
  local buffer = math.max(0, math.floor(tonumber(spec.buffer) or 0))
  local grow_raw = math.max(0, math.floor(tonumber(spec.grow) or 0))
  local grow = reach == "progressive" and math.max(1, grow_raw) or 0
  local hold = math.max(0, math.floor(tonumber(spec.hold) or 0))
  local fade = spec.fade ~= nil and math.max(0, math.floor(tonumber(spec.fade) or 0)) or 4
  if dissipate == "none" and spec.fade == nil then fade = 0 end

  local path = spec.path or "jagged"
  local bulge = tonumber(spec.bulge) or 0
  if path == "arc" and bulge == 0 then
    if not BEAM_ARC_LOGGED[weapon_id] then
      BEAM_ARC_LOGGED[weapon_id] = true
      beam_log("path='arc' with bulge=0 treated as 'straight' (" .. tostring(weapon_id) .. ")")
    end
    path = "straight"
  end

  local points = math.max(2, math.min(64, math.floor(tonumber(spec.points) or 9)))
  local noise_px = spec.noise ~= nil and math.max(0, tonumber(spec.noise) or 0) or 15
  local core0 = spec.core0 ~= nil and math.max(0, tonumber(spec.core0) or 0) or 70
  local core1 = spec.core1 ~= nil and math.max(0, tonumber(spec.core1) or 0) or 6
  local glow0 = spec.glow0 ~= nil and math.max(0, tonumber(spec.glow0) or 0) or 62
  local glow1 = spec.glow1 ~= nil and math.max(0, tonumber(spec.glow1) or 0) or 8

  local col_int = tonumber(spec.color) or 0xCD78FF
  local r_c = spec.r ~= nil and tonumber(spec.r) or ((col_int >> 16) & 0xFF)
  local g_c = spec.g ~= nil and tonumber(spec.g) or ((col_int >> 8) & 0xFF)
  local b_c = spec.b ~= nil and tonumber(spec.b) or (col_int & 0xFF)

  local hits = spec.hits or "corridor"
  local width = spec.width ~= nil and math.max(0, tonumber(spec.width) or 0) or 80
  local width0 = spec.width0 ~= nil and math.max(0, tonumber(spec.width0) or 0) or 8
  local cone_deg = spec.cone_deg ~= nil and math.max(0, math.min(160, tonumber(spec.cone_deg) or 0)) or 24
  local cone_tan = 0
  if hits == "cone" and cone_deg > 0 then
    local half_rad = (cone_deg * 0.5) * DEG2RAD
    local c = wa.math.cos(half_rad)
    cone_tan = c > 0.001 and (wa.math.sin(half_rad) / c) or 0
  end

  local range = spec.range ~= nil and math.max(1, tonumber(spec.range) or 350) or 350
  local stop_on_terrain = spec.stop_on_terrain ~= false
  local hit_cooldown = math.max(0, math.floor(tonumber(spec.hit_cooldown) or 0))

  local off_x = tonumber(spec.offset_x or (spec.offset and spec.offset.x)) or 0
  local off_y = tonumber(spec.offset_y or (spec.offset and spec.offset.y)) or 0
  local standoff = tonumber(spec.standoff) or 0

  local dx, dy = unit_dir_from_ev(ev, spec.aim_clamp)
  local x0, y0 = ev.x, ev.y
  local base_standoff = (x0 == nil or y0 == nil) and (standoff > 0 and standoff or 4) or standoff
  if x0 == nil or y0 == nil then
    x0 = (owner.x or 0) + off_x + base_standoff * dx
    y0 = (owner.y or 0) + off_y + base_standoff * dy
  else
    x0 = x0 + off_x + base_standoff * dx
    y0 = y0 + off_y + base_standoff * dy
  end

  local depth = spec.depth
  if depth == nil then
    depth = (wa.depth and wa.depth.FRONT) or 0x10000
  end

  NEXT_BEAM = NEXT_BEAM + 1
  local start_frame = now_frame()
  local b = {
    id = NEXT_BEAM,
    owner_handle = owner,
    owner_id = owner.id,
    facing = (owner and owner.facing) or (dx < 0 and -1 or 1),
    weapon = weapon_id,
    frame = start_frame,
    x0 = x0,
    y0 = y0,
    dx = dx,
    dy = dy,
    ex = x0,
    ey = y0,
    len = 0,
    head = 0,
    age = 0,
    phase = buffer > 0 and "buffer" or (grow > 0 and "grow" or (hold > 0 and "hold" or "end")),
    reach = reach,
    buffer = buffer,
    pre_buffer = parse_pre_buffer(spec.pre_buffer, r_c, g_c, b_c, range, stop_on_terrain),
    live_aim = spec.live_aim ~= false,
    aim_clamp = spec.aim_clamp,
    off_x = off_x,
    off_y = off_y,
    standoff = standoff,
    base_standoff = base_standoff,
    grow = grow,
    grow_ease = spec.grow_ease or "linear",
    hold = hold,
    fade = fade,
    dissipate = dissipate,
    look = look,
    path = path,
    bulge = bulge,
    noise_px = noise_px,
    points = points,
    branches = branches,
    hit_branches = spec.hit_branches == true,
    core0 = core0,
    core1 = core1,
    glow0 = glow0,
    glow1 = glow1,
    r = r_c,
    g = g_c,
    b = b_c,
    rainbow = spec.rainbow == true,
    flicker = math.max(0, math.min(1, tonumber(spec.flicker) or 0)),
    depth = depth,
    visibility = spec.visibility,
    sprite = spec.sprite or "beam.png",
    glow_sprite = spec.glow_sprite or spec.sprite or "beam_glow.png",
    end_sprite = spec.end_sprite,
    orb_sprite = spec.orb_sprite,
    hits = hits,
    width = width,
    width0 = width0,
    cone_tan = cone_tan,
    hit_cooldown = hit_cooldown,
    range = range,
    stop_on_terrain = stop_on_terrain,
    damage_spec = spec.damage ~= nil and spec.damage or { 20, 30 },
    push = tonumber(spec.push) or 0,
    burn_push = math.max(0, tonumber(spec.burn_push) or 0),
    poison = math.max(0, math.min(1000, math.floor(tonumber(spec.poison) or 0))),
    poisoned = {},
    interact = interact,
    kind = spec.kind or (interact == "hit" and "taze" or "fire"),
    targets = spec.targets == "worms" and "worms" or "all",
    spare_shooter = spec.spare_shooter ~= false,
    taze_mines = spec.taze_mines == true,
    on_taze_mine = type(spec.on_taze_mine) == "function" and spec.on_taze_mine or nil,
    cut = cut_rad,
    cut_shape = cut_shape,
    cut_enabled = cut_enabled,
    impact_radius = math.max(0, tonumber(spec.impact_radius) or 0),
    fire = type(spec.fire) == "table" and spec.fire or nil,
    fire_sampled_upto = 0,
    cut_done = false,
    sparks = spec.sparks == true,
    sound = spec.sound,
    charge_sound = spec.charge_sound,
    impact_sound = spec.impact_sound,
    impact_played = false,
    on_hit = type(spec.on_hit) == "function" and spec.on_hit or nil,
    on_before_hit = type(spec.on_before_hit) == "function" and spec.on_before_hit or nil,
    on_buffer = type(spec.on_buffer) == "function" and spec.on_buffer or nil,
    on_discharge = type(spec.on_discharge) == "function" and spec.on_discharge or nil,
    on_impact = type(spec.on_impact) == "function" and spec.on_impact or nil,
    on_end = type(spec.on_end) == "function" and spec.on_end or nil,
    holds_worm = (not owned_by_seq) and owner_id ~= nil and (buffer + grow + hold > 0),
    last_cut_frame = nil,
    impact_fired = false,
    log = spec.log == true,
    hit = {},
    hits_list = {},
    forks = {},
    jag1 = 0,
    jag2 = 0,
    sampled_upto = 0,
    first_target = nil,
    first_dist = 0,
    first_done = false,
    discharged = false,
    trails_finished = false,
    done = false,
  }

  -- The bolt's shape, seeded once: `wa.random` is the simulation's, so every
  -- peer draws the same bolt.
  b.jag1 = (wa.random(0, 1000000) / 1000000) * (2 * PI)
  b.jag2 = (wa.random(0, 1000000) / 1000000) * (2 * PI)
  beam_seed_shape(b)
  for i = 1, branches do
    b.forks[i] = {
      t = 0.15 + (wa.random(0, 1000000) / 1000000) * 0.7,
      side = wa.random(0, 1) == 1 and 1 or -1,
      phase = (wa.random(0, 1000000) / 1000000) * (2 * PI),
    }
  end

  local function beam_fire_impact(b_ent)
    if b_ent.impact_fired then return end
    b_ent.impact_fired = true
    if b_ent.fire and (b_ent.fire.mode == "impact" or b_ent.fire.mode == "both") then
      beam_spawn_fire_at(b_ent, b_ent.ex, b_ent.ey, b_ent.fire.count or 8, -3)
    end
    if b_ent.on_impact then
      pcall(b_ent.on_impact, b_ent.ex, b_ent.ey, b_ent.owner_handle, b_ent)
    end
  end

  local function release_worm_hold(interrupted)
    if b._worm_released then return end
    b._worm_released = true
    b._release_frame = now_frame()
    if b.holds_worm and owner and owner.shots_to_fire ~= nil then
      owner.shots_fired = owner.shots_to_fire
    end
    if b.on_end then
      pcall(b.on_end, owner, b, interrupted == true)
    end
  end

  local function discharge_now(cur_frame)
    if b.discharged then return end
    b.discharged = true
    if (b.grow + b.hold) <= 0 then
      release_worm_hold(false)
    end
    beam_resolve_endpoint(b)
    bump_shot_counter(owner, 60)
    play_shot_sound(owner, b.sound, 1)
    if b.on_discharge then
      b.on_discharge(owner, b)
    end
    if b.log then
      beam_log(
        "fire id=" .. tostring(b.id) ..
        " weapon=" .. tostring(b.weapon) ..
        " len=" .. tostring(math.floor(b.len + 0.5)) ..
        " hits=" .. tostring(b.hits) ..
        " reach=" .. tostring(b.reach)
      )
    end
    if b.reach == "instant" then
      b.head = b.len
      beam_run_hits(b, cur_frame)
      beam_step_trajectory_fire(b)
      if b.cut_enabled and (b.hit_terrain or not b.stop_on_terrain) then
        beam_apply_cut(b, cur_frame)
      end
      beam_fire_impact(b)
    else
      b.head = 0
    end
  end

  ensure_beam_renderer()

  BEAMS[b.id] = b
  BEAM_ORDER[#BEAM_ORDER + 1] = b.id

  if b.holds_worm then
    beam_guard[owner_id] = b.id
    b._guard = true
    if owner.shots_to_fire ~= nil then
      owner.shots_fired = 0
      owner.shots_to_fire = 1
    end
  end

  if buffer > 0 then
    beam_resolve_buffer_len(b)
    if b.on_buffer then
      b.on_buffer(owner, buffer)
    end
    if b.charge_sound then
      if type(b.charge_sound) == "table" and b.charge_sound.path then
        pcall(wa.sound.play, owner, b.charge_sound.path, tonumber(b.charge_sound.priority) or 10)
      elseif type(b.charge_sound) == "string" or type(b.charge_sound) == "number" then
        pcall(wa.sound.play, owner, b.charge_sound, 10)
      end
    end
  else
    discharge_now(start_frame)
  end

  local total_frames = buffer + grow + hold + fade
  if total_frames <= 0 then
    release_worm_hold(false)
    beam_release_guard(b)
    beam_remove_entry(b)
    return nil
  end

  if not (wa.actors and wa.actors.spawn) then
    release_worm_hold(false)
    beam_release_guard(b)
    beam_remove_entry(b)
    return nil
  end

  -- API 5 body-less driver actor: no `body`, no `collide`, no `drown`, no gravity.
  wa.actors.spawn({
    sprite = false,
    x = b.x0,
    y = b.y0,
    persist = true,
    owner = owner,
    visibility = b.visibility,
    on = function(a)
      local cur = now_frame()
      local age = cur - b.frame
      if age < 0 then age = 0 end
      b.age = age

      if b.done then
        if b._guard and b._release_frame ~= nil and (cur - b._release_frame) < DRAIN_DEFAULT
            and worm_alive(owner) and owner.turn ~= false
            and (b.weapon == "" or owner.weapon == b.weapon)
            and not (owner.state and NOT_FIRING[owner.state] == true) then
          return
        end
        beam_release_guard(b)
        a:remove()
        return
      end

      if age >= total_frames then
        release_worm_hold(false)
        beam_remove_entry(b)
        if b._guard and b._release_frame ~= nil and (cur - b._release_frame) < DRAIN_DEFAULT
            and worm_alive(owner) and owner.turn ~= false
            and (b.weapon == "" or owner.weapon == b.weapon)
            and not (owner.state and NOT_FIRING[owner.state] == true) then
          return
        end
        beam_release_guard(b)
        a:remove()
        return
      end

      local function beam_interrupted()
        return not worm_alive(owner)
          or owner.turn == false
          or (b.weapon ~= "" and owner.weapon ~= b.weapon)
          or (owner.state and NOT_FIRING[owner.state] == true)
      end

      -- Buffer / charge windup phase
      if age < b.buffer then
        b.phase = "buffer"
        if beam_interrupted() then
          release_worm_hold(true)
          beam_release_guard(b)
          beam_remove_entry(b)
          a:remove()
          return
        end
        if b.holds_worm and owner.shots_to_fire ~= nil then
          owner.shots_fired = 0
          owner.shots_to_fire = 1
        end
        if b.live_aim then
          beam_update_live_aim(b, owner)
        else
          local so = b.base_standoff ~= nil and b.base_standoff or (b.standoff > 0 and b.standoff or 4)
          b.x0 = (owner.x or b.x0) + b.off_x + so * b.dx
          b.y0 = (owner.y or b.y0) + b.off_y + so * b.dy
        end
        beam_resolve_buffer_len(b)
        return
      end

      -- Transition out of buffer into active beam
      if not b.discharged then
        discharge_now(cur)
      end

      local active_age = age - b.buffer
      if active_age < b.grow + b.hold then
        if b.holds_worm then
          if beam_interrupted() then
            release_worm_hold(true)
            beam_release_guard(b)
            beam_remove_entry(b)
            a:remove()
            return
          end
          if owner.shots_to_fire ~= nil then
            owner.shots_fired = 0
            owner.shots_to_fire = 1
          end
        end

        if b.live_aim then
          beam_update_live_aim(b, owner)
          beam_resolve_endpoint(b)
          if b.hits == "first" then
            b.first_done = false
          end
        end

        if active_age < b.grow then
          b.phase = "grow"
          local frac = beam_ease(b.grow_ease, active_age / b.grow)
          b.head = b.len * frac
        else
          b.phase = "hold"
          b.head = b.len
        end

        beam_run_hits(b, cur)
        beam_step_trajectory_fire(b)
        if b.head + 2 >= b.len then
          if b.cut_enabled and (b.hit_terrain or not b.stop_on_terrain) then
            beam_apply_cut(b, cur)
          end
          beam_fire_impact(b)
        end
      else
        b.phase = "end"
        release_worm_hold(false)
        if b.dissipate == "retract" and b.fade > 0 then
          local k = math.min(1, math.max(0, (active_age - b.grow - b.hold) / b.fade))
          b.head = b.len * (1 - k)
        else
          b.head = b.len
        end
      end
    end,
  })

  return nil
end

-- Visual-only buffering orb + sight preview for sequenced beams (`SEQ.on_buffer`),
-- where the sequencer owns the charge delay before the first `firing.beam` shot.
function M.beam_buffer(owner, ticks, spec)
  spec = spec or {}
  local dur = math.max(0, math.floor(tonumber(ticks) or 0))
  if dur <= 0 or not worm_alive(owner) then return nil end
  if not (wa.actors and wa.actors.spawn) then return nil end

  local col_int = tonumber(spec.color) or 0x5AD7FF
  local r_c = spec.r ~= nil and tonumber(spec.r) or ((col_int >> 16) & 0xFF)
  local g_c = spec.g ~= nil and tonumber(spec.g) or ((col_int >> 8) & 0xFF)
  local b_c = spec.b ~= nil and tonumber(spec.b) or (col_int & 0xFF)
  local off_x = tonumber(spec.offset_x or (spec.offset and spec.offset.x)) or 0
  local off_y = tonumber(spec.offset_y or (spec.offset and spec.offset.y)) or 0
  local standoff = tonumber(spec.standoff) or 0
  local dx, dy = aim_dir(owner, spec.aim_clamp)
  local depth = spec.depth
  if depth == nil then depth = (wa.depth and wa.depth.FRONT) or 0x10000 end

  ensure_beam_renderer()
  NEXT_BEAM = NEXT_BEAM + 1
  local pb_stop = spec.stop_on_terrain ~= false
  local pb_range = spec.range ~= nil and math.max(1, tonumber(spec.range) or 350) or 350
  local b = {
    id = NEXT_BEAM,
    owner_handle = owner,
    owner_id = owner.id,
    weapon = spec.weapon or owner.weapon or "",
    frame = now_frame(),
    x0 = (owner.x or 0) + off_x + (standoff > 0 and standoff or 4) * dx,
    y0 = (owner.y or 0) + off_y + (standoff > 0 and standoff or 4) * dy,
    dx = dx,
    dy = dy,
    len = 0,
    age = 0,
    phase = "buffer",
    look = "ribbon",
    buffer = dur,
    core0 = spec.core0 ~= nil and math.max(0, tonumber(spec.core0) or 0) or 7,
    range = pb_range,
    r = r_c,
    g = g_c,
    b = b_c,
    rainbow = spec.rainbow == true,
    depth = depth,
    visibility = spec.visibility,
    sprite = spec.sprite,
    glow_sprite = spec.glow_sprite or spec.sprite,
    orb_sprite = spec.orb_sprite,
    off_x = off_x,
    off_y = off_y,
    standoff = standoff,
    aim_clamp = spec.aim_clamp,
    live_aim = spec.live_aim ~= false,
    pre_buffer = parse_pre_buffer(spec.pre_buffer, r_c, g_c, b_c, pb_range, pb_stop),
    jag1 = (wa.random(0, 1000000) / 1000000) * (2 * PI),
    jag2 = (wa.random(0, 1000000) / 1000000) * (2 * PI),
    done = false,
  }
  beam_seed_shape(b)
  beam_resolve_buffer_len(b)
  BEAMS[b.id] = b
  BEAM_ORDER[#BEAM_ORDER + 1] = b.id

  wa.actors.spawn({
    sprite = false,
    x = b.x0,
    y = b.y0,
    persist = true,
    owner = owner,
    visibility = b.visibility,
    on = function(a)
      local age = now_frame() - b.frame
      if age < 0 then age = 0 end
      b.age = age
      local cancelled =
        b.done
        or age >= b.buffer
        or not worm_alive(owner)
        or owner.turn == false
        or (b.weapon ~= "" and owner.weapon ~= b.weapon)
        or (owner.state and NOT_FIRING[owner.state] == true)
      if cancelled then
        beam_remove_entry(b)
        a:remove()
        return
      end
      if b.live_aim then
        local ndx, ndy = aim_dir(owner, b.aim_clamp)
        b.dx, b.dy = ndx, ndy
      end
      b.x0 = (owner.x or b.x0) + b.off_x + (b.standoff > 0 and b.standoff or 4) * b.dx
      b.y0 = (owner.y or b.y0) + b.off_y + (b.standoff > 0 and b.standoff or 4) * b.dy
      beam_resolve_buffer_len(b)
    end,
  })
  return nil
end

return M
