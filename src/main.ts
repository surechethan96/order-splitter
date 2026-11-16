import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, type AppConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);

  const logger = new Logger('Bootstrap');
  logger.log(`Console   http://localhost:${config.port}/`);
  logger.log(`Swagger   http://localhost:${config.port}/docs`);
  logger.log(`API       http://localhost:${config.port}/api/v1/orders`);
  logger.log(
    `Settings  quantity decimals=${config.quantityDecimals}, default price=$${config.defaultStockPrice}, ` +
      `market ${config.market.open}-${config.market.close} ${config.market.timezone}, ` +
      `api key ${config.apiKey ? 'on' : 'off'}`,
  );
}

void bootstrap();
