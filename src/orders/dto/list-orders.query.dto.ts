import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrderType } from './create-order.dto';

export class ListOrdersQueryDto {
  @ApiPropertyOptional({
    enum: OrderType,
    description: 'Show only BUY or only SELL orders.',
  })
  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @Max(100)
  @Min(1)
  @IsInt()
  limit: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 1_000_000 })
  @IsOptional()
  @Type(() => Number)
  @Max(1_000_000)
  @Min(0)
  @IsInt()
  offset: number = 0;
}
