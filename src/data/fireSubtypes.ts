/**
 * `fires.subtype` (record +0x34): which of WA's stock fire animations and
 * sounds the worm plays when the weapon is used.
 *
 * The number is the stock weapon's own subtype (`crates/weapons/src/record.rs`,
 * `stock_subtype`), so 4 is the Minigun's burst (shell casings and its firing
 * loop) and 5 the Shotgun's pump/cock. It applies to every family: a missile
 * with subtype 5 fires with the shotgun's animation and sound, even though its
 * projectile is unchanged. It has nothing to do with the held-art animation.
 *
 * 0 is a real value ("no special firing behaviour"), not "inherit": use the
 * donor's own number when the weapon should keep it, which the generator does
 * by diffing against the donor.
 */
export const FIRE_SUBTYPES: { value: number; label: string }[] = [
  { value: 0, label: '0, plain (no special firing animation)' },
  { value: 1, label: '1, Uzi (rapid single shots)' },
  { value: 2, label: '2, Grenade throw' },
  { value: 3, label: '3, Bazooka launch' },
  { value: 4, label: '4, Minigun (shells + firing loop)' },
  { value: 5, label: '5, Shotgun (pump / cock)' },
  { value: 6, label: '6, Handgun' },
  { value: 7, label: '7, Homing Pigeon' },
  { value: 8, label: '8, Sheep Launcher' },
  { value: 9, label: '9, Flame Thrower' },
  { value: 10, label: '10, Longbow' },
  { value: 11, label: '11, Mortar' },
  { value: 12, label: '12, Homing Missile' },
  { value: 13, label: '13, Surrender' },
  { value: 14, label: '14, Skip Go' },
  { value: 15, label: '15, Select Worm' },
  { value: 16, label: '16, Nuclear Test' },
  { value: 17, label: '17, Girder / Girder Pack' },
  { value: 18, label: '18, Battle Axe' },
  { value: 19, label: '19, Turn utility' },
  { value: 20, label: '20, Freeze' },
  { value: 21, label: '21, Earthquake' },
  { value: 22, label: '22, Scales of Justice' },
  { value: 23, label: '23, Jet Pack' },
  { value: 24, label: '24, Armageddon' },
  { value: 70, label: '70, Napalm Strike' },
  { value: 200, label: '200, Mail Strike' },
  { value: 260, label: '260, MB Bomb' },
];

/**
 * `fires.subtype` (+0x34) values whose Sprite Builder hold stays out through
 * firing (`keep_while_firing = true`) and plays the put-away animation
 * (`put_away = true`). Includes guns, launchers, bow, flamethrower and axe.
 */
export const HOLD_FIRE_MODE_SUBTYPES = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18]);

/**
 * `fires.subtype` (+0x34) values whose Sprite Builder hold behaves as a thrown
 * grenade (`thrown = true`, `0` plain/custom anim and `2` grenade).
 */
export const HOLD_THROW_MODE_SUBTYPES = new Set([0, 2]);

export interface HoldFireMode {
  keepWhileFiring: boolean;
  putAway: boolean;
  thrown: boolean;
}

/**
 * Derive Sprite Builder hold flags (`keep_while_firing`, `put_away`, `thrown`)
 * from the record's `fires.subtype` (+0x34). Strikes, utilities and specials
 * leave all three false.
 */
export function holdFireModeForSubtype(subtype: number | undefined): HoldFireMode {
  if (subtype !== undefined && HOLD_FIRE_MODE_SUBTYPES.has(subtype)) {
    return { keepWhileFiring: true, putAway: true, thrown: false };
  }
  if (subtype !== undefined && HOLD_THROW_MODE_SUBTYPES.has(subtype)) {
    return { keepWhileFiring: false, putAway: false, thrown: true };
  }
  return { keepWhileFiring: false, putAway: false, thrown: false };
}

/**
 * PX's `'Weapon Sprite'` index (record +0x2C) mapped to the stock WA weapon
 * whose held pose matches it. Used as a donor hint and `hold_as` fallback when
 * a weapon has no SPB hold and a zeroed flight sprite.
 */
const WEP_WEAPON_SPRITE_DONOR: Record<number, string> = {
  2: 'grenade',
  3: 'banana_bomb',
  4: 'cluster_bomb',
  7: 'bazooka',
  11: 'homing_missile',
  12: 'sheep_launcher',
};

export function wepWeaponSpriteToStockDonor(weaponSprite: number | undefined): string | undefined {
  if (weaponSprite === undefined) return undefined;
  return WEP_WEAPON_SPRITE_DONOR[weaponSprite];
}

/** The label for a value, or `null` when it is not one of the stock subtypes. */
export function fireSubtypeLabel(value: number): string | null {
  return FIRE_SUBTYPES.find((entry) => entry.value === value)?.label ?? null;
}
