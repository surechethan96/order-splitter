import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'node:path';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { requestLogger } from './common/request-logger.middleware';

// Everything the HTTP layer needs. Shared by main.ts and the end-to-end tests.
export function configureApp(app: NestExpressApplication): void {
  app.use(
    helmet({
      // TLS ends at the load balancer in production, so do not force https on localhost.
      contentSecurityPolicy: {
        directives: { 'upgrade-insecure-requests': null },
      },
    }),
  );
  app.use(requestLogger());

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(
    // Reject unknown fields and wrong types before they reach the business code.
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true, // one clear message per field
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Order Splitter API')
      .setDescription(
        'Splits an amount across a model portfolio, tells you when to execute, and keeps the order history.',
      )
      .setVersion('1.0.0')
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Order Splitter API',
  });
}
