import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_CONFIG, loadConfig } from './app.config';

// Loads .env (if present), validates the settings once, and shares them app-wide.
@Global()
@Module({
  imports: [ConfigModule.forRoot()],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
