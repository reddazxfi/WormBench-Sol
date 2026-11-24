/**
 * Poison is not a WA hit kind. It is a dose on the worm (`worm:poison(n)`),
 * applied after the damage and paid out as nonlethal health at turn
 * boundaries (`spec/lua_sdk/verbs.md`). The editor stores it as a plain
 * number: `0` is off, `1..10` is the dose.
 */
export const POISON_DEFAULT = 2;
export const POISON_MAX = 10;

/** A stored value read back as 0 (off) or an integer 1..10. */
export function clampPoisonPower(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(POISON_MAX, n);
}

/** The Lua call, always emitted with a literal dose so a peer never reads state. */
export function poisonCall(target: string, power: unknown): string {
  return `${target}:poison(${clampPoisonPower(power)})`;
}
