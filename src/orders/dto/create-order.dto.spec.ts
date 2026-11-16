import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

const valid = {
  orderType: 'BUY',
  totalAmount: 100,
  portfolio: [
    { symbol: 'AAPL', weight: 60 },
    { symbol: 'TSLA', weight: 40 },
  ],
};
const one = (holding: object) => ({ portfolio: [holding] });

// Same options as the real ValidationPipe in app.setup.ts.
async function messages(body: unknown): Promise<string> {
  const errors = await validate(plainToInstance(CreateOrderDto, body), {
    whitelist: true,
    stopAtFirstError: true,
  });
  return JSON.stringify(errors.map((e) => [e.constraints, e.children]));
}

describe('CreateOrderDto', () => {
  describe('accepts', () => {
    it('the example from the brief', async () => {
      expect(await messages(valid)).toBe('[]');
    });

    it('optional price and name, and upper-cases symbols', async () => {
      const dto = plainToInstance(CreateOrderDto, {
        ...valid,
        portfolioName: '  Growth  ',
        portfolio: [
          { symbol: ' aapl ', weight: 60, price: 187.53 },
          { symbol: 'brk.b', weight: 40, price: null },
        ],
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.portfolio.map((h) => h.symbol)).toEqual(['AAPL', 'BRK.B']);
      expect(dto.portfolioName).toBe('Growth');
    });

    it('a name of only spaces, and treats it as no name', async () => {
      const dto = plainToInstance(CreateOrderDto, {
        ...valid,
        portfolioName: '   ',
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.portfolioName).toBeUndefined();
    });

    it('weights that only add up to 100 without float errors', async () => {
      const portfolio = [
        { symbol: 'A', weight: 0.1 },
        { symbol: 'B', weight: 0.2 },
        { symbol: 'C', weight: 99.7 },
      ];
      expect(await messages({ ...valid, portfolio })).toBe('[]');
    });

    it.each([
      ['the smallest amount', { totalAmount: 0.01 }],
      ['the largest amount', { totalAmount: 10_000_000 }],
      ['an amount written as 1e2', { totalAmount: 1e2 }],
      ['a single stock at 100%', one({ symbol: 'A', weight: 100 })],
      [
        'the smallest and largest price',
        {
          portfolio: [
            { symbol: 'A', weight: 50, price: 0.01 },
            { symbol: 'B', weight: 50, price: 1_000_000 },
          ],
        },
      ],
      [
        'a price with 4 decimals',
        one({ symbol: 'A', weight: 100, price: 0.3333 }),
      ],
      ['a name of 100 characters', { portfolioName: 'x'.repeat(100) }],
      [
        '100 stocks',
        {
          portfolio: Array.from({ length: 100 }, (_, i) => ({
            symbol: `S${i}`,
            weight: 1,
          })),
        },
      ],
      [
        'symbols with digits, dot and dash',
        {
          portfolio: [
            { symbol: 'BRK.B', weight: 50 },
            { symbol: 'BF-B', weight: 25 },
            { symbol: 'A1', weight: 25 },
          ],
        },
      ],
    ])('%s', async (_name, change) => {
      expect(await messages({ ...valid, ...change })).toBe('[]');
    });
  });

  describe('rejects', () => {
    it.each([
      // order type
      ['an unknown order type', { orderType: 'HOLD' }, 'isEnum'],
      ['a lower-case order type', { orderType: 'buy' }, 'isEnum'],
      ['a missing order type', { orderType: undefined }, 'isEnum'],
      // amount
      ['a missing amount', { totalAmount: undefined }, 'isNumber'],
      ['a null amount', { totalAmount: null }, 'isNumber'],
      ['an amount sent as text', { totalAmount: '100' }, 'isNumber'],
      ['an amount that is not finite', { totalAmount: Infinity }, 'isNumber'],
      ['an amount that is NaN', { totalAmount: NaN }, 'isNumber'],
      ['a negative amount', { totalAmount: -5 }, '"min"'],
      ['an amount of zero', { totalAmount: 0 }, '"min"'],
      [
        'an amount with 3 decimals',
        { totalAmount: 10.001 },
        'at most 2 decimal places',
      ],
      [
        'a tiny amount written as 1e-7',
        { totalAmount: 1e-7 },
        'at most 2 decimal places',
      ],
      ['an amount above the limit', { totalAmount: 10_000_000.01 }, '"max"'],
      // name
      ['a name that is not text', { portfolioName: 5 }, 'isString'],
      [
        'a name of 101 characters',
        { portfolioName: 'x'.repeat(101) },
        'maxLength',
      ],
      // portfolio shape
      ['a missing portfolio', { portfolio: undefined }, 'isArray'],
      ['an empty portfolio', { portfolio: [] }, 'arrayMinSize'],
      ['a portfolio that is not a list', { portfolio: 'AAPL' }, 'isArray'],
      ['a portfolio that is an object', { portfolio: {} }, 'isArray'],
      [
        '101 stocks',
        {
          portfolio: Array.from({ length: 101 }, (_, i) => ({
            symbol: `S${i}`,
            weight: 1,
          })),
        },
        'arrayMaxSize',
      ],
      ['a null item', { portfolio: [null] }, 'must be an object'],
      ['a text item', { portfolio: ['AAPL'] }, 'must be an object'],
      [
        'a list inside the list',
        { portfolio: [[{ symbol: 'A', weight: 100 }]] },
        'must be an object',
      ],
      // symbols
      ['a missing symbol', one({ weight: 100 }), 'isString'],
      [
        'a symbol that is a number',
        one({ symbol: 123, weight: 100 }),
        'isString',
      ],
      ['an empty symbol', one({ symbol: '  ', weight: 100 }), 'symbol must be'],
      [
        'a symbol with a space or symbol',
        one({ symbol: 'AA PL!', weight: 100 }),
        'symbol must be',
      ],
      [
        'a symbol of 11 characters',
        one({ symbol: 'ABCDEFGHIJK', weight: 100 }),
        'symbol must be',
      ],
      [
        'a symbol that starts with a digit',
        one({ symbol: '1A', weight: 100 }),
        'symbol must be',
      ],
      [
        'the same symbol twice',
        {
          portfolio: [
            { symbol: 'AAPL', weight: 50 },
            { symbol: 'aapl', weight: 50 },
          ],
        },
        'only once',
      ],
      // weights
      [
        'weights below 100',
        one({ symbol: 'AAPL', weight: 60 }),
        'add up to exactly 100',
      ],
      [
        'weights above 100',
        {
          portfolio: [
            { symbol: 'AAPL', weight: 60 },
            { symbol: 'TSLA', weight: 50 },
          ],
        },
        'add up to exactly 100',
      ],
      [
        'weights that miss 100 by 0.01',
        {
          portfolio: [
            { symbol: 'A', weight: 33.33 },
            { symbol: 'B', weight: 33.33 },
            { symbol: 'C', weight: 33.33 },
          ],
        },
        'add up to exactly 100',
      ],
      ['a missing weight', one({ symbol: 'A' }), 'isNumber'],
      [
        'a weight sent as text',
        one({ symbol: 'A', weight: '100' }),
        'isNumber',
      ],
      [
        'a zero weight',
        {
          portfolio: [
            { symbol: 'A', weight: 0 },
            { symbol: 'B', weight: 100 },
          ],
        },
        '"min"',
      ],
      [
        'a negative weight',
        {
          portfolio: [
            { symbol: 'A', weight: -10 },
            { symbol: 'B', weight: 110 },
          ],
        },
        '"min"',
      ],
      [
        'a weight above 100',
        {
          portfolio: [
            { symbol: 'A', weight: 100.01 },
            { symbol: 'B', weight: -0.01 },
          ],
        },
        '"max"',
      ],
      [
        'a weight with 3 decimals',
        {
          portfolio: [
            { symbol: 'A', weight: 33.333 },
            { symbol: 'B', weight: 66.667 },
          ],
        },
        'at most 2 decimal places',
      ],
      [
        'a tiny weight written as 1e-7',
        {
          portfolio: [
            { symbol: 'A', weight: 1e-7 },
            { symbol: 'B', weight: 99.9999999 },
          ],
        },
        'at most 2 decimal places',
      ],
      // prices
      ['a price of zero', one({ symbol: 'A', weight: 100, price: 0 }), '"min"'],
      [
        'a negative price',
        one({ symbol: 'A', weight: 100, price: -1 }),
        '"min"',
      ],
      [
        'a price sent as text',
        one({ symbol: 'A', weight: 100, price: '10' }),
        'isNumber',
      ],
      [
        'a price with 5 decimals',
        one({ symbol: 'A', weight: 100, price: 1.00001 }),
        'at most 4 decimal places',
      ],
      [
        'a tiny price written as 1e-7',
        one({ symbol: 'A', weight: 100, price: 1e-7 }),
        'at most 4 decimal places',
      ],
      [
        'a price above the limit',
        one({ symbol: 'A', weight: 100, price: 1_000_000.01 }),
        '"max"',
      ],
    ])('%s', async (_name, change, expected) => {
      expect(await messages({ ...valid, ...change })).toContain(expected);
    });

    it('reports only the most basic problem for each field', async () => {
      const errors = await validate(
        plainToInstance(CreateOrderDto, {
          orderType: 'BUY',
          portfolio: valid.portfolio,
        }),
        { stopAtFirstError: true },
      );
      expect(errors).toHaveLength(1);
      expect(Object.keys(errors[0].constraints ?? {})).toEqual(['isNumber']);
    });
  });
});
