import type { FC } from 'react';
import { POISON_DEFAULT, POISON_MAX, clampPoisonPower } from '../data/poison';
import { TooltipLabel, UnitNumberInput } from './RecordEditor';

interface Props {
  id: string;
  value: number | undefined;
  onChange: (value: number) => void;
  hint?: string;
}

/**
 * The one poison control: off, or a dose from 1 to 10 with a default of 2.
 *
 * Poison is a status (`worm:poison(n)`), not a hit kind, so it is a separate
 * switch on each damaging side rather than an entry in a kind dropdown.
 */
export const PoisonDoseField: FC<Props> = ({ id, value, onChange, hint }) => {
  const power = clampPoisonPower(value);
  const on = power > 0;
  return (
    <div className="space-y-1">
      <TooltipLabel
        label="Poison"
        code="poison"
        desc={
          hint ??
          'Adds `worm:poison(n)` to each worm this hit damages. It is a status dose, not a hit kind: WA pays it out as nonlethal health at turn boundaries. Off, or 1..10 (2 when first switched on).'
        }
        htmlFor={`${id}-toggle`}
      />
      <div className="flex items-center gap-2">
        <label
          htmlFor={`${id}-toggle`}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-stone-300"
        >
          <input
            id={`${id}-toggle`}
            type="checkbox"
            checked={on}
            onChange={(event) => onChange(event.currentTarget.checked ? POISON_DEFAULT : 0)}
            className="h-3.5 w-3.5 rounded border-stone-300 text-forge-600 focus:ring-forge-500 dark:border-stone-600 dark:bg-stone-900"
          />
          <span>{on ? 'On' : 'Off'}</span>
        </label>
        {on && (
          <div className="min-w-0 flex-1">
            <UnitNumberInput
              id={id}
              min={1}
              max={POISON_MAX}
              step={1}
              value={power}
              unit="dose"
              onChange={(event) => onChange(Math.max(1, clampPoisonPower(event.currentTarget.value)))}
            />
          </div>
        )}
      </div>
    </div>
  );
};
