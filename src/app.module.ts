import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { HealthController } from './health/health.controller';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [AppConfigModule, OrdersModule],
  controllers: [HealthController],
})
export class AppModule {}
