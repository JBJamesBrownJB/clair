import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app';
import { seed } from '../prisma/seed';

// One client + app for the suite. DATABASE_URL is set by tests/setup.ts before
// this module is imported.
export const prisma = new PrismaClient();
export const app: FastifyInstance = buildApp(prisma);

export async function resetDb(): Promise<void> {
  await seed(prisma);
}

export const SEED_LOGINS = {
  admin: { email: 'alice@larder.test', password: 'password123' },
  member: { email: 'bob@larder.test', password: 'password123' },
  viewer: { email: 'dave@larder.test', password: 'password123' },
} as const;

export async function tokenFor(role: keyof typeof SEED_LOGINS): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: SEED_LOGINS[role],
  });
  return res.json().data.token as string;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
