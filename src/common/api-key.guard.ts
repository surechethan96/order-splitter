import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/app.config';

const IS_PUBLIC = 'isPublic';

// Marks a route that does not need an API key (for example the health check).
export const Public = () => SetMetadata(IS_PUBLIC, true);

// Simple API-key check. It only turns on when API_KEY is set, so the demo runs with zero setup.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.apiKey) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const sent = context.switchToHttp().getRequest<Request>().headers[
      'x-api-key'
    ];
    if (typeof sent === 'string' && this.matches(sent, this.config.apiKey))
      return true;
    throw new UnauthorizedException('A valid x-api-key header is required.');
  }

  // Compares in constant time, so the key cannot be guessed from response timing.
  private matches(sent: string, expected: string): boolean {
    const hash = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(hash(sent), hash(expected));
  }
}
