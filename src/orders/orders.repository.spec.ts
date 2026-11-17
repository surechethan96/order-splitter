import { testConfig } from '../../test/helpers';
import { OrderType } from './dto/create-order.dto';
import { Order } from './order.model';
import { OrdersRepository } from './orders.repository';

const order = (id: string, orderType = OrderType.BUY) =>
  ({ id, orderType }) as Order;

describe('OrdersRepository', () => {
  it('saves an order and finds it by id', () => {
    const repo = new OrdersRepository(testConfig());
    repo.save(order('1'));

    expect(repo.findById('1')).toEqual(order('1'));
    expect(repo.findById('missing')).toBeUndefined();
  });

  it('lists newest first, with a filter and paging', () => {
    const repo = new OrdersRepository(testConfig());
    repo.save(order('1'));
    repo.save(order('2', OrderType.SELL));
    repo.save(order('3'));

    expect(
      repo.findAll({ limit: 10, offset: 0 }).items.map((o) => o.id),
    ).toEqual(['3', '2', '1']);
    expect(repo.findAll({ limit: 1, offset: 1 })).toEqual({
      items: [order('2', OrderType.SELL)],
      total: 3,
    });
    expect(
      repo.findAll({ orderType: OrderType.BUY, limit: 10, offset: 0 }).total,
    ).toBe(2);
    expect(repo.findAll({ limit: 10, offset: 99 }).items).toEqual([]);
  });

  it('remembers idempotency keys', () => {
    const repo = new OrdersRepository(testConfig());
    repo.save(order('1'), { key: 'k1', fingerprint: 'abc' });

    expect(repo.findByIdempotencyKey('k1')).toEqual({
      fingerprint: 'abc',
      order: order('1'),
    });
    expect(repo.findByIdempotencyKey('other')).toBeUndefined();
  });

  it('drops the oldest orders once the limit is reached, but keeps their keys', () => {
    const repo = new OrdersRepository(testConfig({ maxStoredOrders: 2 }));
    repo.save(order('1'), { key: 'k1', fingerprint: 'abc' });
    repo.save(order('2'));
    repo.save(order('3'));

    expect(repo.findById('1')).toBeUndefined();
    expect(repo.findAll({ limit: 10, offset: 0 }).total).toBe(2);
    // The key is still known, with no order behind it.
    expect(repo.findByIdempotencyKey('k1')).toEqual({ fingerprint: 'abc' });
  });

  it('forgets the oldest keys once the key limit is reached', () => {
    const repo = new OrdersRepository(
      testConfig({ maxStoredOrders: 1, maxIdempotencyKeys: 2 }),
    );
    repo.save(order('1'), { key: 'k1', fingerprint: 'a' });
    repo.save(order('2'), { key: 'k2', fingerprint: 'b' });
    repo.save(order('3'), { key: 'k3', fingerprint: 'c' });

    expect(repo.findByIdempotencyKey('k1')).toBeUndefined();
    expect(repo.findByIdempotencyKey('k2')).toEqual({ fingerprint: 'b' });
    expect(repo.findByIdempotencyKey('k3')).toEqual({
      fingerprint: 'c',
      order: order('3'),
    });
  });
});
