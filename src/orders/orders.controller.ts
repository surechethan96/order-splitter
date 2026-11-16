import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { Order, OrderPage } from './order.model';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiSecurity('api-key')
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary: 'Split an amount across a model portfolio',
    description:
      'Returns the amount and number of shares per stock, and when to execute. ' +
      'The result is saved in the order history.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Send the same key when you retry, to avoid creating the order twice.',
  })
  @ApiCreatedResponse({ type: Order })
  @ApiBadRequestResponse({ description: 'The request body is not valid.' })
  @ApiConflictResponse({
    description: 'Idempotency-Key reused with a different body.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Amount too small to trade any share.',
  })
  create(
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Order {
    if (
      idempotencyKey !== undefined &&
      !/^[\x21-\x7E]{1,128}$/.test(idempotencyKey)
    ) {
      throw new BadRequestException(
        'Idempotency-Key must be 1-128 visible ASCII characters.',
      );
    }
    const { order, replayed } = this.ordersService.create(dto, idempotencyKey);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.setHeader('Location', `/api/v1/orders/${order.id}`);
    return order;
  }

  @Get()
  @ApiOperation({ summary: 'List historic orders, newest first' })
  @ApiOkResponse({ type: OrderPage })
  findAll(@Query() query: ListOrdersQueryDto): OrderPage {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one historic order' })
  @ApiOkResponse({ type: Order })
  @ApiNotFoundResponse({ description: 'No order with this id.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Order {
    return this.ordersService.findOne(id);
  }
}
