import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MaxDecimalPlaces, WeightsSumTo100 } from './validators';

export enum OrderType {
  BUY = 'BUY',
  SELL = 'SELL',
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// class-validator runs decorators bottom-up and stops at the first failure, so the basic type check goes last.
export class HoldingDto {
  @ApiProperty({
    example: 'AAPL',
    description: 'Ticker symbol. Lower case is accepted.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z][A-Z0-9.-]{0,9}$/, {
    message: 'symbol must be 1-10 characters: letters, digits, dot or dash',
  })
  @IsString()
  symbol: string;

  @ApiProperty({
    example: 60,
    description: 'Percent of the portfolio, 0.01 to 100 (up to 2 decimals).',
  })
  @Max(100)
  @Min(0.01)
  @MaxDecimalPlaces(2)
  @IsNumber({}, { message: '$property must be a number' })
  weight: number;

  @ApiPropertyOptional({
    example: 187.5,
    description:
      'Market price from the partner (up to 4 decimals). If missing or null, the fixed price ($100) is used.',
  })
  @IsOptional()
  @Max(1_000_000)
  @Min(0.01)
  @MaxDecimalPlaces(4)
  @IsNumber({}, { message: '$property must be a number' })
  price?: number | null;
}

export class CreateOrderDto {
  @ApiProperty({ enum: OrderType, example: OrderType.BUY })
  @IsEnum(OrderType)
  orderType: OrderType;

  @ApiProperty({
    example: 100,
    description: 'Total amount in USD, 0.01 to 10,000,000 (up to 2 decimals).',
  })
  @Max(10_000_000)
  @Min(0.01)
  @MaxDecimalPlaces(2)
  @IsNumber({}, { message: '$property must be a number' })
  totalAmount: number;

  @ApiPropertyOptional({
    example: 'Growth 60/40',
    description: 'Optional label for the history.',
  })
  @Transform((params) => trim(params) || undefined)
  @IsOptional()
  @MaxLength(100)
  @IsString()
  portfolioName?: string;

  @ApiProperty({
    type: [HoldingDto],
    description: 'The model portfolio. Weights must add up to exactly 100.',
    example: [
      { symbol: 'AAPL', weight: 60 },
      { symbol: 'TSLA', weight: 40 },
    ],
  })
  @WeightsSumTo100()
  @ArrayUnique((holding: HoldingDto) => holding?.symbol, {
    message: 'each symbol may appear only once in the portfolio',
  })
  @Type(() => HoldingDto)
  @ValidateNested({ each: true })
  @IsObject({ each: true, message: 'each item in portfolio must be an object' })
  @ArrayMaxSize(100)
  @ArrayMinSize(1)
  @IsArray()
  portfolio: HoldingDto[];
}
