import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './order.model';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

const order = { id: 'abc' } as Order;
const dto = {} as CreateOrderDto;

function build(replayed = false) {
  const service = {
    create: jest.fn().mockReturnValue({ order, replayed }),
    findAll: jest.fn().mockReturnValue({
      data: [order],
      meta: { total: 1, limit: 20, offset: 0 },
    }),
    findOne: jest.fn().mockReturnValue(order),
  };
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  return {
    controller: new OrdersController(service as unknown as OrdersService),
    service,
    setHeader,
    res,
  };
}

describe('OrdersController', () => {
  it('creates an order and points to it with a Location header', () => {
    const { controller, service, setHeader, res } = build();

    expect(controller.create(dto, 'key-1', res)).toBe(order);
    expect(service.create).toHaveBeenCalledWith(dto, 'key-1');
    expect(setHeader).toHaveBeenCalledWith('Location', '/api/v1/orders/abc');
    expect(setHeader).not.toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('marks a replayed response', () => {
    const { controller, setHeader, res } = build(true);
    controller.create(dto, 'key-1', res);
    expect(setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('rejects an idempotency key that is empty, too long or has odd characters', () => {
    const { controller, res } = build();
    expect(() => controller.create(dto, '', res)).toThrow(BadRequestException);
    expect(() => controller.create(dto, 'x'.repeat(129), res)).toThrow(
      BadRequestException,
    );
    expect(() => controller.create(dto, 'has space', res)).toThrow(
      BadRequestException,
    );
  });

  it('passes list and single reads to the service', () => {
    const { controller, service } = build();
    const query = { limit: 20, offset: 0 };

    expect(controller.findAll(query).data).toEqual([order]);
    expect(service.findAll).toHaveBeenCalledWith(query);
    expect(controller.findOne('abc')).toBe(order);
    expect(service.findOne).toHaveBeenCalledWith('abc');
  });
});
