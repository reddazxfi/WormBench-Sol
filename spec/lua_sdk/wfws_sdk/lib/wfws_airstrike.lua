-- wfws_airstrike.lua -- Lockstep Lua airstrike takeover module for WFWS.
--
-- Pure data at load time: zero `wa` reads until `M.install(ctx, spec)`,
-- `M.strike(ev)`, or registered runtime callbacks run. Every simulation
-- decision derives strictly from `wa.world.frame()`, `wa.world`, and `wa.random`
-- / `wa.math` without `pairs` iteration order or wall-clock timing.
--
-- Supports:
--   - Entry modes: "offmap" (fly in from map side), "above" (spawn above drop
--     window), and "payload" (direct drop on sky or cursor with no plane actor).
--   - Release modes: "drop" (discrete 50 Hz ballistic lead) and "strafe"
--     (aimed fire with optional target seeking, distance fuse, stealth
--     steering, trail integration, and FIFO shell casings).
--   - Patterns: "sequential", "burst", "ripple", "pairs", "carpet",
--     "random_window", "offsets", plus multi-phase `release.phases`.
--   - 5-phase speed state machine: approach -> slow -> release -> recover -> exit.
--   - Multi-part vehicle actors (`plane.parts`) with independent frames, mirrors,
--     and pitch/aim angles, plus shootable hull `on.hit` crash handling.

local M = {}

local registry = {}
local sole_weapon_id = nil
local active_strikes = {}
local launched_mains = {}
local launched_born = {}
local shots = {}
local shot_pool = {}
local casings = {}
local casing_pool = {}
local hooks_installed = false
local installed_trail = nil

local HALF_PI = math.pi / 2

-- Preallocated geometry tables reused across every draw quad (zero per-frame allocs).
local CORNERS = { { -1, -1 }, { 1, -1 }, { 1, 1 }, { -1, 1 } }
local QUAD = {
  points = { { 0, 0 }, { 0, 0 }, { 0, 0 }, { 0, 0 } },
  blend = "alpha",
}

-- Preallocated spawner request tables reused on release ticks.
local LAUNCH_REQ = {
  weapon = "",
  owner = nil,
  x = 0,
  y = 0,
  vx = 0,
  vy = 0,
  missile = nil,
  clusters = nil,
}
local MINE_REQ = {
  owner = nil,
  x = 0,
  y = 0,
  vx = 0,
  vy = 0,
  fuse = 400,
  arm = 0,
  damage = 50,
  radius = 48,
  dud_proof = false,
}
local CRATE_REQ = {
  x = 0,
  y = 0,
  kind = "weapon",
  health = 25,
  drop = "chute",
}
local ACTOR_REQ = {
  sprite = false,
  x = 0,
  y = 0,
  vx = 0,
  vy = 0,
  gravity = 1,
  owner = nil,
}
local FIRE_REQ = {
  owner = nil,
  x = 0,
  y = 0,
  vx = 0,
  vy = 4,
  count = 8,
  duration = 4000,
  up_power = 100,
  damage = 20,
}
local BULLET_REQ = {
  weapon = "stock.handgun",
  owner = nil,
  x = 0,
  y = 0,
  dx = 1,
  dy = 0,
  damage = nil,
  push_pct = nil,
}

local function opt(v, fallback)
  if v ~= nil then return v end
  return fallback
end

local function trunc(n)
  if n < 0 then return math.ceil(n) end
  return math.floor(n)
end

local function copy_record_fields(dst, src)
  if type(src) ~= "table" then return dst end
  local keys = wa and wa.sorted and wa.sorted(src)
  if keys then
    for _, k in ipairs(keys) do
      local v = src[k]
      dst[k] = type(v) == "table" and copy_record_fields({}, v) or v
    end
  end
  return dst
end

local function strip_frame(tick, frames, fps, play)
  if frames <= 1 or fps <= 0 then return 0 end
  local raw = math.floor(tick * fps / 50)
  if play == "once" then
    if raw >= frames then return frames - 1 end
    return raw
  elseif play == "pingpong" and frames >= 3 then
    local span = 2 * frames - 2
    local idx = raw % span
    if idx >= frames then return span - idx end
    return idx
  end
  return raw % frames
end

local function find_trail_lib(spec)
  local strafe = spec.strafe
  if spec.trail_lib then return spec.trail_lib end
  if strafe and type(strafe.trail) == "table" and strafe.trail.lib then
    return strafe.trail.lib
  end
  if installed_trail then return installed_trail end
  return nil
end

local function normalize_spec(weapon_id, raw)
  local r = raw or {}
  local entry_r = r.entry or {}
  local plane_r = r.plane or {}
  local speed_r = r.speed or {}
  local rel_r = r.release or {}
  local strafe_r = r.strafe or {}
  local pay_r = r.payload or {}

  local entry_mode = opt(entry_r.mode, "offmap")
  local rel_count = math.max(0, math.floor(opt(rel_r.count, 5)))
  local rel_mode = opt(rel_r.mode, opt(r.mode, "drop"))
  if rel_mode ~= "drop" and rel_mode ~= "strafe" then
    rel_mode = "drop"
  end

  local spec = {
    weapon = weapon_id,
    mode = opt(r.mode, rel_mode),
    direction = opt(r.direction, "arrows"),
    default_dir = opt(r.default_dir, 1) < 0 and -1 or 1,
    zero_vx_uses_facing = opt(r.zero_vx_uses_facing, false),
    stop_on_turn_end = opt(r.stop_on_turn_end, true),

    entry = {
      mode = entry_mode,
      y = entry_r.y, -- explicit nil preserves sky fallback, 0 stays 0
      side = math.max(0, opt(entry_r.side, 16)),
      spawn_at = opt(entry_r.spawn_at, "sky"),
      drop_offset_x = opt(entry_r.drop_offset_x, 0),
    },

    plane = {
      enabled = opt(plane_r.enabled, entry_mode ~= "payload"),
      sprite = opt(plane_r.sprite, "airjetg"),
      frames = math.max(1, math.floor(opt(plane_r.frames, 1))),
      fps = math.max(0, opt(plane_r.fps, 15)),
      play = opt(plane_r.play, "loop"),
      scale = opt(plane_r.scale, 1),
      depth = plane_r.depth,
      facing_flip = opt(plane_r.facing_flip, true),
      bank_angle_approach = opt(plane_r.bank_angle_approach, 0),
      bank_angle_release = opt(plane_r.bank_angle_release, 0),
      bank_rate = math.max(0, opt(plane_r.bank_rate, 0.6)),
      collide = opt(plane_r.collide, false),
      as_object = opt(plane_r.as_object, false),
      hp = math.max(0, opt(plane_r.hp, 0)),
      dead_damage = math.max(0, opt(plane_r.dead_damage, 25)),
      crash_on_terrain = opt(plane_r.crash_on_terrain, false),
      crash_on_water = opt(plane_r.crash_on_water, true),
      boom_mode = opt(plane_r.boom_mode, "native"),
      boom_damage = math.max(0, opt(plane_r.boom_damage, 80)),
      boom_kind = opt(plane_r.boom_kind, 100),
      boom_below = opt(plane_r.boom_below, false),
      boom_radius = math.max(1, opt(plane_r.boom_radius, 120)),
      boom_push_pct = math.max(0, opt(plane_r.boom_push_pct, 100)),
      boom_crater_radius = math.max(0, math.min(200, opt(plane_r.boom_crater_radius, 60))),
      boom_hit_kind = plane_r.boom_hit_kind,
      boom_visual = opt(plane_r.boom_visual, "native"),
      boom_sound = plane_r.boom_sound,
      boom_fires = math.max(0, math.floor(opt(plane_r.boom_fires, 0))),
      boom_fire_count = math.max(1, math.floor(opt(plane_r.boom_fire_count, 7))),
      boom_fire_duration = math.max(100, math.floor(opt(plane_r.boom_fire_duration, 1500))),
      boom_fire_up_power = math.max(0, opt(plane_r.boom_fire_up_power, 55)),
      boom_fire_damage = math.max(0, opt(plane_r.boom_fire_damage, 9)),
      exit_margin = math.max(0, opt(plane_r.exit_margin, 64)),
      timeout_frames = math.max(1, math.floor(opt(plane_r.timeout_frames, 900))),
      fade_out_frames = math.max(0, math.floor(opt(plane_r.fade_out_frames, 0))),
      sound_enter = plane_r.sound_enter,
      sound_loop = plane_r.sound_loop,
      sound_loop_ticks = math.max(0, math.floor(opt(plane_r.sound_loop_ticks, 47))),
      sound_exit = plane_r.sound_exit,
      parts = plane_r.parts or {},
    },

    speed = {
      cruise = math.max(0, opt(speed_r.cruise, 16)),
      release = speed_r.release ~= nil and math.max(0, speed_r.release) or nil,
      min = math.max(0, opt(speed_r.min, 0)),
      exit = speed_r.exit ~= nil and math.max(0, speed_r.exit) or nil,
      decel = math.max(0, opt(speed_r.decel, 0)),
      damping = opt(speed_r.damping, 1),
      release_damping = opt(speed_r.release_damping, 1),
      accel = math.max(0, opt(speed_r.accel, 0)),
      growth = opt(speed_r.growth, 1),
      recover_mode = opt(speed_r.recover_mode, "ramp"),
      recover_delay = math.max(0, math.floor(opt(speed_r.recover_delay, 0))),
      recover_min = math.max(0, opt(speed_r.recover_min, 0.15)),
      slow_distance = math.max(0, opt(speed_r.slow_distance, 0)),
      engage_range = math.max(0, opt(speed_r.engage_range, 0)),
      altitude_mode = opt(speed_r.altitude_mode, "level"),
      dive_vy = opt(speed_r.dive_vy, 0),
      min_y = opt(speed_r.min_y, -600),
      max_y = opt(speed_r.max_y, 2000),
    },

    release = {
      mode = rel_mode,
      pattern = opt(rel_r.pattern, "sequential"),
      count = rel_count,
      cadence_unit = opt(rel_r.cadence_unit, "distance"),
      spacing = math.max(0, opt(rel_r.spacing, 32)),
      frames_between = math.max(0, math.floor(opt(rel_r.frames_between, 3))),
      min_frames = math.max(0, math.floor(opt(rel_r.min_frames, 0))),
      burst_size = math.max(1, math.floor(opt(rel_r.burst_size, rel_count > 0 and rel_count or 1))),
      per_tick = math.max(1, math.floor(opt(rel_r.per_tick, 1))),
      window = math.max(0, opt(rel_r.window, 160)),
      offsets = rel_r.offsets or {},
      windup = math.max(0, math.floor(opt(rel_r.windup, 0))),
      lead = opt(rel_r.lead, true),
      lead_max_back = math.max(0, opt(rel_r.lead_max_back, 0)),
      lead_inertia_y = opt(rel_r.lead_inertia_y, 0),
      jitter_x = math.max(0, opt(rel_r.jitter_x, 0)),
      jitter_y = math.max(0, opt(rel_r.jitter_y, 0)),
      jitter_vx = math.max(0, opt(rel_r.jitter_vx, 0)),
      jitter_vy = math.max(0, opt(rel_r.jitter_vy, 0)),
      sound = rel_r.sound,
      sound_variants = rel_r.sound_variants,
      sound_cooldown = math.max(0, math.floor(opt(rel_r.sound_cooldown, 0))),
      max_pool_retries = math.max(0, math.floor(opt(rel_r.max_pool_retries, 25))),
      phases = rel_r.phases,
    },

    strafe = {
      muzzle_x = opt(strafe_r.muzzle_x, 5),
      muzzle_y = opt(strafe_r.muzzle_y, 12),
      muzzle_length = opt(strafe_r.muzzle_length, 0),
      aim_mode = opt(strafe_r.aim_mode, "target"),
      aim_turn = opt(strafe_r.aim_turn, 1),
      fixed_angle_deg = opt(strafe_r.fixed_angle_deg, 45),
      target_seek = opt(strafe_r.target_seek, false),
      target_box = strafe_r.target_box or { rx = 130, up = 70, down = 80 },
      bullet_speed = math.max(0.1, opt(strafe_r.bullet_speed, 35)),
      steer_frames = math.max(0, math.floor(opt(strafe_r.steer_frames, 3))),
      max_fuse_ms = math.max(0, math.floor(opt(strafe_r.max_fuse_ms, 3000))),
      exit_margin_frames = math.max(0, math.floor(opt(strafe_r.exit_margin_frames, 3))),
      art_sheet = strafe_r.art_sheet,
      art_half = math.max(1, opt(strafe_r.art_half, 16)),
      art_frames = math.max(1, math.floor(opt(strafe_r.art_frames, 1))),
      art_depth = strafe_r.art_depth,
      trail = strafe_r.trail,
      casing = strafe_r.casing,
    },

    payload = {
      kind = opt(pay_r.kind, "missile"),
      weapon = opt(pay_r.weapon, weapon_id),
      inherit_vx = opt(pay_r.inherit_vx, 1),
      vx = opt(pay_r.vx, 1),
      vy = opt(pay_r.vy, 0),
      spread_vx = opt(pay_r.spread_vx, 0),
      spread_vy = opt(pay_r.spread_vy, 0),
      gravity_pct = opt(pay_r.gravity_pct, opt(pay_r.missile and pay_r.missile.gravity_pct, 100)),
      missile = pay_r.missile,
      clusters = pay_r.clusters,
      mine = pay_r.mine or {},
      crate = pay_r.crate or {},
      actor = pay_r.actor or {},
      fire = pay_r.fire or {},
      bullet = pay_r.bullet or {},
    },

    effects = r.effects or {},
    trail_lib = find_trail_lib(r),
  }

  -- Pre-build static per-shot missile override template so hot path never allocates.
  if spec.payload.missile then
    spec._missile_template = copy_record_fields({}, spec.payload.missile)
  end
  if spec.payload.clusters then
    spec._clusters_template = copy_record_fields({}, spec.payload.clusters)
  end
  if spec.release.mode == "strafe" or spec.release.phases then
    spec._strafe_missile_buf = copy_record_fields({}, spec.payload.missile or {})
  end

  local base_rel = spec.release
  local stages = {}
  local total_count = 0
  if type(rel_r.phases) == "table" and #rel_r.phases > 0 then
    for _, pr in ipairs(rel_r.phases) do
      local pcount = math.max(0, math.floor(opt(pr.count, base_rel.count)))
      local pmode = opt(pr.mode, base_rel.mode)
      if pmode ~= "drop" and pmode ~= "strafe" then pmode = "drop" end
      local st = {
        mode = pmode,
        pattern = opt(pr.pattern, base_rel.pattern),
        count = pcount,
        cadence_unit = opt(pr.cadence_unit, pmode == "strafe" and "frames" or base_rel.cadence_unit),
        spacing = math.max(0, opt(pr.spacing, base_rel.spacing)),
        frames_between = math.max(0, math.floor(opt(pr.frames_between, base_rel.frames_between))),
        min_frames = math.max(0, math.floor(opt(pr.min_frames, base_rel.min_frames))),
        burst_size = math.max(1, math.floor(opt(pr.burst_size, pcount > 0 and pcount or 1))),
        per_tick = math.max(1, math.floor(opt(pr.per_tick, base_rel.per_tick))),
        window = math.max(0, opt(pr.window, base_rel.window)),
        offsets = opt(pr.offsets, base_rel.offsets),
        windup = math.max(0, math.floor(opt(pr.windup, 0))),
        lead = opt(pr.lead, base_rel.lead),
        lead_max_back = math.max(0, opt(pr.lead_max_back, base_rel.lead_max_back)),
        lead_inertia_y = opt(pr.lead_inertia_y, base_rel.lead_inertia_y),
        jitter_x = math.max(0, opt(pr.jitter_x, base_rel.jitter_x)),
        jitter_y = math.max(0, opt(pr.jitter_y, base_rel.jitter_y)),
        jitter_vx = math.max(0, opt(pr.jitter_vx, base_rel.jitter_vx)),
        jitter_vy = math.max(0, opt(pr.jitter_vy, base_rel.jitter_vy)),
        sound = pr.sound ~= nil and pr.sound or base_rel.sound,
        sound_variants = opt(pr.sound_variants, base_rel.sound_variants),
        sound_cooldown = math.max(0, math.floor(opt(pr.sound_cooldown, base_rel.sound_cooldown))),
        max_pool_retries = math.max(0, math.floor(opt(pr.max_pool_retries, base_rel.max_pool_retries))),
      }
      stages[#stages + 1] = st
      total_count = total_count + pcount
    end
  else
    stages[1] = base_rel
    total_count = base_rel.count
  end
  spec._stages = stages
  spec._total_count = total_count

  return spec
end

local function prune_mains(now)
  if not (wa and wa.sorted) then return end
  local ids = wa.sorted(launched_mains)
  if #ids <= 50 then return end
  for _, id in ipairs(ids) do
    local born = launched_born[id] or 0
    if now - born > 500 then
      launched_mains[id] = nil
      launched_born[id] = nil
    end
  end
end

local function recycle_shot(id)
  local s = shots[id]
  if not s then return end
  if s.trail_lib and s.trail_lib.drop then
    s.trail_lib.drop(id)
  end
  shots[id] = nil
  s.seen = nil
  s.trail_lib = nil
  shot_pool[#shot_pool + 1] = s
end

local function prune_shots(now)
  if not (wa and wa.sorted) then return end
  local ids = wa.sorted(shots)
  for _, id in ipairs(ids) do
    local r = shots[id]
    if r and now - (r.seen or r.born) > 2 then
      recycle_shot(id)
    end
  end
end

local function ensure_hooks()
  if hooks_installed or not wa or not wa.on then return end
  hooks_installed = true

  if wa.on.missile_frame then
    wa.on.missile_frame(function(m)
      local r = shots[m.id]
      if not r then return end
      if m.phase == "pre" then
        if r.hide_sprite then m.sprite = 0 end
        if r.steer_frames > 0 then
          r.steer_frames = r.steer_frames - 1
          local dx, dy = r.tx - m.x, r.ty - m.y
          local dist = math.sqrt(dx * dx + dy * dy)
          if dist > 0 then
            m.vx = dx / dist * r.speed
            m.vy = dy / dist * r.speed
          end
        end
        return
      end
      r.px = r.cx ~= nil and r.cx or m.x
      r.py = r.cy ~= nil and r.cy or m.y
      r.cx = m.x
      r.cy = m.y
      r.vx = m.vx
      r.vy = m.vy
      r.seen = wa.world.frame()
    end)
  end

  if wa.on.draw and wa.draw and wa.draw.quad then
    local function put_quad(sheet, frame_idx, x, y, half, rot, flip, alpha_color, depth)
      local c = wa.math.cos(rot)
      local sn = wa.math.sin(rot)
      QUAD.sprite = sheet
      QUAD.frame = frame_idx
      QUAD.color = alpha_color
      QUAD.depth = depth
      for i = 1, 4 do
        local k = CORNERS[i]
        local dx = k[1] * flip * half
        local dy = k[2] * half
        QUAD.points[i][1] = x + (dx * c - dy * sn)
        QUAD.points[i][2] = y + (dx * sn + dy * c)
      end
      wa.draw.quad(QUAD)
    end

    wa.on.draw(function()
      local now = wa.world.frame()
      local f = wa.draw.fraction and wa.draw.fraction() or 0
      local depth_obj = wa.depth and wa.depth.OBJECTS or 0x20000
      local depth_bg = wa.depth and wa.depth.BEHIND_TERRAIN or 0x10000

      -- FIFO casing visuals
      while casings[1] and now - casings[1].born >= casings[1].life do
        local old = table.remove(casings, 1)
        casing_pool[#casing_pool + 1] = old
      end
      for _, c in ipairs(casings) do
        local age = now - c.born
        if age < c.life then
          local t = age + f
          local spr = wa.sprites and wa.sprites.key and wa.sprites.key(c.sheet) or c.sheet
          put_quad(
            spr,
            age % c.frames,
            c.x + c.vx * t,
            c.y + c.vy * t + c.g * t * (t + 1) / 2,
            c.half,
            0,
            1,
            nil,
            opt(c.depth, depth_bg)
          )
        end
      end

      -- Active strafe quad projectiles
      local shot_ids = wa.sorted(shots)
      for _, id in ipairs(shot_ids) do
        local r = shots[id]
        if r and r.art_sheet and r.seen and now - r.seen <= 1 then
          local spr = wa.sprites and wa.sprites.key and wa.sprites.key(r.art_sheet) or r.art_sheet
          local rot = -wa.math.atan(r.vx, r.vy) - math.pi
          local flip = r.vx < 0 and -1 or 1
          put_quad(
            spr,
            now % r.art_frames,
            r.cx + (r.cx - r.px) * f,
            r.cy + (r.cy - r.py) * f,
            r.art_half,
            rot,
            flip,
            nil,
            opt(r.art_depth, depth_obj - 1)
          )
        end
      end

      -- Optional fade-out quad render on plane exit
      local active_keys = wa.sorted(active_strikes)
      for _, wid in ipairs(active_keys) do
        local s = active_strikes[wid]
        if s and s.fade_draw and s.fade_alpha > 0 and s.plane_cfg.sprite then
          local spr = wa.sprites and wa.sprites.key and wa.sprites.key(s.plane_cfg.sprite) or s.plane_cfg.sprite
          local alpha = math.max(0, math.min(255, math.floor(s.fade_alpha)))
          local col = alpha * 0x1000000 + 0xFFFFFF
          local flip = s.dir
          if s.plane_cfg.facing_flip then flip = -flip end
          local rot = math.rad(s.bank_angle * s.dir)
          local fidx = strip_frame(s.tick, s.plane_cfg.frames, s.plane_cfg.fps, s.plane_cfg.play)
          put_quad(
            spr,
            fidx,
            s.x,
            s.y,
            32 * s.plane_cfg.scale,
            rot,
            flip,
            col,
            opt(s.plane_cfg.depth, depth_obj + 2)
          )
        end
      end
    end)
  end

  if wa.on.turn_end then
    wa.on.turn_end(function()
      local keys = wa.sorted(active_strikes)
      for _, wid in ipairs(keys) do
        local s = active_strikes[wid]
        if s and s.spec.stop_on_turn_end then
          M.cancel(wid)
        end
      end
      prune_shots(wa.world.frame())
    end)
  end
end

local function pick_direction(spec, ev)
  local mode = spec.direction
  if mode == "left" then return -1 end
  if mode == "right" or mode == "none" then return 1 end
  if mode == "facing" then
    local facing = ev.worm and ev.worm.facing or 1
    return facing < 0 and -1 or 1
  end
  if mode == "nearest" then
    local map_w = wa.world.size().w
    return ev.x < map_w / 2 and 1 or -1
  end
  if mode == "cursor_side" then
    local map_w = wa.world.size().w
    return ev.x < map_w / 2 and 1 or -1
  end
  local evx = opt(ev.vx, 0)
  if evx < 0 then return -1 end
  if evx > 0 then return 1 end
  if spec.zero_vx_uses_facing and ev.worm and ev.worm.facing then
    return ev.worm.facing < 0 and -1 or 1
  end
  return spec.default_dir
end

local function solve_ballistic_drift(y0, target_y, vx0, vy0, gravity_pct, inertia_y)
  local g = wa.world.gravity() * gravity_pct / 100
  if g <= 0 or y0 >= target_y then return 0 end
  local x, y, vy, lvy = 0, y0, vy0, vy0
  for _ = 1, 3000 do
    if y >= target_y then break end
    local vy2 = vy + g
    x = x + vx0
    y = y + vy2
    vy = vy2 + inertia_y * (vy2 - lvy)
    lvy = vy
  end
  return x
end

local function build_drop_schedule_for(center_x, dir, rel)
  local count = rel.count
  local xs = {}
  if count <= 0 then return xs end

  local pattern = rel.pattern
  if pattern == "burst" then
    for k = 1, count do xs[k] = center_x end
  elseif pattern == "ripple" then
    local per = math.max(1, rel.per_tick)
    local groups = math.ceil(count / per)
    for k = 1, count do
      local g_idx = math.floor((k - 1) / per) + 1
      xs[k] = center_x + (g_idx - (groups + 1) / 2) * rel.spacing * dir
    end
  elseif pattern == "pairs" then
    local pairs_total = math.ceil(count / 2)
    local quarter = rel.spacing / 4
    for k = 1, count do
      local p_idx = math.floor((k - 1) / 2) + 1
      local base = center_x + (p_idx - (pairs_total + 1) / 2) * rel.spacing * dir
      local twin = ((k - 1) % 2 == 0) and -quarter or quarter
      xs[k] = base + twin * dir
    end
  elseif pattern == "carpet" then
    local win = rel.window
    local step = count > 1 and (win / (count - 1)) or 0
    local start_x = center_x - (win / 2) * dir
    for k = 1, count do
      xs[k] = start_x + (k - 1) * step * dir
    end
  elseif pattern == "random_window" then
    local half_w = math.floor(rel.window / 2)
    for k = 1, count do
      local rx = half_w > 0 and wa.random(-half_w, half_w) or 0
      xs[k] = center_x + rx * dir
    end
    table.sort(xs, function(a, b)
      if dir > 0 then return a < b end
      return a > b
    end)
  elseif pattern == "offsets" then
    local offsets = rel.offsets
    for k = 1, count do
      local off = offsets[k] ~= nil and offsets[k] or 0
      xs[k] = center_x + off * dir
    end
  else
    -- Default: "sequential"
    for k = 1, count do
      xs[k] = center_x + (k - (count + 1) / 2) * rel.spacing * dir
    end
  end
  return xs
end

local function build_drop_schedule(center_x, dir, spec)
  return build_drop_schedule_for(center_x, dir, spec.release)
end

local function in_box(o, l, r, t, b)
  return o.x > l and o.x < r and o.y > t and o.y < b
end

local function has_los(x0, y0, x1, y1)
  if not (wa.land and wa.land.trace) then return true end
  return wa.land.trace(math.floor(x0), math.floor(y0), math.floor(x1), math.floor(y1)) == nil
end

local function seek_target(s)
  local st = s.spec.strafe
  if not st.target_seek then return s.tx, s.ty end
  local tx, ty = s.tx, s.ty
  local box = st.target_box
  local rx = opt(box.rx, 130)
  local up = opt(box.up, 70)
  local dn = opt(box.down, 80)
  local pick = nil
  local seen_count = 0

  if wa.worms and wa.worms.all then
    for _, w in ipairs(wa.worms.all()) do
      if w.hp > 0 and (not s.owner or w.id ~= s.owner.id) and in_box(w, tx - rx, tx + rx, ty - up, ty + dn) then
        seen_count = seen_count + 1
        if wa.random(1, seen_count) == 1 then pick = w end
      end
    end
    if pick and has_los(s.x, s.y, pick.x, pick.y) then
      return pick.x, pick.y
    end
  end

  pick = nil
  seen_count = 0
  for _, grp in ipairs({ wa.worms, wa.mines, wa.crates, wa.oil }) do
    if grp and grp.all then
      for _, o in ipairs(grp.all()) do
        local is_self = s.owner and o.kind == "worm" and o.id == s.owner.id
        local alive = o.kind ~= "worm" or o.hp > 0
        if alive and not is_self and in_box(o, tx - rx, tx + rx, ty - up, ty + dn) then
          seen_count = seen_count + 1
          if wa.random(1, seen_count) == 1 then pick = o end
        end
      end
    end
  end
  if pick and has_los(s.x, s.y, pick.x, pick.y) then
    return pick.x, pick.y
  end
  return tx, ty
end

local function solve_strafe_fuse(sx, sy, tx, ty, speed, map_w, exit_margin_frames, max_fuse_ms)
  if max_fuse_ms <= 0 then return nil end
  local dx, dy = tx - sx, ty - sy
  local len = math.sqrt(dx * dx + dy * dy)
  if len == 0 then return max_fuse_ms end
  local vx = dx / len * speed
  local frames
  if vx < -0.01 then
    frames = sx / -vx
  elseif vx > 0.01 then
    frames = (map_w - sx) / vx
  else
    return max_fuse_ms
  end
  frames = math.max(frames, 0) + exit_margin_frames
  return math.min(max_fuse_ms, (math.floor(frames) + 1) * 20)
end

local function play_release_sound(s, actor_or_owner)
  local rel = s.spec.release
  local now = wa.world.frame()
  if s.last_release_sound ~= nil and now - s.last_release_sound < rel.sound_cooldown then
    return
  end
  local snd = nil
  if rel.sound_variants and #rel.sound_variants > 0 then
    snd = rel.sound_variants[wa.random(1, #rel.sound_variants)]
  elseif rel.sound ~= nil then
    snd = rel.sound
  end
  if snd ~= nil and wa.sound and wa.sound.play then
    s.last_release_sound = now
    wa.sound.play(actor_or_owner, snd)
  end
end

local function eject_casing(s, sx, sy)
  local cas = s.spec.strafe.casing
  if not cas then return end
  local ang = s.gun_angle + HALF_PI + math.rad(wa.random(-opt(cas.jitter_deg, 17), opt(cas.jitter_deg, 17)))
  local spd = wa.random(opt(cas.speed_min, 200), opt(cas.speed_max, 300)) / 100
  local now = wa.world.frame()
  local life = opt(cas.life, 100)
  while casings[1] and now - casings[1].born >= life do
    local old = table.remove(casings, 1)
    casing_pool[#casing_pool + 1] = old
  end
  local rec = table.remove(casing_pool) or {}
  rec.sheet = cas.sheet
  rec.frames = math.max(1, opt(cas.frames, 16))
  rec.half = opt(cas.half, 30)
  rec.depth = cas.depth
  rec.x = sx
  rec.y = sy
  rec.vx = wa.math.cos(ang) * spd
  rec.vy = wa.math.sin(ang) * spd
  rec.g = wa.world.gravity()
  rec.born = now
  rec.life = life
  casings[#casings + 1] = rec
end

local function despawn_strike_actors(s)
  if s.parts then
    for _, p in ipairs(s.parts) do
      if p.actor and not p.actor.dead then p.actor:remove() end
    end
  end
  if s.hull and not s.hull.dead then s.hull:remove() end
  s.fade_draw = false
  active_strikes[s.spec.weapon] = nil
end

local function is_spawn_blocked(x, y)
  if wa.world and wa.world.collides then
    if wa.world.collides({ x = x, y = y, radius = 9 }) then return true end
  end
  if wa.land and wa.land.solid then
    if wa.land.solid(math.floor(x), math.floor(y)) then return true end
  end
  return false
end

local function boom_plane(s)
  if s.done then return end
  s.done = true
  s.phase = "done"

  local pc = s.plane_cfg
  if s.owner and pc.boom_fires > 0 and wa.fire and wa.fire.spawn then
    local count = math.min(3, pc.boom_fires)
    local offs = { { -3, -1 }, { 3, 20 }, { 0, -3 } }
    for i = 1, count do
      local f = offs[i]
      FIRE_REQ.owner = s.owner
      FIRE_REQ.x = s.x + f[1]
      FIRE_REQ.y = s.y + f[2]
      FIRE_REQ.vx = 0
      FIRE_REQ.vy = 0
      FIRE_REQ.count = pc.boom_fire_count
      FIRE_REQ.duration = pc.boom_fire_duration
      FIRE_REQ.up_power = pc.boom_fire_up_power
      FIRE_REQ.damage = pc.boom_fire_damage
      pcall(wa.fire.spawn, FIRE_REQ)
    end
  end
  if pc.boom_sound ~= nil and wa.sound and wa.sound.play then
    wa.sound.play(s.hull or s.owner, pc.boom_sound)
  end
  if s.spec.effects.on_plane_boom then
    s.spec.effects.on_plane_boom(s)
  end
  if pc.boom_mode == "custom" then
    if (pc.boom_damage > 0 or pc.boom_crater_radius > 0) and wa.world and wa.world.blast then
      wa.world.blast({
        owner = s.owner,
        x = s.x,
        y = s.y,
        damage = pc.boom_damage,
        radius = pc.boom_radius,
        push_pct = pc.boom_push_pct,
        terrain_radius = pc.boom_crater_radius,
        kind = (pc.boom_hit_kind and pc.boom_hit_kind ~= "blast") and pc.boom_hit_kind or nil,
      })
    end
    local want_native_vis = pc.boom_visual == "native" or pc.boom_visual == "both"
    if want_native_vis and s.hull and not s.hull.dead and s.hull.explode then
      s.hull:explode({ damage = 0, id = pc.boom_kind, below = pc.boom_below })
    elseif pc.boom_sound == nil and pc.boom_visual ~= "none" and s.owner and wa.sound and wa.sound.play then
      wa.sound.play(s.owner, wa.random(69, 71))
    end
  else
    if s.hull and not s.hull.dead and s.hull.explode then
      s.hull:explode({ damage = pc.boom_damage, id = pc.boom_kind, below = pc.boom_below })
    end
  end
  despawn_strike_actors(s)
  if s.spec.effects.on_done then s.spec.effects.on_done(s) end
end

local function spawn_one_payload(s, drop_x, drop_y, item_idx)
  local spec = s.spec
  local rel = s.active_rel or spec.release
  local pay = spec.payload
  local dir = s.dir
  local is_strafe = rel.mode == "strafe"

  local sx = drop_x + (rel.jitter_x > 0 and wa.random(-rel.jitter_x, rel.jitter_x) or 0)
  local sy = drop_y + (rel.jitter_y > 0 and wa.random(-rel.jitter_y, rel.jitter_y) or 0)

  if (spec.entry.mode == "payload" or not spec.plane.enabled) and spec.entry.spawn_at == "cursor" and is_spawn_blocked(sx, sy) then
    return false, "blocked"
  end

  local center_offset = item_idx - (rel.count + 1) / 2
  local jvx = rel.jitter_vx > 0 and (wa.random(-rel.jitter_vx, rel.jitter_vx) / 100) or 0
  local jvy = rel.jitter_vy > 0 and (wa.random(-rel.jitter_vy, rel.jitter_vy) / 100) or 0

  local vx, vy
  local tx, ty = s.tx, s.ty
  local solved_fuse = nil

  if is_strafe then
    local st = spec.strafe
    local right = dir >= 0
    local mx = s.x + (right and st.muzzle_x or -st.muzzle_x)
    local my = s.y + st.muzzle_y
    if st.muzzle_length ~= 0 then
      local final = right and s.gun_angle or (math.pi - s.gun_angle)
      local ang = -(HALF_PI + final)
      local lx = (right and 1 or -1)
      local ly = -st.muzzle_length
      local c = wa.math.cos(ang)
      local sn = wa.math.sin(ang)
      sx = mx + c * lx - sn * ly
      sy = my + sn * lx + c * ly
    else
      sx, sy = mx, my
    end
    tx, ty = seek_target(s)
    if rel.jitter_x > 0 then tx = tx + wa.random(-rel.jitter_x, rel.jitter_x) end
    if rel.jitter_y > 0 then ty = ty + wa.random(-rel.jitter_y, rel.jitter_y) end

    local dx, dy = tx - sx, ty - sy
    if st.aim_mode == "fixed" then
      local rad = math.rad(st.fixed_angle_deg)
      dx = wa.math.cos(rad) * dir
      dy = wa.math.sin(rad)
    end
    local len = math.sqrt(dx * dx + dy * dy)
    if len == 0 then dx, dy, len = dir, 0, 1 end
    vx = (dx / len) * st.bullet_speed + center_offset * pay.spread_vx * dir + jvx
    vy = (dy / len) * st.bullet_speed + center_offset * pay.spread_vy + jvy
    solved_fuse = solve_strafe_fuse(sx, sy, tx, ty, st.bullet_speed, s.map_w, st.exit_margin_frames, st.max_fuse_ms)
  else
    vx = pay.inherit_vx * (s.vx * dir) + pay.vx * dir + center_offset * pay.spread_vx * dir + jvx
    vy = pay.vy + center_offset * pay.spread_vy + jvy
  end

  local kind = pay.kind
  local sound_target = s.hull or s.owner

  if kind == "missile" then
    local now = wa.world.frame()
    prune_mains(now)
    prune_shots(now)

    LAUNCH_REQ.weapon = pay.weapon
    LAUNCH_REQ.owner = s.owner
    LAUNCH_REQ.x = sx
    LAUNCH_REQ.y = sy
    if is_strafe and spec.strafe.steer_frames > 0 then
      LAUNCH_REQ.vx = 0
      LAUNCH_REQ.vy = 0
    else
      LAUNCH_REQ.vx = vx
      LAUNCH_REQ.vy = vy
    end

    if is_strafe and solved_fuse ~= nil then
      local buf = spec._strafe_missile_buf
      buf.fuse = solved_fuse
      LAUNCH_REQ.missile = buf
    else
      LAUNCH_REQ.missile = spec._missile_template
    end
    LAUNCH_REQ.clusters = spec._clusters_template

    local ok, id = pcall(wa.weapons.launch, LAUNCH_REQ)
    if not ok then
      if tostring(id):find("object pool is full", 1, true) then
        return false, "pool_full"
      end
      error(id, 0)
    end
    if id then
      launched_mains[id] = true
      launched_born[id] = now

      local st = spec.strafe
      if is_strafe and (st.steer_frames > 0 or st.art_sheet ~= nil or st.trail ~= nil) then
        local sh = table.remove(shot_pool) or {}
        sh.x = sx
        sh.y = sy
        sh.px = sx
        sh.py = sy
        sh.cx = sx
        sh.cy = sy
        sh.vx = vx
        sh.vy = vy
        sh.tx = tx
        sh.ty = ty
        sh.speed = st.bullet_speed
        sh.steer_frames = st.steer_frames
        sh.hide_sprite = st.art_sheet ~= nil or opt(st.hide_wa_sprite, st.steer_frames > 0)
        sh.art_sheet = st.art_sheet
        sh.art_half = st.art_half
        sh.art_frames = st.art_frames
        sh.art_depth = st.art_depth
        sh.born = now
        sh.seen = now
        shots[id] = sh
        local tlib = find_trail_lib(spec)
        if st.trail and tlib and tlib.add then
          sh.trail_lib = tlib
          tlib.add(id, s.owner, st.trail)
        end
      end
    end

    if is_strafe then
      s.firing_flash = 1
      eject_casing(s, sx, sy)
    end
    play_release_sound(s, sound_target)
    if spec.effects.on_release then spec.effects.on_release(s, id, sx, sy, item_idx) end
    return true, id
  elseif kind == "mine" then
    local mc = pay.mine
    MINE_REQ.owner = s.owner
    MINE_REQ.x = sx
    MINE_REQ.y = sy
    MINE_REQ.vx = vx
    MINE_REQ.vy = vy
    MINE_REQ.fuse = opt(mc.fuse, 400)
    MINE_REQ.arm = opt(mc.arm, 0)
    MINE_REQ.damage = opt(mc.damage, 50)
    MINE_REQ.radius = opt(mc.radius, 48)
    MINE_REQ.dud_proof = opt(mc.dud_proof, false)
    local ok, m = pcall(wa.mines.spawn, MINE_REQ)
    if not ok then
      if tostring(m):find("object pool is full", 1, true) then return false, "pool_full" end
      error(m, 0)
    end
    play_release_sound(s, sound_target)
    if spec.effects.on_release then spec.effects.on_release(s, m, sx, sy, item_idx) end
    return true, m
  elseif kind == "crate" then
    local cc = pay.crate
    CRATE_REQ.x = sx
    CRATE_REQ.y = sy
    CRATE_REQ.kind = opt(cc.kind, "weapon")
    CRATE_REQ.health = opt(cc.health, 25)
    CRATE_REQ.drop = opt(cc.drop, "chute")
    CRATE_REQ.contents = cc.contents
    CRATE_REQ.amount = cc.amount
    local ok, c = pcall(wa.crates.spawn, CRATE_REQ)
    if not ok and CRATE_REQ.kind ~= "health" then
      CRATE_REQ.kind = "health"
      ok, c = pcall(wa.crates.spawn, CRATE_REQ)
    end
    play_release_sound(s, sound_target)
    if spec.effects.on_release then spec.effects.on_release(s, c, sx, sy, item_idx) end
    return ok, c
  elseif kind == "actor" then
    local ac = pay.actor
    ACTOR_REQ.gravity = 1
    ACTOR_REQ.body = nil
    ACTOR_REQ.sprite = false
    copy_record_fields(ACTOR_REQ, ac)
    if type(ACTOR_REQ.gravity) == "boolean" then
      ACTOR_REQ.gravity = ACTOR_REQ.gravity and 1 or 0
    end
    if ACTOR_REQ.body == nil and (ACTOR_REQ.collide or ACTOR_REQ.as_object) then
      ACTOR_REQ.body = {
        layer = ACTOR_REQ.as_object and "object" or "missile",
        hits = { land = true, worms = true },
        hit_by = "all",
      }
    end
    ACTOR_REQ.collide = nil
    ACTOR_REQ.as_object = nil
    ACTOR_REQ.owner = opt(ac.owner, s.owner)
    ACTOR_REQ.x = sx
    ACTOR_REQ.y = sy
    ACTOR_REQ.vx = vx
    ACTOR_REQ.vy = vy
    local a = wa.actors.spawn(ACTOR_REQ)
    play_release_sound(s, sound_target)
    if spec.effects.on_release then spec.effects.on_release(s, a, sx, sy, item_idx) end
    return true, a
  elseif kind == "fire" then
    local fc = pay.fire
    copy_record_fields(FIRE_REQ, fc)
    FIRE_REQ.owner = s.owner
    FIRE_REQ.x = sx
    FIRE_REQ.y = sy
    FIRE_REQ.vx = vx
    FIRE_REQ.vy = vy
    FIRE_REQ.count = opt(fc.count, 8)
    FIRE_REQ.duration = math.max(1, opt(fc.duration, 4000))
    FIRE_REQ.up_power = opt(fc.up_power, 100)
    FIRE_REQ.damage = opt(fc.damage, 20)
    local ok, fid = pcall(wa.fire.spawn, FIRE_REQ)
    if not ok then return false, "pool_full" end
    play_release_sound(s, sound_target)
    if spec.effects.on_release then spec.effects.on_release(s, fid, sx, sy, item_idx) end
    return true, fid
  elseif kind == "bullet" then
    local bc = pay.bullet
    local dx, dy = tx - sx, ty - sy
    if not is_strafe then
      dx, dy = vx, vy
    end
    local len = math.sqrt(dx * dx + dy * dy)
    if len == 0 then dx, dy, len = dir, 0, 1 end
    BULLET_REQ.weapon = opt(bc.weapon, "stock.handgun")
    BULLET_REQ.owner = s.owner
    BULLET_REQ.x = sx
    BULLET_REQ.y = sy
    BULLET_REQ.dx = dx / len
    BULLET_REQ.dy = dy / len
    BULLET_REQ.damage = bc.damage
    BULLET_REQ.push_pct = bc.push_pct
    wa.weapons.fire_bullet(BULLET_REQ)
    play_release_sound(s, sound_target)
    if spec.effects.on_release then spec.effects.on_release(s, true, sx, sy, item_idx) end
    return true, true
  end

  return true, nil
end

local function sync_parts_and_hull(s)
  local pc = s.plane_cfg
  local depth_obj = wa.depth and wa.depth.OBJECTS or 0x20000
  local base_depth = opt(pc.depth, depth_obj + 2)
  local face = s.dir
  if pc.facing_flip then face = -face end

  if s.hull and not s.hull.dead then
    s.hull.x = s.x
    s.hull.y = s.y
    s.hull.vx = 0
    s.hull.vy = 0
    s.hull.facing = face
    if s.hull.frame then
      s.hull:frame(strip_frame(s.tick, pc.frames, pc.fps, pc.play))
    end
    if s.hull.gfx then
      local angle = (s.bank_angle * s.dir) % 360
      s.hull:gfx({ angle = angle, scale = pc.scale, depth = base_depth })
    end
  end

  if not s.parts then return end
  local right = s.dir >= 0
  for _, p in ipairs(s.parts) do
    local a = p.actor
    local c = p.cfg
    if a and not a.dead then
      local ox = opt(c.ox, 0) * (right and 1 or -1)
      local oy = opt(c.oy, 0)
      a.x = s.x + ox
      a.y = s.y + oy
      local pface = opt(c.facing_flip, false) and -face or face
      a.facing = pface

      if a.frame then
        if c.aim_sync then
          local norm = (s.gun_angle + math.pi) / (math.pi * 1.5)
          if norm < 0 then norm = 0 elseif norm > 1 then norm = 1 end
          local nframes = math.max(1, opt(c.frames, 32))
          a:frame(math.floor((1 - norm) * (nframes - 1)))
        elseif c.firing_frames then
          a:frame(s.firing_flash > 0 and 1 or 0)
        elseif opt(c.frames, 1) > 1 then
          a:frame(strip_frame(s.tick, c.frames, opt(c.fps, 15), opt(c.play, "loop")))
        end
      end

      if a.gfx then
        local rot
        if c.track_gun then
          local final = right and s.gun_angle or (math.pi - s.gun_angle)
          rot = (-math.deg(HALF_PI + final) + opt(c.angle_offset, 0)) % 360
        else
          rot = ((s.bank_angle * opt(c.bank_scale, 1) * s.dir) + opt(c.angle_offset, 0)) % 360
        end
        a:gfx({ angle = rot, scale = c.scale, depth = base_depth + opt(c.depth_offset, -1) })
      end
    end
  end
end

local function update_aim_and_bank(s, instant)
  local st = s.spec.strafe
  local target_ang
  if st.aim_mode == "fixed" then
    target_ang = math.rad(st.fixed_angle_deg)
  else
    target_ang = wa.math.atan(s.ty - s.y, math.abs(s.tx - s.x))
    if target_ang > HALF_PI then target_ang = HALF_PI end
    if target_ang < -math.pi then target_ang = -math.pi end
  end
  if instant then
    s.gun_angle = target_ang
  else
    s.gun_angle = s.gun_angle + (target_ang - s.gun_angle) * st.aim_turn
  end

  local pc = s.plane_cfg
  local want_bank = 0
  if s.phase == "approach" then
    want_bank = pc.bank_angle_approach
  elseif s.phase == "slow" or s.phase == "release" then
    want_bank = pc.bank_angle_release
  else
    want_bank = pc.bank_angle_approach
  end
  if pc.bank_rate <= 0 then
    s.bank_angle = want_bank
  elseif s.bank_angle < want_bank then
    s.bank_angle = math.min(want_bank, s.bank_angle + pc.bank_rate)
  elseif s.bank_angle > want_bank then
    s.bank_angle = math.max(want_bank, s.bank_angle - pc.bank_rate)
  end
end

local function crossed_x(dir, target_x, x)
  if dir > 0 then return x >= target_x end
  return x <= target_x
end

local function step_plane(s)
  if s.done then return end
  local now = wa.world.frame()
  local elapsed = now - s.start_frame
  local spec = s.spec
  local pc = s.plane_cfg
  local spd = spec.speed
  local rel = spec.release

  local prev_x, prev_y = s.x, s.y
  s.tick = elapsed
  s.firing_flash = 0

  -- Hard timeout and boundary despawn bounds
  if elapsed >= pc.timeout_frames then
    s.done = true
    s.phase = "done"
    despawn_strike_actors(s)
    if spec.effects.on_done then spec.effects.on_done(s) end
    return
  end

  local function resolve_crash_dive_rate()
    if spd.dive_vy ~= 0 then return math.abs(spd.dive_vy) end
    if s.dive_rate == nil then
      local dist_x = math.max(16, math.abs(s.tx - s.x))
      local ticks = math.max(1, dist_x / math.max(1, s.vx))
      s.dive_rate = math.max(1.2, math.min(18, math.max(16, s.ty - s.y) / ticks))
    end
    return s.dive_rate
  end

  if (pc.collide or pc.crash_on_terrain) and pc.crash_on_water and wa.world.water then
    local water_y = wa.world.water()
    if s.y >= water_y and s.x > -300 and s.x < s.map_w + 300 then
      if s.hull and not s.hull.dead then
        s.hull.x = s.x
        s.hull.y = s.y
      end
      boom_plane(s)
      return
    end
  end

  -- Phase transitions
  if s.phase == "approach" then
    local enter_slow = false
    if spd.engage_range > 0 then
      enter_slow = math.abs(s.x - s.tx) <= spd.engage_range
    elseif s.count > 0 then
      local gate_x = s.drops[1] - spd.slow_distance * s.dir
      enter_slow = crossed_x(s.dir, gate_x, s.x)
    elseif spd.slow_distance > 0 then
      local gate_x = s.tx - spd.slow_distance * s.dir
      enter_slow = crossed_x(s.dir, gate_x, s.x)
    end
    if enter_slow then
      s.phase = "slow"
      s.phase_start = now
      s.cooldown = rel.windup
      update_aim_and_bank(s, spd.engage_range > 0)
    elseif s.count == 0 and spd.slow_distance <= 0 and spd.engage_range <= 0 then
      s.phase = "recover"
      s.phase_start = now
    end
  end

  if s.phase == "slow" then
    if spd.damping ~= 1 then s.vx = s.vx * spd.damping end
    if spd.decel > 0 then s.vx = s.vx - spd.decel end
    if spd.release ~= nil and spd.damping == 1 and spd.decel == 0 then
      s.vx = spd.release
    end
    local floor_v = math.max(spd.min, spd.release ~= nil and spd.release or spd.min)
    if s.vx < floor_v then s.vx = floor_v end

    local ready_gate = true
    if s.count > 0 and spd.engage_range <= 0 then
      ready_gate = crossed_x(s.dir, s.drops[1], s.x)
    end
    if s.cooldown > 0 then
      s.cooldown = s.cooldown - 1
    end
    if spd.altitude_mode == "crash_dive" then
      s.y = math.min(spd.max_y, s.y + resolve_crash_dive_rate())
    end
    if s.cooldown <= 0 and ready_gate then
      if s.count == 0 then
        s.phase = "recover"
        s.phase_start = now
      else
        s.phase = "release"
        s.phase_start = now
        s.cadence_cd = 0
      end
    end
  end

  if s.phase == "release" then
    local active_rel = s.active_rel or rel
    local rel_floor = (spd.release ~= nil) and math.max(spd.min, spd.release) or spd.min
    if spd.release_damping ~= 1 then s.vx = math.max(spd.min, s.vx * spd.release_damping) end
    if spd.decel > 0 and s.vx > rel_floor then s.vx = math.max(rel_floor, s.vx - spd.decel) end
    if spd.min >= 0 and s.vx < spd.min then s.vx = spd.min end

    if spd.altitude_mode == "crash_dive" then
      s.y = math.min(spd.max_y, s.y + resolve_crash_dive_rate())
    elseif spd.altitude_mode == "dive" and spd.dive_vy ~= 0 then
      s.y = math.max(spd.min_y, math.min(spd.max_y, s.y + math.abs(spd.dive_vy)))
    elseif spd.altitude_mode == "climb" and spd.dive_vy ~= 0 then
      s.y = math.max(spd.min_y, math.min(spd.max_y, s.y - math.abs(spd.dive_vy)))
    end

    -- Evaluate releases before position integration for exact entry alignment
    local stage_count = active_rel.count
    if active_rel.cadence_unit == "frames" or active_rel.pattern == "burst" or active_rel.pattern == "ripple" or active_rel.pattern == "pairs" then
      if s.cadence_cd > 0 then
        s.cadence_cd = s.cadence_cd - 1
      else
        local first_gate = s.stage_released == 0 and active_rel.mode == "drop" and stage_count > 0 and spd.engage_range <= 0 and not crossed_x(s.dir, s.drops[1], s.x)
        if not first_gate then
          local batch = 1
          if active_rel.pattern == "burst" then
            batch = math.min(stage_count - s.stage_released, active_rel.burst_size)
          elseif active_rel.pattern == "ripple" then
            batch = math.min(stage_count - s.stage_released, active_rel.per_tick)
          elseif active_rel.pattern == "pairs" then
            batch = math.min(stage_count - s.stage_released, 2)
          elseif active_rel.pattern == "carpet" and active_rel.per_tick > 1 then
            batch = math.min(stage_count - s.stage_released, active_rel.per_tick)
          end
          local ok_count = 0
          local blocked = false
          for _ = 1, batch do
            local idx = s.stage_released + 1
            local dx = active_rel.mode == "drop" and s.drops[idx] or s.x
            local ok, res = spawn_one_payload(s, dx, s.y, s.released + 1)
            if ok then
              s.stage_released = idx
              s.released = s.released + 1
              s.pool_retries = 0
              ok_count = ok_count + 1
            elseif res == "pool_full" then
              s.pool_retries = s.pool_retries + 1
              if s.pool_retries > active_rel.max_pool_retries then
                s.stage_released = idx
                s.released = s.released + 1
                s.pool_retries = 0
              else
                blocked = true
              end
              break
            else
              s.stage_released = idx
              s.released = s.released + 1
            end
          end
          if ok_count > 0 or not blocked then
            s.cadence_cd = active_rel.frames_between
          end
        end
      end
    else
      -- Distance-driven cadence
      if s.cadence_cd > 0 then s.cadence_cd = s.cadence_cd - 1 end
      while s.stage_released < stage_count and s.cadence_cd <= 0 do
        local idx = s.stage_released + 1
        local tx_drop = s.drops[idx]
        if not crossed_x(s.dir, tx_drop, s.x) then break end
        local ok, res = spawn_one_payload(s, tx_drop, s.y, s.released + 1)
        if ok then
          s.stage_released = idx
          s.released = s.released + 1
          s.pool_retries = 0
          if active_rel.min_frames > 0 then
            s.cadence_cd = active_rel.min_frames
            break
          end
        elseif res == "pool_full" then
          s.pool_retries = s.pool_retries + 1
          if s.pool_retries > active_rel.max_pool_retries then
            s.stage_released = idx
            s.released = s.released + 1
            s.pool_retries = 0
          else
            break
          end
        else
          s.stage_released = idx
          s.released = s.released + 1
        end
      end
    end

    if s.stage_released >= stage_count then
      if s.stage_idx < #s.stages then
        s.stage_idx = s.stage_idx + 1
        local nxt = s.stages[s.stage_idx]
        s.active_rel = nxt.rel
        s.drops = nxt.drops
        s.stage_released = 0
        s.cadence_cd = nxt.rel.windup
      else
        s.phase = "recover"
        s.phase_start = now
        if spd.recover_delay == 0 and spd.recover_mode == "snap" then
          s.vx = spd.exit ~= nil and spd.exit or spd.cruise
          s.phase = "exit"
          if pc.sound_exit ~= nil and wa.sound and wa.sound.play then
            wa.sound.play(s.hull or s.owner, pc.sound_exit)
          end
        elseif spd.growth > 1 and s.vx < spd.recover_min then
          s.vx = spd.recover_min
        end
      end
    end
  end

  if s.phase == "recover" then
    if spd.altitude_mode == "crash_dive" then
      s.y = math.min(spd.max_y, s.y + resolve_crash_dive_rate())
    end
    local p_elapsed = now - s.phase_start
    if p_elapsed >= spd.recover_delay then
      local exit_v = spd.exit ~= nil and spd.exit or spd.cruise
      if spd.recover_mode == "snap" then
        s.vx = exit_v
        s.phase = "exit"
      elseif spd.recover_mode == "hold" then
        s.phase = "exit"
      else
        if s.vx < spd.recover_min and (spd.growth > 1 or spd.accel > 0) then
          s.vx = spd.recover_min
        end
        if spd.growth ~= 1 then s.vx = math.min(exit_v, s.vx * spd.growth) end
        if spd.accel > 0 then s.vx = math.min(exit_v, s.vx + spd.accel) end
        if s.vx >= exit_v or (spd.growth == 1 and spd.accel == 0) then
          s.vx = exit_v
          s.phase = "exit"
        end
      end
      if s.phase == "exit" and pc.sound_exit ~= nil and wa.sound and wa.sound.play then
        wa.sound.play(s.hull or s.owner, pc.sound_exit)
      end
    end
  end

  if s.phase == "exit" then
    if spd.altitude_mode == "crash_dive" then
      s.y = math.min(spd.max_y, s.y + resolve_crash_dive_rate())
    elseif spd.altitude_mode ~= "level" and spd.dive_vy ~= 0 and math.abs(s.y - s.init_y) > 0.5 then
      if s.y > s.init_y then
        s.y = math.max(s.init_y, s.y - math.abs(spd.dive_vy))
      else
        s.y = math.min(s.init_y, s.y + math.abs(spd.dive_vy))
      end
    end
    if pc.fade_out_frames > 0 then
      if not s.fade_draw then
        s.fade_draw = true
        s.fade_alpha = 255
        if s.hull and not s.hull.dead and s.hull.gfx then
          s.hull:gfx({ blend = "add", tint = 0 }) -- hide actor sprite cleanly during quad fade
        end
      end
      s.fade_alpha = math.max(0, s.fade_alpha - (255 / pc.fade_out_frames))
    end
  end

  s.x = s.x + s.dir * s.vx
  s.vy = s.y - prev_y

  -- Deterministic terrain impact check when crash_on_terrain is enabled
  if pc.crash_on_terrain and wa.land and s.x >= 0 and s.x < s.map_w and s.y >= 0 then
    local hit_x, hit_y = nil, nil
    if wa.land.trace then
      local h = wa.land.trace(math.floor(prev_x), math.floor(prev_y), math.floor(s.x), math.floor(s.y))
      if h and (h.hit == nil or h.hit) then
        hit_x = h.x or s.x
        hit_y = h.y or s.y
      end
    end
    if not hit_x and wa.land.solid and wa.land.solid(math.floor(s.x), math.floor(s.y)) then
      hit_x, hit_y = s.x, s.y
    end
    if hit_x then
      s.x, s.y = hit_x, hit_y
      if s.hull and not s.hull.dead then
        s.hull.x = s.x
        s.hull.y = s.y
      end
      boom_plane(s)
      return
    end
  end

  if (pc.collide or pc.crash_on_terrain) and pc.crash_on_water and wa.world.water then
    local water_y = wa.world.water()
    if s.y >= water_y and s.x > -300 and s.x < s.map_w + 300 then
      if s.hull and not s.hull.dead then
        s.hull.x = s.x
        s.hull.y = s.y
      end
      boom_plane(s)
      return
    end
  end

  -- Exit despawn check after motion
  local past_right = s.dir > 0 and s.x > s.map_w + pc.exit_margin
  local past_left = s.dir < 0 and s.x < -pc.exit_margin
  if past_right or past_left then
    s.done = true
    s.phase = "done"
    despawn_strike_actors(s)
    if spec.effects.on_done then spec.effects.on_done(s) end
    return
  end

  if pc.sound_loop ~= nil and pc.sound_loop_ticks > 0 and wa.sound and wa.sound.play then
    if s.tick > 0 and s.tick % pc.sound_loop_ticks == 0 then
      wa.sound.play(s.owner, pc.sound_loop)
    end
  end

  update_aim_and_bank(s, false)
  sync_parts_and_hull(s)
end

local function step_direct_payload(s)
  if s.done then return end
  local now = wa.world.frame()
  local elapsed = now - s.start_frame
  local spec = s.spec
  local rel = spec.release

  if elapsed >= s.plane_cfg.timeout_frames then
    s.done = true
    s.phase = "done"
    despawn_strike_actors(s)
    if spec.effects.on_done then spec.effects.on_done(s) end
    return
  end

  if elapsed < rel.windup then return end
  if s.cadence_cd > 0 then
    s.cadence_cd = s.cadence_cd - 1
    return
  end

  local batch = 1
  if rel.pattern == "burst" or rel.frames_between == 0 then
    batch = s.count - s.released
  elseif rel.pattern == "ripple" then
    batch = math.min(s.count - s.released, rel.per_tick)
  elseif rel.pattern == "pairs" then
    batch = math.min(s.count - s.released, 2)
  end

  for _ = 1, batch do
    local idx = s.released + 1
    local sx = s.drops[idx] ~= nil and s.drops[idx] or s.x
    local ok, res = spawn_one_payload(s, sx, s.y, idx)
    if ok then
      s.released = idx
      s.pool_retries = 0
    elseif res == "pool_full" then
      s.pool_retries = s.pool_retries + 1
      if s.pool_retries > rel.max_pool_retries then
        s.released = idx
        s.pool_retries = 0
      else
        break
      end
    else
      s.released = idx
    end
  end
  s.cadence_cd = rel.frames_between

  if s.released >= s.count then
    s.done = true
    s.phase = "done"
    despawn_strike_actors(s)
    if spec.effects.on_done then spec.effects.on_done(s) end
  end
end

--- Register an airstrike spec under `spec.weapon or ctx.id`.
function M.install(ctx, spec)
  ensure_hooks()
  local weapon_id = (spec and spec.weapon) or (ctx and ctx.id) or "__default"
  local norm = normalize_spec(weapon_id, spec)
  registry[weapon_id] = norm
  if sole_weapon_id == nil then
    sole_weapon_id = weapon_id
  elseif sole_weapon_id ~= weapon_id then
    sole_weapon_id = false
  end
  return {
    strike = function(ev) return M.strike(ev, weapon_id) end,
    is_main = M.is_main,
    is_bit = M.is_bit,
    active = function() return M.active(weapon_id) end,
    cancel = function() return M.cancel(weapon_id) end,
  }
end

--- Start a strike from an `on_click(ev)` callback.
function M.strike(ev, explicit_weapon_id)
  if not ev or not ev.worm then return nil end
  ensure_hooks()

  local weapon_id = explicit_weapon_id or ev.weapon
  local spec = weapon_id and registry[weapon_id] or nil
  if not spec and sole_weapon_id then
    spec = registry[sole_weapon_id]
  end
  if not spec then return nil end

  if active_strikes[spec.weapon] then
    M.cancel(spec.weapon)
  end

  local now = wa.world.frame()
  local map_w = wa.world.size().w
  local dir = pick_direction(spec, ev)
  local entry = spec.entry
  local pc = spec.plane
  local spd = spec.speed
  local rel = spec.release
  local pay = spec.payload

  local sky_y = opt(entry.y, opt(ev.sky, -208))
  local v_rel = spd.release ~= nil and spd.release or spd.cruise
  local vx_drop = pay.inherit_vx * (dir * v_rel) + pay.vx * dir

  local drift_x = 0
  if rel.lead and rel.mode == "drop" and pay.kind == "missile" then
    drift_x = solve_ballistic_drift(sky_y, ev.y, vx_drop, pay.vy, pay.gravity_pct, rel.lead_inertia_y)
    if rel.lead_max_back > 0 then
      if drift_x > rel.lead_max_back then drift_x = rel.lead_max_back end
      if drift_x < -rel.lead_max_back then drift_x = -rel.lead_max_back end
    end
  elseif rel.lead and rel.mode == "drop" and pay.kind == "actor" then
    drift_x = solve_ballistic_drift(sky_y, ev.y, vx_drop, pay.vy, 100, rel.lead_inertia_y)
  end

  local center_x = ev.x + entry.drop_offset_x - drift_x
  local stages = {}
  for _, st_rel in ipairs(spec._stages) do
    stages[#stages + 1] = {
      rel = st_rel,
      drops = build_drop_schedule_for(center_x, dir, st_rel),
    }
  end
  local drops = stages[1].drops
  local active_rel = stages[1].rel
  local total_count = spec._total_count

  local is_payload_only = (entry.mode == "payload") or not pc.enabled
  local start_x, start_y, start_phase
  if is_payload_only then
    start_x = ev.x + entry.drop_offset_x
    start_y = entry.spawn_at == "cursor" and ev.y or sky_y
    start_phase = "release"
    if entry.spawn_at == "cursor" and is_spawn_blocked(start_x, start_y) then
      if wa.sound and wa.sound.play then
        wa.sound.play(ev.worm, 120)
      end
      if ev.worm.ammo then
        local ok_ammo, cur = pcall(ev.worm.ammo, ev.worm, spec.weapon)
        if ok_ammo and type(cur) == "number" and cur >= 0 then
          pcall(ev.worm.ammo, ev.worm, spec.weapon, 1)
        end
      end
      return nil
    end
  elseif entry.mode == "above" then
    local lead_x = #drops > 0 and drops[1] or center_x
    start_x = lead_x - spd.slow_distance * dir
    start_y = sky_y
    start_phase = spd.slow_distance > 0 and "slow" or (active_rel.windup > 0 and "slow" or "release")
  else
    start_x = dir > 0 and -entry.side or (map_w + entry.side)
    start_y = sky_y
    start_phase = "approach"
  end

  local s = {
    spec = spec,
    plane_cfg = pc,
    owner = ev.worm,
    dir = dir,
    map_w = map_w,
    x = start_x,
    y = start_y,
    init_y = start_y,
    vx = spd.cruise,
    vy = 0,
    dive_rate = nil,
    tx = ev.x,
    ty = ev.y,
    stages = stages,
    stage_idx = 1,
    active_rel = active_rel,
    drops = drops,
    count = total_count,
    stage_released = 0,
    released = 0,
    phase = start_phase,
    start_frame = now,
    phase_start = now,
    cooldown = active_rel.windup,
    cadence_cd = 0,
    pool_retries = 0,
    tick = 0,
    hp = pc.hp,
    bank_angle = pc.bank_angle_approach,
    gun_angle = -math.pi,
    firing_flash = 0,
    fade_draw = false,
    fade_alpha = 255,
    done = false,
    parts = {},
    hull = nil,
  }

  active_strikes[spec.weapon] = s

  -- Instant click-only payload delivery when windup == 0 and frames_between == 0 (or count <= 1 with no windup)
  if is_payload_only and rel.windup == 0 and (rel.frames_between == 0 or rel.count <= 1 or rel.pattern == "burst" or rel.pattern == "offsets") then
    local total = rel.count
    local handled = 0
    for idx = 1, total do
      local sx = drops[idx] ~= nil and drops[idx] or start_x
      local ok, res = spawn_one_payload(s, sx, start_y, idx)
      if ok then
        s.released = s.released + 1
        handled = handled + 1
      elseif res == "blocked" then
        handled = handled + 1
      end
    end
    if handled >= total then
      s.done = true
      s.phase = "done"
      active_strikes[spec.weapon] = nil
      if spec.effects.on_done then spec.effects.on_done(s) end
      return s
    end
    -- Spawn controller actor only if pool overflow left undropped items to retry
  end

  if is_payload_only then
    s.hull = wa.actors.spawn({
      sprite = false,
      x = start_x,
      y = start_y,
      vx = 0,
      vy = 0,
      gravity = 0,
      owner = ev.worm,
      on = function() step_direct_payload(s) end,
    })
    return s
  end

  -- Spawn plane hull actor (with optional shootable collision & child art actors)
  local spawn_spec = {
    sprite = pc.sprite,
    x = start_x,
    y = start_y,
    vx = 0,
    vy = 0,
    gravity = 0,
    owner = ev.worm,
  }
  if pc.collide or pc.as_object then
    spawn_spec.body = {
      layer = pc.as_object and "object" or "missile",
      hit_by = "all",
    }
  end
  if pc.collide then
    spawn_spec.on = {
      frame = function() step_plane(s) end,
      hit = function(a, event)
        if s.done then return end
        local dmg = math.max(0, event.damage or 0)
        if event.kind == "blast" and dmg > 0 then
          local dx = a.x - (event.x or a.x)
          local dy = a.y - (event.y or a.y)
          dmg = trunc((1 - (dx * dx + dy * dy) / (dmg * dmg * 4)) * dmg)
        end
        if pc.hp > 0 then
          s.hp = s.hp - dmg
          if s.hp <= 0 then boom_plane(s) end
        elseif dmg > pc.dead_damage then
          boom_plane(s)
        end
      end,
    }
  else
    spawn_spec.on = function() step_plane(s) end
  end

  s.hull = wa.actors.spawn(spawn_spec)

  if pc.parts then
    for _, part_cfg in ipairs(pc.parts) do
      local pa = wa.actors.spawn({
        sprite = opt(part_cfg.sprite, false),
        x = start_x,
        y = start_y,
        vx = 0,
        vy = 0,
        gravity = 0,
        owner = ev.worm,
        on = function() end,
      })
      s.parts[#s.parts + 1] = { actor = pa, cfg = part_cfg }
    end
  end

  update_aim_and_bank(s, true)
  sync_parts_and_hull(s)

  if pc.sound_enter ~= nil and wa.sound and wa.sound.play then
    wa.sound.play(s.hull or ev.worm, pc.sound_enter)
  end

  if spec.effects.on_start then
    spec.effects.on_start(s)
  end

  return s
end

--- True when `missile_id` is a launched primary payload / strafe round of this module.
function M.is_main(missile_id)
  return launched_mains[missile_id] == true
end

--- Cluster-bit classifier callback for `sb.flight(ctx, { ..., is_bit = air.is_bit })`.
function M.is_bit(m)
  if not m then return false end
  return launched_mains[m.id] ~= true
end

--- Active strike state handle (for tests and HUD reads).
function M.active(weapon_id)
  local key = weapon_id or sole_weapon_id
  if not key then return nil end
  return active_strikes[key]
end

--- Cleanly terminate active strike and free any remaining trail/part state.
function M.cancel(weapon_id)
  local key = weapon_id or sole_weapon_id
  if key then
    local s = active_strikes[key]
    if s then
      s.done = true
      s.phase = "cancelled"
      despawn_strike_actors(s)
    end
  end
  if wa and wa.sorted then
    local sids = wa.sorted(shots)
    for _, id in ipairs(sids) do
      recycle_shot(id)
    end
  end
end

return M
