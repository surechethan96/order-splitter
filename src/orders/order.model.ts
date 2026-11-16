import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderType } from './dto/create-order.dto';

export class OrderLine {
  @ApiProperty({ example: 'AAPL' })
  symbol: string;

  @ApiProperty({ example: 60, description: 'Percent of the portfolio.' })
  weight: number;

  @ApiProperty({ example: 100, description: 'Price used for the calculation.' })
  price: number;

  @ApiProperty({
    enum: ['PARTNER', 'DEFAULT'],
    description: 'Where the price came from.',
  })
  priceSource: 'PARTNER' | 'DEFAULT';

  @ApiProperty({ example: 60, description: 'Weight x total amount.' })
  targetAmount: number;

  @ApiProperty({
    example: 0.6,
    description: 'Shares to buy or sell (rounded down).',
  })
  quantity: number;

  @ApiProperty({
    example: 60,
    description: 'quantity x price, after rounding.',
  })
  amount: number;
}

export class Execution {
  @ApiProperty({
    example: '2026-11-16T14:30:00.000Z',
    description: 'When to execute (UTC).',
  })
  executeAt: string;

  @ApiProperty({ example: '2026-11-16T09:30:00.000-05:00' })
  executeAtMarketTime: string;

  @ApiProperty({
    description:
      'True if the market is open now and the orders can go at once.',
  })
  marketOpenNow: boolean;

  @ApiProperty({ example: 'America/New_York' })
  timezone: string;

  @ApiProperty({
    example: 'Market is closed. Execute at the next market open.',
  })
  note: string;
}

export class Order {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: OrderType })
  orderType: OrderType;

  @ApiPropertyOptional({ example: 'Growth 60/40' })
  portfolioName?: string;

  @ApiProperty({ example: 100 })
  totalAmount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: 3,
    description: 'Decimal places used for share quantities.',
  })
  quantityDecimals: number;

  @ApiProperty({ type: [OrderLine] })
  orders: OrderLine[];

  @ApiProperty({ example: 100, description: 'Sum of all order amounts.' })
  allocatedAmount: number;

  @ApiProperty({
    example: 0,
    description: 'Left over because quantities are rounded down.',
  })
  unallocatedAmount: number;

  @ApiProperty({ type: Execution })
  execution: Execution;

  @ApiProperty({ example: '2026-11-12T09:15:00.000Z' })
  createdAt: string;
}

export class PageMeta {
  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}

export class OrderPage {
  @ApiProperty({ type: [Order] })
  data: Order[];

  @ApiProperty({ type: PageMeta })
  meta: PageMeta;
}
