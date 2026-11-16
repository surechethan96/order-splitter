import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app.config';
import { OrderType } from './dto/create-order.dto';
import { Order } from './order.model';

interface StoredOrder {
  order: Order;
  idempotencyKey?: string;
}

export interface IdempotencyRecord {
  fingerprint: string;
  order: Order;
}

// In-memory store (data is lost on restart, as asked). Kept behind this class so a real DB can replace it later.
@Injectable()
export class OrdersRepository {
  private readonly orders: StoredOrder[] = []; // oldest first
  private readonly byId = new Map<string, Order>();
  private readonly byIdempotencyKey = new Map<string, IdempotencyRecord>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  save(
    order: Order,
    idempotency?: { key: string; fingerprint: string },
  ): Order {
    this.orders.push({ order, idempotencyKey: idempotency?.key });
    this.byId.set(order.id, order);
    if (idempotency) {
      this.byIdempotencyKey.set(idempotency.key, {
        fingerprint: idempotency.fingerprint,
        order,
      });
    }
    this.evictOldest();
    return order;
  }

  findById(id: string): Order | undefined {
    return this.byId.get(id);
  }

  findByIdempotencyKey(key: string): IdempotencyRecord | undefined {
    return this.byIdempotencyKey.get(key);
  }

  // Newest first, with an optional BUY/SELL filter.
  findAll(filter: { orderType?: OrderType; limit: number; offset: number }): {
    items: Order[];
    total: number;
  } {
    const matching = this.orders
      .map((stored) => stored.order)
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
      this.byId.delete(oldest.order.id);
      if (oldest.idempotencyKey)
        this.byIdempotencyKey.delete(oldest.idempotencyKey);
    }
  }
}
