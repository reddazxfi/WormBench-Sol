-- wfws_swing.lua -- Space-swing clip & melee strike simulation for WFWS.
--
-- Separated from `wfws_sprite_builder.lua` for modularity. Loaded automatically
-- by `wfws_sprite_builder` (`require("wf-lib/wfws_swing")`) and re-exported so
-- older mods calling `sb.hold(...)` and `sb.clip_pose(...)` keep working.
--
-- Pure data at load: `wa` is touched only inside callbacks and runtime helpers.

local M = {}

-- The swing is one at a time: WA is turn based, so exactly one worm can hold a
-- weapon up and press Space. `swing_of[entry] = { worm, start, aim, facing,
-- taken, hit }`, and no per-worm table for it.
local swing_of = {}
local swing_hooked = false
local swing_tick = -1
local swing_space = false

function M.state(entry)
  return swing_of[entry]
end

-- ---------------------------------------------------------------------------
-- The Space swing (`swing` in the spec, `project.aimClip` in the editor).
--
-- A clip is data, not Lua: keyframes over 50 Hz ticks, each holding an angle
-- added to the drawn one, a dx/dy in sheet pixels, a size multiplier, an
-- optional strip frame and alpha, and the easing that reaches it. `M.clip_pose`
-- is a pure function of the ticks since the press, which is what keeps the two
-- halves honest: the simulation decides *when* (the key edge, the finish) and
-- the draw decides *how it looks*, from the same arithmetic the editor's
-- preview runs. Nothing here reads the render clock, and nothing writes state
-- from inside `wa.on.draw`.
-- ---------------------------------------------------------------------------
local CLIP_EASE = {
  linear = function(t) return t end,
  in_quad = function(t) return t * t end,
  out_quad = function(t) return 1 - (1 - t) * (1 - t) end,
  inout_quad = function(t)
    if t < 0.5 then return 2 * t * t end
    return 1 - 2 * (1 - t) * (1 - t)
  end,
  in_cubic = function(t) return t * t * t end,
  out_cubic = function(t) return 1 - (1 - t) ^ 3 end,
  inout_cubic = function(t)
    if t < 0.5 then return 4 * t * t * t end
    return 1 - 4 * (1 - t) ^ 3
  end,
  out_back = function(t)
    local c = 1.70158
    local u = t - 1
    return 1 + (c + 1) * u * u * u + c * u * u
  end,
  out_elastic = function(t)
    if t == 0 or t == 1 then return t end
    local u = t - 1
    return 2 ^ (-10 * t) * wa.math.sin((u * 10 - 0.75) * (2 * math.pi / 3)) + 1
  end,
  hold = function(t)
    if t >= 1 then return 1 end
    return 0
  end,
}

local function clip_lerp(a, b, f)
  return a + (b - a) * f
end

-- The pose at `t` ticks. Keys are read in file order but sorted by `t` once, at
-- install, so this stays allocation-free enough for a draw callback: it returns
-- one small table per call and the caller drops it.
function M.clip_pose(clip, t)
  local keys = clip and clip.keys
  if not keys or #keys == 0 then return nil end
  local first, last = keys[1], keys[#keys]
  if t <= first.t then
    return { angle = first.angle or 0, dx = first.dx or 0, dy = first.dy or 0,
      scale = first.scale or 1, frame = first.frame, alpha = first.alpha or 1 }
  end
  if t >= last.t then
    return { angle = last.angle or 0, dx = last.dx or 0, dy = last.dy or 0,
      scale = last.scale or 1, frame = last.frame, alpha = last.alpha or 1 }
  end
  local i = 1
  while i < #keys and keys[i + 1].t <= t do i = i + 1 end
  local a, b = keys[i], keys[i + 1]
  local span = b.t - a.t
  local raw = span > 0 and (t - a.t) / span or 1
  local ease = CLIP_EASE[b.ease or "inout_quad"] or CLIP_EASE.inout_quad
  local f = ease(raw)
  local a_scale, b_scale = a.scale or 1, b.scale or 1
  local a_alpha, b_alpha = a.alpha or 1, b.alpha or 1
  return {
    angle = clip_lerp(a.angle or 0, b.angle or 0, f),
    dx = clip_lerp(a.dx or 0, b.dx or 0, f),
    dy = clip_lerp(a.dy or 0, b.dy or 0, f),
    scale = clip_lerp(a_scale, b_scale, f),
    -- A frame is an index, not a number to blend: it steps at the segment end.
    frame = (raw >= 1) and b.frame or a.frame,
    -- `fade = false` on the key makes opacity step the same way: hold the
    -- previous value for the segment, then land on this key's. A snap-back (the
    -- art returning to the worm after a cut) must not fade on the way.
    alpha = b.fade == false and a_alpha or clip_lerp(a_alpha, b_alpha, f),
  }
end

-- Sorted copy of a clip's keys, so `clip_pose` never has to sort in a callback.
function M.prepare_clip(clip)
  if type(clip) ~= "table" or type(clip.keys) ~= "table" or #clip.keys == 0 then
    return nil
  end
  local keys = {}
  for i = 1, #clip.keys do
    local k = clip.keys[i]
    if type(k) == "table" and type(k.t) == "number" then keys[#keys + 1] = k end
  end
  table.sort(keys, function(a, b) return a.t < b.t end)
  if #keys == 0 then return nil end
  local echo = type(clip.echo) == "table" and clip.echo or nil
  return {
    keys = keys,
    ticks = math.max(1, math.floor(clip.ticks or keys[#keys].t or 1)),
    finish = clip.finish,
    -- The trail behind a swing: the same clip evaluated at earlier ticks, each
    -- ghost fainter than the last. Nothing is recorded, because the pose is a
    -- pure function of the tick, so a ghost costs one `clip_pose` and one quad.
    echo = echo and {
      count = math.max(1, math.min(8, math.floor(echo.count or 3))),
      every = math.max(1, math.floor(echo.every or 2)),
      fade = math.max(0.05, math.min(0.95, echo.fade or 0.55)),
      blend = echo.blend == "add" and "add" or "alpha",
    } or nil,
  }
end

-- ---------------------------------------------------------------------------
-- Melee strike parsing, box scan and hit resolution.
-- ---------------------------------------------------------------------------

-- The strikes a melee swing lands: `hits = { { frame, damage, power, lift }, ... }`
-- for a combo, or the single `hit_frame` / `damage` / `power` / `lift` a weapon
-- wrote before combos existed. Sorted by frame, because the swing lands them in
-- tick order however the author typed them, and a strike with no numbers of its
-- own inherits the weapon's.

-- One strike sound: a pack WAV if the weapon uploaded one, else the WA id.
-- The file wins, so a strip that keeps both keys played while it had a WAV does
-- not start playing its old id when the WAV is removed (`priority` is the third
-- argument `wa.sound.play` takes for either kind).
local function melee_sound(spec, role)
  local wav = spec[role .. "_wav"]
  if type(wav) == "string" and wav ~= "" then
    return {
      sound = wav,
      priority = math.floor(tonumber(spec[role .. "_priority"]) or 8),
    }
  end
  local id = math.floor(tonumber(spec[role .. "_sound"]) or 0)
  if id == 0 then return nil end
  return { sound = id, priority = math.floor(tonumber(spec[role .. "_priority"]) or 8) }
end

-- A strike's own sample (`wav` / `sound` / `priority` on its row), for a combo
-- whose jabs and haymakers are heard differently. `nil` falls back to the
-- weapon's own `hit_wav` / `hit_sound` in `M.melee_strike`.
local function melee_hit_audio(h)
  local wav = h.wav
  if type(wav) == "string" and wav ~= "" then
    return { sound = wav, priority = math.floor(tonumber(h.priority) or 8) }
  end
  local id = math.floor(tonumber(h.sound) or 0)
  if id == 0 then return nil end
  return { sound = id, priority = math.floor(tonumber(h.priority) or 8) }
end

local function melee_hits(spec, push_aim)
  local out = {}
  local listed = type(spec.hits) == "table" and spec.hits or nil
  if listed then
    for i = 1, #listed do
      local h = listed[i]
      if type(h) == "table" then
        out[#out + 1] = {
          frame = math.max(0, math.floor(tonumber(h.frame) or 0)),
          damage = math.max(0, tonumber(h.damage) or 0),
          power = h.power ~= nil and tonumber(h.power) or (push_aim and (tonumber(spec.power) or 0) or 0),
          lift = h.lift ~= nil and tonumber(h.lift) or (tonumber(spec.lift) or 0),
          vx = h.vx ~= nil and tonumber(h.vx) or nil,
          vy = h.vy ~= nil and tonumber(h.vy) or nil,
          audio = melee_hit_audio(h),
        }
      end
    end
  end
  if #out == 0 then
    out[1] = {
      frame = math.max(0, math.floor(tonumber(spec.hit_frame) or 0)),
      damage = math.max(0, tonumber(spec.damage) or 0),
      power = tonumber(spec.power) or 0,
      lift = tonumber(spec.lift) or 0,
    }
  end
  table.sort(out, function(a, b) return a.frame < b.frame end)
  return out
end

-- Normalise `spec.melee` against the prepared clip. Logs a diagnostic if a
-- melee table was provided without a swing clip.
function M.prepare_melee(raw_melee, clip)
  local melee_spec = type(raw_melee) == "table" and raw_melee or nil
  -- A `melee` table without a clip can't land anything: the strike's frames are
  -- ticks of the swing, and `M.ensure` (which owns the Space edge) only runs
  -- when there is one. The editor writes the single key such a strike needs; a
  -- hand-written bundle gets told instead of shipping a dead weapon silently.
  if melee_spec and not clip then
    wa.log("wfws_sprite_builder.hold: melee = { ... } needs swing = { ticks, keys "
      .. "}: without a clip the strike never lands and Space does nothing")
    return nil
  end
  if not melee_spec or not clip then return nil end
  local push = melee_spec.push
  local melee = {
    radius = math.max(1, melee_spec.radius or 32),
    width = math.max(0, melee_spec.width or 16),
    follow_swing = melee_spec.follow_swing ~= false,
    -- `push = "aim"` throws along the weapon; a `{ x, y }` table is the
    -- literal throw, per strike when the strike names one and the weapon's
    -- otherwise. `lift` is added to either (positive is up).
    push_aim = push == nil or push == "aim",
    fvx = type(push) == "table" and (push.x or 0) or 0,
    fvy = type(push) == "table" and (push.y or 0) or 0,
    -- The strike's sounds: where it lands, and where it doesn't. Either
    -- half is one of the stock ids (`hit_sound`) or a pack WAV played by path
    -- (`hit_wav`), and the file wins, like the firing art's fire_draw. 0 and
    -- no path is silent; the editor's default whiff is 96, WA's grenade throw
    -- and bat miss. A strike row can name its own sample instead, which the
    -- weapon's becomes the fallback for.
    hit_audio = melee_sound(melee_spec, "hit"),
    miss_audio = melee_sound(melee_spec, "miss"),
    once = melee_spec.once ~= false,
    spare_shooter = melee_spec.spare_shooter ~= false,
    log = melee_spec.log and true or false,
    hit = melee_spec.hit,
    on_taze_mine = type(melee_spec.on_taze_mine) == "function" and melee_spec.on_taze_mine or nil,
    hits = melee_hits(melee_spec, push == nil or push == "aim"),
  }
  melee.hit_frame = melee.hits[1].frame
  -- One string for the press log: "8", or "8, 16, 22" for a combo.
  local frames = {}
  for i = 1, #melee.hits do frames[i] = tostring(melee.hits[i].frame) end
  melee.frames_text = table.concat(frames, ", ")
  return melee
end

-- The melee strike (`melee` in the spec). The box is the worm's own aim and
-- direction, nothing about the art: `M.melee_scan` below reads `worm.aim`
-- and `worm.facing` and turns the swing's angle into it, so turning the sheet
-- or moving its pivot can't move the strike. (Two earlier versions read the
-- art instead, once through its offset and once through its drawn angle, and
-- both pointed the box at the striker's back.)
local MELEE_SLACK = 3

function M.melee_scan(entry, w, pose, aim_ov, facing_ov)
  local pi = math.pi
  local facing = (facing_ov or w.facing) < 0 and -1 or 1
  local a = aim_ov or w.aim or 0.5
  -- The worm's own aim, and nothing else. `worm.aim` is WA's sweep (0 straight
  -- down, 0.5 level, 1 straight up) and `facing` is the side, so the direction is
  -- `(facing * sin(a*PI), cos(a*PI))`, world y down. The art's `weap_rotation`
  -- and `weap_radius` are drawing controls: turning a sheet or moving its pivot
  -- doesn't change where the worm points, and using either here is what put the
  -- box behind the striker.
  local phi = a * pi
  local swing = 0
  if entry.melee.follow_swing and pose and pose.angle then
    swing = pose.angle * pi / 180.0
  end
  local s = swing * facing
  local x = facing * wa.math.sin(phi)
  local y = wa.math.cos(phi)
  local cr, sr = wa.math.cos(s), wa.math.sin(s)
  return x * cr - y * sr, x * sr + y * cr
end

-- One strike: hit `index` of the swing, on the tick it lands. Worms only:
-- `wa.worms.all()` is a deterministic list, so every peer hits the same worms in
-- the same order, and the weapon's own `hit` callback decides what a hit does
-- (damage, kind, sound). `hit` is handed over as the callback's fourth argument,
-- so a combo can give each strike its own damage and throw.
function M.melee_strike(entry, w, st, index)
  local m = entry.melee
  local hit = m.hits[index]
  local pose = nil
  if entry.clip then pose = M.clip_pose(entry.clip, hit.frame) end
  -- The aim the swing was thrown with, not the one WA has drifted to since: a
  -- swing is one committed motion, and a taken worm can still turn its aim.
  local vx, vy = M.melee_scan(entry, w, pose, st.aim, st.facing)
  -- The throw. `push = "aim"` throws along the same unit vector the box was
  -- tested with, so a hit goes the way the strike went; a `{ x, y }` table is the
  -- author's literal throw (per hit when it has one, else the weapon's). `lift`
  -- is subtracted from y (world y is down, so a positive lift throws up).
  -- Explicit `if`s, not `and/or`: a zero component is a value (an aim straight
  -- up has `vx = 0`, a level one has `vy = 0`).
  local push_x, push_y
  if m.push_aim then
    push_x, push_y = vx * hit.power, vy * hit.power
  else
    push_x, push_y = (hit.vx or m.fvx), (hit.vy or m.fvy)
  end
  push_y = push_y - hit.lift
  -- One table per strike: a worm can take hit 1 and hit 2, but not hit 2 twice.
  st.hit = st.hit or {}
  local done = st.hit[index] or {}
  st.hit[index] = done
  local worms = wa.worms.all()
  local hits = 0
  local first_hit = nil
  for i = 1, #worms do
    local o = worms[i]
    local skip = nil
    if (o.hp or 0) <= 0 then skip = "dead"
    elseif m.spare_shooter and o.id == w.id then skip = "self"
    elseif m.once and done[o.id] then skip = "already hit" end
    local dx, dy = o.x - w.x, o.y - w.y
    local along = dx * vx + dy * vy
    local across = -dx * vy + dy * vx
    local inside = along >= -MELEE_SLACK and along <= m.radius and math.abs(across) <= m.width
    -- Under `log` every worm is reported with its own distance, so an empty box
    -- says whether it was behind the striker (bad `facing`), out of reach, or out
    -- of the arc, instead of only that nothing was hit.
    if m.log then
      wa.log(string.format("[melee] worm %d%s: d %.1f,%.1f along %.1f across %.1f %s%s",
        o.id, o.id == w.id and " (self)" or "", dx, dy, along, across,
        inside and "inside" or "outside", skip and (" [" .. skip .. "]") or ""))
    end
    if inside and not skip then
      done[o.id] = true
      hits = hits + 1
      first_hit = first_hit or o
      -- A broken callback must not take the whole 50 Hz message down with it.
      -- The strike itself is the fourth argument, so a combo's callback reads
      -- `hit.damage` instead of one number baked into the closure.
      if m.hit then pcall(m.hit, o, push_x, push_y, hit) end
    end
  end
  if type(m.on_taze_mine) == "function" and wa.mines and wa.mines.all then
    st.tazed_mines = st.tazed_mines or {}
    local mines = wa.mines.all()
    if mines then
      for i = 1, #mines do
        local mine = mines[i]
        if mine and mine.id ~= nil and not (m.once and st.tazed_mines[mine.id]) then
          local dx, dy = mine.x - w.x, mine.y - w.y
          local along = dx * vx + dy * vy
          local across = -dx * vy + dy * vx
          if along >= -MELEE_SLACK and along <= m.radius and math.abs(across) <= m.width then
            st.tazed_mines[mine.id] = true
            pcall(m.on_taze_mine, mine, w)
          end
        end
      end
    end
  end
  st.hits = (st.hits or 0) + hits
  -- The strike's own sound. `wa.sound.play` takes a native id or a pack WAV path
  -- and localises the voice at the emitter: the first worm the box took when it
  -- landed, the striker when it took nobody. A whiff would otherwise be silent,
  -- because the claim eats WA's fire and the record's own sound never plays.
  -- `wa.sound` arrived with 0.9.x, so an older engine keeps the strike and loses
  -- only the sound.
  if wa.sound and wa.sound.play then
    -- The strike's own sample wins over the weapon's, which is what lets a
    -- combo open with a light hit and close with a heavy one.
    local audio = hits > 0 and (hit.audio or m.hit_audio) or m.miss_audio
    if audio then
      local emitter = hits > 0 and first_hit or w
      if emitter then pcall(wa.sound.play, emitter, audio.sound, audio.priority) end
    end
  end
  if m.log then
    wa.log(string.format("[melee] hit %d/%d at frame %d: %d worm(s) of %d, scan %.2f,%.2f, reach %d wide %d, aim %.2f facing %s, damage %d, push %.1f,%.1f",
      index, #m.hits, hit.frame, hits, #worms, vx, vy, m.radius, m.width,
      st.aim or -1, tostring(st.facing), hit.damage, push_x, push_y))
  end
end

-- Every strike whose frame has been reached and has not landed yet. `>=` with a
-- per-strike latch, not `==`: a frame whose message never arrives can't cost a
-- strike its hit, and it still lands only once. Returns whether anything landed.
function M.melee_step(entry, w, st, tick)
  local m = entry.melee
  local landed = false
  st.struck = st.struck or {}
  for i = 1, #m.hits do
    if not st.struck[i] and tick >= m.hits[i].frame then
      st.struck[i] = true
      M.melee_strike(entry, w, st, i)
      landed = true
    end
  end
  return landed
end

-- The simulation half of the swing: one handler for every layer, run per worm
-- message, gated to the first call of each 50 Hz frame so the entries and the
-- worm list are walked once. `wa.world.keys().space` is the turn player's
-- synchronised keyboard, so the edge lands on the same frame on every peer;
-- `wa.on.draw` must never decide a swing, because its rate is the renderer's.
function M.ensure(hold_entries, clamp_aim)
  if swing_hooked then return end
  if not (wa.on and wa.on.worm_message and wa.world and wa.world.frame) then return end
  -- `wa.msg` is built with `wa` in this engine, but the filter is a table read at
  -- install: on a build without it (or one that gates it) the index would throw
  -- inside the weapon's `install` and take the whole bundle down, not just the
  -- swing. The handler works unfiltered, so this only costs the filter.
  if not (wa.msg and wa.msg.FRAME_FINISH) then return end
  swing_hooked = true
  wa.on.worm_message(function()
    local now = wa.world.frame() or 0
    if now == swing_tick then return end
    swing_tick = now
    -- WA is turn based: one worm has the turn, and the keys are its player's.
    -- There is no second swing to reconcile with.
    local w = nil
    local worms = wa.worms.all()
    for i = 1, #worms do
      if worms[i].turn and worms[i].hp and worms[i].hp > 0 then
        w = worms[i]
        break
      end
    end
    local keys = wa.world.keys and wa.world.keys() or nil
    local space = keys and keys.space and true or false
    -- The edge itself, independent of which entry (if any) can use it.
    local pressed = space and not swing_space
    swing_space = space
    local started = false
    -- Did the turn's worm hold one of this bundle's weapons at the press? Only
    -- then is a press that started nothing worth reporting: every other Space
    -- press in the match belongs to somebody else's weapon (a jump, a backflip,
    -- a stock gun) and logging those would fill the game log of anyone who
    -- installs one WFWS weapon.
    local ours = false
    for i = 1, #hold_entries do
      local entry = hold_entries[i]
      if w and w.weapon == entry.weapon then ours = true end
      if entry.clip then
        local st = swing_of[entry]
        if not st then
          st = {}
          swing_of[entry] = st
        end
        local holds = w and w.weapon == entry.weapon
        local sw = st.worm
        -- Once the swing owns its worm, only that worm dying ends it early: WA
        -- has no say in the clip, and a selection that drifts mid-clip must not
        -- cut the animation short.
        local live = sw and (sw.hp or 0) > 0
        if st.start and not live then
          if st.taken and sw then pcall(sw.release, sw, 0, 0) end
          st.taken, st.worm, st.worm_id, st.start = nil, nil, nil, nil
        end
        if st.start then
          -- The clip is its own clock: WA's worm states can't end it, so a
          -- swing of any length plays in full.
          local tick = now - st.start
          if entry.melee then M.melee_step(entry, sw, st, tick) end
          if tick >= entry.clip.ticks then
            st.start = nil
            if st.taken then
              st.taken = nil
              -- WA flies and lands a released worm, as it does after any shot.
              pcall(sw.release, sw, 0, 0)
            end
            st.worm, st.worm_id = nil, nil
            if entry.melee and entry.melee.log then
              wa.log(("[melee] swing done: %d ticks, %d hit(s)")
                :format(entry.clip.ticks, st.hits or 0))
            end
            -- A melee swing fires a ghost shot and WA owns the turn; zeroing
            -- the clock here would skip the retreat window and end the turn
            -- the frame the clip ran out. `finish` belongs to a clip-only
            -- weapon that ate the fire and has nothing else to end it.
            if not entry.melee and entry.clip.finish == "end_turn"
              and wa.world.set_turn_clock then
              --wa.world.set_turn_clock(0)
            end
          end
        elseif holds and space and not st.space then
          -- One press, one swing: the edge is the turn player's synchronised
          -- keyboard, so every peer starts on the same frame. No aiming state
          -- test: a clip-only claim eats WA's fire, and a melee claim fires the
          -- ghost shot WA ends the turn for, so the swing starts from the key
          -- edge and never from what WA says about the worm.
          -- `fire = true` is the half that lets the melee's ghost shot happen:
          -- a taken worm's fire messages are the engine's to eat, so a hold that
          -- took the worm silently swallowed the press and WA never fired, never
          -- took the ammo and never ran its own retreat, which is the turn flow a
          -- melee weapon wants (WA ends the turn when the shot is gone). A
          -- clip-only claim still eats the shot at dispatch (`eat_fire`), so this
          -- changes nothing for one that did not ask for a shot.
          local took = w.take and w:take{ turn = "freeze", fire = true } or false
          st.worm = w
          st.worm_id = w.id
          st.start = now
          st.aim = clamp_aim and clamp_aim(entry, w.aim) or (w.aim or 0.5)
          st.facing = w.facing
          st.taken = took or nil
          st.hit = {}
          st.hits = 0
          st.struck = nil
          st.tazed_mines = nil
          started = true
          if entry.melee and entry.melee.log then
            -- `aim` is the sweep WA draws, `aim_target` is FireAngle in degrees
            -- (0 level, +90 up, -90 down, relative to facing): the number the
            -- shot itself uses, printed here so a press can be checked without
            -- guessing at the art.
            wa.log(("[melee] swing at tick %d: %s the worm at %.0f,%.0f (weapon %s), " ..
              "aim %.3f (FireAngle %.1f deg) facing %d, hit frame(s) %s")
              :format(now, took and "took" or "could not take", w.x or 0, w.y or 0,
                tostring(w.weapon), w.aim or -1, w.aim_target or 0, w.facing or 1,
                entry.melee.frames_text))
            if st.aim ~= (w.aim or 0.5) then
              wa.log(("[melee] aim clamped %.3f -> %.3f by the layer's aim_clamp")
                :format(w.aim or 0.5, st.aim))
            end
          end
          -- A strike whose frame is 0 lands on the press itself.
          if entry.melee then M.melee_step(entry, w, st, 0) end
        end
        st.space = space
      end
    end
    -- A Space press on our own weapon that swung nothing is the one case a
    -- swing can't log for itself, and it is the case that looks like "Space
    -- does nothing" (a layer with no `swing`/`clip`, or an older installed copy
    -- of this library that has no clip support).
    if pressed and not started and ours then
      wa.log(("[wfws] Space pressed at tick %d while holding %s, but no swing started: " ..
        "that weapon's layer has no `swing`/`clip` (or an older wfws.sdk is installed)")
        :format(now, tostring(w.weapon)))
    end
  end, { msgs = { wa.msg.FRAME_FINISH } })
end

return M
