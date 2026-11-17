import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app.config';
import { OrderType } from './dto/create-order.dto';
import { Order } from './order.model';

// What we know about a used Idempotency-Key. `order` is missing when the order was dropped from history.
export interface IdempotencyRecord {
  fingerprint: string;
  order?: Order;
}

// In-memory store (data is lost on restart, as asked). Kept behind this class so a real DB can replace it later.
@Injectable()
export class OrdersRepository {
  private readonly orders: Order[] = []; // oldest first
  private readonly byId = new Map<string, Order>();
  // Kept apart from the history, so dropping an old order does not forget its key. A Map keeps insertion order.
  private readonly keys = new Map<
    string,
    { fingerprint: string; orderId: string }
  >();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  save(
    order: Order,
    idempotency?: { key: string; fingerprint: string },
  ): Order {
    this.orders.push(order);
    this.byId.set(order.id, order);
    if (idempotency) {
      this.keys.set(idempotency.key, {
        fingerprint: idempotency.fingerprint,
        orderId: order.id,
      });
    }
    this.evictOldest();
    return order;
  }

  findById(id: string): Order | undefined {
    return this.byId.get(id);
  }

  findByIdempotencyKey(key: string): IdempotencyRecord | undefined {
    const record = this.keys.get(key);
    if (!record) return undefined;
    return {
      fingerprint: record.fingerprint,
      order: this.byId.get(record.orderId),
    };
  }

  // Newest first, with an optional BUY/SELL filter.
  findAll(filter: { orderType?: OrderType; limit: number; offset: number }): {
    items: Order[];
    total: number;
  } {
    const matching = this.orders
      .filter(
        (order) => !filter.orderType || order.orderType === filter.orderType,
      )
      .reverse();
    return {
      items: matching.slice(filter.offset, filter.offset + filter.limit),
      total: matching.length,
    };
  }

  private evictOldest(): void {
    while (this.orders.length > this.config.maxStoredOrders) {
      const oldest = this.orders.shift()!;
      this.byId.delete(oldest.id);
    }
    // Oldest keys come first, so delete from the front until we are back under the limit.
    for (const key of this.keys.keys()) {
      if (this.keys.size <= this.config.maxIdempotencyKeys) break;
      this.keys.delete(key);
    }
  }
}
