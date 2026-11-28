export interface RecordFieldKind {
  type: 'int' | 'bool' | 'sprite' | 'enum' | 'mask' | 'scale';
  enumOptions?: Record<string, number>;
  maskFlags?: Record<string, number>;
  scaleFactor?: number;
  whole?: boolean;
}

export interface RecordFieldDef {
  path: string;
  label: string;
  group: string;
  description: string;
  kind: RecordFieldKind;
  families: string[];
  action?: number | null; // 0 none, 1 homing, 2 bounce, 3 roam, 4 dig
  burst?: number | null; // 1 clusters, 2 fire
  special_subtype?: number | null;
  legacy?: boolean;
}

export const COLLISION_FLAGS: Record<string, number> = {
  land: 2,
  worms: 60,
  worms_normal: 4,
  worms_acting: 8,
  worms_jumping: 16,
  worms_roping: 32,
  worms_frozen: 64,
  worms_frozen_moving: 128,
  canisters: 512,
  mines: 1024,
  crates: 2048,
  donor_cards: 4096,
  graves: 8192,
  missiles: 32768,
  arrows: 65536,
  objects: 131072,
  water: 4194304,
};

/**
 * WA's animation type (`missile.animation`, `clusters.bit.animation`,
 * `missile.homing.animation`, `clusters.bit.homing.animation`). The field does
 * not change how many frames the sheet has - the art does - it says where the
 * drawn frame's animation value comes from, and WA picks the frame from that.
 *
 * The numbers below come from PX's weapon editor: seven otherwise identical
 * grenade records that differ only at record +0x64
 * (`wep_Formatting/grenade_animtypes/`, fire type 1 / subtype 2 / method 3).
 * PX's editor lists them in this same order, and its `WeapSprite` uses the
 * 0.5 / 0.8 / 1.35 spin rates for slow / faster / fast.
 */
export const MISSILE_ANIM_TYPES: { value: number; label: string }[] = [
  { value: 0, label: 'Horizontal speed (tracks left/right velocity)' },
  { value: 1, label: 'Continuous spin (cycles sheet frames)' },
  { value: 2, label: 'Face flight direction (Bazooka style)' },
  { value: 3, label: 'Speed-tracked rotation' },
  { value: 4, label: 'Slow spin (0.5x)' },
  { value: 5, label: 'Medium spin (0.8x)' },
  { value: 6, label: 'Fast spin (1.35x)' },
];

export const MISSILE_ANIM_HINT =
  'Controls how WA selects frames from the sprite sheet during flight (spinning, facing flight direction, or tracking horizontal speed). Frame count comes from the sprite art itself.';
export const ARMAGEDDON_RECORD_GROUPS: { id: string; label: string }[] = [
  { id: 'armageddon.meteor', label: 'Armageddon Meteor' },
  { id: 'armageddon.meteor.explosion', label: 'Meteor Explosion' },
  { id: 'armageddon.meteor.bounce', label: 'Meteor Bounce' },
  { id: 'armageddon.meteor.homing', label: 'Meteor Homing' },
  { id: 'armageddon.meteor.trail', label: 'Meteor Trail' },
];
export const RECORD_GROUPS: { id: string; label: string; icon?: string }[] = [
  { id: 'fires', label: 'Firing & Launch' },
  { id: 'handling', label: 'Handling & Shots' },
  { id: 'missile', label: 'Missile Body' },
  { id: 'missile.explosion', label: 'Explosion & Blast' },
  { id: 'missile.bounce', label: 'Bounce Physics' },
  { id: 'missile.homing', label: 'Homing Lock-on' },
  { id: 'missile.roam', label: 'Animal Roam' },
  { id: 'missile.dig', label: 'Digging Action' },
  { id: 'missile.trail', label: 'Visual Trail' },
  { id: 'missile.fire', label: 'Incendiary Fire' },
  { id: 'clusters', label: 'Clusters Spec' },
  { id: 'clusters.bit', label: 'Cluster Bits' },
  { id: 'clusters.bit.explosion', label: 'Bit Explosion' },
  { id: 'clusters.bit.bounce', label: 'Bit Bounce' },
  { id: 'clusters.bit.homing', label: 'Bit Homing' },
  { id: 'clusters.bit.trail', label: 'Bit Trail' },
  { id: 'gun', label: 'Gun (Hitscan)' },
  { id: 'flame_thrower', label: 'Flame Thrower (Spray)' },
  { id: 'mine', label: 'Mine Proximity' },
  { id: 'strike', label: 'Air Strike Plane' },
  { id: 'special', label: 'Specials & Utilities' },
  ...ARMAGEDDON_RECORD_GROUPS,
];

/**
 * Armageddon is WA's special subtype 24. Its meteor body sits four bytes
 * earlier than a missile's (`record.rs` METEOR_SHIFT), and the engine reads it
 * from the `armageddon.meteor` group, never from `missile`.
 *
 * Every field below names the same engine field a missile body has, with the
 * `armageddon.meteor.` prefix. `trail.enabled` is the editor's own switch: the
 * engine has no such key and it is never written.
 */
export const ARMAGEDDON_SUBTYPE = 24;
export const ARMAGEDDON_METEOR_PREFIX = 'armageddon.meteor.';


const METEOR_ANIM_OPTIONS: Record<string, number> = Object.fromEntries(
  MISSILE_ANIM_TYPES.map((type) => [type.label, type.value]),
);

const meteorField = (
  path: string,
  label: string,
  group: string,
  description: string,
  kind: RecordFieldKind,
  action?: number,
): RecordFieldDef => ({
  path: `${ARMAGEDDON_METEOR_PREFIX}${path}`,
  label,
  group: group ? `armageddon.meteor.${group}` : 'armageddon.meteor',
  description,
  kind,
  families: ['special'],
  special_subtype: ARMAGEDDON_SUBTYPE,
  ...(action !== undefined ? { action } : {}),
});

export const ARMAGEDDON_METEOR_FIELDS: RecordFieldDef[] = [
  meteorField('collision_shape', 'Collision Outline Preset', '', 'Native numeric collision outline clearance preset.', { type: 'int' }),
  meteorField('alarm_worms', 'Alarm Worms Nearby', '', 'Nearby worms gasp shortly before the meteor detonates.', { type: 'bool' }),
  meteorField('ends_on_contact', 'Detonate On Contact With', '', 'Which entities end the meteor flight and detonate it.', { type: 'mask', maskFlags: COLLISION_FLAGS }),
  meteorField('impact_particles', 'Holy Impact Particles', '', 'Brief particle trail after impact (Holy Hand Grenade style).', { type: 'bool' }),
  meteorField('sprite', 'Meteor Sprite', '', 'Stock sprite the engine draws for the falling meteor.', { type: 'sprite' }),
  meteorField('animation', 'Meteor Animation Mode', '', 'How WA selects frames from the meteor sheet during flight.', { type: 'enum', enumOptions: METEOR_ANIM_OPTIONS }),
  meteorField('speed_pct', 'Initial Speed (%)', '', 'Multiplier for the meteor launch velocity (100 = normal).', { type: 'int' }),
  meteorField('gravity_pct', 'Gravity (%)', '', 'Downward acceleration multiplier (100 = normal WA gravity).', { type: 'int' }),
  meteorField('wind_pct', 'Wind Sensitivity (%)', '', 'Horizontal wind response (100 = full bazooka drift).', { type: 'int' }),
  meteorField('random_motion', 'Random Motion', '', 'Native random wobble added to the flight path.', { type: 'int' }),
  meteorField('fuse', 'Fuse Timer (ms)', '', 'Native explosion countdown in milliseconds.', { type: 'int' }),
  meteorField('countdown', 'Visible Countdown Timer', '', 'Countdown displayed above the meteor in milliseconds.', { type: 'int' }),
  meteorField('explode_on_space', 'Detonate on Space', '', 'Allows the player to press Space mid-flight to detonate.', { type: 'bool' }),
  meteorField('flight_sound', 'Flight Sound', '', 'Native sound id played while the meteor falls (0 = silent).', { type: 'int' }),

  meteorField('explosion.power', 'Explosion Power (Radius & Damage)', 'explosion', 'Combined blast damage and terrain cut radius (WA power value).', { type: 'int' }),
  meteorField('explosion.push_pct', 'Knockback Push (%)', 'explosion', 'Knockback percentage applied to worms and objects (100 = normal).', { type: 'int' }),
  meteorField('explosion.bias', 'Blast Bias', 'explosion', 'Vertical blast elevation bias.', { type: 'int' }),
  meteorField('explosion.variation', 'Explosion Variation', 'explosion', 'Random spread added to the blast power.', { type: 'int' }),
  meteorField('explosion_sound.enabled', 'Play Explosion Sound', 'explosion', 'Whether WA plays a native sound when the meteor explodes.', { type: 'bool' }),
  meteorField('explosion_sound.sound', 'Explosion Sound', 'explosion', 'Native sound id played at detonation.', { type: 'int' }),
  meteorField('explosion_sound.before', 'Explosion Sound Delay (ms)', 'explosion', 'Delay between the blast and its sound.', { type: 'int' }),

  meteorField('trail.enabled', 'Enable Visual Trail', 'trail', 'Editor switch: writes the trail block when on, leaves the donor trail alone when off.', { type: 'bool' }),
  meteorField('trail.sprite', 'Trail Sprite', 'trail', 'Stock trail sprite emitted behind the meteor (0 or blank disables it).', { type: 'sprite' }),
  meteorField('trail.power', 'Trail Density', 'trail', 'Particle density of the stock trail.', { type: 'int' }),
  meteorField('trail.speed', 'Trail Speed', 'trail', 'Particle ejection speed of the stock trail.', { type: 'int' }),
  meteorField('trail.bubbles_per_second', 'Water Bubbles / sec', 'trail', 'Underwater bubble rate (0.25 steps).', { type: 'scale', scaleFactor: 4 }),

  meteorField('action', 'Meteor Action', '', 'Flight behaviour: none, homing or bounce. The stock Armageddon bounces.', { type: 'enum', enumOptions: { 'None (0)': 0, 'Homing (1)': 1, 'Bounce (2)': 2, 'Roam (3)': 3, 'Dig (4)': 4 } }),

  meteorField('bounce.hits', 'Bounce Collision Targets', 'bounce', 'Entities that cause a bounce instead of detonation.', { type: 'mask', maskFlags: COLLISION_FLAGS }, 2),
  meteorField('bounce.bounciness', 'Bounciness Boost', 'bounce', 'Extra bounce relative to the Grenade (0 = Grenade).', { type: 'int' }, 2),
  meteorField('bounce.max_bounces', 'Max Bounces', 'bounce', 'Terrain contacts before detonation (0 keeps the fuse timer).', { type: 'int' }, 2),
  meteorField('bounce.terrain_keep_speed_pct', 'Speed Retained on Bounce (%)', 'bounce', 'Percentage of velocity preserved after hitting terrain.', { type: 'int' }, 2),
  meteorField('bounce.sound', 'Bounce Sound', 'bounce', 'Native sound id played on every bounce (0 = silent).', { type: 'int' }, 2),
  meteorField('bounce.contact_sides', 'Bounce Contact Sides', 'bounce', 'Bitmask of the sides that count as a terrain contact.', { type: 'int' }, 2),
  meteorField('bounce.extra_reverse_chance_pct', 'Extra Reverse Chance (%)', 'bounce', 'Chance that a bounce also reverses direction.', { type: 'int' }, 2),
  meteorField('bounce.explosion.bias', 'Bounce Blast Bias', 'bounce', 'Vertical bias of the small blast a bounce can spawn.', { type: 'int' }, 2),
  meteorField('bounce.explosion.push_pct', 'Bounce Knockback Push (%)', 'bounce', 'Knockback percentage of the bounce blast.', { type: 'int' }, 2),
  meteorField('bounce.explosion.power', 'Bounce Explosion Power', 'bounce', 'Power of the blast a bounce spawns (0 = no blast).', { type: 'int' }, 2),
  meteorField('bounce.explosion.variation', 'Bounce Explosion Variation', 'bounce', 'Random spread of the bounce blast power.', { type: 'int' }, 2),

  meteorField('homing.sprite', 'Homing Sprite', 'homing', 'Stock sprite drawn while the meteor homes in.', { type: 'sprite' }, 1),
  meteorField('homing.animation', 'Homing Animation Mode', 'homing', 'How WA selects frames while homing.', { type: 'enum', enumOptions: METEOR_ANIM_OPTIONS }, 1),
  meteorField('homing.trail.sprite', 'Homing Trail Sprite', 'homing', 'Stock trail sprite emitted while homing.', { type: 'sprite' }, 1),
  meteorField('homing.trail.power', 'Homing Trail Density', 'homing', 'Particle density while homing.', { type: 'int' }, 1),
  meteorField('homing.trail.speed', 'Homing Trail Speed', 'homing', 'Particle ejection speed while homing.', { type: 'int' }, 1),
  meteorField('homing.trail.bubbles_per_second', 'Homing Bubbles / sec', 'homing', 'Underwater bubble rate while homing (0.25 steps).', { type: 'scale', scaleFactor: 4 }, 1),
  meteorField('homing.kind', 'Homing Kind', 'homing', 'Homing steering behavior.', { type: 'enum', enumOptions: { 'Off (0)': 0, 'Lock-on (1)': 1, 'Dodge (2)': 2 } }, 1),
  meteorField('homing.arm', 'Arming Delay (ms)', 'homing', 'Free flight drift before homing propulsion activates.', { type: 'int' }, 1),
  meteorField('homing.time', 'Homing Duration (ms)', 'homing', 'How long active target steering continues.', { type: 'int' }, 1),
];

/** Whether a project runs the Armageddon meteor body (special subtype 24). */
export function isArmageddonWeapon(
  fireType: string | undefined,
  specialSubtype: number | undefined,
): boolean {
  return fireType === 'special' && specialSubtype === ARMAGEDDON_SUBTYPE;
}

/** Whether a donor slot or slot id names the stock Armageddon. */
export function isArmageddonDonor(slot: string | undefined): boolean {
  return (slot ?? '').replace(/^stock\./, '') === 'armageddon';
}

export const ARMAGEDDON_METEOR_PATHS: string[] = ARMAGEDDON_METEOR_FIELDS
  .filter((field) => field.path !== `${ARMAGEDDON_METEOR_PREFIX}trail.enabled`)
  .map((field) => field.path);

export const RECORD_FIELDS: RecordFieldDef[] = [
  ...ARMAGEDDON_METEOR_FIELDS,
  // Firing
  {
    path: 'fires.creates_projectile',
    label: 'Creates Projectile',
    group: 'fires',
    description: 'Whether using the weapon spawns a physical projectile entity.',
    kind: { type: 'bool' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine', 'strike', 'special'],
  },
  {
    path: 'fires.launch_power_pct',
    label: 'Launch Power (%)',
    group: 'fires',
    description: 'Launch velocity multiplier. 0 enables charging on launch (Bazooka style).',
    kind: { type: 'enum', enumOptions: { 'Charged (0)': 0, 'Fixed 50%': 50, 'Fixed 100%': 100, 'Fixed 150%': 150 } },
    families: ['missile'],
  },
  {
    path: 'fires.method',
    label: 'Fire Method',
    group: 'fires',
    description: 'Native firing method selector (inherit from base unless porting).',
    kind: { type: 'int' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine'],
  },
  {
    path: 'fires.subtype',
    label: 'Fire Subtype',
    group: 'fires',
    description: 'Subtype selector for special weapons and utilities.',
    kind: { type: 'int' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine', 'strike', 'special'],
  },

  // Handling
  {
    path: 'handling.shots',
    label: 'Shots in Sequence',
    group: 'handling',
    description: 'Number of uses in a firing sequence (like Shotgun 2 shots).',
    kind: { type: 'int' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine', 'strike', 'special'],
  },
  {
    path: 'handling.ends_turn',
    label: 'Ends Turn',
    group: 'handling',
    description: 'Whether firing this weapon ends weapon use for the current turn.',
    kind: { type: 'bool' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine', 'strike', 'special'],
  },
  {
    path: 'handling.retreat',
    label: 'Retreat Time (ms)',
    group: 'handling',
    description: 'Retreat timer allotted to the worm after firing (3000 ms).',
    kind: { type: 'int' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine', 'strike', 'special'],
  },
  {
    path: 'handling.remember_selection',
    label: 'Remember Selection',
    group: 'handling',
    description: 'Whether WA re-selects this weapon next turn.',
    kind: { type: 'bool' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine', 'strike', 'special'],
  },
  {
    path: 'handling.available_in_caves',
    label: 'Available in Caves',
    group: 'handling',
    description: 'Whether the weapon can be used in cavern (roofed) maps.',
    kind: { type: 'bool' },
    families: ['missile', 'gun', 'arrow', 'spray', 'mine', 'strike', 'special'],
  },

  // Missile Body
  {
    path: 'missile.speed_pct',
    label: 'Initial Speed (%)',
    group: 'missile',
    description: 'Multiplier for base projectile velocity (100 = 100%).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.gravity_pct',
    label: 'Gravity (%)',
    group: 'missile',
    description: 'Downward gravitational acceleration multiplier (100 = normal WA gravity).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.wind_pct',
    label: 'Wind Sensitivity (%)',
    group: 'missile',
    description: 'Horizontal wind response (0 = ignores wind, 100 = full bazooka drift).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.fuse',
    label: 'Fuse Timer (ms)',
    group: 'missile',
    description: 'Native explosion countdown in milliseconds (5000 for 5 s).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.countdown',
    label: 'Visible Countdown Timer',
    group: 'missile',
    description: 'Countdown displayed above projectile in milliseconds.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.explode_on_space',
    label: 'Detonate on Space',
    group: 'missile',
    description: 'Allows player to press Space mid-flight to detonate (Super Banana style).',
    kind: { type: 'bool' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.action',
    label: 'Missile Action',
    group: 'missile',
    description: 'Primary flight behavior archetype.',
    kind: { type: 'enum', enumOptions: { 'None (0)': 0, 'Homing (1)': 1, 'Bounce (2)': 2, 'Roam (3)': 3, 'Dig (4)': 4 } },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.burst',
    label: 'Burst Payload',
    group: 'missile',
    description: 'Payload triggered upon detonation.',
    kind: { type: 'enum', enumOptions: { 'Nothing (0)': 0, 'Clusters (1)': 1, 'Fire (2)': 2 } },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.impact_particles',
    label: 'Holy Impact Particles',
    group: 'missile',
    description: 'Brief particle trail after impact (Holy Hand Grenade style).',
    kind: { type: 'bool' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.alarm_worms',
    label: 'Alarm Worms Nearby',
    group: 'missile',
    description: 'Nearby worms gasp/cower shortly before detonation.',
    kind: { type: 'bool' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.collision_shape',
    label: 'Collision Outline Preset',
    group: 'missile',
    description: 'Native numeric collision outline clearance preset.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.ends_on_contact',
    label: 'Detonate On Contact With',
    group: 'missile',
    description: 'Which entities cause the missile to end flight and detonate.',
    kind: { type: 'mask', maskFlags: COLLISION_FLAGS },
    families: ['missile', 'strike'],
  },

  // Explosion
  {
    path: 'missile.explosion.power',
    label: 'Explosion Power (Radius & Damage)',
    group: 'missile.explosion',
    description: 'Combined blast damage and terrain cut radius (WA power value).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.explosion.push_pct',
    label: 'Knockback Push (%)',
    group: 'missile.explosion',
    description: 'Knockback percentage applied to worms and objects (100 = normal).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },
  {
    path: 'missile.explosion.bias',
    label: 'Blast Bias',
    group: 'missile.explosion',
    description: 'Vertical blast elevation bias.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
  },

  // Bounce
  {
    path: 'missile.bounce.bounciness',
    label: 'Bounciness Boost',
    group: 'missile.bounce',
    description: 'Extra bounce relative to Grenade (0 = Grenade, 60 = Banana Bomb, 80 = Super Banana).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    action: 2,
  },
  {
    path: 'missile.bounce.max_bounces',
    label: 'Max Bounces',
    group: 'missile.bounce',
    description: 'Max terrain contacts before fuse detonation (0 keeps normal timer).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    action: 2,
  },
  {
    path: 'missile.bounce.terrain_keep_speed_pct',
    label: 'Speed Retained on Bounce (%)',
    group: 'missile.bounce',
    description: 'Percentage of velocity preserved after hitting terrain.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    action: 2,
  },
  {
    path: 'missile.bounce.hits',
    label: 'Bounce Collision Targets',
    group: 'missile.bounce',
    description: 'Entities that cause physical bounce instead of detonation.',
    kind: { type: 'mask', maskFlags: COLLISION_FLAGS },
    families: ['missile', 'strike'],
    action: 2,
  },

  // Homing
  {
    path: 'missile.homing.kind',
    label: 'Homing Kind',
    group: 'missile.homing',
    description: 'Homing steering behavior.',
    kind: { type: 'enum', enumOptions: { 'Off (0)': 0, 'Lock-on (1)': 1, 'Dodge (2)': 2 } },
    families: ['missile', 'strike'],
    action: 1,
  },
  {
    path: 'missile.homing.arm',
    label: 'Arming Delay (ms)',
    group: 'missile.homing',
    description: 'Free flight drift before homing propulsion activates.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    action: 1,
  },
  {
    path: 'missile.homing.time',
    label: 'Homing Duration (ms)',
    group: 'missile.homing',
    description: 'How long active target steering continues before unguided fall.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    action: 1,
  },

  // Fire payload
  {
    path: 'missile.fire.burn_time_ms',
    label: 'Fire Burn Time (ms)',
    group: 'missile.fire',
    description: 'Nominal burn duration of settled flames (1500 ms).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 2,
  },
  {
    path: 'missile.fire.spread_delay_ms',
    label: 'Spread Delay (ms)',
    group: 'missile.fire',
    description: 'Delay between flame propagation steps (30 ms).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 2,
  },
  {
    path: 'missile.fire.spread_generations',
    label: 'Spread Generations',
    group: 'missile.fire',
    description: 'Number of successive spreading flame branches (10).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 2,
  },
  {
    path: 'missile.fire.decay_mode',
    label: 'Fire Decay Mode',
    group: 'missile.fire',
    description: 'Instant drains while burning; at_turn_start holds until the next turn start.',
    kind: { type: 'enum', enumOptions: { 'Instant (0)': 0, 'At Turn Start (1)': 1 } },
    families: ['missile', 'strike'],
    burst: 2,
  },

  // Clusters
  {
    path: 'clusters.count',
    label: 'Cluster Bits Count',
    group: 'clusters',
    description: 'Number of child projectiles emitted on burst (5).',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.launch_power_pct',
    label: 'Cluster Launch Power (%)',
    group: 'clusters',
    description: 'Cluster launch strength relative to 24 px/frame.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.power_variation_pct',
    label: 'Power Variation (%)',
    group: 'clusters',
    description: 'Random spread reduction in cluster ejection velocity.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.spread',
    label: 'Angular Spread (deg)',
    group: 'clusters',
    description: 'Fan width in degrees for emitted cluster bits.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },

  // Cluster Bit
  {
    path: 'clusters.bit.explosion.power',
    label: 'Bit Explosion Power',
    group: 'clusters.bit.explosion',
    description: 'Explosion damage and radius for each individual cluster bit.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.gravity_pct',
    label: 'Bit Gravity (%)',
    group: 'clusters.bit',
    description: 'Gravity multiplier for cluster bits.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.fuse',
    label: 'Bit Fuse (ms)',
    group: 'clusters.bit',
    description: 'Fuse timer in milliseconds for child bits.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.bounce.bounciness',
    label: 'Bit Bounciness',
    group: 'clusters.bit.bounce',
    description: 'Extra bounce elasticity for cluster bits.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.action',
    label: 'Bit Action',
    group: 'clusters.bit',
    description: 'Child projectile action: none (impact), bounce or homing.',
    kind: { type: 'enum', enumOptions: { None: 0, Homing: 1, Bounce: 2, Roam: 3, Dig: 4 } },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.wind_pct',
    label: 'Bit Wind (%)',
    group: 'clusters.bit',
    description: 'Wind response multiplier for cluster bits.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.bounce.max_bounces',
    label: 'Bit Max Bounces',
    group: 'clusters.bit.bounce',
    description: 'Bounce limit for child bits; 0 leaves the normal fuse behaviour.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.bounce.explosion.power',
    label: 'Bit Bounce Explosion Power',
    group: 'clusters.bit.bounce',
    description: 'Contact explosion power for a bouncing bit; 0 disables it.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.homing.kind',
    label: 'Bit Homing Kind',
    group: 'clusters.bit.homing',
    description: 'Homing guidance for child bits: off, lock or dodge.',
    kind: { type: 'enum', enumOptions: { Off: 0, Lock: 1, Dodge: 2 } },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.homing.arm',
    label: 'Bit Homing Arm (ms)',
    group: 'clusters.bit.homing',
    description: 'Arming delay before child homing begins.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.homing.time',
    label: 'Bit Homing Duration (ms)',
    group: 'clusters.bit.homing',
    description: 'Total powered homing duration for child bits.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.trail.sprite',
    label: 'Bit Trail Sprite',
    group: 'clusters.bit.trail',
    description: 'Stock sprite name or numeric id for the child trail; 0 disables it.',
    kind: { type: 'sprite' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.bit.sprite',
    label: 'Bit Flight Sprite',
    group: 'clusters.bit',
    description: 'Stock sprite name or numeric id for the child projectile.',
    kind: { type: 'sprite' },
    families: ['missile', 'strike'],
    burst: 1,
  },
  {
    path: 'clusters.power_variation_pct',
    label: 'Cluster Power Variation (%)',
    group: 'clusters',
    description: 'Random reduction in cluster launch strength, up to this percentage.',
    kind: { type: 'int' },
    families: ['missile', 'strike'],
    burst: 1,
  },

  // Gun
  {
    path: 'gun.bullets',
    label: 'Rounds in Firing Sequence',
    group: 'gun',
    description: 'Number of bullets fired per trigger pull.',
    kind: { type: 'int' },
    families: ['gun'],
  },
  {
    path: 'gun.damage',
    label: 'Damage per Bullet',
    group: 'gun',
    description: 'Damage dealt by each raycast impact.',
    kind: { type: 'int' },
    families: ['gun'],
  },
  {
    path: 'gun.shot_interval_ms',
    label: 'Shot Interval (ms)',
    group: 'gun',
    description: 'Time between consecutive rounds in a burst.',
    kind: { type: 'int' },
    families: ['gun'],
  },
  {
    path: 'gun.spread_deg',
    label: 'Aim Spread (deg)',
    group: 'gun',
    description: 'Angular spread cone centered on the worm aim line.',
    kind: { type: 'int' },
    families: ['gun'],
  },

  // Flame Thrower (spray family). WA gives it its own slab at +0x3C..+0x4C:
  // the flame count shares +0x3C with the guns, the rest is the fire each
  // flame builds (record.rs flame_thrower).
  {
    path: 'flame_thrower.flames',
    label: 'Flames per Use',
    group: 'flame_thrower',
    description: 'Flames released by one trigger pull. The power dial runs from 1 flame to 112.',
    kind: { type: 'int' },
    families: ['spray'],
  },
  {
    path: 'flame_thrower.spread_generations',
    label: 'Spreading Generations',
    group: 'flame_thrower',
    description:
      'Successive generations each flame sheds. 0 keeps only the first flames, as the stock Flame Thrower does.',
    kind: { type: 'int' },
    families: ['spray'],
  },
  {
    path: 'flame_thrower.spread_delay_ms',
    label: 'Spread Delay',
    group: 'flame_thrower',
    description:
      'Delay before a flame sheds the next generation. Native fire checks this in 20 ms steps.',
    kind: { type: 'int' },
    families: ['spray'],
  },
  {
    path: 'flame_thrower.burn_time_ms',
    label: 'Burn Time',
    group: 'flame_thrower',
    description: 'How long each flame stays alight.',
    kind: { type: 'int' },
    families: ['spray'],
  },
  {
    path: 'flame_thrower.decay_mode',
    label: 'Fire Decay Mode',
    group: 'flame_thrower',
    description: 'Instant drains while burning; at_turn_start holds until the next turn start.',
    kind: { type: 'enum', enumOptions: { 'Instant (0)': 0, 'At Turn Start (1)': 1 } },
    families: ['spray'],
  },

  // Mine
  {
    path: 'mine.proximity',
    label: 'Proximity Detection Radius (px)',
    group: 'mine',
    description: 'Distance within which target triggers the mine.',
    kind: { type: 'int' },
    families: ['mine'],
  },
  {
    path: 'mine.arm',
    label: 'Arming Delay (ms)',
    group: 'mine',
    description: 'Immunity delay after placement before mine arms.',
    kind: { type: 'int' },
    families: ['mine'],
  },
  {
    path: 'mine.fuse',
    label: 'Triggered Fuse (ms)',
    group: 'mine',
    description: 'Beep timer between proximity trip and detonation.',
    kind: { type: 'int' },
    families: ['mine'],
  },
  {
    path: 'mine.explosion.power',
    label: 'Mine Explosion Power',
    group: 'mine',
    description: 'Damage and crater radius of the mine blast.',
    kind: { type: 'int' },
    families: ['mine'],
  },

  // Strike
  {
    path: 'strike.count',
    label: 'Munitions Dropped',
    group: 'strike',
    description: 'Number of bombs or mines dropped along the flight path.',
    kind: { type: 'int' },
    families: ['strike'],
  },
  {
    path: 'strike.spacing',
    label: 'Drop Spacing (px)',
    group: 'strike',
    description: 'Distance between consecutive drops along the plane vector.',
    kind: { type: 'int' },
    families: ['strike'],
  },
  {
    path: 'strike.munition',
    label: 'Munition Type',
    group: 'strike',
    description: 'Payload dropped by the aircraft.',
    kind: { type: 'enum', enumOptions: { 'Mines (0)': 0, 'Missiles (2)': 2 } },
    families: ['strike'],
  },
  {
    path: 'strike.munition_speed',
    label: 'Munition Forward Speed',
    group: 'strike',
    description: 'Initial horizontal velocity inherited from plane in px/frame.',
    kind: { type: 'scale', scaleFactor: 100 },
    families: ['strike'],
  },
];

export const RECORD_FIELDS_BY_PATH = new Map(RECORD_FIELDS.map((f) => [f.path, f]));
