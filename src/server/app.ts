import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import { authRoutes } from './routes/auth';
import { itemRoutes } from './routes/items';
import { checkoutRoutes } from './routes/checkouts';
import { userRoutes } from './routes/users';
import { APP_VERSION } from '../shared/version';
import { ok } from '../shared/serialize';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export function buildApp(prisma: PrismaClient): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);

  app.register(cors, { origin: true });

  app.get('/api/health', async () => ok({ version: APP_VERSION, status: 'ok' }));

  app.register(authRoutes);
  app.register(itemRoutes);
  app.register(checkoutRoutes);
  app.register(userRoutes);

  return app;
}
