import {
  QuantityTooPreciseError,
  splitOrder,
  type SplitHolding,
} from './order-splitter';

const options = { quantityDecimals: 3, defaultPrice: '100' };

describe('splitOrder', () => {
  it('solves the example from the brief: $100 into AAPL 60% and TSLA 40%', () => {
    const result = splitOrder(
      100,
      [
        { symbol: 'AAPL', weight: 60 },
        { symbol: 'TSLA', weight: 40 },
      ],
      options,
    );

    expect(result.lines).toEqual([
      {
        symbol: 'AAPL',
        weight: 60,
        price: 100,
        priceSource: 'DEFAULT',
        targetAmount: 60,
        quantity: 0.6,
        amount: 60,
      },
      {
        symbol: 'TSLA',
        weight: 40,
        price: 100,
        priceSource: 'DEFAULT',
        targetAmount: 40,
        quantity: 0.4,
        amount: 40,
      },
    ]);
    expect(result.allocatedAmount).toBe(100);
    expect(result.unallocatedAmount).toBe(0);
  });

  it('uses the partner price when it is sent, and the fixed price otherwise', () => {
    const { lines } = splitOrder(
      100,
      [
        { symbol: 'AAPL', weight: 60, price: 187.5 },
        { symbol: 'TSLA', weight: 40, price: null },
      ],
      options,
    );

    expect(lines[0]).toMatchObject({
      price: 187.5,
      priceSource: 'PARTNER',
      quantity: 0.32,
      amount: 60,
    });
    expect(lines[1]).toMatchObject({
      price: 100,
      priceSource: 'DEFAULT',
      quantity: 0.4,
    });
  });

  it('respects the configured number of decimal places for quantity', () => {
    const holdings = [{ symbol: 'AAPL', weight: 100, price: 3 }];

    expect(
      splitOrder(100, holdings, { ...options, quantityDecimals: 3 }).lines[0]
        .quantity,
    ).toBe(33.333);
    expect(
      splitOrder(100, holdings, { ...options, quantityDecimals: 7 }).lines[0]
        .quantity,
    ).toBe(33.3333333);
    expect(
      splitOrder(100, holdings, { ...options, quantityDecimals: 0 }).lines[0]
        .quantity,
    ).toBe(33);
  });

  it('rounds quantity down and reports the money that could not be placed', () => {
    const result = splitOrder(
      100,
      [{ symbol: 'BRK', weight: 100, price: 333 }],
      {
        ...options,
        quantityDecimals: 2,
      },
    );

    expect(result.lines[0]).toMatchObject({ quantity: 0.3, amount: 99.9 });
    expect(result.allocatedAmount).toBe(99.9);
    expect(result.unallocatedAmount).toBe(0.1);
  });

  it('returns quantity 0 when the amount cannot buy the smallest allowed unit', () => {
    const result = splitOrder(
      1,
      [{ symbol: 'BRK', weight: 100, price: 5000 }],
      {
        ...options,
        quantityDecimals: 0,
      },
    );

    expect(result.lines[0]).toMatchObject({ quantity: 0, amount: 0 });
    expect(result.unallocatedAmount).toBe(1);
  });

  it('splits odd cents so the parts always add up to the total', () => {
    const { lines } = splitOrder(
      0.05,
      [
        { symbol: 'A', weight: 33.33 },
        { symbol: 'B', weight: 33.33 },
        { symbol: 'C', weight: 33.34 },
      ],
      options,
    );

    expect(lines.map((line) => line.targetAmount)).toEqual([0.02, 0.01, 0.02]);
  });

  it('is free of floating point drift (0.1 + 0.2 style weights)', () => {
    const { lines } = splitOrder(
      1000,
      [
        { symbol: 'A', weight: 0.1 },
        { symbol: 'B', weight: 0.2 },
        { symbol: 'C', weight: 99.7 },
      ],
      options,
    );

    expect(lines.map((line) => line.targetAmount)).toEqual([1, 2, 997]);
  });

  it('gives a single stock the whole amount', () => {
    const result = splitOrder(
      250.5,
      [{ symbol: 'AAPL', weight: 100 }],
      options,
    );
    expect(result.lines[0]).toMatchObject({
      targetAmount: 250.5,
      quantity: 2.505,
      amount: 250.5,
    });
  });

  it('handles the smallest amount: one cent goes to one stock, the others get nothing', () => {
    const { lines } = splitOrder(
      0.01,
      [
        { symbol: 'A', weight: 50, price: 0.01 },
        { symbol: 'B', weight: 50, price: 0.01 },
      ],
      options,
    );
    expect(lines.map((line) => [line.targetAmount, line.quantity])).toEqual([
      [0.01, 1],
      [0, 0],
    ]);
  });

  it('handles 100 stocks of 1% each', () => {
    const holdings = Array.from({ length: 100 }, (_, i) => ({
      symbol: `S${i}`,
      weight: 1,
    }));
    const result = splitOrder(12345.67, holdings, options);
    const cents = result.lines.reduce(
      (sum, l) => sum + Math.round(l.targetAmount * 100),
      0,
    );
    expect(cents).toBe(1234567);
    expect(result.lines.filter((l) => l.targetAmount === 123.46)).toHaveLength(
      67,
    );
    expect(result.lines.filter((l) => l.targetAmount === 123.45)).toHaveLength(
      33,
    );
  });

  it('keeps 4-decimal partner prices exact', () => {
    const { lines } = splitOrder(
      100,
      [{ symbol: 'A', weight: 100, price: 0.3333 }],
      {
        ...options,
        quantityDecimals: 4,
      },
    );
    expect(lines[0]).toMatchObject({
      price: 0.3333,
      quantity: 300.03,
      amount: 100,
    });
  });

  it('accepts the default price as text or as a number', () => {
    const holdings = [{ symbol: 'A', weight: 100 }];
    expect(
      splitOrder(100, holdings, { quantityDecimals: 3, defaultPrice: '250.5' })
        .lines[0].quantity,
    ).toBe(0.399);
    expect(
      splitOrder(100, holdings, { quantityDecimals: 3, defaultPrice: 250.5 })
        .lines[0].quantity,
    ).toBe(0.399);
  });

  it('refuses a quantity with more digits than a JSON number can hold exactly', () => {
    const split = () =>
      splitOrder(9999999.99, [{ symbol: 'PENNY', weight: 100, price: 0.07 }], {
        ...options,
        quantityDecimals: 8,
      });
    expect(split).toThrow(QuantityTooPreciseError);
    expect(split).toThrow(/PENNY/);
  });

  it('still allows the largest amount at normal prices with 8 decimals', () => {
    const { lines } = splitOrder(
      10_000_000,
      [{ symbol: 'A', weight: 100, price: 3 }],
      {
        ...options,
        quantityDecimals: 8,
      },
    );
    expect(lines[0].quantity).toBe(3333333.33333333);
  });

  it('never allocates more than the total, for many random portfolios', () => {
    let seed = 42;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    for (let run = 0; run < 300; run++) {
      const count = 1 + Math.floor(random() * 8);
      const basisPoints = Array.from(
        { length: count },
        () => 1 + Math.floor(random() * 1000),
      );
      const sum = basisPoints.reduce((a, b) => a + b, 0);
      // Turn random numbers into weights (2 decimals) that add up to exactly 100.
      const weights = basisPoints.map((bp) => Math.floor((bp / sum) * 10000));
      weights[0] += 10000 - weights.reduce((a, b) => a + b, 0);
      const holdings: SplitHolding[] = weights.map((w, i) => ({
        symbol: `S${i}`,
        weight: w / 100,
        price: Math.round((0.5 + random() * 900) * 100) / 100,
      }));
      const total = Math.round((0.01 + random() * 50000) * 100) / 100;

      const result = splitOrder(total, holdings, {
        defaultPrice: '100',
        quantityDecimals: run % 8,
      });

      const targetCents = result.lines.reduce(
        (s, l) => s + Math.round(l.targetAmount * 100),
        0,
      );
      expect(targetCents).toBe(Math.round(total * 100));
      expect(result.allocatedAmount).toBeLessThanOrEqual(total);
      expect(result.unallocatedAmount).toBeGreaterThanOrEqual(0);
      for (const line of result.lines) {
        expect(line.amount).toBeLessThanOrEqual(line.targetAmount);
      }
    }
  });
});
