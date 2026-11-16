import { Module } from '@nestjs/common';
import { MarketCalendarService } from '../market/market-calendar.service';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, MarketCalendarService],
})
export class OrdersModule {}
