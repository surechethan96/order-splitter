import Decimal from 'decimal.js';

// Our own Decimal with extra precision, so money and share maths never use floats.
const D = Decimal.clone({ precision: 40 });

export type PriceSource = 'PARTNER' | 'DEFAULT';

export interface SplitHolding {
  symbol: string;
  // Share of the portfolio in percent, e.g. 60 means 60%.
  weight: number;
  // Price from the partner. If it is missing, we use the default price.
  price?: number | null;
}

export interface SplitOptions {
  quantityDecimals: number;
  defaultPrice: string | number;
}

export interface SplitLine {
  symbol: string;
  weight: number;
  price: number;
  priceSource: PriceSource;
  // Weight times the total amount, in whole cents.
  targetAmount: number;
  // Shares to buy or sell, rounded down to the allowed decimals.
  quantity: number;
  // quantity times price, rounded down to the cent, so it never shows more than is really traded.
  amount: number;
}

// Thrown when a quantity has more digits than a JSON number can hold exactly.
export class QuantityTooPreciseError extends Error {
  constructor(public readonly symbol: string) {
    super(
      `The quantity for ${symbol} has too many digits to be returned exactly.`,
    );
  }
}

// A JavaScript number keeps 15 significant digits exactly.
const MAX_SAFE_DIGITS = 15;

export interface SplitResult {
  lines: SplitLine[];
  allocatedAmount: number;
  // Money left over because we round share quantities down.
  unallocatedAmount: number;
}

// Splits money into whole cents (largest remainder, so parts add up), then shares = amount/price rounded down.
export function splitOrder(
  totalAmount: number,
  holdings: SplitHolding[],
  options: SplitOptions,
): SplitResult {
  const totalCents = new D(totalAmount).mul(100);
  const targetsInCents = allocateCents(totalCents, holdings);

  const lines = holdings.map((holding, i): SplitLine => {
    const price = new D(holding.price ?? options.defaultPrice);
    const target = targetsInCents[i].div(100);
    const quantity = target
      .div(price)
      .toDecimalPlaces(options.quantityDecimals, D.ROUND_DOWN);
    if (quantity.precision(true) > MAX_SAFE_DIGITS) {
      throw new QuantityTooPreciseError(holding.symbol);
    }
    // Round down: 99.99 x 3.3333 = 333.2967 must show as 333.29, not 333.30.
    const amount = quantity.mul(price).toDecimalPlaces(2, D.ROUND_DOWN);
    return {
      symbol: holding.symbol,
      weight: holding.weight,
      price: price.toNumber(),
      priceSource: holding.price == null ? 'DEFAULT' : 'PARTNER',
      targetAmount: target.toNumber(),
      quantity: quantity.toNumber(),
      amount: amount.toNumber(),
    };
  });

  const allocated = lines.reduce(
    (sum, line) => sum.plus(line.amount),
    new D(0),
  );
  return {
    lines,
    allocatedAmount: allocated.toNumber(),
    unallocatedAmount: new D(totalAmount).minus(allocated).toNumber(),
  };
}

// Largest-remainder split: floor every share, then hand out the spare cents fairly.
function allocateCents(
  totalCents: Decimal,
  holdings: SplitHolding[],
): Decimal[] {
  const exact = holdings.map((h) => totalCents.mul(h.weight).div(100));
  const cents = exact.map((value) => value.floor());
  const spare = totalCents
    .minus(cents.reduce((sum, c) => sum.plus(c), new D(0)))
    .toNumber();

  const byLargestFraction = exact
    .map((value, index) => ({ index, fraction: value.minus(cents[index]) }))
    .sort((a, b) => b.fraction.cmp(a.fraction) || a.index - b.index);

  for (let i = 0; i < spare; i++) {
    const { index } = byLargestFraction[i];
    cents[index] = cents[index].plus(1);
  }
  return cents;
}
