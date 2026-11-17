import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { testConfig } from '../../test/helpers';
import { MarketCalendarService } from '../market/market-calendar.service';
import { CreateOrderDto, OrderType } from './dto/create-order.dto';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

function build(overrides = {}) {
  const config = testConfig(overrides);
  return new OrdersService(
    config,
    new OrdersRepository(config),
    new MarketCalendarService(config),
  );
}

const dto = (change: Partial<CreateOrderDto> = {}): CreateOrderDto => ({
  orderType: OrderType.BUY,
  totalAmount: 100,
  portfolio: [
    { symbol: 'AAPL', weight: 60 },
    { symbol: 'TSLA', weight: 40 },
  ],
  ...change,
});

describe('OrdersService', () => {
  it('creates an order with the split, the schedule and the settings used', () => {
    const { order, replayed } = build().create(
      dto({ portfolioName: 'Growth' }),
    );

    expect(replayed).toBe(false);
    expect(order).toMatchObject({
      orderType: 'BUY',
      portfolioName: 'Growth',
      totalAmount: 100,
      currency: 'USD',
      quantityDecimals: 3,
      allocatedAmount: 100,
      unallocatedAmount: 0,
    });
    expect(order.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      order.orders.map((line) => [line.symbol, line.amount, line.quantity]),
    ).toEqual([
      ['AAPL', 60, 0.6],
      ['TSLA', 40, 0.4],
    ]);
    expect(order.execution.executeAt).toBeDefined();
  });

  it('works the same way for SELL orders', () => {
    const { order } = build().create(dto({ orderType: OrderType.SELL }));
    expect(order.orderType).toBe('SELL');
    expect(order.orders[0].quantity).toBe(0.6);
  });

  it('uses the configured decimals and default price', () => {
    const service = build({ quantityDecimals: 7, defaultStockPrice: '3' });
    const { order } = service.create(
      dto({ portfolio: [{ symbol: 'AAPL', weight: 100 }] }),
    );

    expect(order.quantityDecimals).toBe(7);
    expect(order.orders[0]).toMatchObject({ price: 3, quantity: 33.3333333 });
  });

  it('keeps created orders in the history, newest first', () => {
    const service = build();
    const first = service.create(dto()).order;
    const second = service.create(dto({ orderType: OrderType.SELL })).order;

    expect(service.findAll({ limit: 20, offset: 0 })).toEqual({
      data: [second, first],
      meta: { total: 2, limit: 20, offset: 0 },
    });
    expect(
      service.findAll({ orderType: OrderType.SELL, limit: 20, offset: 0 }).data,
    ).toEqual([second]);
    expect(service.findOne(first.id)).toBe(first);
  });

  it('finds an order when the id is sent in upper case', () => {
    const service = build();
    const { order } = service.create(dto());
    expect(service.findOne(order.id.toUpperCase())).toBe(order);
  });

  it('stamps the order and the schedule with the same moment', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-11T15:00:00.123Z')); // market open
    try {
      const { order } = build().create(dto());
      expect(order.createdAt).toBe('2026-11-11T15:00:00.123Z');
      expect(order.execution).toMatchObject({
        marketOpenNow: true,
        executeAt: order.createdAt,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a stock that rounds to zero shares when another stock can trade', () => {
    const { order } = build({ quantityDecimals: 0 }).create(
      dto({
        totalAmount: 150,
        portfolio: [
          { symbol: 'AAPL', weight: 90 },
          { symbol: 'TSLA', weight: 10 },
        ],
      }),
    );
    expect(order.orders.map((line) => line.quantity)).toEqual([1, 0]);
    expect(order.unallocatedAmount).toBe(50);
  });

  it('refuses a quantity that cannot be returned exactly', () => {
    const service = build({ quantityDecimals: 8 });
    const tooPrecise = dto({
      totalAmount: 9999999.99,
      portfolio: [{ symbol: 'PENNY', weight: 100, price: 0.07 }],
    });
    expect(() => service.create(tooPrecise)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => service.create(tooPrecise)).toThrow(/PENNY/);
  });

  it('lets unexpected errors from the splitter through', () => {
    const service = build({ defaultStockPrice: 'not-a-number' });
    expect(() => service.create(dto())).toThrow(/Invalid argument/);
  });

  it('answers 404 for an unknown order', () => {
    expect(() => build().findOne('nope')).toThrow(NotFoundException);
  });

  it('refuses an amount that cannot buy any share', () => {
    const service = build({ quantityDecimals: 0 });
    expect(() => service.create(dto({ totalAmount: 50 }))).toThrow(
      UnprocessableEntityException,
    );
    expect(service.findAll({ limit: 20, offset: 0 }).meta.total).toBe(0);
  });

  describe('idempotency', () => {
    it('returns the first order again when the same key and body are sent', () => {
      const service = build();
      const first = service.create(dto(), 'key-1');
      const again = service.create(dto(), 'key-1');

      expect(again.replayed).toBe(true);
      expect(again.order).toBe(first.order);
      expect(service.findAll({ limit: 20, offset: 0 }).meta.total).toBe(1);
    });

    it('rejects the same key with a different body', () => {
      const service = build();
      service.create(dto(), 'key-1');
      expect(() => service.create(dto({ totalAmount: 200 }), 'key-1')).toThrow(
        ConflictException,
      );
    });

    it('treats a different stock order, price or name as a different request', () => {
      const service = build();
      service.create(dto(), 'key-1');
      const reordered = dto({ portfolio: [...dto().portfolio].reverse() });
      const withPrice = dto({
        portfolio: [
          { symbol: 'AAPL', weight: 60, price: 100 },
          { symbol: 'TSLA', weight: 40 },
        ],
      });
      expect(() => service.create(reordered, 'key-1')).toThrow(
        ConflictException,
      );
      expect(() => service.create(withPrice, 'key-1')).toThrow(
        ConflictException,
      );
      expect(() =>
        service.create(dto({ portfolioName: 'x' }), 'key-1'),
      ).toThrow(ConflictException);
      expect(() =>
        service.create(dto({ orderType: OrderType.SELL }), 'key-1'),
      ).toThrow(ConflictException);
    });

    it('does not remember a key when the request was rejected', () => {
      const service = build({ quantityDecimals: 0 });
      expect(() => service.create(dto({ totalAmount: 50 }), 'key-1')).toThrow(
        UnprocessableEntityException,
      );
      expect(service.create(dto({ totalAmount: 500 }), 'key-1').replayed).toBe(
        false,
      );
    });

    it('refuses a late retry whose order was dropped from history, instead of creating a duplicate', () => {
      const service = build({ maxStoredOrders: 1 });
      service.create(dto(), 'key-1');
      service.create(dto()); // pushes the first order out of history

      expect(() => service.create(dto(), 'key-1')).toThrow(ConflictException);
      expect(() => service.create(dto(), 'key-1')).toThrow(/removed/);
      expect(service.findAll({ limit: 20, offset: 0 }).meta.total).toBe(1);
    });

    it('creates separate orders for different keys or no key', () => {
      const service = build();
      service.create(dto(), 'key-1');
      service.create(dto(), 'key-2');
      service.create(dto());
      service.create(dto());
      expect(service.findAll({ limit: 20, offset: 0 }).meta.total).toBe(4);
    });
  });
});
