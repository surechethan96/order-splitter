import { registerDecorator, type ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';

// Allows at most `max` decimal places (the built-in check crashes on numbers like 1e-7, so we use decimal.js).
export function MaxDecimalPlaces(max: number, options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'maxDecimalPlaces',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must have at most ${max} decimal places`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'number' || !Number.isFinite(value)) return true; // IsNumber handles this
          return new Decimal(value).decimalPlaces() <= max;
        },
      },
    });
  };
}

// Checks that the portfolio weights add up to exactly 100, with no float drift.
export function WeightsSumTo100(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'weightsSumTo100',
      target: target.constructor,
      propertyName,
      options: {
        message: 'portfolio weights must add up to exactly 100',
        ...options,
      },
      validator: {
        validate(value: unknown) {
          // Other validators handle wrong shapes; here we only check real numbers.
          if (!Array.isArray(value)) return true;
          const weights = value.map(
            (h: { weight?: unknown } | null) => h?.weight,
          );
          const allNumbers = weights.every(
            (w) => typeof w === 'number' && Number.isFinite(w),
          );
          if (!allNumbers) return true;
          return Decimal.sum(...(weights as number[]), 0).equals(100);
        },
      },
    });
  };
}
