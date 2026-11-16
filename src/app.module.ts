import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiKeyGuard } from './common/api-key.guard';
import { AppConfigModule } from './config/app-config.module';
import { APP_CONFIG, type AppConfig } from './config/app.config';
import { HealthController } from './health/health.controller';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [
        { ttl: config.rateLimit.ttlMs, limit: config.rateLimit.limit },
      ],
    }),
    OrdersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Rate limit first, so failed auth attempts (wrong/missing API key) are
    // throttled too and cannot be used to brute-force the key or abuse the service.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
