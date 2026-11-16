import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/app.config';
import { MarketCalendarService } from '../market/market-calendar.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { Order, OrderPage } from './order.model';
import {
  QuantityTooPreciseError,
  splitOrder,
  type SplitResult,
} from './order-splitter';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repository: OrdersRepository,
    private readonly calendar: MarketCalendarService,
  ) {}

  // Splits the amount, decides when to execute and stores it. A repeated idempotency key returns the first order.
  create(
    dto: CreateOrderDto,
    idempotencyKey?: string,
  ): { order: Order; replayed: boolean } {
    const fingerprint = this.fingerprint(dto);

    if (idempotencyKey) {
      const previous = this.repository.findByIdempotencyKey(idempotencyKey);
      if (previous && previous.fingerprint !== fingerprint) {
        throw new ConflictException(
          'This Idempotency-Key was already used with a different request body.',
        );
      }
      if (previous) return { order: previous.order, replayed: true };
    }

    const split = this.split(dto);

    if (split.lines.every((line) => line.quantity === 0)) {
      throw new UnprocessableEntityException(
        `The amount is too small to trade any share with ${this.config.quantityDecimals} decimal places.`,
      );
    }

    const now = new Date();
    const order: Order = {
      id: randomUUID(),
      orderType: dto.orderType,
      portfolioName: dto.portfolioName,
      totalAmount: dto.totalAmount,
      currency: 'USD',
      quantityDecimals: this.config.quantityDecimals,
      orders: split.lines,
      allocatedAmount: split.allocatedAmount,
      unallocatedAmount: split.unallocatedAmount,
      execution: this.calendar.getExecutionSchedule(now),
      createdAt: now.toISOString(),
    };

    this.repository.save(
      order,
      idempotencyKey ? { key: idempotencyKey, fingerprint } : undefined,
    );
    return { order, replayed: false };
  }

  findAll(query: ListOrdersQueryDto): OrderPage {
    const { items, total } = this.repository.findAll(query);
    return {
      data: items,
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  findOne(id: string): Order {
    const order = this.repository.findById(id.toLowerCase());
    if (!order) throw new NotFoundException(`Order ${id} was not found.`);
    return order;
  }

  private split(dto: CreateOrderDto): SplitResult {
    try {
      return splitOrder(dto.totalAmount, dto.portfolio, {
        quantityDecimals: this.config.quantityDecimals,
        defaultPrice: this.config.defaultStockPrice,
      });
    } catch (error) {
      if (error instanceof QuantityTooPreciseError) {
        throw new UnprocessableEntityException(
          `${error.message} Use a smaller amount or a higher price.`,
        );
      }
      throw error;
    }
  }

  // A stable hash of the request, so we can spot a reused key sent with different data.
  private fingerprint(dto: CreateOrderDto): string {
    const canonical = JSON.stringify([
      dto.orderType,
      dto.totalAmount,
      dto.portfolioName ?? null,
      dto.portfolio.map((h) => [h.symbol, h.weight, h.price ?? null]),
    ]);
    return createHash('sha256').update(canonical).digest('hex');
  }
}
