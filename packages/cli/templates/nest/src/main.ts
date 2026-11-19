import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { corsOrigin } from '@sabit/nest';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

/*
 * Logs one line per request (preflights included), sets security headers and CORS (CORS_ORIGIN; any origin
 * in development), validates DTOs in your own controllers (file routes use schema.ts) and runs shutdown
 * hooks when the app is stopped.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const http = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      http.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });
  app.use(helmet());
  app.enableCors({ origin: corsOrigin() });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Server is running on http://localhost:${port}`, 'Bootstrap');
}
await bootstrap();
