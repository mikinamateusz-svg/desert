import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true, bodyLimit: 10 * 1024 * 1024 }),
  );

  // Required for POST /v1/submissions multipart photo upload
  await app.register(multipart);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // strip unknown fields
      forbidNonWhitelisted: true,
      transform: true,       // enable @Transform() decorators
    }),
  );

  // Hardening-2: enable SIGTERM → graceful onModuleDestroy chain so
  // RedisModule's destroy actually fires the shared client's QUIT,
  // and every BullMQ worker's destroy gets to close its Queue/Worker
  // + per-worker blocking ioredis. Without this, the entire chain of
  // "X lives in RedisModule's lifecycle" comments across the worker
  // files is aspirational. NestJS destroys in reverse-dependency
  // order, so workers tear down before RedisModule.
  app.enableShutdownHooks();

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3001;

  await app.listen(port, '0.0.0.0');
  console.log(`🌵 desert API running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application', err);
  process.exit(1);
});
