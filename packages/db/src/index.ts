import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

// Prisma 7: connection URL provided via adapter (not datasource block in schema).
// prisma.config.js provides the URL for CLI commands (migrate, studio).
// PrismaClient at runtime gets the URL via the @prisma/adapter-pg adapter.
function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'],
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });
}

// Singleton — prevents multiple PrismaClient instances during hot-reload in dev
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient, UserRole, SubmissionStatus } from '@prisma/client';
export type { Prisma, User } from '@prisma/client';
